import type { SongNote } from "@/lib/songs";

export type TimingGrade = "perfect" | "great" | "good" | "miss";
export type SustainGrade = "full" | "partial" | "early-release";

export const PERFECT_WINDOW_MS = 55;
export const GREAT_WINDOW_MS = 105;
export const GOOD_WINDOW_MS = 180;
export const EARLY_CAPTURE_BEATS = 0.25;
export const EARLY_CAPTURE_MIN_MS = 240;
export const EARLY_CAPTURE_MAX_MS = 320;
export const TAP_DURATION_BEATS = 0.5;
export const SUSTAIN_RELEASE_GRACE_MS = 120;
export const HOLD_POINTS_PER_BEAT = 120;

export interface PressCandidate {
  note: SongNote;
  offsetMs: number;
  armed: boolean;
}

export interface SustainRequirement {
  eligible: boolean;
  releaseGraceBeats: number;
  requiredBeats: number;
}

export interface SustainJudgement {
  grade: SustainGrade;
  heldBeats: number;
  requiredBeats: number;
  progress: number;
  pointsAwarded: number;
  multiplier: number;
  /** Mode-and-tempo scoring rate latched when the note attack was judged. */
  scoreRate: number;
}

/** Clear both sides of the transient note/source ownership registry. */
export function clearNoteClaims<T>(
  claimsByNoteId: Map<string, T>,
  noteIdBySource: Map<string, string>,
): void {
  claimsByNoteId.clear();
  noteIdBySource.clear();
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function timingGradeForOffset(
  offsetMs: number,
  earlyCaptured = false,
): TimingGrade {
  const absoluteOffset = Math.abs(offsetMs);
  if (absoluteOffset <= PERFECT_WINDOW_MS) return "perfect";
  if (absoluteOffset <= GREAT_WINDOW_MS) return "great";
  if (absoluteOffset <= GOOD_WINDOW_MS) return "good";
  if (earlyCaptured && offsetMs < -GOOD_WINDOW_MS) return "good";
  return "miss";
}

export function earlyCaptureWindowMs(millisecondsPerBeat: number): number {
  if (!Number.isFinite(millisecondsPerBeat) || millisecondsPerBeat <= 0) {
    return GOOD_WINDOW_MS;
  }
  return clamp(
    millisecondsPerBeat * EARLY_CAPTURE_BEATS,
    EARLY_CAPTURE_MIN_MS,
    EARLY_CAPTURE_MAX_MS,
  );
}

export function findPressCandidate(
  notes: readonly SongNote[],
  midi: number,
  judgedBeat: number,
  millisecondsPerBeat: number,
  unavailableNoteIds: ReadonlySet<string>,
): PressCandidate | null {
  if (
    !Number.isFinite(judgedBeat) ||
    !Number.isFinite(millisecondsPerBeat) ||
    millisecondsPerBeat <= 0
  ) {
    return null;
  }

  const earlyWindow = earlyCaptureWindowMs(millisecondsPerBeat);
  let best: PressCandidate | null = null;
  for (const note of notes) {
    if (note.midi !== midi || unavailableNoteIds.has(note.id)) continue;
    const offsetMs = (judgedBeat - note.startBeat) * millisecondsPerBeat;
    if (offsetMs < -earlyWindow || offsetMs > GOOD_WINDOW_MS) continue;
    const candidate = {
      note,
      offsetMs,
      armed: offsetMs < -GOOD_WINDOW_MS,
    };
    if (
      best === null ||
      Math.abs(candidate.offsetMs) < Math.abs(best.offsetMs) ||
      (Math.abs(candidate.offsetMs) === Math.abs(best.offsetMs) &&
        candidate.note.startBeat < best.note.startBeat)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function noteWithinPlaybackRange(
  note: SongNote,
  startBeat: number,
  endBeat: number,
): boolean {
  return (
    note.startBeat >= startBeat - 0.000_001 &&
    note.startBeat < endBeat - 0.000_001
  );
}

export function sustainRequirement(
  durationBeats: number,
  millisecondsPerBeat: number,
): SustainRequirement {
  const normalizedDuration = Number.isFinite(durationBeats)
    ? Math.max(0, durationBeats)
    : 0;
  if (
    normalizedDuration <= TAP_DURATION_BEATS ||
    !Number.isFinite(millisecondsPerBeat) ||
    millisecondsPerBeat <= 0
  ) {
    return { eligible: false, releaseGraceBeats: 0, requiredBeats: 0 };
  }
  const releaseGraceBeats = Math.min(
    SUSTAIN_RELEASE_GRACE_MS / millisecondsPerBeat,
    normalizedDuration * 0.25,
  );
  return {
    eligible: true,
    releaseGraceBeats,
    requiredBeats: Math.max(0, normalizedDuration - releaseGraceBeats),
  };
}

export function judgeSustain(
  heldBeats: number,
  requiredBeats: number,
  multiplier = 1,
  scoreRate = 1,
): SustainJudgement {
  const normalizedHeld = Number.isFinite(heldBeats) ? Math.max(0, heldBeats) : 0;
  const normalizedRequired =
    Number.isFinite(requiredBeats) && requiredBeats > 0 ? requiredBeats : 0;
  const normalizedMultiplier =
    Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const normalizedScoreRate =
    Number.isFinite(scoreRate) && scoreRate >= 0 ? scoreRate : 1;
  const progress = normalizedRequired > 0
    ? clamp(normalizedHeld / normalizedRequired, 0, 1)
    : 0;
  const grade: SustainGrade =
    progress >= 1 - 1e-9
      ? "full"
      : progress >= 0.5
        ? "partial"
        : "early-release";
  return {
    grade,
    heldBeats: normalizedHeld,
    requiredBeats: normalizedRequired,
    progress,
    pointsAwarded: Math.round(
      HOLD_POINTS_PER_BEAT *
        normalizedRequired *
        progress *
        normalizedMultiplier *
        normalizedScoreRate,
    ),
    multiplier: normalizedMultiplier,
    scoreRate: normalizedScoreRate,
  };
}
