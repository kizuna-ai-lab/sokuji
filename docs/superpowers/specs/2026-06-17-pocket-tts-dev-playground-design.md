# Pocket TTS Dev-Playground PoC — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan
**Topic:** Integrate Kyutai Pocket TTS (zero-shot voice cloning) into sokuji's local-inference stack as a standalone dev playground.

## Background

Pocket TTS is Kyutai's ~100M-parameter, CPU-first, zero-shot voice-cloning TTS, built on the **CALM (Continuous Audio Language Model)** architecture (arXiv:2509.06926). It pairs an autoregressive Transformer backbone (`lm_main`) with a flow/consistency head (`lm_flow`) over **Mimi** neural-codec latents, cloning a speaker from a short reference waveform via the Mimi `encoder`. sokuji already ships ONNX-on-`onnxruntime-web` TTS (Supertonic) with WebGPU→WASM fallback and a voice-cloning concept, which makes Pocket a natural addition along the same path.

A community INT8 ONNX export and an `onnxruntime-web` reference implementation exist at `KevinAHM/pocket-tts-onnx` (HF) / `KevinAHM/pocket-tts-onnx-export` (GitHub), which this PoC ports.

## Goal & success criterion

Build a **dev-only, standalone playground** that proves the full Pocket chain runs in sokuji's browser stack:
- a new `onnxruntime-web` worker,
- Pocket model wiring (the 5-session pipeline + tokenizer),
- a **record/upload** reference-audio UI,
- playback.

**Success:** in dev, a user can load the model → record or upload a reference voice → type text → press Generate → hear cloned speech; the UI shows the active backend (`webgpu` or `wasm`) and generation timing.

