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
  assert.match(html, /Band mix/);
  assert.match(html, /Intensity/);
  assert.match(html, /Practice mode/);
  assert.match(html, /Three-dimensional 25-key practice keyboard/);
  assert.match(html, /PLAY HERE/);
  assert.match(html, /Stage score/);
  assert.match(html, /Live streak/);
  assert.match(html, /Accuracy/);
  assert.match(html, /Learn the notes\. Feel the stage\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships the finished game rather than starter assets", async () => {
  const [page, layout, packageJson, songs, stage, stageCss, results, report, engine] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/songs.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.css", import.meta.url), "utf8"),
    readFile(new URL("../components/PerformanceResults.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/performanceReport.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useKeyboardHeroCore.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useKeyboardHeroCore/);
  assert.match(page, /<KeyboardStage/);
  assert.match(page, /currentBeat=\{hero\.visualBeat\}/);
  assert.match(page, /First note hits the bright bar at zero/);
  assert.match(page, /hero\.feedbackEvents\.map/);
  assert.match(page, /<PerformanceResults/);
  assert.match(page, /variant-\$\{celebration\.variant\}/);
  assert.match(page, /target\.tagName === "BUTTON"/);
  assert.match(page, /Performance port connected/);
  assert.match(page, /outside C3–C5/);
  assert.match(page, /hero\.setMIDIChannel/);
  assert.match(page, /hero\.midi\.lastMappedNote/);
  assert.match(page, /hero\.midi\.calibration\.phase === "right"/);
  assert.match(page, /hero\.startMIDICalibration/);
  assert.match(page, /hero\.cancelMIDICalibration/);
  assert.match(page, /hero\.resetMIDICalibration/);
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
  assert.match(page, /Rockstar!/);
  assert.match(page, /result\.grade === "miss"/);
  assert.match(page, /\["flow", "wait", "listen"\]/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /\/og-rock-v2\.png/);
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
  assert.match(stageCss, /\.kh-stage__strike-zone \{[\s\S]*height: 2px;/);
  assert.match(results, /Official score sheet/);
  assert.match(results, /performance-results-overlay/);
  assert.match(results, /results-test-score/);
  assert.match(results, /AnimatedNumber/);
  assert.match(results, /prefers-reduced-motion: reduce/);
  assert.match(results, /dialogRef\.current\?\.focus/);
  assert.match(results, /createPortal/);
  assert.match(report, /grade: "A\+"/);
  assert.match(report, /TIMING_WEIGHTS/);
  assert.match(report, /extraMisses/);
  assert.match(engine, /requestMIDIAccess/);
  assert.match(engine, /mpk mini iv midi port/);
  assert.match(engine, /officialMPKInput/);
  assert.match(engine, /detectedChannel/);
  assert.match(engine, /export type MIDICalibrationPhase/);
  assert.match(engine, /lastMappedNote/);
  assert.match(engine, /isValidMIDICalibrationSpan/);
  assert.match(engine, /startMIDICalibration/);
  assert.match(engine, /backingBandEnabled/);
  assert.match(engine, /backingBandMix/);
  assert.match(engine, /backingBandIntensity/);
  assert.match(engine, /mapMIDINoteToKeyboardRange/);
  assert.match(engine, /midi:\$\{input\.id\}:ch\$\{channel\}/);
  assert.match(engine, /const PRE_ROLL_SECONDS = 5/);
  assert.match(engine, /const POST_ROLL_MIN_SECONDS = 2\.5/);
  assert.match(engine, /const POST_ROLL_CLEARANCE_BEATS = 1\.75/);
  assert.match(engine, /feedbackEvents/);
  assert.match(engine, /songComplete/);
  assert.match(engine, /visualBeat/);
  assert.match(engine, /practiceMode === "listen" && !isPlayingRef\.current\) play\(\)/);
  assert.match(engine, /reconcileScheduledVoices/);
  assert.match(engine, /tempoScale: clamp\(scale, 0\.25, 1\.25\)/);

  await access(new URL("../public/og-rock-v2.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
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
