/**
 * The codes a transcriber hands the local translation unit: Soniox's languages, each pair of which has a model in
 * the catalog. (Bing's list against the same codes is `../bing/codes.test.ts`.)
 */
import { describe, expect, it } from 'vitest';
import { SONIOX_LANGUAGES } from '../soniox/languages';
import { localTranslationTargets } from './translationUnit';

const soniox = SONIOX_LANGUAGES.map((o) => o.value);

describe("Soniox's languages, translated by a model of this device", () => {
  it('every pair of two languages has a model in the catalog, and an automatic source has none', () => {
    for (const source of soniox) {
      expect(localTranslationTargets(source, soniox), source).toEqual(soniox.filter((code) => code !== source));
    }
    expect(localTranslationTargets('auto', soniox)).toEqual([]);
  });
});
