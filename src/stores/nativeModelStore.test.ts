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
    if (msg.type === 'models_catalog') queueMicrotask(() =>
      this.emit({ type: 'models_catalog_result', id: msg.id, models: [
        { id: 'sense-voice', name: 'SenseVoice', languages: ['zh'], recommended: true,
          tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] },
      ] }));
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
      'sense-voice', 'qwen', 'csukuangfj/vits-piper-en_US-amy-low',
    ]);
    // opus-mt translation, ja target -> no TTS
    expect(requiredNativeModels('whisper-tiny', 'opus-mt', '', 'zh', 'ja')).toEqual([
      'whisper-tiny', 'Xenova/opus-mt-zh-ja',
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
});
