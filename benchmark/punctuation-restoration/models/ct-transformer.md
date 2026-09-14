# ct-transformer

FunASR `punc_ct-transformer_zh-cn-common-vocab272727` (CT-Transformer, SANM encoder, 4 blocks, 256-d), as
exported by sherpa-onnx (`sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8`, dynamic
uint8 quantization). Module: `models/ct-transformer.mjs`. Languages: **zh, en**. Output: `punct`
(fullwidth `，。？、`).

## Files

| File | Bytes | gzip -9 |
|---|---|---|
| `model.int8.onnx` | 75,519,198 | 61,098,830 |
| `tokens.json` | 4,207,480 | 816,075 |

`tokens.json` is identical to the `tokens` metadata in the ONNX file (272,727 entries, no `|`, no duplicates,
`<unk>` = 272726). The module reads the JSON; onnxruntime-web does not expose custom metadata, so the class
list `<unk> _ ， 。 ？ 、` is fixed in the module (it matches `config.yaml` and the metadata). Load in Node
(JSON parse and map build included): 0.51–0.57 s.

## Reference

sherpa-onnx 1.13.8 `csrc/offline-punctuation-ct-transformer-impl.h`, plus `SplitUtf8`,
`MergeCharactersIntoWords` and `ToLowerCase` in `csrc/text-utils.cc`. Python reference: the `sherpa-onnx`
1.13.8 wheel (`OfflinePunctuation`, which bundles onnxruntime 1.28.2), run over these exact files.

### Tokenization (C++, what the module does)

- Split into code points. A character of 3+ UTF-8 bytes (CJK, kana, Hangul, emoji, fullwidth forms) is one
  token. A 2-byte character is one token unless it is one of the German/Spanish/French letters `IsSpecial`
  lists (`äöüßáéíóúñàèùçâêîôûëï` and capitals), which stay inside a word.
- Runs of the remaining ASCII bytes (letters, digits, apostrophe, control characters) form one word. ASCII
  punctuation other than `'` is its own token. ASCII whitespace (`\t\n\v\f\r` and space) separates and is
  dropped. NBSP and U+3000 are 2/3-byte characters, so they become tokens, not separators.
- Lookup is on the lowercased token (`std::towlower` in the reference's UTF-8 locale; JS lowercases per
  code point and keeps a character whose lowercase would be several code points). Output uses the tokens
  as written.

Differences from the model directory's `test.py`, where the C++ wins: `test.py` does not lowercase; it
groups by byte-length runs, so `3.5` and `well-known` stay single tokens, where C++ splits out the `.` and
`-`; it searches positions `[2, len-1]` for the sentence end where C++ searches `[1, len-2]`; it uses
`ceil(n/20)` windows; and it applies no final-mark fix.

### Windowing and decode

- `ceil((n + 19) / 20)` windows (one more than `ceil(n/20)` in most cases). Window i covers `[i·20,
  min(i·20+20, n))`, except that from the second window on, the start is the carried position `last`.
- Per window: argmax per token (first maximum on ties), then the last `。`/`？` among positions `len-2 … 1`.
  If there is none, the window is at least 200 tokens and a `，` exists, that comma becomes `。`. A found
  sentence end commits the window up to it and carries the rest. A window with none carries everything,
  unless it is the last window, which then commits everything.
- Assembly: token, then its mark unless `_`. A space goes between two items whose first byte is ASCII, so
  the previous item may be a mark (`hello，world`). A final `，`/`、` becomes `。`; if the text does not end
  in `。`/`？`, `。` is appended.
- Knobs upstream: segment size 20, cut length 200, the sentence-end set {`。`, `？`}. There are no score
  thresholds.

FunASR's own `CT_Transformer` (the original) differs: `ceil(n/20)` mini-sentences, no search in the last
one, a comma cut only at `> 200`, and jieba word splitting when a `jieba_usr_dict` exists (this model
directory has none).

## Deviations in `punctuate()`

`punctuateUpstream(text)` reproduces the reference exactly. `punctuate(text, lang)` differs in four ways:

