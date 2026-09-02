#!/bin/bash
# fp16 activations on top of the shared-weight int4 graphs; RMSNorm / softmax / rotary stay
# fp32 (fp16 overflow in the variance produced NaN logits in the spike). Then dedupe the
# duplicate Cast nodes ORT's converter emits and share the weights into one data file.
set -e
D=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2
PY=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python
B=/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu
rm -f "$D"/decoder_init.q4f16.onnx* "$D"/decoder_step.q4f16.onnx* "$D"/decoder_weights.q4f16.data
$PY "$B/to_q4f16_ort.py" "$D" q4f16 2>&1 | grep -v Warning | tail -8
$PY "$B/dedupe_values.py" "$D/decoder_init.q4f16.onnx" "$D/decoder_step.q4f16.onnx"
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && $PY share_weights.py output/v2 --suffix q4f16 --verify 2>&1 | tail -12
echo "== q4f16 files"
ls -l --block-size=M "$D" | awk '{print $5, $9}' | grep -E 'q4f16'
