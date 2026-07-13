# WASM Engine WorkerSession (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Worker lifecycle copied verbatim across the 4 WASM local-inference engines into a composed `WorkerSession`, and the id-keyed request correlation into a `RequestRegistry`, so all 4 engines share one tested seam instead of four hand-rolled copies — behavior-preserving, guarded by characterization tests written first.

**Architecture:** Two new units under `src/lib/local-inference/engine/`: `WorkerSession` (lifecycle only — synchronous worker creation, init handshake, revoke-blobs-once-on-first-settle, `onerror`, `dispose` core, `post`) and `RequestRegistry<T>` (id→{resolve,reject} map + reject-all). Each engine *composes* them (no inheritance), keeping its own `workerType` switch, init-payload building, and domain message routing. `TranslationEngine` uses `RequestRegistry`; `TtsEngine` keeps its bespoke single-slot pending + edge-TTS. Every engine is put under characterization tests (public-API, `MockWorker`-injected) that pass on the current code, then stay green across the extraction.

**Tech Stack:** TypeScript, Vitest (jsdom), Web Workers, `ModelManager` (blob-URL provider).

## Global Constraints

- **WASM side only.** Touch only `src/lib/local-inference/engine/*` and its tests. Do NOT touch `nativeModelStore`, the Python sidecar, the workers, or `_shared/`.
- **Behavior-preserving.** Public-API behavior of every engine (`init`/`feedAudio`/`flush`/`translate`/`generate`/`generateStream`/`dispose` + callbacks/promises) is unchanged. The characterization tests are the contract.
- **No wire-protocol change.** Message shapes posted to / received from workers are unchanged. `WorkerSession` posts the init message verbatim and forwards non-handshake messages untouched.
- **Supertonic single-await.** `TtsEngine` must still create the `Worker` within one microtask of finishing its blob-load await. `WorkerSession` creates the worker **synchronously in its constructor**, so the engine does `await <blobs>` then `new WorkerSession(...)` with no await between.
- **`StreamingAsrEngine` reorder is allowed & must be documented.** It currently creates the worker *before* loading blobs; it is reordered to load-blobs-first (like the other 3) so it can construct `WorkerSession` synchronously. Safe: the worker is idle until `init`.
- **Revoke-once semantics.** Blob URLs are revoked exactly once, on the first settle (`ready`, or a pre-ready `error`/`onerror`). Post-ready errors do not re-revoke. `WorkerSession` centralizes this via a `revokeBlobs` thunk the engine supplies (edge-TTS supplies a no-op — nothing to revoke).
- English-only comments. Conventional commits. Commit after every task.
- Tests must pass on the **current** engine code first (characterization), then again after the refactor. Run the focused engine test during iteration; run `npm run test -- --run` before each commit.

The 4 engines and their shape:

| Engine | Request model | Blob-load order | Extra dispose cleanup |
|---|---|---|---|
| `AsrEngine` | callbacks | blobs before worker | — |
| `StreamingAsrEngine` | callbacks | worker before blobs (→ reorder) | — |
| `TranslationEngine` | id-keyed `Map` → `RequestRegistry` | blobs before worker | `setBingTranslatorDNR(false)` |
| `TtsEngine` | single-slot `pendingGenerate`/`pendingStream` + edge-TTS | blobs before worker | `edgeTtsConnection.dispose()` |

---

### Task 1: `RequestRegistry<T>` + unit tests

**Files:**
- Create: `src/lib/local-inference/engine/RequestRegistry.ts`
- Test: `src/lib/local-inference/engine/RequestRegistry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class RequestRegistry<T> { create(id: string): Promise<T>; resolve(id: string, value: T): void; reject(id: string, error: Error): void; rejectAll(error: Error): void; readonly size: number }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/engine/RequestRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RequestRegistry } from './RequestRegistry';

describe('RequestRegistry', () => {
  it('resolves the pending promise for a matching id', async () => {
    const r = new RequestRegistry<string>();
    const p = r.create('a');
    r.resolve('a', 'done');
    await expect(p).resolves.toBe('done');
    expect(r.size).toBe(0); // settled entries are removed
  });

  it('rejects the pending promise for a matching id', async () => {
    const r = new RequestRegistry<string>();
    const p = r.create('a');
    r.reject('a', new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(r.size).toBe(0);
  });

  it('resolve/reject for an unknown id is a no-op', () => {
    const r = new RequestRegistry<string>();
    expect(() => r.resolve('missing', 'x')).not.toThrow();
    expect(() => r.reject('missing', new Error('x'))).not.toThrow();
    expect(r.size).toBe(0);
  });

  it('tracks multiple concurrent pending requests independently', async () => {
    const r = new RequestRegistry<number>();
    const a = r.create('a');
    const b = r.create('b');
    expect(r.size).toBe(2);
    r.resolve('b', 2);
    r.resolve('a', 1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    expect(r.size).toBe(0);
  });

  it('rejectAll rejects every pending request and clears the map', async () => {
    const r = new RequestRegistry<number>();
    const a = r.create('a');
    const b = r.create('b');
    r.rejectAll(new Error('disposed'));
    await expect(a).rejects.toThrow('disposed');
    await expect(b).rejects.toThrow('disposed');
    expect(r.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/lib/local-inference/engine/RequestRegistry.test.ts`
Expected: FAIL — `Failed to resolve import "./RequestRegistry"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/local-inference/engine/RequestRegistry.ts`:

