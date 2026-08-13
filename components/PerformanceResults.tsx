"use client";

import {
  useEffect,
  useLayoutEffect,
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
import type { PerformanceCue } from "@/lib/audio";
import { buildPerformanceReport } from "@/lib/performanceReport";
import type { Song } from "@/lib/songs";

const RESULT_REVEAL = {
  rowStart: 460,
  rowStep: 180,
  stagePoints: 1900,
  stagePointsDuration: 760,
  testScore: 2800,
  testScoreDuration: 680,
  grade: 3680,
  feedback: 4120,
  actions: 4250,
  actionsReady: 4600,
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
  onCue: (cue: PerformanceCue, variant?: number) => void;
  onReplay: () => void;
  onPractice: () => void;
}

export default function PerformanceResults({
  song,
  noteResults,
  score,
  practiceMode,
  onCue,
  onReplay,
  onPractice,
}: PerformanceResultsProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const fitFrameRef = useRef<HTMLDivElement>(null);
  const fitScalerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [reduceMotion] = useState(prefersReducedMotion);
  const [revealReady, setRevealReady] = useState(reduceMotion);
  const report = useMemo(
    () => buildPerformanceReport(song, noteResults, score, practiceMode),
    [noteResults, practiceMode, score, song],
  );
  const gradeOutcome =
    report.testScore === null
      ? "neutral"
      : report.grade === "F"
        ? "fail"
        : "pass";

  useEffect(() => {
    const timers: number[] = [];
    const queueCue = (
      delay: number,
      cue: PerformanceCue,
      variant = 0,
    ) => {
      timers.push(
        window.setTimeout(() => onCue(cue, variant), Math.max(0, delay)),
      );
    };
    const stampCue: PerformanceCue = `stamp-${gradeOutcome}`;

    if (reduceMotion) {
      queueCue(0, stampCue);
    } else {
      report.rows.forEach((_, index) => {
        queueCue(
          RESULT_REVEAL.rowStart + index * RESULT_REVEAL.rowStep,
          "ledger-row",
          index,
        );
      });
      queueCue(RESULT_REVEAL.stagePoints, "stage-count");
      queueCue(RESULT_REVEAL.testScore, "test-score");
      queueCue(RESULT_REVEAL.grade, stampCue);
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [gradeOutcome, onCue, reduceMotion, report.rows]);

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

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const fitFrame = fitFrameRef.current;
    const fitScaler = fitScalerRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !fitFrame || !fitScaler || !dialog) return;

    let resizeFrame = 0;

    const resetFit = () => {
      fitFrame.style.removeProperty("width");
      fitFrame.style.removeProperty("height");
      fitScaler.style.removeProperty("width");
      fitScaler.style.removeProperty("--results-fit-scale");
    };

    const fitResultsSheet = () => {
      if (window.matchMedia("(max-width: 640px)").matches) {
        resetFit();
        return;
      }

      const overlayStyle = window.getComputedStyle(overlay);
      const horizontalPadding =
        Number.parseFloat(overlayStyle.paddingLeft) +
        Number.parseFloat(overlayStyle.paddingRight);
      const verticalPadding =
        Number.parseFloat(overlayStyle.paddingTop) +
        Number.parseFloat(overlayStyle.paddingBottom);
      const availableWidth = Math.max(1, overlay.clientWidth - horizontalPadding);
      const availableHeight = Math.max(1, overlay.clientHeight - verticalPadding);
      const naturalWidth = Math.min(880, availableWidth);

      fitFrame.style.width = `${naturalWidth}px`;
      fitFrame.style.height = "auto";
      fitScaler.style.width = `${naturalWidth}px`;
      fitScaler.style.setProperty("--results-fit-scale", "1");

      const naturalHeight = dialog.offsetHeight;
      const fitScale = Math.min(
        1,
        availableWidth / naturalWidth,
        availableHeight / naturalHeight,
      );

      fitFrame.style.width = `${naturalWidth * fitScale}px`;
      fitFrame.style.height = `${naturalHeight * fitScale}px`;
      fitScaler.style.setProperty("--results-fit-scale", fitScale.toString());
    };

    const scheduleFit = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(fitResultsSheet);
    };

    fitResultsSheet();
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(overlay);
    resizeObserver.observe(dialog);
    window.visualViewport?.addEventListener("resize", scheduleFit);
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", scheduleFit);
      resetFit();
    };
  }, []);

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
    <div className="performance-results-overlay" ref={overlayRef}>
      <div className="results-fit-frame" ref={fitFrameRef}>
        <div className="results-fit-scaler" ref={fitScalerRef}>
          <section
            aria-describedby="performance-results-message"
            aria-labelledby="performance-results-title"
            aria-modal="true"
            className={`performance-results-card result-${report.tone}`}
            ref={dialogRef}
            role="dialog"
            style={{
              "--stage-settle-delay": `${
                RESULT_REVEAL.stagePoints + RESULT_REVEAL.stagePointsDuration - 130
              }ms`,
              "--test-block-delay": `${RESULT_REVEAL.testScore - 140}ms`,
              "--grade-delay": `${RESULT_REVEAL.grade}ms`,
              "--feedback-delay": `${RESULT_REVEAL.feedback}ms`,
              "--actions-delay": `${RESULT_REVEAL.actions}ms`,
            } as CSSProperties}
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
                duration={RESULT_REVEAL.stagePointsDuration}
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
                      duration={RESULT_REVEAL.testScoreDuration}
                    />
                  </strong>
                  <small aria-hidden="true">/100</small>
                </>
              )}
            </div>
            <span className="results-test-note">
              {practiceMode === "wait"
                ? "Timing is unscored in Wait mode"
                : `${score.points.toLocaleString()} of ${report.targetScore.toLocaleString()} song target${
                    report.extraMisses > 0 ? " · extras count as zero" : ""
                  }`}
            </span>
          </div>

          <div className="results-grade-zone">
            <span className="results-grade-burst" aria-hidden="true" />
            <div
              className={`results-grade-stamp stamp-${gradeOutcome}`}
              aria-label={`Final grade ${report.gradeLabel}`}
            >
              <span aria-hidden="true">Final grade</span>
              <strong aria-hidden="true">{report.grade}</strong>
              <em aria-hidden="true">
                {report.grade === "A+"
                  ? "Headliner"
                  : gradeOutcome === "fail"
                    ? "Try again"
                    : gradeOutcome === "neutral"
                      ? "Practice run"
                      : "Set complete"}
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
      </div>
    </div>
  );

  return typeof document === "undefined"
    ? null
    : createPortal(resultSheet, document.body);
}
