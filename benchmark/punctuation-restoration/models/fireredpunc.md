# FireRedPunc (zh + en): `fireredpunc`, `fireredpunc-q8w`, `fireredpunc-fp32`

Chinese/English punctuation from FireRedTeam's FireRedASR2S.
- Code: [FireRedASR2S](https://github.com/FireRedTeam/FireRedASR2S) @4e7d9aaf, `fireredasr2s/fireredpunc`.
- Weights: [FireRedTeam/FireRedPunc](https://huggingface.co/FireRedTeam/FireRedPunc), Apache-2.0.
- Model: chinese-lert-base (BERT-base, 12 layers, vocab 21,128) with a token classifier over
  `out_dict` = {`<space>`, `，`, `。`, `？`, `！`}.

| module | model file | bytes | where it comes from |
|---|---|---|---|
| `fireredpunc` | `punc.int8.onnx` | 102,189,962 | [42ailab/FireRedPunc-ONNX](https://huggingface.co/42ailab/FireRedPunc-ONNX) @d1d9992e |
| `fireredpunc-q8w` | `punc.q8w.onnx` | 162,771,205 | `parity/fireredpunc-quant.py` (weight-only 8-bit) |
| `fireredpunc-fp32` | `punc.fp32.onnx` | 406,958,439 | `parity/fireredpunc-export.py` (upstream weights, exported) |

- **Shared files:** every module also reads `tokenizer.json` (268,961 B) and `out_dict` (33 B).
  - The 42ailab `tokenizer.json` is byte-identical to upstream `chinese-lert-base/tokenizer.json`.
  - Its vocab is identical to the `chinese-bert-wwm-ext_vocab.txt` upstream uses for ids.
- **Not wired as modules,** but kept in `/home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx/`:
  - `punc.q4w.onnx` (120,301,909 B; 4-bit, see Parity);
  - two diagnostic dynamic-int8 files.

## ONNX interface, and where [CLS] goes

- **I/O:** `input_ids`, `attention_mask` int64 `[batch, seq]` → `logits` `[1, seq - 1, 5]`.
  The 42ailab graph fixes the output batch dimension at 1, so run batch 1.
- **The graph drops position 0 itself:** `logits = classifier(Slice(last LayerNorm, starts=1, ends=INT64_MAX, axis=1))`.
  So the input is **`[CLS]` + tokens, with no `[SEP]`**, and logits row *i* belongs to token *i*.
  This is upstream `FireRedPuncBert._forward` (`add_cls`, then `outputs[0][:, 1:]`); upstream never adds [SEP].
- **Verified:** our fp32 export with that layout matches upstream PyTorch on 8,798/8,798 token classes.
  The JS module asserts `logits.dims[1] === n`.
- **42ailab's quantization recipe, read off the graph:**
  - dynamic int8, **per-tensor** (all 76 scales are scalars), symmetric full-range weights [-127, 127];
  - `DynamicQuantizeLinear` → `MatMulInteger` with uint8 activations;
  - word, position and token-type **embeddings also stored uint8 per-tensor** (`DequantizeLinear` → `Gather`).

## Upstream pipeline (FireRedPunc.process, the text path), all ported

1. **`HfBertTokenizer`** is transformers 4.51.3 slow `BertTokenizer(chinese-lert-base)`:
   - per-character lowercase;
   - clean text: drop category C* except tab/newline/CR, U+0000, U+FFFD; whitespace → space;
   - spaces around CJK ideographs only (kana and Hangul are *not* split);
   - NFC, lowercase, NFD with every Mn removed (です → てす, é → e; Hangul decomposes into jamo);
   - punctuation split (ASCII punctuation ranges plus Unicode P*);
   - WordPiece: greedy longest match, `##` continuation; a word over 100 characters or with an
     unmatched piece becomes one [UNK].
2. **`_recover_unk`** replaces [UNK] tokens with characters of the lowercased input for the text
   rebuild. The id stays [UNK].
3. **ids** from `chinese-bert-wwm-ext_vocab.txt`.
4. **Forward** on `[CLS]` + ids. Over 511 tokens, upstream `forward_model` cuts non-overlapping 511-token chunks.
5. **Argmax** over the 5 classes; there are no thresholds.
   - `sentence_max_length` (default -1) is only honoured by `process_with_timestamp`.
   - The ASR-system example sets it to 25 there. The text path ignores it.
6. **`add_punc_to_txt`:** concatenate tokens with `##` removed.
   - A space goes before a token matching `[a-zA-Z0-9#]` when the previous token matches too
     *and* got no mark.
   - The mark is appended after its token, then `replace("  ", " ")`.
7. **`RuleBaedTxtFix.fix`:**
   - lowercase everything;
   - `a，b` → `a, b` between ASCII letters (likewise 。？！);
   - a leading `word，` → `word,`; a trailing ` word，` → ` word,`;
   - `i`, `i'm`, `i'd`, `i've`, `i'll` → capital I;
   - capitalise the first ASCII letter, and any letter after `.!?。？！` + whitespace.

## Port decisions and deviations

- **Output is rebuilt from the original characters.**
  - *Upstream* prints token text: lowercased, accent-stripped, input whitespace gone. A
    multi-character [UNK] word keeps only its first character.
  - *The port* records every token's span of original code points and takes each decision on the
    upstream token text exactly as upstream. Decisions here are the spacing rule and every
    RuleBaedTxtFix conversion and capital.
  - It then replays those edits onto the lowercased original characters.
  - Characters that produce no token text (control characters, a lone combining mark) stay with
    the previous token. For an [UNK] word the spacing regex sees the whole lowercased word.
- **Marks the model predicts are removed before inference:** `，。？！、,.?!．｡､` become a space,
  and `,` `.` `．` between two digits are kept. The model is trained on unpunctuated ASR text.
  Leaving ASR commas in hurts upstream itself:
  - on the 57 "commas" rows, upstream torch reproduces its stripped result on only 23;
  - 18 get doubled marks;
  - English spacing breaks (`Hi everyone,let's …`, `First,the …`), because input spaces are
    dropped and the space rule only fires between alphanumeric tokens.
- **Windowing** for inputs over 511 tokens:
  - windows of 511 tokens overlapping by 128;
  - each token takes the class from the window where it sits furthest from an *artificial* edge
    (the real start and end of the text don't count as edges).
  - *Upstream:* a hard 511 split with no overlap.
  - *Checked* on a 2,136-token zh passage: every character kept.
- **Everything else is as upstream:**
  - input whitespace is dropped (`我用 iPhone 拍照` → `我用iphone拍照`);
  - proper nouns lose their capitals (`October` → `october`);
  - full-width Latin is lowercased (`ＡＢＣ` → `ａｂｃ`).
- **Interface:**
  - languages other than zh/en throw;
  - `inspect(text)` returns the stripped text, tokens, ids, classes, and the upstream-form text
    before and after RuleBaedTxtFix;
  - the variant modules reuse `createFireRedPunc(deps, modelFile)`.

## Parity

**Reference** (`parity/fireredpunc.py`): upstream `FireRedPunc.process` on PyTorch 2.14 CPU fp32, with
transformers 4.51.3 as upstream pins. The same upstream tokenizer and decoder run around each ONNX
file under Python onnxruntime 1.30.0.

**Rows:** the 153 zh/en rows of `results/inputs.json` (8,798 tokens):
- zh: 34 stripped, 34 commas, 13 raw;
- en: 23 stripped, 23 commas, 23 lower, 3 raw.

**JS:** onnxruntime-web 1.26 WASM, 1 thread (`parity/fireredpunc.mjs <id>`).

**Results:** `results/parity-fireredpunc-upstream.json`, `parity-fireredpunc{,-q8w,-fp32}.json`,
`parity-fireredpunc-export.json`, `parity-fireredpunc-quant.json`.

| compared with upstream PyTorch fp32 | token classes | rows, exact text | 。？！ placed (torch: 353) |
|---|---|---|---|
| 42ailab int8, Python ORT | 96.86% | 43/153 | 173 |
| 42ailab int8, **JS** (`fireredpunc`) | 96.78% | 43/153 | – |
| own fp32 export, Python ORT | 100% | 153/153 | 353 |
| own dynamic int8, per-channel, MatMul only (Mojicast's recipe) | 96.94% | 43/153 | 180 |
| same, classifier left fp32 | 96.87% | 40/153 | 180 |
| **weight-only 8-bit** MatMulNBits, block 32, Python ORT | 100% | 153/153 | 353 |
| weight-only 4-bit MatMulNBits, block 32, Python ORT | 99.43% | 111/153 | 334 |
| weight-only 8-bit, **JS** (`fireredpunc-q8w`) | 100% | 153/153 | 353 |
| own fp32 export, **JS** (`fireredpunc-fp32`) | 100% | 153/153 | 353 |

**The port itself** (JS int8 against Python ORT int8 on the same file):
- tokens and ids equal upstream's on 153/153 rows;
- token classes agree on 99.69%, text on 130/153 rows;
- decoding is exact: the rate of rows with identical classes equals the rate of rows with identical text (85.0%);
- every output keeps the input's letters and digits in order (153/153).

The 23 rows that differ are int8 kernel numerics, not port logic. WASM and native ORT disagree on
near-tie tokens, e.g. `gl-enlong-ja-openai`:
- WASM gives `week` and `also` a ，: `…fix that next week, also, the new pricing page…`;
- native gives neither: `…next week also the new…`.

**42ailab's "character-for-character identical to full precision" claim does not hold.** It is not
their recipe in particular: every *dynamic* int8 variant tried (per-tensor, per-channel, classifier
excluded) loses about half the sentence-final marks and turns them into commas. Weight-only 8-bit
keeps fp32 activations and matches exactly. First diffs (int8, JS and Python identical):

```
torch: Hi everyone! Let's go over the plan for next quarter. First, the mobile subtitle feature, which we expect to ship in october. Then the pricing page redesign.
int8 : Hi everyone, let's go over the plan for next quarter, first, the mobile subtitle feature, which we expect to ship in october, then the pricing page redesign.

torch: … The mobile subtitle feature has finished internal testing. Feedback was generally positive, but we saw delays on weak network connections and we plan to fix that next week. Also, the new pricing page design …
int8 : … the mobile subtitle feature has finished internal testing feedback was generally positive, but we saw delays on weak network connections, and we plan to fix that next week also the new pricing page design …
```

Edge cases (JS int8; every one keeps the skeleton):

| input | output |
|---|---|
| `café résumé naïve déjà vu` | `Café résumé naïve déjà vu.` |
| `hello😀world how are you` | `Hello😀world, how are you.` (upstream would print `h`) |
| `it costs 3.5 dollars or 1,000 yen` | `It costs 3.5 dollars or 1,000 yen.` |
| `the u.s. army and dr. smith arrived` | `The u. S。army and dr. Smith arrived.` |
| `i'm here i'll go i've been i'd say` | `I'm here, I'll go, I've been I'd say.` |

The `S。army` case is upstream's own quirk, reproduced faithfully. The regex `([a-z])。([a-z])`
is non-overlapping, so in `u。s。army` the `s` is consumed by the first match and the second 。
stays full-width.

## Latency (Node, onnxruntime-web WASM, 1 thread)

`parity/fireredpunc-latency.mjs` → `results/parity-fireredpunc-latency.json`.

- **What is timed:** `punctuate()` end to end, median of 20 calls after 3 warm-ups. The sequence
  length counts [CLS]. The zh "254" row came out at 240 because digit runs and Latin words inside
  the zh text merge into single tokens.
- **Machine:** this aarch64 GB10 box, shared with other benchmark jobs (1-minute load average 2.7–5.1).
  The p10–p90 spread was under 1%.

| module | seq 64 | seq 128 | seq 240 (zh) / 254 (en) | session load |
|---|---|---|---|---|
| `fireredpunc` (42ailab int8) | 181 ms | 361 ms | 694 / 738 ms | 451 ms |
| `fireredpunc-fp32` | 210 ms | 416 ms | 795 / 845 ms | 891 ms |
| `fireredpunc-q8w` | 305 ms | 514 ms | 895 / 949 ms | 426 ms |

- **int8 and fp32 scale linearly:** about 2.9 ms per token for int8 and 3.3 ms per token for fp32.
  The windowed 2,136-token passage took 9.5 s with int8 (5 windows of 511).
- **q8w carries a roughly constant +100 ms per call over fp32** at every length (+95, +98, +104 ms).
  That pattern points to per-call weight dequantization for 8-bit MatMulNBits on WASM, as opposed to
  a fused kernel. It buys a 2.5× smaller file, not speed. Not verified in the ORT source.
- **The same pattern shows in the runner** (`eval-quality.mjs --no-stream`, per call): int8
  112 ms en / 188 ms zh, q8w 224 / 314 ms.

## onnxruntime-web notes

- **No op problems.** All three graphs load and run on the onnxruntime-web 1.26 WASM EP.
  - `fireredpunc`: MatMulInteger, DynamicQuantizeLinear, and DequantizeLinear for the uint8 embeddings.
  - `fireredpunc-q8w`: **MatMulNBits with bits=8** (com.microsoft contrib op). It runs on WASM and
    reproduces upstream on 153/153 rows. 8-bit weight-only quantization is usable in the renderer
    with the stock build.
  - `fireredpunc-fp32`: the 407 MB graph fits the WASM heap.
- **int8 results depend on the runtime.** WASM and native onnxruntime agree on 99.69% of token
  classes for the 42ailab file. q8w and fp32 matched upstream on both runtimes.
- **The 42ailab graph fixes the output batch dimension at 1.**

## Knobs

- **Upstream:** `FireRedPuncConfig.use_gpu`, and `sentence_max_length` (text path ignores it). Decoding is plain argmax.
- **Port:** `MAX_TOKENS` 511, `WINDOW_OVERLAP` 128, the `STRIP_MARKS` set.

## Things that look wrong or matter for Sokuji

- **Don't judge FireRedPunc by the 42ailab int8 file.** Its sentence-boundary recall is a
  quantization artifact: most periods become commas. One `eval-quality.mjs --no-stream` run on the
  current corpus (indicative, not tuned):

  | | int8 boundary recall / F1 | q8w boundary recall / F1 |
  |---|---|---|
  | en/stripped | 5.6% / 10.5 | 83.3% / 85.7 |
  | zh/stripped | 1.4% / 2.8 | 39.4% / 55.4 |

  Boundary precision is 88–100% for both. `fireredpunc-q8w` is the faithful small build.
- **End-of-input bias:** even the fp32 reference ends almost every input with 。/？/！
  (`こんにちは世界。`, `I.`). A mark at the end of a streamed prefix says nothing about a boundary.
- **Case:** RuleBaedTxtFix lowercases the whole string and re-capitalises only sentence starts and "I".
  Proper nouns, acronyms and mid-sentence capitals from the ASR are lost.
- **Spaces:** all input whitespace is dropped and rebuilt by an ASCII-only rule. Mixed zh/en is
  fine; space-separated non-Latin scripts would collapse (ko is refused anyway).
- **Hangul** is decomposed into jamo by the tokenizer, and kana are not split per character, so the
  model has little to work with outside zh/en. It is correctly scoped to zh and en.
