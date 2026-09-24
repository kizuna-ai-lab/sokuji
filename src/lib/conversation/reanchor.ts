import type { TextRange } from '../contract/adapter';
import { countSkeleton, offsetAfterSkeleton } from '../segmentation/sealCursor';
import { skeleton } from '../segmentation/sentenceEnd';

/**
 * Speech ranges are measured against the text at production time, and the
 * text is replaced repeatedly. Three cases (spec: "Re-anchoring on every text
 * replacement"): the text only grew — ranges stand; the old letters and
 * digits are still where the new text starts, in a different dress and
 * perhaps followed by more — re-anchor by skeleton; letters changed — the
 * ranges are gone, the pcm stays.
 */
export function reanchorRanges(
  oldText: string,
  newText: string,
  ranges: ReadonlyArray<TextRange | undefined>,
): Array<TextRange | undefined> {
  if (ranges.every((r) => r === undefined)) return [...ranges];
  if (newText.startsWith(oldText)) return [...ranges];
  if (skeleton(newText).startsWith(skeleton(oldText))) {
    return ranges.map((r) => (r ? [mapOffset(oldText, newText, r[0]), mapOffset(oldText, newText, r[1])] : undefined));
  }
  return ranges.map(() => undefined);
}

/** The offset in `newText` after as many letters and digits as `oldText` has before `offset`. */
function mapOffset(oldText: string, newText: string, offset: number): number {
  return offsetAfterSkeleton(newText, countSkeleton(oldText.slice(0, offset)));
}
