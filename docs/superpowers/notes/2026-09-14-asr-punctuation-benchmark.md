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

## Results

Every model, input variant, right-context R and renderer cell is in
`benchmark/punctuation-restoration/results/summary.md`; the numbers below are a selection.
- **breakpoint**: a comma or sentence end at the reference position — where a subtitle line may be cut.
- **sentence end**: `。 . ？ ? ！ !` only — when a sentence is complete enough for the translator.
- **streaming**: the model re-runs on every chunk; a position is committed after 8 characters of right context.

### Quality by language (stripped input unless noted)

| lang | model | breakpoint F1 (offline) | sentence-end F1 (offline) | streaming breakpoints P/R | streaming sentence ends P/R | notes |
|---|---|---|---|---|---|---|
| zh | **FireRedPunc** | **91.5** (GPT-Live raw 90.8) | 55.4 (P 93 / R 39) | **93.0 / 90.2** | 84.4 / 53.5 | prefers `，` to `。`; lowercases English |
| zh | PCS-47 | 83.9 | 55.0 | 65.2 / 95.3 | 38.7 / 57.7 | extra commas, false `。` inside clauses |
| zh | CT-Transformer | 81.3 | 57.6 | 85.5 / 82.4 | 71.7 / 53.5 | |
| zh | SaT | 37.0 | 56.2 (raw 69.0) | 86.7 / 26.9 | 71.7 / 60.6 | boundaries only |
| en | **Edge-Punct-en** | **92.3** | 84.5 | **90.8 / 94.5** | 76.2 / 88.9 | casing F1 84.0 |
| en | FireRedPunc | 85.0 | 85.7 | 94.8 / 75.3 | 86.1 / 86.1 | output lowercased |
| en | PCS-47 | 84.3 | 78.9 | 85.5 / 89.0 | 75.6 / 86.1 | casing F1 88.6 |
| en | SaT | 67.3 | 98.6 cased, 64.6 lowercased | – | 79.4 / 75.0 (lowercased) | relies on capitals |
| ja | **SaT** | 72.9 | **94.1** | 100 / 57.3 | **93.0 / 95.2** | boundaries only |
| ja | PCS-47 | 85.1 | 90.2 | 69.8 / 98.7 | 88.6 / 92.9 | about twice the reference `、` |
| ja | Mojicast | 72.3 | 87.8 | 93.9 / 61.3 | 84.1 / 88.1 | almost no `、`, never `？` |
| ko | **SaT** | 74.1 | **90.9** | 100 / 61.8 | **100 / 87.5** | boundaries only |
| ko | PCS-47 | **88.9** | 73.7 | 93.3 / 82.4 | 100 / 66.7 | |
| ko | koen-punct | 64.0 | 76.9 | 100 / 55.9 | 100 / 75.0 | no commas at all |

The WebGPU-friendly builds score within noise of the builds above (`pcs47-q8w-gather` boundary F1
en 81.7 / ja 87.5 / zh 55.0 / ko 73.7; `sat-3l-sm-q8w-gather` and `mojicast-q8w-nonan` unchanged);
their streaming runs were not repeated.

### Renderer cost

Electron 40.8.5 renderer on the GB10, median ms per call, 4-thread WASM or WebGPU. Renderer working
set is 104 MB before loading and the GPU process 182 MB.

