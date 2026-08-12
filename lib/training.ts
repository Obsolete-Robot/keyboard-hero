import {
  AKAI_MPK_MINI_IV_SETUP,
  validateSong,
  type Finger,
  type Hand,
  type Song,
  type SongNote,
  type SongSection,
} from "@/lib/songs";

type TrainingNoteSeed = Omit<SongNote, "id">;

export interface TrainingFingerPosition {
  midi: number;
  note: string;
  hand: Exclude<Hand, "both">;
  finger: Finger;
}

export interface TrainingLesson {
  id: string;
  order: number;
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  reassurance: string;
  successCue: string;
  recommendedMinutes: string;
  defaultMode: "flow" | "wait" | "listen";
  defaultSectionId: string;
  song: Song;
}

export interface TrainingLanding {
  beat: number;
  notes: SongNote[];
}

export const TRAINING_STORAGE_KEY = "keyboard-hero.training-progress.v1";

export const HOME_FINGER_POSITIONS: readonly TrainingFingerPosition[] = [
  { midi: 48, note: "C3", hand: "left", finger: 5 },
  { midi: 50, note: "D3", hand: "left", finger: 4 },
  { midi: 52, note: "E3", hand: "left", finger: 3 },
  { midi: 53, note: "F3", hand: "left", finger: 2 },
  { midi: 55, note: "G3", hand: "left", finger: 1 },
  { midi: 60, note: "C4", hand: "right", finger: 1 },
  { midi: 62, note: "D4", hand: "right", finger: 2 },
  { midi: 64, note: "E4", hand: "right", finger: 3 },
  { midi: 65, note: "F4", hand: "right", finger: 4 },
  { midi: 67, note: "G4", hand: "right", finger: 5 },
] as const;

const beginnerMastery = {
  accuracyPercent: 85,
  timingWindowMs: 220,
  minimumTempoPercent: 50,
  cleanRuns: 2,
} as const;

function note(
  midi: number,
  startBeat: number,
  durationBeats: number,
  hand: Exclude<Hand, "both">,
  finger: Finger,
  velocity = 86,
): TrainingNoteSeed {
  return {
    midi,
    startBeat,
    durationBeats,
    hand,
    finger,
    velocity,
  };
}

function notesAt(
  startBeat: number,
  durationBeats: number,
  voices: readonly (readonly [
    midi: number,
    hand: Exclude<Hand, "both">,
    finger: Finger,
  ])[],
): TrainingNoteSeed[] {
  return voices.map(([midi, hand, finger]) =>
    note(midi, startBeat, durationBeats, hand, finger),
  );
}

function phrase(
  startBeat: number,
  hand: Exclude<Hand, "both">,
  midis: readonly number[],
  fingers: readonly Finger[],
  durationBeats = 1,
): TrainingNoteSeed[] {
  return midis.map((midi, index) =>
    note(
      midi,
      startBeat + index * durationBeats,
      durationBeats,
      hand,
      fingers[index] ?? 1,
    ),
  );
}

function makeTrainingSong({
  id,
  title,
  subtitle,
  level,
  skills,
  description,
  durationBeats,
  notes,
  sections,
  handPosition,
  learningGoals,
  coachTips,
}: {
  id: string;
  title: string;
  subtitle: string;
  level: string;
  skills: string[];
  description: string;
  durationBeats: number;
  notes: TrainingNoteSeed[];
  sections: SongSection[];
  handPosition: string;
  learningGoals: string[];
  coachTips: string[];
}): Song {
  const song: Song = {
    id: `training-${id}`,
    title,
    subtitle,
    composer: "Keyboard Hero Coach",
    bpm: 80,
    difficulty: 1,
    level,
    skills,
    description,
    durationBeats,
    notes: [...notes]
      .sort((left, right) =>
        left.startBeat - right.startBeat || left.midi - right.midi,
      )
      .map((songNote, index) => ({
        ...songNote,
        id: `training-${id}-note-${String(index + 1).padStart(3, "0")}`,
      })),
    sections,
    key: "C major",
    timeSignature: [4, 4],
    style: "Guided technique",
    origin: "original",
    attribution: "Original Keyboard Hero training exercise.",
    countInBeats: 4,
    recommendedTempo: { minPercent: 25, maxPercent: 85, stepPercent: 5 },
    pedagogy: {
      handPosition,
      learningGoals,
      coachTips,
      mastery: beginnerMastery,
    },
    octaveShiftHint: AKAI_MPK_MINI_IV_SETUP,
  };

  const issues = validateSong(song);
  if (issues.length > 0) {
    throw new Error(`Invalid training lesson "${id}": ${issues.join("; ")}`);
  }
  return song;
}

