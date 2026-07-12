# Native TTS Stage — Backend, Resolver, Engine, Protocol (Design)

**Date:** 2026-06-29
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)
**Tracking:** issue #129 (native sherpa-onnx + transformers for Electron); relates to #261 (per-stage pipeline), #245 (MOSS-TTS-Nano), #263 (Pocket TTS).

## Summary

Add a **TTS stage** to the Electron Python sidecar, built from scratch to mirror the existing **ASR/translate** pattern (backend registry → hardware resolver → declarative catalog → process-singleton engine → localhost-WS protocol → server-side model downloads). All TTS runs on **onnxruntime in the shared cu128 venv** — no torch added for TTS, no isolated venv.

The first implementation ships two reference backends that exercise both model shapes:

- **A-class — `sherpa_tts`**: sherpa-onnx `OfflineTts` (VITS/Matcha/Kokoro/icefall-zh), non-autoregressive, one-shot per sentence, no cloning.
- **B-class — `moss_onnx`**: **MOSS-TTS-Nano-100M** via its pure-onnxruntime core — autoregressive, **intra-utterance streaming**, **zero-shot voice cloning** from a reference clip, 20 languages.

## Goals

- A TTS stage that composes per-stage with WASM/cloud (mixes with the existing ASR/translate selection, #261).
- GPU acceleration via the existing resolver (gpu-cuda ≫ cpu, fallback, RTF bench), proven on the RTX 4070 SUPER.
- Voice cloning (the new capability) and low-latency streaming output for the B-class.
- Cross-platform: CPU floor everywhere, CUDA on NVIDIA, CoreML/DirectML reachable (same multi-EP story as the rest of the native stack).
- Minimal install footprint (~220 MB marginal in the shared venv).

## Non-goals (future extensions)

- A torch/vLLM **"HQ tier"** (MOSS-TTS-Realtime-2B / Qwen3-TTS) — documented as a later *isolated* backend hosting mode; not in this spec.
- A-class models beyond the reference set (each is just a catalog row later).
- TensorRT-EP tuning; intra-sentence streaming for A-class (unnecessary — see Audio/streaming).
- GPU co-hosting optimization with translation (translation may move to GGUF; out of scope).

## Background and evidence

The TTS model wishlist was originally filed (#134/#159/#245/#263) as **ONNX-for-the-web**. For native, backend choice was re-evaluated against speed, hardware acceleration, and install size. Key spike/research findings that drive this design:

1. **sherpa-onnx GPU works and coexists with the cu128 torch stack.** `sherpa-onnx 1.13.3+cuda12.cudnn9` ran with `LD_LIBRARY_PATH` pointed at torch's nvidia libs (no reinstall, no conflict). RTX 4070 SUPER: piper **2.4×** GPU speedup (CPU RTF 0.0173 → CUDA 0.0074), matcha **7.3×** (0.0211 → 0.0029). CUDA EP genuinely engages (the speedup is real, not silent CPU fallback). The gap grows with model compute.

2. **For the B-class, GGUF/stock-llama.cpp is not viable.** Universal blocker: llama.cpp's GGUF engine runs only the transformer LM; every TTS codec/vocoder (WavTokenizer/DAC/SNAC/Mimi/HiFT/Flow-DiT) is unsupported. Every "good" GGUF path is a single-maintainer bespoke ggml fork or a hybrid (LM on llama.cpp + external codec). MOSS-Nano has **no GGUF** at all.

3. **onnxruntime-python is the light B-class path.** onnxruntime-gpu reuses torch's cuDNN9/CUDA12 libs (CUDA major must match — ORT 1.27 needs CUDA 13, so we pin **onnxruntime-gpu 1.22** to match torch cu12x). Pure ONNX has **no transformers dependency**, so the B-class backend runs **in the shared venv** (no transformers-version conflict, the thing that forces Qwen3-TTS/vLLM into isolated venvs). Marginal install ≈ **220 MB** (the ORT wheel), vs ~6 GB for an isolated torch venv or ~9 GB for vLLM-Omni.

4. **MOSS-TTS-Nano-100M is the only MOSS variant with a true torch-free onnxruntime path** (official `infer_onnx.py` + `MOSS-TTS-Nano-100M-ONNX` + `MOSS-Audio-Tokenizer-Nano-ONNX`). Realtime-2B / Local-Transformer / 8B flagship are torch/vLLM/GGUF only; VoiceGenerator (voice *design*, no ref-clip) and TTSD (dialogue) are wrong tools. Nano has streaming, ref-clip cloning, 20 languages (zh/en/ja/ko/de/fr/es/pt/it/ru all present).

5. **Benchmark (MOSS-Nano, RTX 4070 SUPER, streaming mode):**

   | Engine | Device | RTF | ~realtime | VRAM | install |
   |---|---|---|---|---|---|
   | onnxruntime | CUDA | 0.28 | 3.6× | **3.3 GB** | ~220 MB, shared venv |
   | torch (bf16) | CUDA | 0.245 | 4.1× | 2.3 GB | ~6 GB, isolated venv |
   | onnxruntime | CPU | 0.78 | 1.3× | — (RSS 2.2 GB) | ~220 MB |
   | torch | CPU | 0.45 | 2.2× | — (RSS 3.0 GB) | ~6 GB |

   torch is ~15% faster and both are real-time; install size is decisively ONNX. **Decision: onnxruntime route for MOSS-Nano.** Critical detail: the default "full codec decode" attempts a single 2.3 GB allocation and OOMs to **10.8 GB** peak; switching to **incremental (streaming) codec decode** — which we ship anyway — drops VRAM to **3.3 GB** with zero speed cost. (An ORT `arena_extend_strategy=kSameAsRequested` tweak was tried and **rejected**: it fragmented and crashed.)

## Architecture

A TTS stage parallel to ASR/translate. All backends are onnxruntime, in the shared venv.

```
renderer (LocalNativeClient, IClient)
   │  WS: tts_init / set_voice / tts_generate ──► tts_chunk* / tts_done
   ▼
tts_engine.py        process singleton: init→resolve→load→generate/stream→close (VRAM hygiene)
   ├─ accel.resolve_tts()    reuse probe()/tiers/Plan/load_with_fallback/bench
   ├─ catalog.tts_models()   declarative TtsModel rows (add a model = add a row)
   └─ tts_backends.py        backend adapters (only code touching a framework API)
        ├─ SherpaTtsBackend  (A: OfflineTts; vits/matcha/kokoro/icefall; one-shot; provider cpu|cuda)
        └─ MossOnnxTtsBackend (B: MOSS-Nano multi-graph AR loop; streaming; cloning; provider cpu|cuda)
native_models.py     catalog-driven TTS download specs (sherpa repos; MOSS ONNX + tokenizer ONNX)
server.py            reuse binary-frame handling (set_voice) + async stream-push; add owns_tts cleanup
```

### File map

- **New:** `sidecar/sokuji_sidecar/tts_backends.py` (registry + the two backends), rewrite `sidecar/sokuji_sidecar/tts_engine.py` (the current impl/protocol is discarded).
- **Edit:** `accel.py` (`resolve_tts`, `measure_rtf_tts`, two `_installed()` rows, `.onnx` weight ext), `catalog.py` (`TtsModel` + rows + accessors), `native_models.py` (catalog-driven TTS specs), `server.py` (`owns_tts`).
- **Vendor:** MOSS-Nano's pure-onnxruntime core (`ort_cpu_runtime.py` equivalent) into the sidecar tree, lightly wrapped — **without** the repo's torch/torchaudio/WeTextProcessing convenience layer (`onnx_tts_runtime.py`).
- **Renderer:** `nativeProtocol.ts` (msg types), `LocalNativeClient`/`NativeTtsClient` (already has `setReferenceVoice`), `nativeCatalog.ts` (TTS rows), `nativeModelStore` (`ttsLoading`/`ttsResolved`), a capability-driven Voice section (generalize `VoiceLibrarySection`).

## Backend contract

A TTS-specific registry in `tts_backends.py` (parallel to ASR's `backends.py`). Heavy imports lazy in `load()`; `BackendLoadError` drives gpu→cpu fallback.

```python
@register_tts_backend
class XTtsBackend:
    NAME: str                    # matches catalog Deployment.backend
    STREAMING: bool = False      # B-class True
    CLONES: bool = False         # cloning backends True
    sample_rate: int             # model native rate (engine resamples to 24k)

    def load(self, artifact, device, compute_type) -> None: ...   # device: "cpu"|"cuda"
    def set_voice(self, audio_f32, sr) -> None: ...               # cloning only; no-op otherwise
    def generate(self, text, speed=1.0) -> tuple[np.ndarray, int]: ...   # one-shot → (f32, gen_ms)
    def generate_stream(self, text, speed=1.0): ...               # STREAMING only: yields f32 chunks
    def unload(self) -> None: ...
    @property
    def is_loaded(self) -> bool: ...
```

### A-class — `SherpaTtsBackend` (NAME=`sherpa_tts`)

`STREAMING=False`, `CLONES=False`. Wraps `sherpa_onnx.OfflineTts`. `load()` resolves the snapshot dir and builds the config by family (generalizes the current piper-only `sherpa_tts.py`):

- vits/piper/kokoro/icefall → `OfflineTtsVitsModelConfig` (English: `espeak-ng-data`; Chinese vits: `dict_dir`/`lexicon`).
- matcha → `OfflineTtsMatchaModelConfig` (acoustic + vocoder).
- `provider="cuda"` when device=cuda (GPU build), else `"cpu"`.

`generate(text, speed)` → `self._tts.generate(text, sid=0, speed=speed)` → `(samples, gen_ms)`. `set_voice` no-op. (sherpa `OfflineTts` exposes a per-sentence progress callback — a future option for sentence-granularity progressive emission — but unnecessary at A-class speeds: a sentence synthesizes in tens of ms; the renderer's sentence-split + per-sentence `generate` already provides progressive output.)

### B-class — `MossOnnxTtsBackend` (NAME=`moss_onnx`)

`STREAMING=True`, `CLONES=True`. Built on MOSS-Nano's pure-onnxruntime core (vendored). The model spans **two repos** (LM ONNX + audio-tokenizer ONNX): `Deployment.artifact` is the LM repo; `load()` resolves the LM snapshot dir and its sibling tokenizer dir (both already fetched by the catalog's `repos`) and creates the ~8 ONNX sessions (prefill/decode/local_decoder/codec_encode/**codec_decode_step**) with `provider` cpu/cuda.

- `set_voice(ref_audio, sr)` → `codec_encode` the reference → speaker-prefix rows (zero-shot clone). Preset voice ("Junhao") when no reference set.
- `generate_stream(text)` → tokenize → AR loop → **incremental codec decode per chunk** (`codec_decode_step`), yielding f32 audio deltas. **Always incremental** — the full-decode path is never called (the 10.8 GB phantom).
- `generate(text)` = drain `generate_stream` into one buffer.

## Catalog + resolver

### `catalog.py` — `TtsModel`

```python
@dataclass(frozen=True)
class TtsModel:
    id: str
    name: str
    languages: tuple[str, ...]
    deployments: tuple[Deployment, ...]   # reuse existing Deployment
    repos: tuple[str, ...] = ()           # HF repos for download
    urls: tuple[str, ...] = ()            # extra files (e.g. matcha vocoder)
    clones: bool = False
    streaming: bool = False
    sample_rate: int = 24000              # native rate (engine resamples to 24k)
    recommended: bool = False
    sort_order: int = 99
```

Reference rows (each gpu-cuda + cpu, same backend NAME, resolver picks provider by tier):

| id | backend | clones | streaming | native SR | repos |
|---|---|---|---|---|---|
| `piper-en-amy` (+more later) | `sherpa_tts` | ✗ | ✗ | 16k | csukuangfj mirror |
| `matcha-icefall-en` | `sherpa_tts` | ✗ | ✗ | 22.05k | acoustic repo + vocoder url |
| `kokoro-multi` | `sherpa_tts` | ✗ | ✗ | 24k | sherpa kokoro repo |
| `vits-icefall-zh-aishell3` | `sherpa_tts` | ✗ | ✗ | 16k | sherpa vits-zh repo |
| **`moss-tts-nano`** | `moss_onnx` | ✓ | ✓ | 48k→24k | `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` + `…/MOSS-Audio-Tokenizer-Nano-ONNX` |

Plus `tts_models()` / `tts_model(id)`. `Deployment.compute_type` is informational for ONNX ("fp32").

### `accel.py`

- **`resolve_tts(model_id, override="auto")`** → reuse the ASR-style `_resolve_model` (filter to installed-backend + tier-available, rank gpu-cuda ≫ cpu, override pins tier, bench demotes proven-slow GPU, CPU floor last). No `select_variant` (no quant variants yet).
- **`_installed()`** add: `"sherpa_tts": "sherpa_onnx"`, `"moss_onnx": "onnxruntime"`.
- **`measure_rtf_tts(backend, plan, model_id, machine)`** — synth a fixed sentence, `RTF = elapsed / audio_seconds`, cached under a `"tts:"`-namespaced key. Feeds AUTO-mode demotion + the renderer perf badge.
- **VRAM gate** — add `".onnx"` to `_WEIGHT_EXTS` (or set `est_bytes` on TTS deployments) so the proactive gate can size ONNX models; TTS models are ≤~1 GB so the on-OOM fallback covers the rest.

## Engine + WS protocol

### `tts_engine.py` (rewrite, process singleton)

- `init(model_id, device="auto", language="")` → `close()` (VRAM hygiene) → `resolve_tts` → `load_measured` → `measure_rtf_tts` → store `resolved` (backend/device/computeType/clones/streaming/rtf/memoryBytes/fallbackReason). Reads the catalog row for `sample_rate`/`clones`/`streaming`.
- `set_voice(audio_f32, sr)` → `backend.set_voice`.
- `generate(text, speed)` → one-shot → `_to_int16_24k_mono(samples, native_sr)` + gen_ms.
- `generate_stream(text, speed, send, should_cancel)` → async loop over `backend.generate_stream`; per chunk resample → `send({type:"tts_chunk", id, seq}, binary=pcm)`; then `tts_done`.
- `close()` → `backend.unload()` + `torch.cuda.empty_cache()` (idempotent).
- `_to_int16_24k_mono(f32, src_sr)` — downmix stereo→mono + resample to 24 kHz (linear interp, reverse of `asr_engine._downsample`). The only place native rate (16k/22.05k/48k-stereo) is normalized to the renderer's contract.

### Protocol

| msg | direction | payload |
|---|---|---|
| `tts_init` | →sidecar | `{model, device, language}` → `ready {sampleRate:24000, backend, device, computeType, clones, streaming, rtf, loadTimeMs, fallbackReason?}` |
| `set_voice` | →sidecar | binary ref-audio frame + `{type:"set_voice", sampleRate}` → `ok` |
| `tts_generate` | →sidecar | `{id, text, speed}` → one-shot: `result {id, sampleRate:24000, samples, generationTimeMs}` + binary PCM; streaming: N× `tts_chunk {id, seq}`+binary PCM, then `tts_done {id, totalSamples, generationTimeMs}` |
| `tts_cancel` | →sidecar | `{id}` → sets the stream cancel flag |

- Binary frames reuse `server.py`'s `pending_binary` buffering (no `on_binary` feeder — TTS input is text). Output PCM is **Int16@24k mono**.
- Streaming generate runs **inline in the async handler** (request-scoped, one utterance) — no long-lived `stream_task` like ASR. `tts_cancel` sets a per-id flag the loop checks.
- `server.py`: `tts_init` sets `conn.ctx["owns_tts"]`; connection close → `tts_engine.close()` (frees VRAM).

## Model downloads (`native_models.py`)

Replace the ad-hoc `"piper" in id` hook with a **catalog-driven** path: `download_specs(id)` → `if catalog.tts_model(id): return {repos: model.repos, urls: model.urls}`. No VAD (ASR-only). `model_size`/`model_status`/`model_download`/`model_delete` are already generic over `download_specs` → reused unchanged (progress, cancel, size, delete).

## Renderer integration

- `nativeProtocol.ts`: add `tts_init`/`set_voice`/`tts_generate`/`tts_chunk`/`tts_done`/`tts_cancel` + `ready` TTS fields.
- `LocalNativeClient` (impl `IClient`): TTS path → connect → `tts_init` → (cloning) `setReferenceVoice` (already implemented in `NativeTtsClient`) → per sentence `tts_generate` → collect `result` (one-shot) or `tts_chunk`→`tts_done` (streaming) → push Int16@24k into `ModernAudioPlayer` (existing delta-audio-out contract).
- `nativeCatalog.ts`: TTS rows; `nativeModelStore`: `ttsLoading`/`ttsResolved` (perf badge + connecting state).
- Per-stage seam (#261): native TTS becomes a `TtsEngine` provider, mixing freely with WASM ASR / cloud translation.

### Voice-clone UI

Generalize `VoiceLibrarySection` into a **capability-driven** Voice section:

- **Multi-speaker + style JSON** (e.g. Supertonic-3): keep the existing sid picker + `voice_style.json` import (fields `style_ttl`/`style_dp`).
- **Zero-shot clone** (e.g. MOSS, `clones=true`): accept **raw audio** (`accept="audio/*"`, as `NativeTtsProto` already does), optional MediaRecorder capture; store reference clips in a `voiceStorage`-style library; on session start send via `setReferenceVoice` → `set_voice`.

Both share the section shell (picker + "My Voices" + import/manage/drag-drop); they differ only in the import payload (JSON vs audio) and engine call (sid vs `set_voice`), selected by the model's capability flags. Note: Supertonic's import is style-JSON, **not** raw-wav — do not copy its data model for MOSS; reuse the shell.

## Error handling

- Load fallback via `load_with_fallback` (gpu→cpu, honest OOM); `fallbackReason` in `ready`.
- `server.py` wraps every handler → `error` envelope, never drops the connection.
- **MOSS incremental-only** codec decode (never the 2.3 GB full-decode path); no `kSameAsRequested` arena tweak.
- Clone model without `set_voice` → fall back to preset voice, don't error.
- CUDA requested but EP absent → backend `load()` verifies the session got CUDA → `BackendLoadError` → resolver steps to CPU.
- `tts_cancel` aborts the stream loop cleanly; empty text → empty audio (guarded).

## VRAM hygiene

`TtsEngine.close()` at the start of every `init()` and on connection close (`owns_tts`) → `unload()` + `empty_cache()`. Process singleton → no accumulation. Operating footprint: MOSS streaming ~3.3 GB, sherpa negligible; resolver's proactive gate + on-OOM fallback handle GPU contention.

## Testing

| Test | Covers |
|---|---|
| `test_tts_backends.py` | each backend `load/set_voice/generate/unload` (CPU) |
| `test_tts_engine.py` | `init/generate/generate_stream/close`, resample-to-24k, streaming deltas + `tts_done`, clone-without-set_voice fallback |
| `test_catalog.py` (extend) | TTS rows present; `resolve_tts` plan ordering |
| `test_server_*.py` (extend) | TTS protocol envelopes + binary framing |
| GPU smoke (`SOKUJI_RUN_GPU=1`) | MOSS cuda streaming RTF+VRAM (regression-guards 3.3 GB / 3.6×), sherpa cuda — from the spike harness |
| Renderer | `NativeTtsClient` protocol; capability-driven Voice section (sid vs reference-clip) |

## Dependencies

- `onnxruntime-gpu==1.22` (CUDA 12 / cuDNN 9 — matches torch cu12x; reuses torch's nvidia libs via preload/LD_LIBRARY_PATH). The default pip `sherpa-onnx` wheel is CPU-only; the GPU pack uses `sherpa-onnx …+cuda12.cudnn9`. Both pulled by the GPU pack only; CPU pack uses CPU `onnxruntime` + CPU `sherpa-onnx`.

## Future extensions

- HQ tier (MOSS-Realtime-2B / Qwen3-TTS) as an isolated torch/vLLM backend hosting mode (the seam's `STREAMING`/`CLONES` contract already accommodates it).
- More A-class catalog rows; Supertonic raw-ORT backend; Pocket-TTS (via sherpa OfflineTts, offline+callback).
- A-class sentence-granularity progressive emission via the OfflineTts callback, if ever needed.
