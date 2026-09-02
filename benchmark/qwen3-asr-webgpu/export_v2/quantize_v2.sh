#!/bin/bash
# int4 RTN block 32 (accuracy level 4) for both v2 decoders, then dedupe the identical
# tensors of decoder_init / decoder_step into one shared data file (decoder_weights.int4.data).
# usage: quantize_v2.sh <v2 model dir>
#   QWEN3_ASR_ONNX_DIR  andrewleech/qwen3-asr-onnx checkout (default: current directory)
#   PY                  python with the export deps (default: $QWEN3_ASR_ONNX_DIR/.venv/bin/python)
set -e
D=$(cd "$1" && pwd)
P=${QWEN3_ASR_ONNX_DIR:-$PWD}
PY=${PY:-$P/.venv/bin/python}
cd "$P"
$PY quantize_nbits.py --input "$D" --output "$D" --bits 4 --block-size 32 --accuracy-level 4 2>&1 | grep -v 'Progress:' | tail -8
$PY share_weights.py "$D" --suffix int4 --verify 2>&1 | tail -12
echo "== int4 files"
ls -l --block-size=M "$D" | awk '{print $5, $9}' | grep -E 'int4|weights'
