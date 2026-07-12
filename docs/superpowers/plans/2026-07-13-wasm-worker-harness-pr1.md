# WASM Worker Harness (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the two blocks of transformers.js worker boilerplate — the `createBlobUrlCache` bridge and the `env` setup — into two shared, unit-tested `_shared/` helpers, and rewire all 10 transformers workers through them.

**Architecture:** Two new pure modules under `src/lib/local-inference/workers/_shared/`: `blob-url-cache.ts` (`createBlobUrlCache`) and `transformers-env.ts` (`initTransformersEnv`, which calls `createBlobUrlCache` internally). Each worker imports only `initTransformersEnv`, deletes its local `createBlobUrlCache` and its inline `env` block, and calls the helper inside `handleInit`. Behavior-preserving.

**Tech Stack:** TypeScript, Vitest, `@huggingface/transformers` (transformers.js), Web Workers, Vite worker bundling.

## Global Constraints

- **WASM side only.** Do not touch `nativeModelStore`, the Python sidecar, or any `engine/` file. This PR is workers + `_shared/` only.
- **No wire-protocol change.** Message shapes, `postMessage` payloads, and `self.onmessage` dispatch stay exactly as they are.
- **`transformers-all.ts` and `onnxruntime-all.ts` are NOT modified.** They are build-time chunk-dedup shims, orthogonal to this source-dedup.
- **Each worker imports only `initTransformersEnv`** (from `./_shared/transformers-env`). It does NOT import `createBlobUrlCache` — that is now an internal detail of `transformers-env.ts`.
- **ASR workers keep their `ortEnv.wasm.wasmPaths`** assignment in its original spot (before `initVad`). The helper handles the transformers `env` only, never `ortEnv`. Both worker families already guard `wasmPaths` on `msg.ortWasmBaseUrl`.
- **whisper:** `initTransformersEnv` must be called *after* `patchWhisperConfigs(...)` (it already sits after it in the flow).
- English-only comments. Conventional-commit messages. Commit after every task.
- Verification per rewire task = full `npm run test` stays green + a completeness grep. Workers cannot be unit-tested (they need the real Worker/WASM runtime); a `npm run build` at the end is the integration check.

The 10 transformers workers, by family:
- **Translation (5):** `translation.worker.ts`, `qwen-translation.worker.ts`, `qwen35-translation.worker.ts`, `hy-mt-translation.worker.ts`, `translategemma-translation.worker.ts` — transformers `env` only; do NOT import `ortEnv`.
- **ASR/WebGPU (5):** `whisper-webgpu.worker.ts`, `cohere-transcribe-webgpu.worker.ts`, `voxtral-3b-webgpu.worker.ts`, `voxtral-webgpu.worker.ts`, `granite-speech-webgpu.worker.ts` — also set `ortEnv.wasm.wasmPaths` (imported as `env as ortEnv` from `./_shared/onnxruntime-all`).

---

### Task 1: `createBlobUrlCache` shared helper

**Files:**
- Create: `src/lib/local-inference/workers/_shared/blob-url-cache.ts`
- Test: `src/lib/local-inference/workers/_shared/blob-url-cache.test.ts`

**Interfaces:**
- Consumes: nothing (pure; calls global `fetch`).
- Produces: `export function createBlobUrlCache(fileUrls: Record<string, string>): { match(request: string | Request | undefined): Promise<Response | undefined>; put(request: string | Request, response: Response): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/workers/_shared/blob-url-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBlobUrlCache } from './blob-url-cache';

describe('createBlobUrlCache', () => {
  const fileUrls = { 'config.json': 'blob:abc', 'onnx/model.onnx': 'blob:def' };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves an HF /resolve/main/ URL to a fetch of the mapped blob URL', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match('https://huggingface.co/org/model/resolve/main/config.json');
    expect(fetchMock).toHaveBeenCalledWith('blob:abc');
  });

  it('resolves nested paths after /resolve/main/', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match('https://huggingface.co/org/model/resolve/main/onnx/model.onnx');
    expect(fetchMock).toHaveBeenCalledWith('blob:def');
  });

  it('returns undefined for a file not in the map (no fetch)', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match('https://huggingface.co/org/model/resolve/main/missing.bin')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined for a non-HF URL (no /resolve/main/)', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match('https://example.com/config.json')).toBeUndefined();
  });

  it('returns undefined for an empty request', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match(undefined)).toBeUndefined();
  });

  it('reads .url from a Request-like object', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match({ url: 'https://huggingface.co/o/m/resolve/main/config.json' } as unknown as Request);
    expect(fetchMock).toHaveBeenCalledWith('blob:abc');
  });

  it('put is a no-op that resolves to undefined', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await expect(cache.put('x', {} as Response)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/lib/local-inference/workers/_shared/blob-url-cache.test.ts`
