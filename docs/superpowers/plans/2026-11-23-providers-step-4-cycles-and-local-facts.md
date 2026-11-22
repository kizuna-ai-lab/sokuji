# Provider refactor, step 4: no type cycles, and the local provider handed its facts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The types a run is made of live in one module, `src/lib/run/types.ts`, that imports no provider, plan or session module. No import cycle, of types or of values, passes through the provider definition, the plan, the session or the line-up, and the line-up sits under the plan. The local provider's units, builds, check and admit read this device's models from what they are handed, never from a store.

**Architecture:**
- **The run contract** (`src/lib/run/types.ts`) holds the unit, the plan, the shape a run freezes, the session hooks and what every builder reads.
  - A plan holds providers, and a provider's hooks are handed a run's shape. So the contract names the provider by a type parameter `P`.
  - The provider definition binds it: `session?: SessionHooks<S, K, C, AnyProvider>`.
  - `plan/types.ts` and `session/types.ts` declare the bound types under their old names (`PlannedUnit`, `RunPlan`, `RunShape`, `BalanceShape`). Their 35, 32, 42 and 3 importers do not change.
- **Two more edges the measurement found are cut.**
  - `PreviewClip` moves to its own module. The provider definition reached the playback engine for it, and the engine reaches the session's ports, which import the provider definition.
  - `PlanConfigs` moves to `plan/types.ts`. `compositeLeg.ts` imported it from `composite.ts`, which imports `compositeLeg.ts`.
- **The line-up sits under the plan.** `choose` and `capsOf` are the two line-up modules that read the plan, and they move into `src/lib/plan/`.
- **`LocalModels`** is a port onto this device's models: resolution, GPU features, the first scan, and changes. `src/stores/localModels.ts` implements it over the model store. It is handed in:
  - by the run, to every builder (`SharedSettings.localModels`) and to `admit` (its new second argument);
  - by the provider store, to a local provider's check (`CheckContext.localModels`);
  - by the readiness driver, to `watchReadiness` (its new second argument).
  - After this, no module of the local provider imports a store; its views still do.
- **The measurement is a test.** `src/lib/run/types.cycle.test.ts` lists every import cycle through the five folders (type imports included), and every import of the plan by the line-up. It fails on the base with the cycles recorded at the end of this plan, and passes after.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron).

