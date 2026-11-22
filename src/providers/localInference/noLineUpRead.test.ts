/**
 * The local units run this machine's models and ask no one else's line-up: they read which stages they serve from
 * what a run hands them (`shared.lineUp`, `ctx.stages`), never from the line-up store, and name neither Bing nor Edge.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { localTranslates } from './translationUnit';
import { localSpeaks } from './speechUnit';

const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('the local units read no line-up from the store', () => {
  for (const file of ['translationUnit.ts', 'speechUnit.ts', 'config.ts', 'check.ts']) {
    it(`${file} imports nothing from the line-up store`, () => {
      expect(source(file)).not.toMatch(/stores\/lineUpStore/);
    });
  }
  for (const file of ['translationUnit.ts', 'speechUnit.ts', 'check.ts', 'config.ts']) {
    it(`${file} names neither Bing's languages nor Edge's`, () => {
      expect(source(file)).not.toMatch(/bing\/languages|bing-translator\/languageMap|EDGE_TTS_LANGUAGES/);
    });
  }
});

describe('the local units take this machine\'s models alone', () => {
  it('localTranslates and localSpeaks take no option or stages', () => {
    expect(localTranslates.length).toBe(2);
    expect(localSpeaks.length).toBe(1);
  });
});
