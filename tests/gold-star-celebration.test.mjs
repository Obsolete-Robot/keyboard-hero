import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a perfect Flow run gets a full-card gold-star celebration", async () => {
  const [results, styles] = await Promise.all([
    readFile(new URL("../components/PerformanceResults.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(results, /const GOLD_STAR_HOLD_MS = 2_000/);
  assert.match(results, /const GOLD_STAR_PARTICLES = Array\.from\(\{ length: 36 \}/);
  assert.match(results, /className="results-gold-star-celebration"/);
  assert.match(results, /heroStar\.animate\(/);
  assert.match(results, /targetRect\.left \+ targetRect\.width \/ 2/);
  assert.match(results, /goldStarTargetRefs\.current\[index\] = node/);
  assert.match(results, /Gold star/);
  assert.match(results, /Perfect Flow/);

  assert.match(styles, /\.results-gold-star-celebration/);
  assert.match(styles, /@keyframes results-gold-star-particle/);
  assert.match(styles, /@keyframes results-gold-star-landed/);
  assert.match(styles, /\.results-mastery-stars svg\.just-landed/);
});