Expected: FAIL — `Failed to resolve import "./blob-url-cache"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/local-inference/workers/_shared/blob-url-cache.ts`:

```ts
/**
 * customCache bridge for Transformers.js: resolves the HuggingFace Hub
 * ".../resolve/main/<path>" URLs it requests to the pre-downloaded IndexedDB
 * blob URLs passed in `fileUrls`, so no network request leaves the worker.
 * `put` is a no-op — the files already live in IndexedDB.
 *
 * This is the single behavioural definition of the bridge; the 10 transformers.js
 * workers each used to carry a byte-identical copy.
 */
export function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;
      const marker = '/resolve/main/';
      const idx = url.indexOf(marker);
      if (idx === -1) return undefined;
      const filename = url.slice(idx + marker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;
      return fetch(blobUrl);
    },
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/lib/local-inference/workers/_shared/blob-url-cache.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/_shared/blob-url-cache.ts src/lib/local-inference/workers/_shared/blob-url-cache.test.ts
git commit -m "feat(local-inference): shared createBlobUrlCache helper for WASM workers"
```

---

### Task 2: `initTransformersEnv` shared helper

**Files:**
- Create: `src/lib/local-inference/workers/_shared/transformers-env.ts`
- Test: `src/lib/local-inference/workers/_shared/transformers-env.test.ts`

**Interfaces:**
- Consumes: `createBlobUrlCache` from Task 1 (`./blob-url-cache`).
- Produces:
  - `export interface TransformersEnvInit { fileUrls: Record<string, string>; ortWasmBaseUrl?: string }`
  - `export function initTransformersEnv(env: TransformersEnvLike, msg: TransformersEnvInit): void` — sets `proxy=false` + `wasmPaths` (guarded) on `env.backends.onnx.wasm`, sets the four `env` flags, and installs `env.customCache = createBlobUrlCache(msg.fileUrls)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/workers/_shared/transformers-env.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTransformersEnv } from './transformers-env';

function fakeEnv(withWasm = true) {
  return {
    backends: withWasm ? { onnx: { wasm: {} as Record<string, unknown> } } : {},
    allowRemoteModels: undefined as unknown,
    allowLocalModels: undefined as unknown,
    useBrowserCache: undefined as unknown,
    useCustomCache: undefined as unknown,
    customCache: undefined as unknown,
  };
}

describe('initTransformersEnv', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('sets the four transformers.js flags and a customCache bridge', () => {
    const env = fakeEnv();
    initTransformersEnv(env, { fileUrls: { 'config.json': 'blob:x' } });
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.useBrowserCache).toBe(false);
    expect(env.useCustomCache).toBe(true);
    expect(typeof (env.customCache as { match?: unknown }).match).toBe('function');
  });

  it('disables the wasm proxy when the backend exists', () => {
    const env = fakeEnv();
    initTransformersEnv(env, { fileUrls: {} });
    expect((env.backends as { onnx: { wasm: { proxy?: boolean } } }).onnx.wasm.proxy).toBe(false);
  });

  it('sets wasmPaths only when ortWasmBaseUrl is provided', () => {
    const a = fakeEnv();
    initTransformersEnv(a, { fileUrls: {}, ortWasmBaseUrl: 'https://host/wasm/ort/' });
    expect((a.backends as { onnx: { wasm: { wasmPaths?: string } } }).onnx.wasm.wasmPaths).toBe('https://host/wasm/ort/');

    const b = fakeEnv();
    initTransformersEnv(b, { fileUrls: {} });
    expect((b.backends as { onnx: { wasm: { wasmPaths?: string } } }).onnx.wasm.wasmPaths).toBeUndefined();
  });

  it('does not throw when the wasm backend is absent, still sets flags', () => {
    const env = fakeEnv(false);
    expect(() => initTransformersEnv(env, { fileUrls: {}, ortWasmBaseUrl: 'x' })).not.toThrow();
    expect(env.useCustomCache).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/lib/local-inference/workers/_shared/transformers-env.test.ts`
