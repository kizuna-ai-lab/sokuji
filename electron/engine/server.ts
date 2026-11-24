/**
 * The engine's WebSocket server (port of sidecar/sokuji_sidecar/server.py): pure dispatch by message type, one
 * connection's messages handled one at a time in arrival order, binary frames fed to the stage that asked for them
 * or held for the next control message, and each connection's cleanups run after the handler in flight returns.
 *
 * Binds 127.0.0.1 only, takes frames up to 64 MiB (a voice clip is one frame of Float32 PCM), and refuses an upgrade
 * whose Origin header is present and not allowed (spec §6.8): a page in a browser on this machine must not drive it.
 */
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData } from 'ws';
import { Conn, type SocketLike } from './conn';

/** A parsed inbound message: an object with a type and, usually, an id. */
export type Msg = Record<string, unknown> & { type?: unknown; id?: unknown };
/** A handler's answer: the JSON reply and the binary frame sent before it, either absent. */
export type Reply = [Record<string, unknown> | null, Uint8Array | null];
export type Handler = (state: EngineState, msg: Msg, binaryIn: Uint8Array | null, conn: Conn) => Promise<Reply>;
export type Log = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

/** What every handler shares: the handlers by type, and the stages' engines (one per stage, for every connection). */
export interface EngineState {
  handlers: Map<string, Handler>;
  [key: string]: unknown;
}

/** What a stage that streams binary sets as `conn.ctx.get('on_binary')`: each frame in, the messages to send out. */
export type OnBinary = (data: Uint8Array) => Iterable<Record<string, unknown>> | Promise<Iterable<Record<string, unknown>>>;

export const MAX_WS_MESSAGE_BYTES = 64 * 1024 * 1024;

export function createState(): EngineState {
  return { handlers: new Map() };
}

/**
 * Runs `fn` after every earlier call with the same key has finished. Connections are served concurrently, but a stage's
 * engine is one per process: two inits at once would each free the other's half-loaded model.
 */
export function exclusive<T>(state: EngineState, key: string, fn: () => Promise<T>): Promise<T> {
  let chains = state.exclusiveChains as Map<string, Promise<void>> | undefined;
  if (!chains) {
    chains = new Map();
    state.exclusiveChains = chains;
  }
  const run = (chains.get(key) ?? Promise.resolve()).then(fn);
  chains.set(key, run.then(() => {}, () => {}));
  return run;
}

/** Registers the handler for one message type. */
export function register(state: EngineState, type: string, handler: Handler): void {
  state.handlers.set(type, handler);
}

/** Pure dispatch: the reply and the binary frame to send before it. */
export async function handleMessage(state: EngineState, raw: string, binaryIn: Uint8Array | null = null, conn?: Conn): Promise<Reply> {
  const msg = JSON.parse(raw) as unknown;
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    // server.py's `msg.get(...)` on a non-object: the request is refused, the connection goes on.
    throw new TypeError(`'${Array.isArray(msg) ? 'list' : typeof msg}' object has no attribute 'get'`);
  }
  const m = msg as Msg;
  const type = m.type;
  const id = m.id;
  if (type === 'ping') return [{ type: 'pong', id }, null];
  const handler = state.handlers.get(String(type));
  if (!handler) return [{ type: 'error', id, message: `unknown message type: ${String(type)}` }, null];
  return handler(state, m, binaryIn, conn as Conn);
}

