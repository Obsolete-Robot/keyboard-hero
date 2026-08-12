/**
 * Three-chart Keyboard Hero career catalog.
 *
 * `Song` remains the playback contract. Catalog metadata is additive, so every
 * chart can be passed directly to the existing transport, renderer, scorer,
 * fingering guide, and accompaniment engine.
 */
import {
  AKAI_MPK_MINI_IV_SETUP,
  MIDI_MAX,
  MIDI_MIN,
  SONGS,
  validateSong,
  type Articulation,
  type Difficulty,
  type Finger,
  type Hand,
  type Song,
  type SongNote,
  type SongSection,
} from "@/lib/songs";
import { meterGrid } from "@/lib/meter";

export const CHALLENGE_LEVELS = ["easy", "medium", "hard"] as const;

export type ChallengeLevel = (typeof CHALLENGE_LEVELS)[number];

export const CAREER_TIERS = [1, 2, 3, 4, 5] as const;

export type CareerTier = (typeof CAREER_TIERS)[number];

/** A current `Song` plus catalog-only progression metadata. */
export interface SongChart extends Song {
  familyId: string;
  challengeLevel: ChallengeLevel;
  /** Strictly increases from career rank 1 through 35 for every challenge. */
  challengeRating: number;
  courseRank: number;
  careerTier: CareerTier;
}

export interface SongFamily {
  id: string;
  title: string;
  subtitle: string;
  composer: string;
  bpm: number;
  style: string;
  courseRank: number;
  careerTier: CareerTier;
  challengeRatings: Record<ChallengeLevel, number>;
  charts: Record<ChallengeLevel, SongChart>;
}

type NoteSeed = Omit<SongNote, "id">;
type HarmonySymbol = string;
type ThemeStep = readonly [midi: number | null, durationBeats: number];

interface PublicDomainTheme {
  id: string;
  title: string;
  subtitle: string;
  composer: string;
  bpm: number;
  key: string;
  timeSignature: readonly [number, number];
  style: string;
  focus: string;
  melody: readonly ThemeStep[];
  harmony: readonly HarmonySymbol[];
  repeats?: number;
  articulation?: Articulation;
}

const EPSILON = 0.000_001;
const MIN_FULL_PLAYTHROUGH_SECONDS = 60;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const roundBeat = (beat: number): number => Math.round(beat * 1_000_000) / 1_000_000;

const fullPlaythroughPasses = (
  passDurationBeats: number,
  bpm: number,
  preferredPasses = 1,
): number =>
  Math.max(
    preferredPasses,
    Math.ceil((MIN_FULL_PLAYTHROUGH_SECONDS * bpm) / (60 * passDurationBeats)),
  );

const repeatArrangement = (
  notes: readonly NoteSeed[],
  passDurationBeats: number,
  passes: number,
): NoteSeed[] =>
  Array.from({ length: passes }, (_, passIndex) =>
    notes.map((note) => ({
      ...note,
      startBeat: roundBeat(note.startBeat + passIndex * passDurationBeats),
    })),
  ).flat();

const beatsPerMeasure = (signature: readonly [number, number]): number =>
  meterGrid(signature).measureBeats;

const careerTierFor = (courseRank: number): CareerTier =>
  CAREER_TIERS[Math.min(CAREER_TIERS.length - 1, Math.floor((courseRank - 1) / 7))];

const challengeRatingFor = (
  courseRank: number,
  challenge: ChallengeLevel,
): number =>
  (courseRank - 1) * CHALLENGE_LEVELS.length +
  CHALLENGE_LEVELS.indexOf(challenge) +
  1;

const displayDifficultyFor = (
  courseRank: number,
  challenge: ChallengeLevel,
): Difficulty => {
  const rating = challengeRatingFor(courseRank, challenge);
  return clamp(Math.ceil(rating / 21), 1, 5) as Difficulty;
};

const rightFingerFor = (midi: number): Finger =>
  clamp(((midi - 60) % 5 + 5) % 5 + 1, 1, 5) as Finger;

const leftFingerFor = (midi: number): Finger =>
  clamp(5 - Math.round((clamp(midi, 48, 59) - 48) / 3), 1, 5) as Finger;

const fingerFor = (midi: number, hand: Hand): Finger =>
  hand === "left" ? leftFingerFor(midi) : rightFingerFor(midi);

const seed = (
  midi: number,
  startBeat: number,
  durationBeats: number,
  hand: Hand,
  velocity: number,
  articulation: Articulation = "normal",
  accent = false,
): NoteSeed => ({
  midi,
  startBeat: roundBeat(startBeat),
  durationBeats: roundBeat(durationBeats),
  hand,
  finger: fingerFor(midi, hand),
  velocity,
  articulation,
  accent,
});

const NOTE_PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

interface ParsedHarmony {
  rootPitchClass: number;
  pitchClasses: readonly number[];
}

const parseHarmony = (symbol: HarmonySymbol): ParsedHarmony => {
  const match = /^(C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[A-G])/.exec(symbol);
  if (!match) throw new Error(`Unsupported harmony symbol: ${symbol}`);

  const rootPitchClass = NOTE_PITCH_CLASSES[match[1]];
  const suffix = symbol.slice(match[1].length);
  const intervals = suffix.includes("dim")
    ? [0, 3, 6]
    : suffix.startsWith("m") && !suffix.startsWith("maj")
      ? [0, 3, 7]
      : [0, 4, 7];
  const withSeventh = suffix.includes("7")
    ? [...intervals, suffix.includes("maj7") ? 11 : 10]
    : intervals;

  return {
    rootPitchClass,
    pitchClasses: withSeventh.map((interval) => (rootPitchClass + interval) % 12),
  };
};

const bassMidiFor = (pitchClass: number): number => MIDI_MIN + pitchClass;

/** Compact close-position voicing whose pitches all fit C4-C5. */
const rightVoicingFor = (symbol: HarmonySymbol, maximumNotes = 3): number[] => {
  const harmony = parseHarmony(symbol);
  const candidates: number[] = [];
  for (let midi = 60; midi <= MIDI_MAX; midi += 1) {
    if (harmony.pitchClasses.includes(midi % 12)) candidates.push(midi);
  }
  return candidates.slice(0, maximumNotes);
};

