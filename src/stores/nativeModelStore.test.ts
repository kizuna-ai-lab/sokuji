import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNativeModelStore } from './nativeModelStore';
import { requiredNativeModels } from '../lib/local-inference/native/nativeCatalog';

// ---------------------------------------------------------------------------
// Helpers for controlling FakeWS catalog behaviour in lifecycle tests
// ---------------------------------------------------------------------------
let _shouldReject = false;
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
             tiers: [{ tier: 'gpu-cuda', backend: 'qwen_translate', available: true },
                     { tier: 'cpu', backend: 'qwen_translate', available: true }] }];
      } else if (msg.kind === 'tts') {
        models = [{ id: 'moss-tts-nano', name: 'MOSS TTS Nano', languages: ['ja', 'zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'moss_tts', available: true }] }];
      } else {
        models = [{ id: 'sense-voice', name: 'SenseVoice', languages: ['zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] }];
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
  _catalogCallCount = 0;
  useNativeModelStore.setState({ catalog: {}, sidecarStatus: 'idle' } as any);
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
  it('lists asr + translation(+qwen default) + tts when speech on', () => {
    // en target -> piper TTS; '' translation -> qwen
    expect(requiredNativeModels('sense-voice', '', '', 'es', 'en')).toEqual([
      'sense-voice', 'qwen2.5-0.5b', 'csukuangfj/vits-piper-en_US-amy-low',
    ]);
    // explicit translation model, ja target → MOSS TTS (Fix 2: ja now gets moss-tts-nano as default)
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', '', 'zh', 'ja')).toEqual([
      'whisper-tiny', 'translategemma-4b', 'moss-tts-nano',
    ]);
    // 'off' tts choice -> no TTS regardless of language
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', 'off', 'zh', 'ja')).toEqual([
      'whisper-tiny', 'translategemma-4b',
    ]);
    // language with no voice (th) -> no TTS
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', '', 'zh', 'th')).toEqual([
      'whisper-tiny', 'translategemma-4b',
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
});
