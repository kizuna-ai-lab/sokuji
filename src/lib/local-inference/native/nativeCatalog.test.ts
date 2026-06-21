import { describe, it, expect } from 'vitest';
import { pickNativeTts, hasNativeTts, nativeTtsVoices, resolveNativeTts, resolveNativeTranslation, NATIVE_ASR, NATIVE_TRANSLATION, nativeAsrCards, nativeTranslationCards, nativeTtsCards } from './nativeCatalog';

describe('nativeCatalog', () => {
  it('maps the 7 verified piper languages and nothing else', () => {
    for (const l of ['en', 'de', 'es', 'fr', 'it', 'ru', 'zh']) {
      expect(pickNativeTts(l)).toContain('vits-piper');
      expect(hasNativeTts(l)).toBe(true);
      expect(nativeTtsVoices(l).length).toBeGreaterThan(0);
    }
    expect(pickNativeTts('ja')).toBe('');
    expect(hasNativeTts('ja')).toBe(false);
  });

  it('resolves the TTS choice against the target language', () => {
    // Auto -> default voice for the language
    expect(resolveNativeTts('', 'en')).toBe('csukuangfj/vits-piper-en_US-amy-low');
    // off -> no speech
    expect(resolveNativeTts('off', 'en')).toBeUndefined();
    // a valid voice for the language is kept
    expect(resolveNativeTts('csukuangfj/vits-piper-en_US-ryan-low', 'en')).toBe('csukuangfj/vits-piper-en_US-ryan-low');
    // a stale cross-language voice falls back to the language default
    expect(resolveNativeTts('csukuangfj/vits-piper-en_US-ryan-low', 'de')).toBe('csukuangfj/vits-piper-de_DE-thorsten-low');
    // language without a voice -> undefined
    expect(resolveNativeTts('', 'ja')).toBeUndefined();
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

  it('builds per-stage cards with the selectId/downloadId split', () => {
    expect(nativeAsrCards()[0]).toMatchObject({ selectId: 'sense-voice', downloadId: 'sense-voice' });

    const tr = nativeTranslationCards('zh', 'en');
    expect(tr[0]).toMatchObject({ selectId: '', downloadId: 'qwen' });
    expect(tr[1]).toMatchObject({ selectId: 'opus-mt', downloadId: 'Xenova/opus-mt-zh-en' });

    const tts = nativeTtsCards('en');
    expect(tts[0]).toMatchObject({ selectId: 'csukuangfj/vits-piper-en_US-amy-low', downloadId: 'csukuangfj/vits-piper-en_US-amy-low' });
    const off = tts[tts.length - 1];
    expect(off.selectId).toBe('off');
    expect(off.downloadId).toBeNull();

    // language with no piper voice -> only the Off card
    expect(nativeTtsCards('ja')).toEqual([{ selectId: 'off', downloadId: null, name: 'Off', note: 'text only' }]);
  });
});