const dedupeAndIdentify = (chartId: string, notes: readonly NoteSeed[]): SongNote[] => {
  const byAttack = new Map<string, NoteSeed>();
  for (const note of notes) {
    if (note.midi < MIDI_MIN || note.midi > MIDI_MAX) continue;
    const key = `${roundBeat(note.startBeat)}:${note.midi}`;
    const existing = byAttack.get(key);
    if (!existing || note.durationBeats > existing.durationBeats) byAttack.set(key, note);
  }

  const byAttackAndHand = new Map<string, NoteSeed[]>();
  for (const note of byAttack.values()) {
    const concreteHand: Hand = note.hand === "left" ? "left" : "right";
    const key = `${roundBeat(note.startBeat)}:${concreteHand}`;
    const group = byAttackAndHand.get(key) ?? [];
    group.push({ ...note, hand: concreteHand });
    byAttackAndHand.set(key, group);
  }

  const playable: NoteSeed[] = [];
  for (const group of byAttackAndHand.values()) {
    const hand: Hand = group[0]?.hand === "left" ? "left" : "right";
    const ordered = [...group].sort((a, b) => a.midi - b.midi);
    // A physical hand has only five fingers. On an over-full reduced landing,
    // retain the bass edge for the left hand and melody edge for the right.
    const capped = hand === "left" ? ordered.slice(0, 5) : ordered.slice(-5);
    capped.forEach((note, index) => {
      const finger = capped.length === 1
        ? (note.finger ?? fingerFor(note.midi, hand))
        : hand === "left"
          ? ((5 - index) as Finger)
          : ((index + 1) as Finger);
      playable.push({ ...note, hand, finger });
    });
  }

  return playable
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    .map((note, index) => ({
      ...note,
      id: `${chartId}-note-${String(index + 1).padStart(4, "0")}`,
    }));
};

const buildSections = (
  familyId: string,
  durationBeats: number,
  signature: readonly [number, number],
  challenge: ChallengeLevel,
): SongSection[] => {
  const measureBeats = beatsPerMeasure(signature);
  const measureCount = Math.max(1, Math.round(durationBeats / measureBeats));
  const sectionCount = Math.min(4, measureCount);
  const result: SongSection[] = [];
  let startMeasure = 0;

  for (let index = 0; index < sectionCount; index += 1) {
    const endMeasure = Math.round(((index + 1) * measureCount) / sectionCount);
    if (endMeasure <= startMeasure) continue;
    result.push({
      id: `${familyId}-${challenge}-section-${index + 1}`,
      label: index === sectionCount - 1 ? "Finale" : `Phrase ${index + 1}`,
      startBeat: roundBeat(startMeasure * measureBeats),
      endBeat: index === sectionCount - 1
        ? durationBeats
        : roundBeat(endMeasure * measureBeats),
      focus:
        challenge === "easy"
          ? "Keep the melody even and prepare each hand-position change."
          : challenge === "medium"
            ? "Keep the melody clear while the left hand marks the harmony."
            : "Balance the melody above the compact full-piano voicing.",
      recommendedTempoPercent: challenge === "easy" ? 80 : challenge === "medium" ? 65 : 50,
      repeatCount: challenge === "easy" ? 2 : challenge === "medium" ? 3 : 4,
    });
    startMeasure = endMeasure;
  }

  return result;
};

const buildPerformanceSections = (
  familyId: string,
  labels: readonly string[],
  passDurationBeats: number,
  challenge: ChallengeLevel,
): SongSection[] =>
  labels.map((label, index) => ({
    id: `${familyId}-${challenge}-performance-${index + 1}`,
    label,
    startBeat: roundBeat(index * passDurationBeats),
    endBeat: roundBeat((index + 1) * passDurationBeats),
    focus:
      index === labels.length - 1
        ? "Keep your technique relaxed and finish the complete song cleanly."
        : challenge === "easy"
          ? "Keep the melody and pulse consistent across the full song."
          : challenge === "medium"
            ? "Keep the melody clear while sustaining the accompaniment through the form."
            : "Balance the full voicing without losing energy across the form.",
    recommendedTempoPercent: challenge === "easy" ? 80 : challenge === "medium" ? 65 : 50,
    repeatCount: challenge === "easy" ? 2 : challenge === "medium" ? 3 : 4,
  }));

const chartSkills = (
  challenge: ChallengeLevel,
  focus: string,
): string[] => {
  if (challenge === "easy") {
    return ["one-hand melody", "single-note reading", "steady pulse", focus];
  }
  if (challenge === "medium") {
    return ["two-hand coordination", "bass anchors", "occasional chords", focus];
  }
  return ["full chord voicing", "hand independence", "real-piano reduction", focus];
};

const chartPedagogy = (
  challenge: ChallengeLevel,
  focus: string,
  courseRank: number,
): Song["pedagogy"] => ({
  handPosition:
    challenge === "easy"
      ? "Right hand follows the melody inside C3-C5; shift as a relaxed unit when needed."
      : "Left hand covers C3-B3 while the right hand voices melody and harmony from C4-C5.",
  learningGoals:
    challenge === "easy"
      ? ["Play one note at a time with the right hand.", "Read rhythm before adding speed.", focus]
      : challenge === "medium"
        ? ["Coordinate melody and bass.", "Land occasional chord tones together.", focus]
        : ["Voice the melody above full chords.", "Move between inversions economically.", focus],
  coachTips:
    challenge === "easy"
      ? ["Name the next key before it arrives.", "Keep unused fingers close to the keys."]
      : challenge === "medium"
        ? ["Practice each hand alone once before combining them.", "Keep bass notes quieter than melody."]
        : ["Block each harmony before playing it in rhythm.", "Use arm weight, never a rigid wrist, for chord attacks."],
  mastery: {
    accuracyPercent: challenge === "easy" ? 85 : challenge === "medium" ? 90 : 93,
    timingWindowMs: challenge === "easy" ? 180 : challenge === "medium" ? 135 : 95,
    minimumTempoPercent: challenge === "easy" ? 70 : challenge === "medium" ? 80 : 90,
    cleanRuns: challenge === "hard" || courseRank > 28 ? 3 : 2,
  },
});

interface ChartBase {
  familyId: string;
  title: string;
  subtitle: string;
  composer: string;
  bpm: number;
  key: string;
  timeSignature: readonly [number, number];
  style: string;
  origin: Song["origin"];
  attribution: string;
  durationBeats: number;
  /** Length of one authored pass before full-song endurance repeats. */
  performancePassBeats?: number;
  /** Named top-level form shown across the full-song timeline. */
  performanceSectionLabels?: readonly string[];
  notes: readonly NoteSeed[];
  courseRank: number;
  focus: string;
  sourceSections?: readonly SongSection[];
}

