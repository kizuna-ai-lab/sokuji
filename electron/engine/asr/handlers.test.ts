// @vitest-environment node
/**
 * The ASR handlers (ported from sidecar/tests/test_asr_engine.py): asr_init's two paths and its ready reply, vad_mark,
 * asr_flush, freeing the model when the connection closes; then the engine on a real connection — PCM frames and marks
 * interleaved on one socket, with a transcription that takes 200 ms.
 */
import '../test/env';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBackend } from '../backends';
import { Conn } from '../conn';
import { setNativeForTests } from '../native';
import type { Plan } from '../planner';
import { attach, createState, handleMessage, type EngineState } from '../server';
import { makeFakeNative, type FakeNative } from '../test/fakeNative';
import { cacheArtifact, freshHfHome } from '../test/hfFixture';
import type { NativeAsrBackend } from './backend';
import { AsrEngine, engineSeams, restoreEngineSeams, type AsrEvent } from './engine';
import { register } from './handlers';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<string | Uint8Array> = [];
  send(data: string | Uint8Array, cb?: (err?: Error) => void) {
    this.sent.push(data);
    cb?.();
  }
  message(data: string | Uint8Array) {
    this.emit('message', Buffer.from(data), typeof data !== 'string');
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  json(): Array<Record<string, any>> {
    return this.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(String(s)));
  }
}

const pcm = (n: number, value = 0) => new Uint8Array(new Int16Array(n).fill(value).buffer);
const msg = (m: Record<string, unknown>) => JSON.stringify(m);

/** Python's FakeAsr: init answers 33 ms, an end mark and a flush each answer one result. */
class FakeAsr {
  marks: string[] = [];
  resolved: Record<string, unknown> | null = null;
  closed = 0;
  async init() { return 33; }
  feed() { return [] as AsrEvent[]; }
  async mark(event: string) {
    this.marks.push(event);
    return event === 'end' ? [{ type: 'result', text: 'hello', startSample: 0, durationMs: 1000, recognitionTimeMs: 5 }] : [];
  }
  async flush() { return [{ type: 'result', text: 'tail', startSample: 0, durationMs: 100, recognitionTimeMs: 1 }]; }
  close() { this.closed++; }
}

const setup = (engine: unknown = new FakeAsr()) => {
  const state = createState();
  state.asr_engine = engine;
  register(state);
  const socket = new FakeSocket();
  const conn = new Conn(socket);
  const call = (m: Record<string, unknown>) => handleMessage(state, msg(m), null, conn);
  return { state, socket, conn, call, engine: engine as FakeAsr };
};

afterEach(() => {
  restoreEngineSeams();
  setNativeForTests(null);
});

