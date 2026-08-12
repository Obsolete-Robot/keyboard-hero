"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  AudioLines,
  ChevronDown,
  CircleGauge,
  Headphones,
  Pause,
  Play,
  Repeat2,
  Rewind,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Usb,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import KeyboardStage, {
  type KeyboardHitFeedback,
  type KeyboardStageHand,
  type KeyboardStageNote,
} from "@/components/KeyboardStage";
import PerformanceResults from "@/components/PerformanceResults";
import { buildSongFingeringGuide } from "@/lib/fingering";
import {
  TrainingCoach,
  TrainingLauncher,
  TrainingRoom,
  type TrainingProgress,
} from "@/components/TrainingArea";
import {
  useKeyboardHeroCore,
  type NoteFeedback,
  type SustainFeedback,
} from "@/hooks/useKeyboardHeroCore";
import { resolveMIDITransportIntent } from "@/lib/midiTransport";
import {
  SONGS,
  getSongDurationSeconds,
  midiToNoteName,
  type Song,
  type SongSection,
} from "@/lib/songs";
import {
  TRAINING_LESSONS,
  TRAINING_SONGS,
  TRAINING_STORAGE_KEY,
  getNextTrainingLanding,
  getNotesInSection,
  getTrainingLessonBySongId,
  getTrainingSection,
  type TrainingLesson,
} from "@/lib/training";

const PLAYABLE_SONGS: readonly Song[] = [...SONGS, ...TRAINING_SONGS];

function formatTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function currentSection(song: Song, beat: number) {
  return (
    [...song.sections]
      .reverse()
      .find((section) => beat >= section.startBeat && beat < section.endBeat) ??
    song.sections[0]
  );
}

function modeCopy(mode: "flow" | "wait" | "listen") {
  if (mode === "wait") {
    return {
      title: "No note left behind",
      body: "The song holds its place until you land the right key. Build the motion first; timing comes next.",
      tone: "warn",
    };
  }
  if (mode === "listen") {
    return {
      title: "Watch the hands come alive",
      body: "Keyboard Hero performs the arrangement so you can hear the phrasing and preview each move.",
      tone: "success",
    };
  }
  return {
    title: "Stay loose, look ahead",
    body: "Keep your eyes one beat above the hit line. A relaxed miss is easier to fix than a tense recovery.",
    tone: "",
  };
}

type CelebrationTone = "perfect" | "great" | "good" | "miss" | "rockstar";

interface CelebrationCopy {
  eyebrow: string;
  headline: string;
  detail: string;
  tone: CelebrationTone;
  variant: "judgement" | "milestone";
}

function performanceCelebration(
  feedback: NoteFeedback | null,
  combo: number,
): CelebrationCopy | null {
  if (!feedback) return null;
  if (feedback.powerActivation) {
    return {
      eyebrow: "Combo energy maxed // 2× score",
      headline: "Power mode!",
      detail: "You earned the spotlight. Keep every note clean.",
      tone: "rockstar",
      variant: "milestone",
    };
  }
  const offset = Math.round(Math.abs(feedback.offsetMs));
  const timingDirection = feedback.earlyCaptured
    ? "Early catch held to the line"
    : offset <= 8
      ? "Dead center"
      : `${offset}ms ${feedback.offsetMs < 0 ? "early" : "late"}`;

  if (feedback.grade === "miss") {
    return {
      eyebrow: "Reset // next note",
      headline: "Miss",
      detail: "Head up. Find the next lane.",
      tone: "miss",
      variant: "judgement",
    };
  }

  const isMilestone =
    combo === 4 ||
    combo === 8 ||
    combo === 15 ||
    combo === 25 ||
    (combo > 25 && combo % 10 === 0);

  if (isMilestone && combo >= 25) {
    return {
      eyebrow: `${combo} straight // no breaks`,
      headline: "Rockstar!",
      detail: "The whole stage is lit. Ride it home.",
      tone: "rockstar",
      variant: "milestone",
    };
  }
  if (isMilestone && combo >= 15) {
    return {
      eyebrow: `${combo} straight // streak live`,
      headline: "On fire!",
      detail: "Your hands know the path. Stay loose.",
      tone: "rockstar",
      variant: "milestone",
    };
  }
  if (isMilestone && combo >= 8) {
    return {
      eyebrow: `${combo} straight // streak live`,
      headline: "Locked in!",
      detail: "Timing is turning into instinct.",
      tone: feedback.grade === "perfect" ? "perfect" : "great",
      variant: "milestone",
    };
  }
  if (isMilestone && combo >= 4) {
    return {
      eyebrow: `${combo} straight // streak started`,
      headline: "Groove live!",
      detail: "The groove is building. Look ahead.",
      tone: feedback.grade === "perfect" ? "perfect" : "great",
      variant: "milestone",
    };
  }
  if (feedback.grade === "perfect") {
    return {
      eyebrow: "Perfect timing",
      headline: "Perfect",
      detail: `${timingDirection} // remember that feel`,
      tone: "perfect",
      variant: "judgement",
    };
  }
  if (feedback.grade === "great") {
    return {
      eyebrow: timingDirection,
      headline: "Great",
      detail: "Same motion. Settle into the pulse.",
      tone: "great",
      variant: "judgement",
    };
  }
  return {
    eyebrow: timingDirection,
    headline: "Landed",
    detail: "Stay in it. Smooth beats rushed.",
    tone: "good",
    variant: "judgement",
  };
}

function sustainCelebration(feedback: SustainFeedback): CelebrationCopy {
  const progress = Math.round(feedback.progress * 100);
  const points = feedback.pointsAwarded.toLocaleString();

  if (feedback.grade === "full") {
    return {
      eyebrow: `Full sustain // +${points}`,
      headline: "Hold locked!",
      detail: `${feedback.heldBeats.toFixed(1)} beats ringing clean.`,
      tone: "perfect",
      variant: "judgement",
    };
  }
  if (feedback.grade === "partial") {
    return {
      eyebrow: `Sustain ${progress}% // +${points}`,
      headline: "Keep it singing",
      detail: "Good hold. Stay down through the full note tail.",
      tone: "good",
      variant: "judgement",
    };
  }
  return {
    eyebrow: `Released at ${progress}% // +${points}`,
    headline: "Hold it longer",
    detail: "Keep the key down until the note tail clears the line.",
    tone: "miss",
    variant: "judgement",
  };
}

