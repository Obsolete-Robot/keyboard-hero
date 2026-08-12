export type PowerJudgementGrade = "perfect" | "great" | "good" | "miss";

export interface KeyboardHeroPowerState {
  /** Earned meter fill. Remains full while POWER MODE is active. */
  charge: number;
  active: boolean;
  multiplier: number;
  /** Normalized presentation/audio intensity. */
  energy: number;
  /** Monotonic within one practice run; useful for one-shot visual effects. */
  activations: number;
}

export interface PowerJudgementOutcome {
  state: KeyboardHeroPowerState;
  activated: boolean;
}

export const POWER_MODE_SCORE_MULTIPLIER = 2;
const POWER_CHARGE_EPSILON = 0.000_000_001;

const POWER_CHARGE_BY_GRADE: Readonly<
  Record<Exclude<PowerJudgementGrade, "miss">, number>
> = {
  perfect: 0.12,
  great: 0.1,
  good: 0.08,
};

const SCORE_BY_GRADE: Readonly<
  Record<Exclude<PowerJudgementGrade, "miss">, number>
> = {
  perfect: 1000,
  great: 700,
  good: 450,
};

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Stable identity shared by every note authored at the same song timestamp. */
export function authoredChordGroupId(songId: string, startBeat: number): string {
  const timestamp = Number.isFinite(startBeat)
    ? Math.round(startBeat * 1_000_000)
    : 0;
  return `${songId}:chord:${timestamp}`;
}

export function createPowerModeState(): KeyboardHeroPowerState {
  return {
    charge: 0,
    active: false,
    multiplier: 1,
    energy: 0,
    activations: 0,
  };
}

/** Clears live power at a run boundary while retaining its activation count. */
export function completePowerMode(
  current: KeyboardHeroPowerState,
): KeyboardHeroPowerState {
  if (!current.active && current.charge === 0 && current.energy === 0) {
    return current;
  }
  return {
    ...current,
    charge: 0,
    active: false,
    multiplier: 1,
    energy: 0,
  };
}

export function pointsForJudgement(
  grade: PowerJudgementGrade,
  combo: number,
  multiplier: number,
): number {
  if (grade === "miss") return 0;
  const safeCombo = Number.isFinite(combo) ? Math.max(0, Math.trunc(combo)) : 0;
  const safeMultiplier = Number.isFinite(multiplier)
    ? Math.max(1, multiplier)
    : 1;
  const base = SCORE_BY_GRADE[grade] + Math.min(500, safeCombo * 10);
  return Math.round(base * safeMultiplier);
}

/**
 * Locks one score multiplier to an authored timestamp group. Physical MIDI
 * devices are free to emit simultaneous chord tones in any order; this latch
 * keeps that ordering from changing the chord's total award.
 */
export function latchChordScoreMultiplier(
  ledger: Map<string, number>,
  chordKey: string,
  currentMultiplier: number,
): number {
  const latched = ledger.get(chordKey);
  if (latched !== undefined) return latched;
  const normalized = Number.isFinite(currentMultiplier)
    ? Math.max(1, currentMultiplier)
    : 1;
  ledger.set(chordKey, normalized);
  return normalized;
}

/**
 * Applies exactly one resolved player judgement. Callers remain responsible
 * for deduplicating scheduled note ids; the returned activation flag makes a
 * chord that crosses the threshold produce one transition, not one per tone.
 */
export function applyPowerJudgement(
  current: KeyboardHeroPowerState,
  grade: PowerJudgementGrade,
): PowerJudgementOutcome {
  if (grade === "miss") {
    return {
      state: {
        ...current,
        charge: 0,
        active: false,
        multiplier: 1,
        energy: 0,
      },
      activated: false,
    };
  }

  if (current.active) {
    // Power is tied to the live combo, not a transport timer. Every successful
    // judgement keeps it fully active until a miss breaks the streak.
    return {
      state: { ...current, energy: 1 },
      activated: false,
    };
  }

  const charge = clamp01(current.charge + POWER_CHARGE_BY_GRADE[grade]);
  if (charge < 1 - POWER_CHARGE_EPSILON) {
    return {
      state: {
        ...current,
        charge,
        energy: charge,
      },
      activated: false,
    };
  }

  return {
    state: {
      ...current,
      charge: 1,
      active: true,
      multiplier: POWER_MODE_SCORE_MULTIPLIER,
      energy: 1,
      activations: current.activations + 1,
    },
    activated: true,
  };
}
