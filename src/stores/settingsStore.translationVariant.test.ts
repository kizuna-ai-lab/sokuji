import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directionKey } from '../lib/local-inference/selection/types';

// Mock ServiceFactory (required — settingsStore calls it during updateLocalNative)
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: mockSetSetting,
      getSetting: vi.fn(),
    })),
  },
}));

// Mock modelManifest (required — settingsStore imports it at module level)
vi.mock('../lib/local-inference/modelManifest', async () => {
  const actual = await vi.importActual('../lib/local-inference/modelManifest');
  return { ...actual };
});

// Import after mocking
const { default: useSettingsStore, createLocalNativeSessionConfig } = await import('./settingsStore');
const { useNativeModelStore } = await import('./nativeModelStore');

// defaultLocalNativeSettings' pair (sourceLanguage: 'ja', targetLanguage: 'en').
const DIR = directionKey('ja', 'en');

describe('translationVariant pin reaches the session config (download/load agree)', () => {
  // createLocalNativeSessionConfig here is the settingsStore back-compat
  // wrapper, which delegates to LocalNativeProviderConfig.buildSessionConfig
  // — that calls nativeModelStore's resolve(), so an explicit pick needs a
  // matching catalog entry AND a 'ready' status to resolve at all (an
  // explicit choice the resolver can't find/use falls back to auto instead
  // of surfacing its variant).
  const catalog = {
    'hy-mt2-7b': {
      id: 'hy-mt2-7b', name: 'HY-MT2 7B', languages: ['multi'], recommended: false,
      tiers: [], order: 1, repo: 'hy-mt2-7b', kind: 'translate' as const,
      variants: [{ id: 'fp8', sizeBytes: 1, repo: 'org/hy-mt2-7b-fp8', supported: true, recommended: true }],
    },
    'qwen2.5-0.5b': {
      id: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', languages: ['multi'], recommended: true,
      tiers: [], order: 0, repo: 'qwen2.5-0.5b', kind: 'translate' as const,
    },
  };

  beforeEach(async () => {
    useNativeModelStore.setState({
      catalog, statuses: { 'hy-mt2-7b': 'ready', 'qwen2.5-0.5b': 'ready' },
    } as any);
    await useSettingsStore.getState().updateLocalNative({ selections: {} });
  });

  it('is undefined (automatic) by default — empty selections map', () => {
    expect(useSettingsStore.getState().localNative.selections).toEqual({});
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });

  it('forwards the active model\'s chosen quant as config.translationVariant', async () => {
    await useSettingsStore.getState().updateLocalNative({
      selections: {
        [DIR]: { asr: { modelId: '' }, translation: { modelId: 'hy-mt2-7b', variant: 'fp8' }, tts: { modelId: '' } },
      },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBe('fp8');
  });

  it('a pin can only ever belong to the stage\'s own active selection — there is no shared map for another model\'s pin to leak through', async () => {
    // hy-mt2-7b's pin (seeded above, in a DIFFERENT direction's would-be entry
    // if one existed) simply has nowhere to live except THIS selection —
    // picking a different active model (qwen2.5-0.5b, unpinned) can only ever
    // read its own (absent) variant.
    await useSettingsStore.getState().updateLocalNative({
      selections: {
        [DIR]: { asr: { modelId: '' }, translation: { modelId: 'qwen2.5-0.5b' }, tts: { modelId: '' } },
      },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });
});

describe('ttsVariant pin reaches the session config (download/load agree)', () => {
  // Same per-(direction,stage) pin contract as translation above, this time
  // for TTS — keyed by the RESOLVED tts model id via resolve(), not a
  // separately-resolved settings.ttsModel (there is no such flat field left).
  const ttsCatalog = {
    'qwen3-tts-1.7b': {
      id: 'qwen3-tts-1.7b', name: 'Qwen3 TTS 1.7B', languages: ['en'], recommended: true,
      tiers: [], order: 0, repo: 'qwen3-tts-1.7b', kind: 'tts' as const,
      variants: [{ id: 'bf16', sizeBytes: 1, repo: 'org/qwen3-tts-1.7b-bf16', supported: true, recommended: true }],
    },
  };

  beforeEach(async () => {
    useNativeModelStore.setState({ catalog: ttsCatalog, statuses: { 'qwen3-tts-1.7b': 'ready' } } as any);
    await useSettingsStore.getState().updateLocalNative({ selections: {}, targetLanguage: 'en' });
  });

  it('auto-resolves to the sole en-compatible model, with no variant (a stage\'s variant is always absent under auto)', () => {
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.ttsModelId).toBe('qwen3-tts-1.7b');
    expect(cfg.ttsVariant).toBeUndefined();
  });

  it('forwards the active TTS model\'s chosen quant as config.ttsVariant', async () => {
    await useSettingsStore.getState().updateLocalNative({
      selections: {
        [DIR]: { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'qwen3-tts-1.7b', variant: 'bf16' } },
      },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.ttsVariant).toBe('bf16');
  });
});
