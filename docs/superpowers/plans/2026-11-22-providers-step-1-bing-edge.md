# Provider refactor, step 1: Bing and Edge as providers of their own — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bing (translation) and Edge (speech) become two providers, `bing` and `edge`, outside `local_inference`. The local provider then deals with this machine's models only.

**Architecture:** Today `bing` and `edge` are catalog options whose host is `local_inference`. The local units decide by the line-up id whether a stage is Bing or a local model, and the line-up local + Bing + Edge runs as one whole local session. After this step each is a provider with one unit, and `host === id` for every option. The engine-backed session code (translation and speech over `TranslationEngine` / `TtsEngine`) moves to `src/lib/local-inference/sessions/` so that `local_inference`, `bing` and `edge` all use it without importing each other. Local + Bing + Edge then runs as three units through the composite path that Soniox + Bing + Edge already uses.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron).

**Spec:** this document. Decisions are by the owner, 2026-11-22, task #131:
- two providers, ids `bing` and `edge` kept;
- local + Bing + Edge may run as a three-unit composite (sentence cutting and timing follow the composite rules);
- four PRs, this is the first.

The code inventory with file:line references is `docs/superpowers/plans/2026-11-22-providers-step-1-inventory.md`. Read its "Hidden one-host dependencies" section before Task 4.

## Global Constraints

- The ids stay `bing` and `edge`:
  - in the catalog, the registry, stored line-ups (`settings.lineup`), history `services.stages`, and analytics `stages`;
  - no migration of any of these.
- The only stored-data change is Edge's settings. They are read from `settings.localInference.voices` (each direction's `.edge`) and `settings.localInference.ttsSpeed` until Edge stores its own. Nothing is written back to the local keys.
- No user-visible change except those listed in "Accepted changes" below.
- No new strings. Bing's and Edge's names and lines are the existing `providers.bing.*` / `providers.edge.*` keys.
- Platforms for `bing` and `edge`: `['electron', 'extension', 'web']`, the same as `local_inference`.
- New `ProviderKind` value `'online'`: a free online service, with no key, no sign-in and nothing downloaded.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage explicit paths. Never run vite or Electron in the main checkout.
- Test commands:
  - `npx vitest run <paths>` for the files a task touches;
  - `npx vitest run` before each commit that touches shared code;
  - `npm run e2e:build && npm run e2e` at the end.

### Accepted changes (tell the owner; do not hide)

1. Local + Bing + Edge (and local + Bing, local + Edge) run as composite plans of two or three units. Before, they ran as one local session.
2. `api_error` for a Bing or Edge failure carries `provider: 'bing'` / `'edge'`, no longer `'local_inference'`.
3. A history export of such a session gains the `stages` block, because `severalHosts` is now true for it.
4. On local + Bing, the language offer narrows to the pairs Bing translates, and a pair Bing does not translate is refused instead of silently running on a local model (as on Soniox + Bing). Confirmed by the owner, 2026-11-22.
5. In every two-unit text + speech plan, a speech error is filed under the speech unit's provider, not only for Edge. For example, Soniox with a local voice reports `local_inference`.
6. The plain-text history export's `Provider:` line names each stage for such a session (`transcription=…, translation=…, speech=…`).
7. A session run before a line-up is stored records the line-up that ran (`bing` / `edge` in history `services.stages` and analytics `stages`), not `local_inference` on every stage.
8. Edge speaks Norwegian (`no`) with a Bokmål voice and offers Bokmål voices on its card. Before, local + Bing + Edge read Norwegian with Edge's default multilingual voice, and Soniox + Edge refused a Norwegian target.

## Review Focus

