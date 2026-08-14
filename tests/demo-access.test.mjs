import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const { KEYBOARD_HERO_CONFIG } = await import("../keyboard-hero.config.ts");
const {
  DEMO_SONG_FAMILIES,
  DEMO_SONG_FAMILY_IDS,
  isDemoSongFamily,
} = await import("../lib/demoAccess.ts");
const {
  CHALLENGE_LEVELS,
  SONG_FAMILIES,
  getSongChart,
} = await import("../lib/songCatalog.ts");

test("the release config selects a valid playable catalog", () => {
  assert.equal(typeof KEYBOARD_HERO_CONFIG.demoMode, "boolean");

  const playableFamilies = SONG_FAMILIES.filter(
    (family) =>
      !KEYBOARD_HERO_CONFIG.demoMode || isDemoSongFamily(family),
  );

  assert.equal(
    playableFamilies.length,
    KEYBOARD_HERO_CONFIG.demoMode
      ? DEMO_SONG_FAMILIES.length
      : SONG_FAMILIES.length,
  );
});

test("the demo exposes exactly one song from the start of every venue", () => {
  const venueIds = new Set(SONG_FAMILIES.map((family) => family.careerTier));

  assert.equal(DEMO_SONG_FAMILIES.length, venueIds.size);
  assert.equal(DEMO_SONG_FAMILY_IDS.size, venueIds.size);

  for (const venueId of venueIds) {
    const venueFamilies = SONG_FAMILIES
      .filter((family) => family.careerTier === venueId)
      .sort((left, right) => left.courseRank - right.courseRank);
    const playableFamilies = venueFamilies.filter(isDemoSongFamily);

    assert.equal(playableFamilies.length, 1, `venue ${venueId}`);
    assert.equal(playableFamilies[0].id, venueFamilies[0].id, `venue ${venueId}`);
  }
});

test("every demo song keeps its Easy, Medium, and Hard charts", () => {
  for (const family of DEMO_SONG_FAMILIES) {
    for (const challenge of CHALLENGE_LEVELS) {
      const chart = getSongChart(family, challenge);
      assert.equal(chart.familyId, family.id);
      assert.equal(chart.challengeLevel, challenge);
      assert.ok(chart.notes.length > 0, `${family.id}/${challenge}`);
    }
  }
});

test("the rest of the catalog remains present but demo locked", () => {
  const lockedFamilies = SONG_FAMILIES.filter(
    (family) => !isDemoSongFamily(family),
  );

  assert.equal(lockedFamilies.length, SONG_FAMILIES.length - DEMO_SONG_FAMILIES.length);
  assert.equal(lockedFamilies.length, 31);
});
