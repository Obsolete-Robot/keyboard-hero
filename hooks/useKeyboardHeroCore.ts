"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KeyboardSynth } from "@/lib/audio";
import type { Song, SongNote } from "@/lib/songs";

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
  error: string | null;
}

export interface KeyboardHeroSettings {
  tempoScale: number;
  practiceMode: PracticeMode;
  metronomeEnabled: boolean;
  synthEnabled: boolean;
  latencyMs: number;
}

export interface KeyboardHeroLoop {
  enabled: boolean;
  startBeat: number;
  endBeat: number;
}

export interface KeyboardHeroCore {
  positionBeat: number;
  positionSeconds: number;
  isPlaying: boolean;
  countdown: number | null;
  pressedNotes: Set<number>;
  noteResults: Map<string, NoteResult>;
  latestFeedback: NoteResult | null;
  score: KeyboardHeroScore;
  midi: KeyboardHeroMIDIState;
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
  setLatencyMs: (latencyMs: number) => void;
  setLoop: (startBeat: number, endBeat: number, enabled?: boolean) => void;
  toggleLoop: () => void;
  connectMIDI: () => Promise<void>;
  selectMIDIInput: (inputId: string | null) => void;
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
const DEFAULT_SETTINGS: KeyboardHeroSettings = {
  tempoScale: 1,
  practiceMode: "flow",
  metronomeEnabled: true,
  synthEnabled: true,
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
  const [settings, setSettings] = useState<KeyboardHeroSettings>(readSettings);
  const [positionBeat, setPositionBeatState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(() => new Set());
  const [noteResults, setNoteResults] = useState<Map<string, NoteResult>>(
    () => new Map(),
  );
  const [latestFeedback, setLatestFeedback] = useState<NoteResult | null>(null);
  const [score, setScore] = useState<KeyboardHeroScore>(EMPTY_SCORE);
  const [loop, setLoopState] = useState<KeyboardHeroLoop>({
    enabled: false,
    startBeat: 0,
    endBeat: song.durationBeats,
  });
  const [midi, setMIDI] = useState<KeyboardHeroMIDIState>(() => ({
    supported:
      typeof navigator !== "undefined" &&
      typeof (navigator as MIDIEnabledNavigator).requestMIDIAccess === "function",
    permission: "idle",
    inputs: [],
    selectedInputId: null,
    connectedName: null,
    error: null,
  }));

  const synthRef = useRef<KeyboardSynth | null>(null);
  const midiAccessRef = useRef<MIDIAccessLike | null>(null);
  const midiInputRef = useRef<MIDIInputLike | null>(null);
  const selectedMIDIIdRef = useRef<string | null>(null);
  const noteOnRef = useRef<(midi: number, velocity?: number, source?: string) => void>(
    () => undefined,
  );
  const noteOffRef = useRef<(midi: number, source?: string) => void>(() => undefined);
  const positionRef = useRef(0);
  const resultsRef = useRef(noteResults);
  const settingsRef = useRef(settings);
  const loopRef = useRef(loop);
  const isPlayingRef = useRef(false);
  const countInBeatsRef = useRef(0);
  const heldSourcesRef = useRef<Map<number, Set<string>>>(new Map());
  const listenVoicesRef = useRef<Set<string>>(new Set());
  const lastMetronomeBeatRef = useRef<number | null>(null);

  const synth = useCallback((): KeyboardSynth => {
    synthRef.current ??= new KeyboardSynth();
    return synthRef.current;
  }, []);

  const commitPosition = useCallback(
    (beat: number) => {
      const next = clamp(beat, 0, song.durationBeats);
      positionRef.current = next;
      setPositionBeatState(next);
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

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    countInBeatsRef.current = 0;
    setCountdown(null);
    lastMetronomeBeatRef.current = null;
    stopListenVoices();
  }, [stopListenVoices]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    if (positionRef.current >= song.durationBeats) commitPosition(0);
    void synth().resume();
    const shouldCountIn =
      positionRef.current === 0 && song.countInBeats > 0;
    countInBeatsRef.current = shouldCountIn ? song.countInBeats : 0;
    setCountdown(shouldCountIn ? song.countInBeats : null);
    if (shouldCountIn && settingsRef.current.metronomeEnabled) {
      synth().playMetronome(true);
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [commitPosition, song.countInBeats, song.durationBeats, synth]);

  const seekBeat = useCallback(
    (beat: number) => {
      const destination = clamp(beat, 0, song.durationBeats);
      stopListenVoices();
      countInBeatsRef.current = 0;
      setCountdown(null);
      lastMetronomeBeatRef.current = null;
      const reopenedResults = new Map(resultsRef.current);
      for (const note of song.notes) {
        if (note.startBeat >= destination) reopenedResults.delete(note.id);
      }
      resultsRef.current = reopenedResults;
      setNoteResults(reopenedResults);
      setLatestFeedback(null);
      commitPosition(destination);
    },
    [commitPosition, song.durationBeats, song.notes, stopListenVoices],
  );

  const resetScore = useCallback(() => {
    resultsRef.current = new Map();
    setNoteResults(new Map());
    setLatestFeedback(null);
    setScore(EMPTY_SCORE);
  }, []);

  const restart = useCallback(() => {
    pause();
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
    setLatestFeedback(result);
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
        countInBeatsRef.current > 0
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
      } else {
        registerResult({
          id: `extra-${sourceId}-${performance.now().toFixed(1)}`,
          midi: midiNote,
          grade: "miss",
          offsetMs: 0,
        });
      }
    },
    [registerResult, song.bpm, song.notes, synth],
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
      loopRef.current = nextLoop;
      setLoopState(nextLoop);
      if (enabled && (positionRef.current < start || positionRef.current >= end)) {
        seekBeat(start);
      }
    },
    [seekBeat, song.durationBeats],
  );

  const toggleLoop = useCallback(() => {
    const current = loopRef.current;
    const nextLoop = { ...current, enabled: !current.enabled };
    loopRef.current = nextLoop;
    setLoopState(nextLoop);
    if (
      nextLoop.enabled &&
      (positionRef.current < nextLoop.startBeat ||
        positionRef.current >= nextLoop.endBeat)
    ) {
      seekBeat(nextLoop.startBeat);
    }
  }, [seekBeat]);

  const bindMIDIInput = useCallback((input: MIDIInputLike) => {
    input.onmidimessage = (event) => {
      const [status = 0, note = 0, velocity = 0] = event.data;
      const command = status & 0xf0;
      const source = `midi:${input.id}`;
      if (command === 0x90 && velocity > 0) {
        noteOnRef.current(note, velocity, source);
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
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
    if (previous && previous !== selected) {
      previous.onmidimessage = null;
      releaseHeldSources(`midi:${previous.id}:`);
    }
    midiInputRef.current = selected ?? null;
    if (selected) bindMIDIInput(selected);
    setMIDI((current) => ({
      ...current,
      inputs: infos,
      selectedInputId: selected?.id ?? null,
      connectedName: selected?.name || null,
    }));
  }, [bindMIDIInput, releaseHeldSources]);

  const selectMIDIInput = useCallback(
    (inputId: string | null) => {
      const previous = midiInputRef.current;
      if (previous) {
        previous.onmidimessage = null;
        if (previous.id !== inputId) {
          releaseHeldSources(`midi:${previous.id}:`);
        }
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
    [bindMIDIInput, releaseHeldSources],
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
      const first = Array.from(access.inputs.values()).find(
        (input) => input.state === "connected",
      );
      if (first) selectMIDIInput(first.id);
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
    settingsRef.current = settings;
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

      if (countInBeatsRef.current > 0) {
        const before = countInBeatsRef.current;
        const after = Math.max(0, before - beatsAdvanced);
        countInBeatsRef.current = after;
        const beforeDisplay = Math.ceil(before);
        const afterDisplay = Math.ceil(after);
        if (
          after > 0 &&
          afterDisplay !== beforeDisplay &&
          currentSettings.metronomeEnabled
        ) {
          synth().playMetronome(afterDisplay === song.countInBeats);
        }
        setCountdown(after > 0 ? afterDisplay : null);
        frame = requestAnimationFrame(animate);
        return;
      }

      const oldBeat = positionRef.current;
      let nextBeat = oldBeat + beatsAdvanced;
      const activeLoop = loopRef.current;
      const loopEnd = activeLoop.enabled ? activeLoop.endBeat : song.durationBeats;

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
        if (blockingBeat !== null) nextBeat = Math.min(nextBeat, blockingBeat);
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
          commitPosition(song.durationBeats);
          pause();
          return;
        }
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
    stopListenVoices,
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
    positionSeconds,
    isPlaying,
    countdown,
    pressedNotes,
    noteResults,
    latestFeedback,
    score,
    midi,
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
    setLatencyMs,
    setLoop,
    toggleLoop,
    connectMIDI,
    selectMIDIInput,
    noteOn,
    noteOff,
    resetScore,
  };
}
