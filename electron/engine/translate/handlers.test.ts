// @vitest-environment node
/**
 * The translation handlers (ported from sidecar/tests/test_translate_engine.py, plus test_server_conn.py's two
 * translate close cases): reply shapes, partials, the reserve, teardown and its generation check; then real
 * connections — a client that disconnects mid-generation, and two connections sharing the one engine.
 */
import '../test/env';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBackend } from '../backends';
import { Conn } from '../conn';
import { ledgerClaim, ledgerReset } from '../accel/ledger';
import { restoreSeams, seams } from '../accel/seams';
import { setNativeForTests } from '../native';
import type { Plan } from '../planner';
import { attach, createState, handleMessage, register as registerHandler, type EngineState } from '../server';
import { makeFakeNative, type FakeNative, type FakeTranslator } from '../test/fakeNative';
import type { NativeTranslateBackend } from './backend';
import { TranslateEngine, engineSeams, restoreEngineSeams } from './engine';
import { register, translateHandler, translateInitHandler, translateTeardown } from './handlers';

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
}

/** Python's FakeTranslate: init answers 21 ms with a resolved plan, translate echoes "<text>" in 8 ms. */
class FakeTranslate {
  langs: [string, string] | null = null;
  device = '';
  reserved = -1;
  resolved: Record<string, unknown> | null = null;
  generation = 0;
  async init(_m: string | null, src: string, tgt: string, device: string, reserved: number) {
    this.langs = [src, tgt];
    this.device = device;
    this.reserved = reserved;
    this.resolved = { backend: 'native_translate', device: 'vulkan', computeType: 'q8_0' };
    this.generation++;
    return 21;
  }
  async translate(text: string): Promise<[string, number]> { return [`<${text}>`, 8]; }
}

const stateWith = (engine: unknown): EngineState => {
  const state = createState();
  state.translate_engine = engine;
  register(state);
  return state;
};
const call = (state: EngineState, m: Record<string, unknown>, conn?: Conn) => handleMessage(state, JSON.stringify(m), null, conn);

afterEach(() => {
  restoreEngineSeams();
  restoreSeams();
  ledgerReset();
  setNativeForTests(null);
});

describe('translate_init', () => {
  it('answers ready with the resolved plan, the languages and device handed on', async () => {
    const eng = new FakeTranslate();
    const [reply] = await call(stateWith(eng), { type: 'translate_init', id: 1, sourceLang: 'ja', targetLang: 'en', device: 'vulkan' });
    expect(reply).toEqual({ type: 'ready', id: 1, loadTimeMs: 21, backend: 'native_translate', device: 'vulkan', computeType: 'q8_0' });
    expect([eng.langs, eng.device]).toEqual([['ja', 'en'], 'vulkan']);
  });

  it('reserves the other stages\' download sizes', async () => {
    seams.modelSize = (id) => ({ 'voxtral-mini-4b-realtime': 8 * 1024 ** 3, 'piper-en': 100 * 1024 ** 2 } as Record<string, number>)[id] ?? 0;
    const eng = new FakeTranslate();
    await translateInitHandler(stateWith(eng), { type: 'translate_init', id: 1, model: 'hy-mt2-7b', asrModel: 'voxtral-mini-4b-realtime', ttsModel: 'piper-en' }, null, undefined as unknown as Conn);
    expect(eng.reserved).toBe(8 * 1024 ** 3 + 100 * 1024 ** 2);
  });

  it('a stage already loaded on CPU reserves nothing', async () => {
    ledgerReset();
    ledgerClaim('asr', 0);
    seams.modelSize = (id) => ({ a: 3 * 2 ** 30, t: 4 * 2 ** 30 } as Record<string, number>)[id] ?? 0;
    const eng = new FakeTranslate();
    await translateInitHandler(stateWith(eng), { model: 'qwen2.5-0.5b', asrModel: 'a', ttsModel: 't' }, null, undefined as unknown as Conn);
    expect(eng.reserved).toBe(4 * 2 ** 30);
  });
});