1. A user who picked an Edge voice per direction before the upgrade hears the same voice after it. Pinned in Task 3: `migrates each direction's Edge voice and the speed from the local settings`.
2. A user who changes a local voice before Edge's entry ever loads must not lose the Edge voices stored beside it. Pinned in Task 5: `a local voice change keeps the Edge voice stored in the same direction`.
3. A user with no stored line-up (the model scan failed or is still pending on the first start) still runs Bing and Edge as before. Pinned in Task 6: `an unstored local line-up runs the line-up the settings show`.
4. A two-way session reading both directions with Edge uses each direction's voice. Pinned in Task 3: `builds each leg with its own direction's voice`.
5. The extension build still offers Bing; its worker needs the extension's header rules. Pinned in Task 2 (`bing and edge are present on electron, extension and web`). Manual check noted in Task 9.

---

### Task 1: Engine-backed sessions move to `src/lib/local-inference/sessions/`

No behaviour change. Moves only, and imports updated.

**Files:**
- Move: `src/providers/localInference/translationSession.ts` → `src/lib/local-inference/sessions/translationSession.ts`
- Move: `src/providers/localInference/speechSession.ts` → `src/lib/local-inference/sessions/speechSession.ts`
- Move: `src/providers/localInference/speech.ts` → `src/lib/local-inference/sessions/speech.ts`
- Move the helpers these import from `src/providers/localInference/adapter.ts` to `src/lib/local-inference/sessions/errors.ts`: `humanizeTranslationError`, `isGpuOutOfMemory`, `isDeviceLost`, `GPU_OUT_OF_MEMORY`, and the Bing error humaniser (`adapter.ts:138-158`).
- Move the `TranslationLike` / `TtsLike` engine types from `src/providers/localInference/engines.ts` to `src/lib/local-inference/sessions/engines.ts`. The local `engines.ts` keeps `defaultEngines` and re-imports the types.
- Move each file's `*.test.ts` alongside it.
- Modify: `src/providers/sessionSide.consistency.test.ts`. Its "no store, no reporter" scan also covers `src/lib/local-inference/sessions/**`.

**Interfaces:**
- Produces:
  - `startLocalTranslation(makeEngine, request, events)`, `localTranslationRefusal(modelId, source, target)`, `BING_TRANSLATOR`, `LOCAL_MODEL_JOB_TIMEOUT_MS`, `LocalTranslationConfig` from `src/lib/local-inference/sessions/translationSession`;
  - `startLocalSpeech(makeTts, request, events)`, `isOff`, `LocalSpeechConfig`, `LocalSpeechOff` from `.../sessions/speechSession`.
  - Names are unchanged.

- [ ] **Step 1:** `git mv` the files and their tests. Update every import (`grep -rn "localInference/(translationSession|speechSession|speech|engines)'" src`).
- [ ] **Step 2:** Extend the consistency scan's list of session files. Run `npx vitest run src/providers/sessionSide.consistency.test.ts src/lib/local-inference src/providers/localInference`. Expected: PASS.
- [ ] **Step 3:** `npx vitest run`. Expected: no new failures compared with the base.
- [ ] **Step 4:** Commit `refactor(local): engine-backed translation and speech sessions live in lib, for any provider`.

### Task 2: The `online` kind and the Bing provider

**Files:**
- Modify: `src/lib/provider/types.ts`. `ProviderKind = 'own-key' | 'managed' | 'local' | 'online'`, with a doc line.
- Create: `src/providers/bing/languages.ts`. The Bing language logic moves here from `src/providers/localInference/translationUnit.ts` (`sameForBing`, the Bing branch of `localTranslates`, the Bing branch of `localTranslationLanguages`).
- Create: `src/providers/bing/unit.ts`, `src/providers/bing/provider.ts`, `src/providers/bing/unit.test.ts`, `src/providers/bing/provider.test.ts`
- Modify: `src/providers/registry.ts`. `bingProvider` goes into `RELEASED` right after `localInferenceProvider`.

**Interfaces:**
- Consumes: Task 1's `startLocalTranslation`, `localTranslationRefusal`, `BING_TRANSLATOR`; `JOB_TIMEOUT_MS` from `src/lib/translation/jobTranslator`.
- Produces:
  - `bingTranslates(source: string, target: string): boolean` and `bingLanguages(): string[]` (app codes), from `src/providers/bing/languages.ts`;
  - `bingTranslationUnit: UnitDefinition<BingSettings, BingCredentials, LocalTranslationConfig>` with `id: 'translation'`;
  - `bingProvider: Provider<BingSettings, BingCredentials, LocalTranslationConfig> & { id: 'bing' }`;
  - `type BingSettings = Record<string, never>`, `type BingCredentials = Record<string, never>`.

Provider fields:
- `kind: 'online'`, `icon: BingIcon`, platforms as in Global Constraints, `settings: { key: 'bing', defaults: {} }`, `Settings: () => null`.
- No `optionStages`, since Bing has no options.
- `credentials: { keys: [], fields: () => [], read: () => ({}) }`, `check: async () => ({ ok: true })`.
- `languages`: sources `bingLanguages()`, targets `bingLanguages()` filtered by `bingTranslates(source, ·)`, `wire: identityWire`.
- The whole-provider fields that step 3 removes, written as the text models write them: `speech: 'never'`, and a `start` that rejects with `plan_unsupported`.
- Unit:
  - `occupies` TL only;
  - capabilities as the local translation unit's today: `speech: 'never'`, `boundaries: 'provider'`, `faceToFace: false`, `participantSpeech: true`, `translates: bingTranslates`;
  - `build` returns `{ refused }` from `localTranslationRefusal(BING_TRANSLATOR, source, target)` when it refuses, else `{ modelId: BING_TRANSLATOR, instructions: '', wrapTranscript: false }`;
  - `describe` → `{ translationModel: 'bing-translator' }`;
  - `startTranslation` → `startLocalTranslation(() => new TranslationEngine(), request, events)`, which keeps today's 20 s Bing job timeout.

- [ ] **Step 1: Write the failing tests**

```ts
// unit.test.ts
it('occupies translation alone', () => {
  expect(bingTranslationUnit.occupies({}, new Set(['translation']))).toEqual(['translation']);
  expect(bingTranslationUnit.occupies({}, new Set(['transcription', 'translation']))).toBeNull();
});
it('translates the pairs Bing supports, never from an automatic source', () => {
  const c = bingTranslationUnit.capabilities({});
  expect(c.translates!('en', 'ja')).toBe(true);
  expect(c.translates!('auto', 'ja')).toBe(false);
  expect(c.translates!('en', 'en')).toBe(false);
});
it('builds the Bing config, and refuses an automatic source', () => {
  expect(build({ source: 'en', target: 'ja' })).toEqual({ modelId: 'bing-translator', instructions: '', wrapTranscript: false });
  expect(build({ source: 'auto', target: 'ja' })).toMatchObject({ refused: expect.stringContaining('fixed source language') });
});
// provider.test.ts
it('bing and edge are present on electron, extension and web', () => {
  for (const platform of ['electron', 'extension', 'web'] as const) expect(presentProviders({ ...env, platform }).map((p) => p.id)).toEqual(expect.arrayContaining(['bing']));
});
it('needs nothing to be ready', async () => { expect(await bingProvider.check({}, {}, ctx)).toEqual({ ok: true }); });
```

(Task 3 extends the presence test with `'edge'`.)

- [ ] **Step 2:** Run `npx vitest run src/providers/bing`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the files above. `localTranslates('bing', …)` in the local unit now calls `bingTranslates`. Task 5 removes the local Bing branch.
- [ ] **Step 4:** Run `npx vitest run src/providers/bing src/providers/registry.test.ts`. Expected: PASS. Update `registry.test.ts` expectations for the new id.
- [ ] **Step 5:** Commit `feat(bing): Bing is a provider of its own, with one translation unit`.

### Task 3: The Edge provider

**Files:**
- Create:
  - `src/providers/edge/settings.ts`, `src/providers/edge/unit.ts`, `src/providers/edge/provider.ts`;
  - `src/providers/edge/EdgeSettings.tsx`, moved from `src/components/SettingsPage/EdgeVoices.tsx`;
  - `src/providers/edge/EdgeVoiceSummary.tsx`;
  - tests beside each.
- Modify: `src/providers/registry.ts`: `edgeProvider` right after `bingProvider`.
- Keep `src/components/SettingsPage/EdgeVoices.tsx` and its use in `LineUpCategory` until Task 7. Until Task 4, Edge's card is still the local provider's. Edge's settings keep deriving from the local table while Edge stores nothing of its own, so edits made there still reach Edge. Task 7 retargets `SettingsInitializer` and `openTtsSlot` and deletes `EdgeVoices.tsx`.

**Interfaces:**
- Consumes: Task 1's `startLocalSpeech`, `isOff`, `LocalSpeechConfig`; `EDGE_TTS_LANGUAGES`; `getEdgeTtsVoices`, `filterVoicesByLanguage`; `directionKey`.
- Produces:
  - `interface EdgeSettings { voices: Record<string, string>; speed: number }`, where a key is `directionKey(src, tgt)` and a value is an Edge `ShortName`, with `EDGE_DEFAULTS = { voices: {}, speed: 1.0 }`;
  - `migrateEdgeSettings(stored, inputs): EdgeSettings`;
  - `edgeSpeaks(language: string): boolean`;
  - `edgeSpeechUnit: UnitDefinition<EdgeSettings, Record<string, never>, LocalSpeechConfig>` with `id: 'speech'`;
  - `edgeProvider` with `id: 'edge'`, `kind: 'online'`, `optionStages: [SP]`, `Settings: EdgeSettings`, `VoiceSummary: EdgeVoiceSummary`.

Settings migration:
- `settings.legacyKeys: ['voices', 'speed', 'settings.localInference.voices', 'settings.localInference.ttsSpeed']`.
- `migrate` uses Edge's own `voices` / `speed` when they are stored (present in `inputs.legacy` under `voices` / `speed`).
- Otherwise it takes each direction's `.edge` string from the local table, and the local `ttsSpeed`.
- Values that are not strings or finite numbers are dropped.

Unit:
- `occupies` SP only.
- Capabilities: `speech: 'optional'`, `boundaries: 'silence'`, `faceToFace: true`, `participantSpeech: true`, `speaks: edgeSpeaks`. These match today's local speech unit; `edgeSpeaks` is the base-language match against `EDGE_TTS_LANGUAGES` (`localSpeaks`'s Edge branch).
- `build`:
  - `{ off: true }` when `!context.speech`;
  - else `{ modelId: 'edge-tts', speakerId: 0, speed: s.speed, edgeVoice: s.voices[directionKey(source, target)] }`, with `edgeVoice` omitted when unset (today's behaviour).
- `describe` → `{ ttsModel: 'edge-tts' }`.
- `startSpeech` → `startLocalSpeech(() => new TtsEngine(), …)`.

Settings UI:
- `EdgeSettings` is today's `EdgeVoices` card reading and writing Edge's entry (`useProviderStore.entries.edge`).
- It adds the speed control the Edge card showed through the local speech part. Reuse the local SP part's speed control component; find it in `LocalInferenceSettings.tsx:71-77`.
- It is wrapped in `<StagePart stages={SP}>`, to satisfy `optionStages.consistency.test.ts`, with root id `edge-voices-section`.


- [ ] **Step 1: Write the failing tests**

```ts
it("migrates each direction's Edge voice and the speed from the local settings", () => {
  expect(migrateEdgeSettings({}, { legacy: { 'settings.localInference.voices': { 'en→ja': { edge: 'ja-JP-NanamiNeural', speaker: 3 }, 'ja→en': { speaker: 1 } }, 'settings.localInference.ttsSpeed': 1.2 }, credentials: {} }))
    .toEqual({ voices: { 'en→ja': 'ja-JP-NanamiNeural' }, speed: 1.2 });
});
it("keeps Edge's own stored values over the local ones", () => {
  expect(migrateEdgeSettings({}, { legacy: { voices: { 'en→ja': 'ja-JP-KeitaNeural' }, speed: 0.9, 'settings.localInference.voices': { 'en→ja': { edge: 'ja-JP-NanamiNeural' } }, 'settings.localInference.ttsSpeed': 1.2 }, credentials: {} }))
    .toEqual({ voices: { 'en→ja': 'ja-JP-KeitaNeural' }, speed: 0.9 });
});
it("builds each leg with its own direction's voice", () => {
  const s = { voices: { [directionKey('en', 'ja')]: 'ja-JP-NanamiNeural', [directionKey('ja', 'en')]: 'en-US-JennyNeural' }, speed: 1 };
  expect(build(s, { source: 'en', target: 'ja' })).toMatchObject({ modelId: 'edge-tts', edgeVoice: 'ja-JP-NanamiNeural' });
  expect(build(s, { source: 'ja', target: 'en' })).toMatchObject({ edgeVoice: 'en-US-JennyNeural' });
  expect(build(s, { source: 'en', target: 'ja' }, { speech: false })).toEqual({ off: true });
});
it('speaks the languages Edge has voices for', () => { expect(edgeSpeaks('ja')).toBe(true); expect(edgeSpeaks('xx')).toBe(false); });
// EdgeSettings.test.tsx: EdgeVoices' tests, adapted: the card reads and writes `entries.edge`, and shows the speed.
```

- [ ] **Step 2:** Run `npx vitest run src/providers/edge`. Expected: FAIL.
- [ ] **Step 3:** Implement the files. `EdgeSettings` starts as a copy of `EdgeVoices` retargeted to Edge's entry, plus the speed.
- [ ] **Step 4:** Run `npx vitest run src/providers/edge src/providers/registry.test.ts src/providers/optionStages.consistency.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(edge): Edge is a provider of its own: its voices and speed, migrated from the local settings`.

### Task 4: Every option is its own host

**Files:**
- Modify:
  - `src/lib/lineup/catalog.ts` and its test;
  - `src/stores/lineUpStore.ts:188`;
  - `src/components/SetupWizard/SetupWizard.tsx:58`;
  - `src/lib/plan/compose.test.ts`;
  - `src/providers/localInference/provider.test.ts:137-167`;
  - `src/lib/plan/checks.test.ts` as needed.

**Interfaces:**
- Produces:
  - CAPS `{ id: 'bing', stages: ['translation'], host: 'bing', … }` and `{ id: 'edge', stages: ['speech'], host: 'edge', … }`, other fields unchanged;
  - `belongsTo(stages: Pick<LineUp, RunStage>, provider: string): boolean` in `catalog.ts`: true when every stage's host is one of the hosts of `hostDefaults(provider)`. For `local_inference` that is `{local_inference, bing, edge}`; for another provider it is the provider alone.

Rules:
- `lineUpStore` v1 acceptance (`:188`) uses `belongsTo(value.stages, provider)` in place of `soleHost(value.stages) === provider`.
- The wizard (`SetupWizard.tsx:58`) uses the transcription stage's host when `belongsTo(lineUp, thatHost)`, else null, in place of `soleHost(lineUp)`.
- `hostDefaults('local_inference')` still returns local + Bing + Edge.

- [ ] **Step 1: Write the failing tests**

```ts
it('every option is its own host', () => { for (const c of CAPS) expect([c.id, c.host]).toEqual([c.id, c.id]); });
it('the free line-up belongs to this device', () => {
  expect(belongsTo({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, 'local_inference')).toBe(true);
  expect(belongsTo({ transcription: 'soniox', translation: 'bing', speech: 'edge' }, 'local_inference')).toBe(false);
  expect(belongsTo({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' }, 'soniox')).toBe(true);
});
it('composes this device, Bing and Edge as three units', () => {
  const plan = compose({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, input);
  expect(plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['local_inference', 'transcription'], ['bing', 'translation'], ['edge', 'speech']]);
});
it('a version 1 free line-up is kept as stored', async () => { /* lineUpStore.test: v1 {local, bing, edge} with provider local_inference → stored, not re-migrated */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Change CAPS, add `belongsTo`, switch the two callers. Update `provider.test.ts:137-167`: local + Bing + Edge is now three units; local + local + Edge is the local whole unit for transcription and translation beside Edge. Update `compose.test.ts`'s CAPS-triple expectations.
- [ ] **Step 4:** Run `npx vitest run src/lib src/stores src/providers src/components/SetupWizard`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(lineup): Bing and Edge are hosts of their own`.

### Task 5: The local provider runs this machine's models only

**Files:**
- Modify:
  - `src/lib/lineup/localStages.ts`: `LocalStages { translation: 'local' | null; speech: 'local' | null; transcription?: 'local' | null }`; `localStagesOf` reads `lineUp[stage] === 'local_inference'`;
  - `src/lib/local-inference/selection/resolveWithStages.ts`: the Bing/Edge forcing (`:16-23`) is removed;
  - `src/providers/localInference/translationUnit.ts`: Bing branches, `LocalTranslationOption` and the `storedLocalStages` imports removed; `translates` is the local models only; `build` reads stages from `shared.lineUp` and treats a missing one as `{ translation: 'local', speech: null }`;
  - `src/providers/localInference/speechUnit.ts`: likewise, local voices only;
  - `src/providers/localInference/check.ts`: the Bing pair check removed; stages read from `ctx.stages`;
  - `src/providers/localInference/config.ts`: `LocalTtsConfig.edgeVoice` and `localStagesFor`'s store fallback removed;
  - `src/providers/localInference/settings.ts`, `voices.ts`: `DirectionVoice.edge` removed from the type; `withDirectionVoice` keeps the stored entry's other fields;
  - `src/providers/localInference/LocalInferenceVoiceSummary.tsx`, `LocalInferenceVoiceSection.tsx`: Edge branches removed;
  - `src/lib/provider/types.ts`: `CheckContext.stageIds` removed;
  - `src/stores/providerStore.ts`: `stageIds` removed from the store and from `setStages`; readiness is keyed by the stages a provider serves alone (`:453-456`), which still re-checks the local provider when it serves other stages;
  - `src/lib/plan/read.ts`: `checkStageIdsOf` removed;
  - `src/app/readiness.ts:109-119`;
  - `src/components/Settings/engine/useWasmEngineAdapter.ts:41,47`: `withCloud: false` always.
- Test: the files' existing tests, updated.

**Interfaces:**
- Consumes: Task 2's `bingTranslates` (the local unit no longer calls it).
- Produces: `localTranslates(source, target): boolean`, without the option argument; `localSpeaks(language): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it('a local voice change keeps the Edge voice stored in the same direction', () => {
  const table = { 'en→ja': { edge: 'ja-JP-NanamiNeural', speaker: 1 } } as never;
  expect(withDirectionVoice(table, 'en→ja', { speaker: 4 }).voices['en→ja']).toEqual({ edge: 'ja-JP-NanamiNeural', speaker: 4 });
});
it('the local translation unit translates with local models only', () => { /* a pair only Bing supports → false */ });
it('the local units read no line-up from the store', () => { /* translationUnit.ts, speechUnit.ts, config.ts import nothing from src/stores/lineUpStore (the model store reads stay until step 4) */ });
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Make the changes listed under Files. The model store's `resolve(src, tgt, selections, null)` keeps cloud candidates: the line-up migration's `todayLocal()` (`lineUpStore.ts:117-132`) still asks whether today's choice is Bing or Edge.
- [ ] **Step 4:** Run `npx vitest run`. Expected: no new failures.
- [ ] **Step 5:** Commit `refactor(local): this device's provider runs only this device's models`.

