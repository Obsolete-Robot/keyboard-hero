/**
 * Keyboard Hero curriculum.
 *
 * Timing is expressed in quarter-note beats. That keeps the score independent
 * of playback speed: at 120 BPM, one beat is 0.5 seconds at 100% speed.
 * Scientific pitch notation is used throughout (MIDI 60 === C4).
 */

export const MIDI_MIN = 48 as const;
export const MIDI_MAX = 72 as const;
export const KEY_COUNT = 25 as const;

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type Finger = 1 | 2 | 3 | 4 | 5;
export type Hand = "left" | "right" | "both";
export type SongOrigin = "original" | "public-domain";
export type Articulation = "legato" | "normal" | "staccato";

export type AccompanimentDrumKit =
  | "none"
  | "brushes"
  | "folk"
  | "march"
  | "orchestral"
  | "rock"
  | "studio"
  | "electronic";
export type AccompanimentBassVoice =
  | "none"
  | "round"
  | "upright"
  | "pluck"
  | "tuba"
  | "cello"
  | "synth";
export type AccompanimentHarmonyVoice =
  | "none"
  | "piano"
  | "organ"
  | "strings"
  | "brass"
  | "bell"
  | "harpsichord"
  | "synth";
export type AccompanimentBassTone =
  | "root"
  | "fifth"
  | "octave"
  | "approach";

export interface AccompanimentBassStep {
  /** Position from 0 (measure start) to less than 1 (next measure). */
  at: number;
  tone: AccompanimentBassTone;
  /** Length as a fraction of the current measure. */
  duration: number;
  velocity: number;
}

export interface AccompanimentHarmonyStep {
  /** Position from 0 (measure start) to less than 1 (next measure). */
  at: number;
  /** Length as a fraction of the current measure. */
  duration: number;
  velocity: number;
}

/** Authored backing-band identity and measure pattern for one song family. */
export interface SongAccompaniment {
  /** Stable family-level identity; all difficulty charts share it. */
  arrangementId: string;
  /** User-facing band arrangement name. */
  name: string;
  /** One chord symbol per measure, repeated with the performance form. */
  progression: readonly string[];
  drumKit: AccompanimentDrumKit;
  bassVoice: AccompanimentBassVoice;
  harmonyVoice: AccompanimentHarmonyVoice;
  /** Drum positions are normalized measure offsets from 0 through < 1. */
  kick: readonly number[];
  snare: readonly number[];
  hats: readonly number[];
  openHat?: readonly number[];
  bass: readonly AccompanimentBassStep[];
  harmony: readonly AccompanimentHarmonyStep[];
  /** Rotates compact chord inversions without changing the harmony. */
  voicingOffset?: number;
}

export interface SongNote {
  /** Stable identifier, suitable for React keys and score tracking. */
  id: string;
  /** MIDI note number. Every curriculum note is within MIDI 48-72. */
  midi: number;
  /** Start position in quarter-note beats from the beginning of the song. */
  startBeat: number;
  /** Held length in quarter-note beats. */
  durationBeats: number;
  /** MIDI-style target velocity (1-127). */
  velocity?: number;
  hand?: Hand;
  /** Piano fingering: thumb = 1, little finger = 5 for either hand. */
  finger?: Finger;
  accent?: boolean;
  articulation?: Articulation;
}

export interface SongSection {
  id: string;
  label: string;
  /** Inclusive loop start in quarter-note beats. */
  startBeat: number;
  /** Exclusive loop end in quarter-note beats. */
  endBeat: number;
  focus?: string;
  recommendedTempoPercent?: number;
  repeatCount?: number;
}

export interface MasteryTarget {
  accuracyPercent: number;
  timingWindowMs: number;
  minimumTempoPercent: number;
  cleanRuns: number;
}

export interface SongPedagogy {
  handPosition: string;
  learningGoals: string[];
  coachTips: string[];
  mastery: MasteryTarget;
}

export interface OctaveShiftHint {
  /** Lowest MIDI note the controller should currently transmit. */
  expectedLowestMidi: typeof MIDI_MIN;
  /** Highest MIDI note the controller should currently transmit. */
  expectedHighestMidi: typeof MIDI_MAX;
  message: string;
}

export interface Song {
  id: string;
  title: string;
  subtitle?: string;
  composer: string;
  bpm: number;
  difficulty: Difficulty;
  level: string;
  skills: string[];
  description: string;
  durationBeats: number;
  notes: SongNote[];
  sections: SongSection[];

  /** Additional display and teaching metadata. */
  key: string;
  timeSignature: readonly [beatsPerMeasure: number, beatUnit: number];
  style: string;
  /** Optional for drills; every career chart receives an authored arrangement. */
  accompaniment?: SongAccompaniment;
  origin: SongOrigin;
  attribution: string;
  countInBeats: number;
  recommendedTempo: {
    minPercent: number;
    maxPercent: number;
    stepPercent: number;
  };
  pedagogy: SongPedagogy;
  octaveShiftHint: OctaveShiftHint;
}

export const AKAI_MPK_MINI_IV_SETUP: OctaveShiftHint & {
  keyCount: typeof KEY_COUNT;
  lowestNote: "C3";
  highestNote: "C5";
} = {
  keyCount: KEY_COUNT,
  expectedLowestMidi: MIDI_MIN,
  expectedHighestMidi: MIDI_MAX,
  lowestNote: "C3",
  highestNote: "C5",
  message:
    "Use OCTAVE DOWN/UP until the leftmost key sends C3 (MIDI 48) and the rightmost sends C5 (MIDI 72).",
};

type NoteSeed = Omit<SongNote, "id">;
type Step = readonly [
  midi: number | null,
  durationBeats: number,
  finger?: Finger,
  accent?: boolean,
];
type SongDraft = Omit<Song, "notes" | "octaveShiftHint"> & {
  notes: NoteSeed[];
  octaveShiftHint?: OctaveShiftHint;
};

const tone = (
  midi: number,
  startBeat: number,
  durationBeats: number,
  hand: Hand,
  finger: Finger,
  velocity = 92,
  accent = false,
  articulation: Articulation = "normal",
): NoteSeed => ({
  midi,
  startBeat,
  durationBeats,
  velocity,
  hand,
  finger,
  accent,
  articulation,
});

/** Turn a monophonic sequence (including rests represented by null) into notes. */
const phrase = (
  startBeat: number,
  hand: Hand,
  steps: readonly Step[],
  velocity = 94,
  articulation: Articulation = "normal",
): NoteSeed[] => {
  let cursor = startBeat;
  const result: NoteSeed[] = [];

  for (const [midi, durationBeats, finger = 1, accent = false] of steps) {
    if (midi !== null) {
      result.push(
        tone(
          midi,
          cursor,
          durationBeats,
          hand,
          finger,
          accent ? Math.min(127, velocity + 10) : velocity,
          accent,
          articulation,
        ),
      );
    }
    cursor += durationBeats;
  }

  return result;
};

