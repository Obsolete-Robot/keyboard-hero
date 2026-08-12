import type { Finger, Hand, Song, SongNote } from "@/lib/songs";

export type PianoHand = Exclude<Hand, "both">;
export type SongHandMode = PianoHand | "both";
export type PianoFingerId = `${PianoHand}-${Finger}`;

export interface PianoFingerDescriptor {
  id: PianoFingerId;
  hand: PianoHand;
  finger: Finger;
  name: "thumb" | "index" | "middle" | "ring" | "pinky";
  /** Human-readable compact label, for example “R2” or “L5”. */
  shortLabel: string;
}

export interface RecommendedFingering {
  noteId: string;
  midi: number;
  startBeat: number;
  hand: PianoHand;
  finger: Finger;
  fingerId: PianoFingerId;
  /** True when the concrete left/right hand came directly from the score. */
  handIsAuthored: boolean;
  /** True when the finger number came directly from the score. */
  fingerIsAuthored: boolean;
}

export interface SongFingeringGuide {
  handMode: SongHandMode;
  /** Stable keyboard order: left hand, then right hand. */
  hands: readonly PianoHand[];
  /** The five or ten fingers that should be represented by the UI. */
  fingers: readonly PianoFingerDescriptor[];
  /** Recommendations in the same order as the score's notes. */
  notes: readonly RecommendedFingering[];
  byNoteId: ReadonlyMap<string, RecommendedFingering>;
  /** Impossible or contradictory imported landings that need human editing. */
  conflicts: readonly FingeringConflict[];
}

export interface FingeringConflict {
  kind: "hand-capacity" | "finger-collision";
  startBeat: number;
  hand: PianoHand;
  noteIds: readonly string[];
  message: string;
}

type FingeringSong = Pick<Song, "notes">;

const FINGERS = [1, 2, 3, 4, 5] as const;
const FINGER_NAMES = {
  1: "thumb",
  2: "index",
  3: "middle",
  4: "ring",
  5: "pinky",
} as const satisfies Record<Finger, PianoFingerDescriptor["name"]>;

/** UI order follows the fingers' left-to-right position over the keyboard. */
export const PIANO_FINGERS: readonly PianoFingerDescriptor[] = [
  ...[5, 4, 3, 2, 1].map((finger) => describeFinger("left", finger as Finger)),
  ...FINGERS.map((finger) => describeFinger("right", finger)),
];

function describeFinger(
  hand: PianoHand,
  finger: Finger,
): PianoFingerDescriptor {
  return {
    id: `${hand}-${finger}`,
    hand,
    finger,
    name: FINGER_NAMES[finger],
    shortLabel: `${hand === "left" ? "L" : "R"}${finger}`,
  };
}

function isConcreteHand(hand: Hand | undefined): hand is PianoHand {
  return hand === "left" || hand === "right";
}

function isFinger(finger: Finger | undefined): finger is Finger {
  return finger !== undefined && FINGERS.includes(finger);
}

function groupLandings(notes: readonly SongNote[]): SongNote[][] {
  const sorted = [...notes].sort(
    (left, right) =>
      left.startBeat - right.startBeat ||
      left.midi - right.midi ||
      left.id.localeCompare(right.id),
  );
  const landings: SongNote[][] = [];

  for (const note of sorted) {
    const landing = landings.at(-1);
    if (
      !landing ||
      Math.abs(landing[0].startBeat - note.startBeat) > 0.000_001
    ) {
      landings.push([note]);
    } else {
      landing.push(note);
    }
  }

  return landings;
}

function inferMode(notes: readonly SongNote[]): SongHandMode {
  const authoredHands = new Set<PianoHand>();
  let explicitlyUsesBothHands = false;
  let minimumMidi = Number.POSITIVE_INFINITY;
  let maximumMidi = Number.NEGATIVE_INFINITY;
  let maximumLandingSize = 0;

  for (const note of notes) {
    if (isConcreteHand(note.hand)) authoredHands.add(note.hand);
    if (note.hand === "both") explicitlyUsesBothHands = true;
    minimumMidi = Math.min(minimumMidi, note.midi);
    maximumMidi = Math.max(maximumMidi, note.midi);
  }
  for (const landing of groupLandings(notes)) {
    maximumLandingSize = Math.max(maximumLandingSize, landing.length);
  }

  if (explicitlyUsesBothHands || authoredHands.size === 2) return "both";
  if (authoredHands.has("left")) return "left";
  if (authoredHands.has("right")) return "right";

  // Scores without fingering default to the right hand when they fit under one
  // hand. Wider music and six-note-or-larger landings need both hands.
  return maximumMidi - minimumMidi > 12 || maximumLandingSize > 5
    ? "both"
    : "right";
}