const rightHandHome = makeTrainingSong({
  id: "right-hand-home",
  title: "Right-Hand Home",
  subtitle: "Give every finger one key",
  level: "Training 1 · Finger map",
  skills: ["right-hand position", "finger numbers", "relaxed shape"],
  description: "A slow C-to-G walk that keeps the right hand completely still.",
  durationBeats: 16,
  notes: [
    ...phrase(0, "right", [60, 62, 64, 65, 67, 65, 64, 62], [1, 2, 3, 4, 5, 4, 3, 2]),
    ...phrase(8, "right", [60, 64, 67, 64, 60, 62, 64, 60], [1, 3, 5, 3, 1, 2, 3, 1]),
  ],
  sections: [
    {
      id: "walk-home",
      label: "Walk Home",
      startBeat: 0,
      endBeat: 8,
      focus: "Keep one curved finger floating over each white key.",
      recommendedTempoPercent: 45,
      repeatCount: 2,
    },
    {
      id: "small-skips",
      label: "Small Skips",
      startBeat: 8,
      endBeat: 16,
      focus: "Let the third and fifth fingers move without sliding the thumb.",
      recommendedTempoPercent: 45,
      repeatCount: 2,
    },
  ],
  handPosition: "Right thumb on C4; fingers 2, 3, 4, and 5 rest over D4 through G4.",
  learningGoals: [
    "Connect finger numbers 1-5 to the five right-hand keys.",
    "Move one finger without moving the whole hand.",
  ],
  coachTips: [
    "Finger 1 is the thumb and finger 5 is the pinky.",
    "Keep the wrist level and the knuckles softly rounded.",
  ],
});

const leftHandHome = makeTrainingSong({
  id: "left-hand-home",
  title: "Left-Hand Home",
  subtitle: "Mirror the shape one octave lower",
  level: "Training 2 · Left hand",
  skills: ["left-hand position", "mirrored fingering", "finger independence"],
  description: "The same five-key walk, with left-hand finger numbers running 5-to-1.",
  durationBeats: 16,
  notes: [
    ...phrase(0, "left", [48, 50, 52, 53, 55, 53, 52, 50], [5, 4, 3, 2, 1, 2, 3, 4]),
    ...phrase(8, "left", [48, 52, 55, 52, 48, 50, 52, 48], [5, 3, 1, 3, 5, 4, 3, 5]),
  ],
  sections: [
    {
      id: "mirror-walk",
      label: "Mirror Walk",
      startBeat: 0,
      endBeat: 8,
      focus: "Start with the left pinky on C3 and finish with the thumb on G3.",
      recommendedTempoPercent: 40,
      repeatCount: 2,
    },
    {
      id: "left-skips",
      label: "Left Skips",
      startBeat: 8,
      endBeat: 16,
      focus: "Keep the little finger parked over C3 while the hand opens.",
      recommendedTempoPercent: 40,
      repeatCount: 2,
    },
  ],
  handPosition: "Left pinky on C3; fingers 4, 3, 2, and thumb rest over D3 through G3.",
  learningGoals: [
    "Read left-hand finger numbers from 5 down to 1.",
    "Keep the left wrist quiet while individual fingers move.",
  ],
  coachTips: [
    "The left-hand C uses finger 5, not finger 1.",
    "Practice this hand by itself until the fingering feels boring.",
  ],
});

