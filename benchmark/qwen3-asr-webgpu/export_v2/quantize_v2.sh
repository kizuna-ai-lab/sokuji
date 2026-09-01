#!/bin/bash
# int4 RTN block 32 (accuracy level 4) for both v2 decoders, then dedupe the identical
# tensors of decoder_init / decoder_step into one shared data file (decoder_weights.int4.data).
set -e
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx
PY=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python
$PY quantize_nbits.py --input output/v2 --output output/v2 --bits 4 --block-size 32 --accuracy-level 4 2>&1 | grep -v 'Progress:' | tail -8
$PY share_weights.py output/v2 --suffix int4 --verify 2>&1 | tail -12
echo "== int4 files"
ls -l --block-size=M output/v2 | awk '{print $5, $9}' | grep -E 'int4|weights'
