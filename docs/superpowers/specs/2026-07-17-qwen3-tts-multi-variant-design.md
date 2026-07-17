# Qwen3-TTS multi-compute-type variants (fp32 / bf16 / int8)

**Date**: 2026-07-17
**Status**: approved (design), pending implementation plan

## Problem

The native-sidecar Qwen3-TTS cards download one monolithic HF repo that packs
TWO graph sets — `onnx/` (fp32) and `onnx-bf16/` (bf16 CUDA rebuilds of the two
AR hot graphs) — and the loader picks per device at load time
(`cuda_variant_subdir`). Every user downloads both sets:

| repo (today) | total | fp32-only needs | bf16-lane needs |
|---|---|---|---|
| qwen3-tts-1.7b-onnx | 10.65 GB | ~7.8 GB | ~5.0 GB |
| qwen3-tts-0.6b-onnx | 5.05 GB | ~4.1 GB | ~3.1 GB |

CUDA users waste the fp32 talker (~5.8 GB on 1.7b); CPU/DML users waste the
whole `onnx-bf16/` tree. There is also no smaller rung for CPU users at all.

TTS cards expose no download-variant picker because the picker machinery is
driven by distinct `compute_type` values and every TTS deployment row says
`"fp32"` (`accel._h_models_catalog` emits `variants` only when
`len(seen_cts) > 1`; `list_variants` is translate-only). The `onnx/` vs
`onnx-bf16/` split is invisible to the user and to the downloader.

Local Native has no production users yet — HF repo restructuring, including
deleting and recreating repos, is acceptable.

## Decisions (user-confirmed)

1. **Ladder**: `fp32` / `bf16` / `int8`. The 2-byte rung is **bf16** (the
   existing, GB10-CUDA-validated rebuilds), NOT fp16 — fp16 would add DML
   coverage but needs fresh numerical validation (fp16 AR graphs were broken
   even on CUDA in the CosyVoice3 spike). DML keeps using fp32.
2. **Repo structure**: **one self-contained repo per variant** —
   `jiangzhuo9357/qwen3-tts-{0.6b,1.7b}-onnx-{fp32,bf16,int8}` (6 repos).
   Chosen over shared-repo+delta and single-repo+download-filters because it
   aligns with the translate "one quant = one download unit" model and slots
   into the existing whole-repo downloader, `_repos_cached` readiness check,
   and the picker's `chosenVariant.repo → download(model, repo)` wire with
   zero downloader changes. Cost accepted: ~2 GB of shared graphs duplicated
   per repo (variant switching re-downloads them; HF storage is
   content-addressed anyway).
3. **Scope**: qwen3-tts 0.6b + 1.7b only. The machinery is card-agnostic;
   other TTS cards stay single-variant (see §7).

## §1 HF repos (rebuild)

Each of the 6 repos: a single `onnx/` dir + tokenizer/config/voices,
self-contained and directly runnable:

| repo suffix | `onnx/` contents | 1.7b est. | 0.6b est. |
|---|---|---|---|
| `-fp32` | all-fp32 graph set | ~7.8 GB | ~4.1 GB |
| `-bf16` | `talker_decode` + `code_predictor` bf16 rebuilds, rest fp32 | ~5.0 GB | ~3.1 GB |
| ~~`-int8`~~ | ~~`talker_decode` / `code_predictor` / `text_project` int8-quantized, small COLD graphs fp32~~ | ~~~2.6 GB (est.)~~ | ~~~1.5 GB (est.)~~ |

> **int8: CUT (2026-07-17).** The whisper-loopback quality gate PASSED
> (transcripts byte-identical to fp32/bf16), but int8 measured ~3x SLOWER
> than fp32 on BOTH aarch64 (GB10) and x86/AVX-VNNI (i7-14700F) — the
> "smaller = faster on CPU" premise this plan assumed (§3) was falsified in
> practice. The ladder ships as fp32/bf16 only. Artifacts + the gate script
> are retained for future runtime-improvement work:
> `scripts/quantize-qwen3-tts-nbits.py` (export),
> `scripts/validate-qwen3-tts-int8.py` (gate).

