# Shared turn detection for local recognizers — design

Date: 2026-11-23. Status: draft for the owner's review.

## 1. Goal and policy

"Turn detection" here is deciding where one utterance ends: Silero VAD finds speech and silence, and Smart Turn
(an end-of-turn model) decides whether a pause is the end of a turn. The owner's policy (2026-11-23):

1. **A recognizer with its own turn detection keeps it, alone.** Every cloud service (Soniox, OpenAI Realtime,
   Gemini, Qwen, Doubao AST 2.0, Palabra, OpenAI Translate, OpenAI Live) and the local *streaming* sherpa-onnx
   models (Kroko, streaming Zipformer, NeMo CTC), whose recognizer has endpoint rules. No option to replace it.
2. **A recognizer without one uses ours.** The local *segmented* recognizers — sherpa-onnx offline (SenseVoice,
   Moonshine, NeMo, …), the five WebGPU workers (Whisper, Cohere, Granite, Qwen3-ASR, Voxtral 3B), Voxtral 4B
   Realtime — and Local Native's sidecar recognizer.
3. **Ours is one component with one set of settings**, instead of today's three implementations bound to their
   providers.

Push-to-talk is not turn detection: the user decides, for every recognizer, as today (§5).

Out of scope: turn detection for cloud services (rule 1), a line-up stage for it (spec 2026-11-19 §9), new models.

## 2. Today

All references are to `main` at v0.51.2.

| | Where the VAD runs | Model / runtime | Knobs (stored under) | Smart Turn |
|---|---|---|---|---|
| sherpa-onnx offline | Inside `public/workers/sherpa-onnx-asr.worker.js` (classic `importScripts` worker), sherpa's C++ VAD in its WASM | Silero bundled in each model's `.data` package | threshold, min silence, min speech (`settings.localInference.*`); max speech hard-coded 20 s, 9 s for Moonshine v2 | No |
| WebGPU ×5 (Whisper, Cohere, Granite, Qwen3-ASR, Voxtral 3B) | Inside each ASR worker: vad-web `FrameProcessor` | Silero v5 (`public/wasm/vad/silero_vad_v5.onnx`), its own ORT instance | six knobs (`settings.localInference.*`); max speech under each engine's cap | Yes, through a port from `TurnRuntime` into each worker's `TurnGate` |
| Voxtral 4B Realtime | Inside its worker; starts and finishes streaming generation | Same | six knobs | No (the engine passes no port) |
| Local Native (unreleased) | `native-vad.worker.ts`, a renderer worker that only posts edges; the sidecar turns them into segments | Same | three knobs (`settings.localNative.*`) | No |

Problems this causes:

- Three implementations, three knob sets, two UIs. Smart Turn reaches five recognizers only; SenseVoice (the
  default) never gets it.
- The vad-web workers drop a 100 ms audio chunk that arrives while their feed loop is busy (whisper worker :369),
  which also cuts Voxtral 4B's model feed.
- Push-to-talk does not bypass the VAD: release sends 700 ms of zeros as one buffer and a flush
  (`providers/localInference/adapter.ts:55-60, 410-422`); the worker's VAD still drops quiet or short speech inside
  a press, and the WebGPU workers flush only while their VAD thinks someone is speaking.
- `turnOwner` is declared on every unit and read by nothing.

## 3. The component

**One turn-detector worker per leg, in the renderer, generalised from `native-vad.worker.ts`.** It takes the leg's
audio (24 kHz Int16, as the adapters receive it), resamples to 16 kHz once, runs Silero v5 through vad-web's
`FrameProcessor` with the shared `SileroInput` context, and hosts the Smart Turn gate (`TurnGate`, today in
`workers/_shared/turn-gate.ts`), which needs the audio window and so lives with the VAD. It connects to the one
shared Smart Turn worker (`TurnRuntime`) the way the ASR workers do today.

It answers in one of two shapes, chosen by the recognizer:

- **Segments**, for recognizers that decode one utterance at a time (sherpa-onnx offline, the five WebGPU
  workers): `{ type: 'segment', audio: Float32Array (16 kHz), startSample, endedBy: 'silence' | 'smart' | 'cap' |
  'turn-end', smartTurnProbability? }`. The segment keeps today's shape (pre-pad + speech + the silence that ended
  it), so recognition accuracy does not move. It is sent on a direct `MessageChannel` from the detector to the ASR
  worker, transferred, not through the main thread.
