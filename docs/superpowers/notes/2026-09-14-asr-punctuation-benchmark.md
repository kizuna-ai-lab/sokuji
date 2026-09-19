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
- ~~**WebGPU sessions still hold 1.1–1.9 GB in the renderer**, beyond the GPU process growth. Not
  investigated (model bytes kept alive, WASM heap copy, arena).~~ Investigated in "Renderer memory
  of WebGPU sessions (task 12)" below: the "model bytes kept alive" hypothesis is disproved
  (dropping that reference measured no effect); the WASM-heap/arena half is the one the forced-GC
  diagnostic there supports.
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

**That claim was never measured, and it is wrong about the largest model.** See
"Live check in the app" at the end of this note: cohere-transcribe emits no
punctuation in either Chinese or English.

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
- ~~**Renderer memory of WebGPU sessions (1.1–1.9 GB):** can it be released after upload?~~
  Answered in "Renderer memory of WebGPU sessions (task 12)" below: no, not by either candidate
  fix — it is close to a permanent per-renderer floor.
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

## Renderer memory of WebGPU sessions (task 12)

Date: 2026-09-16. Answers the open question above: can the 1.1–1.9 GB a WebGPU session holds be
released? Same box as the rest of this note (DGX Spark GB10, aarch64, Vulkan) and the same
Electron build (40.8.5, Chrome 144.0.7559.236), so these numbers are directly comparable to the
"Renderer cost" table. `app.getGPUInfo('basic')` reported an active device with `vendorId 4318`
(NVIDIA) on every run, confirming WebGPU ran on the real GB10 GPU, not a software fallback.

**Inherits task 11.** Only `tools/electron-bench.cjs` + `www/bench.mjs` exist to drive this —
they load the benchmark ports (`models/fireredpunc-q8w.mjs`, `models/edge-punct-en.mjs`,
`models/sat-3l-sm-q8w-gather.mjs`), not the shipped TypeScript worker entries, which are not
loadable assets before a vite build and are wired to no session yet (slice 1). Task 11
(`benchmark/punctuation-restoration/app-parity.test.ts`) established that these same three ports
reproduce the shipped adapters' scored F1 figures within 0.0005, which is what licenses reading
this measurement as standing in for the shipped code.