const chord = (
  startBeat: number,
  durationBeats: number,
  hand: Hand,
  midis: readonly number[],
  fingers: readonly Finger[],
  velocity = 88,
  accent = false,
): NoteSeed[] =>
  midis.map((midi, index) =>
    tone(
      midi,
      startBeat,
      durationBeats,
      hand,
      fingers[index] ?? 1,
      velocity,
      accent,
    ),
  );

const shifted = (
  notes: readonly NoteSeed[],
  beatOffset: number,
  semitones = 0,
  hand?: Hand,
  mirrorFingering = false,
): NoteSeed[] =>
  notes.map((note) => ({
    ...note,
    midi: note.midi + semitones,
    startBeat: note.startBeat + beatOffset,
    hand: hand ?? note.hand,
    finger:
      mirrorFingering && note.finger
        ? ((6 - note.finger) as Finger)
        : note.finger,
  }));

const makeSong = (draft: SongDraft): Song => {
  const notes = [...draft.notes]
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    .map((note, index) => ({
      ...note,
      id: `${draft.id}-note-${String(index + 1).padStart(3, "0")}`,
    }));

  const song: Song = {
    ...draft,
    notes,
    octaveShiftHint: draft.octaveShiftHint ?? AKAI_MPK_MINI_IV_SETUP,
  };

  const issues = validateSong(song);
  if (issues.length > 0) {
    throw new Error(`Invalid curriculum song "${song.id}": ${issues.join("; ")}`);
  }

  return song;
};

const beginnerMastery: MasteryTarget = {
  accuracyPercent: 85,
  timingWindowMs: 180,
  minimumTempoPercent: 70,
  cleanRuns: 2,
};

const intermediateMastery: MasteryTarget = {
  accuracyPercent: 90,
  timingWindowMs: 135,
  minimumTempoPercent: 80,
  cleanRuns: 2,
};

const advancedMastery: MasteryTarget = {
  accuracyPercent: 93,
  timingWindowMs: 95,
  minimumTempoPercent: 90,
  cleanRuns: 3,
};

const firstFiveNotes: NoteSeed[] = [
  ...phrase(0, "right", [
    [60, 1, 1, true],
    [62, 1, 2],
    [64, 1, 3],
    [65, 1, 4],
    [67, 1, 5, true],
    [65, 1, 4],
    [64, 1, 3],
    [62, 1, 2],
  ]),
  ...phrase(8, "right", [
    [60, 1, 1, true],
    [62, 1, 2],
    [64, 1, 3],
    [67, 1, 5, true],
    [64, 1, 3],
    [62, 1, 2],
    [60, 2, 1, true],
  ]),
  ...phrase(16, "right", [
    [60, 1, 1, true],
    [62, 1, 2],
    [64, 1, 3],
    [65, 1, 4],
    [67, 1, 5, true],
    [64, 1, 3],
    [62, 1, 2],
    [60, 1, 1, true],
  ]),
];

const odeToJoyNotes: NoteSeed[] = [
  ...phrase(0, "right", [
    [64, 1, 3, true],
    [64, 1, 3],
    [65, 1, 4],
    [67, 1, 5],
    [67, 1, 5, true],
    [65, 1, 4],
    [64, 1, 3],
    [62, 1, 2],
  ]),
  ...phrase(8, "right", [
    [60, 1, 1, true],
    [60, 1, 1],
    [62, 1, 2],
    [64, 1, 3],
    [64, 1.5, 3, true],
    [62, 0.5, 2],
    [62, 2, 2],
  ]),
  ...phrase(16, "right", [
    [64, 1, 3, true],
    [64, 1, 3],
    [65, 1, 4],
    [67, 1, 5],
    [67, 1, 5, true],
    [65, 1, 4],
    [64, 1, 3],
    [62, 1, 2],
  ]),
  ...phrase(24, "right", [
    [60, 1, 1, true],
    [60, 1, 1],
    [62, 1, 2],
    [64, 1, 3],
    [62, 1.5, 2, true],
    [60, 0.5, 1],
    [60, 2, 1],
  ]),
];

const maryMelody: NoteSeed[] = [
  ...phrase(0, "right", [
    [64, 1, 3, true],
    [62, 1, 2],
    [60, 1, 1],
    [62, 1, 2],
    [64, 1, 3, true],
    [64, 1, 3],
    [64, 2, 3],
  ]),
  ...phrase(8, "right", [
    [62, 1, 2, true],
    [62, 1, 2],
    [62, 2, 2],
    [64, 1, 3, true],
    [67, 1, 5],
    [67, 2, 5],
  ]),
  ...phrase(16, "right", [
    [64, 1, 3, true],
    [62, 1, 2],
    [60, 1, 1],
    [62, 1, 2],
    [64, 1, 3, true],
    [64, 1, 3],
    [64, 2, 3],
  ]),
  ...phrase(24, "right", [
    [62, 1, 2, true],
    [62, 1, 2],
    [64, 1, 3],
    [62, 1, 2],
    [60, 4, 1, true],
  ]),
];

const maryBass: NoteSeed[] = [
  tone(48, 16, 3.5, "left", 5, 80, true),
  tone(55, 20, 3.5, "left", 1, 78),
  tone(55, 24, 3.5, "left", 1, 80, true),
  tone(48, 28, 3.5, "left", 5, 82, true),
];

const frereRight: NoteSeed[] = [
  ...phrase(0, "right", [
    [60, 1, 1, true],
    [62, 1, 2],
    [64, 1, 3],
    [60, 1, 1],
    [60, 1, 1, true],
    [62, 1, 2],
    [64, 1, 3],
    [60, 1, 1],
  ]),
  ...phrase(8, "right", [
    [64, 1, 3, true],
    [65, 1, 4],
    [67, 2, 5],
    [64, 1, 3, true],
    [65, 1, 4],
    [67, 2, 5],
  ]),
  ...phrase(16, "right", [
    [67, 0.5, 5, true],
    [69, 0.5, 5],
    [67, 0.5, 4],
    [65, 0.5, 3],
    [64, 1, 2],
    [60, 1, 1],
    [67, 0.5, 5, true],
    [69, 0.5, 5],
    [67, 0.5, 4],
    [65, 0.5, 3],
    [64, 1, 2],
    [60, 1, 1],
  ]),
  ...phrase(24, "right", [
    [72, 1, 5, true],
    [67, 1, 1],
    [72, 2, 5],
    [72, 1, 5, true],
    [67, 1, 1],
    [72, 2, 5],
  ]),
];

const saintsMelody: NoteSeed[] = [
  ...phrase(0, "right", [
    [null, 0.5],
    [60, 0.5, 1, true],
    [64, 1, 3],
    [65, 1, 4],
    [67, 2, 5, true],
    [null, 1],
    [60, 1, 1],
    [67, 1, 5],
  ]),
  ...phrase(8, "right", [
    [null, 0.5],
    [60, 0.5, 1, true],
    [64, 1, 3],
    [65, 1, 4],
    [67, 1, 5, true],
    [64, 1, 3],
    [60, 1, 1],
    [64, 2, 3],
  ]),
  ...phrase(16, "right", [
    [null, 0.5],
    [64, 0.5, 3, true],
    [64, 1, 3],
    [62, 1, 2],
    [60, 1, 1],
    [62, 2, 2, true],
    [65, 2, 4],
  ]),
  ...phrase(24, "right", [
    [64, 1, 3, true],
    [65, 1, 4],
    [67, 1, 5],
    [64, 1, 3],
    [60, 1, 1],
    [62, 1, 2],
    [60, 2, 1, true],
  ]),
];

