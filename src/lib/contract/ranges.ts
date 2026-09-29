/**
 * Ranges filled in once a segment's speech has ended (spec: "A range known
 * only later is filled in"): the span divided among the speech entries by
 * their sample counts. Written for Soniox's TTS segments (Stage 2 Soniox,
 * choice 4) and lifted here at its second user, Palabra's sentences
 * (Stage 2 Palabra, ruling 6; choice 2): a provider never imports another
 * provider's folder. Pure.
 */
import type { TextRange } from './adapter';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A segment's span divided among its chunks in proportion to their sample
 * counts (every count positive), so consecutive ranges tile the span; the
 * last ends at the span's end. A boundary inside a surrogate pair moves
 * past it (Stage 2 Soniox, choice 4). `text` is the ref's text the span indexes.
 */
export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
  const [a, b] = span;
  const total = samples.reduce((sum, n) => sum + n, 0);
  const out: TextRange[] = [];
  let start = a;
  let cum = 0;
  samples.forEach((n, k) => {
    cum += n;
    let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
    if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
    out.push([start, end]);
    start = end;
  });
  return out;
}