describe('translate', () => {
  it('answers translate_result', async () => {
    const [reply, binary] = await call(stateWith(new FakeTranslate()), { type: 'translate', id: 2, text: 'hola' });
    expect(binary).toBeNull();
    expect(reply).toEqual({ type: 'translate_result', id: 2, sourceText: 'hola', translatedText: '<hola>', inferenceTimeMs: 8 });
  });

  it('without a connection there are no partials, only the reply', async () => {
    const [reply] = await translateHandler(stateWith(new FakeTranslate()), { type: 'translate', id: 3, text: 'hola', systemPrompt: '', wrapTranscript: false }, null, undefined as unknown as Conn);
    expect(reply).toEqual({ type: 'translate_result', id: 3, sourceText: 'hola', translatedText: '<hola>', inferenceTimeMs: 8 });
  });

  const streaming = { translate: async (_t: string, _s: string, _w: boolean, o: { onPartial?: (t: string) => void }): Promise<[string, number]> => { o.onPartial?.('Bon'); o.onPartial?.('Bonjour.'); return ['Bonjour.', 3]; }, init: async () => 0 };

  it('a partial goes out before the reply', async () => {
    const socket = new FakeSocket();
    const conn = new Conn(socket);
    const one = { ...streaming, translate: async (_t: string, _s: string, _w: boolean, o: { onPartial?: (t: string) => void }): Promise<[string, number]> => { o.onPartial?.('Bon'); return ['Bonjour.', 3]; } };
    const [reply] = await translateHandler(stateWith(one), { type: 'translate', id: 5, text: 'hello' }, null, conn);
    expect(reply).toEqual({ type: 'translate_result', id: 5, sourceText: 'hello', translatedText: 'Bonjour.', inferenceTimeMs: 3 });
    expect(socket.json()).toEqual([{ type: 'translate_partial', text: 'Bon' }]);
  });

  it('a failing partial send is reported once and the reply still arrives', async () => {
    const lines: string[] = [];
    seams.log = (_l, m) => { lines.push(m); };
    const conn = new Conn({ readyState: 1, send: (_d, cb) => cb?.(new Error('boom')) });
    const [reply] = await translateHandler(stateWith(streaming), { type: 'translate', id: 4, text: 'hello' }, null, conn);
    expect(reply).toEqual({ type: 'translate_result', id: 4, sourceText: 'hello', translatedText: 'Bonjour.', inferenceTimeMs: 3 });
    await vi.waitFor(() => expect(lines.filter((l) => l.includes('translate_partial send failed'))).toHaveLength(1));
  });
});

describe('teardown', () => {
  it('cancels the active generation before closing', async () => {
    const order: string[] = [];
    await translateTeardown({ handlers: new Map(), translate_engine: { cancelActive: () => order.push('cancelActive'), close: () => { order.push('close'); } } });
    expect(order).toEqual(['cancelActive', 'close']);
  });

  it('closes even when the cancel throws', async () => {
    const order: string[] = [];
    await translateTeardown({ handlers: new Map(), translate_engine: { cancelActive: () => { throw new Error('boom'); }, close: () => { order.push('close'); } } });
    expect(order).toEqual(['close']);
  });

  it('a stale teardown, after a newer init, leaves the newer model alone', async () => {
    const backends = [{ unloads: 0 }, { unloads: 0 }].map((b) => ({ ...b, translate: async (): Promise<[string, number]> => ['', 0], unload: async function (this: { unloads: number }) { this.unloads++; } }));
    const p = { backend: 'native_translate', device: 'cpu', computeType: 'float32' } as unknown as Plan;
    let i = 0;
    engineSeams.resolveTranslate = async () => [p];
    engineSeams.loadMeasured = async () => [backends[i++], p, null, null];
    engineSeams.measureTps = async () => null;
    const eng = new TranslateEngine();
    const state = stateWith(eng);
    await translateInitHandler(state, { type: 'translate_init', id: 1, sourceLang: 'ja', targetLang: 'en' }, null, undefined as unknown as Conn);
    const stale = eng.generation;
    await translateInitHandler(state, { type: 'translate_init', id: 2, sourceLang: 'ja', targetLang: 'en' }, null, undefined as unknown as Conn);
    expect([stale, eng.generation]).toEqual([1, 2]);
    await translateTeardown(state, stale);
    expect(eng.backend).toBe(backends[1]);
    expect(backends[1].unloads).toBe(0);
  });
});

describe('concurrent inits', () => {
  it('two translate_inits at once load one after the other', async () => {
    let running = 0;
    let maxRunning = 0;
    const eng = { generation: 0, resolved: null, translate: async (): Promise<[string, number]> => ['', 0], init: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 30)); running--; return 1; } };
    const state = stateWith(eng);
    await Promise.all([call(state, { type: 'translate_init', id: 1 }), call(state, { type: 'translate_init', id: 2 })]);
    expect(maxRunning).toBe(1);
  });
});

describe('a queued init whose connection has closed', () => {
  it('loads nothing: no client is left to own the model', async () => {
    let inits = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const eng = { generation: 0, resolved: null, translate: async (): Promise<[string, number]> => ['', 0], init: async () => { inits++; if (inits === 1) await gate; return 1; } };
    const state = stateWith(eng);
    const a = new Conn(new FakeSocket());
    const b = new Conn(new FakeSocket());
    const first = call(state, { type: 'translate_init', id: 1 }, a);
    const second = call(state, { type: 'translate_init', id: 2 }, b);
    b.markClosed();
    release();
    const [, [reply]] = await Promise.all([first, second]);
    expect(inits).toBe(1);
    expect(reply).toBeNull();
  });
});

