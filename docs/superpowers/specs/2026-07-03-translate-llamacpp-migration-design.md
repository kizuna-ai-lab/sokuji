# Native Sidecar Translation: llama.cpp + ONNX Migration — Design

**Date**: 2026-07-03
**Status**: Approved design, pending implementation plan

## Goal

Move the native sidecar's entire translation domain off torch/transformers:

- The 9 LLM translation cards (Qwen 2.5/3/3.5, TranslateGemma, HY-MT2/MT1.5) run on
  **llama.cpp** (`llama-server` subprocess, GGUF weights) with CUDA, Metal, and CPU tiers.
- The 13 Opus-MT pair cards run on **onnxruntime** (Xenova int8 ONNX exports, CPU-only).

What this buys:

- **macOS GPU path** (Metal) for translation — currently zero GPU support on macOS.
- **Q4/Q8 GGUF quantization**: TranslateGemma 4B drops from 8.6 GB (bf16) to 2.49 GB
  (Q4_K_M); VRAM footprint roughly quartered across the LLM cards.
- **`--fit` auto VRAM management** replaces the hand-rolled 1.2×+padding estimator for
  this domain, eliminating the silent AUTO→CPU fallback class of bugs (issue #271 /
  the TranslateGemma-misses-GPU-by-0.3GB bug). Insufficient VRAM now means partial
  layer offload, not a cliff to CPU.
- First concrete step of the two-family backend consolidation (ggml + ONNX); the
  llama runtime built here is directly reusable for the ASR migration later.

Hard cut: this feature is pre-release with no users. The 5 transformers translate
backends are **deleted** (git history is the rollback). No weight-migration or
orphan-cleanup work.

## Verified facts the design rests on (2026-07-03)