| model (build) | files | backend | renderer after load | GPU process peak | 120 CJK / 240 en chars | 480 CJK / 960 en chars |
|---|---|---|---|---|---|---|
| Edge-Punct-en (int8) | 7.6 MB | WASM | 353 MB | – | en 15 ms | en 39 ms |
| CT-Transformer (int8) | 80 MB | WASM | 666 MB | – | zh 24 / en 8 ms | zh 92 / en 27 ms |
| FireRedPunc (q8w) | 163 MB | **WebGPU** | 1,102 MB | 409 MB | zh 13 / en 13 ms | zh 27 / en 19 ms |
| FireRedPunc (q8w) | 163 MB | WASM | 856 MB | – | zh 115 / en 81 ms | zh 394 / en 246 ms |
| Mojicast (q8w, no IsNaN) | 119 MB | **WebGPU** | 840 MB | 334 MB | ja 14 ms | ja 33 ms |
| Mojicast (int8) | 109 MB | WASM | 760 MB | – | ja 101 ms | ja 411 ms |
| SaT (q8w + 8-bit embedding) | 251 MB | **WebGPU** | 1,582 MB | 514 MB | ja 16 / zh 11 / en 14 / ko 12 ms | ja 15 / zh 13 / en 13 / ko 16 ms |
| SaT (q8w + 8-bit embedding) | 251 MB | WASM (`ort.wasm` bundle) | 1,251 MB | – | ja 19 / zh 20 / en 19 / ko 28 ms | ja 54 / zh 62 / en 50 / ko 95 ms |
| SaT (published fp16) | 437 MB | WASM | 2,046 MB | – | zh 17 / en 16 ms | zh 63 / en 48 ms |
| PCS-47 (q8w + 8-bit embedding) | 325 MB | **WebGPU** | 1,915 MB | 716 MB | ja 35 / zh 25 / en 25 / ko 37 ms | ja 30 / zh 74 / en 25 / ko 68 ms |
| PCS-47 (q8w + 8-bit embedding) | 325 MB | WASM (`ort.wasm` bundle) | 1,443 MB | – | ja 75 / zh 79 / en 74 / ko 111 ms | ja 206 / zh 279 / en 193 / ko 394 ms |
| PCS-47 (int8) | 288 MB | WASM | 1,444 MB | – | ja 52 / zh 57 / en 54 ms | ja 196 / zh 248 / en 181 / ko 374 ms |
| koen-punct (int8) | 328 MB | WASM | 1,571 MB | – | ko 65 ms | ko 490 ms |

What the cost runs established:
- **q8w builds are backend-portable.** WebGPU output equals WASM output on every corpus input:
  `fireredpunc-q8w` 57/57 (both in the renderer), `mojicast-q8w-nonan` 24/24,
  `pcs47-q8w-gather` 101/101 and `sat-3l-sm-q8w-gather` 101/101 (WebGPU renderer vs Node WASM).
  Against their fp32 originals on WASM: FireRedPunc and Mojicast 100%, PCS-47 96.4% of rows,
  SaT 96.7% of splits (near-threshold flips; no 8-bit recipe reaches 100%).
