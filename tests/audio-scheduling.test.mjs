import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import {
  reconcileScheduledVoices,
  scheduleAudioSourceWindow,
  transportSubdivisionAtBeat,
} from "../lib/audioScheduling.ts";
import {
  createPowerSaturationCurve,
  derivePowerModeProfile,
  powerAccompanimentIntensity,
  powerAmount,
  shapePowerVelocity,
} from "../lib/audioPower.ts";
import {
  isDownbeatPulse,
  meterGrid,
  pulseIndexAtBeat,
} from "../lib/meter.ts";

register(new URL("./path-alias-loader.mjs", import.meta.url));

const { KeyboardSynth } = await import("../lib/audio.ts");
const { getSongChart } = await import("../lib/songCatalog.ts");

class FakeAudioParam {
  value = 0;
  ramps = [];

  cancelScheduledValues() {}

  setValueAtTime(value) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value, when) {
    this.value = value;
    this.ramps.push({ value, when });
  }

  setTargetAtTime(value) {
    this.value = value;
  }
}

class FakeAudioNode {
  connections = [];
  disconnectCount = 0;

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnectCount += 1;
    this.connections = [];
  }
}

class FakeScheduledSource extends FakeAudioNode {
  buffer = null;
  detune = new FakeAudioParam();
  frequency = new FakeAudioParam();
  onended = null;
  started = false;
  stopCount = 0;
  stopTimes = [];
  type = "sine";

  start() {
    this.started = true;
  }

  stop(when) {
    if (!this.started) {
      throw new DOMException("cannot stop before start", "InvalidStateError");
    }
    this.stopCount += 1;
    this.stopTimes.push(when);
  }

  finish() {
    this.onended?.({ type: "ended" });
  }
}

class FakeAudioContext {
  static instances = [];

  currentTime = 1;
  destination = new FakeAudioNode();
  oscillators = [];
  sampleRate = 32;
  state = "running";

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBiquadFilter() {
    return Object.assign(new FakeAudioNode(), {
      frequency: new FakeAudioParam(),
      gain: new FakeAudioParam(),
      Q: new FakeAudioParam(),
      type: "lowpass",
    });
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    const channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
    return {
      getChannelData: (channel) => channels[channel],
      numberOfChannels,
      sampleRate,
    };
  }

  createBufferSource() {
    return new FakeScheduledSource();
  }

  createConvolver() {
    return Object.assign(new FakeAudioNode(), { buffer: null });
  }

  createDynamicsCompressor() {
    return Object.assign(new FakeAudioNode(), {
      attack: new FakeAudioParam(),
      knee: new FakeAudioParam(),
      ratio: new FakeAudioParam(),
      release: new FakeAudioParam(),
      threshold: new FakeAudioParam(),
    });
  }

  createGain() {
    return Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
  }

