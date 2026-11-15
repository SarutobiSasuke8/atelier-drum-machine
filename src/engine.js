/**
 * Atelier Drum Machine audio engine.
 * DOM-free. Synthesis is oscillators, noise and envelopes only.
 * Intended to stay portable for a later move into atelier-dsp.
 *
 * Primary API: createDrumMachine, triggerVoice, loadPattern, renderToWav.
 */

export const STEPS = 16;
export const MIDI_PPQ = 480;
export const PAD_MIDI_START = 36;

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Pad order matches the on-screen grid, top to bottom, left to right. */
export const VOICES = [
  { id: "kick", label: "Kick", kind: "kick", key: "1", choke: null },
  { id: "snare", label: "Snare", kind: "snare", key: "2", choke: null },
  { id: "clap", label: "Clap", kind: "clap", key: "3", choke: null },
  { id: "rim", label: "Rim", kind: "rim", key: "4", choke: null },
  { id: "hat", label: "Hat", kind: "hat", key: "Q", choke: "hats" },
  { id: "hatOpen", label: "Open Hat", kind: "hatOpen", key: "W", choke: "hats" },
  { id: "tomLow", label: "Low Tom", kind: "tom", key: "E", choke: null },
  { id: "tomHigh", label: "High Tom", kind: "tom", key: "R", choke: null },
  { id: "cowbell", label: "Cowbell", kind: "cowbell", key: "A", choke: null },
  { id: "crash", label: "Crash", kind: "crash", key: "S", choke: null },
  { id: "shaker", label: "Shaker", kind: "shaker", key: "D", choke: null },
  { id: "conga", label: "Conga", kind: "tom", key: "F", choke: null },
  { id: "clave", label: "Clave", kind: "rim", key: "Z", choke: null },
  { id: "tamb", label: "Tamb", kind: "tamb", key: "X", choke: null },
  { id: "ride", label: "Ride", kind: "ride", key: "C", choke: null },
  { id: "perc", label: "Blip", kind: "perc", key: "V", choke: null },
];

export const VOICE_IDS = VOICES.map((v) => v.id);

export const KEYBOARD_MAP = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
  KeyQ: 4, KeyW: 5, KeyE: 6, KeyR: 7,
  KeyA: 8, KeyS: 9, KeyD: 10, KeyF: 11,
  KeyZ: 12, KeyX: 13, KeyC: 14, KeyV: 15,
};

export const BAR_IDS = ["A", "B", "C", "D"];
export const DELAY_DIVISIONS = ["1/4", "1/8", "1/8d", "1/16"];

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clampBpm(value) {
  return clamp(value, 60, 200);
}

/** Swing is 0 (straight) through 0.75 (hard shuffle). */
export function clampSwing(value) {
  return clamp(value, 0, 0.75);
}

export function midiNoteNumber(name, octave) {
  const index = NOTE_NAMES.indexOf(name);
  if (index < 0) throw new Error(`Unknown note "${name}"`);
  const oct = Number(octave);
  if (!Number.isInteger(oct) || oct < 0 || oct > 7) throw new Error(`Bad octave "${octave}"`);
  return (oct + 1) * 12 + index;
}

export function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

