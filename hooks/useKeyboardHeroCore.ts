"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KeyboardSynth } from "@/lib/audio";
import {
  reconcileScheduledVoices,
  transportSubdivisionAtBeat,
} from "@/lib/audioScheduling";
import {
  isValidMIDICalibrationSpan,
  mapMIDINoteToKeyboardRange,
} from "@/lib/midiCalibration";
import {
  advancePowerMode,
  applyPowerJudgement,
  authoredChordGroupId,
  completePowerMode,
  createPowerModeState,
  latchChordScoreMultiplier,
  pointsForJudgement,
  type KeyboardHeroPowerState,
} from "@/lib/powerMode";
import { MIDI_MAX, MIDI_MIN, type Song, type SongNote } from "@/lib/songs";

export type { KeyboardHeroPowerState } from "@/lib/powerMode";

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

export interface NoteFeedback extends NoteResult {
  /** Shared by all resolved tones in one authored chord; extras fall back to their unique id. */
  groupId: string;
  /** Exact score delta already including combo bonus and POWER multiplier. */
  pointsAwarded: number;
  multiplier: number;
  /** True only for the successful judgement that filled the power meter. */
  powerActivation: boolean;
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

export type MIDICalibrationPhase =
  | "idle"
  | "left"
  | "release-left"
  | "right"
  | "release-right";

export interface KeyboardHeroMIDICalibrationState {
  active: boolean;
  calibrated: boolean;
  /** A saved alignment exists but must be verified again for this connection. */
  needsVerification: boolean;
  phase: MIDICalibrationPhase;
  /** Raw device note learned from the physical leftmost key. */
  rawNote: number | null;
  /** Raw device note learned from the physical rightmost key. */
  rightRawNote: number | null;
  /** Signed semitone offset applied to accepted keybed notes. */
  transpose: number;
  error: string | null;
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
  /** Last raw note number received from the selected device. */
  lastNote: number | null;
  /** Last note after alignment, or null when it falls outside MIDI 0-127. */
  lastMappedNote: number | null;
  lastVelocity: number;
  lastMessageInRange: boolean | null;
  calibration: KeyboardHeroMIDICalibrationState;
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
  latestFeedback: NoteFeedback | null;
  /** Recent uniquely keyed hit/miss events, including simultaneous chord tones. */
  feedbackEvents: NoteFeedback[];
  score: KeyboardHeroScore;
  power: KeyboardHeroPowerState;
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
  startMIDICalibration: () => void;
  cancelMIDICalibration: () => void;
  resetMIDICalibration: () => void;
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

interface ActiveMIDINoteMapping {
  mappedNote: number;
  source: string;
}

interface MIDICalibrationCandidate {
  key: string;
  rawNote: number;
  channel: number;
  invalid: boolean;
}

type MIDIEnabledNavigator = Navigator & {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccessLike>;
};

const SETTINGS_KEY = "keyboard-hero.settings.v1";
const MIDI_CALIBRATION_KEY = "keyboard-hero.midi-calibration.v1";
const MIDI_CALIBRATION_TIMEOUT_MS = 25_000;
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
const EMPTY_MIDI_CALIBRATION: KeyboardHeroMIDICalibrationState = {
  active: false,
  calibrated: false,
  needsVerification: false,
  phase: "idle",
  rawNote: null,
  rightRawNote: null,
  transpose: 0,
  error: null,
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

interface StoredMIDICalibration {
  rawNote: number;
  rightRawNote: number;
  transpose: number;
}

function readMIDICalibration(inputId: string): KeyboardHeroMIDICalibrationState {
  if (typeof window === "undefined") return { ...EMPTY_MIDI_CALIBRATION };
  try {
    const entries = JSON.parse(
      window.localStorage.getItem(MIDI_CALIBRATION_KEY) ?? "{}",
    ) as Record<string, Partial<StoredMIDICalibration>>;
    const saved = entries[inputId];
    const rawNote = Number(saved?.rawNote);
    const rightRawNote = Number(saved?.rightRawNote);
    const transpose = Number(saved?.transpose);
    if (
      !Number.isInteger(rawNote) ||
      !Number.isInteger(rightRawNote) ||
      !Number.isInteger(transpose) ||
      rawNote < 0 ||
      rightRawNote > 127 ||
      !isValidMIDICalibrationSpan(rawNote, rightRawNote) ||
      transpose !== MIDI_MIN - rawNote
    ) {
      return { ...EMPTY_MIDI_CALIBRATION };
    }
    return {
      active: false,
      calibrated: false,
      needsVerification: true,
      phase: "idle",
      rawNote,
      rightRawNote,
      transpose,
      error: null,
    };
  } catch {
    return { ...EMPTY_MIDI_CALIBRATION };
  }
}

function persistMIDICalibration(
  inputId: string,
  calibration: KeyboardHeroMIDICalibrationState,
): void {
  if (typeof window === "undefined") return;
  try {
    const entries = JSON.parse(
      window.localStorage.getItem(MIDI_CALIBRATION_KEY) ?? "{}",
    ) as Record<string, StoredMIDICalibration>;
    if (
      calibration.rawNote === null ||
      calibration.rightRawNote === null ||
      !calibration.calibrated
    ) {
      delete entries[inputId];
    } else {
      entries[inputId] = {
        rawNote: calibration.rawNote,
        rightRawNote: calibration.rightRawNote,
        transpose: calibration.transpose,
      };
    }
    window.localStorage.setItem(MIDI_CALIBRATION_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable in private browsing or embedded previews.
  }
}

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
  const [latestFeedback, setLatestFeedback] = useState<NoteFeedback | null>(null);
  const [feedbackEvents, setFeedbackEvents] = useState<NoteFeedback[]>([]);
  const [score, setScore] = useState<KeyboardHeroScore>(EMPTY_SCORE);
  const [power, setPower] = useState<KeyboardHeroPowerState>(() =>
    createPowerModeState(),
  );
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
    lastMappedNote: null,
    lastVelocity: 0,
    lastMessageInRange: null,
    calibration: { ...EMPTY_MIDI_CALIBRATION },
    error: null,
  }));
  const powerChordKeyByNoteId = useMemo(() => {
    const keys = new Map<string, string>();
    for (const note of song.notes) {
      keys.set(note.id, authoredChordGroupId(song.id, note.startBeat));
    }
    return keys;
  }, [song.id, song.notes]);

