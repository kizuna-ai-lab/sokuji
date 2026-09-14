# koen-punct — `whooray/koen_punctuation`

A Korean + English punctuation restorer: `Alibaba-NLP/gte-multilingual-mlm-base` (mGTE, 12-layer
768-wide encoder with RoPE and a gated MLP, XLM-R's 250k vocabulary) fine-tuned as a 5-way token
classifier — none, `,`, `.`, `?`, `!`. One pass, no casing and no boundary head: a sentence
boundary is a `.`/`?`/`!`. 305,372,165 parameters, of which 192M are the word-embedding table.

| module | graph | notes |
| --- | --- | --- |
| `koen-punct` | `model.int8.onnx` | int8 MatMul + Gather, 311 MB |
| `koen-punct-fp32` | `model.onnx` | fp32 export, 1.23 GB, quality reference |

Both share `models/koen-punct-core.mjs`. `langs: ['ko', 'en']` (the upstream package README lists
"English, Korean"; its card examples are one of each). Other languages throw.

## Discovery (2026-09-14)

Searched: the HF model API (`search=` punct/punc/punctuator/korean-punct/ko_punct/koen/sentence-split/
spacing/sbd…, `language=ko&pipeline_tag=token-classification`), GitHub repository search (English and
Korean queries), and web search. Korean-specific punctuation models are almost absent from public hubs.

| model | license (exact) | size | labels | last update | downloads | published metrics | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **whooray/koen_punctuation** | `apache-2.0` (card front matter) | 305M params, 1.22 GB safetensors | none `,` `.` `?` `!` (token-level) | 2025-03-10 | 28 | on its own eval set (dataset undisclosed, ko+en mixed): acc 0.980; F1 `,` 0.827, `.` 0.922, `?` 0.832, `!` 0.556 (P 1.0 R 0.385) | **ported** — the only Korean-targeted, permissive, single-pass model found |
| 1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase (PCS-47) | `apache-2.0` | ~278M, 1.11 GB onnx | pre/post punct, truecase, SBD | 2023-07-15 | 312,893 | no Korean numbers | already ported (`pcs47`) |
| 1-800-BAD-CODE/punct_cap_seg_47_language | `apache-2.0` | 233 MB onnx, 64k unigram | punct, truecase, SBD | 2023-06-14 | 39,871 | no Korean numbers | older/smaller sibling of PCS-47, multilingual, not Korean-specific |
| 1-800-BAD-CODE/sentence_boundary_detection_multilang | `apache-2.0` | 36 MB onnx (bert-small) | boundary only | 2023-05-25 | 25 | — | boundaries only, 49 langs incl. ko; no marks |
| segment-any-text/sat-* | `mit` | sat-3l-sm 214M | boundary only | 2024-09-24 | 510,523 | — | already covered (SaT), no marks |
| CheonggyeMountain-Sherpa/kogpt-trinity-punct-wrapper | `cc-by-nc-sa-4.0` | Ko-GPT-Trinity 1.2B | generative | 2021-12-22 | 0 | — | excluded: non-commercial, autoregressive, 1.2B |
| sangmini/sentence_split_mini_kobart-base-v2 | none declared | KoBART base | seq2seq split | 2023-03-27 | 7 | — | excluded: no license, autoregressive |
| sheldonlidev/korean-classical-chinese-punctuation (also yachagye/…, no license) | `apache-2.0` | 434 MB onnx, RoBERTa | classical-Chinese 標點 | 2026-01-11 | 3 | — | excluded: Classical Chinese text in Korean archives, not modern Korean |
| noticemkjung/korean-spacing-ONNX (base fiveflow/roberta-base-spacing) | `apache-2.0` (base: none declared) | 111 MB q8 | word spacing | 2026-08-22 | 45 | — | not punctuation |
| kredor/punctuate-all, oliverguhr/fullstop-* | `mit` | xlm-r base/large | `.` `,` `?` `-` `:` | 2023–2024 | high | European langs | no Korean in training |

Why koen_punctuation: it is the only candidate trained with Korean in the target set that is
permissive, under 350M, and single-pass; everything else Korean-specific is non-commercial,
autoregressive, a different task (spacing, classical Chinese), or unlicensed. It is a genuinely
different comparison point from PCS-47: different base (mGTE vs XLM-R), a label set aimed at
spoken text ("Punctuation restoration for spoken language"), and no casing/boundary heads.

Caveats worth knowing before relying on it: 28 downloads and 1 like, a Trainer auto-generated card
("fine-tuned … on the None dataset"), training data undisclosed, eval metrics are on an undisclosed
ko+en mix with no per-language split. The inference package `spokentxt-punctuation-restoration` on
PyPI declares no license (its logic is re-implemented here, not copied as a dependency).

## Files

`/home/jiangzhuo/.cache/sokuji-punct-bench/ko/koen_punctuation/`

| file | bytes |
| --- | --- |
| `src/model.safetensors` (upstream) | 1,221,503,956 |
| `model.onnx` (fp32 export) | 1,226,067,261 |
| `model.int8-matmul.onnx` | 887,115,233 |
| `model.int8.onnx` | 311,003,266 |
| `tokenizer.json` (copy of `src/tokenizer.json`) | 17,082,734 |

`src/` holds the pinned snapshot (`README.md`, `config.json`, `tokenizer*.json`,
`special_tokens_map.json`, `model.safetensors`) and `src/new-impl/` the pinned custom code
(`modeling.py` sha256 `374670b4…50a0`, `configuration.py` sha256 `34110880…4fe4`).

## Export (exact steps)

Pins: `whooray/koen_punctuation@5c132a5cefa058c38b9f40006effa2da6f0c1d4d`, custom code
`Alibaba-NLP/new-impl@40ced75c3017eb27626c9d4ea981bde21a2662f4`. The card's `auto_map` points at
`Alibaba-NLP/new-impl--modeling.NewModel`; transformers 4.49 fetches that from `main` unless
`code_revision` is passed (`dynamic_module_utils.py` only defaults it to `revision` when the code lives
in the model's own repo), so every load passes `code_revision=40ced75…` and the scripts refuse to run
if the loaded `modeling.py` hash differs. The code was read before running: plain PyTorch (RoPE, packed
qkv, gated GELU MLP, optional xformers not installed), no network or file access.

```sh
uv venv --python 3.12 /home/jiangzhuo/.cache/sokuji-punct-bench/venv-ko
uv pip install --python /home/jiangzhuo/.cache/sokuji-punct-bench/venv-ko/bin/python torch "transformers==4.49.0" onnx onnxruntime onnxscript huggingface_hub safetensors numpy
# → torch 2.14.0, transformers 4.49.0 (the card's 4.49.0.dev0), onnx 1.22.0, onnxruntime 1.30.0
# snapshot: curl .../whooray/koen_punctuation/resolve/<REV>/<file> and .../Alibaba-NLP/new-impl/resolve/<CODE_REV>/<file>
/home/jiangzhuo/.cache/sokuji-punct-bench/venv-ko/bin/python parity/koen-punct-export.py
```

`parity/koen-punct-export.py`:

1. Loads the model with `attn_implementation="eager"` and exports `input_ids`/`attention_mask`
   (int64 `[B, T]`, both axes dynamic) → `logits` (float32 `[B, T, 5]`) with the TorchScript exporter
   (`dynamo=False`, opset 17, constant folding). No `token_type_ids` input: upstream's tokenizer does not
   return them and the single type embedding is added as a constant lookup.
2. Checks the fp32 graph (onnxruntime CPU) against the upstream PyTorch model at its default sdpa
   attention: max |Δlogit| 6.9e-6 (T=3), 8.5e-6 (T=28), 1.3e-5 (T=442); argmax identical.
3. `quantize_dynamic(per_channel=True, weight_type=QInt8)` twice, no pre-processing pass:
   - `op_types_to_quantize=["MatMul"]` → `model.int8-matmul.onnx`: 49 of 73 MatMul → MatMulInteger
     (12 × qkv/o/up_gate/down + classifier); the other 24 multiply two activations.
   - `["MatMul", "Gather"]` → `model.int8.onnx`: the same plus the word- and token-type embedding Gathers
     (+2 DequantizeLinear). **The embedding table came out UINT8 with a per-tensor DequantizeLinear (no
     `axis`)**, not per-channel QInt8 — onnxruntime's Gather path ignores both options here. The RoPE
     cos/sin tables are sliced before their Gather, so they stay fp32.

## Tokenizer

`tokenizer.json` (XLM-R sentencepiece unigram, 250,002 pieces; `Precompiled` normalizer; `WhitespaceSplit`
+ `Metaspace` pre-tokenizer; `<s> A </s>` template) loaded with `@huggingface/tokenizers` 0.1.3,
config `{}`. Verified against the Python `XLMRobertaTokenizerFast` (`tokenizers` 0.21.4) on all 114
parity rows — every ko and en row of `results/inputs.json` (40 ko, 72 en) plus the two `long` rows —
with special tokens: **0 id mismatches**. No row normalizes differently from its input and none
produces `<unk>`. Probed separately: `ＡＢＣ１２ ﾊﾝｶｸ ㎏`, a run of Egyptian hieroglyphs (`<unk>`),
multiple spaces, `자, 그럼` — same ids in both. The JS `tokens` array gives an `<unk>`'s covered
characters instead of `<unk>`, and `tokenizer.normalizer` is callable, which the character mapping uses.

## Inference (port of `spokentxt_punctuation_restoration.PunctuationModel.predict`)

Upstream: `tokenizer(text)` → one forward pass over the whole text → argmax per token. Tokens are walked
in order; special tokens (`<s> <pad> </s> <unk> <mask>`) are skipped entirely; a token starting with `▁`
starts a new word (the `▁` dropped); the word's mark is the label of its **last** non-special token; a
word is emitted as `word + mark` unless its last character already equals the mark; words are joined with
one space. The module does exactly that grouping (`groupWords`) on the labels, then places the marks:

- **Characters come from the input, not from the pieces.** Upstream returns normalized pieces
  (`ＡＢＣ` → `ABC`, `…` → `...`) and silently drops a word that is entirely `<unk>`. The module
  normalizes the input one code point at a time with the tokenizer's own normalizer, walks the pieces
  over that stream, and inserts each mark after the original character that ends its word. Whitespace
  runs collapse to one space and the ends are trimmed, as upstream's join does. A piece that cannot be
  found within 16 characters counts as a mapping miss (0 over all parity rows).
- **Input commas** (the `commas` variant) are passed through untouched: upstream does no preprocessing.
  A comma is its own token, gets its own label, and the "already ends with the mark" rule stops `,,`.
  No doubled mark appeared in any evaluated output.
- **Length.** Upstream has no limit (model_max_length 32768, RoPE to 8192) and runs the whole text in
  one pass. The module windows at 510 content tokens (512 with `<s>`/`</s>`), overlap 32, keeping 16 on
  each inner side — a choice, not an upstream value (the training length is undisclosed). No corpus row
  comes near 510; `en-long` (654 tokens, 2 windows) still matched the single-pass PyTorch labels exactly.
- Argmax takes the first maximum, like `torch.argmax`. Empty or whitespace-only input returns `''`.
- A word's `<unk>`/special-token characters stay inside it, so its mark goes after them
  (`안녕𓀀` → `안녕𓀀.`), where upstream, having dropped them, writes `안녕.`. A literal `<mask>` in the text
  swallows the space before it (lstrip) and joins the previous word the same way.
- Checked on the int8 module: the letter/digit skeleton (`lib/text.mjs` `analyze`) of the output equals
  the input's on all 112 ko/en rows and on empty, whitespace-only, all-`<unk>`, fullwidth/halfwidth,
  multi-space, literal `<s>`/`<mask>` and a 2,859-character (3-window) Korean input; `ja` throws.

## Parity (`parity/koen-punct.py` + `parity/koen-punct.mjs`)

Reference: PyTorch model, upstream `predict()` called verbatim (constructor bypassed only to pin
revisions). JS: `models/koen-punct-core.mjs` on onnxruntime-web 1.26 WASM, 1 thread.
`onnxruntime-py` rows run the same `predict()` over a CPU session of that graph.
"tokens" = per-token argmax agreement; "marks" = agreement of scored (position, class) events.

| comparison | ko rows (40) | en rows (72) | long rows (2) | ko tokens |
| --- | --- | --- | --- | --- |
| JS fp32 vs PyTorch | **40/40** | **72/72** | **2/2** | 876/876 |
| JS int8 vs PyTorch | 40/40 | 69/72 | 1/2 | 871/876 |
| JS int8-matmul vs PyTorch | 38/40 | 70/72 | 1/2 | 873/876 |
| onnxruntime-py int8 vs PyTorch | 38/40 | 71/72 | 1/2 | 871/876 |
| onnxruntime-py int8-matmul vs PyTorch | 38/40 | 71/72 | 1/2 | 871/876 |
| JS int8 vs JS fp32 | 40/40 | 69/72 | 1/2 | 871/876 |

- JS fp32 is identical to PyTorch on every token of every row, so the port (tokenizer, windowing,
  grouping, character mapping) adds no error.
- Quantization moves a handful of labels. On ko the five int8 token flips land on word-internal tokens
  and change no text. The MatMul-only build is not closer to fp32 than MatMul+Gather (ko 38/40 vs 40/40),
  so the 311 MB build is the one to use.
- JS int8 and Python int8 disagree with each other on a few rows (different integer kernels) while
  being equally close to fp32.

First diffs (all int8 vs fp32/PyTorch):
- `ko-numbers-01` (int8-matmul, both variants): `…증가했습니다 특히…` loses the `.` fp32 puts after `증가했습니다`.
- `en-numbers-01` (JS int8, both variants): `Revenue grew 12%, year over year` gains a `,`.
- `en-stream-02/stripped` (all int8): `Oh, no, he's right behind me` gains a `,` after `no`.
- `en-longsentence-01/lower` (JS int8-matmul): gains `, so` after `in real time`.
- `ko-long` (all int8): 3–6 marks move across the 435-token passage (`감사합니다.` added/removed,
  `가 봤어,` → `가 봤어`, `지시예요` gains `?`).

Files: `results/parity-koen-punct-ref-{torch,fp32,int8,int8-matmul}.json`,
`results/parity-koen-punct-js-{fp32,int8,int8-matmul}.json`, summary `results/parity-koen-punct.json`.

## Latency (Node 22, onnxruntime-web 1.26 WASM, 1 thread)

`session.run` on one window of N content tokens + `<s></s>`, median of 15 after 3 warm-ups. The
machine (GB10, aarch64) was shared with other benchmark agents and the three builds ran concurrently,
so treat these as indicative.

| build | load | 64 tok | 128 tok | 256 tok |
| --- | --- | --- | --- | --- |
| fp32 | 3.5 s | 293 ms | 570 ms | 1146 ms |
| int8-matmul | 3.0 s | 252 ms | 492 ms | 991 ms |
| int8 | 1.6 s | 248 ms | 485 ms | 982 ms |

Cost grows linearly with length (MatMul-dominated; the gated MLP's 768→6144 projection is ~1.5× a BERT
FFN). int8 buys size and load time, only ~15% speed on WASM. In `eval-quality.mjs` the int8 module
averaged ~96 ms per short Korean passage, versus PCS-47's ~77 ms, measured in a separate run.

## onnxruntime-web

No issues. Both int8 builds and the fp32 build load and run every parity row on the WASM EP. Ops in the
int8 graph: MatMulInteger, DynamicQuantizeLinear, per-tensor DequantizeLinear, LayerNormalization, Erf,
Split, Softmax, plus shape plumbing. All are available in the 1.26 WASM build. The fp32 graph is a single
1.23 GB file under the 2 GB protobuf limit, so no external data is needed.

## Quality snapshot (indicative; `node eval-quality.mjs --models koen-punct --no-stream --out results/parity-koen-punct-quality.json`)

| model | variant | boundary P | boundary R | boundary F1 | comma F1 | question F1 | final mark |
| --- | --- | --- | --- | --- | --- | --- | --- |
| koen-punct (int8) | ko/stripped | 100.0 | 62.5 | 76.9 | 0.0 | 66.7 | 100% |
| koen-punct (int8) | ko/commas | 100.0 | 62.5 | 76.9 | 95.2 | 66.7 | 100% |
| pcs47 (int8, from `results/quality-pcs47+pcs47-sbd.json`) | ko/stripped | 100.0 | 58.3 | 73.7 | 56.0 | 72.7 | 100% |

What stands out, from the outputs:
- **Korean commas: essentially none.** Over 20 stripped ko passages it wrote one comma, and that one
  was wrong (`준비해 주세요, 출발`). It never restores the fillers' or list commas (`음 그`, `여권 항공권`).
  Its card reports comma F1 0.83, but on a ko+en mix with no per-language split.
- **Boundaries:** slightly higher Korean recall than PCS-47 (62.5 vs 58.3) at the same 100% precision.
  It misses boundaries after `시작하겠습니다`, `김민수입니다`, `발표했습니다`, `별도군요`, and between
  the three questions of `ko-questions-02`. `!` never fires on `와 대박 보스 너무 세다`.
- **Questions:** `무엇을 도와드릴까요.` gets `.`; `가 봤어?` gets a false `?`.
- **English: final marks are usually missing** (26.1% of passages end with one), e.g. `…the agenda for
  today` and `…the final boss`, and internal boundaries are recovered at 33% recall. Casing is not
  restored (`lower` variant upper-case F1 0). JS fp32 equals PyTorch exactly, so these are model
  behaviour, not port errors.

## License text location

- Model weights: `license: apache-2.0` in the YAML front matter of
  `https://huggingface.co/whooray/koen_punctuation/blob/5c132a5cefa058c38b9f40006effa2da6f0c1d4d/README.md`
  (the repo has no LICENSE file); local copy `…/koen_punctuation/src/README.md`.
- Base model: `license: apache-2.0` in `Alibaba-NLP/gte-multilingual-mlm-base` README front matter.
- Custom modeling code: Apache-2.0 header in `modeling.py`/`configuration.py` (local copies under
  `…/koen_punctuation/src/new-impl/`), and `license: apache-2.0` in `Alibaba-NLP/new-impl`'s README.
- Inference reference `spokentxt-punctuation-restoration` 0.1.1 (PyPI): no license declared. It is used
  only as the reference for this port and in the parity script.
- Training data: undisclosed.