export function parseKey(key) {
  const match = /^([A-G]#?)([0-7])$/.exec(String(key || "A1"));
  if (!match) return { name: "A", octave: 1, label: "A1" };
  return { name: match[1], octave: Number(match[2]), label: `${match[1]}${match[2]}` };
}

function tunedHz(baseHz, tune) {
  const semis = (clamp(tune, 0, 1) - 0.5) * 24;
  return Math.max(20, baseHz * 2 ** (semis / 12));
}

/**
 * Time of a step inside one bar, in seconds.
 * Even steps stay on the grid. Odd steps (the off-beats) are delayed
 * by `swing` sixteenths, so 0.5 is a triplet shuffle.
 */
export function stepOffsetSeconds(stepIndex, bpm, swing) {
  const sixteenth = 60 / clampBpm(bpm) / 4;
  const pair = Math.floor(stepIndex / 2);
  const base = pair * 2 * sixteenth;
  if (stepIndex % 2 === 0) return base;
  return base + sixteenth * (1 + clampSwing(swing));
}

export function barDurationSeconds(bpm, swing) {
  return stepOffsetSeconds(STEPS, bpm, swing);
}

export function stepTick(stepIndex, swing) {
  const sixteenth = MIDI_PPQ / 4;
  const pair = Math.floor(stepIndex / 2);
  const base = pair * 2 * sixteenth;
  if (stepIndex % 2 === 0) return base;
  return Math.round(base + sixteenth * (1 + clampSwing(swing)));
}

export function divisionSeconds(bpm, division) {
  const beat = 60 / clampBpm(bpm);
  if (division === "1/8") return beat / 2;
  if (division === "1/32") return beat / 8;
  if (division === "1/4") return beat;
  if (division === "1/8d") return beat * 0.75;
  return beat / 4;
}

/**
 * Steps whose start time falls in [start, end).
 * Origin is the audio time of step 0 of cycle 0.
 */
export function stepsInRange({ bpm, swing, start, end, origin = 0 }) {
  const len = barDurationSeconds(bpm, swing);
  if (!(end > start) || len <= 0) return [];
  const first = Math.floor((start - origin) / len) - 1;
  const last = Math.floor((end - origin) / len) + 1;
  const events = [];
  for (let cycle = first; cycle <= last; cycle++) {
    for (let step = 0; step < STEPS; step++) {
      const time = origin + cycle * len + stepOffsetSeconds(step, bpm, swing);
      if (time >= start && time < end) events.push({ step, cycle, time });
    }
  }
  return events;
}

/** Nearest step to a time, measured from the start of a bar. Ties keep the earlier step. */
export function nearestStepIndex(time, bpm, swing) {
  const len = barDurationSeconds(bpm, swing);
  const t = ((time % len) + len) % len;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < STEPS; i++) {
    const s = stepOffsetSeconds(i, bpm, swing);
    const dist = Math.min(Math.abs(t - s), len - Math.abs(t - s));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function emptyLanes() {
  const lanes = {};
  for (const id of VOICE_IDS) lanes[id] = new Array(STEPS).fill(0);
  return lanes;
}

function emptyBass() {
  return new Array(STEPS).fill(null);
}

function emptyBar() {
  return { lanes: emptyLanes(), bass: emptyBass() };
}

function normalizeVelocity(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return clamp(n, 0, 1);
}

function normalizeBassStep(step) {
  if (step == null || step === false) return null;
  if (typeof step !== "object") throw new Error("Bass step must be an object or null");
  const velocity = normalizeVelocity(step.velocity ?? 0.8);
  if (velocity <= 0) return null;
  if (!NOTE_NAMES.includes(step.note)) throw new Error(`Unknown note "${step.note}"`);
  const octave = step.octave == null ? 2 : step.octave;
  midiNoteNumber(step.note, octave);
  return {
    note: step.note,
    octave,
    velocity,
    accent: Boolean(step.accent),
    slide: Boolean(step.slide),
  };
}

function normalizeBar(input) {
  const bar = emptyBar();
  const lanes = input && input.lanes;
  if (lanes && typeof lanes === "object") {
    for (const id of VOICE_IDS) {
      const src = lanes[id];
      if (!src) continue;
      if (!Array.isArray(src)) throw new Error(`Lane ${id} must be an array`);
      for (let i = 0; i < STEPS; i++) bar.lanes[id][i] = normalizeVelocity(src[i] ?? 0);
    }
  }
  const bass = input && input.bass;
  if (bass) {
    if (!Array.isArray(bass)) throw new Error("Bass lane must be an array");
    for (let i = 0; i < STEPS; i++) bar.bass[i] = normalizeBassStep(bass[i]);
  }
  return bar;
}

function normalizeChain(chain) {
  const list = Array.isArray(chain) ? chain.filter((id) => BAR_IDS.includes(id)) : [];
  return list.length ? list.slice(0, 16) : ["A"];
}

export function createEmptyPattern(name = "Untitled") {
  return normalizePattern({ name, bpm: 120, swing: 0, chain: ["A"] });
}

export function normalizePattern(input) {
  if (!input || typeof input !== "object") throw new Error("Pattern must be an object");
  if (input.format && input.format !== "atelier-pattern") {
    throw new Error(`Unknown pattern format "${input.format}"`);
  }
  const bars = {};
  for (const id of BAR_IDS) bars[id] = normalizeBar(input.bars && input.bars[id]);
  const pattern = {
    format: "atelier-pattern",
    version: 1,
    name: String(input.name || "Untitled").slice(0, 80),
    bpm: clampBpm(input.bpm ?? 120),
    swing: clampSwing(input.swing ?? 0),
    chain: normalizeChain(input.chain),
    bars,
  };
  if (input.kit && typeof input.kit === "object") pattern.kit = normalizeKit(input.kit);
  return pattern;
}

export function parsePattern(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  return normalizePattern(data);
}

export function serializePattern(pattern) {
  return JSON.stringify(normalizePattern(pattern));
}

function defaultVoiceParams(id) {
  const base = { tune: 0.5, decay: 0.45, level: 0.8, drive: 0.15 };
  if (id === "kick") return { ...base, decay: 0.42, level: 0.95, drive: 0.22, punch: 0.62, key: "A1" };
  if (id === "snare") return { ...base, tune: 0.52, decay: 0.38, level: 0.72, drive: 0.28 };
  if (id === "clap") return { ...base, decay: 0.4, level: 0.6, drive: 0.18 };
  if (id === "hat") return { ...base, tune: 0.58, decay: 0.28, level: 0.42, drive: 0.1 };
  if (id === "hatOpen") return { ...base, tune: 0.56, decay: 0.62, level: 0.4, drive: 0.1 };
  if (id === "tomLow") return { ...base, tune: 0.42, decay: 0.48, level: 0.7 };
  if (id === "tomHigh") return { ...base, tune: 0.62, decay: 0.4, level: 0.66 };
  if (id === "cowbell") return { ...base, tune: 0.55, decay: 0.36, level: 0.45 };
  if (id === "crash") return { ...base, decay: 0.7, level: 0.48, drive: 0.12 };
  if (id === "shaker") return { ...base, decay: 0.22, level: 0.36 };
  if (id === "ride") return { ...base, decay: 0.55, level: 0.4 };
  if (id === "perc") return { ...base, tune: 0.6, decay: 0.24, level: 0.5 };
  return base;
}

export function createDefaultKit(name = "Studio") {
  const voices = {};
  const sends = {};
  for (const id of VOICE_IDS) {
    voices[id] = defaultVoiceParams(id);
    const airy = id === "hat" || id === "hatOpen" || id === "snare" || id === "crash" || id === "ride";
    sends[id] = {
      reverb: airy ? (id === "crash" ? 0.35 : 0.12) : 0,
      delay: id === "clap" || id === "rim" ? 0.08 : 0,
    };
  }
  return normalizeKit({
    name,
    voices,
    sends,
    bass: {
      wave: "saw",
      cutoff: 0.28,
      resonance: 0.62,
      env: 0.55,
      decay: 0.42,
      level: 0.55,
      drive: 0.18,
      tune: 0.5,
    },
    master: {
      drive: 0.18,
      compress: 0.4,
      filter: 0.92,
      reverb: 0.16,
      delay: 0.1,
      delayDivision: "1/8",
      level: 0.86,
    },
  });
}

function normalizeVoiceParams(id, input) {
  const defaults = defaultVoiceParams(id);
  const src = input || {};
  const out = {
    tune: clamp(src.tune ?? defaults.tune, 0, 1),
    decay: clamp(src.decay ?? defaults.decay, 0, 1),
    level: clamp(src.level ?? defaults.level, 0, 1),
    drive: clamp(src.drive ?? defaults.drive, 0, 1),
  };
  if (id === "kick") {
    out.punch = clamp(src.punch ?? defaults.punch, 0, 1);
    out.key = parseKey(src.key || defaults.key).label;
  }
  return out;
}

export function normalizeKit(input) {
  if (!input || typeof input !== "object") throw new Error("Kit must be an object");
  if (input.format && input.format !== "atelier-kit") throw new Error(`Unknown kit format "${input.format}"`);
  const defaults = createDefaultKitRaw();
  const voices = {};
  const sends = {};
  for (const id of VOICE_IDS) {
    voices[id] = normalizeVoiceParams(id, input.voices && input.voices[id]);
    const send = (input.sends && input.sends[id]) || {};
    const baseSend = defaults.sends[id];
    sends[id] = {
      reverb: clamp(send.reverb ?? baseSend.reverb, 0, 1),
      delay: clamp(send.delay ?? baseSend.delay, 0, 1),
    };
  }
  const bassIn = input.bass || {};
  const masterIn = input.master || {};
  return {
    format: "atelier-kit",
    version: 1,
    name: String(input.name || "Studio").slice(0, 80),
    voices,
    sends,
    bass: {
      wave: bassIn.wave === "square" ? "square" : "saw",
      cutoff: clamp(bassIn.cutoff ?? defaults.bass.cutoff, 0, 1),
      resonance: clamp(bassIn.resonance ?? defaults.bass.resonance, 0, 1),
      env: clamp(bassIn.env ?? defaults.bass.env, 0, 1),
      decay: clamp(bassIn.decay ?? defaults.bass.decay, 0, 1),
      level: clamp(bassIn.level ?? defaults.bass.level, 0, 1),
      drive: clamp(bassIn.drive ?? defaults.bass.drive, 0, 1),
      tune: clamp(bassIn.tune ?? defaults.bass.tune, 0, 1),
    },
    master: {
      drive: clamp(masterIn.drive ?? defaults.master.drive, 0, 1),
      compress: clamp(masterIn.compress ?? defaults.master.compress, 0, 1),
      filter: clamp(masterIn.filter ?? defaults.master.filter, 0, 1),
      reverb: clamp(masterIn.reverb ?? defaults.master.reverb, 0, 1),
      delay: clamp(masterIn.delay ?? defaults.master.delay, 0, 1),
      delayDivision: DELAY_DIVISIONS.includes(masterIn.delayDivision) ? masterIn.delayDivision : defaults.master.delayDivision,
      level: clamp(masterIn.level ?? defaults.master.level, 0, 1),
    },
  };
}

function createDefaultKitRaw() {
  const voices = {};
  const sends = {};
  for (const id of VOICE_IDS) {
    voices[id] = defaultVoiceParams(id);
    sends[id] = { reverb: 0, delay: 0 };
  }
  return {
    voices,
    sends,
    bass: { wave: "saw", cutoff: 0.28, resonance: 0.62, env: 0.55, decay: 0.42, level: 0.55, drive: 0.18, tune: 0.5 },
    master: { drive: 0.18, compress: 0.4, filter: 0.92, reverb: 0.16, delay: 0.1, delayDivision: "1/8", level: 0.86 },
  };
}

export function parseKit(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  return normalizeKit(data);
}

export function serializeKit(kit) {
  return JSON.stringify(normalizeKit(kit));
}

function vlq(value) {
  let n = Math.max(0, value | 0);
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes.reverse();
}

function pushBytes(out, bytes) {
  for (const b of bytes) out.push(b);
}

export function buildMidiEvents(pattern, options = {}) {
  const doc = normalizePattern(pattern);
  const bars = Math.max(1, options.bars || doc.chain.length || 1);
  const events = [];
  const barTicks = MIDI_PPQ * 4;
  for (let cycle = 0; cycle < bars; cycle++) {
    const bar = doc.bars[doc.chain[cycle % doc.chain.length]];
    const origin = cycle * barTicks;
    for (let step = 0; step < STEPS; step++) {
      const tick = origin + stepTick(step, doc.swing);
      for (let v = 0; v < VOICE_IDS.length; v++) {
        const id = VOICE_IDS[v];
        if (id === "hatOpen" && bar.lanes.hat[step] > 0) continue;
        const velocity = bar.lanes[id][step];
        if (velocity <= 0) continue;
        const note = PAD_MIDI_START + v;
        const nextTick = step === STEPS - 1 ? origin + barTicks : origin + stepTick(step + 1, doc.swing);
        const dur = Math.max(20, Math.min(80, nextTick - tick - 10));
        events.push({ tick, type: "on", channel: 9, note, velocity: Math.max(1, Math.round(velocity * 127)), order: 1 });
        events.push({ tick: tick + dur, type: "off", channel: 9, note, velocity: 0, order: 0 });
      }
      const bass = bar.bass[step];
      if (!bass) continue;
      const note = midiNoteNumber(bass.note, bass.octave);
      let endTick;
      let nextIndex = -1;
      for (let k = step + 1; k < STEPS; k++) {
        if (bar.bass[k]) {
          nextIndex = k;
          break;
        }
      }
      if (nextIndex >= 0) endTick = origin + stepTick(nextIndex, doc.swing);
      else endTick = Math.min(origin + barTicks, tick + MIDI_PPQ);
      if (endTick <= tick) endTick = tick + 30;
      const vel = Math.max(1, Math.round(clamp(bass.velocity * (bass.accent ? 1.15 : 1), 0, 1) * 127));
      events.push({ tick, type: "on", channel: 0, note, velocity: vel, order: 1 });
      events.push({ tick: endTick, type: "off", channel: 0, note, velocity: 0, order: 0 });
    }
  }
  return { ppq: MIDI_PPQ, bpm: doc.bpm, events };
}

export function encodeMidi(track) {
  const events = [...track.events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const tempo = Math.round(60000000 / clampBpm(track.bpm));
  const body = [];
  const timed = [
    { tick: 0, order: -2, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    { tick: 0, order: -1, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
  ];
  for (const event of events) {
    const status = (event.type === "on" ? 0x90 : 0x80) | (event.channel & 0x0f);
    timed.push({
      tick: event.tick,
      order: event.order,
      data: [status, event.note & 127, event.velocity & 127],
    });
  }
  timed.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const lastTick = timed.length ? timed[timed.length - 1].tick : 0;
  timed.push({ tick: lastTick, order: 9, data: [0xff, 0x2f, 0x00] });
  let previous = 0;
  for (const event of timed) {
    pushBytes(body, vlq(event.tick - previous));
    previous = event.tick;
    pushBytes(body, event.data);
  }
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (track.ppq >> 8) & 255, track.ppq & 255,
  ];
  const out = [...header, 0x4d, 0x54, 0x72, 0x6b];
  const len = body.length;
  out.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255);
  pushBytes(out, body);
  return Uint8Array.from(out);
}

export function patternToMidi(pattern, options = {}) {
  return encodeMidi(buildMidiEvents(pattern, options));
}

function lcgNoise(ctx, seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = 123456789;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = (state / 4294967295) * 2 - 1;
  }
  return buffer;
}

function makeImpulse(ctx, seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let state = 2463534242;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223 + c * 97) >>> 0;
      const n = (state / 4294967295) * 2 - 1;
      const t = i / length;
      data[i] = n * (1 - t) ** 2.4 * 0.45;
    }
  }
  return buffer;
}

