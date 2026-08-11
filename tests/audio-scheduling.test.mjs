import assert from "node:assert/strict";
import test from "node:test";

import { scheduleAudioSourceWindow } from "../lib/audioScheduling.ts";

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
