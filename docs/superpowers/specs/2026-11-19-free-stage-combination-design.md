# Free combination of stages — design

Date: 2026-11-19. Status: approved; step 1 is under way (see the plan beside it).

## 1. Goal

Today the line-up names one provider per stage (transcription, translation, speech, notes), but a session is
run by exactly one provider. The line-up's rules force the three run stages into one "family", and a choice
that breaks the rule moves the other stages ("Mixing will be supported later").

After this work:

- The three run stages are chosen independently wherever the vendor's interface allows it. The first case to
  work is Kizuna AI's Soniox for transcription and translation with another service for speech.
- A combination that cannot run is refused before anything connects, with a reason the user can read.
- Subtitles, History, karaoke highlighting, export and the Logs panel do not change.
- Notes stay as they are: already independent of the run stages (`src/lib/notes/notesService.ts:47-52`).

First batch of services: Soniox with the user's own key, Kizuna AI's Soniox, local inference, Local Native,
Edge speech and Bing translation. The end-to-end services (OpenAI Realtime, OpenAI Translate, OpenAI Live,
Gemini, Qwen LiveTranslate, Doubao AST 2.0, Palabra) keep their behaviour; their speech becomes replaceable.

Out of scope: a new frame pipeline (rejected, §12), voice activity detection as a line-up stage (§9), any
new vendor.

## 2. Where the stages are bound today

All references are to `main` at v0.51.0.

| Binding | Where | Kind |
|---|---|---|
| The vendor's interface | Soniox: translation rides the STT socket and the config always carries it (`src/providers/soniox/adapter.ts:448`, `sttStream.ts:63,175`). End-to-end services: one connection for everything. | Fixed by the vendor. Every provider is `speech: 'optional'`, so speech can always be left out. |
| The line-up's rules | `ProviderCaps.family` and `binds`; `runOf()` answers `mixed` across families (`src/lib/lineup/catalog.ts:39-51`); `choose()` moves the other stages (`choose.ts:36-37`). | Data and pure functions. |
| One provider per run | `RunShape.provider` (`src/lib/session/types.ts`); `providerStore.selected` follows `runOf(lineUp).provider` (`src/stores/lineUpStore.ts:176-200`). | The main body of work. |
| Speech inside the adapter | Soniox: `LegSpeech`, driven from one seam (`src/providers/soniox/utterances.ts:279-288` → `adapter.ts:243-250`). Local inference: `speakTranslation` at the end of a translation job (`src/providers/localInference/adapter.ts:573-590, 682-699`). | Two components with different shapes. |

What reads "the one provider" today:

- The run reads eleven members of the definition: `turns`, `languages` (reverse check) and
  `session.minimumBalance` in the gate (`src/lib/session/shape.ts:161-193`); `credentials.read`
  (`run.ts:191`); `check` through the readiness cache (`run.ts:199`); `session.prepare` (`:211`); `build`
  (`:227`); `session.admit` (`:239`); `describe` (`:256`); `session.acquire` (`:285-338`);
  `session.startBoth` / `start` (`:360`, `:549`); `textInput` (`:509`).