function driveCurve(amount) {
  const k = 1 + clamp(amount, 0, 1) * 22;
  const curve = new Float32Array(1024);
  const norm = Math.tanh(k);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function applyDrive(shaper, amount) {
  shaper.curve = driveCurve(amount);
  shaper.oversample = "2x";
}

function voiceById(id) {
  return VOICES.find((v) => v.id === id) || null;
}

function defaultSlot() {
  return {
    buffer: null,
    enabled: false,
    pitch: 0,
    trimStart: 0,
    trimEnd: 1,
    attack: 0.002,
    decay: 1,
    reverse: false,
    choke: null,
    _slice: null,
    _key: "",
  };
}

export function createDrumMachine(audioContext, options = {}) {
  if (!audioContext) throw new Error("createDrumMachine requires an AudioContext");
  const ctx = audioContext;
  const destination = options.destination || ctx.destination;

  const dry = ctx.createGain();
  const revSend = ctx.createGain();
  const delSend = ctx.createGain();
  const masterShaper = ctx.createWaveShaper();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 18000;
  filter.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  const mix = ctx.createGain();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;

  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  const revReturn = ctx.createGain();
  const delay = ctx.createDelay(1.5);
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 2800;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.36;
  const delayReturn = ctx.createGain();

  dry.connect(masterShaper);
  masterShaper.connect(filter);
  filter.connect(comp);
  comp.connect(mix);
  revSend.connect(convolver);
  convolver.connect(revReturn);
  revReturn.connect(mix);
  delSend.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delay.connect(delayReturn);
  delayReturn.connect(mix);
  mix.connect(master);
  master.connect(analyser);
  analyser.connect(destination);

  const buses = {};
  for (const voice of VOICES) {
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const output = ctx.createGain();
    const toRev = ctx.createGain();
    const toDel = ctx.createGain();
    input.connect(shaper);
    shaper.connect(output);
    output.connect(dry);
    output.connect(toRev);
    toRev.connect(revSend);
    output.connect(toDel);
    toDel.connect(delSend);
    applyDrive(shaper, 0.15);
    buses[voice.id] = { input, shaper, output, toRev, toDel };
  }

  const bassInput = ctx.createGain();
  const bassShaper = ctx.createWaveShaper();
  applyDrive(bassShaper, 0.18);
  bassInput.connect(bassShaper);
  bassShaper.connect(dry);

  const machine = {
    context: ctx,
    destination,
    pattern: createEmptyPattern(),
    kit: null,
    playing: false,
    recording: false,
    origin: 0,
    bpm: 120,
    swing: 0,
    buses,
    bassInput,
    bassShaper,
    master,
    filter,
    comp,
    analyser,
    convolver,
    delay,
    revReturn,
    delayReturn,
    _noise: null,
    _active: new Map(),
    _samples: new Map(),
    _repeats: new Map(),
    _repeatSerial: 0,
    _nextIndex: 0,
    _timer: null,
    _meter: new Float32Array(analyser.fftSize),
    _masterShaper: masterShaper,
    onTrigger: null,
  };
  machine.kit = createDefaultKit();
  applyKit(machine);
  return machine;
}

function noiseBuffer(machine) {
  if (!machine._noise || machine._noise.sampleRate !== machine.context.sampleRate) {
    machine._noise = lcgNoise(machine.context, 2);
  }
  return machine._noise;
}

function applyKit(machine) {
  const kit = machine.kit;
  for (const id of VOICE_IDS) {
    const bus = machine.buses[id];
    applyDrive(bus.shaper, kit.voices[id].drive);
    bus.toRev.gain.value = kit.sends[id].reverb;
    bus.toDel.gain.value = kit.sends[id].delay;
  }
  applyDrive(machine.bassShaper, kit.bass.drive);
  applyMaster(machine);
}

function applyMaster(machine) {
  const m = machine.kit.master;
  if (machine._masterShaper) applyDrive(machine._masterShaper, m.drive);
  const open = Math.min(20000, 160 * 2 ** (clamp(m.filter, 0, 1) * 7));
  machine.filter.frequency.value = open;
  const amount = clamp(m.compress, 0, 1);
  machine.comp.threshold.value = -10 - amount * 18;
  machine.comp.ratio.value = 1 + amount * 7;
  machine.comp.knee.value = 8 + amount * 10;
  machine.comp.attack.value = 0.004;
  machine.comp.release.value = 0.12 + (1 - amount) * 0.08;
  machine.revReturn.gain.value = clamp(m.reverb, 0, 1) * 0.9;
  machine.delayReturn.gain.value = clamp(m.delay, 0, 1) * 0.7;
  machine.master.gain.value = clamp(m.level, 0, 1) * (1 + amount * 0.15);
  syncTempoFx(machine);
}

function syncTempoFx(machine) {
  const beat = 60 / clampBpm(machine.bpm);
  const div = machine.kit.master.delayDivision;
  const map = { "1/4": beat, "1/8": beat / 2, "1/8d": beat * 0.75, "1/16": beat / 4 };
  machine.delay.delayTime.value = Math.min(1.4, map[div] || beat / 2);
  const tail = Math.min(2.2, Math.max(0.35, beat * 2));
  if (Math.abs((machine._reverbTail || 0) - tail) > 0.08 || !machine.convolver.buffer) {
    machine._reverbTail = tail;
    machine.convolver.buffer = makeImpulse(machine.context, tail);
  }
}

export function loadKit(machine, kit) {
  const partial = typeof kit === "string" ? JSON.parse(kit) : kit;
  const base = machine.kit || createDefaultKit();
  const voices = {};
  const sends = {};
  for (const id of VOICE_IDS) {
    voices[id] = { ...base.voices[id], ...((partial.voices && partial.voices[id]) || {}) };
    sends[id] = { ...base.sends[id], ...((partial.sends && partial.sends[id]) || {}) };
  }
  machine.kit = normalizeKit({
    name: partial.name || base.name,
    voices,
    sends,
    bass: { ...base.bass, ...(partial.bass || {}) },
    master: { ...base.master, ...(partial.master || {}) },
  });
  applyKit(machine);
  return machine.kit;
}

export function loadPattern(machine, pattern) {
  const doc = parsePattern(pattern);
  machine.pattern = doc;
  machine.bpm = doc.bpm;
  machine.swing = doc.swing;
  if (doc.kit) loadKit(machine, doc.kit);
  syncTempoFx(machine);
  return doc;
}

function stepGap(step, bpm, swing) {
  const a = stepOffsetSeconds(step, bpm, swing);
  const b = step === STEPS - 1 ? barDurationSeconds(bpm, swing) : stepOffsetSeconds(step + 1, bpm, swing);
  return Math.max(0.03, b - a);
}

function trackActive(machine, key, item) {
  const list = machine._active.get(key) || [];
  list.push(item);
  machine._active.set(key, list);
}

function chokeKey(machine, key, time) {
  const list = machine._active.get(key);
  if (!list) return;
  const keep = [];
  for (const item of list) {
    if (item.startTime <= time + 0.0001) item.choke(time);
    else keep.push(item);
  }
  machine._active.set(key, keep);
}

function makeStop(ctx, gain, nodes, startTime) {
  return (at) => {
    const when = Number.isFinite(at) ? at : ctx.currentTime;
    if (startTime > when + 0.004) {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      } catch { /* already stopped */ }
      for (const node of nodes) {
        try { node.stop(startTime); } catch { /* already stopped */ }
      }
      return;
    }
    const t = Math.max(when, startTime);
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    } catch { /* param race */ }
    for (const node of nodes) {
      try { node.stop(t + 0.03); } catch { /* already stopped */ }
    }
  };
}

