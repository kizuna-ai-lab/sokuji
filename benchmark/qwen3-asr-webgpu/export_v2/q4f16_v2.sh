#!/bin/bash
# fp16 activations on top of the shared-weight int4 graphs; RMSNorm / softmax / rotary stay
# fp32 (fp16 overflow in the variance produced NaN logits in the spike). Then dedupe the
# duplicate Cast nodes ORT's converter emits and share the weights into one data file.
# usage: q4f16_v2.sh <v2 model dir>
#   QWEN3_ASR_ONNX_DIR  andrewleech/qwen3-asr-onnx checkout (default: current directory)
#   PY                  python with the export deps (default: $QWEN3_ASR_ONNX_DIR/.venv/bin/python)
# pipefail: the converter is piped through grep/tail for readable output; without it a failed
# to_q4f16_ort.py would be hidden behind tail's exit 0 and stale graphs would be deduped/shared.
set -eo pipefail
D=$(cd "$1" && pwd)
P=${QWEN3_ASR_ONNX_DIR:-$PWD}
PY=${PY:-$P/.venv/bin/python}
B=$(cd "$(dirname "$0")/.." && pwd)
rm -f "$D"/decoder_init.q4f16.onnx* "$D"/decoder_step.q4f16.onnx* "$D"/decoder_weights.q4f16.data
$PY "$B/to_q4f16_ort.py" "$D" q4f16 2>&1 | grep -v Warning | tail -8
$PY "$B/dedupe_values.py" "$D/decoder_init.q4f16.onnx" "$D/decoder_step.q4f16.onnx"
cd "$P" && $PY share_weights.py "$D" --suffix q4f16 --verify 2>&1 | tail -12
echo "== q4f16 files"
ls -l --block-size=M "$D" | awk '{print $5, $9}' | grep -E 'q4f16'
