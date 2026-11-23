# Shared turn detection, step 1: the turn detector, one set of settings, the WebGPU recognizers on it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five WebGPU recognizers (Whisper, Cohere, Granite, Qwen3-ASR, Voxtral 3B) stop running Silero themselves and decode the segments of one turn-detector worker per leg, and every local recognizer without turn detection of its own reads one set of settings, `settings.turnDetection.*`.

**Architecture:**
- **One turn detector per leg** (`turn-detector.worker.ts`) is the leg's only audio receiver once its model is `shared` (C5). It resamples 24 kHz to 16 kHz once, on one timeline (C1), and runs Silero v5 through vad-web's `FrameProcessor` with `SileroInput`. It hosts the Smart Turn gate (`TurnGate`/`TurnLink`, unchanged), connected to the shared `TurnRuntime`.
- **The detector is three pure parts and a thin worker.**
  - `TurnDetectorCore` decides boundaries and writes them as a **trace** (frames, opens, closes, drops, cancels, drains).
  - `SegmentAssembler` turns the trace into the segments output. It owns the audio, the sequence numbers, the epochs and the decode-queue bound (C3).
  - `MarksRelay` turns the same trace into the audio-and-marks output. It is built and tested in step 1 and wired to nothing.
- **The recognizers take segments.** Segments travel on a direct `MessageChannel` to a `SegmentInbox` inside each of the five workers. The inbox decodes in order, acks `taken`, drops old epochs and cancelled presses, and answers `drained`.
- **The adapter decides per leg.** It opens a detector only for a `shared` leg, numbers the presses, waits for `drained`, voids a cancelled press's results, and raises the epoch on stop.
- **The other legs keep their own VAD.** sherpa-onnx offline and Voxtral 4B keep their worker's VAD and the 700 ms release pad in this step, but read `settings.turnDetection.*`. Streaming and cloud recognizers are untouched. Local Native is untouched.
- **The engines' limits move to the model manifest with their kinds** (C4). The detector reads them through `resolveMaxSpeechFrames`.
- **One Controls component** replaces LocalInference's per-model knob logic.

**Tech Stack:** TypeScript, React, Zustand, Vitest, `@ricky0123/vad-web` 0.0.30, onnxruntime-web, Playwright (Electron) for the opt-in real-audio check.

**Spec:** `docs/superpowers/specs/2026-11-23-shared-turn-detection-design.md`. Binding: §3.1 (C1–C5), §5, §7, §8 step 1, §9, §10. Code references below are to `origin/main` 17642a804 (v0.51.2); find each place by name if lines moved.

## Global Constraints

- Base: `origin/main` 17642a804. Three PRs into `main`, each stacked on the one before: A `feat/turn-detection-settings`, B `feat/turn-detector` (on A), C `feat/webgpu-turns-on-detector` (on B).
- **Opening each PR is a separate act.** The owner confirms it at the time, for `kizuna-ai-lab/sokuji`, naming the PR's base branch. Never push or open a PR without that confirmation.
- Node: prefix commands with `PATH=$HOME/.nvm/versions/node/v24.22.2/bin:$PATH`. Tests: `npx vitest run <paths>` per task, then `npx vitest run` before each commit. Record the base's full-suite failures and its `npx tsc --noEmit -p tsconfig.json` error count before Task 1. No new failure, and the error count is never above the base's.
- Never run vite, Electron or e2e, except in Task 17, with the owner's go-ahead.
- Commits: stage explicit paths only (`git add <path> …`, never `-A` or `.`). End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Settings, verbatim from §7**, under `settings.turnDetection.<field>`:

| field | default | range |
|---|---|---|
| `threshold` | 0.3 | 0.1–0.95 |
| `negativeThreshold` | 0 (Auto: threshold − 0.15) | 0–threshold |
| `minSilence` | 1.4 | 0.05 (0.3 under Smart)–2.0 |
| `minSpeech` | 0.4 | 0.05–1.0 |
| `prePad` | 0.8 | 0–2 |
| `maxSpeech` | 30 | 10–40 |
| `endOfTurn` | `'normal'` | `'normal'` \| `'smart'` |
| `smartTurnCheckAfter` | 0.3 | 0.10–min(0.5, Max Wait − 0.2) |
| `smartTurnThreshold` | 0.5 | 0.3–0.9 |

- **Migration:** on first read, each field takes the stored `settings.localInference.<old name>` once and writes it under the new key. The old keys stay in storage; nothing deletes them in this step. `settings.localNative.vad*` is not migrated.
- **Limits, verbatim from C4 and the workers:**
  - Whisper `{ kind: 'segment', seconds: 29 }`.
  - Voxtral 3B `{ kind: 'segment', seconds: 30 }`.
  - Granite `{ kind: 'speech', seconds: 30, byTask: { translate: 20 } }`.
  - Qwen3-ASR `{ kind: 'speech', seconds: 40, byLanguage: { hi: 15, th: 20 } }`.
  - Cohere: none.
  - Voxtral 4B `{ kind: 'speech', seconds: 35 }`.
  - sherpa-onnx offline `{ kind: 'speech', seconds: 20 }`; Moonshine v2 `{ kind: 'speech', seconds: 9 }`.
  - Arithmetic: `resolveMaxSpeechFrames` unchanged. Whisper with a 0.8 s pad and a 30 s setting gives 881 frames, 28.992 s with the pad.
- **C3 bounds:**
  - Unprocessed input over 2 s fails the leg.
  - More than 5 segments waiting, or more than 30 s of audio waiting ahead of the newest segment, fails the leg.
  - Notice code `turn_detection_overloaded`, words "Turn detection cannot keep up on this device."
  - Silero failing to load fails the leg: code `turn_detection_unavailable`.