const handsTakeTurns = makeTrainingSong({
  id: "hands-take-turns",
  title: "Hands Take Turns",
  subtitle: "One singer, then the other",
  level: "Training 3 · Hand-off",
  skills: ["hand changes", "matching shapes", "steady pulse"],
  description: "Each hand plays the same four-note idea while the other hand rests.",
  durationBeats: 16,
  notes: [
    ...phrase(0, "right", [60, 62, 64, 60], [1, 2, 3, 1]),
    ...phrase(4, "left", [48, 50, 52, 48], [5, 4, 3, 5]),
    ...phrase(8, "right", [60, 62], [1, 2]),
    ...phrase(10, "left", [48, 50], [5, 4]),
    ...phrase(12, "right", [64, 60], [3, 1]),
    ...phrase(14, "left", [52, 48], [3, 5]),
  ],
  sections: [
    {
      id: "long-handoff",
      label: "Long Hand-off",
      startBeat: 0,
      endBeat: 8,
      focus: "Let the resting hand stay touching its home keys.",
      recommendedTempoPercent: 45,
      repeatCount: 2,
    },
    {
      id: "quick-handoff",
      label: "Quick Hand-off",
      startBeat: 8,
      endBeat: 16,
      focus: "Switch hands every two beats without rushing the hand-off.",
      recommendedTempoPercent: 40,
      repeatCount: 3,
    },
  ],
  handPosition: "Keep both hands in C position: left on C3-G3 and right on C4-G4.",
  learningGoals: [
    "Keep both hands prepared even when only one is playing.",
    "Move attention between hands without losing the beat.",
  ],
  coachTips: [
    "Do not lift the resting hand into the air.",
    "Say 'right' and 'left' aloud at each hand-off.",
  ],
});

const firstTwoHandLanding = makeTrainingSong({
  id: "first-two-hand-landing",
  title: "First Two-Hand Landing",
  subtitle: "Together first, then hold and move",
  level: "Training 4 · Together",
  skills: ["simultaneous notes", "sustained anchor", "hand independence"],
  description: "Start with easy octave landings, then hold one C while the other hand walks.",
  durationBeats: 16,
  notes: [
    ...notesAt(0, 1.5, [[48, "left", 5], [60, "right", 1]]),
    ...notesAt(2, 1.5, [[50, "left", 4], [62, "right", 2]]),
    ...notesAt(4, 1.5, [[52, "left", 3], [64, "right", 3]]),
    ...notesAt(6, 1.5, [[48, "left", 5], [60, "right", 1]]),
    note(48, 8, 4, "left", 5),
    ...phrase(8, "right", [60, 62, 64, 60], [1, 2, 3, 1]),
    note(60, 12, 4, "right", 1),
    ...phrase(12, "left", [48, 50, 52, 48], [5, 4, 3, 5]),
  ],
  sections: [
    {
      id: "land-together",
      label: "Land Together",
      startBeat: 0,
      endBeat: 8,
      focus: "Press both matching notes at the exact same moment.",
      recommendedTempoPercent: 40,
      repeatCount: 3,
    },
    {
      id: "hold-and-move",
      label: "Hold + Move",
      startBeat: 8,
      endBeat: 16,
      focus: "Keep one C held while the other hand moves independently.",
      recommendedTempoPercent: 35,
      repeatCount: 3,
    },
  ],
  handPosition: "Both hands stay in C position, exactly one octave apart.",
  learningGoals: [
    "Land matching notes with both hands together.",
    "Hold one hand still while the other hand plays four notes.",
  ],
  coachTips: [
    "Prepare both keys before pressing; do not chase one hand with the other.",
    "A held key needs gentle weight, not a locked wrist.",
  ],
});

const buildAChord = makeTrainingSong({
  id: "build-a-chord",
  title: "Build a C Chord",
  subtitle: "Find the shape before playing it",
  level: "Training 5 · Chords",
  skills: ["C major chord", "blocked notes", "two-hand voicing"],
  description: "Hear C-E-G separately, then press the notes as one relaxed shape.",
  durationBeats: 16,
  notes: [
    ...phrase(0, "right", [60, 64, 67], [1, 3, 5]),
    ...notesAt(4, 3, [[60, "right", 1], [64, "right", 3], [67, "right", 5]]),
    ...phrase(8, "left", [48, 55], [5, 1]),
    ...notesAt(10, 2, [[48, "left", 5], [55, "left", 1]]),
    ...notesAt(12, 4, [
      [48, "left", 5],
      [55, "left", 1],
      [60, "right", 1],
      [64, "right", 3],
      [67, "right", 5],
    ]),
  ],
  sections: [
    {
      id: "right-chord-shape",
      label: "Right C Chord",
      startBeat: 0,
      endBeat: 8,
      focus: "Keep fingers 1, 3, and 5 over C, E, and G before pressing.",
      recommendedTempoPercent: 40,
      repeatCount: 3,
    },
    {
      id: "full-band-chord",
      label: "Both-Hand Chord",
      startBeat: 8,
      endBeat: 16,
      focus: "Build from the left C-G shell, then add the right C chord.",
      recommendedTempoPercent: 35,
      repeatCount: 3,
    },
  ],
  handPosition: "Left pinky/thumb on C3/G3; right thumb/middle/pinky on C4/E4/G4.",
  learningGoals: [
    "Recognize C-E-G as a C major chord.",
    "Prepare a chord silently before pressing all notes together.",
  ],
  coachTips: [
    "Shape the chord in the air, place the fingers, then press.",
    "If one note arrives late, slow down and prepare all fingers first.",
  ],
});

