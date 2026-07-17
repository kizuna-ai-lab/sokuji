import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNativeModelStore, deriveVariantRepos } from './nativeModelStore';
import { requiredNativeModels } from '../lib/local-inference/native/nativeCatalog';

// The store's bundle IPC helpers (bundleInvoke/onBundleProgress) gate on the
// centralized isElectron() check; force the Electron branch so the FakeWS/
// window.electron mocks below actually get exercised under jsdom, which
// otherwise reports no Electron signals (mirrors settingsStore.nativeGate.test.ts).
vi.mock('../utils/environment', async () => {
  const actual = await vi.importActual<typeof import('../utils/environment')>('../utils/environment');
  return { ...actual, isElectron: () => true };
});

// ---------------------------------------------------------------------------
// Helpers for controlling FakeWS catalog behaviour in lifecycle tests
// ---------------------------------------------------------------------------
let _shouldReject = false;
let _asrExtraModels: any[] = [];
let _catalogCallCount = 0;
// Models the FakeWS should report as NOT downloaded on a `model_status` query.
// The FakeWS reports every queried model 'ready' by default (see below); this
// lets a test force a specific required model to read 'absent' so it can drive
// ensureSelectionReady to the 'models-missing' reason.
let _notReadyModels = new Set<string>();
function mockModelsCatalogResolve() { _shouldReject = false; }
function mockModelsCatalogReject() { _shouldReject = true; }
function modelsCatalogCallCount() { return _catalogCallCount; }
function mockModelNotReady(id: string) { _notReadyModels.add(id); }

class FakeWS {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { setTimeout(() => this.onopen?.(), 0); }
  private emit(o: any) { this.onmessage?.({ data: JSON.stringify(o) }); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'models_catalog') {
      _catalogCallCount++;
      if (_shouldReject) {
        queueMicrotask(() => this.emit({ type: 'error', id: msg.id, message: 'mock catalog error' }));
        return;
      }
      // The sidecar returns ASR, translation, or TTS models depending on `kind` (default asr).
      // Every real sidecar model row carries `kind` (nativeProtocol.NativeModelInfo requires
      // it) — the catalog-filtering helpers (nativeAsrCards/nativeTranslationCards/etc.) key
      // off it, so the fixture rows must too.
      let models;
      if (msg.kind === 'translate') {
        models = [{ id: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', kind: 'translate', languages: ['multi'], recommended: true,
             tiers: [{ tier: 'gpu-cuda', backend: 'llamacpp_qwen', available: true },
                     { tier: 'cpu', backend: 'llamacpp_qwen', available: true }], sizeBytes: 999604126 }];
      } else if (msg.kind === 'tts') {
        models = [{ id: 'moss-tts-nano', name: 'MOSS TTS Nano', kind: 'tts', languages: ['ja', 'zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'moss_tts', available: true }], sizeBytes: 763206064 }];
      } else {
        models = [{ id: 'sense-voice', name: 'SenseVoice', kind: 'asr', languages: ['zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }], sizeBytes: 944624033 },
           ..._asrExtraModels];
      }
      queueMicrotask(() => this.emit({ type: 'models_catalog_result', id: msg.id, models }));
    }
    if (msg.type === 'model_status') {
      (globalThis as any).__lastStatusRepos = msg.repos;
      queueMicrotask(() => this.emit({ type: 'model_status_result', id: msg.id,
        statuses: Object.fromEntries((msg.models || []).map((m: string) =>
          [m, _notReadyModels.has(m) ? 'absent' : 'ready'])) }));
    }
    if (msg.type === 'model_delete') queueMicrotask(() =>
      this.emit({ type: 'model_delete_result', id: msg.id, freed: 0 }));
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.electron = { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) };
  (globalThis as any).__lastStatusRepos = undefined;
  _shouldReject = false;
  _asrExtraModels = [];
  _catalogCallCount = 0;
  _notReadyModels = new Set();
  useNativeModelStore.setState({ catalog: {}, sidecarStatus: 'idle', sizes: {}, statusRepos: {}, statuses: {} } as any);
});

describe('nativeModelStore.isReady', () => {
  it('is true only when all listed models are ready', () => {
    useNativeModelStore.setState({ statuses: { a: 'ready', b: 'ready', c: 'absent' } });
    const { isReady } = useNativeModelStore.getState();
    expect(isReady(['a', 'b'])).toBe(true);
    expect(isReady(['a', 'c'])).toBe(false);
    expect(isReady([])).toBe(false);
  });
});

describe('requiredNativeModels', () => {
  // Fixture catalog — exercises derivation logic without pinning real production ids.
  const FIXTURE_CATALOG = {
    'sense-voice':       { id: 'sense-voice',       name: 'SenseVoice',        languages: ['multi'], recommended: true,  tiers: [], order: 0, repo: 'sense-voice',       kind: 'asr'       },
    'whisper-tiny':      { id: 'whisper-tiny',       name: 'Whisper Tiny',      languages: ['multi'], recommended: false, tiers: [], order: 1, repo: 'whisper-tiny',      kind: 'asr'       },
    'qwen2.5-0.5b':      { id: 'qwen2.5-0.5b',       name: 'Qwen 2.5 0.5B',     languages: ['multi'], recommended: true,  tiers: [], order: 0, repo: 'qwen2.5-0.5b',      kind: 'translate' },
    'translategemma-4b': { id: 'translategemma-4b',   name: 'TranslateGemma 4B', languages: ['multi'], recommended: false, tiers: [], order: 1, repo: 'translategemma-4b', kind: 'translate' },
    'piper-en':          { id: 'piper-en',            name: 'Piper EN',          languages: ['en'],    recommended: true,  tiers: [], order: 0, repo: 'piper-en',          kind: 'tts'       },
    'moss-tts-nano':     { id: 'moss-tts-nano',       name: 'MOSS TTS Nano',     languages: ['ja', 'zh'], recommended: true, tiers: [], order: 0, repo: 'moss-tts-nano',   kind: 'tts'       },
  } as any;

  it('lists asr + translation(+qwen default) + tts when speech on', () => {
    // en target -> fixture piper-en TTS; '' translation -> qwen2.5-0.5b default
    expect(requiredNativeModels('sense-voice', '', '', 'es', 'en', FIXTURE_CATALOG)).toEqual([
      'sense-voice', 'qwen2.5-0.5b', 'piper-en',
    ]);
    // explicit translation model, ja target -> fixture moss-tts-nano
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', '', 'zh', 'ja', FIXTURE_CATALOG)).toEqual([
      'whisper-tiny', 'translategemma-4b', 'moss-tts-nano',
    ]);
    // 'off' tts choice -> no TTS regardless of language
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', 'off', 'zh', 'ja', FIXTURE_CATALOG)).toEqual([
      'whisper-tiny', 'translategemma-4b',
    ]);
    // language with no voice in fixture (th) -> no TTS
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', '', 'zh', 'th', FIXTURE_CATALOG)).toEqual([
      'whisper-tiny', 'translategemma-4b',
    ]);
    // textOnly=true -> TTS dropped even when language has a voice
    expect(requiredNativeModels('sense-voice', '', '', 'es', 'en', FIXTURE_CATALOG, true)).toEqual([
      'sense-voice', 'qwen2.5-0.5b',
    ]);
  });
});