### Task 6: A session with no stored line-up runs the line-up the settings show

**Files:**
- Modify: `src/lib/plan/fromStores.ts` and `src/lib/plan/fromStores.test.ts`

Rule: when no line-up is stored and `unstoredProvider === 'local_inference'`, `planFromStores` composes the line-up the store shows (`useLineUpStore.getState().lineUp`, which is `hostDefaults('local_inference')` until the migration writes). It no longer uses `wholePlan(local)`. Other unstored providers keep `wholePlan`.

- [ ] **Step 1: Write the failing test** `an unstored local line-up runs the line-up the settings show`. Set the store to `{ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: false, unstoredProvider: 'local_inference' }` and expect three units: `local_inference`, `bing`, `edge`.
- [ ] **Step 2:** Run it. Expected: FAIL (one whole unit).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/lib/plan src/stores src/app`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(plan): with no stored line-up, this device runs the line-up the settings show`.

### Task 7: The settings pages list Bing and Edge as providers

**Files:**
- Modify:
  - `src/components/SettingsPage/LineUpCategory.tsx`;
  - `src/components/SettingsPage/AccountsCategory.tsx`;
  - `src/components/providers/ProviderOption.tsx`;
  - `src/lib/view/noticeText.ts:25`;
  - `src/components/SettingsInitializer/SettingsInitializer.tsx`;
  - `src/components/providers/openTtsSlot.ts`;
  - their tests.
