/**
 * The LOCAL_NATIVE readiness gate (validateApiKey) must check the CHOSEN quant
 * variant's repo — even on cold start, when the Settings panel (which normally
 * publishes statusRepos) has never mounted this session. The gate therefore
 * resolves the active translation model's variant itself (pin ?? recommended)
 * via listVariants and passes that repo explicitly to refresh.
 *
 * Without this, the gate falls back to the catalog DEFAULT repo (e.g. bf16) and
 * gates Start for a user who only downloaded the recommended/pinned quant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../types/Provider';
import type { VariantInfo } from '../lib/local-inference/native/nativeProtocol';

// ServiceFactory is touched during updateLocalNative/persist — stub it.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

// Force the Electron branch of the gate.
vi.mock('../utils/environment', async () => {
  const actual = await vi.importActual<typeof import('../utils/environment')>('../utils/environment');
  return { ...actual, isElectron: () => true };
});

// Stub the native store + variant lookup the gate dynamically imports.
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockIsReady = vi.fn().mockReturnValue(true);
const mockListVariants = vi.fn();
vi.mock('./nativeModelStore', () => ({
  useNativeModelStore: { getState: () => ({ refresh: mockRefresh, isReady: mockIsReady }) },
  nativeListVariants: (...a: unknown[]) => mockListVariants(...a),
}));

const { default: useSettingsStore } = await import('./settingsStore');

const VARIANTS: VariantInfo[] = [
  { id: 'fp8', computeType: 'fp8', repo: 'tencent/Hy-MT2-7B-FP8', sizeBytes: 8e9, supported: true },
  { id: 'bfloat16', computeType: 'bfloat16', repo: 'tencent/Hy-MT2-7B', sizeBytes: 15e9, supported: true },
];

function setNative(over: Record<string, unknown>) {
  useSettingsStore.setState({
    provider: Provider.LOCAL_NATIVE,
    localNative: {
      ...useSettingsStore.getState().localNative,
      asrModel: 'sense-voice', sourceLanguage: 'zh', targetLanguage: 'en',
      translationVariantByModel: {}, ...over,
    },
  } as any);
}

function reposArg(): unknown {
  return mockRefresh.mock.calls[0]?.[1];
}

beforeEach(() => {
  mockRefresh.mockClear();
  mockIsReady.mockClear();
  mockListVariants.mockReset();
  mockListVariants.mockResolvedValue({ variants: VARIANTS, recommended: 'fp8' });
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.electron = { invoke: vi.fn().mockResolvedValue({ ok: true }) };
});

describe('LOCAL_NATIVE gate is variant-aware on cold start', () => {
  it('checks the recommended variant repo (not the default) when no pin is set', async () => {
    setNative({ translationModel: 'hy-mt2-7b' });
    await useSettingsStore.getState().validateApiKey();

    expect(mockRefresh).toHaveBeenCalled();
    expect(reposArg()).toEqual({ 'hy-mt2-7b': 'tencent/Hy-MT2-7B-FP8' });
  });

  it('honors an explicit pin over the recommended variant', async () => {
    setNative({ translationModel: 'hy-mt2-7b', translationVariantByModel: { 'hy-mt2-7b': 'bfloat16' } });
    await useSettingsStore.getState().validateApiKey();

    expect(reposArg()).toEqual({ 'hy-mt2-7b': 'tencent/Hy-MT2-7B' });
  });

  it('also resolves the HY-MT1.5 family (the prefix gate is hy-mt, not hy-mt2)', async () => {
    setNative({ translationModel: 'hy-mt15-7b' });
    await useSettingsStore.getState().validateApiKey();

    expect(mockListVariants).toHaveBeenCalledWith('hy-mt15-7b', expect.anything(), expect.anything());
    expect(reposArg()).toEqual({ 'hy-mt15-7b': 'tencent/Hy-MT2-7B-FP8' });
  });

  it('does not fetch variants for a non-HY-MT translation model (repos left to the cache)', async () => {
    setNative({ translationModel: 'qwen2.5-0.5b' });
    await useSettingsStore.getState().validateApiKey();

    // The block is skipped entirely; refresh is called once with no explicit
    // override, so it falls back to the store's statusRepos cache.
    expect(mockListVariants).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(reposArg()).toBeUndefined();
  });
});

describe('LOCAL_NATIVE gate rejects a translation model incompatible with the pair', () => {
  // Repro: zh→en with Opus-MT (zh→en), then reverse to en→zh. The stale
  // 'opus-mt-zh-en' selection is not a card for en→zh, so the UI shows "None" —
  // but the model is still downloaded, so isReady() is true. The gate must NOT
  // report ready, else Start stays enabled with no usable translation model.
  it('is not ready when the selected translation is stale for the reversed pair (even if downloaded)', async () => {
    mockIsReady.mockReturnValue(true); // models "downloaded"
    setNative({ sourceLanguage: 'en', targetLanguage: 'zh', translationModel: 'opus-mt-zh-en' });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(useSettingsStore.getState().isApiKeyValid).toBe(false);
  });

  it('stays ready for a direction-correct Opus-MT card (does not over-block)', async () => {
    mockIsReady.mockReturnValue(true);
    setNative({ sourceLanguage: 'zh', targetLanguage: 'en', translationModel: 'opus-mt-zh-en' });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(true);
  });

  it('stays ready for a multilingual qwen card on any pair', async () => {
    mockIsReady.mockReturnValue(true);
    setNative({ sourceLanguage: 'en', targetLanguage: 'zh', translationModel: 'qwen2.5-0.5b' });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(true);
  });
});
