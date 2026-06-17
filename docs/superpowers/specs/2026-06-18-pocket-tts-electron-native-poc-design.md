# Pocket TTS — Electron Native (onnxruntime-node) PoC — Design

**Date:** 2026-06-18
**Branch:** a new feature branch (e.g. `feat/pocket-tts-electron-native-poc`), created at implementation time; separate from `feat/pocket-tts-playground-poc`
**Status:** Design approved, pending spec review → implementation plan

## Context

Pocket TTS (Kyutai CALM zero-shot voice cloning) was integrated into sokuji's local-inference path as a browser PoC on `feat/pocket-tts-playground-poc` (onnxruntime-web WASM worker + dev playground). That PoC works end-to-end and clones voices correctly, **but caps at ~0.6× realtime** in the browser.

A cross-runtime investigation (2026-06-17 → 18) established **why**: it is a WASM tax, not the model. The identical sherpa-onnx engine and the identical int8 ONNX graphs run at **~4× realtime natively** on CPU (i7-14700F, AVX2+AVX-VNNI: 1 thread 3.87×, 4 threads 4.54×), versus **0.65× in WASM** — a ~6× tax from Emscripten SIMD/threading overhead. `num_steps` barely matters in either runtime (flow head is ~7%; `lm_main` + `mimi` decode dominate, per-frame, step-independent).

**Implication:** Pocket voice-cloning TTS is real-time-viable via a **native runtime** (Electron desktop with `onnxruntime-node`), but not in the browser extension (stuck at WASM ~0.6×; no WebGPU Pocket port exists).

This PoC verifies that path. Two things are still unproven and this PoC answers both:
1. **Does *our* `pocketInferenceCore.ts` (a TS reimplementation) run native-fast and correct on `onnxruntime-node`?** The 4× number was sherpa-onnx's hand-tuned C++; our JS autoregressive loop may carry extra overhead. This must be measured directly.
2. **Does it work inside Electron** — native module load, renderer↔Node IPC, no main-process freeze?

**Intended outcome:** a dev-gated, end-to-end demonstration (in `npm run electron:dev`) that our Pocket core runs on `onnxruntime-node` inside Electron at ≥ ~1× realtime with correct cloned audio, plus a standalone node benchmark proving the core's native throughput. This is decision-grade evidence for a future production Electron-native Pocket feature.

## Scope

**In scope (PoC, dev-gated, dev-mode only):**
- A standalone Node benchmark of `pocketInferenceCore` on `onnxruntime-node` (RTF + wav dump).
- An Electron `utilityProcess` running the same core, driven from the existing dev playground via IPC, with a WASM-vs-native A/B toggle.
- The minimal config changes needed for `onnxruntime-node` to load in `electron:dev`.

**Out of scope (deferred):**
- Production packaging (`npm run package`/Forge `ignore`+`packageAfterPrune` exceptions, `asarUnpack`, packaged-build smoke test).
- Wiring into the real `LocalInferenceClient` translation pipeline.
- Reference-voice UX (recording/managing cloned voices), settings.
- GPU execution providers (CUDA/DirectML/CoreML) — CPU EP only.
- Non-English output (Pocket is English-only: `languages:['en']`).
- Streaming generation (Pocket is offline/one-shot).

## Key architectural facts (from codebase exploration)