```ts
/**
 * Correlates worker responses to their awaiting callers by request id.
 * Extracted from TranslationEngine's hand-rolled `pendingRequests` map so the
 * id→{resolve,reject} bookkeeping (and reject-all-on-dispose) lives in one
 * tested place. Settled entries are removed so `size` reflects only in-flight
 * requests.
 */
export class RequestRegistry<T> {
  private readonly pending = new Map<string, { resolve: (v: T) => void; reject: (e: Error) => void }>();

  /** Register a request id and return a promise settled by resolve()/reject(). */
  create(id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  resolve(id: string, value: T): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(value);
  }

  reject(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.reject(error);
  }

  /** Reject every in-flight request (used on dispose) and clear the map. */
  rejectAll(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/lib/local-inference/engine/RequestRegistry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/RequestRegistry.ts src/lib/local-inference/engine/RequestRegistry.test.ts
git commit -m "feat(local-inference): RequestRegistry for engine request/response correlation"
```

---

### Task 2: `WorkerSession` + shared `MockWorker` test helper + unit tests

**Files:**
- Create: `src/lib/local-inference/engine/WorkerSession.ts`
- Create: `src/lib/local-inference/engine/testing/mockWorker.ts` (test-only helper, imported by this and later tasks)
- Test: `src/lib/local-inference/engine/WorkerSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface WorkerSessionOptions { makeWorker: () => Worker; onMessage: (msg: any) => void; revokeBlobs?: () => void; onFatalError?: (message: string) => void }`
  - `class WorkerSession { constructor(opts: WorkerSessionOptions); start(initMessage: object, transfer?: Transferable[]): Promise<any>; post(msg: object, transfer?: Transferable[]): void; dispose(): void; get ready(): boolean }`
  - `class MockWorker` with `static instances`, `static last()`, `static reset()`, `emit(data)`, `emitError(message)`, spied `postMessage`/`terminate`; and `installMockWorker(): () => void` that swaps `globalThis.Worker` and returns a restore fn.

- [ ] **Step 1: Write the shared MockWorker helper**

Create `src/lib/local-inference/engine/testing/mockWorker.ts`:

```ts
import { vi } from 'vitest';

/** A drop-in stand-in for the DOM Worker, capturing postMessage and letting
 *  tests drive onmessage/onerror. Used by WorkerSession unit tests (via
 *  `makeWorker: () => new MockWorker(...)`) and by engine characterization
 *  tests (via `installMockWorker()`, which patches globalThis.Worker). */
export class MockWorker {
  static instances: MockWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  constructor(public url: string | URL, public opts?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  /** Simulate a message from the worker to the main thread. */
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  /** Simulate a worker-level error event. */
  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  static last(): MockWorker {
    return MockWorker.instances[MockWorker.instances.length - 1];
  }

  static reset(): void {
    MockWorker.instances = [];
  }
}

/** Patch globalThis.Worker with MockWorker. Returns a restore function. */
export function installMockWorker(): () => void {
  const original = (globalThis as any).Worker;
  MockWorker.reset();
  (globalThis as any).Worker = MockWorker;
  return () => { (globalThis as any).Worker = original; };
}
```

- [ ] **Step 2: Write the failing WorkerSession test**

Create `src/lib/local-inference/engine/WorkerSession.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { WorkerSession } from './WorkerSession';
import { MockWorker } from './testing/mockWorker';

function makeSession(over: Partial<{
  onMessage: (m: any) => void; revokeBlobs: () => void; onFatalError: (m: string) => void;
}> = {}) {
  const worker = new MockWorker('x');
  const session = new WorkerSession({
    makeWorker: () => worker as unknown as Worker,
    onMessage: over.onMessage ?? vi.fn(),
    revokeBlobs: over.revokeBlobs,
    onFatalError: over.onFatalError,
  });
  return { worker, session };
}

describe('WorkerSession', () => {
  it('creates the worker synchronously in the constructor', () => {
    const worker = new MockWorker('x');
    const makeWorker = vi.fn(() => worker as unknown as Worker);
    new WorkerSession({ makeWorker, onMessage: vi.fn() });
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });

  it('start() posts the init message and resolves on ready, revoking once', async () => {
    const revokeBlobs = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs });
    const p = session.start({ type: 'init', fileUrls: {} });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', fileUrls: {} });
    expect(session.ready).toBe(false);
    worker.emit({ type: 'ready', loadTimeMs: 42 });
    await expect(p).resolves.toEqual({ type: 'ready', loadTimeMs: 42 });
    expect(session.ready).toBe(true);
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('rejects and revokes once on a pre-ready error message (and fires onFatalError)', async () => {
    const revokeBlobs = vi.fn();
    const onFatalError = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs, onFatalError });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'error', error: 'load failed' });
    await expect(p).rejects.toThrow('load failed');
    expect(onFatalError).toHaveBeenCalledWith('load failed');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });

  it('rejects and revokes once on a pre-ready worker onerror', async () => {
    const revokeBlobs = vi.fn();
    const onFatalError = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs, onFatalError });
    const p = session.start({ type: 'init' });
    worker.emitError('worker crashed');
    await expect(p).rejects.toThrow('worker crashed');
    expect(onFatalError).toHaveBeenCalledWith('worker crashed');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('routes non-handshake messages to onMessage (including post-ready errors), no re-revoke', async () => {
    const onMessage = vi.fn();
    const revokeBlobs = vi.fn();
    const { worker, session } = makeSession({ onMessage, revokeBlobs });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'status', message: 'loading' });   // pre-ready status → routed
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    worker.emit({ type: 'result', text: 'hi' });           // post-ready → routed
    worker.emit({ type: 'error', id: 'r1', error: 'req failed' }); // post-ready error → routed
    expect(onMessage).toHaveBeenCalledWith({ type: 'status', message: 'loading' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'result', text: 'hi' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'error', id: 'r1', error: 'req failed' });
    expect(revokeBlobs).toHaveBeenCalledTimes(1); // only the ready settle revoked
  });

  it('post-ready onerror fires onFatalError but does not reject/re-revoke', async () => {
    const onFatalError = vi.fn();
    const revokeBlobs = vi.fn();
    const { worker, session } = makeSession({ onFatalError, revokeBlobs });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    worker.emitError('late error');
    expect(onFatalError).toHaveBeenCalledWith('late error');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('post() forwards a message, with transfer list when provided', () => {
    const { worker, session } = makeSession();
    const buf = new ArrayBuffer(8);
    session.post({ type: 'audio', samples: 1 }, [buf]);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio', samples: 1 }, [buf]);
    session.post({ type: 'flush' });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'flush' });
  });

  it('dispose() posts dispose, terminates, and clears ready', async () => {
    const { worker, session } = makeSession();
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    session.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --run src/lib/local-inference/engine/WorkerSession.test.ts`
Expected: FAIL — `Failed to resolve import "./WorkerSession"`.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/local-inference/engine/WorkerSession.ts`:

```ts
/**
 * WorkerSession — the Worker lifecycle shared by all WASM local-inference
 * engines, extracted from four verbatim copies. It owns ONLY lifecycle:
 * synchronous worker creation, the init handshake (post init → await 'ready' /
 * reject on pre-ready 'error'/onerror), revoke-blobs-once-on-first-settle, the
 * onerror path, dispose, and post(). It has zero domain knowledge — the engine
 * supplies `onMessage` for its domain messages and `revokeBlobs`/`onFatalError`.
 *
 * Creating the worker in the constructor (not inside an awaited step) is what
 * honors TtsEngine's supertonic constraint: the engine awaits its blobs, then
 * `new WorkerSession(...)` creates the worker in the same microtask.
 */