- **The WebGPU bundle cannot be the CPU fallback for the gather builds.** Under
  `onnxruntime-web/webgpu` the WASM EP has no `GatherBlockQuantized` kernel ("Could not find an
  implementation"); the plain `onnxruntime-web/wasm` bundle loads the same file.
- **SaT's memory problem goes away** with the q8w + 8-bit-embedding build: 1,251 MB on WASM vs
  2,046 MB for the published fp16, and it runs on WebGPU where fp16 cannot.
- **WebGPU sessions still hold 1.1–1.9 GB in the renderer**, beyond the GPU process growth. Not
  investigated (model bytes kept alive, WASM heap copy, arena).
- The SaT fp16 cells ran while seven single-threaded quality jobs were also running; the q8w cells
  overlapped a short Node run. Absolute ms there may be a little high.

## Recommendation

1. **Add a punctuation stage in the renderer, chosen by source language**, between ASR text
   (provider deltas or local ASR partials) and the display / translation hand-off. `Intl.Segmenter`
   stays, after it. Load one model at a time: each costs 0.35–1.9 GB resident.
2. **Model per language:**
   - **zh → FireRedPunc q8w.** Best breakpoints by far, and just as good streamed. The English
     casing the upstream rule-fix lowercases must be restored from the input. Its sentence ends are
     conservative (recall 39%), so "send to the translator" should key on committed breakpoints plus
     a length/time rule, not on `。` alone.
   - **en → Edge-Punct-en.** 7.6 MB and under 40 ms on WASM with no GPU; breakpoints 92, casing 84.
     It never forces a final mark; the VAD end supplies it.
   - **ja → SaT** for sentence ends (94 offline, 93 / 95 streamed), inserting `。` at its cuts.
     None of the Japanese candidates places `、` well: PCS-47 doubles them, Mojicast omits them.
   - **ko → SaT** for sentence ends (91; 100 / 87.5 streamed); PCS-47 if commas are wanted
     (breakpoints 89).
   - **Other languages → SaT** (85 languages, boundaries) or PCS-47 (47 languages, marks and casing).
   - **Not recommended:**
     - CT-Transformer: weaker, and under the FunASR model license.
     - koen-punct.
     - 42ailab's FireRedPunc int8: broken.
     - Any dynamic-int8 build on WebGPU.
     - fp16 builds: they need `shader-f16`.
3. **Ship q8w builds** (MatMulNBits 8-bit, fp32 activations, 8-bit `GatherBlockQuantized`
   embedding where the table is large).
   - One file serves WebGPU and WASM, but the CPU fallback must load the `onnxruntime-web/wasm`
     bundle.
   - These are our own conversions, so they need hosting with the upstream licenses carried over
     (FireRedPunc, PCS-47 and Edge-Punct-Casing Apache-2.0; SaT MIT).
4. **Streaming policy:**
   - Run on the uncommitted tail since the last committed breakpoint, not the whole utterance. That
     keeps calls in the 120-character column above: about 15 ms on WebGPU, at most about 120 ms on
     WASM.
   - Commit a position only after ≥ 8 characters of right context. Every model marks the end of a
     prefix as a sentence end (end-of-input bias), and R = 8 is where precision stops improving.
     Lag is 9–14 characters.
   - Commit everything at the VAD end or a provider final.
   - Skip the model when the provider's text already carries punctuation. GPT-Live's Japanese was
     fully punctuated; its Chinese was not.
5. **Integration points to design against:**
   - `StreamingTextAccumulator` (`streaming-generation.ts:237`, regex on terminal marks).
   - `splitSentences` (`Intl.Segmenter`).
   - The GPT-Live client's timing-based cut rules (#552).

   The stage would give all three committed breakpoints instead. The design is a separate spec.

## French, German, Spanish, Portuguese

Added after the main run: `corpus/european.gold.json`, 10 hand-written passages per language in the
same categories (14 internal sentence ends and ~25 breakpoints per language, so treat differences
under ~10 points as noise). None of the ported modules declares these languages. PCS-47 and SaT
cover them upstream (PCS-47 `config.yaml` lists de/es/fr/pt; SaT covers 85 languages), and
CT-Transformer does not. `eval-quality.mjs --langs fr,de,es,pt --as-lang en` feeds them through the
modules' language guard, which is the only use of the argument. Full tables:
`results/summary-european.md`.

| lang | model | breakpoint F1 (offline) | sentence-end F1: cased / lowercased input | streaming breakpoints P/R (R=8) | casing F1 |
|---|---|---|---|---|---|
| fr | **PCS-47** | **89.8** | 45.5 / 45.5 | **100 / 88.9** | 71.1 |
| fr | SaT | 68.3 | **100** / 58.3 | 91.7 / 40.7 | – |
| fr | CT-Transformer | 7.1 | 0 / 0 | 50.0 / 3.7 | – |
| de | **PCS-47** | **95.5** | 72.7 / 72.7 | **95.7 / 95.7** | 95.2 |
| de | SaT | 75.7 | **100** / 80.0 | 91.7 / 47.8 | – |
| de | CT-Transformer | 14.8 | 13.3 / 13.3 | 60.0 / 13.0 | – |
| es | **PCS-47** | **88.9** | 42.1 / 42.1 | **88.0 / 91.7** | 74.4 |
| es | SaT | 76.9 | **96.6** / 43.5 | 88.9 / 33.3 | – |
| es | CT-Transformer | 0.0 | 0 / 0 | 0 / 0 | – |
| pt | **PCS-47** | **80.0** | 57.1 / 57.1 | **77.8 / 87.5** | 76.0 |
| pt | SaT | 73.7 | **100** / 61.5 | 78.6 / 45.8 | – |
| pt | CT-Transformer | 19.4 | 12.5 / 12.5 | 36.4 / 16.7 | – |

PCS-47 lowercases its input, so its cased and lowercased columns are the same run.

- **CT-Transformer does not support these languages.**
  - **Upstream scope:** FunASR publishes only zh and zh-en CT checkpoints (survey §4.3).
  - **Vocabulary:** the sherpa build's 272,727-token vocabulary is 262,487 ASCII words (English
    corpus, including loanwords such as `le`, `der`, `que`, `obrigado`) and 8,362 CJK characters.
  - **Accented words never match:** its 1,791 accented entries are stored with uppercase accents
    (`acciÓn`), while lookup lowercases first, so `réunion`, `für`, `año`, `não` are `<unk>`.
  - **Unknown-token rate** on these passages: fr 22.5%, de 33.9%, es 28.9%, pt 42.3%, vs en 3.5%.
  - **Output:** no internal marks at all, only a final `。`. It also damages the text: spacing is
    rebuilt from tokens, so `en énergie Elle` → `enénergieElle`, and the decimal `4,2` → `4 2`.
