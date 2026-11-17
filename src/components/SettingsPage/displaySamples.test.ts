import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_LINES, badgeCode, previewLanguages, sampleKey } from './displaySamples';

describe('the display preview samples (B-22)', () => {
  it('reads app, interface and pair codes', () => {
    expect(sampleKey('ja')).toBe('ja');
    expect(sampleKey('EN')).toBe('en');
    expect(sampleKey('zh')).toBe('zh');
    expect(sampleKey('zh_CN')).toBe('zh');
    expect(sampleKey('zh-TW')).toBe('zh-Hant');
    expect(sampleKey('zh_TW')).toBe('zh-Hant');
    expect(sampleKey('zh-Hant')).toBe('zh-Hant');
    expect(sampleKey('pt_BR')).toBe('pt');
    expect(sampleKey('pt-PT')).toBe('pt');
    expect(sampleKey('tl')).toBe('fil');
    expect(sampleKey('zh+en')).toBe('zh');
    expect(sampleKey('auto')).toBeNull();
    expect(sampleKey('sw')).toBeNull();
    expect(sampleKey(null)).toBeNull();
  });

  it('has a sample in every interface language', () => {
    const locales = join(__dirname, '../../locales');
    const codes = readdirSync(locales).filter((name) => statSync(join(locales, name)).isDirectory());
    expect(codes.length).toBeGreaterThanOrEqual(30);
    for (const code of codes) expect(sampleKey(code), code).not.toBeNull();
  });

  it('has three lines, none empty, in every language', () => {
    for (const [key, lines] of Object.entries(SAMPLE_LINES)) {
      expect(lines, key).toHaveLength(3);
      for (const line of lines) expect(line.trim(), key).not.toBe('');
    }
  });

  it("speaks the pair's languages", () => {
    expect(previewLanguages({ source: 'en', target: 'ko' }, 'zh_CN')).toEqual({ mine: 'en', theirs: 'ko' });
    expect(previewLanguages({ source: 'zh-TW', target: 'ja' }, 'en')).toEqual({ mine: 'zh-Hant', theirs: 'ja' });
  });

  it('takes the interface language for a side that is auto-detected or has no sample, then English', () => {
    expect(previewLanguages({ source: 'auto', target: 'en' }, 'ja')).toEqual({ mine: 'ja', theirs: 'en' });
    expect(previewLanguages({ source: 'sw', target: 'en' }, 'fr')).toEqual({ mine: 'fr', theirs: 'en' });
    expect(previewLanguages({ source: 'de', target: 'sw' }, 'xx')).toEqual({ mine: 'de', theirs: 'en' });
    expect(previewLanguages(null, 'es')).toEqual({ mine: 'es', theirs: 'en' });
  });

  it('never shows one language on both sides: the side that fell back gives way', () => {
    // Auto-detected source, the interface in the target's language.
    expect(previewLanguages({ source: 'auto', target: 'ko' }, 'ko')).toEqual({ mine: 'en', theirs: 'ko' });
    expect(previewLanguages({ source: 'auto', target: 'en' }, 'en')).toEqual({ mine: 'zh', theirs: 'en' });
    // A target without a sample, the interface in the source's language.
    expect(previewLanguages({ source: 'fr', target: 'sw' }, 'fr')).toEqual({ mine: 'fr', theirs: 'en' });
    expect(previewLanguages(null, null)).toEqual({ mine: 'en', theirs: 'zh' });
  });

  it('badges a sample with its language code', () => {
    expect(badgeCode('zh-Hant')).toBe('ZH');
    expect(badgeCode('ja')).toBe('JA');
    expect(badgeCode('fil')).toBe('FIL');
  });
});
