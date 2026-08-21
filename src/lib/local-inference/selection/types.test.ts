import { describe, it, expect } from 'vitest';
import { directionKey, splitDirection, emptyDirection } from './types';

describe('directionKey', () => {
  it('joins with U+2192, matching the legacy modelPreferences key format', () => {
    expect(directionKey('ja', 'en')).toBe('ja→en');
  });

  it('round-trips through splitDirection', () => {
    expect(splitDirection(directionKey('zh-Hant', 'en'))).toEqual(['zh-Hant', 'en']);
  });

  it('splits on the FIRST arrow only, so a tag containing one cannot corrupt the target', () => {
    expect(splitDirection('a→b→c')).toEqual(['a', 'b→c']);
  });
});

describe('emptyDirection', () => {
  it('is all-auto', () => {
    expect(emptyDirection()).toEqual({
      asr: { modelId: '' },
      translation: { modelId: '' },
      tts: { modelId: '' },
    });
  });

  it('returns a fresh object each call, so callers cannot poison a shared default', () => {
    const a = emptyDirection();
    const b = emptyDirection();
    a.asr.modelId = 'mutated';
    expect(b.asr.modelId).toBe('');
  });
});
