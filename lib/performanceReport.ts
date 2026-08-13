import type {
  KeyboardHeroScore,
  NoteResult,
  PracticeMode,
} from "@/hooks/useKeyboardHeroCore";
import type { Song } from "@/lib/songs";
import { targetScoreForSong } from "./scoreDifficulty.ts";

export type ResultTone =
  | "legendary"
  | "rockstar"
  | "locked"
  | "rising"
  | "practice";

export interface ResultRow {
  label: string;
  detail: string;
  points: number;
  tone: "perfect" | "great" | "good" | "miss" | "bonus";
}

export interface PerformanceReport {
  grade: string;
  gradeLabel: string;
  title: string;
  message: string;
  tone: ResultTone;
  testScore: number | null;
  targetScore: number;
  perfectRun: boolean;
  rows: ResultRow[];
  attempts: number;
  extraMisses: number;
  missedOrUnplayed: number;
}

function reportCopy(testScore: number) {
  if (testScore >= 97) {
    return {
      grade: "A+",
      gradeLabel: "A plus",
      title: "Headliner status",
      message: "That was precision with swagger. The stage is yours — take the encore.",
      tone: "legendary" as const,
    };
  }
  if (testScore >= 93) {
    return {
      grade: "A",
      gradeLabel: "A",
      title: "Arena ready",
      message: "A sharp, controlled set. Chase the last few milliseconds and make it legendary.",
      tone: "rockstar" as const,
    };
  }
  if (testScore >= 90) {
    return {
      grade: "A−",
      gradeLabel: "A minus",
      title: "Main-stage material",
      message: "The groove is locked. Clean up one phrase and the top mark is waiting.",
      tone: "rockstar" as const,
    };
  }
  if (testScore >= 87) {
    return {
      grade: "B+",
      gradeLabel: "B plus",
      title: "Locked in",
      message: "Strong hands, strong pulse. Tighten the rough edges and run it back louder.",
      tone: "locked" as const,
    };
  }
  if (testScore >= 83) {
    return {
      grade: "B",
      gradeLabel: "B",
      title: "Strong set",
      message: "The song is under your fingers. Loop the shaky bars and turn control into instinct.",
      tone: "locked" as const,
    };
  }
  if (testScore >= 80) {
    return {
      grade: "B−",
      gradeLabel: "B minus",
      title: "Groove secured",
      message: "You held the room. Slow the hardest phrase down and sharpen the landing.",
      tone: "locked" as const,
    };
  }
  if (testScore >= 77) {
    return {
      grade: "C+",
      gradeLabel: "C plus",
      title: "Rising star",
      message: "The shape is there. Build a longer clean streak and the whole score jumps.",
      tone: "rising" as const,
    };
  }
  if (testScore >= 73) {
    return {
      grade: "C",
      gradeLabel: "C",
      title: "Solid rehearsal",
      message: "You made the finish line. Loop the misses, breathe, and own the next run.",
      tone: "rising" as const,
    };
  }
  if (testScore >= 70) {
    return {
      grade: "C−",
      gradeLabel: "C minus",
      title: "Set taking shape",
      message: "The foundation is real. Drop the tempo and make every landing deliberate.",
      tone: "rising" as const,
    };
  }
  if (testScore >= 60) {
    return {
      grade: "D",
      gradeLabel: "D",
      title: "Keep the meter running",
      message: "Finishing counts. Work one section at a time and turn misses into targets.",
      tone: "practice" as const,
    };
  }
  return {
    grade: "F",
    gradeLabel: "F",
    title: "First take logged",
    message: "No shame in a first take. Slow it down, use Wait mode, and build the comeback.",
    tone: "practice" as const,
  };
}

