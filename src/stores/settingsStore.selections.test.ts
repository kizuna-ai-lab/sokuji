import { describe, it, expect } from 'vitest';
import { defaultLocalInferenceSettings } from '../services/providers/LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from '../services/providers/LocalNativeProviderConfig';

describe('local provider slices carry a selections map', () => {
  for (const [name, defaults] of [
    ['localInference', defaultLocalInferenceSettings as unknown as Record<string, unknown>],
    ['localNative', defaultLocalNativeSettings as unknown as Record<string, unknown>],
  ] as const) {
    it(`${name} defaults to an empty selections map`, () => {
      expect(defaults.selections).toEqual({});
    });
  }

  it('keeps the language pair — it is a session property, not a stage property', () => {
    expect(defaultLocalInferenceSettings.sourceLanguage).toBe('ja');
    expect(defaultLocalInferenceSettings.targetLanguage).toBe('en');
  });
});

describe('the flat model fields are gone — selections is the only source', () => {
  for (const [name, defaults] of [
    ['localInference', defaultLocalInferenceSettings as unknown as Record<string, unknown>],
    ['localNative', defaultLocalNativeSettings as unknown as Record<string, unknown>],
  ] as const) {
    it(`${name} no longer declares the flat model fields`, () => {
      // The loader reads Object.keys(defaults); anything still listed here is
      // still loaded and still a second source of truth.
      expect(Object.keys(defaults)).not.toContain('asrModel');
      expect(Object.keys(defaults)).not.toContain('translationModel');
      expect(Object.keys(defaults)).not.toContain('ttsModel');
    });
  }

  it('localNative no longer declares the misnamed shared quant map', () => {
    expect(Object.keys(defaultLocalNativeSettings as unknown as Record<string, unknown>))
      .not.toContain('translationVariantByModel');
  });
});