const saintsBassProgression: readonly (readonly [number, number])[] = [
  [48, 55],
  [48, 55],
  [53, 48],
  [48, 55],
  [48, 55],
  [55, 50],
  [48, 55],
  [55, 50],
];

const saintsBass: NoteSeed[] = saintsBassProgression.flatMap(
  ([root, fifth], bar) => {
    const lowerNote = Math.min(root, fifth);
    return [
      tone(root, bar * 4, 1.5, "left", root === lowerNote ? 5 : 1, 78, true),
      tone(
        fifth,
        bar * 4 + 2,
        1.5,
        "left",
        fifth === lowerNote ? 5 : 1,
        76,
      ),
    ];
  },
);

const waltzMelody: NoteSeed[] = [
  ...phrase(0, "right", [
    [64, 1, 1, true],
    [67, 1, 3],
    [72, 1, 5],
    [71, 1, 5, true],
    [69, 1, 4],
    [67, 1, 3],
    [65, 1, 4, true],
    [64, 1, 3],
    [62, 1, 2],
    [64, 1, 3, true],
    [62, 1, 2],
    [60, 1, 1],
  ]),
  ...phrase(12, "right", [
    [67, 0.5, 3, true],
    [69, 0.5, 4],
    [67, 0.5, 3],
    [65, 0.5, 2],
    [64, 1, 1],
    [62, 1, 1, true],
    [64, 1, 2],
    [65, 1, 3],
    [67, 1.5, 5, true],
    [64, 0.5, 3],
    [60, 1, 1],
    [62, 1, 2, true],
    [59, 1, 1],
    [60, 1, 2],
  ]),
  ...phrase(24, "right", [
    [64, 1, 3, true],
    [65, 1, 4],
    [67, 1, 5],
    [69, 1, 5, true],
    [67, 1, 4],
    [65, 1, 3],
    [64, 0.5, 3, true],
    [65, 0.5, 4],
    [64, 1, 3],
    [62, 1, 2],
    [60, 3, 1, true],
  ]),
];

const waltzHarmony: readonly {
  bass: number;
  chord: readonly [number, number];
}[] = [
  { bass: 48, chord: [52, 55] },
  { bass: 55, chord: [50, 55] },
  { bass: 57, chord: [52, 57] },
  { bass: 52, chord: [52, 59] },
  { bass: 53, chord: [53, 57] },
  { bass: 48, chord: [52, 55] },
  { bass: 50, chord: [50, 57] },
  { bass: 55, chord: [50, 55] },
  { bass: 48, chord: [52, 55] },
  { bass: 53, chord: [53, 57] },
  { bass: 55, chord: [50, 55] },
  { bass: 48, chord: [52, 55] },
];

const waltzAccompaniment: NoteSeed[] = waltzHarmony.flatMap(
  (harmony, bar) => {
    const start = bar * 3;
    return [
      tone(harmony.bass, start, 0.85, "left", 5, 77, true),
      ...chord(start + 1, 0.72, "left", harmony.chord, [3, 1], 72),
      ...chord(start + 2, 0.72, "left", harmony.chord, [3, 1], 70),
    ];
  },
);

type BluesChordName = "C7" | "F7" | "G7";

const bluesShells: Record<BluesChordName, readonly [number, number, number]> = {
  C7: [48, 52, 58],
  F7: [51, 53, 57],
  G7: [50, 55, 59],
};

const bluesRiffs: Record<BluesChordName, readonly number[]> = {
  C7: [60, 63, 65, 66, 67, 70],
  F7: [65, 68, 70, 71, 72, 68],
  G7: [62, 65, 67, 70, 72, 67],
};

const bluesProgression: readonly BluesChordName[] = [
  "C7",
  "C7",
  "C7",
  "C7",
  "F7",
  "F7",
  "C7",
  "C7",
  "G7",
  "F7",
  "C7",
  "G7",
];

const bluesNotes: NoteSeed[] = bluesProgression.flatMap((name, bar) => {
  const start = bar * 4;
  const riff = bluesRiffs[name];
  return [
    ...chord(start, 0.8, "left", bluesShells[name], [5, 3, 1], 82, true),
    ...chord(start + 2, 0.8, "left", bluesShells[name], [5, 3, 1], 78),
    ...phrase(
      start,
      "right",
      [
        [riff[0], 0.5, 1, true],
        [riff[1], 0.5, 2],
        [riff[2], 0.5, 3],
        [riff[3], 0.5, 4],
        [riff[4], 1, 5, true],
        [riff[5], 1, 3],
      ],
      98,
    ),
  ];
});

interface CanonChord {
  name: string;
  bass: readonly [number, number];
  triad: readonly [number, number, number];
}

const canonProgression: readonly CanonChord[] = [
  { name: "C", bass: [48, 55], triad: [60, 64, 67] },
  { name: "G/D", bass: [50, 55], triad: [59, 62, 67] },
  { name: "Am", bass: [57, 52], triad: [60, 64, 69] },
  { name: "Em/G", bass: [55, 52], triad: [59, 64, 67] },
  { name: "F", bass: [53, 48], triad: [60, 65, 69] },
  { name: "C/E", bass: [52, 55], triad: [60, 64, 67] },
  { name: "F", bass: [53, 48], triad: [60, 65, 69] },
  { name: "G", bass: [55, 50], triad: [59, 62, 67] },
];

const buildCanonNotes = (): NoteSeed[] => {
  const result: NoteSeed[] = [];

  canonProgression.forEach((harmony, bar) => {
    const start = bar * 4;
    for (let beat = 0; beat < 4; beat += 1) {
      const bassNote = harmony.bass[beat % 2];
      result.push(
        tone(
          bassNote,
          start + beat,
          0.82,
          "left",
          bassNote === Math.min(...harmony.bass) ? 5 : 1,
          76,
          beat === 0,
        ),
      );
    }
    result.push(
      ...chord(start, 1.45, "right", harmony.triad, [1, 3, 5], 86, true),
      ...chord(start + 2, 1.45, "right", harmony.triad, [1, 3, 5], 82),
    );
  });

  canonProgression.forEach((harmony, bar) => {
    const start = 32 + bar * 4;
    for (let beat = 0; beat < 4; beat += 1) {
      const bassNote = harmony.bass[beat % 2];
      result.push(
        tone(
          bassNote,
          start + beat,
          0.82,
          "left",
          bassNote === Math.min(...harmony.bass) ? 5 : 1,
          78,
          beat === 0,
        ),
      );
    }
    const order = [0, 1, 2, 1, 0, 1, 2, 1] as const;
    order.forEach((triadIndex, step) => {
      const fingers = [1, 3, 5] as const;
      result.push(
        tone(
          harmony.triad[triadIndex],
          start + step * 0.5,
          0.44,
          "right",
          fingers[triadIndex],
          92,
          step === 0,
          "legato",
        ),
      );
    });
  });

  return result;
};

