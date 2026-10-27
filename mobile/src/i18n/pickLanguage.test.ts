import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickLanguage } from './pickLanguage';
import { CATALOGS } from './catalogs';

describe('pickLanguage', () => {
  const available = ['en', 'ja', 'zh_CN', 'zh_TW', 'pt_BR', 'pt_PT', 'fr', 'de'];
  it.each([
    [['ja-JP'], 'ja'],
    [['zh-Hant-TW'], 'zh_TW'],
    [['zh-Hans-CN'], 'zh_CN'],
    [['zh-CN'], 'zh_CN'],
    [['zh-TW'], 'zh_TW'],
    [['pt-BR'], 'pt_BR'],
    [['pt-PT'], 'pt_PT'],
    [['pt'], 'pt_PT'],
    [['fr-CA'], 'fr'],
    [['xx'], 'en'],
    [[], 'en'],
    [['xx', 'de-AT'], 'de'],
  ] as Array<[string[], string]>)('%j → %s', (tags, expected) => {
    expect(pickLanguage(tags, available)).toBe(expected);
  });
});

describe('CATALOGS', () => {
  it('names every catalog directory the desktop ships', () => {
    const dirs = readdirSync(resolve(__dirname, '../../../src/locales'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(Object.keys(CATALOGS).sort()).toEqual(dirs);
  });
});
