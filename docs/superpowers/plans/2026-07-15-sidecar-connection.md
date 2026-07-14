# SidecarConnection Implementation Plan (C1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four hand-rolled WebSocket transports in the Local Native clients into one deep `SidecarConnection` module behind the `ISidecarConnection` seam.

**Architecture:** A "thin pipe" transport module owns one socket to the Python sidecar and the mechanics every native client duplicated (single-flight connect, id-correlated request/reply with two-tier timeout, fire-and-forget send, outbound binary, and routing of un-correlated push messages). The four clients (ASR / translate / TTS / model) keep only their own message-shaping and become verb sets over an injected `ISidecarConnection`. Each client still holds its own connection instance — four sockets stay, because the sidecar routes binary frames and frees VRAM per-connection.

**Tech Stack:** TypeScript, vitest 4, browser `WebSocket`, Electron `window.electron.invoke` IPC bridge.

## Global Constraints

- **Renderer-side only.** No changes to `sidecar/**` (Python) or to the wire protocol. `nativeProtocol.ts` message shapes stay byte-identical. C1 is wire-compatible and ships without sidecar coordination.
- **Four sockets stay.** Do NOT share one socket across clients. Each native client owns its own `SidecarConnection`.
- **No auto-reconnect.** On socket close, reject all pending work (`Error('native host disconnected')` — this exact string is asserted by existing tests). The session surfaces the error; the user restarts.
- **Timeouts:** session/management RPCs default `30_000` ms; init/load RPCs `120_000` ms; downloads are push-routed (no `request()`, no timeout). On timeout: reject with `SidecarTimeoutError`, remove the pending entry only, keep the socket open, ignore any late reply.
- **Comments/code in English** (repo rule). TDD; vitest is the correctness gate (tsc is NOT clean repo-wide — do not gate on tsc).
- **F4 deferred to C4.** Do not rename `result` → `asr_result`/`tts_result`. The connection's id-routing separates them mechanically.
- Test runner: `npx vitest run <path>` for a one-shot run.

---

## File Structure

- Create `src/lib/local-inference/native/SidecarConnection.ts` — the interface `ISidecarConnection`, the concrete `SidecarConnection`, the `SidecarTimeoutError`, and the timeout constants. One responsibility: the WS transport seam.
- Create `src/lib/local-inference/native/SidecarConnection.test.ts` — unit tests for the connection (the only place that still mocks `WebSocket`).
- Create `src/lib/local-inference/native/fakeSidecarConnection.ts` — `FakeSidecarConnection` test double implementing `ISidecarConnection`, imported by all four client tests (replaces four `FakeWS` classes).
- Modify `src/lib/local-inference/native/NativeTranslateClient.ts` — verb set over an injected connection.
- Modify `src/lib/local-inference/native/NativeAsrClient.ts` — same, plus push routing + outbound audio.
- Modify `src/lib/local-inference/native/NativeModelClient.ts` — same, plus model-keyed download routing (reject downloads via `onClose`).
- Modify `src/lib/local-inference/native/NativeTtsClient.ts` — same, plus binary pairing + streaming state machine (reject `streamDone` via `onClose`).
- Rewrite the four client test files to inject `FakeSidecarConnection`.
- `src/services/clients/LocalNativeClient.ts` is **unchanged**: it constructs `new NativeAsrClient()` etc. with no args, which default-construct their own `SidecarConnection`. Its `Deps` injection and tests are untouched.

---

### Task 1: `SidecarConnection` deep module

**Files:**
- Create: `src/lib/local-inference/native/SidecarConnection.ts`
- Test: `src/lib/local-inference/native/SidecarConnection.test.ts`

**Interfaces:**
- Consumes: `ServerMsg` from `./nativeProtocol`.
- Produces:
  - `interface ISidecarConnection { connect(): Promise<void>; request(payload, opts?): Promise<ServerMsg>; send(payload: object): void; sendBinary(buf: ArrayBuffer): void; nextId(): number; onMessage(cb): void; onBinary(cb): void; onClose(cb): void; dispose(): void }`
  - `request(payload: { type: string; [k: string]: unknown }, opts?: { timeoutMs?: number; id?: number }): Promise<ServerMsg>`
  - `onMessage(cb: (msg: ServerMsg) => void)`, `onBinary(cb: (buf: ArrayBuffer) => void)`, `onClose(cb: (err: Error) => void)`
  - `class SidecarConnection implements ISidecarConnection`
  - `class SidecarTimeoutError extends Error` with `.requestType: string`, `.timeoutMs: number`
  - `const INIT_REQUEST_TIMEOUT_MS = 120_000`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/native/SidecarConnection.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SidecarConnection, SidecarTimeoutError } from './SidecarConnection';

// One reusable fake WebSocket — the ONLY place in the native suite that still
// mocks the raw socket. Every client test uses FakeSidecarConnection instead.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  readyState = 1; // OPEN
  constructor(public url: string) { FakeWS.instances.push(this); setTimeout(() => this.onopen?.(), 0); }
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  reply(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  replyBinary(buf: ArrayBuffer) { this.onmessage?.({ data: buf }); }
}

beforeEach(() => {
  FakeWS.instances = [];
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});
afterEach(() => { vi.useRealTimers(); });

