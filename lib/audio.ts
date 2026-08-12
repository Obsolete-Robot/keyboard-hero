/**
 * A tiny, dependency-free Web Audio instrument for Keyboard Hero.
 *
 * The class intentionally creates its AudioContext lazily: constructing React
 * components during SSR (or before the first user gesture) must never touch a
 * browser audio API.
 */

import { deriveHarmonyAtBeat } from "@/lib/accompaniment";
import {
  createPowerSaturationCurve,
  derivePowerModeProfile,
  powerAccompanimentIntensity,
  shapePowerVelocity,
  type PowerModeProfile,
} from "@/lib/audioPower";
import { scheduleAudioSourceWindow } from "@/lib/audioScheduling";
import type { Song } from "@/lib/songs";

export type SynthWaveform = "piano" | "electric" | "organ";

export interface AccompanimentStep {
  /** Zero-based quarter-note beat within the current measure. */
  beatInMeasure: number;
  /** Eighth-note subdivision: zero is on the beat, one is the offbeat. */
  subdivision: 0 | 1;
  beatsPerMeasure: number;
  beatDurationSeconds: number;
  /** Tonic in the bass register (C2 is MIDI 36). */
  tonicMidi: number;
  /** Normalized arrangement density. */
  intensity: number;
  /** Optional normalized POWER MODE energy for this musical step. */
  power?: number;
  /** Current harmony voicing, used for POWER rhythm reinforcement. */
  harmonyPitches?: readonly number[];
}

export interface AccompanimentSyncOptions {
  song: Song;
  beat: number;
  tempoScale?: number;
  loop?: {
    enabled: boolean;
    startBeat: number;
    endBeat: number;
  };
  intensity?: number;
}

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface SynthVoice {
  gain: GainNode;
  panner: StereoPannerNode;
  basePan: number;
  oscillators: OscillatorNode[];
  transients: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  peak: number;
  released: boolean;
  startedAt: number;
  cleanupTimer?: ReturnType<typeof globalThis.setTimeout>;
}

export const midiToFrequency = (midi: number): number =>
  440 * 2 ** ((midi - 69) / 12);

