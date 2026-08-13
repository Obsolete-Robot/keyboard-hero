import { pointsForJudgement } from "./powerMode.ts";
import type { Song } from "./songs.ts";
import { judgeSustain, sustainRequirement } from "./sustainScoring.ts";

export type ScoredPracticeMode = "flow" | "wait" | "listen";

const MODE_SCORE_RATE: Readonly<Record<ScoredPracticeMode, number>> = {
  flow: 1,
  wait: 0,
  listen: 0,
};

/**
 * Converts the current practice difficulty into the rate applied to every
 * earned point. Flow receives the full tempo rate. Wait and Listen remain
 * unscored because neither mode tests live performance timing.
 */
export function scoreRateForSettings(
  mode: ScoredPracticeMode,
  tempoScale: number,
): number {
  const normalizedTempo = Number.isFinite(tempoScale)
    ? Math.min(1.25, Math.max(0.25, tempoScale))
    : 1;
  return MODE_SCORE_RATE[mode] * normalizedTempo;
}

/** Perfect authored-tempo Flow target before optional POWER bonuses. */
export function targetScoreForSong(song: Song): number {
  const millisecondsPerBeat = 60_000 / song.bpm;
  let combo = 0;
  let points = 0;

  for (const note of song.notes) {
    combo += 1;
    points += pointsForJudgement("perfect", combo, 1, 1);

    const requirement = sustainRequirement(
      note.durationBeats,
      millisecondsPerBeat,
    );
    if (requirement.eligible) {
      points += judgeSustain(
        requirement.requiredBeats,
        requirement.requiredBeats,
        1,
        1,
      ).pointsAwarded;
    }
  }

  return points;
}
