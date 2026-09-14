# Mojicast punctuation BERT (ja): `mojicast`, `mojicast-fp32`

Japanese 、 and 。 restoration, ported from the Mojicast streaming-caption app
([ishiki-emo/mojicast](https://github.com/ishiki-emo/mojicast) @d06ddb9f, `punct.py`).
Model: [ishiki-emo/mojicast-punct-onnx](https://huggingface.co/ishiki-emo/mojicast-punct-onnx)
@6bef4454, which is tohoku-nlp/bert-base-japanese-char-v3 with bobfromjapan/bert_japanese_punctuation's
2-way linear head, exported to ONNX (Apache-2.0).

| module | file | bytes |
|---|---|---|
| `mojicast` (the app default) | `punct_bert.int8.onnx` | 109,150,947 |
| `mojicast-fp32` (the app's 高精度モード, and its automatic fallback) | `punct_bert.onnx` | 363,501,157 |
| both | `vocab.txt` (7,027 entries, one per character) | 27,928 |

ONNX interface: `input_ids`, `attention_mask` int64 `[b, s]` → `logits` float `[b, s, 2]` over the
whole sequence including the [CLS] and [SEP] rows; column 0 is 、, column 1 is 。, independent
logits (sigmoid, not softmax). The int8 file is `quantize_dynamic(QInt8, MatMul only,
per_channel=True, MatMulConstBOnly)` (`tools/convert_models.py quantize_punct`); embeddings stay fp32.
Mojicast's own bench says per-tensor quantization dropped decision agreement with fp32 to 50.3%.

## Production inference, as ported

- **Input cleanup:** every 、 and 。 is removed. That is all: no NFKC, no lowercasing. A space is
  an ordinary token (the vocab has one), and ASCII or full-width ？！ stay as characters.
- **Tokens:** one per code point, looked up in `vocab.txt`; unknown → [UNK] (id 1). The sequence
  is `[CLS] chunk [SEP]`, attention all ones, batch 1.
- **Windowing:** non-overlapping 256-character chunks, each run on its own. No overlap and no carried context.
- **Decode:** sigmoid per character. `。` if p(。) > 0.1, else `、` if p(、) > 0.1; the period wins
  a tie of both. The mark goes after the character.
- **Post-fix** `_NUM_PUNC_FIX`: removes a mark between a digit and a counter
  (`(\d)[、。](?=[年月日時分秒歳才人個円回本枚台匹冊話曲位点倍万億兆つ杯件番週%％])`).
  Python `\d` is any Unicode Nd digit; the port uses `\p{Nd}`.
- **Guard** `_looks_broken`: if at least 3 marks were added and added × 2 > length, return the
  cleaned text unmarked. An empty result also returns the text.
- **Load self-test:** `_punctuate_raw("これはてすとです")` must be non-empty and not "broken",
  else `SelfTestFailed`. The engine then reloads fp32 and shows a warning.
  - *Why it exists:* int8 on x86 CPUs without VNNI (reported on i9-9900K and i9-10900K)
    saturates int16 sums. Outputs collapse to ~0, sigmoid(0) = 0.5 clears the 0.1 threshold on
    every character, and the caption becomes あ。い。う。
  - *Port:* `create()` throws an `Error` named `SelfTestFailed`; it does not fall back to fp32
    itself (that is the separate `mojicast-fp32` id).
- **No ？ or ！:** the model has two classes and no rule adds a question mark.
- **Knobs** (defaults kept, not tuned):
  - `comma_thresh` 0.1, `period_thresh` 0.1, `max_length` 256;
  - precision int8 (default) or fp32 (高精度モード);
  - on/off (設定 → その他 → 字幕処理 → 句読点を付ける);
  - session: 4 intra-op threads, `allow_spinning=0`.

### When the app runs it (engine.py): finals only

```
mic → Silero VAD → ReazonSpeech k2 (full utterance) → hotword replacer → numnorm (三十五→35)
    → punct → banned-word mask → on_final → translation
```

- **Only VAD-closed utterances are punctuated.** The VAD is Silero at threshold 0.5,
  `silence_ms` 300, and `max_utt` 12 s forces a flush.
- **Partials are never punctuated.**
  - When: every `interval` 0.4 s, adaptively slowed to at most 50% of CPU.
  - What: they decode only the last 6 s, marked with a leading "…" when truncated.
  - `final_only` switches them off.
- **Punctuation is skipped** when the ASR has built-in punctuation (SenseVoice), and the BERT is unloaded.
- **The translator receives the punctuated final.**

### Design evidence the Mojicast author recorded (ROADMAP §14, 2026-08-22)

- **Tail bias.** The training data were always complete sentences, so the model learned
  "just before [SEP] = sentence end". It does not check whether the sentence is complete:
  - the same position's 。 probability is 0.971 at the end of 「ここでちょっと」, and 0.000 once
    「休憩しますね」 is appended;
  - a fragment scores higher than a finished 「わかりました」 (0.939);
  - fragments and complete sentences cannot be separated by threshold (50%).
- **VAD cuts at 300 ms breaths, not sentence ends,** so line-final 。 is structural.
  - Over 21 consecutive stream lines: 21 line-final 。, 1 internal 。, 0 、.
  - In short-segment use the feature is effectively "append 。 at line end".
- **Tried and rejected:**
  - appending a dummy word 「そして」: 85% discrimination, but it feeds words the speaker did not say;
  - dropping [SEP]: 70–80%;
  - appending [MASK]×8: 75%.
  - The author's proposed direction: do not emit the line-final 。, and let the line break be the
    delimiter. A linked note, "the 、 cannot be improved", is not in the public repo.
- **int8 vs fp32 on 1,043 real stream lines:** 90.0% identical; 。 856 → 759. int8 almost only *drops* 。.

## Parity

Reference: Mojicast's `punct.py` imported unmodified (`parity/mojicast.py`), Python onnxruntime
1.30.0 CPU EP, 4 threads, on this aarch64 box. The JS modules run on onnxruntime-web 1.26 WASM with 1 thread
(`parity/mojicast.mjs`). Rows: the 51 ja rows of `results/inputs.json` (24 stripped, 24 commas, 3 raw).
Results: `results/parity-mojicast-python.json`, `results/parity-mojicast.json`.

| | text exact | max \|Δp\| | threshold flips |
|---|---|---|---|
| fp32, JS vs Python | 51/51 | 5.0e-6 | 0 |
| int8, JS vs Python | 49/51 | 0.246 | 1 position (in 2 rows) |

- **The int8 flip:** `ja-mixed-01` (stripped and commas), 。 after 「ここまでです」: p = 0.163 in WASM,
  0.073 native. That gives 「ここまでです。Thank you for watching…」 in JS against
  「ここまでですThank you for watching…」 in Python.
  - The int8 kernels are not numerically identical between onnxruntime-web WASM and native aarch64 ORT.
  - int8 decisions near the threshold therefore depend on the runtime; fp32 does not.
- **int8 vs fp32, at the mark level** (marks placed by both / only fp32):

  | runtime | text exact | both | only fp32 | only int8 or different mark |
  |---|---|---|---|---|
  | JS | 50/51 | 147 | 1 | 0 |
  | Python | 48/51 | 145 | 3 | 0 |

  As in the Mojicast README, int8 only loses marks.
- **Self-test:** the probe passes under WASM int8 (「これはてすとです。」). The WASM int8 path is
  MLAS's portable wasm kernel rather than a host-specific one, so the VNNI saturation should not
  apply in a browser. That was verified on this host only.
- **Every output keeps the input skeleton** (letters/digits in order): 51/51 at both precisions.

## Port notes and deviations

- **Behaviour is a straight port** of `add_punctuation`, `_punctuate_raw`, `_looks_broken`,
  `_NUM_PUNC_FIX` and the self-test.
  - Vocab parsing mirrors Python text-mode iteration: only `\n` stripped, no phantom last line, later duplicates win.
  - The sigmoid is computed in float64 where numpy uses float32; no effect was seen (fp32 parity 51/51).
- **Not ported:** numnorm, the hotword replacer and banned-word masking. They run around punct in
  the app, but numnorm and the replacer rewrite letters, which the benchmark contract forbids.
  Consequence: `_NUM_PUNC_FIX` only sees digits the ASR already wrote as digits.
- **The "commas" variant:** the 、 in the input is removed and re-predicted, exactly as
  production does. ASCII `,` is not removed.
- **Extras on the returned object** (parity helpers): `inspect(text)` returns cleaned text, the raw
  decision, per-character probabilities and the guard result; `probe` is the self-test output.
- **onnxruntime-web:** no op problems. Both graphs (MatMulInteger, DynamicQuantizeLinear, GatherND,
  IsNaN, Range, …) load and run on the WASM EP.
- **Runner caveat:** `eval-quality.mjs` warms up with `items[0]` in whatever language it is (currently
  en), so a ja-only module throws "unsupported language" there, as the contract requires.
  - A scratch copy of the runner that warms up on the first supported item runs `mojicast` and
    `mojicast-fp32` cleanly (51 ja calls each, no skeleton mismatches).
  - Indicative, ja/stripped: boundary F1 87.8, comma F1 16.2 for both precisions.

## Latency (Node, onnxruntime-web WASM, 1 thread)

`parity/mojicast-latency.mjs` → `results/parity-mojicast-latency.json`.

- **What is timed:** `punctuate()` end to end, median of 20 calls after 3 warm-ups, on one
  Japanese chunk. The sequence length counts [CLS] and [SEP].
- **Machine:** this aarch64 GB10 box, shared with other benchmark jobs (1-minute load average
  about 4.8 during the run). The p10–p90 spread was under 1%.

| module | seq 64 | seq 128 | seq 254 | session load |
|---|---|---|---|---|
| `mojicast` (int8) | 182 ms | 363 ms | 746 ms | 536 ms |
| `mojicast-fp32` | 211 ms | 419 ms | 852 ms | 846 ms |

- **Cost is linear in length:** about 2.9 ms per token for int8 and 3.3 ms per token for fp32 on one
  WASM thread. A typical 30–60 character final costs roughly 100–180 ms per call.
- **int8 buys only about 14% speed in WASM.** Mojicast measured about 2× natively, with 4 threads
  on x86 (5 vs 11 ms per line).
- **These are single-thread numbers.** The app itself uses 4 intra-op threads, and a renderer can
  use WASM threads when cross-origin isolated.

## Things that look wrong or matter for Sokuji

- **Line-final 。 carries no sentence-boundary information** (tail bias, above). For VAD- or
  chunk-cut Sokuji segments, only *internal* marks are evidence.
- **Chunks are 256 characters with no overlap:** the character before each chunk's [SEP] inherits
  the tail bias. It only matters above 256 characters, which the app's 12 s utterance cap rarely reaches.
- **Existing ？/！ are not stripped,** so the model can add 。 after them: fp32 gives
  「こんにちは!。」 on a raw row.
- **The failure mode is "mark everything":** the 0.1 threshold on sigmoid(≈0) = 0.5. The guard and
  self-test exist for that; keep them if this model ships.
- **No ？ class, and comma recall is structurally low** (see ROADMAP §14 and the eval's comma F1).
