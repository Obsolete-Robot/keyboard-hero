import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const {
  PIANO_FINGERS,
  buildSongFingeringGuide,
  detectSongHandMode,
  getFingerDescriptorsForMode,
  getRecommendedFingering,
} = await import("../lib/fingering.ts");
const { SONGS } = await import("../lib/songs.ts");
const { TRAINING_LESSONS } = await import("../lib/training.ts");

test("preserves every authored curriculum and training fingering", () => {
  const songs = [
    ...SONGS,
    ...TRAINING_LESSONS.map((lesson) => lesson.song),
  ];

  for (const song of songs) {
    const guide = buildSongFingeringGuide(song);
    assert.equal(guide.notes.length, song.notes.length, song.id);
    assert.equal(guide.byNoteId.size, song.notes.length, song.id);
    assert.deepEqual(guide.conflicts, [], song.id);

    for (const note of song.notes) {
      const recommendation = getRecommendedFingering(guide, note);
      assert.ok(recommendation, `${song.id}/${note.id}`);
      assert.equal(recommendation.hand, note.hand, `${song.id}/${note.id}`);
      assert.equal(recommendation.finger, note.finger, `${song.id}/${note.id}`);
      assert.equal(recommendation.handIsAuthored, true, `${song.id}/${note.id}`);
      assert.equal(recommendation.fingerIsAuthored, true, `${song.id}/${note.id}`);
    }

    const authoredHands = new Set(song.notes.map((note) => note.hand));
    const expectedMode = authoredHands.size === 2 ? "both" : song.notes[0].hand;
    assert.equal(guide.handMode, expectedMode, song.id);
    assert.equal(guide.fingers.length, expectedMode === "both" ? 10 : 5, song.id);
  }
});

test("a compact unlabelled melody uses one hand and keeps repeated-note fingers", () => {
  const notes = [
    { id: "a", midi: 60, startBeat: 0, durationBeats: 1 },
    { id: "b", midi: 62, startBeat: 1, durationBeats: 1 },
    { id: "c", midi: 60, startBeat: 2, durationBeats: 1 },
    { id: "d", midi: 67, startBeat: 3, durationBeats: 1 },
  ];
  const guide = buildSongFingeringGuide({ notes });

  assert.equal(guide.handMode, "right");
  assert.equal(guide.fingers.length, 5);
  assert.ok(guide.notes.every((note) => note.hand === "right"));
  assert.equal(guide.byNoteId.get("a").finger, guide.byNoteId.get("c").finger);
  assert.deepEqual(notes, [
    { id: "a", midi: 60, startBeat: 0, durationBeats: 1 },
    { id: "b", midi: 62, startBeat: 1, durationBeats: 1 },
    { id: "c", midi: 60, startBeat: 2, durationBeats: 1 },
    { id: "d", midi: 67, startBeat: 3, durationBeats: 1 },
  ]);
});

test("wide chords split across two hands with one distinct finger per tone", () => {
  const chord = [48, 52, 55, 60, 64, 67].map((midi, index) => ({
    id: `chord-${index}`,
    midi,
    startBeat: 0,
    durationBeats: 2,
  }));
  const guide = buildSongFingeringGuide({ notes: chord });
  const left = guide.notes.filter((note) => note.hand === "left");
  const right = guide.notes.filter((note) => note.hand === "right");

  assert.equal(guide.handMode, "both");
  assert.equal(guide.fingers.length, 10);
  assert.ok(left.length > 0);
  assert.ok(right.length > 0);
  assert.ok(Math.max(...left.map((note) => note.midi)) <= Math.min(...right.map((note) => note.midi)));
  assert.equal(new Set(left.map((note) => note.finger)).size, left.length);
  assert.equal(new Set(right.map((note) => note.finger)).size, right.length);
  assert.deepEqual(guide.conflicts, []);
});

test("both-hand authoring splits inferred chords without overloading either hand", () => {
  const guide = buildSongFingeringGuide({
    notes: [48, 50, 52, 53, 55, 60, 62, 64, 65, 67].map((midi, index) => ({
      id: `both-${index}`,
      midi,
      startBeat: 0,
      durationBeats: 1,
      hand: "both",
    })),
  });
  const left = guide.notes.filter((note) => note.hand === "left");
  const right = guide.notes.filter((note) => note.hand === "right");

  assert.equal(guide.handMode, "both");
  assert.equal(left.length, 5);
  assert.equal(right.length, 5);
  assert.equal(new Set(left.map((note) => note.finger)).size, 5);
  assert.equal(new Set(right.map((note) => note.finger)).size, 5);
  assert.deepEqual(guide.conflicts, []);
});

