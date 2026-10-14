import type { ReadingLanguage } from './types';

const TRADITIONAL_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);
const NONE: ReadonlySet<ReadingLanguage> = new Set();

/**
 * The reading language of an app language code, or null. Traditional Chinese and
 * Cantonese have none in phase 1 (pinyin-pro misreads traditional text; the spec's
 * "Measured").
 */
export function readingLanguage(code: string | null | undefined): ReadingLanguage | null {
  if (!code || code === 'auto' || code.includes('+')) return null;
  const [primary, ...subtags] = code.toLowerCase().split('-');
  if (primary === 'zh' || primary === 'cmn') {
    return subtags.some((s) => TRADITIONAL_SUBTAGS.has(s)) ? null : 'zh';
  }
  if (primary === 'ja' || primary === 'ko' || primary === 'ru' || primary === 'uk') return primary;
  return null;
}

/** The reading languages of a pair's target; a bidirectional code (`zh+en`) contributes each half (R13). */
export function readingTargets(target: string | null | undefined): ReadonlySet<ReadingLanguage> {
  if (!target) return NONE;
  const out = new Set<ReadingLanguage>();
  for (const half of target.split('+')) {
    const lang = readingLanguage(half);
    if (lang) out.add(lang);
  }
  return out;
}