export interface WorkerSessionOptions {
  /** Create the Worker. Called synchronously in the constructor. */
  makeWorker: () => Worker;
  /** Every message except the init-handshake 'ready'/'error' (status, partial,
   *  result, audio-chunk, disposed, and POST-ready errors). */
  onMessage: (msg: any) => void;
  /** Called exactly once, on the first settle. Omit when there is nothing to
   *  revoke (e.g. edge-TTS). */
  revokeBlobs?: () => void;
  /** Worker-level failure: the pre-ready 'error' message, and any onerror
   *  event (pre- or post-ready). Mirrors each engine's `onError` callback. */
  onFatalError?: (message: string) => void;
}

export class WorkerSession {
  private readonly worker: Worker;
  private settled = false;
  private revoked = false;
  private _ready = false;
  private resolveReady: ((msg: any) => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;

  constructor(private readonly opts: WorkerSessionOptions) {
    this.worker = opts.makeWorker();
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
    this.worker.onerror = (e: ErrorEvent) => this.handleError(e.message || 'Worker error');
  }

  /** Post the init message and resolve when the worker reports 'ready'
   *  (reject on a pre-ready 'error' message or onerror). */
  start(initMessage: object, transfer?: Transferable[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.post(initMessage, transfer);
    });
  }

  post(msg: object, transfer?: Transferable[]): void {
    if (transfer && transfer.length) this.worker.postMessage(msg, transfer);
    else this.worker.postMessage(msg);
  }

  get ready(): boolean {
    return this._ready;
  }

  dispose(): void {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this._ready = false;
  }

  private handleMessage(msg: any): void {
    if (!this.settled && msg?.type === 'ready') {
      this.settled = true;
      this._ready = true;
      this.revokeOnce();
      this.resolveReady?.(msg);
      return;
    }
    if (!this.settled && msg?.type === 'error') {
      this.settled = true;
      this.revokeOnce();
      this.opts.onFatalError?.(msg.error);
      this.rejectReady?.(new Error(msg.error));
      return;
    }
    this.opts.onMessage(msg);
  }

  private handleError(message: string): void {
    this.opts.onFatalError?.(message);
    if (!this.settled) {
      this.settled = true;
      this.revokeOnce();
      this.rejectReady?.(new Error(message));
    }
  }