describe('SidecarConnection', () => {
  it('connect() opens one socket to the port from native-host:start', async () => {
    const c = new SidecarConnection();
    await c.connect();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('ws://127.0.0.1:9');
  });

  it('single-flights concurrent connect() into one socket', async () => {
    const c = new SidecarConnection();
    await Promise.all([c.connect(), c.connect(), c.connect()]);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('request() injects an id and resolves with the matching reply', async () => {
    const c = new SidecarConnection();
    const p = c.request({ type: 'translate', text: 'hi' });
    await new Promise((r) => setTimeout(r, 0));       // let connect() + send flush
    const ws = FakeWS.instances[0];
    const sent = JSON.parse(ws.sent[0]);
    expect(sent).toMatchObject({ type: 'translate', text: 'hi' });
    expect(typeof sent.id).toBe('number');
    ws.reply({ type: 'translation', id: sent.id, sourceText: 'hi', translatedText: 'こんにちは', inferenceTimeMs: 3 });
    await expect(p).resolves.toMatchObject({ translatedText: 'こんにちは' });
  });

  it('request() rejects on an error reply carrying the id', async () => {
    const c = new SidecarConnection();
    const p = c.request({ type: 'translate', text: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWS.instances[0];
    const id = JSON.parse(ws.sent[0]).id;
    ws.reply({ type: 'error', id, message: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('request() rejects with SidecarTimeoutError after timeoutMs and ignores a late reply', async () => {
    vi.useFakeTimers();
    const c = new SidecarConnection();
    const p = c.request({ type: 'translate', text: 'x' }, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);            // connect() resolves
    const ws = FakeWS.instances[0];
    const id = JSON.parse(ws.sent[0]).id;
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(err).toBeInstanceOf(SidecarTimeoutError);
    expect((err as SidecarTimeoutError).requestType).toBe('translate');
    // A late reply after timeout must be routed to onMessage, not crash.
    const pushes: any[] = [];
    c.onMessage((m) => pushes.push(m));
    ws.reply({ type: 'translation', id, translatedText: 'late' });
    expect(pushes).toHaveLength(1);
  });

  it('routes an id-less message to onMessage', async () => {
    const c = new SidecarConnection();
    const pushes: any[] = [];
    c.onMessage((m) => pushes.push(m));
    await c.connect();
    FakeWS.instances[0].reply({ type: 'partial', text: 'he' });
    expect(pushes).toEqual([{ type: 'partial', text: 'he' }]);
  });

  it('routes a binary frame to onBinary', async () => {
    const c = new SidecarConnection();
    const bins: ArrayBuffer[] = [];
    c.onBinary((b) => bins.push(b));
    await c.connect();
    const buf = new Int16Array([1, 2, 3]).buffer;
    FakeWS.instances[0].replyBinary(buf);
    expect(bins).toEqual([buf]);
  });

  it('rejects pending and fires onClose when the socket closes', async () => {
    const c = new SidecarConnection();
    let closeErr: Error | null = null;
    c.onClose((e) => { closeErr = e; });
    const p = c.request({ type: 'translate', text: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    FakeWS.instances[0].close();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(closeErr).toBeInstanceOf(Error);
    expect((closeErr as unknown as Error).message).toBe('native host disconnected');
  });

  it('dispose() rejects pending and does NOT fire onClose', async () => {
    const c = new SidecarConnection();
    let closeFired = false;
    c.onClose(() => { closeFired = true; });
    const p = c.request({ type: 'translate', text: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(closeFired).toBe(false);
  });

  it('honors a caller-provided id (for out-of-band cancel correlation)', async () => {
    const c = new SidecarConnection();
    const p = c.request({ type: 'tts_generate', text: 'x' }, { id: 4242 });
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWS.instances[0];
    expect(JSON.parse(ws.sent[0]).id).toBe(4242);
    ws.reply({ type: 'result', id: 4242, sampleRate: 24000, generationTimeMs: 5, samples: 0 });
    await expect(p).resolves.toMatchObject({ type: 'result' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/SidecarConnection.test.ts`
Expected: FAIL — `Cannot find module './SidecarConnection'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/local-inference/native/SidecarConnection.ts`:

```typescript
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
  /** Fire-and-forget binary frame (ASR audio, TTS reference clip / style vector). Assumes connected; no-op if not. */
  sendBinary(buf: ArrayBuffer): void;
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
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('native host WS error'));
      ws.onclose = () => {
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
      const timer = timeoutMs > 0
        ? setTimeout(() => { if (this.pending.delete(id)) reject(new SidecarTimeoutError(payload.type, timeoutMs)); }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ ...payload, id }));
    }));
  }

  send(payload: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) { if (p.timer) clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  dispose(): void {
    this.rejectAllPending(new Error('native host disconnected'));
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; try { this.ws.close(); } catch (_) { /* already closing */ } }
    this.ws = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/SidecarConnection.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/SidecarConnection.ts src/lib/local-inference/native/SidecarConnection.test.ts
git commit -m "feat(local-native): add SidecarConnection WS transport seam"
```

---

### Task 2: `FakeSidecarConnection` helper + migrate `NativeTranslateClient`

**Files:**
- Create: `src/lib/local-inference/native/fakeSidecarConnection.ts`
- Modify: `src/lib/local-inference/native/NativeTranslateClient.ts`
- Test: `src/lib/local-inference/native/NativeTranslateClient.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ISidecarConnection`, `INIT_REQUEST_TIMEOUT_MS` from `./SidecarConnection`; `ServerMsg` from `./nativeProtocol`.
- Produces:
  - `class FakeSidecarConnection implements ISidecarConnection` with test drivers: `emit(msg: ServerMsg): void`, `emitBinary(buf: ArrayBuffer): void`, `emitClose(): void`, and inspectors `sent: any[]`, `binarySent: ArrayBuffer[]`, `autoReady: ServerMsg | null`.
  - `NativeTranslateClient` constructor: `new NativeTranslateClient(conn?: ISidecarConnection)`; public methods `init(...)` and `translate(...)` and `dispose()` keep their existing signatures.

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/native/fakeSidecarConnection.ts`:

```typescript
import type { ISidecarConnection } from './SidecarConnection';
import type { ServerMsg } from './nativeProtocol';

/**
 * In-memory ISidecarConnection for client tests. Tests drive it with emit()/
 * emitBinary()/emitClose() and inspect sent[]/binarySent[]. Mirrors the real
 * connection's routing: a JSON message whose id matches a pending request()
 * settles it; otherwise it goes to the onMessage hook.
 */
export class FakeSidecarConnection implements ISidecarConnection {
  sent: any[] = [];
  binarySent: ArrayBuffer[] = [];
  disposed = false;
  private counter = 0;
  private pending = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void }>();
  private messageCb: ((m: ServerMsg) => void) | null = null;
  private binaryCb: ((b: ArrayBuffer) => void) | null = null;
  private closeCb: ((e: Error) => void) | null = null;

  async connect(): Promise<void> { /* no-op: always "connected" */ }
  nextId(): number { return ++this.counter; }
  onMessage(cb: (m: ServerMsg) => void): void { this.messageCb = cb; }
  onBinary(cb: (b: ArrayBuffer) => void): void { this.binaryCb = cb; }
  onClose(cb: (e: Error) => void): void { this.closeCb = cb; }

  request(payload: { type: string; [k: string]: unknown }, opts?: { timeoutMs?: number; id?: number }): Promise<ServerMsg> {
    const id = opts?.id ?? this.nextId();
    this.sent.push({ ...payload, id });
    return new Promise<ServerMsg>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
  }

  send(payload: object): void { this.sent.push(payload); }
  sendBinary(buf: ArrayBuffer): void { this.binarySent.push(buf); }

  /** Simulate a JSON message from the sidecar. */
  emit(msg: ServerMsg): void {
    const id = (msg as { id?: number }).id;
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      if (msg.type === 'error') p.reject(new Error((msg as { message: string }).message));
      else p.resolve(msg);
      return;
    }
    this.messageCb?.(msg);
  }

  /** Simulate an inbound binary frame. */
  emitBinary(buf: ArrayBuffer): void { this.binaryCb?.(buf); }

  /** Simulate an unexpected socket close. */
  emitClose(): void {
    const err = new Error('native host disconnected');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.closeCb?.(err);
  }

  dispose(): void {
    this.disposed = true;
    const err = new Error('native host disconnected');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
```

Rewrite `src/lib/local-inference/native/NativeTranslateClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeTranslateClient } from './NativeTranslateClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

describe('NativeTranslateClient', () => {
  it('init() sends translate_init with the init timeout and returns the resolved plan', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.init('en', 'ja', 'qwen2.5-0.5b', 'cuda', 'sense-voice', null, 'q8');
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'translate_init', sourceLang: 'en', targetLang: 'ja', model: 'qwen2.5-0.5b', device: 'cuda', asrModel: 'sense-voice', variant: 'q8' });
    conn.emit({ type: 'ready', id: sent.id, loadTimeMs: 7, backend: 'llamacpp_qwen', device: 'cuda', computeType: 'q8', tokensPerSec: 42 });
    await expect(p).resolves.toMatchObject({ loadTimeMs: 7, device: 'cuda', tokensPerSec: 42 });
  });

  it('translate() returns the sidecar TranslationResult', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('hello', 'be terse', true);
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'translate', text: 'hello', systemPrompt: 'be terse', wrapTranscript: true });
    conn.emit({ type: 'translation', id: sent.id, sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
    await expect(p).resolves.toEqual({ sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
  });

  it('translate() rejects on an error reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('x');
    conn.emit({ type: 'error', id: conn.sent[0].id, message: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('dispose() rejects an unsettled request', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('x');
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(conn.disposed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`
Expected: FAIL — `NativeTranslateClient` still `new WebSocket`s (constructor ignores `conn`); assertions on `conn.sent` fail.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/local-inference/native/NativeTranslateClient.ts` entirely:

```typescript
import type { TranslationResult } from '../engine/TranslationEngine';
import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, type ISidecarConnection } from './SidecarConnection';

export class NativeTranslateClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    // Only id-less errors reach here (id-carrying errors reject the request()); this
    // is defensive — translate RPCs all carry ids, so callers see failures via reject.
    this.conn.onMessage((msg) => { if (msg.type === 'error') this.onError?.(msg.message); });
  }

  async init(
    sourceLang: string, targetLang: string, modelId?: string, device?: string,
    asrModel?: string | null, ttsModel?: string | null, variant?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }> {
    this.onStatus?.('[native-translate] init…');
    const payload: Record<string, unknown> = { type: 'translate_init', sourceLang, targetLang, model: modelId, device };
    // Pass co-loaded stage IDs and the chosen variant so the sidecar can account
    // for their VRAM when reserving memory for the translation model.
    if (asrModel) payload.asrModel = asrModel;
    if (ttsModel) payload.ttsModel = ttsModel;
    if (variant) payload.variant = variant;
    const msg = await this.conn.request(payload as { type: string; [k: string]: unknown }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, tokensPerSec: r.tokensPerSec, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  async translate(text: string, systemPrompt = '', wrapTranscript = false): Promise<TranslationResult> {
    const msg = await this.conn.request({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translation' }>;
    return { sourceText: msg.sourceText, translatedText: msg.translatedText, inferenceTimeMs: msg.inferenceTimeMs };
  }

  dispose(): void { this.conn.dispose(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/fakeSidecarConnection.ts src/lib/local-inference/native/NativeTranslateClient.ts src/lib/local-inference/native/NativeTranslateClient.test.ts
git commit -m "refactor(local-native): NativeTranslateClient over SidecarConnection"
```

---

### Task 3: Migrate `NativeAsrClient`

**Files:**
- Modify: `src/lib/local-inference/native/NativeAsrClient.ts`
- Test: `src/lib/local-inference/native/NativeAsrClient.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ISidecarConnection`, `SidecarConnection`, `INIT_REQUEST_TIMEOUT_MS`; `FakeSidecarConnection` (test).
- Produces: `NativeAsrClient` constructor `new NativeAsrClient(conn?: ISidecarConnection)`; existing public surface unchanged — `onResult/onPartialResult/onSpeechStart/onStatus/onError` callbacks, `init(...)`, `feedAudio(samples, rate)`, `flush()`, `dispose()`, plus keep the `NativeAsrResult` export.

- [ ] **Step 1: Write the failing test**

Rewrite `src/lib/local-inference/native/NativeAsrClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

describe('NativeAsrClient', () => {
  it('init() sends asr_init with device override and returns device + rtf', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const p = c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'asr_init', language: 'en', model: 'granite-speech-4.1-2b', device: 'cuda' });
    conn.emit({ type: 'ready', id: sent.id, loadTimeMs: 2, device: 'cuda', rtf: 0.5 });
    await expect(p).resolves.toMatchObject({ loadTimeMs: 2, device: 'cuda', rtf: 0.5 });
  });

  it('feedAudio() sends the raw buffer as a binary frame', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const samples = new Int16Array(24000);
    c.feedAudio(samples, 24000);
    expect(conn.binarySent).toHaveLength(1);
    expect(conn.binarySent[0]).toBe(samples.buffer);
  });

  it('routes id-less push messages to their callbacks', () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const partials: string[] = []; const finals: string[] = []; let starts = 0;
    c.onPartialResult = (t) => partials.push(t);
    c.onResult = (r) => finals.push(r.text);
    c.onSpeechStart = () => { starts++; };
    conn.emit({ type: 'speech_start' });
    conn.emit({ type: 'partial', text: 'he llo' });
    conn.emit({ type: 'result', text: 'hello world', durationMs: 1000, recognitionTimeMs: 50 });
    expect(starts).toBe(1);
    expect(partials).toEqual(['he llo']);
    expect(finals).toEqual(['hello world']);
  });

  it('flush() resolves on the ok reply and rejects on an error reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const okP = c.flush();
    conn.emit({ type: 'ok', id: conn.sent[0].id });
    await expect(okP).resolves.toBeUndefined();
    const errP = c.flush();
    conn.emit({ type: 'error', id: conn.sent[1].id, message: 'flush-boom' });
    await expect(errP).rejects.toThrow('flush-boom');
  });

  it('dispose() rejects a pending flush', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const p = c.flush();
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: FAIL — constructor ignores `conn`; `conn.sent`/`conn.binarySent` empty.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/local-inference/native/NativeAsrClient.ts` entirely:

```typescript
import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, type ISidecarConnection } from './SidecarConnection';

export interface NativeAsrResult { text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }

export class NativeAsrClient {
  onResult: ((r: NativeAsrResult) => void) | null = null;
  onPartialResult: ((text: string) => void) | null = null;
  onSpeechStart: (() => void) | null = null;
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onMessage((msg) => this.onPush(msg));
  }

  private onPush(msg: ServerMsg): void {
    if (msg.type === 'speech_start') { this.onSpeechStart?.(); return; }
    if (msg.type === 'partial') { this.onPartialResult?.(msg.text); return; }
    // ASR results are pushed without an id; TTS results carry an id and are matched
    // as request replies on the (separate) TTS connection — they never reach here.
    if (msg.type === 'result') {
      const r = msg as Extract<ServerMsg, { type: 'result' }> & { text?: string; startSample?: number; durationMs?: number; recognitionTimeMs?: number };
      this.onResult?.({ text: r.text as string, startSample: r.startSample, durationMs: r.durationMs as number, recognitionTimeMs: r.recognitionTimeMs as number });
      return;
    }
    // Feeder errors during streaming arrive id-less (see sidecar server.py on_binary).
    if (msg.type === 'error') this.onError?.(msg.message);
  }

  async init(
    language = '', modelId?: string, sampleRate = 24000,
    vad?: { threshold?: number; minSilence?: number; minSpeech?: number },
    device?: string, variant?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string }> {
    this.onStatus?.('[native-asr] init…');
    const msg = await this.conn.request({
      type: 'asr_init', language, model: modelId, sampleRate, device, variant,
      vadThreshold: vad?.threshold, vadMinSilenceDuration: vad?.minSilence, vadMinSpeechDuration: vad?.minSpeech,
    }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  feedAudio(samples: Int16Array, _sampleRate: number): void {
    this.conn.sendBinary(samples.buffer);   // server is in asr binary mode after init
  }

  async flush(): Promise<void> { await this.conn.request({ type: 'asr_flush' }); }

  dispose(): void { this.conn.dispose(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/NativeAsrClient.ts src/lib/local-inference/native/NativeAsrClient.test.ts
git commit -m "refactor(local-native): NativeAsrClient over SidecarConnection"
```

---

### Task 4: Migrate `NativeModelClient`

**Files:**
- Modify: `src/lib/local-inference/native/NativeModelClient.ts`
- Test: `src/lib/local-inference/native/NativeModelClient.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ISidecarConnection`, `SidecarConnection`; `FakeSidecarConnection` (test). Types `ServerMsg, NativeModelState, ModelProgressMsg, ModelDownloadStatus, NativeModelInfo, NativeVoiceInfo, VariantInfo` from `./nativeProtocol`.
- Produces: `NativeModelClient` constructor `new NativeModelClient(conn?: ISidecarConnection)`; public surface unchanged — `status`, `hardwareInfo`, `modelsCatalog`, `listVariants`, `listTtsVoices`, `delete`, `download`, `cancel`, `dispose`. Downloads stay push-routed by model name and are rejected via `onClose`.

- [ ] **Step 1: Write the failing test**

Rewrite `src/lib/local-inference/native/NativeModelClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeModelClient } from './NativeModelClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

// download() awaits conn.connect() before it registers its handle and sends, so
// the register+send land a microtask later — flush before emitting to it.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('NativeModelClient', () => {
  it('status() sends model_status and returns the statuses map', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.status(['sense-voice'], { 'sense-voice': 'repo/x' });
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'model_status', models: ['sense-voice'], repos: { 'sense-voice': 'repo/x' } });
    conn.emit({ type: 'model_status_result', id: sent.id, statuses: { 'sense-voice': 'ready' } });
    await expect(p).resolves.toEqual({ 'sense-voice': 'ready' });
  });

  it('download() streams progress then resolves on model_download_done (push-routed by model)', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const progress: number[] = [];
    const p = c.download('sense-voice', (pr) => progress.push(pr.downloaded));
    await tick();
    expect(conn.sent[0]).toMatchObject({ type: 'model_download', model: 'sense-voice' });
    conn.emit({ type: 'model_progress', model: 'sense-voice', downloaded: 50, total: 100 });
    conn.emit({ type: 'model_download_done', model: 'sense-voice', status: 'ready' });
    await expect(p).resolves.toBe('ready');
    expect(progress).toEqual([50]);
  });

  it('download() rejects when the sidecar errors with the model tag', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.download('sense-voice');
    await tick();
    conn.emit({ type: 'error', model: 'sense-voice', message: 'disk full' });
    await expect(p).rejects.toThrow('disk full');
  });

  it('a socket close rejects an in-flight download via onClose', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.download('sense-voice');
    await tick();
    conn.emitClose();
    await expect(p).rejects.toThrow('native host disconnected');
  });

  it('delete() returns freed bytes', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.delete('sense-voice', 'repo/x');
    conn.emit({ type: 'model_delete_result', id: conn.sent[0].id, model: 'sense-voice', freed: 1234 });
    await expect(p).resolves.toBe(1234);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: FAIL — constructor ignores `conn`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/local-inference/native/NativeModelClient.ts` entirely:

```typescript
import type { ServerMsg, NativeModelState, ModelProgressMsg, ModelDownloadStatus, NativeModelInfo, NativeVoiceInfo, VariantInfo } from './nativeProtocol';
import { SidecarConnection, type ISidecarConnection } from './SidecarConnection';

interface DownloadHandle {
  onProgress?: (p: ModelProgressMsg) => void;
  resolve: (status: ModelDownloadStatus) => void;
  reject: (err: Error) => void;
}

/** Manages native-model download/status against the sidecar (not session-bound). */
export class NativeModelClient {
  private conn: ISidecarConnection;
  // In-flight downloads keyed by model — completion/progress is pushed (not
  // id-matched) so cancel can arrive on the same socket while a download runs.
  private downloads = new Map<string, DownloadHandle>();

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onMessage((msg) => this.onPush(msg));
    // Downloads are client-owned correlation state (push-routed by model), so the
    // connection can't reject them — do it here when the socket drops.
    this.conn.onClose((err) => {
      for (const h of this.downloads.values()) h.reject(err);
      this.downloads.clear();
    });
  }

  private onPush(msg: ServerMsg): void {
    if (msg.type === 'model_progress') { this.downloads.get(msg.model)?.onProgress?.(msg); return; }
    if (msg.type === 'model_download_done') {
      const h = this.downloads.get(msg.model);
      this.downloads.delete(msg.model);
      h?.resolve(msg.status);
      return;
    }
    if (msg.type === 'error' && msg.model && this.downloads.has(msg.model)) {
      const h = this.downloads.get(msg.model)!;
      this.downloads.delete(msg.model);
      h.reject(new Error(msg.message));
    }
  }

  async status(models: string[], repos?: Record<string, string>): Promise<Record<string, NativeModelState>> {
    const msg = await this.conn.request({ type: 'model_status', models, repos });
    return (msg as Extract<ServerMsg, { type: 'model_status_result' }>).statuses;
  }

  /** Query the sidecar for detected hardware (CPU/GPU/NPU + installed backends). */
  async hardwareInfo(): Promise<Extract<ServerMsg, { type: 'hardware_info_result' }>> {
    const msg = await this.conn.request({ type: 'hardware_info' });
    return msg as Extract<ServerMsg, { type: 'hardware_info_result' }>;
  }

  /** Query the per-machine model catalog (languages, recommended, tier availability).
   *  `kind` selects the ASR catalog (default) or the translation catalog — they are
   *  separate model lists sidecar-side, so callers fetch each independently. */
  async modelsCatalog(models?: string[], kind?: 'asr' | 'translate' | 'tts'): Promise<NativeModelInfo[]> {
    const payload: { type: 'models_catalog'; models?: string[]; kind?: 'asr' | 'translate' | 'tts' } = { type: 'models_catalog' };
    if (models) payload.models = models;
    if (kind) payload.kind = kind;
    const msg = await this.conn.request(payload);
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }

  /** Query available variants (quant levels) for a model, with hardware feasibility info. */
  async listVariants(model: string, asrId: string | null, ttsId: string | null, pin?: string)
    : Promise<{ variants: VariantInfo[]; recommended: string }> {
    const payload: { type: 'list_variants'; model: string; asrId?: string; ttsId?: string; pin?: string } = { type: 'list_variants', model };
    if (asrId) payload.asrId = asrId;
    if (ttsId) payload.ttsId = ttsId;
    if (pin) payload.pin = pin;
    const msg = await this.conn.request(payload);
    const r = msg as Extract<ServerMsg, { type: 'list_variants_result' }>;
    return { variants: r.variants, recommended: r.recommended };
  }

  /** Built-in TTS voice descriptors for a voice-capable model (empty if not downloaded). */
  async listTtsVoices(model?: string): Promise<NativeVoiceInfo[]> {
    const payload: { type: 'list_tts_voices'; model?: string } = { type: 'list_tts_voices' };
    if (model) payload.model = model;
    const msg = await this.conn.request(payload);
    return (msg as Extract<ServerMsg, { type: 'list_tts_voices_result' }>).voices;
  }

  /** Remove a model from the sidecar's cache; resolves to the bytes freed. */
  async delete(model: string, repo?: string): Promise<number> {
    const msg = await this.conn.request({ type: 'model_delete', model, repo });
    if (msg.type === 'error') throw new Error(msg.message);
    return (msg as Extract<ServerMsg, { type: 'model_delete_result' }>).freed;
  }

  /** Start a download; resolves 'ready' on completion or 'cancelled' if cancel()
   *  stopped it. Rejects on a sidecar error tagged with this model or on disconnect. */
  async download(model: string, onProgress?: (p: ModelProgressMsg) => void, repo?: string): Promise<ModelDownloadStatus> {
    await this.conn.connect();
    return new Promise<ModelDownloadStatus>((resolve, reject) => {
      this.downloads.set(model, { onProgress, resolve, reject });
      const payload: { type: 'model_download'; model: string; id: number; repo?: string } =
        { type: 'model_download', model, id: this.conn.nextId() };
      if (repo) payload.repo = repo;
      this.conn.send(payload);
    });
  }

  /** Signal an in-flight download to stop at the next file boundary. */
  async cancel(model: string): Promise<void> {
    this.conn.send({ type: 'model_cancel', model, id: this.conn.nextId() });
  }

  dispose(): void {
    for (const h of this.downloads.values()) h.reject(new Error('native host disconnected'));
    this.downloads.clear();
    this.conn.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/NativeModelClient.ts src/lib/local-inference/native/NativeModelClient.test.ts
git commit -m "refactor(local-native): NativeModelClient over SidecarConnection"
```

---

### Task 5: Migrate `NativeTtsClient` (binary pairing + streaming)

**Files:**
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts`
- Test: `src/lib/local-inference/native/NativeTtsClient.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ISidecarConnection`, `SidecarConnection`, `INIT_REQUEST_TIMEOUT_MS`, `SidecarTimeoutError`; `FakeSidecarConnection` (test). `TtsResult` from `../engine/TtsEngine`; `ServerMsg` from `./nativeProtocol`.
- Produces: `NativeTtsClient` constructor `new NativeTtsClient(conn?: ISidecarConnection)`; public surface unchanged — `onStatus/onError`, `TtsReady` export, `init(model?, device?)`, `setVoice`, `setSpeaker`, `setReferenceVoice`, `setStyleVoice`, `generate(text, speed?, onChunk?)`, `cancel()`, `dispose()`. One-shot generate pairs the buffered binary via `onBinary`; streaming generate uses `send()` + an inactivity timeout on `streamDone`.

- [ ] **Step 1: Write the failing test**

Rewrite `src/lib/local-inference/native/NativeTtsClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

async function initClient(conn: FakeSidecarConnection, streaming: boolean) {
  const c = new NativeTtsClient(conn);
  const p = c.init('moss', 'cpu');
  conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'moss_onnx', rtf: 0.44, streaming, clones: streaming });
  await p;
  return c;
}

describe('NativeTtsClient one-shot', () => {
  it('generate() pairs the buffered binary with the result reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, false);
    const genP = c.generate('hi', 1.0);
    const genSent = conn.sent.find((m) => m.type === 'tts_generate');
    expect(genSent).toBeTruthy();
    // Sidecar sends the PCM binary frame BEFORE the result meta.
    const pcm = new Int16Array([16384, 16384, 16384]);
    conn.emitBinary(pcm.buffer);
    conn.emit({ type: 'result', id: genSent.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 });
    const res = await genP;
    expect(res.sampleRate).toBe(24000);
    expect(res.generationTimeMs).toBe(7);
    expect(res.samples.length).toBe(3);
    expect(res.samples[0]).toBeCloseTo(0.5, 2);
  });
});

describe('NativeTtsClient streaming', () => {
  it('generate() emits each chunk and resolves on tts_done', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const chunks: number[] = [];
    const genP = c.generate('hi', 1.0, (pcm, seq) => { chunks.push(seq); void pcm; });
    const genSent = conn.sent.find((m) => m.type === 'tts_generate');
    const id = genSent.id;
    for (let i = 0; i < 3; i++) {
      conn.emitBinary(new Int16Array([i, i, i]).buffer);
      conn.emit({ type: 'tts_chunk', id, seq: i });
    }
    conn.emit({ type: 'tts_done', id, totalSamples: 9, generationTimeMs: 20 });
    const res = await genP;
    expect(chunks).toEqual([0, 1, 2]);
    expect(res.generationTimeMs).toBe(20);
  });

  it('streaming generate() rejects if the socket closes mid-stream', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const genP = c.generate('hi', 1.0, () => {});
    conn.emitClose();
    await expect(genP).rejects.toThrow('native host disconnected');
  });
});

describe('NativeTtsClient voice selection', () => {
  it('setReferenceVoice() sends the clip binary before the set_voice control message', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const clip = new Float32Array([0.1, 0.2]);
    const p = c.setReferenceVoice(clip, 24000, 'hello');
    expect(conn.binarySent[0]).toBe(clip.buffer);
    const setSent = conn.sent.find((m) => m.type === 'set_voice');
    expect(setSent).toMatchObject({ type: 'set_voice', sampleRate: 24000, refText: 'hello' });
    conn.emit({ type: 'ok', id: setSent.id });
    await expect(p).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: FAIL — constructor ignores `conn`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/local-inference/native/NativeTtsClient.ts` entirely:

```typescript
import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, SidecarTimeoutError, type ISidecarConnection } from './SidecarConnection';

/** Reject a streaming generate if no chunk/done arrives for this long (inactivity). */
const TTS_STREAM_INACTIVITY_MS = 30_000;

/**
 * The sidecar emits binary PCM as Int16 mono @ 24 kHz.
 * Convert Int16 bytes to Float32 samples (range [-1, 1]).
 */
function int16ToFloat32(buf: ArrayBuffer): Float32Array {
  const i16 = new Int16Array(buf);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

export interface TtsReady {
  sampleRate: number; loadTimeMs: number;
  backend?: string; device?: string; computeType?: string; rtf?: number;
  streaming: boolean; clones: boolean; memoryBytes?: number; fallbackReason?: string;
}

interface StreamDone { resolve: (m: ServerMsg) => void; reject: (e: Error) => void; bump: () => void; }

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;
  private lastBinary: ArrayBuffer | null = null;
  private streamHandlers = new Map<number, (pcm: Float32Array, seq: number) => void>();
  private streamDone = new Map<number, StreamDone>();
  private streaming = false;          // cached from the last init()
  private inFlightId = 0;             // id of the current generate (for cancel())

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onBinary((buf) => { this.lastBinary = buf; });
    this.conn.onMessage((msg) => this.onPush(msg));
    // Streaming generate is client-owned correlation state (uses send(), not
    // request()), so the connection can't reject it — do it here on disconnect.
    this.conn.onClose((err) => this.rejectStreams(err));
  }

  private onPush(msg: ServerMsg): void {
    const id = (msg as { id?: number }).id;
    if (msg.type === 'tts_chunk') {
      this.streamDone.get(id as number)?.bump();
      const onChunk = this.streamHandlers.get(id as number);
      if (onChunk && this.lastBinary) { onChunk(int16ToFloat32(this.lastBinary), msg.seq); this.lastBinary = null; }
      return;
    }
    if (msg.type === 'tts_done') {
      this.streamHandlers.delete(id as number);
      const d = this.streamDone.get(id as number);
      this.streamDone.delete(id as number);
      d?.resolve(msg);
      return;
    }
    if (msg.type === 'error') {
      this.onError?.(msg.message);
      if (typeof id === 'number' && this.streamDone.has(id)) {
        const d = this.streamDone.get(id)!;
        this.streamDone.delete(id); this.streamHandlers.delete(id);
        d.reject(new Error(msg.message));
      }
    }
  }

  private rejectStreams(err: Error): void {
    for (const d of this.streamDone.values()) d.reject(err);
    this.streamDone.clear(); this.streamHandlers.clear(); this.lastBinary = null;
  }

  async init(model?: string, device?: string): Promise<TtsReady> {
    this.onStatus?.('[native-tts] init…');
    const msg = await this.conn.request({ type: 'tts_init', model, device }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    this.streaming = !!r.streaming;
    return {
      sampleRate: r.sampleRate ?? 24000, loadTimeMs: r.loadTimeMs,
      backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf,
      streaming: !!r.streaming, clones: !!r.clones, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason,
    };
  }

  /** Select a built-in voice by name (applies to subsequent generate calls). */
  async setVoice(name: string): Promise<void> { await this.conn.request({ type: 'set_voice', voice: name }); }

  /** Select a numeric speaker id (range models). */
  async setSpeaker(sid: number): Promise<void> { await this.conn.request({ type: 'set_voice', sid }); }

  async setReferenceVoice(audio: Float32Array, sampleRate: number, refText?: string): Promise<void> {
    this.conn.sendBinary(audio.buffer);                  // binary frame precedes the control message
    await this.conn.request({ type: 'set_voice', sampleRate, ...(refText ? { refText } : {}) });
  }

  /** Select a style-cloned voice (e.g. Supertonic) from precomputed style-conditioning vectors. */
  async setStyleVoice(styleTtl: { dims: number[]; data: number[] },
                      styleDp: { dims: number[]; data: number[] }): Promise<void> {
    // Voice JSON `data` is nested per dims — flatten it (mirrors the WASM worker's
    // jsonToFloat32Tensor) before packing; otherwise Float32Array.from over the outer
    // array yields the wrong length and the sidecar's reshape fails.
    const f32 = (d: number[]) => Float32Array.from((d as unknown[]).flat(Infinity) as number[]);
    const ttl = f32(styleTtl.data), dp = f32(styleDp.data);
    const buf = new Float32Array(ttl.length + dp.length);
    buf.set(ttl, 0); buf.set(dp, ttl.length);
    this.conn.sendBinary(buf.buffer);                    // binary frame precedes the control message
    await this.conn.request({ type: 'set_voice', styleVoice: { ttlDims: styleTtl.dims, dpDims: styleDp.dims } });
  }

  async generate(text: string, speed = 1.0, onChunk?: (pcm: Float32Array, seq: number) => void): Promise<TtsResult> {
    if (this.streaming && onChunk) {
      const id = this.conn.nextId();
      this.inFlightId = id;
      this.streamHandlers.set(id, onChunk);
      const done = await new Promise<ServerMsg>((resolve, reject) => {
        // Inactivity timeout: reset on each chunk (bump), so a long-but-progressing
        // stream isn't killed but a silent hang is bounded. Arrow fns keep `this`.
        let timer: ReturnType<typeof setTimeout>;
        const clear = () => clearTimeout(timer);
        const arm = () => { timer = setTimeout(() => {
          this.streamDone.delete(id); this.streamHandlers.delete(id);
          reject(new SidecarTimeoutError('tts_generate', TTS_STREAM_INACTIVITY_MS));
        }, TTS_STREAM_INACTIVITY_MS); };
        arm();
        this.streamDone.set(id, {
          resolve: (m) => { clear(); resolve(m); },
          reject: (e) => { clear(); reject(e); },
          bump: () => { clear(); arm(); },
        });
        this.conn.send({ type: 'tts_generate', text, speed, id });
      });
      const d = done as Extract<ServerMsg, { type: 'tts_done' }>;
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: d.generationTimeMs };
    }
    // One-shot: the sidecar sends the PCM binary frame, then the result meta.
    const id = this.conn.nextId();
    this.inFlightId = id;
    this.lastBinary = null;
    const msg = await this.conn.request({ type: 'tts_generate', text, speed }, { id });
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
    const binary = this.lastBinary; this.lastBinary = null;
    return { samples: int16ToFloat32(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  cancel(): void {
    if (this.inFlightId) this.conn.send({ type: 'tts_cancel', id: this.inFlightId });
  }

  dispose(): void {
    this.rejectStreams(new Error('native host disconnected'));
    this.conn.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/NativeTtsClient.ts src/lib/local-inference/native/NativeTtsClient.test.ts
git commit -m "refactor(local-native): NativeTtsClient over SidecarConnection"
```

---

### Task 6: Full-suite verification

**Files:** none changed — this task proves the refactor is behavior-preserving end-to-end.

**Interfaces:**
- Consumes: everything from Tasks 1–5. Confirms `LocalNativeClient` (which default-constructs the clients with no `conn` arg) and its 797-line test still pass untouched.

- [ ] **Step 1: Run the full native + client suite**

Run:
```bash
npx vitest run src/lib/local-inference/native src/services/clients/LocalNativeClient.test.ts src/services/providers/localNativeGating.test.ts
```
Expected: PASS. Confirm specifically that `LocalNativeClient.test.ts` passes with **zero changes** (it injects client-level stubs via `Deps`, unaffected by the transport change), and that no `FakeWS` class remains in any `native/*.test.ts` except inside `SidecarConnection.test.ts`.

- [ ] **Step 2: Grep to confirm the duplication is gone**

Run:
```bash
grep -rn "new WebSocket\|window.electron" src/lib/local-inference/native/*.ts | grep -v ".test.ts"
```
Expected: matches ONLY in `SidecarConnection.ts`. Zero matches in the four client files (transport fully centralized).

Run:
```bash
grep -rln "class FakeWS" src/lib/local-inference/native/
```
Expected: only `SidecarConnection.test.ts`.

- [ ] **Step 3: Run the whole test suite once**

Run: `npx vitest run`
Expected: PASS (no regressions outside the native lane).

- [ ] **Step 4: Commit (if any incidental fixups were needed)**

```bash
git add -A
git commit -m "test(local-native): verify SidecarConnection refactor is behavior-preserving" --allow-empty
```

---

## Self-Review

**Spec coverage (grilling decisions → tasks):**
- Q1 scope (renderer-only, 4 sockets, no wire change) → Global Constraints; Task 6 grep proves transport centralized without touching Python.
- Q2 thin pipe (request/send/sendBinary/onMessage/onBinary + id-routing rule) → Task 1 interface + `onSocketMessage`.
- Q3 two-tier timeout (30s / 120s, downloads exempt, typed error, keep socket, ignore late reply) → Task 1 `request()` + timeout tests; init sites pass `INIT_REQUEST_TIMEOUT_MS` (Tasks 2/3/5).
- Q4 interface seam + per-client DI + shared FakeSidecarConnection → Task 1 `ISidecarConnection`, Task 2 helper, Tasks 2–5 constructors.
- Q5 no reconnect, reject-all-on-close, request() auto-ensureConnected, send/sendBinary no-op if closed → Task 1 `_connect` onclose, `request` calls `connect()`, `send`/`sendBinary` readyState guards.
- Q6 order (connection → translate → asr → model → tts) + F4 deferred → Task ordering; no `result` rename anywhere.
- `onClose` + client-owned state rejection (TTS streamDone, Model downloads) → Tasks 4/5.

**Placeholder scan:** none — every module and test file is written in full; commands have exact expected output.

**Type consistency:** `request(payload, { timeoutMs?, id? })`, `nextId()`, `onMessage/onBinary/onClose`, `dispose()` are used identically in `SidecarConnection`, `FakeSidecarConnection`, and all four clients. `INIT_REQUEST_TIMEOUT_MS` imported from `./SidecarConnection` at every init site. Disconnect string is `'native host disconnected'` everywhere (matches the surviving assertions).

**Behavior-change note (intentional, benign):** id-carrying error replies now reject the `request()` promise only — they no longer *also* fire the client's `onError` callback (id-less errors still do). Every caller that cared already routes rejections to `handlers.onError` (`LocalNativeClient.runJob` catch at `:310`, TTS init try/catch at `:160`). No existing test asserts the old double-signal; Task 6 confirms the suite stays green.
