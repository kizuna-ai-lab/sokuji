# Free combination of stages, step 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speech becomes a stage of its own: the transcription and translation of Kizuna AI's Soniox, of Soniox with an own key, or of this device can be read aloud by Soniox's voice (own key), by Edge, or by a local voice model, and the stored line-up, not a selected provider, decides what runs.

**Architecture:** A unit that occupies only `speech` implements a small speech contract (`startSpeech`) instead of the adapter contract. The composite adapter runs a plan of a text unit and a speech unit per leg: it forwards the text unit's events, feeds each translation's stable text to the speech unit, and owns the rules that are not about one vendor's voice (audio numbering, the other leg's voice, speech off and on, the reconnect recycle, agent text). Soniox and the local provider each gain a speech unit; Soniox with one account for all three stages runs through the same composite path, and its old in-adapter speech path is deleted once the two are shown equal.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron E2E). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-19-free-stage-combination-design.md` (§4.2, §4.3, §4.4, §6, §7, §8, §11 step 2, §11.1, §13, §14). Read it before any task. Step 1's plan (`2026-11-20-free-stage-combination-step-1.md`): read its four "Decisions made while Part … was built" sections and "What this step leaves for step 2"; they are binding here.

## Global Constraints

- The parts are pull requests stacked on step 1: Part A's base is `feat/records-name-stages`, each later part's base is the part before it. Nothing merges to `main` and nothing is released until step 4 is done (owner's decision, 2026-11-21). No feature flag.
- Parts A, B and C change nothing a user can see: the plan still follows the selected provider until Task D2, so every shipped line-up runs as it does today. In those parts an existing test's `expect(...)` may change only where a task names the test and says why.
- Standalone voices in this step: `soniox` (own key), `edge`, `local_inference`. Not offered alone: Kizuna AI's Soniox voice (step 3), any end-to-end provider's voice.
- Text sides that may take another provider's voice in this step: `kizunaai_soniox`, `soniox`, `local_inference`. An end-to-end provider is not offered another voice until it is confirmed, per vendor, to stop generating and charging for audio when asked for text only (spec §14). The composer refuses such a line-up with words.
- Prices and charging rules do not change. Kizuna AI's Soniox with another provider's voice is today's text-only session: no speech role is requested, the floor and the session cap are the text-only ones (spec §6).
- A plan with two managed providers is refused by the composer (spec §6); step 3 lifts that.
- Storage: `settings.lineup` is written as `{ version: 2, stages }` from Task D1 on; versions 1 and 2 are read. `settings.common.provider` is still written (the transcription provider's id), so a downgraded app opens that provider; version 0.51.0 does not accept `version: 2`, shows its own values and does not overwrite the stored line-up. No other stored format changes.
- Provider ids never change. Audio crosses every contract at `SAMPLE_RATE` (24 kHz, mono, Int16).
- Public repository: no backend internals, no usage data, no machine or team names in code, comments, commits or PR text.
- Run OCR (`ocr review --from <base> --to HEAD --audience agent`) before each push. Gate every push on the unit suite (`npx vitest run`) passing and on no type error in a touched file with the total not rising (step 1, Part A's ruling).
- Commits end with the `Co-Authored-By` trailer of the model that wrote them.

## Review Focus

1. The speech unit cannot open, or dies mid-session (no network to Edge, a voice model that fails to load, a refused Soniox key): subtitles go on, one `tts_degraded` notice says speech stopped, nothing throws and the session does not end. → Tasks A4, C1.
2. A target language the chosen voice cannot speak: the line-up card and Start say so before anything connects; never a session that silently has no voice. → Task D4.
3. A mixed line-up is stored, the app is downgraded to 0.51.0 and upgraded again: the old version opens its stored provider and leaves `settings.lineup` alone; after the upgrade the mix is intact. → Task D1.
4. Speech switched off and on mid-sentence, and a transcription reconnect while a foreign voice is speaking: nothing is heard after off, speech resumes at the next sentence, nothing is spoken twice after the reconnect. → Tasks A4, B4.
5. Kizuna AI's Soniox with Edge's voice: the lease asks for no speech role and the balance floor is the text-only one; the user is neither blocked nor charged for speech Kizuna AI does not provide. → Task D6.

---

## File structure

New:

| File | Responsibility |
|---|---|
| `src/lib/contract/speech.ts` | The speech contract: `SpeechStartRequest`, `SpeechSession`, `SpeechEvents`. Types only. |
| `src/lib/contract/speechConformance.ts` | The rule suite every speech unit passes (spec §13). |
| `src/lib/plan/speechFeed.ts` | From a translation segment's events to `speak` / `endUtterance` calls. Pure state per leg. |
| `src/lib/plan/compositeLeg.ts` | One leg of a plan with a text unit and a speech unit: wiring, order, failure rules. |
| `src/lib/plan/compositeBoth.ts` | Both legs over one text session: the other leg's voice, one audio numbering per row. |
| `src/providers/fake/voice.ts` | `fakeVoiceProvider`: a speech-only provider for tests and the E2E build. |
| `src/providers/soniox/ttsUnit.ts` | Soniox's voice as a speech unit, over `LegSpeech`. |
| `src/providers/soniox/units.ts` | The Soniox units (`stt`, `tts`) for the own-key and the Kizuna AI definitions. |
| `src/providers/localInference/speechUnit.ts` | Edge and the local voice models as a speech unit, over `TtsEngine` and `speakTranslation`. |
| `src/lib/plan/checks.ts` | The composer's checks 3 to 5 and the step's refusals (voices, languages, modes, two managed providers). Pure. |

Changed: `src/lib/contract/{adapter,conformance}.ts`, `src/lib/plan/{types,composite,compose,read,fromStores,wholeUnit}.ts`, `src/lib/lineup/{types,catalog,choose,localStages,migrate}.ts`, `src/lib/session/{run,shape,appShape,types}.ts`, `src/providers/soniox/{adapter,utterances,config,settings,provider,kizuna,leaseRequest,kizunaBudget}.ts`, `src/providers/localInference/{provider,config}.ts`, `src/providers/registry.ts`, `src/stores/{lineUpStore,providerStore}.ts`, `src/app/{loadStores,session,telemetry}.ts`, the readers of the selection listed in Task D3, `src/components/SettingsPage/LineUpCategory.tsx` and the speech surfaces of Part E, `e2e/support/app.ts`.

---

# Part A — the speech stage and the composite over two units

Branch `feat/speech-stage-contract`. Ends with a plan of `fake` (text) and `fake_voice` (speech) running under the adapter conformance suite. No shipped line-up reaches it.

### Task A1: a stable length on translation text

**Files:** Modify `src/lib/contract/adapter.ts`, `src/lib/contract/conformance.ts`; Test `src/lib/contract/conformance.test.ts`.

**Interfaces:**
- Produces: `AdapterEvents.segmentText(e: { …; stableLen?: number })`. On a translation segment: the first `stableLen` characters of `text` will not change. Absent: nothing is known to be stable until the segment closes.

- [ ] Add `stableLen?: number` to the `segmentText` payload with that doc comment. `Conversation` ignores it.
- [ ] Conformance rules, each with a failing scenario first: `stable-len-in-text` (`stableLen <= text.length`), `stable-len-holds` (for one ref, `stableLen` never decreases and the first `stableLen` characters of a later text equal the earlier ones).
- [ ] Run `npx vitest run src/lib/contract` — PASS. Commit.

### Task A2: the speech contract and its rule suite

**Files:** Create `src/lib/contract/speech.ts`, `src/lib/contract/speechConformance.ts`, `src/lib/contract/speechConformance.test.ts`; Modify `src/lib/plan/types.ts`.

**Interfaces — Produces:**

```ts
// src/lib/contract/speech.ts
export interface SpeechStartRequest<C, K> {
  leg: LegName;
  /** The leg's direction; `speech` is true. */
  context: SessionContext;
  config: C;
  credentials: K;
  clock: Clock;
  signal: AbortSignal;
  /** One counter of audio entries per row, shared by every voice that reads the row (spec §7.2). */
  counts: Map<Ref, number>;
}
export interface SpeechEvents {
  /** `home`: the leg whose row this audio belongs to, when it is not this voice's leg. */
  audio(e: { pcm: Int16Array; ref: Ref; range?: TextRange; home?: LegName }): void;
  speechRanges(e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }>; home?: LegName }): void;
  /** Speech is degraded or gone; the session goes on. */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string }): void;
  frame(e: AdapterFrame): void;
}
export interface SpeechSession {
  /** Never rejects: a voice that cannot open reports `degraded`. */
  open(): Promise<void>;
  /** `span`: where `text` sits in the row's whole translation. `language`: an app language code. `home`: see `SpeechEvents.audio`. */
  speak(ref: Ref, text: string, span: TextRange, language: string, home?: LegName): void;
  endUtterance(ref: Ref): void;
  setOn(on: boolean): void;
  /** The transcription connection came back: let a half-open connection go. */
  recycle?(): void;
  close(): void;
}
// src/lib/plan/types.ts — added to UnitDefinition
/** A unit that occupies only `speech`: started through this, and has no `start`. */
startSpeech?(request: SpeechStartRequest<C, K>, events: SpeechEvents): SpeechSession;
```

`UnitDefinition.start` becomes optional; exactly one of `start` / `startSpeech` is present. `isSpeechUnit(unit): boolean` in `src/lib/plan/types.ts`.

- [ ] Write `speechConformance.ts`: `checkSpeech(log): Violation[]` over a recorded log of calls and events, with rules `audio-has-ref`, `audio-index-counts` (each `audio` advances `counts` for its ref by one, and only then), `ranges-entry-exists`, `ranges-ascend`, `range-in-span` (a range lies within the union of the spans spoken for the ref), `silent-when-off` (no `audio` for text spoken while off), `nothing-after-close`. One failing fixture per rule in the test file, then the rule.
- [ ] Types as above. `npx vitest run src/lib/contract src/lib/plan` — PASS. Commit.

### Task A3: the speech feed

**Files:** Create `src/lib/plan/speechFeed.ts`, `src/lib/plan/speechFeed.test.ts`.

**Interfaces — Produces:** `createSpeechFeed(sink: { speak(ref, text, span, language): void; end(ref): void }, target: () => string)` returning `{ opened(e), text(e), closed(e), reset() }`, fed the text unit's translation-segment events only.

Rules, each a test:
- [ ] `text` with `stableLen` beyond what was spoken for the ref speaks `text.slice(spoken, stableLen)` with span `[spoken, stableLen]` and language `e.language ?? target()`; no `stableLen`: nothing yet.
- [ ] `closed` speaks what is left of the last text (`[spoken, text.length]`), if any, then `end(ref)`.
- [ ] A text shorter than what was spoken (a revised row) speaks nothing and does not move `spoken` back.
- [ ] A segment that was never a translation (no `opened` with `side: 'translation'`) is ignored.
- [ ] Commit.

### Task A4: one leg of a text unit and a speech unit

**Files:** Create `src/lib/plan/compositeLeg.ts`, `src/lib/plan/compositeLeg.test.ts`; Modify `src/lib/plan/composite.ts`.

**Interfaces:**
- Consumes: Tasks A1–A3; `PlanConfigs`; `AdapterEvents`, `AdapterSession`.
- Produces: `startComposite(plan, request, events)` accepts a plan of one unit (as before) or of a text unit serving `transcription` and `translation` plus a speech unit serving `speech`; any other shape rejects with `AdapterStartError(…, 'plan_unsupported')`. `buildPlan` builds each unit with its own context: `speech` is `context.speech && planned.stages.includes('speech')` for that unit; `shared.speaks` is unchanged.

Behaviour, each a test in `compositeLeg.test.ts` with stub units:
- [ ] Order (spec §7.4): the speech session is created and `open()` called and not awaited, then the text unit starts; `stop()` stops the text session first, then closes the speech session. A text unit that fails to start closes the speech session and rejects with the text unit's error.
- [ ] Every event of the text unit reaches `events` unchanged, except that an `audio` or `speechRanges` from a text unit built without speech is a programming error reported once through `frame` (`composite.unexpected_audio`) and dropped.
- [ ] Translation segments drive the feed; the speech session's `audio` and `speechRanges` reach `events` as the contract's `audio` (`voice` absent) and `speechRanges`.
- [ ] `setSpeech(on)` calls the speech session's `setOn`. The text unit's `reconnected` calls `recycle?.()` before it is forwarded.
- [ ] The speech session's `degraded` reaches `events.degraded` with its code; a throw from `startSpeech` becomes `degraded({ code: 'tts_degraded', … })` and the session goes on without speech (Review Focus 1).
- [ ] `agentText`, `appendAudio`, `appendText`, the turn calls, `networkRestored` and `info` are the text session's.
- [ ] A leg whose context does not speak starts no speech session.
- [ ] The adapter conformance suite (`runScenario` over the stub text unit and a stub speech unit) passes. Commit.

### Task A5: both legs over one text session

**Files:** Create `src/lib/plan/compositeBoth.ts`, `src/lib/plan/compositeBoth.test.ts`; Modify `src/lib/session/run.ts:302-330` (the `together` branch).

**Interfaces — Produces:** `startCompositeBoth(plan, requests: Record<LegName, StartRequest<PlanConfigs, …>>, events: Record<LegName, AdapterEvents>, shared: boolean): Promise<Record<LegName, AdapterSession>>`. The run takes this path when there are two legs and the provider of the unit that serves `transcription` has `session.startBoth`.

- [ ] One speech session per speaking leg, one `counts` map for both when `shared`.
- [ ] A translation whose language is the leg's own target is read by that leg's voice. Otherwise, when `shared`, it is read by the other leg's voice if that leg's target is the language: `speak(…, home = the row's leg)`; its audio and ranges return on the row's leg with `voice` naming the reading leg (spec §7.2). When not `shared`, or no leg has that target, it is not read.
- [ ] `endUtterance` goes to the row's own voice and to every voice that read the row.
- [ ] Tests mirror `src/providers/soniox/adapter.both.test.ts:491` (the routing) with stub units. Commit.

### Task A6: the run opens a plan of two units

**Files:** Modify `src/lib/session/run.ts`, `src/lib/session/shape.ts`; Test `src/lib/session/run.plan.test.ts` (new).

- [ ] Each unit's `shared.models` is its own provider's readiness answer (was: the transcription provider's for all).
- [ ] `credentials(unit)` answers that unit's provider's credentials for the leg, a lease's where the provider is leased.
- [ ] `describePlan` already reads each stage's unit; a test pins `ttsModel` from the speech unit and `asrModel` from the text unit.
- [ ] A run over `planOf(fake text, fake_voice)` (Task A7's stubs may be inlined here first) starts, emits a translation's audio, switches participant speech off and on, and stops in the order of §7.4. Commit.

### Task A7: `fake_voice`, for tests and the E2E build

**Files:** Create `src/providers/fake/voice.ts`, `src/providers/fake/voice.test.ts`; Modify `src/providers/registry.ts`, `src/lib/lineup/catalog.ts`.

- [ ] `fakeVoiceProvider`: id `fake_voice`, `kind: 'own-key'` with no key, one unit `{ id: 'voice', occupies: speech only, startSpeech }`. Each `speak` emits one `audio` of 2400 samples per sentence with the sentence's range, on the request's clock.
- [ ] Catalog: `fake_voice` serves `speech`, hosts itself, only in the builds that have `fake`. `DEV_ONLY` gains it.
- [ ] `fake_voice` passes `speechConformance`. Commit. **Part A ends here: open PR A.**

---

# Part B — Soniox as two units

Branch `refactor/soniox-two-units`. Ends with Soniox for all three stages running through the composite path and the old path deleted.

### Task B1: Soniox's text unit says how much translation is stable

**Files:** Modify `src/providers/soniox/utterances.ts`; Test `src/providers/soniox/utterances.test.ts`.

- [ ] The translation's `segmentText` carries `stableLen: translationFinal.length` and the language that stretch is in.
- [ ] A `segmentText` is emitted at every point where `speakFinals` passes text to the sink today (after a final token, at a boundary, in `endPrevious`, before a language switch), so that the feed's chunks are the sink's chunks. Where two would carry the same text and `stableLen`, one is sent.
- [ ] The text spoken for a late chunk on a closed translation (`utterances.ts:287`): decide with the equality suite (Task B4) whether it is carried by a revision event the contract has or is dropped with a `frame`; record the ruling.
- [ ] The adapter conformance suite passes with the new rules of Task A1. Commit.

### Task B2: Soniox's voice as a speech unit

**Files:** Create `src/providers/soniox/ttsUnit.ts`, `src/providers/soniox/ttsUnit.test.ts`.

**Interfaces — Produces:** `sonioxTtsUnit: UnitDefinition<SonioxSettings, SonioxCredentials, { voice: string; speed: number }>` with `id: 'tts'`, `occupies` speech only, `build` giving the voice and speed `buildSoniox` gives today (`config.ts:68-70, 81-83`), `describe` giving `ttsModel`, `startSpeech` over `LegSpeech` (`speech.ts`).

- [ ] `speak` converts the app language with `sonioxWire.toWire`; `home` maps to `LegSpeech`'s `home` events; `endUtterance(ref)` calls `LegSpeech.endUtterance()`.
- [ ] No key for speech: `open()` reports `degraded({ code: 'tts_degraded' })` once (today's `noTtsKey`, `adapter.ts:141, 471-475`).
- [ ] Passes `speechConformance`, driven through the fake TTS socket (`src/lib/contract/testing/fakeSocket.ts`). Commit.

### Task B3: the two definitions declare their units

**Files:** Create `src/providers/soniox/units.ts`; Modify `src/providers/soniox/{provider,kizuna,config}.ts`, `src/lib/lineup/catalog.ts`.

- [ ] `sonioxSttUnit`: `id: 'stt'`, occupies `transcription` and `translation`, `start` = today's adapter started with `context.speech` false. Its capabilities are the definition's present members with `speech: 'never'`.
- [ ] Both definitions get `units: [sonioxSttUnit, sonioxTtsUnit]`. The provider-level `speech` member stays, for readers not yet on units.
- [ ] `stt.agentText` is asked for when `shared.speaks` is true, whoever speaks (spec §7.3): unchanged code, new test.
- [ ] `compose` for a line-up all on `soniox` now yields two units. A test pins that the plan the selection gives (Task D2 replaces it) is that two-unit plan for Soniox and Kizuna AI's Soniox.
- [ ] Commit only together with Task B4 passing: from here Soniox runs the composite path.

### Task B4: the composite path equals the old one

**Files:** Create `src/providers/soniox/equality.test.ts`, `src/providers/soniox/testing.equality.ts`.

The harness drives the old adapter (speech inside) and the composite of `stt` + `tts` from one script of STT frames and TTS answers on fake sockets, and compares the event logs: segments, texts ignoring `stableLen` and the extra snapshots of Task B1, `audio` order with `ref`, `range` and `voice`, `speechRanges`, `degraded`, and the frames sent on each socket.

- [ ] Cases (spec §11.1), one test each: one leg; split Both; shared Both; face-to-face with a translation read by the other voice; speech switched off and on mid-sentence; an STT reconnect during speech (the recycle); a TTS segment lost; `<fin>` with a late translation; stop during a connect; no speech key; a language switch inside one utterance.
- [ ] Agent text: the indices and ranges `AgentTextFeed` reads are equal on both paths (`src/lib/session/agentText.ts:63-65`).
- [ ] Every difference is either fixed or recorded as a ruling with its reason in "Decisions made while Part B was built".
- [ ] One real session on each path with the same audio (the E2E `@real` spec with `E2E_SONIOX_KEY`, speech on), compared by the History record: sentences heard and translated, audio duration within 10 %.
- [ ] Commit.

### Task B5: the old path goes

**Files:** Modify `src/providers/soniox/{adapter,config,settings}.ts` and their tests.

- [ ] Remove `CoreLeg.speech`, `noTtsKey`, `abroad`, the `speak` / `endSpeech` sink wiring, `setSpeech` and the recycle from the adapter; `buildSoniox` no longer builds `tts`; `describeSoniox` no longer reports a TTS model. Tests of the removed behaviour move to `ttsUnit.test.ts` or `compositeBoth.test.ts` where they are not already covered; `equality.test.ts` and its harness are deleted in the same commit, their cases having become the composite's own tests.
- [ ] Full unit suite and the E2E suite pass. Commit. **Part B ends here: open PR B.**

---

# Part C — Edge and the local voices as a speech unit

Branch `feat/local-speech-unit`.

### Task C1: the unit

**Files:** Create `src/providers/localInference/speechUnit.ts`, `src/providers/localInference/speechUnit.test.ts`.

**Interfaces — Produces:** `localSpeechUnit: UnitDefinition<LocalInferenceSettings, null, { modelId: string; speakerId: number; speed: number; edgeVoice?: string }>` with `id: 'speech'`, occupies speech only.

- [ ] `build(context, s, shared)`: the voice for `context.direction` from `s.voices` and `s.ttsSpeed` (`voices.ts:10-24`); the model is `edge-tts` when the line-up's speech is `edge`, else the direction's selected local voice model; a missing local model is the refusal `speaker_tts_missing` / `participant_tts_missing`.
- [ ] `startSpeech`: one `TtsEngine` per leg; `open()` initialises it and reports `degraded({ code: 'tts_degraded' })` on failure or on a later fatal (Review Focus 1); `speak` queues, in order, `speakTranslation` per chunk with ranges offset by the chunk's span; `setOn(false)` empties the queue and drops what is in flight; `close()` disposes the engine.
- [ ] Passes `speechConformance` with `FakeTts` (`fakeEngines.ts:101`). Commit.

### Task C2: the local provider declares it

**Files:** Modify `src/providers/localInference/{provider,config}.ts`, `src/lib/lineup/localStages.ts`.

- [ ] `units: [wholeUnit(localInferenceProvider), localSpeechUnit]`: the whole unit still serves a line-up that is all on this device (its split is step 4); the speech unit serves `speech` alone.
- [ ] `admitLocalInference` for a plan that holds only the speech unit counts the voice model alone; over budget is `memory_exceeded`.
- [ ] `buildLocalInference` reads the frozen `shape.lineUp` handed to it through `shared`, not the line-up store (step 1, Part D's ruling). Commit.

### Task C3: voices when another provider transcribes

**Files:** Modify `src/components/SettingsInitializer/SettingsInitializer.tsx`, `src/components/SettingsPage/{EdgeVoices,LocalVoices}.tsx`, `src/components/providers/openTtsSlot.ts`.

- [ ] The first Edge voice for the target is picked whenever the plan's speech unit is the local one (was: while the selected provider is this device).
- [ ] The local provider's entry is loaded whenever it is in the plan. Tests for both. Commit. **Part C ends here: open PR C.**

---

# Part D — the stored line-up decides what runs

Branch `feat/lineup-decides-run`. The first part with a visible change.

### Task D1: storage

**Files:** Modify `src/stores/lineUpStore.ts`, `src/lib/lineup/migrate.ts`, `e2e/support/app.ts`; Tests `src/stores/lineUpStore.test.ts`, `src/app/loadStores.test.ts`.

- [ ] Write `{ version: 2, stages }`; read 1 and 2. A stored line-up is kept as stored: it is no longer worked out again from the stored provider (`lineUpStore.ts:112-115`). A line-up naming an id this build does not know is shown from today's values and never overwritten, as now.
- [ ] `choose` no longer returns null for an unstored line-up that the app has shown: the first choice stores it.
- [ ] `settings.common.provider` is written with the transcription provider's id whenever the stored line-up's transcription changes (Global Constraints). The tests that pin "a launch writes nothing" stay as they are; the tests that pin "a stored line-up its provider does not run is worked out again" (`lineUpStore.test.ts:100`) and "selects the provider … before saving" (`:168, :192`) are rewritten on purpose, each named in the commit.
- [ ] Review Focus 3 as a test: a version-2 mixed line-up read by the version-1 reader (`isStoredLineUp` of 0.51.0, copied into the test) is not accepted and is not overwritten.
- [ ] `e2e/support/app.ts` seeds the stored form. Commit.

### Task D2: the plan comes from the line-up

**Files:** Modify `src/lib/plan/fromStores.ts`, `src/lib/session/appShape.ts`, `src/app/session.ts`.

- [ ] `planFromStores()`: `loading` until the line-up store and every entry of the composed plan have loaded; `refused` with the composer's refusal; else `ready`. Before a line-up is stored, the plan is the whole-provider plan of the resolved selection, as in step 1.
- [ ] `readShapeFromStores` freezes `plan`, `accounts` and `lineUp` from it; `stageIdsFor` and `lineUpInUse` lose their "sole host is the provider that runs" condition together with `localStagesOf` (step 1, Part D's ruling). Commit.

### Task D3: the selection seam goes

**Files:** every reader listed under "Still on the selection" in step 1's Part C rulings and in the step-2 code map; `src/stores/providerStore.ts`.

- [ ] Each reader asks the plan's unit that owns its answer (transcription for turns, boundaries, typed text, face-to-face, the region hint; speech for voices and the hear switches). `useSelectedProvider`, `selectedFromStores`, `planFromSelection`, `planOnceSelected` and its hooks are deleted; `selectionLocked` becomes the line-up store's `locked`, set while the runner is not idle.
- [ ] `providerStore.selected` remains only as the value last written to `settings.common.provider`; nothing reads it to decide what runs. Commit.

### Task D4: the composer's remaining checks, in words

**Files:** Create `src/lib/plan/checks.ts`, `src/lib/plan/checks.test.ts`; Modify `src/lib/plan/{compose,types}.ts`, `src/lib/lineup/catalog.ts`, `src/lib/session/shape.ts`, `src/locales/*/translation.json`.

- [ ] New refusal codes, each with a table test: `lineup_voice_not_alone` (a voice not offered alone: Kizuna AI's Soniox, an end-to-end provider's), `lineup_voice_not_taken` (a text side that takes no other voice), `lineup_two_managed`, `lineup_language_not_spoken` (the target is not one the speech unit speaks, on a leg that speaks), `lineup_mode_not_served` (face-to-face, shared Both, manual turns, typed text: the unit that must serve it does not).
- [ ] Each speech unit states the languages it speaks (`UnitCapabilities.speaks(target): boolean`): Soniox from its wire table, Edge from its language list, a local model from its manifest.
- [ ] `gate` (`shape.ts`) returns a plan refusal as a run notice with the same code; the checks 3 to 5 that `gate` runs today move into `checks.ts` unchanged in behaviour.
- [ ] English words for every code under `notices.*`, and the other locales through the project's translation step. Commit.

### Task D5: choosing no longer moves what it need not

**Files:** Modify `src/lib/lineup/choose.ts`, `src/components/SettingsPage/LineUpCategory.tsx`, `src/locales/*/translation.json`.

- [ ] A choice moves another stage only inside a joint group. A choice the composer refuses is still stored, and the card shows the refusal.
- [ ] `settingsPage.lineup.moved` is removed from every locale and from the page. Commit.

### Task D6: leases and floors read the plan

**Files:** Modify `src/providers/soniox/{leaseRequest,kizunaBudget,kizuna}.ts`, `src/lib/session/shape.ts`; Tests beside them.

- [ ] `leaseRequest` and `kizunaSonioxMinimumBalance` take "this plan asks this provider for speech" in place of "the run speaks": with another provider's voice the request is today's `textOnly: true`, `participantSpeaks: false`.
- [ ] Review Focus 5 as tests: the roles asked, the floor and the cap for Kizuna AI's Soniox with Edge equal those of a text-only session today. Commit. **Part D ends here: open PR D.**

---

# Part E — surfaces

Branch `feat/free-speech-surfaces`.

### Task E1: the line-up page

- [ ] The speech card lists every voice the composer accepts with the current text side, and the others disabled with the refusal's words (`ProviderOptionModel.blocked`).
- [ ] Options on a card are owned by the unit (`LineUpCategory.tsx:203-215`): Soniox's voice and speed under Speech when Soniox speaks, Edge's and the local voices as now.
- [ ] A refusal of the whole line-up shows on the card of its stage, in the slot of the removed moved line, with `role="status"`. Send screenshots of the page in the four combinations to the design reviewer before the PR.

### Task E2: languages

- [ ] The target list is the translation unit's targets that the speech unit speaks, on a leg that speaks; the pair is normalised against that. `LanguagePairSection` reads the speech unit for its sentence (`:153`).

### Task E3: notices, telemetry, the rest

- [ ] `credentials_missing` and `sign_in_required` carry the provider they are about and open that provider's account row (`provider:<id>`).
- [ ] Every event that carries `provider` keeps the transcription provider and carries `stages`; `translation_session_start.stages` is always sent.
- [ ] The setup wizard stores the line-up; the provider id is written by the store (Task D1).

### Task E4: History and export

- [ ] A record whose stages are not all one provider's shows who did each stage in its details, and the export prints it (`recordStages`).

### Task E5: end to end

- [ ] E2E, fake: a session on `fake` + `fake_voice` hears audio for each translation and stores a record naming both.
- [ ] E2E `@real` (keys from the environment, skipped without them): Soniox own key with Edge; Kizuna AI's Soniox with Edge (needs a build with the hosted service and a signed-in test account); this device with Soniox's voice.
- [ ] macOS and Windows runs are asked of the platform owner and recorded in the hand-over as done or not done. **Part E ends here: open PR E.**

---

## Decisions made while Part A was built

They replace the text of Tasks A2 to A7 where the two differ; Parts B to E build on them.

- **The composite feeds the voice whether speech is on or off.** `speak` and `endUtterance` are always called; the unit decides what to drop and where to resume (Soniox's voice tracks the open sentence while off). `setSpeech` only calls `setOn`.
- **A reconnect of the text unit does not reset the feed.** The composite calls `recycle?.()` on each voice, then forwards `reconnected`. The feed is reset when the composite stops.
- **`counts` is keyed by `Ref` alone.** One map for both voices when the text sessions say `info.shared`; one per leg otherwise. Soniox's shared core has one ref counter for both legs, so refs do not collide there; in split Both each leg has its own core and nothing crosses legs.
- **Both legs: the voices start right after `startBoth` resolves**, not before it as §7.4 says for one leg: whether the legs share a connection is known only from the started sessions' `info.shared`, and `counts` is fixed when a voice starts. That is still before the run sends audio. `startCompositeBoth(plan, requests, events)` has no `shared` parameter and calls the text provider's `session.startBoth` itself with the text unit's configs and credentials: a text unit's config must keep whatever its provider's `startBoth` reads.
- **`startComposite(plan, request, events, leg = 'speaker')`**: the leg is passed because a `StartRequest` carries none and a voice is told its leg. The run passes it.
- **A voice that throws at start** is reported as `tts_degraded` once the text unit has opened; a start that fails says nothing of it. When the text unit fails or closes, the leg's voice is closed.
- **A lone leg does not read a translation whose language is not its target**; `endUtterance` is still sent.
- **`speak` carries an app language code and the home leg's name.** A unit converts to its own wire code.
- **The speech feed keeps a segment's stated language** for its later texts and for the close, clamps `stableLen` to the text, ignores a text after the close, and always calls `end(ref)` on close.
- **The rule suite**: `recordSpeech(start, request, forward?, log = [])` returns `{ session, log }`; `checkSpeech(log)` reads one session's log. `audio-index-counts` assumes the voice advances the counter before it emits. Two voices sharing one `counts` map cannot be checked from one log by the rules keyed by ref; they are checked each from its own log, with a fresh map.
- **Each unit's `shared.models`** is its own provider's readiness answer. `buildPlan`'s `shared` may be a function of the unit.
- **`fake_voice`** is registered among the development-only providers and in the catalog under the same build condition as `fake`. The setup wizard's own-key list holds only providers that can run a session alone (a unit with `start`), so a voice is never offered as a path. `registry.test.ts`'s "a development build adds exactly the two fakes" became three, on purpose.
- **Not done here, for Part B:** `wholePlan(p)` gives a provider's first unit all three stages, which is wrong once a provider declares several units: its callers (`planOf`, `shapeWith`, the selection's plan) must compose instead. `units` is read from a provider through a cast; Part B declares it on the provider type.

---

## Decisions made while Part B was built

They replace the text of Tasks B1 to B5 where the two differ; Parts C to E build on them.

- **The feed reads, at a segment's close, only up to the last stable length the segment stated**, when it ever stated one; a segment that never stated one is read whole at its close. A translation cut short with a partial showing (a reconnect) is not read past its finals, as before.
- **A late chunk on a closed translation is carried by `AdapterEvents.lateSpeech`** (optional): the composite hands it to the voice that reads the row, then ends the row's utterance, and passes nothing of it upward. Soniox emits it where its adapter used to speak such a chunk.
- **Soniox's text side sends a translation snapshot wherever it used to hand text to its voice**, with `stableLen`, plus one extra snapshot (finals only, in the spoken language) when the next regular snapshot would name another language. Above the contract a row may show that language for the length of one message.
- **A voice's `degraded` waits for the leg**: held until the text unit has opened, dropped when the start fails, for a voice that reports it during `open()` and for one whose `open()` rejects.
- **`units` is a declared, optional member of a provider.** `wholePlan(p)` and `compose` give a provider with a text unit and a speech unit the plan of both when it is asked for all three stages; a provider with one unit is as before.
- **The Soniox voice unit's `speech` capability is `'optional'`**, not `'always'`: the text-only switch must still silence it. On a leg that does not speak its config is `{ off: true }` and it names no model. `fake_voice` is `'optional'` too.
- **Shown equal, then deleted.** Thirty cases drove the adapter with its voice inside and the composite of `stt` + `tts` from one script, comparing segment events exactly and the Logs frames in order; a real hosted session on each path heard and translated the same sixteen sentences, sent the same sixty text frames for speech and received audio within 5 % of each other. The cases live on in `src/providers/soniox/composite.test.ts` as the composite's own expectations. Three differences were accepted, none above the contract: a Both start cancelled before the transcription socket opens asks for no voice (the adapter had opened and closed one socket per leg); nothing is logged after `failed` (the adapter still logged `tts.end`); the `session.opened` frame no longer lists who speaks.
- **Temporary, for Task D5 to remove:** `src/lib/lineup/choose.ts` treats a plan of more than one provider as not runnable, so that a choice still moves the other stages while the plan follows the selection. Without it, real units made the composer accept mixes (Kizuna AI's text with an own-key Soniox voice) and the line-up page stopped moving stages.
- **Open until Tasks D4 and D6:** the composer accepts Kizuna AI's voice alone and plans of two providers; a managed lease still asks for a speech role when another provider speaks.
- **For Part C:** `sessionSide.consistency.test.ts` roots Soniox's walk at `speech.ts` as well as the adapter; a new speech unit's files must be registered the same way. `silent-when-off` rejects ranged audio over a stretch handed over while speech was off, also after the row resumed: a voice must drop what is in flight when switched off.

---

## Decisions made while Part C was built

They replace the text of Tasks C1 to C3 where the two differ; Parts D and E build on them.

- **A missing local voice model is a notice, not a refusal**, as the whole local unit treats it today: the voice's config is `{ off: true, unavailable }`, its `open()` says `speaker_tts_missing` or `participant_tts_missing` once, and the session goes on with text only. `SpeechEvents.degraded` gained an optional `params` for the notice's words.
- **The session lives in `speechSession.ts`**, apart from the unit: the unit reads stores when it builds, the session must not. That file is registered in `sessionSide.consistency.test.ts`.
- **Switched off, the queue waits for the sentence in synthesis to settle** before it reads again: the engine refuses a second synthesis at once. What that sentence produces is dropped. An Edge synthesis that never settles therefore holds later speech until the session closes.
- **A voice that falls back to another speaker keeps its `voice_fallback` notice; a lost GPU device degrades the voice** and does not end the session.
- **`units` on the local provider is a lazy getter**: `[the whole unit, the speech unit]`. A line-up all on this device is served by the whole unit, as before.
- **The frozen line-up reaches a builder through `shared.lineUp`**, set only when the run's line-up was a stored one (`RunShape.lineUpStored`): a run started before any line-up is stored builds as it did, with Bing and Edge as ordinary candidates.
- **Admission is per unit**: the speech unit's configs are admitted for the voice model alone, told apart from a whole-session config by their shape. Memory is not summed across a plan.
- **Entries are loaded for every host the line-up names**, at launch and on each change of it; loads in flight are shared.
- **The first Edge voice is picked for the transcription provider's pair** when the local provider only speaks, and by the line-up's `edge`, not by the local selections. The voice slot opens the local voices when a local voice reads another provider's text.
- **For Part D:** the local provider's readiness check still asks for a recognition and a translation model when the provider only speaks; readiness must learn which stages a provider serves in the plan before a line-up with a local voice can start. `stageIdsFor`, `storedLineUpRuns`, `lineUpInUse` and `localStagesOf` hold one rule in four places and change together. The line-up page must show the local voices' card for a plan in which the local provider only speaks.

---

## Decisions made while Part D was built

They replace the text of Tasks D1 to D6 where the two differ; Part E builds on them.

- **Storage.** `settings.lineup` is `{ version: 2, stages }`. A version-1 value that disagrees with the stored provider is worked out again from the provider once and rewritten; one that agrees is rewritten on its next write. A version-2 value is used as stored. The provider key is written after every choice and every `replace`, with the transcription host's id, and never at a launch that changes nothing. Version 0.51.0's reader does not accept version 2 and leaves it alone (pinned by a test that carries that reader).
- **A stored line-up that cannot run is kept.** Only a value that is not a line-up, or names an id the catalog does not know, is shown from today's values and left unstored. A valid line-up the composer refuses stays stored: the plan is `refused`, Start is off with the refusal's words, and the page shows the stored choices.
- **The line-up store** holds `lineUp`, `stored`, `unstoredProvider` (the provider that runs while nothing is stored; null once something is) and `locked`. `providerStore.selected`, `select` and `selectionLocked` are gone. `useProviderEntry(provider)` and `useStageProvider(providers, stage)` replace `useSelectedProvider`; `runPlanFromStores` replaces `planFromSelection`; the readers that waited for a selection wait for the line-up store's load.
- **The launch window.** Before the line-up store has loaded, no surface falls back to the first offered provider: the account dot, the live gate, face-to-face, the hear switches, the pair, the speech and voice lines and a provider's own settings are empty or at their defaults until then.
- **A null speech stage does not compose** (`lineup_incomplete`): text-only is the session's switch, not an empty stage. The E2E specs that seed one keep a bare, unstored seed and run from the provider key.
- **Refusals.** `compose` adds `lineup_voice_not_alone`, `lineup_voice_not_taken` and `lineup_two_managed` from two catalog flags (`voiceAlone`, `takesVoice`) and the providers' kinds. `checkPlan(plan, context)`, run by the gate, adds `lineup_language_not_spoken` from `UnitCapabilities.speaks`. Every `lineup_*` code is a run notice with words in all thirty locales and the target `lineup`. `{{provider}}` appears once in each sentence, so that every locale keeps the same placeholders.
- **What a voice speaks.** Soniox: what its wire table accepts. The local unit: Edge's language list when the line-up says Edge, else any local voice model the manifest lists for the language, downloaded or not. `fake_voice`: everything.
- **Choosing** moves a stage only inside a joint group and a refused result is stored. (Part E gave `choose` the composer back: see its decisions.) The temporary guard and the text `settingsPage.lineup.moved` are gone. The page shows the current refusal on the card of the refusal's stage, through `useLineUpNotice()`. After a joint group is broken up nothing names which other stage moved; the line shown before the choice is the explanation.
- **The stored local stages** say per stage what the local provider serves: `translation: 'bing' | 'local' | null`, `speech: 'edge' | 'local' | null`. Null: another provider serves it, and nothing is resolved, noted or pruned for it.
- **Leases.** `servesSpeech(plan, provider)` decides. Kizuna AI's Soniox with another provider's voice asks for the text-only roles, floor and cap and makes no voice claim: on a speaker leg `spk_stt` alone, where `spk_stt` and `spk_tts` were asked.
- **Readiness knows the stages.** `CheckContext.stages` and `ReadinessInputs.stages` carry the stages a provider serves in the plan; a change of them forgets its readiness. The local check is ready when the provider only speaks.
- **Shown on real services** (Linux): Kizuna AI's Soniox read by Edge, and Soniox with an own key read by Edge. No connection to Soniox's voice is opened. Edge now and then refuses a connection for one sentence, on both of its endpoints; that sentence is not read and the session goes on.
- **For Part E:** `EdgeVoices` and `LocalVoices` read the local entry's pair, not the run's. The translations were not reviewed by native speakers. The target list is not yet the intersection with what the voice speaks. Notices about a key or a sign-in do not yet name their provider. History and the export do not yet show the stages.

---

## Decisions made while Part E was built

They replace the text of Tasks E1 to E5 where the two differ.

- **A voice that cannot stay follows the text side.** When a choice on a stage other than speech leaves a voice that cannot run with the new text side (`lineup_voice_not_alone`), speech moves to the chosen host's default voice and the Speech card says so once, in the plain tone: "Speech switched to {{provider}}. The previous speech service only supports its own translations." Without this a user whose stages were all on Kizuna AI's Soniox could not move the text to another service in one step. `choose(lineUp, stage, providerId, input)` takes the composer's input again and answers `{ lineUp, moved, followed? }`; the page's candidate check and the store's choice share `choiceInput` (`src/lib/plan/choice.ts`), so what the page tests is what a click stores. A choice made on the speech stage makes nothing follow.
- **An option the composer would refuse is disabled, with a short reason** after its name, in the way "needs a key" is said: "reads only its own translation", "uses only its own voice", "one Kizuna AI service at a time". Only the three structural refusals disable an option; a missing key or sign-in is said first; the current choice is never disabled. The full sentence stays on the card's refusal line.
- **A card never says Ready while it carries a refusal.** Its tag says "Unsupported language", "Can't be combined" or "Not available here", in the tone "Needs a key" has, as plain text. The refusal's tag wins over a missing key.
- **Words.** A refusal names the speech service, not "another voice": changing the voice of the same service does not help. `lineup_stage_split` reads "{{provider}} must also do {{stage}}. Choose {{provider}} for {{stage}}, or use another service instead of {{provider}}."; the refusal carries the provider and the missing stage only.
- **Languages.** Each provider's lists are asked with speech only when that provider's unit serves the speech stage (`contextFor`, `src/lib/session/shape.ts`); what a separate voice reads is a filter over the lists (`UnitCapabilities.speaks`) and the composer's own check. A stored pair the voice cannot read is kept and shown as a disabled option; the swap is off when a voice would not read the result, and says why.
- **Voices follow the session's pair.** `EdgeVoices`, `LocalVoices`, the voice line and a provider's own options read the transcription provider's pair (`useRunPair`).
- **Notices name their provider.** A key or sign-in notice carries the provider it is about (`namingProvider`) and opens that provider's account row, scrolled to and highlighted, also for a line-up on one provider.
- **Analytics.** The run's analytics port adds `stages` to every event that names a provider; `translation_session_start.stages` is always sent.
- **The export, not the History page, shows the stages.** The History page has no service line for a record, and none was added. The export's header reads `Provider: transcription=…, translation=…, speech=…` and the JSON gains `stages`, only when the stages are not all one provider's.
- **End to end.** The mixed-line-up spec waits for each translation row's replay to be offered, which only audio from the voice makes available. `real-mixed-line-up.spec.ts` runs Soniox with an own key read by Edge, and Kizuna AI's Soniox read by Edge after a sign-in; each asserts that no connection to Soniox's voice is opened. Not written: this device's text read by Soniox's voice (it needs downloaded models).
- **Not verified:** macOS and Windows; the thirty locales' new words by native speakers; an end-to-end provider with another voice (not offered: spec §14).