Expected: FAIL — `Failed to resolve import "./transformers-env"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/local-inference/workers/_shared/transformers-env.ts`:

```ts
import { createBlobUrlCache } from './blob-url-cache';

/**
 * Configure the Transformers.js `env` for offline, IndexedDB-backed inference:
 * disable the WASM proxy and remote/browser caching, point ONNX at the
 * app-served WASM binaries, and install the blob-URL customCache bridge.
 *
 * `env` is passed in (not imported) so this helper stays decoupled from the
 * `transformers-all` chunk-dedup shim. It configures the transformers `env`
 * ONLY — ASR workers set their separate onnxruntime-web `ortEnv.wasm.wasmPaths`
 * themselves, before their VAD InferenceSession is created.
 *
 * Folds in the module-top `proxy=false` that every worker also duplicated.
 */
export interface TransformersEnvInit {
  fileUrls: Record<string, string>;
  ortWasmBaseUrl?: string;
}

export interface TransformersEnvLike {
  backends?: { onnx?: { wasm?: { proxy?: boolean; wasmPaths?: string } } };
  allowRemoteModels?: unknown;
  allowLocalModels?: unknown;
  useBrowserCache?: unknown;
  useCustomCache?: unknown;
  customCache?: unknown;
}

export function initTransformersEnv(env: TransformersEnvLike, msg: TransformersEnvInit): void {
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    if (msg.ortWasmBaseUrl) env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
  }
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = createBlobUrlCache(msg.fileUrls);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/lib/local-inference/workers/_shared/transformers-env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/_shared/transformers-env.ts src/lib/local-inference/workers/_shared/transformers-env.test.ts
git commit -m "feat(local-inference): shared initTransformersEnv helper for WASM workers"
```

---

### Task 3: Rewire the 5 translation workers

**Files (all Modify):**
- `src/lib/local-inference/workers/translation.worker.ts`
- `src/lib/local-inference/workers/qwen-translation.worker.ts`
- `src/lib/local-inference/workers/qwen35-translation.worker.ts`
- `src/lib/local-inference/workers/hy-mt-translation.worker.ts`
- `src/lib/local-inference/workers/translategemma-translation.worker.ts`

**Interfaces:**
- Consumes: `initTransformersEnv` from Task 2.
- Produces: nothing new (behavior-preserving rewire).

Apply this exact 4-part edit to **each** of the 5 files (read the file first — line numbers vary per file; match on the code shown):

**(a) Add the import** immediately after the `... from './_shared/transformers-all';` import line:

```ts
import { initTransformersEnv } from './_shared/transformers-env';
```

**(b) Delete the module-top proxy block.** It looks like this (a comment line may precede it):

```ts
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}
```

**(c) Delete the local `createBlobUrlCache` function** in its entirety — the whole `function createBlobUrlCache(fileUrls: Record<string, string>) { ... }` block (and its preceding doc-comment).

**(d) Delete the transformers-env `wasmPaths` block.** Note: in these workers the `wasmPaths` block and the flag block are usually **NOT adjacent** (only `translation.worker.ts` has them together) — do (d) and (e) as two separate find-and-replace edits. Delete this block entirely (the helper sets `wasmPaths` for you; a `// Set ORT WASM paths ...` comment may precede it — delete that too):

```ts
    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }
```

**(e) Replace the inline flag block** (appears separately, under a `// Configure Transformers.js ...` comment) with the single call:

Find:
```ts
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);
```
Replace with:
```ts
    initTransformersEnv(env, msg);
```

(`msg` already carries `fileUrls` and `ortWasmBaseUrl`. A worker-local comment near either block may differ; keep only the call.)

- [ ] **Step 1: Apply edits (a)–(e) to all 5 translation workers.**

- [ ] **Step 2: Run the full test suite**

Run: `npm run test -- --run`
Expected: PASS — same total as before plus the 2 new helper suites; no failures.

- [ ] **Step 3: Completeness grep**