/** Detect whether a score asks for the left hand, right hand, or both. */
export function detectSongHandMode(song: FingeringSong): SongHandMode {
  return inferMode(song.notes);
}

/** Return the five or ten UI finger tokens for the requested hand mode. */
export function getFingerDescriptorsForMode(
  handMode: SongHandMode,
): readonly PianoFingerDescriptor[] {
  if (handMode === "both") return PIANO_FINGERS;
  return PIANO_FINGERS.filter((finger) => finger.hand === handMode);
}

function handBoundary(notes: readonly SongNote[]): number {
  const authoredLeft = notes
    .filter((note) => note.hand === "left")
    .map((note) => note.midi);
  const authoredRight = notes
    .filter((note) => note.hand === "right")
    .map((note) => note.midi);

  if (authoredLeft.length > 0 && authoredRight.length > 0) {
    const highestLeft = Math.max(...authoredLeft);
    const lowestRight = Math.min(...authoredRight);
    if (highestLeft <= lowestRight) return (highestLeft + lowestRight) / 2;
  }

  const midis = [...notes].map((note) => note.midi).sort((a, b) => a - b);
  if (midis.length === 0) return 59.5;
  const middle = (midis.length - 1) / 2;
  const lower = midis[Math.floor(middle)];
  const upper = midis[Math.ceil(middle)];
  return (lower + upper) / 2;
}

function chooseHands(
  notes: readonly SongNote[],
  mode: SongHandMode,
): Map<string, PianoHand> {
  const assignments = new Map<string, PianoHand>();
  const previousHandByMidi = new Map<number, PianoHand>();
  const boundary = handBoundary(notes);

  for (const landing of groupLandings(notes)) {
    const handCounts: Record<PianoHand, number> = { left: 0, right: 0 };

    for (const note of landing) {
      if (!isConcreteHand(note.hand)) continue;
      assignments.set(note.id, note.hand);
      previousHandByMidi.set(note.midi, note.hand);
      handCounts[note.hand] += 1;
    }

    const unassigned = landing.filter((note) => !assignments.has(note.id));
    for (const note of unassigned) {
      if (mode !== "both") {
        assignments.set(note.id, mode);
        previousHandByMidi.set(note.midi, mode);
        handCounts[mode] += 1;
        continue;
      }

      let hand = previousHandByMidi.get(note.midi) ??
        (note.midi <= boundary ? "left" : "right");
      const otherHand: PianoHand = hand === "left" ? "right" : "left";

      // Keep a playable maximum of five simultaneous targets per inferred hand.
      if (handCounts[hand] >= 5 && handCounts[otherHand] < 5) hand = otherHand;

      assignments.set(note.id, hand);
      previousHandByMidi.set(note.midi, hand);
      handCounts[hand] += 1;
    }
  }

  return assignments;
}

function estimateHandAnchor(
  notes: readonly SongNote[],
  hand: PianoHand,
  handAssignments: ReadonlyMap<string, PianoHand>,
): number {
  const authoredAnchors = notes.flatMap((note) => {
    if (handAssignments.get(note.id) !== hand || !isFinger(note.finger)) return [];
    const fingerOffset = hand === "right" ? note.finger - 1 : 5 - note.finger;
    return [note.midi - fingerOffset * 2];
  });
  if (authoredAnchors.length > 0) {
    authoredAnchors.sort((a, b) => a - b);
    return authoredAnchors[Math.floor(authoredAnchors.length / 2)];
  }

  const handMidis = notes
    .filter((note) => handAssignments.get(note.id) === hand)
    .map((note) => note.midi);
  if (handMidis.length === 0) return hand === "left" ? 48 : 60;
  return Math.min(...handMidis);
}

function preferredFinger(
  midi: number,
  hand: PianoHand,
  anchor: number,
): Finger {
  const position = Math.max(0, Math.min(4, Math.round((midi - anchor) / 2)));
  return (hand === "right" ? position + 1 : 5 - position) as Finger;
}

function nearestAvailableFinger(
  preferred: Finger,
  used: ReadonlySet<Finger>,
): Finger {
  return FINGERS.filter((finger) => !used.has(finger)).sort(
    (left, right) =>
      Math.abs(left - preferred) - Math.abs(right - preferred) || left - right,
  )[0] ?? preferred;
}

