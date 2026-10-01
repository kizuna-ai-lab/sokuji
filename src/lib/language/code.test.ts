import { describe, expect, it } from 'vitest';
import { AUTO, baseLanguage, canonicalTag, pairCode, parseCode } from './code';

describe('parseCode', () => {
  it('reads a canonical tag', () => {
    expect(parseCode('zh-Hant')).toEqual({ kind: 'tag', tag: 'zh-Hant' });
    expect(parseCode('zh-TW')).toEqual({ kind: 'tag', tag: 'zh-TW' });
    expect(parseCode('es-419')).toEqual({ kind: 'tag', tag: 'es-419' });
    expect(parseCode('yue')).toEqual({ kind: 'tag', tag: 'yue' });
    expect(parseCode('mul')).toEqual({ kind: 'tag', tag: 'mul' });
  });

  it('reads auto and a bidirectional pair', () => {
    expect(parseCode(AUTO)).toEqual({ kind: 'auto' });
    expect(parseCode('zh+en')).toEqual({ kind: 'pair', a: 'zh', b: 'en' });
  });

  it('refuses anything not written canonically', () => {
    for (const bad of ['', 'zh_CN', 'zh-hant', 'ZH', 'cantonese', 'tl', 'Auto', 'zh+en+ja', 'auto+en', 'zh+', '+en', 'zh+en-us']) {
      expect(parseCode(bad), bad).toBeNull();
    }
  });
});

describe('canonicalTag', () => {
  it("returns Intl's canonical form, aliases included", () => {
    expect(canonicalTag('zh-hant')).toBe('zh-Hant');
    expect(canonicalTag('en-us')).toBe('en-US');
    expect(canonicalTag('tl')).toBe('fil');
  });

  it('throws on a malformed tag', () => {
    expect(() => canonicalTag('zh_CN')).toThrow(RangeError);
    expect(() => canonicalTag('cantonese')).toThrow(RangeError);
  });
});

describe('pairCode and baseLanguage', () => {
  it('joins two tags with +', () => {
    expect(pairCode('zh', 'en')).toBe('zh+en');
  });

  it('answers the primary subtag of a tag, auto for auto, null for a pair', () => {
    expect(baseLanguage('zh-Hant-TW')).toBe('zh');
    expect(baseLanguage('yue')).toBe('yue');
    expect(baseLanguage(AUTO)).toBe(AUTO);
    expect(baseLanguage('zh+en')).toBeNull();
    expect(baseLanguage('zh_CN')).toBeNull();
  });
});
