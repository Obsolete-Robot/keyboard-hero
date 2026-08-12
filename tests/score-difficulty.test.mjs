import assert from "node:assert/strict";
import test from "node:test";

import { scoreRateForSettings } from "../lib/scoreDifficulty.ts";

test("Flow score follows tempo and can earn a fast-play bonus", () => {
  assert.equal(scoreRateForSettings("flow", 0.25), 0.25);
  assert.equal(scoreRateForSettings("flow", 1), 1);
  assert.equal(scoreRateForSettings("flow", 1.25), 1.25);
});

test("Wait earns half the Flow rate and Listen remains unscored", () => {
  assert.equal(scoreRateForSettings("wait", 0.25), 0.125);
  assert.equal(scoreRateForSettings("wait", 1), 0.5);
  assert.equal(scoreRateForSettings("wait", 1.25), 0.625);
  assert.equal(scoreRateForSettings("listen", 1.25), 0);
});

test("a slow Wait run has one tenth the rate of a fast Flow run", () => {
  const slowWait = scoreRateForSettings("wait", 0.25);
  const fastFlow = scoreRateForSettings("flow", 1.25);
  assert.equal(fastFlow / slowWait, 10);
});
