import { describe, it, expect } from 'vitest';
import { defaultLocalInferenceSettings } from '../services/providers/LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from '../services/providers/LocalNativeProviderConfig';

describe('local provider slices carry a selections map', () => {
  for (const [name, defaults] of [
    ['localInference', defaultLocalInferenceSettings as Record<string, unknown>],
    ['localNative', defaultLocalNativeSettings as Record<string, unknown>],
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
