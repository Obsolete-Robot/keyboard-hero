const KEYBOARD_MIDI_MIN = 48;
const KEYBOARD_MIDI_MAX = 72;

/** Maps a raw device pitch into the 25-key curriculum without clamping. */
export function mapMIDINoteToKeyboardRange(
  rawMidi: number,
  transpose: number,
): number | null {
  if (
    !Number.isInteger(rawMidi) ||
    rawMidi < 0 ||
    rawMidi > 127 ||
    !Number.isInteger(transpose)
  ) {
    return null;
  }
  const mapped = rawMidi + transpose;
  return mapped >= KEYBOARD_MIDI_MIN && mapped <= KEYBOARD_MIDI_MAX
    ? mapped
    : null;
}

export function isValidMIDICalibrationSpan(
  leftRaw: number,
  rightRaw: number,
): boolean {
  return (
    Number.isInteger(leftRaw) &&
    Number.isInteger(rightRaw) &&
    leftRaw >= 0 &&
    rightRaw <= 127 &&
    rightRaw - leftRaw === KEYBOARD_MIDI_MAX - KEYBOARD_MIDI_MIN
  );
}
