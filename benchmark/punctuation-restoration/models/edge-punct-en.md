# edge-punct-en

Edge-Punct-Casing (Jian You, Cisco): a CNN-BiLSTM that predicts punctuation and casing per English word,
as packaged by sherpa-onnx (`sherpa-onnx-online-punct-en-2024-08-06`, the int8 file). Module:
`models/edge-punct-en.mjs`. Languages: **en**. Output: `punct` (ASCII `, . ?`, plus casing).

## Files

| File | Bytes | gzip -9 |
|---|---|---|
| `model.int8.onnx` | 7,490,500 | 1,915,056 |
| `bpe.vocab` | 149,430 | 59,762 |

`bpe.vocab` holds 5,000 `piece<TAB>score` lines with CRLF endings, which both parsers treat as whitespace.
The ONNX metadata holds only the label ids (`NO_PUNCT/COMMA/PERIOD/QUESTION` = 0–3,
`LOWER/UPPER/CAP/MIX_CASE` = 0–3), and the module fixes them as constants. Load in Node: about 0.2–0.45 s
cold.

## Reference

sherpa-onnx 1.13.8 `csrc/online-punctuation-cnn-bilstm-impl.h` and `online-cnn-bilstm-model.cc`. The
encoder is `ssentencepiece::Ssentencepiece` from simple-sentencepiece **v0.7**, the tag sherpa-onnx's
`cmake/simple-sentencepiece.cmake` pins. Master differs in one place: on a score tie it takes the longer
piece. Python reference: the `sherpa-onnx` 1.13.8 wheel (`OnlinePunctuation.add_punctuation_with_case`,
bundled onnxruntime 1.28.2).

### Encoder (ssentencepiece v0.7, ported as `UnigramEncoder`)

- There is no normalization at all: no NFKC, no lowercasing. Each whitespace-separated word becomes `▁word`.
- A byte-level trie (Darts double array in C++) over every vocab line finds all pieces that start at each
  byte. The key is read NUL-terminated, so a NUL byte stops matching.
- Viterbi runs from the end over float32 sums (`Math.fround` in JS). A position with no matching piece
  scores 0, which beats every real piece. On an exact tie the earlier, shorter piece is kept.
- A byte no piece covers becomes one `<unk>` (id 0). This vocab has no byte fallback.
- The vocab is lowercase ASCII letters plus `'` only: no digits, no punctuation, no uppercase, no
  non-ASCII. Every capital, digit, mark and non-ASCII byte is its own `<unk>`: `The` → `[565 ▁, 0, 584
  he]`.

**Verification:** a small C++ driver compiled against the v0.7 sources
(`parity/edge-punct-en-ssentencepiece.cc`) encoded 104,523 words: every word of every corpus input and
gold reference, `/usr/share/dict/american-english`, and odd strings (NUL, emoji, CJK, fullwidth, a
300-letter word, `İstanbul`, `<unk>`, `▁the`). The JS ids match on **104,523/104,523**.

### Batching and decode

- Encode: `<s>`=1, then the words' pieces, where only each word's first piece is valid, then `</s>`=2. A
  word that would take the row past 199 ids starts a new row. Rows are padded with 0 to 200, and
  `label_lens` counts the valid positions including `<s>` and `</s>`.
- Upstream sends **all rows in one batch**. The graph quantizes activations per tensor
  (DynamicQuantizeLinear), so the batch composition changes the numbers, and the module keeps the single
  batch.
- Outputs `active_case_logits` and `active_punct_logits` are [valid words, 4] (`<s>`/`</s>` excluded); a
  third output `mask` is unused. Argmax takes the first maximum.
- Decode per whitespace-split word: UPPER uppercases the word, and CAP uppercases its first byte, both
  ASCII-only as `std::toupper` is. LOWER and MIX_CASE leave the word **as written**: no lowercasing, and
  the MIX_CASE word map is an upstream TODO. Then `,`, `.` or `?` is appended, and words are joined by
  single spaces, so the original whitespace collapses. **No final mark is forced.**
- Knobs upstream: `kMaxSeqLen` = 200. There are no thresholds.

The original repository's `decode_sentence.py` differs only in CAP: it uses `str.title()`, which turns
`don't` into `Don'T`. It does not lowercase its input either.

## Deviations in `punctuate()`

`punctuateUpstream(text)` reproduces the reference exactly, including the long-word misalignment below.
`punctuate(text, 'en')` differs in three ways:

1. **The encoder sees each word ASCII-lowercased.** The vocab has no uppercase piece, so upstream turns
   every capital into `<unk>`. The reference on true-cased concatenated input shows the damage:
   `ship. IN, October`, `by The. END. Of. The month`. Output keeps the word as written apart from the
   predicted UPPER/CAP, so the stripped (true-cased) and lower variants give the model identical input.
2. **A trailing run of `, . ?` is stripped from each word, and words made only of those marks are
   dropped.** These are the classes the model predicts, and they never appear in its input. Upstream keeps
   them and appends its own: `hello, world. how are you?` → `Hello, World., how are you??`. Other marks
   (`! ; :`) are left in place as upstream leaves them. As a result the `commas` variant scores exactly like
   `stripped`.