describe('nativeModelStore.refreshCatalog', () => {
  it('populates catalog from the sidecar models_catalog feed', async () => {
    await useNativeModelStore.getState().refreshCatalog(['sense-voice']);
    const cat = useNativeModelStore.getState().catalog;
    expect(cat['sense-voice']).toMatchObject({ recommended: true });
    expect(cat['sense-voice'].tiers[0]).toMatchObject({ tier: 'cpu', available: true });
  });

  it('also fetches the translation catalog so translation cards get tier badges', async () => {
    await useNativeModelStore.getState().refreshCatalog();
    const cat = useNativeModelStore.getState().catalog;
    // ASR and translation models coexist (ids never collide) in one catalog map.
    expect(cat['sense-voice']).toBeTruthy();
    expect(cat['qwen2.5-0.5b']).toBeTruthy();
    expect(cat['qwen2.5-0.5b'].tiers).toContainEqual(
      expect.objectContaining({ tier: 'gpu-cuda', available: true }));
  });

  it('populates sizes from each model sizeBytes — no separate model_sizes round-trip', async () => {
    await useNativeModelStore.getState().refreshCatalog();
    const sizes = useNativeModelStore.getState().sizes;
    expect(sizes['sense-voice']).toBe(944624033);
    expect(sizes['qwen2.5-0.5b']).toBe(999604126);
    expect(sizes['moss-tts-nano']).toBe(763206064);
  });
});

