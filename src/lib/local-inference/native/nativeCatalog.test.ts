import { describe, it, expect } from 'vitest';
import { voiceCapability, isCloneOnlyVoice, resolveNativeTts, resolveNativeTranslation, requiredNativeModels, nativeAsrCards, nativeTranslationCards, nativeTtsCards, supportsLanguage, compatibleNativeAsr, incompatibleNativeAsr, nativeAsrIncompatibleCards, nativeAsrForLanguage, tierLabel, hardwareGated, gpuTierAvailable, formatRtf, formatTps, estimateNativeMemoryByDevice, formatMemMb, actualNativeMemoryByDevice, resolvedTierState, statusReposFor, pinsFromSelections, defaultTtsVoice, curatedBuiltinVoices, infoToCard, frameworkLabel, accelApiLabel, buildBackendTooltipRows } from './nativeCatalog';
import type { NativeModelInfo, NativeVoiceInfo } from './nativeProtocol';

const V = (name: string, language: string | undefined, curated: boolean, def = false): NativeVoiceInfo =>
  ({ name, language, curated, unstable: false, default: def });

/**
 * Fixture catalog for ASR logic tests. Contains entries that exercise:
 *   - recommended-first then order sorting
 *   - language filtering (including multi)
 *   - canonLang aliases (yue for cantonese, fil for tl)
 * Production catalog data lives in the sidecar (tested in sidecar/tests/test_catalog.py).
 */
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [], order, repo: id, kind, ...extra });

const FIXTURE_ASR: Record<string, NativeModelInfo> = {
  // recommended, order 0 — covers en/de/zh/ja/ko; leads for those languages
  'cohere-transcribe-03-2026': M('cohere-transcribe-03-2026', 'asr', ['en', 'de', 'zh', 'ja', 'ko'], 0, true),
  // recommended, order 1 — covers zh/en/ja/ko/yue (yue = cantonese alias)
  'sense-voice': M('sense-voice', 'asr', ['zh', 'en', 'ja', 'ko', 'yue'], 1, true),
  // non-recommended multi models for fallback
  'whisper-tiny': M('whisper-tiny', 'asr', ['multi'], 2),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 3),
  'whisper-small': M('whisper-small', 'asr', ['multi'], 4),
  // recommended, order 11 — covers yue + fil (fil = tl alias)
  'fun-asr': M('fun-asr', 'asr', ['zh', 'en', 'yue', 'fil'], 11, true),
  // non-recommended, restricted languages — for incompatible split tests
  'granite': M('granite', 'asr', ['en', 'fr'], 7),
};

/**
 * Fixture catalog for translation logic tests. Exercises:
 *   - multilingual models (languages includes 'multi') always shown, order-sorted
 *   - pair-specific Opus models shown only when src/tgt match
 *   - canonLang aliases on the pair (passed as-is; infoToCard echoes them)
 */
const TR_CAT: Record<string, NativeModelInfo> = {
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
  'qwen3-0.6b': M('qwen3-0.6b', 'translate', ['multi'], 2, true),
  'opus-mt-zh-en': M('opus-mt-zh-en', 'translate', ['zh', 'en'], 21),
  'opus-mt-en-zh': M('opus-mt-en-zh', 'translate', ['en', 'zh'], 22),
};

/**
 * TTS-specific fixture catalog for voiceCapability / nativeTtsCards / resolveNativeTts tests.
 * Exercises: named+clip (clones), none (single speaker, no clones), ordering.
 * numSpeakers died server-side (Task 5/6) and was removed from NativeModelInfo
 * in Task 7's sweep (R4) — these fixtures no longer carry it.
 */
const TTS_CAT: Record<string, NativeModelInfo> = {
  'moss-tts-nano': M('moss-tts-nano', 'tts', ['en', 'ja'], 0, true, { clones: true, streaming: true }),
  'csukuangfj/vits-piper-en_US-amy-low': M('csukuangfj/vits-piper-en_US-amy-low', 'tts', ['en'], 10, false, { clones: false }),
  'csukuangfj/vits-piper-en_US-libritts_r-medium': M('csukuangfj/vits-piper-en_US-libritts_r-medium', 'tts', ['en'], 11, false, { clones: false }),
};

