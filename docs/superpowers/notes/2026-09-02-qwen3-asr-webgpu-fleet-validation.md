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

No worker or runtime errors and no timeouts on any clip; each clip produced one VAD segment and
no output collapsed to `!`. (Recognition quality is discussed below — "no errors" here means
the pipeline, not the transcript.)

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

## Second bug: audio dropped while a decode is running (and why the obvious fix hung)

The first worker version, cloned from the granite scaffold, `await`ed the transcription inside
`feedAudio` while holding `processingVad`, so every audio chunk that arrived during a decode
(0.5–2.5 s) was silently dropped. On the microphone path a natural pause usually follows an
utterance and hides this; on gapless system audio the loss lands on the next sentence's first
words. Fixed the way voxtral-3b does it: `void transcribe(...)` on SpeechEnd / the 20 s cap /
flush, decodes serialized through `currentDecodePromise`, and `handleFlush`/`handleDispose`
await the in-flight decode before releasing the sessions.

That change alone **hung the worker permanently** (zero results, no error, every later decode
pending). Cause: `onnxruntime-web/webgpu` runs `session.run()` on the Asyncify build of the wasm
runtime (`ort-wasm-simd-threaded.asyncify.wasm`; `_OrtRun` is awaited, and the bundle has no run
mutex). A VAD frame's wasm-EP `run()` arriving while the GPU decode is Asyncify-suspended
re-enters the same wasm instance, which Emscripten defines as undefined behaviour. The old
`processingVad` drop was the only thing keeping the two apart. voxtral-3b never hits this
because its VAD lives on the bare `onnxruntime-web` (wasm-only bundle, its own instance) while
Transformers.js holds its own `onnxruntime-web/webgpu`. The worker now uses the same split: VAD
via `_shared/onnxruntime-all`, the model via `_shared/onnxruntime-webgpu`, `wasmPaths` set on
both envs. Rule for any future raw-ORT WebGPU worker: never run a second session on the webgpu
ORT instance while a decode is in flight — give the VAD its own instance.

A/B on the GB10 (q4, auto language), old = commit 7e032376, new = this fix, identical audio
fed as one continuous stream at 1.7× real time:

| stream | old worker | new worker |
|---|---|---|
| 4 clips back to back with their own silences (45.7 s) | 4 segments; Japanese clip lost its first second ("インターネットで" missing, segment 6.5 s) | 4 segments; Japanese complete (8.8 s); no hang; dispose clean |
| same 4 clips with head/tail silence trimmed, 34.2 s of continuous speech | 3 segments totalling 31.2 s of audio (2.9 s lost); Japanese head missing again | 3 segments totalling 33.9 s (all of it); Japanese complete |
| all 13 clips trimmed, 112.3 s of continuous speech — the 20 s cap fires twice | 8 segments, 93.6 s captured (18.7 s lost): the JFK clip and one short Japanese clip vanish entirely, and text is missing across a cap boundary ("…敲下垂直。" → "二零一一年八月完工…") | 9 segments, 109.7 s captured (the rest is VAD edge trimming); text continues across the cap boundary ("…找到自己的" → "立场，并能够…"); no hang; dispose clean |

The 20 s cap still splits a sentence mid-way — that is the cap's job — but no audio is lost on
either side of the split any more.

Where the two zh clips were hard-spliced into one segment, both workers skipped the end of the
first sentence. That is the model on an abrupt splice, not dropped audio: the new worker's
segment durations account for all of the input, the same two clips are transcribed in full when
a pause separates them, and feeding just that spliced pair as the very first segment (no decode
in flight at all) reproduces the identical omission on a 12.96 s segment out of 13.12 s.

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
