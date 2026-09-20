import { sentenceEnds, skeleton } from '../../lib/segmentation/sentenceEnd';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/**
 * Fill in missing punctuation on a segment the server already decided.
 *
 * Boundaries are the server's and are never touched: these providers split on
 * their own signal (Soniox's <end>, Volcengine's Definite, Palabra's
 * validated_transcription, a server turn, one Zoom REST utterance), and a
 * client-side split would fight it. The only change is the text.
 *
 * Returns the input unchanged on every failure path, so a caller can assign
 * the result unconditionally.
 */
export async function punctuateDefinite(
  runtime: SegmentationRuntime | null,
  lang: string,
  text: string,
  sentencesPerChunk = 3,
): Promise<string> {
  if (!runtime || !runtime.enabled) return text;
  if (text.length < gateChars(lang, sentencesPerChunk)) return text;
  if (sentenceEnds(text).length > 0) return text;
  // A runtime is contracted never to reject, but a caller that assigns this
  // unconditionally must not be able to lose a segment if one ever does.
  const result = await runtime.punctuate(lang, text).catch(() => null);
  if (!result) return text;
  if (skeleton(result.text) !== skeleton(text)) return text;
  return result.text;
}

/**
 * A one-at-a-time lane for the writes that follow a `punctuateDefinite` call.
 *
 * `punctuateDefinite` resolves in a microtask when it has nothing to do and in
 * tens of milliseconds when the model actually runs, so two segments that
 * became definite in order can finish out of order — and a client that assigns
 * each answer as it lands would list the later segment first. Every client
 * therefore queues its assignment here, and the lane runs the queued pieces in
 * the order they arrived.
 *
 * The lane orders the *writes* only. A caller starts its `punctuateDefinite`
 * call before queueing and awaits that promise inside the queued work, so two
 * segments still punctuate concurrently and one slow model call does not add
 * its latency to the next segment.
 *
 * A rejection cannot wedge the lane: the next piece runs regardless.
 */
export function createSegmentLane(): (work: () => Promise<void>) => void {
  let tail: Promise<void> = Promise.resolve();
  return (work) => { tail = tail.then(work).catch(() => {}); };
}