function envDown(param, time, peak, attack, decay) {
  const a = Math.max(0.0015, attack);
  const d = Math.max(a + 0.02, decay);
  const p = Math.max(0.0008, peak);
  param.cancelScheduledValues(time);
  param.setValueAtTime(0.0001, time);
  param.exponentialRampToValueAtTime(p, time + a);
  param.exponentialRampToValueAtTime(0.0001, time + d);
  return d;
}

function spawnNoise(ctx, buffer, time, duration) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(time);
  src.stop(time + duration + 0.05);
  return src;
}

function metalOscs(ctx, time, base, ratios, duration, type = "square") {
  const oscs = [];
  for (const ratio of ratios) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, base * ratio), time);
    osc.start(time);
    osc.stop(time + duration + 0.05);
    oscs.push(osc);
  }
  return oscs;
}

const METAL = [1, 1.37, 1.81, 2.43, 3.09];

function triggerKick(machine, time, velocity) {
  const ctx = machine.context;
  const voice = machine.kit.voices.kick;
  const dest = machine.buses.kick.input;
  const key = parseKey(voice.key);
  const base = tunedHz(midiToHz(midiNoteNumber(key.name, key.octave)), voice.tune);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const startF = base * (1 + voice.punch * 6.5);
  osc.frequency.setValueAtTime(Math.max(35, startF), time);
  if (startF > base + 1) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, base), time + 0.028 + voice.punch * 0.05);
  }
  const gain = ctx.createGain();
  const decay = 0.12 + voice.decay * 0.95;
  envDown(gain.gain, time, velocity * voice.level, 0.002, decay);
  const click = ctx.createGain();
  const clickSrc = spawnNoise(ctx, noiseBuffer(machine), time, 0.03);
  const clickHp = ctx.createBiquadFilter();
  clickHp.type = "highpass";
  clickHp.frequency.value = 1800;
  envDown(click.gain, time, velocity * voice.punch * 0.45 * voice.level, 0.001, 0.02);
  clickSrc.connect(clickHp);
  clickHp.connect(click);
  click.connect(dest);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.05);
  const choke = makeStop(ctx, gain, [osc, clickSrc], time);
  trackActive(machine, "kick", { startTime: time, choke });
}

