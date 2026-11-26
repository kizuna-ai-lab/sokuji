// @vitest-environment node
/**
 * The ASR engine (ported from sidecar/tests/test_asr_engine.py): mark-driven offline segmentation, init through the
 * resolver, and the streaming state machine (always-stream, per-utterance, the pre-roll, the backstops, backpressure).
 * Python's tests poke the engine's private state; here the same state is the engine's public fields.
 */
import '../test/env';
import { afterEach, describe, expect, it } from 'vitest';
import { AsrResult } from '../backends';
import type { Plan } from '../planner';
import type { AsrStreamLike } from './backend';
import { AsrEngine, AudioQueue, RING_SAMPLES, engineSeams, restoreEngineSeams, type AsrBackendLike, type AsrEvent } from './engine';

/** `n` int16 samples of `value`, as the client's bytes. */
const pcm = (n: number, value = 0) => new Uint8Array(new Int16Array(n).fill(value).buffer);
const plan = (backend: string, device: string, computeType: string): Plan => ({ backend, tier: device, device, computeType, artifact: 'tiny', rank: 1.0 } as unknown as Plan);
const collect = () => {
  const sent: AsrEvent[] = [];
  return { sent, send: async (m: AsrEvent) => { sent.push(m); } };
};
const results = (sent: AsrEvent[]) => sent.filter((m) => m.type === 'result');

afterEach(() => restoreEngineSeams());

class EchoBackend implements AsrBackendLike {
  readonly calls: Float32Array[] = [];
  async transcribe(samples: Float32Array) {
    this.calls.push(samples);
    return new AsrResult('seg-text');
  }
}

/** An offline engine at 16 kHz with an echo backend — no addon, no model. */
const offlineEngine = () => {
  const eng = new AsrEngine();
  eng.srcRate = 16000;
  const backend = new EchoBackend();
  eng.backend = backend;
  return { eng, backend };
};

describe('offline (mark-driven) segmentation', () => {
  it('buffers between the marks and transcribes on end, with the pre-roll', async () => {
    const { eng, backend } = offlineEngine();
    expect(await eng.feed(pcm(1600))).toEqual([]);
    expect(await eng.mark('start')).toEqual([]);
    await eng.feed(pcm(1600, 1000));
    const out = await eng.mark('end');
    expect(out.map((m) => m.type)).toEqual(['result']);
    expect(out[0].text).toBe('seg-text');
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].length).toBeGreaterThanOrEqual(1600);
  });

  it('the pre-roll ring seeds the segment and is capped', async () => {
    const { eng, backend } = offlineEngine();
    for (let i = 0; i < 20; i++) await eng.feed(pcm(1600, 1));
    await eng.mark('start');
    await eng.mark('end');
    const [seg] = backend.calls;
    expect(seg.length).toBeGreaterThanOrEqual(RING_SAMPLES);
    expect(seg.length).toBeLessThanOrEqual(RING_SAMPLES + 1600);
  });

  it('cancel drops the segment', async () => {
    const { eng, backend } = offlineEngine();
    await eng.mark('start');
    await eng.feed(pcm(1600, 1));
    expect(await eng.mark('cancel')).toEqual([]);
    expect(await eng.mark('end')).toEqual([]);
    expect(backend.calls).toEqual([]);
  });

  it('an end without a start does nothing', async () => {
    const { eng, backend } = offlineEngine();
    expect(await eng.mark('end')).toEqual([]);
    expect(backend.calls).toEqual([]);
  });

  it('flush finalizes the open segment, once', async () => {
    const { eng } = offlineEngine();
    await eng.mark('start');
    await eng.feed(pcm(1600, 1));
    expect((await eng.flush()).map((m) => m.type)).toEqual(['result']);
    expect(await eng.flush()).toEqual([]);
  });

  it("the ring is cleared after an end: no tail duplicated into the next segment", async () => {
    const { eng, backend } = offlineEngine();
    await eng.mark('start');
    await eng.feed(pcm(1600, 1));
    await eng.mark('end');
    await eng.mark('start');
    await eng.mark('end');
    expect(backend.calls).toHaveLength(1);
  });

  it('the 30 s backstop cuts a runaway segment', async () => {
    const { eng } = offlineEngine();
    await eng.mark('start');
    const out: AsrEvent[] = [];
    for (let i = 0; i < 31; i++) out.push(...(await eng.feed(pcm(16000, 1))));
    expect(out.map((m) => m.type)).toEqual(['result']);
    expect((await eng.mark('end')).map((m) => m.type)).toEqual(['result']);
  });

  it('feeds while a transcription is running, and keeps each frame in its own segment', async () => {
    const { eng } = offlineEngine();
    const seen: Float32Array[] = [];
    let release!: () => void;
    eng.backend = {
      transcribe: async (samples) => {
        seen.push(samples);
        if (seen.length === 1) await new Promise<void>((r) => { release = r; });
        return new AsrResult(`seg${seen.length}`);
      },
    };
    await eng.mark('start');
    void eng.feed(pcm(1600, 100));
    const first = eng.mark('end');                           // its transcription is now running
    await new Promise((r) => setImmediate(r));
    await eng.feed(pcm(1600, 200));                          // accepted at once: into the ring
    await eng.mark('start');
    await eng.feed(pcm(1600, 300));
    const second = eng.mark('end');
    expect(seen).toHaveLength(1);                            // the second waits behind the first
    release();
    expect((await first)[0].text).toBe('seg1');
    expect((await second)[0].text).toBe('seg2');
    expect(Array.from(new Set(seen[0])).map((v) => Math.round(v * 32768))).toEqual([100]);
    expect(Array.from(new Set(seen[1])).map((v) => Math.round(v * 32768))).toEqual([200, 300]);
  });
});

