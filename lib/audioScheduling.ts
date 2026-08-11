/**
 * Schedule a one-shot Web Audio source with the lifecycle ordering required by
 * AudioScheduledSourceNode: a source must be started before it can be stopped.
 */
export function scheduleAudioSourceWindow(
  source: Pick<AudioScheduledSourceNode, "start" | "stop">,
  startAt: number,
  stopAt: number,
): void {
  source.start(startAt);
  source.stop(stopAt);
}

export interface ScheduledVoiceNote {
  id: string;
  startBeat: number;
  durationBeats: number;
}

export function transportSubdivisionAtBeat(
  beat: number,
  subdivisionsPerBeat = 2,
): number {
  const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  const safeSubdivisions =
    Number.isInteger(subdivisionsPerBeat) && subdivisionsPerBeat > 0
      ? subdivisionsPerBeat
      : 1;
  return Math.floor(safeBeat * safeSubdivisions + 0.000_001);
}

/**
 * Reconciles transport-owned voices without allowing a Web Audio failure to
 * abort the caller's animation frame. An attempted start is recorded before
 * invoking audio so a broken source is not retried on every RAF tick; the id
 * is released normally once its musical window ends.
 */
export function reconcileScheduledVoices<TNote extends ScheduledVoiceNote>(
  notes: readonly TNote[],
  beat: number,
  activeIds: Set<string>,
  startVoice: (note: TNote) => void,
  stopVoice: (note: TNote) => void,
): void {
  for (const note of notes) {
    const active =
      beat >= note.startBeat && beat < note.startBeat + note.durationBeats;
    if (active && !activeIds.has(note.id)) {
      activeIds.add(note.id);
      try {
        startVoice(note);
      } catch {
        // The transport must continue even if Web Audio rejects one source.
      }
    } else if (!active && activeIds.has(note.id)) {
      activeIds.delete(note.id);
      try {
        stopVoice(note);
      } catch {
        // Voice bookkeeping still clears so loops can retry on the next pass.
      }
    }
  }
}
