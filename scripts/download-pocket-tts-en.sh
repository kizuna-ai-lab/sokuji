#!/usr/bin/env bash
# Downloads the English Pocket TTS int8 bundle from the KevinAHM/pocket-tts-web
# Space into public/wasm/pocket-tts-en/ for the dev playground PoC.
# These files are NOT committed (see .gitignore).
set -euo pipefail

SPACE="https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main"
OUT="public/wasm/pocket-tts-en"
mkdir -p "$OUT"

# Confirm the exact dated bundle dir at
#   https://huggingface.co/spaces/KevinAHM/pocket-tts-web/tree/main/onnx
# and pass it as $1 if it differs.
BUNDLE="${1:-onnx/english_2026-04}"

# Files the worker loads (5 int8 onnx + tokenizer + per-bundle metadata).
FILES=(
  "flow_lm_main_int8.onnx"
  "flow_lm_flow_int8.onnx"
  "mimi_encoder_int8.onnx"
  "mimi_decoder_int8.onnx"
  "text_conditioner_int8.onnx"
  "tokenizer.model"
  "bundle.json"
)

for f in "${FILES[@]}"; do
  echo "Downloading $BUNDLE/$f ..."
  curl -fL "$SPACE/$BUNDLE/$f" -o "$OUT/$f"
done

echo "Done. Bundle in $OUT/"
ls -la "$OUT"
