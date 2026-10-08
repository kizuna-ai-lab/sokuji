import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoopbackRecorder } from './LoopbackRecorder';

const getDisplayMedia = vi.fn();
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getDisplayMedia.mockReset();
  invoke = vi.fn().mockResolvedValue(undefined);
  (window as any).electron = { invoke };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia },
  });
});

describe('LoopbackRecorder.acquireStream', () => {
  it('rejects with what getDisplayMedia rejected with, not advice for another platform', async () => {
    // An Error carrying the name, as Chromium's DOMException is one; jsdom's is not an Error.
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    getDisplayMedia.mockRejectedValue(denied);
    const rec = new LoopbackRecorder(24000);

    await expect((rec as any).acquireStream()).rejects.toBe(denied);
  });

  it('turns loopback audio back off when getDisplayMedia rejects', async () => {
    getDisplayMedia.mockRejectedValue(new DOMException('Could not start audio source', 'NotReadableError'));
    const rec = new LoopbackRecorder(24000);

    await expect((rec as any).acquireStream()).rejects.toThrow();
    expect(invoke).toHaveBeenLastCalledWith('disable-loopback-audio');
  });
});
