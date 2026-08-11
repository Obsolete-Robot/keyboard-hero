"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Play, RotateCcw } from "lucide-react";

import type {
  KeyboardHeroScore,
  NoteResult,
  PracticeMode,
} from "@/hooks/useKeyboardHeroCore";
import { buildPerformanceReport } from "@/lib/performanceReport";
import type { Song } from "@/lib/songs";

const RESULT_REVEAL = {
  rowStart: 420,
  rowStep: 150,
  stagePoints: 1650,
  testScore: 2400,
  actionsReady: 4120,
} as const;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function AnimatedNumber({
  value,
  delay,
  duration = 900,
}: {
  value: number;
  delay: number;
  duration?: number;
}) {
  const [reduceMotion] = useState(prefersReducedMotion);
  const [displayValue, setDisplayValue] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) return;
    let frame = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(Math.round(value * eased));
        if (progress < 1) frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [delay, duration, reduceMotion, value]);

  return <span aria-hidden="true">{displayValue.toLocaleString()}</span>;
}

interface PerformanceResultsProps {
  song: Song;
  noteResults: ReadonlyMap<string, NoteResult>;
  score: KeyboardHeroScore;
  practiceMode: PracticeMode;
  onReplay: () => void;
  onPractice: () => void;
}

export default function PerformanceResults({
  song,
  noteResults,
  score,
  practiceMode,
  onReplay,
  onPractice,
}: PerformanceResultsProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [reduceMotion] = useState(prefersReducedMotion);
  const [revealReady, setRevealReady] = useState(reduceMotion);
  const report = useMemo(
    () => buildPerformanceReport(song, noteResults, score, practiceMode),
    [noteResults, practiceMode, score, song],
  );

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
    const timer = window.setTimeout(
      () => setRevealReady(true),
      reduceMotion ? 0 : RESULT_REVEAL.actionsReady,
    );
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [reduceMotion]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onPractice();
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
  }, [onPractice]);

  const finalScoreLabel =
    report.testScore === null ? "Demo run, not graded" : `${report.testScore} out of 100`;

  const resultSheet = (
    <div className="performance-results-overlay">
      <section
        aria-describedby="performance-results-message"
        aria-labelledby="performance-results-title"
        aria-modal="true"
        className={`performance-results-card result-${report.tone}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="results-registration" aria-hidden="true" />

        <header className="results-sheet-header">
          <div>
            <span className="results-kicker">
              Official score sheet // Level {song.level.toString().padStart(2, "0")}
            </span>
            <h2 id="performance-results-title">{song.title}</h2>
            <span className="results-sheet-meta">
              {song.key} · {song.timeSignature[0]}/{song.timeSignature[1]} · {song.bpm} BPM
            </span>
          </div>
          <div className="results-stage-points" aria-label={`${score.points} stage points`}>
            <span>Stage points</span>
            <strong>
              <AnimatedNumber
                value={score.points}
                delay={RESULT_REVEAL.stagePoints}
                duration={700}
              />
            </strong>
          </div>
        </header>

        <div className="results-sheet-rule" aria-hidden="true" />

        <div className="results-ledger" aria-label="Scoring breakdown" role="list">
          {report.rows.map((row, index) => (
            <div
              aria-label={`${row.label}: ${row.detail}, ${row.points} points`}
              className={`results-ledger-row row-${row.tone}`}
              key={row.label}
              role="listitem"
              style={{
                "--row-delay": `${RESULT_REVEAL.rowStart + index * RESULT_REVEAL.rowStep}ms`,
              } as CSSProperties}
            >
              <span className="results-row-number" aria-hidden="true">
                {(index + 1).toString().padStart(2, "0")}
              </span>
              <span className="results-row-label" aria-hidden="true">
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </span>
              <strong className="results-row-points" aria-hidden="true">
                {row.tone === "miss" ? (
                  "0 PTS"
                ) : row.points === 0 ? (
                  "—"
                ) : (
                  <>
                    +
                    <AnimatedNumber
                      value={row.points}
                      delay={RESULT_REVEAL.rowStart + index * RESULT_REVEAL.rowStep}
                      duration={620}
                    />
                  </>
                )}
              </strong>
            </div>
          ))}
        </div>

        <div className="results-final-verdict">
          <div className="results-test-block">
            <span className="results-test-label">Performance test</span>
            <div className="results-test-score" aria-label={finalScoreLabel}>
              {report.testScore === null ? (
                <strong aria-hidden="true">DEMO</strong>
              ) : (
                <>
                  <strong>
                    <AnimatedNumber
                      value={report.testScore}
                      delay={RESULT_REVEAL.testScore}
                      duration={650}
                    />
                  </strong>
                  <small aria-hidden="true">/100</small>
                </>
              )}
            </div>
            <span className="results-test-note">
              Timing across {song.notes.length} chart notes
              {report.extraMisses > 0 ? " · extras count as zero" : ""}
            </span>
          </div>

          <div className="results-grade-zone">
            <span className="results-grade-burst" aria-hidden="true" />
            <div className="results-grade-stamp" aria-label={`Final grade ${report.gradeLabel}`}>
              <span aria-hidden="true">Final grade</span>
              <strong aria-hidden="true">{report.grade}</strong>
              <em aria-hidden="true">
                {report.grade === "A+" ? "Headliner" : "Set complete"}
              </em>
            </div>
          </div>
        </div>

        <div className="results-feedback">
          <span>Coach&apos;s note</span>
          <div>
            <strong>{report.title}</strong>
            <p id="performance-results-message">{report.message}</p>
          </div>
        </div>

        <div className="results-actions">
          <button
            className="results-replay"
            disabled={!revealReady}
            onClick={onReplay}
          >
            <Play size={15} fill="currentColor" aria-hidden="true" />
            Play it again
          </button>
          <button
            className="results-practice"
            disabled={!revealReady}
            onClick={onPractice}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Back to practice
          </button>
        </div>

        <p className="sr-only" role="status">
          Performance complete. {score.points} stage points. {finalScoreLabel}. Final grade {report.gradeLabel}.
          {report.missedOrUnplayed > 0
            ? ` ${report.missedOrUnplayed} notes were missed or unplayed.`
            : " Every note was completed."}
        </p>
      </section>
    </div>
  );

  return typeof document === "undefined"
    ? null
    : createPortal(resultSheet, document.body);
}