describe('nativeCatalog', () => {
  it('nativeTranslationCards: multilingual always, opus only for the matching pair', () => {
    const zhEn = nativeTranslationCards('zh', 'en', TR_CAT).map((c) => c.selectId);
    expect(zhEn).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'opus-mt-zh-en']);
    const enZh = nativeTranslationCards('en', 'zh', TR_CAT).map((c) => c.selectId);
    expect(enZh).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'opus-mt-en-zh']);
  });

  it('resolves translation choices', () => {
    expect(resolveNativeTranslation('')).toBeUndefined();
    expect(resolveNativeTranslation('Qwen/Qwen2.5-0.5B-Instruct')).toBe('Qwen/Qwen2.5-0.5B-Instruct');
  });

  it('language compatibility + ASR auto-select (catalog-derived)', () => {
    // supportsLanguage basics
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'zh')).toBe(true);
    expect(supportsLanguage({ languages: ['zh', 'en'] }, 'de')).toBe(false);
    expect(supportsLanguage({ languages: ['multi'] }, 'de')).toBe(true);

    // Alias-aware: the picker emits app codes (cantonese/tl) while catalog rows use
    // ISO codes (yue/fil). Both must resolve to the same model.
    expect(supportsLanguage({ languages: ['yue'] }, 'cantonese')).toBe(true);
    expect(supportsLanguage({ languages: ['yue'] }, 'yue')).toBe(true);
    expect(supportsLanguage({ languages: ['fil'] }, 'tl')).toBe(true);
    expect(supportsLanguage({ languages: ['fil'] }, 'fil')).toBe(true);
    // sense-voice (yue) and fun-asr (yue) are reachable when the picker selects Cantonese
    expect(compatibleNativeAsr('cantonese', FIXTURE_ASR).map((m) => m.id)).toContain('sense-voice');
    expect(compatibleNativeAsr('cantonese', FIXTURE_ASR).map((m) => m.id)).toContain('fun-asr');
    // fun-asr (fil) is reachable when the picker selects Tagalog (tl)
    expect(compatibleNativeAsr('tl', FIXTURE_ASR).map((m) => m.id)).toContain('fun-asr');

    // Recommended-first then order: for zh, cohere (recommended, order 0) leads
    expect(compatibleNativeAsr('zh', FIXTURE_ASR).map((m) => m.id)[0]).toBe('cohere-transcribe-03-2026');
    // sense-voice doesn't support 'de' → incompatible; cohere does and leads
    expect(compatibleNativeAsr('de', FIXTURE_ASR).map((m) => m.id)).not.toContain('sense-voice');
    expect(compatibleNativeAsr('de', FIXTURE_ASR)[0].id).toBe('cohere-transcribe-03-2026');

    // auto-select keeps a still-compatible choice, else switches to best compatible
    expect(nativeAsrForLanguage('zh', 'sense-voice', FIXTURE_ASR)).toBe('sense-voice');
    expect(nativeAsrForLanguage('de', 'sense-voice', FIXTURE_ASR)).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrForLanguage('de', 'whisper-tiny', FIXTURE_ASR)).toBe('whisper-tiny');
  });

  it('builds per-stage cards with the selectId/downloadId split', () => {
    // ASR cards from catalog: cohere leads for zh (recommended, order 0)
    expect(nativeAsrCards('zh', FIXTURE_ASR)[0]).toMatchObject({
      selectId: 'cohere-transcribe-03-2026', downloadId: 'cohere-transcribe-03-2026', recommended: true,
    });
    // sense-voice is incompatible with 'de', so it does not appear in the compatible list
    expect(nativeAsrCards('de', FIXTURE_ASR).map((c) => c.selectId)).not.toContain('sense-voice');

    const tr = nativeTranslationCards('zh', 'en', TR_CAT);
    expect(tr[0]).toMatchObject({ selectId: 'qwen2.5-0.5b', downloadId: 'qwen2.5-0.5b' });            // Qwen 2.5 0.5B recommended default
    expect(tr[1]).toMatchObject({ selectId: 'qwen3-0.6b', downloadId: 'qwen3-0.6b' });
    // every native translation card's downloadId equals its selectId
    expect(tr.every((c) => c.downloadId === c.selectId)).toBe(true);

    // TTS cards derive from catalog — use TTS_CAT fixture (moss recommended, order=0 → first)
    const tts = nativeTtsCards('en', TTS_CAT);
    expect(tts[0]).toMatchObject({ selectId: 'moss-tts-nano', downloadId: 'moss-tts-nano', recommended: true });
    // no Off card — voice picker only (text-only is the common textOnly toggle)
    expect(tts.every((c) => c.selectId !== 'off')).toBe(true);

    // language with only MOSS support in TTS_CAT -> MOSS card only
    const jaCards = nativeTtsCards('ja', TTS_CAT);
    expect(jaCards).toHaveLength(1);
    expect(jaCards[0]).toMatchObject({ selectId: 'moss-tts-nano', downloadId: 'moss-tts-nano', recommended: true });

    // cards show the model's FULL language list (like ASR/translate cards),
    // not just the currently selected target language
    expect(jaCards[0].languages).toEqual(TTS_CAT['moss-tts-nano'].languages);
    expect(jaCards[0].languages.length).toBeGreaterThan(1);
  });

  it('splits ASR into compatible / incompatible for a language (catalog-derived)', () => {
    // 'de': cohere/whisper-* support it; sense-voice and fun-asr do not
    const incompatibleDe = incompatibleNativeAsr('de', FIXTURE_ASR).map((m) => m.id);
    expect(incompatibleDe).toContain('sense-voice');
    expect(incompatibleDe).toContain('fun-asr');
    expect(incompatibleDe).not.toContain('cohere-transcribe-03-2026');
    // recommended models appear first in the incompatible list (sense-voice order 1, fun-asr order 11)
    expect(incompatibleDe[0]).toBe('sense-voice');
    // incompatible cards have the correct selectId/downloadId structure
    expect(nativeAsrIncompatibleCards('de', FIXTURE_ASR)[0]).toMatchObject({ selectId: 'sense-voice', downloadId: 'sense-voice' });
    // for zh: all fixture models except granite are compatible; granite (en/fr only) is incompatible
    expect(incompatibleNativeAsr('zh', FIXTURE_ASR).map((m) => m.id)).toContain('granite');
    expect(nativeAsrIncompatibleCards('zh', FIXTURE_ASR).map((c) => c.selectId)).toContain('granite');
  });

  it('maps hardware tiers to display labels', () => {
    expect(tierLabel('cpu')).toEqual({ label: 'CPU', accel: false });
    expect(tierLabel('gpu-metal')).toEqual({ label: 'GPU · Metal', accel: true });
    expect(tierLabel('gpu-vulkan')).toEqual({ label: 'GPU · Vulkan', accel: true });
    // gpu-cuda/gpu-dml died with the ONNX/MLX TTS backends that were their
    // last catalog producers (slice 4 — R4); an unrecognized tier (including
    // those two now) echoes the raw string, not accelerated.
    expect(tierLabel('gpu-cuda')).toEqual({ label: 'gpu-cuda', accel: false });
    expect(tierLabel('mystery')).toEqual({ label: 'mystery', accel: false });
  });

  it('gpuTierAvailable reflects any available non-cpu tier in the feed', () => {
    expect(gpuTierAvailable({})).toBe(false);
    expect(gpuTierAvailable({ a: { id: 'a', name: 'A', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } } as any)).toBe(false);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-vulkan', backend: 'transformers', available: true }] } } as any)).toBe(true);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-vulkan', backend: 'transformers', available: false }] } } as any)).toBe(false);
  });

  it('hardwareGated is true only when a model has tiers but none are available', () => {
    expect(hardwareGated(undefined)).toBe(false);                       // unknown → not gated
    expect(hardwareGated({ id: 'x', name: 'X', languages: ['en'], recommended: false, tiers: [] } as any)).toBe(false);
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-vulkan', backend: 'transformers', available: false }] } as any)).toBe(true);   // GPU-only, no GPU
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-vulkan', backend: 'transformers', available: true }] } as any)).toBe(false);   // GPU present
    expect(hardwareGated({ id: 's', name: 'S', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } as any)).toBe(false);              // CPU floor
  });

  it('formatRtf renders a realtime multiple: one decimal below 10×, whole numbers above', () => {
    expect(formatRtf(0.5)).toBe('2× realtime');
    expect(formatRtf(0.625)).toBe('1.6× realtime');
    expect(formatRtf(2.5)).toBe('0.4× realtime');
    expect(formatRtf(0.105)).toBe('9.5× realtime');
    expect(formatRtf(0.1)).toBe('10× realtime');
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
      voxtral: info('voxtral', [tier('gpu-vulkan')]),                 // GPU-only, available
      qwen: info('qwen', [tier('gpu-vulkan'), tier('cpu')]),          // GPU + CPU floor
      cpuonly: info('cpuonly', [tier('cpu')]),                        // CPU-only
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

    it('honors an explicit gpu override even without a catalog entry', () => {
      const est = estimateNativeMemoryByDevice(
        [{ id: 'unknown', device: 'gpu' }], { unknown: 2000 * MB }, {},
      );
      expect(est).toEqual({ vramMb: 2000, ramMb: 0 });
    });

    it('treats auto models with no usable GPU tier as RAM (CPU-only machine)', () => {
      const cpuOnly = { qwen: info('qwen', [tier('gpu-vulkan', false), tier('cpu', true)]) };
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

  describe('pinsFromSelections', () => {
    // A model id is the sidecar's status/repo key, not (direction, model id)
    // — two directions pinning the SAME model to different variants collide,
    // and the doc comment on pinsFromSelections says FIRST-wins so the
    // speaker (audible) leg beats the participant (silent) one when callers
    // list it first.
    it('the FIRST direction to pin a given model id wins on a collision', () => {
      const selections = {
        'ja→en': { asr: { modelId: '' }, translation: { modelId: 'hy-mt2-7b', variant: 'q4_k_m' }, tts: { modelId: '' } },
        'en→ja': { asr: { modelId: '' }, translation: { modelId: 'hy-mt2-7b', variant: 'q8_0' }, tts: { modelId: '' } },
      };
      expect(pinsFromSelections(selections, ['ja→en', 'en→ja'])).toEqual({ 'hy-mt2-7b': 'q4_k_m' });
      // Reversing which direction is listed first reverses which pin wins —
      // pins the collision rule to argument ORDER, not object key order.
      expect(pinsFromSelections(selections, ['en→ja', 'ja→en'])).toEqual({ 'hy-mt2-7b': 'q8_0' });
    });

    it('collects non-colliding pins from every listed direction', () => {
      const selections = {
        'ja→en': { asr: { modelId: 'sense-voice', variant: 'q4' }, translation: { modelId: '' }, tts: { modelId: '' } },
        'en→ja': { asr: { modelId: '' }, translation: { modelId: 'hy-mt2-7b', variant: 'q8_0' }, tts: { modelId: '' } },
      };
      expect(pinsFromSelections(selections, ['ja→en', 'en→ja'])).toEqual({
        'sense-voice': 'q4', 'hy-mt2-7b': 'q8_0',
      });
    });
  });

  it('voiceCapability derives builtin/custom for named/none TTS models', () => {
    // A model with no `clones` and no `voice` field is just 'none' -- the old
    // numSpeakers-driven 'range' builtin died with the ONNX range-model
    // backends (Task 5/6) and the field itself was removed in Task 7's sweep.
    expect(voiceCapability(TTS_CAT['moss-tts-nano'])).toEqual({ builtin: 'named', custom: 'clip' });
    expect(voiceCapability(TTS_CAT['csukuangfj/vits-piper-en_US-libritts_r-medium'])).toEqual({ builtin: 'none', custom: 'none' });
    expect(voiceCapability(TTS_CAT['csukuangfj/vits-piper-en_US-amy-low'])).toEqual({ builtin: 'none', custom: 'none' });
    expect(voiceCapability(undefined)).toEqual({ builtin: 'none', custom: 'none' });
  });

  it('nativeTtsCards lists tts models for the language; resolveNativeTts honors off/valid/default', () => {
    expect(nativeTtsCards('ja', TTS_CAT).map((c) => c.selectId)).toEqual(['moss-tts-nano']);
    expect(resolveNativeTts('off', 'en', TTS_CAT)).toBeUndefined();
    expect(resolveNativeTts('csukuangfj/vits-piper-en_US-amy-low', 'en', TTS_CAT)).toBe('csukuangfj/vits-piper-en_US-amy-low');
    expect(resolveNativeTts('', 'en', TTS_CAT)).toBe('moss-tts-nano'); // recommended/order-first default
  });

  it('defaultTtsVoice picks the language default descriptor', () => {
    const voices = [V('Ava', 'en', true, true), V('Bella', 'en', true), V('Saki', 'ja', true, true)];
    expect(defaultTtsVoice('en', voices)).toBe('builtin:Ava');
    expect(defaultTtsVoice('ja', voices)).toBe('builtin:Saki');
  });

  it('defaultTtsVoice falls back to first curated, then empty', () => {
    expect(defaultTtsVoice('fr', [V('Ava', 'en', true, true)])).toBe('builtin:Ava');
    expect(defaultTtsVoice('fr', [])).toBe('');
  });

  it('defaultTtsVoice honors a language-less default preset over first-curated (Supertonic)', () => {
    // Supertonic presets have no language; Robert (sid 7) is the sole default:true.
    // Must resolve to Robert, not the first curated preset (Sarah).
    const voices = [V('Sarah', undefined, true, false), V('Robert', undefined, true, true)];
    expect(defaultTtsVoice('en', voices)).toBe('builtin:Robert');
  });

  it('curatedBuiltinVoices splits and orders target-language curated first', () => {
    const voices = [V('Bella', 'en', true), V('Saki', 'ja', true), V('Nathan', 'en', false)];
    const { curated, rest } = curatedBuiltinVoices('en', voices);
    expect(curated.map((v) => v.name)).toEqual(['Bella', 'Saki']);
    expect(rest.map((v) => v.name)).toEqual(['Nathan']);
  });

  it('defaultTtsVoice returns Ava for English and a builtin: prefix', () => {
    const voices = [V('Ava', 'en', true, true), V('Bella', 'en', true)];
    expect(defaultTtsVoice('en', voices)).toBe('builtin:Ava');
  });
  it('defaultTtsVoice falls back to first curated when no language match', () => {
    const voices = [V('Ava', 'en', true, true)];
    expect(defaultTtsVoice('xx', voices)).toBe('builtin:Ava');
  });
  it('curatedBuiltinVoices splits curated vs rest preserving membership', () => {
    const all = [V('Ava', 'en', true), V('Adam', 'en', false), V('Bella', 'en', true), V('Junhao', 'zh', false)];
    const { curated, rest } = curatedBuiltinVoices('en', all);
    expect(curated.map((v) => v.name)).toContain('Ava');
    const combined = [...curated, ...rest].map((v) => v.name).sort();
    expect(combined).toEqual(all.map((v) => v.name).sort());
    expect(curated.every((v) => all.map((x) => x.name).includes(v.name))).toBe(true);
  });
  it('voiceCapability reads the capability from the sidecar voice field', () => {
    expect(voiceCapability({ voice: { builtin: 'named', custom: 'clip' } } as any)).toEqual({ builtin: 'named', custom: 'clip' });
  });
  it('voiceCapability falls back to derive when voice is absent', () => {
    expect(voiceCapability({ clones: true } as any)).toEqual({ builtin: 'named', custom: 'clip' });
    // numSpeakers died server-side (Task 5/6) and was removed from
    // NativeModelInfo (Task 7's sweep, R4) -- a stale/legacy payload still
    // carrying it derives 'none', same as any other unrecognized shape.
    expect(voiceCapability({ numSpeakers: 174 } as any)).toEqual({ builtin: 'none', custom: 'none' });
    expect(voiceCapability({} as any)).toEqual({ builtin: 'none', custom: 'none' });
  });

  it('voiceCapability passes transcriptRequired through', () => {
    expect(voiceCapability({ voice: { builtin: 'none', custom: 'clip', transcriptRequired: true } } as any))
      .toEqual({ builtin: 'none', custom: 'clip', transcriptRequired: true });
  });

  describe('isCloneOnlyVoice', () => {
    it('is true only for builtin:none + custom:clip (qwen3_tts/omnivoice-shaped)', () => {
      expect(isCloneOnlyVoice({ builtin: 'none', custom: 'clip' })).toBe(true);
    });
    it('is false for a model with a built-in voice, even if it also clones (MOSS-shaped)', () => {
      expect(isCloneOnlyVoice({ builtin: 'named', custom: 'clip' })).toBe(false);
    });
    it('is false for a model with no custom-voice capability at all', () => {
      expect(isCloneOnlyVoice({ builtin: 'none', custom: 'none' })).toBe(false);
      expect(isCloneOnlyVoice({ builtin: 'named', custom: 'none' })).toBe(false);
    });
  });

  it('nativeTranslationCards: jap alias resolves en→ja Opus-MT card', () => {
    // Helsinki Opus rows emit "jap" as the target language token; the alias
    // jap→ja must make the card visible for the en→ja pair.
    const FIXTURE: Record<string, NativeModelInfo> = {
      'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
      'opus-mt-en-jap': M('opus-mt-en-jap', 'translate', ['en', 'jap'], 22),
    };
    expect(nativeTranslationCards('en', 'ja', FIXTURE).map((c) => c.selectId)).toContain('opus-mt-en-jap');
  });

  it('passes variantIds through infoToCard', () => {
    const info = M('translategemma-4b', 'translate', ['multi'], 5, false, { variantIds: ['q4_k_m', 'q8_0'] });
    expect(infoToCard(info).variantIds).toEqual(['q4_k_m', 'q8_0']);
  });

  describe('requiredNativeModels', () => {
    it('does not substitute a hardcoded translation model for an empty choice', () => {
      const ids = requiredNativeModels('sense-voice', '', '', 'ja', 'en', TR_CAT, true);
      expect(ids).not.toContain('qwen2.5-0.5b');
      expect(ids).toEqual(['sense-voice']);
    });

    it('still lists a real translation choice', () => {
      const ids = requiredNativeModels('sense-voice', 'qwen2.5-0.5b', '', 'ja', 'en', TR_CAT, true);
      expect(ids).toEqual(['sense-voice', 'qwen2.5-0.5b']);
    });
  });
});

describe('frameworkLabel', () => {
  it('maps every known backend id to its engine label', () => {
    const cases: Record<string, string> = {
      transcribe_cpp: 'transcribe.cpp',
      transcribe_cpp_stream: 'transcribe.cpp',
      native_translate: 'llama.cpp',
      native_tts: 'audio.cpp',
    };
    for (const [id, label] of Object.entries(cases)) expect(frameworkLabel(id)).toBe(label);
  });
  it('derives transcribe_cpp_X ids by prefix; a plain unknown id just echoes', () => {
    // The old `X_onnx` -> 'ONNXRuntime' fallback died with the ONNX backends
    // themselves (slice 5) — no backend id ends in _onnx anymore, so an id
    // shaped like one now falls through to the same raw-echo path as any
    // other unknown id.
    expect(frameworkLabel('foo_onnx')).toBe('foo_onnx');
    expect(frameworkLabel('transcribe_cpp_x')).toBe('transcribe.cpp');
    expect(frameworkLabel('brand_new_backend')).toBe('brand_new_backend');
  });
});

describe('accelApiLabel', () => {
  it('names the GPU API and returns null for cpu/unknown', () => {
    expect(accelApiLabel('gpu-metal')).toBe('Metal');
    expect(accelApiLabel('gpu-vulkan')).toBe('Vulkan');
    expect(accelApiLabel('cpu')).toBeNull();
    // gpu-cuda/gpu-dml died with the ONNX/MLX TTS backends that were their
    // last catalog producers (slice 4 — R4); both are now unknown tiers.
    expect(accelApiLabel('gpu-cuda')).toBeNull();
    expect(accelApiLabel('weird')).toBeNull();
  });
});

describe('buildBackendTooltipRows', () => {
  it('idle GPU tier: framework/device/api/size/repo, no runtime rows', () => {
    const rows = buildBackendTooltipRows({
      tier: 'gpu-vulkan', backendId: 'native_translate', resolved: null, sizeMb: 1843, repo: 'org/model',
    });
    expect(rows.map((r) => r.key)).toEqual(['framework', 'device', 'api', 'size', 'repo']);
    expect(rows[0]).toEqual({ key: 'framework', value: 'llama.cpp' });
    expect(rows[1]).toEqual({ key: 'device', value: 'GPU' });
    expect(rows[2]).toEqual({ key: 'api', value: 'Vulkan' });
    expect(rows.find((r) => r.key === 'size')?.value).toBe('1.8 GB');
  });
  it('idle CPU tier: no api row, still has framework/device/size', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', backendId: 'native_translate', resolved: null, sizeMb: 300 });
    expect(rows.map((r) => r.key)).toEqual(['framework', 'device', 'size']);
    expect(rows[1]).toEqual({ key: 'device', value: 'CPU' });
    expect(rows[0].value).toBe('llama.cpp');
  });
  it('active tier adds precision/speed/memory from the resolved plan', () => {
    const rows = buildBackendTooltipRows({
      tier: 'gpu-vulkan', backendId: 'moss_onnx',
      resolved: { computeType: 'int8', rtf: 0.02, memoryBytes: 3_400_000_000 },
      sizeMb: 100, repo: 'org/tts',
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.precision).toBe('INT8');
    expect(byKey.speed).toBe('50× realtime');
    expect(byKey.memory).toBe('3.2 GB');
  });
  it('translate speed uses tok/s; empty tps omits the speed row', () => {
    const withTps = buildBackendTooltipRows({ tier: 'cpu', backendId: 'native_translate', resolved: { tokensPerSec: 131 } });
    expect(withTps.find((r) => r.key === 'speed')?.value).toBe('131 tok/s');
    const zeroTps = buildBackendTooltipRows({ tier: 'cpu', backendId: 'native_translate', resolved: { tokensPerSec: 0 } });
    expect(zeroTps.find((r) => r.key === 'speed')).toBeUndefined();
  });
  it('fallbackReason becomes a trailing warn row', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', backendId: 'native_translate', resolved: { fallbackReason: 'Low VRAM → CPU' } });
    const last = rows[rows.length - 1];
    expect(last).toEqual({ key: 'fallback', value: 'Low VRAM → CPU', warn: true });
  });
  it('omits the framework row when no backend id is known', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', resolved: null, sizeMb: 10 });
    expect(rows.find((r) => r.key === 'framework')).toBeUndefined();
  });
  it('omits the speed row for an unmeasured (zero) rtf, like zero tps', () => {
    const rows = buildBackendTooltipRows({ tier: 'gpu-vulkan', backendId: 'moss_onnx', resolved: { rtf: 0 } });
    expect(rows.find((r) => r.key === 'speed')).toBeUndefined();
  });
  it('shows the repo row for every current backend (the #287 MLX guard was deleted, not just left inert)', () => {
    // The #287 MLX repo-hiding guard (`repo && !(backendId && frameworkLabel(backendId)
    // === 'MLX')`) had been inert since Task 5's catalog rewire onto native_tts
    // (mlx_audio_tts died, and frameworkLabel can no longer produce 'MLX') —
    // slice 5 removed the dead guard from the source entirely rather than
    // leaving unreachable code behind. Behavior is unchanged: the repo row
    // still shows unconditionally.
    const nativeTts = buildBackendTooltipRows({ tier: 'gpu-metal', backendId: 'native_tts', resolved: null, repo: 'org/model' });
    expect(nativeTts.find((r) => r.key === 'repo')?.value).toBe('org/model');
    const onnx = buildBackendTooltipRows({ tier: 'cpu', backendId: 'moss_onnx', resolved: null, repo: 'org/onnx-assets' });
    expect(onnx.find((r) => r.key === 'repo')?.value).toBe('org/onnx-assets');
  });
});
