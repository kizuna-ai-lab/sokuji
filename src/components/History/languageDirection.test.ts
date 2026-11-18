import { describe, it, expect } from 'vitest';
import { languageDirection as shown } from './languageDirection';

/** The text as it reads: the marks that keep a right-to-left script in place take no room (arrowBetween.ts). */
const languageDirection = (...args: Parameters<typeof shown>) => shown(...args).replace(/[\u200E\u2066\u2069]/g, '');

// A record keeps "my language" and the other side's (owner, 2026-11-18): shown as they were stored, a session that only
// translated the other side read "Chinese → Japanese" while Japanese was spoken and translated into Chinese.
describe("a session's languages, as the History list and the record page show them", () => {
  const record = { myLanguage: 'zh', targetLanguage: 'ja' };

  it('in "Me": what I speak, into the other side\'s language', () => {
    expect(languageDirection({ ...record, mode: 'speaker' }, 'en')).toBe('Chinese → Japanese');
  });

  it('in "Other": what the other side speaks, into mine', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'en')).toBe('Japanese → Chinese');
  });

  it('in "Both", and face to face: the two, each way', () => {
    expect(languageDirection({ ...record, mode: 'both' }, 'en')).toBe('Chinese ⇄ Japanese');
    expect(languageDirection({ ...record, mode: 'face-to-face' }, 'en')).toBe('Chinese ⇄ Japanese');
  });

  it('names the languages in the interface language', () => {
    expect(languageDirection({ ...record, mode: 'participant' }, 'zh_CN')).toBe('日语 → 中文');
  });

  // Review, 2026-11-18: in Hebrew, Arabic and Persian the arrow pointed the wrong way, the names swapped around it.
  it('keeps the names in their places in a right-to-left script, the arrow pointing the way it says', () => {
    expect(shown({ ...record, mode: 'speaker' }, 'he')).toMatch(/^\u2066\S+\u200E → \u200E\S+\u2069$/);
    expect(shown({ ...record, mode: 'participant' }, 'ar')).toMatch(/^\u2066\S+\u200E → \u200E\S+\u2069$/);
    expect(shown({ ...record, mode: 'both' }, 'fa')).toMatch(/^\u2066\S+\u200E ⇄ \u200E\S+\u2069$/);
  });
});