const frereBridge = makeTrainingSong({
  id: "frere-bridge",
  title: "Frère, Unknotted",
  subtitle: "Shrink the canon into a two-beat overlap",
  level: "Training 6 · Song bridge",
  skills: ["Frère Jacques pattern", "delayed entrance", "two-hand overlap"],
  description: "Learn the opening in each hand, then overlap only two beats at a time.",
  durationBeats: 22,
  notes: [
    ...phrase(0, "right", [60, 62, 64, 60], [1, 2, 3, 1]),
    ...phrase(4, "left", [48, 50, 52, 48], [5, 4, 3, 5]),
    ...phrase(8, "right", [60, 62, 64, 60], [1, 2, 3, 1]),
    ...phrase(10, "left", [48, 50, 52, 48], [5, 4, 3, 5]),
    ...phrase(14, "right", [60, 62, 64, 60, 60, 62, 64, 60], [1, 2, 3, 1, 1, 2, 3, 1]),
    ...phrase(18, "left", [48, 50, 52, 48], [5, 4, 3, 5]),
  ],
  sections: [
    {
      id: "each-singer",
      label: "Each Singer",
      startBeat: 0,
      endBeat: 8,
      focus: "Play the same four notes once with each hand.",
      recommendedTempoPercent: 40,
      repeatCount: 2,
    },
    {
      id: "tiny-overlap",
      label: "Tiny Overlap",
      startBeat: 8,
      endBeat: 14,
      focus: "The left hand enters after only C-D in the right hand.",
      recommendedTempoPercent: 35,
      repeatCount: 4,
    },
    {
      id: "real-entrance",
      label: "Real Entrance",
      startBeat: 14,
      endBeat: 22,
      focus: "Keep the right-hand repeat steady when the left hand enters.",
      recommendedTempoPercent: 40,
      repeatCount: 3,
    },
  ],
  handPosition: "Mirror the same C-D-E-C shape: right hand at C4 and left hand at C3.",
  learningGoals: [
    "Play the Frère Jacques opening confidently in either hand.",
    "Maintain one hand through a short delayed entrance.",
  ],
  coachTips: [
    "Hear two separate singers instead of one tangled pattern.",
    "Stay on this tiny overlap until it feels ordinary; the full song can wait.",
  ],
});

