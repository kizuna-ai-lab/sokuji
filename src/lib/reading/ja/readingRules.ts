import type { JaToken } from './furigana';

/** A token where furigana() found it in the text: what lies before it, and the token. */
export interface PlacedToken {
  gap: string;
  token: JaToken;
}

// IPADIC reads a numeral and its counter piece by piece (三日 さん にち, 一人 いち にん,
// 4月 つき) and 空く by its あく entry whatever precedes it. These rules correct only
// what the neighbouring tokens settle; what the meaning alone settles (辛い, その方が)
// stays IPADIC's reading (#545).

const DAYS: Readonly<Record<number, string>> = {
  2: 'フツカ', 3: 'ミッカ', 4: 'ヨッカ', 5: 'イツカ', 6: 'ムイカ', 7: 'ナノカ', 8: 'ヨウカ', 9: 'ココノカ', 10: 'トオカ',
  14: 'ジュウヨッカ', 20: 'ハツカ', 24: 'ニジュウヨッカ',
};
const PEOPLE: Readonly<Record<number, string>> = { 1: 'ヒトリ', 2: 'フタリ', 4: 'ヨニン' };
const MONTHS = ['', 'イチ', 'ニ', 'サン', 'シ', 'ゴ', 'ロク', 'シチ', 'ハチ', 'ク', 'ジュウ', 'ジュウイチ', 'ジュウニ'];

const NUMERAL = /^[0-9０-９〇一二三四五六七八九十百]+$/;
const KANJI_DIGITS = '〇一二三四五六七八九';
const BELLY = new Set(['お腹', 'おなか', '腹']);
const PARTICLES = new Set(['が', 'も', 'は', 'を']);

/** A numeral's value, written in digits or in kanji up to the hundreds; null for anything else. */
function numeralValue(s: string): number | null {
  if (/^[0-9０-９]+$/.test(s)) return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  let total = 0;
  let digit: number | null = null;
  for (const c of s) {
    const d = KANJI_DIGITS.indexOf(c);
    if (d >= 0) {
      if (digit !== null) return null;
      digit = d;
    } else if (c === '十' || c === '百') {
      total += (digit ?? 1) * (c === '十' ? 10 : 100);
      digit = null;
    } else {
      return null;
    }
  }
  return total + (digit ?? 0);
}

/** The reading of a numeral and its counter together, or null where IPADIC's piece-by-piece reading is right. */
function counterReading(value: number, counter: string, before: string | undefined): string | null {
  switch (counter) {
    case '人': return PEOPLE[value] ?? null;
    // 一日 is いちにち (a day) unless a month precedes it.
    case '日': return value === 1 ? (before?.endsWith('月') ? 'ツイタチ' : null) : DAYS[value] ?? null;
    case '日間': return DAYS[value] ? `${DAYS[value]}カン` : null;
    case '歳': return value === 20 ? 'ハタチ' : null;
    case '月': return MONTHS[value] ? `${MONTHS[value]}ガツ` : null;
    default: return null;
  }
}

function afterBelly(out: readonly PlacedToken[]): boolean {
  const prev = out[out.length - 1]?.token.surface;
  if (prev === undefined) return false;
  return BELLY.has(prev) || (PARTICLES.has(prev) && BELLY.has(out[out.length - 2]?.token.surface ?? ''));
}

/**
 * The tokens with those readings corrected. A numeral and the counter right after
 * it (no gap) become one token with one reading, which furigana() draws over both.
 */
export function applyReadingRules(placed: readonly PlacedToken[]): PlacedToken[] {
  const out: PlacedToken[] = [];
  for (let i = 0; i < placed.length; i++) {
    const { gap, token } = placed[i];
    if (NUMERAL.test(token.surface)) {
      let end = i + 1;
      while (end < placed.length && !placed[end].gap && NUMERAL.test(placed[end].token.surface)) end++;
      const run = placed.slice(i, end);
      const numeral = run.map((p) => p.token.surface).join('');
      const counter = end < placed.length && !placed[end].gap ? placed[end].token.surface : null;
      const value = numeralValue(numeral);
      const reading = counter !== null && value !== null ? counterReading(value, counter, out[out.length - 1]?.token.surface) : null;
      if (reading) {
        out.push({ gap, token: { surface: numeral + counter, reading, unknown: false } });
        i = end;
      } else {
        // The whole numeral, so 十一人 is not read from its 一.
        out.push(...run);
        i = end - 1;
      }
      continue;
    }
    if (token.surface.startsWith('空') && token.reading?.startsWith('ア') && afterBelly(out)) {
      out.push({ gap, token: { ...token, reading: `ス${token.reading.slice(1)}` } });
      continue;
    }
    out.push(placed[i]);
  }
  return out;
}
