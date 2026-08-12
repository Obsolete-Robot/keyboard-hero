"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  Headphones,
  Music2,
  Play,
  Repeat2,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import type { NoteResult, PracticeMode } from "@/hooks/useKeyboardHeroCore";
import { midiToNoteName, type SongSection } from "@/lib/songs";
import {
  HOME_FINGER_POSITIONS,
  TRAINING_LESSONS,
  getNotesInSection,
  nextTrainingLesson,
  type TrainingLanding,
  type TrainingLesson,
} from "@/lib/training";

export type TrainingProgress = Record<string, Record<string, number>>;

interface TrainingRoomProps {
  activeLessonId?: string;
  onClose: () => void;
  onSelect: (lesson: TrainingLesson) => void;
  progress: TrainingProgress;
}

interface TrainingCoachProps {
  cleanRuns: number;
  isPlaying: boolean;
  lesson: TrainingLesson;
  mode: PracticeMode;
  nextLanding: TrainingLanding | null;
  noteResults: ReadonlyMap<string, NoteResult>;
  onExit: () => void;
  onHear: () => void;
  onNavigateLesson: (lesson: TrainingLesson) => void;
  onOpenRoadmap: () => void;
  onPractice: () => void;
  onSelectSection: (section: SongSection) => void;
  onTest: () => void;
  pressedNotes: ReadonlySet<number>;
  section: SongSection;
  tempoPercent: number;
}

function completedSectionCount(
  lesson: TrainingLesson,
  progress: TrainingProgress,
): number {
  const lessonProgress = progress[lesson.id] ?? {};
  return lesson.song.sections.filter(
    (section) =>
      (lessonProgress[section.id] ?? 0) >=
      lesson.song.pedagogy.mastery.cleanRuns,
  ).length;
}

function modeLabel(mode: PracticeMode) {
  if (mode === "listen") return "Coach is playing";
  if (mode === "wait") return "Waiting for you";
  return "Keeping the pulse";
}