Run:
```bash
cd src/lib/local-inference/workers
grep -L "initTransformersEnv" translation.worker.ts qwen-translation.worker.ts qwen35-translation.worker.ts hy-mt-translation.worker.ts translategemma-translation.worker.ts
grep -l "function createBlobUrlCache" translation.worker.ts qwen-translation.worker.ts qwen35-translation.worker.ts hy-mt-translation.worker.ts translategemma-translation.worker.ts
```
Expected: BOTH commands print nothing (every file imports/uses `initTransformersEnv`; no file still defines `createBlobUrlCache`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/workers/translation.worker.ts \
        src/lib/local-inference/workers/qwen-translation.worker.ts \
        src/lib/local-inference/workers/qwen35-translation.worker.ts \
        src/lib/local-inference/workers/hy-mt-translation.worker.ts \
        src/lib/local-inference/workers/translategemma-translation.worker.ts
git commit -m "refactor(local-inference): route translation workers through shared env harness"
```

---

### Task 4: Rewire the 4 non-whisper ASR workers

**Files (all Modify):**
- `src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts`
- `src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts`
- `src/lib/local-inference/workers/voxtral-webgpu.worker.ts`
- `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts`

**Interfaces:**
- Consumes: `initTransformersEnv` from Task 2.
- Produces: nothing new (behavior-preserving rewire).

These differ from Task 3 in one way: they also set `ortEnv.wasm.wasmPaths`, which **must stay before `initVad`**. Apply this exact edit to **each** of the 4 files (read the file first; match on the code shown):

**(a) Add the import** after the `... from './_shared/onnxruntime-all';` import line:

```ts
import { initTransformersEnv } from './_shared/transformers-env';
```

**(b) Delete the module-top proxy block:**

```ts
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}
```

**(c) Delete the local `createBlobUrlCache` function** in its entirety (and its doc-comment).

**(d) Trim the wasmPaths block to keep only the `ortEnv` half.** Find this block (a `// Set ORT WASM paths` comment precedes it):

```ts
    if (msg.ortWasmBaseUrl) {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
      if (ortEnv?.wasm) {
        ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
    }
```

Replace it with (drops the transformers-`env` half — the helper sets that later; keeps the `ortEnv` half in place before `initVad`):

```ts
    // ortEnv wasmPaths must be set before initVad's InferenceSession; the
    // transformers env is configured later via initTransformersEnv.
    if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
      ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }
```

**(e) Replace the inline transformers env block** (it appears later, after `initVad`, under a `// ... Configure Transformers.js ...` comment):

```ts
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);
```

Replace with:

```ts
    initTransformersEnv(env, msg);
```

- [ ] **Step 1: Apply edits (a)–(e) to all 4 ASR workers.**

- [ ] **Step 2: Run the full test suite**

Run: `npm run test -- --run`
Expected: PASS — no failures.

- [ ] **Step 3: Completeness grep**

Run:
```bash
cd src/lib/local-inference/workers
grep -L "initTransformersEnv" cohere-transcribe-webgpu.worker.ts voxtral-3b-webgpu.worker.ts voxtral-webgpu.worker.ts granite-speech-webgpu.worker.ts
grep -l "function createBlobUrlCache" cohere-transcribe-webgpu.worker.ts voxtral-3b-webgpu.worker.ts voxtral-webgpu.worker.ts granite-speech-webgpu.worker.ts
grep -c "ortEnv.wasm.wasmPaths" cohere-transcribe-webgpu.worker.ts voxtral-3b-webgpu.worker.ts voxtral-webgpu.worker.ts granite-speech-webgpu.worker.ts
```
Expected: first two print nothing; the third prints `...:1` for each file (the `ortEnv` assignment is retained exactly once per worker).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts \
        src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts \
        src/lib/local-inference/workers/voxtral-webgpu.worker.ts \
        src/lib/local-inference/workers/granite-speech-webgpu.worker.ts
git commit -m "refactor(local-inference): route ASR workers through shared env harness (keep ortEnv wasmPaths)"
```

---

### Task 5: Rewire the whisper worker

**Files:**
- Modify: `src/lib/local-inference/workers/whisper-webgpu.worker.ts`

**Interfaces:**
- Consumes: `initTransformersEnv` from Task 2.
- Produces: nothing new.

Whisper is identical to Task 4 with one ordering note: its transformers env block sits **after** `await patchWhisperConfigs(msg.fileUrls, msg.language);`. The `initTransformersEnv(env, msg)` call must land in that same spot (after the patch), so the cache is built over the already-mutated `fileUrls`.

Apply the same 5-part edit as Task 4:

**(a)** Add `import { initTransformersEnv } from './_shared/transformers-env';` after the `... from './_shared/onnxruntime-all';` import.

**(b)** Delete the module-top proxy block:
```ts
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}
```

**(c)** Delete the local `function createBlobUrlCache(...) { ... }` (and its doc-comment).

**(d)** Trim the wasmPaths block (has a 3-line `// Set ORT WASM paths ...` comment preceding it):
```ts
    if (msg.ortWasmBaseUrl) {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
      if (ortEnv?.wasm) {
        ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
    }
```
Replace with:
```ts
    // ortEnv wasmPaths must be set before the VAD/whisper InferenceSession; the
    // transformers env is configured later (after patchWhisperConfigs).
    if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
      ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }
```

