import assert from "node:assert/strict";
import test from "node:test";

import {
  advancePowerMode,
  applyPowerJudgement,
  authoredChordGroupId,
  completePowerMode,
  createPowerModeState,
  latchChordScoreMultiplier,
  pointsForJudgement,
} from "../lib/powerMode.ts";

test("grade-weighted hits fill the meter and activate exactly once across a chord", () => {
  let power = createPowerModeState();
  for (let index = 0; index < 8; index += 1) {
    const outcome = applyPowerJudgement(power, "perfect");
    assert.equal(outcome.activated, false);
    power = outcome.state;
  }
  assert.ok(Math.abs(power.charge - 0.96) < 0.000_001);

  const activation = applyPowerJudgement(power, "perfect");
  assert.equal(activation.activated, true);
  assert.equal(activation.state.activations, 1);
  assert.equal(activation.state.multiplier, 2);

  const simultaneousChordTone = applyPowerJudgement(
    activation.state,
    "perfect",
  );
  assert.equal(simultaneousChordTone.activated, false);
  assert.equal(simultaneousChordTone.state.activations, 1);
});

test("POWER MODE advances in beats, expires finitely, and a miss cancels it", () => {
  let power = createPowerModeState();
  for (let index = 0; index < 9; index += 1) {
    power = applyPowerJudgement(power, "perfect").state;
  }

  const unchanged = advancePowerMode(power, 0);
  assert.equal(unchanged, power, "paused and Wait transport do not consume power");

  power = advancePowerMode(power, 3);
  assert.equal(power.active, true);
  assert.equal(power.remainingBeats, 5);
  assert.equal(power.progress, 3 / 8);

  power = advancePowerMode(power, 5);
  assert.equal(power.active, false);
  assert.equal(power.remainingBeats, 0);
  assert.equal(power.progress, 1);
  assert.equal(power.multiplier, 1);

  power = applyPowerJudgement(createPowerModeState(), "great").state;
  power = applyPowerJudgement(power, "miss").state;
  assert.equal(power.charge, 0);
  assert.equal(power.active, false);
  assert.equal(power.energy, 0);
});

test("ten Great judgements activate instead of displaying a stuck 100 percent", () => {
  let power = createPowerModeState();
  for (let index = 0; index < 10; index += 1) {
    power = applyPowerJudgement(power, "great").state;
  }

  assert.equal(power.charge, 1);
  assert.equal(power.active, true);
  assert.equal(power.activations, 1);
});

test("an authored chord uses one pre-chord multiplier regardless of MIDI order", () => {
  const runChord = (grades) => {
    let power = createPowerModeState();
    for (let index = 0; index < 7; index += 1) {
      power = applyPowerJudgement(power, "perfect").state;
    }

    const ledger = new Map();
    const feedbackMultipliers = [];
    let combo = 7;
    let points = 0;
    let activationEvents = 0;
    for (const grade of grades) {
      const multiplier = latchChordScoreMultiplier(
        ledger,
        "song:beat-4",
        power.multiplier,
      );
      feedbackMultipliers.push(multiplier);
      const outcome = applyPowerJudgement(power, grade);
      power = outcome.state;
      if (outcome.activated) activationEvents += 1;
      combo += 1;
      points += pointsForJudgement(grade, combo, multiplier);
    }

    return { power, feedbackMultipliers, points, activationEvents, ledger };
  };

  const lowThenHigh = runChord(["good", "perfect"]);
  const highThenLow = runChord(["perfect", "good"]);
  assert.equal(lowThenHigh.points, highThenLow.points);
  assert.deepEqual(lowThenHigh.feedbackMultipliers, [1, 1]);
  assert.deepEqual(highThenLow.feedbackMultipliers, [1, 1]);
  assert.equal(lowThenHigh.activationEvents, 1);
  assert.equal(highThenLow.activationEvents, 1);
  assert.equal(
    latchChordScoreMultiplier(
      lowThenHigh.ledger,
      "song:beat-5",
      lowThenHigh.power.multiplier,
    ),
    2,
    "the next authored group receives POWER's multiplier",
  );
});

test("authored chord feedback gets a stable song-and-timestamp group id", () => {
  assert.equal(
    authoredChordGroupId("song-a", 4),
    authoredChordGroupId("song-a", 4.0000002),
  );
  assert.notEqual(
    authoredChordGroupId("song-a", 4),
    authoredChordGroupId("song-a", 4.25),
  );
  assert.notEqual(
    authoredChordGroupId("song-a", 4),
    authoredChordGroupId("song-b", 4),
  );
});

test("feedback point awards use the exact active multiplier", () => {
  assert.equal(pointsForJudgement("perfect", 1, 1), 1010);
  assert.equal(pointsForJudgement("perfect", 9, 2), 2180);
  assert.equal(pointsForJudgement("good", 60, 2), 1900);
  assert.equal(pointsForJudgement("miss", 60, 2), 0);
});

test("song completion clears live power without erasing earned activations", () => {
  let power = createPowerModeState();
  for (let index = 0; index < 9; index += 1) {
    power = applyPowerJudgement(power, "perfect").state;
  }

  power = completePowerMode(power);
  assert.equal(power.active, false);
  assert.equal(power.charge, 0);
  assert.equal(power.multiplier, 1);
  assert.equal(power.activations, 1);
});
