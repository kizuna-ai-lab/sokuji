import { describe, it, expect } from 'vitest';
import { defaultLocalNativeSettings } from '../services/providers/LocalNativeProviderConfig';

describe('the localNative slice carries a selections map', () => {
  it('defaults to an empty selections map', () => {
    expect(defaultLocalNativeSettings.selections).toEqual({});
  });
});

describe('the flat model fields are gone — selections is the only source', () => {
  it('localNative no longer declares the flat model fields', () => {
    // The loader reads Object.keys(defaults); anything still listed here is
    // still loaded and still a second source of truth.
    const defaults = defaultLocalNativeSettings as unknown as Record<string, unknown>;
    expect(Object.keys(defaults)).not.toContain('asrModel');
    expect(Object.keys(defaults)).not.toContain('translationModel');
    expect(Object.keys(defaults)).not.toContain('ttsModel');
  });

  it('localNative no longer declares the misnamed shared quant map', () => {
    expect(Object.keys(defaultLocalNativeSettings as unknown as Record<string, unknown>))
      .not.toContain('translationVariantByModel');
  });
});