  private revokeOnce(): void {
    if (this.revoked) return;
    this.revoked = true;
    this.opts.revokeBlobs?.();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --run src/lib/local-inference/engine/WorkerSession.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/engine/WorkerSession.ts src/lib/local-inference/engine/testing/mockWorker.ts src/lib/local-inference/engine/WorkerSession.test.ts
git commit -m "feat(local-inference): WorkerSession lifecycle seam + MockWorker test helper"
```

---

### Task 3: `AsrEngine` characterization tests

**Files:**
- Test: `src/lib/local-inference/engine/AsrEngine.test.ts`

**Interfaces:**
- Consumes: `MockWorker`, `installMockWorker` from Task 2.
- Produces: nothing (tests only). These pin `AsrEngine`'s public behavior and MUST pass on the current (pre-refactor) code.

Context for the implementer: `AsrEngine.init(modelId)` loads blob URLs via `ModelManager` (mock it), creates a `Worker`, wires `onmessage`/`onerror`, posts an init message, and resolves `{loadTimeMs}` on the worker's `ready`. On `ready` it also calls `ModelManager.revokeBlobUrls(fileUrls)`. `feedAudio`/`flush` post messages only when ready. `dispose` posts `{type:'dispose'}` and terminates. Use a non-webgpu model id so the worker is the module `whisper-webgpu` path OR the default sherpa path — pick `sensevoice-int8` (default sherpa path) to avoid the metadata-fetch branch, OR mock `fetch` for the metadata. This test uses the **sherpa default path**, which requires a `package-metadata.json` blob; mock `fetch` to return `{}`.

- [ ] **Step 1: Write the characterization tests**

Create `src/lib/local-inference/engine/AsrEngine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('AsrEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    // sensevoice-int8 → default sherpa path, which fetches package-metadata.json
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'int8' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      'package-metadata.json': 'blob:meta',
      'sense.onnx': 'blob:model',
    });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('resolves init with loadTimeMs on ready and revokes blob URLs once', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    // Let the pre-worker awaits (isModelReady, getModelBlobUrls, metadata fetch) settle.
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled()); // init posted
    worker.emit({ type: 'ready', loadTimeMs: 7 });
    await expect(initP).resolves.toEqual({ loadTimeMs: 7 });
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('delivers status/speech_start/partial/result via callbacks after ready', async () => {
    const engine = new AsrEngine();
    const onStatus = vi.fn(); const onSpeechStart = vi.fn();
    const onPartial = vi.fn(); const onResult = vi.fn();
    engine.onStatus = onStatus; engine.onSpeechStart = onSpeechStart;
    engine.onPartialResult = onPartial; engine.onResult = onResult;
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.emit({ type: 'status', message: 'loading' });
    worker.emit({ type: 'speech_start' });
    worker.emit({ type: 'partial', text: 'he' });
    worker.emit({ type: 'result', text: 'hello', durationMs: 10, recognitionTimeMs: 5 });
    expect(onStatus).toHaveBeenCalledWith('loading');
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onPartial).toHaveBeenCalledWith('he');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', durationMs: 10, recognitionTimeMs: 5 }));
  });

  it('rejects init and revokes on a pre-ready error, firing onError', async () => {
    const engine = new AsrEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'bad model' });
    await expect(initP).rejects.toThrow('bad model');
    expect(onError).toHaveBeenCalledWith('bad model');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('feedAudio posts an audio message (transferring the buffer) only when ready', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    const before = new Int16Array([1, 2, 3]);
    engine.feedAudio(before, 24000);            // not ready yet → ignored
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.postMessage.mockClear();
    const samples = new Int16Array([4, 5, 6]);
    engine.feedAudio(samples, 24000);
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'audio', samples, sampleRate: 24000 },
      [samples.buffer],
    );
  });

  it('dispose posts dispose, terminates, and resets ready', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    engine.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(false);
  });
});
```

- [ ] **Step 2: Run against the CURRENT AsrEngine (must pass — this is characterization)**

Run: `npm run test -- --run src/lib/local-inference/engine/AsrEngine.test.ts`
Expected: PASS (5 tests). If a test fails, the assertion doesn't match current behavior — fix the test to reflect what the code actually does (do NOT change `AsrEngine.ts` in this task). If the sherpa metadata path makes an assertion flaky, adjust the `fetch`/`getModelBlobUrls` mocks — the goal is to pin real current behavior.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.test.ts
git commit -m "test(local-inference): characterization tests for AsrEngine (pre-refactor)"
```

---

### Task 4: Refactor `AsrEngine` to compose `WorkerSession`

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts`

**Interfaces:**
- Consumes: `WorkerSession` (Task 2).
- Produces: nothing new (behavior-preserving; the Task 3 tests are the contract).

Recipe (read `AsrEngine.ts` first; keep every public member and all callbacks):

1. Add `import { WorkerSession } from './WorkerSession';`.
2. Replace the private field `private worker: Worker | null = null;` with `private session: WorkerSession | null = null;`. Keep `isReady`? Remove it — derive readiness from the session. Replace `this.isReady` reads with `this.session?.ready ?? false`, and the `get ready()` getter returns `this.session?.ready ?? false`. Keep `private currentModel`.
3. In `init`, keep the pre-Promise blob loading exactly as-is (`isModelReady`, `getModelVariantInfo`, `getModelBlobUrls`, the `workerType` decision, the Cohere language guard). Replace the `return new Promise((resolve, reject) => { ... })` body:
   - Build a `makeWorker` thunk from the existing `switch (workerType)` (each `case` returns the corresponding `new Worker(...)` instead of assigning `this.worker`). Example shape:
     ```ts
     const makeWorker = (): Worker => {
       switch (workerType) {
         case 'whisper-webgpu':
           return new Worker(new URL('../workers/whisper-webgpu.worker.ts', import.meta.url), { type: 'module' });
         case 'cohere-transcribe-webgpu':
           return new Worker(new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url), { type: 'module' });
         case 'voxtral-3b-webgpu':
           return new Worker(new URL('../workers/voxtral-3b-webgpu.worker.ts', import.meta.url), { type: 'module' });
         case 'granite-speech-webgpu':
           return new Worker(new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url), { type: 'module' });
         default:
           return new Worker('./workers/sherpa-onnx-asr.worker.js');
       }
     };
     ```
   - Create the session with a `route` that is the current `onmessage` switch MINUS the `ready`/`error` cases (those move to WorkerSession), MINUS `disposed` (no-op):
     ```ts
     const session = new WorkerSession({
       makeWorker,
       revokeBlobs: () => manager.revokeBlobUrls(fileUrls),
       onFatalError: (message) => this.onError?.(message),
       onMessage: (msg) => {
         switch (msg.type) {
           case 'status': this.onStatus?.(msg.message); break;
           case 'speech_start': this.onSpeechStart?.(); break;
           case 'partial': this.onPartialResult?.(msg.text); break;
           case 'result':
             this.onResult?.({
               text: msg.text,
               startSample: 'startSample' in msg ? msg.startSample : undefined,
               durationMs: msg.durationMs,
               recognitionTimeMs: msg.recognitionTimeMs,
             });
             break;
           case 'error': this.onError?.(msg.error); break;   // post-ready only (pre-ready handled by WorkerSession)
         }
       },
     });
     this.session = session;
     ```
   - Build the init message exactly as the current code posts it (the two webgpu shapes, the granite shape, and the sherpa metadata-fetch shape), then `const ready = await session.start(<initMessage>);` and set `this.currentModel = model;` — but note the sherpa path's metadata fetch is `await`ed *after* `new WorkerSession(...)` (worker already created), then `start(initMessage)`. For the webgpu paths, `start` is called immediately.
   - Replace `resolve({ loadTimeMs: msg.loadTimeMs })` with `return { loadTimeMs: ready.loadTimeMs };` (the method already returns a Promise since it becomes `async` around the session; or keep the `new Promise` wrapper and resolve). **Simplest: make the whole post-blob section `await session.start(...)` and `return { loadTimeMs: ready.loadTimeMs }`** — `init` is already `async`.
   - On init failure, `session.start` rejects (WorkerSession revokes + fires onFatalError). Wrap the sherpa metadata-fetch failure so it still revokes: if `fetch`/metadata throws before `start`, call `manager.revokeBlobUrls(fileUrls)` and rethrow (preserve current behavior at `AsrEngine.ts` where the metadata catch revokes + rejects).
4. `feedAudio`: `if (!this.session?.ready) return; this.session.post({ type: 'audio', samples, sampleRate }, [samples.buffer]);`
5. `flush`: `if (!this.session?.ready) return; this.session.post({ type: 'flush' });`
6. `dispose`: `this.session?.dispose(); this.session = null; this.currentModel = null;`

- [ ] **Step 1: Apply the recipe to `AsrEngine.ts`.**

- [ ] **Step 2: Run the characterization tests (must stay green)**

Run: `npm run test -- --run src/lib/local-inference/engine/AsrEngine.test.ts`
Expected: PASS (all 5 from Task 3, unchanged).

- [ ] **Step 3: Run the full suite**

Run: `npm run test -- --run`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.ts
git commit -m "refactor(local-inference): AsrEngine composes WorkerSession"
```

