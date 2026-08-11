"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KeyboardSynth } from "@/lib/audio";
import { MIDI_MAX, MIDI_MIN, type Song, type SongNote } from "@/lib/songs";

export type PracticeMode = "flow" | "wait" | "listen";
export type NoteGrade = "perfect" | "great" | "good" | "miss";
export type MIDIPermissionState =
  | "unsupported"
  | "idle"
  | "prompt"
  | "granted"
  | "denied";

export interface NoteResult {
  id: string;
  midi: number;
  grade: NoteGrade;
  offsetMs: number;
}

export interface KeyboardHeroScore {
  points: number;
  combo: number;
  bestCombo: number;
  hits: number;
  misses: number;
  accuracy: number;
}

export interface MIDIInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export interface KeyboardHeroMIDIState {
  supported: boolean;
  permission: MIDIPermissionState;
  inputs: MIDIInputInfo[];
  selectedInputId: string | null;
  connectedName: string | null;
  /** Manual MIDI channel, zero-based. Null enables automatic channel detection. */
  channel: number | null;
  /** Zero-based channel learned from the first in-range note-on in Auto mode. */
  detectedChannel: number | null;
  lastNote: number | null;
  lastVelocity: number;
  lastMessageInRange: boolean | null;
  error: string | null;
}

export interface KeyboardHeroSettings {
  tempoScale: number;
  practiceMode: PracticeMode;
  metronomeEnabled: boolean;
  synthEnabled: boolean;
  backingBandEnabled: boolean;
  backingBandMix: number;
  backingBandIntensity: number;
  latencyMs: number;
}

export interface KeyboardHeroBackingBandState {
  active: boolean;
  /** Normalized live pulse for visual meters. */
  energy: number;
}

export interface KeyboardHeroLoop {
  enabled: boolean;
  startBeat: number;
  endBeat: number;
}

export interface KeyboardHeroCore {
  positionBeat: number;
  /** Rendering position, including the negative five-second pre-roll runway. */
  visualBeat: number;
  positionSeconds: number;
  isPlaying: boolean;
  /** True while the non-interactive visual tail clears the stage. */
  isFinishing: boolean;
  /** True only after natural playback and its visual tail have completed. */
  songComplete: boolean;
  countdown: number | null;
  pressedNotes: Set<number>;
  noteResults: Map<string, NoteResult>;
  latestFeedback: NoteResult | null;
  /** Recent uniquely keyed hit/miss events, including simultaneous chord tones. */
  feedbackEvents: NoteResult[];
  score: KeyboardHeroScore;
  midi: KeyboardHeroMIDIState;
  backingBand: KeyboardHeroBackingBandState;
  settings: KeyboardHeroSettings;
  loop: KeyboardHeroLoop;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  seekBeat: (beat: number) => void;
  rewindBeats: (beats?: number) => void;
  restart: () => void;
  setTempoScale: (scale: number) => void;
  setPracticeMode: (mode: PracticeMode) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  setSynthEnabled: (enabled: boolean) => void;
  setBackingBandEnabled: (enabled: boolean) => void;
  setBackingBandMix: (mix: number) => void;
  setBackingBandIntensity: (intensity: number) => void;
  setLatencyMs: (latencyMs: number) => void;
  setLoop: (startBeat: number, endBeat: number, enabled?: boolean) => void;
  toggleLoop: () => void;
  connectMIDI: () => Promise<void>;
  selectMIDIInput: (inputId: string | null) => void;
  setMIDIChannel: (channel: number | null) => void;
  noteOn: (midi: number, velocity?: number, source?: string) => void;
  noteOff: (midi: number, source?: string) => void;
  resetScore: () => void;
}

interface MIDIMessageLike {
  data: Uint8Array;
}

interface MIDIInputLike {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: "connected" | "disconnected";
  onmidimessage: ((event: MIDIMessageLike) => void) | null;
}

interface MIDIAccessLike {
  inputs: { values(): IterableIterator<MIDIInputLike> };
  onstatechange: (() => void) | null;
}

type MIDIEnabledNavigator = Navigator & {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccessLike>;
};

const SETTINGS_KEY = "keyboard-hero.settings.v1";
const PRE_ROLL_SECONDS = 5;
const POST_ROLL_MIN_SECONDS = 2.5;
const POST_ROLL_CLEARANCE_BEATS = 1.75;
const FEEDBACK_HISTORY_LIMIT = 16;
const DEFAULT_SETTINGS: KeyboardHeroSettings = {
  tempoScale: 1,
  practiceMode: "flow",
  metronomeEnabled: true,
  synthEnabled: true,
  backingBandEnabled: true,
  backingBandMix: 0.58,
  backingBandIntensity: 0.65,
  latencyMs: 0,
};
const EMPTY_SCORE: KeyboardHeroScore = {
  points: 0,
  combo: 0,
  bestCombo: 0,
  hits: 0,
  misses: 0,
  accuracy: 100,
};