- **Push-to-talk:** the runner's check (`lib/session/turn.ts`, 500 ms above mean amplitude 0.01) and `run.ts`'s press/release are not edited.
- **Not touched:** `public/workers/sherpa-onnx-asr.worker.js`, `voxtral-webgpu.worker.ts`, `native-vad.worker.ts`, `src/services/**` (Local Native), `sidecar/**`, every cloud provider, the sherpa WASM build. The two exceptions are a comment and test pins in Task 3.
- **Every new locale key goes into all 30 `src/locales/*/translation.json`, translated** (`locales.consistency.test.ts` holds every locale to en's key set). Existing `settings.vad*` keys are reused, not renamed.
- The repository is public: commit messages, comments and PR text name no machine, person, team or internal system.

### Decisions this plan takes where the spec leaves a choice

1. **The audio-and-marks output is built in PR B** (`MarksRelay` over the core's trace) and unit-tested against C1/C2. Nothing wires it: the worker accepts only the segments output. Steps 3 and 4 wire it.
   - Why: the trace is shared by both shapes, so building the relay now proves the core serves both.
   - If a reviewer prefers, Task 12 moves to step 3 unchanged. Nothing else depends on it.
2. **The five workers' VAD code is deleted in step 1, not left dormant.**
   - This covers `FrameProcessor`, Silero, `onnxruntime-all`, `processingVad`, `openTurnLink` and `handleFlush`.
   - After step 1 no caller can send them `vadConfig`. Keeping dead paths would keep three consistency tests pinning code nothing runs.
   - §4's "skip when no `vadConfig`" thus becomes "removed". Step 5 cleans what is left (sherpa, Voxtral 4B, the pad, the old keys).
3. **After a cap cut on an automatic turn, the turn continues** (§9 row "crossing the length limit with 100–300 ms left").
   - What follows the cut belongs to the same turn until Normal's silence rule, Smart, a drain or the next cap ends it.
   - It is emitted from the cut, with no pre-pad and no minSpeech check.
   - If every frame of it was below the negative threshold, nothing is emitted.
4. **Presses never ask Silero.** A press is cut at `resolveMaxSpeechFrames(maxSpeech, 0, limit)` frames: no pad inside a press, and the user's Max speech still applies, as the worker VAD did inside presses.
   - Under manual turns the detector loads no Silero at all.
   - Audio outside a press counts on the timeline and is no segment.
5. **`endedBy`** becomes `'silence' | 'smart' | 'cap' | 'release' | 'flush' | 'kept'`.
   - `release` is a press's end.
   - `flush` is an automatic leg's drain. Nothing calls it in step 1 beyond tests.
   - `kept` is the gate's misfire rescue, which moves unchanged.
6. **The decode-queue bound counts what waits ahead of the newest segment.** Otherwise one long press segment (Qwen3-ASR allows 40 s) would fail a leg that is keeping up. A waiting segment is one emitted and not yet `taken` (decode started) by the recognizer.
7. **What the settings show in step 1.**
   - Shown for every leg whose model has no turn detection of its own: rule 2, `takesOurTurnDetection`. That includes sherpa offline and Voxtral 4B, still `own` (C5) in this step.
   - Normal / Smart is offered only when an automatic leg is `shared`.
   - sherpa offline ignores Silence Threshold, Pre-pad and Max speech until step 2. The note under Max speech shows its fixed 20 s / 9 s.
   - See "Could not settle" in the hand-off.
8. **Limits live in the manifest.** sherpa's and Voxtral 4B's in-worker constants stay until their steps, pinned equal to the manifest by a test.
9. **The settings reach the builders through `SharedSettings.turnDetection`**, read by the run at start (`config.ts` reads no store, `noStoreRead.test.ts`).
10. **The adapter's drain wait** is a FIFO of pending drains, answered in order. A 60 s timeout logs a `local.turn.drain_timeout` frame. A drain logs `local.turn.drained {press, ms}`. Neither blocks anything.

## Review Focus

1. **Stored legacy values that are out of range or of the wrong type** (a hand-edited store, an older build's string). A person expects their tuning carried over where it makes sense and defaults elsewhere, never a crash or a NaN slider. Pinned in Task 1: `clamps an out-of-range legacy value and ignores one of the wrong type`.
2. **A stored Smart whose model was deleted, or whose worker fails to load.** The session must run Normal and must not hang. Pinned in Task 15: `a stored Smart with no Smart Turn model runs Normal: the detector gets no turn port`. Pinned in Task 6: `Smart failing or answering late: Normal still ends the segment`.
3. **The detector worker dying mid-session** (out of memory, a WASM trap). The leg must fail with a notice, not go silent. Pinned in Task 15: `the detector dying fails the leg: failed once, nothing more emitted`.
4. **Region-tagged source languages and speech translation.** `hi-IN`, `th_TH` and `zh-Hant` must find Qwen3-ASR's per-language limit by primary subtag, and a Granite AST leg its translate limit. Pinned in Task 3: `resolves Qwen3-ASR by primary subtag and Granite by task`.
5. **Empty or near-empty drains** (a release just after a cap, a drain with nothing open, a press holding only a partial frame). Whisper invents text for empty or near-empty audio, so no empty segment may be decoded. Pinned in Task 7: `a release right after a cap emits only drained` and `a press holding fewer than 512 samples is one segment of exactly those samples`. Pinned in Task 6: `a drain with nothing open emits only drained`.

---

## PR A — Settings, the per-leg decision, the limits, the one Controls component

No recognizer changes behaviour in PR A: every leg reads the same values from the new namespace. Until PR C, a `shared` leg is still served by its worker's own VAD; PR C changes only that transport.

### Task 1: `settings.turnDetection.*`, migrated once, handed to every builder

**Files:**
- Create: `src/lib/turn/turnDetectionSettings.ts`. Pure: types, defaults, ranges, migration, the VAD config.
- Create: `src/stores/turnDetectionStore.ts`.
- Create: `src/lib/turn/turnDetectionSettings.test.ts`, `src/stores/turnDetectionStore.test.ts`.
- Modify: `src/app/loadStores.ts`. Add `['turn detection', () => loadTurnDetection(service)]` to `loads`.
- Modify: `src/lib/run/types.ts`, `SharedSettings`. Add `turnDetection?: TurnDetectionSettings` with the doc "Turn detection as stored, read at start; absent: the defaults."
- Modify: `src/lib/session/shared.ts`. `buildSharedSettings` takes `turnDetection?` as a sixth parameter and copies it when given.
- Modify: `src/lib/session/appShape.ts`. Pass `useTurnDetectionStore.getState().settings`.
- Modify: `src/providers/localInference/config.ts`.
  - `localRecognition(td: TurnDetectionSettings, asrModelId: string)` builds `vad` from `td` (`vadConfigOf`).
  - `buildLocalInference` passes `shared.turnDetection ?? TURN_DETECTION_DEFAULTS`.
- Modify: `src/providers/localInference/transcriptionUnit.ts`, the same in `buildLocalTranscription`.
- Modify: `config.test.ts` and `transcriptionUnit.test.ts`: values come from `shared.turnDetection`.
- Until Task 4 the Speech settings still edit the old keys; do not release between.

**Interfaces:**
- Produces, in `src/lib/turn/turnDetectionSettings.ts`:
  - `interface TurnDetectionSettings { threshold: number; negativeThreshold: number; minSilence: number; minSpeech: number; prePad: number; maxSpeech: number; endOfTurn: VadEndOfTurn; smartTurnCheckAfter: number; smartTurnThreshold: number }`.
  - `TURN_DETECTION_DEFAULTS: TurnDetectionSettings`: the table's defaults.
  - `TURN_DETECTION_RANGES`: `{ min, max, step }` per numeric field. Reuse today's slider steps from `LocalSettingsControls.tsx` and `SMART_TURN_*_RANGE`.
  - `TURN_DETECTION_PREFIX = 'settings.turnDetection'`.
  - `LEGACY_TURN_DETECTION_FIELDS: Record<keyof TurnDetectionSettings, string>`: `threshold→vadThreshold`, `negativeThreshold→vadNegativeThreshold`, `minSilence→vadMinSilenceDuration`, `minSpeech→vadMinSpeechDuration`, `prePad→vadPreSpeechPadDuration`, `maxSpeech→vadMaxSpeechDuration`, `endOfTurn→vadEndOfTurn`, `smartTurnCheckAfter→smartTurnCheckAfter`, `smartTurnThreshold→smartTurnThreshold`. All under `settings.localInference.`.
  - `clampTurnDetection(raw: Partial<Record<keyof TurnDetectionSettings, unknown>>): Partial<TurnDetectionSettings>`: drops a non-finite number or a non-member enum, and clamps to range. A `negativeThreshold` above `threshold` reads as 0.
  - `migrateTurnDetection(stored, legacy): { settings: TurnDetectionSettings; writes: Partial<TurnDetectionSettings> }`. Both arguments are keyed by the new names; the store maps legacy keys.
  - `vadConfigOf(td: TurnDetectionSettings, smart: boolean): VadWebConfig`. Today's `localRecognition` mapping. `negativeThreshold` is only when non-zero. `smartTurn: { checkAfter: effectiveCheckAfter(td.smartTurnCheckAfter, td.minSilence), threshold }` only when `smart && td.endOfTurn === 'smart'` and the cap is not null.
- Produces, in `src/stores/turnDetectionStore.ts`:
  - `useTurnDetectionStore`: `{ settings: TurnDetectionSettings; update(patch: Partial<TurnDetectionSettings>): void; restoreDefaults(): void }`.
    - `update` clamps, sets, and persists each changed field with `persistSetting`.
    - `restoreDefaults` resets the eight numeric fields and keeps `endOfTurn`.
  - `loadTurnDetection(service: Pick<ISettingsService, 'getSetting'>): Promise<void>`: reads both key sets, migrates, writes `writes`, never writes otherwise.
- In Task 1, `smart` is passed as `supportsSmartTurn(entry)`; Task 2 replaces it.

- [ ] **Step 1: Write the failing tests**

```ts
// turnDetectionSettings.test.ts
it('takes each stored localInference value once, to be written under settings.turnDetection', () => {
  const { settings, writes } = migrateTurnDetection({}, { threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
  expect(settings).toEqual({ ...TURN_DETECTION_DEFAULTS, threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
  expect(writes).toEqual({ threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
});
it('a value already under settings.turnDetection wins and is not written again', () => {
  expect(migrateTurnDetection({ threshold: 0.5 }, { threshold: 0.45 })).toEqual({ settings: { ...TURN_DETECTION_DEFAULTS, threshold: 0.5 }, writes: {} });
});
it('nothing stored: the defaults, nothing written', () => {
  expect(migrateTurnDetection({}, {})).toEqual({ settings: TURN_DETECTION_DEFAULTS, writes: {} });
});
it('clamps an out-of-range legacy value and ignores one of the wrong type', () => {
  const { settings, writes } = migrateTurnDetection({}, { threshold: 2, minSpeech: '0.4', endOfTurn: 'fast', maxSpeech: 5 });
  expect(settings).toMatchObject({ threshold: 0.95, minSpeech: 0.4, endOfTurn: 'normal', maxSpeech: 10 });
  expect(writes).toEqual({ threshold: 0.95, maxSpeech: 10 });
});
it('vadConfigOf: Smart only when asked for and stored, its check capped at Max Wait − 0.2', () => {
  const td = { ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' as const, minSilence: 0.4, smartTurnCheckAfter: 0.5 };
  expect(vadConfigOf(td, true).smartTurn).toEqual({ checkAfter: 0.2, threshold: 0.5 });
  expect(vadConfigOf(td, false).smartTurn).toBeUndefined();
});
// turnDetectionStore.test.ts
// Fake service: a Map from key to value.
it('loadTurnDetection reads settings.localInference.vadThreshold once and writes settings.turnDetection.threshold', async () => { /* persistSetting called once with ('settings.turnDetection.threshold', 0.45); a second load writes nothing */ });
it('update persists only the fields that changed, clamped', () => { /* update({ threshold: 0.3, minSilence: 3 }) on defaults → one write, ('settings.turnDetection.minSilence', 2) */ });
it('restoreDefaults puts the eight sliders back and keeps Normal / Smart', () => { /* … */ });
// config.test.ts
it('the leg reads turn detection from shared.turnDetection, the defaults without it', () => { /* threshold 0.45 → config.vad.threshold 0.45; absent → 0.3 */ });
```

- [ ] **Step 2:** Run `npx vitest run src/lib/turn src/stores/turnDetectionStore.test.ts src/providers/localInference/config.test.ts src/providers/localInference/transcriptionUnit.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the two modules and the wiring listed under Files.
- [ ] **Step 4:** Run the same command, then `npx vitest run`. Expected: PASS, no new failure.
- [ ] **Step 5:** Commit.

```bash
git add src/lib/turn/turnDetectionSettings.ts src/lib/turn/turnDetectionSettings.test.ts src/stores/turnDetectionStore.ts src/stores/turnDetectionStore.test.ts src/app/loadStores.ts src/lib/run/types.ts src/lib/session/shared.ts src/lib/session/appShape.ts src/providers/localInference/config.ts src/providers/localInference/config.test.ts src/providers/localInference/transcriptionUnit.ts src/providers/localInference/transcriptionUnit.test.ts
git commit -m "feat(turns): settings.turnDetection, migrated once from the local provider's VAD keys, read by every local build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: C5 — the per-leg decision; Smart only on `shared` legs; `turnOwner` retired

**Files:**
- Create: `src/lib/turn/turnDetection.ts`, `src/lib/turn/turnDetection.test.ts`.
- Modify: `src/lib/turn/smartTurn.ts`. Delete `SMART_TURN_WORKER_TYPES` and `supportsSmartTurn`. `smartTurn.test.ts` loses their cases.
- Modify: `src/providers/localInference/config.ts`.
  - `LocalInferenceConfig.asr` gains `turnDetection: TurnDetection`.
  - `localRecognition` sets it and passes `smart = turnDetection === 'shared'` to `vadConfigOf`.
- Modify: `src/providers/localInference/LocalInferenceTurnDetection.tsx`: `supportsSmartTurn(e)` becomes `turnDetectionOf(e) === 'shared'`. Task 4 rewrites the file.
- Modify: `src/lib/local-inference/workers/turnGate.consistency.test.ts`: import `DETECTOR_WORKER_TYPES` in place of `SMART_TURN_WORKER_TYPES`.
- Modify, to retire `turnOwner`:
  - `src/lib/run/types.ts`: delete the member and its doc.
  - The sites that declare it: `lib/plan/wholeUnit.ts`, `lib/textModel/unit.ts`, `providers/fake/{translator,transcriber,voice}.ts`, `providers/soniox/{units,ttsUnit}.ts`, `providers/localInference/{translationUnit,speechUnit,transcriptionUnit}.ts`, `providers/bing/unit.ts`, `providers/edge/unit.ts`.
  - The tests that list it: `lib/plan/wholeUnit.test.ts`, `providers/soniox/{units,ttsUnit}.test.ts`, `providers/fake/voice.test.ts`, `providers/localInference/{transcriptionUnit,speechUnit,provider}.test.ts`.
  - `git grep -n turnOwner -- src` prints nothing after.

**Interfaces:**
- Produces, in `src/lib/turn/turnDetection.ts`:
  - `type TurnDetection = 'shared' | 'own'`.
  - `DETECTOR_WORKER_TYPES = ['whisper-webgpu', 'cohere-transcribe-webgpu', 'granite-speech-webgpu', 'qwen3-asr-webgpu', 'voxtral-3b-webgpu'] as const`. Step 2 adds `'sherpa-onnx'` for `type: 'asr'`; step 3 adds `'voxtral-webgpu'`.
  - `turnDetectionOf(entry: Pick<ModelManifestEntry, 'type' | 'asrWorkerType'> | undefined): TurnDetection`: `'shared'` iff `entry.type === 'asr'` and its worker type is in the list.
  - `takesOurTurnDetection(entry): boolean`: rule 2, every `'asr'` entry, and an `'asr-stream'` entry with a worker type (Voxtral 4B). Deleted in step 5, when it equals `turnDetectionOf(e) === 'shared'`.
  - `interface TurnDetectionLeg { entry: ModelManifestEntry | undefined; turns: 'auto' | 'manual'; task: 'transcribe' | 'translate'; language: string }`.
  - `interface TurnDetectionScope { shown: boolean; smartOffered: boolean; limitSeconds?: number }`. `limitSeconds` arrives in Task 3.
  - `turnDetectionScope(legs: readonly TurnDetectionLeg[], td: TurnDetectionSettings): TurnDetectionScope`:
    - `shown` = some leg `takesOurTurnDetection`;
    - `smartOffered` = some leg with `turns === 'auto'` is `shared`.

- [ ] **Step 1: Write the failing tests**

```ts
// turnDetection.test.ts
it.each(['whisper-base-webgpu', 'cohere-transcribe-webgpu', 'granite-speech', 'qwen3-asr-0.6b-webgpu', 'voxtral-mini-3b-webgpu'])('%s is shared', (id) =>
  expect(turnDetectionOf(getManifestEntry(id))).toBe('shared'));
it.each(['sensevoice-int8', 'moonshine-tiny-ja-quant', 'voxtral-mini-4b-webgpu'])('%s is own in step 1 and still takes our settings', (id) => {
  expect(turnDetectionOf(getManifestEntry(id))).toBe('own');
  expect(takesOurTurnDetection(getManifestEntry(id))).toBe(true);
});
it('a streaming sherpa model is own and takes none', () => { /* 'stream-en-kroko' → 'own', false */ });
it('an unknown model is own and takes none', () => { /* undefined → 'own', false */ });
it('Smart is offered through any automatic leg on a shared model: a manual speaker on Whisper offers it only through an automatic participant on Whisper', () => { /* … */ });
// config.test.ts
it('a Whisper leg is shared and gets Smart when stored; a SenseVoice leg is own and never does', () => { /* asr.turnDetection; vad.smartTurn */ });
it('two legs on different models decide apart', () => { /* speaker ja→en on whisper-base-webgpu: shared; participant en→ja on sensevoice-int8: own */ });
it('the same direction built twice with the model changed between the builds changes the decision', () => { /* … */ });
// transcriptionUnit.test.ts
it('the transcription-only unit decides per leg the same way', () => { /* … */ });
```

- [ ] **Step 2:** Run `npx vitest run src/lib/turn src/providers/localInference`. Expected: FAIL.
- [ ] **Step 3:** Implement `turnDetection.ts`; edit `config.ts`, `smartTurn.ts` and `LocalInferenceTurnDetection.tsx`; delete `turnOwner` everywhere listed.
- [ ] **Step 4:** Run `npx vitest run src/lib src/providers` and `npx tsc --noEmit -p tsconfig.json`. Expected: PASS; tsc count not above base.
- [ ] **Step 5:** Commit, staging every file listed under Files explicitly.
  - Message: `feat(turns): which legs our turn detection serves, decided per leg from the resolved model; Smart only on shared legs; turnOwner retired`.
  - Trailer: Co-Authored-By.

### Task 3: C4 — each engine's length limit in the manifest, with its kind

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts`.
  - `AsrLengthLimit`; `ModelManifestEntry.asrLimit?: AsrLengthLimit`.
  - Named constants `WHISPER_LIMIT`, `VOXTRAL_3B_LIMIT`, `GRANITE_LIMIT`, `QWEN3_ASR_LIMIT`, `VOXTRAL_REALTIME_LIMIT`, `MOONSHINE_V2_LIMIT`, `SHERPA_OFFLINE_LIMIT`. Each carries the measurement comment moved from its worker (whisper :94-104, granite :90-101, qwen3 :80-96, voxtral-3b at `VOXTRAL_3B_MAX_SEGMENT_SAMPLES`, voxtral-webgpu at `VOXTRAL_REALTIME_MAX_SPEECH_SECONDS`, sherpa worker :275-284).
  - `asrLimit` set on the six Whisper entries, `voxtral-mini-3b-webgpu`, both Granite entries, both Qwen3-ASR entries, `voxtral-mini-4b-webgpu`, and the nine `asrEngine: 'moonshine-v2'` entries.
  - `asrLimitOf` and `segmentLimitFor`.
- Modify: `src/lib/turn/turnDetection.ts`. `turnDetectionScope` sets `limitSeconds`.
- Modify: `src/providers/localInference/config.ts`.
  - `localRecognition(td, asrModelId, leg: RecognitionLeg)`; `LocalInferenceConfig.limit?: SegmentLimit`, set for `shared` legs.
  - Callers pass `{ language: direction.source, task: translation.kind === 'ast' ? 'translate' : 'transcribe' }`; the transcription unit always `'transcribe'`.
- Modify, comments only: in each worker that still holds its constant, a comment pointing at the manifest constant. That is the five WebGPU workers (Task 13 deletes theirs), `voxtral-webgpu.worker.ts` and `public/workers/sherpa-onnx-asr.worker.js`.
- Create: `src/lib/local-inference/modelManifest.asrLimit.test.ts`.
- Create: `src/lib/local-inference/workers/asrLimits.consistency.test.ts`. It pins each in-worker constant equal to the manifest:
  - `WHISPER_MAX_SEGMENT_SAMPLES = 29 * VAD_SAMPLE_RATE`; `VOXTRAL_3B_MAX_SEGMENT_SAMPLES = 30 * VAD_SAMPLE_RATE`;
  - `GRANITE_MAX_SPEECH_SECONDS = 30` and `GRANITE_TRANSLATE_MAX_SPEECH_SECONDS = 20`;
  - `QWEN3_ASR_MAX_SPEECH_SECONDS = { hi: 15, th: 20 }` and `QWEN3_ASR_DEFAULT_MAX_SPEECH_SECONDS = 40`;
  - `VOXTRAL_REALTIME_MAX_SPEECH_SECONDS = 35`;
  - sherpa's `asrEngine === 'moonshine-v2' ? 9 : 20`.

**Interfaces:**
- Produces:
  - `interface AsrLengthLimit { kind: 'segment' | 'speech'; seconds: number; byTask?: { translate?: number }; byLanguage?: Readonly<Record<string, number>> }`.
  - `asrLimitOf(entry: ModelManifestEntry | undefined): AsrLengthLimit | undefined`: `entry.asrLimit`, or `SHERPA_OFFLINE_LIMIT` for an `'asr'` entry on `sherpa-onnx`.
  - `segmentLimitFor(entry, leg: { task: 'transcribe' | 'translate'; language: string }): SegmentLimit`:
    - `byLanguage` by primary subtag (`toLowerCase().split(/[-_]/)[0]`), then `byTask`;
    - `segment` → `{ maxSegmentSamples: seconds * 16000 }`, `speech` → `{ maxSpeechSeconds: seconds }`, none → `{}`.
  - `type RecognitionLeg = { language: string; task: 'transcribe' | 'translate' }` (`config.ts`).
  - `TurnDetectionScope.limitSeconds`. Over the shown legs, the smallest `resolveMaxSpeechFrames(td.maxSpeech, td.prePad * 1000, segmentLimitFor(entry, leg)) * 0.032`, rounded to 0.1 s. Set only when below `td.maxSpeech`.

- [ ] **Step 1: Write the failing tests**

```ts
it('Whisper: a 29 s segment, 881 frames at a 30 s setting and a 0.8 s pad', () => {
  expect(segmentLimitFor(getManifestEntry('whisper-base-webgpu'), { task: 'transcribe', language: 'ja' })).toEqual({ maxSegmentSamples: 464000 });
  expect(resolveMaxSpeechFrames(30, 800, { maxSegmentSamples: 464000 })).toBe(881);
});
it('resolves Qwen3-ASR by primary subtag and Granite by task', () => {
  const q = getManifestEntry('qwen3-asr-0.6b-webgpu');
  expect(segmentLimitFor(q, { task: 'transcribe', language: 'hi-IN' })).toEqual({ maxSpeechSeconds: 15 });
  expect(segmentLimitFor(q, { task: 'transcribe', language: 'th_TH' })).toEqual({ maxSpeechSeconds: 20 });
  expect(segmentLimitFor(q, { task: 'transcribe', language: 'zh-Hant' })).toEqual({ maxSpeechSeconds: 40 });
  expect(segmentLimitFor(getManifestEntry('granite-speech'), { task: 'translate', language: 'en' })).toEqual({ maxSpeechSeconds: 20 });
  expect(segmentLimitFor(getManifestEntry('granite-speech-4.1-2b'), { task: 'transcribe', language: 'en' })).toEqual({ maxSpeechSeconds: 30 });
});
it.each([
  ['voxtral-mini-3b-webgpu', { maxSegmentSamples: 480000 }], ['cohere-transcribe-webgpu', {}],
  ['voxtral-mini-4b-webgpu', { maxSpeechSeconds: 35 }], ['moonshine-tiny-ja-quant', { maxSpeechSeconds: 9 }], ['sensevoice-int8', { maxSpeechSeconds: 20 }],
])('%s', (id, limit) => expect(segmentLimitFor(getManifestEntry(id), { task: 'transcribe', language: 'ja' })).toEqual(limit));
it('every entry of a detector worker type except Cohere declares a limit', () => { /* manifest scan */ });
// turnDetection.test.ts
it('the Max speech note: 28.2 s for Whisper at 30 s with a 0.8 s pad, none at 20 s', () => { /* limitSeconds */ });
// config.test.ts
it('a shared leg carries its limit for its task and language; an own leg none', () => { /* AST Granite leg → { maxSpeechSeconds: 20 } */ });
```

- [ ] **Step 2:** Run `npx vitest run src/lib/local-inference/modelManifest.asrLimit.test.ts src/lib/local-inference/workers/asrLimits.consistency.test.ts src/lib/turn src/providers/localInference/config.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Files.
- [ ] **Step 4:** Same command, then `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit, staging the manifest, the two new tests, `turnDetection.ts`/`.test.ts`, `config.ts`/`config.test.ts`, `transcriptionUnit.ts`, and the seven commented workers by path.
  - Message: `feat(turns): each recognizer's length limit in the model manifest, with its kind`.
  - Trailer: Co-Authored-By.

### Task 4: One Controls component for turn detection

**Files:**
- Create: `src/components/Settings/turnDetection/TurnDetectionControls.tsx`. It exports `TurnDetectionControls`, `TurnDetectionSummary` and `TurnDetectionHelp`, all bound to `useTurnDetectionStore`.
  - Move `VadControl` (as the sliders) and `EndOfTurnControl` here from `LocalSettingsControls.tsx`.
  - The sliders are keyed by the new field names and always all six. The two Smart sliders show only under Smart.
  - Add the note under Max speech.
- Move the tests: `git mv src/components/Settings/sections/LocalSettingsControls.vad.test.tsx src/components/Settings/turnDetection/TurnDetectionControls.test.tsx`; fold `LocalSettingsControls.endOfTurn.test.tsx` into it (`git rm` the old file).
- Modify: `src/components/Settings/sections/LocalSettingsControls.tsx`. Delete `VadControl`, `VadValues`, `EndOfTurnControl` and their imports.
- Rewrite: `src/providers/localInference/LocalInferenceTurnDetection.tsx`.
  - `useTurnDetectionLegs(settings, pair): TurnDetectionLeg[]` resolves the speaker's and participant's models as today's `useVadKnobs` does. Turns are speaker `auto`/`manual` from `turnModeStore`, participant `auto`; legs come from `providerStore.legs`. It keeps the Smart refresh effect.
  - The three exports render the generic components with `turnDetectionScope(legs, useTurnDetectionStore((s) => s.settings))`; the provider's own `settings` supply only `selections`.
  - `useVadKnobs`, `showVad`, `vadIsWebWorker`, `SLIDER_KEYS` go.
- Modify: `src/providers/localInference/settings.ts`. Delete the nine `vad*`/`smartTurn*` fields from `LocalInferenceSettings` and `LOCAL_INFERENCE_DEFAULTS`; drop the `VadEndOfTurn` import. `settings.test.ts` follows.
- Modify: `LocalInferenceTurnDetection.test.tsx`, `SpeechSection.test.tsx`, `SpeechSection.turnDetectionHelp.test.tsx`: values come from the store.
- Modify: all 30 `src/locales/*/translation.json`. Add `settings.turnDetectionLimitNote`, en `"This model splits utterances longer than {{seconds}} s."`, translated in each.

**Interfaces:**
- Consumes: `useTurnDetectionStore` (Task 1); `TurnDetectionLeg`, `TurnDetectionScope`, `turnDetectionScope` (Tasks 2–3).
- Produces: `TurnDetectionControls({ scope, disabled }: { scope: TurnDetectionScope; disabled?: boolean })`; `TurnDetectionSummary({ scope })`; `TurnDetectionHelp({ scope })`. Each renders nothing when `!scope.shown`. The LocalInference slot keeps `SettingsProps<LocalInferenceSettings>` (it needs `selections` and `pair`).

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the same six sliders for SenseVoice as for Whisper', () => { /* both scopes shown → six labelled sliders */ });
it('shows nothing for a streaming model', () => { /* scope.shown false → container empty */ });
it('offers Normal / Smart only when an automatic leg is on a shared model', () => { /* SenseVoice-only scope: no EndOfTurnControl */ });
it('writes settings.turnDetection.*, never settings.localInference.*', () => { /* persistSetting spy: ('settings.turnDetection.minSilence', 1.2) */ });
it('Restore defaults puts the eight sliders back and keeps Normal / Smart', () => { /* … */ });
it('names the model limit under Max speech when it is below the setting', () => {
  // scope.limitSeconds 28.2 → getByText('This model splits utterances longer than 28.2 s.')
});
it('Summary: "VAD Settings · Min Silence Duration: 1.40s", and under Smart "VAD Settings · Smart · Max Wait 1.40s"', () => { /* … */ });
it('turning Smart on downloads the model first and raises a Max Wait under 0.3 s to 0.3 s', () => { /* today's enableSmart rule, on the store */ });
```

- [ ] **Step 2:** Run `npx vitest run src/components/Settings src/providers/localInference src/locales`. Expected: FAIL.
- [ ] **Step 3:** Implement per Files.
- [ ] **Step 4:** Same command; then `npx vitest run`; `npx tsc --noEmit -p tsconfig.json`. Expected: PASS; tsc not above base. Then `git grep -nE "useVadKnobs|vadIsWebWorker|showVad|SMART_TURN_WORKER_TYPES|supportsSmartTurn" -- src` prints nothing.
- [ ] **Step 5:** Commit, staging every file above by path (the 30 locale files listed explicitly).
  - Message: `feat(turns): one turn detection control set, the same knobs for every recognizer we detect turns for`.
  - Trailer: Co-Authored-By.
- [ ] **Step 6 (PR A done):**
  - Run `npx vitest run` and tsc.
  - Ask the owner to confirm opening the PR on `kizuna-ai-lab/sokuji`, head `feat/turn-detection-settings`, base `main`.

---

## PR B — The turn detector (pure parts, worker, engine; wired to nothing yet)

All new files sit under `src/lib/local-inference/workers/_shared/` unless stated. Every part takes an injected `infer` (Silero probability per 512-sample frame), so tests run without ONNX.

### Task 5: One timeline per leg — `TimelineResampler`

**Files:**
- Create: `timeline-resampler.ts`, `timeline-resampler.test.ts`.

**Interfaces:**
- Produces `class TimelineResampler`:
  - `constructor(inputRate = 24000)`;
  - `push(pcm: Int16Array): Float32Array`;
  - `flush(): Float32Array`;
  - `get position(): number`, the 16 kHz samples emitted since the leg's first chunk.
- The rule, which fixes the algorithm:
  - Output sample `i` is the interpolation at input index `1.5·i`, computed exactly as the workers do: `a/32768 + (b/32768 − a/32768)·frac`.
  - It is emitted once input index `ceil(1.5·i)` has arrived.
  - `flush()` emits the one pending odd-index sample, if any, holding the last input sample.
  - The grid is the leg's and never restarts, through presses and cancels.
  - At 16000 in, samples pass through as `x/32768`.

- [ ] **Step 1: Write the failing tests**

```ts
it("matches the workers' per-chunk resampling bit for bit on the runner's 2400-sample chunks", () => {
  /* compare with a copy of whisper-webgpu.worker.ts's resampleInt16ToFloat32_16k over 20 random chunks: toEqual per sample */
});
it('any chunking gives the samples of one chunk, and positions never drift', () => {
  /* seeded random sizes 1..5000, 200 trials: concat(push…, flush) equals push(all) + flush(); position equal */
});
it('after N input samples and a flush, the position is floor(2(N−1)/3) + 1', () => { /* N = 1, 2, 3, 2401, 1_000_000 */ });
it('16 kHz input passes through', () => { /* … */ });
```

- [ ] **Step 2:** `npx vitest run src/lib/local-inference/workers/_shared/timeline-resampler.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit both paths.
  - Message: `feat(turns): one 16 kHz timeline per leg, resampled once with no drift`.
  - Trailer: Co-Authored-By.

### Task 6: The core — automatic turns, the trace, the segments' shape

**Files:**
- Create: `turn-detector-protocol.ts`. Every type and constant of the detector; Tasks 7–12 use them.
- Create: `frame-log.ts`, `turn-detector-core.ts`, `segment-assembler.ts`.
- Create: `turn-detector-core.test.ts`, `segment-assembler.test.ts`.
- Modify: `src/lib/local-inference/types.ts`. Add `'release'` to `SegmentEnd['endedBy']` and update its doc: "a press's release; `flush`: an automatic leg's drain".

**Interfaces:**
- Produces, in `turn-detector-protocol.ts`:

```ts
export type SegmentEndedBy = SegmentEnd['endedBy'];
export type TurnTrace =
  | { kind: 'frame'; from: number; to: number; samples: Float32Array }   // real 16 kHz samples processed; a drained partial frame is < 512
  | { kind: 'open'; at: number; press?: number }                          // a segment will start at `at` (auto: pad included, never before the last close)
  | { kind: 'close'; from: number; to: number; endedBy: SegmentEndedBy; press?: number; smartTurnProbability?: number }
  | { kind: 'drop'; from: number; to: number }                            // an open segment that ends as no segment (a misfire nobody keeps)
  | { kind: 'cancel'; press: number }
  | { kind: 'drained' };
export interface DetectorSegment { type: 'segment'; epoch: number; seq: number; press?: number; audio: Float32Array; start: number; end: number; endedBy: SegmentEndedBy; smartTurnProbability?: number }
export interface DetectorCancel { type: 'cancel'; epoch: number; seq: number; press: number }
export interface DetectorDrained { type: 'drained'; epoch: number; seq: number }
export type DetectorOutput = DetectorSegment | DetectorCancel | DetectorDrained;   // detector → recognizer, one ordered port
export interface RecognizerTaken { type: 'taken'; epoch: number; seq: number }     // recognizer → detector, same port
export type TurnFailureCode = 'turn_detection_overloaded' | 'turn_detection_unavailable';
export type DetectorNotice = { type: 'speech_start' } | { type: 'failed'; code: TurnFailureCode; message: string };
export const INPUT_BACKLOG_SECONDS = 2;
export const DECODE_QUEUE_SEGMENTS = 5;
export const DECODE_QUEUE_SECONDS = 30;
```

- Produces `class FrameLog`: `append(samples: Float32Array): void`, `slice(from: number, to: number): Float32Array` (a fresh copy, transferable), `trimBefore(position: number): void`, `get end(): number`.
- Produces `class TurnDetectorCore`:
  - `constructor(o: TurnDetectorCoreOptions)`;
  - `push(pcm: Int16Array)`, `begin(press: number)`, `drain(press?: number)`, `cancel(press: number)`: all queued, processed in call order;
  - `stop(): void`: drops the queue at once;
  - `idle(): Promise<void>`;
  - `earliestNeeded(): number`, where a later segment may start, for `FrameLog.trimBefore`.
- `TurnDetectorCoreOptions`:

```ts
{ turns: 'auto' | 'manual'; vad: VadWebConfig; limit: SegmentLimit; inputRate?: number;
  infer?: (frame: Float32Array) => Promise<number>;      // required for 'auto'
  resetModel?: () => void;
  smart?: (processor: FrameProcessorParams) => SmartLink | null;
  trace: (event: TurnTrace) => void; notify: (notice: DetectorNotice) => void }
type SmartLink = Pick<TurnLink, 'afterFrame' | 'rescue' | 'reset' | 'close'>
```

- Produces `class SegmentAssembler`:
  - `constructor(o: { post(msg: DetectorOutput, transfer: Transferable[]): void; notify(n: DetectorNotice): void; earliestNeeded(): number; epoch?: number })`;
  - `trace(event: TurnTrace): void`: appends `frame` samples to its `FrameLog`; slices `close` into a segment; passes `cancel` and `drained` through; trims after each close;
  - `taken(msg: RecognizerTaken): void` and `stop(epoch: number): void` arrive in Task 8.
- The automatic-turn rules, which fix the algorithm:
  - The `FrameProcessor` is built exactly as `whisper-webgpu.worker.ts`'s `initVad`: `resolveVadThresholds`, redemption = `minSilence`, `minSpeech`, `prePad`, `submitUserSpeechOnPause: false`, `VAD_FRAME_MS`.
  - Each 512-sample frame: `process`, then `trace({ kind: 'frame' })`.
  - **SpeechStart:** `notify(speech_start)`, then `open{ at }`. `at` is this frame's start minus the pad frames the processor holds. Track pad frames as `TurnGate.push` does, and clamp `at` to at least the last close's `to`.
  - **SpeechEnd:** `close{ endedBy: 'silence' }`.
  - **Misfire:** the gate's `rescue()` gives `close{ 'kept' }`, else `drop`.
  - **Smart** (`smart.afterFrame` non-null): `endSegment`, then `close{ 'smart', smartTurnProbability }`.
  - **Cap**, at `resolveMaxSpeechFrames(maxSpeech, prePad·1000, limit)` speech frames counted as the workers count them: `endSegment`, `close{ 'cap' }`, `smart.reset()`, then `open{ at: to }` as a continuation.
  - **The continuation (Decision 3)** is already open: a SpeechStart inside it opens nothing new and only sends `speech_start`. It ends when one of these comes first:
    - the processor's own end of a segment it started meanwhile: SpeechEnd, Smart, or the next cap. That close starts at the continuation, and a misfire there closes as `'silence'`;
    - while the processor is not speaking, `redemptionFrames` frames below the negative threshold counted as the processor counts them (reset on ≥ positive). Then `close{ 'silence' }` if any frame since the cut was ≥ negative, else `drop`.
  - **`drain()`:**
    - A partial frame is zero-padded to 512 for `process`; `frame` carries only its real samples.
    - If a segment is open: `endSegment`, then the same close rules with `endedBy 'flush'`.
    - Then `drained`.

- [ ] **Step 1: Write the failing tests** (fake `infer` returns a probability per frame index; small parameters: `prePad 0.064`, `minSilence 0.128`, `minSpeech 0.096`)

```ts
it("a segment's audio is the FrameProcessor's own: pad, speech and the silence that ended it", () => {
  /* seeded random probability tracks; a bare FrameProcessor run beside the core; every SpeechEnd ev.audio toEqual the assembled segment.audio */
});
it("start and end are positions on the leg's timeline: end − start = audio.length", () => { /* … */ });
it('a misfire is dropped: no segment', () => { /* … */ });
it('the cap cuts at resolveMaxSpeechFrames(maxSpeech, prePad, limit) speech frames', () => { /* limit { maxSpeechSeconds: 1 } → 32 frames */ });
it('after a cap, 200 ms more speech then silence is one more segment from the cut: no pad, not dropped as a misfire', () => {
  /* segments: [s0, cut) 'cap', [cut, cut + 6·512 + redemption) 'silence'; the second starts exactly at the first's end */
});
it('after a cap, silence alone ends the turn with nothing more', () => { /* … */ });
it("Smart ends a segment at the frame after its answer, endedBy 'smart' with the probability", () => { /* fake SmartLink */ });
it('a Smart answer for an earlier segment never ends the next one', () => { /* real TurnGate behind the fake link */ });
it('Smart failing or answering late: Normal still ends the segment', () => { /* link that never answers; answers after SpeechEnd */ });
it('a misfire after a Smart end inside Normal\'s wait is kept', () => { /* endedBy 'kept' */ });
it("drain: the partial frame is padded for the VAD only; the closing segment holds its real samples, endedBy 'flush', then drained", () => { /* … */ });
it('a drain with nothing open emits only drained', () => { /* … */ });
it('two cores fed interleaved keep their positions, state and output apart', () => { /* … */ });
it('the trace is well formed on random input', () => {
  /* 300 seeded runs of random probabilities, chunk sizes and drains: frames contiguous from 0; open/close|drop alternate;
     closes ordered and disjoint, each within processed frames; no close starts before the previous close's end */
});
```

- [ ] **Step 2:** `npx vitest run src/lib/local-inference/workers/_shared/turn-detector-core.test.ts src/lib/local-inference/workers/_shared/segment-assembler.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the four modules and the `types.ts` change.
- [ ] **Step 4:** Same command, then `npx vitest run src/lib/local-inference`. Expected: PASS.
- [ ] **Step 5:** Commit the six new files and `types.ts`.
  - Message: `feat(turns): the turn detector's core: automatic turns on one timeline, segments of today's shape, a cap that keeps the turn`.
  - Trailer: Co-Authored-By.

### Task 7: The core — presses (§5, C2)

**Files:**
- Modify: `turn-detector-core.ts`, `turn-detector-core.test.ts`.

**Interfaces:**
- Consumes Task 6's core and trace.
- The rules, which fix the algorithm, under `turns: 'manual'`:
  - `infer` is never called.
  - `begin(p)`: `open{ at: position, press: p }`. If a press is still open, it is first closed as a release.
  - Every input sample of the press goes to the trace.
  - At `resolveMaxSpeechFrames(maxSpeech, 0, limit) · 512` samples since the segment's start: `close{ 'cap', press }` and `open{ at: to, press }`.
  - `drain(p)`: `flush()` the resampler; `close{ 'release', press }` when the open segment holds at least one sample, else nothing; then `drained`.
  - `cancel(p)`: no close; `cancel{ press }`.
  - Audio with no press open: `frame` only.

- [ ] **Step 1: Write the failing tests**

```ts
it('under manual turns Silero is never asked', () => { /* infer spy not called */ });
it("a press is one segment of every sample from begin to release, endedBy 'release': quiet speech is not dropped", () => { /* amplitude 200/32768 */ });
it('a 500 ms press: 8000 samples, one segment of 8000; the 320 after the last whole frame come at release, not later', () => { /* … */ });
it('a press holding fewer than 512 samples is one segment of exactly those samples', () => { /* … */ });
it('a Whisper press of 463872 + 3200 samples: [0, 463872) cap and [463872, 467072) release, both of the press, the tail decoded once', () => {
  /* limit { maxSegmentSamples: 464000 }, maxSpeech 30 → 906 frames */
});
it('a release right after a cap emits only drained', () => { /* … */ });
it('cancel drops the open audio and emits cancel{press}; nothing more of that press', () => { /* … */ });
it("quick repeated presses: each segment carries its own press, and no sample of press 1 is in press 2's", () => { /* … */ });
it('audio outside a press counts on the timeline and is no segment; positions keep counting through presses and cancels', () => { /* … */ });
```

- [ ] **Step 2:** Run the core test. Expected: the new cases FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the core test. Expected: PASS.
- [ ] **Step 5:** Commit the two paths.
  - Message: `feat(turns): presses in the turn detector: the press is the turn, cut only at the engine's limit`.
  - Trailer: Co-Authored-By.

### Task 8: Bounded queues, drain acknowledgement, epochs, failures (C3)

**Files:**
- Modify: `turn-detector-core.ts` (input backlog), `segment-assembler.ts` (seq, epoch, `taken`, decode bound, `stop`), and their tests.

**Interfaces:**
- `TurnDetectorCore.push` counts unprocessed input samples. Past `INPUT_BACKLOG_SECONDS · inputRate`, it notifies `failed{ code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' }` once, drops its queue and accepts nothing more.
- `SegmentAssembler`:
  - Gives every output a `seq` from 1 and the current `epoch` (from 1).
  - Transfers `audio.buffer` and keeps no copy.
  - Counts as waiting each segment of its epoch not yet `taken`.
  - After posting a segment, it fails the leg (the same notice, once) when more than `DECODE_QUEUE_SEGMENTS` wait, or when the waiting audio **excluding the newest segment** exceeds `DECODE_QUEUE_SECONDS · 16000`.
  - `stop(epoch)` sets the epoch and posts nothing more of the older one; a `taken` of an older epoch is ignored.

- [ ] **Step 1: Write the failing tests**

```ts
it('input slower than real time: past 2 s unprocessed the leg fails once and processes nothing more', () => { /* infer held pending; push 2.1 s */ });
it('exactly 2 s unprocessed does not fail', () => { /* … */ });
it('a sixth waiting segment fails the leg; taken acks free the queue', () => { /* … */ });
it('more than 30 s waiting ahead of the newest segment fails it; one 40 s segment alone does not', () => { /* … */ });
it('stop with a backlog returns at once: queued input dropped, nothing more posted, late taken ignored', () => { /* … */ });
it('every output message carries seq from 1 in order and the epoch; after stop(2) nothing of epoch 1 is posted', () => { /* … */ });
it("the segment's buffer is in the transfer list: the detector keeps no copy", () => { /* post spy */ });
```

- [ ] **Step 2:** Run both tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both tests. Expected: PASS.
- [ ] **Step 5:** Commit the four paths.
  - Message: `feat(turns): the turn detector's queues are bounded; epochs and acknowledgements`.
  - Trailer: Co-Authored-By.

### Task 9: The recognizer's side — `SegmentInbox`

**Files:**
- Create: `segment-inbox.ts`, `segment-inbox.test.ts` (real `MessageChannel`).

**Interfaces:**
- Produces:

```ts
export interface DecodeTag extends SegmentEnd { press?: number; epoch: number }
export class SegmentInbox {
  constructor(port: MessagePort,
              decode: (audio: Float32Array, startSample: number, tag: DecodeTag) => Promise<void>,
              toMain: (msg: { type: 'drained'; epoch: number; seq: number }) => void);
  stop(epoch: number): void;   // segments of an older epoch are dropped; their drained marks unanswered
  close(): Promise<void>;      // stops listening; resolves when the decode in flight has finished
}
```

- [ ] **Step 1: Write the failing tests**

```ts
it("decodes one segment at a time, in seq order, and acks taken as each starts", async () => { /* … */ });
it('a slow decode does not stop segments arriving; they wait in order', async () => { /* … */ });
it('after stop(2), segments of epoch 1 are dropped and acked taken', async () => { /* … */ });
it("cancel{press} drops that press's segments not yet started; the one decoding finishes", async () => { /* … */ });
it('drained{seq} is answered once everything before it is decoded or dropped', async () => { /* … */ });
it('a decode that throws does not stop the next', async () => { /* … */ });
it('passes start, press, epoch, endedBy and the Smart probability to decode', async () => { /* … */ });
it('close() stops listening and resolves after the decode in flight', async () => { /* … */ });
```

- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit both paths.
  - Message: `feat(turns): the recognizers' segment inbox: in order, acknowledged, epoch- and cancel-aware`.
  - Trailer: Co-Authored-By.

### Task 10: The detector worker and its main-thread engine

**Files:**
- Create: `src/lib/local-inference/workers/turn-detector.worker.ts`.
- Create: `src/lib/local-inference/engine/TurnDetector.ts`, `src/lib/local-inference/engine/TurnDetector.test.ts` (`testing/mockWorker`).

**Interfaces:**
- Worker inbound (in `turn-detector-protocol.ts`):

```ts
export interface DetectorInitMessage { type: 'init'; turns: 'auto' | 'manual'; vad: VadWebConfig; limit: SegmentLimit; output: MessagePort; turnPort?: MessagePort; ortWasmBaseUrl: string; vadModelUrl: string }
export type DetectorInbound = DetectorInitMessage | { type: 'audio'; pcm: Int16Array; sampleRate: number } | { type: 'begin'; press: number }
  | { type: 'drain'; press?: number } | { type: 'cancel'; press: number } | { type: 'stop'; epoch: number } | { type: 'dispose' };
export type DetectorOutbound = { type: 'ready'; loadTimeMs: number } | DetectorNotice | { type: 'error'; error: string; code?: TurnFailureCode };
```

- The worker:
  - It sets `ortEnv.wasm.wasmPaths` before `await initVad(`. `initVad` loads `silero_vad_v5.onnx` on `['wasm']` with `SileroInput`; its `vadInfer`/`vadResetStates` are named as in the other VAD workers, which the consistency tests read. Silero is loaded only when `turns === 'auto'`. A load failure posts `{ type: 'error', error, code: 'turn_detection_unavailable' }` before `ready`.
  - It builds `TurnDetectorCore` with `smart: (p) => openTurnLink(msg.turnPort, msg.vad, p)`, and `SegmentAssembler` posting to `msg.output`.
  - `output.onmessage` routes `taken` to the assembler.
  - `stop`: `core.stop()`, then `assembler.stop(epoch)`.
  - `dispose`: closes the link and releases the session.
  - It imports nothing from `marks-relay`.
- Produces `class TurnDetector` (main thread, over `WorkerSession`):
  - `init(o: TurnDetectorInit): Promise<{ loadTimeMs: number }>`. `output` and `turnPort` are transferred. It rejects with `TurnDetectorError` (`code: TurnFailureCode`) on a pre-ready error carrying one.
  - `feedAudio(pcm: Int16Array)`: the buffer is transferred.
  - `begin(press)`, `drain(press?)`, `cancel(press)`, `stop(epoch)`, `dispose()`.
  - Callbacks `onSpeechStart`, `onFailed(failure: { code: TurnFailureCode; message: string })` and `onFatal(error: string)`, the last for a worker that died.
  - `TurnDetectorInit = { turns; vad: VadWebConfig; limit: SegmentLimit; output: MessagePort; turnPort?: MessagePort }`. The engine fills the two URLs as `AsrEngine` does.

- [ ] **Step 1: Write the failing tests** (`TurnDetector.test.ts`)

```ts
it('init posts the config with the output port and the Smart Turn port transferred', async () => { /* transfer list [output, turnPort] */ });
it('feedAudio transfers the buffer; begin, drain, cancel and stop post in call order', () => { /* … */ });
it("a failed notice reaches onFailed with its code; a worker error reaches onFatal", () => { /* … */ });
it('init rejects with code turn_detection_unavailable when the worker cannot load Silero', async () => { /* … */ });
```

- [ ] **Step 2:** `npx vitest run src/lib/local-inference/engine/TurnDetector.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the worker and the engine.
- [ ] **Step 4:** The same test, then `npx vitest run src/lib/local-inference` and tsc. Expected: PASS.
- [ ] **Step 5:** Commit the three files and the protocol module.
  - Message: `feat(turns): the turn detector worker and its engine`.
  - Trailer: Co-Authored-By.

### Task 11: The same cuts as the worker VAD, on the recorded Japanese sentences

This is the deterministic half of §9's before/after: it compares segment boundaries between today's worker logic and the detector, on real recordings, in CI.

**Files:**
- Create: `scripts/dev/turn-fixtures/silero-probs.mjs`.
  - It reads `scripts/dev/wire-probe/assets/ja/*.wav` (16-bit mono, 16 kHz) in `SENTENCES` order, with `PAUSES_MS` silence after each (`e2e/support/speech.ts`).
  - It runs Silero v5 (`public/wasm/vad/silero_vad_v5.onnx`) with onnxruntime-web's Node build on the wasm backend and the `SileroInput` context, once over the whole timeline with no state resets. Both paths replay the probabilities with `resetModel` a no-op, so the test compares the segmenting logic on real speech, not Silero.
  - It writes `src/lib/local-inference/workers/_shared/__fixtures__/ja-sentences.silero.json`: `{ frames: number[], clips: string[], pausesMs: number[] }`.
  - If onnxruntime-web does not load in Node, the test falls back to an energy track (mean |x| per frame mapped to [0, 1]) and the commit message says so.
- Create: `src/lib/local-inference/workers/_shared/legacy-vad-loop.testing.ts`. Today's segmenting logic as a function:
  - It is `whisper-webgpu.worker.ts` `feedAudio` (:366-450) and `handleFlush` (:554-573) at 17642a804.
  - Module state becomes locals, `scheduleWhisper` becomes a push to a list, and `infer` and the Smart link are injected.
  - Its header: "the reference the detector is held to; deleted in step 5".
- Create: `src/lib/local-inference/workers/_shared/turn-detector.replay.test.ts`. Both paths get the WAVs upsampled to 24 kHz Int16 in 2400-sample chunks (a linear helper in the test) and the same per-frame probabilities.

- [ ] **Step 1: Write the tests**

```ts
it('Normal: the detector cuts the segments the Whisper worker cut — same start, end, audio and endedBy', () => { /* toEqual over the list */ });
it('Smart answering 0.9 on every request: the same segments and the same Smart ends', () => { /* real TurnGate behind a synchronous fake link, both paths */ });
it('Max speech 10 s over the sentences played without pauses: the same cuts, plus each post-cap tail the worker dropped and nothing else', () => {
  /* every extra segment starts exactly at a 'cap' segment's end; removing them leaves the worker's list */
});
```

- [ ] **Step 2:** Run `node scripts/dev/turn-fixtures/silero-probs.mjs` (Node only: no vite, no Electron). Then `npx vitest run src/lib/local-inference/workers/_shared/turn-detector.replay.test.ts`. Expected: PASS. A difference is a bug in Tasks 6–7, not in the test.
- [ ] **Step 3:** Commit the script, the fixture, the reference and the test.
  - Message: `test(turns): the detector cuts the recorded Japanese sentences as the worker VAD did`.
  - Trailer: Co-Authored-By.

### Task 12: The audio-and-marks output, built and tested, wired to nothing

**Files:**
- Create: `marks-relay.ts`, `marks-relay.test.ts`.
- Modify: `turn-detector-core.ts`. `frame` events gain `raw: Int16Array`: the input samples that produced the frame, split at `round(to · 1.5)` on the grid, and everything received at a flush.

**Interfaces:**
- Produces `type RelayOutput = { type: 'audio'; pcm: Int16Array } | { type: 'mark'; event: 'start' | 'end' | 'cancel' }` and `class MarksRelay { constructor(post: (o: RelayOutput) => void); trace(e: TurnTrace): void }`.
- Mapping:
  - `frame`: its `raw`;
  - `open`: `start`, placed at the detecting frame (the frame whose processing decided the open), not at the pre-padded `open.at`;
  - `close`: `end`;
  - `drop` and `cancel`: `cancel`;
  - `drained`: nothing.
- `end` and `cancel` marks are exact: each sits between the frames it separates, after the frame that decided it.
- The `start` mark is posted right before the detecting frame's audio. The pre-pad span (0.8 s by default) is audio that precedes it; it is the consumer's own pre-roll, and the relay never delays audio by the pre-pad.

- [ ] **Step 1: Write the failing tests**

```ts
it('relays every input sample once, in order, in 768-sample spans on the 512-frame grid', () => { /* … */ });
it('an end or cancel mark sits between the frames it separates: no sample past the boundary precedes it', () => { /* … */ });
it('the start mark is placed right before the detecting frame, not at the pre-padded open.at', () => { /* … */ });
it('the audio of the pre-pad span precedes the start mark: it is the consumer\'s own pre-roll, never held back by the relay', () => { /* … */ });
it('a boundary inside a chunk: audio before the mark and the mark before the rest of the chunk', () => { /* … */ });
it("on release the partial frame's real samples are relayed before the closing mark", () => { /* … */ });
it('irregular chunk sizes never drift the 24 kHz spans from the 16 kHz frames', () => { /* … */ });
it('a consumer reading the output a second late changes nothing: order alone places the marks', () => { /* … */ });
```

- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test and the core test. Expected: PASS.
- [ ] **Step 5:** Commit the three paths.
  - Message: `feat(turns): the turn detector's audio-and-marks output (not wired yet: Voxtral 4B and Local Native take it in steps 3 and 4)`.
  - Trailer: Co-Authored-By.
- [ ] **Step 6 (PR B done):**
  - Run `npx vitest run` and tsc.
  - Ask the owner to confirm opening the PR on `kizuna-ai-lab/sokuji`, head `feat/turn-detector`, base `feat/turn-detection-settings`.

---

## PR C — The five WebGPU recognizers on the detector

The app runs the five again only from Task 15's commit on; the commits between are not releasable on their own.

### Task 13: The five workers take segments; the consistency tests guard the new arrangement

**Files:**
- Modify: `whisper-webgpu.worker.ts`, `cohere-transcribe-webgpu.worker.ts`, `granite-speech-webgpu.worker.ts`, `qwen3-asr-webgpu.worker.ts`, `voxtral-3b-webgpu.worker.ts`. In each:
  - **Delete:**
    - the VAD session, `vadInfer`, `vadResetStates` and `initVad`;
    - `FrameProcessor` and `@ricky0123/vad-web`, `SileroInput`, `resolveVadThresholds`, `resolveMaxSpeechFrames`, the engine's limit constant;
    - `audioBuffer`, the resampler, `feedAudio`, `processingVad`, `speechFramesSinceStart`;
    - `turnLink`, `openTurnLink`, `handleFlush`, the `'audio'` and `'flush'` routes;
    - the decode chain (`pendingWhisperDecode`, `currentTranscriptionPromise`, `pendingGraniteDecode`, `currentDecodePromise`);
    - `onnxruntime-all` and its `ortEnv.wasm.wasmPaths` line (qwen3 drops `vadOrtEnv` and keeps its webgpu `ortEnv`).
  - **Add:** in init, after the model is ready, `inbox = new SegmentInbox(msg.segmentPort, decode, post)`, where `decode` is the existing `run…Segment(audio, startSample, tag)`.
  - The result posts `startSample`, `durationMs`, `recognitionTimeMs`, `...tag`. Cohere and Voxtral 3B now take and post `startSample` too, and their `partial` messages carry the segment's `press` and `epoch`.
  - **Route:** `case 'stop': inbox?.stop(msg.epoch)`.
  - **Dispose:** `await inbox?.close()` before the model is released. qwen3's warm-up runs before the inbox exists.
- Modify: `src/lib/local-inference/types.ts`.
  - `WhisperAsrInitMessage`, `CohereTranscribeAsrInitMessage`, `Voxtral3BAsrInitMessage` and `GraniteSpeechInitMessage` lose `vadConfig`, `vadModelUrl` and `turnPort`, and gain `segmentPort: MessagePort`.
  - `AsrResultMessage` and `StreamingAsrPartialMessage` gain `press?: number; epoch?: number`.
  - New `AsrDrainedMessage { type: 'drained'; epoch: number; seq: number }`, in `AsrWorkerOutMessage`.
  - New `AsrStopMessage { type: 'stop'; epoch: number }`.
- Replace: `git mv src/lib/local-inference/workers/turnGate.consistency.test.ts src/lib/local-inference/workers/turnDetection.consistency.test.ts`. It asserts:
  - the non-test `.ts` files (not `*.test.ts`) with `new FrameProcessor(` under `workers/` and `workers/_shared/` are exactly:
    - `_shared/turn-detector-core.ts`;
    - `_shared/legacy-vad-loop.testing.ts`;
    - `native-vad.worker.ts` (exempt: "Local Native's, until step 4");
    - `voxtral-webgpu.worker.ts` (exempt: "Voxtral 4B's, until step 3");
  - for each `DETECTOR_WORKER_TYPES` worker: no `@ricky0123/vad-web`, `_shared/turn-gate`, `silero_vad`, `onnxruntime-all` or `processingVad`; it matches `/new SegmentInbox\(msg\.segmentPort,/` and `/case 'stop':/`;
  - `turn-detector.worker.ts` matches `/openTurnLink\(msg\.turnPort, msg\.vad,/` and closes the link on dispose;
  - the two exempt workers still do not import `_shared/turn-gate`.
- Modify: `sileroInput.consistency.test.ts`. The found list becomes `native-vad.worker.ts`, `turn-detector.worker.ts`, `voxtral-webgpu.worker.ts`; its three assertions are unchanged.
- Modify: `_shared/harness-consolidation.test.ts`.
  - `ASR_WORKERS` for the wasmPaths-before-`initVad` pair becomes `voxtral-webgpu.worker.ts` and `turn-detector.worker.ts`.
  - The flush-routing case is for `voxtral-webgpu.worker.ts` only.
  - The #470 case becomes "each detector-type worker decodes through `SegmentInbox`, never from an audio handler": it matches `/new SegmentInbox\(/`, has no `case 'audio'`, and has no `processingVad`.
  - `TRANSFORMERS_WORKERS` and the Granite local-capture case are unchanged.
- Modify: `asrLimits.consistency.test.ts`. The five no longer declare a limit constant; sherpa and Voxtral 4B still equal the manifest.

- [ ] **Step 1:** Write the consistency tests as above. Run `npx vitest run src/lib/local-inference/workers`. Expected: FAIL on the five.
- [ ] **Step 2:** Edit the five workers and `types.ts`.
- [ ] **Step 3:** Run `npx vitest run src/lib/local-inference/workers` and tsc. Expected: PASS.
- [ ] **Step 4:** Commit the five workers, `types.ts` and the four test files (the `git mv` pair by both paths).
  - Message: `feat(turns): Whisper, Cohere, Granite, Qwen3-ASR and Voxtral 3B decode the detector's segments and run no VAD of their own`.
  - Trailer: Co-Authored-By.

### Task 14: `AsrEngine` and the engine shapes

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts`.
  - `init(modelId, vadConfig?, language?, taskConfig?, segmentPort?)`: the fifth parameter replaces `turnPort`.
  - For the five worker types it throws `"<model> takes its segments from a turn detector: no segment port"` without `segmentPort`.
  - The init message carries `{ type: 'init', fileUrls, hfModelId, language, dtype, ortWasmBaseUrl, segmentPort }` (+ Granite's `task`, `targetLanguage`), transferred `[segmentPort]`; no `vadConfig`, `vadModelUrl`, `turnPort`.
  - sherpa is unchanged.
  - New `onDrained: ((seq: number) => void) | null` and `stop(epoch: number): void`. Results and partials pass `press` and `epoch` through: `onPartialResult(text, tag?: { press?: number; epoch?: number })`.
- Replace: `git mv src/lib/local-inference/engine/AsrEngine.turn.test.ts src/lib/local-inference/engine/AsrEngine.segments.test.ts`. Update `AsrEngine.qwen3.test.ts` (no VAD URL) and `AsrEngine.test.ts`.
- Modify: `src/providers/localInference/engines.ts`.
  - `AsrInit = { language; translateTo?; punctuationEndpoint?; vadConfig?: VadWebConfig; segmentPort?: MessagePort }`; `turnPort` is gone.
  - `AsrLike` gains `onDrained` and `stop(epoch)`, and `onPartialResult` takes the optional tag; `StreamingAsrEngine`'s `stop` is a no-op and its partials carry no tag.
  - `TurnDetectorLike`, the shape of `TurnDetector`. `LocalEngines.detector?: () => TurnDetectorLike`; `defaultEngines.detector = () => new TurnDetector()`.
  - `engines.test.ts` follows.

**Interfaces:**
- Consumes `TurnDetector` (Task 10), `AsrDrainedMessage`/`AsrStopMessage` (Task 13).
- Produces `TurnDetectorLike { init(o: TurnDetectorInit): Promise<unknown>; feedAudio(pcm: Int16Array): void; begin(press: number): void; drain(press?: number): void; cancel(press: number): void; stop(epoch: number): void; dispose(): void; onSpeechStart; onFailed; onFatal }`, and `AsrResult.press?`, `AsrResult.epoch?`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(['whisper-base-webgpu', 'qwen3-asr-0.6b-webgpu', 'granite-speech', 'cohere-transcribe-webgpu', 'voxtral-mini-3b-webgpu'])('%s gets the segment port, transferred, and no VAD config', async (id) => { /* … */ });
it('a WebGPU recognizer without a segment port does not start', async () => { /* rejects */ });
it('sherpa-onnx still gets its VAD config and no port', async () => { /* … */ });
it("drained reaches onDrained; stop posts {type:'stop', epoch}; press and epoch come with the result", () => { /* … */ });
```

- [ ] **Step 2:** `npx vitest run src/lib/local-inference/engine src/providers/localInference/engines.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `AsrEngine.ts`, its tests (the `git mv` pair by both paths), `engines.ts` and `engines.test.ts`.
  - Message: `feat(turns): the recognizer engine takes a segment port for the WebGPU models`.
  - Trailer: Co-Authored-By.

### Task 15: The adapter opens a detector for a shared leg

**Files:**
- Modify: `src/providers/localInference/adapter.ts`.
  - **`open()`, for `config.asr.turnDetection === 'shared'`:**
    - Make `new MessageChannel()`. Load `detector.init({ turns: context.turns, vad: config.vad, limit: config.limit ?? {}, output: port1, turnPort })` and `asr.init(modelId, { language, translateTo, punctuationEndpoint, segmentPort: port2 })` together, as the `'asr'` stage.
    - The turn port comes from `openTurn` when `config.vad.smartTurn` is set and turns are `auto`; it goes to the detector, never the recognizer.
    - A missing `engines.detector` rejects the start.
    - A `TurnDetectorError` rejects with `AdapterStartError(message, code)`.
  - **For an `own` leg:** today's path (`vadConfig`, pad, flush).
  - **`appendAudio`:** `fed.sent`, then `detector.feedAudio(pcm.slice())` on shared legs.
  - **`beginTurn`:** `press = ++presses`, `detector.begin(press)`.
  - **`endTurn`:** `detector.drain(press)`. Push `{ press, since: clock.now() }` on the drain FIFO, settled by `asr.onDrained` (frame `local.turn.drained { press, ms }`) or after `DRAIN_TIMEOUT_MS = 60_000` (frame `local.turn.drain_timeout { press }`). No `fed.padded`, no `asr.flush`.
  - **`cancelTurn`:** `cancelled.add(press)`, `detector.cancel(press)`.
  - **`final()` and `partial()`:** a result or partial whose `press` is in `cancelled`, or whose `epoch` differs from the session's, logs `local.asr.voided` and is dropped. A voided final closes a segment its earlier partials opened, as it stands and with no job: text shown before the cancel stays (C2). Otherwise as today: a released press's results stand whenever they come.
  - **`stop()`:** `epoch++`, `detector.stop(epoch)`, `asr.stop(epoch)`, then `disposeEngines()` (which disposes the detector).
  - **Callbacks:**
    - `detector.onFailed` → `fatal(message, code)`;
    - `detector.onFatal` → `fatal('Turn detection stopped: …')`;
    - `detector.onSpeechStart` → frame `local.asr.start`.
  - `fatal(message, code?)` passes `code` to `failed`.
  - The `FLUSH_SAMPLES` doc says it serves `own` legs only (step 5 removes it).
- Modify: `src/providers/localInference/fakeEngines.ts`. `FakeDetector` records calls, exposes `fail(code)`, `die()` and `speechStart()`, and `FakeAsr` gains `drained(seq)` and `result(..., { press, epoch })`. `fakeEngines()` includes `detector`.
- Modify: `adapter.test.ts`.
  - Its "turns" and "Smart Turn" describes get an `own` (SenseVoice config) and a `shared` (Whisper config) variant.
  - The 700 ms cases stay for `own`; the port cases move to the detector.
- Modify, the two notice codes:
  - `src/lib/view/noticeText.ts` `NOTICE_WORDS`: `turn_detection_overloaded: 'Turn detection cannot keep up on this device.'`, `turn_detection_unavailable: 'Turn detection could not start: {{detail}}'`.
  - `src/lib/view/noticeTargets.ts`: both → `'provider-options'`.
  - `notices.*` in all 30 `src/locales/*/translation.json`, translated.
  - Any closed code list `noticeText.test.ts` enumerates.

**Interfaces:**
- Consumes `TurnDetectorLike`, `AsrLike.onDrained`/`stop`, `AsrInit.segmentPort` (Task 14); `LocalInferenceConfig.asr.turnDetection` and `.limit` (Tasks 2–3).

- [ ] **Step 1: Write the failing tests** (`adapter.test.ts`)

```ts
it('opens a detector for a shared leg and none for an own one', () => { /* whisper config → detector.inits 1; sensevoice config → engines.detector never called */ });
it('a shared leg: audio goes to the detector only, at 24 kHz, and the recognizer gets the segment port', () => { /* asr.fed empty */ });
it('a shared leg: endTurn drains the press — no 700 ms pad, no flush', () => { /* detector.drains [1]; asr.fed empty; asr.flushes 0 */ });
it('an own leg keeps the 700 ms release tail and the flush', () => { /* today's assertions */ });
it('after a cancel no new result of that press is published', () => { /* press 1 cancelled; result {press:1} → no segment */ });
it('after a cancel no partial of that press is shown; one shown before the cancel stays, closed with no job', () => { /* Cohere-style partials */ });
it("a released press's late result is published after the next press began, and stays the first press's", () => { /* … */ });
it('results of an older epoch are ignored after stop', () => { /* … */ });
it('Smart under Auto: the Smart Turn port goes to the detector, never to the recognizer', () => { /* … */ });
it('a stored Smart with no Smart Turn model runs Normal: the detector gets no turn port', () => { /* connect resolves null */ });
it('the detector failing overloaded fails the leg with turn_detection_overloaded', () => { /* failed {code} */ });
it('the detector dying fails the leg: failed once, nothing more emitted', () => { /* … */ });
it('Silero not loading rejects the start with turn_detection_unavailable', async () => { /* … */ });
it('drained answers in order settle the pending drains and log local.turn.drained', () => { /* … */ });
it('two legs each have their own detector; a cancel on one touches nothing of the other', () => { /* two sessions */ });
```

- [ ] **Step 2:** `npx vitest run src/providers/localInference src/lib/view src/locales`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command; then `npx vitest run`; tsc. Expected: PASS, tsc not above base.
- [ ] **Step 5:** Commit `adapter.ts`, `adapter.test.ts`, `fakeEngines.ts`, `noticeText.ts`, `noticeTargets.ts` (and the notice test if edited), and the 30 locale files, each by path.
  - Message: `feat(turns): the local adapter runs a turn detector for the WebGPU recognizers; push-to-talk presses are turns`.
  - Trailer: Co-Authored-By.

### Task 16: Whole-step verification

- [ ] **Step 1:** `npx vitest run`. Expected: no failure beyond the base's.
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.json`. Expected: count at most the base's.
- [ ] **Step 3:** `git grep -nE "turnPort|vadModelUrl" -- src/lib/local-inference/workers/{whisper,cohere-transcribe,granite-speech,qwen3-asr,voxtral-3b}*.worker.ts src/providers/localInference/engines.ts` prints nothing.
- [ ] **Step 4:** `git grep -n "openTurnLink(" -- src` prints only `turn-detector.worker.ts` and `turn-gate.ts`.
- [ ] **Step 5:** `git diff --stat origin/main -- public/workers src/services sidecar src/lib/local-inference/workers/native-vad.worker.ts src/lib/local-inference/workers/voxtral-webgpu.worker.ts src/lib/session/turn.ts` shows only Task 3's comment lines.

