# WASM WorkerSession + worker harness consolidation (Design)

**Date**: 2026-07-13
**Branch**: `refactor/wasm-worker-session`
**Status**: Design / proposal — approved forks, no implementation yet

## Summary

The WASM Local-Inference layer duplicates worker plumbing at two levels:

- **Worker side** (runs in the worker): `createBlobUrlCache` is copied into 10 transformers.js workers (all semantically identical), and the transformers `env` setup block — `allowRemoteModels=false … useCustomCache=true … customCache=createBlobUrlCache(msg.fileUrls)` plus the ORT `wasmPaths` wiring and a module-top `proxy=false` — is copied into all 10 as well.
- **Engine side** (main thread): the 4 engines (`AsrEngine`, `StreamingAsrEngine`, `TranslationEngine`, `TtsEngine`) copy the same Worker lifecycle verbatim — the init handshake (create worker → await `ready`/`error` → revoke blob URLs), the `onerror` path, and the `dispose()` core (`postMessage({type:'dispose'})` → `terminate()`). The two request/response engines additionally each hand-roll an id-keyed `pendingRequests` map.

None of this is under test. The only existing engine test (`TtsEngine.supertonic.test.ts`) works by monkeypatching `globalThis.Worker`.

This design extracts the shared plumbing into small, independently-testable units — **behavior-preserving**, **WASM side only** — landed as two PRs. It is a peer of, and shares nothing with, the Local Native (sidecar) path.

## Goals

- Collapse the 10× `createBlobUrlCache` + 10× transformers `env` setup into two shared `_shared/` helpers.
- Extract the engine Worker lifecycle into a composed `WorkerSession`, and the id-correlation into a `RequestRegistry`, so all 4 engines share one tested lifecycle instead of four hand-copied ones.
- Bring this 0-test area under characterization tests that pin current observable behavior before any extraction, and unit tests on the new shared units after.

## Non-goals

- **No wire-protocol change.** The message shapes stay exactly as they are today, including the known drift between families: ASR workers use the shared `types.ts` union (`ready{loadTimeMs}`, `status{message}`); translation workers declare types locally and emit `ready{modelId, loadTimeMs, device}` / `status{status:'loading', modelId}`. Unifying that is a separate, riskier change and is explicitly out of scope.
- **Local Native / sidecar untouched.** `nativeModelStore`, the Python sidecar, and its engines are a peer provider with separate repos, runtimes, and readiness stores. No shared abstraction is introduced across the WASM/native boundary.
- **The 3 non-transformers workers stay as-is.** `bing-translation` (HTTP client), `supertonic-tts` (raw `InferenceSession`), and `zoom-vad` (raw `InferenceSession`) do not use `createBlobUrlCache` or the transformers `env` bridge and legitimately differ; they are not folded into the harness.
- No `types.ts` init-message dedup (a separate duplication axis, deferred).

## Background — the duplication, with evidence

### Worker side

`createBlobUrlCache` — 10 copies, all semantically identical, two cosmetic families plus one drifted ancestor:

- Family A (`marker` var, dense): `whisper-webgpu:210`, `cohere-transcribe-webgpu:158`, `voxtral-webgpu:413`, `voxtral-3b-webgpu:174`, `granite-speech-webgpu:179` (granite differs only in a `put` brace).
- Family B (`resolveMainMarker` var, blank lines): `qwen-translation:51`, `translategemma-translation:51`, `hy-mt-translation:70`, `qwen35-translation:56`.
- Drifted ancestor: `translation.worker.ts:67` (splits the `return fetch(...)` into two statements; semantically identical).

The transformers `env` setup, identical in all 10 (line refs from `translation.worker.ts`):

```ts
// module top-level (runs at worker load)
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;      // :14-15
}

// inside handleInit(msg)
if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {   // :100-102
  env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
}
env.allowRemoteModels = false;   // :105
env.allowLocalModels = true;     // :106
env.useBrowserCache = false;     // :107
env.useCustomCache = true;       // :108
env.customCache = createBlobUrlCache(msg.fileUrls);  // :109
```