**Spec:** this document. The owner set the direction on 2026-11-22 (task #131), and it is binding. The code inventory is `docs/superpowers/plans/2026-11-22-providers-step-1-inventory.md` §6 and §7. Its line numbers predate steps 1-3, so find each place by name.
- **A.** Move the shared run-contract types (the unit, its capabilities, the planned unit, the plan, the session hooks, the shared settings, the refusal, and whatever the type checker shows they need) to one module.
  - That module imports none of `lib/provider`, `lib/plan`, `lib/session`.
  - The old modules re-export nothing they no longer own: importers are updated.
  - Resolve the folder-level cycle `lib/lineup` ↔ `lib/plan`, so that the dependency runs one way.
  - Measure the cycles before and after; the verification includes the measurement.
- **B.** The local provider's units, builds, check and admit read no store.
  - The facts they read (model resolution, the GPU features of the device budget, the check's wait for the model scan, the readiness watch) come in from the run, or, for the check, from its caller.
  - `capabilities(s).translates/speaks` stay correct. They read the static manifest (`getManifestByType`, `getTtsModelsForLanguage`), not a store, and are left alone.
  - Behaviour does not change.
- **C.** Sweep the deferred cosmetic minors of steps 1-3 that still apply, are cheap and are in scope (Task 5 lists them, and lists what is left).
- No user-visible change; no new strings; ids unchanged; stored data untouched.

## Global Constraints

- No user-visible change. No new locale strings. Ids, settings keys and stored data are untouched.
- Every local build resolves the same models, every admit judges the same budget, and every local check gives the same answer. The model store is read at the same moments as before, through the port.
- Names, fixed here:
  - `src/lib/run/types.ts`, with:
    - `PlannedUnitOf<P>`, `RunPlanOf<P>`, `RunShapeOf<P>`, `BalanceShapeOf<P>`;
    - `SessionHooks<S, K, C, P>`;
  - the bound types `PlannedUnit` and `RunPlan` (`src/lib/plan/types.ts`), and `RunShape` and `BalanceShape` (`src/lib/session/types.ts`);
  - `src/lib/audio/previewClip.ts`; `PlanConfigs` in `src/lib/plan/types.ts`;
  - `src/lib/plan/choose.ts`, `src/lib/plan/capsOf.ts`;
  - in `src/lib/local-inference/selection/types.ts`, `LocalModels`;
  - in `src/stores/localModels.ts`, `localModels`;
  - in `src/lib/local-inference/selection/localModels.testing.ts`, `fakeLocalModels`;
  - in `src/providers/localInference/config.ts`, `localModelsOf`;
  - the members `SharedSettings.localModels`, `CheckContext.localModels` and `RunnerDeps.localModels`;
  - in `src/lib/plan/importWalk.testing.ts`, `sourceFiles`, `importsOf` and `importCycles`.
- An old module re-exports nothing it no longer declares: no `export … from` is added anywhere.
  - The four bound types are declarations of their own, not shims. Each one binds the contract's type to this app's providers, which the contract cannot name without the cycle this step removes.
  - Without them, every importer would write `RunPlanOf<AnyProvider>`: 89 uses of `RunPlan`, 113 of `PlannedUnit`, 94 of `RunShape`.
- Moved files move with `git mv`.
- Type checking: the base's `npx tsc --noEmit -p tsconfig.json` count is 89 (b2461602b, 2026-11-23). After each task, no touched file has an error, and the total is not above 89.
- Test commands:
  - Before Task 1, record the base's `npx vitest run` failures.
  - `npx vitest run <paths>` for the files a task touches.
  - `npx vitest run` before each commit.
  - `npm run e2e:build && npm run e2e` in Task 6, in this worktree only. Never run vite or Electron in the main checkout.
- Commits:
  - on branch `refactor/cycles-and-local-facts`;
  - stage explicit paths;
  - end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The owner authorised (2026-11-22, task #131) opening the step 2-4 PRs directly, each stacked on the previous one. Task 6 pushes `refactor/cycles-and-local-facts` to `kizuna-ai-lab/sokuji` and opens its PR into `refactor/units-required` (`kizuna-ai-lab/sokuji`).

### Accepted differences (internal; tell the owner; do not hide)

1. **The run contract is generic in the provider.** Four bound types keep the old names (see Global Constraints).
2. **The generic API grows for one provider.**
   - `SessionHooks.admit` takes a second argument, `shared`.
   - `Provider.watchReadiness` takes a second argument, `localModels`.
   - `CheckContext`, `SharedSettings` and `RunnerDeps` gain an optional `localModels`.
   - Only the local provider reads any of them.
3. **The local check and the local builds throw when not handed `localModels`.**
   - This is unreachable in the app. The provider store hands it to every local check, and the app's runner (`app/session.ts`) hands it to every build.
   - A test that builds or checks a local unit by hand hands it (`fakeLocalModels`).
4. **The check's wait for the first model scan moves.** It moves from `check.ts` into `localModels.scanned`, as the same code.
   - `stores/providerStore.ts` now imports `stores/localModels.ts`, and through it `stores/modelStore.ts`.
   - Every module graph that holds the provider store already held the model store, through `stores/lineUpStore.ts`.
5. **Two kinds of move.**
   - Module moves: `lib/lineup/{choose,capsOf}.ts` move to `lib/plan/`.
   - Type moves: `PreviewClip` moves to `lib/audio/previewClip.ts`, and `PlanConfigs` to `lib/plan/types.ts`.
6. **One folder-level group of `src/lib` remains, and `lib/run` is in it.**
   - `lib/provider`, `lib/plan` and `lib/session` were already in it. One of the edges that hold `lib/run` in it is `lib/contract/reconnect.ts` → `lib/session`.
   - `lib/lineup` leaves it.
   - No module-level cycle remains in any of the five folders.

## Review Focus

1. **A start pressed before the model scan finishes.**
   - Today the local check waits for the scan, then the build reads the scanned store.
   - It would break if the run froze the models before readiness, or if `scanned` skipped its wait. The build would then find no model and refuse with `no_asr`.
   - The run hands the live port, read when built, after readiness.
   - Pinned in Task 3: `localModels.test.ts`'s `scanned` cases.
   - Pinned in Task 4: `check.test.ts`'s `waits for this device's models to be scanned, with the start's signal, before it resolves anything`.
2. **A provider that is not local.**
   - If every check were handed the device's models, an own-key check's context would change.
   - Its exact-context case, `passes what read returned, the settings, and the pair, to check`, pins that it is not.
   - Pinned in Task 3: `hands a local provider's check this device's models, and no other kind's`.
3. **The local provider as one unit of a mixed plan** (its voice alone, its translation alone, its recognition alone).
   - Each `admit` path must read the GPU features from what the run hands it.
   - Pinned in Task 4: `provider.test.ts`'s admit cases hand `{ localModels }` and assert the features reach `fitsBudget` and `admitLocalInference`.
4. **The tests that mock the model store.**
   - Ten view, store and app tests mock `useModelStore` with a factory that names only what they use (`ProviderPicker`, `lineUpStore`, `loadStores.lineup`, the four local views' tests and three more).
   - The port forwards to `useModelStore` from a module of its own, so those mocks keep serving the local reads.
   - Had the port been an export of `modelStore.ts`, those factories would lack it, and any readiness path reaching it would throw.
   - Pinned by the full suite in Tasks 3 and 4, with no view test edited.
5. **A cycle coming back.** A run-contract type that names `AnyProvider`, or a line-up module that imports the plan, recloses one.
   - Pinned in Tasks 1 and 2: `types.cycle.test.ts`.

---

### Task 1: The run contract, and no type cycle through the provider definition, the plan or the session

**Files:**
- Create: `src/lib/run/types.ts`.
  - Its header comment:

```ts
// src/lib/run/types.ts
//
// The run contract: what a provider declares for a run (its units and its session hooks) and what a run hands it
// (the settings every builder reads, the shape a run froze at its start, its plan). Types only. It imports no
// provider, plan or session module: they import it. The plan and the shape name the providers they hold by a type
// parameter, `P`, which the provider definition (`src/lib/provider/types.ts`) and the modules above it bind.
```

  - Then these declarations, cut from their modules with their doc comments, in this order:
    - from `src/lib/provider/types.ts`: `LanguagePair`, `AuthContext`, `ModelOption`, `SharedSettings`, `SessionWords`, `ProviderRefusal`;
    - from `src/lib/plan/types.ts`: `UnitCapabilities`, `UnitDefinition`, `PlannedUnit`, `RunPlan`;
    - from `src/lib/session/types.ts`: `TurnMode`, `AccountState`, `PayerWallets`, `Payer`, `PlanAccount`, `RunShape`, `RunNotice`, `Prepared`, `BalanceShape`, `Budget`, `Resources`, `LeaseContext`, `AdmittedConfigs`, `SessionHooks`, `EndReason`.
  - Rename and generalise these, and change nothing else:
    - `PlannedUnit` → `PlannedUnitOf<P>`, with `provider: P`. Add to its doc: "`P`: the provider definition, bound where it is known (`PlannedUnit`, `src/lib/plan/types.ts`)."
    - `RunPlan` → `RunPlanOf<P>`, over `PlannedUnitOf<P>`.
    - `RunShape` → `RunShapeOf<P>`, with `plan: RunPlanOf<P>`.
    - `BalanceShape` → `BalanceShapeOf<P> = Pick<RunShapeOf<P>, 'legs' | 'textOnly' | 'participantSpeech'> & Partial<Pick<RunShapeOf<P>, 'faceToFace' | 'plan'>>`.
    - `SessionHooks<S, K, C>` → `SessionHooks<S, K, C, P>`. `prepare` and `acquire` take `shape: RunShapeOf<P>`, and `minimumBalance` takes `shape: BalanceShapeOf<P>`.
  - Its imports, all `import type`:
    - `Adapter`, `AdapterEvents`, `AdapterFrame`, `AdapterSession`, `FrameSource`, `SessionContext`, `StartRequest` (`../contract/adapter`);
    - `Clock` (`../contract/clock`);
    - `SpeechEvents`, `SpeechSession`, `SpeechStartRequest` (`../contract/speech`);
    - `TranslationEvents`, `TranslationSession`, `TranslationStartRequest` (`../contract/translation`);
    - `LegName` (`../conversation/types`);
    - `RunStage`, `StageIds` (`../lineup/types`);
    - `WordEntry` (`../words/list`).
- Modify: `src/lib/plan/types.ts`.
  - Its imports become `RunStage` (`../lineup/types`), `AnyProvider` (`../provider/types`), and `PlannedUnitOf`, `RunPlanOf`, `UnitDefinition` (`../run/types`).
  - It declares, after its imports:

```ts
/** A unit chosen for a run of this app's providers (`PlannedUnitOf`). */
export type PlannedUnit = PlannedUnitOf<AnyProvider>;

/** Which unit of this app's providers serves which stage of one run (`RunPlanOf`). */
export type RunPlan = RunPlanOf<AnyProvider>;
```

  - `PlanConfigs` moves here from `src/lib/plan/composite.ts`, with its doc, after `RunPlan`. `composite.ts` imports it from `./types`.
  - Its header says: "The run plan of this app's providers: which planned unit serves each stage, the configs one leg built for them, and why a plan is refused. The unit and the plan's shape are the run contract's (`src/lib/run/types.ts`); this module binds them to `AnyProvider`. Types and small checks on them; the composer that builds a plan lives elsewhere."
- Modify: `src/lib/session/types.ts`.
  - Its imports become `LegName` (`../conversation/types`), `AnyProvider` (`../provider/types`), and `BalanceShapeOf`, `Budget`, `EndReason`, `Payer`, `RunNotice`, `RunShapeOf` (`../run/types`).
  - It declares `export type RunShape = RunShapeOf<AnyProvider>;` with the doc "Everything a run of this app's providers reads, frozen once at start (`RunShapeOf`)."
  - It declares `export type BalanceShape = BalanceShapeOf<AnyProvider>;` with the doc "What a managed provider's start floor depends on, in a run of this app's providers (`BalanceShapeOf`)."
  - Its header says: "The runner's vocabulary (spec: "Session lifecycle"): how a run stands and how it ended, and the shape of a run of this app's providers. What a provider's hooks are handed is the run contract's (`src/lib/run/types.ts`). Types only."
- Modify: `src/lib/provider/types.ts`.
  - It imports `AuthContext`, `LanguagePair`, `ModelOption`, `SessionHooks`, `SessionWords`, `UnitDefinition` from `../run/types`, and `PreviewClip` from `../audio/previewClip`.
  - Drop the now-unused `StageIds`, `SessionContext` and `WordEntry` imports.
  - `session?: SessionHooks<S, K, C, AnyProvider>;`.
- Create: `src/lib/audio/previewClip.ts`.
  - It holds `PreviewClip`, cut from `src/lib/audio/playback.ts` with its doc.
  - Header: "A clip a preview plays: its own module, so the provider definition (`PreviewPort`) names it without reaching the playback engine. Types only."
  - `playback.ts` imports it.
- Modify every importer of a moved name, so it imports the name from its new module. Run Appendix A's codemod (`reimport.cjs`) from the scratch directory, in this order:

```bash
node reimport.cjs src lib/run/types.ts lib/provider/types.ts,lib/plan/types.ts,lib/session/types.ts LanguagePair,AuthContext,ModelOption,SharedSettings,SessionWords,ProviderRefusal,UnitCapabilities,UnitDefinition,TurnMode,AccountState,PayerWallets,Payer,PlanAccount,RunNotice,Prepared,Budget,Resources,LeaseContext,AdmittedConfigs,SessionHooks,EndReason
node reimport.cjs src lib/audio/previewClip.ts lib/audio/playback.ts PreviewClip
node reimport.cjs src lib/plan/types.ts lib/plan/composite.ts PlanConfigs
```

  - The first run rewrites 188 files, the second 6, and the third 15.
  - `PlannedUnit`, `RunPlan`, `RunShape` and `BalanceShape` are not on the list: their importers keep importing them where they are.
- Modify: the five places that write `SessionHooks` with three arguments add `AnyProvider` as the fourth, importing it where they do not:
  - `src/lib/provider/managed.ts` (two uses, and the import);
  - `src/lib/provider/managed.test.ts`;
  - `src/lib/session/run.plan.test.ts` (two uses);
  - `src/lib/session/run.test.ts` (and the import);
  - `src/lib/session/runner.hooks.test.ts`.
- Modify: `src/lib/plan/importWalk.testing.ts`. Add `sourceFiles`, `importsOf` and `importCycles` (Interfaces). Its header adds: "`importsOf` keeps type-only imports: a cycle of types is a cycle."
- Create: `src/lib/run/types.cycle.test.ts`.
- Modify: `CLAUDE.md`.
  - Under Provider Architecture, "(… its `Settings` view; typed by `src/lib/provider/types.ts`)" becomes "(… its `Settings` view; typed by `src/lib/provider/types.ts`, its units and session hooks by the run contract, `src/lib/run/types.ts`)".
  - "Adding a New AI Provider" item 1 gets the same addition after "typed by `src/lib/provider/types.ts`".

**Interfaces:**
- Produces:
  - `src/lib/run/types.ts`:
    - `PlannedUnitOf<P> { provider: P; unit: UnitDefinition; stages: readonly RunStage[] }`;
    - `RunPlanOf<P> { units: readonly PlannedUnitOf<P>[]; byStage: Readonly<Record<RunStage, PlannedUnitOf<P>>> }`;
    - `RunShapeOf<P>`, `BalanceShapeOf<P>`, `SessionHooks<S, K, C, P>`;
    - and, unchanged, every other name listed under Files.
  - `src/lib/plan/types.ts`: `PlannedUnit`, `RunPlan`, `PlanConfigs`.
  - `src/lib/session/types.ts`: `RunShape`, `BalanceShape`.
  - `src/lib/audio/previewClip.ts`: `PreviewClip`.
  - `src/lib/plan/importWalk.testing.ts`:
    - `sourceFiles(dir: string = SRC): string[]`. Every `.ts`/`.tsx` under `dir`, recursively, absolute, except `*.d.ts`, `*.test.*` and `*.testing.*`.
    - `importsOf(file: string): string[]`. The files `file` imports by a relative specifier, `import type` included (the module's `STATIC` matches without the type filter, plus `DYNAMIC`), resolved by `resolveFrom`, each once.
    - `importCycles(): string[][]`. The strongly connected groups of more than one file in the graph `sourceFiles()` → `importsOf` (Tarjan), each a sorted list of paths relative to `SRC`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/run/types.cycle.test.ts
//
// The run contract (types.ts here) sits under the provider definition, the plan and the session: they import it, it
// imports none of them, and no import cycle — of types or of values — passes through any of them or the line-up.
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importCycles, importsOf, SRC } from '../plan/importWalk.testing';

const rel = (files: readonly string[]) => files.map((f) => relative(SRC, f));
const FOLDERS = ['lib/run/', 'lib/provider/', 'lib/plan/', 'lib/session/', 'lib/lineup/'];

describe('the import rules of the run contract', () => {
  it('the run contract imports no provider, plan or session module', () => {
    expect(rel(importsOf(resolve(SRC, 'lib/run/types.ts'))).filter((f) => /^lib\/(provider|plan|session)\//.test(f))).toEqual([]);
  });
  it('no import cycle, type imports included, passes through the run contract, the provider definition, the plan, the session or the line-up', () => {
    expect(importCycles().filter((group) => group.some((f) => FOLDERS.some((folder) => f.startsWith(folder))))).toEqual([]);
  });
  it('the walk follows type imports: the provider definition imports `WireTable` for its type alone', () => {
    expect(rel(importsOf(resolve(SRC, 'lib/provider/types.ts')))).toContain('lib/language/wire.ts');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/run`. Expected: 2 failed, 1 passed. These two failures are the "before" measurement:
  - `ENOENT … src/lib/run/types.ts`.
  - Two groups:
    - `lib/analytics.ts`, `lib/audio/playback.ts`, `lib/plan/types.ts`, `lib/provider/types.ts`, `lib/session/orgNotice.ts`, `lib/session/ports.ts`, `lib/session/reconnect.ts`, `lib/session/reconnectEvents.ts`, `lib/session/types.ts`;
    - `lib/plan/composite.ts`, `lib/plan/compositeLeg.ts`, `lib/plan/compositeStages.ts`.
- [ ] **Step 3:** Make the changes listed under Files.
  - Create the module, then trim the three modules and set their imports.
  - Then move `PreviewClip` and `PlanConfigs`, then run the codemod.
  - Then add the fourth argument to `SessionHooks`, then edit `CLAUDE.md`.
- [ ] **Step 4:** Verify.
  - `npx tsc --noEmit -p tsconfig.json`: no new error, and the total is at most 89.
  - `git grep -nE "^export (type )?\{|^export \*" -- src/lib/provider/types.ts src/lib/plan/types.ts src/lib/session/types.ts src/lib/audio/playback.ts` prints nothing.
  - Run `npx vitest run src/lib/run src/lib/plan src/lib/lineup src/lib/session src/lib/provider src/lib/audio src/providers/registry.test.ts`. Expected: PASS.
  - Then run `npx vitest run`. Expected: no new failures, and no expectation edited.
- [ ] **Step 5:** Commit `refactor(run): the run contract in one module under the provider definition, the plan and the session; no type cycle through them (provider refactor, step 4)`.

### Task 2: The line-up under the plan

**Files:**
- Move:
  - `git mv src/lib/lineup/choose.ts src/lib/plan/choose.ts`, and its `choose.test.ts` beside it;
  - `git mv src/lib/lineup/capsOf.ts src/lib/plan/capsOf.ts`, and its `capsOf.test.ts` beside it.
  - In the four moved files, the relative imports follow:
    - `../lineup/…` for the line-up's catalog, types and `catalog.testing`;
    - `./…` for the plan's `compose`, `choice`, `types`, `wholeUnit` and `testing`.
  - Their header path comments name their new path.
- Modify:
  - `src/lib/plan/choice.ts` and `src/lib/plan/choice.test.ts`: `choose` comes from `./choose`.
  - `src/stores/lineUpStore.ts`: from `../lib/plan/choose`.
  - `src/providers/registry.ts`: `catalogOf` from `../lib/plan/capsOf`.
- Modify: `src/lib/lineup/catalog.cycle.test.ts`. Its two `lib/lineup/capsOf.ts` become `lib/plan/capsOf.ts`.
- Modify the docs that name `capsOf.ts` by its old place:
  - `src/lib/lineup/types.ts` (`ProviderCaps`'s doc: "`capsOf` (`src/lib/plan/capsOf.ts`)");
  - `src/lib/lineup/catalog.ts` (header: "(`catalogOf`, `src/lib/plan/capsOf.ts`)").
- Test: `src/lib/run/types.cycle.test.ts`.

**Interfaces:**
- Consumes: Task 1's `sourceFiles` and `importsOf`.
- Produces: `choose`, `Choice` from `src/lib/plan/choose.ts`; `capsOf`, `catalogOf`, `occupationsOf` from `src/lib/plan/capsOf.ts`. Signatures are unchanged.

- [ ] **Step 1: Write the failing test** (`types.cycle.test.ts`, and import `sourceFiles`):

```ts
it('the line-up imports nothing of the plan: the plan reads the line-up, one way', () => {
  const lineUp = sourceFiles().filter((f) => relative(SRC, f).startsWith('lib/lineup/'));
  expect(lineUp.flatMap((f) => rel(importsOf(f)).filter((to) => to.startsWith('lib/plan/')).map((to) => `${relative(SRC, f)} -> ${to}`))).toEqual([]);
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/run`. Expected: FAIL, listing `lib/lineup/capsOf.ts -> lib/plan/types.ts`, `lib/lineup/capsOf.ts -> lib/plan/wholeUnit.ts`, `lib/lineup/choose.ts -> lib/plan/compose.ts` and `lib/lineup/choose.ts -> lib/plan/types.ts`.
- [ ] **Step 3:** Make the moves and edits listed under Files.
- [ ] **Step 4:** Verify.
  - `git grep -nE "lineup/(choose|capsOf)" -- src` prints nothing.
  - Run `npx vitest run src/lib/run src/lib/plan src/lib/lineup src/stores/lineUpStore.test.ts src/providers/registry.test.ts src/components/SettingsPage`. Expected: PASS, with no expectation edited.
  - Then run tsc and `npx vitest run`.
- [ ] **Step 5:** Commit `refactor(plan): choose and capsOf move into the plan; the line-up reads no plan`.

### Task 3: This device's local models, handed in

The port, its implementation over the model store, and every hand that passes it. The local provider does not read it yet. Its `admit` and `watchReadiness` ignore their new argument, so behaviour is unchanged.

**Files:**
- Modify: `src/lib/local-inference/selection/types.ts`. Add `LocalModels`, importing `LocalStages` as a type from `../../lineup/localStages`:

```ts
/**
 * This device's local models, as the local provider reads them: what a direction resolves to among the models on this
 * device, the GPU's features its memory budget reads, when its models have been scanned, and when one changes. The app
 * gives it (`src/stores/localModels.ts`): a run to every builder (`SharedSettings.localModels`) and to `admit`, the
 * provider store to a local provider's check (`CheckContext.localModels`), the readiness driver to `watchReadiness`.
 * A provider's units, check and admit read it, never the store.
 */
export interface LocalModels {
  /** Settles once this device's models have been scanned (the first scan at launch); rejects with the abort reason when `signal` fires first. */
  scanned(signal?: AbortSignal): Promise<void>;
  /** A direction's models among those on this device; a stage `stages` gives another provider resolves to none. */
  resolve(source: string, target: string, selections: Selections, stages: LocalStages): DirectionResult;
  /** The GPU's features (e.g. `shader-f16`): which variant of a model loads, and so its memory. */
  deviceFeatures(): readonly string[];
  /** Calls back when a model's status changes (a download, a delete, the first scan); returns the unsubscribe. */
  watch(onChange: () => void): () => void;
}
```

- Create: `src/stores/localModels.ts`, which exports `localModels: LocalModels`.
  - `scanned(signal)` returns at once when `useModelStore.getState().initialized`. Otherwise it is `check.ts`'s `raceInitialize(signal)`, moved verbatim.
  - `resolve` calls `useModelStore.getState().resolve`.
  - `deviceFeatures()` returns `useModelStore.getState().deviceFeatures`.
  - `watch(onChange)` is `useModelStore.subscribe((s) => s.modelStatuses, () => onChange())`.
  - Header: "This device's local models behind the `LocalModels` port: the model store, read through whatever the local provider is handed. The run, the provider store and the readiness driver hand it on; the provider imports no store. A module of its own, so a test that mocks `modelStore` with only `useModelStore` still serves it."
- Create: `src/lib/local-inference/selection/localModels.testing.ts`, which exports `fakeLocalModels(over: Partial<LocalModels> = {}): LocalModels`. Its defaults:
  - `scanned` resolves;
  - `resolve` answers `{ asr: null, translation: null, tts: null, notes: [], prunes: [] }`;
  - `deviceFeatures` gives `[]`;
  - `watch` returns a no-op unsubscribe.
- Modify: `src/lib/run/types.ts`.
  - `SharedSettings` gains, after `lineUp`:

```ts
/**
 * This device's local models (`LocalModels`): what a builder of a unit that runs them (the local provider's) resolves
 * its models through, and what its `admit` budgets by. Set by the run when its deps have them (the app's always do);
 * absent where the caller is not a run.
 */
localModels?: LocalModels;
```

  - `SessionHooks.admit?(configs: Partial<Record<LegName, C>>, shared: Omit<SharedSettings, 'reversed'>)`. Its doc adds: "`shared`: what the builders of this unit were handed, less which leg each built."
- Modify: `src/lib/provider/types.ts`.
  - `CheckContext` gains `localModels?: LocalModels`, documented: "This device's local models, for the check of a provider whose models are on this device: the provider store hands them to a `local` provider's check, and to no other."
  - `watchReadiness?(onChange: () => void, localModels: LocalModels): () => void`. Its doc's example becomes: "a local engine's models downloading, which it watches through `localModels` (the readiness driver hands them)".
- Modify: `src/lib/session/ports.ts`. `RunnerDeps` gains, after `punctuationReady`:
  - `localModels?: LocalModels`;
  - documented: "This device's local models, handed to every builder (`SharedSettings.localModels`) and every `admit`. Absent: none is handed, and no local unit can build."
- Modify: `src/lib/session/run.ts`, in `runOpen`, after `speaks`:
  - A `sharedOf(unit: PlannedUnit): Omit<SharedSettings, 'reversed'>` gives today's builder object less `reversed`, plus `...(deps.localModels ? { localModels: deps.localModels } : {})`.
  - The builder is `(unit) => ({ ...sharedOf(unit), reversed: () => leg === 'participant' })`.
  - `admit` is called with `sharedOf(planned)` as its second argument.
  - The comment above it says that `admit` is handed what the builders were.
- Modify: `src/app/session.ts`. `createRunner` gets `localModels` (from `../stores/localModels`).
- Modify: `src/stores/providerStore.ts`. The `check` context adds `...(p.kind === 'local' ? { localModels } : {})` (from `./localModels`).
- Modify: `src/app/readiness.ts`. `p.watchReadiness?.(() => inputsChanged(p.id), localModels)` (from `../stores/localModels`).
- Not changed:
  - `src/components/SetupWizard/steps/StepCredentials.tsx` and `src/components/SettingsPage/notesReadiness.ts` check own-key and managed providers only, and hand none.
  - The local provider's code is unchanged in this task.
- Modify: `src/providers/localInference/provider.test.ts`, because tsc requires the new argument.
  - Every `admit?.(configs)` becomes `admit?.(configs, SHARED)`.
  - `const FEATURES = ['shader-f16']`, and `const SHARED = { localModels: fakeLocalModels({ deviceFeatures: () => FEATURES }) } as never`.
  - The definition's `admit` ignores it until Task 4, so no expectation changes here.
- Test:
  - `src/stores/localModels.test.ts` (new);
  - `src/lib/session/runner.hooks.test.ts`;
  - `src/stores/providerStore.readiness.test.ts`;
  - `src/lib/session/appShape.test.ts`;
  - `src/app/readiness.test.ts`.

**Interfaces:**
- Consumes: Task 1's run contract.
- Produces:
  - `LocalModels`;
  - `localModels`;
  - `fakeLocalModels`;
  - `SharedSettings.localModels?`, `CheckContext.localModels?`, `RunnerDeps.localModels?`;
  - the two-argument `admit` and `watchReadiness`.

- [ ] **Step 1: Write the failing tests**

`src/stores/localModels.test.ts` mocks `./modelStore` as `check.test.ts` mocks it today. Its `getState()` returns `initialized`, `initialize`, `resolve` and `deviceFeatures` (getters over `let`s), and `subscribe` records its selector and listener.

```ts
it("scanned: starts the model store's first scan when it has not run, and none once it has", async () => {
  mockInitialized = false;
  await localModels.scanned();
  await localModels.scanned();
  expect(mockInitialize).toHaveBeenCalledTimes(1);
});
// Moved from check.test.ts ('rejects with the abort reason when the signal fires before initialization resolves'), onto
// `localModels.scanned(controller.signal)`: it rejects with the reason, and the scan still settles afterwards.
it('scanned: rejects with the abort reason when the signal fires before the scan settles', async () => { /* as moved */ });
it('resolve and deviceFeatures read the model store when asked', () => {
  localModels.resolve('ja', 'en', {}, ALL_LOCAL_STAGES);
  expect(mockResolve).toHaveBeenCalledWith('ja', 'en', {}, ALL_LOCAL_STAGES);
  mockFeatures = ['shader-f16'];
  expect(localModels.deviceFeatures()).toEqual(['shader-f16']);
});
it("watch: calls back when the models' statuses change, and returns the unsubscribe", () => {
  const onChange = vi.fn();
  expect(localModels.watch(onChange)).toBe(mockOff);
  recordedListener!();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(recordedSelector!({ modelStatuses: 'statuses' })).toBe('statuses');
});
```

`runner.hooks.test.ts`:
- `setup` gains a last parameter, `deps: Partial<RunnerDeps> = {}`, spread last into `createRunner`'s deps.
- The existing `hands admit the configs actually built, one per leg` adds `expect.anything()` as the second argument of its `toHaveBeenCalledWith`.
- Add:

```ts
it("hands admit what the builders of its unit were handed, this device's local models among it", async () => {
  const admit = vi.fn(() => true as const);
  const models = fakeLocalModels();
  await setup(withHooks({ admit }), ['speaker', 'participant'], undefined, undefined, undefined, { localModels: models }).runner.start();
  expect(admit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ models: [], localModels: models }));
});
it("hands every builder this device's local models, and none when the runner has none", async () => {
  const build = vi.fn(buildFake);
  const models = fakeLocalModels();
  await setup(withHooks({}, { build }), ['speaker'], undefined, undefined, undefined, { localModels: models }).runner.start();
  expect(build.mock.calls[0][2].localModels).toBe(models);
  build.mockClear();
  await setup(withHooks({}, { build })).runner.start();
  expect(build.mock.calls[0][2]).not.toHaveProperty('localModels');
});
```

`providerStore.readiness.test.ts` (a fresh module per case, so the port is the one the store imported):

```ts
it.each([['local', true], ['own-key', false]] as const)("hands a %s provider's check this device's models: %s", async (kind, handed) => {
  const { localModels } = await import('./localModels');
  const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext): Promise<CheckResult> => ({ ok: true }));
  const p = probe(kind, check);
  await loadedWithKey(p);
  await store.useProviderStore.getState().refreshReadiness(p, noAuth);
  expect(check.mock.calls[0][2].localModels).toBe(handed ? localModels : undefined);
});
```

`appShape.test.ts`: in `checks the shape's own settings, credentials, pair and legs, with the run's signal`, whose probe is `local`, the expected context becomes `{ pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], localModels, signal }` (from `../../stores/localModels`).

`app/readiness.test.ts`:
- `makeProbe`'s `watchReadiness` becomes a `vi.fn` with the same body, returned as `watch`.
- `localModels` is imported from `../stores/localModels`.
- Add, in the shape of `checks a loaded local provider whose readiness is unknown…`:

```ts
it("watches each provider of the plan through this device's models", async () => {
  const { provider, watch } = makeProbe();
  setupStore(provider);
  const detach = driveReadiness({ runner: idleRunner(), providers: () => [provider], plan: readinessPlan, auth: () => auth, clock: createVirtualClock(0) });
  await flush();
  expect(watch).toHaveBeenCalledWith(expect.any(Function), localModels);
  detach();
});
```

- [ ] **Step 2:** Run `npx vitest run src/stores/localModels.test.ts src/lib/session/runner.hooks.test.ts src/stores/providerStore.readiness.test.ts src/lib/session/appShape.test.ts src/app/readiness.test.ts`. Expected: FAIL. `./localModels` is not found, `admit` gets one argument, and no check or watch is handed the port.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Run the Step 2 command, then `npx vitest run src/lib/session src/app src/stores src/providers/localInference`, then tsc and `npx vitest run`.
  - Expected: PASS, with no expectation edited beyond the two above.
  - No view test edited: the view tests' `useModelStore` mocks serve the port as before.
- [ ] **Step 5:** Commit `refactor(session): this device's local models, handed to every builder, admit, local check and readiness watch`.

### Task 4: The local provider reads the models it is handed, never a store

**The store reads this task removes** (found by `git grep -nE "stores/|deviceFeatures" -- src/providers/localInference`, the views left out):
- `config.ts`:
  - `resolveLocal` → `useModelStore.getState().resolve`, twice: the direction, and the AST guard's re-resolve. Used by the builds of the whole session, of the recognition, translation and voice units.
  - `fitsBudget` → `useModelStore.getState().deviceFeatures`. Used by all four `admit…` functions, which the definition's `admit` calls.
- `check.ts`:
  - `useModelStore.getState().initialized` and `.initialize()` (`raceInitialize`);
  - `.resolve` for every direction;
  - `useModelStore.subscribe((s) => s.modelStatuses, …)` (`watchLocalInferenceReadiness`, the definition's `watchReadiness`).
- The three unit modules import no store themselves. They reach the model store through `config.ts`, and `translationUnit.ts` also through `check.ts` (`LOCAL_MODELS_MISSING`).
- Stay, since they are not stores: `fitsBudget`'s two `localStorage` debug overrides, and `navigator.deviceMemory`.
- Views, which may read stores and are untouched: `LocalInferenceSettings.tsx`, `LocalInferenceEngineSummary.tsx`, `LocalInferenceVoiceSummary.tsx`, `LocalInferenceTurnDetection.tsx`.

**Files:**
- Modify: `src/providers/localInference/config.ts`. Drop the store import.
  - `resolveLocal(direction, s, stages, models: LocalModels)` resolves through `models.resolve`, both times.
  - Add `localModelsOf(shared: Pick<SharedSettings, 'localModels'>): LocalModels`. It throws `Error("The local provider was built without this device's models (SharedSettings.localModels): only a run hands them.")` when they are absent.
  - `buildLocalInference` resolves with `localModelsOf(shared)`.
  - `fitsBudget(modelIds: string[], deviceFeatures: readonly string[])` hands `[...deviceFeatures]` to `estimateModelMemoryByDevice`.
  - `admitLocalInference(configs, deviceFeatures: readonly string[])` passes the features to both of its `fitsBudget` calls.
- Modify: `transcriptionUnit.ts`, `translationUnit.ts` and `speechUnit.ts`.
  - Each build hands `localModelsOf(shared)` to `resolveLocal`.
  - `admitLocalTranscription`, `admitLocalTranslation` and `admitLocalSpeech` take `(configs, deviceFeatures: readonly string[])` and pass the features to `fitsBudget`.
- Modify: `check.ts`.
  - Drop the store import, `raceInitialize` and `watchLocalInferenceReadiness`.
  - `checkLocalInference` takes `const models = ctx.localModels`. It throws `Error("The local check was asked without this device's models (CheckContext.localModels).")` when they are absent.
  - It then `await models.scanned(ctx.signal)` and resolves through `models.resolve`.
  - Its doc's first paragraph adds: "and this device's models come from `ctx.localModels`, not the model store".
- Modify: `provider.ts`.
  - `admit: (configs, shared) => { const features = localModelsOf(shared).deviceFeatures(); … }`. The four branches pass `features`.
  - `watchReadiness: (onChange, models) => models.watch(onChange)`, with the comment "Its check reads this device's models: a download, a delete or their first scan can change its answer."
- Rename: `git mv src/providers/localInference/noLineUpRead.test.ts src/providers/localInference/noStoreRead.test.ts`.
  - Its cases stay.
  - Its header adds: "Nor do they read any other store: this device's models come in as `LocalModels` (`shared.localModels`, `ctx.localModels`)."
- Modify the comments in `src/providers/sessionSide.consistency.test.ts`:
  - The header's "LocalInference's shipped `admit` reads `modelStore`" becomes "LocalInference's `admit` no longer does: it budgets by the device's models the run hands it".
  - `VOICE_SESSIONS`'s "resolves the voice from the model store" becomes "resolves the voice through this device's models, which the run hands it (`shared.localModels`)".
  - `TRANSLATION_SESSIONS`'s "resolves the engine from the stored line-up and the model store" becomes "resolves the engine from the line-up the run froze and this device's models (`shared.lineUp`, `shared.localModels`)".
  - The two inline comments that say the local units read "the model store" and "the stores" say "the models a run hands it".
- Modify these tests, by one rule:
  - The test drops `vi.mock('../../stores/modelStore', …)`.
  - Its `shared`/`sharedFor` fixture gains `localModels: models`, where `const models = fakeLocalModels({ resolve: <the file's resolve mock>, deviceFeatures: () => <its features> })`.
  - Every `admit…` call passes the features.
  - The files:
    - `src/providers/localInference/config.test.ts`. Its `estimateModelMemoryByDevice` mock becomes a hoisted `vi.fn` named `estimate`, with the same body.
    - `src/providers/localInference/transcriptionUnit.test.ts`
    - `src/providers/localInference/translationUnit.test.ts` (its `requestFor` builds with the fixture)
    - `src/providers/localInference/speechUnit.test.ts` (its composed cases too)
    - `src/providers/localInference/transcriptionUnit.run.test.ts`
    - `src/providers/openai_text/translation.run.test.ts`
- Modify: `src/providers/localInference/check.test.ts`.
  - The store mock goes.
  - Every `checkLocalInference(s, ctx)` hands `{ ...ctx, localModels: fakeLocalModels({ resolve: mockResolve }) }`.
  - These go:
    - `writes nothing` and `modelStoreWrites`: the check imports no store, which `noStoreRead.test.ts` pins.
    - `initializes the model store first…` and `rejects with the abort reason…`: moved in Task 3.
    - the `watchLocalInferenceReadiness` describe: moved in Task 3, and pinned on the definition below.
- Modify: `src/providers/localInference/provider.test.ts`.
  - Its `admit` calls already hand `SHARED` (Task 3).
  - `mockFits` is now expected with `(ids, FEATURES)`, and `mockAdmit` with `(configs, FEATURES)`.
  - The `./check` mock loses `watchLocalInferenceReadiness`.
  - `delegates watchReadiness() to watchLocalInferenceReadiness` becomes the case below.

**Interfaces:**
- Consumes: Task 3's `LocalModels`, `fakeLocalModels`, `SharedSettings.localModels` and `CheckContext.localModels`, and the two-argument `admit` and `watchReadiness`.
- Produces:
  - `resolveLocal(direction: SessionContext['direction'], s: LocalInferenceSettings, stages: LocalStages, models: LocalModels): DirectionResult`;
  - `localModelsOf(shared: Pick<SharedSettings, 'localModels'>): LocalModels`;
  - `fitsBudget(modelIds: string[], deviceFeatures: readonly string[]): boolean`;
  - `admitLocalInference | admitLocalTranscription | admitLocalTranslation | admitLocalSpeech(configs, deviceFeatures: readonly string[])`.

- [ ] **Step 1: Write the failing tests**

```ts
// noStoreRead.test.ts
it('no module of the local provider but its views (.tsx) imports a store', () => {
  const modules = readdirSync(__dirname).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
  expect(modules.filter((f) => importsOf(join(__dirname, f)).some((to) => relative(SRC, to).startsWith('stores/')))).toEqual([]);
});
// config.test.ts
it("resolves a direction through this device's models as the run hands them", () => {
  const resolve = vi.fn(mockResolve);
  buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), { ...shared(), localModels: fakeLocalModels({ resolve }) });
  expect(resolve).toHaveBeenCalledWith('ja', 'en', LOCAL_INFERENCE_DEFAULTS.selections, ALL_LOCAL_STAGES);
});
it("throws when no run handed it this device's models", () => {
  expect(() => buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), { ...shared(), localModels: undefined })).toThrow(/SharedSettings\.localModels/);
});
it('budgets by the GPU features it is handed', () => {
  admitLocalInference({ speaker: cfg({ asr: 'a' }) }, ['shader-f16']);
  expect(estimate).toHaveBeenLastCalledWith(['a'], ['shader-f16']);
});
// check.test.ts
it("waits for this device's models to be scanned, with the start's signal, before it resolves anything", async () => {
  let release!: () => void;
  const scanned = vi.fn(() => new Promise<void>((r) => { release = r; }));
  const signal = new AbortController().signal;
  resolved({ 'ja>en': { asr: 'a', translation: 't' } });
  const answer = checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal, localModels: fakeLocalModels({ scanned, resolve: mockResolve }) });
  await Promise.resolve();
  expect(scanned).toHaveBeenCalledWith(signal);
  expect(mockResolve).not.toHaveBeenCalled();
  release();
  await expect(answer).resolves.toEqual({ ok: true });
});
it('rejects with what the scan rejects with: a start cancelled while it waits', async () => {
  const reason = new Error('cancelled');
  await expect(checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], localModels: fakeLocalModels({ scanned: () => Promise.reject(reason) }) })).rejects.toBe(reason);
});
it("throws when it is asked without this device's models", async () => {
  await expect(checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).rejects.toThrow(/CheckContext\.localModels/);
});
// provider.test.ts
it("watches its readiness through this device's models", () => {
  const off = vi.fn();
  const watch = vi.fn(() => off);
  const onChange = vi.fn();
  expect(localInferenceProvider.watchReadiness?.(onChange, fakeLocalModels({ watch }))).toBe(off);
  expect(watch).toHaveBeenCalledWith(onChange);
});
```

(`cfg` is `config.test.ts`'s existing helper for the `admit` cases; `estimate` is its `estimateModelMemoryByDevice` mock.)

- [ ] **Step 2:** Run `npx vitest run src/providers/localInference`. Expected: FAIL.
  - `noStoreRead` lists `check.ts` and `config.ts`.
  - The resolve spy is never called: the build reads the store.
  - Nothing throws when the models are absent, and the scan is never asked.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Verify.
  - `git grep -nE "from '[./]*stores/" -- 'src/providers/localInference/*.ts'` prints nothing; the views are `.tsx`.
  - Run `npx vitest run src/providers/localInference src/providers/openai_text src/providers/sessionSide.consistency.test.ts src/lib/session src/lib/history src/app`. Expected: PASS.
  - Then run tsc, and `npx vitest run`. Expected: no new failures. No view or app test edited.
- [ ] **Step 5:** Commit `refactor(local): the local provider reads this device's models from what it is handed, never a store`.

### Task 5: The deferred cosmetic minors

Each item comes from a ledger of steps 1-3 and still applies at b2461602b. None changes behaviour.

**Files:**
- `src/providers/localInference/check.ts`, `effectiveStages`: `if (!told) return ALL_LOCAL_STAGES;`, with `ALL_LOCAL_STAGES` imported from `../../lib/lineup/localStages`.
- Redundant `?.` and `!` on `units`, which is now required, are dropped: every match of `git grep -nE "units(\?\.|!)" -- src` but `compositeBoth.ts`'s (21 at b2461602b). They are in:
  - `src/providers/fake/provider.test.ts`, `src/providers/fake/stages.test.ts`;
  - `src/providers/bing/provider.test.ts`, `src/providers/edge/provider.test.ts`;
  - `src/providers/openai/provider.test.ts`, `src/providers/openai_text/provider.test.ts`, `src/providers/gemini_text/provider.test.ts`, `src/providers/openai_compatible/provider.test.ts`;
  - `src/providers/openai_text/translation.run.test.ts`;
  - `src/providers/localInference/provider.test.ts`, `src/providers/localInference/transcriptionUnit.run.test.ts`, `src/providers/localInference/translationUnit.test.ts`;
  - `src/providers/soniox/transcriptionAlone.run.test.ts`.
- Wording that names a removed member:
  - `src/components/SetupWizard/providerPaths.ts`, `textOnlyCapabilityOf`'s doc: "A definition's speech" → "A unit's speech".
  - `src/components/SetupWizard/providerPaths.test.ts`: "judges the managed card's fit from the definition's speech" → "… from what its unit says of its speech".
  - `src/lib/plan/fromStores.test.ts`: "is ready with the selected provider as one whole-provider unit, …" → "is ready with the selected provider's plan alone, and its entry as its account".
  - `src/components/MainPanel/panel/TypedText.tsx`'s doc: "provider.textInput(settings)" → "the transcribing unit's `textInput`".
  - `src/lib/provider/managed.test.ts`, the compile-time case's comment: "`start` still takes the lease's K." → "A start takes the provider's K: the fake's own here, since a twin's units are erased."
- Step 2's minors:
  - `e2e/README.md`:
    - the `src/lib/lineup/catalog.ts` row goes;
    - the `src/providers/registry.ts` row reads "Keeps the five fake providers (`src/providers/fake`), and lets a line-up name them (`CATALOGUED`)."
  - `src/lib/lineup/catalog.testing.ts`:
    - the helper `e2e` is renamed `endToEnd`, with the doc "An end-to-end provider's entry: every stage, held together, and no other voice reads its text.";
    - `registerReleasedCatalog`'s doc adds "A test that calls `vi.resetModules()` and imports a catalog reader again gets none registered, and registers again (`categories.test.ts`)."
  - `src/lib/plan/capsOf.ts`, the `SUBSETS` doc: "Every non-empty subset of the run stages, each in `RUN_STAGES` order (the list itself in bitmask order)."
  - `src/providers/registry.ts`, around `CATALOGUED`:
    - the `//` block keeps its reasons: compiled, not present; and the cycle;
    - the `/** */` doc gives the literal's reason once: "The condition is a literal `MODE`, not `PROVIDERS`: development builds compile the fakes but catalogue none, and only a literal lets a release build drop them."
  - `src/lib/lineup/types.ts`, the `translatesOwn` rule: "Rule: some occupation (the stages a unit occupies when asked for exactly those) has transcription without translation, some has translation, and every one with translation has transcription."

Left out, since they are not cosmetic or not cheap:
- From step 1:
  - Edge's id in three voice paths;
  - Edge's speed following the local `ttsSpeed`;
  - the shared sessions' "Local" names;
  - the notes language placeholders;
  - the untagged composite frame;
  - `sessions/speech.test.ts` importing from a provider;
  - `openTtsSlot` while the plan loads.
- From step 2:
  - an end-to-end provider's `joint` when it serves fewer stages;
  - the dead `defaultLineUp`.
- From step 3:
  - restoring the local adapter's identity check;
  - the `FAKE_LANGUAGES` pure annotation.

- [ ] **Step 1:** Make the changes.
- [ ] **Step 2:** `git grep -nE "units(\?\.|!)" -- src` prints only `src/lib/plan/compositeBoth.ts`'s `units?.text`, a nullable value of another type. `git grep -n "provider.textInput\|definition's speech\|whole-provider unit" -- src` prints nothing.
- [ ] **Step 3:** Run `npx vitest run src/providers src/components/SetupWizard src/lib/plan src/lib/lineup src/lib/provider`, then tsc, then `npx vitest run`. Expected: PASS, with no expectation edited.
- [ ] **Step 4:** Commit `chore: the deferred minors of the provider refactor: stale wording, required units read plainly, the shared local stages`.

### Task 6: Whole-suite verification, the measurement, push and PR

- [ ] **Step 1:** Run `npx vitest run`. Expected: only the base's failures, as recorded before Task 1.
- [ ] **Step 2:** Run `npx tsc --noEmit -p tsconfig.json`. Expected: no error in a touched file, and at most 89. Record the count.
- [ ] **Step 3: The measurement.** Run `npx vitest run src/lib/run/types.cycle.test.ts`. Expected: 4 passed.
  - Before, at b2461602b, the same test lists the two groups recorded at Task 1 Step 2 and the four edges recorded at Task 2 Step 2.
  - Record both in the PR body.
- [ ] **Step 4:** Run `npm run e2e:build && npm run e2e` in this worktree. Expected: all pass. It is the only run, in a built app, of the run handing `localModels` (the app's runner wiring) and of the sessions on the fakes.
- [ ] **Step 5:** Push `refactor/cycles-and-local-facts` to `kizuna-ai-lab/sokuji`, and open its PR into `refactor/units-required` (`kizuna-ai-lab/sokuji`). The owner authorised opening the step 2-4 PRs directly, stacked, on 2026-11-22 (task #131). The PR body states:
  - the goal;
  - the measurement before and after;
  - the store reads removed (Task 4's list);
  - the accepted differences;
  - the tsc count and the e2e result.
  - It ends with the attribution line the session gives.

---

## Appendix A: the import codemod (`reimport.cjs`)

Run it from the scratch directory, never committed, with `TSPATH=<worktree>/node_modules/typescript`. For every file under `src`, it moves the named imports of `NAMES` from the `FROM` modules to `TO`, as `import type`.
- It merges them into an existing `import type` of `TO`, or adds the line after the import they came from.
- It drops an import left empty, and refuses (throws) on a re-export of a moved name.

```js
const ts = require(process.env.TSPATH); const fs = require('fs'), path = require('path');
const [srcArg, toArg, fromArg, namesArg] = process.argv.slice(2);
const SRC = path.resolve(srcArg), TO = path.resolve(SRC, toArg);
const FROM = new Set(fromArg.split(',').map((f) => path.resolve(SRC, f))), NAMES = new Set(namesArg.split(','));
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } })(SRC);
const res = (from, spec) => [path.join(path.dirname(from), spec)].flatMap((b) => [b, b + '.ts', b + '.tsx']).find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
const relSpec = (from, to) => { const r = path.relative(path.dirname(from), to).replace(/\.ts$/, ''); return r.startsWith('.') ? r : './' + r; };
let changed = 0;
for (const f of files) {
  if (f === TO) continue;
  const text = fs.readFileSync(f, 'utf8'); const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [], moved = new Set();
  for (const st of sf.statements) {
    const imp = ts.isImportDeclaration(st), exp = ts.isExportDeclaration(st);
    if (!(imp || exp) || !st.moduleSpecifier || !st.moduleSpecifier.text.startsWith('.') || !FROM.has(res(f, st.moduleSpecifier.text))) continue;
    const named = imp ? st.importClause?.namedBindings : st.exportClause;
    if (!named || !(ts.isNamedImports(named) || ts.isNamedExports(named))) continue;
    const take = named.elements.filter((e) => NAMES.has((e.propertyName || e.name).text));
    if (!take.length) continue;
    if (exp) throw new Error(`re-export of a moved name in ${f}`);
    take.forEach((e) => moved.add(e.getText(sf).replace(/^type\s+/, '')));
    const keep = named.elements.filter((e) => !take.includes(e)), def = st.importClause.name;
    const text2 = keep.length || def ? `import ${st.importClause.isTypeOnly ? 'type ' : ''}${def ? def.text + (keep.length ? ', ' : '') : ''}${keep.length ? `{ ${keep.map((e) => e.getText(sf)).join(', ')} }` : ''} from ${st.moduleSpecifier.getText(sf)};` : '';
    edits.push({ start: st.getStart(sf), end: st.getEnd(), text: text2, drop: !text2 });
  }
  if (!moved.size) continue;
  const into = sf.statements.find((s) => ts.isImportDeclaration(s) && s.moduleSpecifier.text.startsWith('.') && res(f, s.moduleSpecifier.text) === TO && s.importClause?.isTypeOnly && s.importClause.namedBindings && ts.isNamedImports(s.importClause.namedBindings));
  const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b)).join(', ');
  if (into) edits.push({ start: into.getStart(sf), end: into.getEnd(), text: `import type { ${sorted(new Set([...into.importClause.namedBindings.elements.map((e) => e.getText(sf)), ...moved]))} } from ${into.moduleSpecifier.getText(sf)};` });
  else { const line = `import type { ${sorted(moved)} } from '${relSpec(f, TO)}';`; edits[0].text = edits[0].text ? `${edits[0].text}\n${line}` : line; edits[0].drop = false; }
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.drop && out[e.end] === '\n' ? e.end + 1 : e.end);
  fs.writeFileSync(f, out); changed++;
}
console.log(`${changed} files changed`);
```

## What was checked before writing this plan (2026-11-23, on b2461602b)

- **The base.**
  - `npx tsc --noEmit -p tsconfig.json`: 89 errors.
  - No cycle tool is installed (`madge`, `dpdm`, `dependency-cruiser`, `skott`). `typescript` is.
- **The measurement before**, by two scans of the 950 non-test source files under `src`. One is the guard's regular-expression walk (`importsOf`), the other a scan with the TypeScript compiler's parser that tells `import type` apart. Both give the same answer.
  - Type imports included:
    - 15 import cycles in `src`. Two pass through the five folders: the 9-file group and the 3-file group recorded at Task 1 Step 2.
    - The 9-file group is two loops through `lib/provider/types.ts`:
      - the run contract's: provider → plan → provider, and provider → session → plan;
      - `PreviewClip`'s: provider → `audio/playback` → `session/ports` → provider. `analytics.ts`, `reconnect*.ts` and `orgNotice.ts` hang on that loop.
  - Value imports only: no cycle passes through the five folders.
  - Folder level: `lib/lineup` imports `lib/plan` 4 times (Task 2 Step 2), and `lib/plan` imports `lib/lineup` 14 times.
- **Part A, prototyped** in a scratch copy of b2461602b (with `extension/`, `scripts/`, `electron/` beside it, so tsc counts the same 89):
  - The type checker asked for exactly the names Task 1 moves.
    - `LanguagePair` and `AuthContext` are in the list because the shape a run freezes, which the hooks take, carries them.
    - Leaving `PlannedUnit`, `RunPlan` or `RunShape` outside the contract re-closed the cycle through `AnyProvider`.
  - The codemod rewrote 188 + 6 + 13 files, and tsc gave 89.
  - The full suite: 14583 passed. 8 files failed, and they fail the same way at base in that copy: consistency tests that read `sidecar/` and `.github/`, which the copy lacks.
  - The guard test failed at base as recorded, and passed after.
  - Measurement after:
    - no import cycle passes through `lib/run`, `lib/provider`, `lib/plan`, `lib/session` or `lib/lineup`;
    - `lib/lineup` imports nothing of `lib/plan`;
    - the 13 other cycles of `src` are elsewhere and untouched.
- **Part B, prototyped** on top:
  - Production code typed at 89 with Task 3's and Task 4's code changes.
  - The only failing test files were the ones Tasks 3 and 4 edit, each for the reason given there:
    - `check`, `config`, `provider`, `speechUnit`, `transcriptionUnit`, `translationUnit` and `transcriptionUnit.run` under `localInference`;
    - `openai_text/translation.run`, `runner.hooks` and `appShape`.
  - No view test failed: the port's module forwards to `useModelStore`, which their mocks provide.
  - Following value imports within `src`, with the reporter left out, the units, `config.ts` and `check.ts` reach no store after.
