import { describe, it, expect } from 'vitest';
import { pickNativeTts, hasNativeTts, nativeTtsVoices, resolveNativeTts, resolveNativeTranslation, NATIVE_ASR, NATIVE_TRANSLATION, nativeAsrCards, nativeTranslationCards, nativeTtsCards, supportsLanguage, compatibleNativeAsr, incompatibleNativeAsr, nativeAsrIncompatibleCards, nativeAsrForLanguage, autoSelectNative, tierLabel, hardwareGated } from './nativeCatalog';
import type { NativeModelInfo } from './nativeProtocol';

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

  it('language compatibility + ASR auto-select', () => {
    // sense-voice supports its 5 langs; whisper is multi
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'zh')).toBe(true);
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'de')).toBe(false);
    expect(supportsLanguage({ languages: ['multi'] }, 'de')).toBe(true);

    // for a sense-voice language, sense-voice is compatible + recommended-first
    expect(compatibleNativeAsr('zh').map((m) => m.id)[0]).toBe('sense-voice');
    // for an unsupported language, sense-voice drops out → whisper-base leads
    expect(compatibleNativeAsr('de').map((m) => m.id)).not.toContain('sense-voice');
    expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');

    // auto-select keeps a still-compatible choice, else switches
    expect(nativeAsrForLanguage('zh', 'sense-voice')).toBe('sense-voice');
    expect(nativeAsrForLanguage('de', 'sense-voice')).toBe('whisper-base');
    expect(nativeAsrForLanguage('de', 'whisper-tiny')).toBe('whisper-tiny');
  });

  it('builds per-stage cards with the selectId/downloadId split', () => {
    expect(nativeAsrCards('zh')[0]).toMatchObject({ selectId: 'sense-voice', downloadId: 'sense-voice', recommended: true });
    expect(nativeAsrCards('de').map((c) => c.selectId)).not.toContain('sense-voice');

    const tr = nativeTranslationCards('zh', 'en');
    expect(tr[0]).toMatchObject({ selectId: '', downloadId: 'qwen' });
    expect(tr[1]).toMatchObject({ selectId: 'opus-mt', downloadId: 'Xenova/opus-mt-zh-en' });

    const tts = nativeTtsCards('en');
    expect(tts[0]).toMatchObject({ selectId: 'csukuangfj/vits-piper-en_US-amy-low', downloadId: 'csukuangfj/vits-piper-en_US-amy-low', recommended: true });
    // no Off card — voice picker only (text-only is the common textOnly toggle)
    expect(tts.every((c) => c.selectId !== 'off')).toBe(true);

    // language with no piper voice -> empty list (UI shows a text-only notice)
    expect(nativeTtsCards('ja')).toHaveLength(0);
  });

  it('includes whisper-large-v3 as an available, non-recommended ASR option', () => {
    const lv3 = NATIVE_ASR.find((m) => m.id === 'whisper-large-v3');
    expect(lv3).toBeTruthy();
    expect(lv3!.languages).toEqual(['multi']);
    expect(lv3!.recommended).toBeFalsy();
    // whisper-base stays the recommended multilingual fallback (CPU-real-time)
    expect(NATIVE_ASR.find((m) => m.id === 'whisper-base')!.recommended).toBe(true);
    // a non-sense-voice language still leads with whisper-base, not large-v3
    expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');
  });

  it('splits ASR into compatible / incompatible for a language', () => {
    // 'de' is not a sense-voice language: sense-voice is incompatible, whisper-* compatible
    expect(incompatibleNativeAsr('de').map((m) => m.id)).toEqual(['sense-voice']);
    expect(nativeAsrIncompatibleCards('de')[0]).toMatchObject({ selectId: 'sense-voice', downloadId: 'sense-voice' });
    // for a sense-voice language, sense-voice and whisper are compatible; Granite models (no zh) are incompatible
    expect(incompatibleNativeAsr('zh').map((m) => m.id)).toContain('granite-speech-4.1-2b');
    expect(incompatibleNativeAsr('zh').map((m) => m.id)).toContain('granite-speech-4.1-2b-plus');
    expect(nativeAsrIncompatibleCards('zh').map((c) => c.selectId)).toContain('granite-speech-4.1-2b');
  });

  describe('autoSelectNative', () => {
    const cur = (over = {}) => ({ asrModel: 'sense-voice', translationModel: '', ttsModel: '', ...over });
    const downloaded = (...ids: string[]) => (id: string | null) => id === null || ids.includes(id);
    const none = () => false;

    it('keeps a valid, downloaded selection (no change)', () => {
      expect(autoSelectNative('zh', 'en', cur(), downloaded('sense-voice', 'qwen'))).toBeNull();
    });

    it('drops an ASR model that no longer supports the source language', () => {
      // sense-voice does not support German → switch to the best downloaded compatible (whisper-base)
      const r = autoSelectNative('de', 'en', cur({ asrModel: 'sense-voice' }), downloaded('whisper-base', 'qwen'));
      expect(r).toMatchObject({ asrModel: 'whisper-base' });
    });

    it('clears ASR to "" when nothing compatible is downloaded (parity with local inference)', () => {
      const r = autoSelectNative('de', 'en', cur({ asrModel: 'sense-voice' }), none);
      expect(r?.asrModel).toBe('');
    });

    it('falls back from a not-downloaded opus-mt to whatever is downloaded for this pair', () => {
      // user picked opus-mt zh→en but only qwen is cached → revert to Qwen ('')
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice', translationModel: 'opus-mt' }), downloaded('sense-voice', 'qwen'));
      expect(r).toMatchObject({ translationModel: '' });
    });

    it('reverse pair: opus-mt downloaded one way is absent the other way', () => {
      // zh→en repo is cached; after swap to en→zh the en-zh repo is absent → opus-mt invalid
      const isDl = downloaded('sense-voice', 'Xenova/opus-mt-zh-en');
      // forward direction: opus-mt is valid and kept
      expect(autoSelectNative('zh', 'en', cur({ translationModel: 'opus-mt' }), isDl)).toBeNull();
      // reverse direction: downloadId becomes opus-mt-en-zh (absent) → reverts to Qwen
      const rev = autoSelectNative('en', 'zh', cur({ asrModel: 'whisper-base', translationModel: 'opus-mt' }), downloaded('whisper-base', 'Xenova/opus-mt-zh-en'));
      expect(rev).toMatchObject({ translationModel: '' });
    });

    it('resets a stale cross-language TTS voice to Auto', () => {
      const r = autoSelectNative('en', 'de', cur({ asrModel: 'whisper-base', ttsModel: 'csukuangfj/vits-piper-en_US-amy-low' }), downloaded('whisper-base', 'qwen'));
      expect(r?.ttsModel).toBe('');
    });

    it('migrates a legacy "off" TTS choice to Auto', () => {
      const r = autoSelectNative('zh', 'en', cur({ ttsModel: 'off' }), downloaded('sense-voice', 'qwen'));
      expect(r?.ttsModel).toBe('');
    });

    it('applies recalled history when its models are downloaded for this pair', () => {
      // history for zh→en prefers whisper-small; it is downloaded → recall overrides the default
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice' }), downloaded('whisper-small', 'qwen'),
        { asrModel: 'whisper-small', translationModel: '', ttsModel: '' });
      expect(r).toMatchObject({ asrModel: 'whisper-small' });
    });

    it('ignores recalled history whose model is not downloaded', () => {
      // recall wants whisper-small but only sense-voice is cached → keep sense-voice
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice' }), downloaded('sense-voice', 'qwen'),
        { asrModel: 'whisper-small', translationModel: '', ttsModel: '' });
      expect(r?.asrModel ?? 'sense-voice').toBe('sense-voice');
    });
  });

  it('exposes Granite speech-LLM ASR options with language-specific gating', () => {
    const ids = NATIVE_ASR.map((m) => m.id);
    expect(ids).toContain('granite-speech-4.1-2b');
    expect(ids).toContain('granite-speech-4.1-2b-plus');
    // base granite supports Japanese; the plus variant does not
    expect(compatibleNativeAsr('ja').map((m) => m.id)).toContain('granite-speech-4.1-2b');
    expect(compatibleNativeAsr('ja').map((m) => m.id)).not.toContain('granite-speech-4.1-2b-plus');
    // neither is recommended (sense-voice / whisper-base stay the recommended leaders)
    expect(NATIVE_ASR.find((m) => m.id === 'granite-speech-4.1-2b')!.recommended).toBeFalsy();
    // a non-sense-voice language still leads with whisper-base, not granite
    expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');
  });

  it('maps hardware tiers to display labels', () => {
    expect(tierLabel('cpu')).toEqual({ label: 'CPU', accel: false });
    expect(tierLabel('gpu-cuda')).toEqual({ label: 'GPU · CUDA', accel: true });
    expect(tierLabel('gpu-metal')).toEqual({ label: 'GPU · Metal', accel: true });
    expect(tierLabel('gpu-dml')).toEqual({ label: 'GPU · DirectML', accel: true });
    expect(tierLabel('gpu-vulkan')).toEqual({ label: 'GPU · Vulkan', accel: true });
    // unknown tier → echo the raw string, not accelerated
    expect(tierLabel('mystery')).toEqual({ label: 'mystery', accel: false });
  });

  it('hardwareGated is true only when a model has tiers but none are available', () => {
    expect(hardwareGated(undefined)).toBe(false);                       // unknown → not gated
    expect(hardwareGated({ id: 'x', name: 'X', languages: ['en'], recommended: false, tiers: [] } as any)).toBe(false);
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: false }] } as any)).toBe(true);   // GPU-only, no GPU
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: true }] } as any)).toBe(false);   // GPU present
    expect(hardwareGated({ id: 's', name: 'S', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } as any)).toBe(false);              // CPU floor
  });
});
