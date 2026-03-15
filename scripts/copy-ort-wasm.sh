#!/usr/bin/env bash
# Copy ONNX Runtime WASM files from node_modules into public/wasm/ort/
# so that translation workers load them locally instead of from cdn.jsdelivr.net.
#
# Called automatically via npm postinstall.

set -euo pipefail

SRC="node_modules/onnxruntime-web/dist"
DEST="public/wasm/ort"

# Needed WASM variants:
#   asyncify  — default (non-Safari browsers)
#   plain     — Safari fallback (no asyncify support)
#   jsep      — WebGPU/WebNN backend (used by Whisper-WebGPU, Qwen workers)
FILES=(
  "ort-wasm-simd-threaded.asyncify.mjs"
  "ort-wasm-simd-threaded.asyncify.wasm"
  "ort-wasm-simd-threaded.mjs"
  "ort-wasm-simd-threaded.wasm"
  "ort-wasm-simd-threaded.jsep.mjs"
  "ort-wasm-simd-threaded.jsep.wasm"
)

if [ ! -d "$SRC" ]; then
  echo "[copy-ort-wasm] onnxruntime-web not installed yet — skipping."
  exit 0
fi

mkdir -p "$DEST"

for f in "${FILES[@]}"; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$DEST/$f"
  else
    echo "[copy-ort-wasm] WARNING: $SRC/$f not found"
  fi
done

echo "[copy-ort-wasm] Copied ${#FILES[@]} ORT WASM files → $DEST/"
