# Native Python Sidecar — Phase 3e (model download management) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Give LOCAL_NATIVE a model-management UX like LOCAL_INFERENCE: see which models are downloaded, download them with a progress bar, and only enable the provider once the selected models are present — so first-run is explicit, not a silent multi-GB wait.

**Architecture:** Native models live in the **sidecar's HF cache** (server-side), so this can't reuse the IndexedDB `modelStore`. Instead: the sidecar gains `model_status` / `model_download` WS messages (per-file progress); a renderer `NativeModelClient` + `nativeModelStore` drive a `NativeModelManagementSection` in settings; `validateApiKey` gates on the selected models being downloaded.

## Global Constraints
- Electron-only. Reuse `NativeHostManager` (start sidecar) + the WS server.
- Per-model download = a set of HF repos (and the VAD URL) resolved by a registry; status = all cached (`local_files_only`); download = per-file with `{downloaded,total}` progress.
- Readiness = sidecar up **AND** the 3 selected-stage models cached.
- Pure logic (registry, isReady) unit-tested; UI build-gated; real download model-gated.

## Task 1: Sidecar — model registry + status/download handlers
- Create `sidecar/sokuji_sidecar/native_models.py`:
  - `download_specs(model_id) -> {repos: [..], urls: [..]}`: piper/vits id → `[id]`; `Xenova/opus-mt-*` → `[id, Helsinki-NLP/<name>]`; `whisper-*` → `[Systran/faster-whisper-<size>]`; `sense-voice` → `[csukuangfj/sherpa-onnx-sense-voice-…]` + `[VAD_URL]`; `qwen`/`''` → `[Qwen/Qwen2.5-0.5B-Instruct]`; else `[id]`.
  - `model_status(model_id) -> 'ready'|'absent'` (snapshot_download `local_files_only=True` per repo + url file exists).
  - `async download(model_id, send)`: list repo files, `hf_hub_download` each via `asyncio.to_thread`, `await send({type:'model_progress',model,downloaded,total})`; then urls.
- Handlers `model_status` (`{models:[]} -> {type:'model_status_result', statuses:{id:state}}`) and `model_download` (`{model} -> progress pushes + {ok}`). Register in `__main__`.
- Tests: `download_specs` mapping (unit); model-gated `model_status` (a cached repo → ready, a bogus repo → absent).
- Commit `feat(sidecar): model status/download WS handlers + registry`.

## Task 2: Renderer NativeModelClient + protocol
- Extend `nativeProtocol.ts`: `ModelStatusResultMsg`, `ModelProgressMsg`.
- `NativeModelClient.ts`: `status(models): Promise<Record<id,'ready'|'absent'>>`, `download(model, onProgress): Promise<void>` (routes `model_progress` to onProgress, resolves on `ok`).
- vitest with fake WS.
- Commit `feat(renderer): NativeModelClient (status/download)`.

## Task 3: nativeModelStore (Zustand)
- `src/stores/nativeModelStore.ts`: `statuses: Record<id,'ready'|'absent'|'downloading'>`, `progress: Record<id,{downloaded,total}>`, `refresh(models)`, `download(model)`, `isReady(models)`. Talks to NativeModelClient (starts sidecar via `native-host:start`).
- vitest for `isReady` + a mocked download/refresh.
- Commit `feat(store): nativeModelStore`.

## Task 4: NativeModelManagementSection UI
- `src/components/Settings/.../NativeModelManagementSection.tsx`: lists the **currently selected** ASR / translation / TTS models (resolved from `localNative` + catalog), each with status chip + Download button + progress bar (`downloaded/total`). Rendered inside `renderLocalNativeSettings`.
- Build-gated.
- Commit `feat(settings-ui): native model management section`.

## Task 5: Readiness gate
- `settingsStore.validateApiKey` LOCAL_NATIVE: after `native-host:start`, compute required model ids (asr, translation-resolved-or-qwen, tts-if-any) and check `nativeModelStore` statuses; ready only if all 'ready', else message "Download the native models in settings" + not valid.
- Commit `feat(settings): gate LOCAL_NATIVE on downloaded models`.

## Deferred
- Byte-accurate progress (currently per-file count); delete/cleanup of cached models; full catalog browser (this lists only selected-stage models).

## Self-Review
Mirrors the LOCAL_INFERENCE management UX but server-side (sidecar HF cache) instead of IndexedDB. Per-file progress is coarse but honest. Readiness now means "models present", matching the user's "only usable after downloaded".
