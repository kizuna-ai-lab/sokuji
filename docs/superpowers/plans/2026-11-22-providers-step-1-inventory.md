Code inventory for the provider refactor (origin/main ca1259850, 2026-11-22). Paths are relative to the repository.

# Inventory: Bing/Edge as providers, one stage declaration, required `units`, no store reads in units

## 1. Bing/Edge special-casing (non-test, non-locale)

Line-up and catalog layer:
- `src/lib/lineup/catalog.ts:27-28`: CAPS entries `bing` (translation, host `local_inference`, voiceAlone false, takesVoice true) and `edge` (speech, host `local_inference`, voiceAlone true, takesVoice false). Becomes: `host === id`.
- `src/lib/lineup/catalog.ts:118-124`: `severalHosts` counts Bing/Edge as the local host.
- `src/lib/lineup/catalog.ts:144-157`: `ON_THIS_DEVICE` is `{local_inference, bing, edge}`; `hostDefaults('local_inference')` returns it, and text models default their other stages to it.
- What these become: the defaults can stay (ids unchanged). But `soleHost`, `severalHosts` and `voiceRefusal`'s early return would stop treating local+Bing+Edge as one host (see "Hidden one-host dependencies" below).
- `src/lib/lineup/migrate.ts:18-29`: maps a resolved `bing-translator` to `'bing'` and `edge-tts` to `'edge'`. No change if the ids are kept.
- `src/lib/lineup/localStages.ts:19` (`LocalStages{translation:'bing'|'local'|null; speech:'edge'|'local'|null}`), `:28-42` (`served('translation','bing')`, `served('speech','edge')`), `:49,58,68,80`: tells the local provider whether a stage is Bing, a local model or another provider.
  - Becomes: the `'bing'`/`'edge'` values disappear. Only "local or other provider" is left, and that is the unit's identity.
- `src/lib/lineup/types.ts:11` (doc example), `:36` (`host` doc names bing/edge).

UI:
- `src/components/SettingsPage/LineUpCategory.tsx`:
  - `:163-167`: adds bing/edge to `offered` when local is present.
  - `:183`: splices bing/edge into the option list after `local_inference`.
  - `:286-290`: `ownerOf` gives null for bing (no options) and the host for edge, so Edge's card shows the local provider's options.
  - `:335`: draws `<EdgeVoices>` in place of the engine when speech is `edge`.
  - `:386`: maps an option whose host is local to the local provider.
  - `:388`: bing/edge are always "Ready".
  - `:65`: `'edge-voices'` target opens the speech card.
  - Becomes: generic provider rows. Edge gets its own `Settings` with an SP part and its own readiness.
- `src/components/SettingsPage/AccountsCategory.tsx:30,110-111,160`: hard-coded "online" rows for Bing and Edge, pushed only if local is present. Becomes: rows driven by the providers (a new `kind`, or `local`).
- `src/components/SettingsInitializer/SettingsInitializer.tsx:3,28,34-37,52-85`: auto-picks an Edge voice per speaking direction.
  - It is gated on "the speech unit's provider is `local_inference`" (`:35`), then on `resolve(...).tts.modelId === 'edge-tts'` or `lineUpSpeech === 'edge'` (`:62-63`).
  - It writes `voices[dir].edge` into local settings (`:78-80`).
  - Becomes: the gate moves to the Edge provider and the write goes to Edge's settings. Unchanged, the effect silently stops running.
