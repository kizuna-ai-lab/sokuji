# Native Quant-Variant Selection + FP8 Runtime (Track A.1)

## Problem

The LOCAL_NATIVE provider downloads and loads a single full-precision (bf16)
copy of each model. On a consumer GPU the pipeline's stages share VRAM, so a
large model forces a degrade to CPU — e.g. with Voxtral ASR (~8 GB) resident on
a 12 GB card, HY-MT2-7B (bf16 ~15 GB) cannot co-reside and runs on the CPU
floor (single-digit tok/s). Pre-quantized variants exist (HY-MT2 ships FP8 repos
~8 GB) but nothing today picks or runs them: there is no quantized runtime, the
catalog maps one model to one repo, and the hardware probe does not even report
total VRAM or GPU architecture.

## Goal

When a user selects a model, an algorithm picks — **at download time** — the
variant best suited to this machine (e.g. download HY-MT2-7B's ~8 GB FP8 repo
instead of its ~15 GB bf16 repo), and the session loads that same variant. The
choice accounts for VRAM shared with the other pipeline stages (ASR + TTS) and
the GPU's architecture, defaults to automatic with a manual override, and shows
the user which variant was chosen and why.

This is sub-project **A.1** of a larger effort. Its decomposition and the
broader conceptual model are recorded in Non-Goals below so this spec stays
single-scoped.

## Non-Goals

- **No GGUF / llama.cpp runtime** (Track A.2) — the universal Apple/AMD/Intel/CPU
  + low-VRAM path. A.1 ships only the FP8 (compressed-tensors) runtime.
- **No NVFP4 (Blackwell) or MLX (Apple) runtimes** (Track A.3).
- **No model mirroring / self-hosting / offline self-quant pipeline** (Track B) —
  the workstream that publishes our own variant repos (de-gating + gap quants,
  especially large ASR speech-LLMs) to our HF org. A.1 consumes only the
  existing **upstream** HY-MT2-FP8 repos. Track B is transparent to A.1: it only
  ever adds repo ids to the catalog.
- **No FP8/quant variants for ASR or TTS models** in A.1. The selection brain is
  built **stage-general** (it can pick variants for any stage), but A.1 populates
  variants only for the translation stage (HY-MT2), because that is where
  upstream pre-quant repos exist today. ASR/TTS variants arrive via Track B.
- **No on-load self-quantization** (e.g. bitsandbytes NF4). All variants are
  downloadable pre-quantized repos.
- **No new model families.** A.1 adds FP8 variants only to the existing
  `hy-mt2-1.8b` / `hy-mt2-7b` rows. Gemma and Qwen rows are untouched (no
  upstream transformers-native quant).

## Architecture

A model now has **variants** (bf16 / FP8 / … — each a downloadable repo). A pure
function `select_variant` picks the best variant for `(model, machine, other
stages)`. The download path asks the sidecar which variant to fetch; the load
path resolves to the same variant. Everything keys on a repo id, so a variant's
source (upstream vs a future Track-B mirror) is irrelevant to this code.

```
download:  renderer → list_variants(model, asrId, ttsId) → sidecar select_variant
                    → download the chosen variant's repo
load:      resolve_translate → select_variant → plans=[chosen, cpu floor]
                    → load_with_fallback (runtime OOM safety net) → backend.load
```

`select_variant` is **deterministic**: the same `(model, machine, pipeline
config)` yields the same variant, so download-time and load-time calls agree
without persisting any variant state.

### Why this risk is already closed

Both HY-MT2-FP8 repos declare `quantization_config.quant_method =
"compressed-tensors"`, `format = "naive-quantized"`, with `model_type =
"hunyuan_v1_dense"` (the same native arch as the bf16, no `trust_remote_code`).
So the runtime dependency is exactly **`compressed-tensors`**, and transformers'
built-in compressed-tensors integration loads the checkpoint when you call
`from_pretrained` without forcing a dtype. No custom loading code.

## Components / files