### Task 17: Before/after on real audio — what is measured where

§9 asks for the e2e Japanese sentences through SenseVoice, Whisper and Voxtral 4B on the e2e build. It runs before and after, with the same models, settings and clips, five runs each. A step ships only if each median is no worse than before by more than the before side's run-to-run spread.

**What can be measured where:**

| Check | Where | Who |
|---|---|---|
| Segment boundaries of today's worker logic vs the detector, on the recorded sentences (Task 11) | CI, any machine | automatic |
| Whisper WebGPU, before/after, e2e build | A Linux arm64 machine with an NVIDIA GB10 is plausible but unverified (below); otherwise another machine with a hardware WebGPU adapter | needs the owner's go-ahead |
| SenseVoice before/after (sherpa WASM; reads the new settings only) | Any machine, the GB10 one included | needs the owner's go-ahead |
| Voxtral 4B before/after (its q4 variant needs no `shader-f16`, which the GB10 lacks) | The GB10 machine is plausible (about 2.8 GB of downloads), or another WebGPU machine | optional for step 1 (only its settings source changed); needs the owner's go-ahead |
| The C3 bounds (2 s; 5 segments / 30 s) on the slowest supported device (§12) | The slowest supported device | a person on that device |
| Push-to-talk by hand: quiet speech kept, a short press cancelled, Smart ends on real speech | Any WebGPU machine, the real app | a person |