/** A socket the server drives: `ws`'s WebSocket, or a test's fake. */
export interface EventSocket extends SocketLike {
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

const idOf = (raw: string): unknown => {
  try {
    const m = JSON.parse(raw) as unknown;
    return typeof m === 'object' && m !== null && !Array.isArray(m) ? (m as Msg).id ?? null : null;
  } catch {
    return null;
  }
};

/**
 * Serves one connection on `socket`. `settled()` resolves once every message received so far has been handled;
 * `done` once the socket has closed and the connection's cleanups have run.
 */
export function attach(state: EngineState, socket: EventSocket, log: Log): { conn: Conn; settled(): Promise<void>; done: Promise<void> } {
  const conn = new Conn(socket);
  let pendingBinary: Uint8Array | null = null;
  let chain: Promise<void> = Promise.resolve();
  const send = async (obj: Record<string, unknown> | null, binary: Uint8Array | null = null) => {
    try {
      await conn.send(obj, binary);
    } catch (e) {
      log('error', `[send] ${String(e)}`);
    }
  };
  const onBinary = async (data: Uint8Array) => {
    const feeder = conn.ctx.get('on_binary') as OnBinary | undefined;
    if (!feeder) {
      pendingBinary = data;                     // set_voice: held for the next control message
      return;
    }
    try {
      for (const out of await feeder(data)) await send(out);
    } catch (e) {                               // a feeder's error must not end the connection
      await send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  const onText = async (raw: string) => {
    let reply: Reply;
    try {
      reply = await handleMessage(state, raw, pendingBinary, conn);
    } catch (e) {                               // one bad request never drops the connection
      reply = [{ type: 'error', id: idOf(raw), message: e instanceof Error ? e.message : String(e) }, null];
    }
    pendingBinary = null;
    await send(reply[0], reply[1]);             // binary first, then its JSON
  };
  socket.on('message', (data, isBinary) => {
    chain = chain.then(() => (isBinary ? onBinary(toBytes(data)) : onText(Buffer.from(toBytes(data)).toString('utf8'))));
  });
  let settleDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { settleDone = resolve; });
  socket.on('close', () => {
    conn.markClosed();
    // A session connection closing is "stop": each stage registered its own cleanup at init. One that throws must
    // not skip the rest, and must not vanish: its stage's model would never leave memory.
    chain = chain.then(async () => {
      for (const cb of conn.takeCleanups()) {
        try {
          await cb();
        } catch (e) {
          log('error', `[teardown] on_close cleanup failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        }
      }
    }).finally(settleDone);
  });
  return { conn, settled: () => chain, done };
}

export interface ServeOptions {
  allowedOrigins: readonly string[];
  log: Log;
  host?: string;
  port?: number;
  /** How long close() waits, in total, for the connections' cleanups (model unloads) before it gives up on them. */
  teardownDeadlineMs?: number;
}

/** Serves `state` on 127.0.0.1 (a free port unless one is given). */
export function serve(state: EngineState, opts: ServeOptions): Promise<{ port: number; close(): Promise<void> }> {
  const allowed = new Set(opts.allowedOrigins);
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host: opts.host ?? '127.0.0.1',
      port: opts.port ?? 0,
      maxPayload: MAX_WS_MESSAGE_BYTES,
      verifyClient: (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
        const origin = info.req.headers.origin;
        if (origin !== undefined && !allowed.has(origin)) {
          opts.log('warn', `[server] refused a connection from origin ${origin}`);
          cb(false, 403, 'Forbidden');
          return;
        }
        cb(true);
      },
    });
    /** Each open connection's `done`: resolves once its cleanups (model unloads) have run. */
    const live = new Set<Promise<void>>();
    wss.once('error', reject);
    wss.once('listening', () => {
      wss.off('error', reject);
      wss.on('connection', (socket) => {
        // An oversize frame or a broken socket is the socket's own error: it closes (1009 for a frame over the
        // limit) and the connection's cleanups run; the engine goes on.
        socket.on('error', (e) => opts.log('warn', `[server] socket error: ${e.message}`));
        const { done } = attach(state, socket as unknown as EventSocket, opts.log);
        live.add(done);
        void done.finally(() => live.delete(done));
      });
      const { port } = wss.address() as AddressInfo;
      resolve({
        port,
        // A polite stop closes the sockets and waits for the models to be unloaded (within the deadline), so a caller
        // that exits next does not cut an unload short.
        close: async () => {
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            Promise.allSettled([...live]),
            new Promise<void>((r) => { timer = setTimeout(r, opts.teardownDeadlineMs ?? 15_000); }),
          ]);
          clearTimeout(timer);
        },
      });
    });
  });
}