- `src/components/providers/openTtsSlot.ts:24-27,52`: `lineUp.speech === 'edge'` navigates to `'edge-voices'`. Becomes: a check on `unitFor(plan,'speech').provider.id`.
- `src/components/providers/ProviderOption.tsx:10,29-33,38-42`: `EXTRA` map (icon, name, note) for the two "providers that are not in the registry". Becomes: `provider.icon` plus the `providers.<id>.*` locale keys.
- `src/components/SettingsPage/EdgeVoices.tsx` (whole file): reads and writes `settings.local_inference.voices[dir].edge` (`:26,66-67`), checks `localInferenceProvider.participantSpeech` (`:58`), previews (`:69-76`). Moves to the Edge provider, as its `Settings` SP part or a `VoiceSummary`.
- `src/components/SettingsPage/categories.ts:63-64`: `'edge-voices'` → `{category:'lineup', anchor:'edge-voices'}`.
- `src/lib/view/noticeText.ts:25`: `OPTION_NAMES {bing:'Bing', edge:'Edge'}`, the fallback names in refusal notices. Becomes dead.
- `src/components/Icons/ProviderIcons.tsx:311-343`: `BingIcon`; `EdgeIcon = BingIcon`. Become the providers' `icon`.
- `src/components/SetupWizard/LineUpPreview.tsx:21` (comment), `steps/StepCredentials.tsx:47`, `steps/StepProviderPath.tsx:28`: copy only.

Local engine:
- `src/lib/local-inference/modelManifest.ts`:
  - `:27` (`TtsEngineType 'edge-tts'`), `:145` (`translationWorkerType 'bing'`).
  - `:3008-3020` (`edge-tts` entry, `isCloudModel`), `:3248-3266` (`bing-translator` entry).
  - `:3453-3460` (TTS languages use `EDGE_TTS_LANGUAGES`, so Edge widens the local language list).
  - `:3521-3526` (Bing branch of `isTranslationModelCompatible`).
  - Becomes: the entries must stay for the unstored path (see risks). Moving them out of the manifest changes `getLocalInferenceLanguages`.
- `src/lib/local-inference/selection/resolveWithStages.ts:16-30`: with no line-up, cloud models are candidates. With a line-up, `withCloud:false`, and Bing/Edge are forced in when stages name them.
  - Becomes: the forcing goes away (another provider serves the stage, so `unservedStages` nulls it).
- `src/lib/local-inference/selection/candidates.wasm.ts:12-15,26,35-36`: `withCloud`. Also `src/components/Settings/engine/useWasmEngineAdapter.ts:41,47`: `withCloud: stages === null`.
- `src/lib/local-inference/engine/TranslationEngine.ts:30,95-104,108,253-256,277-297`: Bing worker plus extension DNR headers (`BING_TRANSLATOR_SET_HEADERS`; handler in `extension/background/background.js`).
- `src/lib/local-inference/engine/TtsEngine.ts:18,49,92-101,171-183,200,357-415,512-514`: Edge connection path.
- What both engines become: the Bing/Edge sessions keep using these lib engines, which is allowed. A new provider's session must not import `src/providers/localInference/*`.

Local provider:
- `src/providers/localInference/speechUnit.ts:40-52`: `localSpeaks` uses `stages.speech==='edge'` to pick Edge's list, local models, or either if unstored. `:74`: `speaks` reads `storedLocalStages()`. `:78`: build reads the line-up.
  - Becomes: local voices only. A new `edge` speech unit gets Edge's list.
- `src/providers/localInference/translationUnit.ts`:
  - `:10,24-27,37` (`LocalTranslationOption = 'bing'|'local_inference'`).
  - `:60-107` (Bing language logic), `:114-118` (stages from line-up or store).
  - `:120,152,161` (Bing config), `:143` (`translates` reads the store), `:191` (budget skips Bing).
  - Becomes: local models only. The Bing logic moves to a `bing` translation unit.
- `src/providers/localInference/check.ts:7,34-37,90-107 (94),129-150 (142-143)`: Bing pair check; `effectiveStages` reads `ctx.stageIds` for `'bing'`/`'edge'`.
  - Becomes: `stageIds` is no longer needed. Bing gets its own (static or language) check.