---

### Task 5: `StreamingAsrEngine` characterization tests

**Files:**
- Test: `src/lib/local-inference/engine/StreamingAsrEngine.test.ts`

**Interfaces:**
- Consumes: `MockWorker`, `installMockWorker` from Task 2.

Context: `StreamingAsrEngine` is callback-based like `AsrEngine` but currently creates the worker *before* loading blobs. Its `ready` (`voxtral-webgpu`) does NOT revoke inside init's inline handler — it wraps `onmessage` to revoke on ready/error. Use a streaming model id: `stream-en-kroko` uses the default sherpa streaming path (metadata fetch); `voxtral-mini-4b-webgpu` uses the module path. This test uses the **voxtral-webgpu path** (no metadata fetch, cleaner). Note the current voxtral path revokes via the onmessage wrapper on ready/error.

- [ ] **Step 1: Write the characterization tests**

Create `src/lib/local-inference/engine/StreamingAsrEngine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingAsrEngine } from './StreamingAsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('StreamingAsrEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'q4' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'model.onnx': 'blob:m' });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'ready', loadTimeMs: 9 });
    await expect(initP).resolves.toEqual({ loadTimeMs: 9 });
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('delivers partial and final results via callbacks', async () => {
    const engine = new StreamingAsrEngine();
    const onPartial = vi.fn(); const onResult = vi.fn();
    engine.onPartialResult = onPartial; engine.onResult = onResult;
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.emit({ type: 'partial', text: 'wor' });
    worker.emit({ type: 'result', text: 'world', durationMs: 8, recognitionTimeMs: 4 });
    expect(onPartial).toHaveBeenCalledWith('wor');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'world', durationMs: 8, recognitionTimeMs: 4 }));
  });

  it('rejects init and revokes on a pre-ready error', async () => {
    const engine = new StreamingAsrEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'stream fail' });
    await expect(initP).rejects.toThrow('stream fail');
    expect(onError).toHaveBeenCalledWith('stream fail');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('feedAudio and flush post only when ready', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.postMessage.mockClear();
    const samples = new Int16Array([1, 2]);
    engine.feedAudio(samples, 24000);
    engine.flush();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio', samples, sampleRate: 24000 }, [samples.buffer]);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'flush' });
  });

  it('dispose posts dispose, terminates, resets ready', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    engine.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(false);
  });
});
```

- [ ] **Step 2: Run against current code (must pass)**

Run: `npm run test -- --run src/lib/local-inference/engine/StreamingAsrEngine.test.ts`
Expected: PASS (5 tests). Adjust mocks/assertions to match real current behavior if needed; do NOT change `StreamingAsrEngine.ts` here.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/StreamingAsrEngine.test.ts
git commit -m "test(local-inference): characterization tests for StreamingAsrEngine (pre-refactor)"
```

---

### Task 6: Refactor `StreamingAsrEngine` to compose `WorkerSession` (with reorder)

**Files:**
- Modify: `src/lib/local-inference/engine/StreamingAsrEngine.ts`

**Interfaces:**
- Consumes: `WorkerSession`.

Recipe (read the file first). This engine currently creates the worker inside `new Promise(async ...)` *before* loading blobs, and wraps `onmessage` to revoke. The refactor **reorders to load-blobs-first** so the session is constructed synchronously (Global Constraint: documented, safe).

1. Add `import { WorkerSession } from './WorkerSession';`. Replace `private worker` with `private session: WorkerSession | null = null;`. Replace `isReady` reads with `this.session?.ready`; `get ready()` returns `this.session?.ready ?? false`.
2. Rewrite `init` to be `async` without the `new Promise(async ...)` wrapper:
   - Compute `workerType`. **Load blobs first** (move the per-branch `isModelReady`/`getModelBlobUrls`/`getModelVariantInfo`/metadata-fetch work to before worker creation), matching each branch:
     - `voxtral-webgpu`: `if (!await manager.isModelReady(modelId)) throw ...; const fileUrls = await manager.getModelBlobUrls(modelId); const { dtype } = await manager.getModelVariantInfo(modelId);`
     - default sherpa: `if (!await manager.isModelReady(modelId)) throw ...; const fileUrls = await manager.getModelBlobUrls(modelId); const metadataBlobUrl = fileUrls['package-metadata.json']; if (!metadataBlobUrl) throw ...; const dataPackageMetadata = await (await fetch(metadataBlobUrl)).json(); const dataFileUrls = <copy without package-metadata.json>;`
   - Build `makeWorker` from the `switch` (return the `new Worker(...)` for each case).
   - `const session = new WorkerSession({ makeWorker, revokeBlobs: () => manager.revokeBlobUrls(fileUrls), onFatalError: (m) => this.onError?.(m), onMessage: (msg) => { switch (msg.type) { case 'status': this.onStatus?.(msg.message); break; case 'speech_start': this.onSpeechStart?.(); break; case 'partial': this.onPartialResult?.(msg.text); break; case 'result': this.onResult?.({ text: msg.text, durationMs: msg.durationMs, recognitionTimeMs: msg.recognitionTimeMs }); break; case 'error': this.onError?.(msg.error); break; } } }); this.session = session;`
   - Build the init message per branch (voxtral shape vs sherpa shape, exactly as currently posted) and `const ready = await session.start(<initMessage>); this.currentModel = model; return { loadTimeMs: ready.loadTimeMs };`
   - Delete the two `onmessage`-wrapper cleanup blocks (revocation now flows through `WorkerSession`'s `revokeBlobs` on first settle — same net behavior).
3. `feedAudio`/`flush`/`dispose`: same shape as Task 4 (`this.session?.ready` guards; `this.session.post(...)`; `dispose` → `this.session?.dispose(); this.session = null; this.currentModel = null;`).

- [ ] **Step 1: Apply the recipe.**

- [ ] **Step 2: Characterization tests stay green**

Run: `npm run test -- --run src/lib/local-inference/engine/StreamingAsrEngine.test.ts`
Expected: PASS (all 5).

- [ ] **Step 3: Full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/StreamingAsrEngine.ts
git commit -m "refactor(local-inference): StreamingAsrEngine composes WorkerSession (load blobs before worker)"
```

