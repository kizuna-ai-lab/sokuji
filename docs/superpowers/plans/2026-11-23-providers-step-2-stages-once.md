# Provider refactor, step 2: which stages a provider can do is declared once — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The line-up catalog (`ProviderCaps[]`) is derived from the providers' units and kind instead of being written by hand. The one thing units cannot say, that a service is end to end, becomes a single provider flag.

**Architecture:**
- A pure derivation, `capsOf(provider)`, probes each unit's `occupies` over the seven non-empty sets of run stages, under the provider's default settings, and reads `kind` and the new `endToEnd` flag.
- `src/lib/lineup/catalog.ts` cannot import the registry: every provider reaches it through the line-up store. So it keeps a registered catalog, the way `src/lib/plan/present.ts` keeps the present providers. `src/providers/registry.ts` registers `catalogOf(...)` of the compiled providers as it loads.
- Catalog functions keep their optional `catalog` parameter, and its default becomes `allCaps()`.
- `Provider.optionStages`, which is the layout of the settings cards and not a capability, is renamed `settingsStages`.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron).

**Spec:** this document. The decisions below were made by the owner on 2026-11-23 and are binding. The code inventory is `docs/superpowers/plans/2026-11-22-providers-step-1-inventory.md` §4; its line numbers predate step 1, so find each place by name.
- The catalog is derived from the providers. The derived catalog equals today's hand-written one entry for entry. A test pins this before the hand-written list is deleted.
- Derived fields:
  - `host` is the id.
  - `stages` is the union of what the units occupy.
  - `voiceAlone`: some unit occupies exactly `[speech]`.
  - `translatesOwn`: Soniox's shape.
  - `joint`: the stages it serves that no unit can serve apart from each other.
  - `account` comes from `kind`.
- End-to-end services carry `joint: ALL` and `takesVoice: false` through one provider flag: it is not known per vendor that they stop making, and charging for, audio when asked for text alone.
- `optionStages` is layout. It is kept and renamed.
- `catalog.ts` does not import the registry at module load. The registry registers the catalog. E2E/dev fakes land in the catalog exactly as today.
- The tests that inject a catalog keep a seam that works.
- No user-visible change, no new strings, ids unchanged, stored data untouched.

## Global Constraints

- No user-visible change. The only differences are the two listed under "Accepted differences", and neither reaches a release build.
- No new locale strings.
- Ids are unchanged. Stored data is untouched: `settings.lineup`, `settings.common.provider`, every provider's settings keys, history `services.stages`, and analytics `stages`.
- The catalog is built from the **compiled** providers, never from `presentProviders()`.
  - It holds `RELEASED`, plus `DEV_ONLY` only when `import.meta.env.MODE === 'e2e'`. Write that condition as a literal in `registry.ts`, so a release build drops the fakes.
  - Development, test and production builds list no fake, as today.
- `src/lib/lineup/catalog.ts` and `src/lib/lineup/capsOf.ts` reach no module under `src/providers/` or `src/stores/`.
- Every catalog function keeps its optional `catalog` parameter. Its default is `allCaps()`, read when the function is called.
- Names, fixed here:
  - `Provider.endToEnd?: true`;
  - `Provider.settingsStages` (was `optionStages`);
  - `allCaps()` and `registerCatalog()` in `catalog.ts`;
  - `capsOf()`, `catalogOf()` and `occupationsOf()` in `src/lib/lineup/capsOf.ts`;
  - `RELEASED_CAPS`, `E2E_CAPS` and `registerReleasedCatalog()` in `src/lib/lineup/catalog.testing.ts`;
  - the test `src/providers/settingsStages.consistency.test.ts`.
- `ProviderCaps` keeps its shape. An absent `joint` or `translatesOwn` is left out of the object, never set to `undefined`. The pins use `toStrictEqual`.
- Before Task 1, record the base's `npx tsc --noEmit -p tsconfig.json` error count. After each task: no error in a touched file, and the total is not above the base's.
- Test commands:
  - `npx vitest run <paths>` for the files a task touches;
  - `npx vitest run` before each commit that touches shared code;
  - `npm run e2e:build && npm run e2e` in Task 5, in this worktree only. Never run vite or Electron in the main checkout.