- **`src/lib/local-inference/pocket/pocketInferenceCore.ts`** is runtime-agnostic *except* it imports `InferenceSession`/`Tensor` from `src/lib/local-inference/workers/_shared/onnxruntime-all.ts` (= `onnxruntime-web`). The only runtime *value* dependency is the `Tensor` constructor (`makeTensor` → `new Tensor(type,data,dims)`); the 5 `InferenceSession`s are created by the host and passed in as `PocketSessions`. `onnxruntime-web` and `onnxruntime-node` share the `onnxruntime-common` JS API (identical `Tensor` ctor, `InferenceSession.create`, `session.run`).
- **`onnxruntime-node` is currently stubbed out**: `package.json` override `"onnxruntime-node": "npm:empty-npm-package@1.0.0"`. Native rebuild tooling is already wired (`@electron/rebuild`, `postinstall`, `forge.config.js` `auto-unpack-natives`).
- **Electron has no `worker_threads`/`utilityProcess` today**, but is on Electron 40 (`utilityProcess` available). Renderer↔main IPC uses `ipcMain.handle` + `contextBridge` `window.electron.invoke(channel, data)`; new channels must be added to the `invoke` whitelist (`electron/preload.js`, `validChannels`).
- **The dev playground (`src/components/dev/PocketPlayground.tsx`)** is a separate Vite HTML entry (`pocket-playground.html`), **not loaded in the Electron main window** (Electron loads `index.html`). It drives a `TtsEngine` and calls `engine.generateWithReference(text, ref, sr, speed)`.
- **`isElectron()`** lives in `src/utils/environment.ts`; the real IPC surface is `window.electron` (not `window.electronAPI`).
- The Pocket model bundle is on disk at `public/wasm/pocket-tts-en/` (gitignored, populated by `scripts/download-pocket-tts-en.sh`): 5 int8 onnx (`mimi_encoder_int8.onnx`, `flow_lm_main_int8.onnx`, `flow_lm_flow_int8.onnx`, `mimi_decoder_int8.onnx`, `text_conditioner_int8.onnx`) + `tokenizer.model` + `bundle.json` + `bos_before_voice.npy`. Filename→session mapping is in `src/lib/local-inference/pocket/pocketBundle.ts` (`POCKET_MODEL_STEMS`).

## Architecture

### Portability seam — dependency injection (chosen over build-alias / duplication)

Refactor `pocketInferenceCore.ts` so it no longer imports `Tensor` from `onnxruntime-all`. Instead, the `Tensor` class (and the already-built sessions) are **injected** by the host:

- The renderer Web worker (`pocket-tts.worker.ts`) injects `onnxruntime-web`'s `Tensor`.
- The Node host (bench script + utilityProcess) injects `onnxruntime-node`'s `Tensor`.

Concretely: the exported core functions that build tensors (`makeTensor`, and the public `encodeReference` / `buildVoiceConditionedState` / `generate`) receive the `Tensor` ctor via a small injected context object (e.g. `{ Tensor }`), or the core is wrapped in a factory `createPocketCore({ Tensor })` returning the same function set. `InferenceSession` is used only as a *type* (sessions are passed in), so it needs no runtime injection — typing against `onnxruntime-common` is sufficient. This keeps **one core, two hosts**, unit-testable with a fake `Tensor`, and is the same decoupling a future "native path invisible under `TtsEngine`" would need.

`pocketTokenizer.ts` (sentencepiece.js), npy parsing, and `bundle.json` parsing are pure JS/TS and run unchanged in Node.

### Milestone 1 — Node benchmark (highest signal, lowest cost)

**`scripts/bench-pocket-native.ts`** (run via `tsx`; add `tsx` as a devDependency if absent):
- Load the 5 sessions from disk via `onnxruntime-node` `InferenceSession.create(path, { executionProviders:['cpu'], intraOpNumThreads:N })`, reading from `public/wasm/pocket-tts-en/`.
- Reuse `pocketInferenceCore` (inject `onnxruntime-node` `Tensor`) and `pocketTokenizer`; parse `bundle.json` + `bos_before_voice.npy` from disk.
- Reference audio: `benchmark/test-speech-silence-speech.wav` (24kHz mono). Text: the same 3-sentence demo string used in the WASM perf runs.
- Warm-up + timed runs; sweep `intraOpNumThreads ∈ {1,4,8}`. Compute `RTF = audioSec / (genMs/1000)`. Inline a minimal WAV encoder to write `out_native.wav`.
- **Pass:** RTF ≥ ~1× (expect ~2–4× on this CPU) and `out_native.wav` audibly matches the reference voice.

### Milestone 2 — Electron end-to-end (utilityProcess + IPC + playground toggle)

Data flow:
```
renderer PocketPlayground ("Native (Electron)" toggle + isElectron())
  → window.electron.invoke('pocket-native:generate', {text, referenceAudio?, referenceSampleRate?, useCachedVoice})
main.js ipcMain.handle  ──MessagePort──►  utilityProcess (Node)
                                            onnxruntime-node + pocketInferenceCore (inject node Tensor)
                                          ◄── {samples, sampleRate, generationTimeMs}
  ◄──────────────────────────────────────  Float32 back to renderer → play
```

