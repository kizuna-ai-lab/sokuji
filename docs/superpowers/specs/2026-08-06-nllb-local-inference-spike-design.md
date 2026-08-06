# NLLB-200 in LOCAL_INFERENCE — Feasibility Spike

**Issue**: none (research requested in-session, 2026-08-06)
**Date**: 2026-08-06
**Status**: Design

## Summary

Measure whether Meta's **NLLB-200-distilled-600M** is worth integrating as a
LOCAL_INFERENCE translation model, and produce a GO/NO-GO recommendation backed
by real numbers. This spec describes a throwaway spike, not a feature.

The spike answers three questions:

1. Does `Xenova/nllb-200-distilled-600M` load and produce correct output under
   this repo's exact `@huggingface/transformers` 4.2.0 + pinned ORT WASM build?
2. Is WASM (CPU) single-sentence latency good enough for real-time translation?
   This is the question that decides whether NLLB has a niche at all.
3. Where does its translation quality land relative to what already ships?

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
translation is limited to whichever fixed language pairs Opus-MT covers.** That
gap is the strongest hypothesis for what NLLB could be worth here — and it is
precisely the hypothesis that hinges on an unmeasured latency number.

The counter-argument is real and must be stated: Qwen 3.5 0.8B already claims
201+ languages, so on raw language count NLLB adds nothing. If NLLB cannot run
acceptably on WASM, it has no distinct position in this lineup.

## Goals

- Produce measured load time, single-sentence latency (median and p90), and
  observed failure modes for NLLB-600M q8 on **both** WASM and WebGPU, inside a
  worker context using this repo's own transformers build and pinned ORT WASM
  binaries.
- Produce the same latency numbers for two already-shipping baselines in the
  same session, on the same machine, so the NLLB numbers have a reference point.
  The repo currently records **no** latency baseline for any translation model.
- Produce a quality read on `ja↔en` and `zh↔en` against Opus-MT, and a
  structural correctness read on `xh↔en` — plus, for `en→xh`, a latency
  head-to-head against `opus-mt-en-xh` in the WASM lane.
- Verify the sokuji-code → FLORES-200 language code mapping against the
  tokenizer's own `language_codes` list rather than against memory.
- Write a decision report with a GO/NO-GO recommendation and, if GO, a scoped
  list of the real integration work.

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
Report NO-GO and do not build Phase 1.

Node uses `onnxruntime-node`, so this phase proves *correctness only*. It
produces no latency signal and none is recorded from it.

## Phase 1 — Browser harness

Three new files plus three lines in `App.tsx`, all spike-only and deleted after.

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
  Runs the fixed test set, shows a per-sentence table of source, output and
  `inferenceTimeMs`, computes median and p90 per pair, and offers one-click JSON
  copy. For the two baselines it instantiates the **real** `TranslationEngine`
  directly rather than duplicating worker code — `TranslationEngine.ts:165`
  already surfaces `inferenceTimeMs` on its result, it is simply never logged in
  production UI.
- **`App.tsx`** — Ctrl+Shift+L mount, following the existing
  `import.meta.env.DEV` + Ctrl+Shift+N pattern at `App.tsx:40-49`.

The proto deliberately does not touch `modelManifest`, `ModelManager`, or
IndexedDB.

## Measurement matrix

| Model | Device | dtype | Source | Purpose |
|---|---|---|---|---|
| NLLB-600M | wasm | q8 | HF direct | the core question |
| NLLB-600M | webgpu | q8 | HF direct | comparison; plus seq2seq-on-WebGPU output sanity |
| Opus-MT ja-en | wasm | q8 | IndexedDB | latency baseline — fastest shipping option |
| HY-MT1.5 1.8B | webgpu | q4 | IndexedDB | quality + latency baseline — current `sortOrder: 1` |

The latency baseline needs only one Opus-MT card, but the **quality** comparison
needs one per direction under test. Models to download through the normal UI
before running the spike:

`opus-mt-ja-en`, `opus-mt-en-jap`, `opus-mt-zh-en`, `opus-mt-en-zh`,
`opus-mt-en-xh` (~110 MB each), and `hy-mt15-1.8b-translation` q4 (~1.34 GB).

`xh→en` has no Opus-MT card — that absence is the point, and NLLB's output there
is judged structurally rather than comparatively.

Recorded per run: machine, browser build, GPU, and whether the model load was
cold or HTTP-cached.

## Test set

Seven directions, twelve sentences each — 84 sentences per model per device.
Sentences are conversational-meeting shaped — 8 to 25 words, including elision,
proper nouns and numbers — not newswire, because that is what Sokuji actually
translates.

