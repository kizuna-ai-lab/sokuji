/**
 * Where a stretch of audio the VAD hands over began in the audio a worker was fed since init. A segment (from the
 * FrameProcessor or the turn gate's window) ends at the frame just processed and runs back over its own length, its
 * pre-speech pad included, so a result's `startSample` and `durationMs` describe the same stretch of audio — the frame
 * speech was detected at comes a pad later.
 */
export function segmentStartSample(samplesFed: number, audio: Float32Array): number {
  return Math.max(0, samplesFed - audio.length);
}
