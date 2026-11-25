import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnDetector, TurnDetectorError } from './TurnDetector';
import { MockWorker, installMockWorker } from './testing/mockWorker';

describe('TurnDetector', () => {
  let restore: () => void;
  let output: MessageChannel;
  let turn: MessageChannel;

  beforeEach(() => {
    restore = installMockWorker();
    output = new MessageChannel();
    turn = new MessageChannel();
  });
  afterEach(() => {
    restore();
    for (const c of [output, turn]) { c.port1.close(); c.port2.close(); }
  });

  const config = () => ({ turns: 'auto' as const, vad: { threshold: 0.3 }, limit: { maxSpeechSeconds: 29 }, output: output.port1, turnPort: turn.port1 });

  async function started(detector = new TurnDetector()) {
    const init = detector.init(config());
    const worker = MockWorker.last();
    return { detector, init, worker };
  }
  async function ready() {
    const s = await started();
    s.worker.emit({ type: 'ready', loadTimeMs: 12 });
    await s.init;
    s.worker.postMessage.mockClear();
    return s;
  }

  it('init posts the config with the output port and the Smart Turn port transferred', async () => {
    const { init, worker } = await started();
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message).toMatchObject({ type: 'init', turns: 'auto', vad: { threshold: 0.3 }, limit: { maxSpeechSeconds: 29 }, output: output.port1, turnPort: turn.port1 });
    expect(message.ortWasmBaseUrl).toMatch(/wasm\/ort\/$/);
    expect(message.vadModelUrl).toMatch(/wasm\/vad\/silero_vad_v5\.onnx$/);
    expect(transfer).toEqual([output.port1, turn.port1]);
    worker.emit({ type: 'ready', loadTimeMs: 7 });
    await expect(init).resolves.toEqual({ loadTimeMs: 7 });
  });

  it('init transfers only the output port when there is no Smart Turn port', async () => {
    const detector = new TurnDetector();
    void detector.init({ ...config(), turnPort: undefined });
    const [message, transfer] = MockWorker.last().postMessage.mock.calls[0];
    expect(message.turnPort).toBeUndefined();
    expect(transfer).toEqual([output.port1]);
  });

  it('feedAudio transfers the buffer; begin, drain, cancel and stop post in call order', async () => {
    const { detector, worker } = await ready();
    const pcm = new Int16Array(480);
    detector.feedAudio(pcm);
    detector.begin(3);
    detector.drain(3);
    detector.drain();
    detector.cancel(4);
    detector.stop(2);
    const calls = worker.postMessage.mock.calls;
    expect(calls.map((c) => c[0].type)).toEqual(['audio', 'begin', 'drain', 'drain', 'cancel', 'stop']);
    expect(calls[0][0]).toMatchObject({ type: 'audio', sampleRate: 24000 });
    expect(calls[0][0].pcm).toBe(pcm);
    expect(calls[0][1]).toEqual([pcm.buffer]);
    expect(calls[1][0]).toEqual({ type: 'begin', press: 3 });
    expect(calls[2][0]).toEqual({ type: 'drain', press: 3 });
    expect(calls[3][0]).toEqual({ type: 'drain', press: undefined });
    expect(calls[4][0]).toEqual({ type: 'cancel', press: 4 });
    expect(calls[5][0]).toEqual({ type: 'stop', epoch: 2 });
  });

  it('posts nothing before ready', async () => {
    const { detector, worker } = await started();
    worker.postMessage.mockClear();
    detector.feedAudio(new Int16Array(4));
    detector.begin(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('a failed notice reaches onFailed with its code; a worker error reaches onFatal', async () => {
    const { detector, worker } = await ready();
    const onFailed = vi.fn(), onFatal = vi.fn(), onSpeechStart = vi.fn();
    detector.onFailed = onFailed; detector.onFatal = onFatal; detector.onSpeechStart = onSpeechStart;
    worker.emit({ type: 'speech_start' });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    worker.emit({ type: 'failed', code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' });
    expect(onFailed).toHaveBeenCalledWith({ code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' });
    worker.emitError('boom');
    expect(onFatal).toHaveBeenCalledWith('boom');
  });

  it('onFailed fires at most once', async () => {
    const { detector, worker } = await ready();
    const onFailed = vi.fn();
    detector.onFailed = onFailed;
    worker.emit({ type: 'failed', code: 'turn_detection_overloaded', message: 'a' });
    worker.emit({ type: 'failed', code: 'turn_detection_unavailable', message: 'b' });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0][0].message).toBe('a');
  });

  it('init rejects with code turn_detection_unavailable when the worker cannot load Silero', async () => {
    const { init, worker } = await started();
    worker.emit({ type: 'error', error: 'no model', code: 'turn_detection_unavailable' });
    const err = await init.catch((e) => e);
    expect(err).toBeInstanceOf(TurnDetectorError);
    expect(err.code).toBe('turn_detection_unavailable');
    expect(err.message).toBe('no model');
  });

  it('an init error without a code rejects as a plain error', async () => {
    const { init, worker } = await started();
    worker.emit({ type: 'error', error: 'odd' });
    const err = await init.catch((e) => e);
    expect(err).not.toBeInstanceOf(TurnDetectorError);
    expect(err.message).toBe('odd');
  });

  it('dispose terminates the worker', async () => {
    const { detector, worker } = await ready();
    detector.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalled();
  });
});
