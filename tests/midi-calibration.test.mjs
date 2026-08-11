import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidMIDICalibrationSpan,
  mapMIDINoteToKeyboardRange,
} from "../lib/midiCalibration.ts";

test("maps a two-octave keyboard from raw C2-C4 onto curriculum C3-C5", () => {
  const transpose = 48 - 36;

  assert.equal(mapMIDINoteToKeyboardRange(36, transpose), 48);
  assert.equal(mapMIDINoteToKeyboardRange(60, transpose), 72);
});

test("maps every valid 24-semitone endpoint span exactly onto C3-C5", () => {
  for (const [leftRaw, rightRaw] of [
    [0, 24],
    [36, 60],
    [48, 72],
    [103, 127],
  ]) {
    assert.equal(isValidMIDICalibrationSpan(leftRaw, rightRaw), true);

    const transpose = 48 - leftRaw;
    assert.equal(mapMIDINoteToKeyboardRange(leftRaw, transpose), 48);
    assert.equal(mapMIDINoteToKeyboardRange(rightRaw, transpose), 72);
  }
});

test("returns null instead of clamping notes outside the calibrated range", () => {
  const transpose = 12;

  assert.equal(mapMIDINoteToKeyboardRange(35, transpose), null);
  assert.equal(mapMIDINoteToKeyboardRange(61, transpose), null);
  assert.equal(mapMIDINoteToKeyboardRange(36, transpose), 48);
  assert.equal(mapMIDINoteToKeyboardRange(60, transpose), 72);
});

test("rejects malformed raw pitches and transpose values", () => {
  assert.equal(mapMIDINoteToKeyboardRange(-1, 0), null);
  assert.equal(mapMIDINoteToKeyboardRange(128, 0), null);
  assert.equal(mapMIDINoteToKeyboardRange(36.5, 12), null);
  assert.equal(mapMIDINoteToKeyboardRange(36, 12.5), null);
  assert.equal(mapMIDINoteToKeyboardRange(Number.NaN, 12), null);
});

test("rejects invalid or corrupt calibration endpoint spans", () => {
  for (const [leftRaw, rightRaw] of [
    [36, 59],
    [36, 61],
    [60, 36],
    [-1, 23],
    [104, 128],
    [36.5, 60.5],
    [Number.NaN, 60],
  ]) {
    assert.equal(
      isValidMIDICalibrationSpan(leftRaw, rightRaw),
      false,
      `expected ${leftRaw}-${rightRaw} to be rejected`,
    );
  }
});