export class KeyboardSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private instrument: GainNode | null = null;
  private accompaniment: GainNode | null = null;
  private instrumentSend: GainNode | null = null;
  private accompanimentSend: GainNode | null = null;
  private powerInstrumentSend: GainNode | null = null;
  private powerAccompanimentSend: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbWet: GainNode | null = null;
  private voices = new Map<string, SynthVoice>();
  private accompanimentSources = new Set<AudioScheduledSourceNode>();
  private noiseBuffer: AudioBuffer | null = null;
  private accompanimentSongId: string | null = null;
  private accompanimentStep: number | null = null;
  private volume = 0.72;
  private accompanimentVolume = 0.58;
  private muted = false;
  private waveform: SynthWaveform = "piano";
  private powerProfile = derivePowerModeProfile(false, 0);

  get state(): AudioContextState | "unavailable" {
    return this.context?.state ?? "unavailable";
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;

    const AudioContextClass =
      window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextClass) return null;

    let context: AudioContext;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
    } catch {
      try {
        context = new AudioContextClass();
      } catch {
        return null;
      }
    }
    const master = context.createGain();
    const instrument = context.createGain();
    const accompaniment = context.createGain();
    const instrumentSend = context.createGain();
    const accompanimentSend = context.createGain();
    const powerInstrumentSend = context.createGain();
    const powerAccompanimentSend = context.createGain();
    const powerDrive = context.createWaveShaper();
    const powerTone = context.createBiquadFilter();
    const powerOutput = context.createGain();
    const reverbInput = context.createGain();
    const reverb = context.createConvolver();
    const reverbWet = context.createGain();
    const highpass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();

    highpass.type = "highpass";
    highpass.frequency.value = 28;
    highpass.Q.value = 0.62;
    compressor.threshold.value = -15;
    compressor.knee.value = 14;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const power = this.powerProfile;
    compressor.threshold.value = power.compressorThreshold;
    master.gain.value = this.muted ? 0 : this.volume;
    instrument.gain.value = power.instrumentGain;
    accompaniment.gain.value =
      this.accompanimentVolume * power.accompanimentGainScale;
    instrumentSend.gain.value = power.instrumentReverbSend;
    accompanimentSend.gain.value = power.accompanimentReverbSend;
    powerInstrumentSend.gain.value = power.saturationInstrumentSend;
    powerAccompanimentSend.gain.value = power.saturationAccompanimentSend;
    powerDrive.curve = createPowerSaturationCurve();
    powerDrive.oversample = "none";
    powerTone.type = "highshelf";
    powerTone.frequency.value = 1_800;
    powerTone.gain.value = 2.4;
    powerOutput.gain.value = 0.72;
    reverbWet.gain.value = power.reverbWet;
    reverb.buffer = this.createReverbImpulse(context);

    instrument.connect(master);
    instrument.connect(instrumentSend);
    instrumentSend.connect(reverbInput);
    instrument.connect(powerInstrumentSend);
    powerInstrumentSend.connect(powerDrive);
    accompaniment.connect(master);
    accompaniment.connect(accompanimentSend);
    accompanimentSend.connect(reverbInput);
    accompaniment.connect(powerAccompanimentSend);
    powerAccompanimentSend.connect(powerDrive);
    powerDrive.connect(powerTone);
    powerTone.connect(powerOutput);
    powerOutput.connect(master);
    reverbInput.connect(reverb);
    reverb.connect(reverbWet);
    reverbWet.connect(master);
    master.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.instrument = instrument;
    this.accompaniment = accompaniment;
    this.instrumentSend = instrumentSend;
    this.accompanimentSend = accompanimentSend;
    this.powerInstrumentSend = powerInstrumentSend;
    this.powerAccompanimentSend = powerAccompanimentSend;
    this.compressor = compressor;
    this.reverb = reverb;
    this.reverbWet = reverbWet;
    return context;
  }

  private createReverbImpulse(context: AudioContext): AudioBuffer {
    const seconds = 1.65;
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = 0x4b_48_45_52;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
      const channel = impulse.getChannelData(channelIndex);
      for (let frame = 0; frame < length; frame += 1) {
        const progress = frame / length;
        const earlyReflection = frame < context.sampleRate * 0.055 ? 0.18 : 0;
        channel[frame] =
          (random() * 2 - 1) *
          (earlyReflection + (1 - progress) ** 2.55) *
          (channelIndex === 0 ? 0.96 : 0.9);
      }
    }
    return impulse;
  }

  async resume(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    return context.state === "running";
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (!this.master || !this.context) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.015);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  setWaveform(waveform: SynthWaveform): void {
    this.waveform = waveform;
  }

  /**
   * Smoothly opens the concert-sized performance layer without changing pitch
   * or recreating the graph. Safe to call before audio is unlocked and cheap
   * enough for continuously changing gameplay energy.
   */
  setPowerMode(active: boolean, energy = 1): void {
    const next = derivePowerModeProfile(active, energy);
    const previousAmount = this.powerProfile.amount;
    const crossedOffBoundary = (previousAmount === 0) !== (next.amount === 0);
    if (
      !crossedOffBoundary &&
      Math.abs(previousAmount - next.amount) < 0.008
    ) {
      return;
    }
    this.powerProfile = next;
    this.applyPowerProfile(next);
  }

  private applyPowerProfile(profile: PowerModeProfile): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    this.instrument?.gain.setTargetAtTime(profile.instrumentGain, now, 0.055);
    this.accompaniment?.gain.setTargetAtTime(
      this.accompanimentVolume * profile.accompanimentGainScale,
      now,
      0.07,
    );
    this.instrumentSend?.gain.setTargetAtTime(
      profile.instrumentReverbSend,
      now,
      0.085,
    );
    this.accompanimentSend?.gain.setTargetAtTime(
      profile.accompanimentReverbSend,
      now,
      0.09,
    );
    this.powerInstrumentSend?.gain.setTargetAtTime(
      profile.saturationInstrumentSend,
      now,
      0.06,
    );
    this.powerAccompanimentSend?.gain.setTargetAtTime(
      profile.saturationAccompanimentSend,
      now,
      0.075,
    );
    this.reverbWet?.gain.setTargetAtTime(profile.reverbWet, now, 0.095);
    this.compressor?.threshold.setTargetAtTime(
      profile.compressorThreshold,
      now,
      0.07,
    );
    for (const voice of this.voices.values()) {
      voice.panner.pan.setTargetAtTime(
        Math.min(0.78, Math.max(-0.78, voice.basePan * profile.stereoWidthScale)),
        now,
        0.055,
      );
    }
  }

  setAccompanimentVolume(volume: number): void {
    this.accompanimentVolume = Math.min(1, Math.max(0, volume));
    if (!this.accompaniment || !this.context) return;
    this.accompaniment.gain.setTargetAtTime(
      this.accompanimentVolume * this.powerProfile.accompanimentGainScale,
      this.context.currentTime,
      0.018,
    );
  }

  private trackAccompanimentSource(
    source: AudioScheduledSourceNode,
    nodes: readonly AudioNode[] = [],
  ): void {
    this.accompanimentSources.add(source);
    source.onended = () => {
      this.accompanimentSources.delete(source);
      for (const node of [source, ...nodes]) {
        try {
          node.disconnect();
        } catch {
          // The graph may already have been disconnected during teardown.
        }
      }
    };
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (
      this.noiseBuffer &&
      this.noiseBuffer.sampleRate === context.sampleRate
    ) {
      return this.noiseBuffer;
    }
    const frameCount = Math.max(1, Math.floor(context.sampleRate * 0.16));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x41_4b_41_49;
    for (let frame = 0; frame < frameCount; frame += 1) {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      channel[frame] = (seed / 0x1_0000_0000) * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Play one clocked eighth-note of the procedural backing band. Nothing is
   * scheduled beyond this subdivision, so tempo, loop, and seek changes take
   * effect on the very next step.
   */
  playAccompanimentStep(step: AccompanimentStep): boolean {
    const context = this.ensureContext();
    const destination = this.accompaniment;
    if (
      !context ||
      !destination ||
      context.state !== "running" ||
      this.accompanimentVolume <= 0
    ) {
      return false;
    }

    const now = context.currentTime + 0.002;
    const requestedPower = step.power ?? this.powerProfile.amount;
    const power = Number.isFinite(requestedPower)
      ? Math.min(1, Math.max(0, requestedPower))
      : 0;
    const intensity = powerAccompanimentIntensity(step.intensity, power);
    const beatDuration = Math.min(
      4,
      Math.max(0.08, step.beatDurationSeconds),
    );
    const beatsPerMeasure = Math.max(1, Math.floor(step.beatsPerMeasure));
    const beatInMeasure =
      ((Math.floor(step.beatInMeasure) % beatsPerMeasure) + beatsPerMeasure) %
      beatsPerMeasure;

    // Closed hi-hat: the constant subdivision makes the groove legible at
    // every practice speed without relying on sample assets.
    {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const duration = step.subdivision === 0 ? 0.042 : 0.028;
      source.buffer = this.getNoiseBuffer(context);
      filter.type = "highpass";
      filter.frequency.value = 5_800 + intensity * 1_800;
      gain.gain.setValueAtTime(
        (step.subdivision === 0 ? 0.028 : 0.018) + intensity * 0.018,
        now,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      this.trackAccompanimentSource(source, [filter, gain]);
      source.start(now);
      source.stop(now + duration + 0.01);
    }

    // A short filtered cymbal bloom marks the downbeat in POWER without
    // turning the practice groove into a wall of noise.
    if (power > 0.015 && step.subdivision === 0 && beatInMeasure === 0) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const duration = 0.1 + power * 0.05;
      source.buffer = this.getNoiseBuffer(context);
      filter.type = "highpass";
      filter.frequency.value = 3_100 + power * 1_100;
      filter.Q.value = 0.52;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        0.012 + power * 0.045,
        now + 0.004,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      this.trackAccompanimentSource(source, [filter, gain]);
      source.start(now);
      source.stop(now + duration + 0.01);
    }

    if (step.subdivision === 0) {
      const backbeat =
        (beatsPerMeasure >= 4 && beatInMeasure % 2 === 1) ||
        (beatsPerMeasure < 4 && beatInMeasure === 1);
      const kick =
        beatInMeasure === 0 ||
        (intensity >= 0.52 && beatInMeasure % 2 === 0);

      if (kick) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(112, now);
        oscillator.frequency.exponentialRampToValueAtTime(46, now + 0.12);
        gain.gain.setValueAtTime(0.36 + intensity * 0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        oscillator.connect(gain);
        gain.connect(destination);
        this.trackAccompanimentSource(oscillator, [gain]);
        oscillator.start(now);
        oscillator.stop(now + 0.17);
      }

      if (backbeat) {
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        source.buffer = this.getNoiseBuffer(context);
        filter.type = "bandpass";
        filter.frequency.value = 1_850;
        filter.Q.value = 0.72;
        gain.gain.setValueAtTime(0.17 + intensity * 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(destination);
        this.trackAccompanimentSource(source, [filter, gain]);
        source.start(now);
        source.stop(now + 0.12);
      }

      // Alternating tonic/fifth bass keeps the backing useful across the
      // curriculum without pretending to infer a full chord chart.
      {
        const bassMidi = step.tonicMidi + (beatInMeasure % 2 === 0 ? 0 : 7);
        const oscillator = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        const duration = Math.min(1.4, beatDuration * (0.38 + intensity * 0.3));
        oscillator.type = "sawtooth";
        oscillator.frequency.value = midiToFrequency(bassMidi);
        filter.type = "lowpass";
        filter.frequency.value = 230 + intensity * 180;
        filter.Q.value = 1.2;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(
          0.075 + intensity * 0.055,
          now + 0.008,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(destination);
        this.trackAccompanimentSource(oscillator, [filter, gain]);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.02);
      }
    }

    // A restrained pickup kick adds forward motion at high POWER and occurs
    // only once per measure, keeping the eighth-note scheduler inexpensive.
    if (
      power > 0.62 &&
      step.subdivision === 1 &&
      beatInMeasure === beatsPerMeasure - 1
    ) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(86, now);
      oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.085);
      gain.gain.setValueAtTime(0.06 + power * 0.085, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      oscillator.connect(gain);
      gain.connect(destination);
      this.trackAccompanimentSource(oscillator, [gain]);
      oscillator.start(now);
      oscillator.stop(now + 0.125);
    }

    const rhythmHit =
      (step.subdivision === 1 && intensity >= 0.18) ||
      (step.subdivision === 0 &&
        beatInMeasure === 0 &&
        (intensity < 0.18 || power > 0.16));
    if (rhythmHit) {
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const duration = Math.min(0.24, beatDuration * 0.24);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        0.025 + intensity * 0.035 + power * 0.012,
        now + 0.006,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      filter.type = "lowpass";
      filter.frequency.value = 1_050 + intensity * 950 + power * 620;
      filter.Q.value = 0.8;
      gain.connect(filter);
      filter.connect(destination);

      const fallbackPitches = [12, 19, 24].map(
        (offset) => step.tonicMidi + offset,
      );
      const harmonyPitches =
        power > 0.08 && step.harmonyPitches && step.harmonyPitches.length > 0
          ? [...step.harmonyPitches].slice(0, 4)
          : fallbackPitches;
      if (power > 0.68 && harmonyPitches.length < 4) {
        const upperRoot = harmonyPitches[0] + 12;
        if (upperRoot <= 84 && !harmonyPitches.includes(upperRoot)) {
          harmonyPitches.push(upperRoot);
        }
      }

      for (const [index, pitch] of harmonyPitches.entries()) {
        const oscillator = context.createOscillator();
        oscillator.type = index % 3 === 1 ? "triangle" : "sawtooth";
        oscillator.frequency.value = midiToFrequency(pitch);
        oscillator.detune.value = index === harmonyPitches.length - 1 ? 3 : -2;
        oscillator.connect(gain);
        this.trackAccompanimentSource(
          oscillator,
          index === harmonyPitches.length - 1 ? [gain, filter] : [],
        );
        oscillator.start(now);
        oscillator.stop(now + duration + 0.02);
      }
    }

    return true;
  }

  /**
   * Keeps the procedural band locked to the transport. The public transport
   * supplies musical beats; this method owns AudioContext scheduling details.
   */
  syncAccompaniment(options: AccompanimentSyncOptions): boolean {
    const beat = Math.max(0, options.beat);
    const stepIndex = Math.floor(beat * 2 + 0.000_1);
    const loopChanged =
      options.loop?.enabled === true &&
      this.accompanimentStep !== null &&
      stepIndex < this.accompanimentStep;
    if (this.accompanimentSongId !== options.song.id || loopChanged) {
      this.stopAccompaniment(true);
    }
    if (
      this.accompanimentSongId === options.song.id &&
      this.accompanimentStep === stepIndex
    ) {
      return true;
    }

    const tempoScale = Math.min(2, Math.max(0.1, options.tempoScale ?? 1));
    const beatDurationSeconds = 60 / (options.song.bpm * tempoScale);
    const measureBeats = Math.max(
      1,
      options.song.timeSignature[0] * (4 / options.song.timeSignature[1]),
    );
    const beatInMeasure = Math.floor(beat % measureBeats);
    const harmony = deriveHarmonyAtBeat(options.song, beat);
    const played = this.playAccompanimentStep({
      beatInMeasure,
      subdivision: stepIndex % 2 === 0 ? 0 : 1,
      beatsPerMeasure: measureBeats,
      beatDurationSeconds,
      tonicMidi: harmony.bassMidi,
      intensity: Math.min(1, Math.max(0, options.intensity ?? 0.62)),
      power: this.powerProfile.amount,
      harmonyPitches: harmony.pitches,
    });
    if (played) {
      this.accompanimentSongId = options.song.id;
      this.accompanimentStep = stepIndex;
    }
    return played;
  }

  stopAccompaniment(immediate = false): void {
    this.accompanimentSongId = null;
    this.accompanimentStep = null;
    const context = this.context;
    if (!context) {
      this.accompanimentSources.clear();
      return;
    }
    const stopAt = context.currentTime + (immediate ? 0.004 : 0.055);
    for (const source of this.accompanimentSources) {
      try {
        source.stop(stopAt);
      } catch {
        // A naturally ended one-shot may already be stopped.
      }
    }
    this.accompanimentSources.clear();
  }

  noteOn(
    voiceId: string,
    midi: number,
    velocity = 0.8,
    when?: number,
  ): boolean {
    const context = this.ensureContext();
    if (!context || !this.instrument) return false;

    // A repeated note-on from the same physical key should replace, not leak,
    // its former voice.
    this.noteOff(voiceId, context.currentTime, 0.025);

    // A generous but finite voice count keeps large two-hand chords smooth on
    // mobile hardware. The quietest perceptual choice is the oldest voice.
    if (!this.voices.has(voiceId) && this.voices.size >= 32) {
      const oldest = [...this.voices.entries()]
        .filter(([id]) => id !== voiceId)
        .sort((left, right) => left[1].startedAt - right[1].startedAt)[0];
      if (oldest) {
        this.noteOff(oldest[0], context.currentTime, 0.018);
        this.voices.delete(oldest[0]);
      }
    }

    const startAt = Math.max(context.currentTime + 0.002, when ?? 0);
    const normalizedVelocity = Number.isFinite(velocity)
      ? Math.min(1, Math.max(0.03, velocity))
      : 0.8;
    const power = this.powerProfile;
    const expressiveVelocity = shapePowerVelocity(
      normalizedVelocity,
      power.amount,
    );
    const frequency = midiToFrequency(midi);
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();
    const oscillators: OscillatorNode[] = [];
    const transients: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [gain, filter, panner];

    filter.type = "lowpass";
    const brightCutoff =
      this.waveform === "organ"
        ? 6_800
        : 2_100 +
          expressiveVelocity ** 1.35 * 5_400 +
          Math.max(0, midi - 48) * 34 +
          power.brightnessLiftHz;
    const restingCutoff =
      this.waveform === "electric"
        ? 1_850 + expressiveVelocity * 1_500 + power.brightnessLiftHz * 0.22
        : 1_450 + expressiveVelocity * 1_850 + power.brightnessLiftHz * 0.18;
    filter.frequency.setValueAtTime(brightCutoff, startAt);
    if (this.waveform !== "organ") {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(300, restingCutoff),
        startAt + 0.48,
      );
    }
    filter.Q.value = this.waveform === "electric" ? 1.15 : 0.58;
    const basePan = Math.min(0.58, Math.max(-0.58, (midi - 60) / 23));
    panner.pan.value = Math.min(
      0.78,
      Math.max(-0.78, basePan * power.stereoWidthScale),
    );
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this.instrument);

    // Partial envelopes create the fast hammer bloom and slower wooden body;
    // the outer gain remains at unity solely for click-free key release.
    const peak = 1;
    gain.gain.setValueAtTime(1, startAt);
    const bodyLevel =
      (this.waveform === "organ" ? 0.04 : 0.036) +
      expressiveVelocity ** 1.55 *
        (this.waveform === "organ" ? 0.073 : 0.096);
    const expressiveBodyLevel = bodyLevel * power.bodyGain;
    const registerDecay = Math.min(1.18, Math.max(0.62, 1.08 - (midi - 48) * 0.018));

    const basePartials: Array<{
      ratio: number;
      type: OscillatorType;
      detune: number;
      level: number;
      decay: number;
      sustain: number;
    }> =
      this.waveform === "organ"
        ? [
            { ratio: 1, type: "sine", detune: -1.5, level: 0.7, decay: 40, sustain: 0.98 },
            { ratio: 2, type: "sine", detune: 1.5, level: 0.25, decay: 40, sustain: 0.98 },
            { ratio: 3, type: "sine", detune: -0.5, level: 0.1, decay: 40, sustain: 0.98 },
            { ratio: 4, type: "sine", detune: 2, level: 0.045, decay: 40, sustain: 0.98 },
          ]
        : this.waveform === "electric"
          ? [
              { ratio: 1, type: "triangle", detune: -2.5, level: 0.74, decay: 2.8, sustain: 0.13 },
              { ratio: 1.002, type: "sine", detune: 2.5, level: 0.2, decay: 3.5, sustain: 0.12 },
              { ratio: 2.01, type: "sine", detune: 1, level: 0.14, decay: 1.5, sustain: 0.025 },
              { ratio: 3.97, type: "sine", detune: -1, level: 0.04, decay: 0.7, sustain: 0.008 },
            ]
          : [
              { ratio: 1, type: "triangle", detune: -1.4, level: 0.72, decay: 3.7, sustain: 0.055 },
              { ratio: 1.003, type: "sine", detune: 1.7, level: 0.18, decay: 4.4, sustain: 0.04 },
              { ratio: 2.006, type: "sine", detune: -0.7, level: 0.15, decay: 1.9, sustain: 0.012 },
              { ratio: 3.015, type: "sine", detune: 1.1, level: 0.065, decay: 1.05, sustain: 0.006 },
              { ratio: 5.04, type: "sine", detune: -1, level: 0.024, decay: 0.55, sustain: 0.003 },
            ];
    const partials =
      power.octaveGain > 0.001 && this.waveform !== "organ"
        ? [
            ...basePartials,
            midi >= 60
              ? {
                  ratio: 0.5,
                  type: "sine" as const,
                  detune: -0.8,
                  level: power.octaveGain,
                  decay: 2.7,
                  sustain: 0.035,
                }
              : {
                  ratio: 2.002,
                  type: "sine" as const,
                  detune: 0.8,
                  level: power.octaveGain,
                  decay: 1.45,
                  sustain: 0.012,
                },
          ]
        : basePartials;

    let naturalDuration = this.waveform === "organ" ? 45 : this.waveform === "electric" ? 9 : 8;
    for (const [index, partial] of partials.entries()) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      let oscillatorStopAt: number;
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, startAt);
      oscillator.detune.value = partial.detune;
      const partialPeak = Math.max(0.0002, expressiveBodyLevel * partial.level);
      const attack = this.waveform === "organ" ? 0.015 : 0.0035 + index * 0.0007;
      partialGain.gain.setValueAtTime(0.0001, startAt);
      partialGain.gain.exponentialRampToValueAtTime(partialPeak, startAt + attack);
      if (this.waveform !== "organ") {
        const decayAt = startAt + Math.max(0.12, partial.decay * registerDecay);
        const tailLevel = Math.max(0.0001, partialPeak * partial.sustain);
        partialGain.gain.exponentialRampToValueAtTime(tailLevel, decayAt);
        const partialDuration = Math.max(
          decayAt - startAt + 0.3,
          (index === 0 ? naturalDuration : naturalDuration * (1 - index * 0.11)) *
            registerDecay,
        );
        naturalDuration = Math.max(naturalDuration, partialDuration);
        partialGain.gain.exponentialRampToValueAtTime(
          0.0001,
          startAt + partialDuration,
        );
        oscillatorStopAt = startAt + partialDuration + 0.04;
      } else {
        oscillatorStopAt = startAt + naturalDuration;
      }
      oscillator.connect(partialGain);
      partialGain.connect(gain);
      scheduleAudioSourceWindow(oscillator, startAt, oscillatorStopAt);
      oscillators.push(oscillator);
      nodes.push(oscillator, partialGain);
    }

    // A filtered noise tick and tiny soundboard thump make velocity tangible,
    // especially on the MPK's light action, without sample-loading latency.
    {
      const hammer = context.createBufferSource();
      const hammerFilter = context.createBiquadFilter();
      const hammerGain = context.createGain();
      hammer.buffer = this.getNoiseBuffer(context);
      hammerFilter.type = "bandpass";
      hammerFilter.frequency.value =
        1_650 +
        expressiveVelocity ** 1.4 * 3_900 +
        Math.max(0, midi - 48) * 22 +
        power.brightnessLiftHz * 0.34;
      hammerFilter.Q.value = this.waveform === "organ" ? 1.8 : 0.9;
      const hammerLevel =
        (this.waveform === "organ" ? 0.006 : 0.012) +
        expressiveVelocity ** 2 *
          (this.waveform === "piano" ? 0.064 : 0.038);
      hammerGain.gain.setValueAtTime(
        Math.max(0.0001, hammerLevel * power.hammerGain),
        startAt,
      );
      hammerGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + (this.waveform === "organ" ? 0.012 : 0.028),
      );
      hammer.connect(hammerFilter);
      hammerFilter.connect(hammerGain);
      hammerGain.connect(gain);
      hammer.start(startAt);
      hammer.stop(startAt + 0.035);
      transients.push(hammer);
      nodes.push(hammer, hammerFilter, hammerGain);
    }

    if (this.waveform === "piano") {
      const thump = context.createOscillator();
      const thumpGain = context.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(72 + Math.max(0, midi - 48) * 1.4, startAt);
      thumpGain.gain.setValueAtTime(
        (0.009 + expressiveVelocity * 0.013) * (1 + power.amount * 0.16),
        startAt,
      );
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.052);
      thump.connect(thumpGain);
      thumpGain.connect(gain);
      thump.start(startAt);
      thump.stop(startAt + 0.058);
      transients.push(thump);
      nodes.push(thump, thumpGain);
    }

    const voice: SynthVoice = {
      gain,
      panner,
      basePan,
      oscillators,
      transients,
      nodes,
      peak,
      released: false,
      startedAt: startAt,
    };
    this.voices.set(voiceId, voice);
    voice.cleanupTimer = globalThis.setTimeout(() => {
      if (this.voices.get(voiceId) === voice) this.voices.delete(voiceId);
      for (const node of voice.nodes) {
        try {
          node.disconnect();
        } catch {
          // A naturally ended source may already be disconnected.
        }
      }
    }, (Math.max(0, startAt - context.currentTime) + naturalDuration + 0.16) * 1000);
    return true;
  }

  noteOff(
    voiceId: string,
    when?: number,
    releaseSeconds = 0.18,
  ): void {
    const context = this.context;
    const voice = this.voices.get(voiceId);
    if (!context || !voice || voice.released) return;

    voice.released = true;
    if (voice.cleanupTimer !== undefined) {
      globalThis.clearTimeout(voice.cleanupTimer);
      voice.cleanupTimer = undefined;
    }
    const stopAt = Math.max(context.currentTime, when ?? context.currentTime);
    const release = Math.max(
      0.015,
      releaseSeconds * (this.waveform === "piano" ? 1.28 : 1),
    );
    const gainParam = voice.gain.gain;

    // cancelAndHoldAtTime avoids a click when a short note is released during
    // its attack. Older Safari lacks it, hence the guarded fallback.
    if (typeof gainParam.cancelAndHoldAtTime === "function") {
      gainParam.cancelAndHoldAtTime(stopAt);
    } else {
      gainParam.cancelScheduledValues(stopAt);
      gainParam.setValueAtTime(Math.max(0.0001, voice.peak * 0.45), stopAt);
    }
    gainParam.exponentialRampToValueAtTime(0.0001, stopAt + release);

    for (const oscillator of voice.oscillators) {
      try {
        oscillator.stop(stopAt + release + 0.025);
      } catch {
        // A context can close between scheduling and cleanup; that is safe.
      }
    }
    for (const transient of voice.transients) {
      try {
        transient.stop(stopAt + Math.min(0.025, release));
      } catch {
        // One-shot hammer sources usually finish before key release.
      }
    }

    globalThis.setTimeout(() => {
      if (this.voices.get(voiceId) === voice) {
        this.voices.delete(voiceId);
      }
      for (const node of voice.nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    }, (Math.max(0, stopAt - context.currentTime) + release + 0.08) * 1000);
  }

  playMetronome(accent = false, volume = 0.3): void {
    const context = this.ensureContext();
    if (!context || !this.master || context.state !== "running") return;

    const now = context.currentTime + 0.002;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 1320 : 880, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      accent ? 880 : 620,
      now + 0.04,
    );
    gain.gain.setValueAtTime(Math.max(0.0001, volume * (accent ? 0.22 : 0.14)), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.onended = () => {
      for (const node of [oscillator, gain]) {
        try {
          node.disconnect();
        } catch {
          // Teardown may have already detached this short one-shot chain.
        }
      }
    };
    oscillator.start(now);
    oscillator.stop(now + 0.065);
  }

  allNotesOff(immediate = false): void {
    const now = this.context?.currentTime ?? 0;
    for (const id of [...this.voices.keys()]) {
      this.noteOff(id, now, immediate ? 0.015 : 0.08);
    }
  }

  async dispose(): Promise<void> {
    this.allNotesOff(true);
    this.stopAccompaniment(true);
    const context = this.context;
    this.context = null;
    this.master = null;
    this.instrument = null;
    this.accompaniment = null;
    this.instrumentSend = null;
    this.accompanimentSend = null;
    this.powerInstrumentSend = null;
    this.powerAccompanimentSend = null;
    this.compressor = null;
    this.reverb = null;
    this.reverbWet = null;
    this.noiseBuffer = null;
    this.voices.clear();
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Closing is best-effort during React teardown.
      }
    }
  }
}