**Why Whisper on the Linux arm64 / GB10 machine is plausible, and what would stop it:**
- The e2e app runs in a real X11 window, not headless, so `applyLinuxGpuFlags` keeps `Vulkan` on.
- `enable-unsafe-webgpu` is always passed, and the NVIDIA Vulkan ICD is installed.
- Whisper's WebGPU dtypes (fp32 encoder, q4 decoder) need no `shader-f16`.
- Unknowns:
  - The app passes no `--ignore-gpu-blocklist`.
  - An installed Electron may lag `package.json`'s pin (44.11.5): run `npm ci` in the measuring worktree first.
  - Nothing has run a local recognizer through e2e before.
- The spec therefore records the adapter. It fails with "software WebGPU adapter: measure on another machine" when `checkWebGPU()` reports `softwareOnly` or no adapter.

**Files:**
- Create: `e2e/specs/real-local-turns.spec.ts`.
  - Tagged `@real`, so it is outside `npm run e2e` and runs only under `npm run e2e:real`.
  - Its header comment is the runbook below.
  - It reads the env:
    - `E2E_LOCAL_ASR`: one of `whisper-base-webgpu`, `sensevoice-int8`, `voxtral-mini-4b-webgpu`;
    - `E2E_LOCAL_PROFILE`: an absolute path, not starting with `sokuji-e2e-`, so it is kept;
    - `E2E_LOCAL_OUT`: the results folder;
    - `E2E_RUNS`, default 5;
    - `E2E_LOCAL_PREPARE=1`: a one-time test that downloads the chosen models through Model Management into the profile.
  - Seed:
    - `settings.lineup` = `{ transcription: 'local_inference', translation: 'local_inference', speech: null, summarisation: null }`;
    - `settings.localInference.selections` = `{ 'ja→en': { asr: { modelId: E2E_LOCAL_ASR }, translation: { modelId: 'opus-mt-ja-en' }, tts: { modelId: '' } } }`;
    - the pair `ja`→`en`; `e2e.mic: 'speech'`;
    - no turn detection keys, so both builds run the defaults.
  - Per run, it plays the eight clips with `PAUSES_MS` through `say()` and records `Date.now()` when each ends. After the app closes, it reads History. It writes `{ build, model, adapter, sentences: [{ file, heard, translated, startMs, endMs, latencyMs }] }`:
    - `heard`/`translated` by the `SENTENCES` regexes;
    - `startMs`/`endMs` from the matching source segment;
    - `latencyMs` = the source segment's `opened_at` − the clip's end. Whisper and SenseVoice send no partials, so a segment opens at its final. First check that `opened_at` and the spec's clock share a base (`session-to-history.spec.ts`), and convert if not.
