// @vitest-environment node
/**
 * The engine's transport (ported from sidecar/tests/test_server_conn.py and test_server_envelope.py): the one outbound
 * funnel, serial dispatch per connection, cleanups after the handler in flight, and the server's limits. The two
 * translate-specific close cases are Task 9's (translate/engine.test.ts).
 */
import './test/env';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { Conn } from './conn';
import { startEngine } from './main';
import { attach, createState, handleMessage, register, serve, type Handler } from './server';
import { WireContractError } from './wire';
import { makeFakeNative } from './test/fakeNative';
import { nextClose, nextJson, openWs } from './test/wsClient';

/** A socket driven by hand: what it is sent is kept, and the test says when a message arrives and when it closes. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<string | Uint8Array> = [];
  send(data: string | Uint8Array, cb?: (err?: Error) => void) {
    this.sent.push(data);
    cb?.();
  }
  message(data: string | Uint8Array) {
    this.emit('message', typeof data === 'string' ? Buffer.from(data) : Buffer.from(data), typeof data !== 'string');
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

const quiet = () => {};
const json = (sent: Array<string | Uint8Array>) => sent.map((s) => JSON.parse(String(s)) as Record<string, unknown>);

/** Drives one connection over `messages`, then closes it: the cleanups have run when it resolves. */
async function drive(state: ReturnType<typeof createState>, messages: Array<string | Uint8Array>) {
  const socket = new FakeSocket();
  const h = attach(state, socket, quiet);
  for (const m of messages) socket.message(m);
  await h.settled();
  socket.close();
  await h.done;
  return socket;
}

describe('Conn', () => {
  it('waitClosed resolves when its socket closes, whatever a handler is doing', async () => {
    const socket = new FakeSocket();
    const conn = new Conn(socket);
    let closed = false;
    void conn.waitClosed().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    conn.markClosed();
    await conn.waitClosed();
    expect(closed).toBe(true);
    expect(conn.closed).toBe(true);
  });

  it('sends JSON and binary, the binary first', async () => {
    const socket = new FakeSocket();
    const conn = new Conn(socket);
    await conn.send({ type: 'ok', id: 1 });
    await conn.send(undefined, new Uint8Array([0, 1]));
    await conn.send({ type: 'ok', id: 2 }, new Uint8Array([2]));
    expect(socket.sent).toEqual([JSON.stringify({ type: 'ok', id: 1 }), new Uint8Array([0, 1]), new Uint8Array([2]), JSON.stringify({ type: 'ok', id: 2 })]);
  });

  it('holds every message to the wire contract before anything is sent', async () => {
    const socket = new FakeSocket();
    const conn = new Conn(socket);
    await expect(conn.send({ type: 'ok' })).rejects.toBeInstanceOf(WireContractError);
    expect(socket.sent).toEqual([]);
    // A violating JSON must not leave its binary orphaned on the wire.
    await expect(conn.send({ type: 'ok' }, new Uint8Array([0, 1]))).rejects.toBeInstanceOf(WireContractError);
    expect(socket.sent).toEqual([]);
  });

  it('sends nothing on a closed socket', async () => {
    const socket = new FakeSocket();
    const conn = new Conn(socket);
    socket.readyState = 3;
    conn.markClosed();
    await conn.send({ type: 'ok', id: 1 }, new Uint8Array([1]));
    expect(socket.sent).toEqual([]);
  });
});

describe('handleMessage', () => {
  it('answers ping with pong', async () => {
    expect(await handleMessage(createState(), JSON.stringify({ type: 'ping', id: 7 }))).toEqual([{ type: 'pong', id: 7 }, null]);
  });

  it('answers an unknown type with an error naming it', async () => {
    const [reply] = await handleMessage(createState(), JSON.stringify({ type: 'nope', id: 1 }));
    expect(reply).toEqual({ type: 'error', id: 1, message: 'unknown message type: nope' });
  });

  it('hands the handler its connection', async () => {
    let seen: Conn | null = null;
    const state = createState();
    register(state, 'probe', async (_s, msg, _b, conn) => {
      seen = conn;
      return [{ type: 'okk', id: msg.id }, null];
    });
    const conn = new Conn(new FakeSocket());
    expect(await handleMessage(state, JSON.stringify({ type: 'probe', id: 5 }), null, conn)).toEqual([{ type: 'okk', id: 5 }, null]);
    expect(seen).toBe(conn);
  });
});