describe('asr_init', () => {
  it('routes the binary frames and answers ready', async () => {
    const { conn, call } = setup();
    expect((await call({ type: 'asr_init', id: 1, language: 'en' }))[0]).toEqual({ type: 'ready', id: 1, loadTimeMs: 33 });
    expect(typeof conn.ctx.get('on_binary')).toBe('function');
  });

  it('ignores the stale vad* fields', async () => {
    const { call } = setup();
    const [reply] = await call({ type: 'asr_init', id: 1, model: 'sense-voice', vadThreshold: 0.3, vadMinSilenceDuration: 1.4, vadMinSpeechDuration: 0.4 });
    expect(reply?.type).toBe('ready');
  });

  it('carries the resolved plan when the engine has one, and only then', async () => {
    const eng = new FakeAsr();
    eng.init = async () => { eng.resolved = { backend: 'ctranslate2', device: 'vulkan', computeType: 'float16' }; return 33; };
    const [reply] = await setup(eng).call({ type: 'asr_init', id: 1 });
    expect(reply).toEqual({ type: 'ready', id: 1, loadTimeMs: 33, backend: 'ctranslate2', device: 'vulkan', computeType: 'float16' });
    expect((await setup().call({ type: 'asr_init', id: 2 }))[0]).toEqual({ type: 'ready', id: 2, loadTimeMs: 33 });
  });

  it('a streaming model takes the streaming path: one load, the loop started, the pin handed to the pre-check', async () => {
    const started: Record<string, unknown> = {};
    const eng = {
      resolved: { backend: 'voxtral_realtime', device: 'vulkan', computeType: 'bfloat16' },
      resolvesToStreaming: async (_m: string | null, _d: string | null, pin?: string | null) => { started.pin = pin; return true; },
      initStreaming: async (model: string | null, _l: string, _r: number, device: string) => { started.init = { model, device }; },
      init: async () => { started.offline = true; return 0; },
      feed: () => [],
      feedStream: (b: Uint8Array | null) => { started.fed = b; return []; },
      runStream: async () => { started.task = true; },
    };
    const { conn, call } = setup(eng);
    const [reply] = await call({ type: 'asr_init', id: 1, model: 'voxtral-mini-4b-realtime', language: 'en', device: 'vulkan', variant: 'q8_0' });
    expect([reply?.type, reply?.id]).toEqual(['ready', 1]);
    await conn.ctx.get('stream_task');
    expect(started).toMatchObject({ task: true, pin: 'q8_0', init: { model: 'voxtral-mini-4b-realtime', device: 'vulkan' } });
    expect('offline' in started).toBe(false);
    (conn.ctx.get('on_binary') as (b: Uint8Array) => unknown)(new Uint8Array(2));
    expect(started.fed).toBeInstanceOf(Uint8Array);                    // frames go to feedStream
  });

  it('an offline model loads once, with no streaming loop', async () => {
    let inits = 0;
    const fed: Uint8Array[] = [];
    const eng = { resolvesToStreaming: async () => false, init: async () => { inits++; return 42; }, feed: (b: Uint8Array) => { fed.push(b); return []; } };
    const { conn, call } = setup(eng);
    expect((await call({ type: 'asr_init', id: 2, model: 'sense-voice', language: 'ja', device: 'auto' }))[0]).toEqual({ type: 'ready', id: 2, loadTimeMs: 42 });
    expect(inits).toBe(1);
    expect(conn.ctx.get('stream_task')).toBeUndefined();
    (conn.ctx.get('on_binary') as (b: Uint8Array) => unknown)(new Uint8Array(2));
    expect(fed).toHaveLength(1);                                       // frames go to feed
  });
});

describe('vad_mark and asr_flush', () => {
  it('vad_mark reaches the engine, answers nothing, and pushes an end mark\'s result', async () => {
    const { socket, call, engine } = setup();
    await call({ type: 'asr_init', id: 1 });
    expect((await call({ type: 'vad_mark', event: 'start' }))[0]).toBeNull();
    expect((await call({ type: 'vad_mark', event: 'end' }))[0]).toBeNull();
    expect(engine.marks).toEqual(['start', 'end']);
    await vi.waitFor(() => expect(socket.json().some((m) => m.text === 'hello')).toBe(true));
  });

  it('asr_flush pushes what is left, then answers ok', async () => {
    const { socket, call } = setup();
    await call({ type: 'asr_init', id: 1 });
    expect((await call({ type: 'asr_flush', id: 2 }))[0]).toEqual({ type: 'ok', id: 2 });
    expect(socket.json().some((m) => m.text === 'tail')).toBe(true);
  });
});

describe('closing the connection', () => {
  it('frees the model of an offline session', async () => {
    const state = createState();
    const eng = new FakeAsr();
    state.asr_engine = eng;
    register(state);
    const socket = new FakeSocket();
    const h = attach(state, socket, () => {});
    socket.message(msg({ type: 'asr_init', id: 1, model: 'm' }));
    await h.settled();
    socket.close();
    await h.done;
    expect(eng.closed).toBe(1);
  });

  it('frees the model of a streaming session and ends its loop', async () => {
    const state = createState();
    let closed = 0;
    let stopLoop!: () => void;
    let loopDone = false;
    state.asr_engine = {
      resolvesToStreaming: async () => true,
      initStreaming: async () => 5,
      init: async () => 0,
      feed: () => [],
      feedStream: () => [],
      runStream: async () => { await new Promise<void>((r) => { stopLoop = r; }); loopDone = true; },
      close: () => { closed++; stopLoop(); },
    };
    register(state);
    const socket = new FakeSocket();
    const h = attach(state, socket, () => {});
    socket.message(msg({ type: 'asr_init', id: 1, model: 'voxtral-mini-4b-realtime', device: 'vulkan' }));
    await h.settled();
    socket.close();
    await h.done;
    expect([closed, loopDone]).toEqual([1, true]);
  });
});

