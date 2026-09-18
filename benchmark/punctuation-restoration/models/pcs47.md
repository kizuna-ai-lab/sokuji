# PCS-47 — `1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase`

One xlm-roberta (base-sized, 250k-row vocab) pass predicts, per subtoken: a punctuation mark before
it (`¿` only), a mark after it (16 classes incl. `<ACRONYM>`), an upper-case bit for each of its
characters (16 slots) and a sentence-boundary bit. Argmax is inside the graph, so it exposes
labels, not probabilities: **there are no thresholds to tune.** 47 languages; our four (ja, zh,
en, ko) are all in its training set (1M lines of WMT News Crawl per language).

Modules (all share `models/pcs47-core.mjs`):

| module | graph | output |
| --- | --- | --- |
| `pcs47` | `model.int8.onnx` | punctuated, true-cased text (`apply_sbd=False`) |
| `pcs47-sbd` | `model.int8.onnx` | same text split where the boundary head fires, joined with `\n` (`apply_sbd=True`) |
| `pcs47-fp32` | `model.onnx` | as `pcs47`, upstream fp32 graph — quality reference |

Files in `/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47/`: `model.onnx` (symlink to the HF
snapshot), `model.int8.onnx`, `model.int8-matmul.onnx`, `sp.model` (copy, used only by the Python
reference), `config.yaml` (copy), `tokenizer.json` (symlink to `FacebookAI/xlm-roberta-base`).

## Preprocessing (our choice; punctuators does none)

The model card builds its test inputs by lower-casing and removing all punctuation, so that is the
input the modules feed:

1. Drop every character the model itself predicts — the union of `pre_labels` and `post_labels` in
   `config.yaml`: `¿ . , ? ？ ， 。 、 ・ । ؟ ، ; ። ፣ ፧`. Exception: `.` and `,` between two
   `\p{Nd}` digits stay (`12.5`, `3,000`).
2. Lower-case (`String.prototype.toLowerCase`; Python `str.lower` on the reference side).
3. Collapse whitespace runs to one space, trim.

Consequences: the `commas` variant is punctuated from scratch (its commas are removed, not kept as
hints — the model never saw input punctuation, and a kept `,` token can collect a predicted `,` of
its own); casing that ASR already got right (`Tokyo`, `OpenAI`) is discarded and must be restored
by the true-case head. Other punctuation (apostrophes, `%`, `$`, `-`, quotes) is left alone, as the
model card's own examples keep `how's`. An input with no characters left returns `''`.

## Tokenizer

`tokenizer.json` from `FacebookAI/xlm-roberta-base`, loaded with `@huggingface/tokenizers`
(`add_special_tokens: false`; BOS 0 / EOS 2 added by hand), in place of upstream's re-numbered
`sp.model`. Verified against `sp.model` `EncodeAsIds` on all 248 parity rows (244 from
`results/inputs.json`, at most 140 tokens each, plus one concatenation of every `stripped` input
per language: ko 430, ja 597, en 659, zh 1419 tokens), on both the raw input and
the preprocessed string: **0 id mismatches**, 0 preprocessing mismatches (JS vs Python), no row
produced `<unk>`. Both tokenizers fuse a run of unknown characters into one `<unk>` (id 3).

Pieces are decoded with `tokenizer.id_to_token(id)`, which returns the same strings as
`sp.IdToPiece` (same vocabulary; the longest piece is exactly 16 code points, matching the 16
cap slots). Characters are indexed by code point, as Python does.

## Windowing (port of `TextInferenceDataset._tokenize_inputs`, `infer(overlap=16)`)

`max_length` 256 → windows of 254 ids + BOS/EOS. Window `i > 0` starts `overlap` (16) ids before
the previous window's end: `[0,254) [238,492) [476,730) …`. When stitching, each window drops its
first 8 ids if a window precedes it and its last 8 if one follows (`overlap // 2`). Every window is
run on its own (batch 1, no padding).

## Decoding (port of `PunctCapSegResultCollector.produce`)

For each kept token, in order:

- a piece starting with `▁` appends a space if the current sentence is non-empty, and its first
  character is the one after `▁`;
- before the first character, the pre label (`¿`) if not `<NULL>`;
- each character upper-cased if its cap bit (`cap_preds[t][char index]`) is set;
- `<ACRONYM>`: a `.` after **every** character of the piece (and no other post mark); otherwise the
  post label after the piece's last character if not `<NULL>`;
- after the last character, if boundary output is on and `seg_preds[t]` is set, the sentence is
  closed (the next sentence then starts without the space).

A piece that is only `▁` has no characters, so a post mark or boundary predicted on it is dropped —
upstream behaves the same way. Boundary and punctuation heads are independent: a boundary can
follow a `、`/`，`, or no mark at all, and a `.` can appear without a boundary.

