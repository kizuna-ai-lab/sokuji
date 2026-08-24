import { describe, it, expect } from 'vitest';
import { matchLanguage, defaultLanguagePair } from './languageDefaults';

const opt = (value: string) => ({ value, name: value, englishName: value });
const L = ['en', 'zh_CN', 'ja-JP', 'es'].map(opt);

describe('matchLanguage', () => {
  it('matches exact, then case/separator-insensitively, then by primary subtag', () => {
    expect(matchLanguage(L, 'en')).toBe('en');
    expect(matchLanguage(L, 'zh-cn')).toBe('zh_CN');
    expect(matchLanguage(L, 'ja')).toBe('ja-JP');
    expect(matchLanguage(L, 'zh')).toBe('zh_CN');
    expect(matchLanguage(L, 'fr')).toBeNull();
  });
});

describe('defaultLanguagePair (spec §1.2 step 4)', () => {
  const targetsFor = () => L;
  const providerDefault = { source: 'es', target: 'ja-JP' };

  it('uses the interface language as source and English as target when both are offered', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'zh_CN', providerDefault })).toEqual({ source: 'zh_CN', target: 'en' });
  });

  it('falls back to the provider default source when the UI language is not offered', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'fr', providerDefault })).toEqual({ source: 'es', target: 'en' });
  });

  it('falls the target to the provider default when source and target would coincide', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'en', providerDefault })).toEqual({ source: 'en', target: 'ja-JP' });
  });

  it('respects a source-dependent target list', () => {
    const only = (s: string) => (s === 'en' ? [opt('ja-JP')] : L);
    expect(defaultLanguagePair({ sources: L, targetsFor: only, uiLanguage: 'en', providerDefault })).toEqual({ source: 'en', target: 'ja-JP' });
  });

  it('picks the first target the list offers when neither English nor the default is in it', () => {
    const onlyEs = () => [opt('es')];
    expect(defaultLanguagePair({ sources: L, targetsFor: onlyEs, uiLanguage: 'ja', providerDefault })).toEqual({ source: 'ja-JP', target: 'es' });
  });
});
