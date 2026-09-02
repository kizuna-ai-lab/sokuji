---
license: apache-2.0
base_model: Qwen/Qwen3-ASR-0.6B
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

# Qwen3-ASR-0.6B — ONNX for the browser (onnxruntime-web / WebGPU), layout v2

ONNX export of [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) (Apache-2.0)
packaged for in-browser inference with onnxruntime-web, built for the
[Sokuji](https://github.com/kizuna-ai-lab/sokuji) local-inference lane (issues #465, #148).
Layout v2 (2026-09-02): no embedding table inside any graph, one shared weights file per
precision, int8 embedding table, and a `prompt_config.json` that carries every constant a
client needs. Tooling and measurements: `benchmark/qwen3-asr-webgpu/` in the Sokuji repo.

## Pick a variant

| variant | files | needs | download |
|---|---|---|---|
| `q4` | `encoder.onnx` (fp32, fused) + `decoder_init.int4.onnx` + `decoder_step.int4.onnx` + `decoder_weights.int4.data` | WebGPU | ≈ 1.1 GB + shared files |
| `q4f16` | `encoder.fp16.onnx` + `decoder_init.q4f16.onnx` + `decoder_step.q4f16.onnx` + `decoder_weights.q4f16.data` | WebGPU with `shader-f16` | ≈ 0.7 GB + shared files |

Shared by both: `embed_tokens.int8.bin` (155.6 MB) + `embed_scales.f32.bin` (0.6 MB),
`prompt_config.json`, `mel_filters.json`, `tokenizer.json`, `tokenizer_config.json`,
`vocab.json`, `added_tokens.json`, `config.json`. `prompt_config.json` → `variants` lists the
same file roles machine-readably. Decoders are MatMulNBits int4, RTN, block 32, accuracy
level 4; `q4f16` additionally runs activations and I/O in fp16 with RMSNorm / softmax / rotary
kept in fp32. Without WebGPU the wasm execution provider is ~30× too slow for live use.

## Graph contracts

- `encoder.*`: `mel` [1, 128, T] fp32 → `audio_features` [1, A, 1024] fp32 (fp32 I/O for both encoders).
- `decoder_init.*`: `input_embeds` [1, S, 1024], `position_ids` [1, S] int64 → `logits` [1, 1, 151936] (last position only), `present_keys` / `present_values` [28, 1, 8, S, 128].
- `decoder_step.*`: `input_embeds` [1, 1, 1024], `position_ids` [1, 1], `past_keys`, `past_values` → `logits` [1, 1, 151936], `present_*` [28, 1, 8, S+1, 128].
- `q4f16` graphs use fp16 for every float tensor above; `q4` uses fp32. Both decoders of a variant reference the same `decoder_weights.*.data`; hand onnxruntime-web the buffer once (`externalData: [{ path, data }]`) for each session.
- Keep the KV cache on the GPU between steps (`preferredOutputLocation: { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' }`) and dispose the superseded tensors.

## Building the prompt (see `prompt_config.json`)

1. Log-mel, Whisper-compatible: 16 kHz, n_fft 400, hop 160 (periodic Hann, centred, reflect
   padding), power spectrum, the 128-bin Slaney filterbank in `mel_filters.json`, `log10` with a
   1e-10 floor, clamp to `max − 8`, `(x + 4) / 4`, last frame dropped.
2. Audio tokens for `T` mel frames: `A = conv(conv(conv(T mod 100))) + 13 · floor(T / 100)` with
   `conv(t) = floor((t + 1) / 2)`.
3. Prompt ids: `prompt.prefix_ids` + `A × prompt.audio_pad_id` + `prompt.suffix_ids`, i.e.
   `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|audio_start|>` … `<|audio_end|><|im_end|>\n<|im_start|>assistant\n`.
4. Embeddings: row `id` of the int8 table times `embed_scales[id]` → fp32 (or fp16 for `q4f16`);
   overwrite the `A` rows at the pad positions with the encoder output. That tensor is
   `input_embeds` for `decoder_init`.
5. Greedy decode with `decoder_step` (each new token's embedding row from the same table)
   until `<|endoftext|>` (151643) or `<|im_end|>` (151645); `max_new_tokens` 256.
6. Output begins with `language <Name><asr_text>`; drop everything up to and including
   `asr_text_id` (151704). **Recommended:** when the language is known, append
   `language_prefix_ids[<iso>]` (the ids of `language <Name>` + `<asr_text>`) to the prompt.
   This removes a first-token knife edge where the quantized decoder occasionally skipped
   the prefix and stopped early, and removes language-ID mistakes on short utterances.

## Validation

- v2 FP32 graphs are token-for-token identical to the v1 export on English, Japanese and
  Chinese test clips (encoder fusion changes the encoder output by ≤ 6.5e-6).
- int8 embedding rows leave the FP32 decoders token-identical on the same clips.
- int4 block 32 / q4f16: Japanese and Chinese clips identical to FP32, English differs by one
  punctuation token; the `zh` clip that collapsed under block 64 transcribes correctly.
- CPU sweep (13 clips, onnxruntime 1.29): median RTF 0.071 at 8 threads, no collapses.

## Measured in the browser (whole pipeline, warm, 8 clips zh/en/ja)

| device | variant | median RTF | ms / generated token | prefill (10–15 s clip) |
|---|---|---|---|---|
| RTX 4070 SUPER, Windows 11, Chrome 152, WebGPU | q4 | 0.095 | 24.1 | 25–71 ms |
| RTX 4070 SUPER, Windows 11, Chrome 152, WebGPU | q4f16 | 0.087 | 21.4 | 25–73 ms |
| Apple M4, Chrome 152, WebGPU | q4 | 0.091 | 18.6 | 88–201 ms |
| Apple M4, Chrome 152, WebGPU | q4f16 | 0.076 | 16.6 | 59–135 ms |
| NVIDIA GB10 (aarch64, Vulkan, no shader-f16), WebGPU | q4 | 0.081 | 20.8 | 37–64 ms |
| GB10 CPU, onnxruntime 1.29 (Python), 8 threads | int4 | 0.071 | — | — |

More (spike layout, RTX 4070 SUPER, wasm EP): `benchmark/qwen3-asr-webgpu/results/` in the Sokuji repo.

## Provenance

Exported with [andrewleech/qwen3-asr-onnx](https://github.com/andrewleech/qwen3-asr-onnx)
(`qwen-asr` 0.0.6, transformers 4.57.6, torch 2.14), with a new prefill wrapper (host-provided
embeddings, last-position logits), the pipeline's `optimize_graphs.py` (RMSNorm → SimplifiedLayerNormalization,
encoder BiasGelu / SkipLayerNormalization) and `share_weights.py`, onnxruntime's `MatMulNBitsQuantizer`
(RTN, 4-bit, block 32, accuracy level 4) and float16 converter. Scripts: `benchmark/qwen3-asr-webgpu/export_v2/`.