describe('a real engine on one connection', () => {
  const REF = 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf';
  let fake: FakeNative;
  let cleanupHf: () => void = () => {};

  /** A real AsrEngine whose resolver loads native_asr from the fake addon, its run taking `runDelayMs`. */
  const realEngine = (runDelayMs: number) => {
    cleanupHf = freshHfHome();
    cacheArtifact(REF);
    fake = makeFakeNative({ devices: [{ kind: 'cpu' }], asr: { runDelayMs, text: 'heard' } });
    setNativeForTests(fake);
    const plan = { backend: 'native_asr', tier: 'cpu', device: 'cpu', computeType: 'q8_0', artifact: REF, rank: 1 } as unknown as Plan;
    engineSeams.resolve = async () => [plan];
    engineSeams.loadMeasured = async () => {
      const b = makeBackend('native_asr') as NativeAsrBackend;
      await b.load(REF, 'cpu', 'q8_0');
      return [b, plan, null, null];
    };
    engineSeams.measureRtf = async () => null;
    const state: EngineState = createState();
    state.asr_engine = new AsrEngine();
    register(state);
    const socket = new FakeSocket();
    return { state, socket, h: attach(state, socket, () => {}) };
  };
  afterEach(() => cleanupHf());

  /** The distinct int16 values of a run's audio, in order of first appearance. */
  const valuesOf = (pcmF32: Float32Array) => [...new Set(Array.from(pcmF32, (v) => Math.round(v * 32768)))];

  it('feeds while a transcription is running, and handles every frame in order', async () => {
    const { socket, h } = realEngine(200);
    socket.message(msg({ type: 'asr_init', id: 1, sampleRate: 16000 }));
    await h.settled();
    const t0 = Date.now();
    socket.message(msg({ type: 'vad_mark', event: 'start' }));
    socket.message(pcm(1600, 100));
    socket.message(msg({ type: 'vad_mark', event: 'end' }));       // the first transcription starts: 200 ms
    socket.message(pcm(1600, 200));                                 // sent meanwhile
    socket.message(pcm(1600, 250));
    socket.message(msg({ type: 'vad_mark', event: 'start' }));
    socket.message(pcm(1600, 300));
    socket.message(msg({ type: 'vad_mark', event: 'end' }));
    await h.settled();
    expect(Date.now() - t0).toBeLessThan(150);                      // nothing waited for the transcription
    const model = fake.asrModels[0];
    expect(model.runs).toHaveLength(1);                             // the second is queued behind the first
    await vi.waitFor(() => expect(socket.json().filter((m) => m.type === 'result')).toHaveLength(2), { timeout: 2000 });
    expect(model.runs.map((r) => valuesOf(r.pcm))).toEqual([[100], [200, 250, 300]]);
    const results = socket.json().filter((m) => m.type === 'result');
    expect(results.map((r) => r.startSample)).toEqual([0, 1600]);  // in cut order
    socket.close();
    await h.done;
    expect(model.unloaded).toBe(true);
  });

  it('cuts at the vad_mark between the frames it arrived between', async () => {
    const { socket, h } = realEngine(0);
    socket.message(msg({ type: 'asr_init', id: 1, sampleRate: 16000 }));
    socket.message(pcm(1600, 1));                                   // before the start: the pre-roll
    socket.message(msg({ type: 'vad_mark', event: 'start' }));
    socket.message(pcm(1600, 2));
    socket.message(pcm(1600, 3));
    socket.message(msg({ type: 'vad_mark', event: 'end' }));
    socket.message(pcm(1600, 4));                                   // after the end: the next segment's pre-roll
    socket.message(msg({ type: 'vad_mark', event: 'start' }));
    socket.message(pcm(1600, 5));
    socket.message(msg({ type: 'vad_mark', event: 'end' }));
    socket.message(msg({ type: 'asr_flush', id: 2 }));
    await h.settled();
    expect(fake.asrModels[0].runs.map((r) => valuesOf(r.pcm))).toEqual([[1, 2, 3], [4, 5]]);
    const out = socket.json();
    expect(out.filter((m) => m.type === 'result').map((m) => m.text)).toEqual(['heard', 'heard']);
    expect(out.at(-1)).toEqual({ type: 'ok', id: 2 });               // flush answers after both results
    socket.close();
    await h.done;
  });
});
