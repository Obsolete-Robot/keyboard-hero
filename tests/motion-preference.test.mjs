import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMotionPreference,
  shouldReduceMotion,
} from "../lib/motionPreference.ts";

test("normalizes saved motion preferences safely", () => {
  assert.equal(normalizeMotionPreference("system"), "system");
  assert.equal(normalizeMotionPreference("full"), "full");
  assert.equal(normalizeMotionPreference("reduced"), "reduced");
  assert.equal(normalizeMotionPreference("unexpected"), "system");
  assert.equal(normalizeMotionPreference(null), "system");
});

test("full animation and reduced motion override the system preference", () => {
  assert.equal(shouldReduceMotion("system", false), false);
  assert.equal(shouldReduceMotion("system", true), true);
  assert.equal(shouldReduceMotion("full", true), false);
  assert.equal(shouldReduceMotion("reduced", false), true);
});
