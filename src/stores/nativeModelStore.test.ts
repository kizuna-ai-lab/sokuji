import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNativeModelStore } from './nativeModelStore';
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
function mockModelsCatalogResolve() { _shouldReject = false; }
function mockModelsCatalogReject() { _shouldReject = true; }
function modelsCatalogCallCount() { return _catalogCallCount; }

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
      let models;
      if (msg.kind === 'translate') {
        models = [{ id: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', languages: ['multi'], recommended: true,
             tiers: [{ tier: 'gpu-cuda', backend: 'llamacpp_qwen', available: true },
                     { tier: 'cpu', backend: 'llamacpp_qwen', available: true }], sizeBytes: 999604126 }];
      } else if (msg.kind === 'tts') {
        models = [{ id: 'moss-tts-nano', name: 'MOSS TTS Nano', languages: ['ja', 'zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'moss_tts', available: true }], sizeBytes: 763206064 }];
      } else {
        models = [{ id: 'sense-voice', name: 'SenseVoice', languages: ['zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }], sizeBytes: 944624033 },
           ..._asrExtraModels];
      }
      queueMicrotask(() => this.emit({ type: 'models_catalog_result', id: msg.id, models }));
    }
    if (msg.type === 'model_status') {
      (globalThis as any).__lastStatusRepos = msg.repos;
      queueMicrotask(() => this.emit({ type: 'model_status_result', id: msg.id,
        statuses: Object.fromEntries((msg.models || []).map((m: string) => [m, 'ready'])) }));
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
    id: 'fun-asr-mlt-nano', name: 'Fun-ASR MLT Nano', languages: ['multi'], recommended: true,
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
