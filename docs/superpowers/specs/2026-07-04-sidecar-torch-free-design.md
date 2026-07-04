# Torch-free native sidecar (onnxruntime + llama.cpp)

**Date**: 2026-07-04
**Branch**: `native-torch-free` (off `native-sidecar`)
**Status**: Draft — Phase A/B implementable now; Phase C staged per model

## Goal

Remove PyTorch and `transformers` from the sidecar entirely. Every stage runs on
one of two runtime families:

- **ONNX family**: onnxruntime (CPU + CUDA EP), sherpa-onnx, ctranslate2
- **ggml family**: llama.cpp (`llama-server`, already the whole translate-LLM path)

Install budget: **≤ 3 GB** for the GPU flavor, ideally ≤ 2 GB; CPU flavor well
under 1.5 GB. No existing model card is deleted; a card whose torch-free runtime
is not ready yet keeps its row but loses only the affected *tier* (hardware
gating already renders that correctly in the UI).

## Why now

- Translate domain is already torch-free (9 LLM cards → llama-server GGUF,
  13 Opus cards → ONNX). `transformers` is no longer needed for translation.
- Our onnxruntime PR #29525 (GQA `attention_bias` on the CUDA EP) is merged
  upstream — the next ORT release unblocks Voxtral on the CUDA EP, the last
  model that genuinely needed torch for GPU inference.
