/**
 * A tiny, dependency-free Web Audio instrument for Keyboard Hero.
 *
 * The class intentionally creates its AudioContext lazily: constructing React
 * components during SSR (or before the first user gesture) must never touch a
 * browser audio API.
 */

export type SynthWaveform = "piano" | "electric" | "organ";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface SynthVoice {
  gain: GainNode;
  oscillators: OscillatorNode[];
  peak: number;
  released: boolean;
}

export const midiToFrequency = (midi: number): number =>
  440 * 2 ** ((midi - 69) / 12);

export class KeyboardSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices = new Map<string, SynthVoice>();
  private volume = 0.72;
  private muted = false;
  private waveform: SynthWaveform = "piano";

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

    const context = new AudioContextClass();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();

    compressor.threshold.value = -17;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.compressor = compressor;
    return context;
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

  noteOn(
    voiceId: string,
    midi: number,
    velocity = 0.8,
    when?: number,
  ): boolean {
    const context = this.ensureContext();
    if (!context || !this.master) return false;

    // A repeated note-on from the same physical key should replace, not leak,
    // its former voice.
    this.noteOff(voiceId, context.currentTime, 0.025);

    const startAt = Math.max(context.currentTime + 0.002, when ?? 0);
    const normalizedVelocity = Math.min(1, Math.max(0.03, velocity));
    const frequency = midiToFrequency(midi);
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const oscillators: OscillatorNode[] = [];

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(
      this.waveform === "organ" ? 5200 : 2600 + normalizedVelocity * 3200,
      startAt,
    );
    filter.Q.value = this.waveform === "electric" ? 1.4 : 0.65;
    gain.connect(filter);
    filter.connect(this.master);

    const peak = (0.07 + normalizedVelocity * 0.2) *
      (this.waveform === "organ" ? 0.72 : 1);
    gain.gain.setValueAtTime(0.0001, startAt);

    if (this.waveform === "organ") {
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.018);
    } else {
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.009);
      gain.gain.exponentialRampToValueAtTime(
        peak * (this.waveform === "electric" ? 0.42 : 0.52),
        startAt + (this.waveform === "electric" ? 0.32 : 0.17),
      );
    }

    const partials: Array<{
      ratio: number;
      type: OscillatorType;
      detune: number;
      level: number;
    }> =
      this.waveform === "organ"
        ? [
            { ratio: 1, type: "sine", detune: -2, level: 0.75 },
            { ratio: 2, type: "sine", detune: 2, level: 0.22 },
            { ratio: 3, type: "sine", detune: 0, level: 0.08 },
          ]
        : this.waveform === "electric"
          ? [
              { ratio: 1, type: "triangle", detune: -3, level: 0.8 },
              { ratio: 2, type: "sine", detune: 3, level: 0.16 },
            ]
          : [
              { ratio: 1, type: "triangle", detune: -2, level: 0.82 },
              { ratio: 2, type: "sine", detune: 2, level: 0.13 },
              { ratio: 4, type: "sine", detune: 0, level: 0.035 },
            ];

    for (const partial of partials) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = partial.type;
      oscillator.frequency.value = frequency * partial.ratio;
      oscillator.detune.value = partial.detune;
      partialGain.gain.value = partial.level;
      oscillator.connect(partialGain);
      partialGain.connect(gain);
      oscillator.start(startAt);
      oscillators.push(oscillator);
    }

    this.voices.set(voiceId, {
      gain,
      oscillators,
      peak,
      released: false,
    });
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
    const stopAt = Math.max(context.currentTime, when ?? context.currentTime);
    const release = Math.max(0.015, releaseSeconds);
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

    globalThis.setTimeout(() => {
      if (this.voices.get(voiceId) === voice) {
        this.voices.delete(voiceId);
      }
      try {
        voice.gain.disconnect();
      } catch {
        // Already disconnected.
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
    const context = this.context;
    this.context = null;
    this.master = null;
    this.compressor = null;
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