- Delete: `src/components/SettingsPage/EdgeVoices.tsx`.

Rules:
- `LineUpCategory`:
  - remove the `offered` additions (`:163-167`), the option splicing (`:183`), the Bing/Edge cases of `ownerOf` (`:286-290`), the `<EdgeVoices>` special render (`:335`; Edge's own `Settings` shows through the generic owner path) and the host mapping (`:386`);
  - remove `stateOf`'s Bing/Edge line (`:388`): an `online` provider's state comes from its readiness, and its check always says ready.
- `AccountsCategory`: the hard-coded Bing and Edge rows become one row per present provider of kind `online`, in registry order after This device, with `kind: 'online'` and the same state line.
- `ProviderOption`: the `EXTRA` map is removed. For a provider of kind `online`, `useOptionModel` returns its `icon`, `name: t('providers.<id>.name')` and `description: t('providers.<id>.note')`, the line Bing and Edge show today.
- `noticeText`: `OPTION_NAMES` is removed; names come from `providers.<id>.name`.
- `SettingsInitializer`: when `unitFor(plan, 'speech').provider.id === 'edge'`, for each spoken direction (the speaker's, plus the participant's when the participant leg speaks), store the first voice of `filterVoicesByLanguage(voices, tgt)` if the direction has no voice for that language. Write through `updateSettings(edgeProvider, { voices })`. The local branch that resolved `edge-tts` is removed.
- `openTtsSlot`: navigates to `'edge-voices'` when the plan's speech provider is `edge`, in place of `lineUp.speech === 'edge'`.
- `EdgeVoices.tsx` is deleted. `categories.ts` keeps `'edge-voices'` → `{ category: 'lineup', anchor: 'edge-voices' }`, an anchor `EdgeSettings` renders.
- New tests:
  - `SettingsInitializer.test.tsx`: with a plan whose speech unit is Edge's and no voice stored, the first matching voice is stored under Edge.
  - `openTtsSlot.test.ts`: speech provider `edge` → `'edge-voices'`.

- [ ] **Step 1:** Run `npx vitest run src/components/SettingsPage src/components/providers src/lib/view` before changing code. Expected: PASS. These tests pin today's lists, rows, names and order, and the change must keep every one of them, so no expectation changes unless a test asserts the removed internals.
- [ ] **Step 2:** Make the changes. Run `npx vitest run src/components src/lib/view`. Expected: PASS.
- [ ] **Step 3:** Commit `refactor(settings): Bing and Edge are listed as the providers they are`.

### Task 8: Errors of a two-unit plan's speech carry the stage

**Files:**
- Modify: `src/lib/plan/compositeLeg.ts` (`:74,256,268`) and its test

Rule: in a two-unit text + speech plan, the speech unit's events (`api_error`, notices) carry `runStage: 'speech'`, as they do in a three-unit plan. `run.ts`'s `providerOf(runStage)` then files them under the speech unit's provider.

- [ ] **Step 1: Write the failing test** `a two-unit plan files a speech failure under the speech unit's provider`. Use a fake TR_TL unit beside a fake voice that fails, and expect `api_error.provider === 'fake_voice'`.
- [ ] **Step 2:** Run it. Expected: FAIL (`provider` is the text unit's).
- [ ] **Step 3:** Tag the events.
- [ ] **Step 4:** Run `npx vitest run src/lib/plan src/lib/session`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(plan): a two-unit plan's speech errors name the provider that speaks`.

### Task 9: Whole-suite verification and the before/after comparison

- [ ] **Step 1:** `npx vitest run`. Expected: only the four `src/lib/reading/ja` failures, which also fail on `main` with this machine's shared dependencies.
- [ ] **Step 2:** `npm run e2e:build && npm run e2e`. Expected: all pass.
- [ ] **Step 3: Real-session comparison, owner's condition.**
  - Write a throwaway `@real` spec; do not commit it.
  - It installs the smallest local recognition model into its own user-data directory, then plays the eight recorded sentences twice with the line-up local + Bing + Edge.
  - It records, per sentence: the source text, the translation, the time from the sentence's end to its translation, and whether it was spoken.
  - Run it on `main` and on this branch.
  - Also run Soniox + Bing + Edge (`E2E_SONIOX_KEY`) and all local models on this branch.
  - Put the table in `docs/superpowers/plans/2026-11-22-providers-step-1-comparison.md`. Report it to the owner before asking to open the PR.
- [ ] **Step 4: Migration check.**
  - Start the e2e app with seeded `settings.localInference.voices` (`{ 'en→ja': { edge: 'ja-JP-KeitaNeural' } }`) and `ttsSpeed: 1.3`, and the line-up local + Bing + Edge.
  - Open Languages and line-up. Edge's card must show Keita and speed 1.3.
- [ ] **Step 5:** Note that the extension build was not run.
- [ ] **Step 6:** Ask the owner before opening the PR (`refactor/bing-edge-providers` → `main`).