**(e)** Replace the transformers env block that follows `await patchWhisperConfigs(...)`:
```ts
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);
```
with:
```ts
    initTransformersEnv(env, msg);
```

- [ ] **Step 1: Apply edits (a)–(e) to whisper-webgpu.worker.ts.**

- [ ] **Step 2: Verify the ordering is preserved**

Run:
```bash
cd src/lib/local-inference/workers
grep -n "patchWhisperConfigs\|initTransformersEnv" whisper-webgpu.worker.ts
```
Expected: the `await patchWhisperConfigs(...)` call line number is **less than** the `initTransformersEnv(env, msg)` line number (patch runs first).

- [ ] **Step 3: Run the full test suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 4: Completeness grep**

Run:
```bash
cd src/lib/local-inference/workers
grep -c "function createBlobUrlCache" whisper-webgpu.worker.ts
grep -c "ortEnv.wasm.wasmPaths" whisper-webgpu.worker.ts
```
Expected: `0` and `1`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/whisper-webgpu.worker.ts
git commit -m "refactor(local-inference): route whisper worker through shared env harness (after config patch)"
```

---

### Task 6: Consolidation guard test + integration verification

**Files:**
- Create: `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts`

**Interfaces:**
- Consumes: nothing (reads worker source files from disk).
- Produces: a source-scan guard preventing re-inlining of the harness in any of the 10 workers.

- [ ] **Step 1: Write the guard test (it should pass immediately after Tasks 3–5)**

Create `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every transformers.js worker must route through the shared harness — no
// re-inlined createBlobUrlCache, no hand-written env block. Guards against drift.
const TRANSFORMERS_WORKERS = [
  'translation.worker.ts',
  'qwen-translation.worker.ts',
  'qwen35-translation.worker.ts',
  'hy-mt-translation.worker.ts',
  'translategemma-translation.worker.ts',
  'whisper-webgpu.worker.ts',
  'cohere-transcribe-webgpu.worker.ts',
  'voxtral-3b-webgpu.worker.ts',
  'voxtral-webgpu.worker.ts',
  'granite-speech-webgpu.worker.ts',
];

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
}

describe('worker harness consolidation', () => {
  it.each(TRANSFORMERS_WORKERS)('%s routes through the shared harness', (name) => {
    const src = read(name);
    expect(src, `${name} still defines a local createBlobUrlCache`).not.toMatch(/function\s+createBlobUrlCache/);
    expect(src, `${name} still hand-sets env.customCache`).not.toMatch(/env\.customCache\s*=\s*createBlobUrlCache/);
    expect(src, `${name} does not import initTransformersEnv`).toContain("from './_shared/transformers-env'");
    expect(src, `${name} does not call initTransformersEnv`).toMatch(/initTransformersEnv\(/);
  });
});
```

- [ ] **Step 2: Run the guard test**

Run: `npm run test -- --run src/lib/local-inference/workers/_shared/harness-consolidation.test.ts`
Expected: PASS (10 cases). If any fails, a worker from Tasks 3–5 was missed — fix that worker, do not weaken the test.

- [ ] **Step 3: Run the full suite**

Run: `npm run test -- --run`
Expected: PASS, no failures.

- [ ] **Step 4: Integration build check**

Run: `npm run build`
Expected: build succeeds. This bundles every worker via Vite; a broken import or missing symbol in any rewired worker fails here (the real integration gate, since workers have no unit tests).

> **Coverage note:** the build catches import/symbol breakage but does not *run* the workers, so it cannot prove runtime behavior. Because this PR is a mechanical, line-for-line extraction (the helper bodies are byte-identical to the deleted code, plus the folded-in `proxy=false`), automated green here is strong evidence. A brief manual smoke — one local-inference ASR→translation→TTS session — before merge is the behavioral backstop and is recommended, not required for task completion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/_shared/harness-consolidation.test.ts
git commit -m "test(local-inference): guard WASM workers against re-inlining the shared harness"
```
