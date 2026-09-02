#!/bin/bash
# Alternative decoder quantizations for the int4-RTN collapse on zh-fleurs1883: int4 block 32, and int8.
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx || exit 1
PY=../qwen3-venv/bin/python
SRC=output/qwen3-asr-0.6b
for v in q4b32 int8; do
  mkdir -p output/$v
  for f in encoder.onnx embed_tokens.bin tokenizer.json tokenizer_config.json vocab.json added_tokens.json config.json; do ln -sfn ../qwen3-asr-0.6b/$f output/$v/$f; done
done
$PY quantize_nbits.py --input $SRC --output output/q4b32 --bits 4 --block-size 32 --accuracy-level 4 > ../quant-q4b32.log 2>&1; echo "q4b32 exit=$?"
$PY quantize_nbits.py --input $SRC --output output/int8 --bits 8 --block-size 64 --accuracy-level 4 > ../quant-int8.log 2>&1; echo "int8 exit=$?"
ls -l --block-size=M output/q4b32 output/int8 | grep -v '^l' | awk '{print $5, $9}'
cd .. || exit 1
S4=$(ls qwen3-asr-onnx/output/q4b32 | grep -o 'decoder_init\..*\.onnx$' | sed 's/decoder_init//; s/\.onnx$//' | head -1)
S8=$(ls qwen3-asr-onnx/output/int8 | grep -o 'decoder_init\..*\.onnx$' | sed 's/decoder_init//; s/\.onnx$//' | head -1)
echo "suffixes: q4b32=$S4 int8=$S8"
CLIPS=zh-fleurs1883.wav,ja-fleurs1869.wav,ja-cv0.wav,jfk.wav,zh-fleurs1852.wav
qwen3-venv/bin/python run_onnx_cpu.py --dir qwen3-asr-onnx/output/q4b32 --suffix "$S4" --threads 8 --clips $CLIPS --out cpu-q4b32.json 2>&1 | grep -v 'Warning\|warn\|regex' | tail -7
qwen3-venv/bin/python run_onnx_cpu.py --dir qwen3-asr-onnx/output/int8 --suffix "$S8" --threads 8 --clips $CLIPS --out cpu-int8.json 2>&1 | grep -v 'Warning\|warn\|regex' | tail -7
