import { afterAll, describe, expect, it } from 'vitest';
import i18n, { changeLanguageWithLoad } from './index';

// #559: the document's `lang` follows the UI language, in BCP 47 form.
// index.scss orders its CJK fonts by it, and Chromium resolves `sans-serif`
// by it; left at the pages' hard-coded `en`, Han glyphs fell to SimSun.
describe('document lang', () => {
  afterAll(() => {
    localStorage.removeItem('i18nextLng');
  });

  it('starts at the detected language', () => {
    expect(document.documentElement.lang).toBe(i18n.language.replace('_', '-'));
  });

  it.each([
    ['zh_TW', 'zh-TW'],
    ['zh_CN', 'zh-CN'],
    ['ja', 'ja'],
    ['pt_BR', 'pt-BR'],
    ['en', 'en'],
  ])('%s sets lang="%s"', async (lng, expected) => {
    await changeLanguageWithLoad(lng);
    expect(document.documentElement.lang).toBe(expected);
  });
});
