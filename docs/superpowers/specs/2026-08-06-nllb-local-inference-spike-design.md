# NLLB-200 in LOCAL_INFERENCE — Evaluation and Decision

**Date**: 2026-08-06
**Status**: Closed — **do not ship**. Evaluated, rejected on translation quality.
**Issue**: kizuna-ai-lab/sokuji (see the NLLB evaluation issue, closed as not-planned)

## Decision

`NLLB-200-distilled-600M` is **not usable for Sokuji**. It fails on translation
quality — degenerate repetition, mid-sentence truncation, systematic sentence
dropping on multi-sentence input, and frequent meaning errors on ordinary
meeting speech.

Speed was never the problem. On the same machine and sentences it was the
**fastest** of everything measured, including the cloud option.

The failures are **the model itself**, not the ONNX conversion and not
quantization. That was verified against Meta's official PyTorch weights.

## Why this was asked

NLLB had never been researched here. A repo-wide search across all branches, all
commit messages, all commit contents (`git log --all -S`), every GitHub issue and
PR body, and all 30,676 lines of issue comments turned up exactly two passing
mentions and no MADLAD mentions at all:

- `src/lib/local-inference/workers/translation.worker.ts:70` — a comment using
  NLLB-200 as an example of a "large model" that would justify WebGPU.
- `docs/superpowers/specs/2026-04-22-bing-translator-integration-design.md:9` —
  the phrase "Opus-MT NLLB models", which is a typo.

The motivating gap was real. Every multilingual local translation model requires
WebGPU; the only WASM/CPU option is Opus-MT, which is one fixed language pair per
download (69 cards today). NLLB would have been one download covering everything,
on CPU. That is why it was worth measuring rather than dismissing.

## What was measured

84 sentences — 12 per direction across `ja↔en`, `zh↔en`, `ja↔zh`, plus `en→xh`
as a low-resource speed probe. Items 1–8 in each direction are single-sentence;
9–12 are deliberately multi-sentence, because ASR output often is.

Directions were chosen so that a reviewer here can read every one of them.
Quality was judged absolutely, by reading, with no reference translations and no
automatic metric.

All runs: native CPU, same machine, same session.

| Run | What | Purpose |
|---|---|---|
| `Xenova/nllb-200-distilled-600M` q8 ONNX | the shippable candidate | the actual question |
| `Xenova/nllb-200-distilled-600M` fp32 ONNX | same conversion, no quantization | isolate quantization damage |
| `facebook/nllb-200-distilled-600M` fp32 PyTorch | Meta's official weights | isolate conversion fidelity |
| `onnx-community/HY-MT1.5-1.8B-ONNX` q4 | a shipping model, same sentences | fairness check on the test set |
| Bing Translator | a shipping model | speed reference |

## Results — speed

Median and p90 over the six readable directions, milliseconds per sentence:

| Configuration | median | p90 |
|---|---|---|
| **NLLB-600M q8 ONNX** | **717** | 991 |
| HY-MT1.5 1.8B q4 ONNX | 937 | 1,537 |
| Bing Translator (cloud) | 1,197 | 1,816 |
| NLLB-600M fp32 PyTorch (official) | 4,282 | 6,524 |

NLLB was the fastest thing measured. Bing was notably stable across the session
(1,197 / 1,138 / 1,114 ms medians at start, midpoint and end; 96 calls, zero
errors, `usedLLM: true` throughout).

**The low-resource token-inflation effect is real but smaller than assumed.**
`en→xh` averaged 19 output tokens against 13–16 for `en→ja` / `en→zh` from the
same English source, and ran at 880 ms median against ~640 ms. That is **1.3–1.45×**,
not the 1.5–2× that had been estimated before measuring.

**Quantization bought no speed.** fp32 ONNX ran at or below q8 ONNX on most
sentences (641 vs 876, 525 vs 622, 497 vs 622 ms). The 4–6× gap against the
PyTorch run is ONNX Runtime versus PyTorch, not precision. On this model int8
dynamic quantization pays a quality cost for nothing — worth remembering if NLLB
or a similar 256k-vocabulary seq2seq is ever revisited.