- bf16 rebuilds are the existing validated graphs (moved, not regenerated).
- The old dual-directory repos are deleted after the new ones are verified.
- Assembly/upload scripts are updated to build per-variant trees.

## §2 Catalog

```python
TtsModel("qwen3-tts-1.7b", ...,
    (Deployment("mlx_audio_tts", "gpu-metal", "fp32", MLX_REPO, 1.0, macos/AS),
     Deployment("qwen3tts_onnx", "gpu-cuda", "bf16", REPO_BF16, 1.2, est_bytes=~5.0G),
     Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", REPO_FP32, 1.0, est_bytes=~7.8G),
     Deployment("qwen3tts_onnx", "gpu-dml",  "fp32", REPO_FP32, 1.0, windows),
     # int8 CUT (see §1) -- no cpu int8 row ships. fp32 is the only cpu row.
     Deployment("qwen3tts_onnx", "cpu",      "fp32", REPO_FP32, 1.0)),
    ...)
```

- compute_type strings: `"fp32"` / `"bf16"` (int8 CUT, see §1).
- **Delete `cuda_variant_subdir` entirely** (the qwen3 cards are its only
  user), cascading: `PlanConfig.variant_subdir`, the `onnx-bf16` probe in
  `Qwen3TtsOnnxBackend.load`, `build_sessions`' `variant_dir` parameter, and
  the variant-subdir dedup special case in `accel._model_weight_bytes`.

## §3 Planner: `resolve_tts` multi-quant narrowing

Mirror ASR's `resolve()` narrowing. `resolve_tts` gains `downloaded` and
`pin` parameters; when a card has >1 compute_type, narrow to ONE quant before
`_resolve_model`:

- `pin` wins (picker selection, user's will);
- otherwise restrict to **downloaded** variants (we always run the file the
  user downloaded — same iron rule as ASR/translate);
- machine recommendation: CUDA available → `bf16`; no GPU → the smallest
  RUNNABLE variant (fp32 today — int8 was CUT, see §1: it measured ~3x
  SLOWER than fp32 on CPU, falsifying the "smaller = faster" premise this
  plan originally assumed); DML → `fp32`.
- "Downloaded" detection for TTS = **is the variant's repo cached** (repo
  granularity, new accel helper), unlike translate's per-file check.

## §4 Download / readiness / UI picker

- **Downloader: zero changes.** Whole-repo download per variant repo;
  `download(model, repo)` explicit-repo override already exists (translate
  picker uses it).
- `_h_models_catalog`: `len(seen_cts) > 1` auto-emits the `variants` payload
  for TTS (sizes / supported / recommended). Recommended gains a TTS branch
  (cuda → bf16, no-GPU → smallest runnable variant, fp32 today — int8 was
  CUT, see §1). `bf16` is `supported: false` on non-CUDA machines.
- **Renderer**: pass `variantData + onPin` to the TTS `renderCards` call in
  `NativeModelManagementSection` (aligning with the translate call) — the
  picker appears with no new UI code.
- Status/readiness checks the **selected variant's repo**.

## §5 Load path (net simplification)

Every repo is self-contained at `onnx/`; `Qwen3TtsOnnxBackend.load` calls
`build_sessions(f"{d}/onnx", device, threads)` with no variant probing — in a
bf16 repo the same-named files ARE the bf16 graphs. The
`hf_symlinks.materialize_symlinks` deref (ORT external-data path validation)
stays.

CPU fallback is **not** a load-time `BackendLoadError` catch — bf16 ships no
`cpu` tier row at all, so `_tts_pick_quant`'s runnable-filtered,
override-aware narrowing (§3) never selects it for a CPU device in the first
place; a bf16 graph is never even attempted on CPU. The actual fallback lives
in `resolve_tts` itself: narrowing picks ONE compute type before tier
resolution runs (bf16 on a CUDA machine, since it outranks fp32), so an
all-bf16 plan list has nothing to fall back to on a genuine bf16-on-CUDA load
failure — **unless** a different, cpu-capable compute type (fp32) is ALSO
already downloaded, in which case `resolve_tts` appends fp32's cpu plan as a
last-resort tail after the bf16 plan (`fix(sidecar): downloaded-fp32 cpu tail
for bf16 plans`, 2026-07-17). A bf16-only download still fails honestly with
a single plan — no cpu fallback exists until fp32 is downloaded too.

