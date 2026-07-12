# Native Python Sidecar Local Inference (Electron)

**Date**: 2026-06-21
**Status**: Design
**Tracking**: #129 (native sherpa-onnx / transformers for Electron). Evidence: #263 (Pocket TTS native PoC), #159 (CosyVoice), #261 (hybrid per-stage pipeline).

## Summary

Add a **native local-inference backend** to the Electron desktop build as a
**Python sidecar** process, exposed as a new per-stage backend that slots into
the existing `LocalInferenceClient` pipeline. The browser extension and web
builds keep their WASM workers unchanged — this is Electron-only.

The sidecar runs a localhost WebSocket server. The renderer connects to it
through a thin `LocalNativeClient` (or, equivalently, three native-backed
Engine variants), reusing the entire existing orchestration: sentence-split
TTS, karaoke timing, partial ASR, the `ConversationItem` pipeline, and the
`Int16@24kHz in / Int16@24kHz delta out` audio contract. Electron's main
process only spawns, supervises, and tears down the sidecar.

The sidecar is **not bundled** in the installer. It is downloaded on first use
into the app's data directory, code-signed/notarized, with an optional
GPU (CUDA) pack as a separate download.

This replaces the WASM↔native performance ceiling documented in #263
(WASM ~0.6× realtime vs native ~2–4× for int8 voice cloning) and unlocks
PyTorch-only models — most importantly **multilingual voice cloning**, which
the WASM/ONNX path cannot reach.

## Goals

- New native backend for **ASR, translation, and TTS**, composable **per
  stage** alongside the existing WASM and cloud backends (preserves #261's
  per-stage selection, stage-skipping, and text-only modes).
- Reuse `IClient`, `LocalInferenceClient` orchestration, `ConversationItem`
  pipeline, `audio-conversion`, and the sentence/karaoke logic with no rewrite.
- Port only the **~30 models that have real Electron usage** (per PostHog;
  see Model Scope). Drop the long tail (84/139 TTS, 50/81 opus-mt, 7 ASR).
- Add **voice cloning** as the headline new capability, in two phases:
  Pocket TTS (plumbing proof, English-only) → CosyVoice2 (multilingual, real).
- Sidecar downloaded on demand, signed/notarized, GPU pack optional.

## Non-Goals

- **Extension / web builds**: no native host (sandbox forbids it). They keep
  WASM workers. The shared model catalog is not pruned by this spec — removing
  a model from the manifest must check extension/web usage separately.
- **Bundling the sidecar in the installer**: explicitly downloaded post-install.
- **Reimplementing cloud wrappers**: `edge-tts` and `bing-translator` are
  network wrappers, not models; they stay on the existing worker path.
- **Porting the long-tail models** that PostHog shows nobody uses.
- **Realtime end-to-end providers** (OpenAI Realtime, Gemini Live, Volcengine
  AST): unchanged, separate single-provider options.

## Locked Decisions

| Decision | Choice |
|---|---|
| Runtime language | **Python sidecar** (not Node) — model coverage + faster runtimes; bundle size moot via on-demand download |
| Composition | **Per-stage** native backend, not a monolithic provider |
| Transport | **localhost WebSocket server** in the sidecar; renderer connects directly |
| Voice cloning rollout | **Two-step**: Pocket TTS (plumbing) → CosyVoice2 (multilingual) |
| Inference libraries | **sherpa-onnx + onnxruntime** for parity models, **+ faster-whisper** for Whisper family, **+ PyTorch/transformers** for voxtral/cohere/granite and voice cloning |
| Model hosting | **`huggingface_hub` native cache for everything** (incl. existing `jiangzhuo9357/sherpa-onnx-*` datasets via `hf_hub_download`); `HF_HOME` pointed at app data dir |

## Architecture

### Process topology