**Method:** `node tools/serve.mjs --port 8787` in the background, then
`node_modules/electron/dist/electron --no-sandbox tools/electron-bench.cjs
'http://127.0.0.1:8787/?model=<id>&ep=<ep>&threads=1'` (`--no-sandbox` was required — the
downloaded Electron's `chrome-sandbox` helper isn't setuid-root in this checkout; the app's own
packaged builds don't need it). `bench.mjs` emits four `STATUS` marks used below: `ready` (ort +
tokenizer + model module imported, no session yet — **idle**), `loaded` (`InferenceSession.create`
resolved — **after load**), `ran` (the full latency loop across every language/length finished,
**before** `model.release()` — **after the call loop**), `done` (after `model.release()` has
already run — **after unload**). `sat-3l-sm-q8w-gather` needed `&bundle=ort.wasm.min.mjs` for the
WASM lane: the default WebGPU bundle's WASM EP has no `GatherBlockQuantized` kernel (same finding
as the main table). One run per cell (n=1); see "How noisy" below for the error bar this implies.
All cells here used `threads=1` (the brief's own example command), while the pre-existing
"Renderer cost" table above used 4-thread WASM/WebGPU — a variable this note previously left
unnamed. The "after load" figures still land within 5% of that table's across all five directly
comparable rows (FireRedPunc WASM 2.6%, FireRedPunc WebGPU 2.9%, Edge-Punct-en WASM 4.9% — the
largest gap, SaT WASM 0.9%, SaT WebGPU 0.8%), so thread count does not appear to move memory much,
but it is not the same setting.

### Baseline: idle / load / call loop / unload

Renderer and GPU-process working set (`app.getAppMetrics()`), MB (KB ÷ 1024):

| model | EP | idle | after load | after call loop | after unload | peak (200 ms sampler) |
|---|---|---|---|---|---|---|
| FireRedPunc q8w | WASM | 96.2 / — | 833.5 / 190.0 | 777.6 / 189.5 | 777.8 / 189.5 | 1,027.1 / 190.1 |
| FireRedPunc q8w | **WebGPU** | 96.3 / — | 1,070.6 / 360.3 | 766.7 / 366.4 | 767.1 / 366.5 | 1,095.3 / 366.2 |
| Edge-Punct-en | WASM | 96.1 / — | 370.4 / 190.0 | 284.1 / 190.0 | 283.2 / 190.0 | 377.0 / 190.0 |
| Edge-Punct-en | **WebGPU** | 96.2 / — | 334.2 / 214.3 | 234.9 / 241.0 | 235.2 / 241.1 | 401.3 / 241.8 |
| SaT q8w-gather | WASM (`ort.wasm` bundle) | 97.3 / — | 1,240.4 / 190.0 | 1,225.2 / 190.1 | 1,226.1 / 190.1 | 1,293.2 / 190.1 |
| SaT q8w-gather | **WebGPU** | 97.6 / — | 1,569.4 / 250.4 | 1,521.1 / 499.3 | 1,521.2 / 499.5 | 1,617.8 / 499.4 |

(cell format: renderer MB / GPU-process MB. The GPU process sits at its ~190 MB pre-session
baseline in every row at the idle mark, since no session — WASM or WebGPU — has been created yet;
"—" in the idle column just avoids repeating that same number six times. WASM rows never diverge
from it, which is why their later columns still read ~190.) These "after load" figures land
within about 3% of the main table's (1,102 / 1,582 MB for FireRedPunc/SaT WebGPU there), so the
two harnesses agree.

**The first, unexpected finding: most of the "after load" growth already drains away once the
model actually runs, with no code change.** FireRedPunc WebGPU drops 1,070.6 → 766.7 MB (-28%,
-304 MB) between "after load" and "after the call loop"; SaT WASM barely moves (-1.2%); the drop
happens on WASM too (FireRedPunc WASM -6.9%, Edge-Punct WASM -23%), so it isn't WebGPU-specific.
This is ordinary V8 GC catching up with an already-unreferenced model byte buffer, not anything
`model.release()` did — release() runs later, only between "after the call loop" and "after
unload" in this table.

### Candidate fix 1: drop the reference to the model `Uint8Array` right after `InferenceSession.create` resolves

In all three modules, the local variable holding the model bytes (`modelBytes` in
`fireredpunc.mjs`'s `createFireRedPunc` and in `edge-punct-en.mjs`'s `create`; the temporary in
`sat-3l-sm.mjs`'s `create`, which already has no named binding) is never referenced by any closure
the module returns, so it is already dead code after the `InferenceSession.create` line — with or
without an explicit `= null`. Patched all three (temporarily, not committed — reverted before this
commit) to null it explicitly right after the session resolves, and re-ran all six baseline cells:

| model | EP | after load Δ | after unload Δ |
|---|---|---|---|
| FireRedPunc q8w | WASM | +4.9% (874.6 vs 833.5) | -0.1% (776.7 vs 777.8) |
| FireRedPunc q8w | WebGPU | -0.6% (1,064.2 vs 1,070.6) | -0.9% (759.8 vs 767.1) |
| Edge-Punct-en | WASM | -17.3% (306.1 vs 370.4) | -0.1% (283.1 vs 283.2) |
| Edge-Punct-en | WebGPU | -5.4% (316.3 vs 334.2) | +0.1% (235.5 vs 235.2) |
| SaT q8w-gather | WASM | -0.6% (1,233.4 vs 1,240.4) | +0.1% (1,227.1 vs 1,226.1) |
| SaT q8w-gather | WebGPU | -0.2% (1,566.1 vs 1,569.4) | -0.02% (1,520.9 vs 1,521.2) |

**No effect at "after unload"** — every delta there is under 1%, and the signs are inconsistent
(sometimes higher, sometimes lower than baseline), which is what run-to-run GC-timing noise looks
like, not a real change. The one double-digit swing (Edge-Punct-en WASM "after load" -17.3%) is at
the mark where GC hasn't caught up yet in either version — see "how noisy" below — and washes out
by "after unload" like everything else. Explicitly dropping the reference does not make the model
bytes any more collectible than they already were; the object was already unreachable, not merely
unreferenced-but-reachable.

### Candidate fix 2: call the session's release path on unload

`bench.mjs` already calls `await model.release?.()` before the `done` mark — this candidate was
already exercised in every baseline row above. Its effect is exactly the "after call loop" →
"after unload" column:

| model | EP | Δ from release() |
|---|---|---|
| FireRedPunc q8w | WASM | +0.2 MB |
| FireRedPunc q8w | WebGPU | +0.4 MB |
| Edge-Punct-en | WASM | -0.9 MB |
| Edge-Punct-en | WebGPU | +0.3 MB |
| SaT q8w-gather | WASM | +0.9 MB |
| SaT q8w-gather | WebGPU | +0.1 MB |

**`session.release()` recovers approximately 0 MB in every case**, WASM or WebGPU. It tears down
the ORT session object enough that a new session can be created, but it does not shrink the
process's resident working set.

### An additional check, not a candidate: forced GC (diagnostic only — not shippable)

Neither candidate touches memory, which raises the question of whether the leftover is simply
uncollected garbage (a GC-timing artifact, like the "after load → after call loop" drop above) or
genuinely retained (WASM linear memory / GPU buffers a GC pass cannot shrink). Chromium doesn't
expose `--js-flags=--expose-gc` in a packaged app, so this only works as a diagnostic, not a fix —
but it's diagnostic of exactly which one we're looking at. Patched `electron-bench.cjs` to add
`--js-flags=--expose-gc` and `bench.mjs` to call `globalThis.gc()` three times (200 ms apart) after
`release()` (temporarily, not committed — reverted before this commit), WebGPU only:

| model | released → after 3× forced GC (renderer) | GPU process |
|---|---|---|
| FireRedPunc q8w | 783.9 → 772.1 MB (-1.5%) | 382.3 → 354.3 MB (-7.3%) |
| SaT q8w-gather | 1,519.9 → 1,223.6 MB (**-19.5%**) | 499.1 → 464.0 MB (-7.0%) |

Forced GC recovers a little for FireRedPunc (a genuinely small, mostly-committed float32/int8
graph) and a lot more for SaT (-296 MB, one-fifth of its footprint) — so part of what looked
"stuck" was in fact ordinary uncollected garbage that a GC pass this renderer never happened to run
before the page closed. But even after three forced GC passes, **FireRedPunc is still 676 MB above
idle and SaT is still 1,126 MB above idle** — the majority in both cases is not GC-collectible at
all. That remainder is consistent with WASM linear memory (`memory.grow()` is monotonic — the
browser does not shrink it back once grown) and/or pooled WebGPU buffers ORT does not eagerly
destroy.

### Sequential-load check: does a released session's memory become available to the next one?

The three-model core selection means a renderer can load more than one of these models over its
life (a session with FireRedPunc for zh switches to SaT if the source language changes to ja).
Built a throwaway two-model driver (`www/bench-seq.mjs` + `www/index-seq.html`, not committed —
deleted after this run) that loads FireRedPunc q8w on WebGPU, runs it through **the same full
latency loop `bench.mjs` runs for one model** (every language, every length, `reps=15` — copied
verbatim, not a lighter stand-in), releases it, *then* does the same for SaT q8w-gather on WebGPU.

*(An earlier version of this check used a 5-call warm-up instead of the full loop. FireRedPunc's
own numbers inside that script came out ~300 MB higher than its single-model baseline — a
methodology artifact, not a real effect — which made the "tax" figure computed from it
unreliable. Fixed by matching the workload exactly; see below for why the artifact happened.)*

Three repeated runs (renderer MB):

| mark | run 1 | run 2 | run 3 | baseline (single model) |
|---|---|---|---|---|
| idle | 96.2 | 96.0 | 96.0 | 96.3 |
| loaded FireRedPunc | 1,063.0 | 1,053.4 | 1,039.4 | 1,070.6 |
| ran FireRedPunc | 770.6 | 772.4 | 769.4 | 766.7 |
| released FireRedPunc | 770.9 | 772.7 | 769.4 | 767.1 |
| loaded SaT (on top of released FireRedPunc) | 1,965.6 | 1,960.9 | 1,959.0 | 1,569.4 |
| ran SaT | 1,989.6 | 1,761.3 | 1,993.2 | 1,521.1 |
| done | 1,989.8 | 1,761.3 | 1,993.2 | 1,521.2 |

**FireRedPunc's own numbers inside this script now reproduce its single-model baseline within
1%** (released: 770.9 / 772.7 / 769.4 MB here vs. 767.1 MB baseline) — the fix above worked, so the
gap between this run's final `done` and SaT's own single-model baseline (1,521.2 MB) can be
attributed to loading history rather than to script overhead:

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| tax (`done` − SaT-alone `done`) | 468.6 MB | 240.1 MB | 472.0 MB |
| as % of FireRedPunc's own extra-over-idle (≈675 MB) | 69.5% | 35.5% | 70.1% |

**Direction is robust across all three runs — releasing FireRedPunc before loading SaT still
leaves the renderer several hundred MB heavier than loading SaT alone — but the exact size is not
a fixed number: it ranged 240–472 MB (35–70% of FireRedPunc's own footprint) over three otherwise
identical runs.** The spread traces to whether a GC pass fires during SaT's *own* call loop: run 2
shows the same kind of large mid-loop drop (loaded 1,960.9 → ran 1,761.3 MB) the single-model
baseline also sometimes shows on its own (loaded → ran, main baseline table above); runs 1 and 3
show little to no such drop. This is the same GC-timing variance discussed under "How noisy" —
just landing on the more consequential side of it here. **Treat "several hundred MB, roughly a
third to two-thirds of a released model's own footprint" as the finding, not any single number in
the table above; a specific figure such as "432 MB" is not defensible from n=3 this noisy, and a
further projection to all three shipped models loaded in one renderer was not measured at all and
should not be quoted as if it were.**

### How noisy

n=1 per cell; no repeated-run standard deviation was collected (time budget). The candidate-fix
tables above double as an informal repeat measurement, though, since fix 1 makes no code-observable
change at the marks that matter: comparing baseline vs. fix-1 for the *same* model/EP/mark, at
"after unload" every delta is under 1.5% (max magnitude 6.9 MB), and at "after load" the spread is
wider (up to 17% for Edge-Punct-en WASM, the smallest model, where GC-timing variance is a larger
fraction of a smaller number). Treat single-digit percent differences anywhere in these tables as
noise; the ≥19% GC recovery for SaT is well outside that band. The sequential-load tax (240–472 MB,
i.e. 16–31% of SaT's own single-model `done`) is less clear-cut at its low end: run 2's 240 MB
(16%) sits close to the ~17% ceiling this same paragraph documents for Edge-Punct-en WASM above,
so treat that run as the weakest evidence of the three; runs 1 and 3 (~31%, ~470 MB each) are
comfortably outside it.

### Verdict

**The memory is not recoverable within the renderer's lifetime, by either candidate fix.** Dropping
the model `Uint8Array` reference changes nothing because it was already unreferenced. Calling
`session.release()` — which the harness already does on every run — recovers ~0 MB. Forced GC (not
available in a packaged app) recovers a real but partial amount for one model (SaT, -19.5%) and
almost nothing for another (FireRedPunc, -1.5%); the majority survives even that. And a model that
has been loaded and released once still taxes a renderer that later loads a *different* model, by
several hundred MB. The 1.1–1.9 GB figure isn't a transient spike this app can wait out or nudge
with a release call — it's close to a permanent floor for any renderer that has ever created a
WebGPU (or, per the WASM columns above, even a WASM) punctuation session, and that floor is
per-distinct-model-ever-loaded, not per-currently-loaded-model.

**Consequences for slice 2, stated explicitly:**

1. **Idle unload has to be more aggressive than the current 2-minute constant, but it will not by
   itself fix this.** A shorter timeout calls `release()` sooner, which is still worth doing (it
   stops the session from being usable/holding whatever *does* get GC'd hostage a little longer,
   and the "after load → after call loop" drop shows GC does eventually reclaim something on its
   own schedule) — but `release()` itself, measured above, recovers ~0 MB immediately. Shortening
   the timeout narrows the window during which an idle model's cost is paid; it does not lower the
   cost.
2. **The `deviceMemory ≤ 4 GB` guard may need to rise, and needs to change what it's guarding
   against.** It was presumably sized against "one model's peak footprint" (up to ~1.6 GB for SaT
   WebGPU here). The sequential-load result shows the real risk is cumulative, not just peak: a
   session that switches source or target language mid-call and therefore loads a second distinct
   model still pays several hundred MB (measured range 240–472 MB across three runs, not a single
   fixed number — see above) on top of that second model's own footprint, even though the first
   model was already released. **A specific total for two- or three-model sequences was not
   reliably measured and should not be sized against** — the range above is wide enough that
   picking one endpoint to plan a guard around would be as unfounded as the single figure this
   revision removed. What is measured is the direction: the guard should be evaluated against
   "every distinct model this renderer has ever loaded," not "the model currently active," or
   slice 2/3 should cap how many distinct punctuation models a single renderer lifetime may load
   before requiring a
   window/renderer restart to reclaim the floor.
3. **This is now answered, not open:** "Renderer memory of WebGPU sessions (1.1–1.9 GB): can it be
   released after upload?" → No — not via dropping the byte-array reference, not via
   `session.release()`, and only partially (0–20%, model-dependent) via a forced GC pass that a
   packaged Electron app cannot even invoke on demand.


---

## Live check in the app (2026-09-19) — slice 3, English source

The manual step the segmentation slices exist for. Local Inference provider,
source English, target Chinese, `sentencesPerChunk = 3`, one Fox News broadcast
throughout so every transcript below compares directly. Four runs: voxtral
before the fix, Qwen3-ASR, voxtral after the fix, and voxtral again with
`minSilenceDuration` at 350 ms.

### The stage works

Qwen3-ASR, N = 3, bubbles as designed:

> And ten thousand pages of writings, police say they have identified fifty
> eight people… / One of the videos, Fox twenty nine reports, appears to show…
> / And metadata reportedly shows some of the photos were taken back nearly ten
> years ago in twenty seventeen.

Three sentences, one bubble, repeatedly. Four times two bubbles shared a
timestamp: three of those are a full chunk plus the utterance remainder that
`end()` flushed behind it, and at 03:29:01 both bubbles hold three sentences —
the shape the `for (;;)` loop in `SentenceStream.evaluate()` produces from a
single six-sentence final. That loop's comment names qwen3-asr as its motivating
case; this is the first sighting of it on real audio.

The stage sealed mid-utterance many times across that run and **not one bubble
opened mid-word**. That is direct evidence for the cursor arithmetic of rule 4
(advance by raw consumed), the part no unit test could exercise on a real model.

### voxtral ignored N, and the cause was below us

voxtral-mini-4b produced one sentence per bubble at N = 3. N could not matter,
because the stage was never handed more than one sentence to count:
`voxtral-webgpu.worker.ts` finalizes the moment its decoded text ends with
`. 。 ! ? ！ ？` (`SENTENCE_END_PATTERN`, enabled unconditionally). That is a
hard-coded one-sentence segmenter one layer below the stage.

It has no right-context guard either, so any period the decoder emits — inside
"Mr.", inside "3.5" — ends the result on the spot, where this stage would wait
for `RIGHT_CONTEXT_CHARS` of following text.

> **Retraction.** This section first blamed that same endpoint for the `ished` /
> `ous` / `bese` fragments, reading `…all these.` / `ous cases…` as "various"
> split at a hallucinated period. **That was wrong** — see "The tail-pad
> hallucination" below, where a later run identifies them as something else
> entirely. The claim that risk 3 in the task-4 handover (a bubble opening
> mid-word from the client's cursor) is not what was seen here still holds; the
> reason is different.

Fixed in `037d4842`: the client turns the worker endpoint off while the stage is
sealing, and leaves it exactly as it was when the stage is off (the default).

### Offline ASR does not deliver the latency goal

Qwen3-ASR bubbles arrived at 03:28:21, 03:28:41, 03:29:01 — **twenty seconds
apart**. That is `maxSpeechDuration`, which `LocalInferenceClient` never sets,
so 20 s is always the effective value. A news anchor never pauses the 1.4 s
`minSilenceDuration` wants, so every utterance runs to the wall, and an offline
ASR emits nothing until it does.

So the stage gave good bubble structure and no latency benefit: three-sentence
chunks, all landing at once, twenty seconds late. The handover's bar — "watch
the translation land while you are still talking" — is reachable only on a
streaming ASR, whose partials the stage can seal mid-utterance.

| | bubble structure | when the translation starts |
|---|---|---|
| offline ASR (qwen3-asr) + stage | three sentences | after the utterance ends — up to 20 s |
| voxtral before `037d4842` | one sentence, words cut | immediately |
| voxtral after `037d4842` | three sentences | mid-utterance — see below |

### After the fix: the slice does what it was built for

voxtral re-run on the same broadcast, N = 3. The event order inside the first
utterance is the proof, and it needs no timestamps:

```
partial            "… 10,000 pages of writings. Police say"
translation.start  sourceText = three complete sentences     <- the seal
partial            "… identified 58 people in the photos and videos"
translation.end    "这是我们目前所知道的情况。调查人员从一处住宅…"   <- Chinese on screen
partial            "… including at least four,"
asr.end            durationMs: 20815                          <- utterance ends here
```

**The translation was on screen while the speaker was still talking.** That is
the handover's bar, and an offline ASR cannot reach it by construction.

Five utterances, each sealing one exactly-three-sentence chunk plus an `end()`
remainder — eleven chunks in all, **every seal landing on a sentence terminal
and not one opening mid-word**.

### What the fix did not touch: the 20 s wall

All the remaining damage is at utterance boundaries, where the audio is cut
mid-word and the decoder guesses at the fragment:

| spoken | transcribed | lost |
|---|---|---|
| …who, quote, **appear** lifeless | `You're lifeless.` | appear → You're |
| …sparked back **in June** | split across two utterances | — |
| a former **NYPD**, Intel… | `Intel and counterterrorism…` | NYPD |
| **Going** through all that metadata | `went through all that metadata` | Going → went |

`Going` was lost in the pre-fix run too, as `through all that metadata`. What
took it there is **not established** — the punctuation endpoint only flushes
text, it never touches the audio feed, so it cannot by itself delete a spoken
word. Most likely an utterance boundary fell in the same place. Recorded as
unexplained rather than pinned on the endpoint.

`maxSpeechDuration` is **never set anywhere in `src/`** — eight workers read
`vadConfig?.maxSpeechDuration ?? 20` and the only other mention is the type
field at `types.ts:28`. Twenty seconds is an unfilled wire field's default, not
a decision. A continuous speaker is therefore always cut at 20 s, mid-word.

One hook already exists for the text half of this: `confirmedBoundary()`
(`SentenceStream.ts:126`) returns the latest counted sentence end and its
comment says "a later slice uses it to land a hard span cap on a real boundary
instead of mid-word". It has test callers only. It does not solve the audio
cut, which is where the words are actually lost.

The trailing `but nowished` in this run is not a cut at all — the partials go
`"…but now"` → `"…but nowished"` in one step, so the decoder emitted it. The
next section says where it comes from.

### The tail-pad hallucination

A third run, with `minSilenceDuration` lowered to 350 ms, produced eight of
these in about three and a half minutes — `ished` six times, `ous` twice — plus
two spurious extra periods. Every one of them is **the last token before
`asr.end`**, and three of them land after a finished sentence:

```
" less"  ->  " less important"  ->  " less importantished"      -> asr.end
" …that the prosecution holds."  ->  " …holds.ished"            -> asr.end
" …of this magnitude."           ->  " …magnitude.ous"          -> asr.end
" go about determining whether something is staged or real."
                                 ->  " …or real.."              -> asr.end
```

`holds.ished` and `magnitude.ous` settle it: the sentence is complete, the
period is there, and the fragment follows it. **No word is being truncated.**

The source is the worker's own tail padding. `finishGenerate()` appends
`utterancePadSamples()` — `TAIL_PAD_TOKENS = 7`, about 560 ms of silence — so
the model can decode the words it is still lagging behind on. It decodes the
silence too, and emits one hallucinated token from it. For voxtral that token
is `ished`, `ous`, or an extra `.`.

This is worker behaviour on `main`, independent of this stage, and it predates
it: the standalone `ished` bubbles in the first run are the same artifact, made
to look like separate utterances by the punctuation endpoint clearing
`pendingText` just before the pad was decoded.

**Lowering `minSilenceDuration` makes it worse**, because the rate is per
utterance: more endpoints, more pads, more hallucinations.

One lead for a fix, not yet pursued: every real word in these partials arrives
with a leading space, and every artifact arrives without one.

### What the VAD should be doing now

The 350 ms run also shows the cost of cutting at breath pauses:

```
utterance: "…how does that kind of impact the investigation? I have to imagine it's not"
utterance: "less importantished"
```

"I have to imagine it's not less important" became two bubbles and two
translations. Eight three-sentence seals still landed in that run, and the 20 s
wall was still hit five times.

**The VAD's job changed when this stage shipped.** It no longer has to define
the translation unit — the stage delivers translations continuously inside an
utterance — so its only remaining job is to *not cut a sentence in half*. That
argues for raising both `minSilenceDuration` and `maxSpeechDuration`, not
lowering either. Trading longer utterances for earlier translations is the
trade this stage already makes; making it twice costs sentence integrity and
buys nothing.

### Chinese: the model path, and why it sealed nothing (2026-09-19)

Two live sessions on sherpa `stream-zh-2025-int8`, source Chinese, N = 3. Both
produced **zero seals** — one translation per utterance, every bubble an
`end()` flush. The model was not the problem: Settings read **Active**
mid-session, so FireRedPunc had downloaded, loaded and reached `ready`, and
`punctuate()` had been called (nothing else can trigger a load).

**Measured Chinese rate, five utterances across the two runs:**

| utterance | seconds | characters |
|---|---|---|
| run 1 #1 | 18.5 | 81 |
| run 1 #2 | 20.3 | **126** |
| run 1 #3 | 19.1 | 98 |
| run 2 #1 | 20.3 | 99 |
| run 2 #2 | 15.0 | 61 |

**5.0 characters per second. A 20 s utterance yields about 100 characters, and
`zhFallbackChars(3)` is exactly 100.** The VAD cap and the fallback threshold
land on the same number.

Three separate things follow.

**1. The length fallback was wired to the wrong string** (fixed in `3fd5b382`).
Run 1 #2 is the proof: at 126 characters it cleared the 100-character guard and
still sealed nothing, because `tryLengthFallback` searched the raw tail for
commas and an unpunctuated ASR has none. `PunctuationResult.breakpoints` —
"sentence ends plus commas", produced by all three adapters — had no consumer
anywhere in `src/`.

**2. At N = 3 both gates are calibrated beyond what a 20 s utterance can
produce.** The sentences path needs 3 sentence ends each carrying
`RIGHT_CONTEXT_CHARS` of following text; the expectation in 100 characters is
**1.8** (4.5 real sentences at the 22-character average, times FireRedPunc's
62% recall, minus the last one for want of right context). The fallback needs
≥ 100 characters and gets ~100 — four of the five utterances lost that coin
flip. `zhFallbackChars` is derived as "the length by which N *detected*
sentences should have appeared", so it is deliberately set at the point the
sentences path should already have fired; that leaves it no headroom at all
when the utterance ends at exactly that length. **This is the 20 s wall again**
— on English it garbles words, on Chinese it puts both segmentation gates out
of reach.

**3. `end()` seals the raw tail, never a punctuated one.**

```ts
if (this.active() && tail.length > 0) this.opts.onSeal({ text: tail, reason: 'end' });
```

`tail` is `this.pending`, and no step downstream adds marks
(`onSeal: (chunk) => this.sealUserChunk(chunk.text)`). A sentences seal on the
model path carries the model's punctuation — it seals `result.text.slice(0,
cut)` — and so does a length seal after `3fd5b382`. An `end()` seal never does.
Since at N = 3 on Chinese neither of the other two can fire, **every bubble is
an `end()` bubble and every bubble is therefore unpunctuated**, which is the
symptom originally reported. Giving `end()` the punctuation would mean caching
the last valid model answer for the current pending text; nothing caches it
today, and whether to is a design call, not an oversight to patch in passing.

### Chinese after the fix: the model path works (2026-09-19)

Same setup at **N = 1**, where `gateChars('zh', 1) = 20` and
`zhFallbackChars(1) = 30` put both gates well inside a 20 s utterance. Six
utterances, ~2 minutes, **38 sealed chunks**:

| chunk ends at | count | path |
|---|---|---|
| `，` | **27** | length fallback — unreachable before `3fd5b382` |
| `。` `？` | 5 | sentences |
| no mark | 6 | `end()`, exactly one per utterance |

**32 of 38 chunks carry punctuation the ASR never produced**, and 27 of those 32
came from the fallback. The raw partials are unbroken
(`多米多萝出事了各位他跟姿姿已经分手了而且引起了热议啊…`); the sealed chunks come
out as `多米多萝出事了各位，他跟姿姿已经分手了，`. A chunk ending in a comma cannot
come from the sentences path, which only ever cuts at `。！？`, so those 27 are
direct evidence for the fix.

That FireRedPunc supplies mostly commas is the premise the fallback was built
on, now measured: on conversational speech it emitted a sentence end only five
times in two minutes.

**The three remaining candidates are all dead.** Seals kept arriving through
the final utterance, so the model was never disabled and its median latency
stayed inside the 500 ms budget. Seals happened at all, so its answers passed
the skeleton invariant. And the load plainly completed.

**The latency bar is met on Chinese too.** The first `translation.start` fired
while the partials were still at `…来看看怎么回事`, with that utterance's
`asr.end` at 20916 ms — the translation was on screen while the speaker was
still talking.

**The six unpunctuated chunks are exactly the six `end()` flushes**, one per
utterance, which is the third finding above holding with perfect regularity.
At N = 1 they are a sixth of the output; at N = 3, where neither other path can
fire inside 20 s, they were all of it.

### N = 3 on Chinese is a coin flip on utterance length (2026-09-19)

Same material through **cohere-transcribe** (offline) at N = 3. Six utterances,
and the threshold behaves as a step function:

| # | seconds | raw chars | ≥ 100 | sealed | sealed chars | ends |
|---|---|---|---|---|---|---|
| 1 | 20.8 | 110 | yes | ✓ | 94 | `，` |
| 2 | 20.1 | 129 | yes | ✓ | 97 | `？` |
| 3 | 20.0 | 49 | no | ✗ | — | |
| 4 | 20.0 | 76 | no | ✗ | — | |
| 5 | 20.0 | 125 | yes | ✓ | 92 | `，` |
| 6 | 4.0 | 11 | no | ✗ | — | |

**Every utterance over `zhFallbackChars(3) = 100` sealed; every one under it did
not. No exceptions.**

All three seals are the fallback. Two end at a comma, which the sentences path
cannot produce. The third ends at `？`, but its sealed text carries only that
one sentence mark where N = 3 needs three, so it too is the fallback cutting at
its last breakpoint, which happened to be a question mark. **`3fd5b382` is what
makes N = 3 work on Chinese at all.**

**This retires the idea of lowering the threshold.** When it fires the chunk is
92-97 characters — about three sentences at the 22-character average, which is
exactly what N = 3 asks for. The size is right. The only fault is that it fires
half the time.

**What is wrong is the 20 s cap.** Chinese runs 4.8 characters per second, so
20 s yields 49-129 characters depending on how fast the speaker happens to be
going — straddling the 100-character line. Whether an utterance gets segmented
at all is decided by that coin flip. At 40 s every one of these would clear it
with room for two seals.

**That is the third defect traced to the same wall**: on English it garbles a
word at every boundary, on Chinese at N = 3 it makes segmentation random, and by
keeping tails short it inflates the share of raw `end()` bubbles — in this run
three sealed utterances each left one, plus three that never sealed, so half the
bubbles carried no punctuation.

cohere emitting no punctuation is confirmed again here: every partial is bare.

### Which ASR actually punctuates

Observed, not inferred:

| model | punctuates | note |
|---|---|---|
| voxtral-mini-4b | yes | commas, periods, question marks |
| qwen3-asr | yes | spells numerals out — "fifty eight", "twenty seventeen" |
| cohere-transcribe | **no** | neither Chinese nor English; seen on other material, not this broadcast |

cohere is the largest single model by minutes (102k speaker / 133k participant)
and the "Production language mix" section above lists it as already punctuating.
It does not. Every other model on that list is still unverified.

### Still open

Two defects remain on this path, both in the voxtral worker and both older than
this stage:

- **The 20 s wall.** The only one still costing whole words. `maxSpeechDuration`
  is set nowhere in `src/`.
- **The tail-pad hallucination.** Cosmetic per occurrence, but it reaches the
  user twice — in the bubble and again in its translation, where Bing renders
  `So all thatished` as 「所以所有那些都被处理了」.

Both are decided by the same two numbers, and the "What the VAD should be doing
now" section argues for raising both rather than lowering either. Neither number
has been measured against the cost of raising it: audio buffer, encoder backlog,
and voxtral's `max_new_tokens: 4096`.

Also still open:

- **N = 3 on Chinese** is decided by whether the utterance clears 100
  characters — measured as a clean step function, 3 of 6. The chunk size when it
  fires is right, so the number to change is the 20 s cap, not
  `zhFallbackChars`.
- **`end()` seals raw.** One chunk per utterance, always unpunctuated.
- **Edge-Punct on the model path** (unpunctuated English, i.e. cohere) is still
  unrun; only FireRedPunc has been exercised live.
- **N = 5, and changing N mid-session** (it must take effect only on the next
  utterance) are unrun.
