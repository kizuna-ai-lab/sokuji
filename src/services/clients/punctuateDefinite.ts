import { sentenceEnds, skeleton } from '../../lib/segmentation/sentenceEnd';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/** How long a definite segment may wait for its punctuation before it is shown
 *  raw. See punctuateDefinite's doc for why it is not the runtime's 3 s. */
const FILL_IN_BUDGET_MS = 1_000;

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
 *
 * Bounded by `FILL_IN_BUDGET_MS`, because callers wait for this answer before
 * they show the segment at all. These providers are the ones chosen for
 * latency, and a visible bubble is worth more than its commas: past the budget
 * the raw text is returned and a late answer is discarded. The runtime's own
 * 3 s inference timeout is the wrong bound here — it is there to stop a wedged
 * worker, not to decide how long a finished sentence may be withheld from the
 * screen. The number is an engineering default above the benchmark's slowest
 * measured call (394 ms, zh, 480 characters, 4-thread WASM) with headroom;
 * Task 6's tuning is where a measured one would come from.
 */
export async function punctuateDefinite(
  runtime: SegmentationRuntime | null,
  lang: string,
  text: string,
  sentencesPerChunk = 3,
): Promise<string> {
  if (!runtime || !runtime.enabled) return text;
  const ends = sentenceEnds(text);
  // Counts only, and before either gate: a segment the server already
  // punctuated, and a segment too short to bother with, are exactly the two
  // cases "how often is punctuation missing" is asking about. `text` itself
  // never crosses — two integers about it do.
  runtime.observe?.({ kind: 'definite', lang, chars: text.length, terminals: ends.length });
  if (text.length < gateChars(lang, sentencesPerChunk)) return text;
  if (ends.length > 0) return text;
  // A runtime is contracted never to reject, but a caller that assigns this
  // unconditionally must not be able to lose a segment if one ever does.
  const answer = runtime.punctuate(lang, text).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FILL_IN_BUDGET_MS);
  });
  const result = await Promise.race([answer, budget]);
  clearTimeout(timer);
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
export interface SegmentLane {
  /**
   * Defer one segment's write.
   *
   * `work` is the punctuated write; it is handed a `cancelled` predicate it
   * must consult after its await, because `flush()` may have written the
   * segment raw in the meantime. `writeRaw` is that fallback: the same write,
   * with the text the server sent.
   */
  queue(work: (cancelled: () => boolean) => Promise<void>, writeRaw: () => void): void;
  /**
   * The session is ending. Write every queued segment that has not been
   * written yet with its raw text, synchronously and in arrival order, and
   * cancel the punctuated counterparts so a late answer writes nothing.
   *
   * Called from every `disconnect()`, because MainPanel's teardown is
   * `await client.disconnect()` then `setItems(client.getConversationItems())`
   * — anything the lane has not written by then is a sentence the user said
   * and never gets back. Synchronous by contract: Stop must not wait out the
   * fill-in budget.
   */
  flush(): void;
}

export function createSegmentLane(): SegmentLane {
  let tail: Promise<void> = Promise.resolve();
  /** Queued pieces that have not written yet, in arrival order. */
  let unwritten: Array<{ raw: () => void; written: boolean }> = [];
  return {
    queue(work, writeRaw) {
      const piece = { raw: writeRaw, written: false };
      unwritten.push(piece);
      tail = tail.then(async () => {
        // flush() already wrote this one raw while it waited its turn.
        if (piece.written) return;
        try {
          await work(() => piece.written);
        } finally {
          piece.written = true;
          const at = unwritten.indexOf(piece);
          if (at !== -1) unwritten.splice(at, 1);
        }
      }).catch(() => {});
    },
    flush() {
      const queued = unwritten;
      unwritten = [];
      for (const piece of queued) {
        if (piece.written) continue;
        // Set BEFORE the write, so the punctuated counterpart of a piece that
        // is already awaiting its answer sees `cancelled()` the moment it
        // resumes — whichever order the two land in.
        piece.written = true;
        try {
          piece.raw();
        } catch {
          // One item's write failing must not cost the rest of them theirs.
        }
      }
    },
  };
}