export function buildPerformanceReport(
  song: Song,
  noteResults: ReadonlyMap<string, NoteResult>,
  score: KeyboardHeroScore,
  mode: PracticeMode,
): PerformanceReport {
  const isTimingScored = mode === "flow";
  const counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  const timingPoints = { perfect: 0, great: 0, good: 0 };
  const sustainCounts = { full: 0, partial: 0, earlyRelease: 0 };
  let hasDifficultyAdjustedPoints = false;
  for (const note of song.notes) {
    const result = noteResults.get(note.id);
    if (!result) continue;
    counts[result.grade] += 1;
    if (isTimingScored && result.grade !== "miss") {
      const nominalPoints =
        result.grade === "perfect"
          ? 1000
          : result.grade === "great"
            ? 700
            : 450;
      if (typeof result.basePointsAwarded === "number") {
        timingPoints[result.grade] += result.basePointsAwarded;
        hasDifficultyAdjustedPoints ||= result.basePointsAwarded !== nominalPoints;
      } else {
        timingPoints[result.grade] += nominalPoints;
      }
    }
    if (result.sustain?.grade === "full") sustainCounts.full += 1;
    else if (result.sustain?.grade === "partial") sustainCounts.partial += 1;
    else if (result.sustain?.grade === "early-release") {
      sustainCounts.earlyRelease += 1;
    }
  }

  const attempts = counts.perfect + counts.great + counts.good + counts.miss;
  const unplayed = Math.max(0, song.notes.length - attempts);
  const extraMisses = Math.max(0, score.misses - counts.miss);
  const missedOrUnplayed = counts.miss + unplayed + extraMisses;
  const basePoints =
    timingPoints.perfect + timingPoints.great + timingPoints.good;
  const sustainPoints = Math.max(0, score.sustainPoints);
  const streakBonus = Math.max(
    0,
    score.points - basePoints - sustainPoints,
  );
  const targetScore = targetScoreForSong(song);
  const scorePercent =
    targetScore > 0 ? (score.points / targetScore) * 100 : 0;
  const accuracyRate = Math.min(1, Math.max(0, score.accuracy / 100));
  const successfulNotes = counts.perfect + counts.great + counts.good;
  const completionRate = song.notes.length > 0
    ? Math.min(1, successfulNotes / song.notes.length)
    : 0;
  const testScore =
    isTimingScored
      ? Math.min(100, Math.round(scorePercent * accuracyRate))
      : mode === "wait"
        ? Math.floor(86 * completionRate * accuracyRate)
        : 0;
  const perfectRun =
    mode === "flow" &&
    successfulNotes === song.notes.length &&
    missedOrUnplayed === 0 &&
    score.misses === 0 &&
    score.accuracy >= 100 - 0.000_001;

  const timingDetail = (count: number, nominal: string) =>
    !isTimingScored
      ? `${count} notes · unscored in ${mode === "wait" ? "Wait" : "Listen"} mode`
      : hasDifficultyAdjustedPoints
        ? `${count} notes · tempo adjusted`
        : `${count} × ${nominal}`;

  const rows: ResultRow[] = [
    {
      label: "Perfect timing",
      detail: timingDetail(counts.perfect, "1,000"),
      points: timingPoints.perfect,
      tone: "perfect",
    },
    {
      label: "Great timing",
      detail: timingDetail(counts.great, "700"),
      points: timingPoints.great,
      tone: "great",
    },
    {
      label: "Good timing",
      detail: timingDetail(counts.good, "450"),
      points: timingPoints.good,
      tone: "good",
    },
    {
      label: "Missed / unplayed",
      detail: `${counts.miss} missed · ${unplayed} unplayed · ${extraMisses} extras`,
      points: 0,
      tone: "miss",
    },
    {
      label: "Sustain bonus",
      detail:
        sustainCounts.full + sustainCounts.partial + sustainCounts.earlyRelease >
        0
          ? `${sustainCounts.full} full · ${sustainCounts.partial} partial · ${sustainCounts.earlyRelease} early release`
          : "No scored holds",
      points: sustainPoints,
      tone: "bonus",
    },
    {
      label: "Streak + Power bonus",
      detail: `${score.bestCombo}× peak combo · includes powered notes`,
      points: streakBonus,
      tone: "bonus",
    },
  ];

  if (mode === "listen" && attempts === 0) {
    return {
      grade: "DEMO",
      gradeLabel: "Demo",
      title: "Demo complete",
      message: "You heard the full arrangement. Switch to Flow to earn a score.",
      tone: "practice",
      testScore: null,
      targetScore,
      perfectRun: false,
      rows,
      attempts,
      extraMisses,
      missedOrUnplayed,
    };
  }

  return {
    ...reportCopy(testScore),
    testScore,
    targetScore,
    perfectRun,
    rows,
    attempts,
    extraMisses,
    missedOrUnplayed,
  };
}
