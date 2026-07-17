#!/usr/bin/env bash
# Tier-0 setup for the native Python sidecar: venv + all stage runtimes + models.
# Idempotent. Reuses an existing .venv. Override knobs via env:
#   PYTHON=python3.12            interpreter for a fresh venv (default: python3.12, else python3.11, else python3)
#   HF_HOME=/path/to/cache       where models are cached (default: HF default ~/.cache/huggingface)
#   SOKUJI_VENV=/path/to/venv    venv dir (default: .venv) — lets CI/size checks build clean envs
# Flags:
#   --no-models                  install deps only, skip the (~1.5GB+) model download
set -euo pipefail
cd "$(dirname "$0")"   # sidecar/

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  # Spec D12: dev venv + all SKU bundles unify on CPython 3.12 (DML needs >=3.11;
  # cp312 wheels verified for the full runtime set). Fall back progressively.
  if command -v python3.12 >/dev/null 2>&1; then PYTHON=python3.12
  elif command -v python3.11 >/dev/null 2>&1; then PYTHON=python3.11
  else PYTHON=python3; fi
fi

VENV="${SOKUJI_VENV:-.venv}"
if [ ! -d "$VENV" ]; then
  echo "[setup] creating venv with $PYTHON ($($PYTHON --version 2>&1))"
  "$PYTHON" -m venv "$VENV"
fi
PY="$VENV/bin/python"
echo "[setup] venv python: $($PY --version 2>&1)"

"$PY" -m pip install -q --upgrade pip

echo "[setup] base requirements (onnxruntime, numpy, websockets, sentencepiece, huggingface_hub) + pytest"
# scipy is a test-only dep (tests/test_qwen3_backend.py builds WAV fixtures with
# scipy.io.wavfile); it is NOT in requirements.txt so bundles never ship it.
"$PY" -m pip install -q -r requirements.txt pytest scipy

# Stage runtimes (torch-free since 2026-07-04):
#   ASR       -> transcribe-cpp (pinned in requirements.txt — the single
#                source for that pin; ggml family: CPU+Vulkan bundled on
#                linux/win, Metal on macOS — the stock wheel accelerates
#                NVIDIA/AMD/Intel through Vulkan, no CUDA runtime needed)
#   Translate -> llama-server binary (downloaded on demand) + Opus CTranslate2
#   TTS       -> onnxruntime (MOSS/Supertonic/Qwen3-TTS) + sherpa-onnx (piper)
#                + mlx-audio (Qwen3-TTS / MOSS on Apple Silicon macOS; installed
#                via requirements.txt's platform-marked pin — a no-op elsewhere)
echo "[setup] stage runtimes: sherpa-onnx"
"$PY" -m pip install -q sherpa-onnx

# onnxruntime flavor (TTS + Opus translate). NVIDIA on Win/Linux x86_64 uses
# onnxruntime-gpu with ORT's official cuDNN/cuBLAS extras; NVIDIA on aarch64
# (DGX Spark, Jetson-class sbsa) auto-installs the matching sbsa build from the
# jetson-ai-lab index (PyPI ships no aarch64 GPU wheel). __main__'s
# _preload_cuda_dlls() (onnxruntime.preload_dlls) pins them at startup — no
# hand-rolled preload, no LD_LIBRARY_PATH surgery (spec D8). Non-NVIDIA/macOS
# use the CPU build here; the Windows DirectML SKU ships onnxruntime-directml
# via the P7 bundle, not this dev script. Override with ONNXRUNTIME_PACKAGE=…

# jetson-ai-lab sbsa index root — its per-CUDA buckets (…/sbsa/cu130, …/cu128)
# host the aarch64 onnxruntime-gpu wheels NVIDIA does not publish to PyPI.
SBSA_INDEX_ROOT="https://pypi.jetson-ai-lab.io/sbsa"