- **PCS-47 is the usable model for these four.**
  - Breakpoints 80–96 offline and 78–100% precision streamed, with casing restored (de 95).
  - It prefers commas where the reference ends a sentence, so sentence-end recall is low (29–57%).
    The same trigger caveat as Chinese applies.
  - On the renderer it is the same PCS-47 build and cost as above.
- **SaT leans on capitals again.**
  - Sentence ends are near-perfect when the ASR keeps casing (Whisper-style and most providers).
  - Lowercased CTC-style text drops them to 44–80.
  - No commas.
- **Suggested routing:** PCS-47 for fr/de/es/pt marks and casing. SaT can add sentence ends when
  the input is cased.

## Production language mix and model selection

**Source.** PostHog (project `sokuji`), production only, 2026-06-01 → 2026-09-14.
- **Languages and channels:** from `translation_session_start`. `channels` was recorded from
  2026-05-23 and fills essentially every session from June on.
- **Minutes:** from `translation_session_end.duration`, joined on `session_id` and capped at 180
  min per session.
- **Legs:** the speaker leg recognises `source_language`; the participant leg recognises
  `target_language`.
- **Codes:** normalised to their base (`zh`, `cmn-CN`, `zh_CN` → zh; `en-US`, `en_US` → en;
  `ru-RU` → ru; …).
- **Totals:** 425,727 speaker minutes and 545,688 participant minutes.