- The venv is 8.7 GB. Measured breakdown (MB, cu128 GPU install):

  | package | MB | why present | verdict |
  |---|---|---|---|
  | nvidia/* (torch's CUDA+cuDNN) | 4298 | torch cu128 | drop with torch; re-add only the subset ORT/CT2 need |
  | torch | 1612 | transformers/funasr backends | **drop** |
  | onnxruntime-gpu | 773 | MOSS/Supertonic/Qwen3-TTS/Opus | keep (becomes the primary runtime) |
  | triton | 640 | torch dep | drops with torch |
  | llvmlite + numba | 189 | librosa | drop by replacing librosa |
  | scipy(+libs) | 136 | librosa/funasr chain | drops with them |
  | ctranslate2(+libs) | 133 | faster-whisper | keep |
  | cuda (cuda-python) | 107 | torch chain | drop |
  | av | 106 | faster-whisper | keep |
  | transformers | 98 | speech-LLM ASR + AutoTokenizer | **drop** |
  | modelscope+jieba+sklearn | 157 | funasr | **drop** |
  | sympy, networkx | 72 | torch deps | drop with torch |
  | mistral_common | 37 | Voxtral tokenizer | keep (torch-free) |
  | sherpa_onnx | 36 | SenseVoice/piper | keep |

  MEASURED clean installs (2026-07-04, setup.sh --no-models, ORT 1.23.2,
  transcribe-cpp 0.1.1; ctranslate2/faster-whisper also gone with the
  all-transcribe.cpp ASR decision):

  | flavor | total | biggest pieces |
  |---|---|---|
  | CPU (`onnxruntime`) | **397 MB** | transcribe_cpp 88 + sympy 57 + ORT 52 + numpy 65 + sherpa 36 |
  | GPU (`onnxruntime-gpu` + nvidia wheels) | **3.1 GB** | nvidia cudnn 1242 + cublas 817 + nvrtc 217 + ORT-gpu 466 |

  Down from 8.7 GB. NOTE the GPU flavor's extra ~2.7 GB serves ONLY the TTS
  CUDA tiers (MOSS/Supertonic/Qwen3-TTS) — ASR gets Vulkan GPU acceleration
  from the stock 88 MB transcribe.cpp wheel even in the CPU flavor. A slim
  default install can therefore ship the CPU flavor and offer "TTS GPU
  acceleration" as an opt-in that installs onnxruntime-gpu + nvidia wheels.
  Gotcha found during the rebuild: `compressed-tensors` (an FP8-era leftover
  in requirements.txt) silently pulled torch+triton+transformers+nvidia back
  in (+4.1 GB) — removed; the torch-free import gate test now guards the
  package tree, and D2's import-health check guards the venv.

## Per-model migration table

### ASR

| card | today | torch-free target | notes |
|---|---|---|---|
| whisper-tiny…large-v3 (5) | ctranslate2 | **keep as-is** | faster-whisper is torch-free; CT2 CUDA uses the same nvidia pip libs as ORT |
| sense-voice | funasr (torch) GPU+CPU | **sherpa-onnx CPU** now; optional ORT-CUDA later | `SherpaBackend.from_sense_voice` already exists; CPU RTF ~0.03 (33× realtime) makes the GPU tier a nice-to-have |
| fun-asr-mlt-nano | funasr (torch) GPU+CPU | ONNX export TBD | speech-LLM (SenseVoice enc + Qwen3-0.6B dec); investigate sherpa-onnx/community export; until then the card stays with **no available tier** (hardware-gated display), not deleted |
| cohere-transcribe-03-2026 | transformers GPU | **ORT** from `onnx-community/cohere-transcribe-03-2026-ONNX` | proven in WASM path; CPU RTF 0.14–0.31 → ships with a *cpu tier it never had*; CUDA EP works today (no GQA-bias in its graph) |
| granite-speech-4.1-2b / -plus | transformers GPU | **ORT** from `onnx-community/granite-speech-4.1-2b-ONNX` (plus variant TBD on HF) | proven in WASM path (granite-speech worker) |
| qwen3-asr-1.7b | transformers fork (PR #43838) GPU | **ORT** community export | drops the git-pinned transformers fork entirely |
| voxtral-mini-4b-realtime | transformers fork GPU | **ORT** from `onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX` | CUDA tier **gated on the first ORT release containing #29525**; until then: cpu tier off (too slow), tier shows unavailable. Tokenizer stays `mistral-common` (torch-free) |

### Translate — already done (llama.cpp GGUF + Opus ONNX). No change.

### TTS

| card | today | change |
|---|---|---|
| moss-tts-nano | ORT | none (already torch-free at runtime; `torch.cuda.empty_cache()` best-effort call removed) |
| supertonic-3 | ORT | none |
| qwen3-tts-0.6b/1.7b | ORT | replace `AutoTokenizer` → `tokenizers.Tokenizer.from_file`, `librosa` mel/resample → numpy mel + `soxr`/`soundfile` |
| piper/vits (22) | sherpa-onnx | none |

## Shared infra changes

1. **accel.py**: `torch.cuda.get_device_properties/get_device_capability/
   mem_get_info` → NVML via `nvidia-ml-py` (~1 MB, pure ctypes). Same probing
   contract (vram_mb, compute capability, free bytes); returns "no CUDA" when
   NVML is absent (macOS) exactly as torch did.
2. **tts_engine.py**: drop the best-effort `torch.cuda.empty_cache()`.
3. **tokenizer**: `tokenizers` (already a requirement) replaces AutoTokenizer.
4. **mel**: `qwen3_tts/mel.py` reimplements the Slaney filterbank in numpy
   (drop `librosa`, and with it numba/llvmlite/scipy).
5. **audio io/resample**: `librosa.load/resample` → `soundfile` + `soxr`.
6. **voxtral_stream.py**: `TextIteratorStreamer` disappears with the ORT
   decode loop (plain generator over decode steps).

## Dependency set after

`requirements.txt` (all flavors): numpy, websockets, sentencepiece,
huggingface_hub, zstandard, psutil, tokenizers, soundfile, soxr,
nvidia-ml-py, mistral-common[audio], sherpa-onnx, faster-whisper.

Flavor-specific (setup.sh):
- CPU: `onnxruntime`
- GPU (linux/win): `onnxruntime-gpu` + `nvidia-cudnn-cu12` + `nvidia-cublas-cu12`
  (+ cudart/curand as required by the EP import check); CT2 discovers the same
  wheels via `LD_LIBRARY_PATH`/preload (mirrors today's `_cudnn_preload.py`).

Gone: torch, torchaudio, triton, transformers (git fork), funasr, modelscope,
librosa, numba, llvmlite, scipy (unless another dep re-pins it).

## ORT version strategy

- Baseline pin moves 1.20.1 → the current stable (CUDA 12 build).
- Voxtral CUDA tier additionally requires the first release with #29525;
  `catalog.py` gates that deployment on `onnxruntime.__version__ >=` that
  release, so the card exposes the tier automatically once the venv updates.
- The GroupQueryAttentionFusion truncation bug (#29524) workaround — disable
  that fusion / opt-level basic — applies to the Voxtral session options.

## transcribe.cpp CUDA vs Vulkan (measured 2026-07-04, RTX 4070 SUPER)

The GH release DOES ship a CUDA native tarball (216MB) and the binding can
load it (`TRANSCRIBE_LIBRARY=<dir>/libtranscribe.so`, dev-tree path; or a
future `transcribe-cpp[cu12]` provider once its PyPI package stops being a
0.0.0 placeholder). Verified working — and measurably SLOWER than Vulkan on
Ada hardware, where ggml's Vulkan backend uses NV_coopmat2 matrix cores:

| model | cuda | vulkan |
|---|---|---|
| cohere batch | RTF 0.0685 | **RTF 0.0109** |
| voxtral streaming | RTF 0.495 | **RTF 0.121** |

The CUDA lib is also NOT self-contained (links libcudart/libcublas.so.12 —
needs the system CUDA toolkit or the nvidia pip wheels + a preload step).
Decision: stay on the stock wheel's Vulkan; revisit CUDA only if some
hardware/driver combo shows Vulkan losing (the `TRANSCRIBE_NATIVE_PROVIDER` /
`TRANSCRIBE_LIBRARY` seams make it a drop-in, llama_runtime-style download).

## Cross-platform / multi-accelerator matrix

The torch-free stack must serve at least Linux/Windows/macOS and NVIDIA + CPU
today, with room for other accelerators. Removing torch *improves* this: torch
wheels were the only NVIDIA-shaped piece of the base install.

| layer | Linux | Windows | macOS | non-NVIDIA future |
|---|---|---|---|---|
| GPU probe | NVML (driver-provided) | NVML | n/a — `_apple_silicon()` | DXGI/DML via ORT provider list (`_dml_adapters` already probes), ROCm-SMI later |
| onnxruntime | `onnxruntime-gpu` (CUDA EP) / `onnxruntime` | `onnxruntime-gpu` or `onnxruntime-directml` (any-GPU) | `onnxruntime` (CoreML EP available) | DirectML covers AMD/Intel on Windows; ROCm EP on Linux |
| llama.cpp | cuda/vulkan/cpu flavors | cuda/vulkan/cpu | metal | vulkan flavor already covers AMD/Intel |
| ctranslate2 | CUDA or CPU | CUDA or CPU | CPU | CPU-only elsewhere |
| sherpa-onnx | CPU wheel | CPU wheel | CPU wheel | — |

Rules the code must keep honoring:
- every probe degrades to "absent" (never raises) — `nvidia-ml-py` is safe to
  install everywhere because importing it without an NVIDIA driver just fails
  the `nvmlInit()` call;
- tier availability stays data-driven (`_tier_available` + `installed` set), so
  adding `gpu-dml`/`gpu-vulkan`/`gpu-metal` deployments to catalog rows is the
  whole work of enabling another accelerator for a model;
- setup.sh selects the ORT package per OS (Darwin → `onnxruntime`,
  win+GPU → directml-or-cuda, linux+NVIDIA → `onnxruntime-gpu`), never
  unconditionally.

## Risks

- **Fun-ASR-Nano** has no confirmed ONNX path. Mitigation: keep card, gate tier.
- **Speech-LLM ORT decode speed on CPU** is untested for Granite/Qwen3-ASR —
  those stay GPU-tier-only initially (same availability as today).
- **ORT CUDA EP lib subset**: exact nvidia wheel list must be verified by
  importing `onnxruntime` with the CUDA EP on a clean venv (Phase D check).
- **CT2 + ORT sharing nvidia wheels**: ctranslate2 needs cuDNN 9/cuBLAS from
  the same major; verify with a whisper GPU smoke test.
