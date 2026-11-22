# Text models for translation and notes, Part D — this device's recognition as a unit of its own

**Spec:** `docs/superpowers/specs/2026-11-22-text-model-stages-design.md` (§5, §11, §12 answer 1). The rulings and decisions of `docs/superpowers/plans/2026-11-21-free-stage-combination-step-4.md` are binding here; this part refines R2 and the "What step 4 leaves" line "No unit of this device transcribes alone".

**Goal:** a unit of the local provider that transcribes only (`id: 'transcription'`, occupies exactly `['transcription']`), started through the adapter contract, so the leg of three units can run this device's recognition with another provider's translation unit. Nothing offered reaches it until Part B adds the text models; this part proves it with plans composed under a test catalog or built by hand.

**Global constraints:** a line-up in which this device transcribes and translates runs through the whole unit, exactly as before (R2). No user-visible change in this part.

## Decisions made while Part D was built

**The unit**

- **The whole session's adapter over a config that says so, as Soniox's unit that transcribes alone is (step 4, Part B).** `createLocalTranscriptionUnit(deps)` / `localTranscriptionUnit` (`src/providers/localInference/transcriptionUnit.ts`, id `LOCAL_TRANSCRIPTION_UNIT`, `'transcription'`) starts `createLocalInferenceAdapter(engines)` over a config built by `buildLocalTranscription`. The recognizer, the VAD, Smart Turn under automatic turns, a manual turn's flush, the times a final's words were heard, and an utterance the recognizer gives up on are the whole session's code, not a copy. No session file of its own: the session side stays `adapter.ts`, so nothing new needs registering in the session-side walk.
- **A config says it transcribes alone: `LocalInferenceConfig.transcribesAlone`.** Its translation is `none`, it has no `tts`, no `ttsUnavailable` and no `jobSentences`. The adapter reads that member for three things only, each guarded by it: it says no `translation_unavailable` (at the start or for typed text: another unit translates), every final states `heard.stableLen = text.length` (with the recognizer's pieces where the words could be placed in time, with none otherwise, as Soniox alone does), and the Logs' `local.session.opened` line names the recognition model and the source, not a pair and a voice. A config without the member runs exactly as before; the whole unit's tests did not change.
- **Partials grow the row and say nothing stable; a final closes it, all of it stable.** A local recognizer's partials are guesses that may be rewritten, so the composite treats nothing as stable until the final, then cuts the closed text with the shared cutter: sentences of a final that holds several are sent as several jobs, in the same moment. `SentenceCut` and the seal are not used here (no translation engine, so no cut); the rows are the recognizer's own utterances, with the whole session's origins (`u1`, `u2`, …).
- **Capabilities:** speech `never`, turns `auto` and `manual` (push-to-talk and push-to-translate are both manual turns to an adapter), boundaries `provider`, text input yes, face-to-face no (the whole local unit has none either), participant speech yes. It describes its recognition model alone: the translation and the voice are named by their units.
- **The start refuses, before any engine is made, a config that would translate or speak** (`build_refused`): an engine translation, speech translation, a voice, or a config not built to transcribe alone. A translation segment from this unit would be a second translation of a row.

**Speech translation (Granite Speech)**

- **Refused as a configuration, not as a model.** The builder resolves the direction with the translation stage served elsewhere, so the speech-translation pairing (Granite chosen for both stages of a direction) cannot resolve here: Granite chosen as the recognizer transcribes (`translateTo` is never set), and the user's translation choice for the direction is left as it is for when this device translates again, as for every stage another provider serves. A config that would translate speech anyway is refused at the start. Refusing the Granite models as recognizers would have taken away two recommended recognition models from a line-up where they only transcribe.

**Typed text (R12)**

- **Typed text stays this unit's.** It is one source segment, opened, said and closed at once, with no `heard` (nothing was heard), exactly as the whole session shows it; the leg hands it to the translation unit closed, which translates it, and the voice reads it.

**Readiness and `LocalStages`**

- **`LocalStages.transcription` is `'local' | null`, stated only where this device serves one of transcription and translation without the other.** `null` (step 4, Part C): another provider transcribes and this device translates. `'local'` (new): this device transcribes and another provider translates. Absent: it transcribes whenever it translates, so every value written before reads as before. `unservedStages` leaves recognition served under `'local'` (so the engine settings show the recognition slot and not the translation slot, and the storage page counts the recognition model as in use). `localTranscriptionStagesOf(lineUp)` is what the unit builds with: never a translation model, speech as the line-up says.
- **The check asks for what will run.** Told `transcription` without `translation` (or a stored line-up that reads so), each leg that runs needs a recognition model for its own source and no translation model; speech never gates. A leg without one is `no_asr` with its source, the code `build` refuses the same gap with (its notice names the language), worded "selected" or "reverse" as the whole unit's check is. The shortcut "this provider only speaks" now applies only where it does not transcribe either.

**Admission**

- **Its configs are told apart by shape: they name `asr` and say `transcribesAlone`.** `admitLocalTranscription` counts the recognition models of the legs and nothing else; over budget the start is refused (`memory_exceeded`). There is no voice of its own to drop. Memory is still not summed across the units of a plan.

**The composer and the catalog**

- **`units` is `[whole, transcription, translation, speech]`.** The exact cover, fewest units first, takes the whole unit wherever this device transcribes and translates: pinned over every triple of this device, Bing and Edge, and with a foreign voice. Where another provider translates, the local host's stages are cut: its recognition unit, and its speech unit when the line-up gives it the voice too.
- **No catalog member was needed.** `local_inference` has neither `joint` nor `translatesOwn`, so `goesWith` already lets its transcription stand alone, and `choose` keeps this device transcribing when another option is chosen to translate. What refused such a line-up was only that the local host had no unit for transcription alone.
- **No released line-up changes how it runs.** A test composes every triple of the released catalog with and without the new unit: every plan is the same, and no plan takes the new unit (nothing offered translates what this device hears but this device). One refusal is worded otherwise: where this device transcribes and an end-to-end provider translates, the composer now says `lineup_stage_split` (that provider's stages go together), as it does for Soniox transcribing alone, where it said `lineup_no_unit` (this device has no unit for transcription alone). `choose` never makes such a line-up (it moves an end-to-end provider's stages together), which the walk of every reachable line-up in `choose.test.ts` pins.

**Languages**

- **No change: the sources stay this device's list, recognition and speech both (`getLocalInferenceLanguages`).** The pair picker takes sources from the provider that transcribes and, where a separate unit states `translates`, keeps those the translator takes from (step 4, Part D). A wider list for this unit alone could not be kept: the provider store holds a pick within the transcription provider's own widest offer (`setPair` → `normalizePair`) and derives the run's pair from it, so a source offered only by the plan would be put back to the first of the provider's list. Widening the provider's own list would change what a line-up all on this device offers, which this part does not do. Every source offered is one some recognition model of the catalog takes, so the list is narrower than the recognizers allow, not wrong; the languages left out are the few no speech model of the catalog speaks. Targets are this device's list for the source, kept to the pairs the translator takes, as for Soniox.

**Both**

- **Each leg is started on its own (step 4, Part A):** its own recognizer for its own source, its own translation session in its own direction, its own voice. A leg whose recognizer cannot load fails the start, naming that leg, and the other is stopped.

**Proof**

- `transcriptionUnit.test.ts`: what the unit declares, its config, admission, and its sessions over `FakeAsr` under the adapter rules (partials, finals with and without placed words, typed text, manual turns, Smart Turn, an utterance given up, a recognizer that dies, one that does not load, a stop mid-utterance, the refusals at start), and that the whole session over the same config without the member still says what it said.
- `transcriptionUnit.run.test.ts`: the plan composed under a test catalog (this device, the fake translator, the fake voice), the leg of three units under the adapter rules (rows and origins, a final of two sentences cut in two, typed text, a manual turn, a stop mid-utterance, a recognizer that dies fails the leg naming the transcription stage, one that cannot load fails the start, an utterance given up), both legs, the languages such a plan offers, and a run of the same line-up through the runner (built, admitted, started, heard, typed text, both legs, each stage's model named).

**Existing tests changed**

- `src/providers/localInference/provider.test.ts`: the test of `units` now expects four and names the recognition unit second. Tests were added beside it (the composer over this device, Bing and Edge; another provider translating; every released triple; admission of the recognition configs).
- `src/providers/localInference/check.test.ts`: its mocked resolver now resolves recognition where `transcription` is `'local'`, as the engine does; no existing assertion changed. Tests were added to it, to `localStages.test.ts` and to `resolveWithStages.test.ts`.

## Not verified in Part D

- No real recognition model ran through the unit: every session here is over a fake engine. Whether a real model's finals arrive at the same pace when no translation engine shares the machine was not measured.
- The latency of the first translated sentence: a local final closes its row at once, so the translator gets each utterance whole at its end (several sentences of one final go as several jobs in the same moment); nothing is translated while the recognizer is still guessing.
- An utterance the recognizer gives up on (or an empty final after partials) closes its row with the text it had, and the separate translator translates that text; the whole unit translates nothing for it. Left as it is: the contract has no way to say a closed source is not to be translated.
- The engine settings, the storage page and the settings initializer read the new `'local'` member through `unservedStages`; no line-up offered today produces it, so none of these surfaces was looked at with it.
- The E2E suite was not run; no E2E case was added (the line-up page cannot reach the unit before Part B).
