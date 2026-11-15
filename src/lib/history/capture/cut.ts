// src/lib/history/capture/cut.ts
//
// The sentence cutter for one source segment, fed every version of the segment in order. A cut is remembered as a
// count of letters and digits, so it survives punctuation filled in later and words rewritten: a sentence's number
// and times never change, its text follows the segment's. No timers: `now` comes in.
import type { Heard } from '../../contract/adapter';
import type { Mark } from '../../conversation/types';
import { SENTENCE_CLOSERS, sentenceEnds } from '../../segmentation/sentenceEnd';
import { countSkeleton } from '../../segmentation/sealCursor';

/** Text after the last sentence end is cut when nothing has grown for this long (inside what may be cut). */
export const PAUSE_CUT_MS = 5000;
/** An open segment that states nothing stable is cut after this long; so is text that began this long ago. */
export const LONG_CUT_MS = 45_000;

export interface CutInput {
  text: string;
  final: boolean;
  openedAt: number;
  marks: readonly Mark[];
  heard?: Heard;
  now: number;
}

export interface CutSentence { index: number; text: string; startAt: number; endAt: number; timeKind: 'given' | 'estimated' }
export interface CutResult { added: CutSentence[]; revised: { index: number; text: string }[] }
export interface SegmentCut { update(input: CutInput): CutResult }

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/u;
/** The marks French and others write after a space. */
const SPACED_TERMINALS = '?!？！';

/** The offset just after the `count`-th letter or digit of `text` (0 for 0; the text's length when it holds fewer). */
function afterCount(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  let offset = 0;
  for (const ch of text) {
    offset += ch.length;
    if (LETTER_OR_DIGIT.test(ch) && ++seen === count) return offset;
  }
  return text.length;
}

/**
 * A stored end in today's text: after the same letter, with the closing punctuation that follows it — and a sentence
 * end after a space, as French writes « Ça va ? », with that space.
 */
function endOf(text: string, count: number): number {
  let end = afterCount(text, count);
  while (end < text.length) {
    const ch = String.fromCodePoint(text.codePointAt(end)!);
    if (LETTER_OR_DIGIT.test(ch)) break;
    if (WHITESPACE.test(ch)) {
      // Only a question or exclamation mark standing on its own after the space: a dot there begins the next sentence.
      let next = end;
      while (next < text.length && WHITESPACE.test(text[next])) next += 1;
      let after = next;
      while (after < text.length && SPACED_TERMINALS.includes(text[after])) after += 1;
      const alone = after === text.length || WHITESPACE.test(text[after]) || SENTENCE_CLOSERS.includes(text[after]);
      if (after > next && alone) { end = next; continue; }
      break;
    }
    end += ch.length;
  }
  return end;
}

interface Stored { endCount: number; lastText: string }

/** A letter or digit of a script that puts spaces between words: a cut between two of them would split a word. */
const IN_SPACED_WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]/u;

/**
 * Where the rest of a final segment (from `from` on, no sentence end in it) is cut, from its growth marks: after the
 * text a 5 s pause followed, and before the growth that would make a stretch longer than LONG_CUT_MS. A cut never
 * falls inside a word of a spaced script: it moves on to the word's end.
 */
function restCuts(text: string, from: number, marks: readonly Mark[]): number[] {
  const out: number[] = [];
  const grown = marks.filter((m) => m.len > from && m.len <= text.length);
  if (grown.length === 0) return out;
  let began = grown[0].at;
  let last = from;
  for (let i = 1; i < grown.length; i++) {
    const before = grown[i - 1];
    const m = grown[i];
    if (m.at - before.at < PAUSE_CUT_MS && m.at - began < LONG_CUT_MS) continue;
    let at = before.len;
    while (at < text.length && IN_SPACED_WORD.test(text[at]) && IN_SPACED_WORD.test(text[at - 1])) at += 1;
    if (at > last && at < text.length && text.slice(last, at).trim() && text.slice(at).trim()) {
      out.push(at);
      last = at;
    }
    began = m.at;
  }
  return out;
}