1. **Marks the model predicts are stripped first.** `，。？、` and ASCII `,` `?` become spaces, and so does
   `.` unless it sits between two digits. The model was trained on unpunctuated text: none of these marks
   is in its vocabulary, so the reference feeds them in as `<unk>` tokens and then adds its own mark next to
   them (`你好，我很好。，谢谢`, `so ,，I`). As a result the `commas` variant scores exactly like
   `stripped`: ASR commas are discarded and predicted again. Keeping ASR commas where the model predicts
   none would be a new rule, so it was not added.
2. **The last window is always committed whole.** Upstream also searches the last window for a sentence
   end and then drops every token after it. Searching 177 prefixes of the zh corpus found 4 cases, all with
   `n % 20 == 1`, which lost 1–14 characters (`results/parity-ct-transformer-truncation.json`). With
   `n % 20 ≠ 1`, the extra window only re-predicts the carried tail, which rarely contains a sentence end;
   with `n % 20 == 1` the last window carries one new token. The module's output is the reference output
   plus the missing tail.
3. **Token-less input is returned as is.** For whitespace- or mark-only text the reference runs the model
   on T = 0, which throws in ConvInteger (`Invalid input shape: {10}`, native and ORT-web alike).
4. Class 0 (`<unk>`) would print the literal string `<unk>`. The module prints nothing. It never occurred
   (its logit is around −20 to −36).

Input of any length works: windows carry forward, and the only length cap is the comma cut at 200 tokens.
Without a predicted comma, a window keeps growing.

## Things that look wrong upstream

- The truncation above.
- 1,816 vocabulary entries keep uppercase accented letters (`abbÉ`, `acadÉmie`, `Ácoma`), but lookup
  lowercases them (`É→é`), so those entries can never match. The vocabulary looks ASCII-lowercased only.
- Spacing is rebuilt from tokens. ASCII punctuation gains spaces (`3.5` → `3 . 5`, `well - known`,
  `One more time , I`), and a space between two words starting with a non-ASCII letter disappears
  (`ÉCOLE abbÉ` → `ÉCOLEabbÉ`). Letters and digits survive; the text does not. A subtitle integration would
  have to map marks back onto the original string.
- The vocabulary has no digit tokens and no punctuation tokens.

## Languages

A probe through the module path on the corpus:

| lang/variant | `<unk>` tokens | boundary F1 | comma F1 |
|---|---|---|---|
| zh/stripped | 1.2% | 57.6 | 65.9 |
| en/stripped | 2.5% | 58.5 | 66.7 |
| ja/stripped | 69.1% | 0.0 | 0.0 |
| ko/stripped | 99.5% | 0.0 | 0.0 |

The vocabulary has kanji but none of the 176 hiragana/katakana and none of the 11,172 Hangul syllables.
Japanese output is the input plus a final `。` (`今日はいい天気ですね明日も晴れるといいですね。`), so ja is **not**
included.

## Parity (`parity/ct-transformer.*`)

Rows: all of `results/inputs.json` (244 rows: ja/zh/en/ko, stripped/commas/lower/raw), 19 edge cases (empty,
whitespace, marks only, mixed zh-en, accents and Cyrillic, decimals, emoji, apostrophes and hyphens,
existing marks, fullwidth, NBSP/U+3000/tab/newline, ja, ko, 161- and 483-character zh), 4 truncation cases,
and 50 concatenations of 3, 6 and all corpus items (up to ~2,000 tokens), 317 in all.
`results/parity-ct-transformer.json` has the details.

