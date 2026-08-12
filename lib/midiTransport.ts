export type MIDITransportAction = "play" | "record";

export type MIDITransportIntent =
  | "replay"
  | "toggle-play"
  | "back-to-practice"
  | "close-overlay";

export interface MIDITransportContext {
  songComplete: boolean;
  overlayOpen: boolean;
}

const PLAY_STOP_CONTROL = 76;
const RECORD_CONTROL = 77;

function isMIDIStatusByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

function isMIDIDataByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x7f;
}

/** Decodes a pressed MPK Mini IV transport control from one MIDI message. */
export function decodeMIDITransportPress(
  data: ArrayLike<number> | null | undefined,
): MIDITransportAction | null {
  if (data?.length !== 3) return null;

  const status = data[0];
  const control = data[1];
  const value = data[2];
  if (
    !isMIDIStatusByte(status) ||
    !isMIDIDataByte(control) ||
    !isMIDIDataByte(value)
  ) {
    return null;
  }

  const messageType = status & 0xf0;
  const isPressMessage = messageType === 0xb0 || messageType === 0x90;
  if (!isPressMessage || value === 0) return null;

  if (control === PLAY_STOP_CONTROL) return "play";
  if (control === RECORD_CONTROL) return "record";
  return null;
}

/** Resolves a decoded hardware action against the current practice UI state. */
export function resolveMIDITransportIntent(
  action: MIDITransportAction,
  { songComplete, overlayOpen }: MIDITransportContext,
): MIDITransportIntent | null {
  if (overlayOpen) return action === "record" ? "close-overlay" : null;
  if (action === "record") return "back-to-practice";
  return songComplete ? "replay" : "toggle-play";
}

/** Identifies the MPK's software-facing transport/control MIDI ports. */
export function isMIDITransportControlPortName(
  name: string | null | undefined,
): boolean {
  return (
    typeof name === "string" &&
    /\b(?:daw|plugin|(?:software\s+)?control)\s+port\b/i.test(name)
  );
}
