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
