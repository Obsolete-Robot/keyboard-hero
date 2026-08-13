import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPowerJudgement,
  authoredChordGroupId,
  completePowerMode,
  createPowerModeState,
  latchChordScoreMultiplier,
  pointsForJudgement,
} from "../lib/powerMode.ts";
import {
  buildComboOrchestrationLayers,
  comboOrchestrationMix,
} from "../lib/comboOrchestration.ts";

const orchestrationNote = (id, midi, startBeat, durationBeats = 1) => ({
  id,
  midi,
  startBeat,
  durationBeats,
  velocity: 90,
});

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

test("POWER MODE stays active with an unbroken combo and a miss cancels it", () => {
  let power = createPowerModeState();
  for (let index = 0; index < 9; index += 1) {
    power = applyPowerJudgement(power, "perfect").state;
  }

  for (let index = 0; index < 32; index += 1) {
    power = applyPowerJudgement(power, "great").state;
  }
  assert.equal(power.active, true);
  assert.equal(power.charge, 1);
  assert.equal(power.multiplier, 2);
  assert.equal(power.activations, 1);

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

test("mode and tempo rates scale the full judgement award", () => {
  assert.equal(pointsForJudgement("perfect", 1, 1, 0.125), 126);
  assert.equal(pointsForJudgement("perfect", 1, 1, 1.25), 1263);
  assert.equal(pointsForJudgement("great", 10, 2, 0.5), 800);
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

test("Easy orchestration separates Medium bridge notes from the eventual Hard chart", () => {
  const player = [orchestrationNote("easy-c", 60, 0)];
  const medium = [
    orchestrationNote("medium-c", 60, 0),
    orchestrationNote("medium-e", 64, 0),
    orchestrationNote("medium-f", 65, 1),
  ];
  const hard = [
    orchestrationNote("hard-c", 60, 0),
    orchestrationNote("hard-e", 64, 0, 2),
    orchestrationNote("hard-g", 67, 1),
  ];

  const layers = buildComboOrchestrationLayers(
    player,
    "easy",
    medium,
    hard,
  );
  assert.deepEqual(layers.shared.map((note) => note.id), ["medium-e"]);
  assert.deepEqual(layers.mediumOnly.map((note) => note.id), ["medium-f"]);
  assert.deepEqual(layers.hardOnly.map((note) => note.id), ["hard-g"]);
});

test("Medium orchestration adds only attacks absent from the player's chart", () => {
  const player = [
    orchestrationNote("medium-c", 60, 0),
    orchestrationNote("medium-e", 64, 0),
  ];
  const hard = [
    orchestrationNote("hard-c", 60, 0),
    orchestrationNote("hard-e", 64, 0),
    orchestrationNote("hard-g", 67, 0),
  ];

  const layers = buildComboOrchestrationLayers(
    player,
    "medium",
    [],
    hard,
  );
  assert.deepEqual(layers.shared, []);
  assert.deepEqual(layers.mediumOnly, []);
  assert.deepEqual(layers.hardOnly.map((note) => note.id), ["hard-g"]);
});

test("Power streak mix grows Easy through Medium into Hard and drops on a miss", () => {
  assert.deepEqual(comboOrchestrationMix("easy", 40, false), {
    shared: 0,
    mediumOnly: 0,
    hardOnly: 0,
  });

  const mediumEntry = comboOrchestrationMix("easy", 9, true);
  assert.ok(mediumEntry.shared > 0);
  assert.ok(mediumEntry.mediumOnly > 0);
  assert.equal(mediumEntry.hardOnly, 0);

  const hardEntry = comboOrchestrationMix("easy", 16, true);
  assert.ok(hardEntry.hardOnly > 0);
  assert.ok(hardEntry.mediumOnly < hardEntry.shared);

  assert.deepEqual(comboOrchestrationMix("easy", 32, true), {
    shared: 1,
    mediumOnly: 0,
    hardOnly: 1,
  });

  const mediumPower = comboOrchestrationMix("medium", 9, true);
  assert.equal(mediumPower.shared, 0);
  assert.equal(mediumPower.mediumOnly, 0);
  assert.ok(mediumPower.hardOnly > 0);
  assert.deepEqual(comboOrchestrationMix("hard", 40, true), {
    shared: 0,
    mediumOnly: 0,
    hardOnly: 0,
  });
});
