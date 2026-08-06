# NLLB-200 in LOCAL_INFERENCE — Feasibility Spike

**Issue**: none (research requested in-session, 2026-08-06)
**Date**: 2026-08-06
**Status**: Design

## Summary

Measure whether Meta's **NLLB-200-distilled-600M** is worth integrating as a
LOCAL_INFERENCE translation model, and produce a per-device ship recommendation
backed by real numbers. This spec describes a throwaway spike, not a feature.

The spike answers three questions:

1. Does `Xenova/nllb-200-distilled-600M` load and produce correct output under
   this repo's exact `@huggingface/transformers` 4.2.0 + pinned ORT WASM build?
2. Is it **fast enough** — on CPU (WASM) and on WebGPU, measured separately?
3. Is the translation **good enough**?

Both criteria are absolute: no shipping model is a bar NLLB must *beat*. An
earlier draft required NLLB to match Opus-MT on quality and HY-MT1.5 on WebGPU
latency, and both were dropped — NLLB and a per-pair Opus-MT card are not
substitutes for the same user need, and on the language pairs where NLLB would
actually be used there is no incumbent to compare against at all.

Two shipping models are still *measured*, for one narrow purpose: an absolute
speed threshold has to come from somewhere, and inventing one would be worse
than reading it off what users already accept. Bing Translator and HY-MT1.5 are
both `recommended: true` today, so their latency calibrates "how slow is too
slow." See Decision criteria. Nothing calibrates the quality bar — that is
judged by reading the output.

The outcome is a per-device recommendation — ship on CPU, on WebGPU, on both, or
not at all — plus, if it ships, whether it earns `recommended: true`.

Everything the spike builds is deleted afterwards. If the answer is GO, the real
integration is designed separately.

## Background

Sokuji has never researched or implemented NLLB. A repo-wide search across all
branches, all commit messages, all commit contents (`git log --all -S`), every
GitHub issue and PR body, and all 30,676 lines of issue comments found exactly
two passing mentions and no MADLAD mentions at all:

- `src/lib/local-inference/workers/translation.worker.ts:70` — a comment using
  NLLB-200 as an example of a "large model" that would justify WebGPU.
- `docs/superpowers/specs/2026-04-22-bing-translator-integration-design.md:9` —
  the phrase "Opus-MT NLLB models", which is a typo; that document is about
  Opus-MT, Qwen and TranslateGemma.

Today's LOCAL_INFERENCE translation lineup and, critically, its device split:

| Model | Languages | Device |
|---|---|---|
| Opus-MT (69 per-pair cards) | one fixed pair each | **wasm** |
| Qwen 2.5 0.5B | 28 | webgpu |
| Qwen 3 0.6B | 119+ | webgpu |
| Qwen 3.5 0.8B / 2B | 201+ | webgpu |
| HY-MT1.5 1.8B (`sortOrder: 1`) | 36 | webgpu |
| TranslateGemma 4B | 51 | webgpu |
| Bing Translator | ~100 | cloud |

Every multilingual local model requires WebGPU. The only WASM/CPU option is
Opus-MT, which is bilingual per card. **A user without WebGPU who wants offline
translation is limited to whichever fixed language pairs Opus-MT covers** — one
download per direction. NLLB would be one download covering everything, which is
why it is worth measuring on CPU specifically and not only on WebGPU.

That is context for why the question is being asked, not a bar NLLB has to
clear. The spike judges NLLB on its own numbers.

One structural property matters for reading those numbers, so it is recorded
here rather than discovered mid-run. NLLB carries a 256,206-token shared
vocabulary at `d_model` 1024 across 12+12 layers (`config.json`). The output
projection alone is ~262M multiply-accumulates **per generated token**, and the
256k embedding is ~262M parameters — roughly a third of the 917 MB q8 footprint,
which is also why q4 does not shrink it (q4 leaves embeddings unquantized).
Covering 200 languages is not free at inference time; whether the cost is
affordable is exactly what gets measured.

## Goals