- Commits:
  - on branch `refactor/stages-declared-once`;
  - stage explicit paths;
  - end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The owner authorised (2026-11-22, task #131) finishing steps 2-4 and opening their PRs directly, each stacked on the previous one; Task 5 pushes and opens this PR into `main`.

### Accepted differences (tell the owner; do not hide)

1. **The E2E fakes' `account` follows their `kind`.** This is E2E-only: no other build lists a fake.
   - The hand-written catalog says `'none'` for all five. Derived from `kind`:
     - `fake`, `fake_voice`, `fake_transcriber` and `fake_translator` (`own-key`) get `'key'`;
     - `fake_leased` (`managed`) gets `'kizuna'`.
   - The field's only reader is `accountKeyOf` (`SettingsPage/accountRows.ts`), which tests for `'kizuna'` only. So the four `own-key` fakes behave as before.
   - For `fake_leased`, a link about its account now lands on the Kizuna AI row, which `AccountsCategory` already lists it in. Before, it pointed at the anchor `account-fake_leased`, which no row has.
   - No E2E spec names `fake_leased`'s account.
2. **Catalog order follows the registry.**
   - `soniox` now comes after `openai_live`, where before it came after `edge`.
   - Nothing reads the order: `caps()` finds by id, the line-up page orders options by the provider list, and the settings search uses `some`.

## Review Focus

1. **Settings-dependent stages.** If a provider's `occupies` came to depend on its settings, the catalog, derived from the defaults, would offer stages the composer refuses under the user's settings, or hide ones it would run.
   - Today no `occupies` reads its settings. The probe gives the same occupations under `undefined` and under the defaults for all 21 providers.
   - Pinned in Task 1: `no provider occupies other stages under other settings`.
2. **A Kizuna twin that loses `endToEnd`.** `managed()` copies the base member by member. If it dropped the flag, Kizuna AI's Qwen would turn `joint: TR_TL` and `takesVoice: true`, and another voice could be put on its text. That is the billing risk the flag exists for.
   - Pinned in Task 1: `carries the base's end-to-end flag, and none when the base has none`, plus the catalog pin on `kizunaai_qwen`.
3. **A catalog read during module loading.** A module that reads the catalog while modules load, before the registry has registered it, crashes the app at start. `categories.ts`'s `nameKeys` does this today.
   - Pinned in Task 3: `the settings categories load before any catalog is registered`, and `the catalog reaches no provider module and no store`.
4. **Fakes in the wrong builds.** The fakes must be in the E2E build's catalog, and in no development, test or production catalog.
   - Pinned in Task 3: the updated mode tests `serves speech alone and hosts itself, in the build whose line-up may name the fake` / `is in no other catalog` (`fake/voice.test.ts`) and `are in no other catalog, and in no release build` (`fake/stages.test.ts`). These now load the registry.
5. **A stored line-up that names an option not offered here.** The text models are offered on the desktop only, yet a stored line-up that names one must stay readable on the web. `isStoredLineUp` rejects any id missing from the catalog, so the catalog must not be built from the present providers.
   - Pinned in Task 3: `lists every released provider, also one this platform does not offer`.

---

### Task 1: The catalog derived from the providers, pinned to the one declared by hand

The hand-written `CAPS` stays in this task. The derivation is added beside it and proven equal to it.

**Files:**
- Modify: `src/lib/provider/types.ts`: add `endToEnd?: true` to `Provider`, beside `units`.
- Modify: `src/lib/provider/managed.ts`: the twin carries `endToEnd` when its base has it, after `start`.
- Modify: set `endToEnd: true` (beside `speech`) on these definitions. Not on `fake` (`fake/provider.ts`), whose `joint` is derived.
  - `src/providers/gemini/provider.ts`
  - `src/providers/volcengine_ast2/provider.ts`
  - `src/providers/openai/provider.ts`
  - `src/providers/openai_translate/provider.ts`
  - `src/providers/openai_live/provider.ts`
  - `src/providers/qwen_livetranslate/provider.ts`
  - `src/providers/palabraai/provider.ts`
  - `src/providers/fake/leased.ts`
- Modify: `src/providers/registry.ts`: `export const DEV_ONLY`. The value is unchanged.
- Create: `src/lib/lineup/capsOf.ts`
- Create: `src/lib/lineup/catalog.testing.ts` (test-only data, like `oldRules.testing.ts`)
- Test: `src/lib/lineup/capsOf.test.ts`, `src/lib/provider/managed.test.ts`

**Interfaces:**
- Produces:
  - `Provider.endToEnd?: true`;
  - `occupationsOf(p: AnyProvider, s: unknown): readonly (readonly RunStage[])[]`;
  - `capsOf(p: AnyProvider): ProviderCaps`;
  - `catalogOf(providers: readonly AnyProvider[]): readonly ProviderCaps[]` (one entry per provider, in their order);
  - `RELEASED_CAPS: readonly ProviderCaps[]` and `E2E_CAPS: readonly ProviderCaps[]`;
  - `DEV_ONLY` exported from the registry.

The flag's doc comment. Write it as is; it replaces the `endToEnd` helper's comment, which Task 3 deletes:

```ts
/**
 * An end-to-end service: one connection does every stage, and a line-up takes it for all three or for none. Its units
 * may serve transcription and translation without speaking (a text-only session of it), but no other voice reads its
 * text: it is not known, per vendor, to stop making — and charging for — audio when asked for text alone. The line-up
 * catalog reads it (`capsOf`): its `joint` is every stage and its `takesVoice` false, whatever its units say.
 */
endToEnd?: true;
```

Derivation rules, all under `p.settings.defaults`. They were checked against every entry of today's catalog; see the report at the end of this plan.
- `occupationsOf(p, s)` gives the non-empty subsets `W` of `RUN_STAGES` for which some unit of `unitsOf(p)` returns exactly `W` from `occupies(s, new Set(W))` (`sameStages`, as the composer accepts it).
- `id` and `host` are `p.id`.
- `stages` are the stages of `RUN_STAGES` that appear in some occupation, in `RUN_STAGES` order.
- `voiceAlone`: some occupation is exactly `['speech']`.
- `translatesOwn: true` when three things hold: some occupation has transcription without translation, some occupation has translation, and every occupation with translation has transcription. Otherwise the key is absent.
  - The middle condition is not in the owner's wording. Without it, `fake_transcriber` would be marked `translatesOwn`.
- `joint`:
  - `RUN_STAGES` when `p.endToEnd`;
  - otherwise the stages `s` for which another stage `t` has "every occupation holds both or neither", in `RUN_STAGES` order;
  - absent when there are fewer than two.
- `takesVoice`: `false` when `p.endToEnd`; otherwise, some occupation has no `speech`.
  - This rule is not in the owner's list. It holds for every entry.
- `account`: `managed` gives `'kizuna'`, `own-key` gives `'key'`, and `local` and `online` give `'none'`.

The fixture data in `catalog.testing.ts`:
- `RELEASED_CAPS`:
  - today's entries from `catalog.ts:20-43`, values copied verbatim;
  - in `RELEASED` order, so `soniox` sits after `openai_live`;
  - the `endToEnd(id, account)` lines expanded to their object.
- `E2E_CAPS`:
  - the five entries from `catalog.ts:50-58`, with `account` per their kind: `'key'`, `'kizuna'` for `fake_leased`, `'key'`, `'key'`, `'key'`;
  - in `DEV_ONLY` order.
- A header comment: "The line-up catalog as it was declared by hand before step 2. The derived catalog must equal it entry for entry. Adding a provider adds its entry here."

- [ ] **Step 1: Write the failing tests**

```ts
// capsOf.test.ts
const byId = (list: readonly ProviderCaps[]) => Object.fromEntries(list.map((c) => [c.id, c]));
const unit = (id: string, stages: RunStage[]) => ({ id, occupies: (_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((s) => want.has(s)) ? stages : null) });
const provider = (o: Record<string, unknown>) => stubProvider('p', { kind: 'own-key', settings: { defaults: {} }, ...o });
const TR = ['transcription'] as RunStage[], TL = ['translation'] as RunStage[], SP = ['speech'] as RunStage[], TR_TL = [...TR, ...TL], ALL = [...TR_TL, ...SP];

it('is the catalog declared by hand, entry for entry, for the released providers', () => {
  expect(catalogOf(RELEASED).map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
  expect(byId(catalogOf(RELEASED))).toStrictEqual(byId(RELEASED_CAPS));
});
it("and for the E2E build's fakes", () => { expect(byId(catalogOf(DEV_ONLY))).toStrictEqual(byId(E2E_CAPS)); });
it('no provider occupies other stages under other settings: no settings and its defaults give the same', () => {
  for (const p of [...RELEASED, ...DEV_ONLY]) expect(occupationsOf(p, undefined), p.id).toEqual(occupationsOf(p, p.settings.defaults));
});
// Removed in Task 3, with the list it compares against.
it('the golden list is the catalog declared by hand; the fakes differ only in their account, which follows their kind', async () => {
  expect(byId(RELEASED_CAPS)).toStrictEqual(byId((await import('./catalog')).CAPS));
  vi.stubEnv('MODE', 'e2e'); vi.resetModules();
  const declared = (await import('./catalog')).CAPS.filter((c) => !RELEASED_CAPS.some((r) => r.id === c.id));
  expect(byId(declared)).toStrictEqual(byId(E2E_CAPS.map((c) => ({ ...c, account: 'none' as const }))));
}); // afterEach: vi.unstubAllEnvs(); vi.resetModules();
it('stages: what its units occupy, together', () => { expect(capsOf(provider({ units: [unit('a', TR), unit('b', SP)] })).stages).toEqual(['transcription', 'speech']); });
it('voiceAlone: a unit occupies speech alone', () => {
  expect(capsOf(provider({ units: [unit('a', SP)] })).voiceAlone).toBe(true);
  expect(capsOf(provider({ units: [unit('a', ALL)] })).voiceAlone).toBe(false);
});
it("translatesOwn: Soniox's shape, and nothing else", () => {
  expect(capsOf(provider({ units: [unit('stt', TR_TL), unit('tr', TR), unit('tts', SP)] })).translatesOwn).toBe(true);
  for (const units of [[unit('tr', TR)], [unit('tr', TR), unit('tl', TL)], [unit('w', TR_TL)]]) expect('translatesOwn' in capsOf(provider({ units }))).toBe(false);
});
it('joint: the stages its units never serve apart', () => {
  expect(capsOf(provider({ units: [unit('w', ALL), unit('t', TR_TL)] })).joint).toEqual(TR_TL);
  expect(capsOf(provider({ units: [unit('w', ALL)] })).joint).toEqual(ALL);
  expect('joint' in capsOf(provider({ units: [unit('a', TR), unit('b', TL), unit('c', SP)] }))).toBe(false);
});
it("takesVoice: a unit serves its text without its voice", () => {
  expect(capsOf(provider({ units: [unit('a', SP)] })).takesVoice).toBe(false);
  expect(capsOf(provider({ units: [unit('a', TL)] })).takesVoice).toBe(true);
});
it('an end-to-end provider: every stage joint, its text read by no other voice, whatever its units say', () => {
  expect(capsOf(provider({ endToEnd: true, units: [unit('w', ALL), unit('t', TR_TL)] }))).toMatchObject({ stages: ALL, joint: ALL, voiceAlone: false, takesVoice: false });
});
it('account and host: from its kind, and its own id', () => {
  expect(['managed', 'own-key', 'local', 'online'].map((kind) => capsOf(provider({ kind, units: [unit('a', TL)] })).account)).toEqual(['kizuna', 'key', 'none', 'none']);
  expect(capsOf(provider({ units: [unit('a', TL)] })).host).toBe('p');
});
// managed.test.ts
it("carries the base's end-to-end flag, and none when the base has none", () => {
  expect(managed({ ...fakeProvider, endToEnd: true }, OVERRIDES).endToEnd).toBe(true);
  expect('endToEnd' in managed(fakeProvider, OVERRIDES)).toBe(false);
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/lineup/capsOf.test.ts src/lib/provider/managed.test.ts`. Expected: FAIL (`./capsOf` not found; `endToEnd` not carried).
- [ ] **Step 3:** Implement the files listed under Files.
  - `capsOf.ts` imports `unitsOf` from `../plan/wholeUnit` and `sameStages` from `../plan/types`. It imports nothing from `providers/` or `stores/`.
  - `capsOf` builds the object with conditional spreads, so absent keys stay absent.
- [ ] **Step 4:** Run `npx vitest run src/lib/lineup src/lib/provider src/providers/registry.test.ts src/lib/plan/fromStores.cycle.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(lineup): the catalog derived from each provider's units, pinned to the one declared by hand (provider refactor, step 2)`.

### Task 2: Every reader asks `allCaps()` for the catalog

No behaviour change. `allCaps()` returns the hand-written list until Task 3.

**Files:**
- Modify: `src/lib/lineup/catalog.ts`.
  - The list becomes a private `const DECLARED`, and `export function allCaps(): readonly ProviderCaps[]` returns it.
  - The defaults of `caps`, `runsByItself`, `optionFor` and `hostDefaults` become `catalog: readonly ProviderCaps[] = allCaps()`.
  - `CAPS` is no longer exported.
- Modify: `src/components/SettingsPage/categories.ts`.
  - `Category.nameKeys?: () => readonly string[]` (`:22`).
  - The accounts category gives `nameKeys: () => allCaps().map((c) => \`providers.${c.id}.name\`)` (`:39`).
  - `filterCategories` calls `c.nameKeys?.() ?? []` (`:126`).
  - Nothing in this module reads the catalog while it loads.
- Modify: `src/lib/plan/testing.ts:33` (`stubHosts`).
- Modify these tests, `CAPS` → `allCaps()` (inside `vi.mock` factories, the call goes inside the function that builds the catalog):
  - `src/lib/lineup/catalog.test.ts`
  - `src/lib/lineup/choose.test.ts`
  - `src/lib/lineup/capsOf.test.ts`
  - `src/lib/plan/checks.test.ts`
  - `src/lib/plan/choice.test.ts`
  - `src/lib/plan/compose.test.ts`
  - `src/components/SettingsPage/LineUpCategory.test.tsx`
  - `src/stores/lineUpStore.test.ts`
  - `src/providers/localInference/provider.test.ts`
  - `src/providers/localInference/transcriptionUnit.run.test.ts`
  - `src/providers/openai_text/translation.run.test.ts`
  - `src/providers/soniox/voiceAlone.test.ts`
  - `src/providers/soniox/voiceAlone.run.test.ts`

**Interfaces:**
- Produces: `allCaps(): readonly ProviderCaps[]`; `Category.nameKeys?: () => readonly string[]`.

- [ ] **Step 1:** Run `npx vitest run src/lib/lineup src/lib/plan src/components/SettingsPage src/stores/lineUpStore.test.ts src/providers/localInference src/providers/openai_text src/providers/soniox`. Expected: PASS (the base).
- [ ] **Step 2:** Make the changes. `git grep -nw CAPS -- src` prints nothing.
- [ ] **Step 3:** Run the Step 1 command, then `npx vitest run`. Expected: PASS. No expectation is edited.
- [ ] **Step 4:** Commit `refactor(lineup): every reader asks allCaps() for the catalog, and the settings search reads it when it searches`.

### Task 3: The registry registers the catalog its providers declare; the hand-written list goes

**Files:**
- Modify: `src/lib/lineup/catalog.ts`.
  - Delete `DECLARED`, the `endToEnd` helper and the now-unused `ALL` / `JOINT`.
  - Add `registerCatalog` and the throwing `allCaps`, as in `present.ts`.
  - The header comment says where the catalog comes from, and that this module imports neither the registry nor a provider.
- Modify: `src/lib/lineup/types.ts`. The `ProviderCaps` doc says the catalog is derived (`capsOf`), and each field's doc names its rule.
- Modify: `src/providers/registry.ts`. Add these lines next to `registerPresentProviders(presentProviders)`, with a comment saying why the literal condition is kept:

```ts
/** The providers a line-up may name: the released ones, and the fakes in the E2E build only (a development build reaches the fake through the stored provider alone). A literal, so a release build drops the fakes. */
const CATALOGUED: readonly AnyProvider[] = import.meta.env.MODE === 'e2e' ? [...RELEASED, ...DEV_ONLY] : [...RELEASED];
registerCatalog(catalogOf(CATALOGUED));
```

- Modify: `src/lib/lineup/catalog.testing.ts`. Add `registerReleasedCatalog(): void`, which calls `registerCatalog(RELEASED_CAPS)`, for a test that keeps the registry out.
- Modify: `src/lib/lineup/capsOf.test.ts`. Delete the "golden list is the catalog declared by hand" test (its `afterEach` too).
- Create: `src/lib/plan/importWalk.testing.ts`. Move `SRC` and `reached(entry)` here out of `src/lib/plan/fromStores.cycle.test.ts`, which then imports them.
- Create: `src/lib/lineup/catalog.cycle.test.ts`.
- Modify: `src/lib/lineup/catalog.test.ts`, `src/components/SettingsPage/categories.test.ts`.
- Modify: `src/providers/fake/voice.test.ts` and `src/providers/fake/stages.test.ts`:
  - `build()` imports `'../registry'` beside the catalog (`voice.test.ts` lacks it today);
  - the fakes' expected `account` becomes `'key'`.
- Modify, adding `registerReleasedCatalog();` at module level right after the imports (before the first read, e.g. `lineUpStore.test.ts`'s `stubHosts(...)`). These 22 tests read the catalog without loading the registry, as found by a probe that made an unregistered read throw:
  - lib:
    - `src/lib/lineup/migrate.test.ts`
    - `src/lib/plan/checks.test.ts`
    - `src/lib/plan/compose.test.ts`
    - `src/lib/session/shape.test.ts`
    - `src/lib/view/noticeText.test.ts`
    - `src/lib/export/exporter.test.ts`
    - `src/lib/export/appAutoSave.test.ts`
  - stores: `src/stores/lineUpStore.test.ts`
  - components:
    - `src/components/History/RecordExportMenu.test.tsx`
    - `src/components/SetupWizard/applySetup.test.ts`
    - `src/components/SetupWizard/applySetup.lineup.test.ts`
    - `src/components/SettingsPage/LocalVoices.test.tsx`
    - `src/components/SettingsPage/categories.test.ts`
    - `src/components/providers/ProviderPicker.test.tsx`
    - `src/components/providers/useProviderEntry.test.tsx`
    - `src/components/Settings/sections/SpeechSection.test.tsx` (it mocks the whole registry)
  - providers:
    - `src/providers/localInference/transcriptionUnit.run.test.ts`
    - `src/providers/openai_text/translation.run.test.ts`
    - `src/providers/soniox/otherVoice.test.ts`
    - `src/providers/soniox/units.test.ts`
    - `src/providers/soniox/voiceAlone.test.ts`
    - `src/providers/soniox/voiceAlone.run.test.ts`
  - Three of these (`RecordExportMenu`, `appAutoSave`, `ProviderPicker`) do not show the error: their code catches it and they fail on another assertion.
  - Any other file that fails with "No line-up catalog is registered" gets the same line.

**Interfaces:**
- Consumes: Task 1's `catalogOf`, `RELEASED_CAPS`, `DEV_ONLY`; Task 2's `allCaps`.
- Produces:
  - `registerCatalog(entries: readonly ProviderCaps[]): void`;
  - `allCaps()`, which throws `Error('No line-up catalog is registered: load the provider registry (or, in a test, register one) first.')` while none is registered;
  - `registerReleasedCatalog(): void`;
  - `SRC: string` and `reached(entry: string): Set<string>` from `src/lib/plan/importWalk.testing.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// catalog.test.ts, a describe with a fresh module per case (`vi.resetModules(); catalog = await import('./catalog')`), as present.test.ts does
it('throws while no catalog is registered', () => { expect(() => catalog.allCaps()).toThrow(/No line-up catalog is registered/); expect(() => catalog.caps('soniox')).toThrow(); });
it('reads the registered catalog when none is given', () => {
  const only = [{ id: 'x', stages: ['speech'], host: 'x', account: 'none', voiceAlone: true, takesVoice: false }] as const;
  catalog.registerCatalog(only);
  expect(catalog.caps('x')).toBe(only[0]);
  expect(catalog.caps('soniox')).toBeUndefined();
});
// catalog.test.ts, under the registry it already imports
it('lists every released provider, also one this platform does not offer', () => {
  expect(allCaps().map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
  const web = presentProviders({ platform: 'web', dev: false, enabled: new Set(), kizuna: true, switchOn: () => false });
  expect(web.some((p) => p.id === 'openai_text')).toBe(false);
  expect(caps('openai_text')).toBeDefined();
});
// categories.test.ts
it('the settings categories load before any catalog is registered', async () => {
  vi.resetModules();
  const fresh = await import('./categories');
  expect(fresh.CATEGORIES.map((c) => c.id)).toContain('accounts');
  (await import('../../lib/lineup/catalog.testing')).registerReleasedCatalog();
  expect(fresh.filterCategories('Soniox', (k) => (k === 'providers.soniox.name' ? 'Soniox' : '')).map((c) => c.id)).toEqual(['accounts']);
});
// catalog.cycle.test.ts
it('the catalog reaches no provider module and no store: the registry registers it', () => {
  for (const entry of ['lib/lineup/catalog.ts', 'lib/lineup/capsOf.ts']) {
    const files = [...reached(entry)].map((f) => relative(SRC, f));
    expect(files.filter((f) => f.startsWith('providers/') || f.startsWith('stores/')), entry).toEqual([]);
  }
  expect(reached('providers/registry.ts').has(resolve(SRC, 'lib/lineup/capsOf.ts'))).toBe(true);
});
// fake/voice.test.ts and fake/stages.test.ts: as today, with `import('../registry')` in build() and the fakes' account 'key'.
```

- [ ] **Step 2:** Run `npx vitest run src/lib/lineup src/components/SettingsPage/categories.test.ts src/providers/fake`. Expected: FAIL (`registerCatalog` is not exported; `allCaps()` does not throw; the mode tests expect `'none'`).
- [ ] **Step 3:** Make the changes listed under Files. The registry's new imports are `registerCatalog` from `../lib/lineup/catalog` and `catalogOf` from `../lib/lineup/capsOf`. Neither reaches `fromStores.ts`, so `fromStores.cycle.test.ts` keeps passing.
- [ ] **Step 4:** Run `npx vitest run src/lib/lineup src/lib/plan src/components/SettingsPage src/providers/fake src/providers/soniox src/stores`. Expected: PASS. The injected-catalog tests (`choose.test.ts`'s `notAlone`, `choice.test.ts`, `checks.test.ts:121`, `LineUpCategory.test.tsx`, `lineUpStore.test.ts`, `soniox/voiceAlone*.test.ts`) still refuse a voice that is not alone, with no expectation edited.
- [ ] **Step 5:** Run `npx vitest run`. Expected: no new failures compared with the base.
  - `git grep -n "endToEnd('" -- src/lib/lineup/catalog.ts` prints nothing.
  - `git grep -n "MODE === 'e2e'" -- src/lib/lineup` prints nothing.
- [ ] **Step 6:** Commit `refactor(lineup): the registry registers the catalog its providers declare; the hand-written list goes`.

### Task 4: `optionStages` is `settingsStages`: the layout of a provider's options, not what it can do

A pure rename. No value changes.

**Files:**
- Modify: `src/lib/provider/types.ts:324-328`. Use this doc:

```ts
/**
 * The layout of its options on the line-up page, not what it can do (its units say that): the stage sets its options
 * act on (mock v19), one per kind of `StagePart` in `Settings` (and the `Engine`'s slots), from
 * `src/lib/lineup/types.ts`. The page reads it to know which stage cards show options and where a setting acting on
 * several stages is shown. A provider that does every stage may still keep its options on one card: OpenAI
 * Translate's sit on the transcription card. Absent: every option shows in the provider's first card.
 */
settingsStages?: readonly (readonly RunStage[])[];
```

- Modify:
  - `src/lib/provider/managed.ts:34-35,72-73`: the override and the carry;
  - `src/lib/lineup/types.ts:14-18` (doc);
  - `src/components/providers/stageParts.tsx:76-89`: `cardOptions`'s first parameter and its doc;
  - `src/components/SettingsPage/LineUpCategory.tsx`: the comment at `:293`, and `:305`, `:340`;
  - the 15 declarations (`git grep -n "optionStages:" -- src/providers`);
  - `src/providers/{bing,edge,openai_text}/provider.test.ts`.
- Rename: `git mv src/providers/optionStages.consistency.test.ts src/providers/settingsStages.consistency.test.ts`, with its describe name and comments.

**Interfaces:**
- Produces:
  - `Provider.settingsStages?`;
  - `ManagedOverrides.settingsStages?`;
  - `cardOptions(settingsStages: readonly (readonly RunStage[])[] | undefined, served, stage, hasTurnDetection)`.

- [ ] **Step 1:** Rename. `git grep -n optionStages -- src` prints nothing.
- [ ] **Step 2:** Run `npx vitest run src/providers/settingsStages.consistency.test.ts src/components/providers src/components/SettingsPage src/lib/provider src/providers/bing src/providers/edge src/providers/openai_text`. Expected: PASS, no expectation edited beyond the renamed member.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` passes per Global Constraints, then `npx vitest run`. Expected: no new failures.
- [ ] **Step 4:** Commit `refactor(providers): optionStages is settingsStages: the layout of a provider's options, not what it can do`.

### Task 5: Whole-suite verification and the owner's go-ahead

- [ ] **Step 1:** `npx vitest run`. Expected: only the base's failures (the four `src/lib/reading/ja` failures, if this machine still shows them on `main`).
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.json`. Expected: no error in a touched file, and the total is not above the base's.
- [ ] **Step 3:** `npm run e2e:build && npm run e2e`. Expected: all pass. This is the only check that the E2E build's catalog holds the fakes, and that the app starts with the registered catalog.
- [ ] **Step 4:** Push `refactor/stages-declared-once` to `kizuna-ai-lab/sokuji` and open its PR into `main` (the owner authorised opening the step 2-4 PRs directly, 2026-11-22). The PR body lists the two accepted differences and the rule report below.

---

## Derivation rules against today's catalog (checked 2026-11-23 on 93303627d)

A throwaway test derived every entry from all 21 providers (the 16 released ones and the 5 fakes) and compared it with `CAPS`:
- `host`, `stages` and `voiceAlone` hold for every entry.
- `joint` (worded: "the stages it serves that no unit can serve apart from each other"; as first worded, "the stages no unit serves apart", it held vacuously for a stage nothing serves) and `takesVoice` hold for every entry that is not end to end.
  - Eight providers differ: the seven own-key end-to-end ones plus `kizunaai_qwen`, and `fake_leased`. Their units give `joint: TR_TL` and `takesVoice: true`, because their whole unit also serves text alone when `speech` is not `'always'`. The `endToEnd` flag covers exactly these nine.
- `translatesOwn` as worded ("TR is occupied without TL, and TL never without TR") is vacuously true for `fake_transcriber`, which never occupies TL. The added condition "some occupation has TL" fixes it, and then it holds for all 21.
- `takesVoice` for providers that are not end to end had no rule. "Some occupation has no speech" holds for all 21.
- `account` from `kind` fails for the five E2E fakes (see Accepted differences 1).
- Every provider's occupations are the same under no settings and under its defaults: nothing today depends on settings.