describe('connections', () => {
  const GGUF_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-conn-'));
  const gguf = path.join(GGUF_DIR, 'w.gguf');
  fs.writeFileSync(gguf, 'GGUF');
  let fake: FakeNative;

  /** A real engine whose resolver loads the real backend on the fake addon; every call waits for release(). */
  const realState = () => {
    fake = makeFakeNative({ devices: [{ kind: 'cpu' }], translate: { gated: true } });
    setNativeForTests(fake);
    const p = { backend: 'native_translate', device: 'cpu', computeType: 'q8_0' } as unknown as Plan;
    engineSeams.resolveTranslate = async () => [p];
    engineSeams.loadMeasured = async () => {
      const b = makeBackend('native_translate') as NativeTranslateBackend;
      await b.load(gguf, 'cpu', 'q8_0', { promptFamily: 'qwen', disableThinking: false, appendNoThink: false });
      return [b, p, null, null];
    };
    engineSeams.measureTps = async () => null;
    return stateWith(new TranslateEngine());
  };
  const connect = (state: EngineState) => {
    const socket = new FakeSocket();
    return { socket, h: attach(state, socket, () => {}) };
  };
  const translator = (): FakeTranslator => fake.translators[0];

  it('a connection that loaded the model frees it when it closes; one that did not, does not', async () => {
    const eng = { ...new FakeTranslate(), closed: 0, init: FakeTranslate.prototype.init, translate: FakeTranslate.prototype.translate, close() { this.closed++; } };
    const state = stateWith(eng);
    registerHandler(state, 'noop', async () => [null, null]);
    const other = connect(state);
    other.socket.message(JSON.stringify({ type: 'noop' }));
    await other.h.settled();
    other.socket.close();
    await other.h.done;
    expect(eng.closed).toBe(0);
    const owner = connect(state);
    owner.socket.message(JSON.stringify({ type: 'translate_init', id: 1, sourceLang: 'ja', targetLang: 'en' }));
    await owner.h.settled();
    owner.socket.close();
    await owner.h.done;
    expect(eng.closed).toBe(1);
  });

  it('cancels the translation when the client disconnects, and sends it nothing more', async () => {
    const state = realState();
    const session = connect(state);
    session.socket.message(JSON.stringify({ type: 'translate_init', id: 1, sourceLang: 'en', targetLang: 'fr' }));
    await session.h.settled();
    const client = connect(state);
    client.socket.message(JSON.stringify({ type: 'translate', id: 9, text: 'hello' }));
    await translator().started;
    client.socket.close();                                        // mid-generation
    const sentAtClose = client.socket.sent.length;
    await vi.waitFor(() => expect(translator().signals[0]?.aborted).toBe(true), { timeout: 100 });   // at once, not after the call
    translator().release();
    await client.h.done;
    expect(client.socket.sent.length).toBe(sentAtClose);          // no reply, no partial after the close
    const backend = (state.translate_engine as TranslateEngine).backend as NativeTranslateBackend;
    expect([backend.isLoaded, backend.inFlight]).toEqual([true, 0]);   // a cancel is not an unload
    session.socket.close();
    await session.h.done;
  });

  it("cancel from one connection leaves another connection's translation running", async () => {
    const state = realState();
    const session = connect(state);
    session.socket.message(JSON.stringify({ type: 'translate_init', id: 1, sourceLang: 'en', targetLang: 'fr' }));
    await session.h.settled();
    const a = connect(state);
    const b = connect(state);
    a.socket.message(JSON.stringify({ type: 'translate', id: 1, text: 'from a' }));
    b.socket.message(JSON.stringify({ type: 'translate', id: 2, text: 'from b' }));
    await vi.waitFor(() => expect(translator().signals).toHaveLength(2));
    a.socket.close();
    await vi.waitFor(() => expect(translator().signals[0]?.aborted).toBe(true), { timeout: 100 });
    expect(translator().signals[1]?.aborted).toBe(false);
    translator().release();
    await b.h.settled();
    expect(b.socket.json().at(-1)).toEqual({ type: 'translate_result', id: 2, sourceText: 'from b', translatedText: 'Bonjour.', inferenceTimeMs: expect.any(Number) });
    await a.h.done;
    session.socket.close();
    await session.h.done;
  });

  it('the owner closing mid-generation waits for the call before freeing the model, and the call answers empty', async () => {
    const state = realState();
    const owner = connect(state);
    owner.socket.message(JSON.stringify({ type: 'translate_init', id: 1, sourceLang: 'en', targetLang: 'fr' }));
    await owner.h.settled();
    const eng = state.translate_engine as TranslateEngine;
    const out = eng.translate('hello');
    await translator().started;
    let tornDown = false;
    const teardown = translateTeardown(state).then(() => { tornDown = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(tornDown).toBe(false);                                 // waiting for the call
    expect(translator().unloaded).toBe(false);
    translator().release();
    await teardown;
    expect(translator().unloaded).toBe(true);
    expect((await out)[0]).toBe('');                              // cancelled: discarded, not thrown
    owner.socket.close();
    await owner.h.done;
  });
});