describe('catalog-derived statusRepos cache (cold-start variant awareness)', () => {
  // Field bug: ProviderSection's chips issue a bare refresh(ids) with no repos.
  // Before the Settings panel ever mounts, nothing had populated the statusRepos
  // cache, so the sidecar checked each card's DEFAULT quant repo — a card whose
  // downloaded quant is the machine-recommended one (Fun-ASR: default Q6_K,
  // downloaded Q8_0) read 'absent' and the ASR chip showed "None" until a
  // variant-aware caller happened to run. The catalog feed already carries the
  // full variant ladder, so the store derives the cache when the catalog lands.
  const FUN_ASR = {
    id: 'fun-asr-mlt-nano', name: 'Fun-ASR MLT Nano', kind: 'asr', languages: ['multi'], recommended: true,
    tiers: [{ tier: 'cpu', backend: 'transcribe_cpp', available: true }], sizeBytes: 690744384,
    variantIds: ['q6_k', 'q8_0'],
    variants: [
      { id: 'q6_k', sizeBytes: 690744384, repo: 'handy/Fun-ASR-gguf/Fun-ASR-Q6_K.gguf', supported: true, recommended: false },
      { id: 'q8_0', sizeBytes: 891271232, repo: 'handy/Fun-ASR-gguf/Fun-ASR-Q8_0.gguf', supported: true, recommended: true },
    ],
  };

  it('a bare refresh() after ensureCatalog checks the RECOMMENDED variant repo', async () => {
    _asrExtraModels = [FUN_ASR];
    await useNativeModelStore.getState().ensureCatalog();
    await useNativeModelStore.getState().refresh(['fun-asr-mlt-nano']);
    expect((globalThis as any).__lastStatusRepos).toMatchObject({
      'fun-asr-mlt-nano': 'handy/Fun-ASR-gguf/Fun-ASR-Q8_0.gguf',
    });
  });

  it('an explicit variant pin wins over the recommendation', async () => {
    _asrExtraModels = [FUN_ASR];
    const { default: useSettingsStore } = await import('./settingsStore');
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        translationVariantByModel: { 'fun-asr-mlt-nano': 'q6_k' },
      },
    } as any);
    await useNativeModelStore.getState().ensureCatalog();
    await useNativeModelStore.getState().refresh(['fun-asr-mlt-nano']);
    expect((globalThis as any).__lastStatusRepos).toMatchObject({
      'fun-asr-mlt-nano': 'handy/Fun-ASR-gguf/Fun-ASR-Q6_K.gguf',
    });
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        translationVariantByModel: {},
      },
    } as any);
  });

  it('single-variant cards stay out of the cache (default repo is correct for them)', async () => {
    await useNativeModelStore.getState().ensureCatalog();
    await useNativeModelStore.getState().refresh(['sense-voice']);
    const repos = (globalThis as any).__lastStatusRepos ?? {};
    expect(repos['sense-voice']).toBeUndefined();
  });

  it('deriveVariantRepos skips single-variant cards (via catalog-derived statusRepos)', async () => {
    await useNativeModelStore.getState().ensureCatalog();
    // sense-voice (the fixture ASR) has no `variants` → no entry in statusRepos.
    expect(useNativeModelStore.getState().statusRepos['sense-voice']).toBeUndefined();
  });
});

describe('deriveVariantRepos', () => {
  // Pure-function unit tests (no store/settingsStore involvement) for the fix
  // site directly, per its own docstring: an unsupported pin must not drive
  // the readiness gate to validate a repo the sidecar's runnable-filter never
  // loads — it must fall back to the recommended (supported) variant.
  const CARD = {
    id: 'card', name: 'Card', kind: 'asr', languages: ['multi'], recommended: true,
    tiers: [], order: 0, repo: 'org/fake-fp32',
    variants: [
      { id: 'fp32', sizeBytes: 1000, repo: 'org/fake-fp32', supported: true, recommended: true },
      { id: 'bf16', sizeBytes: 1000, repo: 'org/fake-bf16', supported: false, recommended: false },
    ],
  } as any;

  it('ignores a pin whose variant is unsupported, falling back to the recommended repo', () => {
    expect(deriveVariantRepos([CARD], { card: 'bf16' })).toEqual({ card: 'org/fake-fp32' });
  });

  it('honours a pin whose variant IS supported', () => {
    const supportedPinCard = {
      ...CARD,
      variants: [
        { id: 'fp32', sizeBytes: 1000, repo: 'org/fake-fp32', supported: true, recommended: true },
        { id: 'bf16', sizeBytes: 1000, repo: 'org/fake-bf16', supported: true, recommended: false },
      ],
    };
    expect(deriveVariantRepos([supportedPinCard], { card: 'bf16' })).toEqual({ card: 'org/fake-bf16' });
  });

  it('falls back to recommended with no pin at all', () => {
    expect(deriveVariantRepos([CARD], {})).toEqual({ card: 'org/fake-fp32' });
  });
});

describe('nativeModelStore.deleteModel', () => {
  it('hides the model optimistically — status flips to absent before the sidecar delete resolves', () => {
    useNativeModelStore.setState({ statuses: { m: 'ready' } });
    // Fire and DO NOT await: the optimistic flip must be visible synchronously,
    // before the (slow) sidecar WS round-trip + disk rm completes.
    void useNativeModelStore.getState().deleteModel('m');
    expect(useNativeModelStore.getState().statuses['m']).toBe('absent');
  });

  it('still ends absent after the delete round-trip completes', async () => {
    useNativeModelStore.setState({ statuses: { m: 'ready' } });
    await useNativeModelStore.getState().deleteModel('m');
    expect(useNativeModelStore.getState().statuses['m']).toBe('absent');
  });
});

