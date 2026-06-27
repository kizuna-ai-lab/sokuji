import { describe, it, expect } from 'vitest';
import { pickNativeTts, hasNativeTts, nativeTtsVoices, resolveNativeTts, resolveNativeTranslation, NATIVE_ASR, NATIVE_TRANSLATION, nativeAsrCards, nativeTranslationCards, nativeTtsCards, supportsLanguage, compatibleNativeAsr, incompatibleNativeAsr, nativeAsrIncompatibleCards, nativeAsrForLanguage, autoSelectNative, tierLabel, hardwareGated, gpuTierAvailable, formatRtf, formatTps, estimateNativeMemoryByDevice, formatMemMb, actualNativeMemoryByDevice, resolvedTierState, statusReposFor } from './nativeCatalog';
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
    expect(resolveNativeTranslation('')).toBeUndefined();
    expect(resolveNativeTranslation('Qwen/Qwen2.5-0.5B-Instruct')).toBe('Qwen/Qwen2.5-0.5B-Instruct');
  });

  it('exposes the four Qwen translation versions plus the speech-LLM translators', () => {
    const ids = nativeTranslationCards('zh', 'en').map((c) => c.selectId);
    // qwen2.5-0.5b is the recommended default; the rest are explicit versions + TranslateGemma/HY-MT2/HY-MT1.5 + opus-mt pair
    expect(ids).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b', 'translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'hy-mt15-1.8b', 'hy-mt15-7b', 'opus-mt-zh-en']);
  });

  it('exposes ASR + translation options', () => {
    expect(NATIVE_ASR.map((m) => m.id)).toContain('sense-voice');
    expect(NATIVE_TRANSLATION.map((m) => m.id)).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b', 'translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'hy-mt15-1.8b', 'hy-mt15-7b']);
  });

  it('language compatibility + ASR auto-select', () => {
    // sense-voice supports its 5 langs; whisper is multi
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'zh')).toBe(true);
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'de')).toBe(false);
    expect(supportsLanguage({ languages: ['multi'] }, 'de')).toBe(true);

    // Alias-aware: the picker emits app codes (cantonese/tl) while catalog rows use
    // ISO codes (yue/fil). Both must resolve to the same model.
    expect(supportsLanguage({ languages: ['yue'] }, 'cantonese')).toBe(true);
    expect(supportsLanguage({ languages: ['yue'] }, 'yue')).toBe(true);
    expect(supportsLanguage({ languages: ['fil'] }, 'tl')).toBe(true);
    expect(supportsLanguage({ languages: ['fil'] }, 'fil')).toBe(true);
    // sense-voice (yue) is reachable when the picker selects Cantonese (cantonese)
    expect(compatibleNativeAsr('cantonese').map((m) => m.id)).toContain('sense-voice');
    // fun-asr-mlt-nano (fil) is reachable when the picker selects Tagalog (tl)
    expect(compatibleNativeAsr('tl').map((m) => m.id)).toContain('fun-asr-mlt-nano');

    // for a sense-voice language, cohere now leads (recommended, sortOrder 0)
    expect(compatibleNativeAsr('zh').map((m) => m.id)[0]).toBe('cohere-transcribe-03-2026');
    // for an unsupported language, sense-voice drops out → cohere leads (supports de)
    expect(compatibleNativeAsr('de').map((m) => m.id)).not.toContain('sense-voice');
    expect(compatibleNativeAsr('de')[0].id).toBe('cohere-transcribe-03-2026');

    // auto-select keeps a still-compatible choice, else switches
    expect(nativeAsrForLanguage('zh', 'sense-voice')).toBe('sense-voice');
    expect(nativeAsrForLanguage('de', 'sense-voice')).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrForLanguage('de', 'whisper-tiny')).toBe('whisper-tiny');
  });

  it('builds per-stage cards with the selectId/downloadId split', () => {
    expect(nativeAsrCards('zh')[0]).toMatchObject({ selectId: 'cohere-transcribe-03-2026', downloadId: 'cohere-transcribe-03-2026', recommended: true });
    expect(nativeAsrCards('de').map((c) => c.selectId)).not.toContain('sense-voice');

    const tr = nativeTranslationCards('zh', 'en');
    expect(tr[0]).toMatchObject({ selectId: 'qwen2.5-0.5b', downloadId: 'qwen2.5-0.5b' });            // Qwen 2.5 0.5B recommended default
    expect(tr[1]).toMatchObject({ selectId: 'qwen3-0.6b', downloadId: 'qwen3-0.6b' });
    // every native translation card's downloadId equals its selectId
    expect(tr.every((c) => c.downloadId === c.selectId)).toBe(true);

    const tts = nativeTtsCards('en');
    expect(tts[0]).toMatchObject({ selectId: 'csukuangfj/vits-piper-en_US-amy-low', downloadId: 'csukuangfj/vits-piper-en_US-amy-low', recommended: true });
    // no Off card — voice picker only (text-only is the common textOnly toggle)
    expect(tts.every((c) => c.selectId !== 'off')).toBe(true);

    // language with no piper voice -> empty list (UI shows a text-only notice)
    expect(nativeTtsCards('ja')).toHaveLength(0);
  });

  it('includes whisper-large-v3 as the recommended multilingual ASR option', () => {
    const lv3 = NATIVE_ASR.find((m) => m.id === 'whisper-large-v3');
    expect(lv3).toBeTruthy();
    expect(lv3!.languages).toEqual(['multi']);
    expect(lv3!.recommended).toBe(true);
    // base is the light multilingual rung but no longer the recommended one
    expect(NATIVE_ASR.find((m) => m.id === 'whisper-base')!.recommended).toBeFalsy();
    // a non-sense-voice language still leads with cohere (recommended, sortOrder 0)
    expect(compatibleNativeAsr('de')[0].id).toBe('cohere-transcribe-03-2026');
  });

  it('splits ASR into compatible / incompatible for a language', () => {
    // 'de' is not a sense-voice language: sense-voice and fun-asr-mlt-nano are incompatible, whisper-* compatible
    expect(incompatibleNativeAsr('de').map((m) => m.id)).toEqual(['sense-voice', 'fun-asr-mlt-nano']);
    expect(nativeAsrIncompatibleCards('de')[0]).toMatchObject({ selectId: 'sense-voice', downloadId: 'sense-voice' });
    // for a sense-voice language, sense-voice and whisper are compatible; Granite models (no zh) are incompatible
    expect(incompatibleNativeAsr('zh').map((m) => m.id)).toContain('granite-speech-4.1-2b');
    expect(incompatibleNativeAsr('zh').map((m) => m.id)).toContain('granite-speech-4.1-2b-plus');
    expect(nativeAsrIncompatibleCards('zh').map((c) => c.selectId)).toContain('granite-speech-4.1-2b');
  });

  describe('autoSelectNative', () => {
    const cur = (over = {}) => ({ asrModel: 'sense-voice', translationModel: 'qwen2.5-0.5b', ttsModel: '', ...over });
    const downloaded = (...ids: string[]) => (id: string | null) => id === null || ids.includes(id);
    const none = () => false;

    it('keeps a valid, downloaded selection (no change)', () => {
      expect(autoSelectNative('zh', 'en', cur(), downloaded('sense-voice', 'qwen2.5-0.5b'))).toBeNull();
    });

    it('drops an ASR model that no longer supports the source language', () => {
      // sense-voice does not support German → switch to the best downloaded compatible (whisper-base)
      const r = autoSelectNative('de', 'en', cur({ asrModel: 'sense-voice' }), downloaded('whisper-base', 'qwen2.5-0.5b'));
      expect(r).toMatchObject({ asrModel: 'whisper-base' });
    });

    it('clears ASR to "" when nothing compatible is downloaded (parity with local inference)', () => {
      const r = autoSelectNative('de', 'en', cur({ asrModel: 'sense-voice' }), none);
      expect(r?.asrModel).toBe('');
    });

    it('falls back from a not-downloaded translation model to whatever is downloaded for this pair', () => {
      // user picked translategemma but only qwen2.5 is cached → revert to Qwen 2.5
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice', translationModel: 'translategemma-4b' }), downloaded('sense-voice', 'qwen2.5-0.5b'));
      expect(r).toMatchObject({ translationModel: 'qwen2.5-0.5b' });
    });

    it('resets a stale cross-language TTS voice to Auto', () => {
      const r = autoSelectNative('en', 'de', cur({ asrModel: 'whisper-base', ttsModel: 'csukuangfj/vits-piper-en_US-amy-low' }), downloaded('whisper-base', 'qwen2.5-0.5b'));
      expect(r?.ttsModel).toBe('');
    });

    it('migrates a legacy "off" TTS choice to Auto', () => {
      const r = autoSelectNative('zh', 'en', cur({ ttsModel: 'off' }), downloaded('sense-voice', 'qwen2.5-0.5b'));
      expect(r?.ttsModel).toBe('');
    });

    it('applies recalled history when its models are downloaded for this pair', () => {
      // history for zh→en prefers whisper-small; it is downloaded → recall overrides the default
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice' }), downloaded('whisper-small', 'qwen2.5-0.5b'),
        { asrModel: 'whisper-small', translationModel: 'qwen2.5-0.5b', ttsModel: '' });
      expect(r).toMatchObject({ asrModel: 'whisper-small' });
    });

    it('ignores recalled history whose model is not downloaded', () => {
      // recall wants whisper-small but only sense-voice is cached → keep sense-voice
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'sense-voice' }), downloaded('sense-voice', 'qwen2.5-0.5b'),
        { asrModel: 'whisper-small', translationModel: 'qwen2.5-0.5b', ttsModel: '' });
      expect(r?.asrModel ?? 'sense-voice').toBe('sense-voice');
    });

    const gatesCohere = (id: string | null) => id === 'cohere-transcribe-03-2026';

    it('never auto-selects a downloaded but hardware-gated ASR (GPU-only on a CPU box)', () => {
      // cohere (GPU-only, sorted first) + sense-voice both downloaded, but cohere is gated
      // here → must pick sense-voice, never the unrunnable cohere.
      const r = autoSelectNative('zh', 'en', cur({ asrModel: '' }),
        downloaded('cohere-transcribe-03-2026', 'sense-voice', 'qwen2.5-0.5b'), null, gatesCohere);
      expect(r?.asrModel).toBe('sense-voice');
    });

    it('reconciles away a remembered ASR that is now hardware-gated', () => {
      // the current selection IS the GPU-only cohere but this machine can't run it → replace it
      const r = autoSelectNative('zh', 'en', cur({ asrModel: 'cohere-transcribe-03-2026' }),
        downloaded('cohere-transcribe-03-2026', 'sense-voice', 'qwen2.5-0.5b'), null, gatesCohere);
      expect(r?.asrModel).toBe('sense-voice');
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
    // a non-sense-voice language still leads with cohere (now recommended, sortOrder 0)
    expect(compatibleNativeAsr('de')[0].id).toBe('cohere-transcribe-03-2026');
  });

  it('includes Qwen3-ASR 1.7B as a recommended GPU option with verbatim sidecar languages', () => {
    const q = NATIVE_ASR.find((m) => m.id === 'qwen3-asr-1.7b');
    expect(q).toBeTruthy();
    expect(q!.languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id']);
    expect(q!.recommended).toBe(true);
    expect(q!.sortOrder).toBe(9);   // 8 → 9 after whisper-medium was inserted
    // recommended, but its high sortOrder keeps Cohere first
    expect(nativeAsrCards('zh')[0].selectId).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrCards('de')[0].selectId).toBe('cohere-transcribe-03-2026');
  });

  it('includes Cohere Transcribe as the first (recommended) ASR with its 14 languages', () => {
    const c = NATIVE_ASR.find((m) => m.id === 'cohere-transcribe-03-2026');
    expect(c).toBeTruthy();
    expect(c!.label).toBe('Cohere Transcribe');
    expect(c!.languages).toEqual(['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko']);
    expect(c!.recommended).toBe(true);
    expect(c!.sortOrder).toBe(0);
    // Cohere leads for every language it supports...
    expect(nativeAsrCards('zh')[0].selectId).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrCards('ja')[0].selectId).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrCards('de')[0].selectId).toBe('cohere-transcribe-03-2026');
    // ...but not for Cantonese (yue), which Cohere does not support → sense-voice still leads
    expect(nativeAsrCards('yue')[0].selectId).toBe('sense-voice');
  });

  it('includes Voxtral Mini 4B Realtime (recommended, sortOrder 10, 13 langs)', () => {
    const v = NATIVE_ASR.find((m) => m.id === 'voxtral-mini-4b-realtime');
    expect(v).toBeDefined();
    expect(v!.label).toBe('Voxtral Mini 4B Realtime');
    expect(v!.recommended).toBe(true);
    expect(v!.sortOrder).toBe(10);   // 9 → 10 after whisper-medium was inserted
    expect(v!.languages).toEqual(['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko']);
    // listed for a supported language (ja), behind the recommended rows
    expect(compatibleNativeAsr('ja').map((m) => m.id)).toContain('voxtral-mini-4b-realtime');
    // dropped for a language it lacks (Thai 'th' — Qwen3 has it, Voxtral does not)
    expect(compatibleNativeAsr('th').map((m) => m.id)).not.toContain('voxtral-mini-4b-realtime');
    // does not displace cohere as the recommended leader for a shared language
    expect(compatibleNativeAsr('zh')[0].id).toBe('cohere-transcribe-03-2026');
  });

  it('includes fun-asr-mlt-nano as a recommended 31-language ASR option', () => {
    const m = NATIVE_ASR.find((x) => x.id === 'fun-asr-mlt-nano');
    expect(m).toBeTruthy();
    expect(m!.label).toBe('Fun-ASR MLT Nano');
    expect(m!.recommended).toBe(true);
    expect(m!.languages).toHaveLength(31);
    expect(m!.languages.slice(0, 5)).toEqual(['zh', 'en', 'yue', 'ja', 'ko']);
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

  it('gpuTierAvailable reflects any available non-cpu tier in the feed', () => {
    expect(gpuTierAvailable({})).toBe(false);
    expect(gpuTierAvailable({ a: { id: 'a', name: 'A', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } } as any)).toBe(false);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: true }] } } as any)).toBe(true);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: false }] } } as any)).toBe(false);
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

  it('formatRtf renders a realtime multiple', () => {
    expect(formatRtf(0.5)).toBe('2× realtime');
    expect(formatRtf(0.015)).toBe('67× realtime');
    expect(formatRtf(1)).toBe('1× realtime');
    expect(formatRtf(0)).toBe('realtime');
  });

  it('formatTps renders tokens/sec, empty for invalid', () => {
    expect(formatTps(130.5)).toBe('131 tok/s');
    expect(formatTps(59.4)).toBe('59 tok/s');
    expect(formatTps(0)).toBe('');
    expect(formatTps(NaN)).toBe('');
    expect(formatTps(-5)).toBe('');
  });

  describe('estimateNativeMemoryByDevice', () => {
    const MB = 1_048_576;
    const tier = (t: string, available = true) => ({ tier: t, backend: 'x', available });
    const info = (id: string, tiers: { tier: string; backend: string; available: boolean }[]): NativeModelInfo =>
      ({ id, name: id, languages: [], recommended: false, tiers });
    const gpuCatalog = {
      voxtral: info('voxtral', [tier('gpu-cuda')]),                 // GPU-only, available
      qwen: info('qwen', [tier('gpu-cuda'), tier('cpu')]),          // GPU + CPU floor
      cpuonly: info('cpuonly', [tier('cpu')]),                      // CPU-only
    };

    it('routes auto GPU-capable models to VRAM and CPU-only models to RAM', () => {
      const sizes = { voxtral: 8000 * MB, qwen: 4000 * MB, piper: 60 * MB };
      const est = estimateNativeMemoryByDevice(
        [{ id: 'voxtral', device: 'auto' }, { id: 'qwen', device: 'auto' }, { id: 'piper', device: 'cpu' }],
        sizes, gpuCatalog,
      );
      expect(est).toEqual({ vramMb: 12000, ramMb: 60 }); // voxtral+qwen → VRAM, piper → RAM
    });

    it('honors an explicit cpu override (auto-GPU model counted as RAM)', () => {
      const est = estimateNativeMemoryByDevice(
        [{ id: 'qwen', device: 'cpu' }], { qwen: 4000 * MB }, gpuCatalog,
      );
      expect(est).toEqual({ vramMb: 0, ramMb: 4000 });
    });

    it('honors an explicit cuda override even without a catalog entry', () => {
      const est = estimateNativeMemoryByDevice(
        [{ id: 'unknown', device: 'cuda' }], { unknown: 2000 * MB }, {},
      );
      expect(est).toEqual({ vramMb: 2000, ramMb: 0 });
    });

    it('treats auto models with no usable GPU tier as RAM (CPU-only machine)', () => {
      const cpuOnly = { qwen: info('qwen', [tier('gpu-cuda', false), tier('cpu', true)]) };
      const est = estimateNativeMemoryByDevice(
        [{ id: 'qwen', device: 'auto' }], { qwen: 4000 * MB }, cpuOnly,
      );
      expect(est).toEqual({ vramMb: 0, ramMb: 4000 });
    });

    it('skips missing ids and zero/unmeasured sizes', () => {
      const est = estimateNativeMemoryByDevice(
        [{ id: undefined, device: 'auto' }, { id: 'qwen', device: 'auto' }],
        { /* qwen size not yet measured */ }, gpuCatalog,
      );
      expect(est).toEqual({ vramMb: 0, ramMb: 0 });
    });
  });

  describe('formatMemMb', () => {
    it('renders GB at/over 1024 MB, MB below', () => {
      expect(formatMemMb(8294)).toBe('8.1 GB');
      expect(formatMemMb(120)).toBe('120 MB');
      expect(formatMemMb(1024)).toBe('1.0 GB');
    });
  });

  describe('actualNativeMemoryByDevice', () => {
    const MB = 1_048_576;
    it('sums memoryBytes by real device (degraded translation lands in RAM)', () => {
      const asr = { model: 'voxtral', device: 'cuda', memoryBytes: 8000 * MB };
      const tr = { model: 'qwen', device: 'cpu', memoryBytes: 4000 * MB, fallbackReason: 'low VRAM' };
      expect(actualNativeMemoryByDevice(asr, tr)).toEqual({ vramMb: 8000, ramMb: 4000 });
    });
    it('skips stages with no measured bytes', () => {
      const asr = { model: 'voxtral', device: 'cuda' };
      expect(actualNativeMemoryByDevice(asr, null)).toEqual({ vramMb: 0, ramMb: 0 });
    });
  });

  describe('resolvedTierState', () => {
    const MB = 1_048_576;
    it('maps a live GPU plan to a non-degraded gpu tier with memory', () => {
      expect(resolvedTierState({ model: 'v', device: 'cuda', memoryBytes: 8294 * MB }))
        .toEqual({ tier: 'gpu-cuda', degraded: false, memoryMb: 8294 });
    });
    it('flags a CPU plan WITH a fallback reason as degraded', () => {
      expect(resolvedTierState({ model: 'q', device: 'cpu', memoryBytes: 4000 * MB, fallbackReason: 'low VRAM' }))
        .toEqual({ tier: 'cpu', degraded: true, memoryMb: 4000 });
    });
    it('a CPU plan WITHOUT a reason is chosen-CPU, not degraded', () => {
      expect(resolvedTierState({ model: 'q', device: 'cpu' }))
        .toEqual({ tier: 'cpu', degraded: false, memoryMb: undefined });
    });
    it('returns null for no resolved', () => {
      expect(resolvedTierState(null)).toBeNull();
    });
  });

  describe('Opus-MT pair cards', () => {
    it('appends the matching pair card after the multilingual models', () => {
      const ids = nativeTranslationCards('zh', 'en').map((c) => c.selectId);
      expect(ids).toContain('opus-mt-zh-en');
      expect(ids.indexOf('opus-mt-zh-en')).toBeGreaterThan(ids.indexOf('hy-mt2-7b')); // opt-in, after defaults
    });

    it('shows only the pair matching the active direction', () => {
      const enJa = nativeTranslationCards('en', 'ja').map((c) => c.selectId);
      expect(enJa).toContain('opus-mt-en-jap');   // id keeps Helsinki "jap"
      expect(enJa).not.toContain('opus-mt-ja-en'); // reverse direction hidden
      const jaEn = nativeTranslationCards('ja', 'en').map((c) => c.selectId);
      expect(jaEn).toContain('opus-mt-ja-en');
      expect(jaEn).not.toContain('opus-mt-en-jap');
    });

    it('shows no Opus-MT card for an unsupported pair', () => {
      const ids = nativeTranslationCards('de', 'fr').map((c) => c.selectId);
      expect(ids.some((id) => id.startsWith('opus-mt-'))).toBe(false);
    });

    it('opus cards keep downloadId === selectId', () => {
      const opus = nativeTranslationCards('zh', 'en').filter((c) => c.selectId.startsWith('opus-mt-'));
      expect(opus.length).toBeGreaterThan(0);
      expect(opus.every((c) => c.downloadId === c.selectId)).toBe(true);
    });
  });

  describe('NATIVE_TRANSLATION new models', () => {
    it('exposes HY-MT1.5 1.8B + 7B as selectable multilingual cards', () => {
      const byId = Object.fromEntries(NATIVE_TRANSLATION.map((m) => [m.id, m]));
      expect(byId['hy-mt15-1.8b']?.label).toBe('Hunyuan-MT1.5 1.8B');
      expect(byId['hy-mt15-7b']?.label).toBe('Hunyuan-MT1.5 7B');
      expect(byId['hy-mt15-1.8b']?.languages).toEqual(['multi']);
      const cards = nativeTranslationCards('zh', 'en');
      const c = Object.fromEntries(cards.map((x) => [x.selectId, x]));
      expect(c['hy-mt15-1.8b']).toMatchObject({ selectId: 'hy-mt15-1.8b', downloadId: 'hy-mt15-1.8b' });
      expect(c['hy-mt15-7b']).toMatchObject({ selectId: 'hy-mt15-7b', downloadId: 'hy-mt15-7b' });
    });

    it('includes TranslateGemma and HY-MT2 with ids matching the sidecar catalog', () => {
      const byId = Object.fromEntries(NATIVE_TRANSLATION.map((m) => [m.id, m]));
      expect(byId['translategemma-4b']?.label).toBe('TranslateGemma 4B');
      expect(byId['hy-mt2-1.8b']?.label).toBe('Hunyuan-MT2 1.8B');
      expect(byId['hy-mt2-7b']?.label).toBe('Hunyuan-MT2 7B');
    });

    it('nativeTranslationCards exposes TranslateGemma + HY-MT2 as selectable cards', () => {
      const ids = nativeTranslationCards('Japanese', 'English').map((c) => c.selectId);
      expect(ids).toEqual(expect.arrayContaining(['translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b']));
      const byId = Object.fromEntries(nativeTranslationCards('Japanese', 'English').map((c) => [c.selectId, c]));
      expect(byId['translategemma-4b'].name).toBe('TranslateGemma 4B');
      expect(byId['hy-mt2-1.8b'].name).toBe('Hunyuan-MT2 1.8B');
      expect(byId['hy-mt2-7b'].name).toBe('Hunyuan-MT2 7B');
      expect(byId['translategemma-4b'].downloadId).toBe('translategemma-4b'); // selectId == downloadId, like the qwen cards
    });
  });

  describe('statusReposFor', () => {
    const vd = {
      'hy-mt2-1.8b': { variants: [
        { id: 'bfloat16', repo: 'tencent/Hy-MT2-1.8B', computeType: 'bfloat16', sizeBytes: 0, supported: true, reason: '' },
        { id: 'fp8', repo: 'tencent/Hy-MT2-1.8B-FP8', computeType: 'fp8', sizeBytes: 0, supported: true, reason: '' },
      ], recommended: 'bfloat16' },
    };
    it('maps a card to its chosen variant repo (pinned)', () => {
      const repos = statusReposFor(['hy-mt2-1.8b', 'sense-voice'], vd, { 'hy-mt2-1.8b': 'fp8' });
      expect(repos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });   // sense-voice has no variants → omitted
    });
    it('falls back to the recommended variant repo when unpinned', () => {
      const repos = statusReposFor(['hy-mt2-1.8b'], vd, {});
      expect(repos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B' });
    });
  });
});
