import assert from "node:assert/strict";
import test from "node:test";
import {
  barDurationSeconds,
  clampBpm,
  divisionSeconds,
  nearestStepIndex,
  stepOffsetSeconds,
  stepsInRange,
} from "../src/engine.js";

test("a bar contains sixteen steps and the end is exclusive", () => {
  const events = stepsInRange({ bpm: 120, swing: 0, start: 0, end: 2 });
  assert.equal(events.length, 16);
  assert.deepEqual(events.map((e) => e.step), [...Array(16).keys()]);
  assert.equal(stepsInRange({ bpm: 120, swing: 0, start: 0, end: 0.125 }).length, 1);
  assert.equal(stepsInRange({ bpm: 120, swing: 0, start: 0, end: 4 }).length, 32);
});

test("swing changes which step falls inside a short window", () => {
  const straight = stepsInRange({ bpm: 120, swing: 0, start: 0.12, end: 0.14 });
  const shuffled = stepsInRange({ bpm: 120, swing: 0.5, start: 0.12, end: 0.14 });
  assert.equal(straight.length, 1);
  assert.equal(straight[0].step, 1);
  assert.equal(shuffled.length, 0);
  const late = stepsInRange({ bpm: 120, swing: 0.5, start: 0.18, end: 0.2 });
  assert.equal(late.length, 1);
  assert.equal(late[0].step, 1);
  assert.ok(Math.abs(late[0].time - 0.1875) < 1e-12);
});

test("range origin shifts the grid", () => {
  const events = stepsInRange({ bpm: 120, swing: 0, start: 1, end: 1.1, origin: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].step, 0);
  assert.equal(events[0].time, 1);
  const next = stepsInRange({ bpm: 120, swing: 0, start: 1, end: 1.2, origin: 1 });
  assert.deepEqual(next.map((e) => e.step), [0, 1]);
});

test("quantize picks the nearest step, including the bar wrap", () => {
  assert.equal(nearestStepIndex(0.02, 120, 0), 0);
  assert.equal(nearestStepIndex(0.1, 120, 0), 1);
  assert.equal(nearestStepIndex(1.97, 120, 0), 0);
  assert.equal(nearestStepIndex(0.16, 120, 0.5), 1);
  const len = barDurationSeconds(100, 0.25);
  assert.equal(nearestStepIndex(len + stepOffsetSeconds(6, 100, 0.25), 100, 0.25), 6);
});

test("tempo clamps and note-repeat divisions follow the beat", () => {
  assert.equal(clampBpm(40), 60);
  assert.equal(clampBpm(120), 120);
  assert.equal(clampBpm(240), 200);
  assert.equal(divisionSeconds(120, "1/4"), 0.5);
  assert.equal(divisionSeconds(120, "1/8"), 0.25);
  assert.equal(divisionSeconds(120, "1/16"), 0.125);
  assert.equal(divisionSeconds(120, "1/32"), 0.0625);
  assert.equal(divisionSeconds(120, "1/8d"), 0.375);
});
