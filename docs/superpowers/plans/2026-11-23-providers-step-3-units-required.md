# Provider refactor, step 3: every provider declares its units — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Provider.units` is required. The nine members that described a whole session leave `Provider`: `speech`, `textInput`, `boundaries`, `turns`, `participantSpeech`, `faceToFace`, `build`, `describe` and `start`. An end-to-end service declares them as its whole unit, and every reader asks the units.

**Architecture:**
- `wholeUnitOf(parts)` (`src/lib/plan/wholeUnit.ts`) is today's `wholeUnit(p)` made of named parts in place of a provider's members. It is the same view: each member reads its part when used.
- `capabilitiesAlone(p, stage)` answers what readers of "the provider as a whole" asked its members. It gives the capabilities of the unit that serves `stage` in `wholePlan(p)`, under the provider's default settings.
  - Task 1 proves it equal to the members for every provider before any reader moves.
- `managed()` carries the base's units. Kizuna Soniox reads its base's adapter (`sonioxAdapter`) instead of `sonioxProvider.start`.
- Tests that tweaked a whole provider tweak its whole unit. The fake's parts are exported (`FAKE_WHOLE`), `withWhole` rebuilds a provider's whole unit with replaced parts, and `stubProvider` builds a whole unit.
  - A spread (`{ ...fakeProvider, start }`) copies the old units, so the replaced `start` would never run.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron).

**Spec:** this document. The owner made these decisions on 2026-11-23, and they are binding. The code inventory is `docs/superpowers/plans/2026-11-22-providers-step-1-inventory.md` §5. Its line numbers predate steps 1-2, so find each place by name.
- `units` is required on every provider. The nine members above leave the `Provider` interface (`src/lib/provider/types.ts`).
- Each end-to-end provider declares its whole unit explicitly, in its own module (`units: [wholeUnitOf({...})]`). These are:
  - the seven own-key ones: `gemini`, `volcengine_ast2`, `openai`, `openai_translate`, `openai_live`, `qwen_livetranslate`, `palabraai`;
  - the E2E fakes `fake` and `fake_leased`.
- Kizuna AI's Qwen gets its base's whole unit "via `managed()`": the twin carries the base's units.
- `local_inference` keeps its whole unit among its units in the same way.
- The providers that only translate or only speak lose their rejecting `start` and the other dead members. These are:
  - the text models `openai_text`, `gemini_text`, `openai_compatible`;
  - `bing`, `edge`;
  - `fake_voice`, `fake_translator`, `fake_transcriber`.
- Every reader of those members reads the unit instead. This includes `managed.ts`, the setup wizard, `providerStore.ts`, `ProviderOwnSettings.tsx`, `LanguagePairSection.tsx` and `shape.ts` (`Speaking`). All of them are found, not just the ones named.
- `wholeUnit` and `unitsOf` simplify: there is no synthesized whole unit, and `unitsOf(p)` is `p.units`. `runsAlone`, `wholePlan` and the plan code still hold.
- Test helpers that build whole-unit-only providers keep working, with a units-based form.
- No behaviour changes for any user. No new strings, ids are unchanged, and stored data is untouched.
- Step 2's guard ("a provider that declares no units is end to end, except `fake`") becomes "every provider declares units".
- Step 2's derived catalog comes out identical. Its pins pass unchanged.

## Global Constraints

- No user-visible change. The internal differences are listed under "Accepted differences".
- No new locale strings.
- Ids are unchanged. Stored data is untouched: every provider's settings keys, `settings.lineup`, `settings.common.provider`, history `services`, and analytics `stages`.
- The catalog is identical.
  - `src/lib/lineup/capsOf.test.ts`'s pins `is the catalog declared by hand, entry for entry, for the released providers` and `and for the E2E build's fakes` pass with no edit.
  - `src/lib/lineup/catalog.testing.ts`'s data does not change. Only its header comment changes, in Task 4.
- What each provider says alone, and its plan alone, stay as they were. Task 1's pins (`registry.test.ts`) pass with no edit after Task 1, except the one marked "Removed in Task 4".
- Names, fixed here:
  - in `src/lib/plan/wholeUnit.ts`:
    - `WholeUnitParts<S = any, K = any, C = any>`;
    - `wholeUnitOf<S, K, C>(parts: WholeUnitParts<S, K, C>): UnitDefinition<S, K, C>`, whose unit id is `'whole'`;
    - `capabilitiesAlone(p: AnyProvider, stage: RunStage): UnitCapabilities`;
  - `FAKE_WHOLE` in `src/providers/fake/provider.ts`;
  - `withWhole(p, whole, over)` in `src/lib/plan/testing.ts`;
  - `sonioxAdapter` in `src/providers/soniox/provider.ts`.
- `wholeUnitOf` is a view of its parts, as `wholeUnit` was of the definition.
  - It reads no part when it is made, and each member reads its part when it is used.
  - It touches no module state (no registry, no cache). A fake's module must stay droppable from a release bundle (D24; see `fake/provider.ts`'s note on `createFakeAdapter`).
- A provider module writes `wholeUnitOf<S, K, C>(...)` with its definition's own type arguments. Its parts are then checked against its settings, credentials and config, since `Provider.units` erases them.
- Type checking: the base's `npx tsc --noEmit -p tsconfig.json` count is 89 (2e730b9cc, 2026-11-23). After each task, no touched file has an error, and the total is not above 89.
- Test commands:
  - Before Task 1, record the base's `npx vitest run` failures.
  - `npx vitest run <paths>` for the files a task touches.
  - `npx vitest run` before each commit.
  - `npm run e2e:build && npm run e2e` in Task 5, in this worktree only. Never run vite or Electron in the main checkout.
- Commits:
  - on branch `refactor/units-required`;
  - stage explicit paths;
  - end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The owner authorised (2026-11-22, task #131) opening the step 2-4 PRs directly, each stacked on the previous one. Task 5 pushes `refactor/units-required` to `kizuna-ai-lab/sokuji` and opens its PR into `refactor/stages-declared-once`.

### Accepted differences (internal; tell the owner; do not hide)

1. `ManagedOverrides.participantSpeech` goes. A twin's participant flag lives in its units. Kizuna Soniox already hands its flag to `sonioxUnitsFor`, its lease and its floor.
2. The providers that only translate or only speak lose the `start` that rejected with `plan_unsupported`.
   - Nothing called it once they declared units: a run starts units, and `wholeUnit` was built only for a provider without units.
   - `composite.ts` still refuses a plan it cannot start with `plan_unsupported`.
3. Kizuna AI's Qwen runs the same unit object as Qwen with an own key. Before, its whole unit was a separate view over the same members.
   - Nothing keys on unit identity across providers. `useFaceToFace` compares units within one plan, and the plan code keys configs by planned unit.

## Review Focus

1. **Kizuna AI's Qwen loses its whole unit.** If `managed()` dropped the base's units, Kizuna Qwen would have none, and its catalog entry, plan and sessions would go with them.
   - Pinned in Task 4: `runs its base's units when it gives none of its own, and its own when it does` (`managed.test.ts`).
   - Also pinned by the catalog pin on `kizunaai_qwen` and Task 1's `runs alone, and plans a run on itself alone, as it always did`.