3. **A word is capped at 198 pieces.** Upstream has no cap: a longer word yields a row of more than 200
   ids. The flat buffer is still wrapped as [n, 200], and ORT reads its first n·200 values, which silently
   shifts every later row. The reference returns an unpunctuated `The word ああ… is long` for a 402-byte
   word. The module caps the word, so every row stays aligned (`… is LONG`). This only happens with about
   200 characters that the vocab covers poorly and that contain no space.

## Things that look wrong upstream

- The C++ does not lowercase input for an all-lowercase vocabulary. sherpa's own example feeds capitalized
  text.
- No final mark is forced: final-mark accuracy is 52.2% on the corpus.
- The misaligned batch above.
- MIX_CASE is predicted but does nothing.
- "online" is in the package name, but the model is stateless and whole-utterance. Streaming means
  re-running it on the growing prefix.

## Parity (`parity/edge-punct-en.*`)

Rows: all 72 en rows of `results/inputs.json` (stripped, commas, lower, raw), 13 edge cases (empty,
whitespace, both sherpa examples, existing marks, marks only, non-ASCII and emoji and CJK, uppercase,
contractions, NBSP/tab/newline, numbers, 150- and 402-byte words), and 12 concatenations of 6, 12 and all
23 items (up to 5 batch rows), 97 in all. `results/parity-edge-punct-en.json` has the
details.

- **Upstream path** (`punctuateUpstream(input)` vs `add_punctuation_with_case(input)`): **96/97 exact**.
  The one diff is one word in the 5-row `concat/stripped/0+23` batch. At `just`, ORT-web gives NO_PUNCT
  over COMMA by **0.018 logit** (1.8302 vs 1.8123); pip onnxruntime 1.30 gives COMMA by 0.003; the
  reference output has the comma. The batch ids are identical on both sides.
- **Module path** (`punctuate(input)` vs the reference on the lowercased, mark-stripped text, with the
  reference's case class and mark per word re-applied to the words as written): **96/97**. The one diff is
  the 402-byte word row (deviation 3). Every letter and digit was kept in all 97 rows.
- **Kernels**: 95 batched forwards covering 5,147 words:

  | pair | max abs diff | class disagreements |
  |---|---|---|
  | native ORT_ENABLE_ALL vs ORT-web default | 0.051 | 1 word (`just`, above) |
  | native ORT_DISABLE_ALL vs ORT-web disabled | 0.051 | |
  | native ORT_ENABLE_ALL vs native ORT_DISABLE_ALL | 9.5e-7 | |
  | ORT-web default vs ORT-web disabled | 0 | |

- **Thread count moves near-ties.** A first run of the logits prep that forgot to set
  `ort.env.wasm.numThreads = 1` (so ORT-web's default multi-threading applied) flipped two words, `just`
  to COMMA and `so` to CAP, relative to the same batch run single-threaded. Single- and multi-threaded
  ORT-web do not give bit-identical logits.

## Quality run

`node eval-quality.mjs --models ct-transformer,edge-punct-en --no-stream`, offline, en:

| variant | n | boundary P / R / F1 | comma F1 | ? F1 | final mark | uppercase F1 |
|---|---|---|---|---|---|---|
| stripped | 23 | 85.7 / 83.3 / 84.5 | 83.3 | 72.7 | 52.2% | |
| commas | 23 | same as stripped | | | | |
| lower | 23 | 85.7 / 83.3 / 84.5 | 83.3 | 72.7 | 52.2% | 84.0 |
| raw | 3 | 92.3 / 100 / 96.0 | 93.3 | 100 | 66.7% | |

## Latency (Node 22, onnxruntime-web 1.26.0-dev WASM, 1 thread, median of 15)

Indicative only: the CPU (aarch64 GB10) was shared with other jobs (load average 3–5).

| pieces | words | batch rows | `punctuate()` |
|---|---|---|---|
| 64 | 49 | 1 | 34.7 ms |
| 128 | 104 | 1 | 50.0 ms |
| 198 | 162 | 1 | 66.4 ms |
| 400 | 319 | 3 | 145.1 ms |

Every row is 200 positions, yet time still grows with the number of valid pieces. There is a fixed cost of
about 20 ms, so short utterances are relatively expensive; `eval-quality` averaged about 28 ms/call on the
corpus inputs.

## onnxruntime-web

- **WASM**: loads and runs unchanged, including the contrib op. The graph is opset 13 plus `com.microsoft`:
  DynamicQuantizeLSTM ×3, ConvInteger ×3, MatMulInteger ×2, DynamicQuantizeLinear ×4, NonZero ×2, TopK ×2,
  GatherND ×5, ScatterND ×1, CumSum ×3, and Where/Equal/Not/And/Expand.
- **WebGPU**: not run in a browser. Per onnxruntime's `js/web/docs/webgpu-operators.md` (main), the WebGPU
  EP has no kernel for DynamicQuantizeLSTM, ConvInteger, MatMulInteger, DynamicQuantizeLinear, NonZero,
  TopK, ConstantOfShape or And, and NonZero/TopK produce data-dependent shapes. Almost the whole graph would
  fall back to CPU, so WebGPU brings nothing at 7.5 MB and ~30–70 ms on one WASM thread.
