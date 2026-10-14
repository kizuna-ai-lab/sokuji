import { describe, it, expect } from 'vitest';
import { readingLanguage, readingTargets } from './languages';

describe('readingLanguage', () => {
  it.each([
    ['zh', 'zh'], ['zh-Hans', 'zh'], ['zh-CN', 'zh'], ['cmn', 'zh'],
    ['ja', 'ja'], ['ja-JP', 'ja'], ['ko', 'ko'], ['ko-KR', 'ko'], ['ru', 'ru'], ['ru-RU', 'ru'], ['uk', 'uk'],
  ])('reads %s as %s', (code, lang) => {
    expect(readingLanguage(code)).toBe(lang);
  });

  it.each(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-Hant-TW', 'yue', 'en', 'auto', 'zh+en', '', null, undefined])('has no reading language for %s', (code) => {
    expect(readingLanguage(code)).toBeNull();
  });
});

describe('readingTargets', () => {
  it("is the target's reading language", () => {
    expect([...readingTargets('ja')]).toEqual(['ja']);
  });
  it('takes each half of a bidirectional pair', () => {
    expect([...readingTargets('zh+en')]).toEqual(['zh']);
  });
  it('is empty for a target without a scheme, and for none', () => {
    expect(readingTargets('en').size).toBe(0);
    expect(readingTargets(null).size).toBe(0);
  });
});
