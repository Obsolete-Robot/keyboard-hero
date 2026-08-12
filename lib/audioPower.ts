export interface PowerModeProfile {
  /** Smoothed, normalized performance energy. */
  amount: number;
  /** Direct buses leave a little headroom for the parallel excitement path. */
  instrumentGain: number;
  accompanimentGainScale: number;
  instrumentReverbSend: number;
  accompanimentReverbSend: number;
  reverbWet: number;
  saturationInstrumentSend: number;
  saturationAccompanimentSend: number;
  compressorThreshold: number;
  stereoWidthScale: number;
  brightnessLiftHz: number;
  bodyGain: number;
  hammerGain: number;
  octaveGain: number;
}

const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * A smoothstep keeps the first hint of POWER MODE tasteful while allowing the
 * final third of the meter to feel meaningfully larger.
 */
export function powerAmount(active: boolean, intensity = 1): number {
  if (!active) return 0;
  const normalized = clampUnit(intensity);
  return normalized * normalized * (3 - 2 * normalized);
}

export function derivePowerModeProfile(
  active: boolean,
  intensity = 1,
): PowerModeProfile {
  const amount = powerAmount(active, intensity);
  return {
    amount,
    instrumentGain: 1 - amount * 0.04,
    accompanimentGainScale: 1 - amount * 0.07,
    instrumentReverbSend: 0.16 + amount * 0.065,
    accompanimentReverbSend: 0.095 + amount * 0.03,
    reverbWet: 0.2 + amount * 0.025,
    saturationInstrumentSend: amount * 0.1,
    saturationAccompanimentSend: amount * 0.052,
    compressorThreshold: -15 - amount * 2.5,
    stereoWidthScale: 1 + amount * 0.34,
    brightnessLiftHz: amount * 1_450,
    bodyGain: 1 + amount * 0.15,
    hammerGain: 1 + amount * 0.34,
    octaveGain: amount * 0.17,
  };
}

/** Preserve soft playing while making confident velocities bloom in POWER. */
export function shapePowerVelocity(velocity: number, amount: number): number {
  const normalizedVelocity = clampUnit(velocity);
  const normalizedPower = clampUnit(amount);
  const lift = normalizedPower * (0.055 + normalizedVelocity ** 2 * 0.22);
  return Math.min(1, Math.max(0.03, normalizedVelocity * (1 + lift)));
}

export function powerAccompanimentIntensity(
  intensity: number,
  amount: number,
): number {
  const normalizedIntensity = clampUnit(intensity);
  const normalizedPower = clampUnit(amount);
  return Math.min(
    1,
    normalizedIntensity + normalizedPower * (0.1 + normalizedIntensity * 0.1),
  );
}

/** A deterministic, bounded curve for the low-level parallel saturation bus. */
export function createPowerSaturationCurve(
  sampleCount = 1_024,
): Float32Array<ArrayBuffer> {
  const requestedLength = Number.isFinite(sampleCount)
    ? Math.floor(sampleCount)
    : 1_024;
  const length = Math.min(65_536, Math.max(32, requestedLength));
  const curve = new Float32Array(
    new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT),
  );
  const drive = 1.8;
  const normalization = Math.tanh(drive);
  for (let index = 0; index < length; index += 1) {
    const input = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.tanh(input * drive) / normalization;
  }
  return curve;
}
