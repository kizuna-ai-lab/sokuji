# ASR decode handoff (#470 / #497) — GB10 validation

**Date**: 2026-09-06
**Branch**: `fix/nonblocking-asr-decode` (PR #497, contributor commit c008509e + review follow-ups)
**What was tested**: the real `whisper-webgpu`, `cohere-transcribe-webgpu` and
`granite-speech-webgpu` workers, PR head vs. the pre-PR copies from `main`, driven through the
same message protocol `AsrEngine` uses (init with `fileUrls` / `hfModelId` / `dtype` / language /
`ortWasmBaseUrl` / `vadModelUrl` → Int16@24 kHz chunks paced at ~1.7× real time → flush →
dispose), on the GB10 (NVIDIA, Vulkan, headless Chromium 151 via the Playwright headless shell,
`--use-vulkan=native`). Same harness shape as the qwen3 run in
`2026-09-02-qwen3-asr-webgpu-fleet-validation.md`; sources live in the job scratch dir
(`worker-harness/asr/`, `vite.harness.config.ts`, `run_asr.py`), not committed.

## Stream

Eight Japanese clips (4 Common Voice + 4 FLEURS), each trimmed of its own head/tail silence and
concatenated into one gapless stream of **70.17 s** of continuous speech, 2.5 s of silence only at
the very end. The 20 s max-speech cap closes the first segment; the VAD closes the rest. The VAD
segmentation is deterministic: every run below, old or new, whisper or cohere, produced the same
six `startSample` / `durationMs` pairs as the qwen3 run on the same clips (20000, 5600, 10656,
8896, 10016, 10016 ms), so "captured" below is a property of what the worker was fed, not of the
VAD. The ~5 s between 70.17 and 65.18 is VAD edge trimming, identical across all new-worker runs.

## Audio captured, old vs. new

| worker (q4) | pre-PR (`await` inside feedAudio) | PR head (`void` + serialized chain) |
|---|---|---|
| whisper-small | **32.13 s** in 3 segments, 4 speech_starts — the two clips after the cap boundary vanish entirely, the stream resumes mid-clip, the last segment is a 2.2 s tail ("になります") | **65.18 s** in 6 segments, 6 speech_starts, 0 errors |
| cohere-transcribe | 61.22 s in 6 segments — segment 2 is 2.40 s ("力であるが。"), segments 3/4 are 0.3–0.5 s short | **65.18 s** in 6 segments, segment 2 is the full 5.60 s ("知性は構成されたものによって所与のものを超える力であるが、"), 0 errors |

whisper-small q4 decodes a 20 s segment in ~15 s on this GPU (RTF ≈ 0.75), which makes the
decode-while-ingesting window enormous and the pre-PR loss dramatic. cohere decodes the same
segment in ~2 s, so the pre-PR loss is confined to the first seconds after each boundary — exactly
the "first words of the next utterance" symptom #470 describes, here the head of clip 4 lost
during the 2.1 s decode of the capped segment.

The 20 s cap happened to land on the clip 3 / clip 4 join (the three trimmed Common Voice clips
sum to ≈ 20.0 s; segment 2 starts at sample 321024 = 20.06 s), so this stream does not split a
sentence at the cap the way the qwen3 run did. What it does show is that nothing is lost on
either side of the cap: with both new workers segment 1 ends on clip 3's last words
(「…面白みのないものしか見つからなかった」) and segment 2 opens on clip 4's first words
(「知性は構成されたものによって…」), whereas the pre-PR cohere kept only clip 4's tail
(「力であるが。」, 2.40 s of 5.60) and the pre-PR whisper lost clips 4 and 5 outright.

## Flush + dispose issued while decodes are in flight (#470 acceptance)

`earlyDispose=1`: the harness posts `flush` and then `dispose` immediately after the last audio
chunk, while decodes are still queued, and counts what arrives before and after `disposed`.

| worker (PR head) | results before dispose | posted during dispose | after `disposed` | errors after | dispose took |
|---|---|---|---|---|---|
| whisper-small | 3 | **3** (the queued decodes drained) | 0 | 0 | 17.2 s |
| cohere-transcribe | 6 | 0 (already drained) | 0 | 0 | 3.2 s |

Every queued utterance's text lands before `disposed`, nothing after it, no error. Note that in
the app this path is unreachable today: `WorkerSession.dispose()` posts `dispose` and calls
`worker.terminate()` on the next line, so the worker-side drain only ever runs in a harness.

## granite: untestable — the model fails on `main` too

Both the pre-PR and the PR-head granite worker fail every decode identically, on every segment
length, with an ORT error from the audio encoder:

```
failed to call OrtRun(). ... reshape_helper.h:41 ... The input tensor cannot be reshaped to the
requested shape. Input shape:{1,1200,1024}, requested shape:{1,5,200,8,-1}
```

`onnx-community/granite-4.0-1b-speech-ONNX` (q4) has a 5 × 200-frame block reshape baked into the
exported audio-encoder graph, while Transformers.js 4.2.0's `GraniteSpeechProcessor` blocks on
`projector_window_size` (15) and pads nothing, so any input that is not exactly 1000 encoder
frames fails. Not related to #497; the worker's dispose still completed cleanly after the six
errors (`disposed` posted, 0 errors after). Tracked as #500: either the export or the
Transformers.js pin.

## Coverage and gaps

- GB10 / Vulkan only. The Mac mini M4 (Metal) and the RTX 4070 SUPER (Windows, Vulkan x64) were
  not run; the change is worker-side scheduling with no device-specific code, and the
  two-ORT-instance layout it relies on is the one the fleet already runs for voxtral-3b.
- q4 variants only (GB10's adapter has no `shader-f16`).
- One language (ja) per stream. The whisper multilingual 13-clip stream from the qwen3 note was
  not repeated; the ja stream already exercises the cap boundary and the decode-while-ingesting
  path.
- The unit-level guard (`harness-consolidation.test.ts`, "ASR worker VAD decode handoff") was
  mutation-checked: 5 workers × 3 paths, each `void` → `await` flip turns exactly that worker's
  case red.