Components:
1. **`electron/pocket-native-process.ts`** — utilityProcess entry (Node context), built by `vite-plugin-electron` as a new entry; `onnxruntime-node` declared `external`. On `init`: load the 5 sessions from a model-dir path (passed in), parse `bundle.json` + BOS npy, load the tokenizer. On `generate`: run the core (inject node `Tensor`), cache the voice embedding (`cachedFlowState`, mirroring `pocket-tts.worker.ts`), post `{samples, sampleRate, generationTimeMs}` back over the MessagePort. Model dir for dev = absolute path to repo `public/wasm/pocket-tts-en/`.
2. **`electron/main.js`** — lazily spawn the utilityProcess on first `pocket-native:init`; `ipcMain.handle('pocket-native:init' | 'pocket-native:generate')` forward requests to the utilityProcess and await its reply; kill the process on app quit.
3. **`electron/preload.js`** — add `pocket-native:init` and `pocket-native:generate` to the `invoke` `validChannels` whitelist. (One-shot `invoke` promise carries the ~1MB Float32 result; no streaming push channel needed.)
4. **`src/lib/local-inference/pocketNativeClient.ts`** (renderer) — mirrors the slice of `TtsEngine` the playground uses: `init()`, `generateWithReference(text, referenceAudio, referenceSampleRate, speed)` → `window.electron.invoke(...)`, returning the same `TtsResult` shape (`{samples:Float32Array, sampleRate, generationTimeMs}`) so playground call sites are identical between WASM and native.
5. **`src/components/dev/PocketPlayground.tsx`** — add a **"Native (Electron)"** toggle, shown only when `isElectron()`. When on, route generation through `pocketNativeClient` instead of the WASM `TtsEngine`; display the active backend + RTF. Same UI, clean WASM-vs-native A/B.
6. **Mount the playground inside the main app for Electron** — add a dev keyboard toggle (following the existing dev-proto toggle pattern, e.g. the `Ctrl+Shift+*` proto toggles) that mounts `PocketPlayground` within the main app, so the Electron renderer (which loads `index.html`) can reach it. The standalone `pocket-playground.html` entry remains for web.

### Config changes (needed even for dev-only)

- **`package.json`** — remove/scope the `onnxruntime-node` → `empty-npm-package` override; add a real `onnxruntime-node` dependency. (`postinstall` electron-rebuild picks up its native binary.)
- **`vite.config.ts`** — add `onnxruntime-node` to the Electron build `external` array (so the utilityProcess entry leaves `require('onnxruntime-node')` for runtime resolution and the renderer never bundles it); register the new `pocket-native-process` Electron entry.
- After changes, run `tsc` + `vitest` to confirm the web build/tests stay green (the override removal + DI refactor must not break the existing WASM path).

## Error handling

- **utilityProcess load failure** (missing model dir, `onnxruntime-node` not resolvable): the process posts an `error` message; main rejects the `invoke` promise; the playground surfaces it in its on-page log panel and falls back to the WASM toggle. Dev-only, so failures are visible, not silent.
- **Generation error** inside the core: caught in the utilityProcess, returned as an `error` reply (not a crash); main does not crash; playground logs it.
- **Process lifecycle**: utilityProcess killed on app quit; a crash leaves the WASM path fully functional (native is purely additive behind a toggle).

## Testing

- **Milestone 1:** `tsx scripts/bench-pocket-native.ts` prints an RTF table (target ≥ ~1×) and writes `out_native.wav` that audibly matches the reference voice.
- **Milestone 2:** `npm run electron:dev` → open the dev Pocket playground in the Electron window → toggle "Native (Electron)" → upload/record a reference → Generate → hear correct cloned audio, RTF logged ≥ ~1×, and the main process stays responsive (UI not frozen) during generation. A/B against the WASM toggle in the same UI.
- **Unit/regression:** the DI refactor must keep existing Pocket unit tests green and `tsc` clean; add a small unit test exercising the core with an injected fake `Tensor` if practical.

## Success criteria

1. Our `pocketInferenceCore` on `onnxruntime-node` runs at ≥ ~1× realtime (ideally near sherpa's native ~4×) with correct cloned output — proving the TS core, not just sherpa's C++, is native-fast.
2. The same core runs inside Electron via a `utilityProcess`, driven from the dev playground over IPC, producing correct audio without freezing the main process.
3. The existing WASM Pocket path and the web build/tests remain unaffected.