const createChart = (base: ChartBase, challenge: ChallengeLevel): SongChart => {
  const chartId = challenge === "medium" ? base.familyId : `${base.familyId}-${challenge}`;
  const careerTier = careerTierFor(base.courseRank);
  const performanceCopy = base.performanceSectionLabels?.length
    ? ` Full-length ${base.performanceSectionLabels.length}-part performance.`
    : "";
  const chart: SongChart = {
    id: chartId,
    familyId: base.familyId,
    challengeLevel: challenge,
    challengeRating: challengeRatingFor(base.courseRank, challenge),
    courseRank: base.courseRank,
    careerTier,
    title: base.title,
    subtitle: base.subtitle,
    composer: base.composer,
    bpm: base.bpm,
    difficulty: displayDifficultyFor(base.courseRank, challenge),
    level: `${base.courseRank} · ${careerTier} · ${challenge[0].toUpperCase()}${challenge.slice(1)}`,
    skills: chartSkills(challenge, base.focus),
    description: `${base.subtitle}. ${challenge === "easy" ? "One-hand melody chart." : challenge === "medium" ? "Two-hand chart with bass anchors and selected chord hits." : "Full-piano challenge adapted to the 25-key range."}${performanceCopy}`,
    durationBeats: base.durationBeats,
    notes: dedupeAndIdentify(chartId, base.notes),
    sections:
      base.performancePassBeats && base.performanceSectionLabels?.length
        ? buildPerformanceSections(
            base.familyId,
            base.performanceSectionLabels,
            base.performancePassBeats,
            challenge,
          )
        : base.sourceSections?.map((section, index) => ({
        ...section,
        id: `${chartId}-section-${index + 1}`,
        recommendedTempoPercent:
          challenge === "easy" ? 80 : challenge === "medium" ? 65 : 50,
          })) ?? buildSections(base.familyId, base.durationBeats, base.timeSignature, challenge),
    key: base.key,
    timeSignature: base.timeSignature,
    style: base.style,
    origin: base.origin,
    attribution: base.attribution,
    countInBeats: beatsPerMeasure(base.timeSignature),
    recommendedTempo: {
      minPercent: challenge === "easy" ? 50 : challenge === "medium" ? 40 : 30,
      maxPercent: challenge === "hard" ? 110 : 120,
      stepPercent: 5,
    },
    pedagogy: chartPedagogy(challenge, base.focus, base.courseRank),
    octaveShiftHint: AKAI_MPK_MINI_IV_SETUP,
  };

  const issues = validateSong(chart);
  if (issues.length > 0) {
    throw new Error(`Invalid catalog chart "${chart.id}": ${issues.join("; ")}`);
  }
  return chart;
};

const buildFamily = (
  base: Omit<ChartBase, "notes">,
  arrangements: Record<ChallengeLevel, readonly NoteSeed[]>,
): SongFamily => {
  const charts = Object.fromEntries(
    CHALLENGE_LEVELS.map((challenge) => [
      challenge,
      createChart({ ...base, notes: arrangements[challenge] }, challenge),
    ]),
  ) as unknown as Record<ChallengeLevel, SongChart>;

  return {
    id: base.familyId,
    title: base.title,
    subtitle: base.subtitle,
    composer: base.composer,
    bpm: base.bpm,
    style: base.style,
    courseRank: base.courseRank,
    careerTier: careerTierFor(base.courseRank),
    challengeRatings: {
      easy: charts.easy.challengeRating,
      medium: charts.medium.challengeRating,
      hard: charts.hard.challengeRating,
    },
    charts,
  };
};

const melodySeedsFromSteps = (
  steps: readonly ThemeStep[],
  repeats: number,
  articulation: Articulation,
): { notes: NoteSeed[]; durationBeats: number } => {
  const cycleBeats = steps.reduce((total, [, duration]) => total + duration, 0);
  const notes: NoteSeed[] = [];

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    let cursor = repeat * cycleBeats;
    steps.forEach(([midi, duration], index) => {
      if (midi !== null) {
        notes.push(
          seed(
            midi,
            cursor,
            Math.max(0.18, duration * 0.88),
            "right",
            94,
            articulation,
            index === 0,
          ),
        );
      }
      cursor += duration;
    });
  }

  return { notes, durationBeats: roundBeat(cycleBeats * repeats) };
};

const harmonyAtMeasure = (
  progression: readonly HarmonySymbol[],
  measureIndex: number,
): HarmonySymbol => progression[measureIndex % progression.length] ?? "C";

const addMediumHarmony = (
  melody: readonly NoteSeed[],
  durationBeats: number,
  signature: readonly [number, number],
  progression: readonly HarmonySymbol[],
): NoteSeed[] => {
  const result = [...melody];
  const measureBeats = beatsPerMeasure(signature);
  const measureCount = Math.ceil(durationBeats / measureBeats);

  for (let measure = 0; measure < measureCount; measure += 1) {
    const start = measure * measureBeats;
    const harmony = parseHarmony(harmonyAtMeasure(progression, measure));
    const root = bassMidiFor(harmony.rootPitchClass);
    result.push(seed(root, start, Math.min(measureBeats * 0.72, 1.8), "left", 76, "normal", true));

    // Every fourth bar introduces an actual left-hand shell chord; intervening
    // bars stay sparse enough for a first two-hand arrangement.
    if (measure % 4 === 3 || measure === measureCount - 1) {
      const fifth = bassMidiFor((harmony.rootPitchClass + 7) % 12);
      result.push(seed(fifth, start, Math.min(measureBeats * 0.72, 1.8), "left", 72));
    }
  }
  return result;
};