2. **Kizuna Soniox's participant flag.** Once the definition carries no flag, the Settings view, the engine summary and the language offer must read the twin's own voice unit. Reading Soniox's would voice a participant the backend has no key for, once the flag is off.
   - Pinned in Task 1: `says alone whether it speaks, and lets its participant speak, as it always did`, which includes `createKizunaSonioxProvider({ participantSpeech: false })`.
   - Pinned in Task 4: `kizunaParticipantSpeech.test.tsx` reads the unit.
3. **The language offer of a provider no plan names.** The provider store asks a provider outside the plan whether it speaks: `speakers[p.id] ?? capabilitiesAlone(p, 'speech')`. Doubao AST 2.0 narrows its languages when it speaks, so a wrong answer moves a stored pair.
   - Pinned in Task 2: `providerStore.test.ts`'s `moody` declares its speaking in its unit only, and its existing cases must still pass.
4. **The wizard's fits.** Speech and face-to-face come from the units.
   - Edge's unit says face-to-face, but its definition said no. Edge never runs alone and is not managed, so the wizard never asks it. Any new reader of `capabilitiesAlone(p, 'transcription').faceToFace` outside the wizard must know this.
   - Pinned in Task 1: `of the providers the wizard offers, the two Soniox ones alone run face-to-face`.
   - Pinned in Task 2: `providerPaths.managedFit.test.ts` (a managed stand-in whose unit alone says it always speaks and runs face-to-face).
5. **A whole unit that is not a view.** If `wholeUnitOf` copied or read its parts when made, a spy on `FAKE_WHOLE` would no longer reach a run, and a fake module could stay in a release bundle.
   - Pinned in Task 1: `reads none of its parts when made: each is read when the unit is used`, and the kept case `a capability read calls only its own function`.
   - Pinned in Task 3: `session.test.ts` and `MainPanel.test.tsx` spy on `FAKE_WHOLE`.

---

### Task 1: The whole unit made of named parts, and what a provider says alone

No reader changes yet. Everything is added beside today's code, and proven equal to the members it will replace.

**Files:**
- Modify: `src/lib/plan/wholeUnit.ts`.
  - Add `WholeUnitParts`, `wholeUnitOf` and `capabilitiesAlone`.
  - `wholeUnit(p)` becomes `return wholeUnitOf(p)`. A definition still carries the nine members. Task 4 deletes `wholeUnit`.
- Modify: `src/lib/plan/types.ts`.
  - `UnitDefinition.id`'s doc: "`'whole'`: a unit that is a whole session (`wholeUnitOf`)".
  - `UnitCapabilities`' doc: "a whole unit asks its parts each time".
- Modify: `src/providers/fake/provider.ts`.
  - `export const FAKE_WHOLE: WholeUnitParts<FakeSettings, FakeCredentials, FakeConfig>` holds the definition's seven members: `speech: 'optional'`, `textInput: () => true`, `boundaries: () => 'provider'`, `turns: () => ['auto', 'manual']`, `build: buildFake`, `describe: describeFake`, `start: startFake`.
  - The definition spreads `...FAKE_WHOLE` in their place. Task 4 drops the spread.
- Test: `src/lib/plan/wholeUnit.test.ts`, `src/providers/registry.test.ts`

**Interfaces:**
- Produces:
  - `WholeUnitParts<S, K, C>`. Its members are `Provider`'s nine, with the same types. The docs of `textInput`, `participantSpeech` and `faceToFace` move here verbatim. `Provider` keeps its copies until Task 4.
  - `wholeUnitOf<S, K, C>(parts)`, the body of today's `wholeUnit` with `p` read as `parts`:
    - `occupies`: all three stages, or `TR_TL` when `speech !== 'always'`;
    - the capability getters;
    - `faceToFace === true`, `participantSpeech !== false`;
    - `build` delegating, `get describe`, `get start`.
  - `capabilitiesAlone(p, stage)`, which is `wholePlan(p).byStage[stage].unit.capabilities(p.settings.defaults)`.
    - Its doc: what a reader asks of a provider as a whole. That means whether it speaks and whether its participant may, read off `'speech'`, and face-to-face, read off `'transcription'`. These come from the unit that serves the stage in a run on it alone, under its default settings, which no unit reads for these.
  - `FAKE_WHOLE`.

- [ ] **Step 1: Write the failing tests**

