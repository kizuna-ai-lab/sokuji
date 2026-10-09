import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('AsrEngine — the Smart Turn port', () => {
  let restore: () => void;
  let channel: MessageChannel;

  beforeEach(() => {
    restore = installMockWorker();
    channel = new MessageChannel();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ variantKey: 'q4f16', dtype: 'q4f16', files: [] });
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({});
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
    channel.port1.close();
    channel.port2.close();
  });

  async function initMessage(engine: AsrEngine, modelId: string, turnPort?: MessagePort) {
    engine.init(modelId, { minSilenceDuration: 1.4 }, 'ja', undefined, turnPort).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    return worker.postMessage.mock.calls[0] as [Record<string, unknown>, Transferable[]?];
  }

  it.each(['qwen3-asr-0.6b-webgpu', 'granite-speech'])('%s gets the port in its init message, transferred', async (modelId) => {
    const engine = new AsrEngine();
    const [message, transfer] = await initMessage(engine, modelId, channel.port1);
    expect(message.turnPort).toBe(channel.port1);
    expect(transfer).toEqual([channel.port1]);
    engine.dispose();
  });

  it('transfers nothing without a port', async () => {
    const engine = new AsrEngine();
    const call = await initMessage(engine, 'qwen3-asr-0.6b-webgpu');
    expect(call[0].turnPort).toBeUndefined();
    expect(call).toHaveLength(1);
    engine.dispose();
  });
});