function triggerSnare(machine, time, velocity) {
  const ctx = machine.context;
  const voice = machine.kit.voices.snare;
  const dest = machine.buses.snare.input;
  const toneF = tunedHz(196, voice.tune);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(toneF * 1.6, time);
  osc.frequency.exponentialRampToValueAtTime(toneF, time + 0.04);
  const toneGain = ctx.createGain();
  envDown(toneGain.gain, time, velocity * voice.level * 0.55, 0.002, 0.05 + voice.decay * 0.12);
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, 0.15 + voice.decay * 0.55);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = tunedHz(1850, voice.tune);
  bp.Q.value = 0.8;
  const nGain = ctx.createGain();
  const decay = 0.08 + voice.decay * 0.42;
  envDown(nGain.gain, time, velocity * voice.level * 0.85, 0.002, decay);
  osc.connect(toneGain);
  toneGain.connect(dest);
  noise.connect(bp);
  bp.connect(nGain);
  nGain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.05);
  const gain = ctx.createGain();
  gain.gain.value = 1;
  const choke = (at) => {
    makeStop(ctx, toneGain, [osc], time)(at);
    makeStop(ctx, nGain, [noise], time)(at);
  };
  trackActive(machine, "snare", { startTime: time, choke });
  void gain;
}

function triggerClap(machine, time, velocity) {
  const ctx = machine.context;
  const voice = machine.kit.voices.clap;
  const dest = machine.buses.clap.input;
  const decay = 0.12 + voice.decay * 0.38;
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, decay);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = tunedHz(1250, voice.tune);
  bp.Q.value = 0.85;
  const gain = ctx.createGain();
  const peak = Math.max(0.001, velocity * voice.level * 0.8);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.011);
  gain.gain.exponentialRampToValueAtTime(peak * 0.9, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.024);
  gain.gain.exponentialRampToValueAtTime(peak * 0.75, time + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  noise.connect(bp);
  bp.connect(gain);
  gain.connect(dest);
  trackActive(machine, "clap", { startTime: time, choke: makeStop(ctx, gain, [noise], time) });
}

function triggerHat(machine, time, velocity, open) {
  const ctx = machine.context;
  const id = open ? "hatOpen" : "hat";
  const voice = machine.kit.voices[id];
  const dest = machine.buses[id].input;
  const decay = open ? 0.12 + voice.decay * 0.7 : 0.02 + voice.decay * 0.09;
  const base = tunedHz(open ? 2800 : 3200, voice.tune);
  const oscs = metalOscs(ctx, time, base, METAL, decay);
  const mix = ctx.createGain();
  mix.gain.value = 0.18;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5500;
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, decay);
  const nGain = ctx.createGain();
  nGain.gain.value = open ? 0.55 : 0.35;
  const gain = ctx.createGain();
  envDown(gain.gain, time, velocity * voice.level, 0.0015, decay);
  for (const osc of oscs) osc.connect(mix);
  mix.connect(hp);
  hp.connect(gain);
  noise.connect(nGain);
  nGain.connect(hp);
  gain.connect(dest);
  const choke = (at) => makeStop(ctx, gain, [...oscs, noise], time)(at);
  trackActive(machine, id, { startTime: time, choke });
  trackActive(machine, "group:hats", { startTime: time, choke });
}

function triggerTom(machine, time, velocity, id) {
  const ctx = machine.context;
  const voice = machine.kit.voices[id];
  const dest = machine.buses[id].input;
  const roots = { tomLow: 92, tomHigh: 168, conga: 210 };
  const base = tunedHz(roots[id] || 140, voice.tune);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(base * 1.9, time);
  osc.frequency.exponentialRampToValueAtTime(base, time + 0.06);
  const gain = ctx.createGain();
  const decay = 0.08 + voice.decay * (id === "conga" ? 0.45 : 0.55);
  envDown(gain.gain, time, velocity * voice.level, 0.002, decay);
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, 0.05);
  const nGain = ctx.createGain();
  envDown(nGain.gain, time, velocity * voice.level * 0.18, 0.001, 0.04);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 400;
  osc.connect(gain);
  gain.connect(dest);
  noise.connect(hp);
  hp.connect(nGain);
  nGain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.05);
  const choke = (at) => {
    makeStop(ctx, gain, [osc], time)(at);
    makeStop(ctx, nGain, [noise], time)(at);
  };
  trackActive(machine, id, { startTime: time, choke });
}

function triggerRim(machine, time, velocity, id) {
  const ctx = machine.context;
  const voice = machine.kit.voices[id];
  const dest = machine.buses[id].input;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(tunedHz(id === "clave" ? 2100 : 640, voice.tune), time);
  const gain = ctx.createGain();
  const decay = 0.02 + voice.decay * 0.06;
  envDown(gain.gain, time, velocity * voice.level * 0.45, 0.001, decay);
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, 0.03);
  const nGain = ctx.createGain();
  envDown(nGain.gain, time, velocity * voice.level * 0.35, 0.001, 0.018);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;
  osc.connect(gain);
  gain.connect(dest);
  noise.connect(hp);
  hp.connect(nGain);
  nGain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.04);
  const choke = (at) => {
    makeStop(ctx, gain, [osc], time)(at);
    makeStop(ctx, nGain, [noise], time)(at);
  };
  trackActive(machine, id, { startTime: time, choke });
}

function triggerCowbell(machine, time, velocity) {
  const ctx = machine.context;
  const voice = machine.kit.voices.cowbell;
  const dest = machine.buses.cowbell.input;
  const f1 = tunedHz(540, voice.tune);
  const a = ctx.createOscillator();
  const b = ctx.createOscillator();
  a.type = "square";
  b.type = "square";
  a.frequency.setValueAtTime(f1, time);
  b.frequency.setValueAtTime(f1 * 1.48, time);
  const mix = ctx.createGain();
  mix.gain.value = 0.4;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f1 * 1.3;
  bp.Q.value = 4.5;
  const gain = ctx.createGain();
  const decay = 0.05 + voice.decay * 0.28;
  envDown(gain.gain, time, velocity * voice.level, 0.001, decay);
  a.connect(mix);
  b.connect(mix);
  mix.connect(bp);
  bp.connect(gain);
  gain.connect(dest);
  a.start(time);
  b.start(time);
  a.stop(time + decay + 0.05);
  b.stop(time + decay + 0.05);
  trackActive(machine, "cowbell", { startTime: time, choke: makeStop(ctx, gain, [a, b], time) });
}