| File | Change |
|---|---|
| `sidecar/sokuji_sidecar/accel.py` | extend `Gpu` with `vram_mb` (populated) + `capability`; populate them in `_nvidia_gpus`/probe via torch; add `select_variant`; route `resolve_translate`/`resolve` through it; gate FP8 backend in `_installed` |
| `sidecar/sokuji_sidecar/catalog.py` | add `min_capability` + `est_bytes` to `Deployment`; add bf16+fp8 variant deployments to the two HY-MT2 rows |
| `sidecar/sokuji_sidecar/translate_backends.py` | `HunyuanTranslateBackend.load` branches on `compute_type == "fp8"` (load via compressed-tensors, no forced dtype) |
| `sidecar/sokuji_sidecar/native_models.py` | variant-aware `download_specs` (download the selected variant's repo); per-variant `model_size` |
| `sidecar/sokuji_sidecar/server.py` (or the model handler) | `list_variants` WS message |
| `sidecar/requirements.txt` | add `compressed-tensors` |
| `src/lib/local-inference/native/*` | `list_variants` client call + types |
| `src/components/Settings/sections/NativeModelManagementSection.tsx` | model card: supported-variants + sizes pre-download, resolved variant + size post-download; advanced override |
| sidecar + renderer tests | as in Testing |

## Hardware probe extension

`Gpu` today is `Gpu("nvidia", "", 0)` — name empty, `vram_mb=0`, no arch. A
download-time budget needs both total VRAM and architecture.

- Add `Gpu.capability: tuple[int, int] | None` (CUDA compute capability, e.g.
  `(8, 9)` for Ada).
- Populate `Gpu.vram_mb` and `Gpu.capability` best-effort via torch:
  `torch.cuda.get_device_properties(i).total_memory` and
  `torch.cuda.get_device_capability(i)`. Any failure leaves `vram_mb=0` /
  `capability=None`, which the selector treats as "no usable GPU budget" so the
  CPU floor stays reachable. Keep the existing `ctranslate2.get_cuda_device_count`
  for the count; torch supplies VRAM + capability.

## Variant catalog

`Deployment` gains two optional fields (defaults keep every existing row valid):

- `min_capability: tuple[int, int] | None = None` — minimum CUDA compute
  capability for a GPU variant (FP8 → `(8, 9)`; bf16 → `None` = any CUDA).
- `est_bytes: int | None = None` — estimated footprint for budgeting; `None`
  falls back to `model_size(repo)` at selection time.

Variants are added to the two HY-MT2 rows (one GPU deployment per variant + the
CPU floor):

| Model | Variant deployments |
|---|---|
| `hy-mt2-7b` | `gpu-cuda bf16 → tencent/Hy-MT2-7B`; `gpu-cuda fp8 → tencent/Hy-MT2-7B-FP8` (min_capability (8,9)); `cpu float32 → tencent/Hy-MT2-7B` |
| `hy-mt2-1.8b` | `gpu-cuda bf16 → tencent/Hy-MT2-1.8B`; `gpu-cuda fp8 → tencent/Hy-MT2-1.8B-FP8` (min_capability (8,9)); `cpu float32 → tencent/Hy-MT2-1.8B` |

`gemma_translate`, the Qwen rows, and all ASR/TTS rows are unchanged
(single bf16 GPU + cpu floor).

## `select_variant` algorithm

A pure, stage-general function in `accel.py`:

```
select_variant(model, machine, reserved_bytes, pin=None) -> Deployment
```

1. **Budget** = `gpu.vram_mb_bytes − reserved_bytes − headroom`, where the GPU is
   the first usable `machine.nvidia` entry. `headroom` reuses the existing VRAM
   gate intuition (a model needs its weights × a transient factor + a fixed CUDA
   context slab — reuse `_VRAM_WEIGHT_FACTOR` / `_VRAM_CONTEXT_BYTES`).
2. **Reserve** = sum of the estimated footprints of the *other* selected stages
   (ASR + TTS) via `model_size(other_stage_id)`. The caller passes the resolved
   reserve; the renderer/load path supplies the pipeline's ASR + TTS ids.
3. **Candidate GPU variants** = the model's gpu deployments where: `backend ∈
   machine.installed` (so the FP8 variant only survives when `compressed_tensors`
   is importable — see `_installed`), AND `machine.capability ≥
   d.min_capability` (None = no gate), AND `est_bytes(d) ≤ budget`.
4. **Pick** the highest-quality candidate — quality order **bf16 > fp8** (encode
   as an explicit rank so future formats slot in: `bf16 > fp8 > int4 > nvfp4 …`).
   If no GPU variant qualifies, return the CPU floor deployment.
5. **Pin**: if `pin` names a variant that is itself a valid candidate (passes the
   same arch/installed/budget checks), return it directly — the manual override,
   mirroring the existing `override` semantics.
6. **Conservative fallback**: if `gpu.vram_mb == 0`/`capability is None` or a
   needed `est_bytes`/reserve can't be determined, do not gamble — skip GPU quant
   variants and return bf16-if-it-fits-else-CPU, and log the reason.

`est_bytes(d)` = `d.est_bytes` if set, else `model_size(d.artifact)` (HF download
bytes ≈ on-GPU weight bytes for these checkpoints; the headroom absorbs the
approximation).

### Integration with the existing resolver

`resolve_translate` / `resolve` call `select_variant` to choose the GPU variant,
then build `plans = [chosen_variant, cpu_floor]` and hand them to the unchanged
`load_with_fallback`. This makes `select_variant` the single source of truth for
*which variant*, while `load_with_fallback`'s measured-free-VRAM gate remains the
runtime OOM safety net (estimate-based selection at download time; measured-based
safety at load time — complementary, not redundant).

## Download wiring

- New WS message `list_variants { model, asrId, ttsId } →
  { variants: [{ id, computeType, repo, sizeBytes, supported, reason }],
  recommended: <id> }`. The sidecar computes the candidate set + sizes
  (`model_size(repo)` per variant) + the `select_variant` recommendation.
  `supported=false` entries (e.g. FP8 on a pre-Ada GPU, or a variant too big) are
  returned with a reason so the UI can explain, but the UI shows only supported
  ones (see UI).
- `download_specs` becomes variant-aware: given the chosen variant it returns
  that variant's repo (the FP8 repos need no special `ignore`; reuse the existing
  shape). The renderer downloads the recommended (or pinned) variant's repo.
- At session load, `resolve_translate` re-derives the variant via `select_variant`
  with the session config's ASR + TTS ids → loads the same repo the download
  fetched (deterministic, so they agree).

## FP8 runtime

`HunyuanTranslateBackend.load` branches on `compute_type`:

- `"fp8"` → `AutoModelForCausalLM.from_pretrained(model_ref, dtype="auto",
  local_files_only=True).to(device).eval()` — **no forced dtype**; transformers'
  compressed-tensors integration reads the checkpoint's `quantization_config` and
  applies FP8. Still `trust_remote_code=False` (native `hunyuan_v1_dense`).
- `"bfloat16"` / `"float32"` → the existing path.

`requirements.txt` gains `compressed-tensors`. `_installed()` gains a mapping so
the **FP8 variant** is gated on the loader being importable. Because variant
backend filtering is by `d.backend ∈ machine.installed`, and bf16 and FP8 share
the `hunyuan_translate` backend NAME, the gate is expressed at the **variant
(compute_type) level**, not just the backend NAME: `select_variant` additionally
drops an `fp8` variant when `compressed_tensors` is not importable. (Concretely:
extend the candidate filter to check a small `_format_ready(compute_type)` helper
alongside `backend ∈ installed`.)

## Renderer UI (model card)

Two states on the native translation model card
(`NativeModelManagementSection`):

- **Before download** — list every **supported** variant for this machine, each
  with **its size**, the recommended one highlighted:
  `● FP8 · 8.0 GB — recommended (fits 12 GB with ASR+TTS reserved)` /
  `○ bf16 · 15 GB — too big`. The "advanced: choose variant" override is selecting
  a different supported row (pins it). A variant the machine cannot run at all is
  not shown.
- **After download** — collapse to the single downloaded variant + its size
  (`FP8 · 8.0 GB`), detected from which variant repo is cached.

Re-evaluate on pipeline/hardware change: if the selected ASR/TTS change the
reserve such that the downloaded variant no longer fits, show a note offering a
re-download of the now-recommended variant.

## Error handling

- `compressed_tensors` missing → FP8 variant is dropped from candidates →
  selector never offers/downloads it; falls to bf16-if-fits-else-CPU. A missing
  dependency can never produce an undownloadable/unloadable choice.
- GPU budget too small for any variant → CPU floor, UI notes it.
- Estimate/probe unavailable → conservative bf16-if-fits-else-CPU (never gamble
  on the whole card), logged.
- `load_with_fallback` still catches a runtime OOM on the chosen variant and
  falls to the CPU floor.

## Testing

- **`select_variant` (pure, no GPU):** a matrix of total VRAM (6/8/12/24/128 GB)
  × capability (Ada `(8,9)` vs Ampere `(8,6)`) × reserve → asserts the chosen
  variant. Specifics: FP8 excluded when `capability < (8,9)`; FP8 chosen on a
  12 GB Ada box with a light ASR reserve; bf16 chosen when it fits; CPU floor when
  nothing fits; `pin` honored when valid and ignored when the pinned variant
  doesn't fit; conservative fallback when `vram_mb==0` or `compressed_tensors`
  absent.
- **Probe:** `vram_mb` and `capability` populated from a mocked torch; failures
  degrade to `0`/`None`.
- **Catalog:** the two HY-MT2 rows expose bf16 + fp8 + cpu deployments with the
  right repos and `min_capability`.
- **`list_variants` handler:** returns supported variants with sizes + a
  recommendation for a mocked machine.
- **FP8 load (`SOKUJI_RUN_GPU`, gated):** on the Ada dev box (sm_89), with
  `compressed-tensors` installed, load `tencent/Hy-MT2-7B-FP8` via the engine and
  translate one sample; assert device cuda + non-empty output. (Needs disk space
  freed for the ~8 GB download.)

## Risks / caveats

- **Primary risk (FP8 format) is resolved:** compressed-tensors / naive-quantized
  → dependency = `compressed-tensors`, loader = transformers built-in. The gated
  GPU test confirms it end-to-end.
- `est_bytes` uses HF download bytes as a VRAM proxy; the headroom factor absorbs
  the slack. KV cache for short translation contexts is small.
- **Ada FP8 is largely weight-only** (memory win, limited speedup vs Hopper's
  hardware scaling) — acceptable: a single-stream translator wants the VRAM
  saving, not batch throughput.
- The dev disk is full; freeing space is a prerequisite for the FP8 GPU
  validation (environment, not code).
