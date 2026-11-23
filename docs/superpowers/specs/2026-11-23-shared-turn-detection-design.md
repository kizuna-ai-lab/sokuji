# Shared turn detection for local recognizers — design

Date: 2026-11-23. Status: draft for the owner's review; revised after an independent review (§3.1).

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

**One turn-detector worker per leg that needs ours, in the renderer, generalised from `native-vad.worker.ts`.**
"One component" means one implementation and one set of settings, not one shared instance: each leg has its own
VAD state, buffers and Smart Turn window. The detector takes the leg's audio (24 kHz Int16, as the adapters receive
it), resamples to 16 kHz once, runs Silero v5 through vad-web's `FrameProcessor` with the shared `SileroInput`
context, and hosts the Smart Turn gate (`TurnGate`, today in `workers/_shared/turn-gate.ts`), which needs the
audio window and so lives with the VAD. It connects to the one shared Smart Turn worker (`TurnRuntime`) the way the
ASR workers do today.

It is the **only** receiver of the leg's audio: the adapter sends audio to the detector and nowhere else. The
detector delivers to the recognizer on one ordered output, in one of two shapes chosen by the recognizer:

- **Segments**, for recognizers that decode one utterance at a time (sherpa-onnx offline, the five WebGPU
  workers): `{ type: 'segment', press?, seq, audio: Float32Array (16 kHz), start, end, endedBy: 'silence' |
  'smart' | 'cap' | 'release', smartTurnProbability? }`. The segment keeps today's shape (pre-pad + speech + the
  silence that ended it), so recognition accuracy does not move. It goes on a direct `MessageChannel` from the
  detector to the ASR worker, transferred (the detector keeps no copy), not through the main thread.