_install_sbsa_onnxruntime_gpu() {
  # NVIDIA aarch64 (DGX Spark / Jetson-class sbsa): pull onnxruntime-gpu from the
  # sbsa bucket matching this box's CUDA runtime. Direct install, no env config.
  # Best-effort — any failure falls back to the CPU wheel so setup still finishes.
  local cuda_ver cuda_major cuda_tag index
  # CUDA runtime version from the nvidia-smi header ("CUDA Version: 13.0"), else nvcc.
  cuda_ver="$(nvidia-smi 2>/dev/null | grep -oE 'CUDA Version: [0-9]+\.[0-9]+' \
              | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
  if [ -z "$cuda_ver" ] && command -v nvcc >/dev/null 2>&1; then
    cuda_ver="$(nvcc --version 2>/dev/null | grep -oE 'release [0-9]+\.[0-9]+' \
                | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
  fi
  if [ -z "$cuda_ver" ]; then
    echo "[setup] onnxruntime: aarch64+NVIDIA but CUDA version undetectable; using CPU build" >&2
    "$PY" -m pip install -q "onnxruntime==1.23.2"
    return 0
  fi
  cuda_major="${cuda_ver%%.*}"                          # 13.0 -> 13
  cuda_tag="cu$(printf '%s' "$cuda_ver" | tr -d '.')"   # 13.0 -> cu130, 12.8 -> cu128
  index="${SBSA_INDEX_ROOT}/${cuda_tag}"
  echo "[setup] onnxruntime: installing sbsa onnxruntime-gpu (CUDA ${cuda_ver}) from ${index}"
  # D1: exactly one `onnxruntime` module per venv — drop any CPU wheel first so
  # the GPU build doesn't collide with it.
  "$PY" -m pip uninstall -y onnxruntime >/dev/null 2>&1 || true
  # --extra-index-url (not --index-url): onnxruntime-gpu resolves from sbsa (its
  # only aarch64 home) while numpy/protobuf/etc. still come from PyPI.
  # --only-binary guards against a surprise sdist building onnxruntime from source.
  if "$PY" -m pip install -q --only-binary=onnxruntime-gpu \
        --extra-index-url "$index" onnxruntime-gpu; then
    # The sbsa wheel needs cuDNN 9.x at RUNTIME (CUDA 13.x itself comes from the
    # system CUDA install that nvidia-smi/nvcc prove is present). The sbsa index
    # does NOT mirror the nvidia-* CUDA wheels, so onnxruntime-gpu[cuda,cudnn]
    # can't resolve there — pull the matching cuDNN straight from PyPI (aarch64
    # wheels exist); __main__._preload_cuda_dlls() (onnxruntime.preload_dlls)
    # loads it from the wheel dir at startup (spec D8, no LD_LIBRARY_PATH).
    if ! "$PY" -m pip install -q "nvidia-cudnn-cu${cuda_major}"; then
      echo "[setup] onnxruntime: WARNING could not install nvidia-cudnn-cu${cuda_major}; " \
           "the CUDA EP will fall back to CPU until cuDNN 9 is available" >&2
    fi
    if "$PY" -c 'import onnxruntime as o,sys; sys.exit(0 if "CUDAExecutionProvider" in o.get_available_providers() else 1)' 2>/dev/null; then
      echo "[setup] onnxruntime: onnxruntime-gpu + cuDNN installed, CUDAExecutionProvider present ✓"
    else
      echo "[setup] onnxruntime: WARNING onnxruntime-gpu installed but CUDAExecutionProvider absent (check NVIDIA driver)" >&2
    fi
  else
    echo "[setup] onnxruntime: sbsa install failed; falling back to CPU build" >&2
    "$PY" -m pip install -q "onnxruntime==1.23.2"
  fi
}

if [ -z "${ONNXRUNTIME_PACKAGE:-}" ] && [ "$(uname -m)" != "x86_64" ] \
    && "$PY" -m pip show onnxruntime-gpu >/dev/null 2>&1; then
  # A previously-installed GPU build (the sbsa branch below on a prior run, or a
  # hand-installed wheel) must survive setup re-runs: installing the CPU wheel
  # next to it would conflict (both provide the `onnxruntime` module). x86_64 is
  # exempt — there the pinned PyPI package below is authoritative.
  echo "[setup] onnxruntime: keeping installed onnxruntime-gpu"
elif [ -z "${ONNXRUNTIME_PACKAGE:-}" ] && [ "$(uname -s)" = "Linux" ] \
    && [ "$(uname -m)" = "aarch64" ] && command -v nvidia-smi >/dev/null 2>&1; then
  _install_sbsa_onnxruntime_gpu
else
  if [ -z "${ONNXRUNTIME_PACKAGE:-}" ]; then
    case "$(uname -s)" in
      Darwin) ONNXRUNTIME_PACKAGE="onnxruntime==1.23.2" ;;
      *) # onnxruntime-gpu ships no aarch64 wheels on PyPI (verified 1.23.2):
         # x86_64 NVIDIA gets the CUDA build; everything else the CPU wheel.
         # (aarch64 NVIDIA is handled by the sbsa branch above.)
         if command -v nvidia-smi >/dev/null 2>&1 && [ "$(uname -m)" = "x86_64" ]; then
           ONNXRUNTIME_PACKAGE="onnxruntime-gpu[cuda,cudnn]==1.23.2"
         else
           ONNXRUNTIME_PACKAGE="onnxruntime==1.23.2"
         fi ;;
    esac
  fi
  echo "[setup] onnxruntime: $ONNXRUNTIME_PACKAGE"
  "$PY" -m pip install -q "$ONNXRUNTIME_PACKAGE"
fi

if [ "${1:-}" = "--no-models" ]; then
  echo "[setup] deps installed; skipping models (--no-models). Done."
  exit 0
fi

echo "[setup] prefetching models (Pocket TTS + translation LLM + ASR + VAD; can exceed 1.5GB)…"
"$PY" prefetch_models.py
echo "[setup] done."