describe.skipIf(!process.env.SOKUJI_RUN_ASR_MODEL || !process.env.SOKUJI_NATIVE_DIR)('a real engine', () => {
  it('transcribes the test clip', async () => {
    const { loadNative, useNative } = await import('../native');
    const { snapshotPath } = await import('../models/hfCache');
    const fs = await import('node:fs');
    process.env.HF_HOME = process.env.SOKUJI_REAL_HF_HOME ?? `${process.env.HOME}/.cache/huggingface`;
    useNative(loadNative(process.env.SOKUJI_NATIVE_DIR!), process.env.SOKUJI_NATIVE_DIR!);
    const dir = snapshotPath('csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')!;
    const wav = fs.readFileSync(`${dir}/test_wavs/en.wav`);
    const bytes = new Uint8Array(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44);
    const eng = new AsrEngine();
    await eng.init(null, '', 16000);
    await eng.mark('start');
    const texts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) texts.push(...(await eng.feed(bytes.subarray(i, i + 8192))).map((m) => String(m.text)));
    texts.push(...(await eng.mark('end')).map((m) => String(m.text)));
    expect(texts.join(' ').toLowerCase()).toMatch(/gold|tribal/);
    await eng.close();
  });
});

describe('init', () => {
  const stubResolver = (load: () => [unknown, Plan, string | null, number | null], rtf: number | null = null) => {
    engineSeams.resolve = async () => [load()[1]];
    engineSeams.loadMeasured = async () => load();
    engineSeams.measureRtf = async () => rtf;
  };

  it('loads through the resolver and records the plan', async () => {
    const p = plan('ctranslate2', 'cpu', 'int8');
    const backend = { transcribe: async () => new AsrResult('resolved-text') };
    stubResolver(() => [backend, p, null, null]);
    const eng = new AsrEngine();
    expect(Number.isInteger(await eng.init('whisper-base', 'en', 24000, 'auto'))).toBe(true);
    expect(eng.resolved).toEqual({ backend: 'ctranslate2', device: 'cpu', computeType: 'int8' });
    expect((await eng.backend!.transcribe(new Float32Array(4), 'en')).text).toBe('resolved-text');
  });

  it('measures and keeps the rtf; leaves it out when the benchmark failed', async () => {
    const p = plan('ctranslate2', 'gpu-vulkan', 'float16');
    stubResolver(() => [{ transcribe: async () => new AsrResult('') }, { ...p, device: 'vulkan' }, null, null], 0.25);
    const eng = new AsrEngine();
    await eng.init('whisper-base', 'en');
    expect([eng.resolved!.device, eng.resolved!.rtf]).toEqual(['vulkan', 0.25]);
    engineSeams.measureRtf = async () => null;
    await eng.init('whisper-base');
    expect('rtf' in eng.resolved!).toBe(false);
  });

  it('frees the previous model on re-init and on close', async () => {
    const p = plan('ctranslate2', 'cpu', 'int8');
    const backends: Array<{ unloaded: boolean }> = [];
    engineSeams.resolve = async () => [p];
    engineSeams.loadMeasured = async () => {
      const b = { unloaded: false, transcribe: async () => new AsrResult('x'), unload: async () => { b.unloaded = true; } };
      backends.push(b);
      return [b, p, null, null];
    };
    engineSeams.measureRtf = async () => null;
    const eng = new AsrEngine();
    await eng.init('whisper-base');
    expect(backends.map((b) => b.unloaded)).toEqual([false]);
    await eng.init('whisper-base');
    expect(backends.map((b) => b.unloaded)).toEqual([true, false]);
    await eng.close();
    expect(backends.map((b) => b.unloaded)).toEqual([true, true]);
    expect(eng.backend).toBeNull();
  });

  it('keeps the measured memory and the fallback reason', async () => {
    stubResolver(() => [{ transcribe: async () => new AsrResult('') }, plan('ctranslate2', 'cpu', 'int8'), 'vulkan skipped; using CPU', 4_200_000_000]);
    const eng = new AsrEngine();
    await eng.init('sense-voice', 'en', 16000, 'auto');
    expect(eng.resolved!.memoryBytes).toBe(4_200_000_000);
    expect(String(eng.resolved!.fallbackReason)).toContain('using CPU');
  });

  it('streaming init records the device and memory', async () => {
    const eng = new AsrEngine();
    eng.resolveStreamingBackend = async () => [{ STREAMING: true, openStream: () => ({}), unload: () => {} }, plan('voxtral_realtime', 'vulkan', 'bfloat16'), null, 8_000_000_000];
    await eng.initStreaming('voxtral-mini-4b-realtime', 'en', 24000, 'auto');
    expect([eng.resolved!.device, eng.resolved!.memoryBytes]).toEqual(['vulkan', 8_000_000_000]);
  });

  it('the streaming pre-check hands the pin to the resolver', async () => {
    const seen: Array<[string, string | null]> = [];
    engineSeams.resolve = async (id, _o, pin) => { seen.push([id, pin]); return [plan('native_asr_stream', 'cpu', 'q8_0')]; };
    const eng = new AsrEngine();
    expect(await eng.resolvesToStreaming('voxtral-mini-4b-realtime', 'auto', 'q8_0')).toBe(true);
    expect(await eng.resolvesToStreaming('voxtral-mini-4b-realtime', 'auto')).toBe(true);
    expect(seen).toEqual([['voxtral-mini-4b-realtime', 'q8_0'], ['voxtral-mini-4b-realtime', null]]);
    engineSeams.resolve = async () => [plan('native_asr', 'cpu', 'q8_0')];
    expect(await eng.resolvesToStreaming('sense-voice', 'auto')).toBe(false);
    engineSeams.resolve = async () => { throw new Error('no plan'); };
    expect(await eng.resolvesToStreaming('x', 'auto')).toBe(false);
  });
});

