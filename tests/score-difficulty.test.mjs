import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  scoreRateForSettings,
  targetScoreForSong,
} from "../lib/scoreDifficulty.ts";

test("Flow score follows tempo and can earn a fast-play bonus", () => {
  assert.equal(scoreRateForSettings("flow", 0.25), 0.25);
  assert.equal(scoreRateForSettings("flow", 1), 1);
  assert.equal(scoreRateForSettings("flow", 1.25), 1.25);
});

test("Wait and Listen remain unscored at every tempo", () => {
  assert.equal(scoreRateForSettings("wait", 0.25), 0);
  assert.equal(scoreRateForSettings("wait", 1), 0);
  assert.equal(scoreRateForSettings("wait", 1.25), 0);
  assert.equal(scoreRateForSettings("listen", 1.25), 0);
});

test("Wait cannot earn timing points while Flow can", () => {
  assert.equal(scoreRateForSettings("wait", 1.25), 0);
  assert.equal(scoreRateForSettings("flow", 1.25), 1.25);
});

test("the song target is a perfect authored-tempo Flow run before POWER", () => {
  const song = {
    bpm: 120,
    notes: [
      { id: "tap", midi: 60, startBeat: 0, durationBeats: 0.5 },
      { id: "hold", midi: 62, startBeat: 1, durationBeats: 1 },
    ],
  };

  assert.equal(targetScoreForSong(song), 2121);
});

test("switching modes clears results so Wait timing cannot carry into Flow", async () => {
  const engine = await readFile(
    new URL("../hooks/useKeyboardHeroCore.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    engine,
    /practiceMode !== settingsRef\.current\.practiceMode\) \{[\s\S]*?resetScore\(\)/,
  );
});