const addHardHarmony = (
  melody: readonly NoteSeed[],
  durationBeats: number,
  signature: readonly [number, number],
  progression: readonly HarmonySymbol[],
): NoteSeed[] => {
  const result = [...melody];
  const meter = meterGrid(signature);
  const measureBeats = meter.measureBeats;
  const measureCount = Math.ceil(durationBeats / measureBeats);
  const isTriple = !meter.compound && meter.pulsesPerMeasure === 3;

  for (let measure = 0; measure < measureCount; measure += 1) {
    const start = measure * measureBeats;
    const symbol = harmonyAtMeasure(progression, measure);
    const harmony = parseHarmony(symbol);
    const root = bassMidiFor(harmony.rootPitchClass);
    const fifth = bassMidiFor((harmony.rootPitchClass + 7) % 12);
    const voicing = rightVoicingFor(symbol, symbol.includes("7") ? 4 : 3);

    result.push(seed(root, start, Math.min(0.88, measureBeats * 0.42), "left", 80, "normal", true));
    result.push(seed(fifth, start + measureBeats / 2, Math.min(0.72, measureBeats * 0.32), "left", 74));

    const chordAttacks = meter.compound
      ? [0, meter.pulseBeats]
      : isTriple
      ? [meter.pulseBeats, meter.pulseBeats * 2]
      : [0, measureBeats / 2];
    for (const offset of chordAttacks) {
      const attack = start + offset;
      const remaining = durationBeats - attack;
      if (remaining <= EPSILON) continue;
      for (const midi of voicing) {
        result.push(
          seed(
            midi,
            attack,
            Math.min(
              meter.compound
                ? meter.pulseBeats * 0.72
                : isTriple
                  ? meter.pulseBeats * 0.68
                  : 1.18,
              remaining,
            ),
            "right",
            offset === 0 ? 88 : 82,
            "normal",
            offset === 0,
          ),
        );
      }
    }
  }
  return result;
};

const arrangePublicDomainTheme = (
  theme: PublicDomainTheme,
  courseRank: number,
): SongFamily => {
  const authoredRepeats = theme.repeats ?? 2;
  const melodyPass = melodySeedsFromSteps(
    theme.melody,
    authoredRepeats,
    theme.articulation ?? "normal",
  );
  const measureBeats = beatsPerMeasure(theme.timeSignature);
  const performancePassBeats = roundBeat(
    Math.ceil(melodyPass.durationBeats / measureBeats) * measureBeats,
  );
  const performancePasses = fullPlaythroughPasses(
    performancePassBeats,
    theme.bpm,
  );
  const performanceSectionLabels = Array.from(
    { length: performancePasses },
    (_, index) =>
      index === performancePasses - 1
        ? "Final Pass"
        : index === 0
          ? "Opening"
          : `Part ${index + 1}`,
  );
  const durationBeats = roundBeat(performancePassBeats * performancePasses);
  const easy = repeatArrangement(
    melodyPass.notes,
    performancePassBeats,
    performancePasses,
  );
  const medium = addMediumHarmony(easy, durationBeats, theme.timeSignature, theme.harmony);
  const hard = addHardHarmony(easy, durationBeats, theme.timeSignature, theme.harmony);

  return buildFamily(
    {
      familyId: theme.id,
      title: theme.title,
      subtitle: theme.subtitle,
      composer: theme.composer,
      bpm: theme.bpm,
      key: theme.key,
      timeSignature: theme.timeSignature,
      style: theme.style,
      origin: "public-domain",
      attribution: `Public-domain composition; original Keyboard Hero 25-key arrangement.`,
      durationBeats,
      performancePassBeats,
      performanceSectionLabels,
      courseRank,
      focus: theme.focus,
    },
    { easy, medium, hard },
  );
};

const melodyFromLegacy = (song: Song): NoteSeed[] => {
  const attacks = new Map<number, SongNote[]>();
  for (const note of song.notes) {
    const key = roundBeat(note.startBeat);
    const group = attacks.get(key) ?? [];
    group.push(note);
    attacks.set(key, group);
  }
  const ordered = [...attacks.entries()].sort(([a], [b]) => a - b);

  return ordered.map(([startBeat, group], index) => {
    const rightNotes = group.filter((note) => note.hand !== "left");
    const source = [...(rightNotes.length > 0 ? rightNotes : group)].sort(
      (a, b) => b.midi - a.midi,
    )[0];
    const nextBeat = ordered[index + 1]?.[0] ?? song.durationBeats;
    const available = Math.max(0.2, nextBeat - startBeat);
    return seed(
      source.midi,
      startBeat,
      Math.min(source.durationBeats, available * 0.88),
      "right",
      source.velocity ?? 94,
      source.articulation ?? "normal",
      source.accent ?? false,
    );
  });
};

const normalizedLegacyNotes = (song: Song): NoteSeed[] =>
  song.notes.map((note) => {
    const hand = note.hand === "left" ? "left" : "right";
    return {
      midi: note.midi,
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      velocity: note.velocity ?? 90,
      hand,
      finger: note.finger ?? fingerFor(note.midi, hand),
      accent: note.accent ?? false,
      articulation: note.articulation ?? "normal",
    };
  });

const LEGACY_HARMONY: Readonly<Record<string, readonly HarmonySymbol[]>> = {
  "first-five-launch": ["C", "F", "G7", "C"],
  "ode-to-joy": ["C", "G7", "C", "G7", "C", "F", "G7", "C"],
  "marys-two-hand-march": ["C", "G7", "C", "G7"],
  "frere-jacques-canon": ["C", "G7", "C", "G7"],
  "saints-syncopation-lab": ["C", "C", "F", "C", "G7", "F", "C", "G7"],
  "clockwork-minuet": ["C", "G7", "Am", "Em", "F", "C", "Dm", "G7"],
  "twelve-bar-neon-blues": ["C7", "C7", "C7", "C7", "F7", "F7", "C7", "C7", "G7", "F7", "C7", "G7"],
  "canon-chord-forge": ["C", "G", "Am", "Em", "F", "C", "F", "G"],
  "arpeggio-accelerator": ["Cmaj7", "Am7", "Fmaj7", "G7", "Dm7", "Em7", "Fmaj7", "G7"],
  "neon-skyline-finale": ["C", "Am", "F", "G"],
};

const LEGACY_PREFERRED_PASSES: Readonly<Record<string, number>> = {
  // The traditional song has four sung verses over the same complete melody.
  "marys-two-hand-march": 4,
};

const legacyPerformanceLabels = (songId: string, passes: number): string[] => {
  if (songId === "marys-two-hand-march") {
    return ["Verse 1", "Verse 2", "Verse 3", "Final Verse"];
  }
  return Array.from({ length: passes }, (_, index) =>
    index === passes - 1
      ? "Final Pass"
      : index === 0
        ? "Opening"
        : `Part ${index + 1}`,
  );
};

