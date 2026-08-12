import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const {
  ALL_SONG_CHARTS,
  CHALLENGE_LEVELS,
  SONG_FAMILIES,
  getSongChart,
} = await import("../lib/songCatalog.ts");
const { MIDI_MAX, MIDI_MIN, validateSong } = await import("../lib/songs.ts");
const { buildSongFingeringGuide } = await import("../lib/fingering.ts");

const EXPECTED_LEVELS = ["easy", "medium", "hard"];
const EXPECTED_FAMILY_COUNT = 35;
const EXPECTED_CHART_COUNT =
  EXPECTED_FAMILY_COUNT * EXPECTED_LEVELS.length;
const CONCRETE_HANDS = new Set(["left", "right"]);

function unwrapCatalogEntry(entry) {
  return entry?.song ?? entry;
}

function chartMetadataForLevel(family, level) {
  if (Array.isArray(family.charts)) {
    return family.charts.find(
      (chart) =>
        chart?.challengeLevel === level ||
        chart?.challenge === level ||
        chart?.level === level,
    );
  }
  return family.charts?.[level];
}

function landingKey(startBeat) {
  return Math.round(startBeat * 1_000_000);
}

function groupLandings(song) {
  const landings = new Map();
  for (const note of song.notes) {
    const key = landingKey(note.startBeat);
    const landing = landings.get(key) ?? [];
    landing.push(note);
    landings.set(key, landing);
  }
  return [...landings.values()];
}

function handsUsedBy(song) {
  return new Set(song.notes.map((note) => note.hand));
}