- Also: `config.ts:21` (`LocalTtsConfig.edgeVoice`), `:116-123`, `:138-141` (`edgeVoice: voice.edge`), `:190-191`; `speech.ts:85-93,110-113,147-164` (Edge sentence path); `translationSession.ts:24,41,144` (`BING_TRANSLATOR`, Bing timeout); `adapter.ts:138-158` (Bing error humaniser); `settings.ts:7-11,28` (`DirectionVoice.edge`); `voices.ts:14-18`; `LocalInferenceVoiceSummary.tsx:5,36`; `provider.ts:74-84` (doc).

Stores and plumbing that exist only because one provider runs a stage two ways:
- `src/stores/lineUpStore.ts:117-132`: `todayLocal()`, the `bing-translator`/`edge-tts` migration probe.
- `src/stores/providerStore.ts:46-47,110,258-267,455-457`: readiness keyed by `stageIds` ("the answer for Bing is not the answer for a local model").
- `src/lib/plan/read.ts:59-71`: `checkStageIdsOf`. Also `src/app/readiness.ts:109-119`.
- `src/lib/provider/types.ts:131-136` (`CheckContext.stageIds`), `:177-183` (`SharedSettings.lineUp`).
- `src/lib/plan/checks.ts:48` (`PlanCheckContext.lineUp`, "Edge or Bing, not the provider that runs it"), `:73,95,107`.
- All of these become removable once a Bing/Edge stage has its own provider.

Bing/Edge-only libraries (move with the new providers): `src/lib/bing-translator/*`, `src/lib/edge-tts/*`, `src/lib/local-inference/workers/bing-translation.worker.ts`.

## 2. Settings today and what a migration needs

**Bing** has no settings. "Bing has no options": `LineUpCategory.tsx:284`. It is told no prompt and no word list: `translationUnit.ts:120,126-127`.

**Edge** reads two fields of the local provider's settings:
- **Voice.** `settings.localInference.voices` → `{[src→tgt]: {edge?: ShortName, speaker?: number}}` (`settings.ts:8-11,32`).
  - Read through `directionVoice` (`voices.ts:10-19`), written through `withDirectionVoice` (`voices.ts:27-30`).
  - Edge and the local voices share one table.
  - The old `edgeTtsVoice` key was dropped with no migration (`settings.ts:28`).
- **Speed.** `settings.localInference.ttsSpeed`, applied through `localTts` (`config.ts:138-141`).
  - It is shown on the Edge card only because that card draws the local provider's SP StagePart (`LocalInferenceSettings.tsx:71-77`).
- **Storage format.** `settings.<settings.key>.<field>` (`providerStore.ts:122-123`). The local key is `localInference` (`provider.ts:45`).

Related keys:
- `settings.lineup` = `{version:2, stages}` (`lineUpStore.ts:34,85-87`).
  - `isStoredLineUp` rejects any line-up that names an id missing from CAPS (`lineUpStore.ts:82`). **Renaming `bing`/`edge` makes every stored line-up unreadable.** It would then be shown as today's values and never overwritten (`:192-197`).
- `settings.common.provider` is the transcription host (`:95-98`), never bing or edge.
- `settings.localInference.selections[dir].translation|tts` may hold an explicit `bing-translator`/`edge-tts` pick from before line-ups. Under a stored line-up these resolve as deleted models (`candidates.wasm.ts:12-15`).

What a migration needs:
- (a) Keep the option ids `bing` and `edge`, and ideally make them the provider ids. Then `settings.lineup`, history `services.stages` and analytics `stages` need no migration.
  - A single "Microsoft" provider with two units keeps `host ≠ id`, so `ProviderCaps.host` stays.
- (b) The Edge provider's `settings.legacyKeys: ['settings.localInference.voices', 'settings.localInference.ttsSpeed']`.
  - A whole-key legacy read is supported (`types.ts:309-322`, `providerStore.ts:137-139`). `migrate` copies `.edge` per direction and the speed while its own fields are unset.
  - Nothing is written back, so stored values must win once they exist.
