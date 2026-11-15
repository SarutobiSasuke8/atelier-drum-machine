import assert from "node:assert/strict";
import test from "node:test";
import {
  barDurationSeconds,
  clampSwing,
  stepOffsetSeconds,
  stepTick,
} from "../src/engine.js";

test("swing 0 keeps straight sixteenths", () => {
  assert.equal(stepOffsetSeconds(0, 120, 0), 0);
  assert.equal(stepOffsetSeconds(1, 120, 0), 0.125);
  assert.equal(stepOffsetSeconds(2, 120, 0), 0.25);
  assert.equal(stepOffsetSeconds(4, 120, 0), 0.5);
  assert.equal(stepTick(1, 0), 120);
  assert.equal(stepTick(2, 0), 240);
});

test("swing delays only the off-beat and stays inside the bar", () => {
  assert.equal(stepOffsetSeconds(1, 120, 0.5), 0.1875);
  assert.equal(stepOffsetSeconds(2, 120, 0.5), 0.25);
  assert.equal(stepTick(1, 0.5), 180);
  assert.equal(stepTick(1, 0.75), 210);
  assert.ok(stepOffsetSeconds(15, 120, 0.75) < barDurationSeconds(120, 0.75));
  assert.ok(stepOffsetSeconds(1, 120, 0.75) < stepOffsetSeconds(2, 120, 0.75));
});

test("bar length ignores swing and matches four beats", () => {
  assert.equal(barDurationSeconds(120, 0), 2);
  assert.equal(barDurationSeconds(120, 0.75), 2);
  assert.equal(stepTick(16, 0.66), 1920);
  assert.equal(barDurationSeconds(60, 0), 4);
  assert.equal(barDurationSeconds(200, 0), 1.2);
});

test("swing clamps to 0..0.75", () => {
  assert.equal(clampSwing(-0.2), 0);
  assert.equal(clampSwing(0.2), 0.2);
  assert.equal(clampSwing(0.9), 0.75);
  assert.equal(stepOffsetSeconds(1, 120, 2), stepOffsetSeconds(1, 120, 0.75));
});