function TrainingRoom({
  activeLessonId,
  onClose,
  onSelect,
  progress,
}: TrainingRoomProps) {
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
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const masteredLessons = TRAINING_LESSONS.filter(
    (lesson) =>
      completedSectionCount(lesson, progress) === lesson.song.sections.length,
  ).length;

  return (
    <div className="modal-backdrop training-room-backdrop">
      <button
        aria-label="Close training room"
        className="modal-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-label="Beginner piano training room"
        aria-modal="true"
        className="training-room-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="training-room-head">
          <div className="training-room-heading">
            <span className="training-room-icon" aria-hidden="true">
              <GraduationCap size={22} />
            </span>
            <div>
              <div className="modal-kicker">Beginner training room</div>
              <h2>Make two hands feel possible.</h2>
              <p>
                No full songs yet. Hear one tiny move slowly, find it without a
                clock, then loop it until your hands stop feeling surprised.
              </p>
            </div>
          </div>
          <div className="training-room-head-actions">
            <span className="training-room-total">
              <strong>{masteredLessons}</strong> / {TRAINING_LESSONS.length} lessons steady
            </span>
            <button
              aria-label="Close training room"
              className="close-button"
              onClick={onClose}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="training-room-primer">
          <div>
            <span>Finger numbers</span>
            <strong>1 = thumb · 5 = pinky</strong>
          </div>
          <div>
            <span>Home position</span>
            <strong>Left C3-G3 · Right C4-G4</strong>
          </div>
          <div>
            <span>Your pace</span>
            <strong>28-36 BPM to start</strong>
          </div>
        </div>

        <div className="training-roadmap" aria-label="Six-step training path">
          {TRAINING_LESSONS.map((lesson) => {
            const completed = completedSectionCount(lesson, progress);
            const sectionCount = lesson.song.sections.length;
            const selected = lesson.id === activeLessonId;
            const mastered = completed === sectionCount;
            return (
              <button
                className={`training-roadmap-card${selected ? " is-current" : ""}${
                  mastered ? " is-mastered" : ""
                }`}
                key={lesson.id}
                onClick={() => onSelect(lesson)}
                type="button"
              >
                <span className="training-card-number">
                  {mastered ? <Check size={14} /> : String(lesson.order).padStart(2, "0")}
                </span>
                <span className="training-card-copy">
                  <small>{lesson.eyebrow}</small>
                  <strong>{lesson.title}</strong>
                  <span>{lesson.summary}</span>
                </span>
                <span className="training-card-meta">
                  <span>{lesson.recommendedMinutes}</span>
                  <span>{completed}/{sectionCount} moves steady</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>

        <footer className="training-room-foot">
          <span><Sparkles size={14} aria-hidden="true" /> Feeling stuck on Frère Jacques?</span>
          <strong>Start at step 3. Take turns → land together → try the tiny overlap.</strong>
        </footer>
      </section>
    </div>
  );
}

function FingerMap({
  lesson,
  noteResults,
  nextLanding,
  pressedNotes,
  section,
}: Pick<
  TrainingCoachProps,
  "lesson" | "noteResults" | "nextLanding" | "pressedNotes" | "section"
>) {
  const sectionNotes = useMemo(
    () => getNotesInSection(lesson.song, section),
    [lesson, section],
  );
  const usedMidi = useMemo(
    () => new Set(sectionNotes.map((songNote) => songNote.midi)),
    [sectionNotes],
  );
  const targetIds = useMemo(
    () => new Set(nextLanding?.notes.map((songNote) => songNote.id) ?? []),
    [nextLanding],
  );

  return (
    <div className="training-finger-map">
      {(["left", "right"] as const).map((hand) => (
        <div className={`training-hand-row hand-${hand}`} key={hand}>
          <div className="training-hand-label">
            <span>{hand === "left" ? "LH" : "RH"}</span>
            <strong>{hand === "left" ? "Left hand" : "Right hand"}</strong>
          </div>
          <div className="training-hand-keys">
            {HOME_FINGER_POSITIONS.filter(
              (position) => position.hand === hand,
            ).map((position) => {
              const targetNote = nextLanding?.notes.find(
                (songNote) =>
                  songNote.midi === position.midi && songNote.hand === hand,
              );
              const complete = targetNote
                ? noteResults.has(targetNote.id)
                : false;
              return (
                <span
                  aria-label={`${hand} hand ${position.note}, finger ${position.finger}${
                    targetNote ? ", next target" : ""
                  }`}
                  className={`training-finger-key${
                    usedMidi.has(position.midi) ? " is-used" : ""
                  }${targetIds.has(targetNote?.id ?? "") ? " is-target" : ""}${
                    pressedNotes.has(position.midi) ? " is-pressed" : ""
                  }${complete ? " is-complete" : ""}`}
                  key={`${hand}-${position.midi}`}
                >
                  <small>{position.note}</small>
                  <b>{position.finger}</b>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <p>Finger 1 is always your thumb. Keep every shown finger resting near its key.</p>
    </div>
  );
}

function TrainingCoach({
  cleanRuns,
  isPlaying,
  lesson,
  mode,
  nextLanding,
  noteResults,
  onExit,
  onHear,
  onNavigateLesson,
  onOpenRoadmap,
  onPractice,
  onSelectSection,
  onTest,
  pressedNotes,
  section,
  tempoPercent,
}: TrainingCoachProps) {
  const targetRuns = lesson.song.pedagogy.mastery.cleanRuns;
  const previousLesson = nextTrainingLesson(lesson, -1);
  const followingLesson = nextTrainingLesson(lesson, 1);
  const sectionIndex = lesson.song.sections.findIndex(
    (candidate) => candidate.id === section.id,
  );
  const mastered = cleanRuns >= targetRuns;

  return (
    <>
      <section className="coach-section training-coach-intro">
        <div className="training-coach-topline">
          <span><GraduationCap size={13} aria-hidden="true" /> Guided training</span>
          <button onClick={onOpenRoadmap} type="button">All 6 steps</button>
        </div>
        <div className="training-lesson-count">
          <span>Step {String(lesson.order).padStart(2, "0")}</span>
          <i><b style={{ width: `${(lesson.order / TRAINING_LESSONS.length) * 100}%` }} /></i>
          <span>{String(TRAINING_LESSONS.length).padStart(2, "0")}</span>
        </div>
        <small className="training-lesson-eyebrow">{lesson.eyebrow}</small>
        <h2>{lesson.title}</h2>
        <p>{lesson.reassurance}</p>
      </section>

      <section className="coach-section training-move-section">
        <div className="section-kicker">
          Tiny moves <strong>{sectionIndex + 1} of {lesson.song.sections.length}</strong>
        </div>
        <div className="training-move-tabs">
          {lesson.song.sections.map((candidate, index) => (
            <button
              aria-current={candidate.id === section.id ? "step" : undefined}
              className={candidate.id === section.id ? "active" : ""}
              key={candidate.id}
              onClick={() => onSelectSection(candidate)}
              type="button"
            >
              <span>{index + 1}</span>
              {candidate.label}
            </button>
          ))}
        </div>
        <div className="training-current-move">
          <div>
            <span>{section.label}</span>
            <strong>{section.focus}</strong>
          </div>
          <div
            aria-label={`${Math.min(cleanRuns, targetRuns)} of ${targetRuns} clean loops`}
            className={`training-clean-runs${mastered ? " is-mastered" : ""}`}
          >
            {Array.from({ length: targetRuns }, (_, index) => (
              <i key={index}>{index < cleanRuns ? <Check size={10} /> : index + 1}</i>
            ))}
            <span>{mastered ? "Steady" : "Clean loops"}</span>
          </div>
        </div>
      </section>

      <section className="coach-section training-hands-section">
        <div className="section-kicker">
          Hand setup <strong>1 thumb · 5 pinky</strong>
        </div>
        <p className="training-hand-position">{lesson.song.pedagogy.handPosition}</p>
        <FingerMap
          lesson={lesson}
          nextLanding={nextLanding}
          noteResults={noteResults}
          pressedNotes={pressedNotes}
          section={section}
        />
      </section>

      <section className="coach-section training-next-landing">
        <div className="section-kicker">
          Next landing
          <strong>{nextLanding ? `${Math.max(0, nextLanding.beat - section.startBeat).toFixed(1)} in loop` : "Loop clear"}</strong>
        </div>
        {nextLanding ? (
          <div className="training-landing-notes">
            {nextLanding.notes.map((songNote) => (
              <span
                className={`hand-${songNote.hand ?? "right"}${
                  noteResults.has(songNote.id) ? " is-complete" : ""
                }`}
                key={songNote.id}
              >
                <small>{songNote.hand === "left" ? "LH" : "RH"}</small>
                <strong>{midiToNoteName(songNote.midi)}</strong>
                <b>finger {songNote.finger}</b>
              </span>
            ))}
          </div>
        ) : (
          <div className="training-loop-clear">
            <Check size={15} aria-hidden="true" /> Every note in this move is down.
          </div>
        )}
        <p className="training-success-cue"><Target size={12} aria-hidden="true" /> {lesson.successCue}</p>
      </section>

      <section className="coach-section training-actions-section">
        <div className="training-session-status" aria-live="polite">
          <span className={isPlaying ? "is-live" : ""} />
          {isPlaying ? modeLabel(mode) : "Choose one way to practice"} · {Math.round(lesson.song.bpm * tempoPercent / 100)} BPM
        </div>
        <div className="training-action-grid">
          <button className={mode === "listen" ? "active" : ""} onClick={onHear} type="button">
            <Headphones size={15} aria-hidden="true" />
            <span><small>1 · Watch</small><strong>Hear it slowly</strong></span>
          </button>
          <button className={mode === "wait" ? "active" : ""} onClick={onPractice} type="button">
            <Repeat2 size={15} aria-hidden="true" />
            <span><small>2 · No rush</small><strong>Find the notes</strong></span>
          </button>
          <button className={mode === "flow" ? "active" : ""} onClick={onTest} type="button">
            <Play size={15} fill="currentColor" aria-hidden="true" />
            <span><small>3 · When ready</small><strong>Keep the pulse</strong></span>
          </button>
        </div>
        <p className="training-action-help">
          Listen plays for you. Wait freezes on each landing. Flow keeps moving.
          Every option repeats only this tiny move.
        </p>
      </section>

      <section className="coach-section training-nav-section">
        <div className="training-lesson-nav">
          <button
            disabled={!previousLesson}
            onClick={() => previousLesson && onNavigateLesson(previousLesson)}
            type="button"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            <span><small>Previous</small><strong>{previousLesson?.shortTitle ?? "Start"}</strong></span>
          </button>
          <button
            disabled={!followingLesson}
            onClick={() => followingLesson && onNavigateLesson(followingLesson)}
            type="button"
          >
            <span><small>Next</small><strong>{followingLesson?.shortTitle ?? "Ready"}</strong></span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
        <button className="training-exit" onClick={onExit} type="button">
          <Music2 size={13} aria-hidden="true" /> Return to songs
        </button>
      </section>
    </>
  );
}

function TrainingLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="coach-section training-launch-section">
      <button className="training-launcher" onClick={onOpen} type="button">
        <span className="training-launch-icon" aria-hidden="true">
          <GraduationCap size={20} />
        </span>
        <span className="training-launch-copy">
          <small>Lost when the left hand joins?</small>
          <strong>Open the training room</strong>
          <span>Six slow, repeatable steps from finger placement to Frère Jacques.</span>
        </span>
        <ArrowRight size={15} aria-hidden="true" />
      </button>
    </section>
  );
}

export { TrainingCoach, TrainingLauncher, TrainingRoom };