**Per-family difference in the `wasmPaths` wiring** (both families are `msg.ortWasmBaseUrl`-guarded — there is no unguarded overwrite):

- 5 translation workers set only the transformers `env` and don't import `ortEnv`:
  ```ts
  if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) { env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl; }
  ```
- 5 ASR/WebGPU workers additionally set the raw onnxruntime-web `env` (imported as `ortEnv` from `./_shared/onnxruntime-all`) that their VAD `InferenceSession` uses, and this block runs *before* `initVad`:
  ```ts
  if (msg.ortWasmBaseUrl) {
    if (env.backends?.onnx?.wasm) { env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl; }
    if (ortEnv?.wasm)            { ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl; }
  }
  ```

So the shared helper handles only the transformers `env`; each ASR worker keeps a minimal `if (msg.ortWasmBaseUrl && ortEnv?.wasm) { ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl; }` before its VAD init. The transformers-`env` `wasmPaths` moves into the helper (safe: the transformers pipeline is created after the helper call; `initVad` only uses `ortEnv`). The consolidation is purely behavior-preserving.

**whisper special case:** `whisper-webgpu.worker.ts` has an additional `patchWhisperConfigs` (`:235-274`) that mutates `fileUrls` in place (revoke + recreate `config.json`/`generation_config.json` blobs) *before* the cache is built at `:454`. This is the only place any worker revokes blob URLs. It stays whisper-local; the shared cache helper needs no whisper awareness as long as the patch still runs first.

`_shared/` already exists (`onnxruntime-all.ts`, `transformers-all.ts`) but only for **build-time bundle-chunk dedup** of the multi-MB runtimes — a different concern. Those files are **not modified** by this work (see Architecture).

### Engine side

Verbatim across all 4 engines — the `dispose()` core:

```ts
if (this.worker) {
  this.worker.postMessage({ type: 'dispose' });
  this.worker.terminate();
  this.worker = null;
}
this.isReady = false;
this.currentModel = null;   // or currentModelId
```

And the init handshake (`AsrEngine:118-170`, `TranslationEngine:139-193` are structurally identical): on `ready` → set ready + `manager.revokeBlobUrls(fileUrls)` + resolve; on `error` when not ready → `onError?` + revoke + reject; `onerror` → same. Two sub-families diverge: `AsrEngine`/`StreamingAsrEngine` are callback-based (`onResult`/`onPartialResult`/`onStatus`/`onSpeechStart`); `TranslationEngine`/`TtsEngine` are request/response via an id-keyed `pendingRequests` map with reject-all-on-dispose.

**Supertonic constraint** (`TtsEngine.ts:96-99`): supertonic loads its blob URLs in a *single await* so the `Worker` is created within one microtask of `init()`. Any refactor must not insert awaits between `init()` and worker creation on that path.

## Architecture

Two PRs from one coordinated design. The message protocol is the coupling point between the two sides, so it is designed once (and deliberately left unchanged); execution is split for small, revertible reviews.

### PR 1 — worker-side harness (lands first)

Two new pure modules under the existing `src/lib/local-inference/workers/_shared/`:

