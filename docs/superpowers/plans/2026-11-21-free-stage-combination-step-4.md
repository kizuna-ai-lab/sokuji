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