```
┌─ Electron main process ─────────────────────────────┐
│  NativeHostManager:                                  │
│    - download/verify sidecar (first use)             │
│    - spawn(python-sidecar)  [execFile/spawn]         │
│    - read handshake → {port} from stdout             │
│    - supervise + cleanup (before-quit/SIGINT/...)    │
│    - ipcMain.handle('native-host:start|stop|status') │
└───────────────────────┬─────────────────────────────┘
                        │ spawns + monitors
                        ▼
┌─ Python sidecar (separate process) ─────────────────┐
│  ws://127.0.0.1:<port>                               │
│    /asr   /translation   /tts   (logical channels)   │
│    backends: sherpa-onnx | faster-whisper |          │
│              onnxruntime | transformers(PyTorch)     │
│    model mgmt: huggingface_hub (HF_HOME=userData)    │
└───────────────────────▲─────────────────────────────┘
                        │ ws (JSON control + binary PCM)
┌─ Renderer ────────────┴─────────────────────────────┐
│  LocalInferenceClient (unchanged orchestration)      │
│    AsrEngine / TranslationEngine / TtsEngine         │
│      → native worker-type: WS client to sidecar      │
└──────────────────────────────────────────────────────┘
```

Rationale for **WS over stdio**: Python is a genuinely separate process (it
cannot reuse Electron's embedded Node the way a Node sidecar could via
`ELECTRON_RUN_AS_NODE`). A localhost WS server keeps the high-bandwidth audio
stream off the Electron IPC whitelist and lets the renderer's `IClient` reuse
the WebSocket-client idiom already used by `VolcengineAST2Client` /
`EdgeTtsConnection`. Electron main never touches audio frames.

### Renderer integration — the engine seam

The existing engines select a worker by `model.asrWorkerType` /
`translationWorkerType` / `model.engine`. Add a `native` value to each. When
selected, the engine opens a WS channel to the sidecar instead of
`new Worker(...)`, but keeps the **identical public surface**
(`init` / `feedAudio` / `flush` / `translate` / `generate` / callbacks). The
`LocalInferenceClient` orchestration is unchanged.

Native availability is gated like other Electron-only providers: registration
in `ProviderConfigFactory` behind `isElectron()`, plus a runtime check that the
sidecar is downloaded and healthy (replaces `modelStore.isProviderReady`, which
is browser/IndexedDB-specific).

## WebSocket Protocol

One WS connection per logical stage (or one multiplexed connection with a
`stage` field). Control messages are JSON text frames; audio is binary frames
(little-endian `Int16` / `Float32`). Mirrors the existing worker message
semantics so the engines need minimal adaptation.

**Common**
- `→ {type:'init', stage, model, config}` ⇒ `← {type:'ready', loadTimeMs, ...}`
  or `← {type:'error', message, code}`
- `← {type:'status', message}` for load progress / model download progress.

**ASR** (`stage:'asr'`)
- `→ binary frame` — `Int16` PCM @ 24kHz (downsampled to 16k in sidecar)
- `→ {type:'flush'}` — finalize (PTT release)
- `← {type:'partial', text}` (streaming engines)
- `← {type:'result', text, startSample, durationMs, recognitionTimeMs}`
- `← {type:'speech_start'}`

**Translation** (`stage:'translation'`)
- `→ {type:'translate', id, text, systemPrompt, wrapTranscript}`
- `← {type:'result', id, sourceText, translatedText, inferenceTimeMs}`
  (id-correlated request/response, matching `TranslationEngine.pendingRequests`)

**TTS** (`stage:'tts'`)
- `→ {type:'generate', id, text, sid, speed, lang, voiceRef?}`
  (`voiceRef` = reference clip for cloning)
- `← binary frame(s)` — `Float32` PCM @ model rate (resampled to Int16@24k in
  the engine, as today) with interleaved `← {type:'chunk', id, seq}` /
  `← {type:'done', id, generationTimeMs}`

**Cascade hook**: because translation and TTS are independent stages, a native
TTS channel can be fed text from *any* upstream source — including a cloud
realtime model that emits text (e.g. Volcengine AST / Seed LiveInterpret). The
TTS `generate` path must not assume a local ASR producer.

## Electron Main — `NativeHostManager`

Mirror the lifecycle discipline of `electron/pulseaudio-utils.js`:

- **Spawn**: `spawn`/`execFile` (no shell), module-level process handle.
- **Handshake**: sidecar binds port `0`, prints `{"port":N}` to stdout; main
  reads it and forwards to the renderer via `native-host:status`.
- **Supervise**: restart-on-crash with backoff; surface fatal errors as
  structured `{ok:false, error}` over IPC (never throw across the boundary).
