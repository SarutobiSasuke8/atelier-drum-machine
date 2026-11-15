import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createDefaultKit,
  parseKit,
  parsePattern,
  serializeKit,
  serializePattern,
  VOICE_IDS,
} from "../src/engine.js";

const demos = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/demos");

test("pattern json round-trips through normalize", () => {
  const input = {
    format: "atelier-pattern",
    version: 1,
    name: "Round",
    bpm: 128,
    swing: 0.33,
    chain: ["B", "A", "D"],
    bars: {
      A: {
        lanes: { kick: [1, 0, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0.5] },
        bass: [
          { note: "F#", octave: 1, velocity: 0.66, accent: true, slide: false },
          { note: "G", octave: 1, velocity: 0.4, accent: false, slide: true },
        ],
      },
    },
    kit: { bass: { wave: "square", resonance: 0.8 } },
  };
  const once = parsePattern(input);
  const twice = parsePattern(JSON.parse(serializePattern(once)));
  assert.deepEqual(twice, once);
  assert.equal(once.bpm, 128);
  assert.equal(once.swing, 0.33);
  assert.deepEqual(once.chain, ["B", "A", "D"]);
  assert.equal(once.bars.A.lanes.kick[2], 0.25);
  assert.equal(once.bars.A.lanes.snare.length, 16);
  assert.equal(once.bars.A.lanes.snare[4], 0.5);
  assert.equal(once.bars.C.lanes.hat.length, 16);
  assert.equal(once.bars.A.bass[0].note, "F#");
  assert.equal(once.bars.A.bass[0].accent, true);
  assert.equal(once.bars.A.bass[1].slide, true);
  assert.equal(once.bars.A.bass[4], null);
  assert.equal(once.kit.bass.wave, "square");
  assert.equal(once.kit.bass.resonance, 0.8);
  assert.equal(once.kit.format, "atelier-kit");
  assert.ok(once.kit.voices.kick.key);
});

test("out of range tempo and swing are clamped, bad notes throw", () => {
  const parsed = parsePattern({ name: "Clamp", bpm: 999, swing: 2, chain: ["nope", "C"] });
  assert.equal(parsed.bpm, 200);
  assert.equal(parsed.swing, 0.75);
  assert.deepEqual(parsed.chain, ["C"]);
  assert.throws(() => parsePattern({
    bars: { A: { bass: [{ note: "H", octave: 2, velocity: 1 }] } },
  }), /Unknown note/);
  assert.throws(() => parsePattern({ format: "other" }), /Unknown pattern format/);
  assert.equal(serializePattern(parsed), serializePattern(JSON.parse(serializePattern(parsed))));
});

test("kit json round-trips and keeps voice fields", () => {
  const kit = createDefaultKit("Room");
  kit.voices.kick.key = "F1";
  kit.voices.kick.punch = 0.2;
  kit.voices.snare.decay = 0.9;
  kit.master.delayDivision = "1/8d";
  kit.sends.clap.delay = 0.4;
  const again = parseKit(JSON.parse(serializeKit(kit)));
  assert.deepEqual(again, parseKit(kit));
  assert.equal(again.voices.kick.key, "F1");
  assert.equal(again.voices.kick.punch, 0.2);
  assert.equal(again.master.delayDivision, "1/8d");
  assert.equal(again.sends.clap.delay, 0.4);
  for (const id of VOICE_IDS) {
    assert.equal(typeof again.voices[id].tune, "number");
    assert.equal(typeof again.voices[id].decay, "number");
    assert.equal(typeof again.voices[id].level, "number");
    assert.equal(typeof again.voices[id].drive, "number");
  }
});

test("shipped demos parse and round-trip", () => {
  const files = fs.readdirSync(demos).filter((name) => name.endsWith(".json"));
  assert.deepEqual(files.sort(), ["acid.json", "boom-bap.json", "dnb.json", "garage.json", "house.json", "techno.json"]);
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(demos, file), "utf8"));
    const once = parsePattern(raw);
    const twice = parsePattern(JSON.parse(serializePattern(once)));
    assert.deepEqual(twice, once, file);
    assert.ok(once.bpm >= 60 && once.bpm <= 200);
    assert.ok(once.bars.A.lanes.kick.some((v) => v > 0), file);
  }
});
