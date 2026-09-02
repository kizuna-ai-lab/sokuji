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

echo "[setup] base requirements (numpy, websockets, huggingface_hub, sokuji-native, ...) + pytest"
# scipy is a test-only dep (tests/test_qwen3_backend.py builds WAV fixtures with
# scipy.io.wavfile); it is NOT in requirements.txt so bundles never ship it.
# requirements.txt itself pins the sokuji-native release wheel per platform
# (spec §4.6), so this one install already gets ASR/translate/TTS working.
"$PY" -m pip install -q -r requirements.txt pytest scipy

# sokuji-native local-wheel OVERRIDE: only for developers testing an unreleased
# native build. When present, install it AFTER requirements.txt so it shadows
# the pinned release wheel above. Build a local wheel with
#   native/ci/build.sh none <plat>     (CPU)   or   native/ci/build.sh vulkan <plat>
# or point SOKUJI_NATIVE_WHEEL at a wheel file / URL.
NATIVE_WHEEL="${SOKUJI_NATIVE_WHEEL:-}"
if [ -n "$NATIVE_WHEEL" ]; then
    echo "[setup] override: local sokuji-native wheel ($NATIVE_WHEEL) shadows the release pin"
    "$PY" -m pip install -q --force-reinstall "$NATIVE_WHEEL"
fi

# Stage runtimes (torch-free since 2026-07-04; ONNX-free since slice 4):
#   ASR       -> sokuji-native (local wheel installed above; ggml family:
#                CPU+Vulkan bundled on linux/win, Metal on macOS — accelerates
#                NVIDIA/AMD/Intel through Vulkan, no CUDA runtime needed)
#   Translate -> sokuji-native (same wheel as ASR; in-process llama.cpp, slice 3)
#   TTS       -> sokuji-native (same wheel again; in-process audio.cpp, slice 4—
#                onnxruntime/sherpa-onnx/mlx-audio and their CUDA/DirectML/sbsa
#                install branches died with the ONNX/sherpa/MLX TTS backends
#                they served; every SKU now installs the exact same requirements)

if [ "${1:-}" = "--no-models" ]; then
  echo "[setup] deps installed; skipping models (--no-models). Done."
  exit 0
fi

echo "[setup] prefetching models (Pocket TTS + translation LLM + ASR + VAD; can exceed 1.5GB)…"
"$PY" prefetch_models.py
echo "[setup] done."