- **Audio and marks**, for recognizers that hold the audio themselves (Voxtral 4B's continuous feed, Local
  Native's sidecar): the detector relays the leg's audio frame by frame **after** the VAD has processed each frame,
  and puts each mark between the frames it separates: `…audio(frame k) · mark(end) · audio(frame k+1)…`. A
  recognizer that acts on a mark when it receives it therefore acts at exactly the right place: nothing past the
  boundary has reached it. No position field is needed on the wire (§3.1).

## 3.1 Contracts

These are the detector's interface. Each has tests in §9.

**C1. One timeline per leg, and ordered delivery.**
- A leg's timeline is the 16 kHz sample index counted from the leg's first audio chunk, as half-open intervals
  `[start, end)`. The detector does the leg's only resampling and carries the fractional remainder across chunks,
  so positions never drift with irregular chunk sizes. Counting continues through cancels and presses.
- VAD frames are 512 samples at 16 kHz, which is exactly 768 samples at 24 kHz, so a boundary always falls between
  whole frames on both rates. For Local Native, which takes 24 kHz PCM, the detector relays the original 24 kHz
  frames, split at those boundaries.
- Voxtral 4B: its feed appends what it receives; `start` starts or queues generation, `end` finishes it on the
  audio received so far, `cancel` aborts it. With the ordered output these are exact. While a previous generation
  is still draining, the next `start` queues, as today, and its audio is kept from its start frame on.
- Local Native: the client forwards the detector's output to the sidecar's socket in the order it arrives (PCM
  chunks and `vad_mark`), so the sidecar's "cut when the mark arrives" is the cut at the position. The wire does not
  change. The sidecar's 0.7 s pre-roll still seeds the start of a segment; it is not relied on to absorb delay.

**C2. Push-to-talk: presses and segments.** See §5.
- A press (`press`, from the runner's `beginTurn`) is one logical turn; the segments one press produces (`seq`) are
  only the engine's length limit cutting it, and none of them goes through minSpeech or Smart Turn.
- `endTurn` closes the press (`endedBy: 'release'`); `cancelTurn` drops the press's segments not yet decoded and
  makes every later result of that press void: results carry `press`, and the adapter publishes nothing more for a
  cancelled press. Results already published before the cancel stay, as they do today.
- A released press is not cancelled by the next one: its results are published whenever they arrive, even after
  press p + 1 has begun, and they stay press p's. What never crosses from p to p + 1 is state: a late `start`, a
  Smart Turn answer, or audio of p inside a segment of p + 1.
- On release (and on any drain), the last partial frame — fewer than 512 samples — is delivered at once: zero-padded
  to a whole frame for the VAD, its real samples included in the closing segment or relayed before the closing mark.
  It never waits for later audio to complete it.

**C3. Bounded queues, drain and stop.**
- Input: the detector processes audio in order and never drops a chunk. If its unprocessed input exceeds 2 s
  (it is falling behind real time), the leg fails with a notice ("turn detection cannot keep up on this device")
  rather than drop audio or fall ever further behind.
- Decoding: at most 5 segments or 30 s of audio may wait for the recognizer. Beyond that the leg fails with a notice,
  the same way.
- Drain (`endTurn`, `flush`, the end of a session): the detector closes the open segment, emits it, then emits
  `drained{seq}` on the same ordered output; the recognizer answers `drained{seq}` once everything before it is
  decoded. The adapter waits for that answer (with a timeout), which covers a segment still on its way over the
  direct channel.
- Stop: an epoch number. `stop` raises it first; the detector drops its queued input at once, the recognizer drops
  segments of an older epoch, and the adapter ignores late results of an older epoch. Stop never waits for a
  backlog to drain.
- Failures: Smart Turn missing, failing or answering late → the leg keeps Normal turn detection (a stale answer
  never ends a newer segment). Silero failing to load → the leg fails with a notice; it never waits silently.

**C4. Length limits, as today's integer arithmetic.** The manifest keeps each model's limit with its kind:
`{ kind: 'segment' | 'speech', seconds, byTask?, byLanguage? }` — `segment` counts the whole input including the
pre-pad (Whisper 29 s, Voxtral 3B 30 s), `speech` the speech after it. Granite's (30 s, 20 s translating) and
Qwen3-ASR's (40 s; Hindi 15 s, Thai 20 s) variants resolve from the leg's task and language at start. The detector
reuses `resolveMaxSpeechFrames` (`workers/_shared/max-speech-frames.ts`), which deducts the pre-pad and rounds to
512-sample frames: for Whisper with a 0.8 s pre-pad and a 30 s setting that is 881 frames, 28.992 s with the pad.
Local Native's limit is set below the sidecar's backstops (20 s streaming, 30 s offline), counting the sidecar's
0.7 s pre-roll.

**C5. Which legs use the detector: decided per leg, from the resolved model.** One `local_inference`
transcription unit hosts both streaming and segmented models, so the choice is not a property of the unit. Once a
leg's recognition model is resolved (`localRecognition`, `providers/localInference/config.ts:163-178`), its config
carries `turnDetection: 'shared' | 'own'`: `shared` for a model already moved to the detector, `own` for a streaming
model, a cloud recognizer, and any model not yet moved in the step under way. The adapter opens a detector only for
a `shared` leg, so no leg ever runs two VADs. The same answer decides what the settings show (§7). This covers two
legs on different models, the whole unit and the transcription-only unit alike, and a model changed between runs.
`turnOwner` (`lib/run/types.ts:97-98`) is retired rather than given a reader: the decision is per leg, not per unit.

**Engine limits move to the manifest** (C4), and **the detector never drops audio** (C3): the vad-web workers'
chunk-dropping goes away for every recognizer.

## 4. The recognizers

| Recognizer | Change | Stays |
|---|---|---|
| WebGPU ×5 | Add `segment` input, calling the existing `schedule*(audio, start, {endedBy})`; answer `drained`; drop segments of an older epoch; without `vadConfig` at init, skip `initVad` and `openTurnLink`; `audio` is no longer sent to them. Their VAD ORT instance goes (Qwen3-ASR may drop `onnxruntime-all`). Cohere and Voxtral 3B gain a start from the segment. | The decode code. |
| sherpa-onnx offline | Add `segment` input in the classic worker: one decode function (folding the two duplicated blocks); `drained`; an init flag skips `createVad` and its buffer. | The WASM build: its VAD stays compiled but unused (rebuilding without it is a later saving). |
| Voxtral 4B | Keep the continuous feed into `audioFeed`, now fed by the detector's ordered output; drop its VAD loop; marks per C1. | Punctuation cuts inside a turn ("exactly one layer may cut" stays true: punctuation splits results, the detector ends turns). |
| Local Native | `nativeVad()` and its worker give way to the detector in audio-and-marks mode; the client forwards its output in order (C1). | The sidecar and its wire. |
| sherpa streaming, every cloud service | None: rule 1 (`turnDetection: 'own'`). | Their own endpointing. |

**The adapters.** `AsrInit.vadConfig` and `turnPort` give way to a detector the adapter opens for a `shared` leg
and connects to the engine (a port). The 700 ms pad goes. Every engine's result start comes from the segment.

## 5. Push-to-talk

With the detector in front of the recognizer, a press is the turn: `beginTurn` opens a press, `endTurn` closes it
(`release`), `cancelTurn` drops it (C2). The VAD is not asked during a press. A press longer than the engine's
limit is cut at the limit and continues in the next segment of the same press; that cut is the one exception to
"a press is one segment", and it is not re-checked by the VAD, so a short tail after the cut is decoded, not dropped.

The runner's own check stays as it is for every provider: a press with less than 500 ms of audio above an average
amplitude of 0.01 is cancelled (`lib/session/turn.ts:3-16`, `lib/session/run.ts:549-558`). So a near-silent press is
still cancelled, as today. What changes is the band in between: speech loud enough for the runner's check but below
Silero's speech threshold, or shorter than minSpeech, is no longer dropped inside a press. Decision 1 (§10).

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
and the line-up card of the transcription stage, whenever a leg's resolved model is `shared` (C5). For a leg on a
streaming model or a cloud service it shows none (rule 1). The engine limit is a note under Max
speech ("this model splits utterances longer than 9 s"). `vadIsWebWorker`, `showVad`, `SMART_TURN_WORKER_TYPES`
and `supportsSmartTurn` go. Restore defaults stays. The participant leg keeps automatic turns.

## 8. Steps

Each a PR into `main`, each leaving every recognizer working:

1. **The detector and the settings.** The turn-detector worker with the contracts of §3.1 (segments and
   audio-and-marks, the gate, limits from the manifest, bounded queues, drain and epochs), the per-leg
   `turnDetection` decision, `settings.turnDetection.*` with its migration, the one Controls component. Wired to the WebGPU
   ×5 first: they take `segment`, lose their VAD; the adapter opens the detector for them. The other recognizers
   keep their own VAD in this step and read the new settings. Push-to-talk per §5 for these five.
2. **sherpa-onnx offline** takes segments. SenseVoice and the rest get Smart Turn and the shared knobs.
3. **Voxtral 4B** takes marks.
4. **Local Native** takes marks, after its port onto the provider structure (#578) lands: `nativeVad()` and its
   three tester knobs go.
5. **Clean-up.** The worker-VAD code paths, the 700 ms pad, the old consistency tests (`turnGate.consistency`,
   `sileroInput.consistency`), the old `localInference.vad*` keys after one release.

## 9. Testing

Rules that hold or fail exactly (zero gaps, zero overlaps) are tested apart from recognition quality and latency,
which are statistics.

**Unit (the detector and each recognizer):**

| Case | Must hold |
|---|---|
| A boundary inside a chunk; audio before a mark and a mark before audio; irregular chunk sizes | Every segment's interval and every relayed audio span is exact: no gap, no overlap, no audio of one turn inside the next; positions do not drift (C1) |
| Two legs at once | Positions, state and cancels of one leg never touch the other |
| Voxtral 4B: a second end, or the next start, while a generation is still draining | Each interval belongs to one turn, in timeline order |
| Local Native: the detector delayed by more than 0.7 s | Output stays exact by ordering, not by the sidecar's pre-roll |
| Push-to-talk: quiet speech, a short press, a silent press, quick repeated presses, cancel | The runner's check decides as today; inside a kept press the VAD drops nothing; after a cancel no new result of that press is published; a released press's late results are still published when the next press has begun; the last partial frame of a press is delivered on release (C2) |
| A press or an automatic turn crossing the length limit with 100–300 ms left after it | The limit as C4's arithmetic; the tail is decoded once, the pre-pad never repeated |
| Input slower than real time; stop with a backlog | Queues stay bounded and the leg fails with a notice; stop returns at once and late results are ignored (C3) |
| Smart Turn missing, failing, or answering late | Normal turn detection goes on; a stale answer never ends a newer segment |
| The migration | Each stored `localInference.vad*` value is carried over once |
| `turnDetection` per leg | Segmented + streaming legs, the whole and the transcription-only unit, a model changed: the detector opens exactly for `shared` legs and the settings show accordingly (C5) |

**Before/after on real audio:** the e2e Japanese sentences through SenseVoice, Whisper and Voxtral 4B on the e2e
build, before and after each step, with the same models, settings and clips, five runs each: sentences heard and
translated, segment boundaries, and the time from the end of speech to the final text. A step ships only if the
medians are no worse than before by more than the run-to-run spread measured on the before side.

## 10. Decisions for the owner

1. **Push-to-talk:** the press is the turn and the VAD is not asked during it (recommended; the runner's
   near-silence check stays, and a press past the model's limit is cut into segments of the same press), or the
   VAD keeps cutting inside a press as today.
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
- The input-backlog and decoding-queue bounds (2 s; 5 segments / 30 s) are starting values; the slowest supported
  device sets them in step 1.
- The cost of one more transferred message per segment (expected a few milliseconds).
- sherpa's bundled Silero version against Silero v5: SenseVoice's segments may move slightly in step 2.
