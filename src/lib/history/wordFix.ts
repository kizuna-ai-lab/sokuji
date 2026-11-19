// src/lib/history/wordFix.ts
//
// Finding a misheard word in a finished record's text, replacing it, and telling an edit that swaps one word for
// another (owner, 2026-11-19; design §5.1, §5.2). Chinese, Japanese and the like have no spaces between words, so a
// word in them is found anywhere; a Latin word, or one with digits, is found only whole, in any case ("Un" is not in
// "Under", "V3" not in "V30"). The page counts with these before a fix and writes with them, so the count shown is what
// changes.
import type { HistoryNotesBody } from './types';

/** A Latin letter or a digit: what a Latin word's edges must not touch. */
const WORDISH = /[\p{Script=Latin}\p{N}]/u;
const LATIN = /\p{Script=Latin}/u;

const escaped = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where `word` is in `text`, as [start, end) character ranges, in order. */
export function findWord(text: string, word: string): Array<{ start: number; end: number }> {
  if (!word) return [];
  const chars = [...word];
  const before = WORDISH.test(chars[0]) ? '(?<![\\p{Script=Latin}\\p{N}])' : '';
  const after = WORDISH.test(chars[chars.length - 1]) ? '(?![\\p{Script=Latin}\\p{N}])' : '';
  const re = new RegExp(`${before}${escaped(word)}${after}`, LATIN.test(word) ? 'giu' : 'gu');
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** `text` with every `from` written as `to`, and how many there were. */
export function replaceWord(text: string, from: string, to: string): { text: string; count: number } {
  const found = findWord(text, from);
  let out = text;
  for (const { start, end } of [...found].reverse()) out = out.slice(0, start) + to + out.slice(end);
  return { text: out, count: found.length };
}

/** The notes with `from` written as `to` in what people read of them; the names to check are left as they are. */
export function replaceInNotes(body: HistoryNotesBody, from: string, to: string): { body: HistoryNotesBody; count: number } {
  let count = 0;
  const fix = (s: string) => { const r = replaceWord(s, from, to); count += r.count; return r.text; };
  const fixed: HistoryNotesBody = {
    ...body,
    title: fix(body.title),
    overview: { ...body.overview, text: fix(body.overview.text) },
    topics: body.topics.map((t) => ({ ...t, title: fix(t.title), summary: fix(t.summary) })),
    points: body.points.map((p) => (typeof p.owner === 'string' ? { ...p, text: fix(p.text), owner: fix(p.owner) } : { ...p, text: fix(p.text) })),
  };
  return { body: fixed, count };
}

/**
 * The one word `after` puts in place of one in `before`, or null when the edit adds or drops words, or changes
 * nothing. A change inside a Latin word is widened to that whole word ("Un450P三" → "Uniswap V3", not "450P三").
 */
export function swapIn(before: string, after: string): { from: string; to: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  // Nothing taken out, or nothing put in: words added or dropped, not swapped.
  if (start + tail >= before.length || start + tail >= after.length) return null;
  // A change at the edge of a Latin word takes the whole word.
  while (start > 0 && WORDISH.test(before[start - 1])) start -= 1;
  while (tail > 0 && WORDISH.test(before[before.length - tail])) tail -= 1;
  const from = before.slice(start, before.length - tail).trim();
  const to = after.slice(start, after.length - tail).trim();
  if (!from || !to || from === to || /[\r\n]/.test(from) || /[\r\n]/.test(to)) return null;
  return { from, to };
}
