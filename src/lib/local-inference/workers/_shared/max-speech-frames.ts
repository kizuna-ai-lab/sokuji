/**
 * How many VAD frames of speech a worker lets one segment run before it
 * force-ends it.
 *
 * The client's "Max Speech Duration" setting is a request, not a fact about
 * the engine. Every engine here has a longest segment it transcribes
 * correctly, none of them says so when it is exceeded, and the ways they fail
 * differ: Whisper's feature extractor silently drops everything past 30 s,
 * Granite and Qwen3-ASR stop at a fixed token budget and post the cut text as
 * an ordinary result, Voxtral Realtime falls behind real time. So each worker
 * states its engine's limit next to the engine code, where the measurement
 * that produced it can be cited, and this module only does the arithmetic —
 * the same way for all of them. A worker whose limit is below the requested
 * value simply cuts sooner; nothing is lost, the next segment picks up at the
 * cut.
 *
 * Measurements: docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md
 * ("How long a segment each engine survives").
 */

export const VAD_SAMPLE_RATE = 16000;
export const VAD_FRAME_SAMPLES = 512; // 32 ms @ 16 kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

/** What the workers used before the setting existed, and still do when the
 *  client sends nothing. */
const DEFAULT_MAX_SPEECH_SECONDS = 20;

export interface SegmentLimit {
  /** Longest speech the engine should be handed in one segment, in seconds.
   *  Behaves exactly like the slider set to this value. */
  maxSpeechSeconds?: number;
  /**
   * Longest whole segment the engine reads, in 16 kHz samples. The pre-speech
   * pad counts against it: vad-web prepends up to `preSpeechPadMs` of audio
   * to the speech it cuts, so the longest segment a worker can emit is pad +
   * cap frames — after silence, after a forced cut that re-acquires the pad,
   * and at a natural end that lands on the cap frame alike.
   */
  maxSegmentSamples?: number;
}

export function resolveMaxSpeechFrames(
  requestedSeconds: number | undefined,
  preSpeechPadMs: number,
  limit: SegmentLimit = {},
): number {
  const framesFor = (seconds: number) => Math.ceil((seconds * 1000) / VAD_FRAME_MS);
  let frames = framesFor(requestedSeconds ?? DEFAULT_MAX_SPEECH_SECONDS);
  if (limit.maxSpeechSeconds !== undefined) {
    frames = Math.min(frames, framesFor(limit.maxSpeechSeconds));
  }
  if (limit.maxSegmentSamples !== undefined) {
    // ceil, where vad-web floors: reserving a frame it may not use can only
    // make the segment shorter than the limit, never longer.
    const padFrames = Math.ceil(preSpeechPadMs / VAD_FRAME_MS);
    frames = Math.min(frames, Math.floor(limit.maxSegmentSamples / VAD_FRAME_SAMPLES) - padFrames);
  }
  return Math.max(1, frames);
}
