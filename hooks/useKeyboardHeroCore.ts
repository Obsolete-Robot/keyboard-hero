"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KeyboardSynth, type PerformanceCue } from "@/lib/audio";
import {
  reconcileScheduledVoices,
  transportSubdivisionAtBeat,
} from "@/lib/audioScheduling";
import {
  buildComboOrchestrationLayers,
  comboOrchestrationMix,
  type ComboOrchestrationChallenge,
  type ComboOrchestrationLayers,
} from "@/lib/comboOrchestration";
import {
  isValidMIDICalibrationSpan,
  mapMIDINoteToKeyboardRange,
  normalizeMIDICalibrationEntries,
  parseMIDICalibrationMapping,
} from "@/lib/midiCalibration";
import { chooseAutomaticMIDIInput } from "@/lib/midiInputs";
import {
  decodeMIDITransportPress,
  isMIDITransportControlPortName,
  type MIDITransportAction,
} from "@/lib/midiTransport";
import { isDownbeatPulse, pulseIndexAtBeat } from "@/lib/meter";
import {
  normalizeMotionPreference,
  type MotionPreference,
} from "@/lib/motionPreference";
import {
  applyPowerJudgement,
  authoredChordGroupId,
  completePowerMode,
  createPowerModeState,
  latchChordScoreMultiplier,
  pointsForJudgement,
  type KeyboardHeroPowerState,
} from "@/lib/powerMode";
import { scoreRateForSettings } from "@/lib/scoreDifficulty";
import { MIDI_MAX, MIDI_MIN, type Song, type SongNote } from "@/lib/songs";
import {
  clearNoteClaims,
  findPressCandidate,
  judgeSustain,
  noteWithinPlaybackRange,
  sustainRequirement,
  timingGradeForOffset,
  type SustainJudgement,
} from "@/lib/sustainScoring";

export type { KeyboardHeroPowerState } from "@/lib/powerMode";
export type { SustainGrade } from "@/lib/sustainScoring";

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
  /** True when an early press was held through the authored strike time. */
  earlyCaptured?: boolean;
  /** Final authored-duration judgement. Tap notes and unresolved holds omit it. */
  sustain?: NoteSustainResult;
  /** Difficulty-adjusted timing value before combo and POWER bonuses. */
  basePointsAwarded?: number;
}

export type NoteSustainResult = SustainJudgement;

export interface NoteFeedback extends NoteResult {
  /** Shared monotonic ordering across onset and sustain feedback streams. */
  sequence: number;
  /** Shared by all resolved tones in one authored chord; extras fall back to their unique id. */
  groupId: string;
  /** Exact score delta including difficulty rate, combo bonus, and POWER. */
  pointsAwarded: number;
  multiplier: number;
  /** Mode-and-tempo scoring rate used for this judgement. */
  scoreRate: number;
  /** True only for the successful judgement that filled the power meter. */
  powerActivation: boolean;
}

export interface KeyboardHeroScore {
  points: number;
  /** Portion of points earned from authored note duration rather than onset. */
  sustainPoints: number;
  combo: number;
  bestCombo: number;
  hits: number;
  misses: number;
  accuracy: number;
}

export interface HeldNoteState {
  noteId: string;
  midi: number;
  phase: "armed" | "holding";
  /** Original physical press timing; negative values are early. */
  pressOffsetMs: number;
  heldBeats: number;
  requiredBeats: number;
  progress: number;
}

export interface SustainFeedback extends NoteSustainResult {
  /** Unique event identity; noteId remains the stable authored result identity. */
  id: string;
  noteId: string;
  groupId: string;
  midi: number;
  /** Shared monotonic ordering across onset and sustain feedback streams. */
  sequence: number;
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
  /** Latest hardware transport press. Sequence makes repeated presses observable. */
  lastTransportEvent: {
    action: MIDITransportAction;
    sequence: number;
  } | null;
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
  motionPreference: MotionPreference;
  latencyMs: number;
}

export interface KeyboardHeroComboOrchestration {
  challengeLevel: ComboOrchestrationChallenge;
  mediumChart?: Song;
  hardChart?: Song;
}

