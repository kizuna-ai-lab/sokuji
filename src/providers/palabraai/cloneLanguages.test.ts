import { describe, it, expect } from 'vitest';
import { cleanVoiceName, cloneLanguageFor, PALABRA_CLONE_LANGUAGES, PALABRA_VOICE_NAME, sameLanguage } from './cloneLanguages';

describe('Palabra clone languages', () => {
  it('holds the 50 codes Palabra clones from', () => {
    expect(PALABRA_CLONE_LANGUAGES).toHaveLength(50);
    expect(PALABRA_CLONE_LANGUAGES).toEqual(expect.arrayContaining(['hu', 'ja', 'zh', 'zh-hans', 'zh-hant', 'en', 'en-us', 'pt-br', 'es-la']));
  });

  it('matches an app code to a clone code, exactly or by its base language', () => {
    expect(cloneLanguageFor('hu')).toBe('hu');
    expect(cloneLanguageFor('en-US')).toBe('en-us');
    expect(cloneLanguageFor('zh_TW')).toBe('zh-hant');
    expect(cloneLanguageFor('zh-TW')).toBe('zh-hant');
    expect(cloneLanguageFor('zh-CN')).toBe('zh-hans');
    expect(cloneLanguageFor('pt-BR')).toBe('pt-br');
    expect(cloneLanguageFor('es-ES')).toBe('es');
  });

  it('has no clone code for auto-detect, an unsupported language, or nothing', () => {
    expect(cloneLanguageFor('auto')).toBeNull();
    expect(cloneLanguageFor('yue')).toBeNull();
    expect(cloneLanguageFor(undefined)).toBeNull();
    expect(cloneLanguageFor(null)).toBeNull();
  });

  it("compares a voice's language with an app code by base language", () => {
    expect(sameLanguage('es-la', 'es')).toBe(true);
    expect(sameLanguage('pt-br', 'pt-PT')).toBe(true);
    expect(sameLanguage('zh-hant', 'zh-TW')).toBe(true);
    expect(sameLanguage('en', 'ja')).toBe(false);
    expect(sameLanguage(null, 'en')).toBe(false);
  });

  it("checks a name with the classes Palabra's server uses, 3-64 characters", () => {
    for (const ok of ['Teszt hang ő', '测试 声音', 'My Voice 1', 'हिन्दी आवाज़', 'voice_(2).v']) expect(PALABRA_VOICE_NAME.test(ok)).toBe(true);
    for (const bad of ['ab', 'x'.repeat(65), "it's"]) expect(PALABRA_VOICE_NAME.test(bad)).toBe(false);
  });

  it('cleans a name down to what Palabra accepts', () => {
    expect(cleanVoiceName("it's mine!")).toBe('its mine');
    expect(cleanVoiceName('  spaced  ')).toBe('spaced');
    expect(cleanVoiceName('y'.repeat(80))).toHaveLength(64);
  });
});
