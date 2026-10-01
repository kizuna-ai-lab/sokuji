import { describe, expect, it } from 'vitest';
import { englishLanguageName, languageLabel, uiLocale } from './label';

describe('uiLocale', () => {
  it("turns an i18next id into a BCP-47 locale, English when there is none", () => {
    expect(uiLocale('zh_TW')).toBe('zh-TW');
    expect(uiLocale('pt_BR')).toBe('pt-BR');
    expect(uiLocale('ja')).toBe('ja');
    expect(uiLocale(undefined)).toBe('en');
    expect(uiLocale('cimode')).toBe('en');
  });
});

describe('languageLabel', () => {
  // Never a pinned CLDR string: ICU differs between Node and Chromium versions.
  const named = (code: string, ui: string) => {
    const label = languageLabel(code, ui);
    expect(label, `${code} in ${ui}`).not.toBe('');
    expect(label, `${code} in ${ui}`).not.toBe(code);
    return label;
  };

  it('names a tag in the UI language, script and region kept apart', () => {
    for (const ui of ['en', 'ja', 'zh_CN', 'zh_TW', 'ko', 'es']) {
      const hant = named('zh-Hant', ui);
      const tw = named('zh-TW', ui);
      expect(hant).not.toBe(tw);
      named('yue', ui);
      named('mul', ui);
    }
  });

  it('follows the UI language', () => {
    expect(languageLabel('ja', 'en')).not.toBe(languageLabel('ja', 'zh_CN'));
  });

  it('starts with a capital in the UI language', () => {
    const es = languageLabel('es', 'es');
    expect(es[0]).toBe(es[0].toLocaleUpperCase('es'));
  });

  it("names auto with the caller's words, and a pair as A ⇄ B", () => {
    expect(languageLabel('auto', 'en', 'Auto Detect')).toBe('Auto Detect');
    expect(languageLabel('zh+en', 'en')).toBe(`${languageLabel('zh', 'en')} ⇄ ${languageLabel('en', 'en')}`);
  });

  it('falls back to the code for anything it cannot name', () => {
    expect(languageLabel('zh_CN', 'en')).toBe('zh_CN');
    expect(languageLabel('', 'en')).toBe('');
  });

  it('names in English for the instructions', () => {
    expect(englishLanguageName('ja')).toBe(languageLabel('ja', 'en'));
  });
});
