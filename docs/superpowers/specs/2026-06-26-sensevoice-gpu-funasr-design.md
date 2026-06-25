# GPU-native SenseVoice via FunASR — Design

**Date**: 2026-06-26
**Branch**: `native-sidecar`
**Status**: Approved design, pending implementation plan

## Summary

Replace the CPU-only sherpa-onnx SenseVoice path in the native sidecar with a
PyTorch FunASR backend that runs `SenseVoiceSmall` on **both GPU and CPU**,
honoring an explicit device selection. This brings SenseVoice in line with the
other torch-based ASR engines (Whisper-CUDA, Granite, Qwen3) that already use
the resolver/catalog seam for GPU acceleration.

## Background & motivation

SenseVoice today runs through `SherpaBackend` (`NAME="sherpa"`) using the
int8 ONNX export. The pip `sherpa-onnx` wheel bundles a CPU-only onnxruntime
(verified: 24 MB lib, no cudart/cudnn linkage, 0 CUDA kernel symbols), so
SenseVoice **never resolves to CUDA** — its catalog row has only a `cpu` tier.
Every other ASR engine in the sidecar reaches the GPU through torch; SenseVoice
is the odd one out.

We want SenseVoice on the GPU like the rest, using the same backend seam.

## Runtime decision

`SenseVoiceSmall` is the model in all four reference HF links. The decision was
*which runtime*:

- **FunASR (PyTorch)** — chosen. Official reference runtime (the HF Space demo),
  torch+CUDA, mirrors the existing `TransformersBackend`. Recovers the
  language/emotion/event tags. Single new dep: `funasr`.
- transformers-native — rejected: no official SenseVoice model class in
  transformers or the sidecar's pinned fork.
- GGUF / SenseVoice.cpp — rejected: CPU-first ggml runtime, immature CUDA path,
  non-Python, doesn't match the torch seam.

## Verification (done on this branch)

`funasr==1.3.14` installed into the worktree venv without disturbing the cu128
torch. `SenseVoiceSmall` loaded from HF (`FunAudioLLM/SenseVoiceSmall`) and run
against the cached sherpa SenseVoice test clips (zh/en/ja/ko/yue), feeding
**float32 @ 16 kHz ndarrays** — the exact input `AsrEngine` hands a backend.

| device | RTF | warm load | VRAM | correctness |
|--------|-----|-----------|------|-------------|
| GPU (cuda:0, fp16) | 0.003–0.006 | ~2.5 s | 940 MB peak | all 5 langs correct |
| CPU (fp32)         | 0.028–0.031 | ~2.1 s | —    | all 5 langs correct |

Both tiers are correct and fast. CPU RTF ~0.03 (≈33× realtime) is faster than
the sherpa int8 floor it replaces, which justifies removing sherpa entirely
rather than keeping it as a sub-floor. Raw output carries
`<|lang|><|emotion|><|event|><|withitn|>` prefixes (e.g.
`<|en|><|NEUTRAL|><|Speech|><|withitn|>…`).

## Design