- (c) Every writer moves to the Edge provider: `EdgeVoices.tsx:66-67`, `SettingsInitializer.tsx:78-80`.
- (d) The local whole session still needs `voices[dir].edge` and `ttsSpeed` for the unstored path (see risks).

Edge voices UI wiring:
- Target `'edge-voices'` (`categories.ts:64`) → `LineUpCategory` `TARGET_CARD` (`:65`) unfolds the speech card → `<EdgeVoices>` (`:335`), root id `edge-voices-section` (`EdgeVoices.tsx:79`).
- Entry points:
  - `openTtsSlot` (`openTtsSlot.ts:22-28`), called from `MainPanel.tsx:246` and `Subtitle/SubtitleTakeover.tsx:62`.
  - `openLocalVoices` (`openTtsSlot.ts:49-53`), called from `Settings/sections/SpeechOutputSection.tsx:63`.
- Voice list: `getEdgeTtsVoices` (`lib/edge-tts/voiceList.ts:42`).
- Preview: `EdgeVoices.play` (`:69-76`) → `previewEdgeVoice` (`lib/edge-tts/preview.ts:47`, a direct `EdgeTtsConnection`, reports `reportError('EdgeTTS', …)`) → `appVoicePreview.play`.
- The Speech-block voice name comes from the local `VoiceSummary` (`LocalInferenceVoiceSummary.tsx:36`). The local provider's `voicesInEngine: true` (`provider.ts:53`) routes the voice line to `openTtsSlot`.
- `LocalInferenceVoiceSection.tsx:53-79` still has an `edge-tts` branch, but `LocalVoices.tsx:149` passes empty Edge props.

## 3. Telemetry and history today

- **Run analytics.** `stagedAnalytics` adds `stages: shape.lineUp` (StageIds such as `{transcription:'local_inference', translation:'bing', speech:'edge'}`) to every event that has `provider` (`session/run.ts:63-75,171`; type `analytics.ts:15`).
  - `provider` is always the transcription provider (`run.ts:173`), except for an `api_error`/notice tagged with a `runStage`.
- **`api_error`.** `run.ts:763,790` use `providerOf(event.payload.runStage)` (`:719-721`) = `unitFor(plan, stage).provider.id`.
  - Today a Bing or Edge failure is filed as `provider:'local_inference'` in every case. In the whole session there is no `runStage`, so it falls back to `providerId`; in a split plan the unit's provider is local anyway.
  - Lease `api_error` uses `p.id` (`run.ts:390-393`).
- **`translation_session_start`** (`session/runner.ts:279-289`): `provider`, `asr_model`/`translation_model`/`tts_model` from `describePlan` (`plan/composite.ts:58-71`).
  - Bing → `translationModel:'bing-translator'` (`config.ts:222`, `translationUnit.ts:164`). Edge → `ttsModel:'edge-tts'`.
- **`lineup_changed`**: `from`/`to` are option ids (`lineUpStore.ts:354-356`). **`speech_mode_changed`**: `stages: stageIdsFor(...)` (`SpeechSection.tsx:45`).
- **History.** `services: {provider, stages, models}` (`history/capture/writer.ts:240`; type `history/types.ts:9-17`); `recordStages` (`history/services.ts:10-11`).
  - Export adds `stages` only when `severalHosts(info.stages)` (`export/exporter.ts:84-90`, using CAPS.host). Today local+Bing+Edge counts as one host.
- **If they become their own providers (ids kept):**
  - `stages` and models are unchanged.
  - `api_error.provider` becomes `bing`/`edge` only where the composite tags `runStage`. All three stages apart are tagged (`compositeStages.ts:332-400`; `compositeLeg.ts:74,256,268` tags speech only in three-unit plans). A two-unit text+speech plan (local TR_TL + edge) still files Edge errors under `local_inference`, so attribution is inconsistent.
  - `severalHosts` turns true for every local run with Bing or Edge, including old records re-exported from History (`RecordExportMenu.tsx:81`). Exported JSON gains a `stages` block.