export const TRAINING_LESSONS: readonly TrainingLesson[] = [
  {
    id: "right-hand-home",
    order: 1,
    title: "Right-Hand Home",
    shortTitle: "Right home",
    eyebrow: "One hand · zero surprises",
    summary: "Park the right hand on C-D-E-F-G and connect fingers 1-5 to those keys.",
    reassurance: "Nothing moves except the finger you are using.",
    successCue: "You can walk up and back without looking down.",
    recommendedMinutes: "2-3 min",
    defaultMode: "wait",
    defaultSectionId: "walk-home",
    song: rightHandHome,
  },
  {
    id: "left-hand-home",
    order: 2,
    title: "Left-Hand Home",
    shortTitle: "Left home",
    eyebrow: "Mirror it · one hand only",
    summary: "Give the left hand the same five-key map, with finger 5 on C3.",
    reassurance: "The numbers reverse, but the physical shape stays familiar.",
    successCue: "The left hand can find C-D-E without help from the right.",
    recommendedMinutes: "2-4 min",
    defaultMode: "wait",
    defaultSectionId: "mirror-walk",
    song: leftHandHome,
  },
  {
    id: "hands-take-turns",
    order: 3,
    title: "Hands Take Turns",
    shortTitle: "Take turns",
    eyebrow: "Both ready · one plays",
    summary: "Pass one tiny melody from the right hand to the left without overlap.",
    reassurance: "This is two-hand preparation, not two-hand playing yet.",
    successCue: "The resting hand stays planted while your attention switches.",
    recommendedMinutes: "3-4 min",
    defaultMode: "wait",
    defaultSectionId: "long-handoff",
    song: handsTakeTurns,
  },
  {
    id: "first-two-hand-landing",
    order: 4,
    title: "First Two-Hand Landing",
    shortTitle: "Land together",
    eyebrow: "Two notes · one motion",
    summary: "Land matching notes together, then hold one hand while the other moves.",
    reassurance: "Only one hand moves at a time after the first landing.",
    successCue: "Both notes arrive together and a held C stays quiet and relaxed.",
    recommendedMinutes: "4-5 min",
    defaultMode: "wait",
    defaultSectionId: "land-together",
    song: firstTwoHandLanding,
  },
  {
    id: "build-a-chord",
    order: 5,
    title: "Build a C Chord",
    shortTitle: "First chord",
    eyebrow: "Shape first · press second",
    summary: "Build C-E-G one note at a time, then play the finished chord together.",
    reassurance: "A chord is just several prepared fingers landing once.",
    successCue: "C, E, and G sound together without a rolled or late note.",
    recommendedMinutes: "3-5 min",
    defaultMode: "wait",
    defaultSectionId: "right-chord-shape",
    song: buildAChord,
  },
  {
    id: "frere-bridge",
    order: 6,
    title: "Frère, Unknotted",
    shortTitle: "Frère bridge",
    eyebrow: "The missing bridge",
    summary: "Practice each singer alone, then shrink the canon to a two-beat overlap.",
    reassurance: "You are not expected to jump straight into the full 32-note overlap.",
    successCue: "The left entrance no longer knocks the right hand off its pattern.",
    recommendedMinutes: "5-8 min",
    defaultMode: "wait",
    defaultSectionId: "each-singer",
    song: frereBridge,
  },
] as const;

export const TRAINING_SONGS: readonly Song[] = TRAINING_LESSONS.map(
  (lesson) => lesson.song,
);

export function getTrainingLesson(id: string): TrainingLesson | undefined {
  return TRAINING_LESSONS.find((lesson) => lesson.id === id);
}

export function getTrainingLessonBySongId(
  songId: string,
): TrainingLesson | undefined {
  return TRAINING_LESSONS.find((lesson) => lesson.song.id === songId);
}

export function getTrainingSection(
  lesson: TrainingLesson,
  sectionId: string | null | undefined,
): SongSection {
  return (
    lesson.song.sections.find((section) => section.id === sectionId) ??
    lesson.song.sections.find(
      (section) => section.id === lesson.defaultSectionId,
    ) ??
    lesson.song.sections[0]
  );
}

export function getNotesInSection(
  song: Song,
  section: Pick<SongSection, "startBeat" | "endBeat">,
): SongNote[] {
  return song.notes.filter(
    (songNote) =>
      songNote.startBeat >= section.startBeat - 0.000_001 &&
      songNote.startBeat < section.endBeat - 0.000_001,
  );
}

export function getNextTrainingLanding(
  song: Song,
  beat: number,
  completedNoteIds?: ReadonlySet<string>,
  section?: Pick<SongSection, "startBeat" | "endBeat">,
): TrainingLanding | null {
  const minimumBeat = section?.startBeat ?? 0;
  const maximumBeat = section?.endBeat ?? song.durationBeats;
  const unresolved = song.notes
    .filter(
      (songNote) =>
        !completedNoteIds?.has(songNote.id) &&
        songNote.startBeat >= Math.max(minimumBeat, beat - 0.04) &&
        songNote.startBeat < maximumBeat - 0.000_001,
    )
    .sort((left, right) =>
      left.startBeat - right.startBeat || left.midi - right.midi,
    );

  const first = unresolved[0];
  if (!first) return null;

  return {
    beat: first.startBeat,
    notes: song.notes
      .filter(
        (songNote) =>
          Math.abs(songNote.startBeat - first.startBeat) < 0.000_001 &&
          songNote.startBeat >= minimumBeat &&
          songNote.startBeat < maximumBeat,
      )
      .sort((left, right) => left.midi - right.midi),
  };
}

export function nextTrainingLesson(
  lesson: TrainingLesson,
  direction: -1 | 1,
): TrainingLesson | null {
  const index = TRAINING_LESSONS.findIndex(
    (candidate) => candidate.id === lesson.id,
  );
  return TRAINING_LESSONS[index + direction] ?? null;
}