`wholeUnit.test.ts`: the existing cases move onto `wholeUnitOf`.
- `stub()` becomes `parts(over)`: the same members and spies, without `units`. Every `wholeUnit(x)` becomes `wholeUnitOf(x)`, and "the definition" in a case name becomes "its parts".
- A provider is built as `provider(units) = { id: 'p', settings: { key: 'p', defaults: s }, units } as unknown as AnyProvider`. The `wholePlan` and `unitsOf` cases build their providers this way. So `plans a provider alone: its first unit on all three stages` gets `provider([wholeUnitOf(parts())])`, and the `stagesOf` helper uses `provider(units)`.
- `occupying` moves from its `describe` to the file's top level, for the cases below.

```ts
it('reads none of its parts when made: each is read when the unit is used', () => {
  const trap = new Proxy({}, { get: (_t, k) => { throw new Error(`read ${String(k)}`); } }) as WholeUnitParts;
  expect(() => wholeUnitOf(trap)).not.toThrow();
});
// Removed in Task 4, with the fallback.
it('a provider with no units of its own is the whole unit of its own members', () => {
  const p = parts() as unknown as AnyProvider;
  expect(unitsOf(p)[0].capabilities(s)).toEqual(wholeUnitOf(parts()).capabilities(s));
});
describe('capabilitiesAlone', () => {
  const caps = (o: Partial<UnitCapabilities>): UnitCapabilities => ({ speech: 'never', turns: ['auto'], turnOwner: 'either', boundaries: 'provider', textInput: false, faceToFace: false, participantSpeech: true, ...o });
  it('is what the unit serving the stage can do in a run on the provider alone, under its default settings', () => {
    const text = { ...occupying('text', ...TR_TL), capabilities: vi.fn(() => caps({ faceToFace: true })) };
    const voice = { ...occupying('voice', 'speech'), capabilities: vi.fn(() => caps({ speech: 'optional', participantSpeech: false })) };
    const p = { id: 'p', settings: { key: 'p', defaults: { d: 1 } }, units: [voice, text] } as unknown as AnyProvider;
    expect(capabilitiesAlone(p, 'speech')).toMatchObject({ speech: 'optional', participantSpeech: false });
    expect(capabilitiesAlone(p, 'transcription').faceToFace).toBe(true);
    expect(voice.capabilities).toHaveBeenCalledWith({ d: 1 });
  });
  it('a provider that only speaks answers with its one unit, for every stage', () => {
    const voice = { ...occupying('voice', 'speech'), capabilities: () => caps({ speech: 'optional', faceToFace: true }) };
    const p = { id: 'p', settings: { key: 'p', defaults: {} }, units: [voice] } as unknown as AnyProvider;
    expect(capabilitiesAlone(p, 'transcription')).toMatchObject({ speech: 'optional', faceToFace: true });
  });
});
```

`registry.test.ts`, in `the invariants every provider meets (F17)`:

```ts
const NEVER_SPEAKS = ['bing', 'openai_text', 'gemini_text', 'openai_compatible', 'fake_transcriber', 'fake_translator'];
const WHOLE = ['kizunaai_qwen', 'local_inference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'qwen_livetranslate', 'palabraai', 'fake', 'fake_leased'];
const SONIOX = ['kizunaai_soniox', 'soniox'];
const silentParticipant = createKizunaSonioxProvider({ participantSpeech: false });

it('says alone whether it speaks, and lets its participant speak, as it always did', () => {
  for (const p of PROVIDERS) expect(capabilitiesAlone(p, 'speech'), p.id).toMatchObject({ speech: NEVER_SPEAKS.includes(p.id) ? 'never' : 'optional', participantSpeech: true });
  expect(capabilitiesAlone(silentParticipant, 'speech').participantSpeech).toBe(false);
});
it('of the providers the wizard offers, the two Soniox ones alone run face-to-face', () => {
  const offered = PROVIDERS.filter((p) => runsAlone(p) || p.kind === 'managed');
  expect(offered.filter((p) => capabilitiesAlone(p, 'transcription').faceToFace).map((p) => p.id)).toEqual(SONIOX);
});
it('runs alone, and plans a run on itself alone, as it always did', () => {
  for (const p of PROVIDERS) {
    const expected = WHOLE.includes(p.id) ? [['whole', RUN_STAGES]] : SONIOX.includes(p.id) ? [['stt', TR_TL], ['tts', SP]] : [[unitsOf(p)[0].id, RUN_STAGES]];
    expect(wholePlan(p).units.map((u) => [u.unit.id, u.stages]), p.id).toEqual(expected);
    expect(runsAlone(p), p.id).toBe(WHOLE.includes(p.id) || SONIOX.includes(p.id));
  }
});
// Removed in Task 4, with the members it compares against.
it('is what each definition says of itself', () => {
  for (const p of [...PROVIDERS, silentParticipant]) {
    expect(capabilitiesAlone(p, 'speech').speech, p.id).toBe(p.speech);
    expect(capabilitiesAlone(p, 'speech').participantSpeech, p.id).toBe(p.participantSpeech !== false);
    if (runsAlone(p) || p.kind === 'managed') expect(capabilitiesAlone(p, 'transcription').faceToFace, p.id).toBe(p.faceToFace === true);
  }
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/plan/wholeUnit.test.ts src/providers/registry.test.ts`. Expected: FAIL (`wholeUnitOf` and `capabilitiesAlone` are not exported).
- [ ] **Step 3:** Implement the files listed under Files. `wholeUnit.ts` gains only type imports (`Adapter`, `SessionContext` from `../contract/adapter`; `ProviderRefusal`, `SharedSettings` from `../provider/types`; `UnitCapabilities` from `./types`). `src/lib/plan/fromStores.cycle.test.ts` and `src/lib/lineup/catalog.cycle.test.ts` keep passing.
- [ ] **Step 4:** Run `npx vitest run src/lib/plan src/lib/lineup src/providers/registry.test.ts src/providers/fake`. Expected: PASS. Then run `npx vitest run`. Expected: no new failures.
- [ ] **Step 5:** Commit `refactor(plan): the whole unit made of named parts, and what a provider says alone (provider refactor, step 3)`.

### Task 2: Every reader asks the units