describe('nativeModelStore asr session channel', () => {
  it('tracks asrLoading and the resolved plan', () => {
    const s = useNativeModelStore.getState();
    s.setAsrLoading(true);
    expect(useNativeModelStore.getState().asrLoading).toBe(true);
    s.setAsrResolved({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.015 });
    s.setAsrLoading(false);
    const st = useNativeModelStore.getState();
    expect(st.asrLoading).toBe(false);
    expect(st.asrResolved).toEqual({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.015 });
  });
});

describe('nativeModelStore translation session channel', () => {
  it('tracks the resolved translation plan with measured tokens/sec', () => {
    const s = useNativeModelStore.getState();
    s.setTranslationResolved({ model: 'qwen3.5-2b', device: 'cuda', tokensPerSec: 59.4 });
    expect(useNativeModelStore.getState().translationResolved)
      .toEqual({ model: 'qwen3.5-2b', device: 'cuda', tokensPerSec: 59.4 });
  });
});

describe('nativeModelStore.refresh — variant-aware via cached statusRepos', () => {
  it('falls back to the cached statusRepos when the caller passes none (gate path)', async () => {
    useNativeModelStore.getState().setStatusRepos({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
    await useNativeModelStore.getState().refresh(['hy-mt2-1.8b']);   // no repos arg — the gate's call shape
    expect((globalThis as any).__lastStatusRepos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
  });

  it('an explicit repos arg overrides the cache', async () => {
    useNativeModelStore.getState().setStatusRepos({ 'hy-mt2-1.8b': 'cached' });
    await useNativeModelStore.getState().refresh(['hy-mt2-1.8b'], { 'hy-mt2-1.8b': 'explicit' });
    expect((globalThis as any).__lastStatusRepos).toEqual({ 'hy-mt2-1.8b': 'explicit' });
  });
});

describe('nativeModelStore TTS resolved', () => {
  beforeEach(() => { useNativeModelStore.setState({ ttsLoading: false, ttsResolved: null }); });

  it('setTtsResolved stores the resolved plan', () => {
    useNativeModelStore.getState().setTtsResolved({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
    expect(useNativeModelStore.getState().ttsResolved).toEqual({ model: 'moss-tts-nano', device: 'cpu', rtf: 0.44 });
  });

  it('setTtsLoading toggles the connecting flag', () => {
    useNativeModelStore.getState().setTtsLoading(true);
    expect(useNativeModelStore.getState().ttsLoading).toBe(true);
  });
});

describe('nativeModelStore sidecar lifecycle', () => {
  it('ensureCatalog transitions starting → ready and populates the catalog', async () => {
    // The suite's client mock returns a model per kind from modelsCatalog.
    const store = useNativeModelStore.getState();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('idle');
    const p = store.ensureCatalog();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('starting');
    await p;
    expect(useNativeModelStore.getState().sidecarStatus).toBe('ready');
    expect(Object.keys(useNativeModelStore.getState().catalog).length).toBeGreaterThan(0);
    // Sizes arrive with the catalog response (sizeBytes per model) — no separate
    // model_sizes round-trip needed for the panel to show a download size.
    expect(useNativeModelStore.getState().sizes['sense-voice']).toBe(944624033);
  });

  it('ensureCatalog goes to unavailable when the catalog fetch throws', async () => {
    // Configure the suite mock so modelsCatalog rejects for this case.
    mockModelsCatalogReject();
    useNativeModelStore.setState({ sidecarStatus: 'idle', catalog: {} } as any);
    await useNativeModelStore.getState().ensureCatalog();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('unavailable');
  });

  it('ensureCatalog is a no-op once ready (no refetch)', async () => {
    mockModelsCatalogResolve();
    useNativeModelStore.setState({ sidecarStatus: 'ready' } as any);
    const calls = modelsCatalogCallCount();
    await useNativeModelStore.getState().ensureCatalog();
    expect(modelsCatalogCallCount()).toBe(calls);
  });

  it('retrySidecar re-runs provider validation so the stale gate message clears', async () => {
    // Boot fails once → the gate stores an "unavailable" message.
    mockModelsCatalogReject();
    useNativeModelStore.setState({ sidecarStatus: 'idle', catalog: {} } as any);
    await useNativeModelStore.getState().ensureCatalog();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('unavailable');
    // Retry succeeds — validateApiKey owns validationMessage/isApiKeyValid
    // (Start button + banner); a successful retry must re-run it.
    const { useSettingsStore } = await import('./settingsStore');
    const validateApiKey = vi.fn(async () => ({ valid: true, validating: false }));
    useSettingsStore.setState({ provider: 'local_native', validateApiKey } as never);
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().retrySidecar();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('ready');
    expect(validateApiKey).toHaveBeenCalled();
  });
});

describe('nativeModelStore resolved plans retain backend and computeType', () => {
  it('resolved plans retain backend and computeType', () => {
    const s = useNativeModelStore.getState();
    s.setAsrResolved({ model: 'a', device: 'cuda', backend: 'moss_onnx', computeType: 'int8', rtf: 0.02 });
    expect(useNativeModelStore.getState().asrResolved).toMatchObject({ backend: 'moss_onnx', computeType: 'int8' });
    s.setTranslationResolved({ model: 't', device: 'cpu', backend: 'ct2_opus_translate', computeType: 'int8', tokensPerSec: 120 });
    expect(useNativeModelStore.getState().translationResolved).toMatchObject({ backend: 'ct2_opus_translate', computeType: 'int8' });
    s.setTtsResolved({ model: 'v', device: 'metal', backend: 'mlx_audio_tts', computeType: 'fp32' });
    expect(useNativeModelStore.getState().ttsResolved).toMatchObject({ backend: 'mlx_audio_tts', computeType: 'fp32' });
  });
});

describe('ensureSelectionReady (facade)', () => {
  const SEL = {
    sourceLanguage: 'zh', targetLanguage: 'en',
    asrModel: 'sense-voice', translationModel: 'qwen2.5-0.5b', ttsModel: '',
    translationVariantByModel: {} as Record<string, string>,
  };

  beforeEach(() => {
    _shouldReject = false;
    _notReadyModels = new Set();
    // The top-level beforeEach resets catalog/statuses/statusRepos but not
    // modelPreferences — autoSelect's step 1 layers recalled history from a
    // PRIOR test's rememberModels() for the same `${src}→${tgt}` key on top of
    // the requested selection, so a leftover here would silently override the
    // translationModel this block is trying to exercise.
    useNativeModelStore.setState({ modelPreferences: {} });
  });

  it('reads the selection AFTER sidecar warmup, not at call time', async () => {
    // The facade takes a READ THUNK, not a snapshot, and calls it only once the
    // sidecar is warm — matching the pre-facade gate, which read get().localNative
    // after `await ensureCatalog()`. A cold start can take seconds, so a snapshot
    // taken at the call site would resolve the verdict against a selection the
    // user has since changed (pair / text-only) mid-warmup.
    mockModelsCatalogResolve();
    // beforeEach seeds sidecarStatus 'idle' → ensureCatalog actually runs here.
    let statusWhenRead: string | undefined;
    await useNativeModelStore.getState().ensureSelectionReady(() => {
      statusWhenRead = useNativeModelStore.getState().sidecarStatus;
      return { selection: SEL, textOnly: true };
    });
    // Would be 'idle' if the read were hoisted back above the warmup await.
    expect(statusWhenRead).toBe('ready');
  });

  it('unavailable sidecar → not ready, reason unavailable, no corrections', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    // ensureCatalog will try to (re)load; make the catalog fetch reject so it stays unavailable.
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ selection: SEL, textOnly: false }));
    expect(r).toEqual({ ready: false, reason: 'unavailable', corrections: null });
  });

  it('bundle absent → reason engine-absent', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'absent' });
    // ensureCatalog's refreshBundle() re-queries the IPC bundle status before the
    // lifecycle check runs; make that call throw (caught, best-effort) so the
    // seeded bundleStatus survives instead of being overwritten by the default
    // `{ ok: true }` mock reply (which carries no `state`/`sku`).
    (globalThis as any).window.electron.invoke = vi.fn().mockRejectedValue(new Error('no ipc'));
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ selection: SEL, textOnly: false }));
    expect(r.reason).toBe('engine-absent');
  });

  it('bundle mismatch → reason engine-mismatch', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'mismatch' });
    (globalThis as any).window.electron.invoke = vi.fn().mockRejectedValue(new Error('no ipc'));
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ selection: SEL, textOnly: false }));
    expect(r.reason).toBe('engine-mismatch');
  });

  it('ready + downloaded compatible pair → ready', async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog(); // status → ready, catalog seeded
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ selection: SEL, textOnly: true }));
    // FakeWS reports every queried model 'ready'; textOnly drops the TTS
    // requirement so readiness only needs the asr+translation pair.
    expect(r.ready).toBe(true);
    expect(r.reason).toBe('ready');
  });

  it('stale translation for the reversed pair → not ready, reason translation-incompatible', async () => {
    // FakeWS's default translate card (qwen2.5-0.5b) is `languages: ['multi']`,
    // which nativeTranslationCards treats as valid for ANY pair — so autoSelect
    // would always fall back to it and the selection would end up compatible
    // again. Replace it with a DIRECTIONAL zh→en-only card, and add an 'en'
    // -capable ASR card (the default sense-voice is zh-only, which would
    // otherwise fail the ASR check first on this reversed pair and mask the
    // translation-incompatible reason this test targets).
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const { 'qwen2.5-0.5b': _drop, ...catalogWithoutQwen } = useNativeModelStore.getState().catalog;
    useNativeModelStore.setState({ catalog: {
      ...catalogWithoutQwen,
      'whisper-en': { id: 'whisper-en', name: 'Whisper EN', kind: 'asr', languages: ['en'], recommended: false,
        tiers: [{ tier: 'cpu', backend: 'whisper', available: true }], order: 1, repo: 'whisper-en' },
      'opus-mt-zh-en': { id: 'opus-mt-zh-en', name: 'Opus MT zh-en', kind: 'translate', languages: ['zh', 'en'],
        recommended: false, tiers: [{ tier: 'cpu', backend: 'opus', available: true }], order: 1, repo: 'opus-mt-zh-en' },
    } as any });
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, sourceLanguage: 'en', targetLanguage: 'zh', asrModel: 'whisper-en', translationModel: 'opus-mt-zh-en' },
      textOnly: false,
    }));
    // opus-mt-zh-en is a card for zh→en, not the reversed en→zh pair — incompatible
    // even though its status reports "downloaded".
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('translation-incompatible');
  });

  it('resolves the selected model chosen variant repo on the required-models refresh', async () => {
    // Seed a multi-variant translate card into the FakeWS catalog for this test,
    // then assert the LAST model_status carried its recommended repo.
    // (Mirror the existing multi-variant fixtures at the top of this file.)
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const catalog = useNativeModelStore.getState().catalog;
    useNativeModelStore.setState({ catalog: { ...catalog, 'hy-mt2-1.8b': {
      id: 'hy-mt2-1.8b', name: 'HY', kind: 'translate', languages: ['multi'], recommended: false,
      tiers: [], order: 9, repo: '', variantIds: ['q4_k_m', 'q8_0'],
      variants: [
        { id: 'fp8', sizeBytes: 8e9, repo: 'tencent/Hy-MT2-1.8B-FP8', supported: true, recommended: true },
        { id: 'bf16', sizeBytes: 15e9, repo: 'tencent/Hy-MT2-1.8B', supported: true, recommended: false },
      ],
    } } as any });
    await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, translationModel: 'hy-mt2-1.8b' }, textOnly: false,
    }));
    expect((globalThis as any).__lastStatusRepos).toMatchObject({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
  });

  it('resolves the PINNED tts variant repo on the required-models refresh, not the recommended one', async () => {
    // Same shape as the translation-model variant test above, but for TTS: a
    // multi-variant TTS card, pinned to its NON-recommended variant. The
    // required-models refresh (the one that queries exactly the models
    // requiredNativeModels() says are needed) must resolve the TTS card's
    // PINNED repo — ensureSelectionReady's second deriveVariantRepos() call
    // historically only listed asrModel/translationModel and silently dropped
    // ttsModel, so this card's status was checked against its default/
    // recommended repo instead of the one the user actually pinned.
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const catalog = useNativeModelStore.getState().catalog;
    useNativeModelStore.setState({ catalog: { ...catalog, 'moss-tts-pro': {
      id: 'moss-tts-pro', name: 'MOSS Pro', kind: 'tts', languages: ['ja', 'zh'], recommended: false,
      tiers: [], order: 9, repo: '',
      variants: [
        { id: 'fp32', sizeBytes: 3e9, repo: 'org/moss-pro-fp32', supported: true, recommended: false },
        { id: 'bf16', sizeBytes: 1.5e9, repo: 'org/moss-pro-bf16', supported: true, recommended: true },
      ],
    } } as any });
    await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, targetLanguage: 'ja', ttsModel: 'moss-tts-pro',
        translationVariantByModel: { 'moss-tts-pro': 'fp32' } },
      textOnly: false,
    }));
    expect((globalThis as any).__lastStatusRepos).toMatchObject({ 'moss-tts-pro': 'org/moss-pro-fp32' });
  });

  it('resolves the PINNED tts variant repo when TTS is on Auto (ttsModel: \'\'), not just an explicit pick', async () => {
    // Same pin as the test above, but ttsModel is '' (Auto) — the DEFAULT for
    // most users. requiredNativeModels() resolves Auto through resolveNativeTts()
    // internally and status-checks the CONCRETE model id it picks, but the
    // second deriveVariantRepos() call historically fed it effective.ttsModel
    // RAW ('' for Auto): asCards() maps '' -> catalog[''] -> undefined and
    // filters it out, so the pinned card never made it into that repo lookup —
    // the checked model (Auto-resolved) and the pin-looked-up model (none,
    // since '' was dropped) diverged and the pin was silently ignored for
    // every Auto-TTS user. Drop the default moss-tts-nano fixture so the
    // pinned multi-variant card is the SOLE ja-matching TTS candidate — the
    // one Auto resolves to.
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const { 'moss-tts-nano': _dropTts, ...catalogWithoutMossNano } = useNativeModelStore.getState().catalog;
    useNativeModelStore.setState({ catalog: { ...catalogWithoutMossNano, 'moss-tts-pro': {
      id: 'moss-tts-pro', name: 'MOSS Pro', kind: 'tts', languages: ['ja', 'zh'], recommended: false,
      tiers: [], order: 9, repo: '',
      variants: [
        { id: 'fp32', sizeBytes: 3e9, repo: 'org/moss-pro-fp32', supported: true, recommended: false },
        { id: 'bf16', sizeBytes: 1.5e9, repo: 'org/moss-pro-bf16', supported: true, recommended: true },
      ],
    } } as any });
    await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, targetLanguage: 'ja', ttsModel: '',
        translationVariantByModel: { 'moss-tts-pro': 'fp32' } },
      textOnly: false,
    }));
    expect((globalThis as any).__lastStatusRepos).toMatchObject({ 'moss-tts-pro': 'org/moss-pro-fp32' });
  });

  it('sidecar still starting → not ready, reason starting, no corrections', async () => {
    // ensureCatalog() early-returns when status is already 'starting' (see its
    // guard: `if (st === 'ready' || st === 'starting') return;`), so the status
    // never advances past 'starting' and refreshBundle() never runs — pin
    // bundleStatus to a value outside the mismatch/absent/paused branches (those
    // take precedence over 'starting' in the reason derivation) so a leftover
    // bundleStatus from an earlier test in this file can't steal the reason.
    useNativeModelStore.setState({ sidecarStatus: 'starting', bundleStatus: 'unknown' });
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ selection: SEL, textOnly: false }));
    expect(r).toEqual({ ready: false, reason: 'starting', corrections: null });
  });

  it('source language with no compatible ASR model → not ready, reason asr-incompatible', async () => {
    // The fixture catalog's only ASR card (sense-voice) is zh-only. Requesting a
    // 'en' source leaves nativeAsrCards('en', catalog) empty, so autoSelect's ASR
    // step (no compatible card, let alone a downloaded one) resets asrModel to ''
    // — catalog[''] is undefined, so asrCompatible is false regardless of the
    // translation pairing, and asr precedence (checked first) wins the reason.
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog(); // status → ready, catalog seeded
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, sourceLanguage: 'en', targetLanguage: 'en', asrModel: 'sense-voice' },
      textOnly: true,
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('asr-incompatible');
  });

  it('a required TTS model not yet downloaded → not ready, reason models-missing', async () => {
    // zh source / ja target: sense-voice (asr) and qwen2.5-0.5b (translate, multi)
    // stay compatible and auto-select keeps them since the FakeWS reports them
    // 'ready'; ttsModel is '' (Auto), so autoSelect's TTS branch never fires
    // (it only revalidates an EXPLICIT choice) and leaves it at Auto, which
    // resolves to moss-tts-nano (the only 'ja'-capable TTS card in the fixture).
    // Force just that model 'absent' so the asr+translation pair is fully
    // compatible and downloaded, but the required set as a whole is not —
    // landing on 'models-missing' rather than 'asr-incompatible'/'translation-incompatible'.
    mockModelsCatalogResolve();
    mockModelNotReady('moss-tts-nano');
    await useNativeModelStore.getState().ensureCatalog();
    const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({
      selection: { ...SEL, targetLanguage: 'ja' }, textOnly: false,
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('models-missing');
  });
});

