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
  ChevronDown,
  CircleGauge,
  Headphones,
  Pause,
  Play,
  Repeat2,
  Rewind,
  RotateCcw,
  Sparkles,
  Usb,
  Volume2,
  X,
} from "lucide-react";
import KeyboardStage, {
  type KeyboardHitFeedback,
  type KeyboardStageNote,
} from "@/components/KeyboardStage";
import {
  useKeyboardHeroCore,
  type KeyboardHeroScore,
  type NoteResult,
} from "@/hooks/useKeyboardHeroCore";
import {
  SONGS,
  getSongDurationSeconds,
  midiToNoteName,
  type Song,
  type SongSection,
} from "@/lib/songs";

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

function nextSongNote(song: Song, beat: number) {
  return song.notes.find((note) => note.startBeat >= beat - 0.04) ?? song.notes[0];
}

function handLabel(hand: "left" | "right" | "both" | undefined) {
  if (hand === "left") return "Left hand";
  if (hand === "right") return "Right hand";
  return "Both hands";
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
}

function performanceCelebration(
  feedback: NoteResult | null,
  combo: number,
): CelebrationCopy | null {
  if (!feedback) return null;
  if (feedback.grade === "miss") {
    return {
      eyebrow: "Miss - reset and rise",
      headline: "Shake it off!",
      detail: "Find the next lane. One note never defines the run.",
      tone: "miss",
    };
  }
  if (combo >= 25) {
    return {
      eyebrow: `${combo} note streak`,
      headline: "Rockstar!",
      detail: "The whole stage is yours. Keep breathing and ride it home.",
      tone: "rockstar",
    };
  }
  if (combo >= 15) {
    return {
      eyebrow: `${combo} note streak`,
      headline: "On fire!",
      detail: "Your hands know the path now. Stay loose.",
      tone: "rockstar",
    };
  }
  if (combo >= 8) {
    return {
      eyebrow: `${combo} note streak`,
      headline: "Locked in!",
      detail: "That timing is turning into instinct.",
      tone: feedback.grade === "perfect" ? "perfect" : "great",
    };
  }
  if (combo >= 4) {
    return {
      eyebrow: `${combo} note streak`,
      headline: "Nice!",
      detail: "The groove is building. Look one note ahead.",
      tone: feedback.grade === "perfect" ? "perfect" : "great",
    };
  }
  if (feedback.grade === "perfect") {
    return {
      eyebrow: "Perfect timing",
      headline: "Dead center!",
      detail: "Exactly on the bright bar. Remember that feel.",
      tone: "perfect",
    };
  }
  if (feedback.grade === "great") {
    return {
      eyebrow: feedback.offsetMs < 0 ? "Great - a touch early" : "Great - a touch late",
      headline: "So close!",
      detail: "Keep the same motion and settle into the pulse.",
      tone: "great",
    };
  }
  return {
    eyebrow: feedback.offsetMs < 0 ? "Good - just early" : "Good - just late",
    headline: "Keep rolling!",
    detail: "You landed it. Smooth beats rushed every time.",
    tone: "good",
  };
}