interface ArpeggioHarmony {
  name: string;
  bass: readonly [number, number];
  tones: readonly [number, number, number, number];
}

const arpeggioProgression: readonly ArpeggioHarmony[] = [
  { name: "Cmaj7", bass: [48, 55], tones: [60, 64, 67, 72] },
  { name: "Am7", bass: [52, 57], tones: [60, 64, 69, 72] },
  { name: "Fmaj7", bass: [53, 57], tones: [60, 65, 69, 72] },
  { name: "G", bass: [50, 55], tones: [59, 62, 67, 71] },
  { name: "Dm7", bass: [50, 57], tones: [60, 62, 65, 69] },
  { name: "Em7", bass: [52, 55], tones: [59, 64, 67, 71] },
  { name: "Fmaj7", bass: [53, 57], tones: [60, 65, 69, 72] },
  { name: "G", bass: [50, 55], tones: [59, 62, 67, 71] },
];

const buildArpeggioNotes = (): NoteSeed[] => {
  const result: NoteSeed[] = [];
  const fingers = [1, 2, 3, 5] as const;
  const eighthOrder = [0, 1, 2, 3, 2, 1, 0, 1] as const;
  const sixteenthOrder = [
    0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1,
  ] as const;

  const addLeftHand = (harmony: ArpeggioHarmony, start: number) => {
    result.push(
      tone(harmony.bass[0], start, 1.75, "left", 5, 78, true),
      tone(harmony.bass[1], start + 2, 1.75, "left", 1, 76),
    );
  };

  arpeggioProgression.forEach((harmony, bar) => {
    const start = bar * 4;
    addLeftHand(harmony, start);
    eighthOrder.forEach((toneIndex, step) => {
      result.push(
        tone(
          harmony.tones[toneIndex],
          start + step * 0.5,
          0.44,
          "right",
          fingers[toneIndex],
          91,
          step === 0,
          "legato",
        ),
      );
    });
  });

  arpeggioProgression.forEach((harmony, bar) => {
    const start = 32 + bar * 4;
    addLeftHand(harmony, start);
    sixteenthOrder.forEach((toneIndex, step) => {
      result.push(
        tone(
          harmony.tones[toneIndex],
          start + step * 0.25,
          0.21,
          "right",
          fingers[toneIndex],
          96,
          step === 0,
          "legato",
        ),
      );
    });
  });

  return result;
};

interface FinaleHarmony {
  name: string;
  bass: readonly [number, number];
  right: readonly [number, number, number, number];
}

const finaleProgression: readonly FinaleHarmony[] = [
  { name: "C", bass: [48, 55], right: [60, 64, 67, 72] },
  { name: "Am", bass: [52, 57], right: [60, 64, 69, 72] },
  { name: "F", bass: [53, 57], right: [60, 65, 69, 72] },
  { name: "G", bass: [50, 55], right: [59, 62, 67, 71] },
  { name: "C", bass: [48, 55], right: [60, 64, 67, 72] },
  { name: "Am", bass: [52, 57], right: [60, 64, 69, 72] },
  { name: "F", bass: [53, 57], right: [60, 65, 69, 72] },
  { name: "G", bass: [50, 55], right: [59, 62, 67, 71] },
  { name: "F", bass: [53, 57], right: [60, 65, 69, 72] },
  { name: "G", bass: [50, 55], right: [59, 62, 67, 71] },
  { name: "C", bass: [48, 55], right: [60, 64, 67, 72] },
  { name: "C", bass: [48, 55], right: [60, 64, 67, 72] },
];

const buildFinaleNotes = (): NoteSeed[] => {
  const result: NoteSeed[] = [];
  const rightFingers = [1, 2, 3, 5] as const;

  finaleProgression.forEach((harmony, bar) => {
    const start = bar * 4;
    for (let step = 0; step < 8; step += 1) {
      result.push(
        tone(
          harmony.bass[step % 2],
          start + step * 0.5,
          0.38,
          "left",
          step % 2 === 0 ? 5 : 1,
          80,
          step === 0,
          "staccato",
        ),
      );
    }

    if (bar < 4) {
      const order = [0, 1, 2, 3, 2, 1, 2, 3] as const;
      order.forEach((toneIndex, step) => {
        result.push(
          tone(
            harmony.right[toneIndex],
            start + step * 0.5,
            0.43,
            "right",
            rightFingers[toneIndex],
            98,
            step === 0,
            "legato",
          ),
        );
      });
    } else if (bar < 8) {
      const triad = harmony.right.slice(0, 3);
      result.push(
        ...chord(start + 0.5, 0.72, "right", triad, [1, 3, 5], 96, true),
        ...chord(start + 2, 0.72, "right", triad, [1, 3, 5], 93),
        ...chord(start + 3.25, 0.48, "right", triad, [1, 3, 5], 102, true),
      );
    } else {
      const order = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3] as const;
      const stepCount = bar === 11 ? 12 : order.length;
      for (let step = 0; step < stepCount; step += 1) {
        const toneIndex = order[step];
        result.push(
          tone(
            harmony.right[toneIndex],
            start + step * 0.25,
            0.21,
            "right",
            rightFingers[toneIndex],
            102,
            step === 0,
            "legato",
          ),
        );
      }
      if (bar === 11) {
        result.push(
          ...chord(47, 1, "right", [60, 64, 72], [1, 3, 5], 112, true),
        );
      }
    }
  });

  return result;
};