describe('a connection', () => {
  it("answers a handler's exception with an error that carries the request's id", async () => {
    const state = createState();
    register(state, 'kaboom', async () => { throw new Error('handler exploded'); });
    const socket = await drive(state, [JSON.stringify({ type: 'kaboom', id: 42 })]);
    expect(json(socket.sent)).toEqual([{ type: 'error', id: 42, message: 'handler exploded' }]);
  });

  it('answers a non-object JSON frame with an error, and goes on', async () => {
    const state = createState();
    const socket = await drive(state, ['[1,2]', 'not json', JSON.stringify({ type: 'ping', id: 3 })]);
    const replies = json(socket.sent);
    expect(replies.map((r) => [r.type, r.id ?? null])).toEqual([['error', null], ['error', null], ['pong', 3]]);
  });

  it("a feeder that throws sends an error and keeps the connection", async () => {
    const state = createState();
    let calls = 0;
    register(state, 'stage_init', async (_s, msg, _b, conn) => {
      conn.ctx.set('on_binary', () => {
        calls++;
        throw new Error('feeder failed');
      });
      return [{ type: 'ok', id: msg.id }, null];
    });
    const socket = await drive(state, [JSON.stringify({ type: 'stage_init', id: 1 }), new Uint8Array([0, 1]), new Uint8Array([2, 3])]);
    expect(calls).toBe(2);
    expect(json(socket.sent)).toEqual([{ type: 'ok', id: 1 }, { type: 'error', message: 'feeder failed' }, { type: 'error', message: 'feeder failed' }]);
  });

  it("a binary frame with no feeder is held for the next control message, and only that one", async () => {
    const state = createState();
    const seen: Array<number | null> = [];
    register(state, 'set_voice', async (_s, msg, binaryIn) => {
      seen.push(binaryIn ? binaryIn.length : null);
      return [{ type: 'ok', id: msg.id }, null];
    });
    await drive(state, [new Uint8Array(5), JSON.stringify({ type: 'set_voice', id: 1 }), JSON.stringify({ type: 'set_voice', id: 2 })]);
    expect(seen).toEqual([5, null]);
  });

  it('handles its messages one at a time, in order', async () => {
    const state = createState();
    const order: string[] = [];
    let release: () => void = () => {};
    register(state, 'slow', async (_s, msg) => {
      order.push('slow:start');
      await new Promise<void>((resolve) => { release = resolve; });
      order.push('slow:end');
      return [{ type: 'ok', id: msg.id }, null];
    });
    register(state, 'fast', async (_s, msg) => {
      order.push('fast');
      return [{ type: 'ok', id: msg.id }, null];
    });
    const socket = new FakeSocket();
    const h = attach(state, socket, quiet);
    socket.message(JSON.stringify({ type: 'slow', id: 1 }));
    socket.message(JSON.stringify({ type: 'fast', id: 2 }));
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['slow:start']);
    release();
    await h.settled();
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
    socket.close();
    await h.done;
  });

  it('runs the cleanups a stage registered when it closes, in order', async () => {
    const calls: string[] = [];
    const state = createState();
    const init: Handler = async (_s, msg, _b, conn) => {
      conn.onClose(() => { calls.push('first'); });
      conn.onClose(async () => { calls.push('second'); });
      return [{ type: 'ready', id: msg.id, loadTimeMs: 0 }, null];
    };
    register(state, 'stage_init', init);
    await drive(state, [JSON.stringify({ type: 'stage_init', id: 1 })]);
    expect(calls).toEqual(['first', 'second']);
  });

  it('runs every cleanup when one throws, and says which failed', async () => {
    const calls: string[] = [];
    const logged: string[] = [];
    const state = createState();
    register(state, 'stage_init', async (_s, msg, _b, conn) => {
      conn.onClose(() => {
        calls.push('boom');
        throw new Error('cleanup exploded');
      });
      conn.onClose(() => { calls.push('after'); });
      return [{ type: 'ready', id: msg.id, loadTimeMs: 0 }, null];
    });
    const socket = new FakeSocket();
    const h = attach(state, socket, (level, msg) => logged.push(`${level}:${msg}`));
    socket.message(JSON.stringify({ type: 'stage_init', id: 1 }));
    await h.settled();
    socket.close();
    await h.done;
    expect(calls).toEqual(['boom', 'after']);
    expect(logged).toEqual([expect.stringMatching(/^error:\[teardown\] on_close cleanup failed: .*cleanup exploded/)]);
  });

  it('runs its cleanups only after the handler in flight returns', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const state = createState();
    register(state, 'slow_init', async (_s, msg, _b, conn) => {
      conn.onClose(() => { order.push('cleanup'); });
      await new Promise<void>((resolve) => { release = resolve; });
      order.push('handler done');
      return [{ type: 'ok', id: msg.id }, null];
    });
    const socket = new FakeSocket();
    const h = attach(state, socket, quiet);
    socket.message(JSON.stringify({ type: 'slow_init', id: 1 }));
    await new Promise((r) => setTimeout(r, 5));
    socket.close();
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    release();
    await h.done;
    expect(order).toEqual(['handler done', 'cleanup']);
    // Its reply had nowhere to go.
    expect(socket.sent).toEqual([]);
  });
});

