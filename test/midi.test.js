import assert from "node:assert/strict";
import test from "node:test";
import { buildMidiEvents, PAD_MIDI_START, patternToMidi, stepTick } from "../src/engine.js";

function readVlq(bytes, pos) {
  let value = 0;
  let guard = 0;
  while (guard++ < 5) {
    const byte = bytes[pos++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos];
  }
  throw new Error("bad vlq");
}

function parseMidi(bytes) {
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString("ascii"), "MThd");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(4), 6);
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const ppq = view.getUint16(12);
  assert.equal(Buffer.from(bytes.slice(14, 18)).toString("ascii"), "MTrk");
  const trackLen = view.getUint32(18);
  let pos = 22;
  const end = 22 + trackLen;
  assert.equal(end, bytes.length);
  const events = [];
  let tick = 0;
  while (pos < end) {
    const [delta, next] = readVlq(bytes, pos);
    pos = next;
    tick += delta;
    const status = bytes[pos++];
    if (status === 0xff) {
      const type = bytes[pos++];
      const [size, after] = readVlq(bytes, pos);
      pos = after;
      const data = bytes.slice(pos, pos + size);
      pos += size;
      events.push({ tick, meta: type, data });
      continue;
    }
    events.push({ tick, status, note: bytes[pos++], velocity: bytes[pos++] });
  }
  return { format, tracks, ppq, events };
}

const pattern = {
  format: "atelier-pattern",
  version: 1,
  name: "Midi",
  bpm: 100,
  swing: 0.5,
  chain: ["A"],
  bars: {
    A: {
      lanes: {
        kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        hat: [0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      bass: [
        { note: "C", octave: 2, velocity: 0.8, accent: true, slide: false },
        null,
        { note: "D#", octave: 2, velocity: 0.7, accent: false, slide: true },
        ...Array(13).fill(null),
      ],
    },
  },
};

test("midi file has a single type-0 track and the pattern tempo", () => {
  const bytes = patternToMidi(pattern, { bars: 1 });
  const midi = parseMidi(bytes);
  assert.equal(midi.format, 0);
  assert.equal(midi.tracks, 1);
  assert.equal(midi.ppq, 480);
  const tempo = midi.events.find((e) => e.meta === 0x51);
  assert.ok(tempo);
  const us = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];
  assert.equal(us, 600000);
  assert.equal(midi.events.at(-1).meta, 0x2f);
});

test("drum and bass notes land on swung ticks", () => {
  const { events } = buildMidiEvents(pattern, { bars: 1 });
  const kickOns = events.filter((e) => e.type === "on" && e.channel === 9 && e.note === PAD_MIDI_START);
  assert.equal(kickOns.length, 4);
  assert.deepEqual(kickOns.map((e) => e.tick), [0, stepTick(4, 0.5), stepTick(8, 0.5), stepTick(12, 0.5)]);
  const hat = events.find((e) => e.type === "on" && e.note === PAD_MIDI_START + 4);
  assert.equal(hat.tick, stepTick(1, 0.5));
  assert.equal(hat.channel, 9);
  const bass = events.find((e) => e.type === "on" && e.channel === 0);
  assert.equal(bass.note, 36);
  assert.equal(bass.tick, 0);
  const slide = events.filter((e) => e.type === "on" && e.channel === 0);
  assert.equal(slide[1].note, 39);
  assert.equal(slide[1].tick, stepTick(2, 0.5));
  const offs = events.filter((e) => e.type === "off" && e.channel === 0);
  assert.equal(offs[0].tick, slide[1].tick);
});

test("encoded bytes round-trip the same note-ons", () => {
  const built = buildMidiEvents(pattern, { bars: 2 });
  const parsed = parseMidi(patternToMidi(pattern, { bars: 2 }));
  const ons = parsed.events.filter((e) => e.status === 0x99 || e.status === 0x90);
  assert.equal(ons.length, built.events.filter((e) => e.type === "on").length);
  assert.ok(ons.some((e) => e.status === 0x99 && e.note === 36 && e.velocity === 127));
  assert.ok(ons.some((e) => e.status === 0x90 && e.note === 36));
});