## 4. Consumers of the three stage declarations

**ProviderCaps readers** (non-test):
- `stages`:
  - `catalog.ts:72` (`runsByItself`), `:82` (`optionFor`), `:156` (`hostDefaults`)
  - `lineup/choose.ts:38`
  - `LineUpCategory.tsx:184`
  - `AccountsCategory.tsx:183`
- `host`:
  - `catalog.ts:112-113` (`soleHost`), `:123` (`severalHosts`), `:155`
  - `plan/compose.ts:78-95` (one group per host)
  - `plan/checks.ts:28,30-31,147`
  - `lineup/choose.ts:41`
  - `lineup/localStages.ts:29-36`
  - `lineup/migrate.ts:27`
  - `plan/fromStores.ts:67`
  - `app/loadStores.ts:52`
  - `lineUpStore.ts:96,327`
  - `SetupWizard/lineUpOf.ts:10`
  - `LineUpCategory.tsx:286,386`
  - `oldRules.testing.ts:17-18`
- `joint` and `translatesOwn` (through `goesWith` and `carriedTogether`, `catalog.ts:90-102`):
  - `compose.ts:34,60,62,87`
  - `checks.ts:134`
  - `choose.ts:40,52`
  - `LineUpCategory.tsx:88,550,554`
  - `AccountsCategory.tsx:178`
- `voiceAlone`, `takesVoice`: `checks.ts:29-31` only (`voiceRefusal`).
- `account`: `SettingsPage/accountRows.ts:20` only (`'kizuna'`).
- `caps(id) !== undefined` as validity: `lineUpStore.ts:82,202`.

**`Provider.optionStages`** says which stage sets a provider's settings UI acts on (StagePart layout). It is **not** a statement of what the provider can do, so it cannot be derived from units.
- Readers: `LineUpCategory.tsx:297,332`; `providers/stageParts.tsx:82-89` (`cardOptions`); `provider/managed.ts:35,73`.
- Declared in 13 providers, e.g. `openai_translate` `[TR]` against CAPS `ALL`.

**`UnitDefinition.occupies`**:
- `plan/compose.ts:107` (the composer)
- `plan/wholeUnit.ts:51` (`runsAlone`), `:70` (`unitServing` → `wholePlan`)
- Implementations: `wholeUnit.ts:20-24`, `soniox/units.ts:36,65`, `soniox/ttsUnit.ts:163`, `localInference/{transcription,translation,speech}Unit.ts:69/133/64`, `lib/textModel/unit.ts:98`, `fake/{voice,translator,transcriber}.ts:88/44/74`. All ignore `s`.

**Consistency tests:**
- `src/lib/lineup/catalog.test.ts:8-18`: host is the id except bing/edge → local; CAPS ids = RELEASED plus bing and edge.
- `src/providers/optionStages.consistency.test.ts:27-46`: `optionStages` against the `<StagePart stages={X}>` in each Settings source.
- `src/providers/sessionSide.consistency.test.ts:82,214-380`: no store or reporter in `adapter.ts` and the voice/translation session files, plus everything they reach in the folder. Unit files are deliberately "settings side" (`:93-107`), so `translationUnit.ts`/`speechUnit.ts` store reads pass.
- **No test checks CAPS.stages against units.** It is checked only indirectly:
  - `compose.test.ts:154-163` (every CAPS triple against `oldRunOf`; with Bing/Edge as their own hosts the expected provider changes)
  - `localInference/provider.test.ts:137-167` (pins that the 4 local/Bing/Edge line-ups run on **one whole unit**)
  - `provider.test.ts:205-255`
- Tests that override `voiceAlone` by injecting a catalog: `choose.test.ts:22`, `choice.test.ts:21`, `checks.test.ts:115`, `LineUpCategory.test.tsx:69`, `lineUpStore.test.ts:58`, `soniox/voiceAlone*.test.ts`. A derived field needs another seam for these.

