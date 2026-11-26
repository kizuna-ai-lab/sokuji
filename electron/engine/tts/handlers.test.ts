// @vitest-environment node
/**
 * The TTS handlers (ported from sidecar/tests/test_tts_engine.py): tts_init and its teardown (with the generation
 * check), set_voice, background generation (streaming and one-shot), tts_cancel, supersede, ownership across
 * connections, list_tts_voices; then real connections — the owner disconnecting mid-stream, a cancelled one-shot.
 */
import '../test/env';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conn } from '../conn';
import type { Plan } from '../planner';
import { attach, createState, handleMessage, type EngineState } from '../server';
import type { OnChunk } from './backend';
import { dspSeams, restoreDspSeams } from './dsp';
import { TtsEngine, engineSeams, restoreEngineSeams, type TtsBackendLike } from './engine';
import { activeOf, register, ttsTeardown } from './handlers';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<string | Uint8Array> = [];
  send(data: string | Uint8Array, cb?: (err?: Error) => void) {
    this.sent.push(data);
    cb?.();
  }
  message(data: string) {
    this.emit('message', Buffer.from(data), false);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  json(): Array<Record<string, any>> {
    return this.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(String(s)));
  }
  types(): string[] {
    return this.json().map((m) => m.type);
  }
}

const plan = (backend: string, ttsFamily = '') => ({ backend, tier: 'cpu', device: 'cpu', computeType: 'fp32', artifact: 'repo', rank: 1, config: { ttsFamily } } as unknown as Plan);

/** A streaming backend whose chunks wait for release() after the first, honouring the abort between chunks. */
function streamBackend() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const b = {
    STREAMING: true, CLONES: true, voice: null as unknown, builtin: null as unknown, cancels: 0, signals: [] as Array<AbortSignal | undefined>, gated: false,
    release,
    setVoice(a: Float32Array, sr: number, refText?: string) { b.voice = [a.length, sr, refText]; },
    setBuiltinVoice(n: string) { b.builtin = n; },
    cancel() { b.cancels++; },
    generate: async (): Promise<[Float32Array, number, number]> => [new Float32Array(24000).fill(1), 24000, 30],
    generateStream: async (_t: string, _s: number, signal: AbortSignal | undefined, onChunk: OnChunk) => {
      b.signals.push(signal);
      for (let i = 0; i < 3; i++) {
        if (signal?.aborted) return;
        onChunk(new Float32Array(8000).fill(1), 24000, 1);
        if (i === 0 && b.gated) await gate;
      }
    },
    unload() {},
  };
  return b;
}

/** A one-shot backend whose synth waits for release(), rejecting once aborted as the addon does. */
function oneShotBackend() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const b = {
    STREAMING: false, CLONES: false, signals: [] as Array<AbortSignal | undefined>, gated: false, release, unloads: 0,
    generate: async (_t: string, _s?: number, signal?: AbortSignal): Promise<[Float32Array, number, number]> => {
      b.signals.push(signal);
      if (b.gated) await gate;
      if (signal?.aborted) throw new Error('sk_tts_synth: cancelled (status -5)');
      return [new Float32Array(16000).fill(1), 16000, 50];
    },
    unload() { b.unloads++; },
  };
  return b;
}

const stub = (backends: TtsBackendLike[], p = plan('fake')) => {
  engineSeams.resolveTts = async () => [p];
  engineSeams.loadMeasured = async () => [backends.shift()!, p, null, null];
  engineSeams.measureRtfTts = async () => 0.1;
};
const stateWith = (engine: unknown = new TtsEngine()): EngineState => {
  const state = createState();
  state.tts_engine = engine;
  register(state);
  return state;
};
const connOf = () => {
  const socket = new FakeSocket();
  return { socket, conn: new Conn(socket) };
};
const call = (state: EngineState, m: Record<string, unknown>, conn?: Conn, binary: Uint8Array | null = null) => handleMessage(state, JSON.stringify(m), binary, conn);
const settled = async (conn: Conn) => { await activeOf(conn)?.task; };

beforeEach(() => {
  dspSeams.resample = (pcm, _c, from, to) => new Float32Array(Math.round(pcm.length * to / from)).fill(pcm[0] ?? 0);
});
afterEach(() => {
  restoreEngineSeams();
  restoreDspSeams();
});

describe('tts_init', () => {
  it('answers ready at 24 kHz with the resolved plan and family', async () => {
    stub([streamBackend()], plan('fake', 'supertonic'));
    const { conn } = connOf();
    const [reply] = await call(stateWith(), { type: 'tts_init', id: 1, model: 'supertonic-3' }, conn);
    expect(reply).toMatchObject({ type: 'ready', id: 1, sampleRate: 24000, streaming: true, clones: true, family: 'supertonic', rtf: 0.1 });
  });

  it('hands the variant to the resolver as the pin', async () => {
    let pin: string | null | undefined;
    stub([oneShotBackend()]);
    engineSeams.resolveTts = async (_m, _o, p) => { pin = p; return [plan('fake')]; };
    await call(stateWith(), { type: 'tts_init', id: 1, model: 'piper-en-amy', variant: 'bf16' }, connOf().conn);
    expect(pin).toBe('bf16');
  });
});