const arrangeLegacySong = (song: Song, courseRank: number): SongFamily => {
  const progression = LEGACY_HARMONY[song.id] ?? ["C", "F", "G7", "C"];
  const performancePasses = fullPlaythroughPasses(
    song.durationBeats,
    song.bpm,
    LEGACY_PREFERRED_PASSES[song.id],
  );
  const durationBeats = roundBeat(song.durationBeats * performancePasses);
  const performanceSectionLabels = legacyPerformanceLabels(song.id, performancePasses);
  const easy = repeatArrangement(
    melodyFromLegacy(song),
    song.durationBeats,
    performancePasses,
  );
  const original = repeatArrangement(
    normalizedLegacyNotes(song),
    song.durationBeats,
    performancePasses,
  );
  const medium = addMediumHarmony(original, durationBeats, song.timeSignature, progression);
  const hard = addHardHarmony(original, durationBeats, song.timeSignature, progression);

  return buildFamily(
    {
      familyId: song.id,
      title: song.title,
      subtitle: song.subtitle ?? "Keyboard Hero career arrangement",
      composer: song.composer,
      bpm: song.bpm,
      key: song.key,
      timeSignature: song.timeSignature,
      style: song.style,
      origin: song.origin,
      attribution: song.attribution,
      durationBeats,
      performancePassBeats: song.durationBeats,
      performanceSectionLabels,
      courseRank,
      focus: song.skills[0] ?? "musical control",
      sourceSections: song.sections,
    },
    { easy, medium, hard },
  );
};

const theme = (
  value: PublicDomainTheme,
): PublicDomainTheme => value;

