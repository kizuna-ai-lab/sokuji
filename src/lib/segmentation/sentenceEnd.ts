/**
 * The shared sentence-end rule.
 *
 * Moved out of OpenAILiveClient, which had the only copy: the segmentation
 * stage, the online providers and the local pipeline all have to agree on
 * where a sentence ends, and Intl.Segmenter cannot be that agreement — it
 * finds no boundary at all in unpunctuated text and splits after every
 * abbreviation followed by a capital (measured in the design's Problem
 * section). splitSentences.ts keeps using Intl.Segmenter for TTS chunking,
 * where the only cost of a wrong cut is an extra pause.
 */

/** Marks that can end a sentence. */
export const SENTENCE_TERMINALS = '。．！？!?.';
/** Quotes and brackets that belong to the sentence they close. */
export const SENTENCE_CLOSERS = '"\'”’」』）)]';
/** Marks a long item may be cut at when no sentence end comes. */
export const CLAUSE_MARKS = ',，、;；:：—–';
/** Punctuation and whitespace at the head of a delta belong to the text before it. */
export const LEADING_PUNCT_RE = /^[\s。．！？!?.,，、;；:：—–"'”’」』）)\]]+/;

/**
 * Words whose trailing period is not a sentence end (lower-case, inner dots kept).
 *
 * The English rows are the original OpenAILiveClient set. The rest cover the
 * de/fr/es/pt/ru/it abbreviations the design measured Intl.Segmenter splitting
 * on. Single letters are listed where the language writes them lower-case
 * (German "z. B.", Russian "т. е."); an upper-case single letter is already
 * handled as an initial below.
 */
export const ABBREVIATIONS = new Set([
  // English (unchanged)
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'bros',
  'fig', 'vol', 'al', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
  // German
  'nr', 'bzw', 'ca', 'usw', 'z', 'b', 'd.h', 'u.a', 'evtl', 'ggf', 'abb', 'bspw',
  // French
  'mme', 'mlle', 'cf', 'env', 'av', 'apr', 'p.ex',
  // Spanish and Portuguese
  'sra', 'srta', 'dra', 'ud', 'uds', 'núm', 'pág',
  // Russian
  'т', 'е', 'др', 'тыс', 'руб', 'см', 'стр', 'г', 'гг',
  // Italian
  'sig', 'dott', 'ing', 'avv',
]);

/** True when the period at `dot` is part of an abbreviation, an initial, a
 *  decimal or a dotted token (e.g., U.S., example.com) rather than a sentence end. */
export function periodIsNotSentenceEnd(text: string, dot: number): boolean {
  const next = text[dot + 1];
  if (next !== undefined && /[A-Za-z0-9]/.test(next)) return true; // 3.5, e.g, U.S, a.b
  if (next === '.' || text[dot - 1] === '.') return true; // an ellipsis is a pause, not an end
  if (next === ',' || next === ';' || next === ':') return true; // "Co., Ltd": the clause goes on
  if (next !== undefined && /\s/.test(next) && /^\s+[a-z]/.test(text.slice(dot + 1))) return true; // "no. then"
  let start = dot;
  // \p{L} rather than [A-Za-z] so a Cyrillic or accented abbreviation is read
  // as one word. The forward check above stays ASCII on purpose: widening it
  // would make a period between two CJK characters stop ending a sentence,
  // which is a behaviour change GPT-Live never asked for.
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) start--;
  const word = text.slice(start, dot).replace(/^\.+/, '');
  if (word.length === 0) return false;
  if (word.length === 1 && /[A-Z]/.test(word)) return true; // an initial: "J. Smith"
  return ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Index just past the last sentence end inside `text` (closing quotes and
 * brackets included), or -1 when the text has none. Live places the terminal
 * of one sentence at the end of a delta or at the start of the next one, so
 * callers split the delta itself: `[0, idx)` finishes the current item, the
 * rest opens a new one. `prefix` is the item's transcript so far: a period
 * whose word began in an earlier delta ("Dr" + ". Andrew") is judged on the
 * whole word.
 */
export function lastSentenceEnd(text: string, prefix = ''): number {
  const full = prefix + text;
  for (let i = full.length - 1; i >= prefix.length; i--) {
    const ch = full[i];
    if (!SENTENCE_TERMINALS.includes(ch)) continue;
    if (ch === '.' && periodIsNotSentenceEnd(full, i)) continue;
    let end = i + 1;
    while (end < full.length && SENTENCE_CLOSERS.includes(full[end])) end++;
    return end - prefix.length;
  }
  return -1;
}

/** Index just past the last clause mark in `text`, or -1. */
export function lastClauseEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (CLAUSE_MARKS.includes(text[i])) return i + 1;
  }
  return -1;
}

/**
 * Offsets just past every sentence end in `text`, in order, closers included.
 * The forward twin of lastSentenceEnd, which only reports the last one.
 */
export function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!SENTENCE_TERMINALS.includes(ch)) continue;
    if (ch === '.' && periodIsNotSentenceEnd(text, i)) continue;
    let end = i + 1;
    while (end < text.length && SENTENCE_CLOSERS.includes(text[end])) end++;
    out.push(end);
    i = end - 1;
  }
  return out;
}

/** Offsets just past every sentence end or clause mark, in order. */
export function breakpoints(text: string): number[] {
  const ends = new Set(sentenceEnds(text));
  for (let i = 0; i < text.length; i++) {
    if (CLAUSE_MARKS.includes(text[i])) ends.add(i + 1);
  }
  return [...ends].sort((a, b) => a - b);
}

/**
 * Letters and digits only, lower-cased.
 *
 * Two jobs. It is the identity a punctuation model must preserve — every model
 * rewrites spacing (FireRedPunc re-derives it from an ASCII rule, Edge-Punct
 * collapses runs to single spaces) and two of them recase, so the invariant has
 * to ignore both. And it is the anchor a rewritten ASR partial is realigned
 * against, since punctuation and spacing are exactly what a rewrite churns.
 */
export function skeleton(text: string): string {
  let out = '';
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

/**
 * The base language tag used for model routing.
 *
 * Production language codes are fragmented — PostHog shows zh, zh-CN, cmn-CN
 * and zh_CN all in use for the same language — so everything downstream keys
 * off this, never off the raw setting.
 */
export function baseLang(lang: string): string {
  const base = lang.toLowerCase().replace(/[_-].*$/, '');
  return base === 'cmn' ? 'zh' : base;
}
