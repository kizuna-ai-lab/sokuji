import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import { INIT_REQUEST_TIMEOUT_MS, SidecarTimeoutError } from '../../lib/local-inference/native/SidecarConnection';
import { FakeSidecarConnection } from '../../lib/local-inference/native/SidecarConnection.fake';
import type { ServerMsg } from '../../lib/local-inference/native/nativeProtocol';
import { nativeAsr, nativeTranslation, nativeTts, nativeTurns } from './engines';
import type { TurnDetectorLike } from '../localInference/engines';

const msg = (m: Record<string, unknown>) => m as unknown as ServerMsg;
const clock = createVirtualClock(0);

describe('nativeAsr', () => {
  it('inits at the contract rate with the device and variant, and feeds and marks the socket', async () => {
    const conn = new FakeSidecarConnection();
    const asr = nativeAsr(clock, conn);
    const init = asr.init({ language: 'ja', modelId: 'asr-a', device: 'gpu', variant: 'q8_0' });
    expect(conn.sent[0]).toMatchObject({ type: 'asr_init', language: 'ja', model: 'asr-a', sampleRate: 24000, device: 'gpu', variant: 'q8_0' });
    conn.emit(msg({ type: 'ready', id: conn.sent[0].id, loadTimeMs: 5, device: 'vulkan' }));
    await expect(init).resolves.toMatchObject({ loadTimeMs: 5, device: 'vulkan' });
    const pcm = new Int16Array([1, 2, 3]);
    asr.feedAudio(pcm);
    asr.sendVadMark('start');
    expect(conn.binarySent).toEqual([pcm]);
    expect(conn.sent[1]).toEqual({ type: 'vad_mark', event: 'start' });
  });

  it('hands pushes to its hooks, an id-less error as an error, and a closed socket as closed', () => {
    const conn = new FakeSidecarConnection();
    const asr = nativeAsr(clock, conn);
    asr.onPartialResult = vi.fn();
    asr.onResult = vi.fn();
    asr.onError = vi.fn();
    asr.onClosed = vi.fn();
    conn.emit(msg({ type: 'partial', text: 'こん' }));
    conn.emit(msg({ type: 'result', text: 'こんにちは', durationMs: 900, recognitionTimeMs: 90 }));
    conn.emit(msg({ type: 'error', message: 'feeder failed' }));
    conn.emitClose();
    expect(asr.onPartialResult).toHaveBeenCalledWith('こん');
    expect(asr.onResult).toHaveBeenCalledWith({ text: 'こんにちは', durationMs: 900, recognitionTimeMs: 90 });
    expect(asr.onError).toHaveBeenCalledWith('feeder failed');
    expect(asr.onClosed).toHaveBeenCalledWith('native host disconnected');
  });
});