**Which fields can be derived from units:**
- `host`: equals `id` once Bing and Edge are providers.
- `stages`: the union of what units occupy, probed over the 7 non-empty subsets.
- `voiceAlone`: true when some unit occupies exactly `[speech]`. This matches every entry today.
- `translatesOwn`: a TR unit exists and every unit with TL also has TR (Soniox).
- `account`: follows `kind` (managed → kizuna, own-key → key, local → none).

**Fields that carry extra rules:**
- End-to-end `joint: ALL` and `takesVoice: false` (`catalog.ts:13-18`). Their whole unit also occupies TR_TL when `speech !== 'always'` (`wholeUnit.ts:22`), so derivation would say TR_TL and true. This is a billing policy ("not known to stop making … audio"), one flag.
- e2e-only fakes (`catalog.ts:50-58`).
- The fake's `joint: TR_TL` is derivable.

## 5. Direct reads of the whole-provider run fields (outside wholeUnit.ts)

- `src/lib/provider/managed.ts:59,79-89`: copies `speech`, `textInput`, `boundaries`, `turns`, `participantSpeech`, `faceToFace`, `build`, `describe`, `start` from the base. `:90`: `units` only if the twin passes them; otherwise the twin is whole "whatever the base declares" (`:44`).
- `src/providers/soniox/kizuna.ts:48`: `sonioxUnitsFor({ start: sonioxProvider.start, … })`.
- `src/lib/session/shape.ts:30`: `Speaking = Pick<AnyProvider,'speech'|'participantSpeech'>`; `legSpeaks` and `languageContext` (`:33-40,79-81`) read them. Called with a **provider** at:
  - `stores/providerStore.ts:205` (`speakers[p.id] ?? p` fallback)
  - `components/providers/ProviderOwnSettings.tsx:104`
  - `SetupWizard/steps/StepFinish.tsx:28`
  - `SetupWizard/steps/StepLanguagePair.tsx:73`
  - Other callers pass `UnitCapabilities`.
- `src/components/SetupWizard/providerPaths.ts:29-31` (`p.speech`), `:54,63,71,96` (`p.faceToFace`); also `StepFinish.tsx:27`, `StepLanguagePair.tsx:72`.
- `src/components/providers/LanguagePairSection.tsx:134`: `speech = provider.speech` default. Its only caller (`ProviderLanguages.tsx:85-88`) passes `speech`.
- `participantSpeech`: `ProviderOwnSettings.tsx:53,102`, `ProviderPicker.tsx:190`, `SettingsPage/EdgeVoices.tsx:58`, `SettingsPage/LocalVoices.tsx:57`.
- `textInput()`, `boundaries()`, `turns()`, `build()`, `describe()`, `start` on a provider: no other non-test readers. Runs go through units (`plan/composite.ts:44,64`).
- Test helper: `plan/testing.ts:18-28` (`stubProvider` is whole-unit only; making `units` required affects every test that uses it).

**Providers without `units`:**
- 7 own-key end-to-end providers: `gemini`, `volcengine_ast2`, `openai`, `openai_translate`, `openai_live`, `qwen_livetranslate`, `palabraai`.
- `kizunaai_qwen` (`managed(qwenLiveTranslateProvider)`, no `units` override): 8 end-to-end in total.
- 2 fakes: `fake` (`fake/provider.ts:64`), `fake_leased` (`fake/leased.ts:62`).
- Stubbed `start` that always rejects: text models `openai_text`/`gemini_text`/`openai_compatible` (`provider.ts:86/70/83`); fakes `fake_voice`/`fake_translator`/`fake_transcriber` (`:138/92/121`).
- `local_inference` lists `wholeUnit(self)` among its units (`provider.ts:81-84`), so its whole fields back a unit.

## 6. Store reads in `src/providers/**`, `src/lib/plan/**`, `src/lib/contract/**` (non-test)

