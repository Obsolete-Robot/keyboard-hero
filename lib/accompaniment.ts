import type { Song } from "@/lib/songs";

const TICKS_PER_BEAT = 12;
const EPSILON = 0.000_001;

export type AccompanimentEventKind =
  | "kick"
  | "snare"
  | "closed-hat"
  | "open-hat"
  | "bass"
  | "harmony";

export type HarmonyQuality = "major" | "minor" | "dominant";

export interface HarmonicVoicing {
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

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const positiveModulo = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

const eventTick = (beat: number): number =>
  Math.round(beat * TICKS_PER_BEAT);

const eventId = (
  song: Song,
  kind: AccompanimentEventKind,
  beat: number,
  suffix = "",
): string => `${song.id}:band:${kind}:${eventTick(beat)}${suffix}`;

export function beatsPerMeasure(
  timeSignature: readonly [beatsPerMeasure: number, beatUnit: number],
): number {
  const [beats, unit] = timeSignature;
  return Math.max(1, beats * (4 / Math.max(1, unit)));
}

function keyPitchClass(key: string): number {
  const match = key.trim().match(/^([A-Ga-g])([#b]?)/);
  if (!match) return 0;
  const natural: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return positiveModulo(natural[match[1].toUpperCase()] + accidental, 12);
}

function harmonyNotes(song: Song, startBeat: number, endBeat: number) {
  const overlapping = song.notes.filter(
    (note) =>
      note.startBeat < endBeat - EPSILON &&
      note.startBeat + note.durationBeats > startBeat + EPSILON,
  );
  if (overlapping.length > 0) return overlapping;

  const center = (startBeat + endBeat) / 2;
  return [...song.notes]
    .sort(
      (left, right) =>
        Math.abs(left.startBeat - center) - Math.abs(right.startBeat - center),
    )
    .slice(0, 8);
}

/**
 * Derives a compact, playable chord from the curriculum notes around a beat.
 * It is deterministic and AudioContext-free so groove/voicing tests can run in
 * Node. Lower and left-hand notes carry extra harmonic weight.
 */
export function deriveHarmonyAtBeat(song: Song, beat: number): HarmonicVoicing {
  const measureBeats = beatsPerMeasure(song.timeSignature);
  const harmonicSpan = song.difficulty >= 3 ? Math.min(2, measureBeats) : measureBeats;
  const segmentStart = Math.floor((beat + EPSILON) / harmonicSpan) * harmonicSpan;
  const notes = harmonyNotes(song, segmentStart, segmentStart + harmonicSpan);
  const pitchWeights = Array.from({ length: 12 }, () => 0);

  for (const note of notes) {
    const overlap = Math.max(
      0.125,
      Math.min(note.startBeat + note.durationBeats, segmentStart + harmonicSpan) -
        Math.max(note.startBeat, segmentStart),
    );
    const handWeight = note.hand === "left" ? 1.38 : note.hand === "both" ? 1.16 : 1;
    const registerWeight = note.midi < 60 ? 1.2 : 1;
    const accentWeight = note.accent ? 1.18 : 1;
    const velocityWeight = clamp((note.velocity ?? 88) / 96, 0.65, 1.25);
    pitchWeights[positiveModulo(note.midi, 12)] +=
      overlap * handWeight * registerWeight * accentWeight * velocityWeight;
  }

  const tonic = keyPitchClass(song.key);
  const style = song.style.toLowerCase();
  const qualities: ReadonlyArray<{
    quality: HarmonyQuality;
    intervals: readonly number[];
  }> = [
    { quality: "major", intervals: [0, 4, 7] },
    { quality: "minor", intervals: [0, 3, 7] },
    { quality: "dominant", intervals: [0, 4, 7, 10] },
  ];

  let bestRoot = tonic;
  let bestQuality: HarmonyQuality = /minor/i.test(song.key) ? "minor" : "major";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let root = 0; root < 12; root += 1) {
    for (const candidate of qualities) {
      let score = candidate.intervals.reduce(
        (total, interval, index) =>
          total +
          pitchWeights[positiveModulo(root + interval, 12)] *
            (index === 0 ? 1.42 : index === 2 ? 0.92 : 1.04),
        0,
      );
      score += pitchWeights[root] * 0.42;
      if (root === tonic) score += 0.32;
      if (candidate.quality === "dominant") {
        score += /blues|rock|new orleans/.test(style) ? 0.2 : -0.22;
      }
      const opposingThird = candidate.quality === "minor" ? 4 : 3;
      score -= pitchWeights[positiveModulo(root + opposingThird, 12)] * 0.14;

      if (score > bestScore + EPSILON) {
        bestScore = score;
        bestRoot = root;
        bestQuality = candidate.quality;
      }
    }
  }

  const intervals =
    bestQuality === "minor"
      ? [0, 3, 7]
      : bestQuality === "dominant"
        ? [0, 4, 7, 10]
        : [0, 4, 7];
  let rootMidi = 48 + bestRoot;
  if (rootMidi > 55) rootMidi -= 12;
  let pitches = intervals.map((interval) => rootMidi + interval);

  // Small deterministic inversions make repeated sections breathe without
  // producing the large jumps that algorithmic accompaniment often suffers.
  const segmentIndex = Math.floor((segmentStart + EPSILON) / harmonicSpan);
  if (segmentIndex % 3 === 1 && pitches.length > 2) {
    pitches = [...pitches.slice(1), pitches[0] + 12];
  } else if (segmentIndex % 3 === 2 && pitches.length > 2) {
    pitches = [...pitches.slice(2), pitches[0] + 12, pitches[1] + 12];
  }
  while (pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length > 64) {
    pitches = pitches.map((pitch) => pitch - 12);
  }
  while (pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length < 52) {
    pitches = pitches.map((pitch) => pitch + 12);
  }

  return {
    rootPitchClass: bestRoot,
    quality: bestQuality,
    bassMidi: 36 + bestRoot,
    pitches,
  };
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

/**
 * Generates a deterministic backing-band timeline for a beat window. Events
 * are start-inclusive/end-exclusive, making adjacent scheduler windows safe to
 * concatenate without duplicates.
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

  const intensity = clamp(
    options.intensity ?? 0.38 + song.difficulty * 0.105,
    0.2,
    1,
  );
  const includeDrums = options.drums ?? true;
  const includeBass = options.bass ?? true;
  const includeHarmony = options.harmony ?? true;
  const measureBeats = beatsPerMeasure(song.timeSignature);
  const isTriple = Math.abs(measureBeats - 3) < EPSILON;
  const style = song.style.toLowerCase();
  const isSwing = /blues|new orleans/.test(style);
  const isRock = /rock|arena/.test(style);
  const isCinematic = /cinematic/.test(style);
  const isMarch = /march/.test(style);
  const firstMeasure = Math.floor(Math.max(0, startBeat) / measureBeats);
  const lastMeasure = Math.ceil(Math.min(song.durationBeats, endBeat) / measureBeats);
  const events: AccompanimentEvent[] = [];

  for (let measure = firstMeasure; measure < lastMeasure; measure += 1) {
    const measureStart = measure * measureBeats;
    const measureEnd = Math.min(song.durationBeats, measureStart + measureBeats);

    if (includeDrums) {
      const kickOffsets = isTriple
        ? [0]
        : isCinematic && !isRock
          ? [0, 2]
          : song.difficulty >= 4
            ? [0, 1.75, 2, 3.5]
            : [0, 2];
      for (const [index, offset] of kickOffsets.entries()) {
        if (offset >= measureBeats) continue;
        addEvent(events, song, startBeat, endBeat, {
          kind: "kick",
          beat: measureStart + offset,
          durationBeats: 0.24,
          velocity: intensity * (index === 0 ? 0.96 : 0.78),
        });
      }

      const snareOffsets = isTriple ? [1, 2] : isCinematic && !isMarch ? [2] : [1, 3];
      for (const [index, offset] of snareOffsets.entries()) {
        if (offset >= measureBeats) continue;
        addEvent(events, song, startBeat, endBeat, {
          kind: "snare",
          beat: measureStart + offset,
          durationBeats: 0.2,
          velocity: intensity * (isTriple ? (index === 0 ? 0.58 : 0.5) : 0.82),
        });
      }

      const hatStep = song.difficulty >= 4 && (isRock || isCinematic) ? 0.25 :
        song.difficulty >= 2 || isMarch ? 0.5 : 1;
      for (let offset = 0; offset < measureBeats - EPSILON; offset += hatStep) {
        const swungOffset =
          isSwing && hatStep === 0.5 && Math.round(offset * 2) % 2 === 1
            ? Math.floor(offset) + 2 / 3
            : offset;
        const isLastOffbeat =
          song.difficulty >= 3 &&
          swungOffset >= measureBeats - 0.5 - EPSILON;
        const kind: AccompanimentEventKind = isLastOffbeat ? "open-hat" : "closed-hat";
        const subdivision = Math.round(offset / hatStep);
        addEvent(events, song, startBeat, endBeat, {
          kind,
          beat: measureStart + swungOffset,
          durationBeats: isLastOffbeat ? 0.42 : 0.08,
          velocity:
            intensity *
            (subdivision % Math.round(Math.max(1, 1 / hatStep)) === 0 ? 0.42 : 0.29),
        });
      }
    }

    if (includeBass) {
      const voicing = deriveHarmonyAtBeat(song, measureStart + 0.01);
      const bassOffsets = isTriple
        ? [0]
        : song.difficulty <= 1
          ? [0, 2]
          : song.difficulty <= 3
            ? [0, 1, 2, 3]
            : [0, 1, 2, 2.75, 3.5];
      for (const [index, offset] of bassOffsets.entries()) {
        if (offset >= measureBeats) continue;
        const localHarmony = deriveHarmonyAtBeat(song, measureStart + offset + 0.01);
        const fifth = 36 + positiveModulo(localHarmony.rootPitchClass + 7, 12);
        const midi = index % 4 === 2 ? fifth : localHarmony.bassMidi;
        addEvent(events, song, startBeat, endBeat, {
          kind: "bass",
          beat: measureStart + offset,
          durationBeats: isTriple ? 0.82 : song.difficulty >= 4 ? 0.58 : 0.78,
          velocity: intensity * (index === 0 ? 0.74 : 0.61),
          midi: index === 0 ? voicing.bassMidi : midi,
        });
      }
    }

    if (includeHarmony) {
      const harmonyOffsets = isTriple
        ? [1, 2]
        : isRock && song.difficulty >= 4
          ? [0, 1.5, 2, 3.5]
          : song.difficulty >= 3
            ? [0, Math.min(2, measureBeats / 2)]
            : [0];
      for (const [index, offset] of [...new Set(harmonyOffsets)].entries()) {
        if (offset >= measureBeats || measureStart + offset >= measureEnd) continue;
        const voicing = deriveHarmonyAtBeat(song, measureStart + offset + 0.01);
        const nextOffset = harmonyOffsets[index + 1] ?? measureBeats;
        const available = Math.max(0.25, nextOffset - offset);
        const duration = isTriple
          ? 0.62
          : isRock && song.difficulty >= 4
            ? 0.42
            : available * 0.9;
        addEvent(events, song, startBeat, endBeat, {
          kind: "harmony",
          beat: measureStart + offset,
          durationBeats: Math.min(duration, measureEnd - (measureStart + offset)),
          velocity: intensity * (isTriple ? 0.44 : isCinematic ? 0.48 : 0.4),
          pitches: voicing.pitches,
        });
      }
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
