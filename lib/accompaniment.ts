import { meterGrid } from "@/lib/meter";
import type {
  AccompanimentBassTone,
  Song,
  SongAccompaniment,
} from "@/lib/songs";

const TICKS_PER_BEAT = 12;
const EPSILON = 0.000_001;

export type AccompanimentEventKind =
  | "kick"
  | "snare"
  | "closed-hat"
  | "open-hat"
  | "bass"
  | "harmony";

export type HarmonyQuality =
  | "major"
  | "minor"
  | "dominant"
  | "major-seventh"
  | "minor-seventh"
  | "diminished";

export interface HarmonicVoicing {
  symbol: string;
  rootPitchClass: number;
  quality: HarmonyQuality;
  bassMidi: number;
  pitches: readonly number[];
}

export interface AccompanimentEvent {
  /** Stable across calls for the same song and beat window. */
  id: string;
  kind: AccompanimentEventKind;
  beat: number;
  durationBeats: number;
  /** Normalized musical velocity, from 0 to 1. */
  velocity: number;
  midi?: number;
  pitches?: readonly number[];
}

export interface AccompanimentGenerationOptions {
  intensity?: number;
  drums?: boolean;
  bass?: boolean;
  harmony?: boolean;
}

interface ParsedHarmony {
  symbol: string;
  rootPitchClass: number;
  quality: HarmonyQuality;
  intervals: readonly number[];
}

const NOTE_PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const positiveModulo = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

const roundBeat = (beat: number): number =>
  Math.round(beat * TICKS_PER_BEAT) / TICKS_PER_BEAT;

const eventTick = (beat: number): number => Math.round(beat * TICKS_PER_BEAT);

const eventId = (
  song: Song,
  kind: AccompanimentEventKind,
  beat: number,
  suffix = "",
): string => `${song.id}:band:${kind}:${eventTick(beat)}${suffix}`;

export function beatsPerMeasure(
  timeSignature: readonly [beatsPerMeasure: number, beatUnit: number],
): number {
  return meterGrid(timeSignature).measureBeats;
}

