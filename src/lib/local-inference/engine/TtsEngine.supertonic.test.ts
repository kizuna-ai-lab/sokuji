import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsEngine } from './TtsEngine';
import { ModelManager } from '../ModelManager';
import * as voiceStorage from '../voiceStorage';

class MockWorker {
  static instances: MockWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  constructor(public url: string | URL, public opts?: WorkerOptions) {
    MockWorker.instances.push(this);
  }
  emit(data: unknown) {
    if (this.onmessage) this.onmessage({ data } as MessageEvent);
  }
}

const originalWorker = globalThis.Worker;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe('TtsEngine — supertonic branch', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    (globalThis as any).Worker = MockWorker;
    URL.createObjectURL = vi.fn((_blob: Blob) => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      'onnx/duration_predictor.onnx': 'blob:dp',
      'onnx/text_encoder.onnx': 'blob:te',
      'onnx/vector_estimator.onnx': 'blob:ve',
      'onnx/vocoder.onnx': 'blob:vc',
      'onnx/tts.json': 'blob:tts',
      'onnx/unicode_indexer.json': 'blob:idx',
      'voice_styles/F1.json': 'blob:f1',
      'voice_styles/F2.json': 'blob:f2',
      'voice_styles/F3.json': 'blob:f3',
      'voice_styles/F4.json': 'blob:f4',
      'voice_styles/F5.json': 'blob:f5',
      'voice_styles/M1.json': 'blob:m1',
      'voice_styles/M2.json': 'blob:m2',
      'voice_styles/M3.json': 'blob:m3',
      'voice_styles/M4.json': 'blob:m4',
      'voice_styles/M5.json': 'blob:m5',
    });
    // Default: no imported voices (avoids hitting real IndexedDB in jsdom)
    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([]);
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('creates a module-type worker pointing at the supertonic worker file', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve(); // extra flush: listVoices await
    const w = MockWorker.instances.at(-1)!;
    // Match anywhere in URL because Vite appends `?worker_file&type=module`.
    expect(String(w.url)).toMatch(/supertonic-tts\.worker\.(ts|js)(\?|$)/);
    expect(w.opts?.type).toBe('module');

    w.emit({ type: 'ready', loadTimeMs: 100, numSpeakers: 10, sampleRate: 44100,
             voices: Array.from({length: 10}, (_, i) => ({sid: i, name: `V${i}`, source: 'preset'})),
             backend: 'webgpu' });
    const ready = await initPromise;
    expect(ready.numSpeakers).toBe(10);
    expect(ready.sampleRate).toBe(44100);
  });

  it('sends voiceList with all 10 preset sids and matching blobUrls', async () => {
    const engine = new TtsEngine();
    void engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve(); // extra flush: listVoices await
    const w = MockWorker.instances.at(-1)!;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(10);
    expect(initMsg.voiceList[0]).toMatchObject({
      sid: 0, name: 'Sarah', source: 'preset', gender: 'F', blobUrl: 'blob:f1',
    });
    expect(initMsg.voiceList[7]).toMatchObject({
      sid: 7, name: 'Robert', source: 'preset', gender: 'M', blobUrl: 'blob:m3',
    });
  });

  it('forwards voices array from ready message to caller', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve(); // extra flush: listVoices await
    const w = MockWorker.instances.at(-1)!;
    const voices = [{sid: 0, name: 'Sarah', source: 'preset' as const, gender: 'F' as const}];
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 1, sampleRate: 44100,
             voices, backend: 'wasm' });
    const ready = await initPromise;
    expect(ready.voices).toEqual(voices);
    expect(ready.backend).toBe('wasm');
  });

  it('revokes all blob URLs after ready', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve(); // extra flush: listVoices await
    const w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 10, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    // 16 model files (incl. 10 voice JSONs) all revoked
    expect((URL.revokeObjectURL as any).mock.calls.length).toBeGreaterThanOrEqual(16);
  });

  it('generate sends { text, sid, speed, lang }', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve(); // extra flush: listVoices await
    const w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 10, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    void engine.generate('hello', 7, 1.0, 'en');
    const genMsg = w.postMessage.mock.calls.find(c => c[0].type === 'generate')![0];
    expect(genMsg).toMatchObject({ type: 'generate', text: 'hello', sid: 7, speed: 1.0, lang: 'en' });
  });
});

describe('TtsEngine — supertonic with imported voices', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    (globalThis as any).Worker = MockWorker;
    URL.createObjectURL = vi.fn((_blob: Blob) => `blob:i-${Math.random()}`);
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      'onnx/duration_predictor.onnx': 'blob:dp',
      'onnx/text_encoder.onnx': 'blob:te',
      'onnx/vector_estimator.onnx': 'blob:ve',
      'onnx/vocoder.onnx': 'blob:vc',
      'onnx/tts.json': 'blob:tts',
      'onnx/unicode_indexer.json': 'blob:idx',
      'voice_styles/F1.json': 'blob:f1',
      'voice_styles/F2.json': 'blob:f2',
      'voice_styles/F3.json': 'blob:f3',
      'voice_styles/F4.json': 'blob:f4',
      'voice_styles/F5.json': 'blob:f5',
      'voice_styles/M1.json': 'blob:m1',
      'voice_styles/M2.json': 'blob:m2',
      'voice_styles/M3.json': 'blob:m3',
      'voice_styles/M4.json': 'blob:m4',
      'voice_styles/M5.json': 'blob:m5',
    });

    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([
      { id: 1, engine: 'supertonic-3', name: 'Imported A',
        jsonData: new Blob(['{}']), importedAt: 1 },
      { id: 5, engine: 'supertonic-3', name: 'Imported B',
        jsonData: new Blob(['{}']), importedAt: 2 },
    ]);
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('merges imported voices with presets, sid = dbKey + 10', async () => {
    const engine = new TtsEngine();
    void engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve();  // extra microtask for the voiceStorage.listVoices await
    const w = MockWorker.instances.at(-1)!;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(12);
    expect(initMsg.voiceList.find((v: any) => v.sid === 11)).toMatchObject({
      sid: 11, name: 'Imported A', source: 'imported',
    });
    expect(initMsg.voiceList.find((v: any) => v.sid === 15)).toMatchObject({
      sid: 15, name: 'Imported B', source: 'imported',
    });
  });

  it('reloadVoices disposes + re-inits the worker and picks up new voices', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    await Promise.resolve();
    await Promise.resolve();
    let w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 1, numSpeakers: 12, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    expect(MockWorker.instances).toHaveLength(1);

    // Simulate a new imported voice
    (voiceStorage.listVoices as any).mockResolvedValue([
      { id: 1, engine: 'supertonic-3', name: 'Imported A',
        jsonData: new Blob(['{}']), importedAt: 1 },
      { id: 5, engine: 'supertonic-3', name: 'Imported B',
        jsonData: new Blob(['{}']), importedAt: 2 },
      { id: 9, engine: 'supertonic-3', name: 'Newly Added',
        jsonData: new Blob(['{}']), importedAt: 3 },
    ]);

    const reloadPromise = engine.reloadVoices();
    await Promise.resolve();
    await Promise.resolve();
    expect(MockWorker.instances).toHaveLength(2);  // new worker spawned
    w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 1, numSpeakers: 13, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await reloadPromise;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(13);
    expect(initMsg.voiceList.find((v: any) => v.sid === 19)?.name).toBe('Newly Added');
  });

  it('reloadVoices is a no-op when no supertonic model is active', async () => {
    const engine = new TtsEngine();
    // Engine never initialized, no current model
    await engine.reloadVoices();
    expect(MockWorker.instances).toHaveLength(0);
  });
});
