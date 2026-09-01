# Layout v2 — decisions and measurements

Working dir on the GB10: `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2`.

## Task 1 — prefill on `input_embeds`

FP32 v2 (`export_v2.py`) vs FP32 v1 on `jfk.wav`, `ja-fleurs1828.wav`, `zh-fleurs1883.wav`:
token-identical (30/30, 30/30, 34/34). The v2 `decoder_init.onnx.data` is still 2.38 GB in
FP32 because the embedding and `lm_head` are tied — removing the gather removes no bytes
until quantization, where `lm_head` becomes a MatMulNBits weight instead of an fp32 table.

## Task 2 — RMSNorm / encoder fusion (`optimize_graphs.py`, in place)

- encoder.onnx: BiasGelu 19, Gelu 3, LayerNormalization 2, SkipLayerNormalization 35;
  699 → 514 nodes. Output vs the unfused v1 encoder on jfk: max abs diff 6.5e-6.
- decoder_init / decoder_step: SimplifiedLayerNormalization 113 each; 2198 → 1518 and
  2266 → 1586 nodes. Token-identical to v1 FP32 on the three clips.
- Kept. Contrib ops introduced (`com.microsoft` SkipLayerNormalization, BiasGelu,
  SimplifiedLayerNormalization) must load on the ORT-web WebGPU EP — verified in Task 8.
- `encoder.fp16.onnx` is the pipeline's separate native-fp16 export and was not fused.

## Task 5 — embedding table

Per-row symmetric int8 (`embed_int8.py`): max |w| 0.2754, max abs dequant error 1.08e-3,
mean 1.9e-4; 155.6 MB + 0.61 MB scales (fp16 would be 311 MB). With int8 rows used for
both the prefill prompt and the step lookups the FP32 v2 decoders stay token-identical to
v1 on the three clips → **int8 shipped**.

## Task 6 — prompt_config.json

prefix `[151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669]`, suffix
`[151670, 151645, 198, 151644, 77091, 198]`, 16 language prefixes of the form
`[11528, <name-token>, 151704]` (e.g. zh `[11528, 8453, 151704]`, ja `[11528, 10769, 151704]`).