- **Teardown**: register cleanup on `before-quit` / `will-quit` / `SIGINT` /
  `SIGTERM` / `uncaughtException` / `unhandledRejection`; kill the child and
  reap orphans on next startup.
- **IPC**: add `native-host:start|stop|status` to `ipcMain.handle` and to the
  `invoke` whitelist in `electron/preload.js`.

## Python Sidecar Internals

### Per-stage backends

| Stage | Backend | Covers |
|---|---|---|
| ASR | **sherpa-onnx** | sense-voice(+nano), nemo-parakeet/fastconf, zipformer-ru, moonshine-*, dolphin, wenetspeech-yue, omnilingual, all `stream-*` streaming |
| ASR | **faster-whisper** (CTranslate2) | whisper-tiny / base / small / medium / large-v3-turbo |
| ASR | **transformers (PyTorch)** | voxtral-mini-4b, cohere-transcribe, granite-speech(-4.1-2b) — the former "webgpu" transformers.js models |
| Translation | **onnxruntime / CTranslate2** | opus-mt used pairs (reuse existing ONNX packs) |
| Translation | **transformers (PyTorch)** | qwen3-0.6b, qwen2.5-0.5b, qwen3.5-0.8b/2b, translategemma-4b, hy-mt15-1.8b |
| TTS | **sherpa-onnx** | piper-*, matcha-fa-en, icefall-zh-aishell3, piper-plus-css10-ja |
| TTS | **onnxruntime** | supertonic-3 |
| TTS (cloning) | **PyTorch** | Pocket TTS (phase 1) → CosyVoice2 (phase 2) |

Note: the WASM-side manifest IDs carry a `-webgpu` suffix that names the
*browser* engine, not the model. The native provider maps by underlying
checkpoint (e.g. every `whisper-*-webgpu` → faster-whisper). The native model
list is therefore its own table, not a 1:1 reuse of `asrWorkerType`.

### Model management