**`blob-url-cache.ts`** — `export function createBlobUrlCache(fileUrls: Record<string, string>)`. Imports nothing. Returns the `{ match, put }` object; `match` extracts the path after `/resolve/main/`, looks it up, and `fetch`es the blob URL; `put` is a no-op. The 10 copies (including the drifted ancestor and granite's brace variant) converge onto this one.

**`transformers-env.ts`** — `export function initTransformersEnv(env, msg)`. Takes `env` as a **parameter** (the worker keeps importing `env` from `./_shared/transformers-all` and passes it in), so this helper is transformers-agnostic and does not touch the chunk-dedup shim. It absorbs *both* env blocks:

```ts
export function initTransformersEnv(env, msg: { fileUrls: Record<string,string>; ortWasmBaseUrl?: string }) {
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    if (msg.ortWasmBaseUrl) env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;  // guarded — matches both families
  }
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = createBlobUrlCache(msg.fileUrls);
}
```

Rewiring: each of the 10 transformers workers deletes its module-top `proxy=false` block and its inline env block, and calls `initTransformersEnv(env, msg)` inside `handleInit` (whisper calls it *after* `patchWhisperConfigs`). Moving `proxy=false` from module-load into the init handler is safe: the worker does nothing between load and the `init` message.

The 5 **translation** workers replace their whole `wasmPaths` + 5-line block with the single call. The 5 **ASR** workers additionally keep a minimal `if (msg.ortWasmBaseUrl && ortEnv?.wasm) { ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl; }` in its original spot (before `initVad`), since the helper only touches the transformers `env`, not `ortEnv`.

**`transformers-all.ts` is not modified.** It solves build-time chunk-dedup (which transformers symbols exist); this work solves source-level dedup (runtime config policy). Keeping them separate preserves the shim's single responsibility. (Caveat: because each worker is its own Rollup build, the ~15-line helpers may be inlined per-worker in the shipped output — fine; the goal here is maintainability, and the bytes are negligible next to the runtime chunks the shims already dedup.)

### PR 2 — engine-side WorkerSession

Two new units under `src/lib/local-inference/engine/`, composed (not inherited) by the engines.

**`WorkerSession.ts`** — lifecycle only, zero domain knowledge:

```ts
interface WorkerSessionOptions {
  makeWorker: () => Worker;            // engine chooses URL + {type:'module'} vs classic
  route: (msg: any) => void;           // every message except the init-handshake ones
  revokeBlobs: () => void;             // called exactly once, on first settle
  onFatalError?: (message: string) => void;  // Worker-level onerror after ready
}

class WorkerSession {
  constructor(opts: WorkerSessionOptions);  // creates the Worker synchronously, wires onmessage/onerror
  start(initPayload: object, transfer?: Transferable[]): Promise<any>;  // posts init; resolves on 'ready', rejects on pre-ready 'error'/onerror
  post(msg: object, transfer?: Transferable[]): void;
  dispose(): void;                     // postMessage({type:'dispose'}) + terminate() + null
  get ready(): boolean;
}
```

Message handling (preserves current behavior exactly):

- `constructor` calls `makeWorker()` **synchronously** and wires `onmessage`/`onerror`. Creating the worker in the constructor (rather than inside an awaited step) is what honors the supertonic constraint: the engine finishes its blob-loading await, then `new WorkerSession(...)` creates the worker in the same microtask.
- `start(payload)` stores the handshake resolve/reject, then posts `{type:'init', ...payload}`. Race-free because workers stay silent until they receive `init`.
- internal `onmessage(msg)`:
  - `msg.type === 'ready'` and not settled → mark settled, `revokeBlobs()` once, `resolve(msg)`.
  - `msg.type === 'error'` and not settled → mark settled, `revokeBlobs()` once, `reject(new Error(msg.error))`. (Pre-ready, all errors are fatal-init; id-correlated errors only occur post-ready.)
  - otherwise → `route(msg)` — this is where `status`/`speech_start`/`partial`/`result`/`disposed` and *post-ready* errors go; the engine decides id-correlation vs fatal.
- internal `onerror(e)`: `onFatalError?.(message)`; if not settled → `revokeBlobs()` once, reject.

**`RequestRegistry.ts`** — id-keyed correlation for the request/response engines:

```ts
class RequestRegistry<T> {
  create(id: string): Promise<T>;     // stores {resolve, reject}
  resolve(id: string, value: T): void;
  reject(id: string, error: Error): void;
  rejectAll(error: Error): void;      // dispose: reject + clear all pending
}
```

Per-engine responsibilities after extraction (each keeps its own `workerType` switch, init-payload building, and domain `route`):

| Engine | WorkerSession | RequestRegistry | Extra dispose cleanup wrapping `session.dispose()` |
|---|---|---|---|
| `AsrEngine` | ✅ | — (callbacks) | — |
| `StreamingAsrEngine` | ✅ | — (callbacks) | — |
| `TranslationEngine` | ✅ | ✅ | `setBingTranslatorDNR(false)` |
| `TtsEngine` | ✅ (worker paths) | ✅ | `edgeTtsConnection.dispose()` (edge-TTS is a non-worker path it keeps separate) |

The sherpa-onnx classic-ASR path (which fetches `package-metadata.json` to build its init payload) fits: the engine does `new WorkerSession(...)` (worker created), `await fetchMetadata()`, then `session.start(payload)`. The metadata await is *after* worker creation, so no path regresses.

## Testing (characterization-first)

Before touching the engines, pin current observable behavior through each engine's **public API** (mock `ModelManager`, patch `globalThis.Worker` with a `FakeWorker` test double, as the existing supertonic test does). These tests assert behavior, not internals, so they stay green across the extraction — the safety net.

**PR 1 — direct unit tests on the pure helpers:**
- `createBlobUrlCache`: `match` on an HF `/resolve/main/<file>` URL → `fetch(fileUrls[file])`; missing file → `undefined`; non-HF URL → `undefined`; `undefined` request → `undefined`; `put` is a no-op.
- `initTransformersEnv`: sets the five `env` flags + `customCache`; sets `proxy=false` and `wasmPaths` only when `backends.onnx.wasm` exists; sets `wasmPaths` only when `msg.ortWasmBaseUrl` is present (the normalized guard); no throw when `backends` is absent.

**PR 2 — characterization (public API) + unit tests on the new units:**
- Characterization (all 4 engines): `init()` resolves with `loadTimeMs` on `ready` and `revokeBlobUrls` fires exactly once after ready; `init()` rejects on pre-ready `error` and on `onerror`, revoking; `dispose()` posts `{type:'dispose'}` and terminates and resets flags; `AsrEngine` audio/partial/result/status/speech_start callbacks fire; `TranslationEngine`/`TtsEngine` correlate results by id, reject the matching request on an id'd `error`, and reject all pending on dispose; `TtsEngine` supertonic path creates the worker synchronously (no await between `init()` and worker creation); `TranslationEngine` toggles bing DNR.
- Unit (`WorkerSession`): handshake resolve/reject; revoke-once-on-first-settle; post-ready messages route; `onerror` pre- vs post-settle; `dispose` teardown — all with an injected `FakeWorker` (no `globalThis` patch needed, since `makeWorker` is the seam).
- Unit (`RequestRegistry`): create/resolve/reject correlation; `rejectAll` on dispose; unknown-id resolve/reject is a no-op.

## Global constraints

- **WASM side only** — no reach into `nativeModelStore` / sidecar (peer-provider rule).
- **No wire-protocol change** — message shapes and the ASR-vs-translation family drift are preserved.
- **Supertonic single-await** — worker created synchronously (in `WorkerSession`'s constructor) right after the engine's blob await.
- **whisper `patchWhisperConfigs`** runs before `initTransformersEnv` builds the cache.
- **ASR workers keep their `ortEnv.wasm.wasmPaths`** before `initVad` — the helper handles the transformers `env` only. Both worker families already guard `wasmPaths` on `msg.ortWasmBaseUrl`; there is no drift to fix.
- **`transformers-all.ts` / `onnxruntime-all.ts` unchanged** — build-time chunk-dedup shims are orthogonal to this source-dedup.

## Rollout

1. **PR 1** — `_shared/blob-url-cache.ts` + `_shared/transformers-env.ts` + their unit tests; rewire 10 workers. Fully behavior-preserving. Small, revertible.
2. **PR 2** — engine characterization tests first (pin behavior), then `WorkerSession` + `RequestRegistry` + their unit tests; rewire the 4 engines to compose them.

Each PR gates on `npm run test` green; PR 2 additionally on manual smoke of a live ASR→translation→TTS session (the tests cannot cover the real Worker/WASM runtime).