## Deviations from upstream

1. **Preprocessing** (above) — upstream passes text through untouched.
2. **`<unk>`**: upstream decodes it with `IdToPiece` into the literal `<unk>`, destroying the
   characters; the port uses the tokenizer's surface text for id 3, so letters survive. (No parity
   row contains `<unk>`, so this never affected the numbers.) The cap-slot lookup is guarded for
   surfaces longer than 16 code points.
3. **Empty input**: upstream raises `IndexError` with `apply_sbd=False` on an input with no
   tokens; the port returns `''`.
4. **Batching**: upstream batches all windows of one text together, padded with `<pad>` (the
   graph masks padding itself); the port runs windows one at a time. Numerically this can only
   shift logits by floating-point noise.
5. **Runtime**: onnxruntime-web 1.26 WASM vs onnxruntime 1.30 CPU on the reference side.

## Knobs

`overlap` (16; `loadEngine(…, { overlap })`), the window length (from `max_length`), boundary
output on/off, and the preprocessing above. The graph has no confidence or threshold input.

## int8 builds

`onnxruntime.quantization.quantize_dynamic`, `per_channel=True`, `weight_type=QInt8`, no
pre-processing pass (onnxruntime 1.30, onnx 1.22).

| file | quantized ops | bytes |
| --- | --- | --- |
| `model.onnx` (upstream fp32) | — | 1,112,481,438 |
| `model.int8-matmul.onnx` | 80 of 104 MatMul → MatMulInteger (the other 24 multiply two activations) | 856,517,247 |
| `model.int8.onnx` | the same + 4 Gather (embedding tables) → int8 initializer + DequantizeLinear | 279,327,734 |
| `sp.model` | — | 5,069,059 |
| `tokenizer.json` | — | 9,096,718 |
| `config.yaml` | — | 531 |

The MatMul-only build stays at 857 MB because the 250,002 × 768 fp32 word embedding (~768 MB) is a
Gather. Both builds load and run every parity row in onnxruntime-web 1.26 WASM (Node,
`ort.node.min.mjs`, 1 thread): MatMulInteger, DynamicQuantizeLinear and per-axis DequantizeLinear
are all available there — no unsupported op. Load time (read files, parse tokenizer.json, create
the session; Node, from the page cache) in the quietest run: fp32 2932 ms, int8-matmul 2507 ms,
int8 1413 ms (under load from other agents: up to 4175 / 4131 / 2344 ms).

**Chosen: `model.int8.onnx` (MatMul + Gather).** Agreement with the fp32 graph, both in JS, over
the 248 parity rows:

| build | identical rows (text / split) | scored marks agreeing | sentence boundaries agreeing |
| --- | --- | --- | --- |
| int8 (MatMul + Gather) | 150 / 142 (60.5% / 57.3%) | 1709 / 2057 (83.1%) | 617 / 756 (81.6%) |
| int8-matmul | 145 / 134 (58.5% / 54.0%) | 1687 / 2065 (81.7%) | 605 / 779 (77.7%) |

"Agreeing" is the intersection over the union of (skeleton position, mark class) pairs, or of
boundary positions, as `lib/text.mjs` scores them. Quantizing the embedding Gather costs nothing
measurable (it is marginally closer to fp32 here, within noise) and removes 577 MB, so the
MatMul-only build has no reason to exist. Neither build is a transparent copy of fp32: about 40% of
rows change somewhere, a mark added or dropped at a close call (examples in
`results/parity-pcs47.json`). The flips go both ways and do not move the scores in one direction.
`eval-quality.mjs --no-stream`, `stripped` variant (101-item corpus; `commas` is byte-identical,
see preprocessing), F1 in percent, int8 / fp32:

| lang | n | boundary | comma | question | upper-case (`lower` variant) |
| --- | --- | --- | --- | --- | --- |
| en | 23 | 78.9 / 81.7 | 66.7 / 68.6 | 76.9 / 76.9 | 88.6 / 91.1 |
| ja | 24 | 90.2 / 87.5 | 65.2 / 63.2 | 85.7 / 80.0 | — |
| zh | 34 | 55.0 / 54.5 | 69.7 / 71.9 | 44.4 / 50.0 | — |
| ko | 20 | 73.7 / 73.7 | 56.0 / 53.8 | 72.7 / 83.3 | — |

With 20-34 passages per language a few points either way is a handful of marks, so treat int8 as
equivalent to fp32 on this corpus, not as a verified lossless copy. Full tables:
`results/quality-pcs47+pcs47-sbd.json` and `results/parity-pcs47-quality-fp32.json`.

## Parity

