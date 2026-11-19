# Free combination of stages, step 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the unit, the run plan, the composer and the composite adapter under every session, with each provider as one whole-provider unit, so that nothing a user sees or a session does changes.

**Architecture:** A pure composer turns the stored line-up into a `RunPlan` (the units that serve the three run stages) or a refusal. The run, the stores and the surfaces read the plan in place of "the selected provider". In this step every plan holds exactly one unit, built from a provider's present `build` / `describe` / `start`, and the composite adapter passes the adapter contract straight through to it.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron E2E). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-19-free-stage-combination-design.md` (§4, §5, §5.1, §8, §11 step 1, §13). Read it before any task.

## Global Constraints

- No visible change: every line-up that runs today runs the same way, and every choice on the line-up page moves the same stages it moves today.
- The bar (spec §13): the existing unit and E2E suites pass **without edits to their expectations**. A test may change only how it builds its input (a `RunShape`, a store state); an `expect(...)` that has to change is a regression to fix in product code, not in the test.
- Provider ids never change; a stored `settings.lineup` stays valid (spec §4.3).
- `settings.common.provider` is still written (the transcription provider's id) so that an older version of the app, after a downgrade, opens the same provider. It is no longer read once a line-up is stored.
- The text `settingsPage.lineup.moved` stays in this step: choices still move stages until step 2 gives speech its own units. (The spec's §8 lists its removal; that belongs to the step where it stops being true.)
- The spec's composer checks 3 to 5 (languages, modes, turn ownership) stay where they run today (`gate` in `src/lib/session/shape.ts`), reading the unit's capabilities through the plan. In this step the composer answers checks 1 and 2 only. Their move into `compose` belongs to step 2, when a second unit exists to check against.
- No adapter under `src/providers/` changes. No provider definition gains a `units` member in this step: `unitsOf(provider)` supplies the whole-provider unit.
- Public repository: no backend internals, no usage data, no machine or team names in code, comments, commits or PR text.
- Each part (A to D) is one pull request to `main`, merged before the next begins. Run OCR (`ocr review --from <base> --to HEAD --audience agent`) before each push. Gate every push on `npx tsc --noEmit` and `npx vitest run` exit codes.
- Commits end with the `Co-Authored-By` trailer of the model that wrote them.

## Review Focus

1. A stored line-up that names a provider this build does not offer (a flagged provider, another platform's): the app opens, shows today's fallback, and Start says why; it never throws at load. → Task A3, Task C4.
2. A line-up stored by a **newer** version that this version cannot compose (step 2's mixed line-up, after a downgrade): shown as today's values, never overwritten, session resolves as today. → Task C4.
3. A choice made while a run is starting: the run keeps the plan it froze; the line-up and the plan a surface reads never disagree for more than the save. → Task C5.
4. A provider whose entry has not loaded yet when the plan is asked for (launch): surfaces show the loading state they show today, not a refusal. → Task C1.
5. Sign-out during a run on a managed provider, then Stop: readiness is forgotten for every managed provider in the plan and re-checked once idle, as today. → Task C3.

---

## File structure

New, all under `src/lib/plan/`:

| File | Responsibility |
|---|---|
| `types.ts` | `UnitCapabilities`, `UnitDefinition`, `PlannedUnit`, `RunPlan`, `PlanRefusal`, `PlanRefusalCode`. Types only. |
| `wholeUnit.ts` | `wholeUnit(provider)`: the one unit of a provider today. `unitsOf(provider)`. |
| `compose.ts` | `compose(lineUp, input)`: the plan or a refusal. Pure. |
| `read.ts` | What generic code asks of a plan: `providersIn`, `unitFor`, `transcriptionProvider`, `accountOf`. Pure. |
| `composite.ts` | `startComposite` / `startCompositeBoth`: the adapter contract over a plan. |
| `fromStores.ts` | `planFromStores()`, `usePlan()`, `useStageUnit(stage)`: the one place the plan is read from the stores. |
| `testing.ts` | `planOf(provider)`, `shapeWith(provider, rest)`: fixtures for tests. Imported by tests only. |

Changed: `src/lib/lineup/{types,catalog,choose,localStages,migrate}.ts`, `src/lib/session/{types,shape,appShape,run,runner}.ts`, `src/stores/{lineUpStore,providerStore}.ts`, `src/app/{readiness,telemetry,session,loadStores}.ts`, `src/components/providers/useSelectedProvider.ts` and its callers, `src/lib/history/capture/{facts,writer}.ts`, `src/lib/export/exporter.ts`.

---

# Part A — units and the composer (pure; no consumer changes)

### Task A1: plan types and the whole-provider unit

**Files:**
- Create: `src/lib/plan/types.ts`, `src/lib/plan/wholeUnit.ts`
- Test: `src/lib/plan/wholeUnit.test.ts`

**Interfaces:**
- Consumes: `AnyProvider`, `Provider`, `SharedSettings`, `ProviderRefusal` (`src/lib/provider/types.ts`); `Adapter`, `SessionContext` (`src/lib/contract/adapter.ts`); `RunStage`, `RUN_STAGES`, `TR_TL` (`src/lib/lineup/types.ts`).
- Produces:

```ts
// types.ts
export interface UnitCapabilities {
  speech: 'always' | 'optional' | 'never';
  turns: ReadonlyArray<'auto' | 'manual'>;
  /** Who may decide the end of a turn (spec §9). Every unit answers 'either' in step 1. */
  turnOwner: 'unit' | 'external' | 'either';
  boundaries: 'provider' | 'silence';
  textInput: boolean;
  faceToFace: boolean;
  /** False: the participant leg never speaks, whatever its switch says. */
  participantSpeech: boolean;
}
export interface UnitDefinition<S = any, K = any, C = any> {
  /** 'whole' in step 1. */
  id: string;
  /** The stages this unit occupies when asked for `want`, or null when it cannot serve exactly that. */
  occupies(s: S, want: ReadonlySet<RunStage>): readonly RunStage[] | null;
  capabilities(s: S): UnitCapabilities;
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start: Adapter<C, K>['start'];
}
export interface PlannedUnit { provider: AnyProvider; unit: UnitDefinition; stages: readonly RunStage[] }
export interface RunPlan {
  /** In the order transcription, translation, speech; a unit that occupies several appears once. */
  units: readonly PlannedUnit[];
  byStage: Readonly<Record<RunStage, PlannedUnit>>;
}
export type PlanRefusalCode = 'lineup_incomplete' | 'lineup_not_offered' | 'lineup_stage_split' | 'lineup_no_unit';
export interface PlanRefusal { refused: PlanRefusalCode; stage: RunStage; provider?: string }
export const isRefusal = (p: RunPlan | PlanRefusal): p is PlanRefusal => 'refused' in p;

// wholeUnit.ts
export function wholeUnit(p: AnyProvider): UnitDefinition;
/** A provider's units: its own list when it declares one (step 2 on), else its whole-provider unit. Same array for the same provider. */
export function unitsOf(p: AnyProvider): readonly UnitDefinition[];
```

- [ ] **Step 1: Write the failing tests** in `wholeUnit.test.ts`, over a stub provider (`speech`, `turns`, `boundaries`, `textInput`, `faceToFace`, `participantSpeech`, `build`, `describe`, `start` as spies):

```ts
it('occupies all three stages when asked for all three', () =>
  expect(wholeUnit(p).occupies(s, new Set(RUN_STAGES))).toEqual(RUN_STAGES));
it('occupies transcription and translation when not asked for speech, unless it always speaks', () => {
  expect(wholeUnit(optional).occupies(s, new Set(TR_TL))).toEqual(TR_TL);
  expect(wholeUnit(always).occupies(s, new Set(TR_TL))).toBeNull();
});
it('serves nothing else', () => {
  for (const want of [['speech'], ['transcription'], ['translation'], ['translation', 'speech'], ['transcription', 'speech'], []] as RunStage[][])
    expect(wholeUnit(optional).occupies(s, new Set(want))).toBeNull();
});
it('answers the definition\'s own capabilities', () =>
  expect(wholeUnit(p).capabilities(s)).toEqual({ speech: p.speech, turns: p.turns(s), turnOwner: 'either', boundaries: p.boundaries(s), textInput: p.textInput(s), faceToFace: p.faceToFace === true, participantSpeech: p.participantSpeech !== false }));
it('builds, describes and starts with the definition\'s own functions', () => { /* same function identity: unit.start === p.start, unit.describe === p.describe; build forwards its three arguments */ });
it('is the same object for the same provider', () => expect(unitsOf(p)).toBe(unitsOf(p)));
```

- [ ] **Step 2: Run** `npx vitest run src/lib/plan/wholeUnit.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `types.ts` as above and `wholeUnit.ts`. `unitsOf` caches per provider in a `WeakMap`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(plan): the unit, the plan and a provider's whole-provider unit`.

### Task A2: the catalog names who runs an option, not a family

**Files:**
- Modify: `src/lib/lineup/types.ts`, `src/lib/lineup/catalog.ts`, `src/lib/lineup/migrate.ts`
- Test: `src/lib/lineup/catalog.test.ts`, `src/lib/lineup/migrate.test.ts` (existing; fixtures only)

**Interfaces:**
- Produces:

```ts
// types.ts — ProviderCaps loses `family` and `binds`
export interface ProviderCaps {
  id: string;
  stages: readonly RunStage[];
  /** The provider definition that runs this option: itself, or `local_inference` for `bing` and `edge`. */
  host: string;
  /** The stages one connection of it carries together; choosing it for one of them chooses it for all (the vendor's interface). Absent: each stage alone. */
  joint?: readonly RunStage[];
  account: 'kizuna' | 'key' | 'none';
}
// catalog.ts
export function hostDefaults(host: string): Pick<LineUp, RunStage>;   // was familyDefaults; same values
```

`joint` values: Soniox and Kizuna AI's Soniox `TR_TL`; every end-to-end provider `ALL_STAGES`; `local_inference`, `bing`, `edge` none. `host` values: `bing` and `edge` → `'local_inference'`; every other id → itself. `runOf` and `RunTarget` are **kept** in this task (Task A4 removes them); `runOf` reads `host` and `joint` and must answer exactly as before.

- [ ] **Step 1: Add the tests** to `catalog.test.ts`:

```ts
it('every option names a provider definition as its host', () => {
  for (const c of CAPS) expect(c.host === c.id || (c.host === 'local_inference' && ['bing', 'edge'].includes(c.id))).toBe(true);
});
it('hostDefaults answers what familyDefaults answered', () => {
  expect(hostDefaults('local_inference')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
  expect(hostDefaults('soniox')).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/lineup`. Expected: the two new tests FAIL.
- [ ] **Step 3: Implement.** Rename every `familyDefaults` call (`git grep -n familyDefaults -- src`) and every `caps(x)?.family` read (`migrate.ts`, `SetupWizard/lineUpOf.ts`) to `hostDefaults` / `.host`.
- [ ] **Step 4: Run** `npx vitest run src/lib/lineup src/components/SetupWizard src/stores` and `npx tsc --noEmit`. Expected: PASS, with no expectation edited.
- [ ] **Step 5: Commit** `refactor(lineup): an option names its host and its joint stages`.

### Task A3: the composer

**Files:**
- Create: `src/lib/plan/compose.ts`, `src/lib/plan/testing.ts`
- Test: `src/lib/plan/compose.test.ts`

**Interfaces:**
- Consumes: `caps`, `CAPS` (Task A2); `unitsOf` (Task A1).
- Produces:

```ts
export interface ComposeInput {
  /** The providers this build offers here: `presentProviders()` in the app. */
  providers: readonly AnyProvider[];
  /** A provider's settings; undefined while its entry has not loaded. */
  settings(providerId: string): unknown;
}
export function compose(lineUp: Pick<LineUp, RunStage>, input: ComposeInput): RunPlan | PlanRefusal;
// testing.ts
/** The plan of a line-up that names `p` on every stage, built without the catalog (a test's stub provider is not in it). */
export function planOf(p: AnyProvider): RunPlan;
```

Rules, in this order; the first failure is the answer:
1. A stage with `null`, or an id `caps()` does not know, or an option that does not list the stage → `lineup_incomplete` with that stage.
2. An option whose `host` is not in `input.providers` → `lineup_not_offered` with that stage and the id.
3. Group the stages by host, hosts in the order of their first stage in `RUN_STAGES`; the first host that fails answers. For each host, ask each of `unitsOf(host)` `occupies(settings(host.id), stagesOfThisHost)`. A unit that answers exactly the asked set is taken. None does:
   - an option used here has a `joint` of which this host is asked one stage and not another → `lineup_stage_split`, stage = the first stage of that `joint` not given to this host;
   - otherwise → `lineup_no_unit`, stage = the first stage (in `RUN_STAGES` order) of the smallest host group.
4. `settings(id) === undefined` is passed to `occupies` as is: the whole-provider unit does not read it.

- [ ] **Step 1: Write the failing table test** in `compose.test.ts`, over the real `CAPS` and stub providers for the ids used:

```ts
const cases: Array<[string, Pick<LineUp, RunStage>, 'ok' | PlanRefusalCode, RunStage?]> = [
  ['one end-to-end provider', all('openai'), 'ok'],
  ['Soniox on all three', all('soniox'), 'ok'],
  ['local with Bing and Edge', { transcription: 'local_inference', translation: 'bing', speech: 'edge' }, 'ok'],
  ['local with its own models', all('local_inference'), 'ok'],
  ['a stage unset', { ...all('soniox'), speech: null }, 'lineup_incomplete', 'speech'],
  ['an unknown id', { ...all('soniox'), speech: 'nope' }, 'lineup_incomplete', 'speech'],
  ['Bing asked to transcribe', { ...all('local_inference'), transcription: 'bing' }, 'lineup_incomplete', 'transcription'],
  ['a provider this build does not offer', all('palabraai'), 'lineup_not_offered', 'transcription'],   // palabraai left out of input.providers
  ['Soniox text with Edge speech', { transcription: 'soniox', translation: 'soniox', speech: 'edge' }, 'lineup_no_unit', 'speech'],
  ['Soniox transcribes, Bing translates', { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, 'lineup_stage_split', 'translation'],
  ['two end-to-end providers', { transcription: 'openai', translation: 'openai', speech: 'gemini' }, 'lineup_stage_split', 'transcription'],
];
```

Plus: for an `'ok'` case, `plan.units` has length 1, `plan.byStage.transcription === plan.byStage.speech`, and its `provider.id` is the host. And one property test: **for every triple of ids in `CAPS`, `!isRefusal(compose(l, all present)) === runOf(l).ok`, and when ok the plan's provider id equals `runOf(l).provider`.**

- [ ] **Step 2: Run** `npx vitest run src/lib/plan/compose.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `compose.ts` and `testing.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS, the property test included.
- [ ] **Step 5: Commit** `feat(plan): compose a line-up into a plan or a refusal`.

### Task A4: choosing and the local stages ask the composer

**Files:**
- Modify: `src/lib/lineup/choose.ts`, `src/lib/lineup/localStages.ts`, `src/lib/lineup/catalog.ts` (delete `runOf`), `src/lib/lineup/types.ts` (delete `RunTarget`), `src/stores/lineUpStore.ts`, `src/app/telemetry.ts`, `src/components/SetupWizard/SetupWizard.tsx`, `src/components/SettingsPage/{LineUpCategory.tsx,ModelsPage.tsx,AccountsCategory.tsx,accountRows.ts}`
- Create: `src/lib/plan/read.ts`
- Test: `src/lib/lineup/choose.test.ts`, `src/lib/lineup/localStages.test.ts`, `src/lib/plan/read.test.ts`

**Interfaces:**
- Produces:

```ts
// choose.ts — a third argument; behaviour unchanged
export function choose(lineUp: LineUp, stage: StageName, providerId: string | null, input: ComposeInput): Choice;
// read.ts
export function providersIn(plan: RunPlan): readonly AnyProvider[];                 // distinct, in unit order
export function unitFor(plan: RunPlan, stage: RunStage): PlannedUnit;
export function transcriptionProvider(plan: RunPlan): AnyProvider;                  // the run's identity where one id is asked for
/** The catalog-only question the old `runOf` answered for code that has no providers at hand: the host that runs this line-up, or null. */
export function soleHost(lineUp: Pick<LineUp, RunStage>): string | null;
```

`choose`: the group is the chosen option's `joint` when it includes the stage, else the stage alone; a stage whose previous option lost a partner of its `joint` goes to `hostDefaults(chosen.host)`; then, when `compose(next, input)` refuses, every stage outside the group goes to `hostDefaults(chosen.host)`. `localStagesOf(lineUp)` answers from `soleHost(lineUp) === 'local_inference'`. `soleHost` composes with every `CAPS` host treated as present, through catalog data only (it must not import the registry).

Every other former `runOf` caller: `run.ok && run.provider` becomes `soleHost(lineUp)`.

- [ ] **Step 1: Add the tests.** In `choose.test.ts`, the property that pins "no visible change", written before `runOf` is deleted and kept afterwards against a frozen copy of the old function placed in the test file (`oldChoose`, copied verbatim from `main` with its `runOf`):

```ts
it('moves exactly the stages the old rule moved, for every line-up and every choice', () => {
  for (const from of everyRunnableLineUp()) for (const stage of RUN_STAGES) for (const c of CAPS) {
    if (!c.stages.includes(stage)) continue;
    expect(choose(from, stage, c.id, allPresent)).toEqual(oldChoose(from, stage, c.id));
  }
});
```

In `read.test.ts`: `soleHost` equals the old `runOf` answer for every triple of ids.

- [ ] **Step 2: Run** `npx vitest run src/lib/lineup src/lib/plan`. Expected: FAIL (`choose` takes three arguments; `read.ts` missing).
- [ ] **Step 3: Implement**, then delete `runOf` and `RunTarget`. `lineUpStore.chooseNow` passes `{ providers: presentProviders(), settings: (id) => useProviderStore.getState().entries[id]?.settings }`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run`. Expected: PASS; `git grep -n "runOf\|familyDefaults\|\.family\b\|\.binds\b" -- src ':!*.test.*'` prints nothing.
- [ ] **Step 5: Commit** `refactor(lineup): choices and the local stages follow the composer`.

**Part A ends here: open PR A.** It changes no behaviour and no consumer of a session.

---

# Part B — the run reads the plan

### Task B1: `RunShape` carries a plan and its accounts

**Files:**
- Modify: `src/lib/session/types.ts`, `src/lib/session/shape.ts`, `src/lib/session/appShape.ts`, `src/lib/plan/testing.ts`
- Test: `src/lib/session/shape.test.ts` (existing), every test that builds a `RunShape` (24 files: `git grep -l "RunShape\|readShapeFromStores" -- 'src/**/*.test.ts' 'src/**/*.test.tsx'`)

**Interfaces:**
- Produces:

```ts
// types.ts — `provider`, `settings`, `credentials` leave RunShape
export interface PlanAccount { settings: unknown; credentials: Readonly<Record<string, string>> }
export interface RunShape {
  plan: RunPlan;
  /** Settings and saved credential values at start, by provider id: every provider in the plan. */
  accounts: Readonly<Record<string, PlanAccount>>;
  // pair, legs, turnMode, textOnly, participantSpeech, faceToFace, keepReplayAudio, shared, auth, account, payer, frames: unchanged
}
// read.ts
export function accountOf(shape: Pick<RunShape, 'accounts'>, p: Pick<AnyProvider, 'id'>): PlanAccount;   // throws on a provider not in the plan
// shape.ts
export type Speaking = Pick<UnitCapabilities, 'speech' | 'participantSpeech'>;   // participantSpeech now a boolean
export type GateInput = Pick<RunShape, 'plan' | 'accounts' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'faceToFace' | 'account' | 'payer'>>;
// testing.ts
export function shapeWith(p: AnyProvider, rest: Omit<RunShape, 'plan' | 'accounts'> & { settings?: unknown; credentials?: Record<string, string> }): RunShape;
```

Which unit answers what, fixed here for every later task:

| Question | Asked of |
|---|---|
| does a leg speak (`legSpeaks`, `speakFor`, `languageContext`) | `unitFor(plan, 'speech')` capabilities |
| turn modes offered; `boundaries`; `textInput` | `unitFor(plan, 'transcription')` capabilities |
| `faceToFace` | `unitFor(plan, 'transcription')` capabilities |
| sources, the reverse of a pair | the transcription provider's `languages` |
| targets | the translation provider's `languages` |
| balance floor (`minimumBalance`), `prepare`, `acquire` | each of `providersIn(plan)` that has the hook |

`gate`, `balanceRefusal`, `contextsFor` keep their codes, messages and order. `balanceRefusal` takes the highest floor among the plan's providers (one in this step).

- [ ] **Step 1: Change the types**, run `npx tsc --noEmit`, and let the errors list the sites.
- [ ] **Step 2: Fix `shape.ts` and `appShape.ts`** per the table. `readShapeFromStores` builds the plan with `compose` over the stored line-up (Task C1 moves that read into `planFromStores`; until then a private helper in `appShape.ts`), and returns null when it is refused or an entry has not loaded.
- [ ] **Step 3: Fix the test fixtures** with `shapeWith` / `planOf`. No `expect` changes.
- [ ] **Step 4: Run** `npx vitest run src/lib/session`. Expected: the files that only build shapes PASS; `run.test.ts` and `runner.test.ts` still fail to compile (Task B2).
- [ ] **Step 5: Commit** `refactor(session): a run's shape holds a plan and its accounts` (with Task B2; the tree does not compile between them, so the two land as one commit).

### Task B2: the composite adapter, and the run calls it

**Files:**
- Create: `src/lib/plan/composite.ts`
- Modify: `src/lib/session/run.ts` (the start sequence `:187-360`, `:509`, `:549`, the reconnect events `:585-837`), `src/lib/session/runner.ts:220-288`
- Test: `src/lib/plan/composite.test.ts`, `src/lib/contract/conformance.ts` users, `src/lib/session/run.test.ts`, `runner.test.ts` (existing)

**Interfaces:**
- Consumes: `RunPlan`, `PlannedUnit` (A1); `accountOf`, `providersIn`, `unitFor`, `transcriptionProvider` (A4, B1); `StartRequest`, `AdapterEvents`, `AdapterSession` (`src/lib/contract/adapter.ts`).
- Produces:

```ts
/** One leg's configs: one per unit of the plan, keyed by `PlannedUnit` identity. */
export type PlanConfigs = ReadonlyMap<PlannedUnit, unknown>;
export function buildPlan(plan: RunPlan, context: SessionContext, shape: Pick<RunShape, 'accounts'>, shared: SharedSettings): PlanConfigs | ProviderRefusal;
export function describePlan(plan: RunPlan, configs: PlanConfigs): { asrModel?: string; translationModel?: string; ttsModel?: string };
/** The adapter contract over a plan. `credentials` answers each unit's own `K`. */
export function startComposite(plan: RunPlan, request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown>, events: AdapterEvents): Promise<AdapterSession>;
```

Step-1 behaviour, exact: with one unit, `startComposite` calls that unit's `start` with `{ ...request, config: configs.get(unit), credentials: credentials(unit) }` and **the same `events` object**, and returns the session it returns, unwrapped. No ref mapping, no event tagging: those arrive with the second unit (step 2). With more than one unit it throws `AdapterStartError('A plan of several units cannot start yet.', 'plan_unsupported')`; `compose` cannot produce one in this step.

`describePlan` takes `asrModel` from the transcription unit, `translationModel` from the translation unit, `ttsModel` from the speech unit.

In `run.ts`, in today's order and with today's notices:
- credentials, readiness (`ensureReady`), `session.prepare`, `session.acquire`: once per provider of `providersIn(plan)`. `prepare`'s `override` merges into that provider's account; `persistIfUnchanged` is called with that provider.
- `build`: `buildPlan` per leg. `session.admit`: for each provider that has the hook, over that provider's unit configs.
- `session.startBoth`: used when the plan has one unit and its provider has the hook (today's rule, restated). Otherwise `startComposite` per leg.
- `describe` → `describePlan`. `textInput` → the transcription unit's capability.
- Every `shape.provider.id` used as an identity (telemetry, `host.conversations`, the reconnect events, error reports) → `transcriptionProvider(shape.plan).id`.

`runner.ts`: `ensureReady(shape, signal)` becomes `ensureReady(provider, shape, signal)`, called per provider; `ensureReadyFromStores` in `appShape.ts` follows.

- [ ] **Step 1: Write `composite.test.ts`:** (a) one unit: `start` called once with the unit's config and credentials; the returned session **is** the unit's (`toBe`); an event the unit emits reaches `events` with the same payload object; (b) `buildPlan` returns the unit's refusal unchanged; (c) `describePlan` over a one-unit plan equals the unit's `describe`; (d) a two-unit plan rejects with code `plan_unsupported`.
- [ ] **Step 2: Add a conformance run.** Wherever a provider's test calls the conformance suite with its adapter, add one call through `startComposite(planOf(provider), …)` for the fake provider (`src/providers/fake`): the suite passes over the composite as it does over the adapter.
- [ ] **Step 3: Run** `npx vitest run src/lib/plan/composite.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `composite.ts`, then `run.ts` and `runner.ts`.
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run`. Expected: PASS, no expectation edited. Then the E2E suite in this worktree (`npm run e2e:build && npm run e2e`). Expected: PASS.
- [ ] **Step 6: Commit** (with Task B1) `refactor(session): a run starts its plan through the composite adapter`.

**Part B ends here: open PR B.**

---

# Part C — stores and surfaces read the plan

### Task C1: the plan from the stores, and `useSelectedProvider` over it

**Files:**
- Create: `src/lib/plan/fromStores.ts`
- Modify: `src/components/providers/useSelectedProvider.ts`, `src/lib/session/appShape.ts` (`selectedFromStores` and its callers)
- Test: `src/lib/plan/fromStores.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanState =
  | { state: 'loading' }                              // no line-up yet, or an entry of the plan has not loaded
  | { state: 'refused'; refusal: PlanRefusal }
  | { state: 'ready'; plan: RunPlan; accounts: Readonly<Record<string, PlanAccount & { pair: LanguagePair }>> };
export function planFromStores(): PlanState;
export function usePlan(): PlanState;                 // re-renders when the line-up or an entry of the plan changes; same object while neither does
export function useStageUnit(stage: RunStage): { provider: AnyProvider; unit: UnitDefinition; settings: unknown; capabilities: UnitCapabilities } | null;
```

Before a line-up is stored (`lineUpStore.stored === false`): the plan is that of `lineUpStore.lineUp` as shown (the migration's values), as a session resolves today.

`selectedFromStores()` and `useSelectedProvider()` keep their names and return shapes in this task and answer `transcriptionProvider(plan)` and its entry. They are the compatibility seam: Task C2 moves their callers to the right unit; Task C5 deletes what is left.

- [ ] **Step 1: Write the tests:** loading before the line-up; loading while the plan's provider entry is absent; refused for an incomplete line-up; ready with the provider and its entry; `usePlan` keeps identity across an unrelated provider's settings change.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**; move `readShapeFromStores`' private helper (B1) onto `planFromStores`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(plan): read the plan from the stores`.

### Task C2: each surface asks the unit that owns the answer

**Files (modify), by what they ask:**
- Speech unit: `src/components/MainPanel/useHearingRows.ts:19-23`, `src/components/Settings/sections/SpeechOutputSection.tsx:47-63,89-93`, `src/components/MainPanel/ModeDevicePopover.tsx:235,273`, `src/components/providers/openTtsSlot.ts`, `src/lib/session/appShape.ts` (`speechFromStores`, `speechInputsFromStores`).
- Transcription unit: `src/components/Settings/sections/SpeechSection.tsx:24,73-91`, `src/lib/view/appViewSettings.ts:63-66`, `src/components/MainPanel/MainPanel.tsx:184-188,267`, `src/components/MainPanel/useFaceToFace.ts:32-49`, `src/lib/session/appShape.ts` (`faceToFaceFromStores`, `screenContextWanted`, `turnScreenContextOff`), `src/components/Settings/sections/SentenceSegmentationSection.tsx`.
- Languages: `src/components/providers/ProviderLanguages.tsx:32-61`, `src/components/Settings/sections/LanguagePairSection.tsx:122-123,153,260-266`, `src/lib/reading/useReadingTargets.ts`.
- Every provider of the plan: `src/components/TitleBar/useBalanceShortfall.ts:21-40`, `src/lib/subtitle/appSession.ts:32-48`, `src/components/Region/*`, `src/components/SettingsPage/ModelsPage.tsx:104-108`.
- Identity (the transcription provider's id): `src/app/captionShare.ts`, `src/lib/share/url.ts`, `src/components/CaptionShare/CaptionSharePanel.tsx`, `src/components/History/HistoryList.tsx`, `src/lib/history/historyPageStore.ts`, `src/components/Tour/useStartBasicsTour.ts`, `src/components/VbCable/VbCableIntro.tsx`, `src/components/SettingsPage/DisplayCategory.tsx`, `src/components/Settings/sections/ModelImportModal.tsx`.
- Test: the existing test beside each file.

**Interfaces:**
- Consumes: `usePlan`, `useStageUnit`, `planFromStores` (C1); the table in Task B1.
- Produces: nothing new.

Rule for a file not listed that reads the selected provider (`git grep -n "useSelectedProvider\|selectedFromStores\|\.selected\b" -- src ':!*.test.*'`): find what it asks and use the table in Task B1; an identity read uses the transcription provider.

- [ ] **Step 1:** One commit per group above, each: change the reads, run the tests beside the changed files, expect PASS with fixtures-only edits.
- [ ] **Step 2: Run** `npx tsc --noEmit && npx vitest run`. Expected: PASS.
- [ ] **Step 3: Commit** per group, `refactor(<area>): read the <speech|transcription> unit from the plan`.

### Task C3: readiness for every provider of the plan

**Files:**
- Modify: `src/app/readiness.ts:50-124`, `src/lib/subtitle/appSession.ts` (`canStart` inputs), `src/lib/view/noticeTargets.ts:16-18`, `src/components/SettingsPage/AccountsCategory.tsx:85-87`
- Test: `src/app/readiness.test.ts` (existing, plus new cases)

**Interfaces:**
- Consumes: `planFromStores`, `providersIn`.
- Produces: `driveReadiness` checks each provider of the current plan under today's timing rules, keyed per provider (`cancel`, `pendingAtOnce`, `watched`, `seen`, `stale` become maps by provider id). Start needs every one `ready`. A notice `credentials_missing` / `sign_in_required` carries `params.provider` (the id it is about) and opens that provider's account row; absent, the transcription provider's.

- [ ] **Step 1: Add tests** over a two-provider plan built by hand (`{ units: [a, b], byStage: … }`, injected through the driver's new `plan()` dependency): both are checked; a key edit on `b` re-checks only `b` after `NETWORK_READINESS_DELAY_MS`; a sign-in flip forgets and re-checks every managed one; nothing is checked while a run is not idle, and the stale ones are checked once idle (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run src/app/readiness.test.ts`. Expected: the new cases FAIL, the existing ones PASS.
- [ ] **Step 3: Implement.** `ReadinessDriverDeps` gains `plan(): RunPlan | null` (the app passes `planFromStores`' ready plan).
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS, existing expectations unedited.
- [ ] **Step 5: Commit** `refactor(readiness): check every provider of the plan`.

### Task C4: the line-up is what is stored; the selection is derived

**Files:**
- Modify: `src/stores/lineUpStore.ts` (`load`, `chooseNow`, `replace`), `src/stores/providerStore.ts` (`selected`, `select`, the write at `:213-215`), `src/app/loadStores.ts`, `src/lib/lineup/migrate.ts`
- Test: `src/stores/lineUpStore.test.ts`, `src/stores/providerStore.test.ts` (existing, plus new cases)

**Interfaces:**
- Produces: `providerStore.selected` and `select()` are removed. `lineUpStore.load()` reads `settings.common.provider` itself, once, for the migration only. After every successful write of a line-up, `settings.common.provider` is written with `soleHost(lineUp)` when it is not null (the downgrade rule in Global Constraints).

`load()`, exactly:
1. A stored line-up this build composes → used. (Today's "the provider is the newer choice" rule at `lineUpStore.ts:98-105` is dropped: nothing else writes a provider any more. It still applies **once**, when the stored `settings.common.provider` differs from `soleHost(stored)` **and** the line-up was last written by a version that did not write the provider with it; tell the two apart by a new field `StoredLineUp.version: 2`. A version-1 value is read with the old rule and rewritten as version 2.)
2. A stored value this build cannot use (unknown ids, a refusal from `compose`) → shown as today's values from `settings.common.provider`, `stored: false`, never overwritten (Review Focus 1 and 2).
3. Nothing stored → today's migration (`lineUpFromToday`), unchanged.

- [ ] **Step 1: Add tests:** a version-2 line-up wins over a different `settings.common.provider`; a version-1 line-up beside a different provider is rebuilt from the provider and rewritten as version 2; a line-up `compose` refuses is shown as today's values and storage is untouched; an id of a provider not offered here does not throw; a successful choice writes both keys; a failed write undoes the line-up and writes neither.
- [ ] **Step 2: Run** `npx vitest run src/stores`. Expected: new cases FAIL.
- [ ] **Step 3: Implement.** Remove `selected` / `select` and fix what `tsc` lists with `planFromStores` or `usePlan`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run`, then the E2E suite. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(stores): the stored line-up decides what runs`.

### Task C5: the lock belongs to the line-up; remove the seam

**Files:**
- Modify: `src/stores/providerStore.ts` (`selectionLocked`, `setSelectionLocked`), `src/stores/lineUpStore.ts`, `src/app/session.ts:618-630`, `src/components/providers/useSelectedProvider.ts` (delete), `src/lib/session/appShape.ts` (`selectedFromStores` delete)
- Test: `src/stores/lineUpStore.test.ts`, `src/app/session.test.ts`

**Interfaces:**
- Produces: `lineUpStore.locked: boolean`, `lineUpStore.setLocked(locked: boolean)`. `choose` and `replace` answer `null` / `false` while locked, as today. `providerStore.updateSettings` and `setCredential` keep whatever lock they apply today, reading `useLineUpStore.getState().locked`.

- [ ] **Step 1: Add the test** (Review Focus 3): a choice saved while a run is starting — the run's frozen `shape.plan` is the one from before; when the write fails after the lock is on, the undo waits for the unlock, then restores the line-up.
- [ ] **Step 2: Run** it. Expected: FAIL (`locked` missing).
- [ ] **Step 3: Implement**; delete `useSelectedProvider.ts` and `selectedFromStores`; `git grep -n "selectionLocked\|useSelectedProvider\|selectedFromStores" -- src` prints nothing.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run`, then the E2E suite. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(stores): the line-up is locked while a run is not idle`.

**Part C ends here: open PR C.**

---

# Part D — records name the stages

### Task D1: conversations, History, export and telemetry carry `stages`

**Files:**
- Modify: `src/lib/session/run.ts:343` (`host.conversations`), the `ConversationInfo` type, `src/lib/history/capture/{writer.ts:227-250,facts.ts:39}`, `src/lib/export/exporter.ts:77-87,125`, `src/app/telemetry.ts:144-152,218-223`, `src/lib/analytics.ts` (event types)
- Test: the existing tests beside each

**Interfaces:**
- Produces:

```ts
/** The line-up id that served each run stage, e.g. { transcription: 'local_inference', translation: 'bing', speech: 'edge' }. */
export type StageIds = Readonly<Record<RunStage, string>>;
interface ConversationInfo { provider: string; stages: StageIds; models: {…} }   // `provider` stays: the transcription provider's id
```

History's `services` gains `stages`; a record written before this has none, and every reader treats an absent `stages` as "all three by `provider`". Exports print what they print today. `translation_session_start.stages` is always sent (today it is left out when the line-up and the selection disagree, which can no longer happen); every other event keeps its `provider` property unchanged.

- [ ] **Step 1: Add tests:** a History record of a local run with Bing and Edge stores `stages` as in the example; a record without `stages` reads as all three by `provider`; `translation_session_start` carries `stages` for an end-to-end provider.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `StageIds` come from the line-up frozen at start: add `lineUp: Pick<LineUp, RunStage>` to `RunShape` in `readShapeFromStores` (and to `shapeWith`, defaulting to the provider's id on all three).
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run`, then the E2E suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(history): a record names the provider of each stage`.

**Part D ends here: open PR D.** Step 1 of the spec is complete when it merges.

---

## Decisions made while Part A was built

They replace the text of Tasks A3 and A4 where the two differ; Parts B to D build on them.

- **The present providers reach a store through a hook, never an import of the registry.** `src/lib/plan/present.ts` has `registerPresentProviders(read)` and `presentHosts()`; the registry registers itself at the end of its module, and `presentHosts()` throws when nothing is registered. A store that imports the registry closes an import cycle (the registry loads the local provider, which reads the line-up store). `fromStores.ts` (Task C1) uses `presentHosts()`.
- **`soleHost` and `optionFor` live in `src/lib/lineup/catalog.ts`.** They are catalog questions; `src/lib/plan/read.ts` holds `providersIn`, `unitFor`, `transcriptionProvider`. Under `src/lib/lineup/` only `choose.ts` imports from `src/lib/plan/`.
- **`soleHost` is pure catalog**: all three stages name a known option that serves them, and the three share one host. It does not call `compose`. A test pins it to the rule it replaced, for every triple of ids.
- **A choice follows the catalog when a provider is not offered.** `choose` moves the other stages when `compose` refuses, except that a refusal only for presence (`lineup_not_offered`) moves them exactly when `soleHost` of the new line-up is null. The rule it replaced never looked at presence.
- **`lineup_no_unit` names the first stage of the host that could not serve**, not of the smallest group.
- **The rule as it was** (`oldRunOf`, `oldChoose`) is kept in `src/lib/lineup/oldRules.testing.ts`, for the property tests only. It reads today's catalog, so it pins the rule, not the catalog's data.
- **The type check** has errors in a local worktree that do not come from this work (library typings); the gate used locally is "none in a touched file, and the count does not rise". CI's own check decides.

---

## What this step leaves for step 2

- `compose` and `soleHost` can disagree once a provider has several units: `soleHost`'s callers move to the plan then.
- `noUnit`'s split attribution when one host has several options with a `joint` (none has today).
- `startComposite` over more than one unit: ref mapping, event tagging, the wiring of §7 of the spec.
- Composer checks 3 to 5 inside `compose`; refusal words on the line-up card and on Start; removal of `settingsPage.lineup.moved`.
- `units` on provider definitions; options ownership on a card by unit (`LineUpCategory.tsx:197-209`).
- The language lists as an intersection (one provider's lists today).
