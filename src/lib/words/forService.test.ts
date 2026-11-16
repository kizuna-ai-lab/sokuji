// What each service gets of the word list: only the columns it has a field for, cut to its limit.
import { describe, it, expect } from 'vitest';
import { WORD_LIMITS, SONIOX_CONTEXT_CHARS, wordsFor, sonioxContextSize } from './forService';
import type { WordEntry } from './list';

const LIST: WordEntry[] = [
  { written: 'Kizuna AI', translation: 'キズナAI', heardAs: 'kizuna eye' },
  { written: 'Sokuji' },
  { written: 'Soniox', heardAs: 'sonic ox' },
];

describe('the word list for each service', () => {
  it('gives each service exactly the columns it has a field for', () => {
    expect(wordsFor('soniox', LIST, 'Weekly sync.')).toEqual({
      terms: ['Kizuna AI', 'Sokuji', 'Soniox'], translations: [['Kizuna AI', 'キズナAI']], background: 'Weekly sync.', leftOut: 0,
    });
    expect(wordsFor('volcengine_ast2', LIST, 'Weekly sync.')).toEqual({
      terms: ['Kizuna AI', 'Sokuji', 'Soniox'], translations: [['Kizuna AI', 'キズナAI']],
      heardAs: [['kizuna eye', 'Kizuna AI'], ['sonic ox', 'Soniox']], leftOut: 0,
    });
    expect(wordsFor('qwen_livetranslate', LIST, 'Weekly sync.')).toEqual({ translations: [['Kizuna AI', 'キズナAI']], leftOut: 0 });
    expect(wordsFor('openai', LIST, 'Weekly sync.')).toEqual({ terms: ['Kizuna AI', 'Sokuji', 'Soniox'], background: 'Weekly sync.', leftOut: 0 });
    expect(wordsFor('gemini', LIST, 'Weekly sync.')).toEqual({ terms: ['Kizuna AI', 'Sokuji', 'Soniox'], leftOut: 0 });
    expect(wordsFor('local_inference', LIST, 'Weekly sync.')).toEqual({
      terms: ['Kizuna AI', 'Sokuji', 'Soniox'], translations: [['Kizuna AI', 'キズナAI']], background: 'Weekly sync.', leftOut: 0,
    });
    for (const none of ['openai_translate', 'openai_live', 'palabraai', 'fake']) expect(wordsFor(none, LIST, 'Weekly sync.')).toEqual({ leftOut: 0 });
  });

  it('sends no empty field for an empty list', () => {
    for (const service of Object.keys(WORD_LIMITS)) expect(wordsFor(service, [], '')).toEqual({ leftOut: 0 });
    expect(wordsFor('soniox', [], '  ')).toEqual({ leftOut: 0 });
  });

  it('sends the first entries up to a limit and counts the rest', () => {
    const many = Array.from({ length: 1005 }, (_, i) => ({ written: `term${i}`, translation: `訳${i}` }));
    // Doubao's 1,000 count hot words, glossary entries and corrections together: two each here.
    const doubao = wordsFor('volcengine_ast2', many, '');
    expect(doubao.terms).toHaveLength(500);
    expect(doubao.translations).toHaveLength(500);
    expect(doubao.terms![499]).toBe('term499');
    expect(doubao.leftOut).toBe(505);
    expect(wordsFor('qwen_livetranslate', many, '').leftOut).toBe(5);
  });

  it('keeps Soniox under its context size, the background cut first, then entries from the end', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ written: `term number ${i}` }));
    const s = wordsFor('soniox', many, 'x'.repeat(20_000));
    expect(sonioxContextSize(s)).toBeLessThanOrEqual(SONIOX_CONTEXT_CHARS);
    expect(s.background ?? '').toBe('');
    expect(s.leftOut).toBe(2000 - s.terms!.length);
    expect(s.leftOut).toBeGreaterThan(0);
    const quoted = wordsFor('soniox', LIST, '"\n'.repeat(6_000));
    expect(sonioxContextSize(quoted)).toBeLessThanOrEqual(SONIOX_CONTEXT_CHARS);
    expect(quoted.leftOut).toBe(0);
    expect(quoted.background!.length).toBeGreaterThan(4_000);
    const roomy = wordsFor('soniox', LIST, 'x'.repeat(8_000));
    expect(roomy.leftOut).toBe(0);
    expect(sonioxContextSize(roomy)).toBeLessThanOrEqual(SONIOX_CONTEXT_CHARS);
    expect(roomy.background).toHaveLength(8_000);
    // Cut as long as it fits, never inside a surrogate pair.
    const emoji = wordsFor('soniox', LIST, '😀'.repeat(6_000));
    expect(sonioxContextSize(emoji)).toBeGreaterThan(SONIOX_CONTEXT_CHARS - 10);
    expect(/[\uD800-\uDBFF]$/.test(emoji.background!)).toBe(false);
  });

  it('counts as left out only the entries the service would have taken', () => {
    const noTranslations = Array.from({ length: 1500 }, (_, i) => ({ written: `w${i}` }));
    expect(wordsFor('qwen_livetranslate', noTranslations, '').leftOut).toBe(0);
    const lastTranslated = [...Array.from({ length: 1000 }, (_, i) => ({ written: `w${i}` })), { written: 'x', translation: 'y' }];
    expect(wordsFor('qwen_livetranslate', lastTranslated, '')).toEqual({ translations: [['x', 'y']], leftOut: 0 });
  });

  it('turns each "often heard as", split at any comma, into a correction', () => {
    expect(wordsFor('volcengine_ast2', [{ written: '速记', heardAs: '速库季，苏库吉、素记' }], '').heardAs).toEqual([['速库季', '速记'], ['苏库吉', '速记'], ['素记', '速记']]);
  });

  it("keeps this device's note short: a few dozen entries and the start of the background", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ written: `w${i}`, translation: `t${i}` }));
    const local = wordsFor('local_inference', many, 'b'.repeat(5000));
    expect(local.terms!.length).toBeLessThanOrEqual(30);
    expect(local.background!.length).toBeLessThanOrEqual(300);
  });
});