export const SONGS: Song[] = [
  makeSong({
    id: "first-five-launch",
    title: "First Five Launch",
    subtitle: "Meet C, D, E, F, and G",
    composer: "Keyboard Hero Studio",
    bpm: 72,
    difficulty: 1,
    level: "1 · First Notes",
    skills: ["right-hand position", "quarter notes", "finger numbers", "steady pulse"],
    description:
      "A no-surprises first flight across the five notes under your right hand.",
    durationBeats: 24,
    notes: firstFiveNotes,
    sections: [
      {
        id: "up-and-back",
        label: "Up & Back",
        startBeat: 0,
        endBeat: 8,
        focus: "Keep one finger resting over each key.",
        recommendedTempoPercent: 70,
        repeatCount: 3,
      },
      {
        id: "first-phrase",
        label: "First Phrase",
        startBeat: 8,
        endBeat: 16,
        focus: "Listen for the longer final C.",
        recommendedTempoPercent: 80,
        repeatCount: 3,
      },
      {
        id: "victory-lap",
        label: "Victory Lap",
        startBeat: 16,
        endBeat: 24,
        focus: "Play evenly without looking down.",
        recommendedTempoPercent: 90,
        repeatCount: 2,
      },
    ],
    key: "C major",
    timeSignature: [4, 4],
    style: "Warm-up",
    origin: "original",
    attribution: "Original Keyboard Hero lesson.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 50, maxPercent: 110, stepPercent: 5 },
    pedagogy: {
      handPosition: "Right thumb on C4; one finger per white key through G4.",
      learningGoals: [
        "Match falling notes to five adjacent keys.",
        "Use fingers 1-5 without moving the hand.",
        "Hold long notes for their full value.",
      ],
      coachTips: [
        "Curve the fingers as if holding a small ball.",
        "Release shoulder tension before each loop.",
      ],
      mastery: beginnerMastery,
    },
  }),
  makeSong({
    id: "ode-to-joy",
    title: "Ode to Joy",
    subtitle: "A five-note Beethoven anthem",
    composer: "Ludwig van Beethoven",
    bpm: 84,
    difficulty: 1,
    level: "2 · First Melody",
    skills: ["stepwise melody", "repeated notes", "half notes", "phrase endings"],
    description:
      "The famous public-domain theme, arranged for a stationary five-finger position.",
    durationBeats: 32,
    notes: odeToJoyNotes,
    sections: [
      {
        id: "question",
        label: "Question",
        startBeat: 0,
        endBeat: 8,
        focus: "Keep repeated E notes even.",
        recommendedTempoPercent: 65,
        repeatCount: 3,
      },
      {
        id: "answer",
        label: "Answer",
        startBeat: 8,
        endBeat: 16,
        focus: "Count the dotted rhythm: one-and-two.",
        recommendedTempoPercent: 70,
        repeatCount: 3,
      },
      {
        id: "full-theme",
        label: "Full Theme",
        startBeat: 16,
        endBeat: 32,
        focus: "Shape the repeat toward the final C.",
        recommendedTempoPercent: 85,
        repeatCount: 2,
      },
    ],
    key: "C major",
    timeSignature: [4, 4],
    style: "Classical anthem",
    origin: "public-domain",
    attribution: "Public-domain theme from Beethoven's Symphony No. 9; simplified arrangement.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 50, maxPercent: 115, stepPercent: 5 },
    pedagogy: {
      handPosition: "Right thumb on C4; keep all five fingers close to the keys.",
      learningGoals: [
        "Read repeated pitches without adding extra motion.",
        "Differentiate quarter, half, and dotted values.",
        "Connect notes into four-beat phrases.",
      ],
      coachTips: [
        "Count aloud when the note lengths change.",
        "Let repeated notes rebound from the key instead of poking them.",
      ],
      mastery: beginnerMastery,
    },
  }),
  makeSong({
    id: "marys-two-hand-march",
    title: "Mary's Two-Hand March",
    subtitle: "Add a steady left-hand foundation",
    composer: "Traditional",
    bpm: 88,
    difficulty: 2,
    level: "3 · Hands Together",
    skills: ["two-hand coordination", "left-hand anchors", "long bass notes", "melody memory"],
    description:
      "A familiar public-domain melody that introduces the left hand only after the right hand feels secure.",
    durationBeats: 32,
    notes: [...maryMelody, ...maryBass],
    sections: [
      {
        id: "melody-alone",
        label: "Melody Alone",
        startBeat: 0,
        endBeat: 16,
        focus: "Make every repeated note deliberate.",
        recommendedTempoPercent: 75,
        repeatCount: 2,
      },
      {
        id: "add-left-hand",
        label: "Add Left Hand",
        startBeat: 16,
        endBeat: 24,
        focus: "Hold the bass while the melody keeps moving.",
        recommendedTempoPercent: 60,
        repeatCount: 4,
      },
      {
        id: "two-hand-ending",
        label: "Two-Hand Ending",
        startBeat: 24,
        endBeat: 32,
        focus: "Land both hands together on the final C harmony.",
        recommendedTempoPercent: 70,
        repeatCount: 4,
      },
    ],
    key: "C major",
    timeSignature: [4, 4],
    style: "Traditional march",
    origin: "public-domain",
    attribution: "Traditional public-domain melody; original two-hand teaching arrangement.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 45, maxPercent: 115, stepPercent: 5 },
    pedagogy: {
      handPosition: "Right hand in C position; left little finger on C3 and thumb on G3.",
      learningGoals: [
        "Sustain a bass note beneath a moving melody.",
        "Keep the pulse when one hand has fewer notes.",
        "Coordinate a two-hand final cadence.",
      ],
      coachTips: [
        "Practice the left-hand C-G motion silently before adding melody.",
        "Do not let the left hand copy the right-hand rhythm.",
      ],
      mastery: beginnerMastery,
    },
  }),
  makeSong({
    id: "frere-jacques-canon",
    title: "Frère Jacques Canon",
    subtitle: "Chase yourself across two octaves",
    composer: "Traditional French",
    bpm: 92,
    difficulty: 2,
    level: "4 · Independent Hands",
    skills: ["canon", "hand independence", "eighth notes", "two-octave mapping"],
    description:
      "The public-domain round becomes a playable two-hand canon: the left hand enters eight beats behind the right.",
    durationBeats: 40,
    notes: [...frereRight, ...shifted(frereRight, 8, -12, "left", true)],
    sections: [
      {
        id: "leader-a",
        label: "Right Phrase",
        startBeat: 0,
        endBeat: 4,
        focus: "Place C-D-E-C under right-hand fingers 1-2-3-1.",
        recommendedTempoPercent: 60,
        repeatCount: 3,
      },
      {
        id: "leader-b",
        label: "Right Repeat",
        startBeat: 4,
        endBeat: 8,
        focus: "Repeat the opening without moving the right-hand position.",
        recommendedTempoPercent: 65,
        repeatCount: 3,
      },
      {
        id: "canon-entry-a",
        label: "Canon Entry",
        startBeat: 8,
        endBeat: 12,
        focus: "Keep the right hand on E-F-G while the left begins C-D-E-C.",
        recommendedTempoPercent: 45,
        repeatCount: 4,
      },
      {
        id: "canon-entry-b",
        label: "Entry Repeat",
        startBeat: 12,
        endBeat: 16,
        focus: "Repeat the first overlap as two separate singers.",
        recommendedTempoPercent: 45,
        repeatCount: 4,
      },
      {
        id: "running-a",
        label: "Running A",
        startBeat: 16,
        endBeat: 20,
        focus: "Keep the right-hand eighth notes light over the left melody.",
        recommendedTempoPercent: 40,
        repeatCount: 4,
      },
      {
        id: "running-b",
        label: "Running B",
        startBeat: 20,
        endBeat: 24,
        focus: "Repeat the eighth-note cell without tightening either wrist.",
        recommendedTempoPercent: 40,
        repeatCount: 4,
      },
      {
        id: "bells-a",
        label: "Bell Answer",
        startBeat: 24,
        endBeat: 28,
        focus: "Let the high right-hand notes ring while the left hand runs.",
        recommendedTempoPercent: 45,
        repeatCount: 4,
      },
      {
        id: "bells-b",
        label: "Bell Repeat",
        startBeat: 28,
        endBeat: 32,
        focus: "Prepare each right-hand jump before the beat arrives.",
        recommendedTempoPercent: 45,
        repeatCount: 4,
      },
      {
        id: "left-finish-a",
        label: "Left Finish",
        startBeat: 32,
        endBeat: 36,
        focus: "Let the right hand rest while the left finishes the running phrase.",
        recommendedTempoPercent: 50,
        repeatCount: 3,
      },
      {
        id: "left-finish-b",
        label: "Final Echo",
        startBeat: 36,
        endBeat: 40,
        focus: "Finish the final left-hand bell phrase with a relaxed thumb.",
        recommendedTempoPercent: 55,
        repeatCount: 3,
      },
    ],
    key: "C major",
    timeSignature: [4, 4],
    style: "Round / canon",
    origin: "public-domain",
    attribution: "Traditional public-domain French round; original two-octave canon arrangement.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 40, maxPercent: 110, stepPercent: 5 },
    pedagogy: {
      handPosition: "Right hand around C4; left hand mirrors the same shape around C3.",
      learningGoals: [
        "Maintain one melody while another enters.",
        "Recognize the same pattern in two octaves.",
        "Play paired eighth notes without tightening the wrist.",
      ],
      coachTips: [
        "Loop each hand alone before attempting the overlap.",
        "Accented notes mark the start of each musical idea, not extra volume everywhere.",
      ],
      mastery: intermediateMastery,
    },
  }),
  makeSong({
    id: "saints-syncopation-lab",
    title: "Saints Syncopation Lab",
    subtitle: "Pickups, rests, and a marching bass",
    composer: "Traditional",
    bpm: 104,
    difficulty: 3,
    level: "5 · Rhythm Control",
    skills: ["eighth-note pickup", "rests", "syncopation", "alternating bass"],
    description:
      "A punchy public-domain Saints arrangement that makes silence and off-beat entrances part of the groove.",
    durationBeats: 32,
    notes: [...saintsMelody, ...saintsBass],
    sections: [
      {
        id: "pickup-launch",
        label: "Pickup Launch",
        startBeat: 0,
        endBeat: 8,
        focus: "Wait through the opening half-beat rest.",
        recommendedTempoPercent: 60,
        repeatCount: 4,
      },
      {
        id: "groove-answer",
        label: "Groove Answer",
        startBeat: 8,
        endBeat: 16,
        focus: "Keep the bass calm beneath the pickup.",
        recommendedTempoPercent: 65,
        repeatCount: 3,
      },
      {
        id: "middle-break",
        label: "Middle Break",
        startBeat: 16,
        endBeat: 24,
        focus: "Count the rests instead of guessing the entrance.",
        recommendedTempoPercent: 65,
        repeatCount: 4,
      },
      {
        id: "saints-finale",
        label: "Saints Finale",
        startBeat: 24,
        endBeat: 32,
        focus: "Aim both hands toward the final C.",
        recommendedTempoPercent: 80,
        repeatCount: 2,
      },
    ],
    key: "C major",
    timeSignature: [4, 4],
    style: "New Orleans-inspired march",
    origin: "public-domain",
    attribution: "Traditional public-domain spiritual; original rhythm-study arrangement.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 40, maxPercent: 120, stepPercent: 5 },
    pedagogy: {
      handPosition: "Right hand near middle C; left hand covers C3 through G3.",
      learningGoals: [
        "Enter accurately after a half-beat pickup.",
        "Treat rests as measured musical events.",
        "Balance melody over an alternating bass.",
      ],
      coachTips: [
        "Say 'and' on each pickup before playing it.",
        "Make the left hand lighter than the melody.",
      ],
      mastery: intermediateMastery,
    },
  }),
  makeSong({
    id: "clockwork-minuet",
    title: "Clockwork Minuet",
    subtitle: "Elegant three-beat coordination",
    composer: "Keyboard Hero Studio",
    bpm: 96,
    difficulty: 3,
    level: "6 · Waltz Balance",
    skills: ["3/4 meter", "waltz accompaniment", "voicing", "finger substitution"],
    description:
      "An original miniature that teaches bass-chord-chord balance while the right hand sings above it.",
    durationBeats: 36,
    notes: [...waltzMelody, ...waltzAccompaniment],
    sections: [
      {
        id: "music-box",
        label: "Music Box",
        startBeat: 0,
        endBeat: 12,
        focus: "Feel one strong beat followed by two light beats.",
        recommendedTempoPercent: 60,
        repeatCount: 3,
      },
      {
        id: "turning-gears",
        label: "Turning Gears",
        startBeat: 12,
        endBeat: 24,
        focus: "Keep the eighth-note turn smooth and quiet.",
        recommendedTempoPercent: 55,
        repeatCount: 4,
      },
      {
        id: "royal-cadence",
        label: "Royal Cadence",
        startBeat: 24,
        endBeat: 36,
        focus: "Let the melody outshine the accompaniment.",
        recommendedTempoPercent: 70,
        repeatCount: 3,
      },
    ],
    key: "C major",
    timeSignature: [3, 4],
    style: "Classical minuet",
    origin: "original",
    attribution: "Original Keyboard Hero lesson in eighteenth-century minuet style.",
    countInBeats: 3,
    recommendedTempo: { minPercent: 40, maxPercent: 115, stepPercent: 5 },
    pedagogy: {
      handPosition: "Left hand below middle C; right hand begins with thumb on E4.",
      learningGoals: [
        "Internalize three-beat meter.",
        "Play bass-chord-chord without heavy repeated chords.",
        "Voice the right-hand melody above accompaniment.",
      ],
      coachTips: [
        "Think 'down, away, away' for each measure.",
        "Practice the left hand as silent key touches if it overpowers the melody.",
      ],
      mastery: intermediateMastery,
    },
  }),
  makeSong({
    id: "twelve-bar-neon-blues",
    title: "Twelve-Bar Neon Blues",
    subtitle: "Shell chords and electric-blue riffs",
    composer: "Keyboard Hero Studio",
    bpm: 108,
    difficulty: 4,
    level: "7 · Chords & Groove",
    skills: ["12-bar blues", "dominant seventh chords", "chromatic notes", "riff coordination"],
    description:
      "An original twelve-bar workout pairing left-hand seventh-chord shells with compact blues riffs.",
    durationBeats: 48,
    notes: bluesNotes,
    sections: [
      {
        id: "home-four",
        label: "Home Four",
        startBeat: 0,
        endBeat: 16,
        focus: "Lock the C7 shell to the first and third beats.",
        recommendedTempoPercent: 55,
        repeatCount: 3,
      },
      {
        id: "change-four",
        label: "Change Four",
        startBeat: 16,
        endBeat: 32,
        focus: "Move to F7 without breaking the right-hand flow.",
        recommendedTempoPercent: 55,
        repeatCount: 4,
      },
      {
        id: "turnaround",
        label: "Turnaround",
        startBeat: 32,
        endBeat: 48,
        focus: "Hear G7-F7-C7-G7 as a complete sentence.",
        recommendedTempoPercent: 60,
        repeatCount: 5,
      },
    ],
    key: "C blues",
    timeSignature: [4, 4],
    style: "Blues-rock",
    origin: "original",
    attribution: "Original Keyboard Hero twelve-bar blues study.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 35, maxPercent: 125, stepPercent: 5 },
    pedagogy: {
      handPosition: "Left hand forms compact shells below C4; right hand covers the C blues zone through C5.",
      learningGoals: [
        "Recognize the I-IV-V twelve-bar form.",
        "Coordinate chord stabs with an independent riff.",
        "Use black keys confidently as expressive scale tones.",
      ],
      coachTips: [
        "Loop the turnaround more often than the opening four bars.",
        "Keep the left-hand shells short so the riff has room to speak.",
      ],
      mastery: advancedMastery,
    },
  }),
  makeSong({
    id: "canon-chord-forge",
    title: "Canon Chord Forge",
    subtitle: "Build chords, then break them open",
    composer: "Keyboard Hero Studio",
    bpm: 100,
    difficulty: 4,
    level: "8 · Harmony Builder",
    skills: ["triad inversions", "broken chords", "voice leading", "left-hand ostinato"],
    description:
      "A centuries-old canon-style progression becomes an original study: block chords first, flowing broken chords second.",
    durationBeats: 64,
    notes: buildCanonNotes(),
    sections: [
      {
        id: "block-chords-a",
        label: "Block Chords A",
        startBeat: 0,
        endBeat: 16,
        focus: "Land each triad as one unified gesture.",
        recommendedTempoPercent: 55,
        repeatCount: 3,
      },
      {
        id: "block-chords-b",
        label: "Block Chords B",
        startBeat: 16,
        endBeat: 32,
        focus: "Notice common tones between neighboring chords.",
        recommendedTempoPercent: 60,
        repeatCount: 3,
      },
      {
        id: "broken-chords-a",
        label: "Broken Chords A",
        startBeat: 32,
        endBeat: 48,
        focus: "Connect each eight-note arpeggio without gaps.",
        recommendedTempoPercent: 45,
        repeatCount: 4,
      },
      {
        id: "broken-chords-b",
        label: "Broken Chords B",
        startBeat: 48,
        endBeat: 64,
        focus: "Keep the left ostinato even through the cadence.",
        recommendedTempoPercent: 50,
        repeatCount: 4,
      },
    ],
    key: "C major / A minor",
    timeSignature: [4, 4],
    style: "Cinematic pop-classical",
    origin: "original",
    attribution: "Original Keyboard Hero exercise using a traditional descending canon progression.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 30, maxPercent: 120, stepPercent: 5 },
    pedagogy: {
      handPosition: "Left hand stays below C4; right hand uses compact inversions around middle C.",
      learningGoals: [
        "Read and land three-note chords together.",
        "Recognize inversions that minimize hand travel.",
        "Convert block harmony into a continuous arpeggio texture.",
      ],
      coachTips: [
        "Freeze on each chord and check that all three notes sound together.",
        "At slow speed, listen for an unbroken chain of right-hand eighth notes.",
      ],
      mastery: advancedMastery,
    },
  }),
  makeSong({
    id: "arpeggio-accelerator",
    title: "Arpeggio Accelerator",
    subtitle: "Eighth notes become sixteenth-note fire",
    composer: "Keyboard Hero Studio",
    bpm: 112,
    difficulty: 5,
    level: "9 · Speed & Flow",
    skills: ["four-note arpeggios", "sixteenth notes", "thumb crossing", "tempo control"],
    description:
      "An original progressive etude: learn the shapes as eighth notes, then replay them twice as densely.",
    durationBeats: 64,
    notes: buildArpeggioNotes(),
    sections: [
      {
        id: "eighth-shapes-a",
        label: "Eighth Shapes A",
        startBeat: 0,
        endBeat: 16,
        focus: "Learn each four-note shape without rushing the top note.",
        recommendedTempoPercent: 50,
        repeatCount: 4,
      },
      {
        id: "eighth-shapes-b",
        label: "Eighth Shapes B",
        startBeat: 16,
        endBeat: 32,
        focus: "Prepare the next hand shape before the bar line.",
        recommendedTempoPercent: 55,
        repeatCount: 4,
      },
      {
        id: "sixteenth-burst-a",
        label: "Sixteenth Burst A",
        startBeat: 32,
        endBeat: 48,
        focus: "Use tiny, relaxed motions at half speed.",
        recommendedTempoPercent: 35,
        repeatCount: 6,
      },
      {
        id: "sixteenth-burst-b",
        label: "Sixteenth Burst B",
        startBeat: 48,
        endBeat: 64,
        focus: "Keep every inner note as clear as the accented downbeats.",
        recommendedTempoPercent: 40,
        repeatCount: 6,
      },
    ],
    key: "C major / A minor",
    timeSignature: [4, 4],
    style: "Cinematic arpeggio etude",
    origin: "original",
    attribution: "Original Keyboard Hero arpeggio study.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 25, maxPercent: 115, stepPercent: 5 },
    pedagogy: {
      handPosition: "Left hand anchors two-note shapes; right hand spans compact seventh-chord shapes.",
      learningGoals: [
        "Map common seventh-chord arpeggios by shape.",
        "Double rhythmic density without changing the underlying pulse.",
        "Stay physically relaxed during fast repeated patterns.",
      ],
      coachTips: [
        "Do not increase speed until every sixteenth note sounds equal.",
        "Release the wrist at the top of each arpeggio instead of stretching harder.",
      ],
      mastery: advancedMastery,
    },
  }),
  makeSong({
    id: "neon-skyline-finale",
    title: "Neon Skyline Finale",
    subtitle: "Your two-hand arena encore",
    composer: "Keyboard Hero Studio",
    bpm: 124,
    difficulty: 5,
    level: "10 · Rockstar",
    skills: ["two-hand ostinato", "syncopated chords", "sixteenth-note runs", "endurance"],
    description:
      "An original concert etude combining everything: bass drive, arpeggios, chord hits, rapid runs, and a huge final chord.",
    durationBeats: 48,
    notes: buildFinaleNotes(),
    sections: [
      {
        id: "skyline-rise",
        label: "Skyline Rise",
        startBeat: 0,
        endBeat: 16,
        focus: "Make the two eighth-note streams feel like one engine.",
        recommendedTempoPercent: 45,
        repeatCount: 5,
      },
      {
        id: "laser-chords",
        label: "Laser Chords",
        startBeat: 16,
        endBeat: 32,
        focus: "Place right-hand chord hits exactly between bass pulses.",
        recommendedTempoPercent: 40,
        repeatCount: 6,
      },
      {
        id: "final-sprint",
        label: "Final Sprint",
        startBeat: 32,
        endBeat: 44,
        focus: "Stay loose while the right hand shifts to sixteenths.",
        recommendedTempoPercent: 30,
        repeatCount: 8,
      },
      {
        id: "encore-hit",
        label: "Encore Hit",
        startBeat: 44,
        endBeat: 48,
        focus: "Drive through the last run and release the final chord together.",
        recommendedTempoPercent: 40,
        repeatCount: 8,
      },
    ],
    key: "C major / A minor",
    timeSignature: [4, 4],
    style: "Arena synth-rock etude",
    origin: "original",
    attribution: "Original Keyboard Hero concert etude.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 20, maxPercent: 110, stepPercent: 5 },
    pedagogy: {
      handPosition: "Left hand alternates compact bass shapes; right hand owns the upper half of the keyboard.",
      learningGoals: [
        "Maintain an ostinato through changing right-hand textures.",
        "Place syncopated chords against a steady subdivision.",
        "Manage tension and accuracy across a complete performance arc.",
      ],
      coachTips: [
        "Treat each section as its own workout before attempting a full run.",
        "If the forearms tighten, stop, shake out, and restart one speed step slower.",
      ],
      mastery: advancedMastery,
    },
  }),
];

