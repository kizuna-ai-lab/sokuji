# Qwen3-ASR WebGPU worker — fleet validation

**Date**: 2026-09-02
**Branch**: `feat/qwen3-asr-webgpu-worker` (PR 2)
**What was tested**: the real `qwen3-asr-webgpu.worker.ts` driven through the same message
protocol `AsrEngine` uses (init → Int16@24kHz audio chunks paced like the recorder → flush →
dispose), on all three fleet GPUs, against the layout-v2 model on the Hub. The harness sources
live in the job scratch dir (`worker-harness/`, plus `vite.harness.config.ts`), not committed.

## Bug found and fixed first

Every clip on every GPU decoded to repeated `!` (token 0). Cause: the worker loaded ORT from
the bare `onnxruntime-web` export, which resolves to the **wasm-only** bundle
(`ort.bundle.min.mjs`); an `InferenceSession` created there with `executionProviders:['webgpu']`
does not run on the GPU and returns flat logits. The other WebGPU workers never hit this
because their model runs through Transformers.js's own ORT. Fix (commit 363d5a0d): import from
`onnxruntime-web/webgpu` via a new `_shared/onnxruntime-webgpu.ts` shim (the entry the spike
page used; it also carries the wasm EP the VAD session needs).

## Results (real worker, per-utterance recognition time; auto = no forced language)

All clips transcribed with no errors, no timeouts, one VAD segment per clip, no `!` collapse.

| box | variant | jfk (en) | zh-1906 | zh-1883 (was the collapse clip) | ja-1828 | rec time |
|---|---|---|---|---|---|---|
| GB10 (NVIDIA Vulkan) | q4 | ✓ | ✓ | ✓ correct | ✓ | 0.55–1.0 s |
| RTX 4070 SUPER | q4f16 | ✓ | ✓ | ✓ correct | ✓ | 1.0–1.5 s |
| Mac mini M4 | q4f16 | ✓ | ✓ | ✓ correct | ✓ | 0.58–1.0 s |

Forced language (`language <Name><asr_text>` appended), Japanese clips, all three boxes: all
transcribe, no collapse. The hard FLEURS clips show the 0.6B's expected proper-noun / kana
slips (e.g. マリア王 / ファティマ, 語りネゴ for カタルーニャ) — a model-quality limit, not a
worker bug; the same clips show the same class of error in the CPU and page runs.

Load time (cold, model already in IndexedDB): ~11 s on the fleet boxes, ~4.7 s on GB10. The
first utterance pays WebGPU shader compilation; the worker warms up on 1 s of silence during
init so the first real utterance is not slow.

## Coverage and gaps (stated honestly)

- The worker + the AsrEngine message contract are validated end to end on real GPUs.
- Variant selection (`selectVariant` → q4f16 with shader-f16, q4 without), readiness, blob
  URLs and engine routing are covered by unit tests (`modelManifest.qwen3Asr.test.ts`,
  `AsrEngine.qwen3.test.ts`) and share the exact machinery Granite/Voxtral use.
- **Not done on the fleet**: a full packaged-app click-through (download UI →
  ModelManagement → picker), because the fleet boxes are set up for headless Chrome, not app
  installs. The download/variant/readiness path is the shared, already-shipping one.
- **Not done**: a formal GPU-memory-over-50-utterances graph. The harness ran 4 utterances per
  session on one loaded instance with stable timing and no growth in failures; the KV cache is
  disposed every step (`greedyDecode`) and asserted by unit test.
- **GB10 `q4f16` is not applicable**: its NVIDIA/Vulkan adapter has no `shader-f16`, so the
  device correctly selects `q4`.

## `recommended` decision

Kept **`recommended: false`** for now. English and Chinese are excellent; Japanese is usable
but the 0.6B makes proper-noun errors on hard sentences (the 1.7B is the CJK quality tier).
It is also WebGPU-only, so it does not fill the "no GPU-free recommended model" gap for
Japanese users. A reasonable candidate to recommend for zh/en later; leaving the call to
jiangzhuo rather than flipping it unprompted.
