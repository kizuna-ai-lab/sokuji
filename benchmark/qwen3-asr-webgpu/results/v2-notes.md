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

## Task 3 / 4 — decoders

- int4 RTN block 32, accuracy level 4, shared file: `decoder_weights.int4.data` 365 MiB,
  graphs ~1 MiB each (v1: 834 + 340 MiB). `onnx.checker` rejects SimplifiedLayerNormalization
  (contrib op, expected); ORT loads both sessions.
- q4f16 on top (norm/softmax/rotary fp32, duplicate Casts removed, shared file):
  `decoder_weights.q4f16.data` 329 MiB.
- Transcripts vs v1 FP32 on the three check clips (int4 and q4f16 alike): ja and zh
  token-identical, en differs by one punctuation token (`;` → `,` at token 19); `zh-fleurs1883`
  no longer collapses. Forced `zh` prefix → correct transcript.

## Task 7 — CPU sweep (GB10, ORT 1.29, 8 threads, 13 clips)

int4 v2: median RTF 0.071 (v1 int4/b64: 0.074), mean CER 0.125 (v1: 0.157 with the
collapse). Forced-from-manifest: identical texts, mean CER 0.125, no collapses. One hard
Japanese clip (`ja-fleurs1813`) is worse with block 32 (CER 0.338 vs 0.169), two others
are better; the block-64 collapse on `zh-fleurs1883` is gone.

## Task 8 — browser, v2 vs spike (acceptance: within 15 %; result: faster everywhere)

| device | variant | spike median RTF / ms·token | v2 median RTF / ms·token | prefill (10–15 s) spike → v2 |
|---|---|---|---|---|
| Mac mini M4, Chrome 152 | q4 (int4 + fp32 enc) | 0.127 / 20.1 | **0.091 / 18.6** | 285–696 → 88–201 ms |
| Mac mini M4, Chrome 152 | q4f16 (fp16 enc) | 0.111 / 19.8 | **0.076 / 16.6** | 455–495 → 59–135 ms |
| GB10 (NVIDIA Vulkan, headless shell) | q4 (int4 + fp32 enc) | 0.091 / 25.3 | **0.081 / 20.8** | 39–81 → 37–64 ms |
| Windows RTX 4070 SUPER, Chrome 152 | q4 (int4 + fp32 enc) | 0.139 / 38.3 | **0.095 / 24.1** | 28–78 → 25–71 ms |
| Windows RTX 4070 SUPER, Chrome 152 | q4f16 (fp16 enc) | 0.133 / 40.5 | **0.087 / 21.4** | 52–80 → 25–73 ms |

(The Windows box had to be re-keyed first: its sshd host key changed when jiangzhuo repaired
it; `ssh-keygen -R 192.168.1.13` + `ssh-keyscan` fixed the client side.) The 4070 gains the
most per token (−37 % / −47 %): its step loop was the most dispatch-bound of the three GPUs.
One more knife-edge: `ja-cv2` transcribes differently on the 4070 with q4 (CER 0.105) than on
the M4 / GB10 / the 4070 q4f16 (all 0.000).

Forced prefix in the browser (Mac, q4f16, `&force=ja`, 4 Japanese clips): all four ran the
forced path, transcripts identical to the unforced run, 3 fewer generated tokens each
(`page-mac-v2-q4f16-forced-ja.log`).

Why faster: 30 % fewer decoder nodes (RMSNorm fused) in a dispatch-bound loop, and the
prefill no longer runs a 622 MB fp32 gather on the GPU — the prompt embedding is built on
the host from the int8 table (`promptBuildMs` 2–6 ms).

## Task 9 — Hub

`jiangzhuo9357/Qwen3-ASR-0.6B-ONNX` @ 46094255: 17 v2 files + README (2.02 GB), v1 files
deleted; exact sizes in `v2-hub-files.json`. Browser run on the Mac with
`base=https://huggingface.co/jiangzhuo9357/Qwen3-ASR-0.6B-ONNX/resolve/main/` (q4f16, three
clips): CORS and `resolve/main` paths work, transcripts and speed identical to the LAN run
(median RTF 0.072, 16.5 ms/token). The Hub download itself took ~18 min from the Mac
(≈0.7 MB/s from this location) — irrelevant to inference, but the product's download UI
must show progress for ~0.9–1.3 GB.

## Task 6 — prompt_config.json

prefix `[151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669]`, suffix
`[151670, 151645, 198, 151644, 77091, 198]`, 16 language prefixes of the form
`[11528, <name-token>, 151704]` (e.g. zh `[11528, 8453, 151704]`, ja `[11528, 10769, 151704]`).