function keySymbol(key: string): string {
  const match = key.trim().match(/^([A-Ga-g])([#b]?)/);
  if (!match) return "C";
  const root = `${match[1].toUpperCase()}${match[2]}`;
  return /minor/i.test(key) ? `${root}m` : root;
}

function parseHarmony(symbol: string): ParsedHarmony {
  const match = /^(C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[A-G])/.exec(symbol);
  if (!match) return parseHarmony("C");

  const rootPitchClass = NOTE_PITCH_CLASSES[match[1]];
  const suffix = symbol.slice(match[1].length);
  if (suffix.includes("dim")) {
    return {
      symbol,
      rootPitchClass,
      quality: "diminished",
      intervals: [0, 3, 6],
    };
  }
  if (suffix.startsWith("m") && !suffix.startsWith("maj")) {
    const seventh = suffix.includes("7");
    return {
      symbol,
      rootPitchClass,
      quality: seventh ? "minor-seventh" : "minor",
      intervals: seventh ? [0, 3, 7, 10] : [0, 3, 7],
    };
  }
  if (suffix.includes("maj7")) {
    return {
      symbol,
      rootPitchClass,
      quality: "major-seventh",
      intervals: [0, 4, 7, 11],
    };
  }
  if (suffix.includes("7")) {
    return {
      symbol,
      rootPitchClass,
      quality: "dominant",
      intervals: [0, 4, 7, 10],
    };
  }
  return {
    symbol,
    rootPitchClass,
    quality: "major",
    intervals: [0, 4, 7],
  };
}

function fallbackArrangement(song: Song): SongAccompaniment {
  const meter = meterGrid(song.timeSignature);
  const pulseOffsets = Array.from(
    { length: meter.pulsesPerMeasure },
    (_, index) => index / meter.pulsesPerMeasure,
  );
  return {
    arrangementId: `${song.id}:adaptive`,
    name: "Adaptive practice pulse",
    progression: [keySymbol(song.key)],
    drumKit: "brushes",
    bassVoice: "round",
    harmonyVoice: "piano",
    kick: [0],
    snare: pulseOffsets.length > 1 ? [pulseOffsets.at(-1) ?? 0] : [],
    hats: pulseOffsets,
    bass: [{ at: 0, tone: "root", duration: 0.72, velocity: 0.58 }],
    harmony: [{ at: 0, duration: 0.82, velocity: 0.36 }],
  };
}

function arrangementFor(song: Song): SongAccompaniment {
  return song.accompaniment ?? fallbackArrangement(song);
}

function harmonyForMeasure(
  song: Song,
  measureIndex: number,
): ParsedHarmony {
  const arrangement = arrangementFor(song);
  const symbol =
    arrangement.progression[
      positiveModulo(measureIndex, arrangement.progression.length)
    ] ?? keySymbol(song.key);
  return parseHarmony(symbol);
}

function compactVoicing(
  harmony: ParsedHarmony,
  measureIndex: number,
  voicingOffset = 0,
): number[] {
  let rootMidi = 48 + harmony.rootPitchClass;
  if (rootMidi > 55) rootMidi -= 12;
  let pitches = harmony.intervals.map((interval) => rootMidi + interval);
  const inversion = positiveModulo(
    measureIndex + voicingOffset,
    Math.min(3, pitches.length),
  );
  for (let index = 0; index < inversion; index += 1) {
    pitches = [...pitches.slice(1), pitches[0] + 12];
  }
  while (pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length > 64) {
    pitches = pitches.map((pitch) => pitch - 12);
  }
  while (pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length < 52) {
    pitches = pitches.map((pitch) => pitch + 12);
  }
  return pitches;
}

/** Returns the authored chord for the current measure, with a compact voicing. */
export function deriveHarmonyAtBeat(song: Song, beat: number): HarmonicVoicing {
  const measureBeats = beatsPerMeasure(song.timeSignature);
  const measureIndex = Math.max(0, Math.floor((beat + EPSILON) / measureBeats));
  const harmony = harmonyForMeasure(song, measureIndex);
  return {
    symbol: harmony.symbol,
    rootPitchClass: harmony.rootPitchClass,
    quality: harmony.quality,
    bassMidi: 36 + harmony.rootPitchClass,
    pitches: compactVoicing(
      harmony,
      measureIndex,
      arrangementFor(song).voicingOffset,
    ),
  };
}

function bassMidiForTone(
  tone: AccompanimentBassTone,
  harmony: ParsedHarmony,
  nextHarmony: ParsedHarmony,
): number {
  const root = 36 + harmony.rootPitchClass;
  if (tone === "root") return root;
  if (tone === "octave") return root + 12;
  if (tone === "fifth") {
    const pitchClass = positiveModulo(harmony.rootPitchClass + 7, 12);
    return 36 + pitchClass + (pitchClass < harmony.rootPitchClass ? 12 : 0);
  }
  const nextRoot = 36 + nextHarmony.rootPitchClass;
  return nextRoot > root ? nextRoot - 1 : nextRoot + 1;
}

function addEvent(
  events: AccompanimentEvent[],
  song: Song,
  startBeat: number,
  endBeat: number,
  event: Omit<AccompanimentEvent, "id">,
  suffix = "",
): void {
  if (event.beat < startBeat - EPSILON || event.beat >= endBeat - EPSILON) return;
  if (event.beat < -EPSILON || event.beat >= song.durationBeats - EPSILON) return;
  events.push({
    ...event,
    id: eventId(song, event.kind, event.beat, suffix),
    velocity: clamp(event.velocity, 0.02, 1),
  });
}

const snappedMeasureBeat = (
  measureStart: number,
  measureBeats: number,
  normalizedOffset: number,
): number => roundBeat(measureStart + normalizedOffset * measureBeats);

/**
 * Builds the exact authored band timeline. Every career song supplies its own
 * progression, rhythm pattern, and instrument palette; drills use a restrained
 * fallback pulse.
 */
export function generateAccompanimentEvents(
  song: Song,
  startBeat: number,
  endBeat: number,
  options: AccompanimentGenerationOptions = {},
): AccompanimentEvent[] {
  if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
    return [];
  }

  const arrangement = arrangementFor(song);
  const intensity = clamp(
    options.intensity ?? 0.38 + song.difficulty * 0.105,
    0.2,
    1,
  );
  const includeDrums =
    (options.drums ?? true) && arrangement.drumKit !== "none";
  const includeBass =
    (options.bass ?? true) && arrangement.bassVoice !== "none";
  const includeHarmony =
    (options.harmony ?? true) && arrangement.harmonyVoice !== "none";
  const measureBeats = beatsPerMeasure(song.timeSignature);
  const firstMeasure = Math.floor(Math.max(0, startBeat) / measureBeats);
  const lastMeasure = Math.ceil(
    Math.min(song.durationBeats, endBeat) / measureBeats,
  );
  const events: AccompanimentEvent[] = [];

  for (let measure = firstMeasure; measure < lastMeasure; measure += 1) {
    const measureStart = measure * measureBeats;
    const measureEnd = Math.min(song.durationBeats, measureStart + measureBeats);
    const harmony = harmonyForMeasure(song, measure);
    const nextHarmony = harmonyForMeasure(song, measure + 1);
    const pitches = compactVoicing(
      harmony,
      measure,
      arrangement.voicingOffset,
    );

    if (includeDrums) {
      arrangement.kick.forEach((at, index) => {
        addEvent(events, song, startBeat, endBeat, {
          kind: "kick",
          beat: snappedMeasureBeat(measureStart, measureBeats, at),
          durationBeats: 0.24,
          velocity: intensity * (index === 0 ? 0.88 : 0.7),
        }, `:${index}`);
      });
      arrangement.snare.forEach((at, index) => {
        addEvent(events, song, startBeat, endBeat, {
          kind: "snare",
          beat: snappedMeasureBeat(measureStart, measureBeats, at),
          durationBeats: 0.2,
          velocity: intensity * (index === 0 ? 0.72 : 0.62),
        }, `:${index}`);
      });
      const openHatTicks = new Set(
        (arrangement.openHat ?? []).map((at) =>
          eventTick(snappedMeasureBeat(measureStart, measureBeats, at)),
        ),
      );
      const hatOffsets = [
        ...arrangement.hats,
        ...(arrangement.openHat ?? []).filter(
          (at) => !arrangement.hats.includes(at),
        ),
      ];
      hatOffsets.forEach((at, index) => {
        const beat = snappedMeasureBeat(measureStart, measureBeats, at);
        const open = openHatTicks.has(eventTick(beat));
        addEvent(events, song, startBeat, endBeat, {
          kind: open ? "open-hat" : "closed-hat",
          beat,
          durationBeats: open ? 0.36 : 0.08,
          velocity: intensity * (index === 0 ? 0.38 : open ? 0.4 : 0.28),
        }, `:${index}`);
      });
    }

    if (includeBass) {
      arrangement.bass.forEach((step, index) => {
        const beat = snappedMeasureBeat(measureStart, measureBeats, step.at);
        addEvent(events, song, startBeat, endBeat, {
          kind: "bass",
          beat,
          durationBeats: Math.min(
            Math.max(0.08, step.duration * measureBeats),
            measureEnd - beat,
          ),
          velocity: intensity * step.velocity,
          midi: bassMidiForTone(step.tone, harmony, nextHarmony),
        }, `:${index}`);
      });
    }

    if (includeHarmony) {
      arrangement.harmony.forEach((step, index) => {
        const beat = snappedMeasureBeat(measureStart, measureBeats, step.at);
        addEvent(events, song, startBeat, endBeat, {
          kind: "harmony",
          beat,
          durationBeats: Math.min(
            Math.max(0.08, step.duration * measureBeats),
            measureEnd - beat,
          ),
          velocity: intensity * step.velocity,
          pitches,
        }, `:${index}`);
      });
    }
  }

  const kindOrder: Record<AccompanimentEventKind, number> = {
    kick: 0,
    snare: 1,
    "closed-hat": 2,
    "open-hat": 3,
    bass: 4,
    harmony: 5,
  };
  return events.sort(
    (left, right) =>
      left.beat - right.beat ||
      kindOrder[left.kind] - kindOrder[right.kind] ||
      left.id.localeCompare(right.id),
  );
}
