import { describe, it, expect } from 'vitest';
import { previewSampleFor, PREVIEW_SAMPLES } from './sonioxPreviewSample';
import { SonioxProviderConfig } from '../../../services/providers/SonioxProviderConfig';

const supported = new Set(
  new SonioxProviderConfig().getConfig().languages.map((l) => l.value)
);

describe('previewSampleFor', () => {
  it('only seeds languages Soniox can actually synthesize', () => {
    // Cross-assertion: if the provider's language list is ever trimmed, this
    // fails loudly instead of the table silently requesting a dead language.
    const unknown = Object.keys(PREVIEW_SAMPLES).filter((k) => !supported.has(k));
    expect(unknown).toEqual([]);
  });

  it('covers the 28 Soniox codes the app UI locales map onto', () => {
    expect(Object.keys(PREVIEW_SAMPLES).sort()).toEqual([
      'ar', 'bn', 'de', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'id', 'it',
      'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ru', 'sv', 'ta', 'te', 'th', 'tl',
      'tr', 'uk', 'vi', 'zh',
    ]);
  });

  it('returns the requested language paired with its own sentence', () => {
    expect(previewSampleFor('ja')).toEqual({ language: 'ja', text: PREVIEW_SAMPLES.ja });
    expect(previewSampleFor('zh')).toEqual({ language: 'zh', text: PREVIEW_SAMPLES.zh });
  });

  it('falls back to the English pair for an unseeded language', () => {
    // 'cy' (Welsh) is a real Soniox target language with no seeded sentence.
    expect(previewSampleFor('cy')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it('falls back to the English pair for an unknown or empty language', () => {
    expect(previewSampleFor('')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
    expect(previewSampleFor('klingon')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it('falls back to the English pair for an Object.prototype key instead of leaking a function', () => {
    // A plain object literal indexed by a raw string resolves inherited
    // members like 'constructor' or 'toString' via bracket access; without a
    // hasOwnProperty guard this would return { language: 'constructor', text:
    // <Function> }, which JSON.stringify then silently drops from the wire
    // payload — a confusing server 400 instead of a clean fallback.
    expect(previewSampleFor('constructor')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
    expect(previewSampleFor('toString')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
    expect(previewSampleFor('hasOwnProperty')).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it('never returns a language whose text came from a different language', () => {
    // The pair is the whole point: a mismatched (text, language) makes Soniox
    // read the sentence with the wrong phonology.
    for (const code of [...supported]) {
      const sample = previewSampleFor(code);
      expect(sample.text).toBe(PREVIEW_SAMPLES[sample.language]);
    }
  });
});