export interface KeyboardHeroBackingBandState {
  active: boolean;
  /** True while the independent free-play groove is running. */
  isJamming: boolean;
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
  /** Active authored-note claims, keyed by the song's stable note id. */
  heldNotes: Map<string, HeldNoteState>;
  latestSustainFeedback: SustainFeedback | null;
  sustainFeedbackEvents: SustainFeedback[];
  score: KeyboardHeroScore;
  power: KeyboardHeroPowerState;
  midi: KeyboardHeroMIDIState;
  backingBand: KeyboardHeroBackingBandState;
  settings: KeyboardHeroSettings;
  loop: KeyboardHeroLoop;
  /** Full-song, unscored practice that restarts immediately at the end. */
  quickLoopEnabled: boolean;
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
  setMotionPreference: (preference: MotionPreference) => void;
  playBackingBand: () => void;
  pauseBackingBand: () => void;
  toggleBackingBandPlayback: () => void;
  setLatencyMs: (latencyMs: number) => void;
  setLoop: (startBeat: number, endBeat: number, enabled?: boolean) => void;
  toggleLoop: () => void;
  setQuickLoopEnabled: (enabled: boolean) => void;
  toggleQuickLoop: () => void;
  connectMIDI: () => Promise<void>;
  selectMIDIInput: (inputId: string | null) => void;
  setMIDIChannel: (channel: number | null) => void;
  startMIDICalibration: () => void;
  cancelMIDICalibration: () => void;
  resetMIDICalibration: () => void;
  noteOn: (midi: number, velocity?: number, source?: string) => void;
  noteOff: (midi: number, source?: string) => void;
  playPerformanceCue: (cue: PerformanceCue, variant?: number) => void;
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

type PlayerNoteAttemptPhase = "armed" | "holding" | "released-before-start";

interface ActivePlayerNoteAttempt {
  note: SongNote;
  sourceId: string;
  pressBeat: number;
  pressOffsetMs: number;
  earlyCaptured: boolean;
  phase: PlayerNoteAttemptPhase;
  holdStartBeat: number;
  requiredBeats: number;
  multiplier: number;
  scoreRate: number;
  sustainScored: boolean;
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

function isMIDITransportInput(input: MIDIInputLike): boolean {
  const name = input.name ?? "";
  if (isMIDITransportControlPortName(name)) return true;

  // Without Akai's Windows driver, companion ports can be exposed as numbered
  // MPK aliases instead of retaining their DAW/Plugin/Control labels.
  return (
    /\bmpk\s+mini\s+(?:iv|4)\b/i.test(name) &&
    !/\b(?:midi|din)\s+port\b/i.test(name)
  );
}

const SETTINGS_KEY = "keyboard-hero.settings.v1";
const MIDI_CALIBRATION_KEY = "keyboard-hero.midi-calibration.v1";
const MIDI_PREFERENCES_KEY = "keyboard-hero.midi-preferences.v1";
const MIDI_CALIBRATION_TIMEOUT_MS = 25_000;
const MIDI_TRANSPORT_DEDUP_MS = 160;
const PRE_ROLL_SECONDS = 5;
const POST_ROLL_MIN_SECONDS = 2.5;
const POST_ROLL_CLEARANCE_BEATS = 1.75;
const FEEDBACK_HISTORY_LIMIT = 16;
const COMBO_ORCHESTRATION_VELOCITY_SCALE = 0.7;
const COMBO_ORCHESTRATION_LAYER_NAMES = [
  "shared",
  "mediumOnly",
  "hardOnly",
] as const satisfies readonly (keyof ComboOrchestrationLayers)[];
const DEFAULT_SETTINGS: KeyboardHeroSettings = {
  tempoScale: 1,
  practiceMode: "flow",
  metronomeEnabled: true,
  synthEnabled: true,
  backingBandEnabled: true,
  backingBandMix: 0.58,
  backingBandIntensity: 0.65,
  motionPreference: "system",
  latencyMs: 0,
};
const EMPTY_SCORE: KeyboardHeroScore = {
  points: 0,
  sustainPoints: 0,
  combo: 0,
  bestCombo: 0,
  hits: 0,
  misses: 0,
  accuracy: 100,
};
const EMPTY_MIDI_CALIBRATION: KeyboardHeroMIDICalibrationState = {
  active: false,
  calibrated: false,
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

interface StoredMIDIPreferences {
  preferredInputId: string | null;
  channel: number | null;
}

const EMPTY_MIDI_PREFERENCES: StoredMIDIPreferences = {
  preferredInputId: null,
  channel: null,
};

function readMIDICalibration(inputId: string): KeyboardHeroMIDICalibrationState {
  if (typeof window === "undefined") return { ...EMPTY_MIDI_CALIBRATION };
  try {
    const entries = normalizeMIDICalibrationEntries(
      JSON.parse(window.localStorage.getItem(MIDI_CALIBRATION_KEY) ?? "{}"),
    );
    const saved = parseMIDICalibrationMapping(entries[inputId]);
    if (!saved) return { ...EMPTY_MIDI_CALIBRATION };
    return {
      active: false,
      calibrated: true,
      phase: "idle",
      rawNote: saved.rawNote,
      rightRawNote: saved.rightRawNote,
      transpose: saved.transpose,
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
    const entries = normalizeMIDICalibrationEntries(
      JSON.parse(window.localStorage.getItem(MIDI_CALIBRATION_KEY) ?? "{}"),
    );
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

function readMIDIPreferences(): StoredMIDIPreferences {
  if (typeof window === "undefined") return { ...EMPTY_MIDI_PREFERENCES };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(MIDI_PREFERENCES_KEY) ?? "{}",
    ) as Partial<StoredMIDIPreferences>;
    const preferredInputId =
      typeof parsed.preferredInputId === "string" && parsed.preferredInputId
        ? parsed.preferredInputId
        : null;
    const channel =
      parsed.channel === null || parsed.channel === undefined
        ? null
        : Number.isInteger(parsed.channel) && parsed.channel >= 0 && parsed.channel <= 15
          ? parsed.channel
          : null;
    return { preferredInputId, channel };
  } catch {
    return { ...EMPTY_MIDI_PREFERENCES };
  }
}

function persistMIDIPreferences(preferences: StoredMIDIPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MIDI_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
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
      motionPreference: normalizeMotionPreference(parsed.motionPreference),
      latencyMs: clamp(Number(parsed.latencyMs) || 0, -250, 250),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function resultFor(
  note: SongNote,
  offsetMs: number,
  earlyCaptured = false,
): NoteResult {
  return {
    id: note.id,
    midi: note.midi,
    grade: timingGradeForOffset(offsetMs, earlyCaptured),
    offsetMs,
    earlyCaptured: earlyCaptured || undefined,
  };
}

export function useKeyboardHeroCore(
  song: Song,
  comboOrchestration?: KeyboardHeroComboOrchestration,
): KeyboardHeroCore {
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
  const [heldNotes, setHeldNotes] = useState<Map<string, HeldNoteState>>(
    () => new Map(),
  );
  const [latestSustainFeedback, setLatestSustainFeedback] =
    useState<SustainFeedback | null>(null);
  const [sustainFeedbackEvents, setSustainFeedbackEvents] = useState<
    SustainFeedback[]
  >([]);
  const [score, setScore] = useState<KeyboardHeroScore>(EMPTY_SCORE);
  const [power, setPower] = useState<KeyboardHeroPowerState>(() =>
    createPowerModeState(),
  );
  const [backingBand, setBackingBand] = useState<KeyboardHeroBackingBandState>({
    active: false,
    isJamming: false,
    energy: 0,
  });
  const [loop, setLoopState] = useState<KeyboardHeroLoop>({
    enabled: false,
    startBeat: 0,
    endBeat: song.durationBeats,
  });
  const [quickLoopEnabled, setQuickLoopEnabledState] = useState(false);
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
    lastTransportEvent: null,
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
  const comboOrchestrationChallenge =
    comboOrchestration?.challengeLevel ?? "hard";
  const comboOrchestrationLayers = useMemo(
    () =>
      buildComboOrchestrationLayers(
        song.notes,
        comboOrchestrationChallenge,
        comboOrchestration?.mediumChart?.notes,
        comboOrchestration?.hardChart?.notes,
      ),
    [
      comboOrchestration?.hardChart?.notes,
      comboOrchestration?.mediumChart?.notes,
      comboOrchestrationChallenge,
      song.notes,
    ],
  );

  const synthRef = useRef<KeyboardSynth | null>(null);
  const midiAccessRef = useRef<MIDIAccessLike | null>(null);
  const midiInputRef = useRef<MIDIInputLike | null>(null);
  const midiTransportInputsRef = useRef<Map<string, MIDIInputLike>>(new Map());
  const selectedMIDIIdRef = useRef<string | null>(null);
  const midiChannelRef = useRef<number | null>(null);
  const midiPreferencesRef = useRef<StoredMIDIPreferences>({
    ...EMPTY_MIDI_PREFERENCES,
  });
  const midiConnectionPromiseRef = useRef<Promise<void> | null>(null);
  const midiHookActiveRef = useRef(true);
  const autoMIDIConnectAttemptedRef = useRef(false);
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
  const quickLoopEnabledRef = useRef(false);
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
  const playerNoteAttemptsRef = useRef<Map<string, ActivePlayerNoteAttempt>>(
    new Map(),
  );
  const playerNoteIdBySourceRef = useRef<Map<string, string>>(new Map());
  const listenVoicesRef = useRef<Set<string>>(new Set());
  const comboOrchestrationVoicesRef = useRef<
    Record<keyof ComboOrchestrationLayers, Set<string>>
  >({
    shared: new Set(),
    mediumOnly: new Set(),
    hardOnly: new Set(),
  });
  const lastMetronomePulseRef = useRef<number | null>(null);
  const feedbackSequenceRef = useRef(0);
  const midiTransportSequenceRef = useRef(0);
  const lastMIDITransportPressRef = useRef<{
    action: MIDITransportAction;
    time: number;
  } | null>(null);
  const backingBandActiveRef = useRef(false);
  const backingBandFailedStepRef = useRef<number | null>(null);
  const backingBandJamBeatRef = useRef(0);
  const backingBandJammingRef = useRef(false);

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

  const playPerformanceCue = useCallback(
    (cue: PerformanceCue, variant = 0) => {
      try {
        synthRef.current?.playPerformanceCue(cue, variant);
      } catch {
        // Results presentation must never be able to interrupt gameplay state.
      }
    },
    [],
  );

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

  const stopComboOrchestration = useCallback((immediate = true) => {
    const instrument = synthRef.current;
    for (const layerName of COMBO_ORCHESTRATION_LAYER_NAMES) {
      const activeIds = comboOrchestrationVoicesRef.current[layerName];
      for (const noteId of activeIds) {
        try {
          instrument?.noteOff(
            `combo-orchestration:${layerName}:${noteId}`,
            undefined,
            immediate ? 0.035 : 0.12,
          );
        } catch {
          // A broken supplemental voice must never interrupt the chart.
        }
      }
      activeIds.clear();
    }
  }, []);

  const syncComboOrchestration = useCallback(
    (beat: number, currentSettings: KeyboardHeroSettings) => {
      const mix = comboOrchestrationMix(
        comboOrchestrationChallenge,
        scoreRef.current.combo,
        powerRef.current.active,
      );
      if (
        !currentSettings.synthEnabled ||
        currentSettings.practiceMode === "listen" ||
        COMBO_ORCHESTRATION_LAYER_NAMES.every(
          (layerName) => mix[layerName] <= 0.001,
        )
      ) {
        stopComboOrchestration(false);
        return;
      }

      let instrument: KeyboardSynth;
      try {
        instrument = synth();
      } catch {
        stopComboOrchestration(true);
        return;
      }
      if (instrument.state !== "running") {
        stopComboOrchestration(true);
        return;
      }

      for (const layerName of COMBO_ORCHESTRATION_LAYER_NAMES) {
        const layerMix = mix[layerName];
        const activeIds = comboOrchestrationVoicesRef.current[layerName];
        if (layerMix <= 0.001) {
          for (const noteId of activeIds) {
            try {
              instrument.noteOff(
                `combo-orchestration:${layerName}:${noteId}`,
                undefined,
                0.12,
              );
            } catch {
              // Clearing the voice ledger remains authoritative.
            }
          }
          activeIds.clear();
          continue;
        }

        reconcileScheduledVoices(
          comboOrchestrationLayers[layerName],
          beat,
          activeIds,
          (note) => {
            const authoredVelocity = (note.velocity ?? 90) / 127;
            instrument.noteOn(
              `combo-orchestration:${layerName}:${note.id}`,
              note.midi,
              clamp(
                authoredVelocity *
                  layerMix *
                  COMBO_ORCHESTRATION_VELOCITY_SCALE,
                0.03,
                0.82,
              ),
            );
          },
          (note) => {
            instrument.noteOff(
              `combo-orchestration:${layerName}:${note.id}`,
              undefined,
              0.1,
            );
          },
        );
      }
    },
    [
      comboOrchestrationChallenge,
      comboOrchestrationLayers,
      stopComboOrchestration,
      synth,
    ],
  );

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

  const publishHeldNotes = useCallback((atBeat = positionRef.current) => {
    const next = new Map<string, HeldNoteState>();
    for (const [noteId, attempt] of playerNoteAttemptsRef.current) {
      if (attempt.phase === "released-before-start") continue;
      const heldBeats =
        attempt.phase === "holding"
          ? Math.max(0, atBeat - attempt.holdStartBeat)
          : 0;
      const progress =
        attempt.phase === "holding" && attempt.requiredBeats > 0
          ? clamp(heldBeats / attempt.requiredBeats, 0, 1)
          : 0;
      next.set(noteId, {
        noteId,
        midi: attempt.note.midi,
        phase: attempt.phase,
        pressOffsetMs: attempt.pressOffsetMs,
        heldBeats,
        requiredBeats: attempt.requiredBeats,
        progress: attempt.sustainScored ? 1 : progress,
      });
    }
    setHeldNotes(next);
  }, []);

  const clearPlayerNoteAttempts = useCallback(() => {
    clearNoteClaims(
      playerNoteAttemptsRef.current,
      playerNoteIdBySourceRef.current,
    );
    setHeldNotes(new Map());
  }, []);

  const cancelPlayerAttemptsForSourcePrefix = useCallback(
    (sourcePrefix: string) => {
      let changed = false;
      for (const [sourceId, noteId] of playerNoteIdBySourceRef.current) {
        if (!sourceId.startsWith(sourcePrefix)) continue;
        playerNoteIdBySourceRef.current.delete(sourceId);
        playerNoteAttemptsRef.current.delete(noteId);
        changed = true;
      }
      if (changed) publishHeldNotes();
    },
    [publishHeldNotes],
  );

  const releaseHeldSources = useCallback(
    (sourcePrefix: string) => {
      cancelPlayerAttemptsForSourcePrefix(sourcePrefix);
      for (const [midiNote, sources] of heldSourcesRef.current) {
        for (const sourceId of [...sources]) {
          if (!sourceId.startsWith(sourcePrefix)) continue;
          synthRef.current?.noteOff(sourceId, undefined, 0.04);
          sources.delete(sourceId);
        }
        if (sources.size === 0) heldSourcesRef.current.delete(midiNote);
      }
      setPressedNotes(new Set(heldSourcesRef.current.keys()));
    },
    [cancelPlayerAttemptsForSourcePrefix],
  );

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
        : { ...current, active, energy: normalizedEnergy },
    );
  }, []);

  const setBackingBandJamming = useCallback((isJamming: boolean) => {
    backingBandJammingRef.current = isJamming;
    setBackingBand((current) =>
      current.isJamming === isJamming
        ? current
        : { ...current, isJamming },
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
        const pulseIndex = pulseIndexAtBeat(normalizedBeat, song.timeSignature);
        const subdivisionPhase = normalizedBeat * 2 - stepIndex;
        const pulse = (1 - subdivisionPhase) ** 3;
        const downbeat = isDownbeatPulse(pulseIndex, song.timeSignature);
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
    (preservePower: boolean, preserveScore = false) => {
      clearPlayerNoteAttempts();
      resultsRef.current = new Map();
      setNoteResults(new Map());
      setLatestFeedback(null);
      setFeedbackEvents([]);
      setLatestSustainFeedback(null);
      setSustainFeedbackEvents([]);
      chordScoreMultipliersRef.current.clear();
      if (!preserveScore) {
        scoreRef.current = EMPTY_SCORE;
        setScore(EMPTY_SCORE);
      }
      if (!preservePower) resetPower();
    },
    [clearPlayerNoteAttempts, resetPower],
  );

  const resetScore = useCallback(() => clearAttempt(false), [clearAttempt]);
  const resetAttemptForLoop = useCallback(
    // A loop wrap makes its authored notes playable again without breaking the
    // player's live streak or the Power Mode that streak earned.
    () => clearAttempt(true, true),
    [clearAttempt],
  );

  const pause = useCallback(() => {
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
    clearPlayerNoteAttempts();
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
    lastMetronomePulseRef.current = null;
    stopListenVoices();
    stopComboOrchestration(true);
    stopBackingBand(true);
  }, [
    cancelMIDICalibration,
    clearPlayerNoteAttempts,
    finishPower,
    stopBackingBand,
    stopComboOrchestration,
    stopListenVoices,
  ]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
    if (backingBandJammingRef.current) setBackingBandJamming(false);
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
    setBackingBandJamming,
    stopBackingBand,
    synth,
  ]);

  const pauseBackingBand = useCallback(() => {
    if (!backingBandJammingRef.current) return;
    setBackingBandJamming(false);
    stopBackingBand(true);
  }, [setBackingBandJamming, stopBackingBand]);

  const playBackingBand = useCallback(() => {
    if (backingBandJammingRef.current) return;
    if (midiCalibrationRef.current.active) cancelMIDICalibration();
    if (isPlayingRef.current) {
      const handoffBeat = positionRef.current;
      pause();
      backingBandJamBeatRef.current =
        handoffBeat >= song.durationBeats ? 0 : handoffBeat;
    }
    if (!settingsRef.current.backingBandEnabled) {
      setSettings((current) => {
        const next = { ...current, backingBandEnabled: true };
        settingsRef.current = next;
        return next;
      });
    }
    if (backingBandJamBeatRef.current >= song.durationBeats) {
      backingBandJamBeatRef.current = 0;
    }
    stopBackingBand(true);
    setBackingBandJamming(true);
    void synth().resume();
  }, [
    cancelMIDICalibration,
    pause,
    setBackingBandJamming,
    song.durationBeats,
    stopBackingBand,
    synth,
  ]);

  const toggleBackingBandPlayback = useCallback(() => {
    if (backingBandJammingRef.current) pauseBackingBand();
    else playBackingBand();
  }, [pauseBackingBand, playBackingBand]);

  const seekBeat = useCallback(
    (beat: number) => {
      if (midiCalibrationRef.current.active) cancelMIDICalibration();
      const destination = clamp(beat, 0, song.durationBeats);
      const movedToNewBeat =
        Math.abs(destination - positionRef.current) > 0.000_001;
      clearPlayerNoteAttempts();
      stopListenVoices();
      stopComboOrchestration(true);
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
      lastMetronomePulseRef.current = null;
      if (movedToNewBeat) resetScore();
      commitPosition(destination);
    },
    [
      commitPosition,
      cancelMIDICalibration,
      clearPlayerNoteAttempts,
      resetScore,
      song.durationBeats,
      stopBackingBand,
      stopComboOrchestration,
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
    (result: NoteResult): NoteFeedback | null => {
      if (settingsRef.current.practiceMode === "listen") return null;
      // Song-note ids are stable across the result map. This guard also makes
      // RAF misses racing a physical chord incapable of awarding twice.
      if (resultsRef.current.has(result.id)) return null;

      const chordKey = powerChordKeyByNoteId.get(result.id);
      const scoringEnabled = !quickLoopEnabledRef.current;
      const scoreRate = scoreRateForSettings(
        settingsRef.current.practiceMode,
        settingsRef.current.tempoScale,
      );
      const multiplier =
        scoringEnabled && chordKey
          ? latchChordScoreMultiplier(
              chordScoreMultipliersRef.current,
              chordKey,
              powerRef.current.multiplier,
            )
          : 1;
      let pointsAwarded = 0;
      let basePointsAwarded = 0;
      let powerActivation = false;
      if (scoringEnabled) {
        const powerOutcome = applyPowerJudgement(
          powerRef.current,
          result.grade,
        );
        commitPower(powerOutcome.state);
        powerActivation = powerOutcome.activated;

        const currentScore = scoreRef.current;
        let nextScore: KeyboardHeroScore;
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
          basePointsAwarded = pointsForJudgement(
            result.grade,
            0,
            1,
            scoreRate,
          );
          pointsAwarded = pointsForJudgement(
            result.grade,
            combo,
            multiplier,
            scoreRate,
          );
          nextScore = {
            points: currentScore.points + pointsAwarded,
            sustainPoints: currentScore.sustainPoints,
            combo,
            bestCombo: Math.max(currentScore.bestCombo, combo),
            hits,
            misses: currentScore.misses,
            accuracy: scoreAccuracy(hits, currentScore.misses),
          };
        }
        scoreRef.current = nextScore;
        setScore(nextScore);
      }

      const scoredResult: NoteResult = {
        ...result,
        basePointsAwarded,
      };
      resultsRef.current = new Map(resultsRef.current).set(
        result.id,
        scoredResult,
      );
      setNoteResults(resultsRef.current);
      feedbackSequenceRef.current += 1;
      const feedbackEvent: NoteFeedback = {
        ...scoredResult,
        id: `${result.id}:feedback-${feedbackSequenceRef.current}`,
        sequence: feedbackSequenceRef.current,
        groupId: chordKey ?? result.id,
        pointsAwarded,
        multiplier,
        scoreRate,
        powerActivation,
      };
      setLatestFeedback(feedbackEvent);
      setFeedbackEvents((current) =>
        [...current, feedbackEvent].slice(-FEEDBACK_HISTORY_LIMIT),
      );
      return feedbackEvent;
    },
    [commitPower, powerChordKeyByNoteId],
  );

  const removePlayerNoteAttempt = useCallback(
    (noteId: string, publish = true) => {
      const attempt = playerNoteAttemptsRef.current.get(noteId);
      if (!attempt) return;
      playerNoteAttemptsRef.current.delete(noteId);
      if (playerNoteIdBySourceRef.current.get(attempt.sourceId) === noteId) {
        playerNoteIdBySourceRef.current.delete(attempt.sourceId);
      }
      if (publish) publishHeldNotes();
    },
    [publishHeldNotes],
  );

  const registerSustainResult = useCallback(
    (
      attempt: ActivePlayerNoteAttempt,
      releaseBeat: number,
    ): SustainFeedback | null => {
      if (attempt.sustainScored) return null;
      const onsetResult = resultsRef.current.get(attempt.note.id);
      if (!onsetResult || onsetResult.grade === "miss") return null;

      const heldBeats = Math.max(
        0,
        Math.min(releaseBeat, attempt.note.startBeat + attempt.note.durationBeats) -
          attempt.holdStartBeat,
      );
      const judgedSustain = judgeSustain(
        heldBeats,
        attempt.requiredBeats,
        attempt.multiplier,
        attempt.scoreRate,
      );
      const sustain = quickLoopEnabledRef.current
        ? { ...judgedSustain, pointsAwarded: 0 }
        : judgedSustain;
      attempt.sustainScored = true;

      const updatedResult: NoteResult = { ...onsetResult, sustain };
      resultsRef.current = new Map(resultsRef.current).set(
        attempt.note.id,
        updatedResult,
      );
      setNoteResults(resultsRef.current);

      if (sustain.pointsAwarded > 0) {
        const currentScore = scoreRef.current;
        const nextScore: KeyboardHeroScore = {
          ...currentScore,
          points: currentScore.points + sustain.pointsAwarded,
          sustainPoints:
            currentScore.sustainPoints + sustain.pointsAwarded,
        };
        scoreRef.current = nextScore;
        setScore(nextScore);
      }

      feedbackSequenceRef.current += 1;
      const chordKey =
        powerChordKeyByNoteId.get(attempt.note.id) ?? attempt.note.id;
      const feedback: SustainFeedback = {
        ...sustain,
        id: `${attempt.note.id}:sustain-feedback-${feedbackSequenceRef.current}`,
        noteId: attempt.note.id,
        groupId: `${chordKey}:sustain`,
        midi: attempt.note.midi,
        sequence: feedbackSequenceRef.current,
      };
      setLatestSustainFeedback(feedback);
      setSustainFeedbackEvents((current) =>
        [...current, feedback].slice(-FEEDBACK_HISTORY_LIMIT),
      );
      return feedback;
    },
    [powerChordKeyByNoteId],
  );

  const registerEarlyReleaseMiss = useCallback(
    (attempt: ActivePlayerNoteAttempt) => {
      if (settingsRef.current.practiceMode === "wait") {
        registerResult({
          id: `extra-early-release-${attempt.note.id}-${performance.now().toFixed(1)}`,
          midi: attempt.note.midi,
          grade: "miss",
          offsetMs: attempt.pressOffsetMs,
          earlyCaptured: true,
        });
        return;
      }
      registerResult({
        id: attempt.note.id,
        midi: attempt.note.midi,
        grade: "miss",
        offsetMs: attempt.pressOffsetMs,
        earlyCaptured: true,
      });
    },
    [registerResult],
  );

  const resolvePlayerNoteAttemptsThrough = useCallback(
    (throughBeat: number, millisecondsPerBeat: number) => {
      let changed = false;
      for (const [noteId, attempt] of [...playerNoteAttemptsRef.current]) {
        const noteEnd = attempt.note.startBeat + attempt.note.durationBeats;
        if (
          (attempt.phase === "armed" ||
            attempt.phase === "released-before-start") &&
          throughBeat + 0.000_001 >= attempt.note.startBeat
        ) {
          if (attempt.phase === "released-before-start") {
            registerEarlyReleaseMiss(attempt);
            removePlayerNoteAttempt(noteId, false);
            changed = true;
            continue;
          }

          const onset = registerResult(
            resultFor(attempt.note, attempt.pressOffsetMs, true),
          );
          if (!onset || onset.grade === "miss") {
            removePlayerNoteAttempt(noteId, false);
            changed = true;
            continue;
          }

          const requirement = sustainRequirement(
            attempt.note.durationBeats,
            millisecondsPerBeat,
          );
          if (!requirement.eligible) {
            removePlayerNoteAttempt(noteId, false);
            changed = true;
            continue;
          }
          attempt.phase = "holding";
          attempt.holdStartBeat = Math.max(
            attempt.note.startBeat,
            attempt.pressBeat,
          );
          attempt.requiredBeats = requirement.requiredBeats;
          attempt.multiplier = onset.multiplier;
          attempt.scoreRate = onset.scoreRate;
          changed = true;
        }

        if (attempt.phase !== "holding") continue;
        const heldBeats = Math.max(0, throughBeat - attempt.holdStartBeat);
        if (!attempt.sustainScored && heldBeats >= attempt.requiredBeats) {
          registerSustainResult(
            attempt,
            attempt.holdStartBeat + attempt.requiredBeats,
          );
          changed = true;
        }
        if (throughBeat + 0.000_001 >= noteEnd) {
          if (!attempt.sustainScored) registerSustainResult(attempt, noteEnd);
          removePlayerNoteAttempt(noteId, false);
          changed = true;
        }
      }
      if (changed || playerNoteAttemptsRef.current.size > 0) {
        publishHeldNotes(throughBeat);
      }
    },
    [
      publishHeldNotes,
      registerEarlyReleaseMiss,
      registerResult,
      registerSustainResult,
      removePlayerNoteAttempt,
    ],
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
        isFinishingRef.current
      ) {
        return;
      }
      const millisecondsPerBeat =
        60_000 / (song.bpm * settingsRef.current.tempoScale);
      const isPreRoll = countInSecondsRef.current > 0;
      const transportBeat = isPreRoll
        ? preRollVisualBeatRef.current
        : positionRef.current;
      const judgedBeat =
        transportBeat - settingsRef.current.latencyMs / millisecondsPerBeat;
      if (isPreRoll) {
        let replacedReleasedCapture = false;
        for (const [noteId, attempt] of playerNoteAttemptsRef.current) {
          if (
            attempt.phase !== "released-before-start" ||
            attempt.note.midi !== midiNote
          ) {
            continue;
          }
          removePlayerNoteAttempt(noteId, false);
          replacedReleasedCapture = true;
        }
        if (replacedReleasedCapture) publishHeldNotes(judgedBeat);
      }
      const unavailableNoteIds = new Set<string>([
        ...resultsRef.current.keys(),
        ...playerNoteAttemptsRef.current.keys(),
      ]);
      const activeLoop = loopRef.current;
      const candidateNotes = activeLoop.enabled
        ? song.notes.filter((note) =>
            noteWithinPlaybackRange(
              note,
              activeLoop.startBeat,
              activeLoop.endBeat,
            ),
          )
        : song.notes;
      const candidate = findPressCandidate(
        candidateNotes,
        midiNote,
        judgedBeat,
        millisecondsPerBeat,
        unavailableNoteIds,
      );

      if (candidate) {
        const requirement = sustainRequirement(
          candidate.note.durationBeats,
          millisecondsPerBeat,
        );
        const shouldArm = candidate.armed || isPreRoll;
        if (shouldArm) {
          const attempt: ActivePlayerNoteAttempt = {
            note: candidate.note,
            sourceId,
            pressBeat: judgedBeat,
            pressOffsetMs: candidate.offsetMs,
            earlyCaptured: true,
            phase: "armed",
            holdStartBeat: candidate.note.startBeat,
            requiredBeats: requirement.requiredBeats,
            multiplier: 1,
            scoreRate: 1,
            sustainScored: false,
          };
          playerNoteAttemptsRef.current.set(candidate.note.id, attempt);
          playerNoteIdBySourceRef.current.set(sourceId, candidate.note.id);
          publishHeldNotes(judgedBeat);
          return;
        }

        const onset = registerResult(
          resultFor(candidate.note, candidate.offsetMs),
        );
        if (onset && onset.grade !== "miss" && requirement.eligible) {
          const attempt: ActivePlayerNoteAttempt = {
            note: candidate.note,
            sourceId,
            pressBeat: judgedBeat,
            pressOffsetMs: candidate.offsetMs,
            earlyCaptured: false,
            phase: "holding",
            holdStartBeat: Math.max(candidate.note.startBeat, judgedBeat),
            requiredBeats: requirement.requiredBeats,
            multiplier: onset.multiplier,
            scoreRate: onset.scoreRate,
            sustainScored: false,
          };
          playerNoteAttemptsRef.current.set(candidate.note.id, attempt);
          playerNoteIdBySourceRef.current.set(sourceId, candidate.note.id);
          publishHeldNotes(judgedBeat);
        }
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
      } else if (!isPreRoll) {
        registerResult({
          id: `extra-${sourceId}-${performance.now().toFixed(1)}`,
          midi: midiNote,
          grade: "miss",
          offsetMs: 0,
        });
      }
    },
    [
      publishHeldNotes,
      registerResult,
      removePlayerNoteAttempt,
      song.bpm,
      song.notes,
      syncBackingBand,
      synth,
    ],
  );

