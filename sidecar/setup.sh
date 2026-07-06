#!/usr/bin/env bash
# Tier-0 setup for the native Python sidecar: venv + all stage runtimes + models.
# Idempotent. Reuses an existing .venv. Override knobs via env:
#   PYTHON=python3.11            interpreter for a fresh venv (default: python3.11 else python3)
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
"$PY" -m pip install -q -r requirements.txt pytest

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

# onnxruntime flavor (TTS + Opus translate). NVIDIA on Win/Linux uses
# onnxruntime-gpu with ORT's official cuDNN/cuBLAS extras; __main__'s
# _preload_cuda_dlls() (onnxruntime.preload_dlls) pins them at startup — no
# hand-rolled preload, no LD_LIBRARY_PATH surgery (spec D8). Non-NVIDIA/macOS
# use the CPU build here; the Windows DirectML SKU ships onnxruntime-directml
# via the P7 bundle, not this dev script. Override with ONNXRUNTIME_PACKAGE=…
if [ -z "${ONNXRUNTIME_PACKAGE:-}" ]; then
  case "$(uname -s)" in
    Darwin) ONNXRUNTIME_PACKAGE="onnxruntime==1.23.2" ;;
    *) if command -v nvidia-smi >/dev/null 2>&1; then
         ONNXRUNTIME_PACKAGE="onnxruntime-gpu[cuda,cudnn]==1.23.2"
       else
         ONNXRUNTIME_PACKAGE="onnxruntime==1.23.2"
       fi ;;
  esac
fi
echo "[setup] onnxruntime: $ONNXRUNTIME_PACKAGE"
"$PY" -m pip install -q "$ONNXRUNTIME_PACKAGE"

if [ "${1:-}" = "--no-models" ]; then
  echo "[setup] deps installed; skipping models (--no-models). Done."
  exit 0
fi

echo "[setup] prefetching models (Pocket TTS + translation LLM + ASR + VAD; can exceed 1.5GB)…"
"$PY" prefetch_models.py
echo "[setup] done."
