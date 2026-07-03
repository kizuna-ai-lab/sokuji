/**
 * The LOCAL_NATIVE readiness gate (validateApiKey) must check the CHOSEN quant
 * variant's repo — even on cold start, when the Settings panel (which normally
 * publishes statusRepos) has never mounted this session. The gate therefore
 * resolves the active translation model's variant itself (pin ?? recommended)
 * via listVariants and passes that repo explicitly to refresh.
 *
 * Without this, the gate falls back to the catalog DEFAULT repo (e.g. bf16) and
 * gates Start for a user who only downloaded the recommended/pinned quant.
 *
 * Task 10: the gate also warms the sidecar via ensureCatalog, checks the lifecycle
 * status (starting/unavailable → early return, no selection mutation), and when
 * ready runs global autoSelect to reconcile stale model choices before gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../types/Provider';
import type { VariantInfo } from '../lib/local-inference/native/nativeProtocol';
import type { NativeModelInfo } from '../lib/local-inference/native/nativeProtocol';
import type { NativeSelection } from '../lib/local-inference/native/nativeCatalog';
import { nativeTranslationCards } from '../lib/local-inference/native/nativeCatalog';

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

// ── mock state (mutable; updated per-test via mockNativeSidecar / beforeEach) ──
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockIsReady = vi.fn().mockReturnValue(true);
const mockListVariants = vi.fn();
const mockEnsureCatalog = vi.fn().mockResolvedValue(undefined);
const mockAutoSelect = vi.fn().mockReturnValue(null);
let mockSidecarStatus: 'idle' | 'starting' | 'ready' | 'unavailable' = 'ready';
let mockCatalog: Record<string, NativeModelInfo> = {};

// Stub the native store + variant lookup the gate dynamically imports.
vi.mock('./nativeModelStore', () => ({
  useNativeModelStore: {
    getState: () => ({
      refresh: mockRefresh,
      isReady: mockIsReady,
      ensureCatalog: mockEnsureCatalog,
      autoSelect: (...args: unknown[]) => mockAutoSelect(...args),
      sidecarStatus: mockSidecarStatus,
      catalog: mockCatalog,
    }),
  },
  nativeListVariants: (...a: unknown[]) => mockListVariants(...a),
}));

const { default: useSettingsStore } = await import('./settingsStore');

const VARIANTS: VariantInfo[] = [
  { id: 'fp8', computeType: 'fp8', repo: 'tencent/Hy-MT2-7B-FP8', sizeBytes: 8e9, supported: true },
  { id: 'bfloat16', computeType: 'bfloat16', repo: 'tencent/Hy-MT2-7B', sizeBytes: 15e9, supported: true },
];

/**
 * Minimal catalog that covers the sense-voice ASR and the two translation
 * models used across the test suite. Both new and existing tests default to
 * this catalog so mock state is consistent.
 */
const DEFAULT_CATALOG: Record<string, NativeModelInfo> = {
  'sense-voice': {
    id: 'sense-voice', name: 'SenseVoice', kind: 'asr',
    languages: ['multi'], recommended: true, tiers: [], order: 0, repo: '',
  },
  'qwen2.5-0.5b': {
    id: 'qwen2.5-0.5b', name: 'Qwen2.5-0.5B', kind: 'translate',
    languages: ['multi'], recommended: true, tiers: [], order: 0, repo: '',
  },
  'opus-mt-zh-en': {
    id: 'opus-mt-zh-en', name: 'Opus-MT zh→en', kind: 'translate',
    languages: ['zh', 'en'], recommended: false, tiers: [], order: 1, repo: '',
  },
  // Multi-variant translate cards. The gate must resolve these via variantIds
  // (data-driven), not a 'hy-mt' prefix check — hy-mt2-7b/hy-mt15-7b cover the
  // HY-MT family, translategemma-4b proves the check isn't HY-MT-specific.
  'hy-mt2-7b': {
    id: 'hy-mt2-7b', name: 'Hunyuan-MT2 7B', kind: 'translate',
    languages: ['multi'], recommended: false, tiers: [], order: 2, repo: '',
    variantIds: ['q4_k_m', 'q8_0'],
  },
  'hy-mt15-7b': {
    id: 'hy-mt15-7b', name: 'Hunyuan-MT1.5 7B', kind: 'translate',
    languages: ['multi'], recommended: false, tiers: [], order: 3, repo: '',
    variantIds: ['q4_k_m', 'q8_0'],
  },
  'translategemma-4b': {
    id: 'translategemma-4b', name: 'TranslateGemma 4B', kind: 'translate',
    languages: ['multi'], recommended: false, tiers: [], order: 4, repo: '',
    variantIds: ['q4_k_m', 'q8_0'],
  },
};

/** The catalog used in the Task-10 lifecycle tests. Same shape as DEFAULT_CATALOG. */
const READY_CATALOG = DEFAULT_CATALOG;

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
  // The required-models refresh (variant-aware) is the LAST refresh call; the
  // first is the pre-auto-select candidate-status refresh (default repos).
  return mockRefresh.mock.calls.at(-1)?.[1];
}