test("unplayable imported same-hand landings expose a capacity conflict", () => {
  const guide = buildSongFingeringGuide({
    notes: [60, 62, 64, 65, 67, 69].map((midi, index) => ({
      id: `overload-${index}`,
      midi,
      startBeat: 0,
      durationBeats: 1,
      hand: "right",
    })),
  });

  assert.equal(guide.handMode, "right");
  assert.deepEqual(
    guide.conflicts.map((conflict) => conflict.kind),
    ["hand-capacity"],
  );
  assert.match(guide.conflicts[0].message, /six|6|five/i);
});

test("all authored same-hand chords follow physical finger order", () => {
  const songs = [
    ...SONGS,
    ...TRAINING_LESSONS.map((lesson) => lesson.song),
  ];

  for (const song of songs) {
    const landings = new Map();
    for (const note of song.notes) {
      const key = `${note.startBeat}:${note.hand}`;
      const landing = landings.get(key) ?? [];
      landing.push(note);
      landings.set(key, landing);
    }

    for (const landing of landings.values()) {
      const ordered = [...landing].sort((left, right) => left.midi - right.midi);
      for (let lowerIndex = 0; lowerIndex < ordered.length; lowerIndex += 1) {
        for (let upperIndex = lowerIndex + 1; upperIndex < ordered.length; upperIndex += 1) {
          const lower = ordered[lowerIndex];
          const upper = ordered[upperIndex];
          if (lower.midi === upper.midi) continue;
          const physicallyOrdered =
            lower.hand === "left"
              ? lower.finger > upper.finger
              : lower.finger < upper.finger;
          assert.equal(
            physicallyOrdered,
            true,
            `${song.id} beat ${lower.startBeat}: ${lower.hand} MIDI ${lower.midi}/${lower.finger} crosses ${upper.midi}/${upper.finger}`,
          );
        }
      }
    }
  }
});

test("alternating left-hand bass pairs keep pinky below thumb", () => {
  for (const songId of ["saints-syncopation-lab", "canon-chord-forge"]) {
    const song = SONGS.find((candidate) => candidate.id === songId);
    assert.ok(song, songId);
    const leftNotes = song.notes.filter((note) => note.hand === "left");

    for (let barStart = 0; barStart < song.durationBeats; barStart += 4) {
      const pair = leftNotes.filter(
        (note) =>
          note.startBeat >= barStart &&
          note.startBeat < barStart + 4 &&
          Number.isInteger(note.startBeat),
      );
      const pitches = [...new Set(pair.map((note) => note.midi))].sort(
        (left, right) => left - right,
      );
      if (pitches.length !== 2) continue;

      const lowerFingers = new Set(
        pair.filter((note) => note.midi === pitches[0]).map((note) => note.finger),
      );
      const upperFingers = new Set(
        pair.filter((note) => note.midi === pitches[1]).map((note) => note.finger),
      );
      assert.deepEqual(
        [...lowerFingers],
        [5],
        `${songId} bar ${barStart / 4 + 1} lower bass note`,
      );
      assert.deepEqual(
        [...upperFingers],
        [1],
        `${songId} bar ${barStart / 4 + 1} upper bass note`,
      );
    }
  }
});

test("authored choices win while missing choices are completed", () => {
  const guide = buildSongFingeringGuide({
    notes: [
      {
        id: "bass",
        midi: 48,
        startBeat: 0,
        durationBeats: 1,
        hand: "left",
        finger: 5,
      },
      {
        id: "melody-authored",
        midi: 60,
        startBeat: 0,
        durationBeats: 1,
        hand: "right",
        finger: 2,
      },
      {
        id: "melody-inferred",
        midi: 64,
        startBeat: 0,
        durationBeats: 1,
      },
    ],
  });

  assert.deepEqual(
    guide.notes.map((note) => [note.noteId, note.hand, note.finger]),
    [
      ["bass", "left", 5],
      ["melody-authored", "right", 2],
      ["melody-inferred", "right", 4],
    ],
  );
  assert.equal(guide.byNoteId.get("melody-inferred").handIsAuthored, false);
  assert.equal(guide.byNoteId.get("melody-inferred").fingerIsAuthored, false);
});

test("finger descriptors read left-to-right across the keyboard", () => {
  assert.deepEqual(
    PIANO_FINGERS.map((finger) => finger.id),
    [
      "left-5",
      "left-4",
      "left-3",
      "left-2",
      "left-1",
      "right-1",
      "right-2",
      "right-3",
      "right-4",
      "right-5",
    ],
  );
  assert.equal(PIANO_FINGERS[4].name, "thumb");
  assert.equal(PIANO_FINGERS[5].name, "thumb");
  assert.equal(getFingerDescriptorsForMode("left").length, 5);
  assert.equal(getFingerDescriptorsForMode("right").length, 5);
  assert.equal(getFingerDescriptorsForMode("both").length, 10);
  assert.equal(
    detectSongHandMode({
      notes: [
        {
          id: "both-hands",
          midi: 60,
          startBeat: 0,
          durationBeats: 1,
          hand: "both",
        },
      ],
    }),
    "both",
  );
});