- 36 non-test files outside `src/providers/` read the selected provider as "the provider of the session":
  the language lists, whether Start is allowed, the balance floor, the hear/read switches, the voice line,
  the turn-detection summary, face-to-face, the setup wizard, telemetry. Twelve files already work per
  provider (the accounts page, a provider's own settings, file recognition, notes).
- Only the selected provider is readiness-checked (`src/app/readiness.ts:50-54`).

## 3. What other projects do

Read from source, for architecture only: `pipecat-ai/pipecat` `main` c8231f3 and `livekit/agents` `main`
8dc9390. Their issue trackers were not read.

- Pipecat: everything is a frame flowing through a list of processors. One class per vendor per stage. A
  fused speech-to-speech model sits in the LLM position and emits the frames of the stages it replaces; this
  needs transcript frames pushed upstream, duplicate text frames marked "do not add to context", and a
  special aggregator mode. No validation of combinations. Fused usage is reported as LLM tokens only.
- LiveKit Agents: fixed slots (`stt`, `llm`, `tts`, `vad`, `turn_detection`) with typed streams between
  them. A fused model is one `RealtimeModel` with a capability struct (`audio_output`, `user_transcription`,
  `turn_detection`, `can_disable_turn_detection`, …) computed from its configuration. A model with no audio
  output and a `tts` in the session has its text routed to that TTS. Translation is a field of the STT
  event (source texts and target texts together), as in its Soniox plugin.

Taken from them:

1. Outputs are normalised, not vendors. A fused model emits the same events a cascade does. The adapter
   contract already does this.
2. One connection may occupy several stages, and which ones follows from its configuration.
3. Both projects validate combinations weakly. This design refuses an invalid plan before connecting.

## 4. Concepts

### 4.1 Unit

A unit is one thing a session opens: a connection or an engine. A unit declares the stages it occupies
**for a given configuration**.

| Unit | Occupies | Notes |
|---|---|---|
| Soniox STT connection | transcription + translation; transcription alone from step 4 | Translation cannot be switched off today (§2). |
| Soniox TTS connection | speech | Today's `LegSpeech`. |
| Local ASR | transcription | Browser models. |
| Local ASR with Granite Speech chosen for both stages | transcription + translation | Today's `translation.kind === 'ast'` (`src/providers/localInference/config.ts:29-32`). |
| Local translation model, Bing | translation | Bing is the engine model `bing-translator` today, not a kind of its own. |
| Local TTS model, Edge | speech | |
| Local Native ASR / translation / TTS | one each | Three clients, already separate (§10). |
| An end-to-end provider | all three; transcription + translation when run without speech | Today's adapter, wrapped, not rewritten. |

### 4.2 Stage interfaces

A unit speaks one or more of three interfaces. Sketches, not final signatures:

```ts
/** Audio in, source segments out. */
interface TranscriptionStage {
  appendAudio(pcm: Int16Array): void;
  endTurn(): void; cancelTurn(): void; beginTurn(): void;
  /** Text this app is about to play where the microphone hears it; absent: not taken (§7.3). */
  agentText?(text: string, endOfSegment: boolean): boolean;
  stop(): Promise<void>;
}
interface TranscriptionEvents {
  sourceOpened(e: { ref: Ref; origin?: string; person?: string }): void;
  sourceText(e: { ref: Ref; text: string; stableLen?: number; heard?: Heard; language?: string; person?: string }): void;
  sourceClosed(e: { ref: Ref }): void;
}

/** Source text in, translated segments out. */
interface TranslationStage {
  /** A source segment's text so far; `stableLen` characters will not change. */
  source(e: { origin: string; text: string; stableLen: number; closed: boolean; language?: string }): void;
  /** Typed text: a source of its own. */
  text(text: string): void;
  stop(): Promise<void>;
}
interface TranslationEvents {
  translationOpened(e: { ref: Ref; origin?: string }): void;
  translationText(e: { ref: Ref; text: string; stableLen: number; language?: string }): void;
  translationClosed(e: { ref: Ref }): void;
}

/** Translated text in, audio and the characters it speaks out. */
interface SpeechStage {
  open(): Promise<void>;
  speak(ref: Ref, text: string, span: TextRange, language: string): void;
  endUtterance(ref: Ref): void;
  setOn(on: boolean): void;
  /** The transcription connection came back: let a half-open socket go. */
  recycle?(): void;
  close(): void;
}
interface SpeechEvents {
  audio(e: { pcm: Int16Array; ref: Ref; range?: TextRange }): void;
  speechRanges(e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void;
}
```

All three also carry the lifecycle events an adapter has today (`failed`, `degraded`, `reconnecting`,
`reconnected`, `loading`, `frame`), tagged by the composite adapter with the stage they came from.

A unit that occupies two stages implements both interfaces on one object; its events for the two stages share
`origin`, as Soniox's source and translation do today (`src/providers/soniox/utterances.ts:106, 209`).

Two families of translation unit exist and the interface covers both:

- Streaming: the unit produces translation as the source grows (Soniox, an end-to-end provider).
- Request and answer: one job per cut of the source (local models, Bing, Local Native). These share one
  cutter, extracted from local inference's `SentenceCut` (`src/providers/localInference/sentenceCut.ts`),
  which decides when a stretch of source is sent.

### 4.3 Composer

`compose(lineUp, settings, run) → RunPlan | Refusal`. Pure; nothing connects.

It checks, in this order, and the first failure is the reason shown:

1. Every run stage has exactly one unit, and a unit is not asked for part of what it occupies under this
   configuration (Soniox chosen for translation means Soniox transcribes).
2. Every provider in the plan is present on this platform and has what it needs: a key, or a sign-in.
3. Languages: the source must be one the transcription unit takes; the target must be offered by the
   translation unit and, on a leg that speaks, by the speech unit. The language lists the pair picker shows
   become the intersection.
4. Modes: face-to-face, shared Both, manual turns, typed text and screen context each need the unit that
   implements them to say it does.
5. Turn ownership (§9).

`family` and `binds` leave `ProviderCaps`. A stored line-up stays valid: provider ids do not change.

A `Refusal` carries a code and parameters, as notices do, so every surface words it the same way.

### 4.4 Composite adapter

The plan is run by one composite adapter per leg (or one for both legs, where a unit serves both). **It
implements today's `Adapter` contract** (`src/lib/contract/adapter.ts`): audio in; `segmentOpened`,
`segmentText`, `segmentClosed`, `audio`, `speechRanges` and the lifecycle events out.

Everything above the contract is therefore unchanged: `Conversation`, the subtitle surfaces, History capture,
karaoke, export, the Logs panel, `AgentTextFeed`. The existing conformance suite
(`src/lib/contract/conformance.ts`) applies to the composite adapter as it is.

The composite adapter owns:

- One ref counter per leg. Units number their own segments; the composite maps them.
- The wiring: source text to the translation unit, translation text to the speech unit.
- Rules that live in the Soniox adapter today and are not about Soniox's TTS (§7.2).
- The order of opening and closing (§7.4).

## 5. The provider definition

A definition is two things today: an account (settings, credentials, readiness check, languages) and a way to
run (`build`, `start`, session hooks). The account stays. The way to run becomes a list of units.

```ts
interface Provider<S, K, R> {
  // unchanged: id, kind, platforms, settings, Settings, credentials, check, languages, …
  units: readonly UnitDefinition<S, K, any>[];
  session?: SessionHooks<S, K>;   // prepare, acquire, minimumBalance: per provider, see §6
}

interface UnitDefinition<S, K, C> {
  id: string;                      // 'stt', 'tts', 'asr', 'translation', 'whole'
  /** The stages this unit occupies under these settings, for this request. */
  occupies(s: S, want: ReadonlySet<RunStage>): readonly RunStage[] | null;
  capabilities(s: S): UnitCapabilities;
  build(context: UnitContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start(request: UnitStartRequest<C, K>, events: UnitEvents): Promise<UnitSession>;
}
```

`UnitCapabilities` holds what generic code reads from the definition today, moved to the unit that owns it:
`turns`, `boundaries`, `textInput`, `faceToFace`, `participantSpeech`, whether it takes agent text, whether it
takes typed text, the languages it serves for its stages.

One key and one readiness check per provider, shared by its units: Soniox's STT and TTS units use the same
key. `languages` splits by stage: the sources a provider transcribes, the targets it translates into, the
languages it speaks.

### 5.1 The whole-provider unit

In step 1 every existing provider gets exactly one unit, `whole`, built from its present `build`, `describe`
and `start`. It occupies all three stages, or transcription and translation when the request does not ask it
for speech. Its capabilities are the definition's present members. Nothing about an adapter changes.

This is what makes step 1 a refactor with no visible change, and it is how the end-to-end providers stay.

## 6. Session hooks, leases and money

`prepare`, `acquire` and `minimumBalance` stay on the provider. The run calls them for each provider in the
plan, with the stages that provider serves in this plan, not with the run's overall shape.

Kizuna AI's Soniox today asks for stream roles from the run's shape: `textOnly` is "no speaker leg, or the
run's speaker does not speak" (`src/providers/soniox/leaseRequest.ts:42-57`). With speech from another
provider, the request is exactly today's `textOnly: true` with `participantSpeaks: false`: no TTS key is
minted, the floor is the STT roles' (`kizunaBudget.ts:48-50`) and the cap is the 18 000 s of a session with no
synthesis (`:23-25`). The backend needs no change. `leaseRequest` must read "this plan asks Soniox for
speech", not "the run speaks".

Places in the Soniox code that equate "the run speaks" with "Soniox holds a TTS key", each to change in
step 2: `buildSoniox` setting `tts` from `context.speech` (`config.ts:81-83`); the `tts_degraded` notice for a
config with `tts` and no key (`adapter.ts:141, 473`); `describeSoniox` reporting a TTS model (`config.ts:93-95`);
the own-key `read` always answering `tts: key` (`settings.ts:177`).

A plan with two managed providers has two leases. Not in the first batch (step 3 introduces a lease for
Kizuna AI's Soniox speech alone, which needs a backend change). The run's single `budget`, single floor and
single `payer` become per provider then; until then the composer refuses a plan with two managed providers.

Billing for Kizuna AI's Soniox with another provider's speech: the STT stream is charged as a text-only
session is today. This is the proposed default; the owner has not yet confirmed it explicitly.

## 7. What moves into the composite adapter

### 7.1 A stable length for translation text

`segmentText` for a translation carries a whole-text snapshot with no statement of how much is final. The
source side has `heard.stableLen`. A speech unit outside the adapter needs the translation's stable length to
speak before the segment closes.

Soniox already has it: `translationFinal` is append-only and the snapshot is `translationFinal + partial`
(`src/providers/soniox/utterances.ts:145, 309`); only the sink to speech sees its length (`:285`). Add
`stableLen` to the translation's `segmentText` payload in the contract. An end-to-end provider's translation
grows by appending, so its stable length is its length. Local inference emits one snapshot per job, whole and
final (`adapter.ts:580`).

The composite adapter speaks `text.slice(spoken, stableLen)` in the chunks the unit reported them, so the
first audio comes as early as today.

### 7.2 Rules that are not about one vendor's TTS

From `src/providers/soniox/adapter.ts`, with the state each needs:

- A translation into the other leg's target is read by that leg's voice, and its audio and ranges return on
  the row's own leg, naming the voice (`:248-265`; the `abroad` set per ref, `:196, 267-275`). Needs each
  leg's target, whether the legs share a core, and the other leg's speech unit.
- One audio index per ref, shared by the voices that read a row (`:135-139, 792-797`). The runner's
  `AgentTextFeed` re-counts the same indices (`src/lib/session/agentText.ts:43, 64-65`), so the composite
  adapter is the one place that numbers them.
- Translated speech switched off and on mid-session, resuming at the next sentence (`:361`;
  `speech.ts:148-161`).
- The speech connection is let go when the transcription connection reconnects (`:207-210`).
- Speech opened before the first word can arrive, never awaited (`:343`).

Karaoke ranges stay a duty of each speech unit: provisional ranges while audio streams, then the fill-in
(`src/lib/contract/ranges.ts`). Soniox keeps its implementation. Local inference's `speakTranslation` gives an
exact range per sentence clip and no fill-in, which the contract already allows. Note: `priorSeconds` in the
shared pace model was measured on Soniox's voice (`ranges.ts:51-53`); a speech unit for another voice states
its own.

### 7.3 Agent text

Soniox's echo help sends the text this app is about to play on the STT socket
(`src/providers/soniox/sttStream.ts:234-238`). It needs no Soniox TTS key: the runner's `AgentTextFeed`
builds it from translation text, `audio` ranges and `speechRanges`, and calls `agentText` on the speaker
leg's session (`src/lib/session/agentText.ts:16-19`).

In a plan, the feed's input comes from the speech unit (through the composite adapter's `audio` and
`speechRanges`) and its output goes to the transcription unit that hears the microphone. The composite
adapter forwards `agentText` to that unit when its capabilities say it takes agent text. Soniox asks for the
socket option when "some leg of this run speaks" (`config.ts:79`), which stays true whoever speaks.

### 7.4 Order

Open: lease(s), sources, then per leg the speech unit (not awaited), the translation unit, the transcription
unit. Close: the reverse of today's Soniox order (`adapter.ts:711-732`): transcription first, then
translation, then speech, then the lease.

### 7.5 Failure of one unit

Today a leg has one state: opening, live, reconnecting (`src/lib/session/types.ts`). Rules for a leg made of
units:

- The transcription unit failing fails the leg, as today.
- The translation unit failing fails the leg: nothing useful remains.
- The speech unit failing degrades the leg (`tts_degraded`), as a lost Soniox TTS socket does today; the
  subtitles go on.
- `reconnecting` / `reconnected` of the transcription unit are the leg's. A speech unit reconnects on its own
  and reports only in the Logs, as `LegSpeech` does.

### 7.6 Translation and speech queueing

In local inference one job is "translate, then speak, then close the segment", and jobs run one at a time, so
translation N+1 waits for speech N (`adapter.ts:561-584`). When the two become separate units (step 4) the
composite adapter keeps two queues: translation jobs in order, and speech in order behind them, so a long
clip no longer delays the next subtitle. The translation segment still closes after its last clip, which
karaoke relies on (`localInference/speech.ts` header). This changes timing for local inference and is
measured in step 4 before it ships.

## 8. Stores and surfaces

The largest part of step 1 by file count.

- `RunShape.provider`, `.settings`, `.credentials` become `RunShape.plan` with each provider's settings and
  credentials. `providerStore.selected` goes; what is stored is the line-up. `selectionLocked` becomes "the
  line-up is locked while a run is not idle".
- Readiness is tracked per provider, and every provider in the current plan is checked, not only one
  (`src/app/readiness.ts:50-54`). Start needs all of them ready. A notice about a missing key or sign-in opens
  the account row of the provider it is about (`src/lib/view/noticeTargets.ts:16-18`).
- The language pair stays one global intent (`src/stores/providerStore.ts:99`). It is normalised against the
  plan's intersection instead of one provider's lists.
- Speech surfaces read the speech unit: the hear/read switches (`useHearingRows.ts`), the voice line
  (`SpeechOutputSection.tsx:47-63`), participant speech. Turn-detection summary and controls read the
  transcription unit (`SpeechSection.tsx:73-77`; `LineUpCategory.tsx:256`).
- The line-up page: a stage's list no longer depends on the other stages. Choosing moves another stage only
  when one connection occupies both (the existing "they change together" wording). A plan the composer
  refuses shows its reason on the card and on Start. The text `settingsPage.lineup.moved` goes.
- Options ownership on a card is by family today (`LineUpCategory.tsx:197-209`); it becomes by unit.
- `ConversationInfo.provider` and History's `services.provider` hold one id. They become the transcription
  provider's id plus a `stages` map; existing readers keep the single field. `describe` is asked of each unit
  for its own model.
- Telemetry: every event that carries `provider` (`runner.ts:277-288`, `run.ts` reconnect events, and the
  others listed in the code map) keeps it as the transcription provider and gains `stages`.
  `translation_session_start.stages` is always sent.
- The setup wizard keeps offering whole-provider paths; it writes a line-up as now.

## 9. Turn detection

Not a line-up stage in this work. The interface reserves its place.

Every provider answers `turns: ['auto', 'manual']` today. A manual turn ends with `finalize` on Soniox
(`soniox/adapter.ts:357-360`) and with a flush on local inference (`localInference/adapter.ts:369-379`). An
external turn detector is therefore a component that takes audio and calls `beginTurn` / `endTurn` /
`cancelTurn` on the transcription unit: an automatic driver of manual turns.

- `UnitCapabilities.turns` says who may decide the end of a turn for this unit: the unit, an external
  detector, or either. The composer checks it against the turn mode from step 1.
- The detector that exists (Silero VAD with Smart Turn) runs inside local inference's ASR worker
  (`src/providers/localInference/engines.ts:17, 25`). It can be offered to other units only after local
  inference is split (step 4). Local Native's ASR already takes client-side marks
  (`NativeAsrClient.sendVadMark`).

A later step, after step 4, extracts it as a component chosen under Advanced. Owner's decision, 2026-11-19.

## 10. Local inference and Local Native

Local inference is a cascade already. Step 4 turns its three parts into units:

- ASR unit: `AsrLike` (`engines.ts`), with the VAD and Smart Turn wiring it has.
- Translation unit: `TranslationLike`, behind the shared cutter. Bing is this unit with the `bing-translator`
  model; the line-up's `bing` id maps to it.
- Speech unit: `speakTranslation` over `TtsLike`; Edge is this unit with the Edge voice.
- Granite Speech chosen for both transcription and translation: the ASR unit occupies both stages and emits no
  source segment, as today (`adapter.ts:439, 524-526`).

Things to carry: `build` reads the line-up from a global store (`config.ts:104`); it takes the plan instead.
`admit` sums memory across the stages (`config.ts:204-242`); it becomes a check over the local units in the
plan. One `ended` flag and "any engine's fatal ends everything" (`adapter.ts:213, 416, 623, 710`) become the
rules of §7.5.

Local Native (step 5) is not wired into a session under the adapter contract today; its port is pending
(`src/services/interfaces/IClient.ts:2-5`). Its three clients map to the three interfaces directly. Points to
settle then: they use global timers, not the run's clock; the translation client is told the co-loaded ASR
and TTS models for memory accounting; the TTS client gives no ranges, so its unit states them per sentence as
local inference does.

## 11. Steps

Each step merges and ships on its own.

| Step | Work | Visible change |
|---|---|---|
| 1 | Units, capabilities, composer, plan, composite adapter. Every provider as one whole-provider unit. Stores and surfaces read the plan (§8). `family` and `binds` go. | None. Every line-up that runs today runs the same way. |
| 2 | Speech interface. Units: Soniox TTS (own key), Edge, local TTS. `stableLen` on translation text. §7.2 and §7.3 move to the composite adapter. Soniox with the same account for all three stages runs through the composite path. | Any transcription and translation (Kizuna AI's Soniox, an end-to-end provider without speech, local) with any of the three voices. |
| 3 | Kizuna AI's Soniox speech alone: a lease with only a speech role (backend), and plans with two leases. | Another provider's transcription and translation with Kizuna AI's Soniox voice. |
| 4 | Translation interface and the shared cutter. Local inference as three units. Soniox STT with translation off. | Transcription and translation chosen apart. |
| 5 | Local Native as three units under the contract. | Local Native per stage. |
| later | Turn detector as a component (§9). | An external turn detector under Advanced. |

### 11.1 Proving the composite path equals the old one (step 2)

The owner's decision: Soniox for all three stages runs through the composite path, and the old internal path
is deleted once the two are shown to behave alike.

- Both paths are driven from the same recorded Soniox token stream and TTS answers (the adapter's tests
  already fake both sockets). The event logs are compared: segments, texts, `audio` order, `voice`, ranges,
  `speechRanges`, notices.
- The cases: one leg; split Both; shared Both; face-to-face with a translation read by the other voice;
  speech switched off and on mid-sentence; an STT reconnect during speech; a TTS segment lost; `<fin>` with a
  late translation; stop during a connect.
- Karaoke and agent text are compared through their inputs (ranges and audio indices), which is what they
  read.
- One real session on each path with the same audio, compared by ear and by the History record.

The old path stays behind a development switch until that passes, then is removed in the same step.

## 12. Rejected

A frame pipeline in Pipecat's manner. It gives the same combinations as this design. It replaces a typed
contract that carries what the surfaces depend on (segment refs, the pairing of a translation with its
source, the characters a piece of audio speaks, two legs, face-to-face) with generic frames from which those
are rebuilt. Half of the providers are fused models, which is where that model is weakest (§3).

## 13. Testing

- The adapter conformance suite runs over the composite adapter for every plan shape.
- Each stage interface has its own rule suite; every unit passes it.
- The composer has a table test over the line-ups: runs, or refused with this code.
- Step 1's bar: the existing unit and E2E suites pass without edits to their expectations.
- The E2E build gains fake units per stage, so mixed plans are tested end to end.

## 14. Not verified

- Whether each end-to-end vendor stops generating and charging for audio when asked for text only. To be
  checked per vendor before step 2 offers it another voice; a vendor that cannot be confirmed is not offered.
- Latency of a fused model's text with an external voice. Not measured. A fused model run this way also loses
  its own voice features (voice cloning in Qwen and Doubao).
- Echo with a voice that is not Soniox's against Soniox STT. Agent text carries text, so it should hold; to be
  measured.
- Face-to-face with a voice that is not Soniox's. Face-to-face stays Soniox-only for transcription; whether its
  speech may come from another unit is decided after step 2's measurements.
- The ASR worker's internals (VAD, Smart Turn) and the Local Native clients were read at their interfaces
  only.
- Whether the runner gates audio for manual turns before the adapter was not traced.