function triggerCrash(machine, time, velocity, id) {
  const ctx = machine.context;
  const voice = machine.kit.voices[id];
  const dest = machine.buses[id].input;
  const open = id === "crash";
  const decay = open ? 0.4 + voice.decay * 1.8 : 0.08 + voice.decay * 0.7;
  const base = tunedHz(open ? 380 : 620, voice.tune);
  const ratios = open ? [2.1, 3.4, 4.7, 6.3, 8.9] : [1.7, 2.6, 3.9, 5.4];
  const oscs = metalOscs(ctx, time, base, ratios, decay);
  const mix = ctx.createGain();
  mix.gain.value = 0.16;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = open ? 2500 : 1800;
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, decay);
  const nGain = ctx.createGain();
  nGain.gain.value = open ? 0.4 : 0.22;
  const gain = ctx.createGain();
  envDown(gain.gain, time, velocity * voice.level, 0.004, decay);
  for (const osc of oscs) osc.connect(mix);
  mix.connect(hp);
  noise.connect(nGain);
  nGain.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  trackActive(machine, id, { startTime: time, choke: makeStop(ctx, gain, [...oscs, noise], time) });
}

function triggerShaker(machine, time, velocity, id) {
  const ctx = machine.context;
  const voice = machine.kit.voices[id];
  const dest = machine.buses[id].input;
  const decay = id === "tamb" ? 0.05 + voice.decay * 0.22 : 0.03 + voice.decay * 0.12;
  const noise = spawnNoise(ctx, noiseBuffer(machine), time, decay);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = id === "tamb" ? 5000 : 7000;
  const gain = ctx.createGain();
  const peak = velocity * voice.level * (id === "tamb" ? 0.55 : 0.4);
  if (id === "tamb") {
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), time + 0.004);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.35), time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  } else {
    envDown(gain.gain, time, peak, 0.002, decay);
  }
  const extras = [];
  if (id === "tamb") {
    const jingle = ctx.createOscillator();
    jingle.type = "square";
    jingle.frequency.setValueAtTime(tunedHz(3200, voice.tune), time);
    const jg = ctx.createGain();
    envDown(jg.gain, time, peak * 0.2, 0.001, 0.05);
    jingle.connect(jg);
    jg.connect(dest);
    jingle.start(time);
    jingle.stop(time + 0.08);
    extras.push(jingle);
  }
  noise.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  const choke = (at) => makeStop(ctx, gain, [noise, ...extras], time)(at);
  trackActive(machine, id, { startTime: time, choke });
}

function triggerPerc(machine, time, velocity) {
  const ctx = machine.context;
  const voice = machine.kit.voices.perc;
  const dest = machine.buses.perc.input;
  const carrier = ctx.createOscillator();
  const mod = ctx.createOscillator();
  carrier.type = "sine";
  mod.type = "sine";
  const f = tunedHz(620, voice.tune);
  carrier.frequency.setValueAtTime(f, time);
  mod.frequency.setValueAtTime(f * 1.73, time);
  const modGain = ctx.createGain();
  envDown(modGain.gain, time, f * 1.4, 0.001, 0.04);
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  const gain = ctx.createGain();
  const decay = 0.04 + voice.decay * 0.16;
  envDown(gain.gain, time, velocity * voice.level * 0.55, 0.001, decay);
  carrier.connect(gain);
  gain.connect(dest);
  carrier.start(time);
  mod.start(time);
  carrier.stop(time + decay + 0.04);
  mod.stop(time + decay + 0.04);
  trackActive(machine, "perc", { startTime: time, choke: makeStop(ctx, gain, [carrier, mod], time) });
}

function triggerBass(machine, time, opts) {
  const ctx = machine.context;
  const bass = machine.kit.bass;
  const note = midiNoteNumber(opts.note || "C", opts.octave ?? 2);
  let freq = midiToHz(note);
  freq = tunedHz(freq, bass.tune);
  const osc = ctx.createOscillator();
  osc.type = bass.wave === "square" ? "square" : "sawtooth";
  const glide = opts.slide && opts.glideFrom ? opts.glideFrom : null;
  if (glide && glide > 0) {
    osc.frequency.setValueAtTime(Math.max(20, glide), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq), time + Math.max(0.03, (opts.duration || 0.12) * 0.8));
  } else {
    osc.frequency.setValueAtTime(Math.max(20, freq), time);
  }
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = "lowpass";
  f2.type = "lowpass";
  const accent = opts.accent ? 1 : 0;
  const baseCut = 70 + bass.cutoff * 1400;
  const peak = Math.min(7200, baseCut + bass.env * (1800 + accent * 2200));
  const q = Math.min(16, 0.8 + bass.resonance * 12 * (accent ? 1.25 : 1));
  f1.Q.setValueAtTime(q, time);
  f2.Q.setValueAtTime(Math.max(0.5, q * 0.65), time);
  f1.frequency.setValueAtTime(Math.max(40, peak), time);
  f2.frequency.setValueAtTime(Math.max(40, peak), time);
  const envTime = 0.04 + bass.decay * 0.4;
  if (peak > baseCut + 1) {
    f1.frequency.exponentialRampToValueAtTime(Math.max(40, baseCut), time + envTime);
    f2.frequency.exponentialRampToValueAtTime(Math.max(40, baseCut * 0.85), time + envTime * 0.95);
  }
  const gain = ctx.createGain();
  const level = clamp((opts.velocity ?? 0.8) * bass.level * (accent ? 1.2 : 0.82), 0, 1);
  const decay = Math.max(envTime, opts.legato ? (opts.duration || envTime) : envTime * 0.92);
  envDown(gain.gain, time, level, accent ? 0.004 : 0.008, decay);
  osc.connect(f1);
  f1.connect(f2);
  f2.connect(gain);
  gain.connect(machine.bassInput);
  osc.start(time);
  osc.stop(time + decay + 0.06);
  trackActive(machine, "bass", { startTime: time, choke: makeStop(ctx, gain, [osc], time) });
}

function sliceBuffer(ctx, buffer, startSec, endSec, reverse) {
  const rate = buffer.sampleRate;
  const a = clamp(Math.floor(startSec * rate), 0, buffer.length - 1);
  const b = clamp(Math.floor(endSec * rate), a + 1, buffer.length);
  const length = b - a;
  const out = ctx.createBuffer(buffer.numberOfChannels, length, rate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) dst[i] = src[reverse ? b - 1 - i : a + i];
  }
  return out;
}

function slotSlice(ctx, slot) {
  const key = `${slot.reverse ? 1 : 0}|${slot.trimStart}|${slot.trimEnd}|${slot.buffer.length}|${slot.buffer.sampleRate}`;
  if (slot._key === key && slot._slice) return slot._slice;
  const dur = slot.buffer.duration;
  const start = clamp(slot.trimStart, 0, 0.98) * dur;
  const end = clamp(Math.max(slot.trimEnd, slot.trimStart + 0.01), 0.01, 1) * dur;
  slot._slice = sliceBuffer(ctx, slot.buffer, start, Math.max(end, start + 0.01), slot.reverse);
  slot._key = key;
  return slot._slice;
}