  const noteOff = useCallback(
    (midiNote: number, source = "manual") => {
      const sourceId = `${source}:${midiNote}`;
      synthRef.current?.noteOff(sourceId);
      const held = heldSourcesRef.current.get(midiNote);
      held?.delete(sourceId);
      if (held?.size === 0) heldSourcesRef.current.delete(midiNote);
      setPressedNotes(new Set(heldSourcesRef.current.keys()));

      const noteId = playerNoteIdBySourceRef.current.get(sourceId);
      const attempt = noteId
        ? playerNoteAttemptsRef.current.get(noteId)
        : undefined;
      if (!noteId || !attempt) return;

      if (attempt.phase === "armed") {
        if (countInSecondsRef.current > 0) {
          attempt.phase = "released-before-start";
          playerNoteIdBySourceRef.current.delete(sourceId);
          publishHeldNotes(preRollVisualBeatRef.current);
          return;
        }
        registerEarlyReleaseMiss(attempt);
      } else if (
        attempt.phase === "holding" &&
        isPlayingRef.current &&
        !isFinishingRef.current &&
        settingsRef.current.practiceMode !== "listen"
      ) {
        const millisecondsPerBeat =
          60_000 / (song.bpm * settingsRef.current.tempoScale);
        const releaseBeat =
          positionRef.current -
          settingsRef.current.latencyMs / millisecondsPerBeat;
        if (!attempt.sustainScored) {
          registerSustainResult(attempt, releaseBeat);
        }
      }
      removePlayerNoteAttempt(noteId);
    },
    [
      publishHeldNotes,
      registerEarlyReleaseMiss,
      registerSustainResult,
      removePlayerNoteAttempt,
      song.bpm,
    ],
  );

