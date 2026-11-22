/**
 * Bing's translation unit: what it declares, the pairs it translates, and the config it builds.
 */
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/run/types';
import { bingLanguages, bingTranslates } from './languages';
import { bingTranslationUnit } from './unit';

const shared: SharedSettings = { pauses: { sourceSeconds: 0, translationSeconds: 0 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
const build = (direction: SessionContext['direction']) => bingTranslationUnit.build({ direction, speech: false, turns: 'auto' }, {}, shared);

describe("Bing's translation unit", () => {
  it('occupies translation alone', () => {
    expect(bingTranslationUnit.occupies({}, new Set(['translation']))).toEqual(['translation']);
    expect(bingTranslationUnit.occupies({}, new Set(['transcription', 'translation']))).toBeNull();
  });

  it('translates the pairs Bing supports, never from an automatic source', () => {
    const c = bingTranslationUnit.capabilities({});
    expect(c.translates!('en', 'ja')).toBe(true);
    expect(c.translates!('auto', 'ja')).toBe(false);
    expect(c.translates!('en', 'en')).toBe(false);
    expect(c.speech).toBe('never');
    expect(c.boundaries).toBe('provider');
    expect(c.faceToFace).toBe(false);
    expect(c.participantSpeech).toBe(true);
  });

  it('builds the Bing config, and refuses an automatic source', () => {
    expect(build({ source: 'en', target: 'ja' })).toEqual({ modelId: 'bing-translator', instructions: '', wrapTranscript: false });
    expect(build({ source: 'auto', target: 'ja' })).toMatchObject({ refused: expect.stringContaining('fixed source language') });
  });

  it('refuses a pair Bing does not support', () => {
    expect(build({ source: 'la', target: 'en' })).toMatchObject({ refused: 'Bing Translator does not support this language pair.' });
  });

  it('describes its model', () => {
    expect(bingTranslationUnit.describe({ modelId: 'bing-translator', instructions: '', wrapTranscript: false })).toEqual({ translationModel: 'bing-translator' });
  });

  it('names its languages as app codes, each translated into the others', () => {
    const all = bingLanguages();
    expect(all).toContain('en');
    expect(new Set(all).size).toBe(all.length);
    expect(bingTranslates('en', 'zh')).toBe(true);
    expect(bingTranslates('en', 'la')).toBe(false);
    expect(bingTranslates('no', 'nb')).toBe(false);
    expect(bingTranslates('en', 'nb')).toBe(true);
    expect(bingTranslates('zh-CN', 'zh-TW')).toBe(true);
    expect(bingTranslates('en', 'zh-Hant')).toBe(false);
  });
});