- Produce measured load time, single-sentence latency (median and p90), and
  observed failure modes for NLLB-600M q8 on **CPU (WASM) and WebGPU
  separately**, inside a worker context using this repo's own transformers build
  and pinned ORT WASM binaries.
- Produce translated output for a fixed sentence set on language pairs a
  reviewer here can actually read, so quality can be judged directly rather than
  inferred.
- Verify the sokuji-code → FLORES-200 language code mapping against the
  tokenizer's own `language_codes` list rather than against memory.
- Write a decision report giving a per-device recommendation and, if it ships, a
  scoped list of the real integration work.

## Non-Goals

- **NLLB-200-distilled-1.3B / 3.3B.** No trustworthy ONNX export exists. An HF
  search for NLLB ONNX repos returns `Xenova/nllb-200-distilled-600M` at 7,757
  downloads and then a long tail of community 1.3B exports in the 3–14 download
  range. Not worth spending spike time on.
- **q4 / q4f16 / fp16 / bnb4 variants.** For this model q8 is the *smallest*
  export (see file sizes below) because the 256k-entry embedding dominates and
  only int8 quantization touches it. Every other dtype is both larger and,
  on WASM, slower. If q8 fails, nothing else can pass.
- **The license consent gate.** NLLB-200 is CC-BY-NC-4.0. Shipping it would
  require the work sketched at the end of "Deliverable", but that is integration
  scope, not spike scope. Running it locally for evaluation does not need it.
- **`modelManifest` / `ModelManager` / IndexedDB plumbing.** Downloading and
  caching a ~900 MB model through this path is already proven — TranslateGemma
  4B q4 ships at 3.1 GB. Re-testing it produces no information. The spike loads
  straight from HF Hub.
- **Expanding `LANGUAGE_OPTIONS`.** Sokuji exposes 55 languages; NLLB covers
  200. Harvesting that surplus is a separate change that affects every provider.
- **Beating other models.** No Opus-MT, Qwen, TranslateGemma or Bing *quality*
  comparison is made, and no model is a bar NLLB must out-perform. Bing and
  HY-MT1.5 latency is measured, but only to calibrate the speed threshold — see
  Summary and Decision criteria.
- **Quality on languages nobody here reads.** An earlier draft tested `xh↔en`
  for quality and then admitted in its own limitations section that the verdict
  could only be structural. A probe that cannot deliver its own purpose is
  wasted budget. `en→xh` survives as a **speed-only** probe (see Test set).

## Established facts

These were verified before writing this spec and do not need re-checking.

**transformers.js supports NLLB natively.** `@huggingface/transformers` 4.2.0
(`node_modules/@huggingface/transformers/dist/transformers.js`) contains the
`m2m_100` architecture mapping, `NllbTokenizer`, and `_build_translation_inputs`,
which validates `src_lang` / `tgt_lang` against the tokenizer's `language_codes`
and throws a listing error on a bad code. The call shape is:

```js
translator(text, { src_lang: 'jpn_Jpan', tgt_lang: 'eng_Latn' })
```

