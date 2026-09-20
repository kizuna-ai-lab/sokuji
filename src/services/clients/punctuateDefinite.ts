import { sentenceEnds, skeleton } from '../../lib/segmentation/sentenceEnd';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/** How long a definite segment may wait for its punctuation before it is shown
 *  raw. See punctuateDefinite's doc for why it is not the runtime's 3 s. */
const FILL_IN_BUDGET_MS = 1_000;

/**
 * Fill in missing punctuation on a segment the server already decided.
 *
 * Boundaries are the server's and are never touched: these providers close a
 * segment on their own signal (Soniox's <end>, Volcengine's Definite,
 * Palabra's validated_transcription, a server turn, one Zoom REST utterance).
 * The only change is the text.
 *
 * This is the whole of Auto, and the whole of what OpenAI Realtime GA and the
 * OpenAI-compatible provider ever do — their items carry per-item audio
 * timing, so a cut would strand it. A provider that CAN be cut calls
 * `punctuateAndSplitDefinite` instead, which adds cuts inside this same
 * boundary at a size of 1-5 (A2's revision of D6).
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
  // 0 is Auto — "punctuate, do not split" — and the gate still has to mean
  // something there, or `gateChars(lang, 0)` is zero and every three-word
  // segment waits out the fill-in budget for marks it does not need. Auto
  // asks the same question a bubble of three sentences would.
  const gateSentences = sentencesPerChunk > 0 ? sentencesPerChunk : DEFAULT_CHUNK_SENTENCES;
  if (text.length < gateChars(lang, gateSentences)) return text;
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
 * Fill in missing punctuation on a segment the server already decided, and cut
 * it into the pieces the user asked for.
 *
 * The same call as `punctuateDefinite` with a second job: A2 revises D6's
 * "never split". A size of 0 is Auto and still means "punctuate, do not split",
 * so it returns exactly one piece — the string `punctuateDefinite` returns, and
 * nothing else. A size of 1-5 cuts the punctuated text after every Nth sentence
 * end, with whatever is left over as a last piece.
 *
 * What it will not do is move the server's own boundary. Every cut is *inside*
 * the segment it was handed: the pieces rejoin to it in order, two segments are
 * never merged, and the outer edges are exactly where the server put them. A
 * segment with fewer than N sentence ends — including one the model declined to
 * punctuate — comes back whole, because there is nothing to count into.
 *
 * The cut positions come from `sentenceEnds`, the one rule the whole stage
 * counts with, so "Dr. Smith went home." is one sentence here exactly as it is
 * to a `SentenceStream`.
 *
 * A caller on a `SegmentLane` writes all of one segment's pieces inside ONE
 * queued work item. The lane orders segments against each other; the pieces of
 * a segment are one unit within it, and must not have the next segment's write
 * land between them.
 */
export async function punctuateAndSplitDefinite(
  runtime: SegmentationRuntime | null,
  lang: string,
  text: string,
  sentencesPerChunk: number,
): Promise<string[]> {
  const filled = await punctuateDefinite(runtime, lang, text, sentencesPerChunk);
  return splitDefinite(filled, sentencesPerChunk);
}

/**
 * `text` cut after every `n`th sentence end, remainder last. `n` of 0 (Auto),
 * and a text with fewer than `n` sentence ends, are returned as one piece.
 *
 * Pieces are trimmed and empty ones dropped: a cut lands just past a terminal,
 * so the next piece would otherwise open with the space that separated the two
 * sentences, and a text ending exactly on its Nth end would produce a bubble
 * with nothing in it.
 *
 * Exported for the raw path only — `SegmentLane.flush()`'s fallback, which
 * runs at Stop and must be synchronous. A segment the server punctuated itself
 * still splits there; one the model never got to does not, because there is
 * nothing to count. Everything else goes through `punctuateAndSplitDefinite`.
 */
export function splitDefinite(text: string, n: number): string[] {
  if (n <= 0) return [text];
  const ends = sentenceEnds(text);
  if (ends.length < n) return [text];
  const pieces: string[] = [];
  let start = 0;
  for (let i = n - 1; i < ends.length; i += n) {
    pieces.push(text.slice(start, ends[i]));
    start = ends[i];
  }
  if (start < text.length) pieces.push(text.slice(start));
  const kept = pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
  // Unreachable with any real segment — a text with a sentence end has a
  // non-empty piece — but a caller that assigns this must never be handed an
  // empty list and lose the segment.
  return kept.length > 0 ? kept : [text];
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
