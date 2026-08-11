import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileScheduledVoices,
  scheduleAudioSourceWindow,
  transportSubdivisionAtBeat,
} from "../lib/audioScheduling.ts";

test("starts a Web Audio source before scheduling its stop", () => {
  const calls = [];
  let started = false;
  const source = {
    start(when) {
      started = true;
      calls.push(["start", when]);
    },
    stop(when) {
      if (!started) {
        throw new DOMException(
          "The source must be started before it can be stopped",
          "InvalidStateError",
        );
      }
      calls.push(["stop", when]);
    },
  };

  assert.doesNotThrow(() => scheduleAudioSourceWindow(source, 1.25, 4.5));
  assert.deepEqual(calls, [
    ["start", 1.25],
    ["stop", 4.5],
  ]);
});

test("voice scheduling exceptions cannot abort transport reconciliation", () => {
  const notes = [{ id: "note-1", startBeat: 1, durationBeats: 1 }];
  const activeIds = new Set();
  let startAttempts = 0;
  let stopAttempts = 0;

  assert.doesNotThrow(() =>
    reconcileScheduledVoices(
      notes,
      1.25,
      activeIds,
      () => {
        startAttempts += 1;
        throw new DOMException("oscillator failed", "InvalidStateError");
      },
      () => undefined,
    ),
  );
  assert.deepEqual([...activeIds], ["note-1"]);

  reconcileScheduledVoices(
    notes,
    1.5,
    activeIds,
    () => {
      startAttempts += 1;
    },
    () => undefined,
  );
  assert.equal(startAttempts, 1, "a failed start is not retried every RAF tick");

  assert.doesNotThrow(() =>
    reconcileScheduledVoices(
      notes,
      2,
      activeIds,
      () => undefined,
      () => {
        stopAttempts += 1;
        throw new DOMException("voice already stopped", "InvalidStateError");
      },
    ),
  );
  assert.equal(stopAttempts, 1);
  assert.equal(activeIds.size, 0, "failed releases do not poison a later loop");
});

test("accompaniment retry boundaries advance once per half beat", () => {
  assert.equal(transportSubdivisionAtBeat(4), 8);
  assert.equal(transportSubdivisionAtBeat(4.49), 8);
  assert.equal(transportSubdivisionAtBeat(4.5), 9);
  assert.equal(transportSubdivisionAtBeat(-3), 0);
  assert.equal(transportSubdivisionAtBeat(Number.NaN), 0);
});