  const synthRef = useRef<KeyboardSynth | null>(null);
  const midiAccessRef = useRef<MIDIAccessLike | null>(null);
  const midiInputRef = useRef<MIDIInputLike | null>(null);
  const selectedMIDIIdRef = useRef<string | null>(null);
  const midiChannelRef = useRef<number | null>(null);
  const detectedMIDIChannelRef = useRef<number | null>(null);
  const midiCalibrationRef = useRef<KeyboardHeroMIDICalibrationState>({
    ...EMPTY_MIDI_CALIBRATION,
  });
  const midiCalibrationSnapshotRef =
    useRef<KeyboardHeroMIDICalibrationState | null>(null);
  const leftCalibrationCandidateRef = useRef<MIDICalibrationCandidate | null>(
    null,
  );
  const rightCalibrationCandidateRef = useRef<MIDICalibrationCandidate | null>(
    null,
  );
  const midiCalibrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeMIDINotesRef = useRef<Map<string, ActiveMIDINoteMapping>>(
    new Map(),
  );
  const noteOnRef = useRef<(midi: number, velocity?: number, source?: string) => void>(
    () => undefined,
  );
  const noteOffRef = useRef<(midi: number, source?: string) => void>(() => undefined);
  const positionRef = useRef(0);
  const resultsRef = useRef(noteResults);
  const scoreRef = useRef<KeyboardHeroScore>(EMPTY_SCORE);
  const powerRef = useRef<KeyboardHeroPowerState>(power);
  const chordScoreMultipliersRef = useRef<Map<string, number>>(new Map());
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
  const backingBandFailedStepRef = useRef<number | null>(null);

  const synth = useCallback((): KeyboardSynth => {
    if (!synthRef.current) {
      synthRef.current = new KeyboardSynth();
      synthRef.current.setAccompanimentVolume(
        settingsRef.current.backingBandMix,
      );
      synthRef.current.setPowerMode(
        powerRef.current.active,
        powerRef.current.energy,
      );
    }
    return synthRef.current;
  }, []);

  const commitPower = useCallback((next: KeyboardHeroPowerState) => {
    if (next === powerRef.current) return;
    powerRef.current = next;
    setPower(next);
    try {
      synthRef.current?.setPowerMode(next.active, next.energy);
    } catch {
      // POWER presentation must not be able to interrupt transport/scoring.
    }
  }, []);

  const resetPower = useCallback(() => {
    const next = createPowerModeState();
    powerRef.current = next;
    setPower(next);
    try {
      synthRef.current?.setPowerMode(false, 0);
    } catch {
      // Audio teardown is best-effort; gameplay state remains authoritative.
    }
  }, []);

  const advancePowerByBeats = useCallback(
    (beats: number) => {
      commitPower(advancePowerMode(powerRef.current, beats));
    },
    [commitPower],
  );

