import { describe, expect, it, vi } from 'vitest';
import { FakeSidecarConnection } from '../../lib/local-inference/native/SidecarConnection.fake';
import type { ServerMsg } from '../../lib/local-inference/native/nativeProtocol';
import { nativeAsr, nativeTranslation, nativeTts, nativeVad } from './engines';

const msg = (m: Record<string, unknown>) => m as unknown as ServerMsg;

describe('nativeAsr', () => {
  it('inits at the contract rate with the device and variant, and feeds and marks the socket', async () => {
    const conn = new FakeSidecarConnection();
    const asr = nativeAsr(conn);
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
    const asr = nativeAsr(conn);
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
    const tr = nativeTranslation(conn);
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
    const tts = nativeTts(conn);
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

describe('nativeVad', () => {
  function fakeWorker() {
    const w = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((e: MessageEvent) => void) | null, onerror: null as ((e: ErrorEvent) => void) | null };
    return w;
  }
  const say = (w: ReturnType<typeof fakeWorker>, data: Record<string, unknown>) => w.onmessage?.({ data } as MessageEvent);

  it('inits the worker with the three knobs and no max duration, and maps its edges', async () => {
    const w = fakeWorker();
    const vad = nativeVad(() => w as unknown as Worker);
    vad.onSpeechStart = vi.fn();
    vad.onSpeechEnd = vi.fn();
    vad.onSpeechCancel = vi.fn();
    const init = vad.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    const posted = w.postMessage.mock.calls[0][0];
    expect(posted.type).toBe('init');
    expect(posted.vadConfig).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w, { type: 'ready' });
    await init;
    say(w, { type: 'speech_start' });
    say(w, { type: 'speech_end' });
    say(w, { type: 'speech_cancel' });
    expect(vad.onSpeechStart).toHaveBeenCalledTimes(1);
    expect(vad.onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(vad.onSpeechCancel).toHaveBeenCalledTimes(1);
    vad.feed(new Int16Array([1]));
    vad.flush();
    vad.dispose();
    expect(w.postMessage.mock.calls.map((c) => c[0].type)).toEqual(['init', 'audio', 'flush', 'dispose']);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('an error before ready rejects the init; after ready it is an error', async () => {
    const w1 = fakeWorker();
    const first = nativeVad(() => w1 as unknown as Worker);
    const init = first.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w1, { type: 'error', message: 'model missing' });
    await expect(init).rejects.toThrow('model missing');

    const w2 = fakeWorker();
    const second = nativeVad(() => w2 as unknown as Worker);
    second.onError = vi.fn();
    const ready = second.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w2, { type: 'ready' });
    await ready;
    say(w2, { type: 'error', message: 'segmenter died' });
    expect(second.onError).toHaveBeenCalledWith('segmenter died');
  });

  it('with no worker (tests, an unsupported page) it opens and does nothing', async () => {
    const vad = nativeVad(() => null);
    await expect(vad.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 })).resolves.toBeUndefined();
    expect(() => { vad.feed(new Int16Array(1)); vad.flush(); vad.dispose(); }).not.toThrow();
  });
});
