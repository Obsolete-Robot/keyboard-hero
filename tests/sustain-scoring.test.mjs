import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clearNoteClaims,
  earlyCaptureWindowMs,
  findPressCandidate,
  judgeSustain,
  noteWithinPlaybackRange,
  sustainRequirement,
  timingGradeForOffset,
} from "../lib/sustainScoring.ts";

const note = (id, midi, startBeat, durationBeats = 1) => ({
  id,
  midi,
  startBeat,
  durationBeats,
});

test("normal early hits judge immediately while the extended band arms", () => {
  const notes = [note("c4", 60, 1)];
  const millisecondsPerBeat = 500;

  assert.equal(earlyCaptureWindowMs(millisecondsPerBeat), 240);
  const normalEarly = findPressCandidate(
    notes,
    60,
    0.8,
    millisecondsPerBeat,
    new Set(),
  );
  assert.ok(Math.abs(normalEarly.offsetMs + 100) < 0.000_001);
  assert.equal(normalEarly?.armed, false);
  assert.equal(timingGradeForOffset(normalEarly.offsetMs), "great");

  const captured = findPressCandidate(
    notes,
    60,
    0.52,
    millisecondsPerBeat,
    new Set(),
  );
  assert.ok(Math.abs(captured.offsetMs + 240) < 0.000_001);
  assert.equal(captured?.armed, true);
  assert.equal(timingGradeForOffset(captured.offsetMs), "miss");
  assert.equal(timingGradeForOffset(captured.offsetMs, true), "good");
});

test("wrong notes and attacks outside the early/late window are not claimed", () => {
  const notes = [note("c4", 60, 1)];
  assert.equal(findPressCandidate(notes, 61, 0.8, 500, new Set()), null);
  assert.equal(findPressCandidate(notes, 60, 0.5, 500, new Set()), null);
  assert.equal(findPressCandidate(notes, 60, 1.37, 500, new Set()), null);
});

test("simultaneous chord tones retain independent stable claims", () => {
  const notes = [note("c4", 60, 2), note("e4", 64, 2), note("g4", 67, 2)];
  const unavailable = new Set();
  for (const midi of [67, 60, 64]) {
    const candidate = findPressCandidate(notes, midi, 1.54, 500, unavailable);
    assert.ok(candidate);
    unavailable.add(candidate.note.id);
  }
  assert.deepEqual([...unavailable].sort(), ["c4", "e4", "g4"]);
  assert.equal(
    findPressCandidate(notes, 60, 1.54, 500, unavailable),
    null,
    "an owned authored tone cannot be farmed by retrigger",
  );
});

test("loop practice cannot claim notes outside the A/B range", () => {
  assert.equal(noteWithinPlaybackRange(note("before", 60, 3.99), 4, 8), false);
  assert.equal(noteWithinPlaybackRange(note("at-a", 60, 4), 4, 8), true);
  assert.equal(noteWithinPlaybackRange(note("inside", 60, 7.99), 4, 8), true);
  assert.equal(noteWithinPlaybackRange(note("at-b", 60, 8), 4, 8), false);
});

test("full, partial, and early releases award proportional hold points", () => {
  const requirement = sustainRequirement(1, 500);
  assert.equal(requirement.eligible, true);
  assert.equal(requirement.releaseGraceBeats, 0.24);
  assert.equal(requirement.requiredBeats, 0.76);

  const full = judgeSustain(0.76, requirement.requiredBeats, 2);
  assert.equal(full.grade, "full");
  assert.equal(full.progress, 1);
  assert.equal(full.pointsAwarded, 182);

  const partial = judgeSustain(0.38, requirement.requiredBeats);
  assert.equal(partial.grade, "partial");
  assert.equal(partial.progress, 0.5);
  assert.equal(partial.pointsAwarded, 46);

  const early = judgeSustain(0.19, requirement.requiredBeats);
  assert.equal(early.grade, "early-release");
  assert.equal(early.progress, 0.25);
  assert.equal(early.pointsAwarded, 23);
});

test("tap notes have no hold score and longer authored tails earn more", () => {
  assert.equal(sustainRequirement(0.5, 500).eligible, false);
  const oneBeat = sustainRequirement(1, 500);
  const twoBeats = sustainRequirement(2, 500);
  assert.ok(
    judgeSustain(twoBeats.requiredBeats, twoBeats.requiredBeats).pointsAwarded >
      judgeSustain(oneBeat.requiredBeats, oneBeat.requiredBeats).pointsAwarded,
  );
});

test("attempt ownership is fully cleared for replay, seek, and loop resets", async () => {
  const claims = new Map([
    ["c4", { sourceId: "keyboard:KeyQ:60" }],
    ["e4", { sourceId: "midi:akai:ch0:raw64:64" }],
  ]);
  const owners = new Map([
    ["keyboard:KeyQ:60", "c4"],
    ["midi:akai:ch0:raw64:64", "e4"],
  ]);
  clearNoteClaims(claims, owners);
  assert.equal(claims.size, 0);
  assert.equal(owners.size, 0);

  const hook = await readFile(
    new URL("../hooks/useKeyboardHeroCore.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /const clearAttempt[\s\S]*?clearPlayerNoteAttempts\(\)/);
  assert.match(hook, /const pause[\s\S]*?clearPlayerNoteAttempts\(\)/);
  assert.match(hook, /const seekBeat[\s\S]*?clearPlayerNoteAttempts\(\)/);
  assert.match(hook, /if \(attempt\.sustainScored\) return null/);
  assert.match(
    hook,
    /attempt\.phase !== "released-before-start"[\s\S]*?removePlayerNoteAttempt\(noteId, false\)/,
  );
});
