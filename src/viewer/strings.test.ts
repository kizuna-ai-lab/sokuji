import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en/translation.json';
import { VIEWER_CATALOGS, makeT, pickCatalog, viewerT } from './strings';

const ALL = Object.keys(VIEWER_CATALOGS);

describe('viewer strings', () => {
  it('is generated from the catalogs as they are now (run node scripts/gen-viewer-strings.mjs if not)', () => {
    const locales = join(__dirname, '..', 'locales');
    const expected: Record<string, unknown> = {};
    for (const id of readdirSync(locales).sort()) {
      if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(id)) continue;
      const catalog = JSON.parse(readFileSync(join(locales, id, 'translation.json'), 'utf8')) as Record<string, unknown>;
      if (catalog.viewer) expected[id] = catalog.viewer;
    }
    expect(VIEWER_CATALOGS).toEqual(expected);
  });

  it('compiles the viewer subtree of all 30 catalogs', () => {
    expect(ALL).toHaveLength(30);
    expect(VIEWER_CATALOGS.en).toEqual((en as Record<string, unknown>).viewer);
    for (const id of ALL) expect(typeof VIEWER_CATALOGS[id]?.title, id).toBe('string');
  });

  it('picks a catalog from navigator.languages', () => {
    expect(pickCatalog(['ja-JP', 'en'], ALL)).toBe('ja');
    expect(pickCatalog(['zh-Hant-TW'], ALL)).toBe('zh_TW');
    expect(pickCatalog(['zh-HK'], ALL)).toBe('zh_TW');
    expect(pickCatalog(['zh'], ALL)).toBe('zh_CN');
    // The app's own catalog ids, as the host's window passes its UI language.
    expect(pickCatalog(['zh_TW'], ALL)).toBe('zh_TW');
    expect(pickCatalog(['pt_BR'], ALL)).toBe('pt_BR');
    expect(pickCatalog(['zh_CN'], ALL)).toBe('zh_CN');
    expect(pickCatalog(['zh-Hans-CN'], ALL)).toBe('zh_CN');
    expect(pickCatalog(['pt-BR'], ALL)).toBe('pt_BR');
    expect(pickCatalog(['pt'], ALL)).toBe('pt_PT');
    expect(pickCatalog(['iw'], ALL)).toBe('he');
    expect(pickCatalog(['tl'], ALL)).toBe('fil');
    expect(pickCatalog(['xx', 'ko-KR'], ALL)).toBe('ko');
    expect(pickCatalog(['xx'], ALL)).toBe('en');
    expect(pickCatalog([], ALL)).toBe('en');
  });

  it('looks keys up with an English fallback and fills {{placeholders}}', () => {
    const t = makeT({ a: { b: 'B {{n}}' } }, { a: { b: 'en B', c: 'en C' } });
    expect(t('a.b', { n: 3 })).toBe('B 3');
    expect(t('a.c')).toBe('en C');
    expect(t('a.missing')).toBe('a.missing');
    expect(t('a.b')).toBe('B {{n}}');
  });

  it('builds a t for the browser languages', () => {
    const { t, catalog } = viewerT(['en-US']);
    expect(catalog).toBe('en');
    expect(t('viewer.title')).toBe('Sokuji captions');
  });
});
