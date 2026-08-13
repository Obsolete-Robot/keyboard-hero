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
    "B+",
    true,
  );
  const hard = recordSongCompletion(
    easy,
    "hot-cross-buns",
    "hard",
    800,
    "C",
  );

  assert.deepEqual(getSongProgress(hard, "hot-cross-buns", "easy"), {
    completedRuns: 1,
    bestScore: 1_250,
    bestRank: "B+",
    perfectRuns: 1,
  });
  assert.deepEqual(getSongProgress(hard, "hot-cross-buns", "hard"), {
    completedRuns: 1,
    bestScore: 800,
    bestRank: "C",
    perfectRuns: 0,
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
    "B",
  );
  const second = recordSongCompletion(
    first,
    "lightly-row",
    "medium",
    2_100,
    "A",
  );

  assert.deepEqual(getSongProgress(second, "lightly-row", "medium"), {
    completedRuns: 2,
    bestScore: 2_400,
    bestRank: "A",
    perfectRuns: 0,
  });
});

test("caps mistake-free Flow mastery at five gold stars", () => {
  let progress = createSongProgress();
  for (let run = 0; run < 7; run += 1) {
    progress = recordSongCompletion(
      progress,
      "yankee-doodle",
      "easy",
      315_000,
      "A+",
      true,
    );
  }

  assert.equal(
    getSongProgress(progress, "yankee-doodle", "easy")?.perfectRuns,
    5,
  );
  assert.equal(
    getSongProgress(progress, "yankee-doodle", "easy")?.completedRuns,
    7,
  );
});

test("parses valid saved progress and recovers from corrupt storage", () => {
  const saved = recordSongCompletion(
    createSongProgress(),
    "twinkle-little-star",
    "easy",
    999.8,
    "A-",
  );

  assert.deepEqual(parseSongProgress(JSON.stringify(saved)), saved);
  assert.equal(
    getSongProgress(saved, "twinkle-little-star", "easy")?.bestRank,
    "A−",
  );
  assert.deepEqual(parseSongProgress("not json"), createSongProgress());
  const migrated = parseSongProgress(
    JSON.stringify({
      version: 1,
      songs: {
        legacy: {
          easy: { completedRuns: 2, bestScore: 500, bestRank: "B" },
        },
      },
    }),
  );
  assert.equal(getSongProgress(migrated, "legacy", "easy")?.perfectRuns, 0);
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