function triggerSample(machine, voiceId, time, velocity) {
  const slot = machine._samples.get(voiceId);
  if (!slot || !slot.enabled || !slot.buffer) return false;
  const ctx = machine.context;
  const slice = slotSlice(ctx, slot);
  const src = ctx.createBufferSource();
  src.buffer = slice;
  const rate = 2 ** (clamp(slot.pitch, -24, 24) / 12);
  src.playbackRate.setValueAtTime(rate, time);
  const heard = slice.duration / rate;
  const attack = Math.min(Math.max(0.001, slot.attack), heard * 0.45);
  const releaseAt = Math.max(attack + 0.015, heard * clamp(slot.decay, 0.05, 1));
  const gain = ctx.createGain();
  const voice = machine.kit.voices[voiceId];
  const peak = Math.max(0.001, velocity * (voice ? voice.level : 0.8));
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + releaseAt);
  src.connect(gain);
  gain.connect(machine.buses[voiceId].input);
  src.start(time);
  src.stop(time + heard + 0.02);
  const item = { startTime: time, choke: makeStop(ctx, gain, [src], time) };
  trackActive(machine, voiceId, item);
  const group = slot.choke || voiceById(voiceId)?.choke;
  if (group) trackActive(machine, `group:${group}`, item);
  return true;
}

export function triggerVoice(machine, voiceId, opts = {}) {
  const time = opts.time ?? machine.context.currentTime;
  const velocity = clamp(opts.velocity ?? 1, 0, 1);
  if (velocity <= 0) return null;
  if (voiceId === "bass") {
    chokeKey(machine, "bass", time);
    triggerBass(machine, time, opts);
    return { time, voiceId };
  }
  const meta = voiceById(voiceId);
  if (!meta) throw new Error(`Unknown voice "${voiceId}"`);
  chokeKey(machine, voiceId, time);
  const group = machine._samples.get(voiceId)?.choke || meta.choke;
  if (group) chokeKey(machine, `group:${group}`, time);
  const playedSample = triggerSample(machine, voiceId, time, velocity);
  if (!playedSample) {
    if (meta.kind === "kick") triggerKick(machine, time, velocity);
    else if (meta.kind === "snare") triggerSnare(machine, time, velocity);
    else if (meta.kind === "clap") triggerClap(machine, time, velocity);
    else if (meta.kind === "hat") triggerHat(machine, time, velocity, false);
    else if (meta.kind === "hatOpen") triggerHat(machine, time, velocity, true);
    else if (meta.kind === "tom") triggerTom(machine, time, velocity, voiceId);
    else if (meta.kind === "rim") triggerRim(machine, time, velocity, voiceId);
    else if (meta.kind === "cowbell") triggerCowbell(machine, time, velocity);
    else if (meta.kind === "crash" || meta.kind === "ride") triggerCrash(machine, time, velocity, voiceId);
    else if (meta.kind === "shaker" || meta.kind === "tamb") triggerShaker(machine, time, velocity, voiceId);
    else if (meta.kind === "perc") triggerPerc(machine, time, velocity);
  }
  machine.onTrigger?.({ voiceId, time, velocity, source: opts.source || "trigger" });
  return { time, voiceId };
}

function dispatchStep(machine, bar, step, time) {
  for (const id of VOICE_IDS) {
    if (id === "hatOpen" && bar.lanes.hat[step] > 0) continue;
    const velocity = bar.lanes[id][step];
    if (velocity > 0) triggerVoice(machine, id, { time, velocity, source: "seq" });
  }
  const bass = bar.bass[step];
  if (!bass) return;
  let glideFrom = null;
  if (bass.slide) {
    for (let i = step - 1; i >= 0; i--) {
      const prev = bar.bass[i];
      if (prev) {
        glideFrom = tunedHz(midiToHz(midiNoteNumber(prev.note, prev.octave)), machine.kit.bass.tune);
        break;
      }
    }
  }
  const next = step < STEPS - 1 ? bar.bass[step + 1] : null;
  triggerVoice(machine, "bass", {
    time,
    velocity: bass.velocity,
    note: bass.note,
    octave: bass.octave,
    accent: bass.accent,
    slide: bass.slide,
    glideFrom,
    duration: stepGap(step, machine.bpm, machine.swing),
    legato: Boolean(next && next.slide),
    source: "seq",
  });
}

function cancelFuture(machine, now) {
  for (const list of machine._active.values()) {
    for (const item of list) {
      if (item.startTime > now + 0.02) item.choke(now);
    }
  }
}

function pruneActive(machine, now) {
  for (const [key, list] of machine._active) {
    const kept = list.filter((item) => item.startTime > now - 4);
    if (kept.length !== list.length) machine._active.set(key, kept);
  }
}

function scheduleAhead(machine) {
  const horizon = machine.context.currentTime + 0.16;
  const now = machine.context.currentTime;
  pruneActive(machine, now);
  const len = barDurationSeconds(machine.bpm, machine.swing);
  let guard = 0;
  while (guard++ < 64) {
    const index = machine._nextIndex;
    const cycle = Math.floor(index / STEPS);
    const step = index % STEPS;
    const time = machine.origin + cycle * len + stepOffsetSeconds(step, machine.bpm, machine.swing);
    if (time >= horizon) break;
    machine._nextIndex = index + 1;
    if (time < now - 0.06) continue;
    const barId = machine.pattern.chain[cycle % machine.pattern.chain.length];
    dispatchStep(machine, machine.pattern.bars[barId], step, time);
  }
}

function repositionTransport(machine, previous) {
  if (!machine.playing) return;
  const now = machine.context.currentTime;
  const oldLen = barDurationSeconds(previous.bpm, previous.swing);
  const elapsed = Math.max(0, now - machine.origin);
  const cycle = Math.floor(elapsed / oldLen);
  const frac = oldLen > 0 ? (elapsed - cycle * oldLen) / oldLen : 0;
  const len = barDurationSeconds(machine.bpm, machine.swing);
  machine.origin = now - (cycle * len + frac * len);
  cancelFuture(machine, now);
  machine._nextIndex = cycle * STEPS;
  while (machine._nextIndex < (cycle + 3) * STEPS) {
    const step = machine._nextIndex % STEPS;
    const cyc = Math.floor(machine._nextIndex / STEPS);
    const t = machine.origin + cyc * len + stepOffsetSeconds(step, machine.bpm, machine.swing);
    if (t >= now + 0.012) break;
    machine._nextIndex++;
  }
}

export function setBpm(machine, bpm) {
  const previous = { bpm: machine.bpm, swing: machine.swing };
  machine.bpm = clampBpm(bpm);
  machine.pattern.bpm = machine.bpm;
  repositionTransport(machine, previous);
  syncTempoFx(machine);
}

export function setSwing(machine, swing) {
  const previous = { bpm: machine.bpm, swing: machine.swing };
  machine.swing = clampSwing(swing);
  machine.pattern.swing = machine.swing;
  repositionTransport(machine, previous);
}

export function startTransport(machine, when) {
  if (machine.playing) return;
  const t = Math.max(machine.context.currentTime + 0.04, when ?? 0);
  machine.playing = true;
  machine.origin = t;
  machine._nextIndex = 0;
  const loop = () => {
    if (!machine.playing) return;
    scheduleAhead(machine);
    machine._timer = setTimeout(loop, 25);
  };
  loop();
}

