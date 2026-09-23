import { sentenceEnds, skeleton } from '../segmentation/sentenceEnd';

/** Asks a punctuation model for `text` with marks. Null: no answer. */
export type Punctuator = (lang: string, text: string) => Promise<string | null>;

/**
 * Punctuation fill-in, once, when a segment goes final. Text that already
 * carries a sentence end is returned untouched (the local engines punctuate
 * themselves). An answer that alters letters or digits is discarded — that
 * invariant is what lets the speech ranges survive the replacement.
 */
export async function fillIn(lang: string, text: string, punctuate: Punctuator): Promise<string> {
  if (text.length === 0 || sentenceEnds(text).length > 0) return text;
  let filled: string | null;
  try {
    filled = await punctuate(lang, text);
  } catch {
    filled = null;
  }
  if (!filled || skeleton(filled) !== skeleton(text)) return text;
  return filled;
}