### Decisions locked
- **Text-only output**: strip all SenseVoice tags, return the clean transcript.
  `AsrResult` stays `{text, language}`; no emotion/event plumbing. (Matches
  today's renderer contract; emotion/event is explicitly out of scope.)
- **Replace sherpa**: the FunASR backend serves both the `gpu-cuda` and `cpu`
  tiers for SenseVoice. The `sherpa` backend is removed from the SenseVoice
  catalog row.

### 1. New backend — `FunAsrSenseVoiceBackend` (`backends.py`)

Mirrors `TransformersBackend`. `NAME="funasr_sensevoice"`. Registered with
`@register_backend`. Implements the duck-typed backend protocol:

- `load(model_ref, device, compute_type)`:
  - Map tier → FunASR device: `"gpu-cuda"`/`"cuda"` → `"cuda:0"`; `"cpu"` → `"cpu"`.
  - `AutoModel(model=model_ref, hub="hf", device=<mapped>, disable_update=True)`.
  - **Honor the device given** — no GPU-only guard (contrast `Qwen3AsrBackend`).
    Raise `BackendLoadError(reason)` only on real failure (e.g. cuda requested
    but `torch.cuda.is_available()` is False), so the resolver falls back to the
    cpu tier.
- `transcribe(samples_f32_16k, language) -> AsrResult`:
  - `res = model.generate(input=samples, fs=16000, language=(language or "auto"), use_itn=True, batch_size_s=60)`
  - Take `res[0]["text"]`, **strip the SenseVoice tag prefix** (see §2), return
    `AsrResult(text=clean, language=<parsed lang or None>)`.
- `unload()`: drop the model reference; if cuda, `torch.cuda.empty_cache()`.
- `is_loaded` property.

No `STREAMING` flag (offline backend). No `warmup()` — `accel.measure_rtf()`
handles benchmarking externally.

### 2. Tag stripping

SenseVoice prefixes the transcript with `<|lang|><|emotion|><|event|><|withitn|>`.
For text-only output, strip every leading `<|...|>` token. Capture the first
token as the language code for `AsrResult.language` (best-effort; `None` if
absent). Use `funasr.utils.postprocess_utils.rich_transcription_postprocess`
when available (it also handles emoji/itn normalization), falling back to a
simple `re.sub(r"<\|[^|]*\|>", "", text)`.

### 3. Catalog — `catalog.py`

Replace the single sherpa deployment on the `sense-voice` `AsrModel` row with
two FunASR deployments:

```python
sense-voice → (
    Deployment("funasr_sensevoice", "gpu-cuda", "float16", "FunAudioLLM/SenseVoiceSmall", rank=0),
    Deployment("funasr_sensevoice", "cpu",      "float32", "FunAudioLLM/SenseVoiceSmall", rank=1),
)
```

`SherpaBackend` served only SenseVoice, so removing it here leaves the class
unused. Delete the class and its `accel._installed()` gate as cleanup (not
required for correctness; keeping it dead is harmless). The `sherpa-onnx`
dependency can then be dropped from `setup.sh` unless used elsewhere.

The resolver already pins an explicit `device` override to the front of the plan
list, so:
- `device:"cuda"` → FunASR gpu-cuda tier
- `device:"cpu"`  → FunASR cpu tier
- `device:"auto"` → gpu-cuda preferred, cpu fallback (and `measure_rtf` demotes
  GPU only if it benchmarks slower than CPU — won't happen here)

### 4. Install gate — `accel._installed()`

Map `"funasr_sensevoice" → "funasr"` so the backend (and therefore the
SenseVoice catalog row) only advertises when funasr imports.

### 5. Download spec — `native_models.download_specs()`

Point the `sense-voice` branch at the FunASR HF repo:
`{repos: ["FunAudioLLM/SenseVoiceSmall"], urls: [VAD_URL]}` (keep the silero VAD
URL). This lets the sidecar's existing `model_status` / `model_size` /
`model_download` / `model_delete` handlers manage it like every other model.
Remove the sherpa SenseVoice repo reference from the SenseVoice spec (keep the
`SENSE_VOICE_REPO` constant only if still referenced elsewhere; otherwise drop).

### 6. Dependencies — `setup.sh`

Add `funasr` to the ML-stack install step. **Known cost**: funasr pulls a heavy
transitive set (modelscope, oss2, aliyun SDKs, jieba, umap-learn, kaldiio,
hydra-core). Acceptable for the GPU capability; noted as a future
size-optimization candidate (a thin torch-only SenseVoice loader could later
replace the full funasr dependency). The GPU tier requires a CUDA torch build in
the deployed sidecar venv (setup.sh installs CPU torch on Linux by default; GPU
torch is provisioned separately — already true on the dev machine).

### What stays untouched

`server.py`, `__main__.py`, and `asr_engine.py` need no changes. SenseVoice is
an offline backend; the WebSocket transport, the silero VAD segmentation in
`AsrEngine`, the 24 kHz→16 kHz downsample, and the `{type:"result", …}` envelope
are all framework-agnostic and already feed `backend.transcribe(samples,
language)`.

## Testing plan

- **Unit**: tag-stripping helper — feed representative raw strings
  (`<|en|><|NEUTRAL|><|Speech|><|withitn|>hello`, mixed scripts, empty,
  no-tag) → assert clean text + parsed language.
- **Backend smoke** (gated on funasr + cuda availability): `load("…/SenseVoiceSmall",
  "gpu-cuda", "float16")` then `transcribe` a synthetic/canned clip → non-empty
  text; repeat with `("cpu","float32")`.
- **Resolver**: `resolve("sense-voice", override="cpu", machine)` returns the
  cpu FunASR plan first; `override="cuda"` returns gpu-cuda first; `"auto"`
  prefers gpu-cuda when a GPU is present.
- **Regression**: existing `AsrEngine` flow still emits `result` events with the
  new backend (no envelope/timing changes).

## Risks & tradeoffs

- **Dependency bloat** (funasr transitive deps) — accepted; flagged for later.
- **GPU torch requirement** for the cuda tier — environmental, already satisfied
  on dev; must be ensured in packaging.
- **First-run download** (~900 MB model) — handled by existing model-download
  UX; same as other native models.

## Out of scope

- Emotion (SER) / audio-event (AED) tag plumbing to the renderer UI.
- GGUF / SenseVoice.cpp runtime.
- Replacing funasr with a thin torch-only loader (future size optimization).
