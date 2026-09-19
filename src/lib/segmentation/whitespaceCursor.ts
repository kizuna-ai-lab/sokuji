/**
 * A cursor into ASR text that survives the text being re-spaced.
 *
 * The local clients remember how much of an utterance is already sealed and
 * slice every later hypothesis at that point. The hypotheses are not spaced
 * alike, though: a worker's partial is TextStreamer's untrimmed accumulation
 * (' 今天…', and a second space at a chunk seam), while its final is trimmed
 * and joined without the seam space. A cursor kept as a plain character
 * offset into the partial lands too far into the final by exactly the
 * whitespace the final lacks — deleting one real character per utterance in
 * Chinese or Japanese, and nothing anyone notices in English, where the
 * character deleted is the space between two sentences.
 *
 * So the cursor is kept as a count of NON-WHITESPACE UTF-16 units, which is
 * the same number in every spacing of the same words, and turned back into an
 * offset separately for each text it is applied to.
 */

const WHITESPACE = /\s/;

/** How many UTF-16 units of `text` are not whitespace. */
export function countNonWhitespace(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (!WHITESPACE.test(text[i])) count++;
  }
  return count;
}

/**
 * The offset in `text` just past its first `count` non-whitespace UTF-16
 * units: 0 for a count of 0, so leading whitespace stays with the remainder,
 * and `text.length` when the text holds no more than `count`.
 *
 * Whitespace that follows the last counted unit is left with the remainder,
 * which is where SentenceStream's own cuts leave it — every cut it makes
 * lands right after a punctuation mark or a letter.
 */
export function offsetAfterNonWhitespace(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (WHITESPACE.test(text[i])) continue;
    seen++;
    if (seen === count) return i + 1;
  }
  return text.length;
}
