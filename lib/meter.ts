/**
 * Meter helpers for the app's quarter-note transport.
 *
 * A "beat" in song data is always one quarter note, regardless of the
 * displayed time signature. Compound meters still pulse in dotted units:
 * 6/8 has two 1.5-quarter-note pulses inside a three-quarter-note measure.
 */
export type TimeSignature = readonly [numerator: number, denominator: number];

export interface MeterGrid {
  /** Measure length expressed in the transport's quarter-note beats. */
  measureBeats: number;
  /** Musical pulse length expressed in quarter-note beats. */
  pulseBeats: number;
  pulsesPerMeasure: number;
  /** Written beat-unit length expressed in quarter-note beats. */
  beatUnitBeats: number;
  compound: boolean;
}

const EPSILON = 0.000_001;

export function meterGrid(timeSignature: TimeSignature): MeterGrid {
  const numerator = Math.max(1, Math.floor(timeSignature[0]));
  const denominator = Math.max(1, Math.floor(timeSignature[1]));
  const beatUnitBeats = 4 / denominator;
  const compound = numerator >= 6 && numerator % 3 === 0;
  const pulsesPerMeasure = compound ? numerator / 3 : numerator;
  const pulseBeats = beatUnitBeats * (compound ? 3 : 1);

  return {
    measureBeats: numerator * beatUnitBeats,
    pulseBeats,
    pulsesPerMeasure,
    beatUnitBeats,
    compound,
  };
}

/** Stable pulse number on either side of beat zero, including count-ins. */
export function pulseIndexAtBeat(
  beat: number,
  timeSignature: TimeSignature,
): number {
  if (!Number.isFinite(beat)) return 0;
  return Math.floor((beat + EPSILON) / meterGrid(timeSignature).pulseBeats);
}

export function isDownbeatPulse(
  pulseIndex: number,
  timeSignature: TimeSignature,
): boolean {
  const { pulsesPerMeasure } = meterGrid(timeSignature);
  return ((pulseIndex % pulsesPerMeasure) + pulsesPerMeasure) % pulsesPerMeasure === 0;
}