**UI components (acceptable):**
- `localInference/LocalInferenceSettings.tsx:2-3,55-62`
- `localInference/LocalInferenceEngineSummary.tsx:4,9,30-43`
- `localInference/LocalInferenceVoiceSummary.tsx:3,10,25-29`
- `localInference/LocalInferenceTurnDetection.tsx:4-7,58-68`
- `soniox/SonioxSettings.tsx:16,46`
- `qwen_livetranslate/QwenSettings.tsx:25`

**App actions living under providers (grey area):**
- `soniox/regionChange.ts:12-13,28,50` (also imports `app/currentAuth`, `app/runPhase`)
- `soniox/voiceFieldReconcile.ts:12,34,73`
- `soniox/voiceLeaseMemory.ts:10,29-30` (`ServiceFactory` settings; used by the `acquire` hook)

**Unit, check, build and admit code (should not read stores):**
- `localInference/translationUnit.ts:18,116` (build fallback), `:143` (`capabilities().translates`)
- `localInference/speechUnit.ts:15,74` (`capabilities().speaks`), `:78` (build fallback)
- `localInference/config.ts:5,7,122` (`localStagesFor` → `storedLocalStages`), `:131,134` (`resolveLocal` → `useModelStore.resolve`; used by the whole/transcription/translation/speech builds), `:265` (`fitsBudget` → `deviceFeatures`; used by every `admit` at `provider.ts:89-94`)
- `localInference/transcriptionUnit.ts:19,44,114`: indirect, through `config.ts`.
- `localInference/check.ts:1,3,48,57,140,154,165`
- `lib/plan/fromStores.ts:17-18,87-88,104`: by design the one bridge from stores to plan. The rest of `lib/plan` is pure; `lib/contract`: none.
- Also: `lib/history/capture/facts.ts:7` imports `translatesSpeechDirectly` from `providers/localInference/config.ts`, which pulls store modules into `lib/history`.
- Note: `capabilities(s)` gets only settings, so `speaks` and `translates` cannot avoid the store until Bing/Edge are separate units, or capabilities gain the line-up. The lineUpStore ↔ registry cycle workaround (`plan/present.ts:1-8`, `registry.ts:57-59`) exists only because local units import `lineUpStore`.

## 7. Type-level import cycles

- `src/lib/provider/types.ts:11` `import type { UnitDefinition } from '../plan/types'` (used at `:493` `units?`) ↔ `src/lib/plan/types.ts:11` `import type { AnyProvider, ProviderRefusal, SharedSettings } from '../provider/types'` (used at `:50` build, `:75` `PlannedUnit.provider`).
- `provider/types.ts:12` `import type { SessionHooks } from '../session/types'` (used at `:496`) ↔ `src/lib/session/types.ts:9` `import type { AuthContext, LanguagePair, ProviderRefusal, SharedSettings } from '../provider/types'` (used in `RunShape` `:62,79-80` and `admit` `:156`).
- `session/types.ts:8` `import type { RunPlan } from '../plan/types'` (`RunShape.plan` `:50`) closes a three-way cycle: provider → plan → provider → session → plan.
- `provider/types.ts:10` also imports `StageIds`. It is used only by the Bing/Edge-motivated `CheckContext.stageIds` and `SharedSettings.lineUp`.
- `src/lib/lineup/choose.ts:15-17` value-imports `compose` and `isRefusal` from plan. `src/lib/plan/choice.ts:8` value-imports `choose` from `lineup/choose`. `plan/compose.ts:5` and `plan/checks.ts:12` value-import `lineup/catalog`.
  - There is no module-level cycle: the chain is choice → choose → compose → catalog.
  - It is a folder-level cycle, `lib/lineup` ↔ `lib/plan`.

## Hidden one-host dependencies (refactor risks)

These places rely on "Bing and Edge are on the local host":
- **Composition:** `compose` groups by host (`compose.ts:92-96`). Today local/Bing/Edge (and local+edge, local+bing) run as **one whole local session** (pinned by `provider.test.ts:137-167`). As separate hosts they become 2-3 unit composite plans: different timing, sentence cutting and frames.
  - The language offer also changes: `planLanguages` filters by `translates` once translation is "apart" (`session/shape.ts:117-131`).
