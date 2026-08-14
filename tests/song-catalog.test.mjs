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
const { buildComboOrchestrationLayers } = await import(
  "../lib/comboOrchestration.ts"
);
const {
  deriveHarmonyAtBeat,
  generateAccompanimentEvents,
} = await import("../lib/accompaniment.ts");

const EXPECTED_LEVELS = ["easy", "medium", "hard"];
const EXPECTED_FAMILY_COUNT = 36;
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

function durationSeconds(song) {
  return (song.durationBeats * 60) / song.bpm;
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

test("ships 36 song families with Easy, Medium, and Hard charts", () => {
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
    "course ranks must cover every rank from 1 through 36 exactly once",
  );
});

test("exports exactly the same 108 unique charts as the family lookup", () => {
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

test("The Entertainer and Itsy Bitsy Spider have charts in their fitting venues", () => {
  const expectedFamilies = [
    { id: "itsy-bitsy-spider", title: "Itsy Bitsy Spider", careerTier: 1 },
    { id: "the-entertainer", title: "The Entertainer", careerTier: 5 },
  ];

  for (const expected of expectedFamilies) {
    const family = SONG_FAMILIES.find((entry) => entry.id === expected.id);
    assert.ok(family, `${expected.title} must appear in the song library`);
    assert.equal(family.title, expected.title);
    assert.equal(family.careerTier, expected.careerTier);

    for (const level of EXPECTED_LEVELS) {
      const chart = getSongChart(family, level);
      assert.equal(chart.challengeLevel, level);
      assert.ok(chart.notes.length > 0, `${expected.id}/${level}`);
    }
  }
});

test("Itsy Bitsy Spider follows the notated C-major 6/8 melody without octave folding", () => {
  const family = SONG_FAMILIES.find((entry) => entry.id === "itsy-bitsy-spider");
  assert.ok(family);
  const easy = family.charts.easy;
  const firstPassEnd = easy.sections[0].endBeat;
  const melody = easy.notes
    .filter((note) => note.hand === "right" && note.startBeat < firstPassEnd)
    .sort((left, right) => left.startBeat - right.startBeat);

  assert.deepEqual(easy.timeSignature, [6, 8]);
  assert.equal(easy.key, "C major");
  assert.deepEqual(
    melody.slice(0, 13).map((note) => [note.midi, note.startBeat]),
    [
      [55, 2.5],
      [60, 3], [60, 4], [60, 4.5], [62, 5.5],
      [64, 6], [64, 7.5], [64, 8.5],
      [62, 9], [60, 10], [62, 10.5], [64, 11.5],
      [60, 12],
    ],
  );
  assert.equal(Math.min(...melody.map((note) => note.midi)), 55);
  assert.equal(Math.max(...melody.map((note) => note.midi)), 67);

  const easyMelody = melody.map((note) => [
    note.midi,
    note.startBeat,
    note.durationBeats,
  ]);
  for (const level of ["medium", "hard"]) {
    const levelMelody = family.charts[level].notes
      .filter((note) => note.hand === "right" && note.startBeat < firstPassEnd)
      .sort((left, right) => left.startBeat - right.startBeat)
      .map((note) => [note.midi, note.startBeat, note.durationBeats]);
    assert.deepEqual(levelMelody, easyMelody, `${level} must preserve the score melody`);
  }
});

test("The Entertainer uses Joplin's syncopated hook in the upper playable register", () => {
  const family = SONG_FAMILIES.find((entry) => entry.id === "the-entertainer");
  assert.ok(family);
  const easy = family.charts.easy;
  const firstPassEnd = easy.sections[0].endBeat;
  const melody = easy.notes
    .filter((note) => note.hand === "right" && note.startBeat < firstPassEnd)
    .sort((left, right) => left.startBeat - right.startBeat);

  assert.deepEqual(easy.timeSignature, [2, 4]);
  assert.match(easy.key, /^A-flat major/);
  assert.deepEqual(
    melody.slice(0, 10).map((note) => [note.midi, note.startBeat]),
    [
      [58, 0], [59, 0.25], [60, 0.5], [68, 0.75], [60, 1.25],
      [68, 1.5], [60, 2], [68, 2.25], [68, 3.75], [70, 4],
    ],
  );
  assert.equal(Math.min(...melody.map((note) => note.midi)), 58);
  assert.equal(Math.max(...melody.map((note) => note.midi)), 72);

  const easyMelody = melody.map((note) => [
    note.midi,
    note.startBeat,
    note.durationBeats,
  ]);
  for (const level of ["medium", "hard"]) {
    const levelMelody = family.charts[level].notes
      .filter((note) => note.hand === "right" && note.startBeat < firstPassEnd)
      .sort((left, right) => left.startBeat - right.startBeat)
      .map((note) => [note.midi, note.startBeat, note.durationBeats]);
    assert.deepEqual(levelMelody, easyMelody, `${level} must preserve Joplin's hook`);
  }
});

test("every Easy and Medium chart has a non-empty harder Power Mode orchestration", () => {
  for (const family of SONG_FAMILIES) {
    const easyLayers = buildComboOrchestrationLayers(
      family.charts.easy.notes,
      "easy",
      family.charts.medium.notes,
      family.charts.hard.notes,
    );
    const mediumLayers = buildComboOrchestrationLayers(
      family.charts.medium.notes,
      "medium",
      [],
      family.charts.hard.notes,
    );

    assert.ok(
      easyLayers.shared.length + easyLayers.mediumOnly.length > 0,
      `${family.id} Easy needs audible Medium additions`,
    );
    assert.ok(
      easyLayers.shared.length + easyLayers.hardOnly.length > 0,
      `${family.id} Easy needs audible Hard additions`,
    );
    assert.ok(
      mediumLayers.hardOnly.length > 0,
      `${family.id} Medium needs audible Hard additions`,
    );
  }
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

test("career charts are full-length endurance playthroughs", () => {
  for (const family of SONG_FAMILIES) {
    const durations = EXPECTED_LEVELS.map(
      (level) => getSongChart(family, level).durationBeats,
    );
    assert.equal(
      new Set(durations).size,
      1,
      `${family.id} challenge levels must share one full-song form`,
    );

    for (const level of EXPECTED_LEVELS) {
      const song = getSongChart(family, level);
      assert.ok(
        durationSeconds(song) >= 60,
        `${song.id} must last at least one minute at 100% tempo`,
      );
      assert.equal(song.sections[0].startBeat, 0, `${song.id} sections must start at zero`);
      assert.equal(
        song.sections.at(-1).endBeat,
        song.durationBeats,
        `${song.id} sections must cover the complete playthrough`,
      );
      for (const section of song.sections) {
        assert.ok(
          song.notes.some(
            (note) =>
              note.startBeat >= section.startBeat && note.startBeat < section.endBeat,
          ),
          `${song.id}/${section.id} must contain playable chart notes`,
        );
      }
    }
  }
});

test("Mary plays all four complete verse passes", () => {
  const mary = getSongChart("marys-two-hand-march", "easy");
  assert.equal(mary.durationBeats, 128);
  assert.deepEqual(
    mary.sections.map((section) => section.label),
    ["Verse 1", "Verse 2", "Verse 3", "Final Verse"],
  );

  const attacksForPass = (passIndex) =>
    mary.notes
      .filter(
        (note) =>
          note.startBeat >= passIndex * 32 && note.startBeat < (passIndex + 1) * 32,
      )
      .map((note) => [note.midi, note.startBeat - passIndex * 32, note.durationBeats]);

  const firstVerse = attacksForPass(0);
  assert.ok(firstVerse.length > 0);
  for (let passIndex = 1; passIndex < 4; passIndex += 1) {
    assert.deepEqual(attacksForPass(passIndex), firstVerse);
  }
});

test("Row, Row, Row Your Boat keeps its 6/8 melody and backing in duple pulse", () => {
  const row = getSongChart("row-row-row-your-boat", "easy");
  assert.deepEqual(row.timeSignature, [6, 8]);
  assert.deepEqual(
    row.notes
      .filter((note) => note.startBeat < 24)
      .map((note) => [note.midi, note.startBeat]),
    [
      [60, 0], [60, 1.5], [60, 3], [62, 4], [64, 4.5],
      [64, 6], [62, 7], [64, 7.5], [65, 8.5], [67, 9],
      [72, 12], [72, 12.5], [72, 13], [67, 13.5], [67, 14],
      [67, 14.5], [64, 15], [64, 15.5], [64, 16], [60, 16.5],
      [60, 17], [60, 17.5],
      [67, 18], [65, 19], [64, 19.5], [62, 20.5], [60, 21],
    ],
  );

  const band = generateAccompanimentEvents(row, 0, 3);
  assert.deepEqual(
    band.filter((event) => event.kind === "snare").map((event) => event.beat),
    [1.5],
  );
  assert.deepEqual(
    band.filter((event) => event.kind === "bass").map((event) => event.beat),
    [0, 1.5],
  );
});

test("every career song ships one stable, uniquely named authored band arrangement", () => {
  const arrangementIds = [];
  const arrangementNames = [];

  for (const family of SONG_FAMILIES) {
    const arrangements = EXPECTED_LEVELS.map(
      (level) => getSongChart(family, level).accompaniment,
    );
    assert.ok(arrangements.every(Boolean), `${family.id} needs authored accompaniment`);
    assert.ok(
      arrangements.every(
        (arrangement) => arrangement.arrangementId === family.id,
      ),
      `${family.id} arrangement identity must follow the song family`,
    );
    assert.deepEqual(
      arrangements.slice(1),
      [arrangements[0], arrangements[0]],
      `${family.id} challenge charts must play with the same band`,
    );
    assert.ok(arrangements[0].progression.length > 0);
    arrangementIds.push(arrangements[0].arrangementId);
    arrangementNames.push(arrangements[0].name);
  }

  assertUnique(arrangementIds, "accompaniment arrangement id");
  assertUnique(arrangementNames, "accompaniment arrangement name");
});

test("career accompaniment has distinct song-level grooves instead of one preset", () => {
  const signatures = SONG_FAMILIES.map((family) => {
    const song = getSongChart(family, "easy");
    const arrangement = song.accompaniment;
    return JSON.stringify({
      drumKit: arrangement.drumKit,
      bassVoice: arrangement.bassVoice,
      harmonyVoice: arrangement.harmonyVoice,
      kick: arrangement.kick,
      snare: arrangement.snare,
      hats: arrangement.hats,
      bass: arrangement.bass,
      harmony: arrangement.harmony,
    });
  });

  assert.ok(
    new Set(signatures).size >= 30,
    "the 36-song career should have at least 30 materially distinct band grooves",
  );
  assert.equal(
    getSongChart("minuet-in-g", "easy").accompaniment.drumKit,
    "none",
    "chamber music should not receive a generic drum machine",
  );
  assert.equal(
    getSongChart("neon-skyline-finale", "easy").accompaniment.drumKit,
    "rock",
  );
});

test("authored chord progressions drive harmony instead of melody-note guessing", () => {
  const blues = getSongChart("twelve-bar-neon-blues", "easy");
  assert.deepEqual(
    [0, 16, 32].map((beat) => {
      const harmony = deriveHarmonyAtBeat(blues, beat);
      return [harmony.symbol, harmony.rootPitchClass, harmony.quality];
    }),
    [
      ["C7", 0, "dominant"],
      ["F7", 5, "dominant"],
      ["G7", 7, "dominant"],
    ],
  );

  const minuet = getSongChart("minuet-in-g", "easy");
  assert.equal(
    generateAccompanimentEvents(minuet, 0, 3).some(
      (event) => ["kick", "snare", "closed-hat", "open-hat"].includes(event.kind),
    ),
    false,
  );
  assert.deepEqual(
    getSongChart("marys-two-hand-march", "easy").accompaniment.progression,
    ["C", "C", "G7", "C", "C", "C", "G7", "C"],
    "Mary's harmony should support each melody phrase instead of alternating blindly",
  );
});

test("every accompaniment chord form resets exactly with its melody pass", () => {
  for (const family of SONG_FAMILIES) {
    const song = getSongChart(family, "easy");
    const passBeats = song.sections[0].endBeat - song.sections[0].startBeat;
    const opening = deriveHarmonyAtBeat(song, 0);
    const repeatedOpening = deriveHarmonyAtBeat(song, passBeats);
    assert.equal(
      repeatedOpening.symbol,
      opening.symbol,
      `${family.id} harmony must not drift when the melody repeats`,
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

test("each challenge level gets strictly harder from course rank 1 to 36", () => {
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