| language | speaker share | participant share | combined share | model |
|---|---|---|---|---|
| en | 20.7% | 45.5% | **34.6%** | Edge-Punct-en |
| zh (+ zh+en 0.3%) | 36.3% | 16.7% | **25.3%** | FireRedPunc |
| ja | 7.6% | 21.3% | **15.3%** | SaT |
| ru | 10.8% | 3.1% | **6.5%** | SaT (sentence ends), PCS-47 (commas) |
| es | 7.6% | 5.4% | **6.4%** | PCS-47 (marks + casing), SaT (sentence ends) |
| pt | 2.0% | 2.0% | 2.0% | PCS-47 / SaT |
| ko | 1.9% | 1.7% | 1.8% | SaT |
| de | 2.3% | 1.2% | 1.6% | PCS-47 / SaT |
| vi | 2.4% | 0.5% | 1.3% | SaT (in its 85 languages; not in PCS-47's 47; not measured here) |
| fr | 1.6% | 0.3% | 0.9% | PCS-47 / SaT |
| tr, id, it, uk, ar, fa, hi, pl, … | ≈ 3% | ≈ 1% | ≈ 2% | SaT (sentence ends); PCS-47 covers most of them too |

Russian was measured after this breakdown (`corpus/russian.gold.json`, 10 passages;
`results/summary-russian.md`):
- **SaT:** sentence-end F1 96.6 on cased input, 64.0 lowercased; streaming 71.4 / 71.4.
- **PCS-47:** breakpoint F1 88.0 (streaming 85.7 / 96.0) but sentence-end F1 only 31.6.

**What recognises the speech.** `local_inference` carries ≈ 68% of speaker minutes and ≈ 72% of
participant minutes. Most of it runs on ASR that already emits punctuation:
- cohere-transcribe: 102k speaker / 133k participant minutes;
- whisper-large-v3-turbo: 47k / 91k;
- voxtral-mini-4b: 62k / 87k;
- parakeet-tdt, qwen3-asr, sensevoice.

The sherpa streaming families carry about 6% of speaker minutes and 3% of participant minutes:
stream-zh-2025, stream-multi-8lang, *-kroko, zipformer-ru/vi, vosk-ru, nemo-ctc-80ms. Their
punctuation was not verified in the survey; these families are normally trained on unpunctuated
text. Online providers carry the rest: Gemini, Volcengine AST 2.0, Soniox, OpenAI Realtime /
Translate. How reliably each punctuates is not in the telemetry; GPT-Live's Chinese was
unpunctuated or comma-only in its spike and GUI logs.

- **Telemetry cannot say where punctuation is actually missing.** PostHog holds no transcript
  text. A privacy-safe measure — sentence terminators per 100 characters of final transcript, by
  leg, provider, ASR model and language — would show where the punctuator must run and where it
  can stay idle.
- **HogQL trap found here:** `if(properties.x != '', …)` on a missing property returns NULL instead
  of taking the else branch. The first participant-leg query reported 348k minutes with no ASR
  model; `coalesce(nullIf(…))` recovered them.

**Selection.**
1. **Core, three models** (≈ 85% of minutes in languages with a measured model):
   - **FireRedPunc q8w** for zh: 25%, including zh+en code-switching.
   - **Edge-Punct-en** for en: 35%; 7.6 MB, WASM.
   - **SaT q8w-gather** for ja, ru, ko, vi and every other language's sentence ends: 85
     languages, one 251 MB model.
2. **Optional fourth: PCS-47 q8w-gather** for comma-level breakpoints and casing in
   es / pt / de / fr / ru (≈ 17% of minutes), where SaT gives only sentence ends and depends on
   the ASR keeping capitals.
   - Its sentence ends are weak (ru 31.6, es 42.1, fr 45.5).
   - It is the heaviest model in the renderer (1.4–1.9 GB).
   - Add it only if SaT-only lines prove too long, or for lowercased ASR.
3. **Not selected:** CT-Transformer (zh-en only, weaker), koen-punct, Mojicast (SaT is better for
   ja sentence ends and covers more languages).
4. **Per session, at most two models are loaded:** speaker source + participant target. The most
   common pairs — zh→en, en→ja, ja→en, zh→ja — cost FireRedPunc + Edge-Punct-en (≈ 1.4 GB
   renderer) or FireRedPunc/Edge + SaT (≈ 1.6–2.7 GB on WebGPU).

## Open questions

- **One machine only.** Needs the fleet:
  - an x64 laptop iGPU (Intel/AMD WebGPU);
  - Apple M-series (has `shader-f16`, so fp16 becomes an option);
  - a machine without WebGPU (WASM-only budget).
- **Renderer memory of WebGPU sessions (1.1–1.9 GB):** can it be released after upload?
- **Chinese translation trigger:** sentence-end recall is ≤ 60% for every model, so the trigger rule
  (breakpoints + length) needs its own test on real sessions.
- **Coverage gaps:**
  - Japanese comma placement is unsolved.
  - Korean has no real-provider text in the corpus.
  - Streaming was not re-run for the q8w builds.

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