The members still exist, so a reader that moves keeps its answer (Task 1's pins). Each test below gives a provider whose units say something its members do not.

**Files:**
- Modify: `src/lib/session/shape.ts`.
  - `Speaking` becomes `Pick<UnitCapabilities, 'speech'> & Partial<Pick<UnitCapabilities, 'participantSpeech'>>`.
  - Its doc: "of the one that speaks: a plan's speech unit, or a provider alone (`capabilitiesAlone`). Absent `participantSpeech`: the participant may speak."
- Modify: `src/lib/session/appShape.ts`. `speechFromStores(speaking: Speaking | undefined = speechUnitFromStores())`. `MainPanel/useFaceToFace.ts` then compiles as it is.
- Modify: `src/stores/providerStore.ts`. In `derive`, use `get().speakers[p.id] ?? capabilitiesAlone(p, 'speech')`.
- Modify: `src/components/providers/ProviderOwnSettings.tsx`. Both `participantSpeaks` (Settings, Engine) and `legSpeaks(selection.provider, …)` read `capabilitiesAlone(selection.provider, 'speech')`.
- Modify: `src/components/providers/ProviderPicker.tsx`. The EngineSummary's `participantSpeaks` uses `capabilitiesAlone(provider, 'speech').participantSpeech && speechParticipant`.
- Modify: `src/components/SettingsPage/LocalVoices.tsx`. Use `capabilitiesAlone(localInferenceProvider, 'speech').participantSpeech`.
- Modify: `src/components/providers/LanguagePairSection.tsx`.
  - `speech?: UnitCapabilities['speech']`.
  - Its default is `capabilitiesAlone(provider, 'speech').speech`.
  - Its doc: "Absent: what the provider's unit that speaks says in a run on it alone."
- Modify: `src/components/SetupWizard/providerPaths.ts`.
  - `textOnlyCapabilityOf(speaking: Pick<UnitCapabilities, 'speech'>)`.
  - A private `fitOf(p: AnyProvider, preset: ScenarioPreset): ProviderFit` returns `providerFitForScenario(textOnlyCapabilityOf(capabilitiesAlone(p, 'speech')), preset, capabilitiesAlone(p, 'transcription').faceToFace)`.
  - `providerFits`, `ownKeyOptions`, `managedOptions` and `offlineFit` call `fitOf`.
- Modify: `src/components/SetupWizard/steps/StepFinish.tsx` and `steps/StepLanguagePair.tsx`. Each uses `const speaking = capabilitiesAlone(p, 'speech')` for `textOnlyCapabilityOf`, `legSpeaks` and `languageContext`.
- Test:
  - `src/components/SetupWizard/providerPaths.managedFit.test.ts`
  - `src/stores/providerStore.test.ts`
  - `src/components/providers/ProviderOwnSettings.test.tsx`
  - `src/components/providers/LanguagePairSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `capabilitiesAlone`, `wholeUnitOf`, `FAKE_WHOLE`.
- Produces:
  - `Speaking` as above;
  - `textOnlyCapabilityOf(speaking: Pick<UnitCapabilities, 'speech'>): 'always' | 'optional' | 'never'`;
  - `LanguagePairSectionProps.speech?: UnitCapabilities['speech']`.

- [ ] **Step 1: Write the failing tests**
  - `providerPaths.managedFit.test.ts`:
    - The mocked registry's stand-in declares its speaking in its unit, not on itself: `{ id: 'kizunaai_soniox', kind: 'managed', settings: { key: 'kizunaSoniox', defaults: {} }, units: [wholeUnitOf({ ...FAKE_WHOLE, speech: 'always', faceToFace: true })] }`. The factory is `async` and imports both modules inside it.
    - The header comment says the wizard reads its kind and its unit.
    - The three existing cases stay. Add:

```ts
it('runs face-to-face where its unit says it does', () => {
  expect(managedOption('face-to-face-voice')?.fit).toEqual({ ok: true });
  expect(managedOption('face-to-face-text')?.fit).toEqual({ ok: false, reason: 'cannot-be-text-only' });
});
```

  - `providerStore.test.ts`: `moody` drops `speech: 'optional'` and gains `units: [wholeUnitOf(FAKE_WHOLE)]`, the fake's whole unit, which speaks optionally. Its existing cases are the test.
  - `ProviderOwnSettings.test.tsx`: the two `{ ...fakeProvider, participantSpeech: false, X }` become `{ ...fakeProvider, units: [wholeUnitOf({ ...FAKE_WHOLE, participantSpeech: false })], X }`.
  - `LanguagePairSection.test.tsx`, beside `the sentence follows the speaking unit's rule, not the provider's own`:

```ts
it("without a speaking unit's rule, the sentence follows the provider's own unit", () => {
  const silent = { ...fakeProvider, units: [wholeUnitOf({ ...FAKE_WHOLE, speech: 'never' })] };
  draw({ source: 'en', target: 'ja' }, vi.fn(), { sentence: { mode: 'speaker', textOnly: false }, provider: silent });
  expect(screen.getByText('settings.langSentence.theyRead')).toBeTruthy();
});
```

- [ ] **Step 2:** Run `npx vitest run src/components/SetupWizard/providerPaths.managedFit.test.ts src/stores/providerStore.test.ts src/components/providers/ProviderOwnSettings.test.tsx src/components/providers/LanguagePairSection.test.tsx`. Expected: FAIL in these places:
  - the stand-in fits every scenario;
  - `moody` keeps `ko` while speaking;
  - `participantSpeaks` is true;
  - the sentence says `theyHear`.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Run `npx vitest run src/components/SetupWizard src/components/providers src/components/SettingsPage src/stores src/lib/session src/providers/registry.test.ts`. Expected: PASS, with no other expectation edited. Then `npx vitest run` and tsc, per Global Constraints.
- [ ] **Step 5:** Commit `refactor(providers): every reader asks a provider's units what it says alone`.

### Task 3: The fake and the test stubs run their whole unit

After this task, no test reaches a whole provider's members to change a run. Each test tweaks a whole unit.

**Files:**
- Modify: `src/providers/fake/provider.ts`. Add `units: [wholeUnitOf(FAKE_WHOLE)]`. The `...FAKE_WHOLE` spread stays until Task 4.
- Modify: `src/lib/plan/testing.ts`.
  - Add `withWhole`.
  - `stubProvider(id, over)` becomes `withWhole({ id } as unknown as AnyProvider, STUB_WHOLE, over)`. `STUB_WHOLE` is private and holds today's stub members: `speech: 'optional'`, `turns: () => ['auto']`, `boundaries: () => 'silence'`, `textInput: () => false`, `build: () => ({})`, `describe: () => ({})`, `start: () => undefined`.
  - A stub has no run member of its own. Its doc says so.
- Create: `src/lib/plan/testing.test.ts`.
- The test helpers this step affects:
  - Changed:
    - `stubProvider` (`testing.ts`);
    - `withHooks` (`runner.hooks.test.ts`);
    - `spyingProvider` (`runner.turns.test.ts`);
    - `hangingStop` and `setup` (`runner.test.ts`);
    - `probe` (`providerStore.test.ts`, `providerStore.readiness.test.ts`);
    - the `moody` stand-ins (`providerStore.test.ts` in Task 2, `StepLanguagePair.test.tsx`, `ProviderLanguages.test.tsx`).
  - Unchanged, because they build through `stubProvider` or spread a provider that carries units:
    - `stubHosts`, `stubTextUnit`, `stubSpeechUnit`, `stubTranslationUnit`, `planOf` and `shapeWith` (`testing.ts`);
    - `makeProbe` (`app/readiness.test.ts`);
    - the `unitOf` helpers of the Soniox lease tests, and the Qwen lease test's `shapeFor`.
  - `sonioxOnSockets` (`soniox/testing.composite.ts`) only loses a dead member, in Task 4.
- Modify these tests:
  - `src/lib/session/runner.test.ts`:
    - every `{ ...fakeProvider, start|build: … }` (in `hangingStop`, the `build` spies, and the `start` overrides) becomes `withWhole(fakeProvider, FAKE_WHOLE, {…})`;
    - `setup` wraps its provider's unit: `{ ...provider, units: [{ ...unitsOf(provider)[0], start: <the wrapper, calling that unit's own start> }] }`.
  - `src/lib/session/runner.hooks.test.ts`:
    - `withHooks(session, patch: Partial<WholeUnitParts> = {})` returns `withWhole(fakeProvider, FAKE_WHOLE, { ...patch, session })`;
    - `AnyProvider['start']` becomes `WholeUnitParts['start']`;
    - the `{ ...fakeProvider, start }` near line 520 becomes `withWhole(...)`.
  - `src/lib/session/runner.turns.test.ts`:
    - the spying start is extracted as `spyingStart(log)`;
    - `spyingProvider(log, patch: Partial<WholeUnitParts>)` is `withWhole(fakeProvider, FAKE_WHOLE, { ...patch, start: spyingStart(log) })`;
    - the shared-connection case builds `startBoth` on `spyingStart(log)`.
  - `src/lib/session/runner.agentText.test.ts`, `src/lib/session/run.test.ts` and `src/providers/palabraai/adapter.runner.test.ts`: their `{ ...fakeProvider, start|build, … }` becomes `withWhole(…)`.
  - `src/lib/session/shape.test.ts`: the `{ ...fakeProvider, speech|participantSpeech|turns }` objects become `withWhole(…)`.
  - `src/app/session.test.ts` (`failedMidSession`): use `vi.spyOn(FAKE_WHOLE, 'start')`, `Parameters<typeof FAKE_WHOLE.start>[1]`, and call `FAKE_WHOLE.start(request, e)`.
  - `src/components/MainPanel/MainPanel.test.tsx`: use `vi.spyOn(FAKE_WHOLE, 'textInput')`.
  - `src/providers/soniox/kizuna.test.ts`, the runner case: `units: fakeProvider.units` replaces its `build`, `describe`, `start` and `units: undefined`.
  - `src/lib/plan/compose.test.ts`: `wholeUnit(local)` becomes `unitsOf(local)[0]`, and the `wholeUnit` import goes.
  - `src/components/providers/ProviderLanguages.test.tsx`: `moody` drops `speech: 'optional'`, which is now the fake's unit.
  - These unit-less literals become `stubProvider(id, {…})`, with their members as they are:
    - `src/stores/providerStore.test.ts`'s `probe`, with `speech: 'never'`, matching its missing `speech`;
    - `src/stores/providerStore.readiness.test.ts`'s `probe(kind, check)`, with `speech: 'never'`;
    - `src/components/SetupWizard/steps/StepLanguagePair.test.tsx`'s `moody`, with `speech: 'optional'`.
  - Every delegation `fakeProvider.start(` / `.build(` / `.describe(` in a test calls `startFake` / `buildFake` / `describeFake`. `src/providers/fake/provider.test.ts` is the exception; Task 4 handles it.
- Test: `src/lib/plan/testing.test.ts`, `src/providers/fake/provider.test.ts`

**Interfaces:**
- Consumes: Task 1's `wholeUnitOf`, `WholeUnitParts`, `FAKE_WHOLE`.
- Produces: `withWhole(p: AnyProvider, whole: WholeUnitParts, over: Record<string, unknown> = {}): AnyProvider`.
  - The members of `over` named among the nine parts go to one whole unit, `wholeUnitOf({ ...whole, ...those })`, which is the result's only unit.
  - Every other member of `over` replaces `p`'s. When `over.units` is given, it is the result's units instead.
  - It throws an `Error` naming the part ("withWhole: start would be lost beside units") when `over` gives `units` and a part.

- [ ] **Step 1: Write the failing tests**

```ts
// testing.test.ts
it('withWhole: a part goes to the whole unit, any other member to the provider', () => {
  const start = vi.fn();
  const p = withWhole(fakeProvider, FAKE_WHOLE, { start, id: 'other' });
  expect(p.id).toBe('other');
  expect(unitsOf(p).map((u) => u.id)).toEqual(['whole']);
  expect(unitsOf(p)[0].start).toBe(start);
  expect(unitsOf(p)[0].describe).toBe(FAKE_WHOLE.describe);
});
it('withWhole: refuses a part beside units, which would lose it', () => {
  expect(() => withWhole(fakeProvider, FAKE_WHOLE, { units: [], start: vi.fn() })).toThrow(/start/);
});
it('stubProvider: its whole unit is made of the members it is given, and it carries none of them', () => {
  const p = stubProvider('x', { speech: 'always', kind: 'managed' });
  expect(unitsOf(p)[0].capabilities(undefined).speech).toBe('always');
  expect(p).toMatchObject({ id: 'x', kind: 'managed' });
  expect(p).not.toHaveProperty('speech');
});
// fake/provider.test.ts
it('runs its whole unit, made of FAKE_WHOLE', () => {
  expect(fakeProvider.units?.map((u) => u.id)).toEqual(['whole']);
  expect(fakeProvider.units![0].describe).toBe(FAKE_WHOLE.describe);
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/plan/testing.test.ts src/providers/fake/provider.test.ts`. Expected: FAIL (`withWhole` is not exported; the stub carries `speech`; the fake declares no units).
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** `git grep -nE "fakeProvider\.(speech|textInput|boundaries|turns|participantSpeech|faceToFace|build|describe|start)\b" -- src ':!src/providers/fake/provider.test.ts'` prints nothing. `git grep -nE "\.\.\.fakeProvider, (speech|textInput|boundaries|turns|participantSpeech|faceToFace|build|describe|start)\b" -- src` prints nothing.
- [ ] **Step 5:** Run `npx vitest run`. Expected: no new failures, and no expectation edited beyond the tests listed. Then run tsc.
- [ ] **Step 6:** Commit `test: the fake and the test stubs run their whole unit; a test tweaks a whole unit, not a whole provider`.

### Task 4: Every provider declares its units; the run members leave the definition

**Files (code):**
- Modify: `src/lib/provider/types.ts`.
  - Delete the nine members, their docs, and the comments `// the only capabilities generic code reads` and `// one leg's session`. `fileRecognition` stays.
  - Drop any import left unused (tsc names `Adapter`).
  - `units` is required, with this doc:

```ts
/**
 * What a session runs: the provider's units, each serving some of the stages with a config of its own
 * (`src/lib/plan/types.ts`). The composer picks among them, a run on the provider alone takes them as `wholePlan`
 * says, and the line-up catalog is read off them (`capsOf`). An end-to-end service declares its one session as a
 * whole unit (`wholeUnitOf`); a provider that only translates, or only speaks, declares the unit that does.
 */
units: readonly UnitDefinition[];
```

- Modify: `src/lib/plan/wholeUnit.ts`.
  - Delete `wholeUnit`.
  - `unitsOf(p)` returns `p.units`, and the cache goes.
  - The header comment names what the module holds: the whole unit an end-to-end service declares, a provider's units, its plan alone, and what it says alone.
- Modify: `src/lib/provider/managed.ts`.
  - Delete the nine member lines and the `participantSpeech` local.
  - `units: o.units ?? base.units`.
  - `ManagedOverrides` loses `participantSpeech`. `units`' doc: "the twin's own units; absent, its base's".
  - The header doc says "the base's languages and units".
- Modify these definitions. Each declares `units: [wholeUnitOf<S, K, C>({ … })]` with the seven members it had, their comments moved with them, and keeps `endToEnd: true`:
  - `src/providers/gemini/provider.ts`
  - `src/providers/volcengine_ast2/provider.ts`
  - `src/providers/openai/provider.ts`
  - `src/providers/openai_translate/provider.ts`
  - `src/providers/openai_live/provider.ts`
  - `src/providers/qwen_livetranslate/provider.ts`
  - `src/providers/palabraai/provider.ts`
  - `src/providers/fake/leased.ts` (its `build` closure as it is)
- Modify: `src/providers/fake/provider.ts`. Drop the `...FAKE_WHOLE` spread.
- Modify: `src/providers/localInference/provider.ts`.
  - `units` is a plain array: `[wholeUnitOf<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig>({ speech: 'optional', textInput: () => true, boundaries: () => 'provider', turns: () => ['auto', 'manual'], build: buildLocalInference, describe: describeLocalInference, start: adapter.start }), localTranscriptionUnit, localTranslationUnit, localSpeechUnit]`.
  - The `let units` getter and the `wholeUnit` import go. No unit module reaches this file, so there is no cycle to defer.
  - The units' doc says "its whole session (`wholeUnitOf`)".
- Modify: `src/providers/soniox/provider.ts`.
  - `export const sonioxAdapter = createSonioxAdapter()` replaces `const adapter`.
  - The definition's eight run members (`faceToFace` among them) and their comments go.
  - The units are `sonioxUnitsFor({ start: sonioxAdapter.start })`, and the session hook is `{ startBoth: sonioxAdapter.startBoth }`.
- Modify: `src/providers/soniox/kizuna.ts`.
  - `units: sonioxUnitsFor({ start: sonioxAdapter.start, participantSpeech })`.
  - The `participantSpeech` override line goes.
  - The doc says the flag "reaches its units, its lease and its floor".
- Modify: `src/providers/qwen_livetranslate/kizuna.ts`. Doc only: "Qwen's languages and whole unit (its base's, carried by `managed()`)".
- Delete the members and the rejecting `start`, then drop imports left unused (`AdapterStartError`, the text models' build and describe helpers):
  - `src/providers/openai_text/provider.ts`
  - `src/providers/gemini_text/provider.ts`
  - `src/providers/openai_compatible/provider.ts`
  - `src/providers/bing/provider.ts`
  - `src/providers/edge/provider.ts`
  - `src/providers/fake/voice.ts`
  - `src/providers/fake/translator.ts`
  - `src/providers/fake/transcriber.ts`
  - Their doc lines that mention the rejecting `start` are reworded to say they start through their unit.
- Modify: `CLAUDE.md` ("Adding a New AI Provider"). Item 1 adds "its `units`". Item 2's last sentence becomes: "An end-to-end service declares its one session as a whole unit (`units: [wholeUnitOf({...})]`, `src/lib/plan/wholeUnit.ts`) and sets `endToEnd: true`."
- Modify: `src/lib/lineup/catalog.testing.ts`. Header comment only, the same sentence in place of "(no `units`)".

**Files (tests):**
- `src/lib/lineup/capsOf.test.ts`: the guard is replaced (Step 1).
- `src/providers/registry.test.ts`:
  - Step 1's two cases are added;
  - Task 1's `is what each definition says of itself` is deleted;
  - `offers at least one turn mode` becomes "every unit of every provider offers at least one turn mode" (`u.capabilities(p.settings.defaults).turns`).
- `src/lib/provider/managed.test.ts`:
  - the member loop of the first case checks `languages` only, plus `expect(twin.units).toBe(fakeProvider.units)`;
  - the two participant-speech cases are replaced by Step 1's;
  - in the compile-time case, the two `twin.start(…)` lines become the same calls on `FAKE_WHOLE.start`, keeping their `@ts-expect-error`.
- `src/lib/plan/wholeUnit.test.ts`: delete the case marked "Removed in Task 4".
- Tests that read a definition's members read its units by one rule, where `const [whole] = xProvider.units` (or the unit by id for Soniox and the local provider):
  - `.speech` becomes `.capabilities(s).speech`;
  - `.textInput(s)`, `.boundaries(s)`, `.turns(s)` become `.capabilities(s).X`;
  - `.participantSpeech` `toBeUndefined()` becomes `.capabilities(s).participantSpeech` `toBe(true)`;
  - `.faceToFace` becomes `capabilitiesAlone(p, 'transcription').faceToFace`;
  - `.build` / `.describe` become `whole.build` / `whole.describe`;
  - `.start` becomes `whole.start!`;
  - a comparison of a unit member against the definition's member becomes a comparison against the module's function (`buildSoniox`, `describeSoniox`, `sonioxAdapter.start`), or `expect.any(Function)` for a private adapter's start;
  - each end-to-end provider's test adds `expect(xProvider.units.map((u) => u.id)).toEqual(['whole'])`.
  - The files:
    - `src/providers/gemini/provider.test.ts`
    - `src/providers/openai/provider.test.ts`
    - `src/providers/openai_live/provider.test.ts`
    - `src/providers/openai_translate/provider.test.ts`
    - `src/providers/palabraai/provider.test.ts`
    - `src/providers/qwen_livetranslate/provider.test.ts`
    - `src/providers/volcengine_ast2/provider.test.ts`
    - `src/providers/qwen_livetranslate/kizuna.test.ts` (member loop: `languages`, `TurnDetection`, and `units` `toBe` the base's)
    - `src/providers/soniox/provider.test.ts`
    - `src/providers/soniox/units.test.ts`:
      - `sonioxProvider.start` becomes `sonioxAdapter.start`;
      - the "definition's own members stay" lines become `units[0].build`/`describe` against `buildSoniox`/`describeSoniox`;
      - the capabilities case compares against its literal values;
      - `legSpeaks(p, …)` becomes `legSpeaks({ speech: 'optional' }, …)`.
    - `src/providers/soniox/kizuna.test.ts` (member loop: `languages`, `TurnDetection`, and each unit's `build`/`describe`/`start` against Soniox's)
    - `src/providers/soniox/kizunaParticipantSpeech.test.tsx` (`.participantSpeech` becomes `capabilitiesAlone(p, 'speech').participantSpeech`)
    - `src/providers/localInference/provider.test.ts`
    - `src/providers/fake/provider.test.ts`
    - `src/providers/fake/leased.test.ts`
    - `src/lib/plan/fromStores.test.ts` (`.toBe(sonioxProvider.speech)` becomes `.toBe('optional')`)
  - These tests swap their own-start-rejects assertions for `expect(p).not.toHaveProperty('start')`:
    - `src/providers/openai_text/provider.test.ts`
    - `src/providers/openai_compatible/provider.test.ts`
    - `src/providers/bing/provider.test.ts`
    - `src/providers/edge/provider.test.ts`
    - `src/providers/fake/stages.test.ts`
    - `src/providers/fake/voice.test.ts`
- A provider handed where a `Speaking` is asked becomes `capabilitiesAlone(p, 'speech')`:
  - `src/lib/session/shape.test.ts` (`fakeProvider` in the `legSpeaks`/`languageContext` cases)
  - `src/lib/session/appShape.test.ts` (around 462, 465)
- These keep a dead `start:` member beside their units; drop it:
  - `src/providers/soniox/voiceAlone.run.test.ts`
  - `src/providers/soniox/testing.composite.ts`
  - `src/providers/soniox/units.run.test.ts`
- Any other file that fails with "units is not iterable" or a missing member builds its provider with `stubProvider` or `withWhole`.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `Provider.units: readonly UnitDefinition[]` (required);
  - `unitsOf(p) === p.units`;
  - `sonioxAdapter`;
  - `ManagedOverrides` without `participantSpeech`.

- [ ] **Step 1: Write the failing tests**

```ts
// capsOf.test.ts, replacing 'a provider that declares no units is end to end, except the fakes listed here'
it('every provider declares its units', () => {
  expect([...RELEASED, ...DEV_ONLY].filter((p) => !Array.isArray(p.units) || p.units.length === 0).map((p) => p.id)).toEqual([]);
});
// registry.test.ts
it('carries no run member of its own: a session runs its units', () => {
  const RUN_MEMBERS = ['speech', 'textInput', 'boundaries', 'turns', 'participantSpeech', 'faceToFace', 'build', 'describe', 'start'];
  for (const p of [...PROVIDERS, silentParticipant]) expect(RUN_MEMBERS.filter((m) => m in p), p.id).toEqual([]);
});
it('an end-to-end service declares its one session as a whole unit', () => {
  for (const p of PROVIDERS.filter((q) => q.endToEnd)) expect(p.units.map((u) => u.id), p.id).toEqual(['whole']);
});
// capsOf.test.ts — keeps step 2's billing guard (controller ruling 2026-11-23): a provider made of one whole unit alone is
// end to end, except `fake` (the E2E stand-in, a plain provider that is no vendor's end-to-end service).
it('a provider whose only unit is a whole unit is end to end, except the fakes listed here', () => {
  const NOT_END_TO_END = new Set(['fake']);
  const forgotten = [...RELEASED, ...DEV_ONLY].filter((p) => p.units.length === 1 && p.units[0].id === 'whole' && !NOT_END_TO_END.has(p.id) && p.endToEnd !== true).map((p) => p.id);
  expect(forgotten).toEqual([]);
});
// managed.test.ts
it("runs its base's units when it gives none of its own, and its own when it does", () => {
  expect(managed(fakeProvider, OVERRIDES).units).toBe(fakeProvider.units);
  const own = [unitsOf(fakeProvider)[0]];
  expect(managed(fakeProvider, { ...OVERRIDES, units: own }).units).toBe(own);
});
it("a twin's participant speaks as its units say: its base's, or its own", () => {
  const silent = withWhole(fakeProvider, FAKE_WHOLE, { participantSpeech: false });
  expect(capabilitiesAlone(managed(silent, OVERRIDES), 'speech').participantSpeech).toBe(false);
  expect(capabilitiesAlone(managed(silent, { ...OVERRIDES, units: fakeProvider.units }), 'speech').participantSpeech).toBe(true);
});
// soniox/units.test.ts, in 'each declares its text unit, …'
expect(units[0].start).toBe(sonioxAdapter.start);
expect(units[1].start).toBe(sonioxAdapter.start);
```

- [ ] **Step 2:** Run `npx vitest run src/lib/lineup/capsOf.test.ts src/providers/registry.test.ts src/lib/provider/managed.test.ts src/providers/soniox/units.test.ts`. Expected: FAIL. The end-to-end providers declare no units, every provider carries members, the twin has no units, and `sonioxAdapter` is not exported.
- [ ] **Step 3:** Make the code changes, then run `npx tsc --noEmit -p tsconfig.json`. Each error outside the base's 89 is a test on the lists above. Rewrite it by the rule.
- [ ] **Step 4:** `git grep -nw "wholeUnit" -- src` prints nothing. `git grep -n "plan_unsupported" -- src/providers` prints nothing. `git grep -n "participantSpeech" -- src/lib/provider/managed.ts` prints nothing.
- [ ] **Step 5:** Run `npx vitest run src/lib src/providers src/components src/stores src/app`, then `npx vitest run`. Expected: no new failures. The catalog pins, Task 1's pins (except the deleted case), and the line-up, plan and session tests pass with no expectation edited beyond the lists above.
- [ ] **Step 6:** Commit `refactor(providers): every provider declares its units; the run members leave the definition`.

### Task 5: Whole-suite verification, push and PR

- [ ] **Step 1:** Run `npx vitest run`. Expected: only the base's failures (recorded before Task 1).
- [ ] **Step 2:** Run `npx tsc --noEmit -p tsconfig.json`. Expected: no error in a touched file, and at most 89.
- [ ] **Step 3:** Run `npm run e2e:build && npm run e2e` in this worktree. Expected: all pass. This is the only run of the fakes' units in a built app (sessions on `fake` and `fake_leased`, and the composites with `fake_voice`, `fake_translator` and `fake_transcriber`).
- [ ] **Step 4:** Push `refactor/units-required` to `kizuna-ai-lab/sokuji` and open its PR into `refactor/stages-declared-once` (`kizuna-ai-lab/sokuji`). The owner authorised opening the step 2-4 PRs directly, stacked, on 2026-11-22 (task #131). The PR body states:
  - the goal;
  - the three accepted differences;
  - that the catalog pins passed unchanged;
  - the check report below.
  - It ends with the attribution line the session gives.

---

## What was checked before writing this plan (2026-11-23, on 2e730b9cc)

- **Readers, by the type checker.** tsc was run with the nine members removed from `Provider` and `units` required, then reverted.
  - The non-test readers are those in Tasks 2 and 4.
  - `appShape.ts` and `MainPanel/useFaceToFace.ts` broke only through `Speaking`'s type. `useFaceToFace.ts` needs no edit once `Speaking` is retyped.
  - `textInput()`, `boundaries()`, `turns()`, `build()`, `describe()` and `start` have no reader outside `wholeUnit`, `managed()` and `soniox/kizuna.ts`.
- **Answers, by a throwaway test.** It covered all 21 definitions and the flag-off Kizuna Soniox, comparing each definition's `speech`, `participantSpeech !== false` and `faceToFace === true` with the plan-alone unit's.
  - They are equal everywhere except Edge's face-to-face: its definition says none, its unit says yes. Edge runs alone nowhere and is not managed, so no reader asks it.
  - The plan-alone unit ids, stages and `runsAlone` are Task 1's table.
- **Unit-less test providers, by a throwaway probe.** `unitsOf` and the readers were made to throw on a provider without units that is not one of the ten unit-less definitions, over 278 test files. The hits were:
  - spreads of `fakeProvider`, which carry its units after Task 3;
  - `stubProvider` stubs, which build a whole unit after Task 3;
  - the literals Task 3 lists.
  - `StepLanguagePair.test.tsx`'s `moody` was found by reading.
- **Base.** `npx tsc --noEmit -p tsconfig.json` gives 89 errors. The 145 test files that name a provider, the plan helpers or the provider store pass (2977 tests).