`parity/pcs47.py` runs `punctuators` (`PunctCapSegModelONNX`, `directory=` the pcs47 folder,
onnxruntime 1.30 CPU on aarch64) over every row of `results/inputs.json` for ja/zh/en/ko, twice
(`apply_sbd=False` → `punct`, `apply_sbd=True` joined with `\n` → `sbd`), after the same
`preprocess()`. `parity/pcs47.mjs run <graph>` replays the rows through `models/pcs47-core.mjs` on
onnxruntime-web WASM, 1 thread; `report` compares. 248 rows: 244 corpus rows (synthetic plus
GPT-Live, incl. `raw` transcripts) and the four `*-long` concatenations, which run as 2 (ko), 3
(ja, en) and 6 (zh) stitched windows.

| comparison | identical `punct` rows | identical `sbd` rows | marks agreeing | boundaries agreeing |
| --- | --- | --- | --- | --- |
| **JS fp32 vs punctuators fp32** | **248 / 248** | **248 / 248** | 1887 / 1887 | 677 / 677 |
| JS int8 vs punctuators int8 | 187 / 248 (75.4%) | 182 / 248 (73.4%) | 1765 / 2000 (88.3%) | 652 / 758 (86.0%) |
| JS int8 vs punctuators int8, graph optimizations off | 182 / 248 (73.4%) | 179 / 248 (72.2%) | 1757 / 2020 (87.0%) | 665 / 775 (85.8%) |
| JS int8-matmul vs punctuators int8-matmul | 187 / 248 (75.4%) | 183 / 248 (73.8%) | 1763 / 1985 (88.8%) | 668 / 785 (85.1%) |
| punctuators int8 vs punctuators fp32 | 143 / 248 (57.7%) | 135 / 248 (54.4%) | 1700 / 2073 (82.0%) | 611 / 780 (78.3%) |
| JS int8 vs JS fp32 | 150 / 248 (60.5%) | 142 / 248 (57.3%) | 1709 / 2057 (83.1%) | 617 / 756 (81.6%) |

- **fp32: exact.** Every character of every output matches upstream, including casing, `<ACRONYM>`
  expansion, the pre/post label placement, SBD splitting and multi-window stitching. Running
  windows one at a time instead of padded together (deviation 4) changed nothing here.
- **int8: the same graph file gives different outputs in the two runtimes**, on a quarter of the
  rows. It is not the port: the JS code path is the one that matches fp32 exactly. It is not
  onnxruntime's CPU graph fusion either (turning optimizations off in punctuators brings the two no
  closer). Two probes pin it down:
  - `parity/pcs47-probe-matmulinteger.{py,mjs}`: layer 0's real query weight in a
    DynamicQuantizeLinear → MatMulInteger graph, 128 × 768 float input. onnxruntime-web, native
    onnxruntime (optimizations on and off) and exact int64 arithmetic agree on every one of 98,304
    output integers, and on the quantized input, scale and zero point. The integer kernels are
    exact in both runtimes.
  - `parity/pcs47-probe-layers.{py,mjs}`: every LayerNorm output (and, in the int8 graph, every
    DynamicQuantizeLinear output) exposed and compared, WASM vs native, on two real 128-token
    windows. Float ops (LayerNorm, Softmax, Erf, Add) differ in the ~7th significant digit in
    both graphs. In **fp32** that stays put: the last hidden state differs by at most 2.6e-5
    (values up to 11). In **int8**, every DynamicQuantizeLinear rounds activations to one byte:
    a 1e-6 difference that lands on a rounding edge flips a byte, worth a whole quantization
    step (0.02-0.2), five orders of magnitude more. Layer 0 has no flipped bytes; by layer 1 (zh)
    34 of 99,840 differ; by layer 5, thousands to 78%; by layer 11, over 90%, and the last
    hidden state differs by up to 1.7. Argmax heads then flip on close calls.

  So int8 dynamic quantization turns float noise into different outputs across runtimes (and
  likely across CPUs and SIMD paths). No port can make JS int8 match native int8 exactly; only
  fp32 parity is a meaningful correctness test for this graph.
- The disagreement between runtimes is smaller than what quantization itself does in either
  runtime (~40% of rows move vs fp32 in both), so for scoring, JS int8 is as representative of "the
  int8 build" as native onnxruntime is.

Artifacts: `results/parity-pcs47-ref-{fp32,int8,int8-matmul,int8-noopt}.json` (punctuators
outputs plus SentencePiece ids), `results/parity-pcs47-js-{fp32,int8,int8-matmul}.json` (JS outputs,
tokenizer check), `results/parity-pcs47.json` (all comparisons, first 10 diffs of each).
Reproduce: `python parity/pcs47.py [--model model.int8.onnx] [--no-opt]`, then
`node parity/pcs47.mjs run fp32|int8|int8-matmul`, then `node parity/pcs47.mjs report`.

