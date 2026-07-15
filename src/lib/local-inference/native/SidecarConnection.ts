import type { ServerMsg } from './nativeProtocol';

/** Session/management RPCs should be fast; a hang is a bug. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Model load is legitimately slow; bound it so a wedged load surfaces an error. */
export const INIT_REQUEST_TIMEOUT_MS = 120_000;

/** Rejects a pending request whose reply never arrived within its timeout. */
export class SidecarTimeoutError extends Error {
  constructor(public readonly requestType: string, public readonly timeoutMs: number) {
    super(`sidecar request '${requestType}' timed out after ${timeoutMs}ms`);
    this.name = 'SidecarTimeoutError';
  }
}

/**
 * The WS-RPC transport seam to the Python sidecar. One instance owns one socket.
 * Deep for the common case (id-correlated request/reply with timeout); un-correlated
 * push messages and inbound binary frames are handed to registered hooks so each
 * client keeps its own message-shaping (ASR pushes, TTS binary pairing + streaming,
 * model-keyed download routing).
 */
export interface ISidecarConnection {
  /** Ensure the socket is open (single-flight, idempotent). */
  connect(): Promise<void>;
  /** Id-correlated request; ensures connected, resolves with the matching reply,
   *  rejects on an error reply, timeout, or disconnect. Pass `id` to reuse a
   *  pre-allocated correlation id (so a later fire-and-forget cancel can target it). */
  request(payload: { type: string; [k: string]: unknown }, opts?: { timeoutMs?: number; id?: number }): Promise<ServerMsg>;
  /** Fire-and-forget JSON (streaming generate, cancel). Assumes connected; no-op if not. */
  send(payload: object): void;
  /** Fire-and-forget binary frame (ASR audio, TTS reference clip / style vector). Assumes connected; no-op if not.
   *  Accepts a typed-array view directly so a subarray's byteOffset/byteLength are honoured (not the whole backing buffer). */
  sendBinary(buf: ArrayBuffer | ArrayBufferView): void;
  /** Allocate a correlation id from the shared space (for send()s that embed their own id). */
  nextId(): number;
  /** Handler for JSON messages that did not match a pending request (pushes + streaming frames). */
  onMessage(cb: (msg: ServerMsg) => void): void;
  /** Handler for inbound binary frames. */
  onBinary(cb: (buf: ArrayBuffer) => void): void;
  /** Handler fired on unexpected socket close (after pending is rejected) so a client
   *  can reject its own correlation state. NOT fired by dispose(). */
  onClose(cb: (err: Error) => void): void;
  /** Client-driven teardown: reject pending, close the socket. Does not fire onClose. */
  dispose(): void;
}

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

interface Pending {
  resolve: (m: ServerMsg) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class SidecarConnection implements ISidecarConnection {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private disposed = false;
  private counter = 0;
  private pending = new Map<number, Pending>();
  private messageCb: ((msg: ServerMsg) => void) | null = null;
  private binaryCb: ((buf: ArrayBuffer) => void) | null = null;
  private closeCb: ((err: Error) => void) | null = null;

  nextId(): number { return ++this.counter; }
  onMessage(cb: (msg: ServerMsg) => void): void { this.messageCb = cb; }
  onBinary(cb: (buf: ArrayBuffer) => void): void { this.binaryCb = cb; }
  onClose(cb: (err: Error) => void): void { this.closeCb = cb; }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('native host disconnected');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    // Single-flight: the sidecar can take seconds to boot on first use; concurrent
    // callers must await the SAME attempt, else the duplicate sockets race and an
    // orphaned socket's onclose() rejects everyone's in-flight requests.
    if (this.connecting) return this.connecting;
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async _connect(): Promise<void> {
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    // dispose() may have run while we awaited the IPC; don't open an orphan socket.
    if (this.disposed) throw new Error('native host disconnected');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        // A dispose() that landed between construction and open must not leave this
        // socket live; close it and fail the attempt rather than adopting it.
        if (this.disposed) { try { ws.close(); } catch (_) { /* already closing */ } reject(new Error('native host disconnected')); return; }
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error('native host WS error'));
      ws.onclose = () => {
        // A close before this socket ever opened settles the connect() promise
        // (no-op if it already resolved/rejected), so connect() can't hang when the
        // socket closes without a preceding error event.
        reject(new Error('native host disconnected'));
        // Only the socket that currently owns the connection may tear down shared
        // state. If a newer connect() already replaced us, a late onclose from the
        // stale socket must not null the live socket or reject its pending requests.
        if (this.ws !== ws) return;
        this.ws = null;
        const err = new Error('native host disconnected');
        this.rejectAllPending(err);
        this.closeCb?.(err);
      };
      ws.onmessage = (e) => this.onSocketMessage(e.data);
    });
  }

  private onSocketMessage(data: any): void {
    if (data instanceof ArrayBuffer) { this.binaryCb?.(data); return; }
    const msg = JSON.parse(data) as ServerMsg;
    const id = (msg as { id?: number }).id;
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.type === 'error') p.reject(new Error((msg as { message: string }).message));
      else p.resolve(msg);
      return;
    }
    // Un-correlated: id-less pushes, model-keyed downloads, or streaming frames whose
    // id the client deliberately left out of pending (via send()).
    this.messageCb?.(msg);
  }

  request(payload: { type: string; [k: string]: unknown }, opts?: { timeoutMs?: number; id?: number }): Promise<ServerMsg> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return this.connect().then(() => new Promise<ServerMsg>((resolve, reject) => {
      const id = opts?.id ?? this.nextId();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('native host disconnected')); return; }
      const timer = timeoutMs > 0
        ? setTimeout(() => { if (this.pending.delete(id)) reject(new SidecarTimeoutError(payload.type, timeoutMs)); }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ ...payload, id }));
      } catch (e) {
        // A synchronous send() failure would otherwise leave the pending entry and
        // its timer to linger until timeout; clear them and reject now.
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }));
  }

  send(payload: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  sendBinary(buf: ArrayBuffer | ArrayBufferView): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) { if (p.timer) clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAllPending(new Error('native host disconnected'));
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; try { this.ws.close(); } catch (_) { /* already closing */ } }
    this.ws = null;
  }
}
