# Smart Turn in the front end: ending a segment when the speaker is done

Status: approved in conversation 2026-10-07 (D1–D4 decided).
Evidence: `~/Desktop/kizunaai/vad-diar-bench/results/smart_turn/` (`summary.md`, `impl_compare.md`, `frontend_compare.md`, `window_sweep.md`).

## Problem

Every VAD-segmented local ASR model waits for 1.4 s of silence (`vadMinSilenceDuration`) before it hands a segment to recognition. A finished sentence therefore shows up about 1.45 s after the speaker stops (p50, measured on AMI and JVNV). Shortening the silence cuts sentences at their pauses instead. The only exception today is the streaming Voxtral worker, which ends a segment on `[.。!?！？]` (`punctuationEndpoint`, `_shared/streaming-generation.ts:237,365`); no other model gets an earlier end.

Smart Turn v3.2 (pipecat-ai/smart-turn-v3, BSD-2-Clause, 8M parameters) classifies the last ≤ 8 s of audio as a finished turn or not. Run once after a short silence, it can end a finished sentence early and leave a mid-sentence pause to the 1.4 s rule.

## What the measurements say

| | value |
|---|---|
| Sentence-end delay p50, 1.4 s rule → Smart Turn (S = 0.2–0.3 s) | 1.45 s → 0.35–0.5 s |
| Cost: extra segment ends per hour, mid-sentence vs at sentence ends (AMI mix, fp32, S 0.2 / th 0.5) | +131 mid-sentence for +70 at sentence ends; segments ×2–2.5 |
| AUC complete-vs-incomplete at pauses: AMI / real Japanese (CALLHOME) / JVNV | 0.65–0.66 / 0.58–0.59 / 0.52–0.58 |
| Official v3.2-test accuracy, fp32 (reproduced exactly) | 93.71 % (JA 97.12, ZH 90.53) |
| Window length | fixed 8 s (input [1,80,800], `embed_positions` [400,384]); 8 s is also the best |

Front end (real Chromium on GB10, fp32 = `smart-turn-v3.2-gpu.onnx`, 32,411,198 bytes):

| backend | model ms/call | with JS features | accuracy vs native fp32 |
|---|---|---|---|
| WebGPU (onnxruntime-web/webgpu) | 6.5 | 60 | identical (max Δ 9e-6) |
| WASM, 4 threads (needs crossOriginIsolated) | 34.5 | 88 | identical |
| WASM, 1 thread | 123 | 177 | identical |

The int8 file (`smart-turn-v3.2-cpu.onnx`) is not faster in WASM (137 / 40.5 ms), flips 18 % of decisions on real Japanese pause points, loses 4.6 points on Chinese, and on WebGPU silently runs every `QuantizeLinear` on the CPU (190 ms). It is not used anywhere.

The repo's `_shared/log-mel.ts` with Whisper's 80-mel filterbank, an 8 s front zero-pad and `do_normalize` reproduces `WhisperFeatureExtractor` to 2.2e-5; it costs 53.7 ms per window (direct DFT).

## Rulings (jiangzhuo, 2026-10-07)

- Smart Turn runs in the front end through ONNX, not in the sidecar: the renderer keeps local inference.
- fp32 on every device: WebGPU when the adapter is there, WASM otherwise.
- The model downloads once, when the user turns the feature on, and stays cached.
- No memory gate: Smart Turn is available on every device.
- No request before the segment holds the FrameProcessor's minimum speech, so a Smart end never drops a segment Normal would have kept.

## Decisions