  noteOnRef.current = noteOn;
  noteOffRef.current = noteOff;

  const setTempoScale = useCallback((scale: number) => {
    if (countInSecondsRef.current > 0) return;
    backingBandFailedStepRef.current = null;
    const tempoScale = clamp(scale, 0.25, 1.25);
    settingsRef.current = { ...settingsRef.current, tempoScale };
    setSettings((current) => ({ ...current, tempoScale }));
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
        stopComboOrchestration(false);
        resetPower();
      }
      if (practiceMode !== settingsRef.current.practiceMode) {
        // Do not let timing-free Wait judgements carry into a ranked Flow run,
        // or let already-earned Flow points survive a switch into Wait.
        resetScore();
      }
      settingsRef.current = { ...settingsRef.current, practiceMode };
      setSettings((current) => {
        const next = { ...current, practiceMode };
        settingsRef.current = next;
        return next;
      });
      if (practiceMode === "listen" && !isPlayingRef.current) play();
    },
    [
      play,
      resetPower,
      resetScore,
      stopComboOrchestration,
      stopListenVoices,
    ],
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
    if (!synthEnabled) {
      synthRef.current?.allNotesOff(true);
      stopComboOrchestration(true);
    }
  }, [stopComboOrchestration]);

  const setBackingBandEnabled = useCallback(
    (backingBandEnabled: boolean) => {
      backingBandFailedStepRef.current = null;
      setSettings((current) => {
        const next = { ...current, backingBandEnabled };
        settingsRef.current = next;
        return next;
      });
      if (!backingBandEnabled) {
        backingBandJamBeatRef.current = 0;
        setBackingBandJamming(false);
        stopBackingBand(true);
      }
    },
    [setBackingBandJamming, stopBackingBand],
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

  const setMotionPreference = useCallback((preference: MotionPreference) => {
    const motionPreference = normalizeMotionPreference(preference);
    setSettings((current) => {
      const next = { ...current, motionPreference };
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
      if (enabled && quickLoopEnabledRef.current) {
        quickLoopEnabledRef.current = false;
        setQuickLoopEnabledState(false);
      }
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
    if (nextLoop.enabled && quickLoopEnabledRef.current) {
      quickLoopEnabledRef.current = false;
      setQuickLoopEnabledState(false);
    }
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

  const setQuickLoopEnabled = useCallback(
    (enabled: boolean) => {
      if (midiCalibrationRef.current.active) cancelMIDICalibration();
      quickLoopEnabledRef.current = enabled;
      setQuickLoopEnabledState(enabled);
      if (!enabled) return;

      if (loopRef.current.enabled) {
        const nextLoop = { ...loopRef.current, enabled: false };
        loopRef.current = nextLoop;
        setLoopState(nextLoop);
      }
      resetScore();
      setSongComplete(false);
    },
    [cancelMIDICalibration, resetScore],
  );

  const toggleQuickLoop = useCallback(() => {
    setQuickLoopEnabled(!quickLoopEnabledRef.current);
  }, [setQuickLoopEnabled]);

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
      const channel = midiPreferencesRef.current.channel;
      midiChannelRef.current = channel;
      detectedMIDIChannelRef.current = null;
      midiCalibrationSnapshotRef.current = null;
      const calibration = inputId
        ? readMIDICalibration(inputId)
        : { ...EMPTY_MIDI_CALIBRATION };
      midiCalibrationRef.current = calibration;
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
      const preferences = { ...midiPreferencesRef.current, channel };
      midiPreferencesRef.current = preferences;
      persistMIDIPreferences(preferences);
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

  const publishMIDITransportPress = useCallback(
    (action: MIDITransportAction) => {
      const now = performance.now();
      const previous = lastMIDITransportPressRef.current;
      if (
        previous?.action === action &&
        now - previous.time < MIDI_TRANSPORT_DEDUP_MS
      ) {
        return;
      }

      lastMIDITransportPressRef.current = { action, time: now };
      const sequence = midiTransportSequenceRef.current + 1;
      midiTransportSequenceRef.current = sequence;
      setMIDI((current) => ({
        ...current,
        lastTransportEvent: { action, sequence },
      }));
    },
    [],
  );

  const bindMIDITransportInput = useCallback(
    (input: MIDIInputLike) => {
      input.onmidimessage = (event) => {
        if (midiTransportInputsRef.current.get(input.id) !== input) return;
        const action = decodeMIDITransportPress(event.data);
        if (action) publishMIDITransportPress(action);
      };
    },
    [publishMIDITransportPress],
  );

  const rebindMIDITransportInputs = useCallback(
    (inputs: MIDIInputLike[], selectedInputId: string | null) => {
      const next = new Map(
        inputs
          .filter(
            (input) =>
              input.state === "connected" &&
              input.id !== selectedInputId &&
              isMIDITransportInput(input),
          )
          .map((input) => [input.id, input] as const),
      );

      for (const [id, input] of midiTransportInputsRef.current) {
        if (next.get(id) !== input) input.onmidimessage = null;
      }
      midiTransportInputsRef.current = next;
      next.forEach(bindMIDITransportInput);
    },
    [bindMIDITransportInput],
  );

  const bindMIDIInput = useCallback((input: MIDIInputLike) => {
    input.onmidimessage = (event) => {
      if (
        midiInputRef.current !== input ||
        selectedMIDIIdRef.current !== input.id
      ) {
        return;
      }
      if (isMIDITransportInput(input)) {
        const action = decodeMIDITransportPress(event.data);
        if (action) {
          publishMIDITransportPress(action);
          return;
        }
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
        displayMappedNote >= 0 &&
        displayMappedNote <= 127
          ? displayMappedNote
          : null;
      const mappedNote = mapMIDINoteToKeyboardRange(note, transpose);
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
    publishMIDITransportPress,
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
    const preferredInputId = selectedMIDIIdRef.current;
    const retainedInput = inputs.find(
      (input) => input.id === preferredInputId && input.state === "connected",
    );
    const selected =
      retainedInput ??
      (preferredInputId === null ? chooseAutomaticMIDIInput(inputs) : null);
    if (selected && preferredInputId === null) {
      selectedMIDIIdRef.current = selected.id;
      const preferences = {
        ...midiPreferencesRef.current,
        preferredInputId: selected.id,
      };
      midiPreferencesRef.current = preferences;
      persistMIDIPreferences(preferences);
    }
    const previous = midiInputRef.current;
    if (previous !== selected) {
      if (previous) previous.onmidimessage = null;
      resetMIDIActivity(selected?.id ?? null);
    }
    midiInputRef.current = selected;
    rebindMIDITransportInputs(inputs, selected?.id ?? null);
    if (selected) bindMIDIInput(selected);
    setMIDI((current) => ({
      ...current,
      inputs: infos,
      selectedInputId: selected?.id ?? null,
      connectedName: selected?.name || null,
    }));
  }, [bindMIDIInput, rebindMIDITransportInputs, resetMIDIActivity]);

  const selectMIDIInput = useCallback(
    (inputId: string | null) => {
      const inputChanged = selectedMIDIIdRef.current !== inputId;
      const previous = midiInputRef.current;
      if (previous) {
        previous.onmidimessage = null;
      }
      const inputs = Array.from(midiAccessRef.current?.inputs.values() ?? []);
      const input = inputs.find(
        (candidate) => candidate.id === inputId && candidate.state === "connected",
      );
      if (inputChanged) {
        resetMIDIActivity(input?.id ?? null);
      }
      selectedMIDIIdRef.current = inputId;
      midiInputRef.current = input ?? null;
      rebindMIDITransportInputs(inputs, input?.id ?? null);
      if (input) bindMIDIInput(input);
      if (input || inputId === null) {
        const preferences = {
          ...midiPreferencesRef.current,
          preferredInputId: input?.id ?? null,
        };
        midiPreferencesRef.current = preferences;
        persistMIDIPreferences(preferences);
      }
      setMIDI((current) => ({
        ...current,
        selectedInputId: input?.id ?? null,
        connectedName: input?.name || null,
        error: inputId && !input ? "That MIDI input is no longer connected." : null,
      }));
    },
    [bindMIDIInput, rebindMIDITransportInputs, resetMIDIActivity],
  );

  const connectMIDI = useCallback((): Promise<void> => {
    if (midiConnectionPromiseRef.current) {
      return midiConnectionPromiseRef.current;
    }

    const connection = (async () => {
      const requestMIDIAccess = (navigator as MIDIEnabledNavigator)
        .requestMIDIAccess;
      if (!requestMIDIAccess) {
        setMIDI((current) => ({
          ...current,
          supported: false,
          permission: "unsupported",
          error: "Web MIDI is not supported in this browser.",
        }));
        return;
      }
      if (!midiAccessRef.current) {
        setMIDI((current) => ({
          ...current,
          permission: "prompt",
          error: null,
        }));
      }
      try {
        const access =
          midiAccessRef.current ??
          (await requestMIDIAccess.call(navigator, { sysex: false }));
        if (!midiHookActiveRef.current) return;
        midiAccessRef.current = access;
        access.onstatechange = refreshMIDIInputs;
        setMIDI((current) => ({
          ...current,
          supported: true,
          permission: "granted",
          error: null,
        }));
        refreshMIDIInputs();
      } catch (error) {
        if (!midiHookActiveRef.current) return;
        setMIDI((current) => ({
          ...current,
          permission: "denied",
          error:
            error instanceof Error
              ? error.message
              : "MIDI access was denied. Check the browser site permission.",
        }));
      }
    })();

    midiConnectionPromiseRef.current = connection;
    void connection.then(
      () => {
        if (midiConnectionPromiseRef.current === connection) {
          midiConnectionPromiseRef.current = null;
        }
      },
      () => {
        if (midiConnectionPromiseRef.current === connection) {
          midiConnectionPromiseRef.current = null;
        }
      },
    );
    return connection;
  }, [refreshMIDIInputs]);

  useEffect(() => {
    midiHookActiveRef.current = true;
    setSettings(readSettings());
    const preferences = readMIDIPreferences();
    midiPreferencesRef.current = preferences;
    selectedMIDIIdRef.current = preferences.preferredInputId;
    midiChannelRef.current = preferences.channel;
    const supported =
      typeof (navigator as MIDIEnabledNavigator).requestMIDIAccess === "function";
    setMIDI((current) => ({
      ...current,
      supported,
      channel: preferences.channel,
    }));
    if (supported && !autoMIDIConnectAttemptedRef.current) {
      autoMIDIConnectAttemptedRef.current = true;
      void connectMIDI();
    }
  }, [connectMIDI]);

  useEffect(() => {
    settingsRef.current = settings;
    document.documentElement.dataset.motionPreference =
      settings.motionPreference;
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
    setBackingBandJamming(false);
    backingBandJamBeatRef.current = 0;
    stopBackingBand(true);
    pause();
    setSongComplete(false);
    commitPosition(0);
    resetScore();
    setLoopState({ enabled: false, startBeat: 0, endBeat: song.durationBeats });
  }, [
    commitPosition,
    pause,
    resetScore,
    setBackingBandJamming,
    song.id,
    song.durationBeats,
    stopBackingBand,
  ]);

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
    if (!backingBand.isJamming) return;
    let frame = 0;
    let previousTime = performance.now();
    const jamLoop: KeyboardHeroLoop = {
      enabled: true,
      startBeat: 0,
      endBeat: song.durationBeats,
    };

    const animateBand = (now: number) => {
      if (!backingBandJammingRef.current) return;
      const currentSettings = settingsRef.current;
      if (!currentSettings.backingBandEnabled) {
        setBackingBandJamming(false);
        stopBackingBand(true);
        return;
      }

      const deltaSeconds = Math.min(
        0.1,
        Math.max(0, (now - previousTime) / 1000),
      );
      previousTime = now;
      const beatsAdvanced =
        deltaSeconds * (song.bpm * currentSettings.tempoScale) / 60;
      let nextBeat = backingBandJamBeatRef.current + beatsAdvanced;
      if (nextBeat >= song.durationBeats) {
        nextBeat %= song.durationBeats;
        stopBackingBand(true);
      }
      backingBandJamBeatRef.current = nextBeat;
      syncBackingBand(nextBeat, currentSettings, jamLoop);
      frame = requestAnimationFrame(animateBand);
    };

    frame = requestAnimationFrame(animateBand);
    return () => cancelAnimationFrame(frame);
  }, [
    backingBand.isJamming,
    setBackingBandJamming,
    song.bpm,
    song.durationBeats,
    stopBackingBand,
    syncBackingBand,
  ]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let previousTime = performance.now();

    const animate = (now: number) => {
      if (!isPlayingRef.current) return;
      const deltaSeconds = Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const currentSettings = settingsRef.current;
      const millisecondsPerBeat =
        60_000 / (song.bpm * currentSettings.tempoScale);
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
        const crossedPulse = pulseIndexAtBeat(
          nextVisualBeat,
          song.timeSignature,
        );
        const previousPulse = pulseIndexAtBeat(
          previousVisualBeat,
          song.timeSignature,
        );
        if (
          currentSettings.metronomeEnabled &&
          crossedPulse <= 0 &&
          crossedPulse > previousPulse
        ) {
          playMetronomeSafely(
            isDownbeatPulse(crossedPulse, song.timeSignature),
          );
          if (crossedPulse === 0) lastMetronomePulseRef.current = 0;
        }
        preRollVisualBeatRef.current = nextVisualBeat;
        setVisualBeat(nextVisualBeat);
        setCountdown(remainingSeconds > 0 ? afterDisplay : null);
        if (remainingSeconds === 0) {
          resolvePlayerNoteAttemptsThrough(0, millisecondsPerBeat);
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
            (note) => {
              const attempt = playerNoteAttemptsRef.current.get(note.id);
              return (
                !resultsRef.current.has(note.id) &&
                attempt?.phase !== "armed" &&
                note.startBeat < loopEnd - 0.000_001 &&
                note.startBeat >= oldBeat - 0.001 &&
                note.startBeat <= nextBeat + 0.001
              );
            },
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

      resolvePlayerNoteAttemptsThrough(
        Math.min(nextBeat, loopEnd),
        millisecondsPerBeat,
      );

      if (currentSettings.practiceMode === "flow") {
        const missed = song.notes.filter(
          (note) =>
            !resultsRef.current.has(note.id) &&
            (!activeLoop.enabled ||
              noteWithinPlaybackRange(
                note,
                activeLoop.startBeat,
                activeLoop.endBeat,
              )) &&
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

      const pulseIndex = pulseIndexAtBeat(nextBeat, song.timeSignature);
      if (
        currentSettings.metronomeEnabled &&
        pulseIndex !== lastMetronomePulseRef.current
      ) {
        lastMetronomePulseRef.current = pulseIndex;
        playMetronomeSafely(
          isDownbeatPulse(pulseIndex, song.timeSignature),
        );
      }

      if (nextBeat >= loopEnd) {
        const shouldQuickLoop =
          quickLoopEnabledRef.current && !activeLoop.enabled;
        if (activeLoop.enabled || shouldQuickLoop) {
          nextBeat =
            (activeLoop.enabled ? activeLoop.startBeat : 0) +
            (nextBeat - loopEnd);
          stopListenVoices();
          stopComboOrchestration(true);
          stopBackingBand(true);
          if (currentSettings.practiceMode !== "listen") {
            if (shouldQuickLoop) {
              resetScore();
            } else {
              resetAttemptForLoop();
            }
          }
          lastMetronomePulseRef.current = null;
        } else {
          resolvePlayerNoteAttemptsThrough(
            song.durationBeats,
            millisecondsPerBeat,
          );
          if (currentSettings.practiceMode === "flow") {
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
          stopComboOrchestration(false);
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
      syncComboOrchestration(nextBeat, currentSettings);
      commitPosition(nextBeat);
      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [
    commitPosition,
    finishPower,
    isPlaying,
    pause,
    playMetronomeSafely,
    registerResult,
    resolvePlayerNoteAttemptsThrough,
    resetAttemptForLoop,
    resetScore,
    song,
    stopBackingBand,
    stopComboOrchestration,
    stopListenVoices,
    syncBackingBand,
    syncComboOrchestration,
    syncListenVoices,
  ]);

  useEffect(
    () => () => {
      midiHookActiveRef.current = false;
      if (midiInputRef.current) midiInputRef.current.onmidimessage = null;
      midiTransportInputsRef.current.forEach((input) => {
        input.onmidimessage = null;
      });
      midiTransportInputsRef.current.clear();
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
      if (midiCalibrationTimeoutRef.current !== null) {
        clearTimeout(midiCalibrationTimeoutRef.current);
      }
      try {
        synthRef.current?.setPowerMode(false, 0);
      } catch {
        // Disposal below remains authoritative if the effects graph is broken.
      }
      stopComboOrchestration(true);
      void synthRef.current?.dispose();
    },
    [stopComboOrchestration],
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
    heldNotes,
    latestSustainFeedback,
    sustainFeedbackEvents,
    score,
    power,
    midi,
    backingBand,
    settings,
    loop,
    quickLoopEnabled,
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
    setMotionPreference,
    playBackingBand,
    pauseBackingBand,
    toggleBackingBandPlayback,
    setLatencyMs,
    setLoop,
    toggleLoop,
    setQuickLoopEnabled,
    toggleQuickLoop,
    connectMIDI,
    selectMIDIInput,
    setMIDIChannel,
    startMIDICalibration,
    cancelMIDICalibration,
    resetMIDICalibration,
    noteOn,
    noteOff,
    playPerformanceCue,
    resetScore,
  };
}