describe('the server', () => {
  const engines: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    process.env.SOKUJI_WIRE_STRICT = '1';
    for (const e of engines.splice(0)) await e.close();
  });

  it('close() resolves only after every connection has been torn down', async () => {
    delete process.env.SOKUJI_WIRE_STRICT;
    const state = createState();
    let freed = false;
    register(state, 'hold', async (_s, msg, _b, conn) => {
      conn.onClose(async () => { await new Promise((r) => setTimeout(r, 100)); freed = true; });   // a model unload
      return [{ type: 'held', id: msg.id }, null];
    });
    const srv = await serve(state, { allowedOrigins: [], log: quiet });
    const ws = await openWs(srv.port);
    ws.send(JSON.stringify({ type: 'hold', id: 1 }));
    await nextJson(ws);
    await srv.close();
    expect(freed).toBe(true);
  });

  it('close() does not wait forever for a teardown that never ends', async () => {
    delete process.env.SOKUJI_WIRE_STRICT;
    const state = createState();
    register(state, 'stuck', async (_s, msg, _b, conn) => {
      conn.onClose(() => new Promise<void>(() => {}));
      return [{ type: 'held', id: msg.id }, null];
    });
    const srv = await serve(state, { allowedOrigins: [], log: quiet, teardownDeadlineMs: 150 });
    const ws = await openWs(srv.port);
    ws.send(JSON.stringify({ type: 'stuck', id: 1 }));
    await nextJson(ws);
    const t0 = Date.now();
    await srv.close();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('accepts a binary frame larger than 1 MiB', async () => {
    // A synthetic probe type: a pure transport test opts out of the strict contract.
    delete process.env.SOKUJI_WIRE_STRICT;
    const state = createState();
    register(state, 'probe', async (_s, msg, binaryIn) => [{ type: 'probe_result', id: msg.id, n: binaryIn ? binaryIn.length : 0 }, null]);
    const srv = await serve(state, { allowedOrigins: [], log: quiet });
    engines.push(srv);
    const ws = await openWs(srv.port);
    ws.send(new Uint8Array(2 * 1024 * 1024));
    ws.send(JSON.stringify({ type: 'probe', id: 1 }));
    expect(await nextJson(ws)).toEqual({ type: 'probe_result', id: 1, n: 2 * 1024 * 1024 });
    ws.close();
  });

  it('closes the socket on a frame over 64 MiB', async () => {
    const srv = await serve(createState(), { allowedOrigins: [], log: quiet });
    engines.push(srv);
    const ws = await openWs(srv.port);
    const closing = nextClose(ws);
    ws.send(new Uint8Array(65 * 1024 * 1024));
    expect(await closing).toBe(1009);
  });

  it('rejects a browser Origin that is not allowed', async () => {
    const eng = await startEngine({ nativeDir: '', allowedOrigins: ['http://localhost:5173'], log: quiet, native: makeFakeNative() });
    engines.push(eng);
    await expect(openWs(eng.port, { origin: 'https://evil.example' })).rejects.toThrow(/403/);
    const ok = await openWs(eng.port, { origin: 'http://localhost:5173' });
    expect(ok).toBeTruthy();
    const none = await openWs(eng.port);
    none.send(JSON.stringify({ type: 'ping', id: 1 }));
    expect(await nextJson(none)).toEqual({ type: 'pong', id: 1 });
    ok.close();
    none.close();
  });

  it('rejects when the addon cannot load', async () => {
    await expect(startEngine({ nativeDir: '/nonexistent', allowedOrigins: [], log: quiet })).rejects.toThrow(/contract\.json|sokuji_native_node/);
  });
});
