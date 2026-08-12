import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Keyboard Hero game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Keyboard Hero — Learn Piano Like a Headliner<\/title>/i);
  assert.match(html, /KEYBOARD HERO/);
  assert.match(html, /First Five Launch/);
  assert.match(html, /Connect MIDI/);
  assert.match(html, /MIDI channel/);
  assert.match(html, /Align keyboard/);
  assert.match(html, /Connect MIDI first, then align the MPK Mini with its two end keys/);
  assert.match(html, /Re-align after MPK Octave, KTrans, or preset changes/);
  assert.match(html, /Backing band/);
  assert.match(html, /Band ready/);
  assert.match(html, /Play band/);
  assert.match(html, /Band mix/);
  assert.match(html, /Intensity/);
  assert.match(html, /Practice mode/);
  assert.match(html, /Open the training room/);
  assert.match(html, /Six slow, repeatable steps from finger placement to Fr.re Jacques/);
  assert.match(html, /Three-dimensional 25-key practice keyboard/);
  assert.match(html, /PLAY HERE/);
  assert.match(html, /Stage score/);
  assert.match(html, /Live streak/);
  assert.match(html, /Combo energy/);
  assert.match(html, /Correct hits fill the meter/);
  assert.match(html, /Power Mode meter/);
  assert.match(html, /Accuracy/);
  assert.match(html, /Learn the notes\. Feel the stage\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships the guided beginner training room and slow-practice controls", async () => {
  const [page, training, trainingArea, appCss, songs] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/training.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/TrainingArea.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/songs.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<TrainingLauncher/);
  assert.match(page, /<TrainingRoom/);
  assert.match(page, /<TrainingCoach/);
  assert.match(page, /getNextTrainingLanding/);
  assert.match(page, /setTrainingProgress/);
  assert.match(page, /prepareTrainingSection\(activeTrainingSection, "listen", true\)/);
  assert.match(page, /setBackingBandForTraining\(false\)/);
  assert.match(training, /export const TRAINING_LESSONS/);
  assert.match(training, /title: "Right-Hand Home"/);
  assert.match(training, /title: "Left-Hand Home"/);
  assert.match(training, /title: "Hands Take Turns"/);
  assert.match(training, /title: "First Two-Hand Landing"/);
  assert.match(training, /title: "Build a C Chord"/);
  assert.match(training, /title: "Fr.re, Unknotted"/);
  assert.match(trainingArea, /Hear it slowly/);
  assert.match(trainingArea, /Find the notes/);
  assert.match(trainingArea, /Keep the pulse/);
  assert.match(trainingArea, /Finger 1 is always your thumb/);
  assert.match(trainingArea, /Clean loops/);
  assert.match(appCss, /\.training-room-modal/);
  assert.match(appCss, /\.training-finger-key\.is-target/);
  assert.match(appCss, /\.coach-panel\.is-training/);
  assert.match(songs, /id: "canon-entry-a"/);
  assert.match(songs, /id: "left-finish-b"/);
});