export function createSegmentCut(): SegmentCut {
  const stored: Stored[] = [];
  // Once a final segment has been cut to its end, its last sentence always runs to the end of the text.
  let toEnd = false;

  /** Each stored sentence's [start, end) in today's text. */
  function spans(text: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let start = 0;
    stored.forEach((s, k) => {
      const end = toEnd && k === stored.length - 1 ? text.length : Math.max(start, endOf(text, s.endCount));
      out.push([start, end]);
      start = end;
    });
    return out;
  }

  function times(input: CutInput, start: number, end: number): Pick<CutSentence, 'startAt' | 'endAt' | 'timeKind'> {
    // Pieces that overlap the sentence: a word's piece may begin on the space before it.
    const pieces = (input.heard?.pieces ?? []).filter((p) => p.at + p.len > start && p.at < end);
    if (pieces.length > 0) {
      const startAt = pieces[0].startAt;
      return { startAt, endAt: Math.max(startAt, pieces[pieces.length - 1].endAt), timeKind: 'given' };
    }
    const startAt = input.marks.find((m) => m.len > start)?.at ?? input.openedAt;
    const endAt = input.marks.find((m) => m.len >= end)?.at ?? input.openedAt;
    return { startAt, endAt: Math.max(startAt, endAt), timeKind: 'estimated' };
  }

  return {
    update(input) {
      const { text } = input;
      const added: CutSentence[] = [];
      const revised: CutResult['revised'] = [];

      // The stored sentences, taken again from today's text.
      const now = spans(text);
      stored.forEach((s, k) => {
        const t = text.slice(now[k][0], now[k][1]).trim();
        if (t !== s.lastText) {
          s.lastText = t;
          revised.push({ index: k, text: t });
        }
      });
      if (toEnd) return { added, revised };

      // What may be cut.
      const ends = sentenceEnds(text);
      let limit: number;
      if (input.final) limit = text.length;
      else if (input.heard) limit = Math.min(text.length, input.heard.stableLen);
      // The sentence still being spoken is never taken: an end where the open text ends may be followed by more.
      else if (input.now - input.openedAt >= LONG_CUT_MS) limit = ends.filter((e) => e < text.trimEnd().length).pop() ?? 0;
      else return { added, revised };

      let from = now.length > 0 ? now[now.length - 1][1] : 0;
      const cut = (end: number, last: boolean) => {
        const sentence = text.slice(from, end);
        const trimmed = sentence.trim();
        if (trimmed) {
          const start = from + (sentence.length - sentence.trimStart().length);
          stored.push({ endCount: countSkeleton(text.slice(0, end)), lastText: trimmed });
          added.push({ index: stored.length - 1, text: trimmed, ...times(input, start, end) });
        }
        from = end;
        if (last) toEnd = true;
      };

      for (const end of ends) if (end > from && end <= limit) cut(end, false);

      // The rest after the last sentence end.
      const rest = text.slice(from, limit);
      if (rest.trim()) {
        if (input.final && limit === text.length) {
          // A rest with no sentence end is cut where the speaker paused, and into stretches of at most LONG_CUT_MS.
          for (const at of restCuts(text, from, input.marks)) cut(at, false);
          cut(text.length, true);
        } else if (!input.final) {
          const lastGrowth = input.marks.length > 0 ? input.marks[input.marks.length - 1].at : input.openedAt;
          const restBegan = input.marks.find((m) => m.len > from)?.at ?? input.openedAt;
          if (input.now - lastGrowth >= PAUSE_CUT_MS || input.now - restBegan >= LONG_CUT_MS) cut(limit, false);
        }
      } else if (input.final && stored.length > 0 && from >= text.trimEnd().length) {
        // Cut to its end by its sentence ends alone: from now on its last sentence runs to the end of the text too.
        toEnd = true;
      }
      return { added, revised };
    },
  };
}