**A new worker type is required.** `translation.worker.ts` accepts `sourceLang`
and `targetLang` in its message types but explicitly ignores them ("provided by
engine, ignored by Opus-MT", lines 29 and 38) and never forwards them to the
pipeline. NLLB cannot reuse it.

**Only one viable ONNX export, and q8 is its smallest form.** From
`Xenova/nllb-200-distilled-600M` (HF API, 2026-08-06):

| File | Bytes |
|---|---|
| `onnx/encoder_model_quantized.onnx` | 419,120,483 |
| `onnx/decoder_model_merged_quantized.onnx` | 475,505,771 |
| `tokenizer.json` | 17,331,224 |
| `sentencepiece.bpe.model` | 4,852,054 |
| `config.json` + `generation_config.json` + `special_tokens_map.json` + `tokenizer_config.json` | 5,154 |
| **Total** | **916,814,686** (~917 MB / 874 MiB) |

For contrast, the q4f16 encoder alone is 612,305,403 bytes — larger than the
whole q8 encoder — because q4 quantization leaves the embedding in fp16.

**License is CC-BY-NC-4.0** (confirmed on both `facebook/nllb-200-distilled-600M`
and the Xenova mirror). Sokuji is a commercial product, so this is a genuine
gating concern for shipping, though not for local evaluation. The repo has a
precedent — the OmniVoice non-commercial consent gate — but it lives **only in
the native sidecar lane** (`nativeCatalog.ts` `license.nonCommercial` →
`LicenseConsentModal` → `licenseConsentStore`). The WASM lane has no license
field in `modelManifest.ts` and no gate in `ModelManagementSection.tsx`.
This is not legal advice; it is a flag that a decision is required.

## Risks the spike must resolve

1. **WASM latency.** A 600M encoder-decoder with a 256k vocabulary is far
   heavier per decode step than Opus-MT's ~50 MB. Unmeasured.
2. **WASM memory.** ~900 MB of int8 weights inside a 32-bit ORT WASM heap, plus
   arena and activations. May simply fail to allocate.
3. **ORT graph-optimization landmines.** This repo has already been bitten:
   `translation.worker.ts:75-82` pins `graphOptimizationLevel: 'basic'` to dodge
   an ORT 1.25 `TransposeDQWeightsForMatMulNBits` fusion bug that broke some
   quantized Opus-MT models. A different quantized seq2seq is a live candidate
   for the same class of failure. **This risk is only observable under the
   repo's own pinned ORT build**, which is why the spike does not use a CDN.
4. **WebGPU correctness for a quantized seq2seq.** TranslateGemma q4f16 emits
   `<unused57>` garbage on Windows WebGPU despite reported `shader-f16` support
   (`modelManifest.ts:3152-3154`), and Whisper hit the same class of issue. NLLB
   on WebGPU needs an output-sanity check, not just a stopwatch.
5. **Language code mapping.** FLORES-200 codes are script-qualified
   (`zho_Hans` vs `zho_Hant`). A wrong code either throws or silently degrades.

## Phase 0 — Node prescreen

`.spike/nllb/node-check.mjs`, run against the repo's own 4.2.0 install.

- `pipeline('translation', 'Xenova/nllb-200-distilled-600M', { dtype: 'q8' })`
- Dump the tokenizer's full `language_codes` list to
  `.spike/out/nllb-language-codes.txt` and cross-check the mapping table below
  against it. Any mismatch is fixed here, before browser time is spent.
- Run the full test set and assert each output is non-empty, is not an echo of
  the input, and is in the expected script.

**Kill condition**: if the model fails to load or output is degenerate, stop.
Report "do not ship" and do not build Phase 1.

Node uses `onnxruntime-node`, so this phase proves *correctness only*. It
produces no latency signal and none is recorded from it.

## Phase 1 — Browser harness

Two new files under `src/` plus three lines in `App.tsx`, all spike-only and
deleted afterwards. The test set itself lives in one JSON file under
`.spike/nllb/` and is read by both phases, so Node and the browser provably
translate the same sentences.

- **`src/lib/local-inference/workers/_spike/nllb-spike.worker.ts`** — imports
  from `_shared/transformers-all` and calls
  `initTransformersEnv(env, { fileUrls: {}, ortWasmBaseUrl })` to inherit the
  repo's `wasm.proxy = false` and pinned `wasm.wasmPaths` — that inheritance is
  the whole point, since it is what keeps ORT parity with production. It then
  overrides the offline flags that helper hard-sets
  (`transformers-env.ts:35-39`) to stream from HF Hub instead of the blob cache:
  `allowRemoteModels = true`, `useCustomCache = false`, `customCache = undefined`,
  `useBrowserCache = true` (browser caching on, so repeat runs are not re-downloads
  — cold vs cached load is recorded separately). Accepts
  `device: 'wasm' | 'webgpu'` in its init message. Reports `loadTimeMs` on ready
  and `inferenceTimeMs` per result, matching the existing worker protocol.
- **`src/components/dev/NllbSpikeProto.tsx`** — modeled on `NativeTtsProto.tsx`.
  A run selector (NLLB-wasm / NLLB-webgpu / Bing / HY-MT1.5), a run button, and
  a per-sentence table of source, translation, `inferenceTimeMs` and output token
  count. Computes median and p90 per direction, and offers one-click JSON copy
  for pasting into the report. Because quality is judged by reading, the table is
  the primary output, not the summary statistics.

  The two anchor runs drive the **real** `TranslationEngine` rather than
  duplicating worker code: it is directly instantiable, it already handles Bing's
  DNR setup and HY-MT1.5's IndexedDB load, and `TranslationEngine.ts:165` already
  surfaces `inferenceTimeMs` on its result — that value is simply never logged in
  production UI, which is why the repo has no recorded latency baseline today.
- **`App.tsx`** — Ctrl+Shift+L mount, following the existing
  `import.meta.env.DEV` + Ctrl+Shift+N pattern at `App.tsx:40-49`.

The proto deliberately does not touch `modelManifest`, `ModelManager`, or
IndexedDB.

## Measurement matrix

Four runs, same sentences, same machine, same session:

| Run | Model | Device | Source | Purpose |
|---|---|---|---|---|
| A | NLLB-600M q8 | wasm | HF direct | is NLLB usable on CPU? |
| B | NLLB-600M q8 | webgpu | HF direct | is NLLB usable on WebGPU? also: does a quantized seq2seq produce clean output there (see Risk 4)? |
| C | Bing Translator | cloud | — | speed anchor, fast end. Sampled 3× across the session (see Test set) |
| D | HY-MT1.5 1.8B q4 | webgpu | IndexedDB | speed anchor, "already recommended" end |

Runs A and B decide NLLB. Runs C and D only set the threshold A and B are
measured against; their translation output is not judged.

The anchor runs cover the **six readable directions only** (72 sentences).
HY-MT1.5's 36 languages do not include `xh`, so `en→xh` has no anchor — which is
the point of that probe. Its timings are reported as a standalone low-resource
observation and are excluded from the pass/fail bands.

Running both devices is not a comparison between products; it separates two
independent ship decisions. CPU and WebGPU can pass or fail independently, and
the result of run A does not change how run B is judged.

**Pre-download required**: `hy-mt15-1.8b-translation` q4 (~1.34 GB) through the
normal Model Management UI. NLLB streams from HF Hub; Bing needs no download.

Recorded per run: machine, Electron/Chromium build, GPU, per-sentence `inferenceTimeMs`,
output token count, `loadTimeMs`, whether the load was cold or HTTP-cached, and
peak memory if the runtime exposes it.

### Execution environment

The spike runs under **`npm run electron:dev`**, not `npm run dev`. Bing
Translator's endpoints restrict CORS to `https://www.bing.com` and only work
when browser-like `Origin` / `Referer` / `User-Agent` headers are injected.
There are exactly two places that happens: the extension's DNR rules, which
`TranslationEngine.ts:268` short-circuits outside an extension
(`if (!isExtension()) return`), and Electron's `session.webRequest` handler at
`electron/main.js:1016`. A plain browser tab served by Vite has neither, so run
C would fail there. Electron 34+ is Chromium-based, so WASM and WebGPU are both
available in the same session — one environment covers all four runs.

It also runs from the **main checkout, on a branch — not from a git worktree**.
A fresh worktree has no `node_modules`, and installing them there resets
`node_modules/electron/dist/chrome-sandbox` to non-root ownership, which stops
Electron from launching until it is manually restored with `sudo chown root` +
`chmod 4755` (the repo deliberately does not pass `--no-sandbox`). The main
checkout already has a correctly configured sandbox binary. The worktree used to
author this spec is for the document only.

## Test set

Twelve sentences per direction. Sentences are conversational-meeting shaped —
8 to 25 words, including elision, proper nouns and numbers — not newswire,
because that is what Sokuji actually translates.

**Quality + speed directions** (six, 72 sentences):

`ja→en`, `en→ja`, `zh→en`, `en→zh`, `ja→zh`, `zh→ja`

Every one of these is directly readable by the reviewer here. That is the
selection rule, and it is deliberate: quality is judged absolutely, by reading
the output, so a direction nobody can read yields no quality signal. These are
also Sokuji's highest-traffic pairs, so a failure here is decisive on its own.
`zh` directions additionally exercise the `zho_Hans` mapping, and `ja↔zh` covers
the non-English-pivot case.

**Speed-only direction** (one, 12 sentences):

`en→xh`

Included because NLLB's whole proposition is language breadth, so users will run
it on languages far outside the set above — and because a shared 256k vocabulary
allocates fewer dedicated subword units to low-resource languages, which inflates
output token count and therefore decode time. Xhosa is additionally agglutinative,
making it a reasonable worst case. The magnitude of that inflation is unknown and
is *measured here* (output token counts are recorded), not assumed.

**No quality claim is made about `en→xh`.** Nobody on this side reads Xhosa. Its
output is checked only for the failure modes that need no language knowledge —
empty output, echoed input, wrong script, degenerate repetition — and those are
reported as diagnostics, never as a quality verdict.

**Totals.** NLLB: 84 sentences × 2 devices = 168. HY-MT1.5 anchor: 72.
Bing anchor: the full 72 once, then a fixed 12-sentence subset at the midpoint
and again at the end — 96 in total. The subset re-runs exist to expose network
drift, and keeping them small is deliberate: `www.bing.com/ttranslatev3` is an
unofficial endpoint reached with a scraped anti-abuse token, so the spike should
not hammer it. 336 translations overall.

## Language code mapping

Provisional, to be confirmed against the Phase 0 `language_codes` dump. These
four are all the spike needs; the full 55-language table is integration scope.

| Sokuji | FLORES-200 |
|---|---|
| `en` | `eng_Latn` |
| `ja` | `jpn_Jpan` |
| `zh` | `zho_Hans` |
| `xh` | `xho_Latn` |

`zh` → Simplified is an assumption the spike adopts to stay unblocked. Sokuji
has a single `zh` code with no script variant, so a real integration must decide
whether to map `zh` to `zho_Hans`, expose both, or infer from UI locale. That
decision is deferred, not resolved here.

## Decision criteria

Two absolute criteria, speed and quality, applied independently to each device.
Fixed before measuring, so the verdict cannot be rationalized afterwards.

### Speed

Translation is a **serial stage after ASR** — `LocalInferenceClient.ts:552`
awaits `translationEngine.translate()` before anything is displayed or spoken —
so its latency adds directly to perceived lag.

The bands are **defined by reference to what already ships**, not by numbers
invented in this document. Two shipping models are measured in the same session,
on the same machine, over the same sentences, and their medians become the
thresholds:

| Band | Definition | Meaning |
|---|---|---|
| Good | ≤ measured **Bing Translator** median | as fast as the cloud option users already accept |
| Usable | ≤ measured **HY-MT1.5 1.8B** median | no slower than the product's current top recommendation |
| Too slow | slower than the above | do not ship on this device |

Load failure or allocation failure is an automatic "too slow" for that device.

**Why these two anchors.** Both carry `recommended: true` in the manifest today
and are actively offered to users, so their latency is by construction a level
this product already treats as acceptable. Bing is the fast end (cloud, no local
compute); HY-MT1.5 is `sortOrder: 1`, the top local recommendation, and at
1.34 GB q4 it is both the more apt anchor and a cheaper download than
TranslateGemma 4B's 3.1 GB.

**This is calibration, not competition.** The spec elsewhere refuses to benchmark
NLLB against other models, and that still holds: no model here is a bar NLLB
must *beat* to be worth shipping. These two only answer a different question —
how slow is too slow in this product — which absolute thresholds cannot be set
without.

**Two caveats that must appear in the report.**

The Bing anchor is network latency, not compute, so it drifts with connection
and time of day. It is therefore sampled three times across the session — the
full set at the start, then a fixed 12-sentence subset at the midpoint and at
the end. The band uses the median of the full opening run; the two subset
re-runs exist to expose drift. If their medians diverge materially from the
opening run, the "good" band is soft and the report says so rather than
presenting a single confident number.

If an anchor itself comes back slow — say HY-MT1.5 lands near 3 s — then the
"usable" band becomes *looser* than a hand-picked threshold would have been.
That is a finding about what the product currently ships, not a loophole for
NLLB. The report therefore prints both anchor medians prominently, so the bar is
visible and can be rejected: jiangzhuo may choose to tighten rather than inherit
it.

### Quality

Judged by reading the output on the six readable directions. No reference
translations, no automatic metric, no comparison model.

| Band | Meaning |
|---|---|
| Good | meaning preserved and phrasing natural enough for a meeting → may be `recommended` |
| Usable | understandable, occasionally awkward or stiff, no meaning errors → ship as an option |
| Not usable | meaning errors, dropped content, hallucination, degeneration, or code-switching |

Any occurrence of degeneration (repetition loops), truncation, or output in the
wrong language is disqualifying regardless of how the rest reads.

### Verdict

Speed and quality are combined per device, then the two devices give independent
answers:

| CPU | WebGPU | Outcome |
|---|---|---|
| pass | pass | ship on both; `recommended` only if both criteria are "good" |
| fail | pass | ship WebGPU-only (`requiredDevice: 'webgpu'`) |
| pass | fail | ship CPU-only — unusual, but the right call if WebGPU shows output corruption |
| fail | fail | do not ship |

Quality is device-independent in principle, but it is judged separately per run
anyway: Risk 4 is precisely that the same model can produce clean output on one
backend and corrupt output on the other.

## Deliverable

`.spike/out/nllb-README.md`, following the `.spike/out/README.md` precedent left
by the CosyVoice3 and OmniVoice spikes:

- **The two anchor medians, stated first**, before any NLLB number — because
  they define the bar, and a bar the reader cannot see is a bar they cannot
  reject. Bing's three runs and their spread are shown individually.
- Raw per-sentence numbers plus median/p90 tables and output token counts, with
  machine and Electron/Chromium build recorded, for both NLLB devices.
- `en→xh` timings and output token counts, reported separately and explicitly
  outside the pass/fail bands.
- The full translated output for all 72 readable sentences, laid out
  source-beside-translation so quality can be judged by reading rather than by
  trusting a summary.
- Every failure and workaround encountered, especially ORT-level ones.
- A per-device verdict against the bands above, and the resulting ship /
  ship-not-recommended / do-not-ship call.
- If it ships, the scoped integration work — currently understood to be: port the
  non-commercial license gate from the native lane to the WASM lane (a `license`
  field on `ModelManifestEntry`, a gate in `ModelManagementSection`, reuse of
  `LicenseConsentModal` / `licenseConsentStore`); a FLORES-200 mapping module
  covering all 55 languages; a new `translationWorkerType: 'nllb'` and its
  worker; a manifest entry with exact byte counts; and the `zh` script decision.

## Known limitations

Stated up front so the report is not read as more than it is.

- **Quality is judged on six directions out of a possible 200 languages.** A
  pass means NLLB is good enough on Sokuji's core pairs. It does **not**
  establish that NLLB is good at Vietnamese, Swahili or Xhosa. If it ships and
  language breadth becomes the selling point, that claim needs its own
  evaluation — reference-scored against a parallel corpus such as FLORES-200,
  which is a separate exercise with its own caveats (FLORES is NLLB's own
  development benchmark, and it is written wiki prose rather than meeting
  speech). Deliberately out of scope here; a failure on the core pairs settles
  the question without it.
- **Quality is one reviewer's judgment.** No metric, no second opinion. That is
  an accepted tradeoff for a spike whose job is to decide whether to keep going.
- **Single-machine numbers.** Latency is measured on one machine. WASM
  performance varies widely with CPU; the numbers bound feasibility, they do not
  characterize the user population. The speed bands are pass/fail on that one
  machine, which is a real limitation when the CPU verdict is the close call.
- **Phase 0 proves correctness, not speed.** `onnxruntime-node` is a different
  execution provider; no timing from it is carried into the report.
- **HF-direct loading skips the download path.** Deliberate — that path is
  already proven — but it means the spike says nothing about the download and
  IndexedDB experience for a ~900 MB model.