- **`soleHost`:**
  - Wizard rerun, `SetupWizard.tsx:58`: the default free line-up becomes "not-offered".
  - Version-1 line-up acceptance, `lineUpStore.ts:188`: a v1 local line-up gets re-migrated.
- **`severalHosts`:** exports (section 3).
- **`voiceRefusal` early return:** `checks.ts:28`.
- **Unstored line-up path:** `wholePlan(local)` with Bing/Edge chosen automatically as cloud models (`resolveWithStages.ts:16-17`). This runs until the local migration writes, and forever if the model scan fails (`lineUpStore.ts:211-228`). So Bing/Edge cannot be removed from the local engine without changing behaviour.

---

## Summary

1. **Ten-line findings.** (The report file could not be written because this session is read-only; the full report is above.)
   1. Behaviour risk: today the line-up local + Bing + Edge (and local+Edge, local+Bing) runs as **one whole local session**. `localInference/provider.test.ts:137-167` pins this. As separate providers, `compose` splits them into 2-3 composite units, which changes timing, frames and the language offer (`session/shape.ts:117-131`).
   2. "Same host" is load-bearing outside the composer:
      - `soleHost`: the wizard rerun in `SetupWizard.tsx:58` and the version-1 line-up check in `lineUpStore.ts:188`.
      - `severalHosts`: old History exports would gain a `stages` block.
      - `voiceRefusal`'s early return.
   3. With no line-up stored, the local whole session still picks Bing/Edge automatically as manifest "cloud models", so Bing/Edge can't leave the local engine fully without changing behaviour.
   4. Keep `bing` and `edge` as the ids. `isStoredLineUp` (`lineUpStore.ts:82`) rejects stored line-ups that name an unknown id, and history and analytics `stages` already store these ids. One "Microsoft" provider would keep `host ≠ id`, so `ProviderCaps.host` would have to stay.
   5. Edge has real settings: per-direction `voices[dir].edge` and the shared `ttsSpeed`, both under `settings.localInference.*`. The `legacyKeys` whole-key read plus `migrate` can carry them over, but `EdgeVoices` and `SettingsInitializer` must move with them. Otherwise the automatic Edge voice pick stops silently, because it is gated on the speech provider being `local_inference`. Bing has no settings.
   6. `optionStages` is not "what the provider can do". It declares the settings-UI layout (`openai_translate` is `[TR]` while CAPS says all stages), so it cannot be derived from units.
   7. From units you can derive `host`, `stages`, `voiceAlone`, `translatesOwn` and `account`. End-to-end `joint: ALL` and `takesVoice: false` are a billing rule: units alone would say TR_TL and true. No test checks CAPS against units today.
   8. Error attribution: `api_error` files Bing/Edge failures as `local_inference` today. After the split it becomes `bing`/`edge` only in three-unit plans; a local + Edge two-unit plan's speech events carry no `runStage`, so they still go to `local_inference`.
   9. Store reads that should go: the store read in `capabilities().translates/speaks` (`translationUnit.ts:143`, `speechUnit.ts:74`) can't be removed without giving capabilities the line-up, or making Bing/Edge separate units. A also makes `CheckContext.stageIds`, `SharedSettings.lineUp`, the `stageIds` readiness keying and the `present.ts` cycle workaround removable.
   10. Units-required scope:
       - 8 end-to-end providers (7 own-key plus `kizunaai_qwen` via `managed()`, which drops the base's units unless overridden) and 2 fakes have no `units`.
       - Direct whole-field readers remain in `managed.ts`, the wizard's `providerPaths`/Step components, `providerStore.ts:205` and `ProviderOwnSettings`.
       - `plan/testing.ts`'s whole-unit `stubProvider` underpins many tests.