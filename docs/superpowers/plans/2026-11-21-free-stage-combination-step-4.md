# Free combination of stages, step 4 — Implementation Plan

**Goal:** Transcription and translation are chosen apart: what one provider hears can be translated by another. The first line-ups this reaches are Soniox for transcription (with an own key, or Kizuna AI's) with the translation done on this device or by Bing, read by any voice the text side takes.

**Spec:** `docs/superpowers/specs/2026-11-19-free-stage-combination-design.md` (§4.2, §4.4, §7, §10, §11 step 4, §13). The plans of steps 1 to 3: their "Decisions made while Part … was built" sections are binding here.

**Tech Stack:** TypeScript, React, Zustand, Vitest. No new dependency.

## Global Constraints

- Stacked on step 3 (`feat/hosted-voice-offered`). Nothing merges to `main` and nothing is released until step 4 is done.
- Provider ids never change. A line-up that runs today sends what it sends today, byte for byte, and keeps its timing.
- Public repository: no backend internals, no usage data, no machine or team names in code, comments, commits or PR text.
- Gate every push on the unit suite passing and on the type-error total not rising.

## Rulings

Decided before the step was built. A part may refine one in its own "Decisions" section; it does not overturn one silently.

- **R1 The line-ups reached.** Transcription by Soniox (own key or Kizuna AI's), translation by this device's models or by Bing, and any voice the text side takes. Soniox's translation stays bound to Soniox's transcription. End-to-end providers stay whole.
- **R2 A line-up that is all on this device keeps today's whole unit.** Local recognition with local or Bing translation runs exactly as it does now: no change of timing. This departs from the spec's "local inference as three units": only the local *translation* unit is built (the speech unit exists since step 2). A local unit for recognition alone is not built, because no offered line-up reaches it: nothing else translates another provider's transcription yet.
- **R3 The contract.** A translation stage interface and its events as the spec's §4.2 sketches them, with a rule suite. A translator that is asked and answers sits behind a shared cutter.
- **R4 Rows.** Source rows and their origins stay the transcription unit's. A translation segment carries its source's origin, and several translations may share one origin (the projection already groups them). The cut: sentences of the source's *stable* start are sent as jobs while the source is open; the rest when it closes.
- **R5 Refs.** The composite adapter owns one ref counter per leg and maps each unit's refs to it (spec §4.4).
- **R6 Catalog.** `joint` stays for end-to-end providers. Soniox gets an asymmetric rule: translation by Soniox needs transcription by Soniox; transcription by Soniox alone is allowed. Choosing Bing or this device for translation on a Soniox line-up no longer moves the transcription.
- **R7 Composer.** A host's stages may be covered by several of its units, exactly. Local translation and local speech are two units.
- **R8 Languages.** A translation unit says which pairs it translates. A pair it does not translate is a refusal of its own; a translator is never swapped for another silently. An automatic source is refused with a separate translator: translators work on a fixed pair.
- **R9 Soniox with translation off.** The translation settings are left out of what is sent, and the unit occupies transcription alone. Both mode with a separate translator runs as two connections, one per leg. Face-to-face, which needs the one connection that carries both, is refused with a separate translator. A hosted session asks for the same text-only grant as today.
- **R10 Queue.** Translation jobs run in order per leg; speech runs in order behind them, as in the composite path of step 2.
- **R11 Failure.** One job failing is a `translation_failed` degradation, and the row keeps its source. The translator dying fails the leg. Lifecycle events say which stage they came from, and an error of the translation stage is filed under the provider that translates.
- **R12 Typed text** stays a capability of the unit that transcribes.
- **R13 Word list.** Soniox still gets the transcription terms; local models get the terms in their prompt as today; Bing gets none.
- **R14 Storage.** The stored line-up already allows a different provider per stage: no change of format.
- **R15 Tests end to end.** A fake unit that only transcribes and a fake unit that only translates; a real session of Soniox, Bing and Edge.
- **R16 Page.** One card per stage where the providers differ.

## Parts

**Part A: the machinery.** The translation contract and its rule suite, the shared cutter, the helper for translators that are asked and answer, the composite leg over three units with its ref mapping and stage tagging, and fake units per stage. Nothing a user can see changes: the composer still refuses every released line-up whose transcription and translation differ.

**Part B: Soniox transcription alone.** The wire without translation, the unit that occupies transcription alone, Both as two connections.

**Part C: the local translation unit.** Local models and Bing behind the cutter and the job translator; readiness and languages per stage.

**Part D: the surfaces.** The catalog's asymmetric rule, the composer's exact cover, the language refusal, the store, the line-up page and its words in every locale, the end-to-end tests and the real session.

## The contracts, as Part A leaves them

**The translation contract** (`src/lib/contract/translation.ts`):

```ts
interface TranslationStartRequest<C, K> { leg: LegName; context: SessionContext; config: C; credentials: K; clock: Clock; signal: AbortSignal }

interface SourceSnapshot { origin: string; text: string; stableLen: number; closed: boolean; language?: string }

interface TranslationEvents {
  translationOpened(e: { ref: Ref; origin: string }): void;
  translationText(e: { ref: Ref; text: string; stableLen: number; language?: string }): void;
  translationClosed(e: { ref: Ref }): void;
  failed(e: { message: string; code?: string; cause?: unknown }): void;
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string; params?: Record<string, string | number> }): void;
  loading(e: { stage: string; done: number; total: number }): void;
  frame(e: AdapterFrame): void;
}

interface TranslationSession {
  open(): Promise<void>;            // rejects when the unit cannot start: the leg does not start
  source(e: SourceSnapshot): void;  // the whole text each time; `closed` is the origin's last snapshot
  stop(): Promise<void>;
}
```

`translation.ts` also holds `hasSpeech(text): boolean` (a letter or a digit): what a source must hold to be translated at all, read by the cutter and by the rule suite.

**The rule suite** (`src/lib/contract/translationConformance.ts`): `recordTranslation(start, request, forward?, log?)` and `checkTranslation(log): Violation[]`. Rules: `ref-opened-once`, `origin-given`, `text-before-open`, `text-after-close`, `close-unopened`, `closed-once`, `stable-len-in-text`, `stable-len-holds`, `nothing-after-failed`, `nothing-after-stop`, `translation-closed`, `source-answered`.

**The cutter** (`src/lib/translation/cutter.ts`): `createSourceCutter(): { feed(snapshot: { text; stableLen; closed }): Stretch[] }`, with `Stretch = { text: string; span: TextRange }`. One cutter per origin.

**The job translator** (`src/lib/translation/jobTranslator.ts`):

```ts
createJobTranslator(o: {
  translate(text: string, signal: AbortSignal): Promise<string>;   // `signal` is the job's own
  events: TranslationEvents;
  clock: Clock;                      // each job's deadline runs on it, and the bound of a fatal failure's close
  signal: AbortSignal;               // the request's: an open still pending rejects when it aborts
  timeoutMs?: number;                // JOB_TIMEOUT_MS (20 000) when absent
  language?: string;                 // stated on every translation
  open?(signal: AbortSignal): Promise<void>;  // what the session awaits to open; `signal` is the request's
  close?(): void | Promise<void>;    // what is let go at the stop, or at a fatal failure; once
  failureMessage?(error: unknown): string;
  fatal?(error: unknown): boolean;   // this failure is the unit's end
}): TranslationSession
```

`CLOSE_TIMEOUT_MS` (5 000) is exported beside `JOB_TIMEOUT_MS`.

**The plan types** (`src/lib/plan/types.ts`): `UnitDefinition.startTranslation?(request, events): TranslationSession`, `isTranslationUnit(unit)`, and `UnitCapabilities.translates?(source, target): boolean`. A unit has `start` (it transcribes, alone or with other stages), or else one or both of `startTranslation` and `startSpeech`.

**The composite** (`src/lib/plan/compositeStages.ts`): `separateStages(plan): { transcription; translation; speech } | null`, `startStagedLeg(units, request, events, leg)`, `startStagedBoth(units, requests, events)`. `startComposite` and `startCompositeBoth` take such a plan; nothing above them changes. The signatures did not change with the review; the `signal` a unit finds in its start request is the leg's own, which follows the run's (see the decisions).

**The stage tag** (`src/lib/contract/adapter.ts`): `FromStage = { runStage?: RunStage }` on the payloads of `failed`, `degraded`, `loading` and on `AdapterFrame`. Only the composite states it, and only over a plan whose transcription and translation are apart.

**The fakes** (`src/providers/fake/transcriber.ts`, `translator.ts`): providers `fake_transcriber` (unit `transcriber`, settings `{ script: 'talk' | 'reconnect' }`) and `fake_translator` (unit `translator`, settings `{ delayMs, failOn, dieOn }`), in development and E2E builds; catalog entries in the E2E build only.

## Decisions made while Part A was built

**The contract**

- **A session opens, and the open may reject.** `startTranslation` returns at once, as `startSpeech` does, and `open()` is awaited: a translator that loads a model cannot translate before it has, and spec §7.4 puts the translation between the voice (not awaited) and the transcription. Unlike a voice's, this open may reject, and then the leg does not start: nothing useful remains of a leg that cannot translate.
- **The lifecycle events a translation unit may raise are `failed`, `degraded`, `loading` and `frame`.** A voice has `degraded` and `frame`; a translator also loads (`loading`) and can die (`failed`, R11). `reconnecting`, `reconnected` and `closed` stay the transcription unit's (spec §7.5); `busy` is read by nothing above the contract and was left out.
- **`translationOpened.origin` is required**, where the spec's sketch has it optional: a translation unit translates only what it was handed, so it always knows the origin, and the rule `origin-given` holds it to that.
- **Typed text is not in the contract (R12).** The unit that transcribes shows typed text as a source segment, and that source reaches the translation session as any other. The header of `translation.ts` says why.
- **A source with no letter or digit is owed nothing.** The cutter sends no job for one (a pause's dots, a lone mark), so the contract says so in its own words and `source-answered` exempts it, by the same predicate (`hasSpeech`, in `translation.ts`) the cutter cuts by. A unit that streams is held to the same: it may answer such a source, it need not.
- **The recorder copies what it records.** `recordTranslation` stores a shallow copy of each payload and passes the unit's own object on, so a unit that says one object twice, changed, is read as it said it each time.
- **`source-answered` reads a degradation loosely.** A closed source is answered when a translation names its origin, or when the session said `degraded` at any time after it was first handed that origin. A job of a stable sentence may fail before the source closes; the log cannot tie a degradation to a stretch, so the rule does not try. A session that was stopped or that failed owes nothing.

**The cutter**

- **Built beside `SentenceCut`, sharing the sentence rule.** `SentenceCut` cuts a recognizer's own hypotheses: they are rewritten as they grow, so it needs a punctuation model, a cursor counted in letters and a guard against re-decodes, and its cuts *are* the source rows. The new cutter reads text another unit owns and has said is stable, so an offset is cursor enough and no row is touched. What the two share is the pure `sentenceEnds` of `src/lib/segmentation/sentenceEnd.ts`. Local inference keeps `SentenceCut` exactly as it is (R2); no file of it changed.
- **A sentence is sent once a stable letter or digit follows its end.** The last mark of a growing text is not known to end a sentence: a decimal, an abbreviation and a lower-case continuation all look like an end until the next word comes. So the last sentence of the stable start waits for the next stable word, or for the close. This costs latency of about one word and keeps a job from being sent on half a sentence.
- **What is ready together is one stretch.** Sentences that became stable in one snapshot are one job, and the rest at the close is one job, however many sentences it holds: fewer requests and more context per request. A source whose unit never states a stable length is therefore translated whole, at its close.
- **No cap on length.** A long stable text without a sentence end waits for the close. A provider that punctuates as it transcribes does not produce one; a cap is left to the part that meets the need.
- **Nothing in `sessionSide.consistency.test.ts` needed registering.** That test follows a provider's own folder; modules under `src/lib` are outside it. The new modules run no timer of their own; the fake translator's delay reads the request's clock.

**The job translator**

- **A blank answer is a failed job.** It says `translation_failed` with the reason `translation_empty`. Local inference today shows nothing and says nothing for an empty answer; here the row would keep its source with no word of why, and the rule `source-answered` would have nothing to read.
- **A job has a deadline.** `createJobTranslator` takes the request's `clock` and a `timeoutMs` (`JOB_TIMEOUT_MS`, 20 s, by default). Jobs run one at a time, so a call that never settles would hold back every later one: at its deadline the job's own signal aborts, the job says `translation_failed` with the reason `translation_timeout`, and the next job runs. A late answer is dropped. A failure of `close()` on the fatal path is said as a `translation.close_error` frame before `failed`.
- **A fatal failure waits five seconds for the close, no longer** (`CLOSE_TIMEOUT_MS`, on the request's clock). A worker that is gone may never answer its own closing, and the leg has to hear `failed`. Past the bound the Logs get a `translation.close_timeout` frame, `failed` is said, the close is given up (a later `stop()` settles at once and whatever the close does afterwards is unheard). A `stop()` that lands during the wait takes over: it disarms the bound, says nothing of the failure, and waits for the close itself, as any stop does. A stop's own wait for `close()` is not bounded.
- **The ending is one.** The promise every `stop()` returns exists before the job in flight is aborted and before `close()` is called, so a stop asked from inside either joins it: `close()` runs once, and every stop settles as the first did, a rejection included.
- **A listener that throws costs that job only.** Its segment still closes, whether it threw at the open or at the text, the Logs get a `translation.job_error` frame, and the queue moves on, as local inference's pipeline does. A close is attempted for a segment whose open threw: whoever listens drops a close for a ref it does not know (the composite does).
- **A listener that stops the session hears nothing more.** `over` is read again after each event of a segment: a stop from inside `translationOpened` is followed by no text and no close, one from inside `translationText` by no close.
- **What the session says of itself in the Logs is said as it can be.** A listener that throws on a `frame` of the session's own (`translation.job_error`, `translation.close_error`, `translation.close_timeout`) costs neither the `failed` that follows nor the jobs that wait.
- **The open hears the run's signal.** `createJobTranslator` takes the request's `signal` (required) and hands it to `open`. Its session's `open()` rejects with the signal's reason when the run is already cancelled, or is cancelled while `open` is still loading, whatever `open` then does; the caller stops the session, which calls `close()`. So every unit built on it honours "a session still opening rejects" without a line of its own; the fake translator only passes its request's signal.
- **An origin that closed is remembered**, so a late snapshot of it starts no second cut and no second translation.

**The composite**

- **Ref mapping is done for the three-unit leg only.** A plan of a text unit and a speech unit has one unit that numbers segments, so its refs already are the leg's; and legs that share a connection number their rows together on purpose (either voice may read a row). Mapping there would change nothing a surface sees and would put every existing assertion on raw refs at risk. The existing composite tests pass untouched.
- **The three-unit leg is a merger in front of the two-unit leg.** `StagedLeg` maps refs and merges the transcription unit's source segments and the translation session's segments into one stream, and hands that stream to an unchanged `CompositeLeg` as if it came from one text unit. The voice, the speech feed, the audio counter and the karaoke ranges are therefore wired by the code step 2 built, keyed by the leg's refs.
- **A source with no stated origin gets one from the composite** (`composite-<ref>`), on the row and to the translator alike: a translation has to name its source. So that no origin a unit states can ever be one the composite stated, a unit's origin that begins with `composite-` is told apart as `composite-=<its origin>`, on the row and to the translator alike. The mapping keeps different origins different and needs no memory. This refines R4 for that one reserved beginning: every other origin stays exactly as its unit stated it, and no provider states one that begins so.
- **Stable is `heard.stableLen`, held to the text.** A snapshot that states no `heard` keeps the last stable length stated; a unit that never states one leaves nothing stable until the close. At the close the whole text is stable.
- **A unit that transcribes must emit no translation.** If it opens a translation segment, or sends `lateSpeech`, the composite throws in a development or test build (`import.meta.env.DEV`), where the mistake is a developer's to see; in other builds it drops the segment and everything that follows for it, and says so once in the Logs (`composite.unexpected_translation`), as it does for audio a text unit was not asked for.
- **Reconnect: what is open is handed to the translator as closed, at `reconnecting`.** The connection that was hearing those segments is gone, so what was heard is translated then, once. The rows stay their unit's: they close when it closes them. Text a unit adds to such a segment afterwards is shown and not translated. Soniox's adapter closes what is open when it swaps its connection; whether every adapter that reconnects does was not checked.
- **A translator that fails while the leg is still starting fails the start**, not a leg that never opened: with an `AdapterStartError` when it stated a code, otherwise with its cause.
- **A start is given up at once.** Each leg has an `AbortController` of its own that follows the request's signal, and its signal is what the translation unit and the transcription unit find in their start requests (the voice keeps the request's, as in a leg of two units, whose path is untouched). The leg aborts it when the translation says `failed` while the leg is starting, with the error the start then rejects with. Every wait of the start (the translation's open, the transcription's start) ends when that signal aborts, whether or not the unit hears it: the start rejects with the signal's reason (the translation's failure, or the run's reason), no unit is started afterwards, what had started is stopped, and a transcription session that opens late all the same is stopped, unheard. The error that gave the start up is the one thrown, whatever a unit rejects with afterwards. The controller is aborted for nothing else, so a unit that reads its signal after the leg has opened reads the run's.
- **A stop settles when the transcription and the translation have stopped and the voice has closed.** All three are called before the first `await` and all three are heard, whatever one of them throws. If the transcription's stop rejects, that is the rejection handed on, as in a leg of two units; then the translation's, then the voice's.
- **A voice that throws as it closes does not hide a start's error.** On a start that failed the voice's close is as unheard as the two stops.
- **Nothing follows a `failed` that came while `reconnecting` was being said.** A translator may fail on the closed snapshot it is handed then; the leg has ended with it, and `reconnecting` is not said.
- **A translation's ref is forgotten at its close; a source's is kept.** Nothing follows a translation's close by the contract, so its mapping is released then, and text or a close for a ref that is not open (never opened, or closed) is dropped instead of being given a row. A source's mapping stays for the session: a unit may revise a row it closed.
- **A translation says who spoke its source**, where the transcription unit tells people apart: the composite copies the source's `person` onto the translation segment, at its open and on its text. The adapter contract says the label is the same on a source and its translation, and that a defined `person` on a text replaces the segment's; Soniox's adapter says a translation's text again when its speaker changes. So a speaker corrected while the source is open is corrected on the translations it already has: each is said again as it last was, with the new `person` (a voice reads nothing twice for it: the text and its stable length are the same). For that the leg keeps the last text of the translations of sources that are still open, and lets it go when the source closes. A source corrected after it closed is not followed: a revision of a closed row is the row's alone.
- **Both runs as two independent legs.** `startCompositeBoth` starts each leg through `startStagedLeg`, with its own transcription session, translation session and voice, whether or not the provider that transcribes has a start of both. No voice reads the other leg's rows. If one leg cannot start, the other is stopped and the start rejects with a `LegStartError` naming the leg. The first leg to fail cancels the other's start through that leg's signal, so a leg still opening is given up, not waited for; the leg named is the one that failed first.
- **One unit may both translate and speak.** `separateStages` takes a plan of two units where one has `startTranslation` and `startSpeech`. No provider has such a unit yet.

**Stage tagging and the run**

- **The tag is named `runStage`**, not `stage`: `loading` already has a `stage` member that names what is loading, in the adapter's own words.
- **Only the three-unit leg tags.** There, every `failed`, `degraded`, `loading` and `frame` says `transcription`, `translation` or `speech`. A plan of a text unit and a speech unit still emits untagged events, so its payloads are what they were, and a voice's degradation there is still filed under the provider that transcribes. Tagging that path as well is a change for Part D to make together with the notices.
- **The run files an adapter's `api_error` under the tagged stage's provider** (`failed` and `degraded`), and under the transcription provider when no stage is stated. Everything else that names a provider is unchanged.

**The fakes**

- **The fake transcriber is the fake's adapter** over a script of source segments, with `sourceOnly`: typed text is shown as a source and not translated. The fake translator is a job translator whose answer is the stretch marked with the leg's target (`[ja] Hello.`), so a test reads which direction translated a row.
- **The three fakes compose today.** Each is a host of its own with one unit for its one stage, so the composer as it stands builds the plan of three units from `fake_transcriber`, `fake_translator` and `fake_voice` in the E2E build. No rule of the catalog, the composer or `choose` changed.
- **The setup wizard's "runs a session by itself" became exact.** It read "has a unit started as an adapter", which a unit for transcription alone also is. It now asks for a unit that serves transcription and translation, alone or with speech.

**Existing tests changed**

- `src/providers/registry.test.ts`: the list of development-only ids and the test that a development build adds exactly the fakes now name five fakes, and the two new ones are asserted present in development and absent from a release. No other existing test changed while Part A was built; in particular every existing composite test passed as it was.
- After the review, two tests of `src/lib/plan/compositeStages.test.ts` (both written in Part A): the order test no longer asserts that the translation unit's `signal` *is* the request's (it is the leg's, and a test beside it asserts that the run's cancels it); and "a translation that fails while the leg is still starting" no longer opens the transcription to let the start settle, since the start is given up at once. The helper of `jobTranslator.test.ts` passes the now required `signal`.

## Not verified in Part A

- The E2E suite was not run. In the E2E build the line-up page now lists the two new fakes among its options.
- No real provider runs through the three-unit leg yet: Soniox's `heard.stableLen`, its segments around a reconnect, and the latency of "one stable word after the sentence end" are for Parts B and D to measure.
- The cutter has no length cap and was tried on English and Japanese text only.
- Memory: the composite keeps one number per source segment and one label per origin whose unit names a speaker for the length of a session (a translation's number is released at its close), and the job translator one string per closed origin.
- A `stop()` whose `close()` never settles is not bounded: only the fatal path is.

## Decisions made while Part B was built

**The unit**

- **Transcription alone is a unit of its own, beside the text unit, not a second shape of it.** A unit's `build` and `capabilities` are not told which stages it was planned for, so one definition could not build two configs or answer face-to-face two ways. `sonioxTranscriptionUnitFor(parts)` (`src/providers/soniox/units.ts`, id `SONIOX_TRANSCRIPTION_UNIT`, `'transcription'`) is the same adapter over `buildSonioxAlone`: it occupies `transcription` exactly, keeps the connection's turns and boundaries, takes no typed text, and is not face-to-face. It describes the STT model and no translation model. The text unit (`stt`) is unchanged.
- **No definition declares it yet.** The composer finds the unit that occupies exactly a host's stages, and what refuses "Soniox transcribes, Bing translates" today is that Soniox has no unit for transcription alone. Declaring the unit would change that refusal (to `lineup_no_unit` on the other host) before the catalog's rule and the language refusal exist. Part D adds it to `sonioxUnitsFor`, which both definitions call, together with the catalog change. Until then a plan holds it only where a test builds one.
- **A config says it transcribes alone: `SonioxConfig.transcribesAlone`.** The adapter reads nothing else to tell the two apart, so a plan is told by its unit's stages and a config by this member.

**The wire**

- **`translation` is optional in the STT config, and left out of the frame when absent.** With a translation the frame's members and their order are what they were. The opening's line in the Logs (`session.opened`) leaves it out too.
- **The hint is the leg's source, alone.** With a translation the hints stay source and target, as before: the target is a language the socket writes in. A socket that transcribes alone writes nothing in the target, and in Both the other side has its own socket hinted with its own source, so the target would only pull recognition toward a language nobody on this socket speaks. An automatic source hints nothing, as before (R8 refuses it with a separate translator anyway).
- **The word list: terms and background, no translations (R13).** The entries are counted against Soniox's context limit as terms alone, so translations that are not sent push no term out.
- **Agent text follows the rule of the socket that also translates, split Both's included.** The speaker's socket asks for it in a run that speaks with the setting on, and never in a run of both legs. Split Both strips it in the adapter's start of both legs; legs that transcribe alone are started one at a time, so the builder has to know. `SharedSettings.bothLegs` says the run has both legs; the run sets it, and only `buildSonioxAlone` reads it.

**What the adapter says, alone**

- **Source segments only.** A token marked as a translation, which a socket asked for none does not send, is dropped before it can open a segment.
- **Every source snapshot states how much of it is final, once any of it is.** `heard.stableLen` is the length of the final tokens, stated whether or not the words could be placed on the run's clock (the pieces are then none), and a partial that turns final with the same words is said again with its new stable length. A socket that also translates states `heard` as before, only when it has a piece.
- **A source closes at its boundary and nothing waits.** `<end>` and `<fin>` close it at once; the utterance is not kept for late translation tokens and no grace is armed.
- **A reconnect closes the open source as it stands, as before.** The adapter closes it before it says `reconnecting`, so the composite hands it to the translator at that close, once, and finds nothing open at `reconnecting`.
- **A start of both legs over such configs is always two sockets**, whatever `sharedBoth` says. The composite does not use it (it starts each leg through the unit's own `start`); the rule is there so no caller can open the mixed socket for legs whose translation is elsewhere.

**Kizuna AI's Soniox**

- **Others translate and speak: exactly today's text-only request**, with the same floor and cap. `asksTranscriptionAlone(shape)` (`leaseRequest.ts`) tells the plan.
- **Both is always asked split when it transcribes alone**, whatever the shared-session setting says, and under face-to-face too (which the composer is to refuse, R9).
- **Its own voice reading another's translation is a speaking session's request**: a transcription role and a speech role a leg, as on this provider alone. It is not the voice-only request: `asksVoiceAlone` is false, because it transcribes. The voice gets the lease's speech key in the leg's credentials, as in a session on this provider alone, and reports nothing: the transcription socket reports the start, once.

**Existing tests changed**

- None. Tests were added beside them: the frame without a translation and the order of its members (`sttStream.test.ts`), the config (`config.test.ts`), the utterances (`utterances.alone.test.ts`), the unit (`units.test.ts`), the request and the floor (`leaseRequest.test.ts`, `kizunaBudget.test.ts`), and the adapter, the leg of three units and the hosted run (`transcriptionAlone.run.test.ts`).

## Not verified in Part B

- Nothing ran against the real service here. That a session opens and finishes with no `translation` and with `context.terms` was verified before this part; what its tokens' `translation_status` reads then, and whether `is_final` tokens arrive at the same pace without a translation, were not looked at. The latency of the first translated sentence depends on that pace.
- The real-session test (`@real`) was not written: no line-up reaches the unit before Part D.
- Whether the service prices a hosted session differently when it is asked for no translation is not known to the client; the request and the floor are today's.
- The settings page still shows the shared-session choice and the agent text row as it did; with the unit undeclared no user can reach a run where they do not apply. Part D decides what the page says there.
- Face-to-face is not refused anywhere yet for this unit: its capability reads false, and Part D's composer check is what refuses it.

## Decisions made while Part C was built

**The unit**

- **A third unit of the local provider, `translation`** (`src/providers/localInference/translationUnit.ts`, session in `translationSession.ts`). It occupies translation alone. Translation and speech on this device are two units (R7): neither occupies the two together. `units` is `[whole, translation, speech]`, and a line-up that is all on this device still resolves to the whole unit (R2).
- **The whole unit's session was not touched.** `adapter.ts` only exports four helpers it already had (`humanizeTranslationError`, `isDeviceLost`, `isGpuOutOfMemory`, `GPU_OUT_OF_MEMORY`), and `config.ts` gives the prompt it built inline a name (`localTranslationPrompt`). No test of the whole unit changed.
- **Its config is `{ modelId, instructions, wrapTranscript }`.** `admit` tells the three units' configs apart by shape: the whole session's names `asr`, the voice's names a speed (or `off`), this one names instructions. Its memory budget counts its translation models only; Bing counts nothing. Memory is still not summed across the units of a plan.

**Which engine translates**

- **The line-up's translation option says, and it is read from what `build` is handed** (`shared.lineUp`, the line-up the run froze). `bing` is `bing-translator`. `local_inference` is the model the direction resolves to among this machine's models, with no recognition model resolved beside it. Handed no line-up, the stored one says; with none stored either, the direction resolves as the local provider does without a line-up, where Bing is one of the local choices.
- **Neither stands in for the other (R8).** Under a foreign transcriber, a pair Bing does not take is a refused build, and the unit's own start refuses it again (`build_refused`) before any engine is made. With no model for the direction, the build is refused as `local_models_missing`; Bing is not tried. The fallback inside `resolveWasmDirection` (Bing's pair unsupported, stay on local models) still exists for the whole unit and is not reached by this unit.
- **A recognition model that translates speech itself is not a translator of text.** If the direction's translation resolves to one, the build is refused as `local_models_missing`.
- **`capabilities.translates` reads the stored line-up**, as the speech unit's `speaks` does: capabilities are asked without a run. Part D may prefer the pure `localTranslates(option, source, target)`, which takes the option id.

**Languages**

- **`translates` is about the catalog, not about downloads.** Bing: both codes are on Bing's own list and are not one language to Bing (`zh` and `zh-CN`, `no` and `nb`). This machine's models: some translation model of the manifest takes the pair, downloaded or not, whatever device it needs. A model that is not downloaded is a matter of readiness. An automatic source is never translated.
- **Because the manifest has models that take any language, `translates` for `local_inference` is true for almost every pair.** Whether the device can run such a model (they need WebGPU) is not part of the answer; readiness says the model is missing.
- **Codes are read as written.** A regional code is not folded onto its base language: the engine is loaded with the code it is given. Bing takes `zh-CN`, `zh-TW`, `zh-HK` and not `zh-Hant` or `zh-Hans`. Whether a foreign transcriber's codes need mapping for this unit is Part D's to decide with the pair picker.
- **For the pair picker:** `localTranslationTargets(option, source, among?)`, `localTranslationSources(option, target, among?)` and `localTranslationLanguages(option)`, with `option` being `'bing'` or `'local_inference'`. A model that takes any language names none, so for local models pass the transcriber's languages as `among`.

**Readiness**

- **`LocalStages` gained an optional `transcription: null`**, stated only when this device translates and another provider transcribes. Absent, the provider transcribes whenever it translates, so every value written before reads as before. `unservedStages` then leaves out recognition alone.
- **The check asks for what will run.** Translating for a foreign transcriber: each leg that runs needs the translation of its own direction and no recognition model; Bing needs no download. Unlike the whole unit, the reverse direction is not allowed to lack a translation: a leg of this unit cannot run transcription-only. Bing with a pair outside its list is not ready. All of these say `local_models_missing`, the existing notice and target.

**The session**

- **The model loads in `open()`**, so the composite starts the transcriber only after it. It says the frames the whole unit says for a translation engine and one `loading` event (`translation`, 1 of 1). A load that fails rejects the start in the whole unit's words (`Translation engine init failed: …`, or `gpu_out_of_memory`). A start cancelled, or a stop, while the model loads rejects the open and lets the engine go.
- **A blank answer is said**, as Part A's job translator does it (`translation_failed`, reason `translation_empty`). The whole unit shows nothing and says nothing for a blank answer; there the source row is its own. Here a row would keep another provider's source with no translation and no word of why.
- **No job is taken back.** No engine here has a way to stop a request, so a job given up at its deadline or at a stop is left to finish and its late answer is dropped. The deadline is 60 s for a model on this machine (`LOCAL_MODEL_JOB_TIMEOUT_MS`) and the shared 20 s for Bing. The whole unit has no deadline; a slow model's answer to a long stretch is still wanted, so the model's deadline is the longer one.
- **Failure (R11).** One job failing is `translation_failed` in the whole unit's words, Bing's tagged errors included. A lost GPU device on a job, or the worker's `onError`, ends the unit: the session is stopped first, then `failed` is said, so nothing follows it; the composite fails the leg.
- **Word list and prompt (R13).** A local model gets the prompt the whole unit builds, word list and session background included. Bing's config has empty instructions.
- **No punctuation model runs.** The shared cutter works on the punctuation the transcriber wrote. A transcriber that does not punctuate gets one job per source, at its close.

**Existing tests changed**

- `src/providers/localInference/provider.test.ts`: the test of `units` now expects three and names the translation unit. Nothing else existing changed; tests were added to `check.test.ts`, `localStages.test.ts` and `resolveWithStages.test.ts`.

## Not verified in Part C

- No real model and no real Bing ran through the unit: every session here is over a fake engine.
- Two legs with one local model load it twice, once per leg, as the whole unit does; memory with a local voice in the same plan is not summed.
- How often a real model answers blank is not known; each such answer is now a notice.
- The 60 s deadline was chosen, not measured.

## Decisions made while Part D was built

**The catalog (R6)**

- **A member of its own: `translatesOwn`.** `joint` means what it meant, and only the end-to-end providers have it: stages one connection carries together and never apart. Soniox, with an own key and Kizuna AI's, has `translatesOwn: true` in its place: it translates only what it transcribes, and its transcription may stand alone. Two helpers read both members, and every reader goes through them: `goesWith(option, stage)` (the stages an option must serve itself when it serves `stage`) and `carriedTogether(option)` (the stages one connection of it carries when the line-up gives it all of them: what the line-up page's shared card and the Accounts page's tags read). `soleHost` needed no change: it compares hosts.
- **The E2E build's `fake` keeps its joint group.** It has no unit that transcribes alone, so the asymmetric rule would say something its units cannot do. `fake_transcriber`, `fake_translator` and `fake_voice` are each a host of one stage, which the composer covers as it stands.

**The composer (R7)**

- **An exact cover, fewest units first.** A host's stages are cut into parts every way there is; a way is a plan when each part has a unit of the host that occupies exactly it. The ways are tried by number of parts, then parts of neighbouring stages first, so one unit for everything wins over any cut: a line-up all on this device, or with this device transcribing and translating, is the whole unit (R2, pinned). Soniox on all three is its text unit and its voice; Soniox transcribing and speaking around another translator is its unit that transcribes alone and its voice; this device translating and speaking is its translation unit and its speech unit.
- **Stages that go together are never cut.** A part holds every stage `goesWith` names for its stages. A host given only part of such a group is asked for one unit and nothing else, as before: an end-to-end provider's whole unit may still answer for transcription and translation, and what follows is the voice rule's to say.
- **Soniox's translation without its transcription is said first**, before any unit is looked for, so the refusal is about Soniox and not about the other host's units. The plan's units are in stage order whichever host they belong to.
- **`lineup_stage_split` is reused for it**, with the stage `transcription`: its sentence reads "Soniox must also do transcription. Choose Soniox for transcription, or use another service instead of Soniox.", which is the rule. End-to-end splits answer the same code as before.
- **Changed after a design review: it has its own code, `lineup_translation_bound`**, on the stage `transcription` and carrying the option that translates. Its sentence says which stage to change ("Soniox translation requires Soniox transcription. Choose Soniox for transcription, or choose another translation service."), in thirty locales; `lineup_stage_split` keeps its sentence and is the end-to-end splits' alone.
- **The line-up page draws the green frame and the "goes with … over one connection" line only for stages the same option serves in this line-up.** A stored line-up with Soniox's translation beside another transcription shows neither on any card, only the refusal; valid line-ups are drawn as before.
- **The voice rule with the text on two hosts.** A voice is its host's own only when all three stages are on that host. Otherwise it is fed by the leg of three units and has to be offered alone, on the host that transcribes too; then each host of the text side that is not the voice's own is asked whether it takes another voice, the one that transcribes first. Every released separate line-up passes. `twoManaged` is unchanged.

**The checks that need the run (R8, R9)**

- **Three codes, each a notice in thirty locales with the target `lineup`:** `lineup_source_not_fixed` (an automatic source), `lineup_pair_not_translated` (it carries the pair) and `lineup_face_to_face_apart`. All are on the translation stage; the first two name the line-up's option for translation (Bing, not the provider that runs it), the third the option that transcribes.
- **They read the units' capabilities.** A translation unit that states `translates` is asked for every leg the run opens, each in its own direction; a unit that does not state it is never refused. Face-to-face is refused when it was asked for, another unit translates, and the unit that transcribes says it cannot run it.
- **"Asked for" is new to the run's shape: `faceToFaceAsked`.** `faceToFace` is "asked for and offered", and under a unit that does not offer it a stored "beside me" is ordinary Both; that stays true for a provider whose one unit transcribes and translates. Where another unit translates it is refused instead, and the Both popover and the Audio page keep the "Other side" choice on show while it is (`useFaceToFace().refused`), so the user can put the other side back in a meeting without changing the line-up.
- **The gate says these before the reversed pair.** Otherwise Both with a pair the translator does not take the other way round would read "this provider can't translate the other participants", which names neither the service nor the way out. The voice's language is still judged after the reversed pair, as before.

**Choosing (R6)**

- **One rule: a stage goes with the stages it needs.** The chosen option takes `goesWith` of the stage, and another provider loses a stage whose `goesWith` it just lost part of. So Bing or this device for translation keeps Soniox transcribing; Soniox for translation takes the transcription (reported in `moved`, as a joint partner is); Soniox for transcription keeps a translation by Bing or this device; another provider for transcription takes Soniox's translation with it, to the chosen host's default. "Speech follows" is unchanged.
- **Every line-up reached by choosing from any host's defaults composes** under the released providers' default settings (a property test walks them all). The separate ones are exactly Soniox, either one, under Bing or this device. What such a line-up can still be refused for needs the run: the three codes above and `lineup_language_not_spoken`.

**Languages (R8)**

- **The translation unit answers, among the transcription provider's languages.** Where another unit translates and states `translates`, the sources are the transcription provider's that have a target, and the targets are that provider's own target list for the source, kept where the unit translates the pair. An automatic source has no target and is not offered. The lists keep the transcription provider's codes, which the pair is stored and reversed in.
- **Bing's codes need no new mapping for Soniox's list.** Soniox writes Chinese `zh` and Norwegian `no`, which Bing's table already maps; every other code is the same. Eight of Soniox's sixty languages are not on the app's list of Bing's (Albanian, Azerbaijani, Basque, Belarusian, Galician, Gujarati, Kannada, Macedonian): they are offered with a model of this device and not with Bing. The list was not widened here: nothing was run against Bing.
- **A stored pair the new translator cannot take is kept**, as a pair a voice cannot read is: the picker shows what it is as an option that cannot be chosen, the line-up's card says why, and Start is off until the pair or the line-up changes.

**Readiness and Start**

- **A provider that only translates is checked for the pair as picked.** Before Start, a provider's check read its own entry's pair, the nearest its own lists offer; with another provider transcribing, that can be another pair than the one that runs. The store now hands such a provider the picked pair, and a new pick forgets its answer. A start's own check already read the run's pair.
- **Nothing else was wrong.** A start reads every provider's credentials and readiness, so Soniox's key (or the sign-in) and this device's translation model are each asked of their own provider and named in their own notice; Bing and Edge need nothing. Kizuna AI's Soniox transcribing for another translator has the text-only floor, and the speaking one when its own voice reads.

**The line-up page (R16)**

- **Soniox's shared card has a second choice.** While Soniox transcribes and translates, the two stages share a card as before, with its one choice on top; the translation's part now has a choice of its own, and the card says "Transcription and translation go over one connection. Another service can do the translation: choose it below." Once another service translates, each stage has its own card and nothing says they go together. An end-to-end provider's card is unchanged.
- **Soniox is offered for translation everywhere**, enabled: choosing it moves the transcription, as choosing an end-to-end provider moves its stages. Nothing is said before or after; the cards regroup.
- **Soniox's options where it transcribes alone:** the shared-session choice is not drawn, and agent text reads as it does in split Both. The stored settings are kept.
- **Card states** reuse the tags there were: "Unsupported language" for the pair and for an automatic source, "Can't be combined" for face-to-face.
- **The word list:** nothing is said for Bing (the page says nothing for it under this device either).

**Records and analytics**

- Nothing was wrong: the run already hands the record the three ids and each stage's model from its own unit, the export prints the stages when the hosts differ, and a translation error is filed under the provider that translates (Part A). Tests were added at each level. The voice of a plan of two units is still untagged: left as it was.

**Existing tests changed**

- The composer's and the catalog's: the cases that pinned "Soniox transcribes, Bing translates" as refused, "a host with no joint stages is not split" and "translation alone is no unit of it" now state the cover; the old joint case runs under a catalog that holds Soniox's stages jointly.
- `choose`: a translation chosen under Soniox keeps Soniox, and Soniox chosen for transcription keeps the translation; the property test follows `goesWith`.
- The Soniox units' list (three, the unit that transcribes alone declared), and Part B's "declared by no definition yet".
- The local provider's "nothing a user can choose changed" (now: a provider with no unit that transcribes alone has no unit for what is left to it).
- The line-up page: the shared card's two choices and its sentence; the refused example is Soniox's translation without its transcription.
- The notice targets' and the notice words' lists, by the three new codes.

## What step 4 leaves

Known limits:

- **Typed text is not available while Soniox transcribes** (R12): it is the transcription unit's capability, and Soniox takes none.
- **Face-to-face and an automatic source are refused with a separate translator** (R8, R9). Both mode then runs as two connections to Soniox, one per direction.
- **No unit of this device transcribes alone** (R2): nothing offered translates another provider's transcription but this device and Bing, so "this device transcribes, Soniox translates" is refused, and a line-up with this device transcribing always runs its whole unit.
- **A run ends when a hosted voice's lease does** (step 3), also where the transcription is on the user's own key and the translation on this device.
- **Memory is not summed across the units of a plan**: this device's translation model and its voice model are budgeted each on its own.
- **The targets with a separate translator are the transcription provider's languages.** Bing translates into languages Soniox does not list; they are not offered, though a one-way session would not need Soniox to hear them.
- **The page's count of word-list entries left out** is Soniox's with translations, also where Soniox is sent the terms alone and more of them fit.
- **A host of one stage has no default for the others.** Choosing the E2E build's fake translator under the joint `fake` leaves a line-up with no transcription, said as incomplete. No released host is such a host.
- **The card's readiness before Start** follows the picked pair; a pair Soniox's own lists would move for its language context is checked as picked, and the start's own check decides.

## Not verified

- The E2E suite was not run. Two cases were added to `mixed-line-up.spec.ts` (three fakes; the line-up page) and one `@real` case to `real-mixed-line-up.spec.ts` (Soniox with an own key, Bing, Edge): written and type-checked only.
- No run against a real service: Soniox asked for no translation, Bing through the job translator, the latency of the first translated sentence, and a hosted session that transcribes alone.
- No real model of this device ran through the translation unit.
- The four new strings in the twenty-nine other locales were not reviewed by native speakers. Each quotes that locale's own words for "Auto Detect", "Other side" and "In a meeting".
- macOS and Windows.
