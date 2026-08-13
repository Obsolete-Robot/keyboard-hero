import type { ChallengeLevel } from "@/lib/songCatalog";

export const SONG_PROGRESS_STORAGE_KEY = "keyboard-hero.song-progress.v1";
export const MAX_GOLD_STARS = 5;

export const SONG_RANKS = [
  "F",
  "D",
  "C−",
  "C",
  "C+",
  "B−",
  "B",
  "B+",
  "A−",
  "A",
  "A+",
] as const;

export type SongRank = (typeof SONG_RANKS)[number];

export interface SongProgressEntry {
  completedRuns: number;
  bestScore: number;
  bestRank?: SongRank;
  /** Mistake-free full Flow runs, capped at five mastery stars. */
  perfectRuns: number;
}

export interface SongProgressState {
  version: 1;
  songs: Record<
    string,
    Partial<Record<ChallengeLevel, SongProgressEntry>>
  >;
}

const CHALLENGES: readonly ChallengeLevel[] = ["easy", "medium", "hard"];

export function createSongProgress(): SongProgressState {
  return { version: 1, songs: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function normalizedRank(value: unknown): SongRank | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.replace("-", "−");
  return SONG_RANKS.find((rank) => rank === candidate);
}

function higherRank(
  current: SongRank | undefined,
  candidate: SongRank | undefined,
): SongRank | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return SONG_RANKS.indexOf(candidate) > SONG_RANKS.indexOf(current)
    ? candidate
    : current;
}

export function parseSongProgress(raw: string | null): SongProgressState {
  if (!raw) return createSongProgress();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.songs)) {
      return createSongProgress();
    }

    const progress = createSongProgress();
    for (const [familyId, storedChallenges] of Object.entries(parsed.songs)) {
      if (!familyId || !isRecord(storedChallenges)) continue;

      for (const challenge of CHALLENGES) {
        const storedEntry = storedChallenges[challenge];
        if (!isRecord(storedEntry)) continue;
        const completedRuns = normalizedInteger(storedEntry.completedRuns);
        const bestScore = normalizedInteger(storedEntry.bestScore);
        const bestRank = normalizedRank(storedEntry.bestRank);
        const perfectRuns = Math.min(
          MAX_GOLD_STARS,
          normalizedInteger(storedEntry.perfectRuns) ?? 0,
        );
        if (completedRuns === null || completedRuns < 1 || bestScore === null) {
          continue;
        }
        progress.songs[familyId] ??= {};
        progress.songs[familyId][challenge] = {
          completedRuns,
          bestScore,
          perfectRuns,
          ...(bestRank ? { bestRank } : {}),
        };
      }
    }
    return progress;
  } catch {
    return createSongProgress();
  }
}

export function getSongProgress(
  progress: SongProgressState,
  familyId: string,
  challenge: ChallengeLevel,
): SongProgressEntry | undefined {
  return progress.songs[familyId]?.[challenge];
}

export function recordSongCompletion(
  progress: SongProgressState,
  familyId: string,
  challenge: ChallengeLevel,
  score: number,
  rank?: string,
  perfectRun = false,
): SongProgressState {
  const existing = getSongProgress(progress, familyId, challenge);
  const normalizedScore = normalizedInteger(score) ?? 0;
  const bestRank = higherRank(existing?.bestRank, normalizedRank(rank));

  return {
    version: 1,
    songs: {
      ...progress.songs,
      [familyId]: {
        ...progress.songs[familyId],
        [challenge]: {
          completedRuns: (existing?.completedRuns ?? 0) + 1,
          bestScore: Math.max(existing?.bestScore ?? 0, normalizedScore),
          perfectRuns: Math.min(
            MAX_GOLD_STARS,
            (existing?.perfectRuns ?? 0) + (perfectRun ? 1 : 0),
          ),
          ...(bestRank ? { bestRank } : {}),
        },
      },
    },
  };
}

export function countClearedSongs(
  progress: SongProgressState,
  familyIds: readonly string[],
  challenge: ChallengeLevel,
): number {
  return familyIds.reduce(
    (total, familyId) =>
      total + (getSongProgress(progress, familyId, challenge) ? 1 : 0),
    0,
  );
}