  const finishPower = useCallback(() => {
    commitPower(completePowerMode(powerRef.current));
  }, [commitPower]);

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
      try {
        instrument?.noteOff(`listen:${noteId}`, undefined, 0.04);
      } catch {
        // A failed voice release must never strand the transport RAF.
      }
    }
    listenVoicesRef.current.clear();
  }, []);

  const syncListenVoices = useCallback(
    (beat: number) => {
      let instrument: KeyboardSynth;
      try {
        instrument = synth();
      } catch {
        return;
      }
      reconcileScheduledVoices(
        song.notes,
        beat,
        listenVoicesRef.current,
        (note) => {
          instrument.noteOn(
            `listen:${note.id}`,
            note.midi,
            (note.velocity ?? 92) / 127,
          );
        },
        (note) => {
          instrument.noteOff(`listen:${note.id}`, undefined, 0.06);
        },
      );
    },
    [song.notes, synth],
  );

  const playMetronomeSafely = useCallback(
    (accent: boolean) => {
      try {
        synth().playMetronome(accent);
      } catch {
        // A metronome source cannot be allowed to terminate transport.
      }
    },
    [synth],
  );

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

  const releaseMIDINotes = useCallback(() => {
    releaseHeldSources("midi:");
    activeMIDINotesRef.current.clear();
  }, [releaseHeldSources]);

  const clearMIDICalibrationTimer = useCallback(() => {
    if (midiCalibrationTimeoutRef.current !== null) {
      clearTimeout(midiCalibrationTimeoutRef.current);
      midiCalibrationTimeoutRef.current = null;
    }
  }, []);

  const setMIDICalibrationState = useCallback(
    (calibration: KeyboardHeroMIDICalibrationState) => {
      midiCalibrationRef.current = calibration;
      setMIDI((current) => ({ ...current, calibration }));
    },
    [],
  );

  const clearMIDICalibrationCapture = useCallback(() => {
    clearMIDICalibrationTimer();
    leftCalibrationCandidateRef.current = null;
    rightCalibrationCandidateRef.current = null;
  }, [clearMIDICalibrationTimer]);

  const finishMIDICalibrationCapture = useCallback(
    (error: string | null = null) => {
      releaseMIDINotes();
      clearMIDICalibrationCapture();
      const baseline =
        midiCalibrationSnapshotRef.current ?? midiCalibrationRef.current;
      midiCalibrationSnapshotRef.current = null;
      setMIDICalibrationState({
        ...baseline,
        active: false,
        phase: "idle",
        error,
      });
    },
    [clearMIDICalibrationCapture, releaseMIDINotes, setMIDICalibrationState],
  );

  const cancelMIDICalibration = useCallback(() => {
    finishMIDICalibrationCapture(null);
    if (midiChannelRef.current === null) {
      detectedMIDIChannelRef.current = null;
      setMIDI((current) => ({
        ...current,
        detectedChannel: null,
        lastNote: null,
        lastMappedNote: null,
        lastVelocity: 0,
        lastMessageInRange: null,
      }));
    }
  }, [finishMIDICalibrationCapture]);

  const armMIDICalibrationTimer = useCallback(() => {
    clearMIDICalibrationTimer();
    midiCalibrationTimeoutRef.current = setTimeout(() => {
      releaseMIDINotes();
      leftCalibrationCandidateRef.current = null;
      rightCalibrationCandidateRef.current = null;
      const next: KeyboardHeroMIDICalibrationState = {
        ...EMPTY_MIDI_CALIBRATION,
        active: true,
        phase: "left",
        error:
          "Alignment timed out. Turn off ARP, Latch, Chord and Scale, then retry.",
      };
      setMIDICalibrationState(next);
      if (midiChannelRef.current === null) {
        detectedMIDIChannelRef.current = null;
        setMIDI((current) => ({ ...current, detectedChannel: null }));
      }
    }, MIDI_CALIBRATION_TIMEOUT_MS);
  }, [clearMIDICalibrationTimer, releaseMIDINotes, setMIDICalibrationState]);

  const resetMIDICalibration = useCallback(() => {
    releaseMIDINotes();
    clearMIDICalibrationCapture();
    midiCalibrationSnapshotRef.current = null;
    const inputId = selectedMIDIIdRef.current;
    const next = { ...EMPTY_MIDI_CALIBRATION };
    setMIDICalibrationState(next);
    detectedMIDIChannelRef.current = null;
    if (inputId) persistMIDICalibration(inputId, next);
    setMIDI((current) => ({
      ...current,
      detectedChannel: null,
      lastNote: null,
      lastMappedNote: null,
      lastVelocity: 0,
      lastMessageInRange: null,
      calibration: next,
    }));
  }, [clearMIDICalibrationCapture, releaseMIDINotes, setMIDICalibrationState]);

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
      backingBandFailedStepRef.current = null;
      try {
        synthRef.current?.stopAccompaniment(immediate);
      } catch {
        // Audio teardown is best-effort; transport state remains authoritative.
      }
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
      const stepIndex = transportSubdivisionAtBeat(normalizedBeat);
      if (backingBandFailedStepRef.current === stepIndex) return;
      try {
        if (
          !currentSettings.backingBandEnabled ||
          currentSettings.backingBandMix <= 0
        ) {
          backingBandFailedStepRef.current = null;
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
          backingBandFailedStepRef.current = stepIndex;
          setBackingBandFrame(false);
          return;
        }

        backingBandFailedStepRef.current = null;
        const beatFloor = Math.floor(normalizedBeat);
        const subdivisionPhase = normalizedBeat * 2 - stepIndex;
        const pulse = (1 - subdivisionPhase) ** 3;
        const downbeat = beatFloor % song.timeSignature[0] === 0;
        const energy = Math.sqrt(currentSettings.backingBandMix) *
          (0.28 + currentSettings.backingBandIntensity * 0.62) *
          (0.55 + pulse * 0.45) *
          (downbeat ? 1.08 : 1);
        setBackingBandFrame(true, clamp(energy, 0, 1));
      } catch {
        backingBandFailedStepRef.current = stepIndex;
        try {
          synthRef.current?.stopAccompaniment(true);
        } catch {
          // The failed Web Audio graph may already be detached.
        }
        setBackingBandFrame(false);
      }
    },
    [setBackingBandFrame, song, synth],
  );

  const clearAttempt = useCallback(
    (preservePower: boolean) => {
      resultsRef.current = new Map();
      setNoteResults(new Map());
      setLatestFeedback(null);
      setFeedbackEvents([]);
      chordScoreMultipliersRef.current.clear();
      scoreRef.current = EMPTY_SCORE;
      setScore(EMPTY_SCORE);
      if (!preservePower) resetPower();
    },
    [resetPower],
  );

  const resetScore = useCallback(() => clearAttempt(false), [clearAttempt]);
  const resetAttemptForLoop = useCallback(
    () => clearAttempt(true),
    [clearAttempt],
  );

  const pause = useCallback(() => {
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
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
    if (wasFinishing) {
      finishPower();
      setSongComplete(true);
    }
    lastMetronomeBeatRef.current = null;
    stopListenVoices();
    stopBackingBand(true);
  }, [
    cancelMIDICalibration,
    finishPower,
    stopBackingBand,
    stopListenVoices,
  ]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
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
  }, [
    cancelMIDICalibration,
    commitPosition,
    resetScore,
    song.bpm,
    song.durationBeats,
    stopBackingBand,
    synth,
  ]);

  const seekBeat = useCallback(
    (beat: number) => {
      if (midiCalibrationRef.current.active) cancelMIDICalibration();
      const destination = clamp(beat, 0, song.durationBeats);
      const movedToNewBeat =
        Math.abs(destination - positionRef.current) > 0.000_001;
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
      if (movedToNewBeat) resetScore();
      commitPosition(destination);
    },
    [
      commitPosition,
      cancelMIDICalibration,
      resetScore,
      song.durationBeats,
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

  const registerResult = useCallback(
    (result: NoteResult) => {
      if (settingsRef.current.practiceMode === "listen") return;
      // Song-note ids are stable across the result map. This guard also makes
      // RAF misses racing a physical chord incapable of awarding twice.
      if (resultsRef.current.has(result.id)) return;

      const chordKey = powerChordKeyByNoteId.get(result.id);
      const multiplier = chordKey
        ? latchChordScoreMultiplier(
            chordScoreMultipliersRef.current,
            chordKey,
            powerRef.current.multiplier,
          )
        : 1;
      const powerOutcome = applyPowerJudgement(
        powerRef.current,
        result.grade,
      );
      commitPower(powerOutcome.state);

      const currentScore = scoreRef.current;
      let nextScore: KeyboardHeroScore;
      let pointsAwarded = 0;
      if (result.grade === "miss") {
        const misses = currentScore.misses + 1;
        nextScore = {
          ...currentScore,
          combo: 0,
          misses,
          accuracy: scoreAccuracy(currentScore.hits, misses),
        };
      } else {
        const combo = currentScore.combo + 1;
        const hits = currentScore.hits + 1;
        pointsAwarded = pointsForJudgement(result.grade, combo, multiplier);
        nextScore = {
          points: currentScore.points + pointsAwarded,
          combo,
          bestCombo: Math.max(currentScore.bestCombo, combo),
          hits,
          misses: currentScore.misses,
          accuracy: scoreAccuracy(hits, currentScore.misses),
        };
      }
      scoreRef.current = nextScore;
      setScore(nextScore);

      resultsRef.current = new Map(resultsRef.current).set(result.id, result);
      setNoteResults(resultsRef.current);
      feedbackSequenceRef.current += 1;
      const feedbackEvent: NoteFeedback = {
        ...result,
        id: `${result.id}:feedback-${feedbackSequenceRef.current}`,
        groupId: chordKey ?? result.id,
        pointsAwarded,
        multiplier,
        powerActivation: powerOutcome.activated,
      };
      setLatestFeedback(feedbackEvent);
      setFeedbackEvents((current) =>
        [...current, feedbackEvent].slice(-FEEDBACK_HISTORY_LIMIT),
      );
    },
    [commitPower, powerChordKeyByNoteId],
  );

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

  noteOnRef.current = noteOn;
  noteOffRef.current = noteOff;

  const setTempoScale = useCallback((scale: number) => {
    if (countInSecondsRef.current > 0) return;
    backingBandFailedStepRef.current = null;
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
      if (
        settingsRef.current.practiceMode !== "listen" &&
        practiceMode === "listen"
      ) {
        resetPower();
      }
      settingsRef.current = { ...settingsRef.current, practiceMode };
      setSettings((current) => {
        const next = { ...current, practiceMode };
        settingsRef.current = next;
        return next;
      });
      if (practiceMode === "listen" && !isPlayingRef.current) play();
    },
    [play, resetPower, stopListenVoices],
  );

  const setMetronomeEnabled = useCallback((metronomeEnabled: boolean) => {
    setSettings((current) => ({ ...current, metronomeEnabled }));
  }, []);

  const setSynthEnabled = useCallback((synthEnabled: boolean) => {
    setSettings((current) => {
      const next = { ...current, synthEnabled };
      settingsRef.current = next;
      return next;
    });
    if (!synthEnabled) synthRef.current?.allNotesOff(true);
  }, []);

  const setBackingBandEnabled = useCallback(
    (backingBandEnabled: boolean) => {
      backingBandFailedStepRef.current = null;
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
    backingBandFailedStepRef.current = null;
    const backingBandMix = clamp(mix, 0, 1);
    setSettings((current) => {
      const next = { ...current, backingBandMix };
      settingsRef.current = next;
      return next;
    });
    synthRef.current?.setAccompanimentVolume(backingBandMix);
  }, []);

  const setBackingBandIntensity = useCallback((intensity: number) => {
    backingBandFailedStepRef.current = null;
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
      if (midiCalibrationRef.current.active) cancelMIDICalibration();
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
    [cancelMIDICalibration, seekBeat, song.durationBeats, stopBackingBand],
  );

  const toggleLoop = useCallback(() => {
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
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
  }, [cancelMIDICalibration, seekBeat, stopBackingBand]);

  const startMIDICalibration = useCallback(() => {
    if (!midiInputRef.current) {
      setMIDI((current) => ({
        ...current,
        error: "Connect a MIDI input before aligning the keyboard.",
      }));
      return;
    }

    if (isPlayingRef.current) pause();
    releaseMIDINotes();
    clearMIDICalibrationCapture();
    const previous = midiCalibrationRef.current;
    if (!previous.active) {
      midiCalibrationSnapshotRef.current = {
        ...previous,
        active: false,
        phase: "idle",
        error: null,
      };
    }
    const next: KeyboardHeroMIDICalibrationState = {
      ...EMPTY_MIDI_CALIBRATION,
      active: true,
      phase: "left",
    };
    setMIDICalibrationState(next);
    if (midiChannelRef.current === null) {
      detectedMIDIChannelRef.current = null;
    }
    setMIDI((current) => ({
      ...current,
      detectedChannel:
        midiChannelRef.current === null ? null : current.detectedChannel,
      lastNote: null,
      lastMappedNote: null,
      lastVelocity: 0,
      lastMessageInRange: null,
      calibration: next,
      error: null,
    }));
    armMIDICalibrationTimer();
  }, [
    armMIDICalibrationTimer,
    clearMIDICalibrationCapture,
    pause,
    releaseMIDINotes,
    setMIDICalibrationState,
  ]);

  const resetMIDIActivity = useCallback(
    (inputId: string | null = null) => {
      releaseMIDINotes();
      clearMIDICalibrationCapture();
      midiChannelRef.current = null;
      detectedMIDIChannelRef.current = null;
      midiCalibrationSnapshotRef.current = null;
      const calibration = inputId
        ? readMIDICalibration(inputId)
        : { ...EMPTY_MIDI_CALIBRATION };
      midiCalibrationRef.current = calibration;
      setMIDI((current) => ({
        ...current,
        channel: null,
        detectedChannel: null,
        lastNote: null,
        lastMappedNote: null,
        lastVelocity: 0,
        lastMessageInRange: null,
        calibration,
      }));
    },
    [clearMIDICalibrationCapture, releaseMIDINotes],
  );

  const setMIDIChannel = useCallback(
    (channel: number | null) => {
      if (
        channel !== null &&
        (!Number.isInteger(channel) || channel < 0 || channel > 15)
      ) {
        return;
      }
      if (midiCalibrationRef.current.active) cancelMIDICalibration();
      releaseMIDINotes();
      midiChannelRef.current = channel;
      detectedMIDIChannelRef.current = null;
      const calibration = midiCalibrationRef.current;
      setMIDI((current) => ({
        ...current,
        channel,
        detectedChannel: null,
        lastNote: null,
        lastMappedNote: null,
        lastVelocity: 0,
        lastMessageInRange: null,
        calibration,
      }));
    },
    [cancelMIDICalibration, releaseMIDINotes],
  );

  const bindMIDIInput = useCallback((input: MIDIInputLike) => {
    input.onmidimessage = (event) => {
      if (
        midiInputRef.current !== input ||
        selectedMIDIIdRef.current !== input.id
      ) {
        return;
      }
      const [status = 0, note = 0, velocity = 0] = event.data;
      const command = status & 0xf0;
      const isNoteOn = command === 0x90 && velocity > 0;
      const isNoteOff = command === 0x80 || (command === 0x90 && velocity === 0);
      if (!isNoteOn && !isNoteOff) return;

      const channel = status & 0x0f;
      const calibration = midiCalibrationRef.current;
      const transpose = calibration.calibrated ? calibration.transpose : 0;
      const displayMappedNote = note + transpose;
      const lastMappedNote =
        !calibration.needsVerification &&
        displayMappedNote >= 0 &&
        displayMappedNote <= 127
          ? displayMappedNote
          : null;
      const mappedNote = calibration.needsVerification
        ? null
        : mapMIDINoteToKeyboardRange(note, transpose);
      const messageKey = `${input.id}:ch${channel}:raw${note}`;
      setMIDI((current) => ({
        ...current,
        lastNote: note,
        lastMappedNote,
        lastVelocity: velocity,
        lastMessageInRange: mappedNote !== null,
      }));

      // Release the exact mapping captured by Note On before applying current
      // channel or transpose gates; those settings may have changed meanwhile.
      if (isNoteOff) {
        const active = activeMIDINotesRef.current.get(messageKey);
        if (active) {
          activeMIDINotesRef.current.delete(messageKey);
          noteOffRef.current(active.mappedNote, active.source);
          return;
        }
      }

      const manualChannel = midiChannelRef.current;
      if (manualChannel !== null && channel !== manualChannel) return;
      if (
        manualChannel === null &&
        detectedMIDIChannelRef.current !== null &&
        channel !== detectedMIDIChannelRef.current
      ) {
        if (calibration.active && isNoteOn) {
          clearMIDICalibrationCapture();
          detectedMIDIChannelRef.current = null;
          const next: KeyboardHeroMIDICalibrationState = {
            ...EMPTY_MIDI_CALIBRATION,
            active: true,
            phase: "left",
            error:
              "The end keys arrived on different MIDI channels. Retry the leftmost key; avoid the drum pads.",
          };
          setMIDICalibrationState(next);
          setMIDI((current) => ({
            ...current,
            detectedChannel: null,
            calibration: next,
          }));
          armMIDICalibrationTimer();
        }
        return;
      }

      if (calibration.active) {
        if (calibration.phase === "left" && isNoteOn) {
          if (manualChannel === null) {
            detectedMIDIChannelRef.current = channel;
            setMIDI((current) => ({ ...current, detectedChannel: channel }));
          }
          const candidate: MIDICalibrationCandidate = {
            key: messageKey,
            rawNote: note,
            channel,
            invalid: false,
          };
          leftCalibrationCandidateRef.current = candidate;
          const next: KeyboardHeroMIDICalibrationState = {
            ...calibration,
            phase: "release-left",
            rawNote: note,
            rightRawNote: null,
            transpose: MIDI_MIN - note,
            error: null,
          };
          midiCalibrationRef.current = next;
          setMIDI((current) => ({
            ...current,
            calibration: next,
            lastMappedNote: MIDI_MIN,
            lastMessageInRange: true,
          }));
          armMIDICalibrationTimer();
          return;
        }

        if (calibration.phase === "release-left") {
          const candidate = leftCalibrationCandidateRef.current;
          if (isNoteOn) {
            if (candidate) candidate.invalid = true;
            const next: KeyboardHeroMIDICalibrationState = {
              ...calibration,
              error:
                "Multiple or repeated notes detected. Release all keys and retry the leftmost key.",
            };
            midiCalibrationRef.current = next;
            setMIDI((current) => ({ ...current, calibration: next }));
            return;
          }
          if (isNoteOff && candidate?.key === messageKey) {
            leftCalibrationCandidateRef.current = null;
            const next: KeyboardHeroMIDICalibrationState = candidate.invalid
              ? {
                  ...calibration,
                  phase: "left",
                  rawNote: null,
                  rightRawNote: null,
                  transpose: 0,
                  error:
                    "Extra notes were detected. Retry with only the physical leftmost key.",
                }
              : { ...calibration, phase: "right", error: null };
            if (candidate.invalid && manualChannel === null) {
              detectedMIDIChannelRef.current = null;
            }
            midiCalibrationRef.current = next;
            setMIDI((current) => ({
              ...current,
              detectedChannel:
                candidate.invalid && manualChannel === null
                  ? null
                  : current.detectedChannel,
              calibration: next,
            }));
            armMIDICalibrationTimer();
          }
          return;
        }

        if (calibration.phase === "right" && isNoteOn) {
          const leftRawNote = calibration.rawNote;
          const candidate: MIDICalibrationCandidate = {
            key: messageKey,
            rawNote: note,
            channel,
            invalid:
              leftRawNote === null ||
              !isValidMIDICalibrationSpan(leftRawNote, note),
          };
          rightCalibrationCandidateRef.current = candidate;
          const next: KeyboardHeroMIDICalibrationState = {
            ...calibration,
            phase: "release-right",
            rightRawNote: note,
            error: null,
          };
          midiCalibrationRef.current = next;
          setMIDI((current) => ({ ...current, calibration: next }));
          armMIDICalibrationTimer();
          return;
        }

        if (calibration.phase === "release-right") {
          const candidate = rightCalibrationCandidateRef.current;
          if (isNoteOn) {
            if (candidate) candidate.invalid = true;
            const next: KeyboardHeroMIDICalibrationState = {
              ...calibration,
              error:
                "Multiple or repeated notes detected. Release all keys and retry the rightmost key.",
            };
            midiCalibrationRef.current = next;
            setMIDI((current) => ({ ...current, calibration: next }));
            return;
          }
          if (!isNoteOff || candidate?.key !== messageKey) return;
          rightCalibrationCandidateRef.current = null;
          if (candidate.invalid || calibration.rawNote === null) {
            const next: KeyboardHeroMIDICalibrationState = {
              ...calibration,
              active: true,
              phase: "right",
              rightRawNote: null,
              error:
                "The end keys must be exactly 24 semitones apart. Retry the physical rightmost key.",
            };
            midiCalibrationRef.current = next;
            setMIDI((current) => ({
              ...current,
              calibration: next,
              lastMappedNote: null,
              lastMessageInRange: null,
            }));
            armMIDICalibrationTimer();
            return;
          }

          const next: KeyboardHeroMIDICalibrationState = {
            active: false,
            calibrated: true,
            needsVerification: false,
            phase: "idle",
            rawNote: calibration.rawNote,
            rightRawNote: candidate.rawNote,
            transpose: MIDI_MIN - calibration.rawNote,
            error: null,
          };
          clearMIDICalibrationCapture();
          midiCalibrationRef.current = next;
          midiCalibrationSnapshotRef.current = null;
          persistMIDICalibration(input.id, next);
          setMIDI((current) => ({
            ...current,
            calibration: next,
            lastMappedNote: MIDI_MAX,
            lastMessageInRange: true,
          }));
          return;
        }
        return;
      }

      if (isNoteOff || mappedNote === null) return;
      if (manualChannel === null) {
        const detectedChannel = detectedMIDIChannelRef.current;
        if (detectedChannel === null) {
          detectedMIDIChannelRef.current = channel;
          setMIDI((current) => ({ ...current, detectedChannel: channel }));
        } else if (channel !== detectedChannel) {
          return;
        }
      }

      if (activeMIDINotesRef.current.has(messageKey)) return;
      const source = `midi:${input.id}:ch${channel}:raw${note}`;
      activeMIDINotesRef.current.set(messageKey, {
        mappedNote,
        source,
      });
      noteOnRef.current(mappedNote, velocity, source);
    };
  }, [
    armMIDICalibrationTimer,
    clearMIDICalibrationCapture,
    setMIDICalibrationState,
  ]);

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
      resetMIDIActivity(selected?.id ?? null);
    }
    midiInputRef.current = selected ?? null;
    if (selected) bindMIDIInput(selected);
    setMIDI((current) => ({
      ...current,
      inputs: infos,
      selectedInputId: selected?.id ?? null,
      connectedName: selected?.name || null,
    }));
  }, [bindMIDIInput, resetMIDIActivity]);

  const selectMIDIInput = useCallback(
    (inputId: string | null) => {
      const inputChanged = selectedMIDIIdRef.current !== inputId;
      const previous = midiInputRef.current;
      if (previous) {
        previous.onmidimessage = null;
      }
      const input = Array.from(midiAccessRef.current?.inputs.values() ?? []).find(
        (candidate) => candidate.id === inputId && candidate.state === "connected",
      );
      if (inputChanged) {
        resetMIDIActivity(input?.id ?? null);
      }
      selectedMIDIIdRef.current = inputId;
      midiInputRef.current = input ?? null;
      if (input) bindMIDIInput(input);
      setMIDI((current) => ({
        ...current,
        selectedInputId: input?.id ?? null,
        connectedName: input?.name || null,
        error: inputId && !input ? "That MIDI input is no longer connected." : null,
      }));
    },
    [bindMIDIInput, resetMIDIActivity],
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
      const inputName = (input: MIDIInputLike) =>
        input.name?.trim().toLowerCase() ?? "";
      const isControlPort = (input: MIDIInputLike) =>
        /\b(daw|plugin|software control|control|din)\b/i.test(inputName(input));
      const officialMPKInput = connectedInputs.find(
        (input) =>
          !isControlPort(input) &&
          inputName(input).endsWith("mpk mini iv midi port"),
      );
      const exactMPKInput = connectedInputs.find(
        (input) => inputName(input) === "mpk mini iv",
      );
      const performanceMPKInput = connectedInputs.find((input) => {
        const name = inputName(input);
        return (
          !isControlPort(input) &&
          (name.includes("mpk mini iv") || name.includes("mpk mini 4"))
        );
      });
      const nonControlInput = connectedInputs.find(
        (input) => !isControlPort(input),
      );
      const preferredInput =
        retainedInput ??
        officialMPKInput ??
        exactMPKInput ??
        performanceMPKInput ??
        nonControlInput;
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
          finishPower();
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
          playMetronomeSafely(crossedBeat % song.timeSignature[0] === 0);
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
      let loopWrapped = false;

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
        syncListenVoices(nextBeat);
      } else if (listenVoicesRef.current.size > 0) {
        stopListenVoices();
      }

      const beatNumber = Math.floor(nextBeat + 0.0001);
      if (
        currentSettings.metronomeEnabled &&
        beatNumber !== lastMetronomeBeatRef.current
      ) {
        lastMetronomeBeatRef.current = beatNumber;
        playMetronomeSafely(beatNumber % song.timeSignature[0] === 0);
      }

      const powerBeatsThisFrame = Math.max(
        0,
        Math.min(nextBeat, loopEnd) - oldBeat,
      );
      const loopPowerBeatsThisFrame = Math.max(0, nextBeat - oldBeat);

      if (nextBeat >= loopEnd) {
        if (activeLoop.enabled) {
          loopWrapped = true;
          nextBeat = activeLoop.startBeat + (nextBeat - loopEnd);
          stopListenVoices();
          stopBackingBand(true);
          if (currentSettings.practiceMode !== "listen") {
            resetAttemptForLoop();
            advancePowerByBeats(loopPowerBeatsThisFrame);
          }
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
          if (currentSettings.practiceMode !== "listen") {
            advancePowerByBeats(powerBeatsThisFrame);
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

      if (!loopWrapped && currentSettings.practiceMode !== "listen") {
        advancePowerByBeats(powerBeatsThisFrame);
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
    advancePowerByBeats,
    commitPosition,
    finishPower,
    isPlaying,
    pause,
    playMetronomeSafely,
    registerResult,
    resetAttemptForLoop,
    resetScore,
    song,
    stopBackingBand,
    stopListenVoices,
    syncBackingBand,
    syncListenVoices,
  ]);

  useEffect(
    () => () => {
      if (midiInputRef.current) midiInputRef.current.onmidimessage = null;
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
      if (midiCalibrationTimeoutRef.current !== null) {
        clearTimeout(midiCalibrationTimeoutRef.current);
      }
      try {
        synthRef.current?.setPowerMode(false, 0);
      } catch {
        // Disposal below remains authoritative if the effects graph is broken.
      }
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
    power,
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
    startMIDICalibration,
    cancelMIDICalibration,
    resetMIDICalibration,
    noteOn,
    noteOff,
    resetScore,
  };
}