- Modify: `e2e/support/history.ts`. `segments` gain `startMs` and `endMs` (`start_ms`, `end_ms`).
- Modify: `e2e/support/app.ts`. `launchApp` takes an optional `userDataDir`; a directory given is never deleted.
- Create: `scripts/dev/turn-fixtures/compare-runs.mjs <before-dir> <after-dir>`. Per model, it prints the median and the before side's spread (max − min over its runs) for sentences heard, translated, mean |boundary shift| and latency. It prints PASS when `after ≥ before − spread` for heard/translated and `after ≤ before + spread` for latency and the boundary shift, else FAIL with the metric.

**Runbook** (the spec's header; every step needs the owner's go-ahead, because it builds with vite, opens Electron windows and downloads models):
1. **Before:** `git worktree add <dir> 17642a804`, then `npm ci`. Copy the new spec, `history.ts`, `app.ts` and `compare-runs.mjs` in, uncommitted. Run `npm run e2e:build`.
2. **Prepare** once per profile: `E2E_LOCAL_PREPARE=1 E2E_LOCAL_PROFILE=… E2E_LOCAL_ASR=whisper-base-webgpu npm run e2e:real -- real-local-turns`. Downloads are roughly 0.3 GB for Whisper base plus Opus-MT ja→en, and 0.25 GB for SenseVoice.
3. **Measure** five runs per model with `E2E_LOCAL_OUT=<before>`.
4. **After:** the same in the branch's worktree with `E2E_LOCAL_OUT=<after>`, the same profile.
5. Run `node scripts/dev/turn-fixtures/compare-runs.mjs <before> <after>`. Paste its table into PR C's description. A FAIL on Whisper blocks the step (§9). A software adapter there means repeating 1–5 for Whisper on another machine with a hardware WebGPU adapter.

