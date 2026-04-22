import { describe, it, expect } from 'vitest';
import { mapToBingCode, isSupportedByBing, BING_SUPPORTED_LANGUAGES } from './languageMap';

describe('languageMap', () => {
  describe('mapToBingCode', () => {
    it('passes through common ISO codes unchanged', () => {
      expect(mapToBingCode('en')).toBe('en');
      expect(mapToBingCode('ja')).toBe('ja');
      expect(mapToBingCode('ko')).toBe('ko');
      expect(mapToBingCode('fr')).toBe('fr');
      expect(mapToBingCode('de')).toBe('de');
      expect(mapToBingCode('es')).toBe('es');
    });

    it('maps bare "zh" to "zh-Hans" (simplified Chinese default)', () => {
      expect(mapToBingCode('zh')).toBe('zh-Hans');
    });

    it('maps "zh-CN" to "zh-Hans" and "zh-TW" to "zh-Hant"', () => {
      expect(mapToBingCode('zh-CN')).toBe('zh-Hans');
      expect(mapToBingCode('zh-TW')).toBe('zh-Hant');
    });

    it('lowercases then looks up — case-insensitive input', () => {
      expect(mapToBingCode('EN')).toBe('en');
      expect(mapToBingCode('Zh-Cn')).toBe('zh-Hans');
    });

    it('throws for unsupported codes', () => {
      expect(() => mapToBingCode('xx')).toThrow(/unsupported/i);
    });

    it('maps app alias "no" to Bing canonical "nb" (Norwegian Bokmål)', () => {
      expect(mapToBingCode('no')).toBe('nb');
      expect(isSupportedByBing('no')).toBe(true);
    });
  });

  describe('isSupportedByBing', () => {
    it('returns true for supported codes', () => {
      expect(isSupportedByBing('en')).toBe(true);
      expect(isSupportedByBing('zh')).toBe(true);
      expect(isSupportedByBing('ja')).toBe(true);
    });

    it('returns false for unsupported codes', () => {
      expect(isSupportedByBing('xx')).toBe(false);
      expect(isSupportedByBing('')).toBe(false);
    });
  });

  describe('BING_SUPPORTED_LANGUAGES', () => {
    it('contains the commonly-used languages', () => {
      for (const code of ['en', 'ja', 'zh', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it', 'ar', 'hi', 'th', 'vi']) {
        expect(BING_SUPPORTED_LANGUAGES).toContain(code);
      }
    });
  });
});