| Direction | Why |
|---|---|
| `ja→en`, `en→ja` | Sokuji's core pair; head-to-head vs Opus-MT |
| `zh→en`, `en→zh` | second core pair; also exercises the `zho_Hans` mapping |
| `ko→en` | third common pair; single direction, to hold the run size down |
| `en→xh`, `xh→en` | the low-resource probe (see below) |

**Why Xhosa.** Among Sokuji's 55 languages it is the sharpest test available:

- `opus-mt-en-xh` already ships **and runs on WASM**, giving a latency and
  structural head-to-head in exactly the lane being probed. (Fluency still
  cannot be compared — see Known limitations.)
- `xh` is absent from TranslateGemma's 51 languages and from HY-MT1.5's 36, so
  **`xh→en` has zero local coverage today** — the exact gap NLLB claims to fill.
- The obvious alternatives are weaker comparisons: `sw` and `zu` are both
  already covered by TranslateGemma.

## Language code mapping

Provisional, to be confirmed against the Phase 0 `language_codes` dump. These
five are all the spike needs; the full 55-language table is integration scope.

| Sokuji | FLORES-200 |
|---|---|
| `en` | `eng_Latn` |
| `ja` | `jpn_Jpan` |
| `zh` | `zho_Hans` |
| `ko` | `kor_Hang` |
| `xh` | `xho_Latn` |

`zh` → Simplified is an assumption the spike adopts to stay unblocked. Sokuji
has a single `zh` code with no script variant, so a real integration must decide
whether to map `zh` to `zho_Hans`, expose both, or infer from UI locale. That
decision is deferred, not resolved here.

## Decision criteria

Fixed before measuring, so the verdict cannot be rationalized afterwards.

**WASM — the deciding lane**

- Pass: median ≤ 1.5 s and p90 ≤ 3 s per sentence.
- Fail: allocation failure, load failure, or median > 3 s.

These absolute thresholds are provisional and are **re-anchored to the Opus-MT
baseline measured in the same run**. If Opus-MT comes in around 400 ms, NLLB at
1.4 s is ~3.5× slower but still plausibly usable as a CPU fallback; if Opus-MT
itself is already near 1.2 s, the bar for "acceptable" shifts with it. The
report states both the absolute numbers and the ratio.

**Quality**

- `ja↔en` and `zh↔en` must not be clearly worse than Opus-MT.
- `xh↔en` must be structurally sound (see limitations).

**WebGPU**

- NLLB must beat HY-MT1.5 1.8B on latency or quality by a clear margin. The
  WebGPU lane already carries six translation models; adding a seventh needs a
  reason.

**Overall NO-GO** if WASM fails *and* WebGPU shows no clear advantage — because
then NLLB occupies no position that an already-shipping model does not fill.

## Deliverable

`.spike/out/nllb-README.md`, following the `.spike/out/README.md` precedent left
by the CosyVoice3 and OmniVoice spikes:

- Raw per-sentence numbers plus median/p90 tables, with machine and browser
  recorded.
- Every failure and workaround encountered, especially ORT-level ones.
- A GO/NO-GO recommendation with reasoning.
- If GO, the scoped integration work — currently understood to be: port the
  non-commercial license gate from the native lane to the WASM lane (a `license`
  field on `ModelManifestEntry`, a gate in `ModelManagementSection`, reuse of
  `LicenseConsentModal` / `licenseConsentStore`); a FLORES-200 mapping module
  covering all 55 languages; a new `translationWorkerType: 'nllb'` and its
  worker; a manifest entry with exact byte counts; and the `zh` script decision.

## Known limitations

Stated up front so the report is not read as more than it is.

- **Low-resource quality cannot be judged here.** Nobody on this side reads
  Xhosa. The `xh` verdict is limited to structural checks — non-empty, not an
  echo, correct script, no code-switching into English, no degenerate repetition.
  It is explicitly **not** a fluency judgment. If `xh` quality becomes the
  deciding factor for GO/NO-GO, it needs a native speaker or a stronger
  reference system, and the report will say so rather than guess.
- **Single-machine numbers.** Latency is measured on one machine. WASM
  performance varies widely with CPU; the numbers bound feasibility, they do not
  characterize the user population.
- **Phase 0 proves correctness, not speed.** `onnxruntime-node` is a different
  execution provider; no timing from it is carried into the report.
- **HF-direct loading skips the download path.** Deliberate — that path is
  already proven — but it means the spike says nothing about the download and
  IndexedDB experience for a ~900 MB model.
