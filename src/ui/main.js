import {
  BAR_IDS,
  DELAY_DIVISIONS,
  KEYBOARD_MAP,
  NOTE_NAMES,
  PAD_MIDI_START,
  VOICE_IDS,
  VOICES,
  clearSample,
  chopSample,
  createDefaultKit,
  createDrumMachine,
  getLevel,
  getPlayhead,
  getSample,
  loadKit,
  loadPattern,
  parseKit,
  parsePattern,
  patternToMidi,
  quantizePlayhead,
  renderToWav,
  serializeKit,
  serializePattern,
  setBpm,
  setSample,
  setSwing,
  startRepeat,
  startTransport,
  stopRepeat,
  stopTransport,
  triggerVoice,
} from "../engine.js";

const PATTERN_KEY = "atelier-drum-machine:pattern";
const KIT_KEY = "atelier-drum-machine:kit";
const DEMOS = [
  ["house", "House"],
  ["techno", "Techno"],
  ["dnb", "Drum and Bass"],
  ["boom-bap", "Boom Bap"],
  ["acid", "Acid"],
  ["garage", "Garage"],
];

const state = {
  pattern: null,
  kit: null,
  view: "A",
  selected: "kick",
  bassStep: 0,
  follow: true,
  repeat: null,
  recording: false,
  lastBuffer: null,
  repeats: new Map(),
};

let machine = null;
let saveTimer = 0;
let midiAccess = null;

const app = document.querySelector("#app");

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function ensure() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("This browser has no Web Audio support.");
  if (!machine) {
    machine = createDrumMachine(new Ctx());
    machine.onTrigger = onTrigger;
    const embedded = state.pattern && state.pattern.kit;
    state.pattern = loadPattern(machine, state.pattern);
    if (!embedded && state.kit) state.kit = loadKit(machine, state.kit);
    else state.kit = machine.kit;
    state.view = state.pattern.chain[0] || "A";
  }
  if (machine.context.state === "suspended") machine.context.resume();
  return machine;
}

function onTrigger(event) {
  if (event.voiceId !== "bass") flashPad(event.voiceId);
  if (!state.recording || !machine?.playing) return;
  if (event.source === "seq" || event.voiceId === "bass") return;
  const hit = quantizePlayhead(machine, event.time);
  const lane = state.pattern.bars[hit.barId].lanes[event.voiceId];
  if (!lane) return;
  lane[hit.step] = event.velocity;
  if (state.follow) state.view = hit.barId;
  paintLane(event.voiceId);
  setStatus(`Recorded ${labelOf(event.voiceId)} into ${hit.barId}`);
  scheduleSave();
}

function labelOf(id) {
  return VOICES.find((v) => v.id === id)?.label || id;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 300);
}

function saveLocal() {
  try {
    const copy = parsePattern(state.pattern);
    delete copy.kit;
    localStorage.setItem(PATTERN_KEY, serializePattern(copy));
    if (state.kit) localStorage.setItem(KIT_KEY, serializeKit(state.kit));
  } catch {
    /* private mode or a full store */
  }
}

function bar() {
  return state.pattern.bars[state.view];
}

