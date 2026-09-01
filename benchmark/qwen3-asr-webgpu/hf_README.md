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
(issue #465). Status: **evaluation artifacts from a feasibility spike** — layout and
quantization are not final.

## Files

| File | Purpose | Notes |
|---|---|---|
| `encoder.onnx` | audio encoder, FP32 weights | input `mel` [1,128,T] fp32 → `audio_features` [1,A,1024] |
| `encoder.fp16.onnx` | audio encoder, FP16 weights, FP32 I/O | half the size; same I/O |
| `decoder_init.int4.onnx` + `.data` | prefill: `input_ids`, `position_ids`, `audio_features`, `audio_offset` → `logits` (last position), `present_keys`, `present_values` | MatMulNBits int4 RTN block 64, fp32 activations |
| `decoder_step.int4.onnx` + `.data` | one decode step: `input_embeds`, `position_ids`, `past_keys`, `past_values` → `logits`, `present_*` | same quantization |
| `decoder_init.q4f16.onnx`, `decoder_step.q4f16.onnx` (+ `.data`) | same graphs with fp16 activations and fp16 I/O | for GPUs with `shader-f16` |
| `embed_tokens.fp16.bin` | token embedding table [151936, 1024] fp16 | looked up on the JS side for each generated token |
| `tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `added_tokens.json`, `config.json` | tokenizer and architecture/mel/special-token config | |

KV cache layout: `[num_layers=28, batch=1, kv_heads=8, seq, head_dim=128]`, stacked in one
tensor per keys/values.

## Front end and prompt

Log-mel is Whisper-compatible: 16 kHz, n_fft 400, hop 160, 128 Slaney mel bins, `log10`,
clamp to `max - 8`, `(x + 4) / 4`, last frame dropped. Audio tokens per utterance follow
Qwen3-ASR's 8× downsampling (`conv_chunksize` 100 mel frames → 13 tokens).

Prompt (token ids): `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|audio_start|>` +
`<|audio_pad|>` × A + `<|audio_end|><|im_end|>\n<|im_start|>assistant\n`; greedy decode until
`<|endoftext|>` (151643) or `<|im_end|>` (151645). The model prefixes its output with
`language <Name><asr_text>` — strip everything up to and including token 151704.

## Provenance

Exported with [andrewleech/qwen3-asr-onnx](https://github.com/andrewleech/qwen3-asr-onnx)
(FP32 export validated token-for-token against PyTorch on English and Japanese clips), with one
local change (prefill emits last-position logits only), then `MatMulNBitsQuantizer` (RTN, 4-bit,
block 64, accuracy level 4); `q4f16` via onnxruntime's float16 converter; fp16 encoder via the
pipeline's native-fp16 export.
