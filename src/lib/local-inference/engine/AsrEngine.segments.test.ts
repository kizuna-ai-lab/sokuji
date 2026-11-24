import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

const WEBGPU_MODELS = ['whisper-base-webgpu', 'qwen3-asr-0.6b-webgpu', 'granite-speech', 'cohere-transcribe-webgpu', 'voxtral-mini-3b-webgpu'];

describe('AsrEngine: the turn detector\'s segment port', () => {
  let restore: () => void;
  let channel: MessageChannel;

  beforeEach(() => {
    restore = installMockWorker();
    channel = new MessageChannel();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ variantKey: 'q4f16', dtype: 'q4f16', files: [] });
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'package-metadata.json': 'blob:meta', 'model.onnx': 'blob:m' });
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    channel.port1.close();
    channel.port2.close();
  });

  async function initMessage(engine: AsrEngine, modelId: string, segmentPort?: MessagePort) {
    engine.init(modelId, { minSilenceDuration: 1.4 }, 'ja', undefined, segmentPort).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    return worker.postMessage.mock.calls[0] as [Record<string, unknown>, Transferable[]?];
  }

  async function readyEngine(modelId = 'whisper-base-webgpu') {
    const engine = new AsrEngine();
    const initP = engine.init(modelId, undefined, 'ja', undefined, channel.port1);
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    return { engine, worker };
  }

  it.each(WEBGPU_MODELS)('%s gets the segment port, transferred, and no VAD config', async (modelId) => {
    const engine = new AsrEngine();
    const [message, transfer] = await initMessage(engine, modelId, channel.port1);
    expect(message.segmentPort).toBe(channel.port1);
    expect(transfer).toEqual([channel.port1]);
    expect(message).not.toHaveProperty('vadConfig');
    expect(message).not.toHaveProperty('vadModelUrl');
    expect(message).not.toHaveProperty('turnPort');
    expect(message.type).toBe('init');
    expect(message.language).toBe('ja');
    engine.dispose();
  });

  it('Granite carries its task and target language beside the port', async () => {
    const engine = new AsrEngine();
    engine.init('granite-speech', undefined, 'ja', { task: 'translate', targetLanguage: 'en' }, channel.port1).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ task: 'translate', targetLanguage: 'en', segmentPort: channel.port1 });
    engine.dispose();
  });

  it.each(WEBGPU_MODELS)('%s without a segment port does not start', async (modelId) => {
    const engine = new AsrEngine();
    await expect(engine.init(modelId, undefined, 'ja')).rejects.toThrow(/takes its segments from a turn detector: no segment port/);
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('sherpa-onnx still gets its VAD config and no port', async () => {
    const engine = new AsrEngine();
    engine.init('sensevoice-int8', { minSilenceDuration: 1.4 } as any, 'ja').catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const call = worker.postMessage.mock.calls[0] as [Record<string, unknown>, Transferable[]?];
    expect(call[0].vadConfig).toEqual({ minSilenceDuration: 1.4 });
    expect(call[0]).not.toHaveProperty('segmentPort');
    expect(call).toHaveLength(1);
    engine.dispose();
  });

  it('drained reaches onDrained with its seq', async () => {
    const { engine, worker } = await readyEngine();
    const onDrained = vi.fn();
    engine.onDrained = onDrained;
    worker.emit({ type: 'drained', epoch: 0, seq: 7 });
    expect(onDrained).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("stop posts {type:'stop', epoch}, and only once ready", async () => {
    const engine = new AsrEngine();
    engine.stop(1);
    expect(MockWorker.instances).toHaveLength(0);
    const { engine: ready, worker } = await readyEngine();
    worker.postMessage.mockClear();
    ready.stop(3);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop', epoch: 3 });
  });

  it('press and epoch come with the result and with a partial', async () => {
    const { engine, worker } = await readyEngine('cohere-transcribe-webgpu');
    const onResult = vi.fn();
    const onPartial = vi.fn();
    engine.onResult = onResult;
    engine.onPartialResult = onPartial;
    worker.emit({ type: 'partial', text: 'こん', press: 2, epoch: 1 });
    worker.emit({ type: 'partial', text: 'こんに' });
    worker.emit({ type: 'result', text: 'こんにちは', startSample: 160, durationMs: 900, recognitionTimeMs: 12, endedBy: 'release', press: 2, epoch: 1 });
    worker.emit({ type: 'result', text: 'plain', durationMs: 1, recognitionTimeMs: 1 });
    expect(onPartial).toHaveBeenNthCalledWith(1, 'こん', { press: 2, epoch: 1 });
    expect(onPartial).toHaveBeenNthCalledWith(2, 'こんに', {});
    expect(onResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'こんにちは', startSample: 160, endedBy: 'release', press: 2, epoch: 1 }));
    expect(onResult.mock.calls[1][0]).not.toHaveProperty('press');
    expect(onResult.mock.calls[1][0]).not.toHaveProperty('epoch');
  });
});