function download(filename, bytes, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function el(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function mount() {
  app.replaceChildren(el(`
    <main class="machine">
      <header class="panel top">
        <div class="brand">
          <div class="mark" aria-hidden="true"></div>
          <div>
            <p class="eyebrow">Synthesised instrument</p>
            <h1>Atelier</h1>
            <small>Drum machine</small>
          </div>
        </div>
        <div class="transport">
          <label class="field">Name
            <input id="name" class="inline-input" type="text" maxlength="80" aria-label="Pattern name">
          </label>
          <label class="field">Tempo
            <input id="bpm" class="bpm" type="number" min="60" max="200" step="1" aria-label="Tempo in beats per minute">
          </label>
          <label class="field">Swing <span id="swing-read">0%</span>
            <input id="swing" class="slider" type="range" min="0" max="75" step="1" aria-label="Swing amount">
          </label>
          <div class="actions">
            <button id="play" class="btn primary" type="button">Play</button>
            <button id="stop" class="btn" type="button">Stop</button>
            <button id="rec" class="btn rec" type="button" aria-pressed="false">Record</button>
          </div>
          <div class="meter-wrap">
            <div class="meter" id="meter" aria-hidden="true">${"<i></i>".repeat(8)}</div>
          </div>
        </div>
      </header>

      <section class="stage">
        <section class="panel sequencer">
          <div class="seq-head">
            <div class="pats" id="pats"></div>
            <label class="check"><input id="follow" type="checkbox" checked> Follow</label>
          </div>
          <div class="seq-head">
            <div class="chain" id="chain"></div>
            <div class="demos" id="demos"></div>
          </div>
          <div class="seq-scroll" id="seq"><div class="lanes" id="lanes"></div></div>
        </section>
        <section class="panel performance">
          <div class="perf-head">
            <p class="section-label">Pads</p>
            <p class="status" id="midi-status">MIDI off</p>
          </div>
          <div class="pads" id="pads"></div>
          <div class="repeat-row">
            <span class="section-label">Note repeat</span>
            <div class="choices" id="repeats"></div>
            <button id="midi" class="btn" type="button">Enable MIDI</button>
          </div>
          <p class="hint">Tap the top of a pad for a harder hit. Keys 1–4, Q–R, A–F, Z–V. Shift plays softer.</p>
        </section>
      </section>

      <section class="panel desk">
        <div>
          <p class="section-label" id="voice-title">Voice</p>
          <div class="knob-row" id="voice-knobs"></div>
        </div>
        <div id="bass-box">
          <p class="section-label">Bass step</p>
          <div class="bass-edit" id="bass-edit"></div>
        </div>
        <div>
          <p class="section-label">Sample pad</p>
          <div class="knob-row" id="sample-box"></div>
        </div>
        <div>
          <p class="section-label">Master</p>
          <div class="knob-row" id="master-knobs"></div>
        </div>
        <div>
          <p class="section-label">Library</p>
          <div class="file-row">
            <button class="btn" id="save-pattern" type="button">Save pattern</button>
            <button class="btn" id="load-pattern" type="button">Load pattern</button>
            <button class="btn" id="save-kit" type="button">Save kit</button>
            <button class="btn" id="load-kit" type="button">Load kit</button>
            <button class="btn" id="clear-bar" type="button">Clear bar</button>
            <label class="field">Export
              <select id="export-bars" aria-label="Export length">
                <option value="bar">This bar</option>
                <option value="chain" selected>Chain</option>
                <option value="twice">Chain twice</option>
              </select>
            </label>
            <button class="btn primary" id="wav" type="button">Export WAV</button>
            <button class="btn" id="midi-file" type="button">Export MIDI</button>
          </div>
          <p class="status" id="status">Drop a WAV or MP3 onto a pad to play it from that pad.</p>
          <input id="file-pattern" class="hidden-file" type="file" accept="application/json,.json">
          <input id="file-kit" class="hidden-file" type="file" accept="application/json,.json">
        </div>
      </section>
    </main>
  `));

  renderPatterns();
  renderChain();
  renderDemos();
  renderRepeats();
  renderPads();
  renderLanes();
  renderVoice();
  renderBassEditor();
  renderSample();
  renderMaster();
  syncTransportInputs();
  bindStatic();
  requestAnimationFrame(frame);
}

function renderPatterns() {
  const root = document.querySelector("#pats");
  root.replaceChildren();
  for (const id of BAR_IDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pat${state.view === id ? " is-on" : ""}`;
    button.textContent = id;
    button.setAttribute("aria-pressed", String(state.view === id));
    button.addEventListener("click", () => {
      state.view = id;
      state.follow = false;
      document.querySelector("#follow").checked = false;
      renderPatterns();
      renderLanes();
      renderBassEditor();
    });
    root.append(button);
  }
}

function renderChain() {
  const root = document.querySelector("#chain");
  root.replaceChildren(Object.assign(document.createElement("span"), { className: "section-label", textContent: "Chain" }));
  state.pattern.chain.forEach((id, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.title = "Cycle the chained pattern";
    button.addEventListener("click", () => {
      const next = BAR_IDS[(BAR_IDS.indexOf(id) + 1) % BAR_IDS.length];
      state.pattern.chain[index] = next;
      if (machine) machine.pattern.chain = state.pattern.chain;
      renderChain();
      scheduleSave();
    });
    root.append(button);
  });
}

function renderDemos() {
  const root = document.querySelector("#demos");
  root.replaceChildren();
  for (const [id, name] of DEMOS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "demo";
    button.textContent = name;
    button.addEventListener("click", () => loadDemo(id));
    root.append(button);
  }
}

function renderRepeats() {
  const root = document.querySelector("#repeats");
  root.replaceChildren();
  for (const [id, label] of [[null, "Off"], ["1/8", "1/8"], ["1/16", "1/16"], ["1/32", "1/32"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice${state.repeat === id ? " is-on" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      state.repeat = id;
      renderRepeats();
    });
    root.append(button);
  }
}

function renderPads() {
  const root = document.querySelector("#pads");
  root.replaceChildren();
  VOICES.forEach((voice, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pad";
    button.dataset.voice = voice.id;
    button.innerHTML = `<strong></strong><em></em>`;
    button.querySelector("strong").textContent = voice.label;
    button.querySelector("em").textContent = `${voice.key} · ${PAD_MIDI_START + index}`;
    button.addEventListener("pointerdown", (event) => hitPad(event, voice.id, button));
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      button.classList.add("is-sel");
    });
    button.addEventListener("dragleave", () => button.classList.remove("is-sel"));
    button.addEventListener("drop", (event) => dropOnPad(event, voice.id, button));
    root.append(button);
  });
  markSelection();
  markSamples();
}

function renderLanes() {
  const root = document.querySelector("#lanes");
  root.replaceChildren();
  const current = bar();
  for (const voice of VOICES) {
    const row = document.createElement("div");
    row.className = "lane";
    row.dataset.voice = voice.id;
    const name = document.createElement("button");
    name.type = "button";
    name.className = `lane-name${state.selected === voice.id ? " is-on" : ""}`;
    name.textContent = voice.label;
    name.addEventListener("click", () => selectVoice(voice.id));
    row.append(name);
    current.lanes[voice.id].forEach((velocity, step) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `step${step % 4 === 0 ? " beat" : ""}`;
      cell.dataset.step = String(step);
      cell.dataset.voice = voice.id;
      cell.innerHTML = "<i></i>";
      paintStep(cell, velocity);
      cell.addEventListener("pointerdown", (event) => editStep(event, cell, voice.id, step));
      row.append(cell);
    });
    root.append(row);
  }
  const bass = document.createElement("div");
  bass.className = "bass-row";
  const name = document.createElement("button");
  name.type = "button";
  name.className = `lane-name${state.selected === "bass" ? " is-on" : ""}`;
  name.textContent = "Bass";
  name.addEventListener("click", () => selectVoice("bass"));
  bass.append(name);
  current.bass.forEach((step, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "bass-step";
    cell.dataset.bass = String(index);
    paintBassCell(cell, step, index);
    cell.addEventListener("click", () => {
      state.bassStep = index;
      state.selected = "bass";
      renderLanes();
      renderVoice();
      renderBassEditor();
      renderSample();
    });
    bass.append(cell);
  });
  root.append(bass);
}

function paintStep(cell, velocity) {
  const fill = cell.querySelector("i");
  fill.style.height = velocity > 0 ? `${Math.round(velocity * 100)}%` : "0";
  cell.setAttribute("aria-pressed", velocity > 0 ? "true" : "false");
  cell.title = velocity > 0 ? `Velocity ${velocity.toFixed(2)}` : "Empty step";
}

function paintBassCell(cell, step, index) {
  cell.classList.toggle("has", Boolean(step));
  cell.classList.toggle("is-sel", index === state.bassStep && state.selected === "bass");
  cell.textContent = step ? `${step.note}${step.octave}` : "·";
}

function paintLane(id) {
  document.querySelectorAll(`.step[data-voice="${id}"]`).forEach((cell) => {
    paintStep(cell, bar().lanes[id][Number(cell.dataset.step)]);
  });
}

function editStep(event, cell, id, step) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectVoice(id);
  const lane = bar().lanes[id];
  const startY = event.clientY;
  const start = lane[step];
  let moved = false;
  const move = (ev) => {
    if (Math.abs(ev.clientY - startY) < 5) return;
    moved = true;
    lane[step] = clamp((start || 0.75) + (startY - ev.clientY) / 90, 0.05, 1);
    paintStep(cell, lane[step]);
  };
  const up = () => {
    if (!moved) {
      lane[step] = start > 0 ? 0 : 0.85;
      paintStep(cell, lane[step]);
    }
    scheduleSave();
    cell.removeEventListener("pointermove", move);
    cell.removeEventListener("pointerup", up);
    cell.removeEventListener("pointercancel", up);
  };
  cell.setPointerCapture?.(event.pointerId);
  cell.addEventListener("pointermove", move);
  cell.addEventListener("pointerup", up);
  cell.addEventListener("pointercancel", up);
}

function renderVoice() {
  const root = document.querySelector("#voice-knobs");
  const title = document.querySelector("#voice-title");
  root.replaceChildren();
  if (state.selected === "bass") {
    title.textContent = "Resonant bass";
    const bass = state.kit.bass;
    root.append(selectKnob("Wave", ["saw", "square"], bass.wave, (value) => {
      commitKit({ bass: { wave: value } });
    }));
    for (const [key, label] of [["cutoff", "Cutoff"], ["resonance", "Resonance"], ["env", "Env"], ["decay", "Decay"], ["level", "Level"], ["drive", "Drive"], ["tune", "Tune"]]) {
      root.append(rangeKnob(label, bass[key], (value) => commitKit({ bass: { [key]: value } })));
    }
    return;
  }
  const voice = state.kit.voices[state.selected];
  title.textContent = labelOf(state.selected);
  if (state.selected === "kick") {
    root.append(keyKnob(voice.key));
    root.append(rangeKnob("Punch", voice.punch, (value) => commitVoice({ punch: value })));
  }
  for (const [key, label] of [["tune", "Tune"], ["decay", "Decay"], ["level", "Level"], ["drive", "Drive"]]) {
    root.append(rangeKnob(label, voice[key], (value) => commitVoice({ [key]: value })));
  }
  const sends = state.kit.sends[state.selected];
  root.append(rangeKnob("Reverb", sends.reverb, (value) => commitKit({ sends: { [state.selected]: { reverb: value } } })));
  root.append(rangeKnob("Delay", sends.delay, (value) => commitKit({ sends: { [state.selected]: { delay: value } } })));
}

function renderMaster() {
  const root = document.querySelector("#master-knobs");
  const master = state.kit.master;
  root.replaceChildren();
  for (const [key, label] of [["drive", "Drive"], ["compress", "Compress"], ["filter", "Filter"], ["reverb", "Reverb"], ["delay", "Delay"], ["level", "Level"]]) {
    root.append(rangeKnob(label, master[key], (value) => commitKit({ master: { [key]: value } })));
  }
  root.append(selectKnob("Delay time", DELAY_DIVISIONS, master.delayDivision, (value) => {
    commitKit({ master: { delayDivision: value } });
  }));
}

function renderSample() {
  const root = document.querySelector("#sample-box");
  root.replaceChildren();
  if (state.selected === "bass" || !machine) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = machine ? "Samples replace a drum pad, not the bass." : "Drop audio after the instrument wakes.";
    root.append(note);
    return;
  }
  const slot = getSample(machine, state.selected) || {
    enabled: false, pitch: 0, trimStart: 0, trimEnd: 1, attack: 0.002, decay: 1, reverse: false, choke: null, buffer: null,
  };
  const live = Boolean(slot.buffer);
  root.append(check("Use sample", live && slot.enabled, (on) => {
    if (!slot.buffer) return;
    setSample(machine, state.selected, slot.buffer, { enabled: on });
    markSamples();
    renderSample();
  }));
  root.append(rangeKnob("Pitch", (slot.pitch + 24) / 48, (value) => {
    if (!live) return;
    setSample(machine, state.selected, slot.buffer, { pitch: Math.round(value * 48 - 24), enabled: slot.enabled });
  }, (value) => `${Math.round(value * 48 - 24)} st`));
  root.append(rangeKnob("Start", slot.trimStart, (value) => patchSample({ trimStart: Math.min(value, slot.trimEnd - 0.01) })));
  root.append(rangeKnob("End", slot.trimEnd, (value) => patchSample({ trimEnd: Math.max(value, slot.trimStart + 0.01) })));
  root.append(rangeKnob("Attack", slot.attack / 0.2, (value) => patchSample({ attack: value * 0.2 })));
  root.append(rangeKnob("Decay", slot.decay, (value) => patchSample({ decay: Math.max(0.05, value) })));
  root.append(check("Reverse", slot.reverse, (on) => patchSample({ reverse: on }, true)));
  root.append(selectKnob("Choke", ["none", "hats", "perc", "metal"], slot.choke || "none", (value) => {
    patchSample({ choke: value === "none" ? null : value }, true);
  }));
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn";
  clear.textContent = "Clear sample";
  clear.addEventListener("click", () => {
    clearSample(machine, state.selected);
    markSamples();
    renderSample();
  });
  const chop = document.createElement("button");
  chop.type = "button";
  chop.className = "btn";
  chop.textContent = "Chop into 16";
  chop.disabled = !state.lastBuffer;
  chop.addEventListener("click", () => {
    ensure();
    chopSample(machine, state.lastBuffer, 16);
    markSamples();
    renderSample();
    setStatus("Loop chopped across all sixteen pads.");
  });
  root.append(clear, chop);
}

function patchSample(partial, refresh) {
  const slot = getSample(machine, state.selected);
  if (!slot?.buffer) return;
  setSample(machine, state.selected, slot.buffer, { ...partial, enabled: slot.enabled });
  if (refresh) renderSample();
}

function renderBassEditor() {
  const root = document.querySelector("#bass-edit");
  const step = bar().bass[state.bassStep];
  const draft = step || state.draft || { note: "C", octave: 2, velocity: 0.8, accent: false, slide: false };
  state.draft = { ...draft };
  root.replaceChildren();
  const place = document.createElement("button");
  place.type = "button";
  place.className = `btn${step ? " is-on" : ""}`;
  place.textContent = step ? `Step ${state.bassStep + 1} on` : `Place on ${state.bassStep + 1}`;
  place.addEventListener("click", () => {
    bar().bass[state.bassStep] = step ? null : { ...state.draft };
    renderLanes();
    renderBassEditor();
    scheduleSave();
  });
  root.append(place);
  root.append(selectKnob("Note", NOTE_NAMES, state.draft.note, (note) => updateBass({ note })));
  root.append(selectKnob("Octave", ["0", "1", "2", "3", "4", "5"], String(state.draft.octave), (value) => updateBass({ octave: Number(value) })));
  root.append(rangeKnob("Velocity", state.draft.velocity, (velocity) => updateBass({ velocity })));
  root.append(check("Accent", state.draft.accent, (accent) => updateBass({ accent })));
  root.append(check("Slide", state.draft.slide, (slide) => updateBass({ slide })));
}

function updateBass(partial) {
  state.draft = { ...state.draft, ...partial };
  if (bar().bass[state.bassStep]) {
    bar().bass[state.bassStep] = { ...bar().bass[state.bassStep], ...partial };
    const cell = document.querySelector(`.bass-step[data-bass="${state.bassStep}"]`);
    if (cell) paintBassCell(cell, bar().bass[state.bassStep], state.bassStep);
    scheduleSave();
  }
}

function rangeKnob(label, value, onInput, read) {
  const wrap = document.createElement("label");
  wrap.className = "knob";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1000";
  input.value = String(Math.round(clamp(value, 0, 1) * 1000));
  const out = document.createElement("span");
  const paint = () => {
    const v = Number(input.value) / 1000;
    out.textContent = read ? read(v) : `${Math.round(v * 100)}`;
  };
  input.addEventListener("input", () => {
    paint();
    onInput(Number(input.value) / 1000);
    scheduleSave();
  });
  paint();
  wrap.append(name, input, out);
  return wrap;
}

function selectKnob(label, options, value, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "knob";
  const name = document.createElement("span");
  name.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    select.append(node);
  }
  select.value = value;
  select.addEventListener("change", () => {
    onChange(select.value);
    scheduleSave();
  });
  wrap.append(name, select);
  return wrap;
}

function keyKnob(value) {
  const notes = [];
  for (const oct of [0, 1, 2]) for (const note of NOTE_NAMES) notes.push(`${note}${oct}`);
  return selectKnob("Key", notes, value, (key) => commitVoice({ key }));
}

function check(label, checked, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function commitVoice(partial) {
  commitKit({ voices: { [state.selected]: partial } });
}

function commitKit(partial) {
  const m = ensure();
  state.kit = loadKit(m, partial);
  if (partial.master || partial.bass || partial.voices) {
    /* values already applied */
  }
}

function syncTransportInputs() {
  document.querySelector("#name").value = state.pattern.name;
  document.querySelector("#bpm").value = String(state.pattern.bpm);
  document.querySelector("#swing").value = String(Math.round(state.pattern.swing * 100));
  document.querySelector("#swing-read").textContent = `${Math.round(state.pattern.swing * 100)}%`;
  document.querySelector("#play").textContent = machine?.playing ? "Playing" : "Play";
  document.querySelector("#play").classList.toggle("is-on", Boolean(machine?.playing));
  document.querySelector("#rec").classList.toggle("is-on", state.recording);
  document.querySelector("#rec").setAttribute("aria-pressed", String(state.recording));
}

function bindStatic() {
  document.querySelector("#name").addEventListener("change", (event) => {
    state.pattern.name = event.target.value.slice(0, 80) || "Untitled";
    if (machine) machine.pattern.name = state.pattern.name;
    scheduleSave();
  });
  document.querySelector("#bpm").addEventListener("change", (event) => {
    const m = ensure();
    setBpm(m, Number(event.target.value));
    state.pattern.bpm = m.bpm;
    event.target.value = String(m.bpm);
    scheduleSave();
  });
  document.querySelector("#swing").addEventListener("input", (event) => {
    const m = ensure();
    setSwing(m, Number(event.target.value) / 100);
    state.pattern.swing = m.swing;
    document.querySelector("#swing-read").textContent = `${Math.round(m.swing * 100)}%`;
    scheduleSave();
  });
  document.querySelector("#play").addEventListener("click", () => {
    const m = ensure();
    if (m.playing) return;
    startTransport(m);
    syncTransportInputs();
    setStatus("Transport running.");
  });
  document.querySelector("#stop").addEventListener("click", () => {
    if (!machine) return;
    stopTransport(machine);
    releaseRepeats();
    syncTransportInputs();
    paintPlayhead(-1);
  });
  document.querySelector("#rec").addEventListener("click", () => {
    ensure();
    state.recording = !state.recording;
    machine.recording = state.recording;
    syncTransportInputs();
    setStatus(state.recording ? "Record armed. Hits quantise to the playing bar." : "Record off.");
  });
  document.querySelector("#follow").addEventListener("change", (event) => {
    state.follow = event.target.checked;
  });
  document.querySelector("#clear-bar").addEventListener("click", () => {
    const current = bar();
    for (const id of VOICE_IDS) current.lanes[id].fill(0);
    current.bass.fill(null);
    renderLanes();
    renderBassEditor();
    scheduleSave();
  });
  document.querySelector("#save-pattern").addEventListener("click", () => {
    const copy = parsePattern(state.pattern);
    delete copy.kit;
    download(`${slug(copy.name)}.pattern.json`, serializePattern(copy), "application/json");
  });
  document.querySelector("#save-kit").addEventListener("click", () => {
    download(`${slug(state.kit.name)}.kit.json`, serializeKit(state.kit), "application/json");
  });
  document.querySelector("#load-pattern").addEventListener("click", () => document.querySelector("#file-pattern").click());
  document.querySelector("#load-kit").addEventListener("click", () => document.querySelector("#file-kit").click());
  document.querySelector("#file-pattern").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      adoptPattern(parsePattern(await file.text()));
      setStatus(`Loaded pattern ${state.pattern.name}.`);
    } catch (error) {
      setStatus(error.message);
    }
  });
  document.querySelector("#file-kit").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const m = ensure();
      state.kit = loadKit(m, parseKit(await file.text()));
      refreshEditors();
      scheduleSave();
      setStatus(`Loaded kit ${state.kit.name}.`);
    } catch (error) {
      setStatus(error.message);
    }
  });
  document.querySelector("#wav").addEventListener("click", exportWav);
  document.querySelector("#midi-file").addEventListener("click", exportMidi);
  document.querySelector("#midi").addEventListener("click", () => enableMidi(true));
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("dragover", (event) => event.preventDefault());
}

function slug(name) {
  return String(name || "atelier").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "atelier";
}

function adoptPattern(doc) {
  const m = machine ? ensure() : null;
  if (m) {
    state.pattern = loadPattern(m, doc);
    state.kit = m.kit;
  } else {
    state.pattern = doc;
    if (doc.kit) state.kit = parseKit(doc.kit);
  }
  state.view = state.pattern.chain[0] || "A";
  state.bassStep = 0;
  refreshEditors();
  renderPatterns();
  renderChain();
  renderLanes();
  syncTransportInputs();
  scheduleSave();
}

function refreshEditors() {
  renderVoice();
  renderBassEditor();
  renderSample();
  renderMaster();
}

async function loadDemo(id) {
  try {
    const response = await fetch(`src/demos/${id}.json`);
    if (!response.ok) throw new Error("Demo failed to load.");
    adoptPattern(parsePattern(await response.json()));
    setStatus(`Loaded ${state.pattern.name}.`);
  } catch (error) {
    setStatus(error.message);
  }
}

function exportDoc() {
  const mode = document.querySelector("#export-bars").value;
  const doc = parsePattern(state.pattern);
  delete doc.kit;
  if (mode === "bar") doc.chain = [state.view];
  return { doc, bars: mode === "twice" ? doc.chain.length * 2 : doc.chain.length };
}

async function exportWav() {
  const button = document.querySelector("#wav");
  button.disabled = true;
  setStatus("Rendering audio…");
  try {
    const { doc, bars } = exportDoc();
    const wav = await renderToWav(doc, { bars, kit: state.kit });
    download(`${slug(doc.name)}.wav`, wav, "audio/wav");
    setStatus("WAV ready.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

function exportMidi() {
  try {
    const { doc, bars } = exportDoc();
    const midi = patternToMidi(doc, { bars });
    download(`${slug(doc.name)}.mid`, midi, "audio/midi");
    setStatus("MIDI file ready.");
  } catch (error) {
    setStatus(error.message);
  }
}

function velocityFrom(event, node) {
  const rect = node.getBoundingClientRect();
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  return clamp(1 - y, 0.15, 1);
}

function hitPad(event, id, node) {
  if (event.button !== 0) return;
  event.preventDefault();
  const m = ensure();
  selectVoice(id);
  const velocity = velocityFrom(event, node);
  triggerVoice(m, id, { velocity, source: "pad" });
  if (state.repeat) {
    const token = startRepeat(m, id, { division: state.repeat, velocity });
    state.repeats.set(event.pointerId, token);
  }
  const end = () => {
    const token = state.repeats.get(event.pointerId);
    if (token) stopRepeat(m, token);
    state.repeats.delete(event.pointerId);
    node.removeEventListener("pointerup", end);
    node.removeEventListener("pointercancel", end);
  };
  node.setPointerCapture?.(event.pointerId);
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}

async function dropOnPad(event, id, node) {
  event.preventDefault();
  node.classList.remove("is-sel");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const m = ensure();
    const audio = await m.context.decodeAudioData((await file.arrayBuffer()).slice(0));
    state.lastBuffer = audio;
    setSample(m, id, audio, {
      enabled: true, pitch: 0, trimStart: 0, trimEnd: 1, attack: 0.002, decay: 1, reverse: false,
    });
    selectVoice(id);
    markSamples();
    renderSample();
    setStatus(`${file.name} is on ${labelOf(id)}. Chop slices the latest drop across the pads.`);
  } catch (error) {
    setStatus(error.message || "Could not decode that file.");
  }
}

function selectVoice(id) {
  if (state.selected === id) {
    markSelection();
    return;
  }
  state.selected = id;
  markSelection();
  document.querySelectorAll(".lane-name").forEach((node) => {
    const row = node.parentElement;
    const voice = row?.dataset.voice;
    const on = (voice && voice === id) || (id === "bass" && node.textContent === "Bass");
    node.classList.toggle("is-on", on);
  });
  renderVoice();
  renderSample();
  if (id === "bass") renderBassEditor();
}

function markSelection() {
  document.querySelectorAll(".pad").forEach((pad) => {
    pad.classList.toggle("is-sel", pad.dataset.voice === state.selected);
  });
}

function markSamples() {
  if (!machine) return;
  document.querySelectorAll(".pad").forEach((pad) => {
    const slot = getSample(machine, pad.dataset.voice);
    pad.classList.toggle("is-sample", Boolean(slot?.enabled && slot.buffer));
  });
}

function flashPad(id) {
  const pad = document.querySelector(`.pad[data-voice="${id}"]`);
  if (!pad) return;
  pad.classList.add("is-hit");
  setTimeout(() => pad.classList.remove("is-hit"), 110);
}

function paintPlayhead(step) {
  document.querySelectorAll(".step, .bass-step").forEach((cell) => {
    const index = cell.dataset.step ?? cell.dataset.bass;
    cell.classList.toggle("is-playhead", step >= 0 && Number(index) === step);
  });
}

let lastHead = "";
function frame() {
  if (machine) {
    const head = machine.playing ? getPlayhead(machine) : null;
    const key = head ? `${head.barId}:${head.step}` : "stop";
    if (key !== lastHead) {
      lastHead = key;
      if (head && state.follow && head.barId !== state.view) {
        state.view = head.barId;
        renderPatterns();
        renderLanes();
      }
      paintPlayhead(head ? head.step : -1);
      document.querySelector("#play").textContent = machine.playing ? "Playing" : "Play";
      document.querySelector("#play").classList.toggle("is-on", machine.playing);
    }
    const level = getLevel(machine);
    const cells = [...document.querySelectorAll("#meter i")];
    const lit = Math.round(level * cells.length);
    cells.forEach((cell, index) => {
      const on = cells.length - 1 - index < lit;
      cell.classList.toggle("on", on);
      cell.classList.toggle("hot", on && index < 2);
    });
  }
  requestAnimationFrame(frame);
}

function setStatus(text) {
  const node = document.querySelector("#status");
  if (node) node.textContent = text;
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName);
  if (event.code === "Space" && !typing) {
    event.preventDefault();
    const m = ensure();
    if (m.playing) {
      stopTransport(m);
      releaseRepeats();
    } else startTransport(m);
    syncTransportInputs();
    return;
  }
  if (typing || event.repeat) return;
  const index = KEYBOARD_MAP[event.code];
  if (index == null) return;
  event.preventDefault();
  const m = ensure();
  const id = VOICE_IDS[index];
  const velocity = event.shiftKey ? 0.45 : 0.92;
  triggerVoice(m, id, { velocity, source: "key" });
  selectVoice(id);
  if (state.repeat) state.repeats.set(event.code, startRepeat(m, id, { division: state.repeat, velocity }));
}

function onKeyUp(event) {
  const token = state.repeats.get(event.code);
  if (token && machine) stopRepeat(machine, token);
  state.repeats.delete(event.code);
}

function releaseRepeats() {
  if (!machine) return;
  for (const token of state.repeats.values()) stopRepeat(machine, token);
  state.repeats.clear();
}

async function enableMidi(gesture) {
  if (!navigator.requestMIDIAccess) {
    document.querySelector("#midi-status").textContent = "MIDI unavailable";
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    for (const input of midiAccess.inputs.values()) bindMidiInput(input);
    midiAccess.onstatechange = () => {
      for (const input of midiAccess.inputs.values()) bindMidiInput(input);
      paintMidi();
    };
    paintMidi();
  } catch (error) {
    document.querySelector("#midi-status").textContent = gesture ? "MIDI blocked" : "MIDI off";
    if (gesture) setStatus(error.message || "MIDI permission was denied.");
  }
}

function paintMidi() {
  const count = midiAccess ? [...midiAccess.inputs.values()].length : 0;
  document.querySelector("#midi-status").textContent = count ? `MIDI · ${count}` : "MIDI waiting";
}

function bindMidiInput(input) {
  input.onmidimessage = (message) => {
    const [status, note, velocity] = message.data;
    const command = status & 0xf0;
    const index = note - PAD_MIDI_START;
    if (index < 0 || index >= 16) return;
    const id = VOICE_IDS[index];
    if (command === 0x90 && velocity > 0) {
      const m = ensure();
      const level = velocity / 127;
      triggerVoice(m, id, { velocity: level, source: "midi" });
      if (state.repeat) state.repeats.set(`midi:${note}`, startRepeat(m, id, { division: state.repeat, velocity: level }));
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      const token = state.repeats.get(`midi:${note}`);
      if (token && machine) stopRepeat(machine, token);
      state.repeats.delete(`midi:${note}`);
    }
  };
}

async function boot() {
  let doc = null;
  try {
    const saved = localStorage.getItem(PATTERN_KEY);
    if (saved) doc = parsePattern(saved);
  } catch { /* ignore broken storage */ }
  if (!doc) {
    const response = await fetch("src/demos/house.json");
    doc = parsePattern(await response.json());
  }
  state.pattern = doc;
  try {
    const savedKit = localStorage.getItem(KIT_KEY);
    state.kit = savedKit ? parseKit(savedKit) : (doc.kit ? parseKit(doc.kit) : createDefaultKit());
  } catch {
    state.kit = doc.kit ? parseKit(doc.kit) : createDefaultKit();
  }
  state.view = doc.chain[0] || "A";
  mount();
  try {
    ensure();
    renderSample();
    markSamples();
  } catch {
    /* the first tap creates the audio context */
  }
  enableMidi(false);
  setStatus("Press play, or tap a pad. House is loaded.");
}

boot().catch((error) => {
  app.textContent = error.message;
});