## Results — quality

Every disqualifying failure class was hit.

**Degenerate repetition.** `ja→en` 「音声が途切れていたので、もう一度お願いします。」
produced `"I'm sorry, but I'm sorry, but I'm sorry, but …"` roughly thirty times,
running to `max_length` — 13.9 s at q8, 67.5 s on official fp32.

**Truncation.** `en→zh` "The API returns a 500 whenever the payload exceeds two
megabytes." produced `任何时候,当使用负载超过2兆字节时,` — the main clause is
absent and the output ends on a comma.

**Systematic sentence dropping.** All four multi-sentence items in every
direction lost content. Examples:

| Source | NLLB |
|---|---|
| I don't think that's blocking. The bigger risk is the vendor contract. | `危険は売り手契約だ` (first sentence gone) |
| 资料我待会儿发给你们。先说结论。 | "I'll send you the information for a moment." (second sentence gone; 待会儿 → "for a moment") |
| Can everyone see my screen? I'll share the Q3 numbers in a second. | `我会分享Q3号码.` (first sentence gone; 号码 = phone number) |

**Meaning errors on ordinary single sentences.**

| Source | NLLB | Problem |
|---|---|---|
| behind on the **migration** | 移住 / 移民 | human migration |
| send the **deck** | 甲板 | a ship's deck |
| we **closed** at 4.2 million | 閉店した / 关闭了 | shutting a shop |
| Let's **park** that for now | 駐車して | parking a car |
| onboarding flow | オンボード流 / 登陆流量 | not words |
| 客户那边希望提前两周**交付** | "The customer wants to **deliver**" | subject inverted |
| **麻烦你**把会议纪要发到群里 | "**I'm sorry you're** sending…" | a request became an apology |
| **这个数字对不上**，我记得是四百二十万 | "I remember that number was 4.2 million." | the entire point dropped |

Chinese output also used ASCII `.` rather than `。`.

**Beam search does not rescue it.** `num_beams=4, no_repeat_ngram_size=3` fixed
only the repetition loop — and the repaired output was still wrong
(`"I'm sorry, but I've been through a lot."` for 「音声が途切れていたので、もう一度お願いします。」).
The other nine failures reproduced byte-for-byte. These are not decoding
artifacts.

**The test set is not unreasonable.** HY-MT1.5 1.8B, run on the same sentences on
the same machine, handled every case NLLB failed: `移行作業` for migration, the
complete API sentence, `売上は420万で終わった`, `その点は今は置いておきましょう。来週のレビューで…`
with both sentences intact, `オンボーディングプロセス`, and
"The sound was cut off. Please do it again." for the sentence that sent NLLB into
a loop. Every multi-sentence input kept both sentences.

## Attribution — conversion, quantization, or the model?

`Xenova/nllb-200-distilled-600M` is a community conversion
(`base_model:quantized:facebook/nllb-200-distilled-600M`, `library_name: transformers.js`,
standard ORT dynamic quantization with `per_channel: true, reduce_range: true`).
That raised a fair question: were the failures an artifact of the export rather
than the model? Twelve failing cases were re-run in all three configurations.

| | fatal failures | the three marginal cases |
|---|---|---|
| Xenova q8 ONNX | all present | slightly worse |
| Xenova fp32 ONNX | all present | **byte-identical to official** |
| Official PyTorch fp32 | all present | — |

Two clean conclusions:

- **The conversion is faithful.** At matching precision, Xenova's ONNX output is
  byte-identical to Meta's PyTorch output across all twelve cases.
- **Quantization causes only minor degradation.** Three of twelve differ — one
  dropped clause recovered, `オンボードフロー` written correctly instead of
  `オンボード流`. **No fatal failure is caused by quantization.**

Everything that disqualifies the model is present in Meta's own weights at fp32.

## Scope limits of this evaluation

- Quality was judged on six directions among 200 supported languages, by one
  reviewer, without reference translations. A pass would not have established
  that NLLB is good at Vietnamese or Swahili. A failure on Sokuji's core pairs
  settles the question without needing that.
- `en→xh` was a speed probe only. Nobody here reads Xhosa and no quality claim
  is made about it.
