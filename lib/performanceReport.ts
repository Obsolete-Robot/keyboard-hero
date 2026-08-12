import type {
  KeyboardHeroScore,
  NoteResult,
  PracticeMode,
} from "@/hooks/useKeyboardHeroCore";
import type { Song } from "@/lib/songs";

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
  rows: ResultRow[];
  attempts: number;
  extraMisses: number;
  missedOrUnplayed: number;
}

export const TIMING_WEIGHTS = {
  perfect: 100,
  great: 95,
  good: 82,
  miss: 0,
} as const;

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
  const counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  const sustainCounts = { full: 0, partial: 0, earlyRelease: 0 };

  for (const note of song.notes) {
    const result = noteResults.get(note.id);
    if (!result) continue;
    counts[result.grade] += 1;
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
    counts.perfect * 1000 + counts.great * 700 + counts.good * 450;
  const sustainPoints = Math.max(0, score.sustainPoints);
  const streakBonus = Math.max(
    0,
    score.points - basePoints - sustainPoints,
  );
  const weightedTiming =
    counts.perfect * TIMING_WEIGHTS.perfect +
    counts.great * TIMING_WEIGHTS.great +
    counts.good * TIMING_WEIGHTS.good;
  const gradedAttempts = song.notes.length + extraMisses;
  const testScore = gradedAttempts
    ? Math.round(weightedTiming / gradedAttempts)
    : 0;

  const rows: ResultRow[] = [
    {
      label: "Perfect timing",
      detail: `${counts.perfect} × 1,000`,
      points: counts.perfect * 1000,
      tone: "perfect",
    },
    {
      label: "Great timing",
      detail: `${counts.great} × 700`,
      points: counts.great * 700,
      tone: "great",
    },
    {
      label: "Good timing",
      detail: `${counts.good} × 450`,
      points: counts.good * 450,
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
      message: "You heard the full arrangement. Switch to Flow or Wait to earn your score.",
      tone: "practice",
      testScore: null,
      rows,
      attempts,
      extraMisses,
      missedOrUnplayed,
    };
  }

  return {
    ...reportCopy(testScore),
    testScore,
    rows,
    attempts,
    extraMisses,
    missedOrUnplayed,
  };
}