describe('nativeTranslation', () => {
  it('inits with the co-loaded ids, streams partials, and reports a closed socket', async () => {
    const conn = new FakeSidecarConnection();
    const tr = nativeTranslation(clock, conn);
    tr.onPartial = vi.fn();
    tr.onClosed = vi.fn();
    const init = tr.init({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto', asrModel: 'asr-a', ttsModel: 'tts-a' });
    // The close settles the init still waiting on its reply; hold the rejection so it is not unhandled.
    const closed = expect(init).rejects.toThrow('native host disconnected');
    expect(conn.sent[0]).toMatchObject({ type: 'translate_init', sourceLang: 'ja', targetLang: 'en', model: 'mt-a', device: 'auto', asrModel: 'asr-a', ttsModel: 'tts-a' });
    conn.emit(msg({ type: 'translate_partial', text: 'Hel' }));
    expect(tr.onPartial).toHaveBeenCalledWith('Hel');
    conn.emitClose();
    expect(tr.onClosed).toHaveBeenCalledWith('native host disconnected');
    await closed;
  });
});

describe('nativeTts', () => {
  it('a closed socket rejects the synthesis in flight and reports closed', async () => {
    const conn = new FakeSidecarConnection();
    const tts = nativeTts(clock, conn);
    tts.onClosed = vi.fn();
    const init = tts.init({ modelId: 'tts-a', device: 'auto', language: 'en' });
    conn.emit(msg({ type: 'ready', id: conn.sent[0].id, loadTimeMs: 1, sampleRate: 24000, streaming: true, clones: false }));
    await expect(init).resolves.toMatchObject({ streaming: true, sampleRate: 24000 });
    const speaking = tts.generate('Hello.', 1, () => {});
    conn.emitClose();
    await expect(speaking).rejects.toThrow();
    expect(tts.onClosed).toHaveBeenCalledWith('native host disconnected');
  });
});

describe('nativeTurns', () => {
  class FakeDetector implements TurnDetectorLike {
    inits: Array<Parameters<TurnDetectorLike['init']>[0]> = [];
    fed: Int16Array[] = [];
    calls: string[] = [];
    disposes = 0;
    failInit: Error | null = null;
    onSpeechStart: TurnDetectorLike['onSpeechStart'] = null;
    onFailed: TurnDetectorLike['onFailed'] = null;
    onFatal: TurnDetectorLike['onFatal'] = null;
    async init(o: Parameters<TurnDetectorLike['init']>[0]) { this.inits.push(o); if (this.failInit) throw this.failInit; }
    feedAudio(pcm: Int16Array) { this.fed.push(pcm); }
    begin(press: number) { this.calls.push(`begin:${press}`); }
    drain(press?: number) { this.calls.push(`drain:${press}`); }
    cancel(press: number) { this.calls.push(`cancel:${press}`); }
    stop(epoch: number) { this.calls.push(`stop:${epoch}`); }
    dispose() { this.disposes++; }
  }
  const VAD = { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 };

  it('opens the detector for marks over a port pair, and relays its audio and marks to the callbacks in order', async () => {
    const d = new FakeDetector();
    const turns = nativeTurns(d);
    const seen: string[] = [];
    turns.onAudio = (pcm) => seen.push(`audio:${pcm.length}`);
    turns.onMark = (event) => seen.push(event);
    turns.onDrained = () => seen.push('drained');
    await turns.init({ turns: 'manual', vad: VAD, limit: { maxSpeechSeconds: 19 } });
    expect(d.inits).toHaveLength(1);
    expect(d.inits[0]).toMatchObject({ turns: 'manual', vad: VAD, limit: { maxSpeechSeconds: 19 }, delivery: 'marks' });
    expect(d.inits[0].turnPort).toBeUndefined();
    // What the detector writes on its end of the port is what the callbacks hear, in the order it was written.
    d.inits[0].output.postMessage({ type: 'audio', pcm: new Int16Array(3) });
    d.inits[0].output.postMessage({ type: 'mark', event: 'start' });
    d.inits[0].output.postMessage({ type: 'audio', pcm: new Int16Array(5) });
    d.inits[0].output.postMessage({ type: 'mark', event: 'end' });
    d.inits[0].output.postMessage({ type: 'drained' });
    await vi.waitFor(() => expect(seen).toHaveLength(5));
    expect(seen).toEqual(['audio:3', 'start', 'audio:5', 'end', 'drained']);
    turns.dispose();
  });

  it('hands the Smart Turn port on, and forwards feed, begin, drain and cancel', async () => {
    const d = new FakeDetector();
    const turns = nativeTurns(d);
    const turnPort = new MessageChannel().port1;
    await turns.init({ turns: 'auto', vad: VAD, limit: {}, turnPort });
    expect(d.inits[0].turnPort).toBe(turnPort);
    turns.feed(new Int16Array([1]));
    turns.begin(1); turns.drain(1); turns.cancel(1);
    expect(d.fed).toEqual([new Int16Array([1])]);
    expect(d.calls).toEqual(['begin:1', 'drain:1', 'cancel:1']);
    turns.dispose();
    expect(d.disposes).toBe(1);
    turnPort.close();
  });

  it('a failed init rejects with the detector\'s own error and closes the port pair', async () => {
    const d = new FakeDetector();
    d.failInit = new Error('Silero did not load');
    const turns = nativeTurns(d);
    await expect(turns.init({ turns: 'auto', vad: VAD, limit: {} })).rejects.toThrow('Silero did not load');
  });

  it('the detector failing or dying is an error, once it is up', async () => {
    const d = new FakeDetector();
    const turns = nativeTurns(d);
    turns.onError = vi.fn();
    await turns.init({ turns: 'auto', vad: VAD, limit: {} });
    d.onFailed?.({ code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' });
    d.onFatal?.('RuntimeError: unreachable');
    expect(turns.onError).toHaveBeenNthCalledWith(1, 'Turn detection cannot keep up on this device.');
    expect(turns.onError).toHaveBeenNthCalledWith(2, 'RuntimeError: unreachable');
    turns.dispose();
  });
});

describe("the seams on the run's clock", () => {
  // A raw socket for the real connection each seam opens when it is handed no connection.
  class FakeWS {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    binaryType = 'arraybuffer';
    readyState = 1;
    constructor() { setTimeout(() => this.onopen?.(), 0); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let savedWS: unknown;
  let savedElectron: unknown;
  beforeEach(() => {
    savedWS = (globalThis as { WebSocket?: unknown }).WebSocket;
    savedElectron = (window as unknown as { electron?: unknown }).electron;
    (globalThis as { WebSocket?: unknown }).WebSocket = Object.assign(FakeWS, { OPEN: 1 });
    (window as unknown as { electron: unknown }).electron = { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) };
  });
  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = savedWS;
    (window as unknown as { electron: unknown }).electron = savedElectron;
  });

  it('every socket is opened on the clock it is handed (#578 ruling 23)', async () => {
    const inits: Array<(c: Clock) => Promise<unknown>> = [
      (c) => nativeAsr(c).init({ language: 'ja', modelId: 'asr-a', device: 'auto' }),
      (c) => nativeTranslation(c).init({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto' }),
      (c) => nativeTts(c).init({ modelId: 'tts-a', device: 'auto', language: 'en' }),
    ];
    for (const init of inits) {
      const virtual = createVirtualClock(0);
      let settled = false;
      const answer = init(virtual);
      answer.then(() => { settled = true; }, () => { settled = true; });
      await tick(); await tick();
      virtual.advance(INIT_REQUEST_TIMEOUT_MS - 1); await tick();
      expect(settled).toBe(false);
      virtual.advance(1);
      await expect(answer).rejects.toBeInstanceOf(SidecarTimeoutError);
    }
  });
});
