export type ScoredPracticeMode = "flow" | "wait" | "listen";

const MODE_SCORE_RATE: Readonly<Record<ScoredPracticeMode, number>> = {
  flow: 1,
  wait: 0.5,
  listen: 0,
};

/**
 * Converts the current practice difficulty into the rate applied to every
 * earned point. Flow receives the full tempo rate, while Wait receives half
 * because the transport stops for unresolved notes. Listen remains unscored.
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