The playground is **decoupled** from the live translation pipeline: `LocalInferenceClient` and its `generate` / `generateStream` paths are not modified.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime path | **onnxruntime-web TS worker** (Supertonic-style), not sherpa-onnx WASM | House style; WebGPU-capable with WASM fallback; no custom C++/WASM build; reuses model-download + manifest infra. |
| PoC scope | **Standalone dev playground** | Fastest path to "hear it"; isolates the new worker + config + reference UI from the live flow. |
| Reference-audio input | **Record (MediaRecorder) + Upload (.wav)** | Lets the developer clone their own voice live and test arbitrary samples. Pocket needs **no reference transcript** (unlike ZipVoice). |
| Voice-embedding lifecycle | Compute once in the worker on reference set, keep **in memory** (rely on Pocket's `voiceEmbeddingCacheCapacity`); **no IndexedDB persistence** | Persistence is a production concern; out of PoC scope. |
| Model source | Pull **`KevinAHM/pocket-tts-onnx`** directly via `hfModelId` | `ModelManager` already supports `hfModelId` downloads; mirroring into our own HF dataset is a later production step. |
| Playground entry point | **Separate dev Vite entry** (precedent: `src/subtitle-overlay-entry.tsx`) | Maximum isolation; never bundled into the production app. |

## Architecture & components

Follows the Supertonic pattern (`src/lib/local-inference/workers/supertonic-tts.worker.ts` and its `TtsEngine` branch). New or changed pieces:

1. **`src/lib/local-inference/workers/pocket-tts.worker.ts`** *(new)* — Vite-bundled ES-module worker on `onnxruntime-web` (`_shared/onnxruntime-all`) with **WebGPU→WASM auto-fallback** cloned from the Supertonic loader. Holds 5 ONNX `InferenceSession`s: `encoder` (Mimi), `text_conditioner`, `lm_main`, `lm_flow`, `decoder` (Mimi). Responsibilities:
   - `init`: load the 5 sessions + tokenizer + model config; report `ready` with `backend`.
   - `encodeReference`: reference Float32 samples → resample to 24 kHz → Mimi `encoder` → voice embedding, cached in-worker.
   - `generate`: text → tokenizer → `text_conditioner` → **`lm_main` autoregressive frame loop** (conditioned on text embedding + voice embedding + KV-cache, ~12.5 Hz / 80 ms frames, EOS detection) → per frame **`lm_flow` ×`numSteps`** → continuous latent → `decoder` (streaming state) → PCM 24 kHz. Ports KevinAHM's decode loop.

2. **SentencePiece tokenizer** — vendor a small JS SentencePiece processor (KevinAHM ships one) plus `vocab.json` / `token_scores.json` from the model bundle. Co-located with the worker.

3. **Worker message types** *(`src/lib/local-inference/types.ts`)* — add `PocketTtsInitMessage` (`fileUrls`, `ortWasmBaseUrl`, `ttsConfig: { numSteps }`) and `PocketTtsGenerateMessage` (text + reference samples/sampleRate **or** a "use cached voice" flag + `numSteps`). Reuse the existing `TtsWorkerOutMessage` union (`ready` / `status` / `result` / `error`). This is a new init shape (like Supertonic), distinct from the legacy `modelFile` init.

4. **Manifest entry** *(`src/lib/local-inference/modelManifest.ts`)* — add `'pocket'` to `TtsEngineType`; register an entry:
   - `id: 'pocket-tts'`, `type: 'tts'`, `engine: 'pocket'`,
   - `hfModelId: 'KevinAHM/pocket-tts-onnx'`,
   - `variants.default.files`: the 5 `.onnx` files + `vocab.json` + `token_scores.json`. Exact filenames and `sizeBytes` are read from the source repo during implementation.
   - `ttsConfig: { numSteps: 5 }`.
   Downloads reuse the `hfModelId` path in `ModelManager`.

5. **`TtsEngine` wiring** *(`src/lib/local-inference/engine/TtsEngine.ts`)* — add an `isPocket` branch in `init` mirroring `isSupertonic` (create the bundled module worker via `new Worker(new URL('../workers/pocket-tts.worker.ts', import.meta.url), { type: 'module' })`; send the Pocket init message). Add a `generateWithReference(text, samples, sampleRate, speed)` method that posts `PocketTtsGenerateMessage` and resolves with `TtsResult`. The existing `generate` / `generateStream` methods are unchanged.

6. **Playground UI + entry point** — a separate dev Vite entry `src/pocket-playground-entry.tsx` + its HTML input, served at a dev URL (mirrors `subtitle-overlay-entry.tsx`). The React component provides: model download/load button, status line (backend), text box, reference panel (**MediaRecorder** record **or** `.wav` upload), speed control, Generate button, audio playback + timing + WAV download. Gated to development only (separate entry + `import.meta.env.MODE === 'development'`); it is never part of the production bundle.

## Data flow

- **init:** `ModelManager` downloads the model into IndexedDB → worker loads 5 sessions + tokenizer (WebGPU, else WASM) → posts `ready({ backend })`.
- **reference:** record (MediaRecorder → WAV) or upload `.wav` → main thread `AudioContext.decodeAudioData` → mono Float32 → `postMessage(samples, [transferable])` → worker resamples to 24 kHz → Mimi `encoder` → voice embedding cached in-worker.
- **generate:** text → tokenizer → `text_conditioner` → `lm_main` AR loop (text emb + voice emb + KV-cache, ~12.5 Hz frames, EOS) → per frame `lm_flow` ×`numSteps` → latent → `decoder` (streaming) → PCM 24 kHz → `result({ samples, sampleRate, generationTimeMs })` → main-thread playback + download.

## Error handling & fallbacks

- **WebGPU init failure** → release any created sessions and retry on WASM (the exact Supertonic fallback pattern); surface the active backend in the UI.
- **INT8-on-WebGPU caveat** → measured during the PoC: if WebGPU yields no speedup because INT8 ops fall back to fp32, record the finding and treat WASM as acceptable. This is a validation point, not a blocker.
- **Invalid reference audio** (not a wav, empty, too short, or too long) → clear, actionable UI error; reject before reaching the worker where possible.
- **Single-generate guard** → already enforced by `TtsEngine` (one pending generate at a time).
- **Model not downloaded** → prompt the user to download via the playground's load button.
- **Worker `onerror` / error message** → reject the pending generate and show the message (reuse `TtsEngine`'s existing handling).

## Testing

- **Vitest (automated):** mirror `TtsEngine.supertonic.test.ts` — assert the `isPocket` branch posts the correct init message, that `ready` resolves with backend/sampleRate, and that `generateWithReference` round-trips a mocked worker `result`. Add a tokenizer unit test (text → token ids) if the vendored SentencePiece processor is deterministic in jsdom.
- **Manual playground checklist** (real ONNX inference needs a browser + the ~211 MB model, so it is not automated): model loads; record + clone produces audio; upload + clone produces audio; speed change affects output; WebGPU and WASM paths both work; generation timing is sane; no console errors.

## Out of scope (PoC) / future work

- Not wired into `LocalInferenceClient` or the live translation pipeline.
- No IndexedDB persistence of voice embeddings. Future: reuse the `voiceStorage` pattern, storing the extracted embedding instead of a raw wav.
- No Settings / VoiceLibrary integration and no production i18n strings beyond the dev page.
- Production model hosting (mirroring `KevinAHM/pocket-tts-onnx` into our own HF dataset) is deferred.

## Risks & open implementation details

- **INT8 + WebGPU performance** is unproven for this model; the PoC explicitly measures it (WASM is the fallback).
- **Autoregressive decode loop** has higher per-step JS/dispatch overhead than sherpa's native C++ loop; acceptable for a PoC, to be measured.
- **Model size** (~211 MB total download) — gate behind an explicit load button; cache in IndexedDB.
- **Exact ONNX file list, sizes, tokenizer files, and I/O tensor names** are captured from `KevinAHM/pocket-tts-onnx` and its export scripts during implementation (mechanical, not a design unknown).
