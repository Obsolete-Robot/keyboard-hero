import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const {
  countClearedSongs,
  createSongProgress,
  getSongProgress,
  parseSongProgress,
  recordSongCompletion,
} = await import("../lib/songProgress.ts");

test("records independent completion progress for each song difficulty", () => {
  const easy = recordSongCompletion(
    createSongProgress(),
    "hot-cross-buns",
    "easy",
    1_250,
  );
  const hard = recordSongCompletion(
    easy,
    "hot-cross-buns",
    "hard",
    800,
  );

  assert.deepEqual(getSongProgress(hard, "hot-cross-buns", "easy"), {
    completedRuns: 1,
    bestScore: 1_250,
  });
  assert.deepEqual(getSongProgress(hard, "hot-cross-buns", "hard"), {
    completedRuns: 1,
    bestScore: 800,
  });
  assert.equal(getSongProgress(hard, "hot-cross-buns", "medium"), undefined);
  assert.equal(
    countClearedSongs(hard, ["hot-cross-buns", "lightly-row"], "easy"),
    1,
  );
});

test("increments completed runs without replacing a higher best score", () => {
  const first = recordSongCompletion(
    createSongProgress(),
    "lightly-row",
    "medium",
    2_400,
  );
  const second = recordSongCompletion(
    first,
    "lightly-row",
    "medium",
    2_100,
  );

  assert.deepEqual(getSongProgress(second, "lightly-row", "medium"), {
    completedRuns: 2,
    bestScore: 2_400,
  });
});

test("parses valid saved progress and recovers from corrupt storage", () => {
  const saved = recordSongCompletion(
    createSongProgress(),
    "twinkle-little-star",
    "easy",
    999.8,
  );

  assert.deepEqual(parseSongProgress(JSON.stringify(saved)), saved);
  assert.deepEqual(parseSongProgress("not json"), createSongProgress());
  assert.deepEqual(
    parseSongProgress(
      JSON.stringify({
        version: 1,
        songs: {
          broken: {
            easy: { completedRuns: -3, bestScore: "nope" },
          },
        },
      }),
    ),
    createSongProgress(),
  );
});