describe('set_voice', () => {
  it('a name is a built-in voice', async () => {
    const b = streamBackend();
    stub([b]);
    const state = stateWith();
    const { conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    expect((await call(state, { type: 'set_voice', id: 2, voice: 'Ava' }, conn))[0]).toEqual({ type: 'ok', id: 2 });
    expect(b.builtin).toBe('Ava');
  });

  it('otherwise the binary frame is the clip, with its rate and reference text', async () => {
    const b = streamBackend();
    stub([b]);
    const state = stateWith();
    const { conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    const clip = new Uint8Array(new Float32Array(2400).fill(1).buffer);
    await call(state, { type: 'set_voice', id: 2, sampleRate: 24000, refText: 'hi' }, conn, clip);
    expect(b.voice).toEqual([2400, 24000, 'hi']);
  });

  it('a missing reference text is none; unknown fields fall to the clip path with an empty clip at 24 kHz', async () => {
    const calls: unknown[] = [];
    const eng = { setBuiltinVoice: (n: string) => calls.push(['builtin', n]), setVoice: (a: Float32Array, sr: number, t: string | null) => calls.push(['clip', a.length, sr, t]) };
    const state = stateWith(eng);
    await call(state, { type: 'set_voice', id: 3, sampleRate: 24000 }, undefined, new Uint8Array(new Float32Array(240).buffer));
    expect((await call(state, { type: 'set_voice', id: 9, sid: 5 }))[0]).toEqual({ type: 'ok', id: 9 });
    expect(calls).toEqual([['clip', 240, 24000, null], ['clip', 0, 24000, null]]);
  });
});

describe('tts_generate', () => {
  it('one-shot: the PCM and tts_generate_result are pushed, sampleRate 24000', async () => {
    stub([oneShotBackend()]);
    const state = stateWith();
    const { socket, conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    expect((await call(state, { type: 'tts_generate', id: 'g2', text: 'hello' }, conn))).toEqual([null, null]);
    await settled(conn);
    const result = socket.json().find((m) => m.type === 'tts_generate_result')!;
    expect(result).toMatchObject({ id: 'g2', sampleRate: 24000, generationTimeMs: 50, samples: 24000 });
    const pcm = socket.sent.find((s) => typeof s !== 'string') as Uint8Array;
    expect(pcm.length / 2).toBe(result.samples);
  });

  it('streaming: runs in the background and pushes chunks then done', async () => {
    stub([streamBackend()]);
    const state = stateWith();
    const { socket, conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    expect(await call(state, { type: 'tts_generate', id: 'g3', text: 'hello' }, conn)).toEqual([null, null]);
    expect(activeOf(conn)?.mid).toBe('g3');
    await settled(conn);
    expect(socket.types().filter((t) => t !== 'ready')).toEqual(['tts_chunk', 'tts_chunk', 'tts_chunk', 'tts_done']);
    expect(activeOf(conn)).toBeUndefined();                           // cleaned up when done
  });

  it('a new generation supersedes the running one', async () => {
    const b = streamBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const { socket, conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    await call(state, { type: 'tts_generate', id: 'prior', text: 'a' }, conn);
    const prior = activeOf(conn)!;
    await call(state, { type: 'tts_generate', id: 'new', text: 'b' }, conn);
    expect([prior.controller.signal.aborted, b.cancels, activeOf(conn)?.mid]).toEqual([true, 1, 'new']);
    b.release();
    await prior.task;
    await settled(conn);
    expect(activeOf(conn)).toBeUndefined();
    expect(socket.json().filter((m) => m.type === 'tts_done').map((m) => m.id)).toEqual(['prior', 'new']);
  });

  it('tts_cancel stops the running stream: fewer chunks, still tts_done', async () => {
    const b = streamBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const { socket, conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    await call(state, { type: 'tts_generate', id: 'g4', text: 'hello' }, conn);
    await vi.waitFor(() => expect(socket.types()).toContain('tts_chunk'));
    expect((await call(state, { type: 'tts_cancel', id: 'g4' }, conn))[0]).toEqual({ type: 'ok', id: 'g4' });
    expect([b.signals[0]?.aborted, b.cancels]).toEqual([true, 1]);
    b.release();
    await settled(conn);
    const types = socket.types();
    expect(types.filter((t) => t === 'tts_chunk').length).toBeLessThan(3);
    expect(types.filter((t) => t === 'tts_done')).toHaveLength(1);
  });

  it('one-shot generation can be cancelled: its signal aborts and no tts_generate_result is sent', async () => {
    const b = oneShotBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const { socket, conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    await call(state, { type: 'tts_generate', id: 'g5', text: 'hello' }, conn);
    await call(state, { type: 'tts_cancel', id: 'g5' }, conn);
    expect(b.signals[0]?.aborted).toBe(true);
    b.release();
    await settled(conn);
    expect(socket.types()).not.toContain('tts_generate_result');
    expect(socket.types()).not.toContain('error');
  });

  it('a stale or unknown id cancels nothing', async () => {
    const b = streamBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const { conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    await call(state, { type: 'tts_generate', id: 'current', text: 'x' }, conn);
    expect((await call(state, { type: 'tts_cancel', id: 'stale-id' }, conn))[0]).toEqual({ type: 'ok', id: 'stale-id' });
    expect([activeOf(conn)!.controller.signal.aborted, b.cancels]).toEqual([false, 0]);
    expect((await call(state, { type: 'tts_cancel', id: 'current' }))[0]).toEqual({ type: 'ok', id: 'current' });   // no connection
    expect(b.cancels).toBe(0);
    b.release();
    await settled(conn);
  });
});

describe('ownership', () => {
  it("another connection may neither generate nor cancel the owner's stream", async () => {
    const b = streamBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const owner = connOf();
    const other = connOf();
    await call(state, { type: 'tts_init', id: 1 }, owner.conn);
    const [intrude, bin] = await call(state, { type: 'tts_generate', id: 'intruder', text: 'hi' }, other.conn);
    expect(bin).toBeNull();
    expect(intrude).toMatchObject({ type: 'error', id: 'intruder' });
    expect(String(intrude?.message)).toContain('not_owner');
    expect(activeOf(other.conn)).toBeUndefined();
    await call(state, { type: 'tts_generate', id: 'owner-stream', text: 'hi' }, owner.conn);
    const [cancel] = await call(state, { type: 'tts_cancel', id: 'owner-stream' }, other.conn);
    expect(String(cancel?.message)).toContain('not_owner');
    expect(activeOf(owner.conn)!.controller.signal.aborted).toBe(false);
    b.release();
    await settled(owner.conn);
    expect(owner.socket.types().filter((t) => t === 'tts_chunk')).toHaveLength(3);
  });

  it('a tts_init from another connection loads afresh and takes ownership', async () => {
    const [b1, b2] = [oneShotBackend(), oneShotBackend()];
    stub([b1, b2]);
    const state = stateWith();
    const first = connOf();
    const second = connOf();
    await call(state, { type: 'tts_init', id: 1 }, first.conn);
    await call(state, { type: 'tts_init', id: 2 }, second.conn);
    expect((state.tts_engine as TtsEngine).backend).toBe(b2);
    expect(String((await call(state, { type: 'tts_generate', id: 'stale', text: 'hi' }, first.conn))[0]?.message)).toContain('not_owner');
    await call(state, { type: 'tts_generate', id: 'fresh', text: 'hi' }, second.conn);
    await settled(second.conn);
    expect(second.socket.types()).toContain('tts_generate_result');
  });
});

describe('teardown', () => {
  it('cancels the active generation before closing, and closes even when the cancel throws', async () => {
    const order: string[] = [];
    await ttsTeardown(stateWith({ cancelActive: () => order.push('cancelActive'), close: () => { order.push('close'); } }), null);
    expect(order).toEqual(['cancelActive', 'close']);
    order.length = 0;
    await ttsTeardown(stateWith({ cancelActive: () => { throw new Error('boom'); }, close: () => { order.push('close'); } }), null);
    expect(order).toEqual(['close']);
  });

  it('closing the connection that loaded the model frees it', async () => {
    let closed = 0;
    const state = stateWith({ sampleRate: 24000, resolved: null, init: async () => 1, close: () => { closed++; } });
    const socket = new FakeSocket();
    const h = attach(state, socket, () => {});
    socket.message(JSON.stringify({ type: 'tts_init', id: 1, model: 'moss-tts-nano' }));
    await h.settled();
    socket.close();
    await h.done;
    expect(closed).toBe(1);
  });

  it("a stale teardown after a re-init leaves the newer model alone", async () => {
    const [b1, b2] = [oneShotBackend(), oneShotBackend()];
    stub([b1, b2]);
    const state = stateWith();
    const eng = state.tts_engine as TtsEngine;
    const { conn } = connOf();
    await call(state, { type: 'tts_init', id: 1 }, conn);
    const stale = eng.generation;
    await call(state, { type: 'tts_init', id: 2 }, conn);
    expect([eng.backend === b2, b1.unloads]).toEqual([true, 1]);
    await ttsTeardown(state, null, stale);
    expect([eng.backend === b2, b2.unloads]).toEqual([true, 0]);
  });

  it('a later init queues behind a running one; each keeps its own generation, and the older teardown is stale', async () => {
    const backendA = oneShotBackend();
    const backendB = oneShotBackend();
    let releaseA!: () => void;
    let aLoading = false;
    const aGate = new Promise<void>((r) => { releaseA = r; });
    engineSeams.resolveTts = async (model) => [plan(model === 'model-a' ? 'blocking-a' : 'fast-b')];
    engineSeams.loadMeasured = async (plans) => {
      if (plans[0].backend === 'blocking-a') {
        aLoading = true;
        await aGate;
        return [backendA, plans[0], null, null];
      }
      return [backendB, plans[0], null, null];
    };
    engineSeams.measureRtfTts = async () => 0.1;
    const state = stateWith();
    const eng = state.tts_engine as TtsEngine;
    const a = connOf();
    const b = connOf();
    const initA = call(state, { type: 'tts_init', id: 1, model: 'model-a' }, a.conn);
    await vi.waitFor(() => expect(aLoading).toBe(true));
    const genA = eng.generation;
    const initB = call(state, { type: 'tts_init', id: 2, model: 'model-b' }, b.conn);
    await new Promise((r) => setTimeout(r, 30));
    expect(eng.generation).toBe(genA);                                // B has not started: A is still loading
    releaseA();
    await Promise.all([initA, initB]);
    const genB = eng.generation;
    expect(genA).toBeLessThan(genB);
    await ttsTeardown(state, a.conn, genA);
    expect(eng.isLoaded).toBe(true);                                  // A's teardown is stale
    await ttsTeardown(state, b.conn, genB);
    expect(eng.isLoaded).toBe(false);
  });

  it('stops streaming when the owner disconnects', async () => {
    const b = streamBackend();
    b.gated = true;
    stub([b]);
    const state = stateWith();
    const socket = new FakeSocket();
    const h = attach(state, socket, () => {});
    socket.message(JSON.stringify({ type: 'tts_init', id: 1 }));
    socket.message(JSON.stringify({ type: 'tts_generate', id: 's1', text: 'hello' }));
    await h.settled();
    await vi.waitFor(() => expect(socket.types()).toContain('tts_chunk'));
    socket.close();
    await vi.waitFor(() => expect(b.signals[0]?.aborted).toBe(true), { timeout: 100 });
    const sentAtClose = socket.sent.length;
    b.release();
    await h.done;
    expect(socket.sent.length).toBe(sentAtClose);                     // nothing more reaches a closed connection
    expect((state.tts_engine as TtsEngine).isLoaded).toBe(false);     // the owner's teardown freed the model
  });
});

describe('a queued init whose connection has closed', () => {
  it('loads nothing and unloads nothing', async () => {
    let inits = 0;
    let closed = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const eng = { sampleRate: 24000, generation: 0, nextGeneration() { return ++this.generation; }, resolved: null, init: async () => { inits++; if (inits === 1) await gate; return 1; }, close: () => { closed++; } };
    const state = stateWith(eng);
    const a = connOf();
    const b = connOf();
    const first = call(state, { type: 'tts_init', id: 1 }, a.conn);
    const second = call(state, { type: 'tts_init', id: 2 }, b.conn);
    await new Promise((r) => setTimeout(r, 10));
    b.conn.markClosed();
    release();
    const [, [reply]] = await Promise.all([first, second]);
    expect(reply).toBeNull();
    expect(inits).toBe(1);
    expect(closed).toBe(0);
  });
});

describe('concurrent inits', () => {
  it('two tts_inits at once load one after the other', async () => {
    let running = 0;
    let maxRunning = 0;
    const eng = { sampleRate: 24000, generation: 0, nextGeneration() { return ++this.generation; }, resolved: null, init: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 30)); running--; return 1; }, close: () => {} };
    const state = stateWith(eng);
    await Promise.all([call(state, { type: 'tts_init', id: 1 }, connOf().conn), call(state, { type: 'tts_init', id: 2 }, connOf().conn)]);
    expect(maxRunning).toBe(1);
  });
});

describe('list_tts_voices', () => {
  it('passes the model and the engine through', async () => {
    const eng = { isLoaded: true, modelId: 'moss-tts-nano', listBuiltinVoices: () => ['Ava', 'Bella'] };
    const [reply] = await call(stateWith(eng), { type: 'list_tts_voices', id: 1, model: 'moss-tts-nano' });
    expect(reply).toEqual({ type: 'list_tts_voices_result', id: 1, voices: ['Ava', 'Bella'] });
  });
});
