---
license: apache-2.0
base_model: Qwen/Qwen3-ASR-1.7B
language:
  - zh
  - en
  - ja
  - ko
  - yue
  - ar
  - de
  - es
  - fr
  - it
  - pt
  - ru
  - th
  - vi
  - hi
  - id
pipeline_tag: automatic-speech-recognition
tags:
  - onnx
  - onnxruntime-web
  - webgpu
  - qwen3-asr
  - sokuji
---

# Qwen3-ASR-1.7B — ONNX for the browser (onnxruntime-web / WebGPU), layout v2

ONNX export of [Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) (Apache-2.0)
packaged for in-browser inference with onnxruntime-web, built for the
[Sokuji](https://github.com/kizuna-ai-lab/sokuji) local-inference lane. Same layout v2 as
[jiangzhuo9357/Qwen3-ASR-0.6B-ONNX](https://huggingface.co/jiangzhuo9357/Qwen3-ASR-0.6B-ONNX)
(2026-09-03): no embedding table inside any graph, one shared weights file per precision, int8
embedding table, and a `prompt_config.json` that carries every constant a client needs — a
client that runs the 0.6B runs this model unchanged by reading the dims from that file.
Tooling and measurements: `benchmark/qwen3-asr-webgpu/` in the Sokuji repo
(`results/1.7b-notes.md` for the 0.6B comparison).

## Pick a variant

| variant | files | needs | download |
|---|---|---|---|
| `q4` | `encoder.onnx` (fp32, fused) + `decoder_init.int4.onnx` + `decoder_step.int4.onnx` + `decoder_weights.int4.data` | WebGPU | ≈ 2.4 GB + shared files |
| `q4f16` | `encoder.fp16.onnx` + `decoder_init.q4f16.onnx` + `decoder_step.q4f16.onnx` + `decoder_weights.q4f16.data` | WebGPU with `shader-f16` | ≈ 1.6 GB + shared files |

Shared by both: `embed_tokens.int8.bin` (311 MB) + `embed_scales.f32.bin` (0.6 MB),
`prompt_config.json`, `mel_filters.json`, `tokenizer.json`, `tokenizer_config.json`,
`vocab.json`, `added_tokens.json`, `config.json` — about 0.33 GB, so the total download is
≈ 2.7 GB (`q4`) or ≈ 2.0 GB (`q4f16`). `prompt_config.json` → `variants` lists the same file
roles machine-readably. Decoders are MatMulNBits int4, RTN, block 32, accuracy level 4;
`q4f16` additionally runs activations and I/O in fp16 with RMSNorm / softmax / rotary kept in
fp32. Without WebGPU the wasm execution provider is far too slow for live use. Note that
Chrome's Vulkan adapters on Linux (NVIDIA) and on the GB10 expose no `shader-f16`, so those
get `q4`; Windows (D3D12) and macOS (Metal) get `q4f16`.

## Graph contracts

- `encoder.*`: `mel` [1, 128, T] fp32 → `audio_features` [1, A, 2048] fp32 (fp32 I/O for both encoders).
- `decoder_init.*`: `input_embeds` [1, S, 2048], `position_ids` [1, S] int64 → `logits` [1, 1, 151936] (last position only), `present_keys` / `present_values` [28, 1, 8, S, 128].
- `decoder_step.*`: `input_embeds` [1, 1, 2048], `position_ids` [1, 1], `past_keys`, `past_values` → `logits` [1, 1, 151936], `present_*` [28, 1, 8, S+1, 128].
- The KV cache has the same shape as the 0.6B's (28 layers, 8 kv heads, head dim 128): 224 KB
  per token in fp32, 112 KB in fp16. Only the hidden size (2048 vs 1024) and the encoder
  (24 layers, d 1024) differ.
- `q4f16` graphs use fp16 for every float tensor above; `q4` uses fp32. Both decoders of a variant reference the same `decoder_weights.*.data`; hand onnxruntime-web the buffer once (`externalData: [{ path, data }]`) for each session.
- Keep the KV cache on the GPU between steps (`preferredOutputLocation: { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' }`) and dispose the superseded tensors.

## Building the prompt (see `prompt_config.json`)

Identical to the 0.6B card; `prompt_config.json` carries the numbers.

1. Log-mel, Whisper-compatible: 16 kHz, n_fft 400, hop 160 (periodic Hann, centred, reflect
   padding), power spectrum, the 128-bin Slaney filterbank in `mel_filters.json`, `log10` with a
   1e-10 floor, clamp to `max − 8`, `(x + 4) / 4`, last frame dropped.
2. Audio tokens for `T` mel frames: `A = conv(conv(conv(T mod 100))) + 13 · floor(T / 100)` with
   `conv(t) = floor((t + 1) / 2)`.
3. Prompt ids: `prompt.prefix_ids` + `A × prompt.audio_pad_id` + `prompt.suffix_ids`.
4. Embeddings: row `id` of the int8 table times `embed_scales[id]` → fp32 (or fp16 for `q4f16`);
   overwrite the `A` rows at the pad positions with the encoder output. That tensor is
   `input_embeds` for `decoder_init`.
5. Greedy decode with `decoder_step` until `<|endoftext|>` (151643) or `<|im_end|>` (151645);
   `max_new_tokens` 256.
6. Output begins with `language <Name><asr_text>`; drop everything up to and including
   `asr_text_id` (151704). When the language is known, append `language_prefix_ids[<iso>]` to
   the prompt (same ids as for the 0.6B — same tokenizer).

## Validation

- v2 FP32 graphs are token-for-token identical to the v1 FP32 export on English, Japanese and
  Chinese test clips.
- int4 block 32 / q4f16: English and Chinese clips identical to FP32; the Japanese clip differs
  in one word (a hard phrase both FP32 and int4 get partly wrong).
- Encoder fusion removes 26.5 % of encoder nodes and 30 % of decoder nodes; int8 embedding
  max dequantisation error 1.2e-3.

## Measured in the browser (whole pipeline, warm, 13 clips: 8 ja, 4 zh, 1 en; medians)

| device | variant | median RTF | ms / generated token | prefill (10–15 s clip) | vs 0.6B, same box & variant |
|---|---|---|---|---|---|
| RTX 4070 SUPER, Windows 11, Chrome 152 (D3D12) | q4f16 | 0.092 | 24.4 | 52 ms | ms/token ×1.34; dedicated GPU memory 3.3 GB vs 1.9 GB |
| RTX 4070 SUPER, Ubuntu 22.04, Chrome 151 (Vulkan) | q4 | 0.083 | 19.6 | 47 ms | ms/token ×1.17; GPU memory in use 4.9 GB vs 3.1 GB |
| Apple M4 (Mac mini), Chrome 152 (Metal) | q4f16 | 0.111 | 23.4 | 234 ms | ms/token ×1.43; GPU-process footprint 3.9 GB vs 2.2 GB |
| NVIDIA GB10 (aarch64, Vulkan, no shader-f16) | q4 | 0.093 | 22.4 | 63 ms | ms/token ×1.13 |

Quality against the 0.6B on the same clips: Japanese CER 0.147 → 0.070 (the 1.7B fixes the
proper-noun / kana slips of the 0.6B); English and Chinese were already near-perfect. The step
loop is dispatch-bound on every GPU, which is why a decoder with ~2.8× the weights costs only
13–43 % more per token; prefill and the encoder scale closer to the parameter ratio.

## Provenance

Exported with [andrewleech/qwen3-asr-onnx](https://github.com/andrewleech/qwen3-asr-onnx)
(`qwen-asr` 0.0.6, transformers 4.57.6, torch 2.14), with the layout-v2 prefill wrapper
(host-provided embeddings, last-position logits), the pipeline's `optimize_graphs.py` (RMSNorm →
SimplifiedLayerNormalization, encoder BiasGelu / SkipLayerNormalization) and `share_weights.py`,
onnxruntime's `MatMulNBitsQuantizer` (RTN, 4-bit, block 32, accuracy level 4) and float16
converter. Scripts: `benchmark/qwen3-asr-webgpu/export_v2/` (size-agnostic since 2026-09-03).