/** A scripted stream: drain answers queued deltas once, end the joined text. */
class FakeStream implements AsrStreamLike {
  fed = 0;
  pendingDeltas = ['he', 'llo '];
  ended = false;
  abortedCalled = false;
  feed(samples: Float32Array) { this.fed += samples.length; }
  drain() { const out = this.pendingDeltas; this.pendingDeltas = []; return out; }
  end() { this.ended = true; return 'hello world'; }
  abort() { this.abortedCalled = true; }
}

/** A stream with the given end() and nothing to drain. */
const quietStream = (end: () => string = () => '') => ({ feed() {}, drain: () => [] as string[], end, abort() {} });

/** An engine already in a streaming mode, its backend opening `make()` and counting opens. */
function streamingEngine(mode: 'always_stream' | 'per_utterance', make: () => AsrStreamLike, opts: Partial<AsrEngine> = {}) {
  const eng = new AsrEngine();
  const opened = { n: 0 };
  eng.mode = mode;
  eng.srcRate = 16000;
  eng.backend = { STREAMING: true, transcribe: async () => new AsrResult(''), openStream: () => { opened.n++; return make(); } };
  eng.audioQ = new AudioQueue();
  eng.streaming = true;
  eng.sampleCursor = 0;
  eng.uttStartSample = 0;
  Object.assign(eng, opts);
  return { eng, opened };
}

