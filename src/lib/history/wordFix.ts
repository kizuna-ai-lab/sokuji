// src/lib/history/wordFix.ts
//
// Finding a misheard word in a finished record's text, replacing it, and telling an edit that swaps one word for
// another (owner, 2026-11-19; design §5.1, §5.2). Chinese, Japanese and the like have no spaces between words, so a
// word in them is found anywhere; a word in a script written with spaces between words (Latin, Cyrillic, Greek,
// Armenian), or one with digits, is found only whole, in any case ("Un" is not in "Under", "V3" not in "V30", "кот" not
// in "который"). A place already written right is left out ("ソク" is not counted inside "ソクジ"). The page counts
// with these before a fix and writes with them, so the count shown is what changes.
import type { HistoryNotesBody } from './types';

/** A letter of a script written with spaces between words, or a digit: what such a word's edges must not touch. */
const SPACED = '\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Armenian}\\p{N}';
const WORDISH = new RegExp(`[${SPACED}]`, 'u');
const CASED = /[\p{Lu}\p{Ll}]/u;

const escaped = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every place `text` reads exactly `word`, as [start, end) ranges. */
function exactly(text: string, word: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) out.push({ start: at, end: at + word.length });
  return out;
}

/**
 * Where `word` is in `text`, as [start, end) character ranges, in order. With `right`, the word as it should be
 * written, a place inside `right` already written so is left out.
 */
export function findWord(text: string, word: string, right?: string): Array<{ start: number; end: number }> {
  if (!word) return [];
  const chars = [...word];
  const before = WORDISH.test(chars[0]) ? `(?<![${SPACED}])` : '';
  const after = WORDISH.test(chars[chars.length - 1]) ? `(?![${SPACED}])` : '';
  const re = new RegExp(`${before}${escaped(word)}${after}`, CASED.test(word) ? 'giu' : 'gu');
  const found = [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!right || right === word) return found;
  const kept = exactly(text, right);
  return found.filter((f) => !kept.some((k) => k.start <= f.start && f.end <= k.end));
}

/** `text` with every `from` written as `to`, and how many there were; places already reading `to` are left alone. */
export function replaceWord(text: string, from: string, to: string): { text: string; count: number } {
  const found = findWord(text, from, to);
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
 * The one word `after` puts in place of one in `before`, or null when the edit adds or drops whole words, or changes
 * nothing. A change touching a word written with spaces takes that whole word: letters added to it, dropped from it or
 * changed in it ("Sok" → "Sokuji", "Un450P三" → "Uniswap V3", not "450P三").
 */
export function swapIn(before: string, after: string): { from: string; to: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  // What changed, in each: one may be empty (letters or words only added, or only dropped).
  const taken = () => before.slice(start, before.length - tail);
  const put = () => after.slice(start, after.length - tail);
  const wordish = (c: string | undefined) => c !== undefined && WORDISH.test(c);
  // A change whose edge is inside a word takes the whole word.
  const leftIn = () => wordish(before[start - 1]) && (wordish(taken()[0]) || wordish(put()[0]));
  const rightIn = () => wordish(before[before.length - tail]) && (wordish(taken().slice(-1)) || wordish(put().slice(-1)));
  if (leftIn()) while (start > 0 && wordish(before[start - 1])) start -= 1;
  if (rightIn()) while (tail > 0 && wordish(before[before.length - tail])) tail -= 1;
  // Still nothing taken out, or nothing put in: whole words added or dropped, not swapped.
  if (!taken().trim() || !put().trim()) return null;
  const from = taken().trim();
  const to = put().trim();
  if (from === to || /[\r\n]/.test(from) || /[\r\n]/.test(to)) return null;
  return { from, to };
}
