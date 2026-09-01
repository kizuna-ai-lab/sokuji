# Qwen3-ASR-0.6B in the browser lane — feasibility spike

**Date**: 2026-09-02
**Tracking**: #465 (re-asks #148)
**Status**: spike complete — **GO**, plan at the end
**Artifacts**: `benchmark/qwen3-asr-webgpu/` (page, runners, export/quantize scripts, raw
results and `results/summary.txt`)

## Question

Can Qwen3-ASR-0.6B run in `LOCAL_INFERENCE` (the shipped browser WebGPU/WASM lane, Electron
renderer and extension alike) fast enough for live translation, without waiting for
transformers.js — which as of 4.2.0 has no Qwen3-ASR class and no onnx-community export?

## Answer

Yes, on WebGPU. With an int4 decoder the whole pipeline runs at **RTF 0.09–0.14 on an
RTX 4070 SUPER, an Apple M4 and the GB10's own GPU** (warm), transcripts identical to the
Python reference, Chinese/English/Japanese all correct on the test set except the model's own
0.6B-class errors. Without WebGPU (wasm EP) it is RTF 3.0 single-threaded and 0.64 with 8
threads: not usable, so the model stays `requiredDevice: 'webgpu'` like Granite/Voxtral.

## Approach

Own ONNX export + a raw onnxruntime-web page. Nothing from transformers.js at runtime: the
page computes Whisper-style log-mel itself, builds the fixed prompt from token ids, runs three
ORT sessions (encoder, prefill, step) and decodes tokens with a 40-line byte-level BPE decoder
read from `tokenizer.json`.