/** Lowercase alias for consumers that prefer conventional collection names. */
export const songs = SONGS;

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

/** Convert a MIDI number to scientific pitch notation (for example, 60 -> C4). */
export function midiToNoteName(midi: number, preferFlats = false): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`MIDI note must be an integer from 0 to 127; received ${midi}.`);
  }
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Convert quarter-note beats to seconds at the requested playback multiplier. */
export function beatsToSeconds(
  beats: number,
  bpm: number,
  tempoMultiplier = 1,
): number {
  if (!Number.isFinite(beats) || beats < 0) {
    throw new RangeError(`Beats must be a finite non-negative number; received ${beats}.`);
  }
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`BPM must be a finite positive number; received ${bpm}.`);
  }
  if (!Number.isFinite(tempoMultiplier) || tempoMultiplier <= 0) {
    throw new RangeError(
      `Tempo multiplier must be a finite positive number; received ${tempoMultiplier}.`,
    );
  }
  return (beats * 60) / (bpm * tempoMultiplier);
}

/** Convert elapsed seconds back into quarter-note beats. */
export function secondsToBeats(
  seconds: number,
  bpm: number,
  tempoMultiplier = 1,
): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `Seconds must be a finite non-negative number; received ${seconds}.`,
    );
  }
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`BPM must be a finite positive number; received ${bpm}.`);
  }
  if (!Number.isFinite(tempoMultiplier) || tempoMultiplier <= 0) {
    throw new RangeError(
      `Tempo multiplier must be a finite positive number; received ${tempoMultiplier}.`,
    );
  }
  return (seconds * bpm * tempoMultiplier) / 60;
}

