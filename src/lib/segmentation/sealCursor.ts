/**
 * A cursor into ASR text that survives the text being rewritten around its
 * words.
 *
 * The local clients remember how much of an utterance is already sealed and
 * slice every later hypothesis at that point. The hypotheses do not agree
 * character for character, because a final is usually not the last partial:
 *
 * - it is trimmed while the partial is TextStreamer's untrimmed accumulation
 *   (`' 今天…'`), and cohere joins the two chunks of a long segment without
 *   the space its partials carried at the seam;
 * - the sidecar's gated branch posts the partial unstripped
 *   (`_drive_utterance`) and strips the final (`_finalize`);
 * - a streaming re-decode revises punctuation: moonshine's final dropped a
 *   full stop the partial had (`…family together. I'm` → `…family together
 *   I'm`) and added a comma elsewhere.
 *
 * A cursor counted in characters, or in non-whitespace characters, moves with
 * every one of those. So it is counted in LETTERS AND DIGITS — the same unit
 * `skeleton()` in sentenceEnd.ts compares by, and the only part of the text
 * that spacing and punctuation edits leave alone — and turned back into an
 * offset separately for each text it is applied to.
 *
 * Counting in code points, not UTF-16 units: both functions here walk the
 * same way, so they agree, and nothing outside this module sees the number.
 */

/** True for a character that carries speech: a letter or a digit. */
const SKELETON_RE = /[\p{L}\p{N}]/u;
/** Brackets and initial quotes open the text that follows them, so they
 *  belong to the next chunk rather than the one just sealed. */
const OPENING_RE = /[\p{Ps}\p{Pi}]/u;

/** How many letters and digits `text` holds. */
export function countSkeleton(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (SKELETON_RE.test(ch)) count++;
  }
  return count;
}

/**
 * Where the text after the first `count` letters and digits of `text` begins:
 * 0 for a count of 0, and `text.length` when the text holds no more than
 * `count`.
 *
 * Past the last counted letter it also steps over the whitespace and the
 * closing punctuation that separate it from the next chunk — the marks that
 * ended the sealed sentence, which the count itself cannot see. Without that
 * step a kept full stop would come back as the head of the next chunk, and
 * the rule path would seal it as a bubble of its own. It stops at the first
 * letter or digit, at an opening bracket or quote, or at the end, so it can
 * never consume speech. `LEADING_PUNCT_RE` in sentenceEnd.ts states the same
 * convention: punctuation at the head of a delta belongs to the text before
 * it.
 */
export function offsetAfterSkeleton(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  let offset = 0;
  let counted = false;
  for (const ch of text) {
    if (counted) {
      if (SKELETON_RE.test(ch) || OPENING_RE.test(ch)) return offset;
    } else if (SKELETON_RE.test(ch)) {
      seen++;
      counted = seen === count;
    }
    offset += ch.length;
  }
  return text.length;
}