- **Marks**, for recognizers that hold the audio themselves (Voxtral 4B's continuous feed, Local Native's
  sidecar): `{ type: 'mark', event: 'start' | 'end' | 'cancel', sample }`, where `sample` is the 16 kHz sample
  index the edge belongs to, so a recognizer that receives audio and marks on different paths places the edge
  exactly. Local Native's sidecar ignores `sample` (its 0.7 s pre-roll absorbs the skew) and keeps its wire.

**Engine limits move to the manifest.** Each recognizer's longest segment (Whisper 29 s, Granite 30 s / 20 s
translating, Qwen3-ASR 40 s / 15 s Hindi / 20 s Thai, Voxtral 3B 30 s, Voxtral 4B 35 s, Moonshine v2 9 s, sherpa
offline 20 s; Cohere none) becomes a manifest field. The detector cuts at `min(the user's max speech, the
engine's limit)` with `endedBy: 'cap'`, as the workers do now.

**What the detector never drops.** It queues audio messages and processes them in order (native-vad's queue),
so the chunk-dropping goes away for every recognizer.

## 4. The recognizers

| Recognizer | Change | Stays |
|---|---|---|
| WebGPU ×5 | Add `segment` input, calling the existing `schedule*(audio, start, {endedBy})`; without `vadConfig` at init, skip `initVad` and `openTurnLink`; `flush` waits for the decode chain only; `audio` becomes a no-op. Their VAD ORT instance goes (Qwen3-ASR may drop `onnxruntime-all`). Cohere and Voxtral 3B gain `startSample` from the segment. | The decode code. |
| sherpa-onnx offline | Add `segment` input in the classic worker: one decode function (folding the two duplicated blocks); an init flag skips `createVad` and its buffer. | The WASM build: its VAD stays compiled but unused (rebuilding without it is a later saving). |
| Voxtral 4B | Keep the continuous `audio` feed into `audioFeed`; drop its VAD loop; `mark start` → start or queue generation, `end` → `finishGenerate`, `cancel` → `abortGenerate`, each at `sample`; the idle trim keeps audio back to the oldest unanswered `sample`. | Punctuation cuts inside a turn ("exactly one layer may cut" stays true: punctuation splits results, the detector ends turns). |
| Local Native | `nativeVad()` and its worker give way to the detector in marks mode; `vad_mark` on the sidecar's socket unchanged. The detector's cap stays below the sidecar's 20 s / 30 s backstops. | The sidecar and its wire. |
| sherpa streaming, every cloud service | None: rule 1. | Their own endpointing. |

**The adapters.** `AsrInit.vadConfig` and `turnPort` give way to a detector the adapter opens per leg and hands
to the engine (a port). The 700 ms pad goes. `startSample` has one source for every engine. `turnOwner` gets a
reader: the composer refuses no plan on it (every local recognizer above is `'external'` and every cloud one
`'unit'`), but the run reads it to know whether a turn-detector is opened for the unit.

## 5. Push-to-talk

With the detector in front of the recognizer, a press can be the turn, exactly: press opens a segment (or sends
`start`), release closes it (`turn-end` / `end`), cancel drops it. The VAD is not asked during a press. Speech
shorter than the runner's 500 ms voiced minimum is already a cancel (`lib/session/turn.ts`). A press longer than
the engine's limit is cut at the limit and continues in the next segment, as today's cap does.

This changes one behaviour: quiet speech inside a press is no longer dropped by the VAD. Decision 1 (§10).

## 6. Smart Turn

Available for every recognizer in rule 2, not only five: the gate lives in the detector. Default stays Normal
(Smart is opt-in, its model downloads on demand, `stores/smartTurnStore.ts`). Without the model on disk a stored
Smart runs as Normal, as today. `smartTurnCheckAfter` stays capped at Max Wait − 0.2 s.

## 7. One set of settings

One namespace, `settings.turnDetection.*`, read by the detector only:

| Field | Default | Range | From |
|---|---|---|---|
| `threshold` | 0.3 | 0.1–0.95 | `localInference.vadThreshold` |
| `negativeThreshold` | 0 (Auto: threshold − 0.15) | 0–threshold | `localInference.vadNegativeThreshold` |
| `minSilence` ("Max Wait" under Smart) | 1.4 s | 0.05 (0.3 under Smart)–2.0 | `localInference.vadMinSilenceDuration` |
| `minSpeech` | 0.4 s | 0.05–1.0 | `localInference.vadMinSpeechDuration` |
| `prePad` | 0.8 s | 0–2 | `localInference.vadPreSpeechPadDuration` |
| `maxSpeech` | 30 s | 10–40 | `localInference.vadMaxSpeechDuration` |
| `endOfTurn` | `normal` | `normal` / `smart` | `localInference.vadEndOfTurn` |
| `smartTurnCheckAfter` | 0.3 s | 0.10–min(0.5, Max Wait − 0.2) | same name |
| `smartTurnThreshold` | 0.5 | 0.3–0.9 | same name |

**Migration.** On first read, each field takes the user's stored `localInference.*` value when there is one, so
nobody's tuning is lost; the old keys are left in place for one release, then removed. Local Native's three
`localNative.vad*` fields are not migrated: it was never released, and its testers' values were defaults.

**UI.** One Turn detection control set, the same knobs for every recognizer in rule 2 — no more 0 / 3 / 6 / 6 +
Smart depending on the model. It shows where LocalInference's does today: the Speech section's summary under Auto,
and the line-up card of the transcription stage, for `local_inference` (segmented models) and `local_native`.
For a streaming model and every cloud service the card shows none (rule 1). The engine limit is a note under Max
speech ("this model splits utterances longer than 9 s"). `vadIsWebWorker`, `showVad`, `SMART_TURN_WORKER_TYPES`
and `supportsSmartTurn` go. Restore defaults stays. The participant leg keeps automatic turns.

## 8. Steps

Each a PR into `main`, each leaving every recognizer working:

1. **The detector and the settings.** The turn-detector worker (segments and marks, the gate, engine limits from
   the manifest), `settings.turnDetection.*` with its migration, the one Controls component. Wired to the WebGPU
   ×5 first: they take `segment`, lose their VAD; the adapter opens the detector for them. The other recognizers
   keep their own VAD in this step and read the new settings. Push-to-talk per §5 for these five.
2. **sherpa-onnx offline** takes segments. SenseVoice and the rest get Smart Turn and the shared knobs.
3. **Voxtral 4B** takes marks.
4. **Local Native** takes marks, after its port onto the provider structure (#578) lands: `nativeVad()` and its
   three tester knobs go.
5. **Clean-up.** The worker-VAD code paths, the 700 ms pad, the old consistency tests (`turnGate.consistency`,
   `sileroInput.consistency`), the old `localInference.vad*` keys after one release.

## 9. Testing

- **Unit:** the detector on recorded fixtures — the segments it cuts (count, start sample, end reason) match the
  current WebGPU worker's on the same audio; Smart Turn's gate as today's tests, moved; marks' `sample`; the queue
  never drops a chunk under a slow consumer; the migration.
- **Recognizers:** each worker's `segment` / mark handling, with the existing decode tests.
- **Before/after on real audio:** the e2e Japanese sentences through SenseVoice, Whisper and Voxtral 4B on this
  repo's e2e build, before and after each step: sentences heard and translated, segment boundaries, and the time
  from the end of speech to the final text. A step does not ship if any of them gets worse beyond noise.
- **Push-to-talk:** press/release produces one segment; quiet speech inside a press is kept (decision 1).

## 10. Decisions for the owner

1. **Push-to-talk:** the press is the turn and the VAD is not asked during it (recommended), or the VAD keeps
   cutting inside a press as today.
2. **Order:** WebGPU first, then SenseVoice and the others, then Voxtral 4B, then Local Native after #578
   (recommended); or SenseVoice first, since it is the default.

## 11. Rejected

- **A shared module compiled into each ASR worker.** One implementation but not one runtime: the sherpa-onnx
  offline worker is a classic script on sherpa's C++ VAD and cannot import it without a rebuild; the chunk
  dropping stays; Local Native still needs a worker of its own.
- **Hosting the VAD in the shared Smart Turn worker.** It runs one model call at a time; Silero's ~31 frames a
  second per leg would wait behind predictions of up to ~180 ms on WASM, and both legs would fail together.
- **A run-level turn owner driving `beginTurn`/`endTurn`.** The local `endTurn` is still pad + flush into a
  worker with its own VAD, so it needs the worker changes anyway, and the detector would have to hold the
  pre-roll the runner gates away.

## 12. Not verified

- That the segments the detector cuts match the worker VAD's closely enough to keep recognition accuracy (the
  before/after check in §9 is the gate).
- The cost of one more transferred message per segment (expected a few milliseconds).
- sherpa's bundled Silero version against Silero v5: SenseVoice's segments may move slightly in step 2.