/** Duration of a song in seconds; optionally include its count-in. */
export function getSongDurationSeconds(
  song: Song,
  tempoMultiplier = 1,
  includeCountIn = false,
): number {
  const beats = song.durationBeats + (includeCountIn ? song.countInBeats : 0);
  return beatsToSeconds(beats, song.bpm, tempoMultiplier);
}

/** Duration of a practice section in seconds at the selected playback speed. */
export function getSectionDurationSeconds(
  song: Song,
  section: SongSection,
  tempoMultiplier = 1,
): number {
  return beatsToSeconds(
    section.endBeat - section.startBeat,
    song.bpm,
    tempoMultiplier,
  );
}

/** Find a curriculum song by its stable slug. */
export function getSongById(id: string): Song | undefined {
  return SONGS.find((song) => song.id === id);
}

/**
 * Notes whose attack falls inside a section. Notes are shifted so the section's
 * first beat becomes beat zero by default, which is convenient for loop playback.
 */
export function getNotesForSection(
  song: Song,
  section: SongSection,
  rebaseToZero = true,
): SongNote[] {
  return song.notes
    .filter(
      (note) =>
        note.startBeat >= section.startBeat && note.startBeat < section.endBeat,
    )
    .map((note) =>
      rebaseToZero
        ? { ...note, startBeat: note.startBeat - section.startBeat }
        : note,
    );
}