function Difficulty({ value }: { value: number }) {
  return (
    <div className="difficulty" aria-label={`Difficulty ${value} of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          className={`difficulty-dot${index < value ? " filled" : ""}`}
          key={index}
        />
      ))}
    </div>
  );
}

function SongLibrary({
  activeSong,
  onClose,
  onSelect,
}: {
  activeSong: Song;
  onClose: () => void;
  onSelect: (song: Song) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeElement = document.activeElement;
    const returnFocus =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (buttons.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleDialogKeyDown);
    return () => dialog.removeEventListener("keydown", handleDialogKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <button
        aria-label="Close song library"
        className="modal-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-label="Song library"
        aria-modal="true"
        className="library-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <div className="modal-kicker">10-level learning path</div>
            <h2>Pick your next set.</h2>
            <p>
              Start with five notes, then work through two-hand independence,
              chords, blues, arpeggios, and a full arena-style finale. Every
              arrangement fits the MPK Mini&apos;s 25 keys.
            </p>
          </div>
          <button
            aria-label="Close song library"
            className="close-button"
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="song-grid">
          {SONGS.map((song, index) => (
            <button
              className={`song-card${song.id === activeSong.id ? " selected" : ""}`}
              key={song.id}
              onClick={() => onSelect(song)}
            >
              <span className="song-card-index">
                LEVEL {(index + 1).toString().padStart(2, "0")} · {song.style}
              </span>
              <h3>{song.title}</h3>
              <div className="song-composer">
                {song.subtitle} · {song.composer}
              </div>
              <Difficulty value={song.difficulty} />
              <div className="skill-chips">
                {song.skills.slice(0, 3).map((skill) => (
                  <span className="skill-chip" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
              <div className="song-card-footer">
                <span>{song.bpm} BPM</span>
                <span>{song.notes.length} notes</span>
                <span>{song.sections.length} loops</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const [songId, setSongId] = useState(SONGS[0].id);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [trainingSectionId, setTrainingSectionId] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress>({});
  const [trainingProgressReady, setTrainingProgressReady] = useState(false);
  const [pendingTrainingSetup, setPendingTrainingSetup] = useState<{
    songId: string;
    sectionId: string;
  } | null>(null);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const closeTraining = useCallback(() => setTrainingOpen(false), []);
  const song = useMemo(
    () =>
      PLAYABLE_SONGS.find((candidate) => candidate.id === songId) ?? SONGS[0],
    [songId],
  );
  const songFingering = useMemo(() => buildSongFingeringGuide(song), [song]);
  const activeTrainingLesson = useMemo(
    () => getTrainingLessonBySongId(song.id),
    [song.id],
  );
  const activeTrainingSection = activeTrainingLesson
    ? getTrainingSection(activeTrainingLesson, trainingSectionId)
    : null;
  const hero = useKeyboardHeroCore(song);
  const pauseForLibrary = hero.pause;
  const openLibrary = useCallback(() => {
    pauseForLibrary();
    setTrainingOpen(false);
    setLibraryOpen(true);
  }, [pauseForLibrary]);
  const openTraining = useCallback(() => {
    pauseForLibrary();
    setLibraryOpen(false);
    setTrainingOpen(true);
  }, [pauseForLibrary]);
  const isFinishing = hero.isFinishing;
  const songComplete = hero.songComplete;
  const positionBeatRef = useRef(hero.positionBeat);
  const lastRegularSongIdRef = useRef(SONGS[0].id);
  const trainingReturnBackingBandRef = useRef(
    hero.settings.backingBandEnabled,
  );
  const previousTrainingFrameRef = useRef<{
    isPlaying: boolean;
    misses: number;
    hits: number;
    accuracy: number;
    positionBeat: number;
    sectionId: string | null;
    songId: string;
  } | null>(null);
  const handledMIDITransportSequenceRef = useRef(0);
  const togglePlayFromKey = hero.togglePlay;
  const playFromMIDI = hero.play;
  const restartFromMIDI = hero.restart;
  const rewindFromKey = hero.rewindBeats;
  const seekFromKey = hero.seekBeat;
  const setBackingBandForTraining = hero.setBackingBandEnabled;
  const setLoopForTraining = hero.setLoop;
  const setModeForTraining = hero.setPracticeMode;
  const setTempoForTraining = hero.setTempoScale;
  const backingBandEnabledForTraining = hero.settings.backingBandEnabled;

  useEffect(() => {
    positionBeatRef.current = hero.positionBeat;
  }, [hero.positionBeat]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const nextProgress: TrainingProgress = {};
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(TRAINING_STORAGE_KEY) ?? "{}",
        ) as unknown;
        if (stored && typeof stored === "object") {
          for (const lesson of TRAINING_LESSONS) {
            const storedLesson = (stored as Record<string, unknown>)[lesson.id];
            if (!storedLesson || typeof storedLesson !== "object") continue;
            for (const section of lesson.song.sections) {
              const value = Number(
                (storedLesson as Record<string, unknown>)[section.id],
              );
              if (!Number.isFinite(value) || value <= 0) continue;
              nextProgress[lesson.id] ??= {};
              nextProgress[lesson.id][section.id] = Math.min(
                lesson.song.pedagogy.mastery.cleanRuns,
                Math.floor(value),
              );
            }
          }
        }
      } catch {
        // Device-local progress is optional in restricted/private browser modes.
      }
      if (!cancelled) {
        setTrainingProgress(nextProgress);
        setTrainingProgressReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trainingProgressReady) return;
    try {
      window.localStorage.setItem(
        TRAINING_STORAGE_KEY,
        JSON.stringify(trainingProgress),
      );
    } catch {
      // The training room remains fully usable when storage is unavailable.
    }
  }, [trainingProgress, trainingProgressReady]);

  useEffect(() => {
    const handleTransportKeys = (event: globalThis.KeyboardEvent) => {
      if (libraryOpen || trainingOpen || songComplete) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "BUTTON" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayFromKey();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        rewindFromKey(4);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        seekFromKey(positionBeatRef.current + 4);
      }
    };
    window.addEventListener("keydown", handleTransportKeys);
    return () => window.removeEventListener("keydown", handleTransportKeys);
  }, [
    libraryOpen,
    rewindFromKey,
    seekFromKey,
    songComplete,
    togglePlayFromKey,
    trainingOpen,
  ]);

  const activeSection =
    activeTrainingSection ?? currentSection(song, hero.positionBeat);
  const fingeringRange = hero.loop.enabled
    ? { startBeat: hero.loop.startBeat, endBeat: hero.loop.endBeat }
    : {
        startBeat: activeSection?.startBeat ?? 0,
        endBeat: activeSection?.endBeat ?? song.durationBeats,
      };
  const fingeringHands = useMemo<readonly KeyboardStageHand[]>(() => {
    const hands = new Set<KeyboardStageHand>();
    songFingering.notes.forEach((recommendation) => {
      if (
        recommendation.handIsAuthored &&
        recommendation.fingerIsAuthored &&
        recommendation.startBeat >= fingeringRange.startBeat - 0.000_001 &&
        recommendation.startBeat < fingeringRange.endBeat - 0.000_001
      ) {
        hands.add(recommendation.hand);
      }
    });
    return (["left", "right"] as const).filter((hand) => hands.has(hand));
  }, [fingeringRange.endBeat, fingeringRange.startBeat, songFingering.notes]);
  const nextFingeringLanding = useMemo(() => {
    const loopNotes = hero.loop.enabled
      ? song.notes.filter(
          (note) =>
            note.startBeat >= hero.loop.startBeat - 0.000_001 &&
            note.startBeat < hero.loop.endBeat - 0.000_001,
        )
      : song.notes;
    const upcomingStart = loopNotes.reduce<number | null>(
      (next, note) =>
        note.startBeat >= hero.positionBeat - 0.04 &&
        (next === null || note.startBeat < next)
          ? note.startBeat
          : next,
      null,
    );
    const landingStart =
      upcomingStart ??
      (hero.loop.enabled
        ? loopNotes.reduce(
            (first, note) => Math.min(first, note.startBeat),
            Number.POSITIVE_INFINITY,
          )
        : Number.NaN);
    if (!Number.isFinite(landingStart)) return [];
    return loopNotes
      .filter((note) => Math.abs(note.startBeat - landingStart) <= 0.000_001)
      .map((note) => ({
        note,
        recommendation: songFingering.byNoteId.get(note.id),
      }))
      .sort((left, right) => left.note.midi - right.note.midi);
  }, [
    hero.loop.enabled,
    hero.loop.endBeat,
    hero.loop.startBeat,
    hero.positionBeat,
    song,
    songFingering.byNoteId,
  ]);
  const nextLandingBeat = nextFingeringLanding[0]?.note.startBeat ?? hero.positionBeat;
  const nextTrainingLanding = useMemo(
    () =>
      activeTrainingLesson && activeTrainingSection
        ? getNextTrainingLanding(
            song,
            hero.positionBeat,
            new Set(hero.noteResults.keys()),
            activeTrainingSection,
          )
        : null,
    [
      activeTrainingLesson,
      activeTrainingSection,
      hero.noteResults,
      hero.positionBeat,
      song,
    ],
  );
  const coach = modeCopy(hero.settings.practiceMode);
  const totalSeconds = getSongDurationSeconds(song, hero.settings.tempoScale);
  const noteApproachBeats = Math.max(
    1.25,
    (song.bpm * hero.settings.tempoScale * 4.6) / 60,
  );
  const progress = Math.min(100, (hero.positionBeat / song.durationBeats) * 100);
  const loopStart = Math.min(100, (hero.loop.startBeat / song.durationBeats) * 100);
  const loopEnd = Math.min(100, (hero.loop.endBeat / song.durationBeats) * 100);
  const activeTrainingCleanRuns =
    activeTrainingLesson && activeTrainingSection
      ? (trainingProgress[activeTrainingLesson.id]?.[
          activeTrainingSection.id
        ] ?? 0)
      : 0;

  useEffect(() => {
    const currentFrame = {
      isPlaying: hero.isPlaying,
      misses: hero.score.misses,
      hits: hero.score.hits,
      accuracy: hero.score.accuracy,
      positionBeat: hero.positionBeat,
      sectionId: activeTrainingSection?.id ?? null,
      songId: song.id,
    };
    const previousFrame = previousTrainingFrameRef.current;
    previousTrainingFrameRef.current = currentFrame;

    if (
      !activeTrainingLesson ||
      !activeTrainingSection ||
      !hero.loop.enabled ||
      !hero.isPlaying ||
      !previousFrame?.isPlaying ||
      previousFrame.songId !== song.id ||
      previousFrame.sectionId !== activeTrainingSection.id
    ) {
      return;
    }

    const wrapped =
      previousFrame.positionBeat > hero.positionBeat &&
      previousFrame.positionBeat >= hero.loop.endBeat - 0.35 &&
      hero.positionBeat <= hero.loop.startBeat + 0.35;
    if (!wrapped || hero.settings.practiceMode === "listen") return;

    const sectionNoteCount = getNotesInSection(
      song,
      activeTrainingSection,
    ).length;
    const clean =
      previousFrame.hits >= sectionNoteCount &&
      previousFrame.misses === 0 &&
      previousFrame.accuracy >=
        song.pedagogy.mastery.accuracyPercent;
    if (!clean) return;

    setTrainingProgress((current) => {
      const lessonProgress = current[activeTrainingLesson.id] ?? {};
      const existing = lessonProgress[activeTrainingSection.id] ?? 0;
      const nextRuns = Math.min(
        song.pedagogy.mastery.cleanRuns,
        existing + 1,
      );
      if (nextRuns === existing) return current;
      return {
        ...current,
        [activeTrainingLesson.id]: {
          ...lessonProgress,
          [activeTrainingSection.id]: nextRuns,
        },
      };
    });
  }, [
    activeTrainingLesson,
    activeTrainingSection,
    hero.isPlaying,
    hero.loop.enabled,
    hero.loop.endBeat,
    hero.loop.startBeat,
    hero.positionBeat,
    hero.score.accuracy,
    hero.score.hits,
    hero.score.misses,
    hero.settings.practiceMode,
    song,
  ]);
  const latestFeedbackGroup = useMemo(() => {
    const latestGroupId = hero.latestFeedback?.groupId;
    if (!latestGroupId) return [];
    return hero.feedbackEvents.filter(
      (event) => event.groupId === latestGroupId,
    );
  }, [hero.feedbackEvents, hero.latestFeedback?.groupId]);
  const hudFeedback =
    latestFeedbackGroup.find((event) => event.powerActivation) ??
    hero.latestFeedback;
  const latestSustainFeedbackGroup = useMemo(() => {
    const latestGroupId = hero.latestSustainFeedback?.groupId;
    if (!latestGroupId) return [];
    return hero.sustainFeedbackEvents.filter(
      (event) => event.groupId === latestGroupId,
    );
  }, [hero.latestSustainFeedback?.groupId, hero.sustainFeedbackEvents]);
  const sustainFeedbackIsLatest =
    (hero.latestSustainFeedback?.sequence ?? -1) >
    (hero.latestFeedback?.sequence ?? -1);
  const hudSustainFeedback = sustainFeedbackIsLatest
    ? (hero.latestSustainFeedback ?? null)
    : null;
  const celebration = hudSustainFeedback
    ? sustainCelebration(hudSustainFeedback)
    : performanceCelebration(hudFeedback, hero.score.combo);
  const recentMissFeedback = useMemo(
    () =>
      hero.feedbackEvents
        .filter((event) => event.grade === "miss")
        .slice(-4),
    [hero.feedbackEvents],
  );
  const noteMissIsLatest =
    !hudSustainFeedback && hudFeedback?.grade === "miss";
  const feedbackKey = hudSustainFeedback
    ? `${hudSustainFeedback.groupId}-${latestSustainFeedbackGroup.length}-${hudSustainFeedback.sequence}`
    : hudFeedback
      ? `${hudFeedback.groupId}-${latestFeedbackGroup.length}-${hero.score.hits}-${hero.score.misses}`
      : "ready";
  const scoreDelta = hudSustainFeedback
    ? latestSustainFeedbackGroup.reduce(
        (total, event) => total + event.pointsAwarded,
        0,
      )
    : latestFeedbackGroup.length
      ? latestFeedbackGroup.reduce(
          (total, event) => total + event.pointsAwarded,
          0,
        )
      : (hero.latestFeedback?.pointsAwarded ?? 0);
  const streakTier =
    hero.score.combo >= 25
      ? "rockstar"
      : hero.score.combo >= 15
        ? "fire"
        : hero.score.combo >= 8
          ? "locked"
          : hero.score.combo >= 4
            ? "building"
            : "base";
  const powerChargePercent = Math.round(hero.power.charge * 100);
  const powerRemainingPercent = Math.round(
    (hero.power.remainingBeats / Math.max(0.001, hero.power.durationBeats)) *
      100,
  );
  const powerMeterPercent = hero.power.active
    ? powerRemainingPercent
    : powerChargePercent;
  const powerMeterValueText = hero.power.active
    ? `Power Mode active, ${hero.power.remainingBeats.toFixed(1)} beats remaining at ${hero.power.multiplier} times score`
    : `${powerChargePercent} percent charged from correct notes`;
  const hasMIDIActivity =
    hero.midi.connectedName !== null &&
    typeof hero.midi.lastNote === "number" &&
    typeof hero.midi.lastMappedNote === "number" &&
    hero.midi.lastMessageInRange !== null;
  const activeMIDIChannel = hero.midi.detectedChannel ?? hero.midi.channel;
  const midiMappingActive =
    hero.midi.calibration.calibrated &&
    hero.midi.calibration.transpose !== 0;
  const showMutedPlayerPianoCue =
    !hero.settings.synthEnabled &&
    (hero.pressedNotes.size > 0 || hero.midi.lastNote !== null);
  const midiCalibrationPrompt =
    hero.midi.calibration.phase === "release-left"
      ? {
          title: "Release the leftmost key.",
          detail: "Then the rightmost-key step will light up.",
          short: "release the leftmost key",
        }
      : hero.midi.calibration.phase === "right"
        ? {
            title: "Now press the physical rightmost key.",
            detail: "Use the highest white key on the 25-key keyboard.",
            short: "press the physical rightmost key",
          }
        : hero.midi.calibration.phase === "release-right"
          ? {
              title: "Release the rightmost key to finish.",
              detail: "Keyboard Hero is checking the full 25-key span.",
              short: "release the rightmost key",
            }
          : {
              title: "Press the physical leftmost key.",
              detail: "Use the lowest white key, then release it.",
              short: "press the physical leftmost key",
            };
  const midiLiveNote = hasMIDIActivity
    ? midiMappingActive
      ? `${midiToNoteName(hero.midi.lastMappedNote!)} mapped from raw ${midiToNoteName(hero.midi.lastNote!)}`
      : midiToNoteName(hero.midi.lastMappedNote!)
    : null;
  const midiDeviceHint = !hero.midi.connectedName
    ? "Z–M / Q–I maps C3–C5"
    : hero.midi.calibration.active
      ? `Alignment listening · ${midiCalibrationPrompt.short}`
    : !hasMIDIActivity
      ? hero.midi.calibration.calibrated &&
        hero.midi.calibration.rawNote !== null
        ? `Aligned ${midiToNoteName(hero.midi.calibration.rawNote)} → C3 · play a key`
        : "Performance port connected · play a C3–C5 key"
      : hero.midi.lastMessageInRange
        ? `${midiLiveNote} · ${
            activeMIDIChannel === null
              ? "Channel detecting"
              : `Channel ${activeMIDIChannel + 1}`
          } · signal received`
        : `${midiLiveNote} outside C3–C5 · align the keyboard`;
  const midiChannelSupport =
    hero.midi.channel !== null
      ? `Listening on channel ${hero.midi.channel + 1}`
      : hero.midi.detectedChannel !== null
        ? `Auto detected channel ${hero.midi.detectedChannel + 1}`
        : hero.midi.connectedName
          ? "Auto detects from your first C3–C5 key"
          : "Auto detects after a MIDI input connects";
  const midiTransposeLabel =
    hero.midi.calibration.transpose === 0
      ? "No transposition needed"
      : `${hero.midi.calibration.transpose > 0 ? "+" : ""}${hero.midi.calibration.transpose} semitone${
          Math.abs(hero.midi.calibration.transpose) === 1 ? "" : "s"
        }`;
  const backingBandStatus = !hero.settings.backingBandEnabled
    ? "Band off"
    : hero.backingBand.isJamming && hero.backingBand.active
      ? "Band jamming"
      : hero.backingBand.isJamming
        ? "Band starting"
        : hero.backingBand.active
          ? "Band live"
          : "Band ready";
  const backingBandEnergy = Math.round(
    Math.max(0, Math.min(1, hero.backingBand.energy)) * 100,
  );
  const backingBandIntensityLabel =
    hero.settings.backingBandIntensity >= 0.8
      ? "Full send"
      : hero.settings.backingBandIntensity >= 0.55
        ? "Big groove"
        : "Laid back";
  const backingBandMeter = [0.62, 0.92, 0.74, 1, 0.68].map(
    (shape) =>
      `${Math.max(12, Math.round(backingBandEnergy * shape))}%`,
  );

  const stageNotes = useMemo<KeyboardStageNote[]>(
    () =>
      song.notes.map((note) => {
        const result = hero.noteResults.get(note.id);
        const heldNote = hero.heldNotes.get(note.id);
        const fingering = songFingering.byNoteId.get(note.id);
        const hasAuthoredFingering =
          fingering?.handIsAuthored && fingering.fingerIsAuthored;
        return {
          id: note.id,
          midi: note.midi,
          startBeat: note.startBeat,
          durationBeats: note.durationBeats,
          velocity: (note.velocity ?? 94) / 127,
          hand: hasAuthoredFingering ? fingering.hand : undefined,
          finger: hasAuthoredFingering ? fingering.finger : undefined,
          state: heldNote
            ? "active"
            : result
              ? result.grade === "miss"
                ? "missed"
                : "hit"
              : "upcoming",
          holdProgress: heldNote?.progress,
        };
      }),
    [hero.heldNotes, hero.noteResults, song, songFingering],
  );

  const stageFeedback = useMemo<readonly KeyboardHitFeedback[]>(
    () =>
      [
        ...hero.feedbackEvents.map((event) => ({
          sequence: event.sequence,
          feedback: {
            id: event.id,
            midi: event.midi,
            kind: event.grade,
            strength: Math.max(0.45, 1 - Math.abs(event.offsetMs) / 280),
            powerActivation: event.powerActivation,
          } satisfies KeyboardHitFeedback,
        })),
        ...hero.sustainFeedbackEvents.map((event) => ({
          sequence: event.sequence,
          feedback: {
            id: event.id,
            midi: event.midi,
            kind:
              event.grade === "full"
                ? "perfect"
                : event.grade === "partial"
                  ? "good"
                  : "miss",
            strength:
              event.grade === "full"
                ? 1.35
                : event.grade === "partial"
                  ? 0.82
                  : 0.68,
          } satisfies KeyboardHitFeedback,
        })),
      ]
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ feedback }) => feedback),
    [hero.feedbackEvents, hero.sustainFeedbackEvents],
  );

  const prepareTrainingSection = useCallback(
    (
      section: SongSection,
      mode: "flow" | "wait" | "listen",
      startPlaying: boolean,
    ) => {
      pauseForLibrary();
      setLoopForTraining(section.startBeat, section.endBeat, true);
      seekFromKey(section.startBeat);
      setTempoForTraining((section.recommendedTempoPercent ?? 45) / 100);
      setBackingBandForTraining(false);
      setModeForTraining(mode);
      if (startPlaying && mode !== "listen") playFromMIDI();
    },
    [
      pauseForLibrary,
      playFromMIDI,
      seekFromKey,
      setBackingBandForTraining,
      setLoopForTraining,
      setModeForTraining,
      setTempoForTraining,
    ],
  );

  const startTrainingLesson = useCallback(
    (lesson: TrainingLesson) => {
      pauseForLibrary();
      if (!activeTrainingLesson) {
        lastRegularSongIdRef.current = song.id;
        trainingReturnBackingBandRef.current =
          backingBandEnabledForTraining;
      }
      setTrainingSectionId(lesson.defaultSectionId);
      setPendingTrainingSetup({
        songId: lesson.song.id,
        sectionId: lesson.defaultSectionId,
      });
      setSongId(lesson.song.id);
      setTrainingOpen(false);
      setLibraryOpen(false);
    },
    [
      activeTrainingLesson,
      backingBandEnabledForTraining,
      pauseForLibrary,
      song.id,
    ],
  );

  const returnToSongs = useCallback(() => {
    pauseForLibrary();
    setBackingBandForTraining(trainingReturnBackingBandRef.current);
    setSongId(lastRegularSongIdRef.current);
    setTrainingSectionId(null);
    setPendingTrainingSetup(null);
  }, [pauseForLibrary, setBackingBandForTraining]);

  const selectSong = useCallback(
    (nextSong: Song) => {
      pauseForLibrary();
      if (activeTrainingLesson) {
        setBackingBandForTraining(trainingReturnBackingBandRef.current);
      }
      lastRegularSongIdRef.current = nextSong.id;
      setSongId(nextSong.id);
      setTrainingSectionId(null);
      setPendingTrainingSetup(null);
      setLibraryOpen(false);
    },
    [activeTrainingLesson, pauseForLibrary, setBackingBandForTraining],
  );

  const selectTrainingSection = useCallback(
    (section: SongSection) => {
      setTrainingSectionId(section.id);
      prepareTrainingSection(section, "wait", false);
    },
    [prepareTrainingSection],
  );

  const selectSection = useCallback(
    (section: SongSection) => {
      if (activeTrainingLesson) {
        selectTrainingSection(section);
        return;
      }
      if (section.recommendedTempoPercent) {
        setTempoForTraining(section.recommendedTempoPercent / 100);
      }
      setLoopForTraining(section.startBeat, section.endBeat, true);
      seekFromKey(section.startBeat);
    },
    [
      activeTrainingLesson,
      seekFromKey,
      selectTrainingSection,
      setLoopForTraining,
      setTempoForTraining,
    ],
  );

  useEffect(() => {
    if (!pendingTrainingSetup || song.id !== pendingTrainingSetup.songId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const lesson = getTrainingLessonBySongId(pendingTrainingSetup.songId);
      if (lesson) {
        const section = getTrainingSection(
          lesson,
          pendingTrainingSetup.sectionId,
        );
        prepareTrainingSection(section, lesson.defaultMode, false);
      }
      setPendingTrainingSetup(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingTrainingSetup, prepareTrainingSection, song.id]);

  const seekFromTimeline = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const nextBeat = Number(input.value);
    hero.seekBeat(nextBeat);
  };

  const replaySong = useCallback(() => {
    restartFromMIDI();
    playFromMIDI();
  }, [playFromMIDI, restartFromMIDI]);

  const closeActiveOverlay = useCallback(() => {
    if (trainingOpen) closeTraining();
    else closeLibrary();
  }, [closeLibrary, closeTraining, trainingOpen]);

  const midiTransportEvent = hero.midi.lastTransportEvent;
  useEffect(() => {
    if (
      !midiTransportEvent ||
      midiTransportEvent.sequence <= handledMIDITransportSequenceRef.current
    ) {
      return;
    }
    handledMIDITransportSequenceRef.current = midiTransportEvent.sequence;

    const intent = resolveMIDITransportIntent(midiTransportEvent.action, {
      songComplete,
      overlayOpen: libraryOpen || trainingOpen,
    });
    if (intent === "replay") replaySong();
    else if (intent === "toggle-play") togglePlayFromKey();
    else if (intent === "back-to-practice") restartFromMIDI();
    else if (intent === "close-overlay") queueMicrotask(closeActiveOverlay);
  }, [
    closeActiveOverlay,
    libraryOpen,
    midiTransportEvent,
    replaySong,
    restartFromMIDI,
    songComplete,
    togglePlayFromKey,
    trainingOpen,
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <span className="brand-name">KEYBOARD HERO</span>
            <span className="brand-sub">Learn the notes. Feel the stage.</span>
          </div>
        </div>

        <div className="song-selector">
          <div className="song-selector-copy">
            <div className="song-selector-label">
              {activeTrainingLesson ? "Training room" : "Now learning"}
            </div>
            <div className="song-selector-title">{song.title}</div>
            <div className="song-selector-meta">
              {song.level} · {song.key} · {song.timeSignature[0]}/{song.timeSignature[1]}
            </div>
          </div>
          <button className="library-button" onClick={openLibrary}>
            {activeTrainingLesson ? "Songs" : "Library"}{" "}
            <ChevronDown size={11} aria-hidden="true" />
          </button>
        </div>

        <div className="device-status">
          <span className={`status-light${hero.midi.connectedName ? " online" : ""}`} />
          <div className="device-copy">
            <span className="device-name">
              {hero.midi.connectedName ?? "Computer keys ready"}
            </span>
            <span
              aria-atomic="true"
              aria-live="polite"
              className={`device-hint${
                hasMIDIActivity && hero.midi.lastMessageInRange === false
                  ? " octave-warning"
                  : hasMIDIActivity
                    ? " signal-received"
                    : ""
              }`}
            >
              {midiDeviceHint}
            </span>
          </div>
          <button
            className="connect-button"
            disabled={hero.midi.permission === "prompt"}
            onClick={hero.connectMIDI}
          >
            <Usb size={13} aria-hidden="true" />
            <span>
              {hero.midi.connectedName
                ? "Reconnect MIDI"
                : hero.midi.permission === "prompt"
                  ? "Connecting…"
                  : "Connect MIDI"}
            </span>
          </button>
        </div>
      </header>

      <div className="main-grid">
        <section className="play-column" aria-label="Keyboard Hero stage">
          <div
            className={`stage-wrap${
              hero.countdown !== null && hero.countdown > 0
                ? " is-counting-in"
                : ""
            }${isFinishing ? " is-finishing" : ""}${
              hero.power.active ? " is-power-mode" : ""
            }`}
          >
            <KeyboardStage
              ariaLabel="Three-dimensional 25-key practice keyboard and falling note highway"
              currentBeat={hero.visualBeat}
              currentTime={hero.positionSeconds}
              feedback={stageFeedback}
              fingeringHands={fingeringHands}
              fingeringRange={fingeringRange}
              intensity={Math.min(
                2,
                0.85 + hero.score.combo / 28 + hero.power.energy * 0.22,
              )}
              notes={stageNotes}
              onKeyDown={(midi, velocity) => hero.noteOn(midi, velocity, "stage")}
              onKeyUp={(midi) => hero.noteOff(midi, "stage")}
              pressedMidiNotes={hero.pressedNotes}
              power={hero.power}
              showHud={false}
              theme="electric"
              travelBeats={noteApproachBeats}
            />

            <div className="stage-head">
              <div className="lesson-tag">
                {activeSection?.label ?? "Full song"} · {activeSection?.focus ?? song.skills[0]}
              </div>
              <div className="stage-metrics">
                <div className="stage-metric">
                  <strong>{Math.round(song.bpm * hero.settings.tempoScale)}</strong>
                  <span>Live BPM</span>
                </div>
              </div>
            </div>

            <section
              className={`performance-hud tier-${streakTier}${
                hero.power.active ? " is-power-mode" : ""
              }${hero.quickLoopEnabled ? " is-quick-loop" : ""}`}
              aria-label={
                hero.quickLoopEnabled
                  ? "Quick loop practice. Scoring is paused and the song restarts automatically."
                  : `Live performance: ${hero.score.points} points, ${hero.score.combo} note streak, ${hero.score.accuracy.toFixed(0)} percent accuracy. ${powerMeterValueText}.`
              }
            >
              <div className="performance-card performance-score">
                <span className="performance-label">
                  {hero.quickLoopEnabled ? "Quick loop" : "Stage score"}
                </span>
                <div className="score-readout">
                  <strong
                    className="score-value"
                    key={
                      hero.quickLoopEnabled
                        ? "quick-loop-practice"
                        : `score-${hero.score.points}`
                    }
                  >
                    {hero.quickLoopEnabled
                      ? "PRACTICE"
                      : hero.score.points.toLocaleString()}
                  </strong>
                  {!hero.quickLoopEnabled && scoreDelta > 0 && (
                    <span className="score-delta" key={`delta-${feedbackKey}`}>
                      +{scoreDelta.toLocaleString()}
                    </span>
                  )}
                </div>
                <span className="performance-subline">
                  {hero.quickLoopEnabled ? (
                    "No score // auto restart"
                  ) : (
                    <>
                      {hero.score.hits} notes landed
                      {hero.score.sustainPoints > 0 &&
                        ` // +${hero.score.sustainPoints.toLocaleString()} sustain`}
                    </>
                  )}
                </span>
              </div>

              <div
                className={`power-meter${
                  hero.power.active ? " is-active" : ""
                }`}
                data-activation={hero.power.activations}
              >
                <div className="power-meter-head">
                  <span>
                    {hero.quickLoopEnabled
                      ? "Scoring paused"
                      : hero.power.active
                        ? "Power Mode"
                        : "Combo energy"}
                  </span>
                  <strong>
                    {hero.quickLoopEnabled
                      ? "LOOPING"
                      : hero.power.active
                      ? `${hero.power.multiplier}× score`
                      : `${powerChargePercent}%`}
                  </strong>
                </div>
                <span
                  aria-label="Power Mode meter"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={Math.max(0, Math.min(100, powerMeterPercent))}
                  aria-valuetext={powerMeterValueText}
                  className="power-meter-track"
                  role="progressbar"
                >
                  <i style={{ width: `${powerMeterPercent}%` }} />
                  <b aria-hidden="true" />
                </span>
                <div className="power-meter-foot">
                  <span>
                    {hero.quickLoopEnabled
                      ? "Full song restarts automatically"
                      : hero.power.active
                      ? "You earned the spotlight — stay clean"
                      : "Correct hits fill the meter"}
                  </span>
                  <strong
                    aria-label={
                      hero.power.active
                        ? `${hero.power.remainingBeats.toFixed(1)} beats remaining`
                        : `${hero.score.combo} hit streak`
                    }
                    role={hero.power.active ? "timer" : undefined}
                  >
                    {hero.quickLoopEnabled
                      ? "No score"
                      : hero.power.active
                      ? `${hero.power.remainingBeats.toFixed(1)} beats`
                      : `${hero.score.combo}× streak`}
                  </strong>
                </div>
              </div>

              <div className="performance-card performance-streak">
                <div className="streak-stat">
                  <span className="performance-label">Live streak</span>
                  <strong className="combo-value" key={`combo-${hero.score.combo}`}>
                    {hero.score.combo}<small>×</small>
                  </strong>
                  <span className="performance-subline">
                    Best {hero.score.bestCombo}×
                  </span>
                </div>
                <div className="accuracy-stat">
                  <span className="performance-label">Accuracy</span>
                  <strong>{hero.score.accuracy.toFixed(0)}%</strong>
                  <span
                    className="accuracy-meter"
                    role="progressbar"
                    aria-label="Performance accuracy"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(hero.score.accuracy)}
                  >
                    <i style={{ width: `${Math.min(100, hero.score.accuracy)}%` }} />
                  </span>
                </div>
              </div>
            </section>

            {hero.power.active && (
              <p
                className="sr-only"
                key={`power-${hero.power.activations}`}
                role="status"
                aria-live="assertive"
              >
                Power Mode activated. Double score for {hero.power.durationBeats}
                beats. Keep the streak alive.
              </p>
            )}

            {celebration &&
              !noteMissIsLatest &&
              !songComplete &&
              (hero.countdown === null || hero.countdown <= 0) && (
                <div
                  aria-hidden="true"
                  className={`stage-encouragement tone-${celebration.tone} variant-${celebration.variant}`}
                  key={feedbackKey}
                >
                  <span className="encouragement-kicker">{celebration.eyebrow}</span>
                  <strong>{celebration.headline}</strong>
                  <span className="encouragement-detail">{celebration.detail}</span>
                  {scoreDelta > 0 && (
                    <b className="encouragement-points">+{scoreDelta.toLocaleString()}</b>
                  )}
                </div>
              )}

            {!songComplete &&
              recentMissFeedback.length > 0 &&
              (hero.countdown === null || hero.countdown <= 0) && (
                <div className="performance-miss-toasts" aria-hidden="true">
                  {recentMissFeedback.map((event) => (
                    <div className="performance-miss-toast" key={event.id}>
                      <strong>Miss</strong>
                      <span>Reset // next note</span>
                    </div>
                  ))}
                </div>
              )}

            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {celebration
                ? hero.quickLoopEnabled
                  ? `${celebration.headline} ${celebration.detail} Quick loop practice; scoring is paused.`
                  : `${celebration.headline} ${celebration.detail} Score ${hero.score.points}. Streak ${hero.score.combo}. Accuracy ${hero.score.accuracy.toFixed(0)} percent.`
                : "Stage ready."}
            </p>

            {isFinishing && !songComplete && (
              <div className="finale-status" role="status" aria-live="polite">
                <span>Final chord</span>
                <strong>Let it ring...</strong>
              </div>
            )}

            {hero.countdown !== null && hero.countdown > 0 && (
              <div className="count-in" aria-live="assertive">
                <span className="count-in-kicker">Get ready</span>
                <strong key={hero.countdown}>{hero.countdown}</strong>
                <span className="count-in-cue">First note hits the bright bar at zero</span>
              </div>
            )}

          </div>

          <div className="transport">
            <div className="timeline-row">
              <span className="timecode">{formatTime(hero.positionSeconds)}</span>
              <div className="timeline">
                <div className="timeline-track" />
                <div className="timeline-progress" style={{ width: `${progress}%` }} />
                {(hero.loop.enabled || hero.quickLoopEnabled) && (
                  <div
                    className={`timeline-loop${hero.quickLoopEnabled ? " is-quick-loop" : ""}`}
                    style={
                      hero.quickLoopEnabled
                        ? { left: "0%", width: "100%" }
                        : {
                            left: `${loopStart}%`,
                            width: `${Math.max(0, loopEnd - loopStart)}%`,
                          }
                    }
                  />
                )}
                <input
                  aria-label="Song position"
                  className="timeline-input"
                  max={song.durationBeats}
                  min={0}
                  onChange={seekFromTimeline}
                  step={0.05}
                  type="range"
                  value={Math.min(song.durationBeats, hero.positionBeat)}
                />
              </div>
              <span className="timecode">{formatTime(totalSeconds)}</span>
            </div>

            <div className="section-labels" aria-label="Practice sections">
              {song.sections.map((section) => (
                <button
                  className={`section-pill${section.id === activeSection?.id ? " active" : ""}`}
                  key={section.id}
                  onClick={() => selectSection(section)}
                  style={{ flexGrow: section.endBeat - section.startBeat }}
                  title={`${section.label}: ${section.focus ?? "practice loop"}`}
                >
                  {section.label}
                </button>
              ))}
            </div>

            <div className="transport-controls">
              <div className="transport-cluster">
                <button className="icon-button" aria-label="Restart song" onClick={hero.restart}>
                  <RotateCcw size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Rewind four beats"
                  onClick={() => hero.rewindBeats(4)}
                >
                  <Rewind size={16} />
                </button>
                <div className="control-caption">
                  Section
                  <strong>{activeSection?.label ?? "Full song"}</strong>
                </div>
              </div>

              <button
                className="play-button"
                aria-label={hero.isPlaying ? "Pause" : "Play"}
                onClick={hero.togglePlay}
              >
                {hero.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>

              <div className="transport-cluster end">
                <div className="speed-control">
                  <div className="control-caption">
                    Tempo
                    <strong>{Math.round(hero.settings.tempoScale * 100)}%</strong>
                  </div>
                  <input
                    aria-label="Practice tempo"
                    max={1.25}
                    min={0.25}
                    onChange={(event) => hero.setTempoScale(Number(event.target.value))}
                    step={0.05}
                    type="range"
                    value={hero.settings.tempoScale}
                  />
                </div>
                <button
                  aria-label="Set loop start here"
                  className="icon-button ab-button"
                  onClick={() =>
                    hero.setLoop(
                      hero.positionBeat,
                      Math.max(hero.positionBeat + 0.25, hero.loop.endBeat),
                      true,
                    )
                  }
                  title="Set loop point A"
                >
                  A
                </button>
                <button
                  aria-label="Set loop end here"
                  className="icon-button ab-button"
                  onClick={() =>
                    hero.setLoop(
                      Math.min(hero.loop.startBeat, Math.max(0, hero.positionBeat - 0.25)),
                      Math.max(0.25, hero.positionBeat),
                      true,
                    )
                  }
                  title="Set loop point B"
                >
                  B
                </button>
                <button
                  aria-label="Toggle practice loop"
                  className={`icon-button${hero.loop.enabled ? " active" : ""}`}
                  onClick={hero.toggleLoop}
                  title="Loop the selected A/B section"
                >
                  <Repeat2 size={16} />
                </button>
                <button
                  aria-label={
                    hero.quickLoopEnabled
                      ? "Turn off quick loop"
                      : "Turn on quick loop without scoring"
                  }
                  aria-pressed={hero.quickLoopEnabled}
                  className={`icon-button quick-loop-button${
                    hero.quickLoopEnabled ? " active" : ""
                  }`}
                  onClick={hero.toggleQuickLoop}
                  title="Quick loop: restart the full song with no score"
                >
                  <Repeat2 size={16} />
                  <span aria-hidden="true">∞</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside
          className={`coach-panel${activeTrainingLesson ? " is-training" : ""}`}
          aria-label={activeTrainingLesson ? "Guided piano training coach" : "Piano coach"}
        >
          {activeTrainingLesson && activeTrainingSection ? (
            <TrainingCoach
              cleanRuns={activeTrainingCleanRuns}
              isPlaying={hero.isPlaying}
              lesson={activeTrainingLesson}
              mode={hero.settings.practiceMode}
              nextLanding={nextTrainingLanding}
              noteResults={hero.noteResults}
              onExit={returnToSongs}
              onHear={() =>
                prepareTrainingSection(activeTrainingSection, "listen", true)
              }
              onNavigateLesson={startTrainingLesson}
              onOpenRoadmap={openTraining}
              onPractice={() =>
                prepareTrainingSection(activeTrainingSection, "wait", true)
              }
              onSelectSection={selectTrainingSection}
              onTest={() =>
                prepareTrainingSection(activeTrainingSection, "flow", true)
              }
              pressedNotes={hero.pressedNotes}
              section={activeTrainingSection}
              tempoPercent={Math.round(hero.settings.tempoScale * 100)}
            />
          ) : (
            <>
              <TrainingLauncher onOpen={openTraining} />
              <section className="coach-section">
            <div className="section-kicker">
              Practice mode <strong>Live coach</strong>
            </div>
            <div className="mode-switch">
              {(["flow", "wait", "listen"] as const).map((mode) => (
                <button
                  className={`mode-option${hero.settings.practiceMode === mode ? " active" : ""}`}
                  key={mode}
                  onClick={() => hero.setPracticeMode(mode)}
                >
                  {mode === "flow" ? "Flow" : mode === "wait" ? "Wait" : "Listen"}
                </button>
              ))}
            </div>
            <div className={`coach-callout ${coach.tone}`}>
              <div className="coach-callout-title">{coach.title}</div>
              <p>{coach.body}</p>
            </div>
          </section>

          <section className="coach-section grow">
            <div className="section-kicker">
              Next move <strong>{Math.max(0, nextLandingBeat - hero.positionBeat).toFixed(1)} beats</strong>
            </div>
            <div className="next-note">
              <div
                aria-label={`${nextFingeringLanding.length} notes in the next landing`}
                className="note-orb"
              >
                {nextFingeringLanding.length > 1
                  ? `${nextFingeringLanding.length}×`
                  : nextFingeringLanding[0]
                    ? midiToNoteName(nextFingeringLanding[0].note.midi)
                    : "—"}
              </div>
              <div className="next-note-copy">
                <strong>Suggested fingering</strong>
                <span>MIDI checks notes and timing, not which fingers you use.</span>
                <div
                  aria-label="Suggested fingering for the next notes"
                  className="next-landing-list"
                  role="list"
                >
                  {nextFingeringLanding.map(({ note, recommendation }) => {
                    const hasAuthoredFingering = Boolean(
                      recommendation?.handIsAuthored &&
                        recommendation.fingerIsAuthored,
                    );
                    return (
                      <div className="next-landing-chip" key={note.id} role="listitem">
                        <b>{midiToNoteName(note.midi)}</b>
                        <small>
                          {hasAuthoredFingering && recommendation
                            ? `${recommendation.hand === "left" ? "L" : "R"}${recommendation.finger}`
                            : "No suggestion"}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="score-grid">
              <div className="score-cell">
                <strong>{hero.score.hits}</strong>
                <span>Notes landed</span>
              </div>
              <div className="score-cell">
                <strong>{hero.score.bestCombo}</strong>
                <span>Best streak</span>
              </div>
              <div className="score-cell">
                <strong>{hero.score.misses}</strong>
                <span>To revisit</span>
              </div>
              <div className="score-cell">
                <strong>{Math.round(Math.abs(hero.latestFeedback?.offsetMs ?? 0))}ms</strong>
                <span>Last offset</span>
              </div>
            </div>
          </section>
            </>
          )}

          <section
            aria-labelledby="backing-band-heading"
            className="coach-section backing-band-section"
          >
            <div className="section-kicker">
              <span id="backing-band-heading">Backing band</span>
              <strong
                aria-atomic="true"
                aria-live="polite"
                className={`band-status${
                  hero.backingBand.active
                    ? " is-live"
                    : hero.settings.backingBandEnabled
                      ? " is-ready"
                      : " is-off"
                }`}
              >
                {backingBandStatus}
              </strong>
            </div>

            <div
              className={`band-console${
                hero.settings.backingBandEnabled ? " is-enabled" : ""
              }${hero.backingBand.active ? " is-active" : ""}`}
            >
              <div className="band-console-head">
                <div className="band-identity">
                  <span className="band-icon" aria-hidden="true">
                    <AudioLines size={17} />
                  </span>
                  <div>
                    <strong>Your band</strong>
                    <span>Drums · bass · rhythm</span>
                  </div>
                </div>
                <div className="band-actions">
                  <button
                    aria-label={
                      hero.backingBand.isJamming ? "Pause band" : "Play band"
                    }
                    aria-pressed={hero.backingBand.isJamming}
                    className={`band-jam-button${
                      hero.backingBand.isJamming ? " is-playing" : ""
                    }`}
                    onClick={hero.toggleBackingBandPlayback}
                    type="button"
                  >
                    {hero.backingBand.isJamming ? (
                      <Pause aria-hidden="true" size={12} fill="currentColor" />
                    ) : (
                      <Play aria-hidden="true" size={12} fill="currentColor" />
                    )}
                    {hero.backingBand.isJamming ? "Pause" : "Play"}
                  </button>
                  <button
                    aria-label={`${
                      hero.settings.backingBandEnabled ? "Turn off" : "Turn on"
                    } backing band`}
                    aria-pressed={hero.settings.backingBandEnabled}
                    className={`band-power${
                      hero.settings.backingBandEnabled ? " on" : ""
                    }`}
                    onClick={() =>
                      hero.setBackingBandEnabled(
                        !hero.settings.backingBandEnabled,
                      )
                    }
                    type="button"
                  >
                    <span aria-hidden="true" className="band-power-light" />
                    {hero.settings.backingBandEnabled ? "On" : "Off"}
                  </button>
                </div>
              </div>

              <div
                aria-label={
                  hero.settings.backingBandEnabled
                    ? `Backing band energy ${backingBandEnergy} percent`
                    : "Backing band is off"
                }
                className="band-energy"
                role="img"
              >
                <div aria-hidden="true" className="band-energy-bars">
                  {backingBandMeter.map((height, index) => (
                    <span key={index} style={{ height }} />
                  ))}
                </div>
                <div className="band-energy-copy" aria-hidden="true">
                  <strong>{hero.backingBand.active ? backingBandEnergy : 0}%</strong>
                  <span>
                    {hero.backingBand.isJamming
                      ? "Free-play groove"
                      : hero.backingBand.active
                        ? "Stage energy"
                        : "On standby"}
                  </span>
                </div>
              </div>

              <div className="band-control-grid">
                <div className="band-control">
                  <div className="band-control-heading">
                    <label htmlFor="backing-band-mix">
                      <SlidersHorizontal size={11} aria-hidden="true" /> Band mix
                    </label>
                    <output htmlFor="backing-band-mix">
                      {Math.round(hero.settings.backingBandMix * 100)}%
                    </output>
                  </div>
                  <input
                    aria-label="Backing band volume"
                    aria-valuetext={`${Math.round(hero.settings.backingBandMix * 100)} percent`}
                    className="band-range"
                    disabled={!hero.settings.backingBandEnabled}
                    id="backing-band-mix"
                    max={1}
                    min={0}
                    onChange={(event) =>
                      hero.setBackingBandMix(Number(event.target.value))
                    }
                    step={0.05}
                    type="range"
                    value={hero.settings.backingBandMix}
                  />
                </div>
                <div className="band-control">
                  <div className="band-control-heading">
                    <label htmlFor="backing-band-intensity">
                      <Zap size={11} aria-hidden="true" /> Intensity
                    </label>
                    <output htmlFor="backing-band-intensity">
                      {backingBandIntensityLabel}
                    </output>
                  </div>
                  <input
                    aria-label="Backing band intensity"
                    aria-valuetext={backingBandIntensityLabel}
                    className="band-range band-intensity-range"
                    disabled={!hero.settings.backingBandEnabled}
                    id="backing-band-intensity"
                    max={1}
                    min={0}
                    onChange={(event) =>
                      hero.setBackingBandIntensity(Number(event.target.value))
                    }
                    step={0.05}
                    type="range"
                    value={hero.settings.backingBandIntensity}
                  />
                </div>
              </div>

              <p className="band-sync-note">
                Follows every tempo change, loop, rewind, and restart.
              </p>
            </div>
          </section>

          <section className="coach-section">
            <div className="section-kicker">Stage setup</div>
            <div className="setting-row">
              <span><Volume2 size={12} aria-hidden="true" /> Metronome</span>
              <button
                aria-label="Toggle metronome"
                aria-pressed={hero.settings.metronomeEnabled}
                className={`toggle${hero.settings.metronomeEnabled ? " on" : ""}`}
                onClick={() => hero.setMetronomeEnabled(!hero.settings.metronomeEnabled)}
              />
            </div>
            <div className="setting-row">
              <span>
                <Headphones size={12} aria-hidden="true" /> Player piano —{" "}
                {hero.settings.synthEnabled ? "On" : "Muted"}
              </span>
              <button
                aria-label={
                  hero.settings.synthEnabled
                    ? "Mute player piano"
                    : "Turn on player piano"
                }
                aria-pressed={hero.settings.synthEnabled}
                className={`toggle${hero.settings.synthEnabled ? " on" : ""}`}
                onClick={() => hero.setSynthEnabled(!hero.settings.synthEnabled)}
              />
            </div>
            {showMutedPlayerPianoCue && (
              <div className="setting-row">
                <span aria-live="polite" role="status">
                  Your keys are muted —
                </span>
                <button
                  aria-label="Turn on player piano"
                  className="midi-align-action"
                  onClick={() => hero.setSynthEnabled(true)}
                  type="button"
                >
                  Turn on
                </button>
              </div>
            )}
            <div className="setting-row">
              <label htmlFor="midi-input-select">
                <Usb size={12} aria-hidden="true" /> MIDI input
              </label>
              <select
                className="mini-select"
                disabled={!hero.midi.inputs.some((input) => input.connected)}
                id="midi-input-select"
                onChange={(event) => hero.selectMIDIInput(event.target.value || null)}
                value={hero.midi.selectedInputId ?? ""}
              >
                <option value="">Not connected</option>
                {hero.midi.inputs.map((input) => (
                  <option disabled={!input.connected} key={input.id} value={input.id}>
                    {input.name}
                    {input.connected ? "" : " — disconnected"}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-row midi-channel-row">
              <label htmlFor="midi-channel-select">
                <CircleGauge size={12} aria-hidden="true" /> MIDI channel
              </label>
              <div className="midi-channel-control">
                <select
                  aria-describedby="midi-channel-support"
                  className="mini-select midi-channel-select"
                  id="midi-channel-select"
                  onChange={(event) =>
                    hero.setMIDIChannel(
                      event.target.value === "auto"
                        ? null
                        : Number(event.target.value),
                    )
                  }
                  value={hero.midi.channel === null ? "auto" : hero.midi.channel}
                >
                  <option value="auto">Auto</option>
                  {Array.from({ length: 16 }, (_, channel) => (
                    <option key={channel} value={channel}>
                      {channel + 1}
                    </option>
                  ))}
                </select>
                <small
                  aria-live="polite"
                  className="midi-channel-support"
                  id="midi-channel-support"
                >
                  {midiChannelSupport}
                </small>
              </div>
            </div>
            <div
              aria-labelledby="midi-align-title"
              className={`midi-align-card${
                hero.midi.calibration.active ? " is-listening" : ""
              }${
                hero.midi.calibration.calibrated ? " is-calibrated" : ""
              }${hero.midi.calibration.error ? " has-error" : ""}`}
              role="group"
            >
              <div className="midi-align-head">
                <div className="midi-align-title">
                  <span className="midi-align-icon" aria-hidden="true">
                    <CircleGauge size={15} />
                  </span>
                  <div>
                    <strong id="midi-align-title">Align keyboard</strong>
                    <span>Fix an octave mismatch</span>
                  </div>
                </div>

                {hero.midi.calibration.active ? (
                  <button
                    className="midi-align-action quiet"
                    onClick={hero.cancelMIDICalibration}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    className="midi-align-action"
                    disabled={!hero.midi.connectedName}
                    onClick={hero.startMIDICalibration}
                    type="button"
                  >
                    {hero.midi.calibration.calibrated ? "Re-align" : "Align"}
                  </button>
                )}
              </div>

              <div
                aria-atomic="true"
                aria-live="polite"
                className="midi-align-body"
              >
                {hero.midi.calibration.active ? (
                  <div className="midi-align-listening">
                    {hero.midi.calibration.error && (
                      <div className="midi-align-error">
                        <div>
                          <strong>Try again</strong>
                          <span>{hero.midi.calibration.error}</span>
                        </div>
                        <button
                          className="midi-align-retry"
                          onClick={hero.startMIDICalibration}
                          type="button"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    <div className="midi-align-steps" aria-hidden="true">
                      <span
                        className={
                          hero.midi.calibration.rawNote !== null
                            ? "complete"
                            : "active"
                        }
                      >
                        1 <small>Left</small>
                      </span>
                      <i />
                      <span
                        className={
                          hero.midi.calibration.rightRawNote !== null
                            ? "complete"
                            : hero.midi.calibration.phase === "right" ||
                                hero.midi.calibration.phase === "release-right"
                              ? "active"
                              : ""
                        }
                      >
                        2 <small>Right</small>
                      </span>
                    </div>
                    <div className="midi-align-prompt" role="status">
                      <span className="midi-align-pulse" aria-hidden="true" />
                      <div>
                        <strong>{midiCalibrationPrompt.title}</strong>
                        <span>{midiCalibrationPrompt.detail}</span>
                      </div>
                    </div>
                  </div>
                ) : hero.midi.calibration.calibrated &&
                  hero.midi.calibration.rawNote !== null ? (
                  <div className="midi-align-success">
                    <div className="midi-align-endpoints">
                      <div
                        className="midi-align-map"
                        aria-label={`Raw ${midiToNoteName(hero.midi.calibration.rawNote)} maps to C3`}
                      >
                        <small>Left</small>
                        <span>{midiToNoteName(hero.midi.calibration.rawNote)}</span>
                        <span aria-hidden="true">→</span>
                        <strong>C3</strong>
                      </div>
                      {hero.midi.calibration.rightRawNote !== null && (
                        <div
                          className="midi-align-map"
                          aria-label={`Raw ${midiToNoteName(hero.midi.calibration.rightRawNote)} maps to C5`}
                        >
                          <small>Right</small>
                          <span>
                            {midiToNoteName(
                              hero.midi.calibration.rightRawNote,
                            )}
                          </span>
                          <span aria-hidden="true">→</span>
                          <strong>C5</strong>
                        </div>
                      )}
                    </div>
                    <div className="midi-align-result">
                      <span>✓ Aligned · {midiTransposeLabel}</span>
                      <button
                        aria-label="Reset keyboard alignment"
                        className="midi-align-reset"
                        onClick={hero.resetMIDICalibration}
                        type="button"
                      >
                        <RotateCcw size={10} aria-hidden="true" /> Reset
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>
                    {hero.midi.connectedName
                      ? "Use this when a physical key triggers the wrong on-screen note."
                      : "Connect MIDI first, then align the MPK Mini with its two end keys."}
                  </p>
                )}
              </div>
              {!hero.midi.calibration.active && (
                <p className="midi-align-footnote">
                  Saved automatically for this MIDI input. Re-align after MPK Octave, KTrans, or preset changes.
                </p>
              )}
            </div>
            <div className="setting-row">
              <span><CircleGauge size={12} aria-hidden="true" /> Current target</span>
              <strong>{song.pedagogy.mastery.accuracyPercent}% clean</strong>
            </div>
            <div className="setting-row latency-row">
              <span><Sparkles size={12} aria-hidden="true" /> Input offset</span>
              <input
                aria-label="MIDI input timing offset in milliseconds"
                className="compact-range"
                max={180}
                min={-120}
                onChange={(event) => hero.setLatencyMs(Number(event.target.value))}
                step={5}
                type="range"
                value={hero.settings.latencyMs}
              />
              <strong>{hero.settings.latencyMs > 0 ? "+" : ""}{hero.settings.latencyMs}ms</strong>
            </div>
          </section>

          <div className="keyboard-help">
            <kbd>Z</kbd><kbd>S</kbd><kbd>X</kbd>
            <span>Use the computer keyboard anytime. Space plays; arrows rewind and seek.</span>
          </div>
        </aside>
      </div>

      {songComplete && !hero.quickLoopEnabled && (
        <PerformanceResults
          noteResults={hero.noteResults}
          onPractice={hero.restart}
          onReplay={replaySong}
          practiceMode={hero.settings.practiceMode}
          score={hero.score}
          song={song}
        />
      )}

      {!hero.midi.supported && (
        <div className="permission-note">
          <strong>Web MIDI needs Chrome or Edge.</strong>
          <p>
            The full game still works with your computer keyboard. For the MPK Mini,
            open this page in a browser with Web MIDI support and click Connect MIDI.
          </p>
          <button onClick={openLibrary}>Browse lessons</button>
        </div>
      )}

      {libraryOpen && (
        <SongLibrary
          activeSong={song}
          onClose={closeLibrary}
          onSelect={selectSong}
        />
      )}

      {trainingOpen && (
        <TrainingRoom
          activeLessonId={activeTrainingLesson?.id}
          onClose={closeTraining}
          onSelect={startTrainingLesson}
          progress={trainingProgress}
        />
      )}

      <span className="sr-only" aria-live="polite">
        {hero.midi.error ?? ""}
      </span>
    </main>
  );
}
