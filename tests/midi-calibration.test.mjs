import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidMIDICalibrationSpan,
  mapMIDINoteToKeyboardRange,
  normalizeMIDICalibrationEntries,
  parseMIDICalibrationMapping,
} from "../lib/midiCalibration.ts";
import { chooseAutomaticMIDIInput } from "../lib/midiInputs.ts";

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

test("restores a valid saved alignment without changing its transpose", () => {
  assert.deepEqual(
    parseMIDICalibrationMapping({
      rawNote: 36,
      rightRawNote: 60,
      transpose: 12,
    }),
    { rawNote: 36, rightRawNote: 60, transpose: 12 },
  );
});

test("rejects corrupt saved alignments before they can be reused", () => {
  for (const saved of [
    null,
    {},
    { rawNote: "36", rightRawNote: 60, transpose: 12 },
    { rawNote: 36, rightRawNote: 59, transpose: 12 },
    { rawNote: 36, rightRawNote: 60, transpose: 0 },
    { rawNote: 104, rightRawNote: 128, transpose: -56 },
  ]) {
    assert.equal(parseMIDICalibrationMapping(saved), null);
  }
});

test("recovers a writable calibration record from a corrupt storage root", () => {
  for (const stored of [null, false, 42, "bad", []]) {
    assert.deepEqual(normalizeMIDICalibrationEntries(stored), {});
  }

  const original = { device: { rawNote: 36, rightRawNote: 60, transpose: 12 } };
  const normalized = normalizeMIDICalibrationEntries(original);
  assert.deepEqual(normalized, original);
  assert.notEqual(normalized, original);
});

test("automatically chooses the performance keyboard but not a control port", () => {
  const control = { id: "control", name: "MPK Mini IV DAW Control Port", state: "connected" };
  const generic = { id: "generic", name: "Other Keyboard", state: "connected" };
  const performance = { id: "mpk", name: "MPK Mini IV MIDI Port", state: "connected" };

  assert.equal(
    chooseAutomaticMIDIInput([control, generic, performance]),
    performance,
  );
  assert.equal(chooseAutomaticMIDIInput([control]), null);
  assert.equal(
    chooseAutomaticMIDIInput([{ ...generic, state: "disconnected" }]),
    null,
  );
});
