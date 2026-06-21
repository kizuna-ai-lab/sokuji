import { describe, it, expect } from 'vitest';
import { pickNativeTts, hasNativeTts, resolveNativeTranslation, NATIVE_ASR, NATIVE_TRANSLATION } from './nativeCatalog';

describe('nativeCatalog', () => {
  it('maps the 7 verified piper languages and nothing else', () => {
    for (const l of ['en', 'de', 'es', 'fr', 'it', 'ru', 'zh']) {
      expect(pickNativeTts(l)).toContain('vits-piper');
      expect(hasNativeTts(l)).toBe(true);
    }
    expect(pickNativeTts('ja')).toBe('');
    expect(hasNativeTts('ja')).toBe(false);
  });

  it('resolves translation choices', () => {
    expect(resolveNativeTranslation('opus-mt', 'zh', 'en')).toBe('Xenova/opus-mt-zh-en');
    expect(resolveNativeTranslation('', 'zh', 'en')).toBeUndefined();
    expect(resolveNativeTranslation('Qwen/Qwen2.5-0.5B-Instruct', 'a', 'b')).toBe('Qwen/Qwen2.5-0.5B-Instruct');
  });

  it('exposes ASR + translation options', () => {
    expect(NATIVE_ASR.map((m) => m.id)).toContain('sense-voice');
    expect(NATIVE_TRANSLATION.map((m) => m.id)).toEqual(['', 'opus-mt']);
  });
});