/**
 * Configure the mock native store for a given sidecar lifecycle state.
 * When status is 'ready', sets up autoSelect to reconcile the translation
 * model based on the downloaded set (mirrors the real autoSelectNative logic
 * for the translation stage).
 */
function mockNativeSidecar({ status, catalog = DEFAULT_CATALOG, downloaded = [] }: {
  status: 'idle' | 'starting' | 'ready' | 'unavailable';
  catalog?: Record<string, NativeModelInfo>;
  downloaded?: string[];
}) {
  mockSidecarStatus = status;
  mockCatalog = catalog;
  const dl = new Set(downloaded);
  mockAutoSelect.mockImplementation((src: string, tgt: string, current: NativeSelection) => {
    const trCards = nativeTranslationCards(src, tgt, catalog);
    const curCard = trCards.find((c) => c.selectId === current.translationModel);
    if (curCard && dl.has(curCard.downloadId)) return null; // still valid
    const best = trCards.find((c) => dl.has(c.downloadId));
    if (!best || best.selectId === current.translationModel) return null;
    return { translationModel: best.selectId };
  });
}

beforeEach(() => {
  mockRefresh.mockClear();
  mockIsReady.mockClear();
  mockListVariants.mockReset();
  mockListVariants.mockResolvedValue({ variants: VARIANTS, recommended: 'fp8' });
  mockEnsureCatalog.mockClear();
  mockAutoSelect.mockReturnValue(null);
  mockSidecarStatus = 'ready';
  mockCatalog = DEFAULT_CATALOG;
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

  it('also resolves the HY-MT1.5 family (gated by catalog variantIds, not a hy-mt prefix)', async () => {
    setNative({ translationModel: 'hy-mt15-7b' });
    await useSettingsStore.getState().validateApiKey();

    // The second arg is the ASR model id; the third is null (no TTS in the test catalog).
    expect(mockListVariants).toHaveBeenCalledWith('hy-mt15-7b', 'sense-voice', null);
    expect(reposArg()).toEqual({ 'hy-mt15-7b': 'tencent/Hy-MT2-7B-FP8' });
  });

  it('resolves a non-HY-MT multi-variant card the same way (the gate is data-driven, not hy-mt-specific)', async () => {
    setNative({ translationModel: 'translategemma-4b' });
    await useSettingsStore.getState().validateApiKey();

    expect(mockListVariants).toHaveBeenCalledWith('translategemma-4b', 'sense-voice', null);
    expect(reposArg()).toEqual({ 'translategemma-4b': 'tencent/Hy-MT2-7B-FP8' });
  });

  it('does not fetch variants for a single-variant translation model (repos left to the cache)', async () => {
    setNative({ translationModel: 'qwen2.5-0.5b' });
    await useSettingsStore.getState().validateApiKey();

    // qwen2.5-0.5b has no (or a single) catalog variantIds entry, so the variant
    // block is skipped; the required-models refresh (the last call) gets no
    // explicit override, so it falls back to the store's statusRepos cache.
    // (The first refresh is the pre-auto-select candidate-status refresh.)
    expect(mockListVariants).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(reposArg()).toBeUndefined();
  });

  it('refreshes the pair candidate statuses BEFORE auto-select (so a downloaded model gets picked)', async () => {
    setNative({ translationModel: 'qwen2.5-0.5b' });
    mockRefresh.mockClear();
    mockAutoSelect.mockClear();
    await useSettingsStore.getState().validateApiKey();

    // The candidate-status refresh must run before auto-select reads statuses,
    // else auto-select sees an empty status map and can't pick a downloaded model.
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockAutoSelect).toHaveBeenCalled();
    expect(mockRefresh.mock.invocationCallOrder[0])
      .toBeLessThan(mockAutoSelect.mock.invocationCallOrder[0]);
    // That first refresh carries the pair's candidate download ids (incl. the ASR card).
    expect(mockRefresh.mock.calls[0][0]).toContain('sense-voice');
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

describe('LOCAL_NATIVE gate: sidecar lifecycle gates (Task 10)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as any);
  });

  it('reports not-ready and does not mutate selection while sidecar is unavailable', async () => {
    mockNativeSidecar({ status: 'unavailable' }); // ensureCatalog leaves it unavailable
    const before = useSettingsStore.getState().localNative.translationModel;
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(useSettingsStore.getState().localNative.translationModel).toBe(before);
  });

  it('runs global auto-select when ready and gates on the reconciled pair', async () => {
    mockNativeSidecar({ status: 'ready', catalog: READY_CATALOG, downloaded: ['sense-voice', 'qwen2.5-0.5b'] });
    // stale translation for the new pair → autoSelect reconciles it
    useSettingsStore.setState((s) => ({ localNative: { ...s.localNative,
      sourceLanguage: 'en', targetLanguage: 'zh', asrModel: 'sense-voice', translationModel: 'opus-mt-zh-en' } }));
    const r = await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().localNative.translationModel).not.toBe('opus-mt-zh-en');
    expect(r.valid).toBe(true);
  });
});