function chooseFingers(
  notes: readonly SongNote[],
  handAssignments: ReadonlyMap<string, PianoHand>,
): Map<string, Finger> {
  const assignments = new Map<string, Finger>();
  const previousFingerByHandMidi = new Map<string, Finger>();
  const anchors: Record<PianoHand, number> = {
    left: estimateHandAnchor(notes, "left", handAssignments),
    right: estimateHandAnchor(notes, "right", handAssignments),
  };

  for (const landing of groupLandings(notes)) {
    for (const hand of ["left", "right"] as const) {
      const handNotes = landing.filter(
        (note) => handAssignments.get(note.id) === hand,
      );
      const used = new Set<Finger>();

      // Authored choices always win, even when an imported score asks one
      // finger to play multiple tones.
      for (const note of handNotes) {
        if (!isFinger(note.finger)) continue;
        assignments.set(note.id, note.finger);
        previousFingerByHandMidi.set(`${hand}:${note.midi}`, note.finger);
        used.add(note.finger);
      }

      for (const note of handNotes) {
        if (assignments.has(note.id)) continue;
        const repeatedFinger = previousFingerByHandMidi.get(
          `${hand}:${note.midi}`,
        );
        const preferred = repeatedFinger ??
          preferredFinger(note.midi, hand, anchors[hand]);
        const finger = used.has(preferred)
          ? nearestAvailableFinger(preferred, used)
          : preferred;

        assignments.set(note.id, finger);
        previousFingerByHandMidi.set(`${hand}:${note.midi}`, finger);
        used.add(finger);
      }
    }
  }

  return assignments;
}

function findFingeringConflicts(
  notes: readonly RecommendedFingering[],
): FingeringConflict[] {
  const landings = new Map<string, RecommendedFingering[]>();
  for (const note of notes) {
    const key = `${note.startBeat}:${note.hand}`;
    const landing = landings.get(key);
    if (landing) landing.push(note);
    else landings.set(key, [note]);
  }

  const conflicts: FingeringConflict[] = [];
  for (const landing of landings.values()) {
    const uniquePitches = new Set(landing.map((note) => note.midi));
    if (uniquePitches.size > 5) {
      conflicts.push({
        kind: "hand-capacity",
        startBeat: landing[0].startBeat,
        hand: landing[0].hand,
        noteIds: landing.map((note) => note.noteId),
        message: `${landing[0].hand} hand has ${uniquePitches.size} simultaneous pitches but only five fingers.`,
      });
      continue;
    }

    const notesByFinger = new Map<Finger, RecommendedFingering[]>();
    for (const note of landing) {
      const fingerNotes = notesByFinger.get(note.finger);
      if (fingerNotes) fingerNotes.push(note);
      else notesByFinger.set(note.finger, [note]);
    }
    for (const [finger, fingerNotes] of notesByFinger) {
      if (new Set(fingerNotes.map((note) => note.midi)).size <= 1) continue;
      conflicts.push({
        kind: "finger-collision",
        startBeat: landing[0].startBeat,
        hand: landing[0].hand,
        noteIds: fingerNotes.map((note) => note.noteId),
        message: `${landing[0].hand} finger ${finger} is assigned to multiple simultaneous pitches.`,
      });
    }
  }
  return conflicts;
}

/**
 * Build deterministic fingering recommendations without mutating the score.
 * Existing concrete hand and finger authoring is retained exactly. Missing
 * metadata is inferred with stable repeated-note choices and distinct fingers
 * for playable chord landings.
 */
export function buildSongFingeringGuide(
  song: FingeringSong,
): SongFingeringGuide {
  const handMode = detectSongHandMode(song);
  const handAssignments = chooseHands(song.notes, handMode);
  const fingerAssignments = chooseFingers(song.notes, handAssignments);
  const byNoteId = new Map<string, RecommendedFingering>();

  const notes = song.notes.map((note) => {
    const hand = handAssignments.get(note.id) ?? "right";
    const finger = fingerAssignments.get(note.id) ?? 1;
    const recommendation: RecommendedFingering = {
      noteId: note.id,
      midi: note.midi,
      startBeat: note.startBeat,
      hand,
      finger,
      fingerId: `${hand}-${finger}`,
      handIsAuthored: isConcreteHand(note.hand),
      fingerIsAuthored: isFinger(note.finger),
    };
    byNoteId.set(note.id, recommendation);
    return recommendation;
  });
  const hands: readonly PianoHand[] =
    handMode === "both" ? ["left", "right"] : [handMode];
  const fingers = getFingerDescriptorsForMode(handMode);

  const conflicts = findFingeringConflicts(notes);
  return { handMode, hands, fingers, notes, byNoteId, conflicts };
}

export function getRecommendedFingering(
  guide: SongFingeringGuide,
  noteOrId: Pick<SongNote, "id"> | string,
): RecommendedFingering | undefined {
  return guide.byNoteId.get(
    typeof noteOrId === "string" ? noteOrId : noteOrId.id,
  );
}
