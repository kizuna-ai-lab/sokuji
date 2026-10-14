import { describe, it, expect } from 'vitest';
import { languageLabel } from '../lib/language/label';
import type { ReadingLanguage } from '../lib/reading/types';

const catalogs = import.meta.glob('./*/translation.json', { eager: true }) as
  Record<string, { default: { subtitle?: { settings?: { readings?: string } } } }>;
const READING_LANGUAGES: ReadingLanguage[] = ['zh', 'ja', 'ko', 'ru', 'uk'];

// The label takes the language's displayed name (CLDR's, capitalised); a catalog
// that also writes the word CLDR's name starts with says it twice ("tiếng Tiếng Nhật").
describe('the readings label', () => {
  const rows = Object.entries(catalogs).map(([path, mod]) => [path.split('/')[1], mod.default.subtitle?.settings?.readings] as const);

  it.each(rows)('in %s does not repeat a word around the language name', (locale, template) => {
    expect(template).toBeTypeOf('string');
    for (const lang of READING_LANGUAGES) {
      const label = template!.replace('{{language}}', languageLabel(lang, locale.replace('_', '-'))).replace('{{scheme}}', 'x');
      expect(label).not.toMatch(/(?:^|\s)(\p{L}+)\s+\1(?=\s|$)/iu);
    }
  });
});