export function stopTransport(machine) {
  machine.playing = false;
  if (machine._timer) clearTimeout(machine._timer);
  machine._timer = null;
  const now = machine.context.currentTime;
  for (const id of [...machine._repeats.keys()]) stopRepeat(machine, id);
  for (const list of machine._active.values()) {
    for (const item of list) item.choke(now);
  }
  machine._active.clear();
}

export function getPlayhead(machine, time = machine.context.currentTime) {
  const chain = machine.pattern.chain;
  if (!machine.playing) {
    return { playing: false, step: 0, cycle: 0, barId: chain[0] || "A" };
  }
  const len = barDurationSeconds(machine.bpm, machine.swing);
  const elapsed = time - machine.origin;
  if (elapsed < 0) return { playing: true, step: 0, cycle: 0, barId: chain[0] };
  const cycle = Math.floor(elapsed / len);
  const pos = elapsed - cycle * len;
  let step = 0;
  for (let i = 0; i < STEPS; i++) {
    if (stepOffsetSeconds(i, machine.bpm, machine.swing) <= pos + 0.0001) step = i;
  }
  return { playing: true, step, cycle, barId: chain[cycle % chain.length] };
}

export function quantizePlayhead(machine, time = machine.context.currentTime) {
  const len = barDurationSeconds(machine.bpm, machine.swing);
  if (!machine.playing) {
    return { step: nearestStepIndex(0, machine.bpm, machine.swing), barId: machine.pattern.chain[0], cycle: 0 };
  }
  const elapsed = Math.max(0, time - machine.origin);
  const cycle = Math.floor(elapsed / len);
  const pos = elapsed - cycle * len;
  return {
    step: nearestStepIndex(pos, machine.bpm, machine.swing),
    barId: machine.pattern.chain[cycle % machine.pattern.chain.length],
    cycle,
  };
}

export function setSample(machine, voiceId, buffer, params = {}) {
  if (!voiceById(voiceId)) throw new Error(`Unknown voice "${voiceId}"`);
  const prev = machine._samples.get(voiceId) || defaultSlot();
  const next = {
    ...prev,
    ...params,
    buffer: buffer || prev.buffer,
    enabled: params.enabled != null ? Boolean(params.enabled) : true,
    pitch: clamp(params.pitch ?? prev.pitch, -24, 24),
    trimStart: clamp(params.trimStart ?? prev.trimStart, 0, 1),
    trimEnd: clamp(params.trimEnd ?? prev.trimEnd, 0, 1),
    attack: Math.max(0, params.attack ?? prev.attack),
    decay: clamp(params.decay ?? prev.decay, 0.05, 1),
    reverse: params.reverse != null ? Boolean(params.reverse) : prev.reverse,
    choke: params.choke !== undefined ? params.choke : prev.choke,
    _slice: null,
    _key: "",
  };
  if (!next.buffer) next.enabled = false;
  machine._samples.set(voiceId, next);
  return next;
}

export function clearSample(machine, voiceId) {
  machine._samples.delete(voiceId);
}

export function getSample(machine, voiceId) {
  return machine._samples.get(voiceId) || null;
}

export function chopSample(machine, buffer, count = 16) {
  if (!buffer) throw new Error("chopSample requires an AudioBuffer");
  const n = Math.max(1, Math.min(16, count | 0));
  VOICE_IDS.forEach((id, i) => {
    if (i >= n) return;
    setSample(machine, id, buffer, {
      enabled: true,
      trimStart: i / n,
      trimEnd: (i + 1) / n,
      pitch: 0,
      attack: 0.001,
      decay: 1,
      reverse: false,
    });
  });
}

export function startRepeat(machine, voiceId, opts = {}) {
  const id = ++machine._repeatSerial;
  const rec = {
    id,
    voiceId,
    division: opts.division || "1/16",
    velocity: clamp(opts.velocity ?? 1, 0, 1),
    stopped: false,
    next: 0,
    timer: null,
    owns: [],
  };
  machine._repeats.set(id, rec);
  const div = divisionSeconds(machine.bpm, rec.division);
  const now = machine.context.currentTime + 0.03;
  if (machine.playing) {
    const elapsed = now - machine.origin;
    const n = Math.ceil(elapsed / div - 1e-6);
    rec.next = machine.origin + n * div;
  } else rec.next = now;
  const firstDiv = divisionSeconds(machine.bpm, rec.division);
  if (rec.next < machine.context.currentTime + 0.05) rec.next += firstDiv;
  const pump = () => {
    if (rec.stopped) return;
    const step = divisionSeconds(machine.bpm, rec.division);
    const horizon = machine.context.currentTime + 0.22;
    while (rec.next < horizon) {
      const key = rec.voiceId;
      const before = (machine._active.get(key) || []).length;
      triggerVoice(machine, rec.voiceId, {
        time: rec.next,
        velocity: rec.velocity,
        source: "repeat",
        note: opts.note,
        octave: opts.octave,
        accent: opts.accent,
      });
      const list = machine._active.get(key) || [];
      if (list.length > before) rec.owns.push(list[list.length - 1]);
      rec.next += step;
    }
    rec.timer = setTimeout(pump, 40);
  };
  pump();
  return id;
}

export function stopRepeat(machine, id) {
  const rec = machine._repeats.get(id);
  if (!rec) return;
  rec.stopped = true;
  if (rec.timer) clearTimeout(rec.timer);
  machine._repeats.delete(id);
  const now = machine.context.currentTime;
  for (const item of rec.owns) {
    if (item.startTime > now + 0.01) item.choke(now);
  }
}

export function getLevel(machine) {
  const buf = machine._meter;
  try {
    machine.analyser.getFloatTimeDomainData(buf);
  } catch {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * 3);
}

function scheduleBars(machine, bars, origin) {
  const len = barDurationSeconds(machine.bpm, machine.swing);
  const chain = machine.pattern.chain;
  for (let cycle = 0; cycle < bars; cycle++) {
    const bar = machine.pattern.bars[chain[cycle % chain.length]];
    for (let step = 0; step < STEPS; step++) {
      const time = origin + cycle * len + stepOffsetSeconds(step, machine.bpm, machine.swing);
      dispatchStep(machine, bar, step, time);
    }
  }
}

function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const rate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const dataSize = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i] || 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

function offlineContext(channels, length, sampleRate) {
  const Ctor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctor) throw new Error("OfflineAudioContext is not available");
  try {
    return new Ctor({ numberOfChannels: channels, length, sampleRate });
  } catch {
    return new Ctor(channels, length, sampleRate);
  }
}

/**
 * Render a pattern document to a 16-bit stereo WAV.
 * Uses OfflineAudioContext, so it does not depend on the live scheduler.
 */
export async function renderToWav(pattern, options = {}) {
  const doc = parsePattern(pattern);
  const sampleRate = options.sampleRate || 44100;
  const bars = Math.max(1, options.bars || doc.chain.length || 1);
  const tail = 1.15;
  const seconds = 0.06 + bars * barDurationSeconds(doc.bpm, doc.swing) + tail;
  const ctx = offlineContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const machine = createDrumMachine(ctx);
  loadPattern(machine, doc);
  if (options.kit) loadKit(machine, options.kit);
  scheduleBars(machine, bars, 0.05);
  const audio = await ctx.startRendering();
  return encodeWav(audio);
}