- **Upstream path** (`punctuateUpstream(input)` vs `add_punctuation(input)`): **311/317 exact** (98.1%;
  one row throws on both sides). Each of the 6 diffs traces to one token where ORT-web and sherpa-onnx pick
  different classes, and every window before it had identical ids. Everything after follows from that
  flip. The ORT-web margin over the reference class at that token:

  | row | token | reference | ORT-web | ORT-web margin | pip onnxruntime 1.30 |
  |---|---|---|---|---|---|
  | gl-zh1-en-openai/commas (and -ja, same text) | 划 | ， | 。 | 0.045 | ， |
  | gl-gui-L3383-p4/commas | 步 | 。 | _ | 0.254 | _ |
  | zh-lecture-01/commas | 别 | _ | ， | 0.007 | _ |
  | en-fillers-01/commas | , (an input token) | _ | ， | 0.108 | ， |
  | concat/zh/stripped/6+6 | 呀 | _ | ， | 0.058 | _ |

  Three ORT builds split among themselves on these ties. Five of the six rows are `commas` inputs, whose
  `<unk>` mark tokens seem to sit closer to ties.
- **Module path** (`punctuate(input)` vs `add_punctuation(stripPredictedMarks(input))`, zh/en rows):
  **217/224 exact**. The 7 diffs are 2 token-less inputs (upstream throws), 4 truncation cases (the
  reference output is a prefix of the module output) and 1 near-tie (the concat row above). Every letter
  and digit was kept in all 224 rows.
- **Kernels**: 57 single forwards (stripped zh/en rows, up to 200 tokens), max |Δlogit|:

  | pair | max abs diff | argmax agreement |
  |---|---|---|
  | native ORT_ENABLE_ALL vs ORT-web default | 0.404 | ≥ 98.98% |
  | native ORT_DISABLE_ALL vs ORT-web disabled | 0.340 | ≥ 98.98% |
  | native ORT_ENABLE_ALL vs native ORT_DISABLE_ALL | 0.404 | 100% |
  | ORT-web default vs ORT-web disabled | 0.430 | 100% |

  Native onnxruntime differs from itself across optimization levels as much as it differs from ORT-web.
  The dynamic-int8 graph is sensitive to which kernels run; this is not a porting error.

## Latency (Node 22, onnxruntime-web 1.26.0-dev WASM, 1 thread, median of 15)

Indicative only: the CPU (aarch64 GB10) was shared with other jobs (load average 3–5).

| lang | tokens | `punctuate()` | windows run (lengths) | one forward at that T |
|---|---|---|---|---|
| zh | 64 | 25.6 ms | 20, 40, 60, 16, 16 | 10.1 ms |
| zh | 128 | 51.6 ms | 8 windows, up to 72 | 20.2 ms |
| zh | 200 | 75.4 ms | 11 windows, up to 72 | 32.9 ms |
| en | 64 | 22.1 ms | 5 windows | 10.2 ms |
| en | 128 | 34.5 ms | 8 windows | 20.3 ms |
| en | 200 | 52.2 ms | 11 windows | 32.7 ms |

Carried windows re-run their tokens, so one call processes about 2–3× the input length. `eval-quality`
(offline, same machine): zh 27.8 ms/call and en 8.5 ms/call on the corpus inputs.

## onnxruntime-web

- **WASM**: loads and runs unchanged. The graph is opset 14 with ConvInteger ×4 (the SANM FSMN memory
  block), MatMulInteger ×17, DynamicQuantizeLinear ×21, DequantizeLinear ×1 (the 272,727 × 256 uint8
  embedding), and Gather, Softmax, Split, Pad, Range, Sin/Cos, ReduceMean/ReduceMax, Pow/Sqrt. There is no
  contrib op. T = 0 fails as it does natively.
- **WebGPU**: not run in a browser. Per onnxruntime's `js/web/docs/webgpu-operators.md` (main), the WebGPU
  EP has no kernel for ConvInteger, MatMulInteger, DynamicQuantizeLinear or ConstantOfShape. Every
  attention and feed-forward MatMulInteger and the FSMN ConvInteger would therefore fall back to the CPU EP,
  with GPU↔CPU copies at each boundary: all of the heavy compute stays on CPU and it would likely be slower
  than WASM alone. WebGPU would need the fp32 export (281 MB), and the 272,727-token embedding makes that
  impractical to ship.

## Streaming

The model is offline: full self-attention inside each window. The only way to stream is to re-run it on
the growing prefix, and each call redoes every window.