- All 9 LLM cards run on one recent llama.cpp build (≥ b8xxx, May 2026+):
  Hunyuan arch `hunyuan-dense` since b6058; Qwen3.5 arch `qwen35` since b7990 with
  correctness fixes through 2026-05; TranslateGemma = `gemma3` arch with a dedicated
  chat handler, language codes passed via request-level `chat_template_kwargs`
  (llama.cpp PR #19052, b7823+).
- GGUF sources: Qwen2.5-0.5B and all four HY-MT repos are official; Qwen3-0.6B
  official repo is Q8_0-only (Q4 from unsloth); Qwen3.5-0.8B/2B have no official GGUF
  (unsloth/bartowski); TranslateGemma has no official GGUF (mradermacher).
  Tencent's 2-bit/1.25-bit GGUFs require unmerged llama.cpp PR #19357 — excluded.
- Official binary channels: GitHub releases cover Windows CUDA + cudart, macOS arm64
  Metal, Vulkan/CPU everywhere — but **not Linux CUDA**. The **llama.app installer
  bucket** (`https://huggingface.co/buckets/ggml-org/install.sh`) fills that gap:
  per-SM single-file `llama-app` binaries (CUDA runtime statically embedded, only
  `libcuda.so.1` + glibc dynamic deps), plus official `cuda-probe`/`vulkan-probe`
  helper binaries, versioned URLs (e.g. `b9835`). Verified on the dev box
  (RTX 4070 SUPER → config `89`, 285 MB compressed / 496 MB unpacked,
  `llama serve --help` = the llama-server parameter set).
- llama-server modern defaults: `-ngl auto`, `--fit on` (auto layer-offload sizing
  with `--fit-target` MiB margin per device), `--jinja` on, `/health` returns 503
  while loading and 200 when ready.
- Xenova Opus-MT ONNX exports exist for all 13 pairs (incl. the `en-jap` naming
  quirk), 6 files/pair, ~115 MB/pair int8 — the same exports the WASM path uses in
  production.

## Architecture

### New components

```
sidecar/sokuji_sidecar/
├── llama_runtime.py        # llama-app binary acquisition + process management
└── translate_backends.py   # REWRITTEN: 4 backend classes, zero torch
```

`translate_engine.py` is unchanged — the backend contract
(`load(model_ref, device, compute_type)` / `translate(text, system_prompt, src, tgt,
wrap) -> (text, n_tokens)` / `unload()` / `is_loaded`) is preserved, so the fallback
chain, TPS benchmark, and WS protocol all carry over.

### llama_runtime.py

**Binary acquisition** — pinned bucket version (constant, e.g. `b9835`) + a sha256
table for every asset recorded at development time. Upgrading llama.cpp = bump one
constant + rerun the checksum script.

| tier | platform | source | asset | size |
|---|---|---|---|---|
| gpu-cuda | Linux | llama.app bucket | official `cuda-probe` → `cuda/<sm>/llama-app.zst` | ~285 MB |
| gpu-cuda | Windows | GitHub release | `win-cuda-12.4` zip + cudart zip | ~254+373 MB |
| gpu-metal | macOS arm64 | llama.app bucket | `metal/<m1..m5>/llama-app.zst` (sysctl chip probe) | ~11 MB |
| cpu | all | bucket / GH release | cpu flavor | 15–17 MB |
| gpu-vulkan (reserved) | Linux/Win | same | vulkan flavor | ~30 MB |

The CPU tier downloads its own cpu-flavor binary (15 MB) rather than reusing the
CUDA binary with `-ngl 0` — the CUDA binary cannot start on driverless machines, and
15 MB buys an always-available floor. Storage:
`~/.config/Sokuji/llama-bin/<version>/<flavor>/llama`. Probe results are cached.
Downloads go through `native_models.py`'s existing progress/cancel protocol; the
binary is registered as a **dependency artifact of each translate model download**,
so downloading a model queues the required binary automatically (one extra row in
the download UI).

**Process management (`LlamaServerProc`)**:

```
llama serve -m <gguf> --host 127.0.0.1 --port <N> \
  --no-webui -c 4096 --log-colors off [--fit-target <MiB>]
```

(Entry point per platform: the bucket's single-file `llama` app with the `serve`
subcommand on Linux/macOS; `llama-server.exe` from the GitHub release zip on
Windows. Flags are identical.)

- Port: bind(127.0.0.1, 0) to reserve a free port, release, pass it in (same trick
  as the sidecar's own WS port).
- Readiness: poll `GET /health` (503 = loading, 200 = ready), 120 s timeout; if the
  child exits during load, capture the stderr tail into `BackendLoadError`.
- VRAM: do **not** pass `-ngl`; rely on `auto` + `--fit on`. `translate_init`'s
  existing `reserved_bytes` (ASR/TTS reservation) maps to
  `--fit-target = 1024 + reserve_MiB` — the "leave room for other stages" semantics
  survive, but the actual fitting is done by llama-server against real VRAM.
  `accel.py`'s weight-based VRAM estimator is retired for this backend.
- Orphan protection: Linux `prctl(PR_SET_PDEATHSIG)` via preexec_fn; Windows Job
  Object via ctypes (no new deps); atexit as a belt-and-braces layer.
- Logs: stderr piped into the sidecar log stream (LogsPanel visibility).
- unload / model switch: terminate → 5 s grace → kill; VRAM returns immediately.

### Translate backends

Three thin llama.cpp backend classes share one base (per-family prompt policy is
preserved verbatim from the current transformers backends); registered names map
1:1 onto catalog rows so `_installed()` gating keeps working:

| backend NAME | cards | request shape |
|---|---|---|
| `llamacpp_qwen` | Qwen2.5-0.5B, Qwen3-0.6B, Qwen3.5-0.8B/2B | system+user; `/no_think` appended for Qwen3; `<transcript>` wrap; `_clean_output` reuse |
| `llamacpp_hunyuan` | HY-MT2/MT1.5 1.8B/7B | no system role; instruction prefix inside the user message (current `_hunyuan_prompt`) |
| `llamacpp_gemma` | TranslateGemma 4B | plain user text + request-level `chat_template_kwargs: {source_lang_code, target_lang_code}` (reuse `_GEMMA_LANG_CODE`); fallback path = self-rendered prompt against `/completion` |

All requests: `POST /v1/chat/completions` (stdlib urllib, localhost, non-streaming),
`temperature 0`, `max_tokens 512` (gemma 256, matching today), per-request timeout
120 s (worst case: 7B on CPU). `usage.completion_tokens` feeds the existing TPS
benchmark.

`OpusOnnxTranslateBackend` (`opus_onnx_translate`):

- Artifacts: the 6-file Xenova export set (`config.json`, `generation_config.json`,
  `tokenizer.json`, `tokenizer_config.json`, `onnx/encoder_model_quantized.onnx`,
  `onnx/decoder_model_merged_quantized.onnx`).
- Tokenizer: the `tokenizers` library loading `tokenizer.json` directly — no
  transformers, no torch. `decoder_start_token_id`/`eos_token_id` read from
  generation_config/config.
- Greedy decode loop (~200 lines, numpy): encoder runs once; first decoder step
  takes the no-past branch of `decoder_model_merged`, subsequent steps feed
  past_key_values. Input truncated at 512 tokens; max_new_tokens 512. Precedent:
  the moss_tts/qwen3_tts ORT loops in this codebase.
- **CPU-only deployment** (intentional change): int8 78M-param Marian is
  ~100 ms/sentence on CPU; ORT's CUDA EP handles int8 quantized ops poorly (often
  silently falls back to CPU while occupying VRAM). Opus therefore never competes
  for VRAM, and behavior is identical on macOS and GPU-less machines. The GPU badge
  disappears from Opus cards.

### Catalog changes

The 9 LLM rows become (deployment tuples):

```
Deployment("llamacpp_<family>", "gpu-cuda",  "<quant>", <gguf ref>, ...)
Deployment("llamacpp_<family>", "gpu-metal", "<quant>", <gguf ref>, ...)
Deployment("llamacpp_<family>", "cpu",       "<quant>", <gguf ref>, ...)
```

FP8 variants are deleted (compressed-tensors is a transformers-ism; Tencent low-bit
GGUFs blocked on upstream PR #19357).

Quant ladder — every LLM card exposes exactly two variants; defaults by size:

| card | GGUF source | default | optional |
|---|---|---|---|
| Qwen2.5-0.5B | Qwen official | **Q8_0** (676 MB) | Q4_K_M (491 MB) |
| Qwen3-0.6B | official (Q8) / unsloth (Q4) | **Q8_0** (639 MB) | Q4_K_M (397 MB) |
| Qwen3.5-0.8B | unsloth | Q4_K_M (533 MB) | Q8_0 (812 MB) |
| Qwen3.5-2B | unsloth | Q4_K_M (1.28 GB) | Q8_0 (2.01 GB) |
| TranslateGemma 4B | mradermacher | Q4_K_M (2.49 GB) | Q8_0 (4.13 GB) |
| HY-MT2/MT1.5 1.8B | Tencent official | Q4_K_M (1.13 GB) | Q8_0 (1.91 GB) |
| HY-MT2/MT1.5 7B | Tencent official | Q4_K_M (4.62 GB) | Q8_0 (7.98 GB) |

Rationale for the ≤0.6B Q8_0 default: Q4 quality damage is material on sub-1B
models while the size delta is ~200 MB.

The 13 Opus rows become a single
`Deployment("opus_onnx_translate", "cpu", "int8", <Xenova repo>, ...)`.

### Model + binary distribution

**Update 2026-07-03 (Task 14b):** artifacts are sourced directly from their
**upstream HF repos** — mirroring to an owned namespace is deferred (the mirror
script from Task 14 stays in tree, unused, as a future option). Upstream GGUF
repos (Qwen/unsloth/mradermacher/tencent) hold many quants per repo, so
`Deployment.artifact` for a GGUF row is now an exact upstream file path
(`"{org}/{repo}/{filename}"`, split via `catalog.split_artifact`) rather than a
bare repo id — one card-variant, one pinned filename, verified 2026-07-03 (see
`catalog._GGUF_SOURCES`). Opus rows keep a plain 2-segment upstream repo id
(`Xenova/opus-mt-{pair}`) and pin an explicit 6-file set (`native_models.OPUS_FILES`)
out of that repo's larger (multi-framework) export set. Download specs are
`{"files": [(repo, filename), ...]}`-shaped for both GGUF and Opus cards — one
entry for GGUF, six for Opus — resolved with `hf_hub_download`, not a repo
snapshot. Trade-off accepted: unsloth/mradermacher/bartowski/tencent repos are
mutable third-party repos with no owned sha256 manifest or deletion-proofing;
revisit mirroring if that becomes a problem in practice.

### accel.py changes

- `_installed()`: `llamacpp_*` is always reported installed on supported platforms —
  the binary is a downloadable artifact (like model weights), not a Python runtime,
  so availability is enforced at `load()` with a clear missing-artifact error plus
  the dependency-download path, never by silently filtering plans.
  `opus_onnx_translate` ready ⇔ `onnxruntime` + `tokenizers` importable.
- Translation rows gain `gpu-metal` deployments — `_tier_available` already handles
  the tier (`machine.apple_silicon`); no resolver logic changes.
- `select_variant` for llamacpp cards: pin wins, else the card's default variant.
  No VRAM math (`--fit` guarantees any quant runs, worst case partially offloaded).
- `_h_list_variants` for llamacpp cards: `supported` reflects tier availability
  only; `sizeBytes` reports download size. Reason strings updated accordingly.
- `_h_models_catalog`: each translate card gains a variant summary field
  (e.g. `variantIds: ["q4_k_m", "q8_0"]`).

### Renderer changes

`NativeModelManagementSection.tsx`: the variant-picker gate switches from the
hardcoded `selectId.startsWith('hy-mt')` prefix match to data-driven
`variantIds.length > 1` from the catalog payload. Variant labels already render
`computeType.toUpperCase()` generically ("Q4_K_M", "Q8_0"). No protocol field
changes otherwise.

## Error handling

| scenario | behavior |
|---|---|
| binary/GGUF missing | `translate_init` errors naming the missing artifact; binary rides the model download queue as a dependency |
| child dies during load | stderr tail → `BackendLoadError` → existing plan fallback chain (gpu plan → cpu plan), honest `fallbackReason` (kills the silent-downgrade class from #271) |
| child crashes mid-session | `translate()` sees connection-refused → checks child liveness → one in-place restart on the same plan (GGUF already on disk, seconds); second failure reports the error |
| request timeout | 120 s per request; treated as the crash path |
| corrupt GGUF | sha256 verified at download completion; runtime load refusal surfaces stderr |

## Testing

- **Unit (pytest, existing sidecar style)**: `LlamaServerProc` lifecycle against a
  fake executable (script simulating /health 503→200, crash-on-start, crash-mid-run);
  the three prompt families asserted against a stub HTTP server (`/no_think`,
  hunyuan prefix, gemma `chat_template_kwargs`); Opus decode loop against stubbed
  `InferenceSession`s (KV loop, truncation, EOS); `test_catalog`/`test_accel`
  updated for the new rows.
- **Local integration (RTX 4070 SUPER)**: one representative card per family
  end-to-end (download Q4 → serve → zh↔en round trip), TPS recorded against the
  outgoing transformers backends; Opus ru-en real run.
- **Metal**: GitHub Actions macos-14/15 arm64 runners have M-series chips with
  Metal — CI smoke test (Qwen2.5-0.5B Q8 download + one translation). No blind
  shipping.
- **Renderer**: variant-gate tests updated in `NativeModelManagementSection` /
  `nativeCatalog` suites.

## Out of scope / future

- Vulkan tier (AMD/Intel GPUs on Linux/Windows): binaries are official and tiny;
  the tier slot and the flavor mapping are designed in, activation is a follow-up.
- Tencent 2-bit/1.25-bit GGUFs: revisit when llama.cpp PR #19357 merges.
- llama-server router mode: not useful for one-model-at-a-time; revisit only if a
  multi-model-resident feature appears.
- venv shrink: torch stays for ASR/TTS this phase; removing it is the endgame of
  the two-family consolidation, not this spec.
- ASR migration to the ggml family (whisper.cpp, FunASR runtime-llamacpp): separate
  spec; reuses `llama_runtime.py`'s acquisition/process layer.
