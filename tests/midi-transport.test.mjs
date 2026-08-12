import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeMIDITransportPress,
  isMIDITransportControlPortName,
  resolveMIDITransportIntent,
} from "../lib/midiTransport.ts";

test("decodes MPK play and record presses sent as control changes", () => {
  assert.equal(decodeMIDITransportPress(new Uint8Array([0xb0, 76, 127])), "play");
  assert.equal(decodeMIDITransportPress(new Uint8Array([0xb0, 77, 1])), "record");
});

test("decodes MPK play and record presses sent as note-on messages", () => {
  assert.equal(decodeMIDITransportPress([0x90, 76, 100]), "play");
  assert.equal(decodeMIDITransportPress([0x90, 77, 64]), "record");
});

test("accepts transport messages on any MIDI channel", () => {
  assert.equal(decodeMIDITransportPress([0xbf, 76, 127]), "play");
  assert.equal(decodeMIDITransportPress([0x9a, 77, 127]), "record");
});

test("ignores zero-value releases and note-off messages", () => {
  assert.equal(decodeMIDITransportPress([0xb0, 76, 0]), null);
  assert.equal(decodeMIDITransportPress([0x90, 77, 0]), null);
  assert.equal(decodeMIDITransportPress([0x80, 76, 127]), null);
  assert.equal(decodeMIDITransportPress([0x8f, 77, 127]), null);
});

test("ignores unrelated and malformed MIDI messages", () => {
  for (const message of [
    [0xb0, 75, 127],
    [0x90, 78, 127],
    [0xa0, 76, 127],
    [0xb0, 76],
    [0xb0, 76, 127, 0],
    [0xb0, 128, 127],
    [0xb0, 76, -1],
    [0xb0, 76, 1.5],
  ]) {
    assert.equal(decodeMIDITransportPress(message), null);
  }

  assert.equal(decodeMIDITransportPress(null), null);
  assert.equal(decodeMIDITransportPress(undefined), null);
});

test("recognizes software-facing MPK transport port names case-insensitively", () => {
  for (const name of [
    "MPK mini IV DAW Port",
    "MPK mini IV Plugin Port",
    "MPK mini IV Software Control Port",
    "MPK mini IV Control Port",
    "akai mpk MINI iv daw PORT",
  ]) {
    assert.equal(isMIDITransportControlPortName(name), true, name);
  }
});

test("does not mistake the MPK performance or DIN ports for control ports", () => {
  for (const name of [
    "MPK mini IV MIDI Port",
    "MPK mini IV DIN Port",
    "MPK mini IV",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isMIDITransportControlPortName(name), false, String(name));
  }
});

test("routes Play to toggle or replay unless an overlay is open", () => {
  assert.equal(
    resolveMIDITransportIntent("play", {
      songComplete: false,
      overlayOpen: false,
    }),
    "toggle-play",
  );
  assert.equal(
    resolveMIDITransportIntent("play", {
      songComplete: true,
      overlayOpen: false,
    }),
    "replay",
  );
  assert.equal(
    resolveMIDITransportIntent("play", {
      songComplete: true,
      overlayOpen: true,
    }),
    null,
  );
});

test("routes Record to back or closes the active overlay first", () => {
  assert.equal(
    resolveMIDITransportIntent("record", {
      songComplete: false,
      overlayOpen: false,
    }),
    "back-to-practice",
  );
  assert.equal(
    resolveMIDITransportIntent("record", {
      songComplete: true,
      overlayOpen: false,
    }),
    "back-to-practice",
  );
  assert.equal(
    resolveMIDITransportIntent("record", {
      songComplete: true,
      overlayOpen: true,
    }),
    "close-overlay",
  );
});
