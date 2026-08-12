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

register(new URL("./path-alias-loader.mjs", import.meta.url));

const { KeyboardSynth } = await import("../lib/audio.ts");

class FakeAudioParam {
  value = 0;

  setValueAtTime(value) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value) {
    this.value = value;
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
  type = "sine";

  start() {
    this.started = true;
  }

  stop() {
    if (!this.started) {
      throw new DOMException("cannot stop before start", "InvalidStateError");
    }
    this.stopCount += 1;
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