---

### Task 7: `TranslationEngine` characterization tests

**Files:**
- Test: `src/lib/local-inference/engine/TranslationEngine.test.ts`

Context: `TranslationEngine` is request/response — `translate(text, systemPrompt, wrapTranscript)` returns a Promise correlated by an id (`tr_N`). Results arrive as `{type:'result', id, ...}`; id'd errors reject that request; dispose rejects all pending. It also toggles Bing DNR for the `bing` worker (skip that path — use the default `opus-mt` path). Use a translation model that resolves to `opus-mt` (e.g. `opus-mt-ja-en`). Its init loads blobs before the worker.

- [ ] **Step 1: Write the characterization tests**

Create `src/lib/local-inference/engine/TranslationEngine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranslationEngine } from './TranslationEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

async function initReady(engine: TranslationEngine, model = 'opus-mt-ja-en') {
  const initP = engine.init('ja', 'en', model);
  await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
  const worker = MockWorker.last();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  worker.emit({ type: 'ready', loadTimeMs: 3, device: 'wasm' });
  await initP;
  return worker;
}

describe('TranslationEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'default' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'config.json': 'blob:c' });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new TranslationEngine();
    await initReady(engine);
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('translate() correlates the result by id', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const p = engine.translate('こんにちは', 'sys', true);
    // capture the id the engine assigned
    const sent = worker.postMessage.mock.calls[0][0] as any;
    expect(sent.type).toBe('translate');
    worker.emit({ type: 'result', id: sent.id, sourceText: 'こんにちは', translatedText: 'hello', inferenceTimeMs: 12 });
    await expect(p).resolves.toEqual(expect.objectContaining({ translatedText: 'hello', inferenceTimeMs: 12 }));
  });

  it('an id-scoped error rejects only that request', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const p = engine.translate('x', 'sys', false);
    const sent = worker.postMessage.mock.calls[0][0] as any;
    worker.emit({ type: 'error', id: sent.id, error: 'translate failed' });
    await expect(p).rejects.toThrow('translate failed');
  });

  it('dispose rejects all pending translate() promises and posts dispose', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    const p1 = engine.translate('a', 's', false);
    const p2 = engine.translate('b', 's', false);
    engine.dispose();
    await expect(p1).rejects.toThrow(/disposed/i);
    await expect(p2).rejects.toThrow(/disposed/i);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects init and revokes on a pre-ready error', async () => {
    const engine = new TranslationEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('ja', 'en', 'opus-mt-ja-en');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'model load failed' });
    await expect(initP).rejects.toThrow('model load failed');
    expect(onError).toHaveBeenCalledWith('model load failed');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run against current code (must pass)**

Run: `npm run test -- --run src/lib/local-inference/engine/TranslationEngine.test.ts`
Expected: PASS (5). Adjust to match real current behavior if a message field differs; do NOT change `TranslationEngine.ts` here.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.test.ts
git commit -m "test(local-inference): characterization tests for TranslationEngine (pre-refactor)"
```

---

### Task 8: Refactor `TranslationEngine` to compose `WorkerSession` + `RequestRegistry`