const COMPUTER_KEYS: Readonly<Record<string, number>> = {
  KeyZ: 48,
  KeyS: 49,
  KeyX: 50,
  KeyD: 51,
  KeyC: 52,
  KeyV: 53,
  KeyG: 54,
  KeyB: 55,
  KeyH: 56,
  KeyN: 57,
  KeyJ: 58,
  KeyM: 59,
  Comma: 60,
  KeyQ: 60,
  Digit2: 61,
  KeyW: 62,
  Digit3: 63,
  KeyE: 64,
  KeyR: 65,
  Digit5: 66,
  KeyT: 67,
  Digit6: 68,
  KeyY: 69,
  Digit7: 70,
  KeyU: 71,
  KeyI: 72,
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const scoreAccuracy = (hits: number, misses: number): number => {
  const attempts = hits + misses;
  return attempts === 0 ? 100 : (hits / attempts) * 100;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
};

function readSettings(): KeyboardHeroSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SETTINGS_KEY) ?? "{}",
    ) as Partial<KeyboardHeroSettings>;
    const practiceMode: PracticeMode =
      parsed.practiceMode === "wait" || parsed.practiceMode === "listen"
        ? parsed.practiceMode
        : "flow";
    return {
      tempoScale: clamp(Number(parsed.tempoScale) || 1, 0.25, 1.25),
      practiceMode,
      metronomeEnabled: parsed.metronomeEnabled ?? true,
      synthEnabled: parsed.synthEnabled ?? true,
      backingBandEnabled: parsed.backingBandEnabled ?? true,
      backingBandMix: clamp(
        Number.isFinite(Number(parsed.backingBandMix))
          ? Number(parsed.backingBandMix)
          : DEFAULT_SETTINGS.backingBandMix,
        0,
        1,
      ),
      backingBandIntensity: clamp(
        Number.isFinite(Number(parsed.backingBandIntensity))
          ? Number(parsed.backingBandIntensity)
          : DEFAULT_SETTINGS.backingBandIntensity,
        0,
        1,
      ),
      latencyMs: clamp(Number(parsed.latencyMs) || 0, -250, 250),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function resultFor(note: SongNote, offsetMs: number): NoteResult {
  const absoluteOffset = Math.abs(offsetMs);
  const grade: NoteGrade =
    absoluteOffset <= 55
      ? "perfect"
      : absoluteOffset <= 105
        ? "great"
        : absoluteOffset <= 180
          ? "good"
          : "miss";
  return { id: note.id, midi: note.midi, grade, offsetMs };
}

export function useKeyboardHeroCore(song: Song): KeyboardHeroCore {
  const [settings, setSettings] = useState<KeyboardHeroSettings>(DEFAULT_SETTINGS);
  const [positionBeat, setPositionBeatState] = useState(0);
  const [visualBeat, setVisualBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [songComplete, setSongComplete] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(() => new Set());
  const [noteResults, setNoteResults] = useState<Map<string, NoteResult>>(
    () => new Map(),
  );
  const [latestFeedback, setLatestFeedback] = useState<NoteResult | null>(null);
  const [feedbackEvents, setFeedbackEvents] = useState<NoteResult[]>([]);
  const [score, setScore] = useState<KeyboardHeroScore>(EMPTY_SCORE);
  const [backingBand, setBackingBand] = useState<KeyboardHeroBackingBandState>({
    active: false,
    energy: 0,
  });
  const [loop, setLoopState] = useState<KeyboardHeroLoop>({
    enabled: false,
    startBeat: 0,
    endBeat: song.durationBeats,
  });
  const [midi, setMIDI] = useState<KeyboardHeroMIDIState>(() => ({
    // Keep the server and first browser render identical. Capability detection
    // runs after hydration so unsupported-browser guidance never mismatches.
    supported: true,
    permission: "idle",
    inputs: [],
    selectedInputId: null,
    connectedName: null,
    channel: null,
    detectedChannel: null,
    lastNote: null,
    lastVelocity: 0,
    lastMessageInRange: null,
    error: null,
  }));

  const synthRef = useRef<KeyboardSynth | null>(null);
  const midiAccessRef = useRef<MIDIAccessLike | null>(null);
  const midiInputRef = useRef<MIDIInputLike | null>(null);
  const selectedMIDIIdRef = useRef<string | null>(null);
  const midiChannelRef = useRef<number | null>(null);
  const detectedMIDIChannelRef = useRef<number | null>(null);
  const noteOnRef = useRef<(midi: number, velocity?: number, source?: string) => void>(
    () => undefined,
  );
  const noteOffRef = useRef<(midi: number, source?: string) => void>(() => undefined);
  const positionRef = useRef(0);
  const resultsRef = useRef(noteResults);
  const settingsRef = useRef(settings);
  const settingsReadyRef = useRef(false);
  const loopRef = useRef(loop);
  const isPlayingRef = useRef(false);
  const isFinishingRef = useRef(false);
  const postRollStartTimeRef = useRef(0);
  const postRollBeatRateRef = useRef(0);
  const postRollDurationRef = useRef(POST_ROLL_MIN_SECONDS);
  const countInSecondsRef = useRef(0);
  const countInEndTimeRef = useRef(0);
  const countInBeatRateRef = useRef(0);
  const preRollVisualBeatRef = useRef(0);
  const heldSourcesRef = useRef<Map<number, Set<string>>>(new Map());
  const listenVoicesRef = useRef<Set<string>>(new Set());
  const lastMetronomeBeatRef = useRef<number | null>(null);
  const feedbackSequenceRef = useRef(0);
  const backingBandActiveRef = useRef(false);

  const synth = useCallback((): KeyboardSynth => {
    if (!synthRef.current) {
      synthRef.current = new KeyboardSynth();
      synthRef.current.setAccompanimentVolume(
        settingsRef.current.backingBandMix,
      );
    }
    return synthRef.current;
  }, []);

  const commitPosition = useCallback(
    (beat: number) => {
      const next = clamp(beat, 0, song.durationBeats);
      positionRef.current = next;
      setPositionBeatState(next);
      setVisualBeat(next);
    },
    [song.durationBeats],
  );

  const stopListenVoices = useCallback(() => {
    const instrument = synthRef.current;
    for (const noteId of listenVoicesRef.current) {
      instrument?.noteOff(`listen:${noteId}`, undefined, 0.04);
    }
    listenVoicesRef.current.clear();
  }, []);

  const setBackingBandFrame = useCallback((active: boolean, energy = 0) => {
    backingBandActiveRef.current = active;
    const normalizedEnergy = active ? clamp(energy, 0, 1) : 0;
    setBackingBand((current) =>
      current.active === active &&
      Math.abs(current.energy - normalizedEnergy) < 0.005
        ? current
        : { active, energy: normalizedEnergy },
    );
  }, []);

  const stopBackingBand = useCallback(
    (immediate = true) => {
      synthRef.current?.stopAccompaniment(immediate);
      setBackingBandFrame(false);
    },
    [setBackingBandFrame],
  );

  const syncBackingBand = useCallback(
    (
      beat: number,
      currentSettings: KeyboardHeroSettings,
      currentLoop: KeyboardHeroLoop = loopRef.current,
    ) => {
      const normalizedBeat = Math.max(0, beat);
      if (
        !currentSettings.backingBandEnabled ||
        currentSettings.backingBandMix <= 0
      ) {
        if (backingBandActiveRef.current) {
          synthRef.current?.stopAccompaniment(true);
          setBackingBandFrame(false);
        }
        return;
      }

      const instrument = synth();
      if (instrument.state !== "running") {
        setBackingBandFrame(false);
        return;
      }

      const accompanimentRunning = instrument.syncAccompaniment({
        song,
        beat: normalizedBeat,
        tempoScale: currentSettings.tempoScale,
        loop: currentLoop,
        intensity: currentSettings.backingBandIntensity,
      });
      if (!accompanimentRunning) {
        setBackingBandFrame(false);
        return;
      }

      const beatFloor = Math.floor(normalizedBeat);
      const stepIndex = Math.floor(normalizedBeat * 2 + 0.000_001);
      const subdivisionPhase = normalizedBeat * 2 - stepIndex;
      const pulse = (1 - subdivisionPhase) ** 3;
      const downbeat = beatFloor % song.timeSignature[0] === 0;
      const energy = Math.sqrt(currentSettings.backingBandMix) *
        (0.28 + currentSettings.backingBandIntensity * 0.62) *
        (0.55 + pulse * 0.45) *
        (downbeat ? 1.08 : 1);
      setBackingBandFrame(true, clamp(energy, 0, 1));
    },
    [setBackingBandFrame, song, synth],
  );

  const resetScore = useCallback(() => {
    resultsRef.current = new Map();
    setNoteResults(new Map());
    setLatestFeedback(null);
    setFeedbackEvents([]);
    setScore(EMPTY_SCORE);
  }, []);

  const pause = useCallback(() => {
    const wasFinishing = isFinishingRef.current;
    isPlayingRef.current = false;
    isFinishingRef.current = false;
    postRollStartTimeRef.current = 0;
    postRollBeatRateRef.current = 0;
    postRollDurationRef.current = POST_ROLL_MIN_SECONDS;
    setIsPlaying(false);
    setIsFinishing(false);
    countInSecondsRef.current = 0;
    countInEndTimeRef.current = 0;
    preRollVisualBeatRef.current = positionRef.current;
    setCountdown(null);
    if (!wasFinishing) setVisualBeat(positionRef.current);
    if (wasFinishing) setSongComplete(true);
    lastMetronomeBeatRef.current = null;
    stopListenVoices();
    stopBackingBand(true);
  }, [stopBackingBand, stopListenVoices]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    isFinishingRef.current = false;
    setIsFinishing(false);
    setSongComplete(false);
    if (positionRef.current >= song.durationBeats) {
      commitPosition(0);
      resetScore();
    }
    stopBackingBand(true);
    void synth().resume();
    const shouldCountIn = positionRef.current === 0;
    const beatRate = (song.bpm * settingsRef.current.tempoScale) / 60;
    countInSecondsRef.current = shouldCountIn ? PRE_ROLL_SECONDS : 0;
    countInEndTimeRef.current = shouldCountIn
      ? performance.now() + PRE_ROLL_SECONDS * 1000
      : 0;
    countInBeatRateRef.current = beatRate;
    const preRollStartBeat = shouldCountIn
      ? -PRE_ROLL_SECONDS * beatRate
      : positionRef.current;
    preRollVisualBeatRef.current = preRollStartBeat;
    setVisualBeat(preRollStartBeat);
    setCountdown(shouldCountIn ? PRE_ROLL_SECONDS : null);
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [commitPosition, resetScore, song.bpm, song.durationBeats, stopBackingBand, synth]);

  const seekBeat = useCallback(
    (beat: number) => {
      const destination = clamp(beat, 0, song.durationBeats);
      stopListenVoices();
      stopBackingBand(true);
      isFinishingRef.current = false;
      postRollStartTimeRef.current = 0;
      postRollBeatRateRef.current = 0;
      postRollDurationRef.current = POST_ROLL_MIN_SECONDS;
      setIsFinishing(false);
      setSongComplete(false);
      countInSecondsRef.current = 0;
      countInEndTimeRef.current = 0;
      preRollVisualBeatRef.current = destination;
      setCountdown(null);
      lastMetronomeBeatRef.current = null;
      const reopenedResults = new Map(resultsRef.current);
      for (const note of song.notes) {
        if (note.startBeat >= destination) reopenedResults.delete(note.id);
      }
      resultsRef.current = reopenedResults;
      setNoteResults(reopenedResults);
      setLatestFeedback(null);
      setFeedbackEvents([]);
      commitPosition(destination);
    },
    [
      commitPosition,
      song.durationBeats,
      song.notes,
      stopBackingBand,
      stopListenVoices,
    ],
  );

  const restart = useCallback(() => {
    pause();
    setSongComplete(false);
    commitPosition(loopRef.current.enabled ? loopRef.current.startBeat : 0);
    resetScore();
  }, [commitPosition, pause, resetScore]);

  const rewindBeats = useCallback(
    (beats = 4) => seekBeat(positionRef.current - Math.max(0, beats)),
    [seekBeat],
  );

  const registerResult = useCallback((result: NoteResult) => {
    resultsRef.current = new Map(resultsRef.current).set(result.id, result);
    setNoteResults(resultsRef.current);
    feedbackSequenceRef.current += 1;
    const feedbackEvent: NoteResult = {
      ...result,
      id: `${result.id}:feedback-${feedbackSequenceRef.current}`,
    };
    setLatestFeedback(feedbackEvent);
    setFeedbackEvents((current) =>
      [...current, feedbackEvent].slice(-FEEDBACK_HISTORY_LIMIT),
    );
    setScore((current) => {
      if (result.grade === "miss") {
        const misses = current.misses + 1;
        return {
          ...current,
          combo: 0,
          misses,
          accuracy: scoreAccuracy(current.hits, misses),
        };
      }
      const combo = current.combo + 1;
      const gradePoints =
        result.grade === "perfect" ? 1000 : result.grade === "great" ? 700 : 450;
      const hits = current.hits + 1;
      return {
        points: current.points + gradePoints + Math.min(500, combo * 10),
        combo,
        bestCombo: Math.max(current.bestCombo, combo),
        hits,
        misses: current.misses,
        accuracy: scoreAccuracy(hits, current.misses),
      };
    });
  }, []);

  const noteOn = useCallback(
    (midiNote: number, velocity = 100, source = "manual") => {
      if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127) return;
      const sourceId = `${source}:${midiNote}`;
      const held = heldSourcesRef.current.get(midiNote) ?? new Set<string>();
      if (held.has(sourceId)) return;
      held.add(sourceId);
      heldSourcesRef.current.set(midiNote, held);
      setPressedNotes(new Set(heldSourcesRef.current.keys()));

      if (settingsRef.current.synthEnabled) {
        const normalizedVelocity =
          velocity <= 1 ? velocity : velocity / 127;
        void synth().resume().then(() => {
          if (heldSourcesRef.current.get(midiNote)?.has(sourceId)) {
            synth().noteOn(
              sourceId,
              midiNote,
              clamp(normalizedVelocity, 0.03, 1),
            );
          }
        });
      }

      if (
        settingsRef.current.practiceMode === "listen" ||
        !isPlayingRef.current ||
        isFinishingRef.current ||
        countInSecondsRef.current > 0
      ) {
        return;
      }
      const millisecondsPerBeat =
        60_000 / (song.bpm * settingsRef.current.tempoScale);
      const judgedBeat =
        positionRef.current - settingsRef.current.latencyMs / millisecondsPerBeat;
      const candidate = song.notes
        .filter(
          (note) =>
            note.midi === midiNote &&
            !resultsRef.current.has(note.id) &&
            Math.abs(note.startBeat - judgedBeat) * millisecondsPerBeat <= 180,
        )
        .sort(
          (a, b) =>
            Math.abs(a.startBeat - judgedBeat) - Math.abs(b.startBeat - judgedBeat),
        )[0];

      if (candidate) {
        registerResult(
          resultFor(candidate, (judgedBeat - candidate.startBeat) * millisecondsPerBeat),
        );
        if (
          settingsRef.current.practiceMode === "wait" &&
          settingsRef.current.backingBandEnabled &&
          !backingBandActiveRef.current
        ) {
          const stillBlocked = song.notes.some(
            (note) =>
              !resultsRef.current.has(note.id) &&
              Math.abs(note.startBeat - positionRef.current) < 0.000_001,
          );
          if (!stillBlocked) {
            syncBackingBand(
              positionRef.current,
              settingsRef.current,
            );
          }
        }
      } else {
        registerResult({
          id: `extra-${sourceId}-${performance.now().toFixed(1)}`,
          midi: midiNote,
          grade: "miss",
          offsetMs: 0,
        });
      }
    },
    [registerResult, song.bpm, song.notes, syncBackingBand, synth],
  );

  const noteOff = useCallback((midiNote: number, source = "manual") => {
    const sourceId = `${source}:${midiNote}`;
    synthRef.current?.noteOff(sourceId);
    const held = heldSourcesRef.current.get(midiNote);
    held?.delete(sourceId);
    if (held?.size === 0) heldSourcesRef.current.delete(midiNote);
    setPressedNotes(new Set(heldSourcesRef.current.keys()));
  }, []);

  const releaseHeldSources = useCallback((sourcePrefix: string) => {
    for (const [midiNote, sources] of heldSourcesRef.current) {
      for (const sourceId of [...sources]) {
        if (!sourceId.startsWith(sourcePrefix)) continue;
        synthRef.current?.noteOff(sourceId, undefined, 0.04);
        sources.delete(sourceId);
      }
      if (sources.size === 0) heldSourcesRef.current.delete(midiNote);
    }
    setPressedNotes(new Set(heldSourcesRef.current.keys()));
  }, []);

  noteOnRef.current = noteOn;
  noteOffRef.current = noteOff;

  const setTempoScale = useCallback((scale: number) => {
    if (countInSecondsRef.current > 0) return;
    setSettings((current) => ({
      ...current,
      tempoScale: clamp(scale, 0.25, 1.25),
    }));
  }, []);

  const setPracticeMode = useCallback(
    (practiceMode: PracticeMode) => {
      if (
        practiceMode !== "flow" &&
        practiceMode !== "wait" &&
        practiceMode !== "listen"
      ) {
        return;
      }
      if (
        settingsRef.current.practiceMode === "listen" &&
        practiceMode !== "listen"
      ) {
        stopListenVoices();
      }
      setSettings((current) => ({ ...current, practiceMode }));
    },
    [stopListenVoices],
  );

  const setMetronomeEnabled = useCallback((metronomeEnabled: boolean) => {
    setSettings((current) => ({ ...current, metronomeEnabled }));
  }, []);

  const setSynthEnabled = useCallback((synthEnabled: boolean) => {
    setSettings((current) => ({ ...current, synthEnabled }));
    if (!synthEnabled) synthRef.current?.allNotesOff(true);
  }, []);

  const setBackingBandEnabled = useCallback(
    (backingBandEnabled: boolean) => {
      setSettings((current) => {
        const next = { ...current, backingBandEnabled };
        settingsRef.current = next;
        return next;
      });
      if (!backingBandEnabled) stopBackingBand(true);
    },
    [stopBackingBand],
  );

  const setBackingBandMix = useCallback((mix: number) => {
    const backingBandMix = clamp(mix, 0, 1);
    setSettings((current) => {
      const next = { ...current, backingBandMix };
      settingsRef.current = next;
      return next;
    });
    synthRef.current?.setAccompanimentVolume(backingBandMix);
  }, []);

  const setBackingBandIntensity = useCallback((intensity: number) => {
    const backingBandIntensity = clamp(intensity, 0, 1);
    setSettings((current) => {
      const next = { ...current, backingBandIntensity };
      settingsRef.current = next;
      return next;
    });
  }, []);

  const setLatencyMs = useCallback((latencyMs: number) => {
    setSettings((current) => ({
      ...current,
      latencyMs: clamp(latencyMs, -250, 250),
    }));
  }, []);

  const setLoop = useCallback(
    (startBeat: number, endBeat: number, enabled = true) => {
      const start = clamp(startBeat, 0, Math.max(0, song.durationBeats - 0.25));
      const end = clamp(endBeat, start + 0.25, song.durationBeats);
      const nextLoop = { enabled, startBeat: start, endBeat: end };
      stopBackingBand(true);
      loopRef.current = nextLoop;
      setLoopState(nextLoop);
      if (enabled && (positionRef.current < start || positionRef.current >= end)) {
        seekBeat(start);
      }
    },
    [seekBeat, song.durationBeats, stopBackingBand],
  );

  const toggleLoop = useCallback(() => {
    const current = loopRef.current;
    const nextLoop = { ...current, enabled: !current.enabled };
    stopBackingBand(true);
    loopRef.current = nextLoop;
    setLoopState(nextLoop);
    if (
      nextLoop.enabled &&
      (positionRef.current < nextLoop.startBeat ||
        positionRef.current >= nextLoop.endBeat)
    ) {
      seekBeat(nextLoop.startBeat);
    }
  }, [seekBeat, stopBackingBand]);

  const resetMIDIActivity = useCallback(() => {
    detectedMIDIChannelRef.current = null;
    setMIDI((current) => ({
      ...current,
      detectedChannel: null,
      lastNote: null,
      lastVelocity: 0,
      lastMessageInRange: null,
    }));
  }, []);

  const setMIDIChannel = useCallback(
    (channel: number | null) => {
      if (
        channel !== null &&
        (!Number.isInteger(channel) || channel < 0 || channel > 15)
      ) {
        return;
      }
      releaseHeldSources("midi:");
      midiChannelRef.current = channel;
      detectedMIDIChannelRef.current = null;
      setMIDI((current) => ({
        ...current,
        channel,
        detectedChannel: null,
        lastNote: null,
        lastVelocity: 0,
        lastMessageInRange: null,
      }));
    },
    [releaseHeldSources],
  );

  const bindMIDIInput = useCallback((input: MIDIInputLike) => {
    input.onmidimessage = (event) => {
      const [status = 0, note = 0, velocity = 0] = event.data;
      const command = status & 0xf0;
      const isNoteOn = command === 0x90 && velocity > 0;
      const isNoteOff = command === 0x80 || (command === 0x90 && velocity === 0);
      if (!isNoteOn && !isNoteOff) return;

      const channel = status & 0x0f;
      const inRange = note >= MIDI_MIN && note <= MIDI_MAX;
      setMIDI((current) => ({
        ...current,
        lastNote: note,
        lastVelocity: velocity,
        lastMessageInRange: inRange,
      }));
      if (!inRange) return;

      const manualChannel = midiChannelRef.current;
      if (manualChannel !== null && channel !== manualChannel) return;
      if (manualChannel === null) {
        const detectedChannel = detectedMIDIChannelRef.current;
        if (detectedChannel === null) {
          if (!isNoteOn) return;
          detectedMIDIChannelRef.current = channel;
          setMIDI((current) => ({ ...current, detectedChannel: channel }));
        } else if (channel !== detectedChannel) {
          return;
        }
      }

      const source = `midi:${input.id}:ch${channel}`;
      if (isNoteOn) {
        noteOnRef.current(note, velocity, source);
      } else {
        noteOffRef.current(note, source);
      }
    };
  }, []);

  const refreshMIDIInputs = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) return;
    const inputs = Array.from(access.inputs.values());
    const infos = inputs.map((input) => ({
      id: input.id,
      name: input.name || "MIDI keyboard",
      manufacturer: input.manufacturer || "Unknown manufacturer",
      connected: input.state === "connected",
    }));
    const selected = inputs.find(
      (input) => input.id === selectedMIDIIdRef.current && input.state === "connected",
    );
    const previous = midiInputRef.current;
    if (previous !== (selected ?? null)) {
      if (previous) previous.onmidimessage = null;
      releaseHeldSources("midi:");
      resetMIDIActivity();
    }
    midiInputRef.current = selected ?? null;
    if (selected) bindMIDIInput(selected);
    setMIDI((current) => ({
      ...current,
      inputs: infos,
      selectedInputId: selected?.id ?? null,
      connectedName: selected?.name || null,
    }));
  }, [bindMIDIInput, releaseHeldSources, resetMIDIActivity]);

  const selectMIDIInput = useCallback(
    (inputId: string | null) => {
      const inputChanged = selectedMIDIIdRef.current !== inputId;
      const previous = midiInputRef.current;
      if (previous) {
        previous.onmidimessage = null;
      }
      if (inputChanged) {
        releaseHeldSources("midi:");
        resetMIDIActivity();
      }
      selectedMIDIIdRef.current = inputId;
      const input = Array.from(midiAccessRef.current?.inputs.values() ?? []).find(
        (candidate) => candidate.id === inputId && candidate.state === "connected",
      );
      midiInputRef.current = input ?? null;
      if (input) bindMIDIInput(input);
      setMIDI((current) => ({
        ...current,
        selectedInputId: input?.id ?? null,
        connectedName: input?.name || null,
        error: inputId && !input ? "That MIDI input is no longer connected." : null,
      }));
    },
    [bindMIDIInput, releaseHeldSources, resetMIDIActivity],
  );

  const connectMIDI = useCallback(async () => {
    const requestMIDIAccess = (navigator as MIDIEnabledNavigator).requestMIDIAccess;
    if (!requestMIDIAccess) {
      setMIDI((current) => ({
        ...current,
        supported: false,
        permission: "unsupported",
        error: "Web MIDI is not supported in this browser.",
      }));
      return;
    }
    setMIDI((current) => ({ ...current, permission: "prompt", error: null }));
    try {
      const access = await requestMIDIAccess.call(navigator, { sysex: false });
      midiAccessRef.current = access;
      access.onstatechange = refreshMIDIInputs;
      setMIDI((current) => ({
        ...current,
        supported: true,
        permission: "granted",
        error: null,
      }));
      refreshMIDIInputs();
      const connectedInputs = Array.from(access.inputs.values()).filter(
        (input) => input.state === "connected",
      );
      const retainedInput = connectedInputs.find(
        (input) => input.id === selectedMIDIIdRef.current,
      );
      const exactMPKInput = connectedInputs.find(
        (input) => input.name?.trim().toLowerCase() === "mpk mini iv",
      );
      const aliasedMPKInput = connectedInputs.find((input) => {
        const name = input.name?.toLowerCase() ?? "";
        return name.includes("mpk mini iv") || name.includes("mpk mini 4");
      });
      const preferredInput =
        retainedInput ?? exactMPKInput ?? aliasedMPKInput ?? connectedInputs[0];
      if (preferredInput) selectMIDIInput(preferredInput.id);
    } catch (error) {
      setMIDI((current) => ({
        ...current,
        permission: "denied",
        error:
          error instanceof Error
            ? error.message
            : "MIDI access was denied. Check the browser site permission.",
      }));
    }
  }, [refreshMIDIInputs, selectMIDIInput]);

  useEffect(() => {
    setSettings(readSettings());
    setMIDI((current) => ({
      ...current,
      supported:
        typeof (navigator as MIDIEnabledNavigator).requestMIDIAccess ===
        "function",
    }));
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    synthRef.current?.setAccompanimentVolume(settings.backingBandMix);
    if (!settingsReadyRef.current) {
      settingsReadyRef.current = true;
      return;
    }
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing and embedded previews can disable storage.
    }
  }, [settings]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    resultsRef.current = noteResults;
  }, [noteResults]);

  useEffect(() => {
    pause();
    setSongComplete(false);
    commitPosition(0);
    resetScore();
    setLoopState({ enabled: false, startBeat: 0, endBeat: song.durationBeats });
  }, [commitPosition, pause, resetScore, song.id, song.durationBeats]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const midiNote = COMPUTER_KEYS[event.code];
      if (midiNote === undefined || event.repeat || isEditableTarget(event.target)) return;
      event.preventDefault();
      noteOnRef.current(midiNote, 104, `keyboard:${event.code}`);
    };
    const up = (event: KeyboardEvent) => {
      const midiNote = COMPUTER_KEYS[event.code];
      if (midiNote === undefined) return;
      event.preventDefault();
      noteOffRef.current(midiNote, `keyboard:${event.code}`);
    };
    const blur = () => releaseHeldSources("keyboard:");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [releaseHeldSources]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let previousTime = performance.now();

    const animate = (now: number) => {
      if (!isPlayingRef.current) return;
      const deltaSeconds = Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const currentSettings = settingsRef.current;
      const beatsAdvanced =
        deltaSeconds * (song.bpm * currentSettings.tempoScale) / 60;

      if (isFinishingRef.current) {
        const elapsedSeconds = Math.max(
          0,
          (now - postRollStartTimeRef.current) / 1000,
        );
        const postRollDuration = postRollDurationRef.current;
        const boundedSeconds = Math.min(postRollDuration, elapsedSeconds);
        setVisualBeat(
          song.durationBeats + boundedSeconds * postRollBeatRateRef.current,
        );
        if (elapsedSeconds >= postRollDuration) {
          isFinishingRef.current = false;
          isPlayingRef.current = false;
          setIsFinishing(false);
          setIsPlaying(false);
          setSongComplete(true);
          return;
        }
        frame = requestAnimationFrame(animate);
        return;
      }

      if (countInSecondsRef.current > 0) {
        const remainingSeconds = Math.max(
          0,
          (countInEndTimeRef.current - now) / 1000,
        );
        countInSecondsRef.current = remainingSeconds;
        const afterDisplay = Math.ceil(remainingSeconds);
        const nextVisualBeat =
          remainingSeconds > 0
            ? -remainingSeconds * countInBeatRateRef.current
            : 0;
        const previousVisualBeat = preRollVisualBeatRef.current;
        const crossedBeat = Math.floor(nextVisualBeat + 0.000_001);
        if (
          currentSettings.metronomeEnabled &&
          crossedBeat <= 0 &&
          crossedBeat > Math.floor(previousVisualBeat + 0.000_001)
        ) {
          synth().playMetronome(
            crossedBeat % song.timeSignature[0] === 0,
          );
          if (crossedBeat === 0) lastMetronomeBeatRef.current = 0;
        }
        preRollVisualBeatRef.current = nextVisualBeat;
        setVisualBeat(nextVisualBeat);
        setCountdown(remainingSeconds > 0 ? afterDisplay : null);
        if (remainingSeconds === 0) {
          const loopAtStart = loopRef.current;
          const waitIsBlockedAtZero =
            currentSettings.practiceMode === "wait" &&
            song.notes.some(
              (note) =>
                !resultsRef.current.has(note.id) &&
                Math.abs(note.startBeat) < 0.000_001 &&
                (!loopAtStart.enabled || note.startBeat < loopAtStart.endBeat),
            );
          if (!waitIsBlockedAtZero) {
            syncBackingBand(0, currentSettings);
          }
        }
        frame = requestAnimationFrame(animate);
        return;
      }

      const oldBeat = positionRef.current;
      let nextBeat = oldBeat + beatsAdvanced;
      const activeLoop = loopRef.current;
      const loopEnd = activeLoop.enabled ? activeLoop.endBeat : song.durationBeats;
      let waitBlocked = false;

      if (currentSettings.practiceMode === "wait") {
        const blockingBeat = song.notes
          .filter(
            (note) =>
              !resultsRef.current.has(note.id) &&
              note.startBeat < loopEnd - 0.000_001 &&
              note.startBeat >= oldBeat - 0.001 &&
              note.startBeat <= nextBeat + 0.001,
          )
          .reduce<number | null>(
            (minimum, note) =>
              minimum === null ? note.startBeat : Math.min(minimum, note.startBeat),
            null,
          );
        if (blockingBeat !== null) {
          nextBeat = Math.min(nextBeat, blockingBeat);
          waitBlocked = Math.abs(nextBeat - oldBeat) < 0.000_001;
        }
      }

      if (currentSettings.practiceMode === "flow") {
        const millisecondsPerBeat = 60_000 / (song.bpm * currentSettings.tempoScale);
        const missed = song.notes.filter(
          (note) =>
            !resultsRef.current.has(note.id) &&
            note.startBeat >= oldBeat - 0.5 &&
            nextBeat - note.startBeat > 180 / millisecondsPerBeat,
        );
        for (const note of missed) {
          registerResult({
            id: note.id,
            midi: note.midi,
            grade: "miss",
            offsetMs: (nextBeat - note.startBeat) * millisecondsPerBeat,
          });
        }
      }

      if (currentSettings.practiceMode === "listen" && currentSettings.synthEnabled) {
        for (const note of song.notes) {
          const voiceId = `listen:${note.id}`;
          const active = nextBeat >= note.startBeat && nextBeat < note.startBeat + note.durationBeats;
          if (active && !listenVoicesRef.current.has(note.id)) {
            listenVoicesRef.current.add(note.id);
            synth().noteOn(voiceId, note.midi, (note.velocity ?? 92) / 127);
          } else if (!active && listenVoicesRef.current.has(note.id)) {
            listenVoicesRef.current.delete(note.id);
            synth().noteOff(voiceId, undefined, 0.06);
          }
        }
      }

      const beatNumber = Math.floor(nextBeat + 0.0001);
      if (
        currentSettings.metronomeEnabled &&
        beatNumber !== lastMetronomeBeatRef.current
      ) {
        lastMetronomeBeatRef.current = beatNumber;
        synth().playMetronome(beatNumber % song.timeSignature[0] === 0);
      }

      if (nextBeat >= loopEnd) {
        if (activeLoop.enabled) {
          nextBeat = activeLoop.startBeat + (nextBeat - loopEnd);
          stopListenVoices();
          stopBackingBand(true);
          const freshResults = new Map(resultsRef.current);
          for (const note of song.notes) {
            if (note.startBeat >= activeLoop.startBeat && note.startBeat < activeLoop.endBeat) {
              freshResults.delete(note.id);
            }
          }
          resultsRef.current = freshResults;
          setNoteResults(freshResults);
          lastMetronomeBeatRef.current = null;
        } else {
          if (currentSettings.practiceMode === "flow") {
            const millisecondsPerBeat =
              60_000 / (song.bpm * currentSettings.tempoScale);
            for (const note of song.notes) {
              if (resultsRef.current.has(note.id)) continue;
              registerResult({
                id: note.id,
                midi: note.midi,
                grade: "miss",
                offsetMs:
                  (song.durationBeats - note.startBeat) * millisecondsPerBeat,
              });
            }
          }
          commitPosition(song.durationBeats);
          stopListenVoices();
          stopBackingBand(false);
          isFinishingRef.current = true;
          postRollStartTimeRef.current = now;
          postRollBeatRateRef.current =
            (song.bpm * currentSettings.tempoScale) / 60;
          postRollDurationRef.current = Math.max(
            POST_ROLL_MIN_SECONDS,
            POST_ROLL_CLEARANCE_BEATS / postRollBeatRateRef.current,
          );
          setIsFinishing(true);
          setSongComplete(false);
          frame = requestAnimationFrame(animate);
          return;
        }
      }

      if (waitBlocked) {
        if (backingBandActiveRef.current) stopBackingBand(true);
      } else {
        syncBackingBand(nextBeat, currentSettings);
      }
      commitPosition(nextBeat);
      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [
    commitPosition,
    isPlaying,
    pause,
    registerResult,
    song,
    stopBackingBand,
    stopListenVoices,
    syncBackingBand,
    synth,
  ]);

  useEffect(
    () => () => {
      if (midiInputRef.current) midiInputRef.current.onmidimessage = null;
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
      void synthRef.current?.dispose();
    },
    [],
  );

  const positionSeconds = useMemo(
    () => (positionBeat * 60) / (song.bpm * settings.tempoScale),
    [positionBeat, settings.tempoScale, song.bpm],
  );

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  return {
    positionBeat,
    visualBeat,
    positionSeconds,
    isPlaying,
    isFinishing,
    songComplete,
    countdown,
    pressedNotes,
    noteResults,
    latestFeedback,
    feedbackEvents,
    score,
    midi,
    backingBand,
    settings,
    loop,
    togglePlay,
    play,
    pause,
    seekBeat,
    rewindBeats,
    restart,
    setTempoScale,
    setPracticeMode,
    setMetronomeEnabled,
    setSynthEnabled,
    setBackingBandEnabled,
    setBackingBandMix,
    setBackingBandIntensity,
    setLatencyMs,
    setLoop,
    toggleLoop,
    connectMIDI,
    selectMIDIInput,
    setMIDIChannel,
    noteOn,
    noteOff,
    resetScore,
  };
}
