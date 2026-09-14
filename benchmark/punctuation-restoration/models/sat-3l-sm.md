# sat-3l-sm (Segment any Text) on onnxruntime-web

`segment-any-text/sat-3l-sm` is wtpsplit's 3-layer XLM-RoBERTa sentence segmenter. The `-sm` variant
has one output label, "a sentence ends after this subword", and is trained to work without
punctuation or casing. It inserts no marks, so the benchmark scores it on boundaries only.

- Module: `models/sat-3l-sm.mjs` (`output: 'boundary'`, langs `ja zh en ko`; the model itself
  covers 85 languages, the list is the benchmark's).
- Model licence: MIT (model card). Code ported: wtpsplit 2.2.1, MIT.
- Files the module reads: `model.onnx` and `tokenizer.json` from
  `/home/jiangzhuo/.cache/sokuji-punct-bench/sat/sat-3l-sm/`. `model.onnx` is a symlink to the
  published fp16 export (see "Weights"). `tokenizer.json` is `FacebookAI/xlm-roberta-base`'s.
- Extra exports for parity and tuning: `predict(text, opts)` (per-character probabilities and ids),
  `split(text, opts)` (wtpsplit's segment list), `tokenizeWithEnds`, `sentencesFrom`,
  `joinSegments`, `DEFAULTS`.

## What the port does

It reproduces `SaT("sat-3l-sm", ort_providers=[...]).split(text)` with default arguments.

**Tokenization.** xlm-roberta-base, no special tokens, `return_offsets_mapping=True`. The
`@huggingface/tokenizers` JS library returns ids but no offsets, so the module rebuilds the Rust
offsets from the library's own normalizer and Unigram model:

1. Split the text into grapheme clusters (`Intl.Segmenter`). A cluster shorter than 6 UTF-8
   bytes is normalized as a whole; a longer one code point by code point. This is the Rust
   `Precompiled` normalizer's rule, and it matters: half-width `ﾃﾞ` is 6 bytes, so it is not
   composed into `デ`, and each emoji of a ZWJ sequence keeps its own offset.
2. Within a normalized piece of m code points, output character k aligns to input code point
   min(k, m − 1). This matches Rust's `replace()` bookkeeping: a composition lands on the first
   input character, an expansion (`㍿` → `株式会社`) repeats it.
3. Split on whitespace, prefix U+2581, and run `tokenizer.model` once per word. The model returns
   literal slices, `<unk>` runs included, so piece lengths give the offsets. The prefix aligns to
   the word's first character.

A token's offset end − 1 is the character that receives its logit. A later token ending on the
same character overwrites the earlier one (numpy assignment order). Every other character gets
−inf, which is probability 0. Offsets are code points, like Python string indices.

**Windowing** (`wtpsplit.extract.extract`):
- The window size is block = min(512, n) subwords, capped at 510 to leave room for `<s>` and
  `</s>`.
- Windows start at 0, 64, 128, …. The first window that would reach the end is right-aligned to
  the end instead, and it is the last window.
- Windows run in batches of 32. Logits are summed with uniform weights and divided by the
  per-subword count.
- wtpsplit does this summing and averaging in **float16** numpy buffers. The module emulates it
  exactly (`f16round(fround(a + b))`, `f16round(fround(a / c))`), so a boundary decision never
  depends on rounding.
- `split()` uses stride 64 by default. `predict_proba()` defaults to 256, so the parity script
  calls it with `stride=64`.

**Decision.** Probability = sigmoid, computed in float32. A boundary after character i when
p > **0.25**. `SaT._split.get_default_threshold` picks 0.25 whenever the string `"sm"` occurs in
the model name. It is a substring test on whatever was passed, including a local path. A LoRA
model gets 0.5, a `no-limited-lookahead` non-sm model 0.01, and anything else 0.025. This port
reports 0.25 and does not tune it.

**Segments.**
- `indices_to_sentences`: a segment ends at i + 1 plus any following whitespace, as defined by
  Python `str.isspace`.
- `split_on_input_newlines=True`: input newlines are always cuts.
- The contract output joins the segments with `\n`, dropping the one space left at the end of a
  cut segment. It keeps every other input character in order: `parity/sat-3l-sm.compare.mjs`
  checks this on all rows.

Empty or whitespace-only input comes back unchanged, and nothing reaches the model.

**Knobs** (`split`/`predict` options; `punctuate` always uses the defaults): `threshold`,
`stride`, `blockSize`, `batchSize`. Not ported:
- `weighting="hat"`;
- `remove_whitespace_before_inference`;
- length-constrained segmentation (`min_length`/`max_length`, Viterbi with priors);
- paragraph mode (with one label, paragraph and sentence probabilities are the same array).

wtpsplit's list mode sizes the window by the longest text in the list and pads the rest, so a
text's result depends on its batch-mates. The module segments one text at a time, which is what
the reference does for a single string.

## Weights

| file | bytes | RSS after load / after 11 calls (MB, Node, GC'd) | used |
|---|---:|---:|---|
| `model_optimized.onnx`, published fp16 (sha256 `8573277b…`) | 427,756,189 | 2,403 / 1,831 | **module default** |
| `model_fp32.onnx`, fp16 → fp32 rewrite (ours) | 855,082,196 | 4,355 / 2,948 | parity only |
| `model_int8.onnx`, `quantize_dynamic` (ours) | 214,243,815 | 1,355 / 1,258 | rejected |
| `ModelCloud/sat-3l-sm-int8-onnx` `model.onnx` (no licence metadata) | 214,691,162 | 1,387 / 1,192 | comparison |
| `tokenizer.json` (xlm-roberta-base) | 9,096,718 | | |

- All four load and run on ORT-web 1.26 WASM.
- Node's own RSS before loading is 54 MB.
- `graphOptimizationLevel: 'disabled'` changes neither memory (fp16 2,349 / 1,831) nor latency.

**fp16 runs on WASM, but not as fp16.**
- The published graph takes an `attention_mask` float16 input and returns float16 `logits`.
- Node 22 has no `Float16Array`, so the module passes the mask as raw half bits (`Uint16Array`,
  1.0 = `0x3c00`) and decodes the output bits itself. Browsers with `Float16Array` get one from
  ORT-web, and the module takes both.
- The WASM CPU EP has almost no float16 kernels. Its verbose log shows `CastFloat16Transformer`
  and `FuseFp16InitializerToFp32NodeTransformer` rewriting the graph: the MatMul weights, biases
  and position/token-type embeddings are replaced by float32 copies. The graph then runs in
  float32, which is why a 428 MB file needs 2.4 GB RSS at load.
- The Python reference on this aarch64 box behaves differently. ORT 1.30's profile shows native
  float16 kernels for MatMul (×25), SkipLayerNormalization (×6), LayerNormalization, Add, Div and
  Sub, with only BiasGelu cast to float32. The official reference therefore computes in genuine
  fp16, while the browser computes in fp32 from the same file. The reference itself is
  platform-dependent: its own fp16 and fp32 runs disagree on 4 of 270 rows, max |Δp| 0.045.

**fp32** (`convert_sat.py` in the job scratch: every FLOAT16 initializer, Constant,
ConstantOfShape value, I/O type and Cast target rewritten to FLOAT):
- The published graph lacks an opset import for `com.microsoft`, although it uses
  SkipLayerNormalization and BiasGelu. ORT does not care, but `onnx.checker` rejects it, so the
  rewrite adds the import.
- Its weights carry the fp16 rounding of the export. The true fp32 checkpoint is only on the Hub
  as safetensors.
- On WASM it makes exactly the same segmentation decisions as the fp16 file on all 270 rows, at
  twice the size and ~1.8× the load-time RSS.

**int8** (`quantize_dynamic`, `per_channel=True`, `QInt8`, `op_types_to_quantize=[MatMul, Gather]`,
`extra_options={"DefaultTensorType": FLOAT}`):
- The extra option is needed because shape inference cannot type the outputs of the contrib ops.
- The quantizer keeps the embedding table UINT8 per-tensor and dequantizes after the Gather, so
  the 250k × 768 table stays one byte per weight at run time. MatMul weights are INT8 per-channel,
  run through MatMulInteger with DynamicQuantizeLinear.
- ModelCloud's file has the same structure, quantized from the unoptimized `model.onnx` (Erf and
  LayerNormalization instead of the fused ops).
- Both int8 builds move boundary probabilities by up to 0.46–0.66 and change the segmentation of
  12–16 % of rows against the official reference. They are only ~17 % faster than fp16. So the
  module keeps the fp16 file: it is the smallest build whose decisions match the reference.

## Parity

Setup:
- `parity/sat-3l-sm.rows.mjs` builds 270 rows: 244 corpus inputs (a snapshot of
  `results/inputs.json` taken at 15:20; the corpus grew afterwards), 12 long rows and 14 edge rows.
- The corpus tops out at 65 subwords, so it never reaches the windowing. The long rows are
  concatenations of 433–4,305 subwords, that is 1–61 windows.
- The edge rows cover: non-BMP characters, a ZWJ emoji, a combining acute, NFKC-expanding
  characters, half-width kana with an ideographic space, a U+FF5E tilde, control characters,
  newlines, leading/trailing/whitespace-only/empty input, CJK extension-B characters, and mixed
  zh/en.
- `parity/sat-3l-sm.reference.py` runs wtpsplit 2.2.1's own `SaT.split` and
  `predict_proba(stride=64)`, one row at a time, under onnxruntime 1.30 CPU on aarch64.
  - `fp16` is the unmodified `SaT("sat-3l-sm", ort_providers=["CPUExecutionProvider"])`.
  - The other variants only swap the session.
- `parity/sat-3l-sm.compare.mjs` runs the module on ORT-web 1.26 WASM with one thread.
- Results: `results/parity-sat-3l-sm.ref-<v>.json` (reference) and
  `results/parity-sat-3l-sm-<v>.json` (JS).

**Tokenizer:** all 270 rows (27,480 subwords) give the same ids as Python. Offset ends match on
269 of the 270 rows. The exception is edge-6, explained under the first diffs.

Split exact match is the share of rows whose segment lists are identical. Decision flips count
characters where exactly one side has p > 0.25. Max |Δp| excludes edge-6.

| JS (WASM) | Python reference | split exact match | decision flips | rows bit-exact | max \|Δp\| |
|---|---|---:|---:|---:|---:|
| fp16 | **fp16 (official)** | **98.1 % (5 rows differ)** | 6 | 2 | 4.5e-2 |
| fp16 | fp32 | 99.6 % (1) | 2 | 6 | 1.7e-3 |
| fp32 | fp32 | 99.6 % (1) | 2 | 248 | 1.0e-4 |
| fp32 | fp16 (official) | 98.1 % (5) | 6 | 2 | 4.5e-2 |
| int8 | int8 | 93.7 % (17) | 36 | 143 | 0.25 |
| int8 | fp16 (official) | 87.8 % (33) | 68 | 2 | 0.46 |
| mc-int8 | mc-int8 | 94.4 % (15) | 40 | 121 | 0.25 |
| mc-int8 | fp16 (official) | 84.4 % (42) | 115 | 2 | 0.66 |

**All diffs, JS fp16 against the official reference** (there are only five):

| row | subwords | character | JS p | Python p | cause |
|---|---:|---|---:|---:|---|
| long1-ja | 579 | 353 `ん` | 0.2478 | 0.2518 | fp16 vs fp32 compute |
| long3-zh | 4,305 | 4400 `念` | 0.2515 | 0.2473 | fp16 vs fp32 compute |
| long3-en | 2,007 | 7631 `m` | 0.2504 | 0.2480 | fp16 vs fp32 compute |
| long3-ko | 1,309 | 1854 `가` | 0.2552 | 0.2467 | fp16 vs fp32 compute |
| edge-6 | 4 | 18 `r` / 19 `e` | 0 / 1.0 | 1.0 / 0 | reference offset bug |

- **The four long rows.** In each flip both probabilities are within 0.006 of the threshold, and
  all four vanish against the fp32 reference. They come from the reference running native fp16 kernels on aarch64 while
  WASM runs float32 (see Weights).
- **edge-6 (`\x01control\x07 chars here`)** is a bug in the Hugging Face tokenizers `Precompiled`
  normalizer, not in the port. `replace()` records a removed character's alignment on the
  previous output character. The leading U+0001 has no previous character, so its removal is lost
  and every later offset in the string shifts one to the left. Python therefore puts the last
  token's logit on `r` and cuts `…her | e`; the module puts it on `e`.
  - This only happens when the normalizer deletes the first character of the input (control
    characters). The module deliberately does not replicate it.
- **JS fp32 against Python fp32.** 248 rows are bit-exact. 21 more rows differ by at most 1.0e-4,
  from float32 kernel differences between MLAS NEON and WASM SIMD. Only edge-6 changes a
  decision.
- **int8 against its own reference** differs on 17 rows because the MatMulInteger and
  DynamicQuantizeLinear kernels differ between the two runtimes. The same pipeline is bit-exact
  on fp32, so it is not the port. The flips are 0.20–0.32 against 0.25; the first ones:
  - `gl-gui-L3383-p4` `了` 0.268 / 0.237;
  - `gl-gui-L3400-p1` `机` 0.217 / 0.270;
  - `ko-questions-02` `요` 0.237 / 0.253;
  - `long1-ja` `ー` 0.223 / 0.254;
  - `long1-zh` `吗` 0.244 / 0.258.

## Latency

Node 22, ORT-web 1.26 WASM, one thread, GB10 (aarch64) shared with other benchmark jobs, so the
numbers are indicative. Median of 15 calls per point, tokenization included (1.4–2.5 ms at
256 subwords). Cost depends only on the subword count. 256 subwords is 529 characters of ja,
420 of zh, 1,205 of en and 571 of ko.

| file | load | 64 subwords | 128 | 256 |
|---|---:|---:|---:|---:|
| fp16 | 1.8–1.9 s | 56–57 ms | 111–112 ms | 225–228 ms |
| fp32 | 2.7–3.0 s | 55 ms | 107–108 ms | 216–217 ms |
| int8 | 1.4–1.7 s | 47–48 ms | 92–93 ms | 188–189 ms |
| mc-int8 | 1.3–1.5 s | 47 ms | 92–93 ms | 187–189 ms |

The first call at 128 subwords takes 125–148 ms, so there is little warm-up.

**Past one window the cost jumps**, because stride 64 means n > 510 subwords needs
⌈(n − 510) / 64⌉ + 1 full 510-subword windows (fp16):

| subwords | windows (stride 64) | ms | windows (stride 256) | ms |
|---:|---:|---:|---:|---:|
| 510 | 1 | 492 | | |
| 511 | 2 | 984 | | |
| 574 | 2 | 987 | | |
| 1,020 | 9 | 4,483 | 3 | 1,486 |
| 2,000 | 25 | 12,325 | 7 | 3,435 |

For streaming, keep the model input under 510 subwords (a trailing context window). Raising
`stride` changes results away from the reference.

`node eval-quality.mjs --models sat-3l-sm --no-stream` runs with this module. The output went to
`results/parity-sat-3l-sm-quality.json`, to stay inside this port's file names. Its numbers are
not part of this report. One thing worth passing on: English boundary F1 drops from 98.6
(`stripped`, cased) to 64.6 (`lower`), so the model leans on casing.

## ORT-web notes

- Every op, including the `com.microsoft` SkipLayerNormalization and BiasGelu, has a WASM kernel.
  All three dtypes load and run with no errors.
- The module reads `session.inputMetadata` to pick the mask dtype: float16 for the published
  graph, float32 for the fp32/int8 rewrites.
- WASM is 32-bit, with a 4 GB heap:
  - The fp32 file reaches 4.36 GB RSS in Node while loading, which is not viable in a renderer.
  - The fp16 file reaches 2.4 GB, because ORT upcasts its weights (see Weights).
  - int8 stays at ~1.3 GB but fails parity.

## LoRA for ASR-style text

- wtpsplit publishes `loras/ted2020-corrupted/{en,ja,ko,zh}`, but for `segment-any-text/sat-3l`,
  not `sat-3l-sm`. The sm repo has no `loras/` folder. "TED" is the paper's ASR-style
  transcribed-speech domain, and "corrupted" is the lowercased, punctuation-stripped variant, which
  is the style of our input.
- Each adapter is LoRA r = 16, α = 32 on attention q/v plus the intermediate layers. It is a
  1,333,391-byte `pytorch_adapter.bin` plus a 342,547-byte head with 111 labels (label 0 is the
  newline).
- The base `sat-3l` differs from `-sm`: its config has `lookahead: 48`, while sm's is `null`.
- A LoRA model's default threshold is 0.5.
- The README's English/multilingual macro F1 is 96.7/94.8 for `sat-3l-lora` against 96.5/93.5
  for `sat-3l-sm`, averaged over all its datasets. The casing dependence above is the case where
  the "corrupted" adapters should matter most. Whether they are needed is a question for the
  corpus scores.

**Usability from ONNX:**
- There is no runtime path. `SaT(..., ort_providers=..., lora_path=...)` raises.
- The documented route is `scripts/export_to_onnx_sat.py --use_lora --style_or_domain
  ted2020-corrupted --language <lang>`. It merges the adapter into the PyTorch weights (needs
  torch and the `adapters` library) and exports a complete fp16 graph with 111-label logits.
- That means one ~428 MB model per language, four for ja/zh/en/ko, of which ~90 % is the same
  250k × 768 embedding table.
- Sharing the table would need a custom export (base graph plus per-language q/v/intermediate
  deltas). wtpsplit does not provide one.

## Reproduce

```sh
node tools/dump-inputs.mjs
node parity/sat-3l-sm.rows.mjs
~/.cache/sokuji-punct-bench/venv-sat/bin/python parity/sat-3l-sm.reference.py fp16 fp32 int8 mc-int8
node parity/sat-3l-sm.compare.mjs --variant fp16 --bench   # likewise fp32, int8, mc-int8
node eval-quality.mjs --models sat-3l-sm --no-stream --out results/parity-sat-3l-sm-quality.json
```

The venv is `uv venv --python 3.12` plus `wtpsplit onnxruntime onnx onnxconverter-common`.
wtpsplit must be imported before transformers: skops walks transformers' lazy modules at import
time and trips over the missing torch otherwise. The fp32 and int8 builds come from
`convert_sat.py` and `convert_sat_int8.py` in the job scratch (`tmp/`, `tmp/sat/`), and the
ModelCloud file from `hf download ModelCloud/sat-3l-sm-int8-onnx`.