**Files:**
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts`

**Interfaces:**
- Consumes: `WorkerSession` (Task 2), `RequestRegistry` (Task 1).

Recipe (read the file first):

1. Add `import { WorkerSession } from './WorkerSession';` and `import { RequestRegistry } from './RequestRegistry';`.
2. Replace `private worker` with `private session: WorkerSession | null = null;`. Replace `private pendingRequests = new Map<...>()` with `private readonly reqs = new RequestRegistry<TranslationResult>();`. Keep `requestCounter`, `sourceLang`, `targetLang`, `currentModelId`, `bingDnrActive`. Replace `isReady` reads with `this.session?.ready`.
3. Keep the pre-Promise blob loading + the Bing DNR pre-step exactly as-is. In the `new Promise` body:
   - `makeWorker` from the `switch (workerType)` (each case returns its `new Worker(...)`).
   - `const session = new WorkerSession({ makeWorker, revokeBlobs: () => manager.revokeBlobUrls(fileUrls), onFatalError: (m) => this.onError?.(m), onMessage: (msg) => this.route(msg) }); this.session = session;`
   - `const ready = await session.start({ type: 'init', hfModelId: entry.hfModelId, fileUrls, sourceLang, targetLang, dtype, ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href }); this.currentModelId = modelCacheKey; return { loadTimeMs: ready.loadTimeMs, device: ready.device || 'wasm' };`
4. Add a private `route(msg)` method carrying the current onmessage's non-handshake cases:
   ```ts
   private route(msg: any): void {
     switch (msg.type) {
       case 'result':
         this.reqs.resolve(msg.id, {
           sourceText: msg.sourceText, translatedText: msg.translatedText,
           inferenceTimeMs: msg.inferenceTimeMs, systemPrompt: msg.systemPrompt,
         });
         break;
       case 'error':
         if (msg.id) this.reqs.reject(msg.id, new Error(msg.error));
         else this.onError?.(msg.error);   // post-ready fatal (pre-ready handled by WorkerSession)
         break;
     }
   }
   ```
5. `translate`: keep the id assignment; replace the pending-map set + postMessage with the registry + session:
   ```ts
   const id = `tr_${++this.requestCounter}`;
   const p = this.reqs.create(id);
   this.session!.post({ type: 'translate', id, text, sourceLang: this.sourceLang, targetLang: this.targetLang, systemPrompt, wrapTranscript });
   return p;
   ```
   (keep the `if (!this.session?.ready) throw ...` guard at the top.)
6. `dispose`: `this.session?.dispose(); this.session = null;` + keep the Bing DNR teardown; replace the pending-reject loop with `this.reqs.rejectAll(new Error('TranslationEngine disposed'));`; reset `currentModelId`/`sourceLang`/`targetLang`.

- [ ] **Step 1: Apply the recipe.**

- [ ] **Step 2: Characterization tests stay green**

Run: `npm run test -- --run src/lib/local-inference/engine/TranslationEngine.test.ts`
Expected: PASS (all 5).

- [ ] **Step 3: Full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.ts
git commit -m "refactor(local-inference): TranslationEngine composes WorkerSession + RequestRegistry"
```

---

### Task 9: `TtsEngine` characterization tests

**Files:**
- Test: `src/lib/local-inference/engine/TtsEngine.test.ts`

Context: `TtsEngine` is single-slot request/response — `generate(text,sid,speed)` resolves on `{type:'result'}`; `generateStream(...)` streams `audio-chunk` via an `onChunk` and resolves on `audio-done`; only one in flight at a time (guards throw if already pending). It also has an edge-TTS non-worker path (skip it). Use the **supertonic** model (`supertonic-3`) — the existing `TtsEngine.supertonic.test.ts` shows the exact `ModelManager`/`voiceStorage` mocks needed. This new test focuses on the generic lifecycle + generate + stream + dispose behaviors (the supertonic test already covers the single-await construction ordering — do not duplicate it).

- [ ] **Step 1: Write the characterization tests**

Create `src/lib/local-inference/engine/TtsEngine.test.ts` (reuse the mock setup shape from `TtsEngine.supertonic.test.ts` for `ModelManager` + `voiceStorage`, but drive via `MockWorker` from the shared helper):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtsEngine } from './TtsEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';
import * as voiceStorage from '../voiceStorage';

const SUPERTONIC_BLOBS = {
  'onnx/duration_predictor.onnx': 'blob:dp', 'onnx/text_encoder.onnx': 'blob:te',
  'onnx/vector_estimator.onnx': 'blob:ve', 'onnx/vocoder.onnx': 'blob:vc',
  'onnx/tts.json': 'blob:tts', 'onnx/unicode_indexer.json': 'blob:idx',
  'voice_styles/F1.json': 'blob:f1',
};

async function initReady(engine: TtsEngine) {
  const initP = engine.init('supertonic-3');
  await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
  const worker = MockWorker.last();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  worker.emit({ type: 'ready', numSpeakers: 1, sampleRate: 24000, loadTimeMs: 5 });
  await initP;
  return worker;
}

describe('TtsEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue(SUPERTONIC_BLOBS as any);
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([]);
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new TtsEngine();
    await initReady(engine);
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('generate() resolves on the result message', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const samples = new Float32Array([0.1, 0.2]);
    const p = engine.generate('hi', 0, 1.0);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate' }));
    worker.emit({ type: 'result', samples, sampleRate: 24000, generationTimeMs: 20 });
    await expect(p).resolves.toEqual(expect.objectContaining({ sampleRate: 24000 }));
  });

  it('generateStream() forwards audio-chunk to onChunk and resolves on audio-done', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    const chunks: Float32Array[] = [];
    const p = engine.generateStream('hi', (s) => chunks.push(s), 0, 1.0);
    worker.emit({ type: 'audio-chunk', samples: new Float32Array([1]), sampleRate: 24000 });
    worker.emit({ type: 'audio-done', generationTimeMs: 30 });
    await expect(p).resolves.toEqual(expect.objectContaining({ generationTimeMs: 30 }));
    expect(chunks.length).toBe(1);
  });

  it('dispose rejects a pending generate and posts dispose', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    const p = engine.generate('hi', 0, 1.0);
    engine.dispose();
    await expect(p).rejects.toThrow(/disposed/i);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(false);
  });

  it('a pre-ready error rejects init and revokes', async () => {
    const engine = new TtsEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('supertonic-3');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'tts load failed' });
    await expect(initP).rejects.toThrow('tts load failed');
    expect(onError).toHaveBeenCalledWith('tts load failed');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run against current code (must pass)**