## §6 Tests & verification

- Planner table tests: pin × downloaded × machine matrix for the narrowing.
- Catalog structure tests: three variants per card, artifacts point at the
  right repos, `est_bytes` present.
- `_h_models_catalog` payload tests: TTS `variants` emitted,
  recommended/supported correct per machine shape.
- Real-machine e2e (GB10): bf16 repo download → CUDA load → synthesis →
  whisper loopback; int8 repo → CPU likewise.
- Renderer: picker renders on TTS cards; pin → `download(repo)` flow.
- `sidecarVersion` bump.

## §7 Other TTS cards: alignment path (no action now)

The machinery is card-agnostic: any TTS card that grows a second
compute_type row (artifact → a self-contained variant repo) automatically
gets the picker, per-need download, and planner narrowing.

Verified inventory (2026-07-17): qwen3-tts is the only card with real,
size-significant existing variants.

| model | total | existing variants | verdict |
|---|---|---|---|
| qwen3-tts 0.6b/1.7b | 5.05 / 10.65 GB | fp32 + bf16 | this design |
| GPT-SoVITS v2pp | 1.29 GB | none (fp32 compute only; fp16 bins are wire compression) | keep single |
| MOSS-TTS-Nano | 0.73 GB | none | too small |
| Supertonic 3 | 0.40 GB | none | too small |
| Pocket TTS | 0.19 GB/lang | int8-only by design (no valid GPU int8 path) | keep single |
| sherpa piper | 0.08 GB | none | keep single |

Precision-variant research concluded 2026-07-17 (two agent passes; full
evidence in project memory `tts-precision-variant-research`), user decisions
applied:

- **GPT-SoVITS int8: spike APPROVED** (separate work, not in this plan).
  Two shipped community precedents use the identical split — int8 t2s
  decoders + fp32 vits (mikv39/gpt-sovits-onnx-custom: t2s 1.05s→407ms
  ≈2.6× on Ryzen 7700; AstraTTS ships the `quantize_dynamic(QInt8,
  MatMul/Gemm, exclude Conv)` recipe). Our t2s graphs are MatMul×121+Gemm×24
  with Conv×0 (ideal target; attention logits stay fp32). Expected CPU RTF
  0.6-0.75 → ~0.35-0.45. Constraint: int8 ops are CPU-EP-only — the variant
  row must gate to the cpu tier; cuda keeps fp32. If the spike passes
  (whisper loopback zh/en/ja, 嗯。-guard regression, cross-lingual clone A/B,
  runaway/early-EOS rate), it lands as one catalog row on this framework.
- **MOSS precision variants: WON'T DO** (user decision). int8 measured only
  ~1.4× on CPU with a real prosody risk (F0 std −33% in community A/B) on a
  model with a known silence-attractor (#277); GPU variants are pointless
  (upstream #55: MPS 6× slower than CPU — transfer-dominated at 100M params).
- GPT-SoVITS bf16: dropped (no tooling, patchy ORT CUDA bf16 kernels, AR
  loop is launch/memory-bound). fp16-CUDA: deferred (numerically likely safe
  — upstream torch default is half — but no bottleneck to relieve).
- GPT-SoVITS RoBERTa split: `RoBERTa.onnx` (571 MB) is the repo's largest
  file and optional (zh prosody only) — a zh-quality addon download would cut
  the base repo ~44%. Different axis (content, not precision); recorded, not
  scheduled.

## Out of scope

- MOSS/Supertonic/Pocket/GPT-SoVITS card changes.
- GPT-SoVITS fp16-bin expansion mechanism (stays).
- The WASM (LOCAL_INFERENCE) provider — separate peer provider, untouched.
