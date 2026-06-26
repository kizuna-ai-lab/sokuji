import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNativeModelStore } from './nativeModelStore';
import { requiredNativeModels } from '../lib/local-inference/native/nativeCatalog';

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
      // The sidecar returns ASR or translation models depending on `kind` (default asr).
      const models = msg.kind === 'translate'
        ? [{ id: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', languages: ['multi'], recommended: true,
             tiers: [{ tier: 'gpu-cuda', backend: 'qwen_translate', available: true },
                     { tier: 'cpu', backend: 'qwen_translate', available: true }] }]
        : [{ id: 'sense-voice', name: 'SenseVoice', languages: ['zh'], recommended: true,
             tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] }];
      queueMicrotask(() => this.emit({ type: 'models_catalog_result', id: msg.id, models }));
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
  useNativeModelStore.setState({ catalog: {} });
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
    // explicit translation model, ja target -> no TTS
    expect(requiredNativeModels('whisper-tiny', 'translategemma-4b', '', 'zh', 'ja')).toEqual([
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
