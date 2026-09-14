# ASR punctuation restoration: benchmark in the renderer

Date: 2026-09-14. Follows the survey in `2026-09-14-asr-punctuation-restoration-survey.md`.
Harness: `benchmark/punctuation-restoration/` (README-level detail in each `models/<id>.md`).

## Why

Streaming ASR from online providers and local models often arrives with no sentence punctuation.
The app then cannot decide **where a subtitle line ends** or **when a sentence is complete enough to
hand to the translator** — not only translation quality suffers. Survey conclusion "no model" was
rejected; this note measures whether a small model running in the renderer can supply the missing
boundaries, for both online-provider text and local-model text.

## Setup

**Corpus** (`corpus/*.gold.json`, 101 passages):
- `synthetic.gold.json` — 82 hand-written spoken-style passages, ~20 per language (ja, zh, en, ko):
  meetings, streams, lectures, support calls, numbers/dates/decimals, abbreviations (`Dr.`, `p.m.`,
  `U.S.`), fillers, code-switching, one-sentence turns, and long single sentences that must not be
  split.
- `gpt-live.gold.json` — 19 passages from the GPT-Live integration session (PR #552), built by
  `tools/build-gpt-live-gold.mjs` from `gpt-live-log-extract.json`:
  - 11 spike WebSocket sessions (en/ja/zh) with the **real delta sequence**, used for streaming replay.
  - 8 passages from GUI conversation exports of real Chinese videos: the fast narrator (no punctuation
    at all, cut every 12 s mid-word) and the slow speaker (commas only).
  - `raw` is what Live transcribed, ASR errors included; `ref` is the same characters with reference
    punctuation added by hand, so skeletons align exactly (the builder fails otherwise).
  - The L2815 export was left out (crude content); L3008 duplicates the L3383 video.

**Inputs** derived per passage: `stripped` (every mark removed), `lower` (English, also lowercased),
`commas` (terminators removed, commas kept), `raw` (the provider's own transcript).

**Metrics** (`lib/text.mjs`): text is reduced to a letter/digit skeleton so marks can be compared by
position.
- Sentence-boundary P/R/F1 counts `。 . ？ ? ！ !` and excludes the end of the utterance, which the VAD
  gives for free. Decimal and abbreviation dots are not boundaries.
- Mark F1 per class (comma `，、,`, period, question, exclamation); final-terminator rate; English
  uppercase F1 on the `lower` input.
- Streaming (`eval-quality.mjs`): the utterance grows chunk by chunk (real deltas where recorded, else
  3 CJK characters / 2 words), the model re-runs on every prefix, and a predicted boundary is committed
  once R skeleton characters of right context have arrived (R = 0/4/8/16). Committed boundaries are
  never revised; commit P/R and the mean lag are reported.

**Runtimes**:
- Quality: Node 22 with onnxruntime-web `1.26.0-dev.20260416-b7804b056c` (the build the app ships),
  WASM EP, 1 thread — same kernels as the renderer.
- Cost: `tools/electron-bench.cjs` loads `www/bench.mjs` in a hidden window of the app's Electron
  (40.8.5, Chromium 144) with the app's Linux GPU switches (`enable-unsafe-webgpu`,
  `Vulkan,SharedArrayBuffer`), cross-origin isolated. Memory is working set from
  `app.getAppMetrics()` (Electron rejects `measureUserAgentSpecificMemory`).
- Hardware: DGX Spark GB10 (aarch64, 20 cores, Vulkan GPU). Absolute latency will differ on x64
  laptops; ratios between models should carry over.

**Port fidelity**: every model was ported to JS pre/post-processing against the injected
onnxruntime-web and `@huggingface/tokenizers`, then compared with its official Python pipeline over
the corpus inputs plus long multi-window rows (`parity/`, `results/parity-*`).

## Intl.Segmenter

`segmenter.mjs`, Node (ICU 78.2) and Electron 40.8.5 (ICU 77.1) give identical numbers:

| input | ja F1 | zh F1 | en F1 | ko F1 |
|---|---|---|---|---|
| reference punctuation | 100.0 | 100.0 | 98.6 (splits after `Dr.`) | 100.0 |
| stripped / lower / commas only | 0.0 | 0.0 | 0.0 | 0.0 |
| GPT-Live raw transcript | 100.0 (spike ja was punctuated) | 37.9 (P 100 / R 23.4) | 73.7 (P 100 / R 58.3) | – |

UAX #29 never breaks without a terminator, so `Intl.Segmenter` only works *after* something has put
the marks in; on Live's Chinese it finds only the boundaries Live already marked.

## Models and port findings

| id | model | langs | license | artifact used | parity vs official |
|---|---|---|---|---|---|
| `pcs47` | 1-800-BAD-CODE xlm-roberta punct+truecase+SBD | ja zh en ko (+43) | Apache-2.0 | own int8 (MatMul+Gather, per-channel) 279,327,734 B | fp32 port 248/248 exact vs `punctuators`; int8 diverges from fp32 on ~40% of rows (see below) |
| `fireredpunc-q8w` | FireRedTeam FireRedPunc (BERT, LERT) | zh en | Apache-2.0 | own 8-bit weight-only (MatMulNBits) export | 153/153 exact vs upstream PyTorch |
| `ct-transformer` | FunASR CT-Transformer via sherpa-onnx int8 | zh en | FunASR model license (see survey) | 79.7 MB (`model.int8.onnx` + `tokens.json`) | 311/317 exact vs sherpa-onnx 1.13.8; diffs are near-tie logits |
| `edge-punct-en` | Edge-Punct-Casing CNN-BiLSTM via sherpa-onnx | en | Apache-2.0 | 7.6 MB | 96/97 exact vs sherpa-onnx |
| `mojicast` | Mojicast (bobfromjapan char BERT) int8 | ja | Apache-2.0 | 109,150,947 B | fp32 51/51 exact vs Mojicast's own `punct.py`; int8 49/51 |
| `koen-punct` | whooray/koen_punctuation (mGTE base) | ko en | Apache-2.0 (card) | own int8 311,003,266 B | fp32 exact on every token vs PyTorch; int8 moves 5/876 ko marks |
| `sat-3l-sm` | segment-any-text SaT (boundaries only) | ja zh en ko (+81) | MIT | published fp16 427,756,189 B | 265/270 identical splits vs wtpsplit; diffs within 0.006 of threshold |

Findings that change what "the model" means in practice:
- **Dynamic int8 is not free for BERT-style punctuators.**
  - FireRedPunc: 42ailab's published int8 ONNX (and every dynamic int8 recipe tried) turns about
    half the sentence ends into commas — zh boundary recall 1.4% vs 39% for the faithful build. Its
    "character-identical" claim is false; use weight-only 8-bit.
  - PCS-47: int8 changes ~40% of output rows vs fp32, but boundary F1 stays within a few points. The
    rounding in each DynamicQuantizeLinear amplifies 1e-6 float differences between runtimes, so int8
    parity across native/WASM is unattainable by construction.
- **WebGPU does not help the dynamic-int8 models.** ORT's WebGPU EP has no kernels for MatMulInteger /
  DynamicQuantizeLinear / DynamicQuantizeLSTM, so compute falls back to CPU with transfer overhead.
  In the renderer: PCS-47 int8 zh 480 chars 1,326 ms on WebGPU vs 248 ms on 4-thread WASM;
  CT-Transformer zh 480 chars 2,237 ms vs 92 ms.
- **Weight-only 8-bit (MatMulNBits, fp32 activations) is the WebGPU format.** `fireredpunc-q8w` runs
  zh 480 chars in 27 ms and en 960 chars in 19 ms on WebGPU (394 / 246 ms on 4-thread WASM), and
  its WebGPU outputs are identical to WASM on all 57 corpus inputs (`tools/ep-parity.mjs`).
- **fp16 needs `shader-f16`, which this adapter lacks.** SaT's fp16 graph fails on WebGPU with
  "Program Gather requires f16 but the device does not support it" — the same failure class the
  app's `shaderF16Gate` exists for (#504, #513). An fp16 punctuator would need an fp32/q8w fallback
  on such devices anyway, so q8w is the one build to ship.
- **Resident memory is far above file size.** onnxruntime-web itself adds ~250 MB to the renderer
  (7.5 MB model: 104 → 355 MB). On top of that, weights are unpacked at load: `fireredpunc-q8w`
  ~750 MB, PCS-47 int8 ~1.34 GB, `koen-punct` int8 ~1.47 GB, SaT fp16 ~1.9 GB on WASM (upcast).
- **SaT's fp16 file is fp32 on WASM**: ORT upcasts at load, ~2.4 GB resident for a 428 MB file; its
  English split quality depends on casing (F1 98.6 cased vs 64.6 lowercased); inputs over 510 subwords
  fall off a cliff (511 → 984 ms, 1,020 → 4.5 s).
- **End-of-input bias** (Mojicast's author documents it; our streaming numbers show it for every
  model): a model sees the end of a prefix as a sentence end. 「ここでちょっと」 scores 0.971 for `。`
  at the end and 0.000 once text follows. A line-final mark on a partial is not evidence of a
  boundary; only marks with right context are.
- **Mojicast in production** punctuates finals only (VAD 300 ms silence, 12 s force-flush), threshold
  0.1, non-overlapping 256-char chunks, with a digit+counter fix and a self-test that falls back to fp32
  because int8 marked every character on non-VNNI CPUs.

<!-- QUALITY_TABLES -->

<!-- COST_TABLE -->

<!-- RECOMMENDATION -->

## Caveats

- The corpus is small: 24–71 internal boundaries per language. Differences under ~5 F1 points are
  noise. Comma F1 depends on my comma style and is the least reliable column.
- Gold punctuation for the GPT-Live passages was added by me over ASR text that contains errors.
- Korean has no real-provider passages; its numbers are synthetic only.
- One machine (aarch64); WASM SIMD speed on x64 differs.

## Reproduce

```
cd benchmark/punctuation-restoration
node tools/build-gpt-live-gold.mjs
node segmenter.mjs --json results/segmenter-node.json
node eval-quality.mjs --models <id> --out results/quality-final-<id>.json   # per model
node tools/serve.mjs --port 8787 &
node tools/run-resource.mjs --models <ids> --eps wasm,webgpu --threads 1,4 --reps 10
node tools/summarize.mjs
```
Model files live under `~/.cache/sokuji-punct-bench/` and the HF cache; each `models/<id>.md` has the
download/export steps.