/** Data-integrity checks are exported for tests and user-authored song packs. */
export function validateSong(song: Song): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();

  if (!song.id.trim()) issues.push("song id is empty");
  if (!Number.isFinite(song.bpm) || song.bpm <= 0) issues.push("BPM must be positive");
  if (!Number.isFinite(song.durationBeats) || song.durationBeats <= 0) {
    issues.push("durationBeats must be positive");
  }

  if (song.accompaniment) {
    if (!song.accompaniment.arrangementId.trim()) {
      issues.push("accompaniment arrangementId is empty");
    }
    if (song.accompaniment.progression.length === 0) {
      issues.push("accompaniment progression is empty");
    }
    if (
      song.accompaniment.progression.some(
        (symbol) =>
          !/^(?:[A-G](?:#|b)?)(?:m|m7|maj7|7|dim)?$/.test(symbol),
      )
    ) {
      issues.push("accompaniment progression contains an unsupported chord symbol");
    }
    const positions = [
      ...song.accompaniment.kick,
      ...song.accompaniment.snare,
      ...song.accompaniment.hats,
      ...(song.accompaniment.openHat ?? []),
      ...song.accompaniment.bass.map((step) => step.at),
      ...song.accompaniment.harmony.map((step) => step.at),
    ];
    if (positions.some((position) => !Number.isFinite(position) || position < 0 || position >= 1)) {
      issues.push("accompaniment positions must be finite measure offsets from 0 through < 1");
    }
    if (
      [...song.accompaniment.bass, ...song.accompaniment.harmony].some(
        (step) =>
          !Number.isFinite(step.duration) ||
          step.duration <= 0 ||
          step.duration > 1 ||
          !Number.isFinite(step.velocity) ||
          step.velocity <= 0 ||
          step.velocity > 1,
      )
    ) {
      issues.push("accompaniment step durations and velocities must be finite and within (0, 1]");
    }
  }

  for (const note of song.notes) {
    if (ids.has(note.id)) issues.push(`duplicate note id ${note.id}`);
    ids.add(note.id);
    if (!Number.isInteger(note.midi) || note.midi < MIDI_MIN || note.midi > MIDI_MAX) {
      issues.push(`note ${note.id} is outside MIDI ${MIDI_MIN}-${MIDI_MAX}`);
    }
    if (!Number.isFinite(note.startBeat) || note.startBeat < 0) {
      issues.push(`note ${note.id} has an invalid startBeat`);
    }
    if (!Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
      issues.push(`note ${note.id} has an invalid durationBeats`);
    }
    if (note.startBeat + note.durationBeats > song.durationBeats + 0.000_001) {
      issues.push(`note ${note.id} extends beyond the song`);
    }
    if (
      note.velocity !== undefined &&
      (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127)
    ) {
      issues.push(`note ${note.id} has an invalid velocity`);
    }
  }

  for (const section of song.sections) {
    if (section.startBeat < 0 || section.endBeat <= section.startBeat) {
      issues.push(`section ${section.id} has invalid bounds`);
    }
    if (section.endBeat > song.durationBeats) {
      issues.push(`section ${section.id} extends beyond the song`);
    }
  }

  return issues;
}
