import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

/**
 * Qwen3-ASR routes through the raw-ORT worker with the Whisper-shaped init message: the
 * manifest variant key travels as `dtype` (the worker resolves it in prompt_config.json) and
 * the source language travels as `language` (the worker forces the model's prefix from it).
 */
describe('AsrEngine — qwen3-asr-webgpu routing', () => {
  let restore: () => void;
  const fileUrls = {
    'prompt_config.json': 'blob:cfg',
    'config.json': 'blob:config',
    'tokenizer.json': 'blob:tok',
    'mel_filters.json': 'blob:mel',
    'embed_tokens.int8.bin': 'blob:emb',
    'embed_scales.f32.bin': 'blob:scales',
    'encoder.fp16.onnx': 'blob:enc',
    'decoder_init.q4f16.onnx': 'blob:init',
    'decoder_step.q4f16.onnx': 'blob:step',
    'decoder_weights.q4f16.data': 'blob:weights',
  };

  beforeEach(() => {
    restore = installMockWorker();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ variantKey: 'q4f16', dtype: 'q4f16', files: [] });
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue(fileUrls);
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('constructs the qwen3 module worker and posts the variant key and language in the init message', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('qwen3-asr-0.6b-webgpu', { minSilenceDuration: 1.0 }, 'ja');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    expect(String(worker.url)).toContain('qwen3-asr-webgpu.worker');
    expect(worker.opts).toEqual({ type: 'module' });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const init = (worker.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(init).toEqual(expect.objectContaining({
      type: 'init',
      fileUrls,
      hfModelId: 'jiangzhuo9357/Qwen3-ASR-0.6B-ONNX',
      language: 'ja',
      dtype: 'q4f16',
      vadConfig: { minSilenceDuration: 1.0 },
    }));
    expect(init.ortWasmBaseUrl).toMatch(/\/wasm\/ort\/$/);
    expect(init.vadModelUrl).toMatch(/\/wasm\/vad\/silero_vad_v5\.onnx$/);
    // No sherpa-style package metadata on this path.
    expect(init.dataFileUrls).toBeUndefined();

    worker.emit({ type: 'ready', loadTimeMs: 3 });
    await expect(initP).resolves.toEqual({ loadTimeMs: 3 });
    expect(engine.ready).toBe(true);
  });

  it('delivers the worker result to onResult', async () => {
    const engine = new AsrEngine();
    const onResult = vi.fn();
    engine.onResult = onResult;
    const initP = engine.init('qwen3-asr-0.6b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.emit({ type: 'result', text: 'こんにちは', startSample: 0, durationMs: 900, recognitionTimeMs: 120 });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'こんにちは', durationMs: 900, recognitionTimeMs: 120 }));
  });
});