- **D1. Default: off** (decided). An opt-in: on our meeting and phone audio it cuts about two pauses mid-sentence for every sentence end it brings forward. Revisit after a listening test on real Japanese.
- **D2. UI: Normal / Smart in VAD Settings, two sliders in Smart** (decided). Smart Turn layers on Auto VAD: Silero still decides speech and silence; Smart Turn only decides, after a short silence, whether to end now. It is not a new turn mode: turn modes are global across providers, and Smart Turn exists only for the local vad-web models. The choice sits at the top of Local Inference's VAD Settings, the same shape as OpenAI Realtime's Normal / Semantic (`RealtimeTurnDetection.tsx`). Smart adds **Turn Check After** (0.10–0.50 s, default 0.30) and **Turn Threshold** (0.30–0.90, default 0.50); Min Silence Duration is shown as **Max Wait** in Smart and is the fallback.
- **D3. Hosting: upstream** (decided). `pipecat-ai/smart-turn-v3` pinned to revision `f766f81d3cfdf7737ac64aad813d91bbfd56bf93`, file `smart-turn-v3.2-gpu.onnx` only. The 80-mel filterbank is computed in code (Slaney, 201 bins, 0–8000 Hz) and pinned by a test against `WhisperFeatureExtractor`'s own filters.
- **D4. Scope: the local inference provider's vad-web models** (decided): Whisper WebGPU, Granite, Qwen3-ASR, Cohere, Voxtral 3B, both legs. Local Native's `native-vad` follows its port to the new contract (#578). Streaming Voxtral (already ends on punctuation) and the sherpa-onnx models (segments cut in C++) are out.

## Design

### Shape

```
VAD worker (one per leg)                          Turn worker (one, app-wide)
  FrameProcessor ── per-frame prob ─▶ TurnGate      onnxruntime-web/webgpu  (WebGPU)
                                        │  window   or onnxruntime-web       (WASM)
                                        └─────────▶ featurize (log-mel.ts, 80 mel)
                                   MessagePort      session.run → probability
  endSegment() ◀── complete && still silent ─────── { id, probability }
```

**Why a separate worker.** The VAD's ORT instance (`_shared/onnxruntime-all`) is wasm-only; asking it for `'webgpu'` returns garbage (`_shared/onnxruntime-webgpu.ts:4-6`). The webgpu instance in a VAD/ASR worker belongs to the ASR model, and a second session there while a decode is in flight is the permanent hang of #469 (`qwen3-asr-webgpu.worker.ts:19-24`). The punctuation models already solved this with their own worker (`createPunctuationWorker.ts`, `punctuation-{webgpu,wasm}.worker.ts`); Smart Turn follows that shape.

**Why a MessagePort.** The VAD worker talks to the turn worker over a `MessageChannel` the main thread creates once per ASR worker, so a request does not hop through the main thread. One turn worker serves both legs; it handles one prediction at a time (ORT sessions are not re-entrant, `punctuation-core.ts:87-89`).

### Model, hosting, download (D3)

- New `ModelType` `'turn'` in `modelManifest.ts`, one entry `smart-turn-v3.2`: `hfModelId: 'pipecat-ai/smart-turn-v3'`, `hfRevision: 'f766f81d3cfdf7737ac64aad813d91bbfd56bf93'`, one variant `default` (`dtype: 'default'`, no `requiredFeatures`), one file `smart-turn-v3.2-gpu.onnx` (32,411,198 B, sha256 `ab8dc64b88713f90…`).
- `_shared/mel-filters.ts`: `slaneyMelFilterbank({ nMels: 80, nFft: 400, sampleRate: 16000, fMin: 0, fMax: 8000 })` → `MelFilterbank`, the `log-mel.ts` input shape; a fixture of `WhisperFeatureExtractor(feature_size=80).mel_filters` pins it.
- Never in a resolver pool. Hidden from the Storage page like `'punctuation'`: from its rows (`StoragePage.tsx:163-169`) and its import picker (`:321-325`). Its Clear all (`:199-206`) re-checks the model, as it does the punctuation pack. A manifest test pins the entry the way `modelManifest.punctuation.test.ts` pins those.
- `ModelManager.downloadModel` / IndexedDB `sokuji-models` as for every model; downloaded when the switch is first turned on, with inline progress; ready = `isModelReady`.

### Turn runtime (main thread)

`src/lib/turn/TurnRuntime.ts`, modelled on `PunctuationRuntime`:

- Picks the worker entry with `checkWebGPU()`: `turn-webgpu.worker.ts` (imports `_shared/onnxruntime-webgpu`, binds the adapter with `bindCheckedWebGpuAdapter`) or `turn-wasm.worker.ts` (`_shared/onnxruntime-all`).
- A failed WebGPU load recreates the worker on WASM. A worker that dies after loading takes its transferred ports with it, so the current run stays Normal and the next `connect()` loads WASM.
- WASM threads: `crossOriginIsolated ? Math.min(4, hardwareConcurrency) : 1`, as `PunctuationRuntime.numThreadsFor()`. Packaged Electron and the extension are not isolated today, so they get one thread (≈ 177 ms per call on GB10).
- `connect()` is async and returns `{ port, release }`, or null when the model is not on disk.
  - The first call loads the worker.
  - The other end of the port goes to the turn worker once the model has loaded.
  - `release()` disconnects; the last release disposes the worker.
- No memory gate: Smart Turn is available on every device.

### Turn worker

`_shared/turn-core.ts` (shared by both entries):

- `init { fileUrls, ortWasmBaseUrl, numThreads }` → session on `smart-turn-v3.2-gpu.onnx`, input `input_features` [1,80,800], output `logits` [1,1] (already a sigmoid probability). The reply is `ready { loadTimeMs, device }`; the device comes from the entry file, not from the message.
- `predict { id, window: Float32Array }` on a connected port → `{ id, probability }` or `{ id, error }`.
- `featurize(window)`: last 128,000 samples, front zero-pad, zero-mean/unit-variance over the padded window (eps 1e-7), then `logMel(w, filters)` from `_shared/log-mel.ts` → [80][800].

### Turn gate (in each VAD worker)

`_shared/turn-gate.ts`, pure and unit-tested; the workers feed it from the FrameProcessor loop they already have (`FrameProcessed` carries `probs.isSpeech` for every frame; today the workers ignore it).

- Takes the positive and negative thresholds, the pre-speech pad and `minSpeechFrames` from the worker's own FrameProcessor (`openTurnLink(port, vadConfig, frameProcessor)`).
- Keeps the last 8 s of 16 kHz audio and the sample where the current segment started (speech start minus the pre-speech pad).
- While the processor is speaking, counts consecutive frames below the negative threshold; a frame between the two thresholds restarts the run.
- It returns a request `{ id, window }` (the segment's audio up to now, at most 8 s) when all three hold:
  - the run reaches the trigger frames;
  - no request is open for this run;
  - the segment holds at least `minSpeechFrames` speech frames. That is the FrameProcessor's own misfire floor, `floor(minSpeechMs / 32)` frames at or above the positive threshold.
- So Smart only ends a segment the FrameProcessor would keep. A short "はい" followed by more speech within Max Wait still merges, as under Normal.
- The worker posts the request on the turn port. On the answer, `gate.shouldEnd(id, probability)` is true only if `probability > threshold`, the id is the latest request, and no speech frame arrived since. Then the worker calls `frameProcessor.endSegment(...)`, exactly as the max-speech cap path does (fire-and-forget decode, `harness-consolidation.test.ts:96-149`).
- An answer takes effect at the next VAD frame, not when it arrives. Acting while `frameProcessor.process()` awaits the model would race the processor.
- Incomplete, late, failed or missing answer: nothing happens; the 1.4 s redemption ends the segment as today.
- A consistency test, like `sileroInput.consistency.test.ts`, requires every vad-web worker in scope to wire the gate.

### Settings, UI, session

- `LocalInferenceSettings`: `vadEndOfTurn: 'normal' | 'smart'` (default `'normal'`), `smartTurnCheckAfter: number` (default 0.30 s), `smartTurnThreshold: number` (default 0.50). The fallback is the existing `vadMinSilenceDuration`.
- `config.ts`: `vad.smartTurn = { checkAfter, threshold }` only when `vadEndOfTurn === 'smart'` and the ASR's worker type is one of the five in scope (`supportsSmartTurn`). `checkAfter` is clamped to `vadMinSilenceDuration − 0.2` s, and Smart is dropped when that leaves under 0.10 s (a prediction takes up to ~180 ms on one WASM thread, so a smaller margin lets the fallback always win).
- Effective only in Auto turn mode: the adapter uses it only when `context.turns === 'auto'`, since push-to-talk and push-to-translate end turns by hand and the VAD keeps running under the held key (`adapter.ts:343-352`).
- The adapter asks the runtime for a port and passes it in the ASR init message (transfer list); no port or a model that is not ready → the gate stays off and the run is Normal.
- The gate's trigger frames are `ceil(checkAfter / 0.032)`; its threshold is `threshold`.
- UI, shown only for those five worker types (`supportsSmartTurn`), on every device. `vadIsWebWorker` is not the check: it also covers the streaming Voxtral, which D4 leaves out.
  - `[ Normal ] [ Smart ]` at the top of VAD Settings, copied from `RealtimeTurnDetection.tsx`'s option buttons.
  - Choosing Smart with the model not on disk starts the download with inline progress; the setting becomes `'smart'` only when the model is ready. A failed download leaves Normal and shows the error with a retry.
  - In Smart: Turn Check After (0.10–0.50 s; its maximum follows Max Wait − 0.2 the way Silence Threshold follows Speech Threshold, and the value shown is the one the session will use) and Turn Threshold (0.30–0.90), above the VAD sliders; Min Silence Duration reads **Max Wait** with its own tooltip.
  - The Speech section's summary reads `VAD Settings · Smart · Max Wait 1.40s` in Smart.
  - Strings in all 30 catalogs; the existing `settings.normal` key is reused for Normal.

### Failure and diagnostics

- The runtime reports, once each, a load that fails on WASM too and a worker that dies after loading. It uses `reportWarning` (`src/lib/diagnostics/report.ts`), and the gate then gets no answers. Workers never `console.*`.
- A prediction that has not answered by the time the 1.4 s rule fires is dropped; no timer is needed.

## Out of scope

- An FFT in `log-mel.ts` (the 53.7 ms direct DFT is the largest cost on WebGPU; it would also speed up Qwen3-ASR). Separate follow-up with its own parity test.
- Local Native (D4), streaming Voxtral, sherpa-onnx models.
- Speaker diarization.
- crossOriginIsolated for the packaged app (would give WASM 4 threads; affects every worker, separate decision).

## Testing

- Unit tests:
  - `turn-gate.test.ts`: trigger timing, one request per silence run, the minimum speech (short speech then a pause asks nothing), stale and late answers, speech resuming, segment start with pad, the 8 s cap.
  - `turn-core.test.ts`: featurize parity against a fixture generated with `WhisperFeatureExtractor`, on three windows (2 s padded, exactly 8 s, 12 s truncated), features within 1e-4.
  - The runtime: backend choice, WASM fallback, a crash after loading.
  - The manifest entry, and settings/config/UI as in #603.
- Consistency: every in-scope vad-web worker wires the gate; `shaderF16Gate` coverage for the new webgpu worker.
- Manual (Electron and extension, both backends): a finished Japanese sentence appears sooner; a mid-sentence "えーと…" pause; a short "はい" followed by speech stays one segment; push-to-talk unaffected; WebGPU-less machine; first-time download and offline reuse.

## Task outline (the plan expands these)

1. Manifest type `'turn'` + entry + manifest test; `_shared/mel-filters.ts` + fixture test.
2. `_shared/turn-core.ts` featurize + parity fixture.
3. Turn workers (webgpu/wasm entries) + `TurnRuntime` with fallback.
4. `_shared/turn-gate.ts` + unit tests.
5. Wire the gate into the in-scope vad-web workers + consistency test.
6. Settings, config, adapter port plumbing (Auto mode only).
7. UI: Normal / Smart, the two sliders, Max Wait, summary, download flow, 30 locales.