- Export: [andrewleech/qwen3-asr-onnx](https://github.com/andrewleech/qwen3-asr-onnx)
  (`qwen-asr` 0.0.6 / transformers 4.57.6 / torch 2.14 CPU), one local patch so the prefill
  graph emits last-position logits only (`qwen3-asr-onnx-last-token-logits.patch`; upstream's
  full-sequence logits would be a ~120 MB GPU→CPU readback per utterance).
- Quantization: `MatMulNBitsQuantizer` RTN 4-bit, block 64, accuracy level 4 → `int4` (fp32
  activations). `q4f16` = onnxruntime's float16 converter on top of the int4 graphs with
  RMSNorm/softmax/rotary ops kept in fp32 (`to_q4f16_ort.py`) plus a pass that drops the
  duplicate Cast nodes the converter emits (`dedupe_values.py`). Encoder: FP32 export and the
  pipeline's native-fp16 export (fp32 I/O).
- KV cache stays on the GPU: `preferredOutputLocation: 'gpu-buffer'` for
  `present_keys/values`, fed straight back as `past_*`, old buffers disposed each step.
- Harness: headless Chrome driven over CDP (`run_page.mjs` / `run_page.py`), models served
  from the GB10 box over LAN. WebGPU needs a secure context, so the LAN origin is passed with
  `--unsafely-treat-insecure-origin-as-secure`.

## Correctness

- FP32 ONNX vs PyTorch (`validate.py`): encoder max abs diff 1.6e-6; decode **30/30 tokens
  identical** on `jfk.wav` (en) and `ja-fleurs1828.wav` (ja).
- JS log-mel vs the Python reference: same frame count, max abs diff 1.8e-5. JS tokenizer
  decode equals `transformers` decode on zh/ja/en/emoji samples.
- Browser transcripts equal the Python int4 transcripts string for string.
- Clips: `jfk.wav` (en, 11 s), 4 Japanese Common Voice sentences (5–10 s), 4 Japanese and
  4 Chinese FLEURS sentences (8–15 s), all with reference text. "CER" is a rough character
  error rate after stripping spaces/punctuation; the references use Arabic digits where the
  model writes numerals as words, so a few CERs overstate the error (`zh-fleurs1883`:
  "15米 / 2011年" vs "十五米 / 二零一一年").

## Speed

RTF = (mel + encoder + prefill + decode) / audio seconds, warm runs. The first utterance of a
session pays shader compilation (RTF 0.2–0.3 once). Load times include the LAN download and
are not representative. `ms/token` is the median per-step decode time.

### WebGPU, Windows 11, RTX 4070 SUPER, Chrome 152 headless

| variant | clips | median RTF | max RTF | ms/token | encoder ms (10 s clip) | prefill ms | mean CER |
|---|---|---|---|---|---|---|---|
| int4 + fp32 encoder | 8 | 0.139 | 0.211 | 38 | 31–50 | 28–78 | 0.045 |
| int4 + fp16 encoder | 3 | 0.115 | 0.116 | 34 | 35–38 | 44–62 | 0.015 |
| q4f16 + fp16 encoder | 4 | 0.133 | 0.145 | 40 | 28–80 | 52–80 | 0.032 |

### WebGPU, Mac mini M4, macOS 26.6, Chrome 152 headless

| variant | clips | median RTF | max RTF | ms/token | encoder ms (10 s clip) | prefill ms | mean CER |
|---|---|---|---|---|---|---|---|
| int4 + fp32 encoder | 8 | 0.127 | 0.164 | 20 | 84–160 | 285–696 | 0.045 |
| int4 + fp16 encoder | 3 | 0.116 | 0.117 | 19 | 89–128 | 489–515 | 0.015 |
| q4f16 + fp16 encoder | 3 | 0.111 | 0.112 | 20 | 90–92 | 455–495 | 0.015 |

Reading: on the M4 the fp16 encoder halves encoder time; fp16 decoder activations change
nothing on either GPU (q4f16 is within noise of int4 on the M4 and the 4070), so q4f16's
value is the ~290 MB smaller download, not speed. The Mac's prefill (0.45–0.7 s for 120–220 tokens) is the slowest stage and is
where a follow-up would look (the fp32 embedding gather and the un-fused RMSNorm are the
suspects). On the 4070 the step loop is dispatch-bound at 34–38 ms/token — a 0.6B q4 step
is a few ms of compute — so the win there is fewer, fused kernels, not a faster GPU.

### CPU reference, GB10 (Grace, aarch64), onnxruntime 1.29 Python, 8 threads

| variant | median RTF | max RTF | mean CER (13 clips) | note |
|---|---|---|---|---|
| FP32 | 0.169 | 0.266 | 0.095 | |
| int4 block 64 | 0.074 | 0.096 | 0.157 | `zh-fleurs1883` collapses to "Current." (see Quality) |
| int4 block 32 | 0.082 (5 clips) | — | — | `zh-fleurs1883` correct; +70 MB |
| int8 block 64 | 0.077 (5 clips) | — | — | `zh-fleurs1883` still collapses |
| int4 + fp16 encoder | 0.075 | — | — | fp16 encoder is not faster on CPU (Cast overhead), as upstream documents |

### wasm EP in the browser (the no-WebGPU / extension-CPU case), GB10 Chromium, int4

| threads | median RTF | ms/token | verdict |
|---|---|---|---|
| 1 (no COOP/COEP — what the extension has today) | 2.97 | 1040 | unusable |
| 8 (COOP/COEP served) | 0.64 | 232 | not live-capable; ~9× slower than native ORT CPU on the same box |

### WebGPU, GB10 (Grace + Blackwell GB10, aarch64 Linux, NVIDIA 580 Vulkan), old headless shell 151

| variant | clips | median RTF | max RTF | ms/token | encoder ms (10 s clip) | prefill ms | mean CER |
|---|---|---|---|---|---|---|---|
| int4 + fp32 encoder | 8 | 0.091 | 0.149 | 25 | 30–40 | 42–81 | 0.062 |
| int4 + fp16 encoder, q4f16 | — | refused: adapter has no `shader-f16` ("Program Transpose requires f16") | | | | | |

`chrome --headless=new` never holds a WebGPU adapter on this box (GPU process dies with
`CreateCommandBuffer kTransientFailure` under every Vulkan flag set tried); the old
`chromium_headless_shell` binary does, with `--use-vulkan=native --disable-vulkan-surface`.
Two things this box adds: an NVIDIA/Vulkan adapter can lack `shader-f16`, so the fp16
artifacts must be gated on the feature, not the vendor; and the same int4 graph picks a
different token on one Japanese clip than the 4070/M4 did (fp32 accumulation differs per
backend), so per-device transcripts can differ at knife edges even without quantization
changes.

## Sizes (bytes on disk, MiB)

| file | size |
|---|---|
| `encoder.onnx` (fp32) | 717 |
| `encoder.fp16.onnx` | 359 |
| `decoder_init.int4.onnx.data` | 834 (int4 layers + the **fp32** embedding gather table, ~590 of it) |
| `decoder_step.int4.onnx.data` | 325 (int4 layers + int4 lm_head) |
| `decoder_init.q4f16.onnx.data` | 524 |
| `decoder_step.q4f16.onnx.data` | 307 |
| `embed_tokens.fp16.bin` | 297 |
| tokenizer + config | 14 |

The spike layout is wasteful: the embedding table exists three times (inside `decoder_init`,
inside `decoder_step` as lm_head, and as `embed_tokens.fp16.bin`). A production export with
one shared weights file and one fp16/int8 embedding lands at roughly **0.9–1.0 GB** for the
fp16-encoder + q4f16 package, versus 1.49 GB for the Granite Speech 4.1 2B q4f16 already in
this lane.

## Quality notes

- 0.6B is strong on Chinese and English; Japanese is usable but makes kana/kanji and
  proper-noun errors on the harder FLEURS sentences (CER 0.17–0.27 on two clips, 0.00–0.07 on
  the rest). This matches the model card (1.7B is the CJK quality tier).
- **The one hard failure is a first-token knife edge, not a precision floor.** On
  `zh-fleurs1883` the quantized decoder sometimes skips its own `language <X><asr_text>`
  prefix and emits "Current." + EOS: int4/b64 fails (CPU and WebGPU alike), int4/b32 passes,
  int8/b64 fails, FP32 passes. **Teacher-forcing the prefix fixes every variant**: appending
  the tokens of `language Chinese` + `<asr_text>` to the prompt yields the correct transcript
  with int4 and int8 (`results/cpu-int4-forcezh.json`, `cpu-int8-forcezh.json`), and the same
  for Japanese. Sokuji always knows the source language, so the worker should force the prefix
  whenever a source language is selected and fall back to auto only for "auto". This also
  removes the language-ID mistakes a 0.6B model would otherwise make on short utterances.
- Language ID (when not forced) was right on every clip and can be shown in the UI for free.

## Go / no-go

**Go.** All four risk items from the research note came out on the right side: the export
runs on ORT-web's WebGPU EP on both GPU families we can test, the JS front end matches the
Python one numerically, speed has 7–9× headroom over real time, and the one quality defect
has a cheap product-side fix. CPU-only users get nothing from this model in the browser lane;
that was expected and does not change with any quantization.

## Productization plan

1. **Export layout** (Python, 1–2 days): one shared external-data file (`share_weights.py`
   pattern), embedding stored once (fp16 or int8) and used for both the prefill gather and the
   step lookup, prefix-forcing prompt support, `q4f16` (block 32) for `shader-f16` devices with
   `q4` fallback, fp16 encoder; fuse RMSNorm (`optimize_graphs.py`) before quantizing and
   re-measure the Mac prefill; re-run the token-exact validation and the 13-clip CER sweep per
   variant. The spike artifacts are on the Hub at
   [`jiangzhuo9357/Qwen3-ASR-0.6B-ONNX`](https://huggingface.co/jiangzhuo9357/Qwen3-ASR-0.6B-ONNX)
   (uploaded private on 2026-09-02 with `upload_hf.py`; the `kizuna-ai-lab` org does not
   exist on the Hub, jiangzhuo chose the personal namespace); the production layout replaces
   it in the same repo.
2. **Worker** (`src/lib/local-inference/workers/qwen3-asr-webgpu.worker.ts`, 2–3 days): clone
   the Granite worker's VAD + message plumbing; replace `generate()` with the prefill/step loop
   from `www/main.js`; mel from `mel.js` (a radix FFT instead of the 400-point DFT if the
   100–250 ms/utterance matters) or transformers.js `WhisperFeatureExtractor` with
   `feature_size: 128` once proven identical; tokenizer via `AutoTokenizer` (already in the
   shared transformers chunk) or the 40-line decoder; strip / force the `<asr_text>` prefix.
3. **Manifest + types + engine** (1 day): `modelManifest.ts` row (`requiredDevice: 'webgpu'`,
   `q4f16` **and the fp16 encoder** together under `requiredFeatures: ['shader-f16']` — the
   GB10's NVIDIA/Vulkan adapter has no `shader-f16` and ORT-web refuses fp16 graphs there —
   with `q4` + fp32 encoder as the fallback, 16 languages, `hfModelId`),
   `asrWorkerType` union, `AsrEngine.ts` dispatch, `harness-consolidation.test.ts`, locales,
   `consoleLedger` rows if the worker logs.
4. **Validation on the fleet** (1 day): the same 13 clips through the real worker on the
   RTX 4070 and the M4, plus a 60-second continuous clip for VAD segmentation; check memory
   stays flat across 50 utterances (KV buffers disposed); a cold-start budget for the first
   utterance (shader compile ≈ 1–2 s).
5. Optional later: 1.7B variant (~1.8 GB, needs ≥4 GB VRAM); an upstream
   `Qwen3ASRForConditionalGeneration` PR to transformers.js modelled on `voxtral` — an outward
   act, needs separate approval.

## How to reproduce

See `benchmark/qwen3-asr-webgpu/README.md`.