describe('nativeModelStore bundle state machine (distribution spec)', () => {
  const statusReply = (over: Record<string, unknown> = {}) => ({
    ok: true, sku: 'linux-nvidia', state: 'ready', installed: true,
    installedVersion: '0.1.0', requiredVersion: '0.1.0',
    gpuName: 'NVIDIA GeForce RTX 4070', stagedBytes: 0, devVenvPresent: false,
    ...over,
  });

  beforeEach(() => {
    useNativeModelStore.setState({
      bundleStatus: 'unknown', bundlePhase: null, bundleSku: null, bundleVersion: null,
      bundleRequiredVersion: null, bundleStagedBytes: 0, bundleGpuName: null,
      bundleDevVenv: false, bundleSize: null, bundleInstalledSize: null,
      bundleProgress: { downloaded: 0, total: 0 }, bundleError: '',
    });
  });


  it('removeBundle resets sidecar lifecycle state so the engine gate re-derives', async () => {
    useNativeModelStore.setState({
      sidecarStatus: 'ready',
      catalog: { 'sense-voice': { id: 'sense-voice' } as any },
      statuses: { 'sense-voice': 'downloaded' as any },
    });
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'sidecar-bundle:remove') return { ok: true };
      return statusReply({ state: 'absent', installed: false, installedVersion: null });
    });
    (globalThis as any).window.electron = { invoke };
    await useNativeModelStore.getState().removeBundle();
    const s = useNativeModelStore.getState();
    // The remove handler killed the sidecar and deleted the bundle: a stale
    // 'ready' would let ensureCatalog early-return and keep Start unlocked
    // against a nonexistent engine.
    expect(s.sidecarStatus).toBe('idle');
    expect(s.catalog).toEqual({});
    expect(s.statuses).toEqual({});
    expect(s.bundleStatus).toBe('absent');
  });

  it('refreshBundle maps ready + carries gpu/dev metadata', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply()),
    };
    await useNativeModelStore.getState().refreshBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('ready');
    expect(s.bundleVersion).toBe('0.1.0');
    expect(s.bundleRequiredVersion).toBe('0.1.0');
    expect(s.bundleGpuName).toBe('NVIDIA GeForce RTX 4070');
  });

  it('refreshBundle maps mismatch and unsupported', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({
        state: 'mismatch', installedVersion: '0.1.0', requiredVersion: '0.2.0' })),
    };
    await useNativeModelStore.getState().refreshBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('mismatch');

    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({ sku: null, state: 'unsupported', installed: false })),
    };
    await useNativeModelStore.getState().refreshBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('unsupported');
  });

  it('refreshBundle maps absent+stagedBytes to paused', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({
        state: 'absent', installed: false, installedVersion: null, stagedBytes: 812 })),
    };
    await useNativeModelStore.getState().refreshBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('paused');
    expect(s.bundleStagedBytes).toBe(812);
  });

  it('refreshBundle is a no-op while installing', async () => {
    useNativeModelStore.setState({ bundleStatus: 'installing' });
    const invoke = vi.fn();
    (globalThis as any).window.electron = { invoke };
    await useNativeModelStore.getState().refreshBundle();
    expect(invoke).not.toHaveBeenCalled();
    expect(useNativeModelStore.getState().bundleStatus).toBe('installing');
  });

  it('installBundle streams phased progress then flips to ready', async () => {
    let progressCb: ((p: any) => void) | null = null;
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, sku: 'linux-nvidia', version: '0.1.0' }),
      receive: (ch: string, f: any) => { if (ch === 'sidecar-bundle-progress') progressCb = f; },
      removeListener: () => {},
    };
    const p = useNativeModelStore.getState().installBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('installing');
    progressCb?.({ phase: 'download', downloaded: 5, total: 10 });
    expect(useNativeModelStore.getState().bundleProgress).toEqual({ downloaded: 5, total: 10 });
    expect(useNativeModelStore.getState().bundlePhase).toBe('download');
    progressCb?.({ phase: 'extract', downloaded: 10, total: 10 });
    expect(useNativeModelStore.getState().bundlePhase).toBe('extract');
    await p;
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('ready');
    expect(s.bundleVersion).toBe('0.1.0');
    expect(s.bundlePhase).toBeNull();
  });

  it('installBundle cancelled -> paused with staged bytes kept', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: false, sku: 'linux-nvidia', cancelled: true }),
      receive: (ch: string, f: any) => { if (ch === 'sidecar-bundle-progress') f({ phase: 'download', downloaded: 812, total: 2000 }); },
      removeListener: () => {},
    };
    await useNativeModelStore.getState().installBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('paused');
    expect(s.bundleStagedBytes).toBe(812);
  });

  it('installBundle surfaces an install error', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: false, error: 'not enough disk space: need ~7.4 GB free, have 3.1 GB' }),
      receive: () => {}, removeListener: () => {},
    };
    await useNativeModelStore.getState().installBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('error');
    expect(s.bundleError).toMatch(/disk space/);
  });

  it('fetchBundleEntry stores manifest sizes best-effort', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, size: 2040, installedSize: 4900 }),
    };
    await useNativeModelStore.getState().fetchBundleEntry();
    const s = useNativeModelStore.getState();
    expect(s.bundleSize).toBe(2040);
    expect(s.bundleInstalledSize).toBe(4900);
  });
});
