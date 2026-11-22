/**
 * The codes a transcriber hands Bing's translation unit, against Bing's own list: what the pair picker offers
 * (`bingTranslates`), what the build refuses and what the engine is loaded with must agree, code by code. The
 * transcriber that reaches this unit is Soniox, so its list is the one read.
 */
import { describe, expect, it } from 'vitest';
import { isSupportedByBing, mapToBingCode } from '../../lib/bing-translator/languageMap';
import { BING_TRANSLATOR, localTranslationRefusal } from '../../lib/local-inference/sessions/translationSession';
import { SONIOX_LANGUAGES } from '../soniox/languages';
import { bingTranslates } from './languages';

const soniox = SONIOX_LANGUAGES.map((o) => o.value);
const targetsOf = (source: string, among: readonly string[]) => among.filter((target) => bingTranslates(source, target));

describe("Soniox's languages, translated by Bing", () => {
  it("Bing's list lacks eight of them, and takes every other as it is written", () => {
    expect(soniox.filter((code) => !isSupportedByBing(code))).toEqual(['sq', 'az', 'eu', 'be', 'gl', 'gu', 'kn', 'mk']);
  });

  it("the codes that differ are mapped where the engine sends them: Chinese as Bing's simplified, Norwegian as Bokmål, the rest unchanged", () => {
    expect(mapToBingCode('zh')).toBe('zh-Hans');
    expect(mapToBingCode('no')).toBe('nb');
    expect(mapToBingCode('fil')).toBe('fil');
    for (const code of soniox.filter(isSupportedByBing)) {
      if (code !== 'zh' && code !== 'no') expect(mapToBingCode(code), code).toBe(code);
    }
  });

  it('a pair is offered exactly when the engine can be loaded with it: both codes map, to two languages', () => {
    for (const source of soniox) for (const target of soniox) {
      const mapped = (code: string) => (isSupportedByBing(code) ? mapToBingCode(code) : null);
      const runs = mapped(source) !== null && mapped(target) !== null && mapped(source) !== mapped(target);
      expect(bingTranslates(source, target), `${source}>${target}`).toBe(runs);
      // What is offered is never refused by the build or by the session's own start.
      if (runs) expect(localTranslationRefusal(BING_TRANSLATOR, source, target), `${source}>${target}`).toBeNull();
    }
  });

  it("the targets of a source are Bing's among the transcriber's own codes, never the source itself", () => {
    const targets = targetsOf('zh', soniox);
    expect(targets).toContain('en');
    expect(targets).toContain('no');
    expect(targets).not.toContain('zh');
    expect(targets).not.toContain('eu');
    expect(targets).toHaveLength(soniox.filter(isSupportedByBing).length - 1);
    // A source Bing does not take has no target, and an automatic one neither.
    expect(targetsOf('eu', soniox)).toEqual([]);
    expect(targetsOf('auto', soniox)).toEqual([]);
  });

  it("the regional forms of Chinese are Bing's own, in the app's spelling; the script forms are not on its list", () => {
    expect(mapToBingCode('zh-CN')).toBe('zh-Hans');
    expect(mapToBingCode('zh-TW')).toBe('zh-Hant');
    expect(mapToBingCode('zh-HK')).toBe('zh-Hant');
    expect(isSupportedByBing('zh-Hant')).toBe(false);
    expect(isSupportedByBing('zh-Hans')).toBe(false);
    // One language to Bing: not a pair.
    expect(bingTranslates('zh', 'zh-CN')).toBe(false);
    expect(bingTranslates('zh', 'zh-TW')).toBe(true);
  });
});