const PUBLIC_DOMAIN_THEMES: readonly PublicDomainTheme[] = [
  theme({
    id: "hot-cross-buns",
    title: "Hot Cross Buns",
    subtitle: "Three notes, one confident hand",
    composer: "Traditional English",
    bpm: 76,
    key: "C major",
    timeSignature: [4, 4],
    style: "Nursery-song warm-up",
    focus: "descending three-note patterns",
    melody: [[64, 1], [62, 1], [60, 2], [64, 1], [62, 1], [60, 2], [60, 0.5], [60, 0.5], [60, 0.5], [60, 0.5], [62, 0.5], [62, 0.5], [62, 0.5], [62, 0.5], [64, 1], [62, 1], [60, 2]],
    harmony: ["C", "C", "F", "G7", "C"],
    repeats: 2,
  }),
  theme({
    id: "au-clair-de-la-lune",
    title: "Au Clair de la Lune",
    subtitle: "Repeated notes under moonlight",
    composer: "Traditional French",
    bpm: 80,
    key: "C major",
    timeSignature: [4, 4],
    style: "French folk song",
    focus: "repeated-note control and phrase endings",
    melody: [[60, 1], [60, 1], [60, 1], [62, 1], [64, 2], [62, 2], [60, 1], [64, 1], [62, 1], [62, 1], [60, 4]],
    harmony: ["C", "G7", "C", "G7", "C"],
    repeats: 2,
  }),
  theme({
    id: "twinkle-little-star",
    title: "Twinkle, Twinkle, Little Star",
    subtitle: "A first leap across the five-finger sky",
    composer: "Traditional French melody",
    bpm: 84,
    key: "C major",
    timeSignature: [4, 4],
    style: "Folk lullaby",
    focus: "fifths, repeated notes, and balanced phrases",
    melody: [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2], [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2]],
    harmony: ["C", "F", "C", "G7", "C", "G7"],
    repeats: 1,
  }),
  theme({
    id: "lightly-row",
    title: "Lightly Row",
    subtitle: "Smooth skips and gentle repetitions",
    composer: "Traditional German",
    bpm: 88,
    key: "C major",
    timeSignature: [4, 4],
    style: "Folk-song study",
    focus: "thirds and repeated-note phrasing",
    melody: [[67, 1], [64, 1], [64, 2], [65, 1], [62, 1], [62, 2], [60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [67, 1], [67, 2], [67, 1], [64, 1], [64, 2], [65, 1], [62, 1], [62, 2], [60, 1], [64, 1], [67, 1], [67, 1], [60, 4]],
    harmony: ["C", "G7", "C", "G7", "C"],
    repeats: 1,
  }),
  theme({
    id: "london-bridge",
    title: "London Bridge",
    subtitle: "Meet B-flat in a compact F-major position",
    composer: "Traditional English",
    bpm: 92,
    key: "F major",
    timeSignature: [4, 4],
    style: "English folk song",
    focus: "black-key awareness and measured rests",
    melody: [[67, 1], [69, 1], [67, 0.5], [65, 0.5], [64, 1], [65, 1], [67, 2], [62, 1], [64, 1], [65, 2], [64, 1], [65, 1], [67, 2], [67, 1], [69, 1], [67, 0.5], [65, 0.5], [64, 1], [65, 1], [67, 2], [62, 2], [67, 2], [64, 1], [60, 3]],
    harmony: ["C", "F", "C", "G7", "C", "F", "G7", "C"],
    repeats: 1,
  }),
  theme({
    id: "row-row-row-your-boat",
    title: "Row, Row, Row Your Boat",
    subtitle: "A lilting first voyage in 6/8",
    composer: "Traditional American",
    bpm: 90,
    key: "C major",
    timeSignature: [6, 8],
    style: "Round / folk song",
    focus: "compound meter and quick repeated notes",
    melody: [[60, 1.5], [60, 1.5], [60, 1], [62, 0.5], [64, 1.5], [64, 1], [62, 0.5], [64, 1], [65, 0.5], [67, 3], [72, 0.5], [72, 0.5], [72, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [64, 0.5], [64, 0.5], [64, 0.5], [60, 0.5], [60, 0.5], [60, 0.5], [67, 1], [65, 0.5], [64, 1], [62, 0.5], [60, 3]],
    harmony: ["C", "C", "G7", "C", "F", "C", "G7", "C"],
    repeats: 1,
  }),
  theme({
    id: "amazing-grace",
    title: "Amazing Grace",
    subtitle: "A singing melody with a gentle pickup",
    composer: "Traditional; tune New Britain",
    bpm: 82,
    key: "F major",
    timeSignature: [3, 4],
    style: "Hymn",
    focus: "pickups, dotted rhythm, and legato tone",
    melody: [[60, 1], [65, 2], [69, 1], [65, 0.5], [69, 0.5], [67, 2], [65, 1], [62, 2], [60, 1], [60, 2], [65, 1], [69, 2], [65, 1], [69, 0.5], [72, 0.5], [69, 2], [65, 1], [67, 2], [69, 1], [65, 3]],
    harmony: ["F", "F", "Bb", "F", "Dm", "C7", "F", "C7", "F"],
    repeats: 1,
    articulation: "legato",
  }),
  theme({
    id: "simple-gifts",
    title: "Simple Gifts",
    subtitle: "A bright Shaker dance tune",
    composer: "Joseph Brackett",
    bpm: 96,
    key: "G major",
    timeSignature: [4, 4],
    style: "Shaker folk dance",
    focus: "position shifts and a first F-sharp",
    melody: [[62, 0.5], [67, 1], [67, 0.5], [69, 1], [71, 1], [72, 2], [71, 1], [69, 1], [67, 1], [64, 1], [62, 2], [67, 1], [67, 1], [69, 1], [71, 1], [72, 1], [71, 1], [69, 1], [67, 1], [66, 1], [64, 1], [62, 2]],
    harmony: ["G", "C", "G", "D7", "G", "Em", "D7", "G"],
    repeats: 1,
  }),
  theme({
    id: "yankee-doodle",
    title: "Yankee Doodle",
    subtitle: "Quick steps and a crisp march pulse",
    composer: "Traditional American",
    bpm: 104,
    key: "C major",
    timeSignature: [2, 4],
    style: "March",
    focus: "eighth-note clarity and repeated pitches",
    melody: [[60, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [62, 1], [60, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 1], [71, 1], [60, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [71, 0.5], [67, 0.5], [69, 0.5], [71, 0.5], [60, 1], [60, 1]],
    harmony: ["C", "G7", "C", "G7", "C", "F", "G7", "C"],
    repeats: 2,
    articulation: "staccato",
  }),
  theme({
    id: "jingle-bells",
    title: "Jingle Bells",
    subtitle: "Repeated notes at sleigh-ride speed",
    composer: "James Lord Pierpont",
    bpm: 108,
    key: "C major",
    timeSignature: [4, 4],
    style: "Holiday song",
    focus: "fast repeated notes and syncopated phrase endings",
    melody: [[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4], [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [64, 1], [62, 1], [62, 1], [64, 1], [62, 2], [67, 2]],
    harmony: ["C", "C", "C", "F", "C", "G7", "G7", "C"],
    repeats: 1,
  }),
  theme({
    id: "auld-lang-syne",
    title: "Auld Lang Syne",
    subtitle: "Broad phrases and familiar goodbyes",
    composer: "Traditional Scottish",
    bpm: 88,
    key: "F major",
    timeSignature: [4, 4],
    style: "Scottish folk song",
    focus: "pickups, dotted rhythms, and longer leaps",
    melody: [[60, 1], [65, 1.5], [65, 0.5], [69, 1], [67, 1.5], [65, 0.5], [69, 1], [70, 1.5], [69, 0.5], [67, 1], [65, 1.5], [67, 0.5], [69, 1], [65, 1], [62, 1], [60, 2], [60, 1], [65, 1.5], [65, 0.5], [69, 1], [67, 1.5], [65, 0.5], [72, 2], [69, 1], [67, 1], [65, 2]],
    harmony: ["F", "C7", "F", "Bb", "F", "Dm", "Gm", "C7", "F"],
    repeats: 1,
    articulation: "legato",
  }),
  theme({
    id: "sakura-sakura",
    title: "Sakura Sakura",
    subtitle: "Measured silence in a Japanese mode",
    composer: "Traditional Japanese",
    bpm: 84,
    key: "D minor / Japanese mode",
    timeSignature: [4, 4],
    style: "Japanese folk song",
    focus: "modal black-key shapes, rests, and tone control",
    melody: [[69, 1], [69, 1], [70, 2], [69, 1], [69, 1], [70, 2], [69, 1], [70, 1], [72, 1], [70, 1], [69, 1], [70, 0.5], [69, 0.5], [65, 2], [64, 1], [60, 1], [64, 1], [65, 1], [64, 1], [64, 0.5], [60, 0.5], [59, 2]],
    harmony: ["Dm", "Dm", "Bb", "A7", "Dm", "Gm", "A7", "Dm"],
    repeats: 2,
  }),
  theme({
    id: "scarborough-fair",
    title: "Scarborough Fair",
    subtitle: "A modal melody over a quiet drone",
    composer: "Traditional English",
    bpm: 86,
    key: "D Dorian",
    timeSignature: [3, 4],
    style: "English ballad",
    focus: "modal phrasing, ties, and wider skips",
    melody: [[62, 1], [62, 1], [69, 2], [69, 1], [64, 1], [65, 1], [64, 2], [62, 1], [60, 1], [62, 1], [60, 1], [57, 2], [62, 1], [69, 1], [72, 1], [69, 2], [67, 1], [65, 1], [64, 1], [62, 3]],
    harmony: ["Dm", "C", "Dm", "C", "G", "Dm", "C", "Dm"],
    repeats: 2,
    articulation: "legato",
  }),
  theme({
    id: "greensleeves",
    title: "Greensleeves",
    subtitle: "A flowing minor dance in 6/8",
    composer: "Traditional English",
    bpm: 96,
    key: "A minor",
    timeSignature: [6, 8],
    style: "Renaissance ballad",
    focus: "dotted rhythm, compound meter, and position changes",
    melody: [[57, 0.5], [60, 1], [62, 0.5], [64, 1.5], [65, 0.5], [64, 1], [62, 0.5], [59, 1.5], [55, 0.5], [57, 1], [59, 0.5], [60, 1.5], [59, 0.5], [57, 1], [56, 0.5], [57, 2.5], [69, 0.5], [69, 1], [68, 0.5], [69, 1.5], [71, 0.5], [69, 1], [64, 0.5], [62, 1.5], [59, 0.5], [60, 1], [62, 0.5], [64, 1.5], [62, 0.5], [60, 1], [59, 0.5], [57, 2.5]],
    harmony: ["Am", "G", "Em", "Am", "C", "G", "Em", "Am"],
    repeats: 1,
    articulation: "legato",
  }),
  theme({
    id: "drunken-sailor",
    title: "Drunken Sailor",
    subtitle: "A hard-driving minor sea shanty",
    composer: "Traditional sea shanty",
    bpm: 112,
    key: "D minor",
    timeSignature: [6, 8],
    style: "Sea shanty",
    focus: "fast 6/8 pulse, accents, and repeated notes",
    melody: [[69, 0.5], [69, 0.5], [69, 0.5], [69, 0.5], [69, 0.5], [69, 0.5], [69, 0.5], [65, 0.5], [62, 1], [67, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [64, 0.5], [60, 1], [69, 0.5], [69, 0.5], [69, 0.5], [69, 0.5], [70, 0.5], [72, 0.5], [70, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 1]],
    harmony: ["Dm", "Dm", "C", "Dm", "Gm", "Dm", "A7", "Dm"],
    repeats: 2,
    articulation: "staccato",
  }),
  theme({
    id: "minuet-in-g",
    title: "Minuet in G",
    subtitle: "Courtly counterpoint in a 25-key frame",
    composer: "Christian Petzold",
    bpm: 100,
    key: "C major (transposed)",
    timeSignature: [3, 4],
    style: "Baroque minuet",
    focus: "ornaments, elegant three-beat phrasing, and counterpoint",
    melody: [[67, 1], [60, 0.5], [62, 0.5], [64, 0.5], [65, 0.5], [67, 1], [60, 1], [60, 1], [69, 1], [65, 0.5], [67, 0.5], [69, 0.5], [71, 0.5], [72, 1], [60, 1], [60, 1], [65, 1], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [64, 1], [65, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [71, 1], [67, 1], [69, 1], [71, 1], [72, 3]],
    harmony: ["C", "G7", "C", "F", "C", "G7", "C", "Am", "Dm", "G7", "C"],
    repeats: 1,
  }),
  theme({
    id: "brahms-lullaby",
    title: "Brahms' Lullaby",
    subtitle: "Suspensions beneath a singing line",
    composer: "Johannes Brahms",
    bpm: 92,
    key: "F major",
    timeSignature: [3, 4],
    style: "Romantic lullaby",
    focus: "ties, syncopation, and melody voicing",
    melody: [[60, 0.5], [60, 0.5], [64, 1.5], [60, 0.5], [60, 1], [64, 2], [60, 0.5], [64, 0.5], [67, 1], [65, 1], [65, 1], [64, 1], [62, 1], [62, 1], [60, 1], [62, 1], [65, 2], [60, 0.5], [62, 0.5], [64, 1], [65, 1], [67, 3]],
    harmony: ["F", "C7", "F", "Bb", "F", "C7", "F", "Dm", "Gm", "C7", "F"],
    repeats: 2,
    articulation: "legato",
  }),
  theme({
    id: "prelude-in-c-major",
    title: "Prelude in C Major",
    subtitle: "Bach's harmony, unfolded one shape at a time",
    composer: "Johann Sebastian Bach",
    bpm: 104,
    key: "C major",
    timeSignature: [4, 4],
    style: "Baroque prelude",
    focus: "harmonic sequencing and continuous arpeggio flow",
    melody: [[64, 0.5], [67, 0.5], [72, 0.5], [67, 0.5], [64, 0.5], [67, 0.5], [72, 0.5], [67, 0.5], [64, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [64, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [65, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [65, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [62, 0.5], [67, 0.5], [71, 0.5], [67, 0.5], [62, 0.5], [67, 0.5], [71, 0.5], [67, 0.5]],
    harmony: ["Cmaj7", "Am7", "Fmaj7", "G7"],
    repeats: 2,
    articulation: "legato",
  }),
  theme({
    id: "swan-lake-theme",
    title: "Swan Lake Theme",
    subtitle: "A dramatic minor melody over dark water",
    composer: "Pyotr Ilyich Tchaikovsky",
    bpm: 98,
    key: "A minor (adapted)",
    timeSignature: [4, 4],
    style: "Romantic ballet",
    focus: "chromatic expression, long notes, and orchestral voicing",
    melody: [[64, 1], [69, 1], [71, 1], [72, 2], [71, 1], [69, 1], [68, 1], [69, 2], [64, 1], [65, 1], [67, 1], [69, 2], [67, 1], [65, 1], [64, 1], [63, 1], [64, 3]],
    harmony: ["Am", "E7", "Am", "Dm", "Am", "F", "E7", "Am"],
    repeats: 2,
    articulation: "legato",
  }),
  theme({
    id: "can-can",
    title: "Can-Can",
    subtitle: "Offenbach's high-speed dance",
    composer: "Jacques Offenbach",
    bpm: 120,
    key: "C major (transposed)",
    timeSignature: [2, 4],
    style: "Galop",
    focus: "rapid repetitions, accents, and compact stride",
    melody: [[67, 0.5], [67, 0.5], [67, 0.5], [69, 0.5], [71, 0.5], [71, 0.5], [69, 0.5], [67, 0.5], [72, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [67, 1], [67, 1], [69, 0.5], [69, 0.5], [69, 0.5], [71, 0.5], [72, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [60, 2]],
    harmony: ["C", "G7", "C", "F", "C", "G7", "C"],
    repeats: 2,
    articulation: "staccato",
  }),
  theme({
    id: "fur-elise",
    title: "Für Elise",
    subtitle: "Beethoven's famous turning figure",
    composer: "Ludwig van Beethoven",
    bpm: 108,
    key: "A minor",
    timeSignature: [3, 8],
    style: "Classical bagatelle",
    focus: "chromatic turns, hand shifts, and broken-chord balance",
    melody: [[64, 0.5], [63, 0.5], [64, 0.5], [63, 0.5], [64, 0.5], [59, 0.5], [62, 0.5], [60, 0.5], [57, 1], [48, 0.5], [52, 0.5], [57, 0.5], [59, 1], [52, 0.5], [56, 0.5], [59, 0.5], [60, 1], [52, 0.5], [64, 0.5], [63, 0.5], [64, 0.5], [63, 0.5], [64, 0.5], [59, 0.5], [62, 0.5], [60, 0.5], [57, 1.5]],
    harmony: ["Am", "E7", "Am", "C", "G7", "C", "E7", "Am"],
    repeats: 2,
    articulation: "legato",
  }),
  theme({
    id: "rondo-alla-turca",
    title: "Rondo Alla Turca",
    subtitle: "Mozart's percussive Turkish march",
    composer: "Wolfgang Amadeus Mozart",
    bpm: 116,
    key: "A minor",
    timeSignature: [2, 4],
    style: "Classical march",
    focus: "grace-note shapes, rapid turns, and repeated chords",
    melody: [[59, 0.5], [57, 0.5], [56, 0.5], [57, 0.5], [60, 1], [62, 1], [59, 0.5], [57, 0.5], [56, 0.5], [57, 0.5], [64, 1], [65, 1], [64, 0.5], [62, 0.5], [60, 0.5], [59, 0.5], [57, 0.5], [59, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [59, 0.5], [57, 2]],
    harmony: ["Am", "E7", "Am", "C", "G7", "C", "E7", "Am"],
    repeats: 2,
    articulation: "staccato",
  }),
  theme({
    id: "the-entertainer",
    title: "The Entertainer",
    subtitle: "Joplin syncopation in miniature",
    composer: "Scott Joplin",
    bpm: 112,
    key: "C major (adapted)",
    timeSignature: [2, 4],
    style: "Ragtime",
    focus: "syncopation, chromatic passing tones, and stride coordination",
    melody: [[59, 0.25], [60, 0.25], [64, 0.5], [60, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [65, 0.25], [66, 0.25], [67, 0.5], [69, 0.5], [67, 0.5], [64, 0.5], [65, 0.5], [67, 0.5], [64, 0.5], [60, 0.5], [62, 0.25], [63, 0.25], [64, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [67, 1], [64, 1], [60, 2]],
    harmony: ["C", "C7", "F", "F#dim", "C", "A7", "D7", "G7", "C"],
    repeats: 2,
    articulation: "staccato",
  }),
  theme({
    id: "in-the-hall-of-the-mountain-king",
    title: "In the Hall of the Mountain King",
    subtitle: "A relentless crescendo toward the throne",
    composer: "Edvard Grieg",
    bpm: 120,
    key: "A minor (adapted)",
    timeSignature: [4, 4],
    style: "Orchestral crescendo",
    focus: "staccato control, repeated patterns, and rising density",
    melody: [[57, 0.5], [59, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [64, 1], [63, 0.5], [59, 0.5], [63, 1], [62, 0.5], [58, 0.5], [62, 1], [57, 0.5], [59, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [69, 0.5], [67, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [67, 0.5], [72, 1]],
    harmony: ["Am", "E7", "Am", "Dm", "Am", "F", "E7", "Am"],
    repeats: 3,
    articulation: "staccato",
  }),
  theme({
    id: "flight-of-the-bumblebee",
    title: "Flight of the Bumblebee",
    subtitle: "Chromatic motion at full concert intensity",
    composer: "Nikolai Rimsky-Korsakov",
    bpm: 132,
    key: "A minor (adapted)",
    timeSignature: [4, 4],
    style: "Virtuoso orchestral étude",
    focus: "chromatic sixteenths, hand transfers, and endurance",
    melody: [[69, 0.25], [68, 0.25], [67, 0.25], [66, 0.25], [65, 0.25], [64, 0.25], [63, 0.25], [62, 0.25], [61, 0.25], [60, 0.25], [61, 0.25], [62, 0.25], [63, 0.25], [64, 0.25], [65, 0.25], [66, 0.25], [67, 0.25], [66, 0.25], [65, 0.25], [64, 0.25], [63, 0.25], [62, 0.25], [61, 0.25], [60, 0.25], [59, 0.25], [58, 0.25], [57, 0.25], [58, 0.25], [59, 0.25], [60, 0.25], [61, 0.25], [62, 0.25], [63, 0.25], [64, 0.25], [65, 0.25], [66, 0.25], [67, 0.25], [68, 0.25], [69, 0.25], [70, 0.25], [71, 0.25], [72, 0.25], [71, 0.25], [70, 0.25], [69, 0.25], [68, 0.25], [67, 0.25], [66, 0.25]],
    harmony: ["Am", "E7", "Am", "Dm", "F", "E7", "Am"],
    repeats: 4,
    articulation: "legato",
  }),
] as const;

const LEGACY_BY_ID = new Map(SONGS.map((song) => [song.id, song]));
const THEME_BY_ID = new Map(PUBLIC_DOMAIN_THEMES.map((entry) => [entry.id, entry]));

const CAREER_ORDER = [
  "first-five-launch",
  "hot-cross-buns",
  "au-clair-de-la-lune",
  "ode-to-joy",
  "twinkle-little-star",
  "lightly-row",
  "marys-two-hand-march",
  "london-bridge",
  "row-row-row-your-boat",
  "amazing-grace",
  "simple-gifts",
  "yankee-doodle",
  "jingle-bells",
  "auld-lang-syne",
  "frere-jacques-canon",
  "sakura-sakura",
  "scarborough-fair",
  "saints-syncopation-lab",
  "greensleeves",
  "clockwork-minuet",
  "drunken-sailor",
  "minuet-in-g",
  "brahms-lullaby",
  "twelve-bar-neon-blues",
  "prelude-in-c-major",
  "canon-chord-forge",
  "swan-lake-theme",
  "can-can",
  "fur-elise",
  "rondo-alla-turca",
  "the-entertainer",
  "arpeggio-accelerator",
  "in-the-hall-of-the-mountain-king",
  "flight-of-the-bumblebee",
  "neon-skyline-finale",
] as const;

/** The 35-song, five-venue career path in its canonical unlock order. */
export const SONG_FAMILIES: readonly SongFamily[] = CAREER_ORDER.map(
  (id, index) => {
    const courseRank = index + 1;
    const legacy = LEGACY_BY_ID.get(id);
    if (legacy) return arrangeLegacySong(legacy, courseRank);

    const publicDomainTheme = THEME_BY_ID.get(id);
    if (publicDomainTheme) return arrangePublicDomainTheme(publicDomainTheme, courseRank);

    throw new Error(`Career order references an unknown song family: ${id}`);
  },
);

const FAMILY_BY_ID = new Map<string, SongFamily>();
for (const family of SONG_FAMILIES) {
  FAMILY_BY_ID.set(family.id, family);
  for (const challenge of CHALLENGE_LEVELS) {
    FAMILY_BY_ID.set(family.charts[challenge].id, family);
  }
}

/** Looks up either a family id or any playable chart id. */
export function getSongFamilyById(id: string): SongFamily | undefined {
  return FAMILY_BY_ID.get(id);
}

/** Resolves a family (or family/chart id) to one directly playable `Song`. */
export function getSongChart(
  familyOrId: SongFamily,
  challenge: ChallengeLevel,
): SongChart;
export function getSongChart(
  familyOrId: string,
  challenge: ChallengeLevel,
): SongChart | undefined;
export function getSongChart(
  familyOrId: SongFamily | string,
  challenge: ChallengeLevel,
): SongChart | undefined {
  const family =
    typeof familyOrId === "string" ? getSongFamilyById(familyOrId) : familyOrId;
  return family?.charts[challenge];
}

/** Flat list useful to transports, routing, tests, and chart-id lookup. */
export const ALL_SONG_CHARTS: readonly SongChart[] = SONG_FAMILIES.flatMap(
  (family) => CHALLENGE_LEVELS.map((challenge) => family.charts[challenge]),
);