- [ ] **Step 1:** Write the spec, the two support changes and the compare script. `npx tsc --noEmit -p e2e/tsconfig.json`, if the repo has one; else `npx playwright test --list` from `e2e/`, which lists without launching. Expected: the spec is listed under `@real`.
- [ ] **Step 2:** Commit the four paths.
  - Message: `test(e2e): opt-in before/after of local recognizers on the Japanese sentences`.
  - Trailer: Co-Authored-By.
- [ ] **Step 3 (owner's go-ahead required):** run the runbook; record the table and the adapter line.
- [ ] **Step 4 (PR C done):** ask the owner to confirm opening the PR on `kizuna-ai-lab/sokuji`, head `feat/webgpu-turns-on-detector`, base `feat/turn-detector`. The description carries the table, or says plainly which rows still need a person or another machine.

---

## Spec coverage

| Spec | Task |
|---|---|
| C1 one timeline, ordered delivery (segments) | 5, 6, 8, 13 |
| C1 audio-and-marks | 12 (unwired) |
| C2 presses and segments; §5; Decision 1 (§10) | 7, 15 |
| C3 bounded queues, drain, stop, failures | 8, 9, 15 |
| C4 limits in the manifest with kinds | 3, 6, 7 |
| C5 per leg; `turnOwner` retired | 2, 15 |
| §6 Smart Turn in the detector; Normal default; Max Wait − 0.2 | 1, 6, 10, 15 |
| §7 settings, migration, one UI | 1, 4 |
| §8 step 1 wiring to the five; others read the new settings | 1, 13–15 |
| §9 unit table | 1–3, 5–9, 12, 15 |
| §9 before/after on real audio | 11 (deterministic), 17 (e2e) |
| Consistency tests guard what remains and the detector | 3, 13 |