function performanceRating(
  score: KeyboardHeroScore,
  mode: "flow" | "wait" | "listen",
) {
  if (score.hits + score.misses === 0) {
    return {
      grade: "—",
      title: mode === "listen" ? "Demo complete" : "Ready for your run",
      message:
        mode === "listen"
          ? "You heard the full arrangement. Switch to Flow or Wait when you are ready to earn your rating."
          : "No notes were judged this time. Start from the top when you are ready to earn your rating.",
      tone: "practice",
    };
  }
  if (score.accuracy >= 97 && score.misses === 0) {
    return {
      grade: "S",
      title: "Legendary run",
      message: "Every light hit at once. Take the encore - you earned it.",
      tone: "legendary",
    };
  }
  if (score.accuracy >= 92) {
    return {
      grade: "A",
      title: "Rockstar performance",
      message: "Precision, momentum, and real musical control. Run it back even faster.",
      tone: "rockstar",
    };
  }
  if (score.accuracy >= 84) {
    return {
      grade: "B",
      title: "Locked in",
      message: "A confident run with a strong pulse. Polish the misses and this song is yours.",
      tone: "locked",
    };
  }
  if (score.accuracy >= 72) {
    return {
      grade: "C",
      title: "Rising star",
      message: "The shape is there. Slow it down, loop the rough section, and build the streak.",
      tone: "rising",
    };
  }
  return {
    grade: "R",
    title: "First run complete",
    message: "Finishing is the first win. Drop the tempo and turn every miss into a target.",
    tone: "practice",
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
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
        role="dialog"
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
          <button className="close-button" onClick={onClose} aria-label="Close song library">
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
  const song = useMemo(
    () => SONGS.find((candidate) => candidate.id === songId) ?? SONGS[0],
    [songId],
  );
  const hero = useKeyboardHeroCore(song);
  const isFinishing = hero.isFinishing;
  const songComplete = hero.songComplete;
  const positionBeatRef = useRef(hero.positionBeat);
  const resultsReplayRef = useRef<HTMLButtonElement>(null);
  const resultsReturnFocusRef = useRef<HTMLElement | null>(null);
  const togglePlayFromKey = hero.togglePlay;
  const rewindFromKey = hero.rewindBeats;
  const seekFromKey = hero.seekBeat;

  useEffect(() => {
    positionBeatRef.current = hero.positionBeat;
  }, [hero.positionBeat]);

  useEffect(() => {
    if (!songComplete) return;
    const activeElement = document.activeElement;
    resultsReturnFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      resultsReplayRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const returnTarget = resultsReturnFocusRef.current;
      resultsReturnFocusRef.current = null;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [songComplete]);

  useEffect(() => {
    const handleTransportKeys = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
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
  }, [rewindFromKey, seekFromKey, togglePlayFromKey]);

  const activeSection = currentSection(song, hero.positionBeat);
  const nextNote = nextSongNote(song, hero.positionBeat);
  const coach = modeCopy(hero.settings.practiceMode);
  const totalSeconds = getSongDurationSeconds(song, hero.settings.tempoScale);
  const noteApproachBeats = Math.max(
    1.25,
    (song.bpm * hero.settings.tempoScale * 4.6) / 60,
  );
  const progress = Math.min(100, (hero.positionBeat / song.durationBeats) * 100);
  const loopStart = Math.min(100, (hero.loop.startBeat / song.durationBeats) * 100);
  const loopEnd = Math.min(100, (hero.loop.endBeat / song.durationBeats) * 100);
  const celebration = performanceCelebration(
    hero.latestFeedback,
    hero.score.combo,
  );
  const feedbackKey = hero.latestFeedback
    ? `${hero.latestFeedback.id}-${hero.score.hits}-${hero.score.misses}`
    : "ready";
  const scoreDelta = hero.latestFeedback
    ? hero.latestFeedback.grade === "perfect"
      ? 1000 + Math.min(500, hero.score.combo * 10)
      : hero.latestFeedback.grade === "great"
        ? 700 + Math.min(500, hero.score.combo * 10)
        : hero.latestFeedback.grade === "good"
          ? 450 + Math.min(500, hero.score.combo * 10)
          : 0
    : 0;
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
  const streakProgress = Math.min(100, (hero.score.combo / 25) * 100);
  const performanceResult = performanceRating(
    hero.score,
    hero.settings.practiceMode,
  );

  const stageNotes = useMemo<KeyboardStageNote[]>(
    () =>
      song.notes.map((note) => {
        const result = hero.noteResults.get(note.id);
        return {
          id: note.id,
          midi: note.midi,
          startBeat: note.startBeat,
          durationBeats: note.durationBeats,
          velocity: (note.velocity ?? 94) / 127,
          hand: note.hand === "both" ? undefined : note.hand,
          state: result
            ? result.grade === "miss"
              ? "missed"
              : "hit"
            : "upcoming",
        };
      }),
    [hero.noteResults, song],
  );

  const stageFeedback = useMemo<readonly KeyboardHitFeedback[]>(
    () =>
      hero.feedbackEvents.map((event) => ({
        id: event.id,
        midi: event.midi,
        kind: event.grade,
        strength: Math.max(0.45, 1 - Math.abs(event.offsetMs) / 280),
      })),
    [hero.feedbackEvents],
  );

  const selectSong = useCallback(
    (nextSong: Song) => {
      hero.pause();
      setSongId(nextSong.id);
      setLibraryOpen(false);
    },
    [hero],
  );

  const selectSection = useCallback(
    (section: SongSection) => {
      hero.setLoop(section.startBeat, section.endBeat, true);
      hero.seekBeat(section.startBeat);
    },
    [hero],
  );

  const seekFromTimeline = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const nextBeat = Number(input.value);
    hero.seekBeat(nextBeat);
  };

  const replaySong = () => {
    hero.restart();
    hero.play();
  };

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
            <div className="song-selector-label">Now learning</div>
            <div className="song-selector-title">{song.title}</div>
            <div className="song-selector-meta">
              {song.level} · {song.key} · {song.timeSignature[0]}/{song.timeSignature[1]}
            </div>
          </div>
          <button className="library-button" onClick={() => setLibraryOpen(true)}>
            Library <ChevronDown size={11} aria-hidden="true" />
          </button>
        </div>

        <div className="device-status">
          <span className={`status-light${hero.midi.connectedName ? " online" : ""}`} />
          <div className="device-copy">
            <span className="device-name">
              {hero.midi.connectedName ?? "Computer keys ready"}
            </span>
            <span className="device-hint">
              {hero.midi.connectedName ? "Left key: C3 · signal live" : "Z–M / Q–I maps C3–C5"}
            </span>
          </div>
          <button className="connect-button" onClick={hero.connectMIDI}>
            <Usb size={13} aria-hidden="true" /> <span>Connect MIDI</span>
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
            }${isFinishing ? " is-finishing" : ""}`}
          >
            <KeyboardStage
              ariaLabel="Three-dimensional 25-key practice keyboard and falling note highway"
              currentBeat={hero.visualBeat}
              currentTime={hero.positionSeconds}
              feedback={stageFeedback}
              intensity={Math.min(1.75, 0.85 + hero.score.combo / 28)}
              notes={stageNotes}
              onKeyDown={(midi, velocity) => hero.noteOn(midi, velocity, "stage")}
              onKeyUp={(midi) => hero.noteOff(midi, "stage")}
              pressedMidiNotes={hero.pressedNotes}
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
              className={`performance-hud tier-${streakTier}`}
              aria-label={`Live performance: ${hero.score.points} points, ${hero.score.combo} note streak, ${hero.score.accuracy.toFixed(0)} percent accuracy`}
            >
              <div className="performance-card performance-score">
                <span className="performance-label">Stage score</span>
                <div className="score-readout">
                  <strong
                    className="score-value"
                    key={`score-${hero.score.points}`}
                  >
                    {hero.score.points.toLocaleString()}
                  </strong>
                  {scoreDelta > 0 && (
                    <span className="score-delta" key={`delta-${feedbackKey}`}>
                      +{scoreDelta.toLocaleString()}
                    </span>
                  )}
                </div>
                <span className="performance-subline">
                  {hero.score.hits} notes landed
                </span>
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
                <span className="streak-charge" aria-hidden="true">
                  <i style={{ width: `${streakProgress}%` }} />
                </span>
              </div>
            </section>

            {celebration &&
              !songComplete &&
              (hero.countdown === null || hero.countdown <= 0) && (
                <div
                  aria-hidden="true"
                  className={`stage-encouragement tone-${celebration.tone}`}
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

            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {celebration
                ? `${celebration.headline} ${celebration.detail} Score ${hero.score.points}. Streak ${hero.score.combo}. Accuracy ${hero.score.accuracy.toFixed(0)} percent.`
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

            {songComplete && (
              <div className="performance-results-overlay">
                <section
                  className={`performance-results-card result-${performanceResult.tone}`}
                  role="dialog"
                  aria-modal="false"
                  aria-live="polite"
                  aria-labelledby="performance-results-title"
                >
                  <span className="results-kicker">Performance complete</span>
                  <div className="results-hero">
                    <div className="results-grade" aria-label={`Rating ${performanceResult.grade}`}>
                      {performanceResult.grade}
                    </div>
                    <div>
                      <h2 id="performance-results-title">{performanceResult.title}</h2>
                      <p>{performanceResult.message}</p>
                    </div>
                  </div>

                  <div className="results-score">
                    <span>Final score</span>
                    <strong>{hero.score.points.toLocaleString()}</strong>
                  </div>

                  <div className="results-grid" aria-label="Performance statistics">
                    <div>
                      <strong>{hero.score.accuracy.toFixed(0)}%</strong>
                      <span>Accuracy</span>
                    </div>
                    <div>
                      <strong>{hero.score.hits}</strong>
                      <span>Notes landed</span>
                    </div>
                    <div>
                      <strong>{hero.score.misses}</strong>
                      <span>To revisit</span>
                    </div>
                    <div>
                      <strong>{hero.score.bestCombo}×</strong>
                      <span>Best streak</span>
                    </div>
                  </div>

                  <div className="results-actions">
                    <button
                      ref={resultsReplayRef}
                      className="results-replay"
                      onClick={replaySong}
                    >
                      <Play size={15} fill="currentColor" aria-hidden="true" />
                      Play it again
                    </button>
                    <button className="results-practice" onClick={hero.restart}>
                      <RotateCcw size={15} aria-hidden="true" />
                      Back to practice
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>

          <div className="transport">
            <div className="timeline-row">
              <span className="timecode">{formatTime(hero.positionSeconds)}</span>
              <div className="timeline">
                <div className="timeline-track" />
                <div className="timeline-progress" style={{ width: `${progress}%` }} />
                {hero.loop.enabled && (
                  <div
                    className="timeline-loop"
                    style={{ left: `${loopStart}%`, width: `${Math.max(0, loopEnd - loopStart)}%` }}
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
                >
                  <Repeat2 size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="coach-panel" aria-label="Piano coach">
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
              Next move <strong>{Math.max(0, nextNote.startBeat - hero.positionBeat).toFixed(1)} beats</strong>
            </div>
            <div className="next-note">
              <div className="note-orb">{midiToNoteName(nextNote.midi)}</div>
              <div className="next-note-copy">
                <strong>{handLabel(nextNote.hand)}</strong>
                <span>
                  Finger {nextNote.finger ?? "—"} · {nextNote.durationBeats} beat
                  {nextNote.durationBeats === 1 ? "" : "s"}
                </span>
                <div className="finger-row" aria-label={`Use finger ${nextNote.finger ?? "unknown"}`}>
                  {[1, 2, 3, 4, 5].map((finger) => (
                    <span
                      className={`finger-dot${finger === nextNote.finger ? " active" : ""}`}
                      key={finger}
                    >
                      {finger}
                    </span>
                  ))}
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
              <span><Headphones size={12} aria-hidden="true" /> Piano sound</span>
              <button
                aria-label="Toggle piano sound"
                aria-pressed={hero.settings.synthEnabled}
                className={`toggle${hero.settings.synthEnabled ? " on" : ""}`}
                onClick={() => hero.setSynthEnabled(!hero.settings.synthEnabled)}
              />
            </div>
            <div className="setting-row">
              <span><Usb size={12} aria-hidden="true" /> MIDI input</span>
              <select
                aria-label="MIDI input"
                className="mini-select"
                disabled={!hero.midi.inputs.length}
                onChange={(event) => hero.selectMIDIInput(event.target.value)}
                value={hero.midi.selectedInputId ?? ""}
              >
                {!hero.midi.inputs.length && <option value="">Not connected</option>}
                {hero.midi.inputs.map((input) => (
                  <option key={input.id} value={input.id}>{input.name}</option>
                ))}
              </select>
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

      {!hero.midi.supported && (
        <div className="permission-note">
          <strong>Web MIDI needs Chrome or Edge.</strong>
          <p>
            The full game still works with your computer keyboard. For the MPK Mini,
            open this page in a browser with Web MIDI support and click Connect MIDI.
          </p>
          <button onClick={() => setLibraryOpen(true)}>Browse lessons</button>
        </div>
      )}

      {libraryOpen && (
        <SongLibrary
          activeSong={song}
          onClose={() => setLibraryOpen(false)}
          onSelect={selectSong}
        />
      )}

      <span className="sr-only" aria-live="polite">
        {hero.midi.error ?? ""}
      </span>
    </main>
  );
}