function assertConcreteHands(song) {
  assert.ok(
    song.notes.every((note) => CONCRETE_HANDS.has(note.hand)),
    `${song.id} must author every note for a concrete left or right hand`,
  );
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert.equal(typeof value, "string", `${label} must be strings`);
    assert.notEqual(value.trim(), "", `${label} must not be empty`);
    assert.equal(seen.has(value), false, `duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function challengeRatingFor(family, level, song, allCatalogEntry) {
  const chartMetadata = chartMetadataForLevel(family, level);
  return (
    chartMetadata?.challengeRating ??
    song.challengeRating ??
    family.challengeRatings?.[level] ??
    allCatalogEntry?.challengeRating
  );
}

test("ships 35 song families with Easy, Medium, and Hard charts", () => {
  assert.deepEqual([...CHALLENGE_LEVELS], EXPECTED_LEVELS);
  assert.ok(Array.isArray(SONG_FAMILIES));
  assert.equal(SONG_FAMILIES.length, EXPECTED_FAMILY_COUNT);
  assertUnique(
    SONG_FAMILIES.map((family) => family.id),
    "song family id",
  );

  const ranks = SONG_FAMILIES.map((family) => family.courseRank);
  assert.deepEqual(
    [...ranks].sort((left, right) => left - right),
    Array.from({ length: EXPECTED_FAMILY_COUNT }, (_, index) => index + 1),
    "course ranks must cover every rank from 1 through 35 exactly once",
  );
});

test("exports exactly the same 105 unique charts as the family lookup", () => {
  assert.ok(Array.isArray(ALL_SONG_CHARTS));
  assert.equal(ALL_SONG_CHARTS.length, EXPECTED_CHART_COUNT);

  const flatCatalogSongs = ALL_SONG_CHARTS.map(unwrapCatalogEntry);
  const resolvedSongs = SONG_FAMILIES.flatMap((family) =>
    EXPECTED_LEVELS.map((level) => getSongChart(family, level)),
  );

  assert.ok(
    resolvedSongs.every(Boolean),
    "getSongChart must resolve every family/challenge combination",
  );
  assertUnique(
    flatCatalogSongs.map((song) => song?.id),
    "chart id",
  );
  assertUnique(
    resolvedSongs.map((song) => song?.id),
    "resolved chart id",
  );
  assert.deepEqual(
    new Set(flatCatalogSongs.map((song) => song.id)),
    new Set(resolvedSongs.map((song) => song.id)),
    "ALL_SONG_CHARTS must contain each chart returned by getSongChart exactly once",
  );
});

test("every chart and note is valid, unique, in range, and playable", () => {
  const songs = ALL_SONG_CHARTS.map(unwrapCatalogEntry);
  const allNoteIds = [];

  for (const song of songs) {
    assert.ok(song && typeof song === "object", "catalog entries must resolve to songs");
    assert.ok(song.notes.length > 0, `${song.id} must contain notes`);
    assert.deepEqual(validateSong(song), [], song.id);
    assertConcreteHands(song);

    for (const note of song.notes) {
      allNoteIds.push(note.id);
      assert.ok(
        note.midi >= MIDI_MIN && note.midi <= MIDI_MAX,
        `${song.id}/${note.id} must stay within MIDI ${MIDI_MIN}-${MIDI_MAX}`,
      );
    }

    for (const landing of groupLandings(song)) {
      const midiNotes = landing.map((note) => note.midi);
      assert.equal(
        new Set(midiNotes).size,
        midiNotes.length,
        `${song.id} beat ${landing[0].startBeat} repeats a MIDI pitch in one landing`,
      );
    }

    const fingering = buildSongFingeringGuide(song);
    assert.deepEqual(fingering.conflicts, [], song.id);
  }

  assertUnique(allNoteIds, "note id");
});

test("Easy charts stay one-handed and monophonic", () => {
  for (const family of SONG_FAMILIES) {
    const song = getSongChart(family, "easy");
    assertConcreteHands(song);

    const hands = handsUsedBy(song);
    assert.equal(hands.size, 1, `${song.id} must use exactly one hand`);
    assert.ok(
      groupLandings(song).every((landing) => landing.length === 1),
      `${song.id} must contain at most one note per landing`,
    );
  }
});

test("Medium charts use both hands and introduce chord landings", () => {
  for (const family of SONG_FAMILIES) {
    const song = getSongChart(family, "medium");
    assertConcreteHands(song);
    assert.deepEqual(
      [...handsUsedBy(song)].sort(),
      ["left", "right"],
      `${song.id} must use both hands`,
    );
    assert.ok(
      groupLandings(song).some((landing) => landing.length >= 2),
      `${song.id} must include at least one chord landing`,
    );
  }
});

test("Hard charts use both hands and include full chords", () => {
  for (const family of SONG_FAMILIES) {
    const song = getSongChart(family, "hard");
    assertConcreteHands(song);
    assert.deepEqual(
      [...handsUsedBy(song)].sort(),
      ["left", "right"],
      `${song.id} must use both hands`,
    );
    assert.ok(
      groupLandings(song).some((landing) => landing.length >= 3),
      `${song.id} must include at least one full three-note-or-larger chord`,
    );
  }
});

test("each challenge level gets strictly harder from course rank 1 to 35", () => {
  const familiesByRank = [...SONG_FAMILIES].sort(
    (left, right) => left.courseRank - right.courseRank,
  );
  const catalogEntryBySongId = new Map(
    ALL_SONG_CHARTS.map((entry) => [unwrapCatalogEntry(entry)?.id, entry]),
  );

  for (const level of EXPECTED_LEVELS) {
    let previousRating = Number.NEGATIVE_INFINITY;

    for (const family of familiesByRank) {
      const song = getSongChart(family, level);
      const rating = challengeRatingFor(
        family,
        level,
        song,
        catalogEntryBySongId.get(song.id),
      );
      assert.ok(
        Number.isFinite(rating),
        `${song.id} must expose a numeric challengeRating`,
      );
      assert.ok(
        rating > previousRating,
        `${level} challengeRating must rise at course rank ${family.courseRank}: ` +
          `${rating} is not greater than ${previousRating}`,
      );
      previousRating = rating;
    }
  }
});