test("ships the finished game rather than starter assets", async () => {
  const [page, appCss, layout, packageJson, songs, stage, stageCss, results, report, engine, midiInputs] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/songs.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.css", import.meta.url), "utf8"),
    readFile(new URL("../components/PerformanceResults.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/performanceReport.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useKeyboardHeroCore.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/midiInputs.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useKeyboardHeroCore/);
  assert.match(page, /<KeyboardStage/);
  assert.match(page, /Reconnect MIDI/);
  assert.match(page, /hero\.midi\.permission === "prompt"/);
  assert.match(page, /currentBeat=\{hero\.visualBeat\}/);
  assert.match(page, /First note hits the bright bar at zero/);
  assert.match(page, /hero\.feedbackEvents\.map/);
  assert.match(page, /hero\.heldNotes\.get\(note\.id\)/);
  assert.match(page, /state: heldNote[\s\S]*?"active"/);
  assert.match(page, /holdProgress: heldNote\?\.progress/);
  assert.match(page, /hero\.sustainFeedbackEvents\.map/);
  assert.match(page, /left\.sequence - right\.sequence/);
  assert.match(page, /sustainCelebration/);
  assert.match(page, /feedback\.earlyCaptured/);
  assert.match(page, /hero\.score\.sustainPoints/);
  assert.match(page, /<PerformanceResults/);
  assert.match(page, /recentFeedbackToasts\.map/);
  assert.match(page, /className="performance-feedback-toasts"/);
  assert.match(page, /performance-feedback-toast tone-\$\{toast\.tone\}/);
  assert.doesNotMatch(page, /className=\{`stage-encouragement/);
  assert.match(page, /target\.tagName === "BUTTON"/);
  assert.match(page, /Performance port connected/);
  assert.match(page, /outside C3–C5/);
  assert.match(page, /hero\.setMIDIChannel/);
  assert.match(page, /hero\.midi\.lastMappedNote/);
  assert.match(page, /hero\.midi\.calibration\.phase === "right"/);
  assert.match(page, /hero\.startMIDICalibration/);
  assert.match(page, /hero\.cancelMIDICalibration/);
  assert.match(page, /hero\.resetMIDICalibration/);
  assert.match(page, /hero\.midi\.lastTransportEvent/);
  assert.match(page, /resolveMIDITransportIntent/);
  assert.match(page, /intent === "replay"/);
  assert.match(page, /intent === "back-to-practice"/);
  assert.match(page, /Press the physical leftmost key/);
  assert.match(page, /physical rightmost key/);
  assert.match(page, /Try again/);
  assert.match(page, /mapped from raw/);
  assert.match(page, /hero\.backingBand\.active/);
  assert.match(page, /hero\.setBackingBandEnabled/);
  assert.match(page, /hero\.setBackingBandMix/);
  assert.match(page, /hero\.setBackingBandIntensity/);
  assert.match(page, /Player piano/);
  assert.match(page, /Mute player piano/);
  assert.match(page, /Your keys are muted/);
  assert.match(page, /showMutedPlayerPianoCue/);
  assert.match(page, /dialogRef\.current\?\.focus/);
  assert.match(page, /document\.body\.style\.overflow = "hidden"/);
  assert.match(page, /input:not\(\[disabled\]\)/);
  assert.match(page, /dialog\.addEventListener\("keydown", handleDialogKeyDown\)/);
  assert.match(page, /returnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /const openLibrary = useCallback/);
  assert.match(page, /pauseForLibrary\(\);[\s\S]*?setLibraryOpen\(true\)/);
  assert.match(page, /function ChallengeSelector/);
  assert.match(page, /<ChallengeSelector/);
  assert.match(page, /SONG_FAMILIES\.length/);
  assert.match(
    page,
    /const CAREER_VENUES = \[[\s\S]*?Garage Sessions[\s\S]*?Downtown Club[\s\S]*?Festival Stage[\s\S]*?Grand Theater[\s\S]*?Arena Headliner[\s\S]*?\] as const/,
  );
  assert.match(page, /const selectChallenge = useCallback/);
  assert.match(page, /getSongChart\(selectedSongFamily, nextChallenge\)/);
  assert.match(
    page,
    /if \(libraryOpen \|\| trainingOpen \|\| songComplete\) return/,
  );
  assert.match(page, /onClick=\{openLibrary\}/);
  assert.match(page, /hero\.power\.active/);
  assert.match(page, /power=\{hero\.power\}/);
  assert.match(page, /pointsAwarded/);
  assert.match(page, /powerActivation/);
  assert.match(page, /latestFeedbackGroup/);
  assert.match(page, /event\.groupId === latestGroupId/);
  assert.match(page, /find\(\(event\) => event\.powerActivation\)/);
  assert.match(page, /total \+ event\.pointsAwarded/);
  assert.match(page, /Power Mode activated/);
  assert.match(page, /Double score until the streak breaks/);
  assert.match(page, /power-meter-track/);
  assert.match(page, /Quick loop: restart the full song with no score/);
  assert.match(page, /onClick=\{hero\.toggleQuickLoop\}/);
  assert.match(page, /songComplete && !hero\.quickLoopEnabled/);
  assert.match(page, /height: `\$\{powerMeterPercent\}%`/);
  assert.match(page, /className="performance-side"/);
  assert.match(appCss, /\.power-meter\.is-active/);
  assert.match(appCss, /grid-row: 1 \/ 4/);
  assert.match(appCss, /transition: height 420ms/);
  assert.match(appCss, /\.performance-hud \.performance-side \.performance-streak/);
  assert.match(appCss, /background: transparent/);
  assert.match(appCss, /power-stage-enter 1100ms/);
  assert.match(stage, /displayedPowerEnergy/);
  assert.match(stageCss, /kh-stage-power-enter 950ms/);
  assert.match(appCss, /\.timeline-loop\.is-quick-loop/);
  assert.match(appCss, /\.performance-feedback-toast \{/);
  assert.match(appCss, /@keyframes feedback-toast-slide/);
  assert.match(appCss, /power-stage-breathe/);
  assert.match(appCss, /prefers-reduced-motion: reduce/);
  assert.match(appCss, /--arena-header-height: clamp\(58px, 9dvh, 70px\)/);
  assert.match(appCss, /--arena-transport-height: clamp\(124px, 18dvh, 148px\)/);
  assert.match(appCss, /--arena-primary-width: 100%/);
  assert.match(appCss, /--arena-stage-height: max\(/);
  assert.match(
    appCss,
    /calc\(100dvh - var\(--arena-header-height\) - var\(--arena-transport-height\)\)/,
  );
  assert.match(appCss, /overflow-y: auto/);
  assert.match(appCss, /\.app-shell \{[\s\S]*?overflow: visible;/);
  assert.match(appCss, /\.main-grid \{[\s\S]*?width: 100%;/);
  assert.match(appCss, /\.stage-wrap \{[\s\S]*?height: var\(--arena-stage-height\);/);
  assert.match(appCss, /\.stage-wrap > \.kh-stage \{[\s\S]*?min-height: 0;/);
  assert.match(appCss, /max-width: 1000px/);
  assert.match(appCss, /orientation: landscape/);
  assert.match(appCss, /280px,[\s\S]*?calc\(100dvh - var\(--arena-header-height\) - var\(--arena-transport-height\)\)/);
  assert.match(appCss, /minmax\(80px, 0\.55fr\) 44px minmax\(218px, 1\.45fr\)/);
  assert.match(appCss, /\.close-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(page, /Rockstar!/);
  assert.match(page, /result\.grade === "miss"/);
  assert.match(page, /\["flow", "wait", "listen"\]/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /\/og-career\.png/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(songs, /export const SONGS: Song\[]/);
  assert.match(songs, /title: "Neon Skyline Finale"/);
  assert.match(stage, /const KEY_COUNT = 25/);
  assert.match(stage, /const HIT_Z = -0\.72/);
  assert.match(stage, /strikeLabel = "PLAY HERE"/);
  assert.match(stage, /const KEY_LANE_COLORS = \[/);
  assert.match(stage, /const HIT_BAR_WIDTH = KEYBOARD_WIDTH \+ 0\.42/);
  assert.match(stage, /BoxGeometry\(HIT_BAR_WIDTH, 0\.055, 0\.055\)/);
  assert.match(stage, /shockwave/);
  assert.match(stage, /KeyboardStagePowerState/);
  assert.match(stage, /powerSurgeRing/);
  assert.match(stage, /!hasCachedTransform/);
  assert.match(stage, /!Number\.isFinite\(lastStrikeWidth\)/);
  assert.match(stage, /flareMaterial/);
  assert.match(stage, /vertexColors: true/);
  assert.match(stage, /data-power-mode/);
  assert.match(stage, /motionQuery\.addEventListener\("change"/);
  assert.match(stage, /motionQuery\.removeEventListener\("change"/);
  assert.match(stage, /cameraTargetY = width >= 620 && width < 900 \? 0\.7 : 0\.1/);
  assert.match(stage, /camera\.lookAt\(0, cameraTargetY, -2\.1\)/);
  assert.match(stage, /holdProgress\?: number/);
  assert.match(stage, /const AIM_RENDER_ORDER = 1200/);
  assert.match(stage, /held-aim-white-ring/);
  assert.match(stage, /held-aim-sparks/);
  assert.match(stage, /depthTest: false/);
  assert.match(stage, /group\.position\.set\(key\.x, 0\.19, HIT_Z\)/);
  assert.match(stage, /whiteRing\.renderOrder = AIM_RENDER_ORDER \+ 2/);
  assert.match(stage, /sparks\.renderOrder = AIM_RENDER_ORDER \+ 4/);
  assert.match(stage, /marker\.group\.visible = active/);
  assert.match(stage, /pressedNow && !missed && note\.state === "active"/);
  assert.match(stage, /matchedHoldStrength/);
  assert.match(stage, /reduceMotion[\s\S]*?0\.82/);
  assert.match(stage, /makeRoundedNoteGeometry/);
  assert.match(stage, /bevelEnabled: true/);
  assert.match(stage, /nextNoteStartRef/);
  assert.match(stage, /const separationGap/);
  assert.match(stage, /headCap/);
  assert.match(stage, /tailCap/);
  assert.match(stage, /finger\?: KeyboardFinger/);
  assert.match(stage, /fingeringHands\?: readonly KeyboardStageHand\[\]/);
  assert.match(stage, /fingeringRange\?: KeyboardStageFingeringRange/);
  assert.match(stage, /range\.wrap \|\| currentBeat >= range\.endBeat/);
  assert.match(stage, /authoredFingeringForNote/);
  assert.match(stage, /const nextStartBeat/);
  assert.match(stage, /const wrappedNextStartBeat/);
  assert.match(stage, /noteIsInFingeringRange/);
  assert.match(stage, /midi: note\.midi/);
  assert.match(stage, /fingerGuideRef/);
  assert.match(stage, /key-fingering-/);
  assert.match(stage, /fingerTargetsByMidi/);
  assert.match(stage, /key\.fingerLabel\.visible = true/);
  assert.match(stage, /fingerLabelMaterial\?\.dispose\(\)/);
  assert.match(stage, /fingerLabelTexture\?\.dispose\(\)/);
  assert.match(stage, /SUGGESTED FINGERING/);
  assert.match(stage, /left: \[5, 4, 3, 2, 1\]/);
  assert.match(stage, /right: \[1, 2, 3, 4, 5\]/);
  assert.match(stage, /T thumb · I index · M middle · R ring · P pinky/);
  assert.match(stageCss, /\.kh-stage__strike-zone \{[\s\S]*height: 2px;/);
  assert.match(stageCss, /\.kh-stage__finger-guide \{/);
  assert.match(stageCss, /\.kh-stage__finger\.is-upcoming/);
  assert.match(stageCss, /\.kh-stage--power/);
  assert.match(stageCss, /kh-stage-power-breathe/);
  assert.match(results, /Official score sheet/);
  assert.match(results, /performance-results-overlay/);
  assert.match(report, /score\.points - basePoints - sustainPoints/);
  assert.match(report, /label: "Sustain bonus"/);
  assert.match(results, /results-test-score/);
  assert.match(results, /AnimatedNumber/);
  assert.match(results, /"ledger-row"/);
  assert.match(results, /"stage-count"/);
  assert.match(results, /"test-score"/);
  assert.match(results, /`stamp-\$\{gradeOutcome\}`/);
  assert.match(results, /results-grade-stamp stamp-\$\{gradeOutcome\}/);
  assert.match(appCss, /@keyframes results-grade-fail-stamp/);
  assert.match(engine, /playPerformanceCue/);
  assert.match(results, /Play it again/);
  assert.match(results, /Back to practice/);
  assert.match(results, /prefers-reduced-motion: reduce/);
  assert.match(results, /dialogRef\.current\?\.focus/);
  assert.match(results, /createPortal/);
  assert.match(results, /fitResultsSheet/);
  assert.match(results, /availableHeight \/ naturalHeight/);
  assert.match(results, /visualViewport\?\.addEventListener\("resize", scheduleFit\)/);
  assert.match(results, /results-fit-frame/);
  assert.match(appCss, /\.results-fit-scaler \{[\s\S]*?transform: scale\(var\(--results-fit-scale, 1\)\)/);
  assert.match(appCss, /\.performance-results-card \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(report, /grade: "A\+"/);
  assert.match(report, /TIMING_WEIGHTS/);
  assert.match(report, /extraMisses/);
  assert.match(engine, /requestMIDIAccess/);
  assert.match(engine, /midiTransportInputsRef/);
  assert.match(engine, /rebindMIDITransportInputs/);
  assert.match(engine, /decodeMIDITransportPress/);
  assert.match(engine, /keyboard-hero\.midi-preferences\.v1/);
  assert.match(engine, /persistMIDIPreferences/);
  assert.match(engine, /autoMIDIConnectAttemptedRef/);
  assert.match(engine, /void connectMIDI\(\)/);
  assert.match(
    engine,
    /preferredInputId === null \? chooseAutomaticMIDIInput\(inputs\) : null/,
  );
  assert.match(engine, /midiHookActiveRef/);
  assert.match(midiInputs, /mpk mini iv midi port/);
  assert.match(midiInputs, /officialMPKInput/);
  assert.match(engine, /detectedChannel/);
  assert.match(engine, /export type MIDICalibrationPhase/);
  assert.match(engine, /lastMappedNote/);
  assert.match(engine, /isValidMIDICalibrationSpan/);
  assert.match(engine, /startMIDICalibration/);
  assert.match(engine, /backingBandEnabled/);
  assert.match(engine, /backingBandMix/);
  assert.match(engine, /backingBandIntensity/);
  assert.match(engine, /backingBandJamBeatRef/);
  assert.match(engine, /toggleBackingBandPlayback/);
  assert.match(engine, /const animateBand = \(now: number\)/);
  assert.match(page, /hero\.backingBand\.isJamming \? "Pause band" : "Play band"/);
  assert.match(page, /onClick=\{hero\.toggleBackingBandPlayback\}/);
  assert.match(appCss, /\.band-jam-button\.is-playing/);
  assert.match(engine, /mapMIDINoteToKeyboardRange/);
  assert.match(
    engine,
    /const saved = parseMIDICalibrationMapping[\s\S]*?if \(!saved\)[\s\S]*?calibrated: true/,
  );
  assert.doesNotMatch(engine, /needsVerification/);
  assert.match(engine, /midi:\$\{input\.id\}:ch\$\{channel\}/);
  assert.match(engine, /const PRE_ROLL_SECONDS = 5/);
  assert.match(engine, /const POST_ROLL_MIN_SECONDS = 2\.5/);
  assert.match(engine, /const POST_ROLL_CLEARANCE_BEATS = 1\.75/);
  assert.match(engine, /feedbackEvents/);
  assert.match(engine, /songComplete/);
  assert.match(engine, /visualBeat/);
  assert.match(engine, /NoteFeedback/);
  assert.match(engine, /pointsAwarded/);
  assert.match(engine, /powerActivation/);
  assert.match(engine, /groupId/);
  assert.match(engine, /const scoringEnabled = !quickLoopEnabledRef\.current/);
  assert.match(engine, /if \(activeLoop\.enabled \|\| shouldQuickLoop\)/);
  assert.match(engine, /clearAttempt\(true, true\)/);
  assert.match(engine, /setQuickLoopEnabled/);
  assert.match(engine, /practiceMode === "listen" && !isPlayingRef\.current\) play\(\)/);
  assert.match(engine, /reconcileScheduledVoices/);
  assert.match(engine, /const tempoScale = clamp\(scale, 0\.25, 1\.25\)/);

  await access(new URL("../public/og-career.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("fits the primary arena inside common 16:9 desktop viewports", () => {
  const targets = [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1223, height: 688 },
    { width: 1156, height: 650 },
    { width: 1024, height: 576 },
    { width: 960, height: 540 },
    { width: 854, height: 480 },
    { width: 800, height: 450 },
  ];
  const clamp = (minimum, preferred, maximum) =>
    Math.min(maximum, Math.max(minimum, preferred));

  for (const { width, height } of targets) {
    const compactLandscape = width >= 641 && width <= 880 && width > height;
    const headerHeight = compactLandscape
      ? 56
      : clamp(58, height * 0.09, 70);
    const transportHeight = compactLandscape
      ? 112
      : clamp(124, height * 0.18, 148);
    const sidebarWidth = width <= 880 ? 0 : width <= 1120 ? 276 : 310;
    const playColumnWidth = width - sidebarWidth;
    const heightBudgetWidth =
      compactLandscape || height <= 688
        ? (height - headerHeight - transportHeight) * (16 / 9)
        : height * 1.29;
    const minimumStageWidth = compactLandscape ? 280 * (16 / 9) : 0;
    const shellWidth = Math.min(
      playColumnWidth,
      Math.max(minimumStageWidth, heightBudgetWidth),
      1280,
    );
    const stageHeight = shellWidth * (9 / 16);
    const occupiedHeight = headerHeight + transportHeight + stageHeight;

    assert.ok(
      occupiedHeight <= height + 0.01,
      `${width}x${height} arena is ${occupiedHeight - height}px too tall`,
    );
    assert.ok(shellWidth <= playColumnWidth, `${width}x${height} overflows horizontally`);
    assert.ok(
      stageHeight >= (compactLandscape ? 280 : 350),
      `${width}x${height} stage is too short to read`,
    );
  }
});

test("grades the score sheet from timing, completion, and extra misses", async () => {
  const { buildPerformanceReport } = await import(
    new URL("../lib/performanceReport.ts", import.meta.url).href
  );

  const song = (count) => ({
    notes: Array.from({ length: count }, (_, index) => ({
      id: `note-${index}`,
      midi: 60 + index,
    })),
  });
  const result = (id, grade) => ({ id, midi: 60, grade, offsetMs: 0 });
  const score = (overrides = {}) => ({
    points: 0,
    sustainPoints: 0,
    combo: 0,
    bestCombo: 0,
    hits: 0,
    misses: 0,
    accuracy: 100,
    ...overrides,
  });

  const headlinerSong = song(3);
  const headliner = buildPerformanceReport(
    headlinerSong,
    new Map([
      ["note-0", result("note-0", "perfect")],
      ["note-1", result("note-1", "great")],
      ["note-2", result("note-2", "great")],
    ]),
    score({ points: 2460, combo: 3, bestCombo: 3, hits: 3 }),
    "flow",
  );
  assert.equal(headliner.testScore, 97);
  assert.equal(headliner.grade, "A+");
  assert.equal(
    headliner.rows.reduce((total, row) => total + row.points, 0),
    2460,
  );

  const allGreat = buildPerformanceReport(
    song(1),
    new Map([["note-0", result("note-0", "great")]]),
    score({ points: 710, combo: 1, bestCombo: 1, hits: 1 }),
    "flow",
  );
  assert.equal(allGreat.testScore, 95);
  assert.equal(allGreat.grade, "A");

  const held = buildPerformanceReport(
    song(1),
    new Map([
      [
        "note-0",
        {
          ...result("note-0", "perfect"),
          sustain: {
            grade: "full",
            heldBeats: 2,
            requiredBeats: 2,
            progress: 1,
            pointsAwarded: 240,
            multiplier: 1,
          },
        },
      ],
    ]),
    score({
      points: 1330,
      sustainPoints: 240,
      combo: 1,
      bestCombo: 1,
      hits: 1,
    }),
    "flow",
  );
  const sustainRow = held.rows.find((row) => row.label === "Sustain bonus");
  const streakRow = held.rows.find(
    (row) => row.label === "Streak + Power bonus",
  );
  assert.equal(sustainRow?.points, 240);
  assert.match(sustainRow?.detail ?? "", /1 full/);
  assert.equal(streakRow?.points, 90);
  assert.equal(
    held.rows.reduce((total, row) => total + row.points, 0),
    1330,
  );

  const adjusted = buildPerformanceReport(
    song(1),
    new Map([
      [
        "note-0",
        {
          ...result("note-0", "perfect"),
          basePointsAwarded: 125,
        },
      ],
    ]),
    score({ points: 126, combo: 1, bestCombo: 1, hits: 1 }),
    "wait",
  );
  assert.equal(adjusted.rows[0].points, 125);
  assert.match(adjusted.rows[0].detail, /mode \+ tempo adjusted/);
  assert.equal(
    adjusted.rows.reduce((total, row) => total + row.points, 0),
    126,
  );

  const skipped = buildPerformanceReport(
    song(2),
    new Map([["note-0", result("note-0", "perfect")]]),
    score({ points: 1010, combo: 1, bestCombo: 1, hits: 1 }),
    "wait",
  );
  assert.equal(skipped.testScore, 50);
  assert.equal(skipped.grade, "F");
  assert.equal(skipped.missedOrUnplayed, 1);

  const spammed = buildPerformanceReport(
    song(1),
    new Map([["note-0", result("note-0", "perfect")]]),
    score({ points: 1010, combo: 1, bestCombo: 1, hits: 1, misses: 1, accuracy: 50 }),
    "flow",
  );
  assert.equal(spammed.testScore, 50);
  assert.equal(spammed.grade, "F");
  assert.match(spammed.rows[3].detail, /1 extras/);

  const demo = buildPerformanceReport(song(2), new Map(), score(), "listen");
  assert.equal(demo.grade, "DEMO");
  assert.equal(demo.testScore, null);
});
