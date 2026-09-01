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

# Qwen3-ASR-0.6B — ONNX for the browser (onnxruntime-web / WebGPU)

ONNX export of [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) (Apache-2.0)
packaged for in-browser inference with onnxruntime-web. Produced for the
[Sokuji](https://github.com/kizuna-ai-lab/sokuji) local-inference lane
(issue #465). Status: **evaluation artifacts from a feasibility spike (2026-09-02)** — the
layout duplicates the embedding table and is not the final packaging.

## Files

| File | Purpose | Notes |
|---|---|---|
| `encoder.onnx` | audio encoder, FP32 weights | input `mel` [1,128,T] fp32 → `audio_features` [1,A,1024] fp32 |
| `encoder.fp16.onnx` | audio encoder, FP16 weights, FP32 I/O | needs a WebGPU adapter with `shader-f16` |
| `decoder_init.int4.onnx` + `.data` | prefill: `input_ids`, `position_ids`, `audio_features`, `audio_offset` → `logits` (last position only), `present_keys`, `present_values` | MatMulNBits int4 RTN block 64, accuracy level 4, fp32 activations |
| `decoder_step.int4.onnx` + `.data` | one decode step: `input_embeds` [1,1,1024], `position_ids` [1,1], `past_keys`, `past_values` → `logits`, `present_*` | same quantization |
| `decoder_init.q4f16.onnx`, `decoder_step.q4f16.onnx` (+ `.data`) | same graphs with fp16 activations and fp16 I/O (RMSNorm / softmax / rotary kept in fp32) | needs `shader-f16`; same speed as int4 on the GPUs tested, ~290 MB smaller |
| `embed_tokens.fp16.bin` | token embedding table [151936, 1024], raw fp16, row-major | looked up on the JS side for each generated token |
| `mel_filters.json` | 128 × 201 Slaney mel filterbank (librosa `norm="slaney"`, fmin 0, fmax 8000) | so a browser front end does not need librosa |
| `tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `added_tokens.json`, `config.json` | tokenizer and architecture / mel / special-token config | |

KV cache layout: `[num_layers=28, batch=1, kv_heads=8, seq, head_dim=128]`, one stacked
tensor for keys and one for values. Keep them on the GPU between steps
(`preferredOutputLocation: 'gpu-buffer'` in onnxruntime-web).

## Front end and prompt

Log-mel is Whisper-compatible: 16 kHz, n_fft 400, hop 160 (torch.stft, periodic Hann,
center/reflect), power spectrum, 128 Slaney mel bins, `log10` with a 1e-10 floor, clamp to
`max - 8`, `(x + 4) / 4`, last frame dropped. Audio-token count for `T` mel frames:
`conv3(T % 100) + (T // 100) * 13` with `conv(t) = (t + 1) // 2` applied three times.

Prompt (token ids): `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|audio_start|>` +
`<|audio_pad|>` (151676) × A + `<|audio_end|><|im_end|>\n<|im_start|>assistant\n`; greedy decode
until `<|endoftext|>` (151643) or `<|im_end|>` (151645). The model prefixes its output with
`language <Name><asr_text>` (151704) — strip everything up to and including that token.

**Recommended: force the prefix when the language is known.** Appending the tokens of
`language Chinese` (or Japanese, English, …) plus `<asr_text>` to the prompt removes a
first-token knife edge where the quantized decoder occasionally skips the prefix and stops
early, and removes language-ID mistakes on short utterances.

## Measured (whole pipeline, warm, 8 clips zh/en/ja, RTF = processing time / audio time)

| device | variant | median RTF | ms / generated token |
|---|---|---|---|
| RTX 4070 SUPER, Chrome 152, WebGPU | int4 + fp16 encoder | 0.115 | 34 |
| Apple M4, Chrome 152, WebGPU | int4 + fp16 encoder | 0.116 | 19 |
| Apple M4, Chrome 152, WebGPU | q4f16 + fp16 encoder | 0.111 | 20 |
| NVIDIA GB10 (aarch64, Vulkan), WebGPU | int4 + fp32 encoder | 0.091 | 25 |
| any, wasm EP, 1 thread | int4 | 2.97 | 1040 |

FP32 export is token-for-token identical to the PyTorch model on English and Japanese test
clips. Without WebGPU the wasm execution provider is far too slow for live use.

## Provenance

Exported with [andrewleech/qwen3-asr-onnx](https://github.com/andrewleech/qwen3-asr-onnx)
(`qwen-asr` 0.0.6, transformers 4.57.6), with one local change (prefill emits last-position
logits only), then onnxruntime's `MatMulNBitsQuantizer` (RTN, 4-bit, block 64, accuracy
level 4); `q4f16` via onnxruntime's float16 converter with norm/softmax/rotary ops blocked
and duplicate Cast nodes removed; fp16 encoder via the pipeline's native-fp16 export. Scripts:
`benchmark/qwen3-asr-webgpu/` in the Sokuji repository.