All model files are fetched via **`huggingface_hub`** (`hf_hub_download` /
`snapshot_download`), including the self-hosted sherpa-onnx packs
(`jiangzhuo9357/sherpa-onnx-*` datasets, `repo_type="dataset"`). Set
**`HF_HOME` to the app data dir** so the cache is app-managed (cleanable,
inspectable, not the user's global `~/.cache/huggingface`). Download progress
is surfaced to the UI via `status` messages on the relevant stage channel.

This drops the renderer-side `ModelManager` / IndexedDB / blob-URL bridge for
the native path entirely — the sidecar owns its own files.

## Packaging & Distribution

- **Build**: PyInstaller (onedir, not onefile — fewer AV false positives) per
  platform: win-x64, mac-arm64, mac-x64, linux-x64. CPU/CoreML/DirectML in the
  base artifact; **CUDA as a separate optional download**.
- **Distribution**: not in the installer. Downloaded on first native use into
  `app.getPath('userData')`, verified against a SHA-256 pinned in a signed
  manifest, then extracted (`chmod +x`; macOS de-quarantine post-signature).
  Reuse the patterns in `electron/vb-cable-installer.js` (runtime download +
  install) and the model-download progress UI.
- **Signing (non-negotiable)**: a downloaded binary does **not** inherit the
  app's notarization. The sidecar artifact must be **independently code-signed +
  notarized** (macOS) / Authenticode-signed (Windows) or Gatekeeper/SmartScreen
  will block it.
- **Versioning**: the manifest pins a sidecar version compatible with the app's
  WS protocol version; mismatch ⇒ prompt re-download.

## Model Scope (port list)

Drive from PostHog Electron `local_inference` usage. Port models with ≥2
distinct users; drop the rest. Cloud wrappers (`edge-tts`, `bing-translator`)
stay on the worker path, not in the sidecar. Indicative keepers:

- **ASR**: cohere-transcribe, whisper-large-v3-turbo, voxtral-mini-4b,
  nemo-parakeet-tdt, sensevoice(+nano), whisper-{tiny,base,small,medium},
  stream-multi-8lang, zipformer-ru, omnilingual, moonshine-{ja,zh,en},
  dolphin, granite-speech-4.1-2b, the used `stream-*`.
- **Translation**: translategemma-4b, qwen3-0.6b, hy-mt15-1.8b, qwen2.5-0.5b,
  qwen3.5-{0.8b,2b}, plus opus-mt {ru-en, en-zh, zh-en, ja-en, en-ru}.
- **TTS**: supertonic-3, piper-{en-gb-alan, en-amy, en-arctic, en-danny,
  en-gb-vctk, ru-denis, zh-huayan}, matcha-fa-en-khadijah, icefall-zh-aishell3,
  piper-plus-css10-ja, **+ cloning (Pocket → CosyVoice2)**.

## Phasing

1. **Plumbing (Pocket TTS)** — `NativeHostManager` spawn/supervise, WS protocol,
   one native `TtsEngine` channel, `LocalNativeClient` wiring, download+sign
   pipeline. Proves sidecar + transport + audio contract end-to-end. (Reuses the
   #263 `pocketInferenceCore` logic, re-hosted in Python.)
2. **ASR + Translation native backends** — sherpa-onnx + faster-whisper +
   transformers; port the keeper list; native model table + `huggingface_hub`
   management.
3. **Multilingual cloning (CosyVoice2)** — replace Pocket as the real cloning
   model; reference-voice UX; multilingual targets matching translation output.
4. **GPU pack** — optional CUDA download + execution-provider selection.

## Open Items / Risks

- **Python version: 3.11 (decided).** Surveyed the whole model roadmap — every
  current TTS plus the unimplemented issue models (Pocket #263, MOSS-TTS-Nano
  #245, Kokoro #134, Qwen3.5 ASR #148, Tiny Aya #158, Supertonic #122) run on
  ONNX / sherpa-onnx / transformers / sentencepiece, which are all
  version-agnostic across 3.10–3.13. faster-whisper/CTranslate2 is also no
  longer a ceiling (4.8.0, 2026-06, ships 3.12/3.13 wheels). The **single
  binding constraint is CosyVoice2** (Phase 3 cloning target): it pins
  `pynini==2.1.5` + `WeTextProcessing==1.0.3` for text normalization, and
  `pynini==2.1.5` only has wheels up to **3.11** (upstream's own conda env is
  3.10; pynini ≥2.1.7 has 3.12/3.13 wheels but CosyVoice doesn't pin those).
  **3.11** is therefore the highest version that satisfies everything including
  CosyVoice2's pinned deps, while staying newer than the 3.10 default and
  avoiding a forced pynini/WeTextProcessing bump off upstream's tested baseline.
  Phase-3 caveat: `pynini==2.1.5` in a **venv** (vs CosyVoice's conda flow) needs
  conda-forge or the ServiceNow manylinux prebuilt wheels, else it compiles
  OpenFst from source — Pocket (Phase 1, pure onnxruntime) is unaffected.
- **Voice-cloning licensing** — verify before distributing any weights: Pocket
  (Kyutai/CALM + the KevinAHM ONNX port, flagged in #263) and CosyVoice2
  (Alibaba license). Blocks phases 1/3 respectively.
- **PyTorch sidecar size** — voxtral/cohere/granite/CosyVoice pull a real
  PyTorch stack; CPU base ~200–350 MB, CUDA pack GB-scale. On-demand download
  absorbs this; tiered (CPU default, CUDA optional) is required.
- **`HF_HOME` redirection** must be set before any HF import in the sidecar, or
  models land in the user's global cache.
- **AV false positives** on PyInstaller Windows builds — onedir + signing
  mitigates; may need a Defender submission.
- **Streaming ASR latency** over WS vs in-process worker — measure; the binary
  PCM frame path should be comparable, but verify partial-result cadence.

## Reuse Summary

- **Reused as-is**: `IClient`, `ClientEventHandlers`, `ConversationItem`,
  `LocalInferenceClient` orchestration, `audio-conversion`, sentence-split /
  karaoke, the cloud wrappers (`edge-tts`, `bing-translator`),
  `ProviderConfigFactory` `isElectron()` gating, `pulseaudio-utils` lifecycle
  pattern, `vb-cable-installer` download pattern.
- **New**: `NativeHostManager` (main), Python sidecar + WS server, native
  worker-type branch in the three engines, `LocalNativeClient`, native model
  table, sidecar download/sign/verify pipeline.
- **Dropped on the native path**: renderer `ModelManager` / IndexedDB /
  blob-URL bridge (sidecar owns files); the long-tail unused models.