Run: `npm run test -- --run src/lib/local-inference/engine/TtsEngine.test.ts`
Expected: PASS (5). The `generate`/`stream` message field names and the `ready` payload (`numSpeakers`/`sampleRate`) must match what `TtsEngine.ts` actually reads — adjust the emitted messages to the real shapes (consult `TtsEngine.ts`'s onmessage) if an assertion fails. Do NOT change `TtsEngine.ts` here. Also confirm `TtsEngine.supertonic.test.ts` still passes unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.test.ts
git commit -m "test(local-inference): characterization tests for TtsEngine (pre-refactor)"
```

---

### Task 10: Refactor `TtsEngine` to compose `WorkerSession` (keep bespoke pending + edge-TTS)

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`

**Interfaces:**
- Consumes: `WorkerSession`. Does NOT use `RequestRegistry` (single-slot pending).

Recipe (read the file first — this is the most involved engine):

1. Add `import { WorkerSession } from './WorkerSession';`. Replace `private worker` with `private session: WorkerSession | null = null;`. Keep `pendingGenerate`, `pendingStream`, `edgeTtsConnection`, `_numSpeakers`, `_sampleRate`, `currentModel`. Replace `isReady` reads with `this.session?.ready`; `get ready()` → `this.session?.ready ?? false`.
2. In `init`, keep the pre-Promise blob loading exactly as-is (this preserves the supertonic single-await ordering — Global Constraint). In the `new Promise` body:
   - `makeWorker` from the current `switch` that picks the worker URL (edge-tts / piper-plus / supertonic / default). Each case returns `new Worker(...)`.
   - `revokeBlobs`: `isEdgeTts ? undefined : () => ModelManager.getInstance().revokeBlobUrls(fileUrls)` — edge-TTS has nothing to revoke (matches the current `if (!isEdgeTts) revoke` guards).
   - `onFatalError`: `(message) => { this.onError?.(message); this.pendingGenerate?.reject(new Error(message)); this.pendingGenerate = null; this.pendingStream?.reject(new Error(message)); this.pendingStream = null; }` — mirrors the current `onerror` handler's pending rejection. (Note: use explicit `if (this.pendingGenerate) {...}` blocks to null after reject, matching current code.)
   - `onMessage: (msg) => this.route(msg)` where `route` carries the current onmessage non-handshake cases: `status` (→ onStatus / whatever it currently does), `result` (→ `pendingGenerate`), `audio-chunk` (→ `pendingStream.onChunk`), `audio-done` (→ `pendingStream`), `error` (post-ready: `onError?` + reject `pendingGenerate`/`pendingStream`), `disposed` (no-op). Copy the exact bodies from the current onmessage `case`s (lines for `result`/`audio-chunk`/`audio-done`/`error`).
   - Set `this._numSpeakers`/`this._sampleRate` from the `ready` message in the `.then()` of start (the current `ready` case reads these): `const ready = await session.start(<the engine-specific init message, exactly as currently posted>); this.currentModel = model; this._numSpeakers = ready.numSpeakers ?? 0; this._sampleRate = ready.sampleRate ?? 0; return { ... };` — match the current `ready` case's field reads and the `init` return shape.
   - `this.session = session;` immediately after construction.
3. `generate` / `generateStream`: keep the "already pending" guards and the single-slot assignment; replace `this.worker.postMessage(...)` / `this.worker!.postMessage(...)` with `this.session!.post(...)`. Keep the `const worker = this.worker;` capture pattern by capturing `const session = this.session;` instead, and post via `session.post(...)`. The edge-TTS branch of `generateStream` still uses `this.edgeTtsConnection` and posts `decode-start`/`decode-end`/audio-in to the worker via `this.session.post(...)`.
4. `dispose`: keep edge-TTS + pending rejection; replace the worker block with `this.session?.dispose(); this.session = null;`. Keep resetting `_numSpeakers`/`_sampleRate`/`currentModel`.
5. `reloadVoices` calls `this.dispose()` then `this.init(...)` — unchanged.

- [ ] **Step 1: Apply the recipe.**

- [ ] **Step 2: Both TtsEngine test files stay green**

Run: `npm run test -- --run src/lib/local-inference/engine/TtsEngine.test.ts src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: PASS (both files). The supertonic test's construction-ordering assertions must still hold (worker created synchronously after the blob await).

- [ ] **Step 3: Full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts
git commit -m "refactor(local-inference): TtsEngine composes WorkerSession (keeps single-slot pending + edge-TTS)"
```

---

### Task 11: Final verification — dedup check, full suite, build

**Files:** none (verification only).

- [ ] **Step 1: Confirm the lifecycle dedup landed**

Run:
```bash
cd src/lib/local-inference/engine
grep -c "this.worker" AsrEngine.ts StreamingAsrEngine.ts TranslationEngine.ts TtsEngine.ts
grep -c "new WorkerSession" AsrEngine.ts StreamingAsrEngine.ts TranslationEngine.ts TtsEngine.ts
```
Expected: the `this.worker` count is `0` for all four (the field is gone), and `new WorkerSession` is `1` for each. If any `this.worker` remains, that engine wasn't fully migrated.

- [ ] **Step 2: Full test suite**

Run: `npm run test -- --run`
Expected: PASS — includes RequestRegistry, WorkerSession, and the 4 engine characterization suites, plus the pre-existing supertonic test.

- [ ] **Step 3: Integration build**

Run: `npm run build`
Expected: build succeeds (the engines still compile and the workers bundle).

> **Coverage note:** the engines have no live-Worker runtime test; the characterization tests pin observable behavior against a `MockWorker`, and the build proves compilation. A manual smoke of one local-inference ASR→translation→TTS session before merge is the behavioral backstop (recommended, not required for task completion).

- [ ] **Step 4: Commit (if any verification touched files)**

No file changes expected in this task. If the greps revealed a missed migration, fix that engine (re-run its characterization suite) and commit under the relevant engine's message.