- Single machine. Latency bounds feasibility; it does not characterise the user
  population.
- Larger NLLB checkpoints (1.3B, 3.3B) were not tested — no trustworthy ONNX
  export exists. An HF search returns `Xenova/nllb-200-distilled-600M` at ~7.8k
  downloads and then community 1.3B exports in the 3–14 download range.

## The browser phase was never built

The original plan had a second phase: a dev-only proto behind a `Ctrl+Shift`
toggle plus a spike worker, run under `electron:dev`, to measure WASM and WebGPU
with the repo's own pinned ORT build. **It was not built and is not needed.**
Those runs could only have changed the speed numbers, and speed was never the
constraint. Quality is backend-independent for the same weights and decoding
configuration.

## Findings that outlived the decision

Worth keeping even though NLLB is rejected.

- **`onnxruntime-node` is aliased to an empty stub in this repo.**
  `package.json:112` sets `"onnxruntime-node": "npm:empty-npm-package@1.0.0"` —
  deliberate, since the app is browser/WASM only. Any future Node-side ONNX
  evaluation must install a real `onnxruntime-node` in an isolated directory, not
  in this repo.
- **The repo records no translation latency baseline.** `TranslationEngine.ts:165`
  surfaces `inferenceTimeMs` on every result and nothing logs it. Several earlier
  specs said they would capture a baseline; none did. The numbers in this
  document are the first.
- **Bing Translator cannot be exercised from a plain Vite dev tab.** Its
  endpoints restrict CORS to `https://www.bing.com` and require injected
  `Origin` / `Referer` / `User-Agent`. Only two places do that: the extension's
  DNR rules — `TranslationEngine.ts:268` short-circuits outside an extension —
  and Electron's `session.webRequest` handler at `electron/main.js:1016`.
  Measuring Bing means `electron:dev`, the extension build, or a plain Node
  script with a manual cookie jar.
- **Spike code should not run from a fresh git worktree.** A new worktree has no
  `node_modules`, and installing them resets
  `node_modules/electron/dist/chrome-sandbox` to non-root ownership, which stops
  Electron launching until it is restored with `sudo chown root` + `chmod 4755`
  (the repo deliberately does not pass `--no-sandbox`).

## What NLLB would have needed even if quality had passed

Recorded so a future revisit starts informed rather than from zero.

- **License.** NLLB-200 is CC-BY-NC-4.0. Sokuji is a commercial product. The repo
  has a non-commercial consent gate, but only in the native sidecar lane
  (`nativeCatalog.ts` `license.nonCommercial` → `LicenseConsentModal` →
  `licenseConsentStore`). The WASM lane has no `license` field on
  `ModelManifestEntry` and no gate in `ModelManagementSection.tsx`. Porting it
  would have been required. This is a flag, not legal advice.
- **Size.** The q8 file set is ~917 MB: `encoder_model_quantized.onnx`
  419,120,483 B + `decoder_model_merged_quantized.onnx` 475,505,771 B +
  `tokenizer.json` 17,331,224 B + `sentencepiece.bpe.model` 4,852,054 B + configs.
  q8 is the *smallest* export — the 256k embedding is ~262M parameters and only
  int8 touches it, so the q4f16 encoder alone (612 MB) is larger than the entire
  q8 encoder.
- **Language codes.** NLLB uses script-qualified FLORES-200 codes. The tokenizer
  exposes 202; `eng_Latn`, `jpn_Jpan`, `zho_Hans` and `xho_Latn` were all
  confirmed present, and the zh family is `zho_Hans` / `zho_Hant` / `yue_Hant`.
  Sokuji has a single `zh` with no script variant, so a mapping decision would
  have been needed.
- **A new worker type.** `translation.worker.ts` accepts `sourceLang` and
  `targetLang` and explicitly ignores them (lines 29 and 38, "ignored by
  Opus-MT"); it never forwards them to the pipeline. NLLB could not have reused it.
- **Sentence splitting.** Would have been mandatory given the multi-sentence
  dropping — though it would not have fixed truncation, degeneration, or the
  meaning errors.
