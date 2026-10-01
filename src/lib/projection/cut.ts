import type { TextRange } from '../contract/adapter';
import type { Mark, Segment } from '../conversation/types';
import { sentenceEnds } from '../segmentation/sentenceEnd';
import type { CutSettings, Row } from './types';

/**
 * `text` cut after every `n`th sentence end. The ranges tile the text — no
 * gaps, no trimming — so adjacent rows concatenated reproduce it exactly; a
 * bubble surface trims for display, a band surface joins with nothing.
 */
export function cutRanges(text: string, n: number): TextRange[] {
  if (text.length === 0) return [[0, 0]];
  if (n <= 0) return [[0, text.length]];
  const ends = sentenceEnds(text);
  if (ends.length < n) return [[0, text.length]];
  const out: TextRange[] = [];
  let start = 0;
  for (let i = n - 1; i < ends.length; i += n) {
    if (ends[i] > start) {
      out.push([start, ends[i]]);
      start = ends[i];
    }
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

/** The text lengths at which a pause of at least `pauseMs` began. */
export function pauseCuts(marks: readonly Mark[], pauseMs: number, textLength: number): number[] {
  if (pauseMs <= 0) return [];
  const cuts: number[] = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const len = marks[k].len;
    if (marks[k + 1].at - marks[k].at < pauseMs) continue;
    if (len <= 0 || len >= textLength) continue;
    if (cuts.length > 0 && cuts[cuts.length - 1] >= len) continue;
    cuts.push(len);
  }
  return cuts;
}

function rangesFromCuts(length: number, cuts: number[]): TextRange[] {
  const out: TextRange[] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut > start && cut < length) {
      out.push([start, cut]);
      start = cut;
    }
  }
  out.push([start, length]);
  return out;
}

/** A segment's rows under the settings. An open segment is cut like a closed
 *  one — its last row is the live one — and a pause cut applies to open and
 *  closed alike, with the pause of the segment's own side. A segment with no
 *  visible text has no rows. */
export function cutSegment(seg: Segment, settings: CutSettings): Row[] {
  if (seg.text.trim().length === 0) return [];
  let ranges: TextRange[];
  if (settings.mode === 'sentences') {
    ranges = cutRanges(seg.text, settings.sentencesPerRow);
  } else if (settings.mode === 'pause') {
    const pauseMs = seg.side === 'source' ? settings.sourcePauseMs : settings.translationPauseMs;
    ranges = rangesFromCuts(seg.text.length, pauseCuts(seg.marks, pauseMs, seg.text.length));
  } else {
    ranges = [[0, seg.text.length]];
  }
  return withoutBlankRanges(seg.text, ranges).map(([start, end], k) => ({
    key: `${seg.id}:${k}`,
    segmentId: seg.id,
    side: seg.side,
    start,
    end,
    text: seg.text.slice(start, end),
    final: seg.final,
    ...(seg.language !== undefined ? { language: seg.language } : {}),
  }));
}

/**
 * A range holding only whitespace joins the range before it — or, at the
 * start, the one after — so no row is blank and the ranges still tile the
 * text. The caller has checked that the text is not blank as a whole.
 */
function withoutBlankRanges(text: string, ranges: TextRange[]): TextRange[] {
  const out: TextRange[] = [];
  let carried: number | null = null;
  for (const [start, end] of ranges) {
    if (text.slice(start, end).trim().length === 0) {
      if (out.length > 0) out[out.length - 1] = [out[out.length - 1][0], end];
      else carried ??= start;
      continue;
    }
    out.push([carried ?? start, end]);
    carried = null;
  }
  return out;
}
