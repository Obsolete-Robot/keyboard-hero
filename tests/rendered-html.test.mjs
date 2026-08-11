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
  const [page, layout, packageJson, songs, stage, stageCss, engine] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/songs.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/KeyboardStage.css", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useKeyboardHeroCore.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useKeyboardHeroCore/);
  assert.match(page, /<KeyboardStage/);
  assert.match(page, /currentBeat=\{hero\.visualBeat\}/);
  assert.match(page, /First note hits the bright bar at zero/);
  assert.match(page, /hero\.feedbackEvents\.map/);
  assert.match(page, /performance-results-overlay/);
  assert.match(page, /resultsReplayRef\.current\?\.focus/);
  assert.match(page, /Performance port connected/);
  assert.match(page, /outside C3–C5/);
  assert.match(page, /hero\.setMIDIChannel/);
  assert.match(page, /Rockstar!/);
  assert.match(page, /result\.grade === "miss"/);
  assert.match(page, /\["flow", "wait", "listen"\]/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /\/og\.png/);
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
  assert.match(engine, /requestMIDIAccess/);
  assert.match(engine, /name\?\.trim\(\)\.toLowerCase\(\) === "mpk mini iv"/);
  assert.match(engine, /detectedChannel/);
  assert.match(engine, /note >= MIDI_MIN && note <= MIDI_MAX/);
  assert.match(engine, /midi:\$\{input\.id\}:ch\$\{channel\}/);
  assert.match(engine, /const PRE_ROLL_SECONDS = 5/);
  assert.match(engine, /const POST_ROLL_MIN_SECONDS = 2\.5/);
  assert.match(engine, /const POST_ROLL_CLEARANCE_BEATS = 1\.75/);
  assert.match(engine, /feedbackEvents/);
  assert.match(engine, /songComplete/);
  assert.match(engine, /visualBeat/);
  assert.match(engine, /tempoScale: clamp\(scale, 0\.25, 1\.25\)/);

  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
