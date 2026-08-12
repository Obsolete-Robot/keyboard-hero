import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const {
  HOME_FINGER_POSITIONS,
  TRAINING_LESSONS,
  getNextTrainingLanding,
  getNotesInSection,
  getTrainingSection,
  nextTrainingLesson,
} = await import("../lib/training.ts");
const { SONGS, validateSong } = await import("../lib/songs.ts");

test("ships a gradual six-step two-hand training path", () => {
  assert.equal(TRAINING_LESSONS.length, 6);
  assert.deepEqual(
    TRAINING_LESSONS.map((lesson) => lesson.id),
    [
      "right-hand-home",
      "left-hand-home",
      "hands-take-turns",
      "first-two-hand-landing",
      "build-a-chord",
      "frere-bridge",
    ],
  );

  for (const [index, lesson] of TRAINING_LESSONS.entries()) {
    assert.equal(lesson.order, index + 1);
    assert.equal(validateSong(lesson.song).length, 0, lesson.id);
    assert.ok(lesson.song.sections.length >= 2, lesson.id);
    assert.ok(
      lesson.song.sections.every(
        (section) => section.endBeat - section.startBeat <= 8,
      ),
      `${lesson.id} contains an oversized practice move`,
    );
    assert.ok(
      lesson.song.sections.every(
        (section) =>
          section.recommendedTempoPercent >= 35 &&
          section.recommendedTempoPercent <= 45,
      ),
      `${lesson.id} does not start slowly`,
    );
    assert.ok(
      lesson.song.notes.every(
        (note) =>
          (note.hand === "left" || note.hand === "right") &&
          Number.isInteger(note.finger) &&
          note.finger >= 1 &&
          note.finger <= 5,
      ),
      `${lesson.id} is missing explicit hand or finger guidance`,
    );
  }
});

test("home-position map gives both hands one finger per C-to-G key", () => {
  assert.equal(HOME_FINGER_POSITIONS.length, 10);
  assert.deepEqual(
    HOME_FINGER_POSITIONS.filter((position) => position.hand === "left").map(
      (position) => [position.note, position.finger],
    ),
    [
      ["C3", 5],
      ["D3", 4],
      ["E3", 3],
      ["F3", 2],
      ["G3", 1],
    ],
  );
  assert.deepEqual(
    HOME_FINGER_POSITIONS.filter((position) => position.hand === "right").map(
      (position) => [position.note, position.finger],
    ),
    [
      ["C4", 1],
      ["D4", 2],
      ["E4", 3],
      ["F4", 4],
      ["G4", 5],
    ],
  );
});

test("grouped landing guidance keeps every simultaneous hand and chord tone", () => {
  const togetherLesson = TRAINING_LESSONS.find(
    (lesson) => lesson.id === "first-two-hand-landing",
  );
  const chordLesson = TRAINING_LESSONS.find(
    (lesson) => lesson.id === "build-a-chord",
  );
  assert.ok(togetherLesson);
  assert.ok(chordLesson);

  const togetherSection = getTrainingSection(
    togetherLesson,
    "land-together",
  );
  const firstLanding = getNextTrainingLanding(
    togetherLesson.song,
    togetherSection.startBeat,
    new Set(),
    togetherSection,
  );
  assert.deepEqual(
    firstLanding.notes.map((note) => [note.midi, note.hand, note.finger]),
    [
      [48, "left", 5],
      [60, "right", 1],
    ],
  );

  const fullChord = getNextTrainingLanding(
    chordLesson.song,
    12,
    new Set(),
    { startBeat: 12, endBeat: 16 },
  );
  assert.equal(fullChord.notes.length, 5);
  assert.deepEqual(fullChord.notes.map((note) => note.midi), [48, 55, 60, 64, 67]);

  const oneToneComplete = new Set([fullChord.notes[0].id]);
  const remainingChord = getNextTrainingLanding(
    chordLesson.song,
    12,
    oneToneComplete,
    { startBeat: 12, endBeat: 16 },
  );
  assert.equal(remainingChord.notes.length, 5);
});

test("section helpers and lesson navigation stay within the roadmap", () => {
  const first = TRAINING_LESSONS[0];
  const last = TRAINING_LESSONS.at(-1);
  assert.equal(nextTrainingLesson(first, -1), null);
  assert.equal(nextTrainingLesson(last, 1), null);
  assert.equal(nextTrainingLesson(first, 1).id, "left-hand-home");

  for (const lesson of TRAINING_LESSONS) {
    for (const section of lesson.song.sections) {
      const notes = getNotesInSection(lesson.song, section);
      assert.ok(notes.length > 0, `${lesson.id}/${section.id} has no notes`);
      assert.ok(
        notes.every(
          (note) =>
            note.startBeat >= section.startBeat &&
            note.startBeat < section.endBeat,
        ),
      );
    }
  }
});

test("Frère Jacques now exposes four-beat cells instead of one 32-note overlap", () => {
  const frere = SONGS.find((song) => song.id === "frere-jacques-canon");
  assert.ok(frere);
  assert.equal(frere.sections.length, 10);
  assert.ok(
    frere.sections.every(
      (section) => section.endBeat - section.startBeat === 4,
    ),
  );
  assert.deepEqual(
    frere.sections.map((section) => [section.startBeat, section.endBeat]),
    Array.from({ length: 10 }, (_, index) => [index * 4, index * 4 + 4]),
  );
});
