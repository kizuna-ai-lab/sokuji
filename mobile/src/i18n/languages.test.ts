import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { LANGUAGE_CODES, LANGUAGE_NAMES } from './languageNames';
import { languageName, searchLanguages, sourceOptions, targetOptions } from './languages';

// Equal to the desktop's SONIOX_LANGUAGES: src/providers/soniox/languages.mobile.test.ts.
const CODES = [...LANGUAGE_CODES].sort();

describe('the language name table', () => {
  // Hermes has no Intl.DisplayNames (checked on iOS and Android, 2026-10-28), so
  // the names the desktop gets from CLDR at run time are generated ahead of time.
  it('names every Soniox language in every interface language the app ships', () => {
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual(Object.keys(CATALOGS).sort());
    for (const [ui, rows] of Object.entries(LANGUAGE_NAMES)) {
      expect(rows.map(([code]) => code).sort(), ui).toEqual(CODES);
      for (const [code, name] of rows) expect(name.trim(), `${ui}/${code}`).not.toBe('');
    }
  });

  it('holds real names, not codes', () => {
    expect(languageName('ja', 'en')).toBe('Japanese');
    expect(languageName('en', 'ja')).toBe('英語');
    expect(languageName('ja', 'zh_CN')).toBe('日语');
    expect(languageName('de', 'de')).toBe('Deutsch');
  });
});

describe('languageName', () => {
  it('calls auto by the label it is given', () => {
    expect(languageName('auto', 'en', 'Auto Detect')).toBe('Auto Detect');
  });

  it('falls back to English for an interface language it has no names for, and to the code last', () => {
    expect(languageName('ja', 'xx')).toBe('Japanese');
    expect(languageName('qq', 'en')).toBe('qq');
  });
});

describe('the options a picker offers', () => {
  it('lets the source be detected and puts that first; the target is always a language', () => {
    const source = sourceOptions('en', 'Auto Detect');
    expect(source[0]).toEqual({ code: 'auto', name: 'Auto Detect' });
    expect(source.slice(1).map((o) => o.code).sort()).toEqual(CODES);
    expect(targetOptions('en').map((o) => o.code).sort()).toEqual(CODES);
  });

  it('lists the languages in the interface language’s alphabetical order', () => {
    const names = targetOptions('en').map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('searchLanguages', () => {
  const options = targetOptions('ja');
  it('matches the shown name, the English name or the code, ignoring case', () => {
    expect(searchLanguages(options, '英').map((o) => o.code)).toContain('en');
    expect(searchLanguages(options, 'JAPAN').map((o) => o.code)).toEqual(['ja']);
    expect(searchLanguages(options, 'fil').map((o) => o.code)).toContain('fil');
  });

  it('matches codes and English names the same on any device language (no Turkish dotless i)', () => {
    const original = String.prototype.toLocaleLowerCase;
    // What a Turkish device's default casing does to a capital I.
    String.prototype.toLocaleLowerCase = function (this: string) { return original.call(this, 'tr'); };
    try {
      expect(searchLanguages(options, 'FIL').map((o) => o.code)).toContain('fil');
      expect(searchLanguages(options, 'INDONESIAN').map((o) => o.code)).toEqual(['id']);
    } finally {
      String.prototype.toLocaleLowerCase = original;
    }
  });

  it('returns everything for an empty query', () => {
    expect(searchLanguages(options, '  ')).toHaveLength(options.length);
  });
});
