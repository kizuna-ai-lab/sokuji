#!/usr/bin/env bash
# Tier-0 setup for the native Python sidecar: venv + all stage runtimes + models.
# Idempotent. Reuses an existing .venv. Override knobs via env:
#   PYTHON=python3.11            interpreter for a fresh venv (default: python3.11 else python3)
#   HF_HOME=/path/to/cache       where models are cached (default: HF default ~/.cache/huggingface)
#   SOKUJI_TRANSLATE_MODEL=...    translation LLM repo (default: Qwen/Qwen2.5-0.5B-Instruct)
#   SOKUJI_ASR_REPO=...           sherpa-onnx ASR repo
# Flags:
#   --no-models                  install deps only, skip the (~1.5GB+) model download
set -euo pipefail
cd "$(dirname "$0")"   # sidecar/

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if command -v python3.11 >/dev/null 2>&1; then PYTHON=python3.11; else PYTHON=python3; fi
fi

VENV=.venv
if [ ! -d "$VENV" ]; then
  echo "[setup] creating venv with $PYTHON ($($PYTHON --version 2>&1))"
  "$PYTHON" -m venv "$VENV"
fi
PY="$VENV/bin/python"
echo "[setup] venv python: $($PY --version 2>&1)"

"$PY" -m pip install -q --upgrade pip

echo "[setup] base requirements (onnxruntime, numpy, websockets, sentencepiece, huggingface_hub) + pytest"
"$PY" -m pip install -q -r requirements.txt pytest

echo "[setup] stage runtimes: torch (CPU), transformers, sherpa-onnx, faster-whisper"
case "$(uname -s)" in
  Linux) "$PY" -m pip install -q torch --index-url https://download.pytorch.org/whl/cpu ;;
  *)     "$PY" -m pip install -q torch ;;
esac
# transformers→tokenizers + Granite/Qwen3 speech-LLMs; faster-whisper→ASR whisper backend;
# sacremoses→Marian (opus-mt) tokenizer.
# mistral-common[audio]→VoxtralRealtimeProcessor tokenizer (MistralCommonBackend).
# transformers is pinned to an IMMUTABLE commit SHA on the PR #43838 fork (native Qwen3-ASR
# support, not yet in any PyPI release). A SHA is content-addressed, so the fork's branch
# cannot shift the installed code under us (unlike a mutable branch archive). Swap to a
# released 'transformers>=5.13' from PyPI once huggingface/transformers PR #43838 merges.
TRANSFORMERS_REF="git+https://github.com/mbtariq82/transformers@a2ec912647e42dee56eb89e64b0ec539ad9e7b65"
"$PY" -m pip install -q "$TRANSFORMERS_REF" sherpa-onnx faster-whisper sacremoses librosa "mistral-common[audio]>=1.9.0" funasr

if [ "${1:-}" = "--no-models" ]; then
  echo "[setup] deps installed; skipping models (--no-models). Done."
  exit 0
fi

echo "[setup] prefetching models (Pocket TTS + translation LLM + ASR + VAD; can exceed 1.5GB)…"
"$PY" prefetch_models.py
echo "[setup] done."