describe('streaming', () => {
  it('close aborts an open stream and stops the loop', async () => {
    const eng = new AsrEngine();
    let aborted = false;
    eng.stream = { ...quietStream(), abort: () => { aborted = true; } };
    eng.audioQ = new AudioQueue();
    eng.backend = { transcribe: async () => new AsrResult(''), unload: () => {} };
    await eng.close();
    expect(aborted).toBe(true);
    expect(eng.stream).toBeNull();
    expect(eng.audioQ.getNowait()).toBeNull();                   // the loop's stop sentinel
  });

  it('feedStream enqueues and answers nothing to send', () => {
    const eng = new AsrEngine();
    eng.audioQ = new AudioQueue();
    expect(eng.feedStream(new Uint8Array([0, 0, 1, 0]))).toEqual([]);
    expect(eng.audioQ.size()).toBe(1);
  });

  it('per utterance: partials, then one result at the end', async () => {
    const fs = new FakeStream();
    const eng = new AsrEngine();
    eng.resolveStreamingBackend = async () => [{ STREAMING: true, transcribe: async () => new AsrResult(''), openStream: () => fs, unload: () => {} }, plan('voxtral_realtime', 'vulkan', 'bfloat16'), null, null];
    await eng.initStreaming('voxtral-mini-4b-realtime', 'en', 24000, 'vulkan');
    eng.mode = 'per_utterance';
    await eng.mark('start');
    eng.feedStream(pcm(16000));
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    const types = sent.map((m) => m.type);
    expect(types).toContain('partial');
    expect(types.at(-1)).toBe('result');
    expect(sent.at(-1)!.text).toBe('hello world');
    expect(fs.ended).toBe(true);
    expect(types).not.toContain('speech_start');
  });

  it('per utterance: cancel aborts without a result', async () => {
    const fs = new FakeStream();
    const eng = new AsrEngine();
    eng.resolveStreamingBackend = async () => [{ STREAMING: true, transcribe: async () => new AsrResult(''), openStream: () => fs, unload: () => {} }, plan('voxtral_realtime', 'vulkan', 'bfloat16'), null, null];
    await eng.initStreaming('voxtral-mini-4b-realtime', 'en', 24000, 'vulkan');
    eng.mode = 'per_utterance';
    await eng.mark('start');
    eng.feedStream(pcm(1600));
    await eng.mark('cancel');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(results(sent)).toEqual([]);
    expect(fs.abortedCalled).toBe(true);
    expect(eng.stream).toBeNull();
  });

  it('always-stream: cancel does not cut', async () => {
    const { eng, opened } = streamingEngine('always_stream', () => quietStream(() => 'should not be called'), { pending: 'some words', inSpeech: true, speechSamples: 8000 });
    eng.stream = quietStream(() => 'should not be called');
    eng.feedStream(pcm(1600));
    await eng.mark('cancel');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(results(sent)).toEqual([]);
    expect(opened.n).toBe(0);
    expect([eng.inSpeech, eng.speechSamples]).toEqual([false, 0]);
  });

  it('always-stream: an end cuts with the complete held tail, and reopens', async () => {
    const tail = () => 'country can do for you. do for your country.';
    const { eng, opened } = streamingEngine('always_stream', () => quietStream(tail), { pending: 'country can do for you.', inSpeech: true, speechSamples: 8000 });
    eng.stream = quietStream(tail);
    eng.feedStream(pcm(1600));
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(String(results(sent).at(-1)!.text)).toContain('do for your country.');
    expect(opened.n).toBe(1);
    expect(eng.pending).toBe('');
  });

  it('always-stream: an end on a stream that heard no speech does not cut', async () => {
    const { eng, opened } = streamingEngine('always_stream', () => quietStream(), { pending: '', inSpeech: false, speechSamples: 0 });
    eng.stream = quietStream();
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(results(sent)).toEqual([]);
    expect(opened.n).toBe(0);
  });

  it('always-stream: an end flushes text the model still held, with nothing pending', async () => {
    const { eng, opened } = streamingEngine('always_stream', () => quietStream(() => 'ok'), { pending: '', inSpeech: true, speechSamples: 8000 });
    eng.stream = quietStream(() => 'ok');
    eng.feedStream(pcm(1600));
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(results(sent).at(-1)!.text).toBe('ok');
    expect(opened.n).toBe(1);
  });

  it('always-stream: the 20 s run-on cap forces a cut', async () => {
    const { eng, opened } = streamingEngine('always_stream', () => quietStream(() => 'a very long run on utterance'), { pending: 'a very long run on', inSpeech: true, speechSamples: 20 * 16000 });
    eng.stream = quietStream(() => 'a very long run on utterance');
    const { sent, send } = collect();
    await eng.driveAlways(send, pcm(1600));
    expect(opened.n).toBe(1);
    expect(results(sent).length).toBeGreaterThan(0);
  });

  it('every stream (re)open forwards the source language', () => {
    const eng = new AsrEngine();
    const seen: Array<string | null> = [];
    eng.backend = { transcribe: async () => new AsrResult(''), openStream: (language) => { seen.push(language); return quietStream(); } };
    eng.language = 'ja';
    eng.openStream();
    eng.language = null;
    eng.openStream();
    expect(seen).toEqual(['ja', null]);
  });

  it('always-stream: a stream that died salvages its pending text and reopens', async () => {
    const dead = () => ({ ...quietStream(), aborted: true });
    const { eng, opened } = streamingEngine('always_stream', dead, { pending: 'partial words', inSpeech: true, speechSamples: 0 });
    eng.stream = dead();
    const { sent, send } = collect();
    await eng.driveAlways(send, pcm(1600));
    expect(results(sent).at(-1)!.text).toBe('partial words');
    expect(opened.n).toBe(1);
    expect([eng.pending, eng.speechSamples]).toEqual(['', 0]);
  });

  it('always-stream: an end whose flush fails still reopens', async () => {
    const failing = () => quietStream(() => { throw new Error('generate crashed during flush'); });
    const { eng, opened } = streamingEngine('always_stream', failing, { pending: 'some words', inSpeech: true, speechSamples: 8000 });
    eng.stream = failing();
    eng.feedStream(pcm(1600));
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(opened.n).toBe(1);
    expect(results(sent)).toEqual([]);
    expect(eng.pending).toBe('');
    // The client is told why the utterance has no text (a hung finalize is cut by its deadline with this kind of error).
    expect(sent.filter((m) => m.type === 'error').map((m) => m.message)).toEqual(['generate crashed during flush']);
  });

  it('backpressure degrades to per-utterance and keeps the utterance going', async () => {
    const { eng } = streamingEngine('always_stream', () => quietStream(), { pending: 'held text', inSpeech: true, speechSamples: 0 });
    eng.stream = quietStream();
    const buf = pcm(16000);                                      // 1 s per buffer
    for (let i = 0; i < 4; i++) eng.audioQ!.put(buf);           // > 3 s backed up
    const { sent, send } = collect();
    await eng.driveAlways(send, buf);
    expect(eng.mode).toBe('per_utterance');
    expect(sent.some((m) => m.type === 'result' && m.text === 'held text')).toBe(true);
    expect(eng.stream).not.toBeNull();                           // the gated continuation
  });

  it('a degrade resets the per-utterance backstop counter', async () => {
    const { eng } = streamingEngine('always_stream', () => quietStream(() => 'should not fire'), { pending: '', inSpeech: true, speechSamples: 0, uttFed: 19 * 16000 });
    eng.stream = quietStream(() => 'should not fire');
    const buf = pcm(16000);
    for (let i = 0; i < 4; i++) eng.audioQ!.put(buf);
    const { sent, send } = collect();
    await eng.driveAlways(send, buf);
    expect([eng.mode, eng.uttFed]).toEqual(['per_utterance', 0]);
    expect(eng.stream).not.toBeNull();
    while (!eng.audioQ!.empty()) eng.audioQ!.getNowait();
    eng.audioQ!.put(buf);
    await eng.driveOnce(send);
    expect(results(sent)).toEqual([]);
  });

  it('silence never degrades always-stream', async () => {
    const { eng } = streamingEngine('always_stream', () => quietStream(), { pending: '', inSpeech: false, speechSamples: 0 });
    eng.stream = quietStream();
    const { send } = collect();
    for (let i = 0; i < 8; i++) await eng.driveAlways(send, pcm(16000));
    expect(eng.mode).toBe('always_stream');
    expect(eng.stream).not.toBeNull();
  });

  const recording = (feeds: Float32Array[], end = 'x') => () => ({ feed: (s: Float32Array) => { feeds.push(s); }, drain: () => [] as string[], end: () => end, abort() {} });

  it('per utterance: a start replays the pre-roll first', async () => {
    const feeds: Float32Array[] = [];
    const { eng } = streamingEngine('per_utterance', recording(feeds), { inSpeech: false });
    eng.feedStream(pcm(8000, 1000));
    eng.feedStream(pcm(8000, 2000));
    await eng.mark('start');
    eng.feedStream(pcm(8000, 3000));
    eng.feedStream(pcm(8000, 4000));
    await eng.driveOnce(collect().send);
    expect(feeds).toHaveLength(3);
    expect(feeds[0].length).toBe(16000);
    expect(feeds[0][0]).toBeGreaterThan(0.02);
    expect(feeds[0][15999]).toBeGreaterThan(0.05);
    expect(Math.abs(feeds[1][0] - 3000 / 32768)).toBeLessThan(1e-4);
    expect(Math.abs(feeds[2][0] - 4000 / 32768)).toBeLessThan(1e-4);
  });

  it('the pre-roll is capped', async () => {
    const feeds: Float32Array[] = [];
    const { eng } = streamingEngine('per_utterance', recording(feeds), { inSpeech: false });
    for (let i = 0; i < 10; i++) eng.feedStream(pcm(8000));
    await eng.mark('start');
    await eng.driveOnce(collect().send);
    expect(feeds[0].length).toBeGreaterThanOrEqual(11200);
    expect(feeds[0].length).toBeLessThan(11200 + 8000);
  });

  it('the pre-roll is cleared after a finalize', async () => {
    const { eng } = streamingEngine('per_utterance', recording([], 'first'), { inSpeech: false });
    eng.feedStream(pcm(8000, 1000));
    await eng.mark('start');
    eng.feedStream(pcm(8000, 2000));
    await eng.mark('end');
    await eng.driveOnce(collect().send);
    expect(eng.preroll).toEqual([]);
  });

  it('a faster-than-realtime utterance returns to always-stream', async () => {
    const { eng } = streamingEngine('per_utterance', () => quietStream(() => 'quick'), { inSpeech: false });
    await eng.mark('start');
    eng.feedStream(pcm(16000));
    eng.feedStream(pcm(16000));
    await eng.mark('end');
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(sent.some((m) => m.type === 'result' && m.text === 'quick')).toBe(true);
    expect(eng.mode).toBe('always_stream');
    expect(eng.stream).not.toBeNull();
  });

  it('the 20 s per-utterance backstop cuts and reopens in place', async () => {
    const { eng } = streamingEngine('per_utterance', () => quietStream(() => 'backstop cut'), { inSpeech: false });
    await eng.mark('start');
    for (let i = 0; i < 21; i++) eng.feedStream(pcm(16000));
    const { sent, send } = collect();
    await eng.driveOnce(send);
    expect(results(sent).map((m) => m.text)).toEqual(['backstop cut']);
    expect(eng.stream).not.toBeNull();
    expect(eng.uttFed).toBe(16000);
    expect(eng.uttStartSample).toBe(19 * 16000);
  });

  it('cuts at the marks between the frames they arrived between', async () => {
    const streams: Float32Array[][] = [];
    const make = () => {
      const feeds: Float32Array[] = [];
      streams.push(feeds);
      return { feed: (s: Float32Array) => { feeds.push(s); }, drain: () => [] as string[], end: () => 'u', abort() {} };
    };
    const { eng } = streamingEngine('per_utterance', make, { inSpeech: false });
    const loop = eng.runStream(collect().send);
    eng.feedStream(pcm(1600, 10));                              // before: the pre-roll
    await eng.mark('start');
    eng.feedStream(pcm(1600, 20));
    eng.feedStream(pcm(1600, 30));
    await eng.mark('end');
    eng.feedStream(pcm(1600, 40));                              // after: the next stream's, not this utterance's
    eng.feedStream(null);                                       // the end of the input
    await loop;
    const values = streams.map((feeds) => feeds.map((f) => Array.from(new Set(f)).map((v) => Math.round(v * 32768))));
    expect(values[0]).toEqual([[10], [20], [30]]);
    expect(values[1]).toEqual([[40]]);                          // the fast utterance reopened always-stream
  });

  it('a stream the library refused is replaced, and the session goes on', async () => {
    let n = 0;
    const make = (): AsrStreamLike => {
      n++;
      const dead = n === 1;
      return { get aborted() { return dead; }, feed() {}, drain: () => [], end: () => '', abort() {} };
    };
    const { eng, opened } = streamingEngine('always_stream', make, { inSpeech: true });
    eng.stream = make();
    opened.n = 0;
    const { send } = collect();
    await eng.driveAlways(send, pcm(1600));
    expect(opened.n).toBe(1);
    expect(eng.stream.aborted).toBe(false);
  });
});

describe('close() racing a newer session', () => {
  it('a close still unloading the old model does not clear what the new session has received', async () => {
    const eng = new AsrEngine();
    eng.srcRate = 16000;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    eng.backend = { transcribe: async () => new AsrResult('x'), unload: async () => { await gate; } };
    const closing = eng.close();                       // the old connection's teardown, stuck unloading its model
    (eng as unknown as { gen: number }).gen += 1;      // a newer init has taken over and loaded its own model
    const fresh = new EchoBackend();
    eng.backend = fresh;
    await eng.feed(pcm(1600, 1));                      // and its client is already sending audio
    release();
    await closing;
    expect(eng.backend).toBe(fresh);
    expect(eng.ringLen).toBe(1600);
  });
});