  createOscillator() {
    const oscillator = new FakeScheduledSource();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createStereoPanner() {
    return Object.assign(new FakeAudioNode(), { pan: new FakeAudioParam() });
  }

  createWaveShaper() {
    return Object.assign(new FakeAudioNode(), {
      curve: null,
      oversample: "none",
    });
  }

  async close() {
    this.state = "closed";
  }
}

test("starts a Web Audio source before scheduling its stop", () => {
  const calls = [];
  let started = false;
  const source = {
    start(when) {
      started = true;
      calls.push(["start", when]);
    },
    stop(when) {
      if (!started) {
        throw new DOMException(
          "The source must be started before it can be stopped",
          "InvalidStateError",
        );
      }
      calls.push(["stop", when]);
    },
  };

  assert.doesNotThrow(() => scheduleAudioSourceWindow(source, 1.25, 4.5));
  assert.deepEqual(calls, [
    ["start", 1.25],
    ["stop", 4.5],
  ]);
});

test("the live note release setting controls the key-up fade", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
    writable: true,
  });
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => undefined;

  const synth = new KeyboardSynth();
  try {
    await synth.resume();
    synth.setReleaseSeconds(0.75);
    assert.equal(synth.noteOn("keyboard:KeyQ:60", 60, 0.8), true);

    const context = FakeAudioContext.instances.at(-1);
    const bodyOscillator = context?.oscillators[0];
    const partialGain = bodyOscillator?.connections[0];
    const voiceGain = partialGain?.connections[0];
    synth.noteOff("keyboard:KeyQ:60");

    assert.ok(
      Math.abs(voiceGain.gain.ramps.at(-1).when - 1.75) < 0.000_001,
      "the outer voice fades for the selected release duration",
    );
    assert.ok(
      Math.abs(bodyOscillator.stopTimes.at(-1) - 1.775) < 0.000_001,
      "the oscillator remains alive through the release tail",
    );
  } finally {
    await synth.dispose();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("metronome one-shots disconnect their complete node chain on ended", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
    writable: true,
  });

  const synth = new KeyboardSynth();
  try {
    synth.playMetronome(true);
    const context = FakeAudioContext.instances.at(-1);
    const oscillator = context?.oscillators.at(-1);
    const gain = oscillator?.connections[0];

    assert.ok(oscillator?.started, "the click source starts before it is stopped");
    assert.equal(oscillator.stopCount, 1);
    assert.ok(gain, "the click source is routed through a per-hit gain node");
    assert.equal(oscillator.disconnectCount, 0);
    assert.equal(gain.disconnectCount, 0);

    oscillator.finish();

    assert.equal(oscillator.disconnectCount, 1);
    assert.equal(gain.disconnectCount, 1);
  } finally {
    await synth.dispose();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("results cues distinguish line reveals, passing stamps, and failing stamps", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
    writable: true,
  });

  const synth = new KeyboardSynth();
  try {
    assert.equal(
      synth.playPerformanceCue("ledger-row"),
      false,
      "a results cue never creates a locked AudioContext after playback",
    );
    await synth.resume();
    const context = FakeAudioContext.instances.at(-1);

    const beforeRow = context.oscillators.length;
    assert.equal(synth.playPerformanceCue("ledger-row", 3), true);
    assert.equal(context.oscillators.length - beforeRow, 1);

    const beforePass = context.oscillators.length;
    synth.playPerformanceCue("stamp-pass");
    const passOscillators = context.oscillators.length - beforePass;

    const beforeFail = context.oscillators.length;
    synth.playPerformanceCue("stamp-fail");
    const failOscillators = context.oscillators.length - beforeFail;

    assert.equal(passOscillators, 5, "the passing stamp lands with a bright chord");
    assert.equal(failOscillators, 3, "the failing stamp uses a shorter descending buzzer");
  } finally {
    await synth.dispose();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("voice scheduling exceptions cannot abort transport reconciliation", () => {
  const notes = [{ id: "note-1", startBeat: 1, durationBeats: 1 }];
  const activeIds = new Set();
  let startAttempts = 0;
  let stopAttempts = 0;

  assert.doesNotThrow(() =>
    reconcileScheduledVoices(
      notes,
      1.25,
      activeIds,
      () => {
        startAttempts += 1;
        throw new DOMException("oscillator failed", "InvalidStateError");
      },
      () => undefined,
    ),
  );
  assert.deepEqual([...activeIds], ["note-1"]);

  reconcileScheduledVoices(
    notes,
    1.5,
    activeIds,
    () => {
      startAttempts += 1;
    },
    () => undefined,
  );
  assert.equal(startAttempts, 1, "a failed start is not retried every RAF tick");

  assert.doesNotThrow(() =>
    reconcileScheduledVoices(
      notes,
      2,
      activeIds,
      () => undefined,
      () => {
        stopAttempts += 1;
        throw new DOMException("voice already stopped", "InvalidStateError");
      },
    ),
  );
  assert.equal(stopAttempts, 1);
  assert.equal(activeIds.size, 0, "failed releases do not poison a later loop");
});

test("accompaniment retry boundaries advance once per half beat", () => {
  assert.equal(transportSubdivisionAtBeat(4), 8);
  assert.equal(transportSubdivisionAtBeat(4.49), 8);
  assert.equal(transportSubdivisionAtBeat(4.5), 9);
  assert.equal(transportSubdivisionAtBeat(-3), 0);
  assert.equal(transportSubdivisionAtBeat(Number.NaN), 0);
});

test("compound meter uses dotted pulses on the quarter-note transport", () => {
  assert.deepEqual(meterGrid([6, 8]), {
    measureBeats: 3,
    pulseBeats: 1.5,
    pulsesPerMeasure: 2,
    beatUnitBeats: 0.5,
    compound: true,
  });
  assert.equal(pulseIndexAtBeat(1.49, [6, 8]), 0);
  assert.equal(pulseIndexAtBeat(1.5, [6, 8]), 1);
  assert.equal(pulseIndexAtBeat(3, [6, 8]), 2);
  assert.equal(isDownbeatPulse(0, [6, 8]), true);
  assert.equal(isDownbeatPulse(1, [6, 8]), false);
  assert.equal(isDownbeatPulse(2, [6, 8]), true);
});

test("the live synth consumes the selected song's authored event frame", () => {
  const synth = new KeyboardSynth();
  const row = getSongChart("row-row-row-your-boat", "easy");
  let captured = null;
  synth.playAuthoredAccompanimentFrame = (frame) => {
    captured = frame;
    return true;
  };

  assert.equal(
    synth.syncAccompaniment({ song: row, beat: 1.5, intensity: 0.64 }),
    true,
  );
  assert.equal(captured.song.accompaniment.name, "Riverboat six-eight");
  assert.deepEqual(
    captured.events.map((event) => [event.kind, event.beat]),
    [
      ["snare", 1.5],
      ["closed-hat", 1.5],
      ["bass", 1.5],
      ["harmony", 1.5],
    ],
  );
});

test("authored song profiles produce audibly different live instrument activity", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
    writable: true,
  });

  const synth = new KeyboardSynth();
  try {
    await synth.resume();
    const context = FakeAudioContext.instances.at(-1);
    const row = getSongChart("row-row-row-your-boat", "easy");
    const minuet = getSongChart("minuet-in-g", "easy");

    const beforeRow = context.oscillators.length;
    assert.equal(synth.syncAccompaniment({ song: row, beat: 0 }), true);
    const rowOscillators = context.oscillators.length - beforeRow;

    const beforeMinuet = context.oscillators.length;
    assert.equal(synth.syncAccompaniment({ song: minuet, beat: 0 }), true);
    const minuetOscillators = context.oscillators.length - beforeMinuet;

    assert.equal(rowOscillators, 5, "riverboat groove plays kick, bass, and chord");
    assert.equal(minuetOscillators, 1, "drumless minuet opens with solo cello bass");
  } finally {
    await synth.dispose();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("POWER MODE preserves the normal mix and clamps unsafe energy", () => {
  const normal = derivePowerModeProfile(false, 1);
  assert.deepEqual(normal, {
    amount: 0,
    instrumentGain: 1,
    accompanimentGainScale: 1,
    instrumentReverbSend: 0.16,
    accompanimentReverbSend: 0.095,
    reverbWet: 0.2,
    saturationInstrumentSend: 0,
    saturationAccompanimentSend: 0,
    compressorThreshold: -15,
    stereoWidthScale: 1,
    brightnessLiftHz: 0,
    bodyGain: 1,
    hammerGain: 1,
    octaveGain: 0,
  });

  assert.equal(powerAmount(true, -1), 0);
  assert.equal(powerAmount(true, Number.NaN), 0);
  assert.equal(powerAmount(true, 2), 1);
  assert.equal(powerAmount(false, 1), 0);
});

test("POWER MODE grows expression monotonically while preserving headroom", () => {
  const half = derivePowerModeProfile(true, 0.5);
  const full = derivePowerModeProfile(true, 1);

  assert.equal(half.amount, 0.5);
  assert.ok(full.bodyGain > half.bodyGain);
  assert.ok(full.hammerGain > half.hammerGain);
  assert.ok(full.stereoWidthScale > half.stereoWidthScale);
  assert.ok(full.instrumentReverbSend > half.instrumentReverbSend);
  assert.ok(full.saturationInstrumentSend > half.saturationInstrumentSend);
  assert.ok(full.instrumentGain < 1);
  assert.ok(full.accompanimentGainScale < 1);
  assert.ok(full.compressorThreshold < -15);

  assert.equal(shapePowerVelocity(0.4, 0), 0.4);
  assert.ok(shapePowerVelocity(0.4, 1) > 0.4);
  assert.ok(shapePowerVelocity(0.8, 1) > shapePowerVelocity(0.4, 1));
  assert.equal(powerAccompanimentIntensity(0.6, 0), 0.6);
  assert.ok(powerAccompanimentIntensity(0.6, 1) > 0.6);
  assert.ok(powerAccompanimentIntensity(1, 1) <= 1);
});

test("parallel saturation curve is deterministic, symmetric, and bounded", () => {
  const curve = createPowerSaturationCurve(64);
  assert.equal(curve.length, 64);
  assert.equal(curve[0], -1);
  assert.equal(curve.at(-1), 1);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
    assert.ok(curve[index] >= -1 && curve[index] <= 1);
  }
  for (let index = 0; index < curve.length; index += 1) {
    assert.ok(Math.abs(curve[index] + curve[curve.length - 1 - index]) < 1e-6);
  }
  assert.equal(createPowerSaturationCurve(Number.NaN).length, 1_024);
  assert.equal(createPowerSaturationCurve(Number.POSITIVE_INFINITY).length, 1_024);
  assert.equal(createPowerSaturationCurve(1_000_000).length, 65_536);
});