## Latency (Node, onnxruntime-web WASM, 1 thread)

`node parity/pcs47.mjs bench <graph>`, one graph per process, on the DGX Spark (GB10, aarch64),
`ort.env.wasm.numThreads = 1`. Load average was 5-10 on 20 cores from other agents' jobs, so treat
the numbers as indicative. **Window** = one `session.run` on exactly N ids plus BOS/EOS (real text,
the start of each language's `*-long` row), median of 15 after 3 warm-ups. **Pipeline** = the whole
`run()` (preprocess, tokenize, all stitched windows, decode), median of 5.

| graph | en 64 | en 128 | en 254 | ja 254 | zh 254 | ko 254 | pipeline ko 430 tok (2 windows) | ja 597 (3) | en 659 (3) | zh 1419 (6) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fp32 | 227 ms | 440 ms | 891 ms | 862 ms | 860 ms | 855 ms | 1500 ms | 2133 ms | 2359 ms | 5112 ms |
| int8 | 191 ms | 373 ms | 752 ms | 747 ms | 749 ms | 739 ms | 1296 ms | 1849 ms | 2040 ms | 4381 ms |
| int8-matmul | 188 ms | 367 ms | 738 ms | 738 ms | 755 ms | 741 ms | 1296 ms | 1832 ms | 2009 ms | 4426 ms |

The two int8 builds run at the same speed (they differ only in the embedding lookup, which is
cheap either way); the Gather variant wins on size and load time, not latency.

Cost is linear in tokens at about **2.9 ms per token (int8)** and 3.4-3.5 ms (fp32), identical across
languages. There is no fixed per-call floor to amortize. int8 is only ~15% faster than fp32 here:
the 24 attention MatMuls stay float, and every quantized MatMul pays a DynamicQuantizeLinear first.
The runner's `ms/call` on the corpus (short passages) was 77-140 ms per item for int8.

For Sokuji this is the binding constraint, more than quality. Re-running on a growing ASR prefix,
as the streamed part of `eval-quality.mjs` does, costs ~370 ms single-threaded at 128 tokens
and grows with the prefix. Measured on the `*-long` rows, 128 tokens is about 267 ja characters,
207 zh characters, 205 ko characters, or 107 en words (ja 2.08, zh 1.62, ko 1.60 characters per
token; en 0.84 words per token). That needs a capped, sliding context
window, multi-threaded WASM, or WebGPU to be usable live.

## What the model gets wrong (seen in the fp32 reference outputs)

Scores are in `eval-quality.mjs`; these are mark counts over the `stripped` rows of the fp32 parity
run (the `commas` variant gives byte-identical output, because preprocessing removes its commas),
compared with the same rows' references, plus patterns visible by eye.

| lang / source | rows | commas (model / gold) | full stops | questions | sentences from the boundary head |
| --- | --- | --- | --- | --- | --- |
| zh synthetic | 21 | `，` 56 / 25 | `。` 21 / 34 | `？` 3 / 6 | 25 |
| zh GPT-Live | 13 | `，` 117 / 88 | `。` 57 / 55 | `？` 3 / 4 | 71 |
| ja synthetic | 21 | `、` 42 / 24 | `。` 37 / 39 | `？` 8 / 7 | 47 |
| ja GPT-Live | 3 | `、` 19 / 9 | `。` 17 / 15 | — | 18 |
| ko synthetic | 20 | `,` 16 / 10 | `.` 29 / 35 | `?` 5 / 7 | 34 |
| en synthetic | 20 | `,` 23 / 22 | `.` 42 / 41 | `?` 7 / 6 | 43 |
| en GPT-Live | 3 | `,` 10 / 15 | `.` 16 / 15 | — | 16 |

- **zh: sentences are joined with `，`.** On the short synthetic passages the model writes more than
  twice the reference commas and under two thirds of the full stops: multi-sentence turns come
  back as one comma-spliced sentence (`…开始今天的会议吧，首先，请小王…`). A question can come back
  as `，` (`你们什么时候可以交付，如果…`). On the longer GPT-Live zh transcripts the full-stop count
  is about right and the excess is commas.
- **ja: extra `、` after topic phrases**, close to double the reference count
  (`この機能は、いつ…`, `場所は、本社の…`), and the filler `えー` turned into a question
  (`えー？それでは…`). A fullwidth `，` appears in ja output.
- **ko: too few terminals** (29 `.` for 35) — the boundary head is precise but misses sentences.
- **Boundary head vs. punctuation head.** The boundary head fires after an acronym dot
  (`2 p.m. | to talk about…`), after a comma (`500毫秒左右， | 下一步…`) and, on the int8 graph,
  after `こんにちは、`. Scored as boundaries (`stripped`, int8), it is no better than the terminal
  marks the punctuation head writes: boundary F1 from the `\n` splits of `pcs47-sbd` / from the
  terminal marks of `pcs47` is en 77.1 / 78.9, ja 89.4 / 90.2, zh 53.2 / 55.0, ko 73.7 / 73.7. For
  cutting subtitle lines, the terminal marks are the signal to use; the separate head adds nothing
  here.
- **en conversational fillers**: `Great?` as a question, `let's get started first, can everyone…`
  (boundary missed, then the comma misplaced). The card warns it was trained on news and
  over-predicts commas.

## WebGPU builds

The int8 build is dynamic quantization (`DynamicQuantizeLinear` → `MatMulInteger`). In the Electron renderer
those nodes have no WebGPU kernel and fall back to the CPU, 10-50× slower than WASM (coordinator's
measurement). A weight-only 8-bit FireRedPunc (`MatMulNBits`, fp32 activations) runs on WebGPU instead. This
section builds the same kind of graph for PCS-47.

### What onnxruntime-web 1.26 supports

The app's `onnxruntime-web` is `1.26.0-dev.20260416-b7804b056c`, commit
[`b7804b056c`](https://github.com/microsoft/onnxruntime/commit/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d).
Sources below are at that commit.

- **Which WebGPU backend.** `onnxruntime-web/webgpu` (`dist/ort.webgpu.bundle.min.mjs`, what Sokuji's
  `onnxruntime-webgpu.ts` imports) loads `ort-wasm-simd-threaded.asyncify.mjs`. That is the native C++
  WebGPU EP compiled into WASM, not the older JSEP (`.jsep.mjs`). The loader choice is in
  [`wasm-utils-import.ts`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/js/web/lib/wasm/wasm-utils-import.ts),
  and the string is in the shipped bundle.
  - So the authoritative op list is the native EP's kernel registry:
    [`webgpu_execution_provider.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/core/providers/webgpu/webgpu_execution_provider.cc)
    and
    [`webgpu_contrib_kernels.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/contrib_ops/webgpu/webgpu_contrib_kernels.cc).
  - [`js/web/docs/webgpu-operators.md`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/js/web/docs/webgpu-operators.md)
    describes JSEP. It agrees on the ops that matter here, but it is not the backend in use.
- **Dynamic int8: no kernel.** Neither registry has `MatMulInteger`, `DynamicQuantizeLinear` or
  `QLinearMatMul`, which is why the int8 build falls back to the CPU.
- **`MatMulNBits` (com.microsoft): 4 and 8 bits.**
  [`matmul_nbits.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/contrib_ops/webgpu/quantization/matmul_nbits.cc)
  enforces "Only 4/8 bits are supported". It takes float32 or float16 activations, uint8 packed weights and
  optional uint8 zero points. Any block size works, but it decides the kernel:
  - the prefill "wide tile" program needs `block_size == 32`;
  - the DP4A integer path needs `accuracy_level == 4` and a block size divisible by 32
    ([`dp4a_matmul_nbits.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/contrib_ops/webgpu/quantization/dp4a_matmul_nbits.cc));
  - other sizes use a generic program.

  The builds here use block 32 and no `accuracy_level`, which keeps float math on the wide-tile or generic
  program.
- **`GatherBlockQuantized` (com.microsoft): yes, including 8-bit.**
  - The WebGPU kernel
    ([`gather_block_quantized.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/contrib_ops/webgpu/quantization/gather_block_quantized.cc))
    takes int4, uint4 or uint8 data, int32 or int64 indices, and float32/float16 output. For uint8 with
    `bits=8` and no zero points it uses 128.
  - The CPU kernel, which is what the WASM EP runs
    ([`cpu/quantization/gather_block_quantized.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/contrib_ops/cpu/quantization/gather_block_quantized.cc)),
    accepts `bits` 4 or 8 and a power-of-two `block_size` ≥ 16. For uint8 it requires `gather_axis=0` and
    `quantize_axis` = the last axis, with the same default zero point 128.
  - Both decode `(q − zp) × scale`, and the output float type needs no `shader-f16`.
  - ORT's own `MatMulNBitsQuantizer` (onnxruntime 1.30.0) only emits the 4-bit form ("Gather only supports
    4 bits quantization"), so the 8-bit table below is built by hand.
- **Float16.** The native EP registers float16 variants for its float kernels (`WebGpuSupportedFloatTypes` =
  float, MLFloat16 in
  [`webgpu_supported_types.h`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/core/providers/webgpu/webgpu_supported_types.h)).
  Running them needs the adapter's `shader-f16` feature, which the GB10/Vulkan adapter on this machine does
  not expose: SaT's fp16 file fails there with "Program Gather requires f16". One detail for devices that
  do have it:
  [`layer_norm.cc`](https://github.com/microsoft/onnxruntime/blob/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/onnxruntime/core/providers/webgpu/nn/layer_norm.cc)
  accumulates the mean and mean square in f32 even for f16 tensors, so the classic fp16 LayerNorm overflow
  does not apply to that kernel.
- **The ops PCS-47 uses** (opset 17): `LayerNormalization`, `Erf`, `Softmax`, `Where`, `MatMul`, `Gather`,
  `Add/Mul/Div/Sub`, `Relu`, `Sigmoid`, `ArgMax`, `Equal`, `Greater`, `Not`, `CumSum`, `ScatterND`, `Pad`,
  `Expand`, `Range`, `Cast`, `Concat`, `Slice`, `Reshape`, `Transpose`, `Unsqueeze` and `Shape` all have
  native WebGPU kernels.
  - The only op type without one is `ConstantOfShape` (5 nodes, all int64 shape arithmetic).
  - The EP's default kernels take no int64 tensors (types are float, MLFloat16, int32, uint32; a few kernels
    opt in to int64). So the int64 shape subgraphs are expected on the CPU in every build, as they already
    are for FireRedPunc.
  - No attention fusion is involved: the export spells attention out as MatMul/Softmax, which the WebGPU EP
    runs as is.

### Builds

`parity/pcs47-webgpu-builds.py` (`venv-firered` Python: onnxruntime 1.30.0, onnx 1.22.0). Files go to
`/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47/`.

| module | file | bytes | op types changed |
|---|---|---:|---|
| `pcs47-q8w` | `model.q8w.onnx` | 868,305,097 | 72 MatMul → `MatMulNBits`; 32 stay `MatMul` (8 decoder heads, 24 activation × activation) |
| `pcs47-q8w-gather` | `model.q8w-gather.onnx` | **316,300,915** | the same, plus the word-embedding `Gather` → `GatherBlockQuantized` |
| (reference) | `model.onnx` fp32 | 1,112,481,438 | |
| (reference) | `model.int8.onnx` | 279,327,734 | |

- **`model.q8w.onnx`**:
  - `MatMulNBitsQuantizer(bits=8, block_size=32, is_symmetric=True, nodes_to_exclude=<the 8 /_decoder/ MatMuls>)`.
  - That is FireRedPunc's recipe, except that the decoder heads (768×256 … 128×2, 1.7 MB) stay fp32. See
    "Choosing the recipe".
  - The 250,002 × 768 word embedding stays an fp32 `Gather` (768 MB), which is why the file is 868 MB.
- **`model.q8w-gather.onnx`**: that graph, with the word-embedding table quantized by hand.
  - One fp32 scale per 32 values along the hidden axis, max |w| / 127.
  - uint8 data with no zero-point input.
  - `GatherBlockQuantized(bits=8, block_size=32, gather_axis=0, quantize_axis=1)`, int64 `input_ids` as
    indices.
  - Max dequantization error 0.0039, mean 0.00086, against a max |w| of 1.04.
  - Position and token-type embeddings (514 and 1 rows) stay fp32.
- The first build quantized all 80 constant MatMuls including the heads: 866,596,583 / 314,592,401 B, with
  results kept as `results/parity-pcs47-q8w{,-gather}-allmatmul.json`.
- The script ends with a native sanity check (Python ORT CPU, first 254-token window of each `*-long` row,
  against fp32): pre, post and seg labels all identical; 1 of 4,096 cap bits differs in each of ja and zh
  (`results/parity-pcs47-q8w-build.json`).

**fp16 was not built** (scope change: the renderer's adapter has no `shader-f16`, so it is untestable on this
box). For the record, the Apache-2.0 port
[`Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16`](https://huggingface.co/Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16)
@75191c14 was inspected:
- `model.onnx`, 556,483,843 B;
- the same op types and counts as upstream fp32;
- all 278,051,561 float initializer elements are float16, embedding included, and the internal Casts are
  retargeted;
- I/O unchanged: `input_ids` int64 in; int64/bool labels out, so `keep_io_types` has nothing to keep;
- its card says `onnxruntime.transformers.float16.convert_float_to_float16(keep_io_types=True)`, which fits
  the graph (the default op block list only names ops PCS-47 uses on int64 tensors, `Range` and `CumSum`).

That file would need re-checking on a `shader-f16` device before use. On the WASM EP it would run upcast to
fp32, as SaT's fp16 file does.

### Choosing the recipe

`parity/pcs47-webgpu-builds-recipes.py` → `results/parity-pcs47-q8w-recipes.json`. Python onnxruntime (CPU EP)
runs all 248 parity rows through fp32 and each recipe with the JS windowing. It counts label flips against
fp32 at the positions the decoder reads: every token for pre/post/seg, and for cap only slots holding a cased
character. The first run's all-MatMul recipe flagged exactly the rows WASM changed, for both `punct` and
`sbd`. Native fp32 is already identical to WASM fp32 here, so the proxy tracks WASM.

| recipe | post flips | seg flips | cap flips | rows with a punct change | rows with any change | bytes |
|---|---:|---:|---:|---:|---:|---:|
| symmetric, block 32, all MatMul (first build) | 14 | 7 | 7 | 14 | 17 | 866,596,583 |
| **symmetric, block 32, heads fp32 (shipped)** | **10** | **6** | **2** | **9** | **12** | 868,305,097 |
| asymmetric, block 32 | 19 | 5 | 4 | 14 | 14 | 869,275,837 |
| asymmetric, block 32, heads fp32 | 19 | 5 | 4 | 14 | 14 | 870,964,849 |
| symmetric, block 16, heads fp32 | 7 | 0 | 2 | 8 | 8 | 878,921,953 |

No pre (`¿`) label flipped in any recipe.

- **Why it is not 100 % like FireRedPunc: the flips are near-ties.** Punctuation is an in-graph argmax, and
  the post flips land on fp32's closest decisions.
  - Largest fp32 top-1 − top-2 logit gap at a flip: 0.20 (block 16: 0.07).
  - Only 1 % of all fp32 post decisions have a gap under 0.19 (0.1 % under 0.025). The median gap is 8.2.
  - 8-bit block-32 weight noise is enough to cross the few gaps that small: 10 of the corpus's post
    decisions flip.
- **Seg and cap flips.** Read from the graph: seg fires on softmax class-1 probability > 0.05, cap on
  sigmoid > 0.5.
  - Some seg/cap flips sit on confident fp32 decisions (margin up to 0.93 / 0.50).
  - Their first layers are 772 and 769 wide against the 768 hidden size, so they read something beyond the
    hidden state. That is consistent with a flipped post label changing their input, but not verified.
- **Keeping the heads fp32** removes a third of the changed rows for 1.7 MB. Asymmetric zero points do
  nothing useful.
- **Block 16** is a little better again (8 rows) but gives up the WebGPU EP's block-32 kernel. It was not
  shipped.
- **The proxy matches WASM.** After the rebuild, the shipped recipe's native row sets again equal the WASM
  row sets exactly, for both `punct` and `sbd`.

### Parity on WASM

- Command: `node --expose-gc parity/pcs47-webgpu-builds.mjs q8w|q8w-gather`, writing
  `results/parity-pcs47-q8w.json` and `results/parity-pcs47-q8w-gather.json`.
- Rows: the same 248 parity rows as above, run through the same module on onnxruntime-web 1.26 WASM with
  1 thread.
- Baseline: the fp32 JS outputs in `results/parity-pcs47-js-fp32.json`, which match `punctuators` on all
  248 rows.
- Language columns give punct / split identical, in percent.

| build vs JS fp32 | punct identical | split identical | ja | zh | en | ko | marks agreeing | boundaries agreeing | skeleton kept |
|---|---:|---:|---|---|---|---|---:|---:|---:|
| **`pcs47-q8w`** | **239/248 (96.4 %)** | **236/248 (95.2 %)** | 100 / 100 | 93.9 / 93.9 | 94.5 / 90.4 | 100 / 100 | 1883/1893 (99.5 %) | 671/677 (99.1 %) | 248/248 |
| **`pcs47-q8w-gather`** | **239/248 (96.4 %)** | **236/248 (95.2 %)** | 100 / 100 | 93.9 / 93.9 | 94.5 / 90.4 | 100 / 100 | 1883/1892 (99.5 %) | 670/677 (99.0 %) | 248/248 |
| q8w, all MatMul (first build) | 234/248 (94.4 %) | 231/248 (93.1 %) | 100 / 100 | 91.5 / 91.5 | 90.4 / 86.3 | 100 / 100 | 1880/1897 (99.1 %) | 670/677 (99.0 %) | 248/248 |
| q8w-gather, all MatMul | 233/248 (94.0 %) | 230/248 (92.7 %) | 100 / 100 | 90.2 / 90.2 | 90.4 / 86.3 | 100 / 100 | 1880/1896 (99.2 %) | 670/677 (99.0 %) | 248/248 |
| int8 (from "int8 builds") | 150/248 (60.5 %) | 142/248 (57.3 %) | | | | | 1709/2057 (83.1 %) | 617/756 (81.6 %) | |

- **q8w-gather against q8w:** both outputs identical on 247/248 rows. Only `zh-long`, stitched from six
  windows, differs.
- **Every change q8w makes** (q8w-gather changes the same rows), about eight distinct decisions:
  - `gl-zhlong-ja-openai/raw`: `最后提醒大家` → `最后，提醒大家`.
  - `gl-gui-L3383-p2` stripped, commas and raw: `而在为身为受的。弹和` → `而在为身为受的弹和`, a `。`
    dropped.
  - `en-numbers-01` stripped, commas and lower: `12% year over year to $4.2` → `12% year over year, to $4.2`.
  - `zh-long`: `NAD Plus` → `NAD plus`, `辅酶，既是` → `辅酶既是`, `像在看动漫受训` → `像在看动漫，受训`.
    q8w-gather also drops the split after `壁炉高旷的小鼠，`.
  - `en-long`: `Um, so I think` → `Um, so, I think`, `OpenAi realtime` → `OpenAi Realtime`.
  - Split output only, `en-abbrev-01` stripped, commas and lower: the boundary after `2 p.m.` is gone and
    the text is unchanged.
- **ja and ko:** no row changes. The changes go both ways: marks added, removed, and a capital in each
  direction.
- **Below FireRedPunc q8w's 100 %.** The reason is the near-ties described in "Choosing the recipe", not the
  port or a kernel:
  - the same module is exact on fp32;
  - native onnxruntime reproduces exactly these rows;
  - no block-32 8-bit recipe tried reaches zero.

  Against int8's 40 % of rows moved, the weight-only build moves 4-5 %.

### Memory and WASM latency

Node RSS in MB, after `gc()`, WASM EP, one process per build:

| build | file bytes | RSS after load | RSS after the 248 rows | RSS after one 254-token window (load-only probe) |
|---|---:|---:|---:|---:|
| `model.onnx` fp32 | 1,112,481,438 | | | 3,243 |
| `model.int8.onnx` | 279,327,734 | | | 1,130 |
| `model.q8w.onnx` | 868,305,097 | 4,461 | 2,890 | 2,773 |
| `model.q8w-gather.onnx` | 316,300,915 | 1,814 | 1,348 | 1,171 |

- The probe column is a one-off scratch script, not kept in the repo.
  - It loads through `loadEngine`, runs one window, then reads `process.memoryUsage()`.
  - It ran on the first (all-MatMul) builds, which are 1.7 MB smaller.
- "After load" still counts the model bytes on the JS side.
- A WASM heap never shrinks, so the later columns keep the load-time high-water mark.
- **q8w peaks at 4.46 GB RSS in Node right after load.** The 768 MB fp32 embedding sits in the file, and
  the session holds a copy of it. That is close to wasm32's 4 GB heap limit, although RSS also counts
  JS-side buffers.
- **q8w-gather stays in int8's class.**
- On WebGPU the q8w embedding would be one 768 MB float32 buffer, while q8w-gather's largest tensor is a
  192 MB uint8 table. Whether a 768 MB buffer binds on the renderer's adapter was not tested.
- **WASM latency**, one window of N ids plus BOS/EOS, median of 7 after 2 warm-ups, measured while other
  single-threaded jobs shared the box:

  | build | en 128 | en 254 | ja 254 |
  |---|---:|---:|---:|
  | q8w | 522 ms | 958 ms | 959 ms |
  | q8w-gather | 524 ms | 960 ms | 961 ms |

  The latency table above has fp32 891 ms and int8 752 ms at en 254, from a quieter run. On the WASM CPU
  kernel an 8-bit `MatMulNBits` works from dequantized weights, so these builds are slower than int8 there.
  They exist for WebGPU.

### Recommendation for the WebGPU run

**Use `pcs47-q8w-gather` (`model.q8w-gather.onnx`, 316 MB).**
- **Decisions:** the same as q8w on 247/248 rows, and the same 96.4 % / 95.2 % agreement with fp32,
  against int8's 60.5 % / 57.3 %.
- **Size:** a third of q8w's file, int8-class resident memory, and no 768 MB float tensor to upload.
- **Ops:** every one it needs has a native WebGPU kernel, apart from the int64 shape subgraphs. Nothing is
  float16, so it does not need `shader-f16`.

Fall back to `pcs47-q8w` if `GatherBlockQuantized` (uint8, bits=8) misbehaves on the adapter. It is the one
kernel here with no WebGPU evidence yet: FireRedPunc's q8w only exercised `MatMulNBits`. Neither build has
run on WebGPU. Re-check the outputs there, because WebGPU float kernels are not bit-identical to WASM and
this model has near-ties.
