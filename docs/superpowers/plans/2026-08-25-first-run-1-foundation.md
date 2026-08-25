# First-Run Setup — Plan 1: Foundation (persistence, migration, managed default)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land everything the setup wizard (Plan 2) and the tour (Plan 3) both depend on, with no user-visible change: the shared types and scenario table, the `settings.setup` / `settings.tour` records with their store and the legacy-user migration, the settings-panel state lifted into a store, the `credentialFields` descriptor contract, and Kizuna Soniox as the managed default.

**Architecture:** Pure modules first (`src/lib/setup/`), then one small Zustand store (`setupStore`) hydrated from `SettingsService` beside the existing stores in `Home`, then two seams in existing code (`layoutStore` for the settings panel; `credentialFields` on every descriptor). Nothing in this plan renders UI or changes behaviour for a user who already has settings.

**Tech Stack:** React 19, TypeScript (strict, `noUnusedLocals`), Zustand, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md` — §1.4 (draft shape), §1.8 (`credentialFields`), §2.1 (`layoutStore`), §2.3 (`settings.tour`), §3.1 (migration), §3.3 (managed default).

## Global Constraints

- **Baseline**: `23209265` (main with #443) plus the spec commit `7a259f20`. Confirm before starting: `git merge-base --is-ancestor 7a259f20 HEAD` must exit 0.
- **Working directory**: every command runs from
  `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/first-run-setup-and-tour`.
  Never `cd` to the repository root. `node_modules` here is a symlink into the main checkout.
- **Test command**: always `npx vitest run -c vitest.worktree.config.ts <paths>`. The plain config refuses files that resolve through the symlinked `node_modules` (`Error: Denied ID …workletProcessor.js?url`) and paints 9 unrelated files red. The override is untracked and excluded from `git status` — never commit it.
- **Baseline test noise, measured**: with the override, over `src/stores src/services/providers src/contexts src/components/MainLayout src/components/Settings/ src/components/TitleBar src/components/MainPanel src/components/Auth src/locales src/utils src/routes src/components/Subtitle` the tree is **159 files / 1745 tests, all passing, 4 unhandled rejections** (all from `settingsStore.nativeGate.test.ts`, `validateApiKey`'s native branch) and **exit code 1 because of those 4**. That is the floor. A new failing test is yours; the 4 rejections are not.
- **Type-check A/B before every commit.** Baseline `npx tsc --noEmit` reports **329** errors repo-wide. Per directory: `src/stores` 27, `src/services/providers` 22, `src/contexts` 0, `src/components/MainLayout` 1, `src/components/Settings/` 23, `src/components/TitleBar` 0, `src/components/MainPanel` 12, `src/components/Auth` 8, `src/locales` 0, `src/utils` 6, `src/routes` 1, `src/lib/analytics.ts` 1. The bar is **zero new errors**: `npx tsc --noEmit 2>&1 | grep -cE "^src/(paths you touched)"` before and after must match. New files must contribute 0.
- **Never `git stash`** — the stash stack is shared with the main checkout and other sessions.
- **Do not `git push` and do not open a PR.** Commit locally only.
- **Language**: code, comments, commit messages in English; conventional commits.
- **TDD, strictly**: write the failing test, run it, watch it fail, then implement. If a test passes before the implementation exists, the test is wrong — fix the test.
- **Locale policy**: this plan adds **no** locale keys. (Plans 2–3 add to `en` only; Plan 4 sweeps the other 29.)
- **Import hygiene**: `src/lib/setup/*` must not import from `src/stores/*` at runtime (type-only imports are erased and allowed). `settingsStore` statically imports `audioStore`; never import `settingsStore` from `audioStore`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/setup/types.ts` (new) | `ScenarioId`, `ProviderPath`, `SetupRecord`, `TourRecord`, `SETUP_VERSION`, `TOUR_VERSION` |
| `src/lib/setup/scenarios.ts` (new) | The five scenario presets; `providerFitForScenario` |
| `src/lib/setup/setupMigration.ts` (new) | Pure decision: legacy evidence → records to write |
| `src/stores/setupStore.ts` (new) | Holds `setup`/`tour` records; `hydrate`, `completeSetup`, `completeTour` |
| `src/stores/layoutStore.ts` (new) | `showSettings` lifted out of `MainLayout` |
| `src/services/providers/ProviderDescriptor.ts` | `CredentialField`, `credentialFields` contract |
| `src/services/providers/*ProviderConfig.ts` | `credentialFields` overrides |
| `src/services/providers/ProviderConfigFactory.ts` | Managed default order |
| `src/stores/settingsStore.ts` | Managed fallback |
| `src/components/MainLayout/MainLayout.tsx` | Reads `showSettings` from `layoutStore` |
| `src/routes/Home.tsx` | Hydrates `setupStore` |

---

### Task 1: Kizuna Soniox becomes the managed default

**Files:**
- Modify: `src/services/providers/ProviderConfigFactory.ts:155-162`
- Modify: `src/stores/settingsStore.ts:390`
- Test: `src/services/providers/kizunaProviderGating.test.ts:163-176`, `:218-231`

**Interfaces:**
- Produces: `ProviderConfigFactory.getDefaultManagedProvider(): ProviderType | null` now prefers `KIZUNA_AI_SONIOX`.

- [ ] **Step 1: Flip the two existing tests that pin the old order**

In `src/services/providers/kizunaProviderGating.test.ts`, replace the test at lines 163–176:

```ts
  it('prefers managed Soniox where it is registered alongside the twins', async () => {
    const factory = await factoryWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_SONIOX);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('falls back to the Translate twin only when Soniox is not registered', async () => {
    const factory = await factoryWith({ openaiTranslate: true, volcengineAst2: true });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });
```

and the test at lines 218–231:

```ts
  it('sends a legacy user to managed Soniox even where the twins are registered', async () => {
    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });
    const migrated = migrateLegacyKizunaProvider('kizunaai');

    expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
    expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify the two new expectations fail**

Run: `npx vitest run -c vitest.worktree.config.ts src/services/providers/kizunaProviderGating.test.ts`
Expected: 2 failed (`prefers managed Soniox…` gets `kizunaai_openai_translate`; `sends a legacy user…even where…` gets `kizunaai_openai_translate`), rest pass.

- [ ] **Step 3: Reorder the preference list**

In `src/services/providers/ProviderConfigFactory.ts` replace lines 155–162:

```ts
  /** The managed provider a fresh sign-in lands on. Soniox first: it is the
   *  only managed provider open in production, and the wallet page states its
   *  rates. The twins stay as fallbacks for builds that register them alone. */
  static getDefaultManagedProvider(): ProviderType | null {
    const preferred = [
      Provider.KIZUNA_AI_SONIOX,
      Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      Provider.KIZUNA_AI_VOLCENGINE_AST2,
    ];
    return preferred.find((p) => this.configs.has(p)) ?? null;
  }
```

In `src/stores/settingsStore.ts` line 390, change the fallback:

```ts
  return ProviderConfigFactory.getDefaultManagedProvider() ?? Provider.KIZUNA_AI_SONIOX;
```

- [ ] **Step 4: Run the gating suite and its neighbours**

Run: `npx vitest run -c vitest.worktree.config.ts src/services/providers/kizunaProviderGating.test.ts src/stores/kizunaProviders.test.ts src/components/MainLayout`
Expected: all pass.

- [ ] **Step 5: Type-check A/B and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/(services/providers|stores)/"   # must equal the count taken before editing (49 at baseline)
git add src/services/providers/ProviderConfigFactory.ts src/stores/settingsStore.ts src/services/providers/kizunaProviderGating.test.ts
git commit -m "feat(providers): prefer managed Soniox as the sign-in default"
```

---

### Task 2: Setup types and the scenario table

**Files:**
- Create: `src/lib/setup/types.ts`
- Create: `src/lib/setup/scenarios.ts`
- Test: `src/lib/setup/scenarios.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SETUP_VERSION = 1; export const TOUR_VERSION = 1;
  export type ScenarioId = 'understand-others' | 'be-heard' | 'subtitle-myself' | 'two-way-voice' | 'two-way-text';
  export type ProviderPath = 'managed' | 'own-key' | 'offline';
  export type TourChapter = 'basics';
  export interface SetupRecord { version: number; scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string; completedAt: string; migratedFrom?: 'legacy' }
  export interface TourRecord { version: number; completedChapters: TourChapter[]; completedAt: string; method: 'finished' | 'skipped' | 'migrated' }
  export interface ScenarioPreset { id: ScenarioId; mode: 'speaker'|'participant'|'both'; textOnly: boolean; speakerDisplayMode?: 'source'|'translation'|'both'; participantDisplayMode?: 'source'|'translation'|'both' }
  export const SCENARIOS: readonly ScenarioPreset[];
  export function getScenario(id: ScenarioId): ScenarioPreset;
  export type ProviderFit = { ok: true } | { ok: false; reason: 'cannot-speak' | 'cannot-be-text-only' };
  export function providerFitForScenario(textOnlyCapability: 'always'|'optional'|'never', scenario: ScenarioPreset): ProviderFit;
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/setup/scenarios.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SCENARIOS, getScenario, providerFitForScenario } from './scenarios';

describe('scenario presets', () => {
  it('enumerates every meaningful mode × textOnly combination exactly once', () => {
    const combos = SCENARIOS.map((s) => `${s.mode}:${s.textOnly}`);
    // participant is text-only by construction (the leg never speaks), so it
    // appears once; speaker and both appear with both toggle values.
    expect(combos.sort()).toEqual([
      'both:false', 'both:true', 'participant:true', 'speaker:false', 'speaker:true',
    ]);
  });

  it('pins the presets the spec table lists', () => {
    expect(getScenario('understand-others')).toMatchObject({ mode: 'participant', textOnly: true, participantDisplayMode: 'translation' });
    expect(getScenario('be-heard')).toMatchObject({ mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' });
    expect(getScenario('subtitle-myself')).toMatchObject({ mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' });
    expect(getScenario('two-way-voice')).toMatchObject({ mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
    expect(getScenario('two-way-text')).toMatchObject({ mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
  });

  it('leaves the display mode of a leg the scenario does not run untouched', () => {
    expect(getScenario('understand-others').speakerDisplayMode).toBeUndefined();
    expect(getScenario('be-heard').participantDisplayMode).toBeUndefined();
  });
});

describe('providerFitForScenario', () => {
  const speaks = getScenario('be-heard');
  const wantsText = getScenario('subtitle-myself');
  const listens = getScenario('understand-others');

  it('rejects a text-only provider for a scenario that speaks', () => {
    expect(providerFitForScenario('always', speaks)).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(providerFitForScenario('always', getScenario('two-way-voice'))).toEqual({ ok: false, reason: 'cannot-speak' });
  });

  it('rejects an always-speaking provider for a subtitles-only scenario', () => {
    expect(providerFitForScenario('never', wantsText)).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(providerFitForScenario('never', getScenario('two-way-text'))).toEqual({ ok: false, reason: 'cannot-be-text-only' });
  });

  it('accepts any provider for the listening scenario — the participant leg never speaks', () => {
    expect(providerFitForScenario('always', listens)).toEqual({ ok: true });
    expect(providerFitForScenario('never', listens)).toEqual({ ok: true });
    expect(providerFitForScenario('optional', listens)).toEqual({ ok: true });
  });

  it('accepts an optional provider everywhere', () => {
    for (const s of SCENARIOS) expect(providerFitForScenario('optional', s)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/lib/setup/scenarios.test.ts`
Expected: FAIL — `Cannot find module './scenarios'`.

- [ ] **Step 3: Create the types module**

`src/lib/setup/types.ts`:

```ts
// src/lib/setup/types.ts
//
// Shared vocabulary for the first-run setup wizard and the tour. A LEAF module:
// no imports. Both `settings.setup` and `settings.tour` are persisted through
// SettingsService with exactly these shapes, so a change here is a storage
// format change — bump the matching *_VERSION.

/** Bumped when SetupRecord's meaning changes. A different stored version does
 *  NOT re-show the wizard; it only tells a reader what shape to expect. */
export const SETUP_VERSION = 1;

/** Bumped when the tour's catalogue changes enough that a "restart" should be
 *  recorded as a different tour. Never auto-restarts the tour (spec §2.3). */
export const TOUR_VERSION = 1;

export type ScenarioId =
  | 'understand-others'
  | 'be-heard'
  | 'subtitle-myself'
  | 'two-way-voice'
  | 'two-way-text';

export type ProviderPath = 'managed' | 'own-key' | 'offline';

export type TourChapter = 'basics';

export interface SetupRecord {
  version: number;
  /** null for users migrated from the pre-wizard app (spec §3.1). */
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  /** Provider id at the time the wizard finished (or the persisted one, when migrated). */
  provider: string;
  completedAt: string;
  migratedFrom?: 'legacy';
}

export interface TourRecord {
  version: number;
  completedChapters: TourChapter[];
  completedAt: string;
  method: 'finished' | 'skipped' | 'migrated';
}
```

- [ ] **Step 4: Create the scenario table**

`src/lib/setup/scenarios.ts`:

```ts
// src/lib/setup/scenarios.ts
//
// The five first-run scenarios and what each one sets. This is the whole
// "preset" concept: a scenario is a translation mode plus whether the speaker
// leg should speak, plus which half of a bilingual utterance each leg shows.
// The participant leg never speaks (every descriptor's
// buildParticipantSessionConfig forces textOnly, see utils/effectiveTextOnly),
// so `participant` has no voice variant.
//
// Local unions rather than the stores' types: this module must stay a leaf.
import type { ScenarioId } from './types';

export type ScenarioMode = 'speaker' | 'participant' | 'both';
export type ScenarioDisplayMode = 'source' | 'translation' | 'both';

export interface ScenarioPreset {
  id: ScenarioId;
  mode: ScenarioMode;
  textOnly: boolean;
  /** Left undefined when the scenario does not run that leg (spec §1.2). */
  speakerDisplayMode?: ScenarioDisplayMode;
  participantDisplayMode?: ScenarioDisplayMode;
}

export const SCENARIOS: readonly ScenarioPreset[] = [
  { id: 'understand-others', mode: 'participant', textOnly: true, participantDisplayMode: 'translation' },
  { id: 'be-heard', mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' },
  { id: 'subtitle-myself', mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' },
  { id: 'two-way-voice', mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
  { id: 'two-way-text', mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
];

export function getScenario(id: ScenarioId): ScenarioPreset {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

/** Does the scenario produce spoken translation? Only a speaker leg can. */
export function scenarioSpeaks(s: ScenarioPreset): boolean {
  return s.mode !== 'participant' && !s.textOnly;
}

/** Does the scenario require the speaker leg to stay silent? */
export function scenarioWantsTextOnly(s: ScenarioPreset): boolean {
  return s.mode !== 'participant' && s.textOnly;
}

export type ProviderFit =
  | { ok: true }
  | { ok: false; reason: 'cannot-speak' | 'cannot-be-text-only' };

/** Whether a provider can serve a scenario, judged on its
 *  ProviderCapabilities.textOnlyCapability alone (spec §1.2, step 2). */
export function providerFitForScenario(
  textOnlyCapability: 'always' | 'optional' | 'never',
  scenario: ScenarioPreset,
): ProviderFit {
  if (textOnlyCapability === 'always' && scenarioSpeaks(scenario)) {
    return { ok: false, reason: 'cannot-speak' };
  }
  if (textOnlyCapability === 'never' && scenarioWantsTextOnly(scenario)) {
    return { ok: false, reason: 'cannot-be-text-only' };
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/lib/setup/scenarios.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/lib/setup/"    # must be 0
git add src/lib/setup/types.ts src/lib/setup/scenarios.ts src/lib/setup/scenarios.test.ts
git commit -m "feat(setup): add scenario presets and setup/tour record types"
```

---

### Task 3: Legacy-user migration decision (pure)

**Files:**
- Create: `src/lib/setup/setupMigration.ts`
- Test: `src/lib/setup/setupMigration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LegacyEvidence { persistedUiMode: string | null; legacyUserType: string | null; legacyOnboarding: string | null; persistedProvider: string; now: string }
  export interface MigrationPlan { setup: SetupRecord | null; tour: TourRecord | null; clearLegacyKeys: boolean }
  export const LEGACY_USER_TYPE_KEY = 'sokuji_user_type';
  export const LEGACY_ONBOARDING_KEY = 'sokuji_onboarding_completed';
  export function planSetupMigration(e: LegacyEvidence): MigrationPlan;
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/setup/setupMigration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planSetupMigration } from './setupMigration';
import { SETUP_VERSION, TOUR_VERSION } from './types';

const NOW = '2026-08-25T00:00:00.000Z';
const base = { persistedUiMode: null, legacyUserType: null, legacyOnboarding: null, persistedProvider: 'openai', now: NOW };

describe('planSetupMigration', () => {
  it('does nothing for a fresh install — the wizard must show', () => {
    expect(planSetupMigration(base)).toEqual({ setup: null, tour: null, clearLegacyKeys: false });
  });

  it('marks setup complete for a user who has a persisted uiMode (synced profile, no localStorage)', () => {
    const plan = planSetupMigration({ ...base, persistedUiMode: 'advanced', persistedProvider: 'soniox' });
    expect(plan.setup).toEqual({
      version: SETUP_VERSION, scenario: null, providerPath: null,
      provider: 'soniox', completedAt: NOW, migratedFrom: 'legacy',
    });
    expect(plan.tour).toBeNull();
    expect(plan.clearLegacyKeys).toBe(true);
  });

  it('marks setup complete for a user who only has the localStorage user type', () => {
    const plan = planSetupMigration({ ...base, legacyUserType: 'regular' });
    expect(plan.setup?.migratedFrom).toBe('legacy');
    expect(plan.clearLegacyKeys).toBe(true);
  });

  it('carries a completed legacy tour over as a completed basics chapter', () => {
    const plan = planSetupMigration({
      ...base, legacyUserType: 'experienced',
      legacyOnboarding: JSON.stringify({ completed: true, version: '1.2.0', completedAt: '2026-01-01T00:00:00.000Z' }),
    });
    expect(plan.tour).toEqual({
      version: TOUR_VERSION, completedChapters: ['basics'], completedAt: NOW, method: 'migrated',
    });
  });

  it('ignores a legacy tour record that is not marked completed, or is unparseable', () => {
    expect(planSetupMigration({ ...base, legacyUserType: 'regular', legacyOnboarding: '{"completed":false}' }).tour).toBeNull();
    expect(planSetupMigration({ ...base, legacyUserType: 'regular', legacyOnboarding: 'not json' }).tour).toBeNull();
  });

  it('never invents a tour record for a user with no setup evidence', () => {
    const plan = planSetupMigration({ ...base, legacyOnboarding: '{"completed":true}' });
    expect(plan).toEqual({ setup: null, tour: null, clearLegacyKeys: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/lib/setup/setupMigration.test.ts`
Expected: FAIL — `Cannot find module './setupMigration'`.

- [ ] **Step 3: Implement**

`src/lib/setup/setupMigration.ts`:

```ts
// src/lib/setup/setupMigration.ts
//
// Decides, from the evidence an existing install leaves behind, whether the
// user has already been through first-run — before the wizard existed — and
// therefore must never see it (spec §3.1). Pure: the store gathers the
// evidence and applies the plan.
import { SETUP_VERSION, TOUR_VERSION } from './types';
import type { SetupRecord, TourRecord } from './types';

/** localStorage keys the pre-wizard OnboardingContext wrote. */
export const LEGACY_USER_TYPE_KEY = 'sokuji_user_type';
export const LEGACY_ONBOARDING_KEY = 'sokuji_onboarding_completed';

export interface LegacyEvidence {
  /** Raw `settings.common.uiMode` from SettingsService, null when absent.
   *  Every user of the old choice screen wrote it, and in the extension it
   *  roams with the synced profile — so it is the evidence that survives a
   *  new machine. */
  persistedUiMode: string | null;
  /** Raw localStorage `sokuji_user_type`, null when absent. */
  legacyUserType: string | null;
  /** Raw localStorage `sokuji_onboarding_completed` JSON, null when absent. */
  legacyOnboarding: string | null;
  /** Raw `settings.common.provider` (already defaulted by the caller). */
  persistedProvider: string;
  now: string;
}

export interface MigrationPlan {
  setup: SetupRecord | null;
  tour: TourRecord | null;
  clearLegacyKeys: boolean;
}

function legacyTourCompleted(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { completed?: unknown };
    return parsed?.completed === true;
  } catch {
    return false;
  }
}

export function planSetupMigration(e: LegacyEvidence): MigrationPlan {
  const isLegacyUser = e.persistedUiMode !== null || e.legacyUserType !== null;
  if (!isLegacyUser) return { setup: null, tour: null, clearLegacyKeys: false };

  const setup: SetupRecord = {
    version: SETUP_VERSION,
    scenario: null,
    providerPath: null,
    provider: e.persistedProvider,
    completedAt: e.now,
    migratedFrom: 'legacy',
  };
  const tour: TourRecord | null = legacyTourCompleted(e.legacyOnboarding)
    ? { version: TOUR_VERSION, completedChapters: ['basics'], completedAt: e.now, method: 'migrated' }
    : null;
  return { setup, tour, clearLegacyKeys: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/lib/setup/setupMigration.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/lib/setup/"    # 0
git add src/lib/setup/setupMigration.ts src/lib/setup/setupMigration.test.ts
git commit -m "feat(setup): decide legacy-user migration from persisted evidence"
```

---

### Task 4: `setupStore` — hydrate, complete setup, complete tour

**Files:**
- Create: `src/stores/setupStore.ts`
- Modify: `src/routes/Home.tsx:22-30`
- Test: `src/stores/setupStore.test.ts`

**Interfaces:**
- Consumes: `planSetupMigration`, `LEGACY_*_KEY` (Task 3); `SetupRecord`, `TourRecord`, `SETUP_VERSION`, `TOUR_VERSION` (Task 2); `ServiceFactory.getSettingsService()`.
- Produces:
  ```ts
  export const SETUP_STORAGE_KEY = 'settings.setup'; export const TOUR_STORAGE_KEY = 'settings.tour';
  interface SetupStore {
    setup: SetupRecord | null; tour: TourRecord | null; loaded: boolean;
    hydrate: () => Promise<void>;
    completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
    completeTour: (chapter: TourChapter, method: 'finished' | 'skipped') => Promise<void>;
  }
  export const useSetupStore; export const useSetupRecord; export const useTourRecord; export const useSetupLoaded;
  export const useSetupComplete: () => boolean;   // loaded && setup !== null
  export const useCompleteSetup; export const useCompleteTour;
  ```

- [ ] **Step 1: Write the failing tests**

`src/stores/setupStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
const mockGetSetting = vi.fn(async (key: string, dflt: unknown) => (store.has(key) ? store.get(key) : dflt));
const mockSetSetting = vi.fn(async (key: string, value: unknown) => { store.set(key, value); return { success: true }; });
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }) },
}));

const { useSetupStore, SETUP_STORAGE_KEY, TOUR_STORAGE_KEY } = await import('./setupStore');
const { SETUP_VERSION, TOUR_VERSION } = await import('../lib/setup/types');
const { LEGACY_USER_TYPE_KEY, LEGACY_ONBOARDING_KEY } = await import('../lib/setup/setupMigration');

beforeEach(() => {
  store.clear();
  localStorage.clear();
  vi.clearAllMocks();
  useSetupStore.setState({ setup: null, tour: null, loaded: false });
});

describe('setupStore.hydrate', () => {
  it('leaves setup null on a fresh install and marks loaded', async () => {
    await useSetupStore.getState().hydrate();
    expect(useSetupStore.getState()).toMatchObject({ setup: null, tour: null, loaded: true });
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('reads an existing record without rewriting it', async () => {
    const record = { version: SETUP_VERSION, scenario: 'be-heard', providerPath: 'managed', provider: 'kizunaai_soniox', completedAt: 'x' };
    store.set(SETUP_STORAGE_KEY, record);
    await useSetupStore.getState().hydrate();
    expect(useSetupStore.getState().setup).toEqual(record);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('migrates a legacy user: writes setup, carries the tour, clears localStorage', async () => {
    store.set('settings.common.uiMode', 'basic');
    store.set('settings.common.provider', 'gemini');
    localStorage.setItem(LEGACY_USER_TYPE_KEY, 'regular');
    localStorage.setItem(LEGACY_ONBOARDING_KEY, JSON.stringify({ completed: true }));

    await useSetupStore.getState().hydrate();

    const s = useSetupStore.getState();
    expect(s.setup).toMatchObject({ version: SETUP_VERSION, scenario: null, providerPath: null, provider: 'gemini', migratedFrom: 'legacy' });
    expect(s.tour).toMatchObject({ version: TOUR_VERSION, completedChapters: ['basics'], method: 'migrated' });
    expect(store.get(SETUP_STORAGE_KEY)).toEqual(s.setup);
    expect(store.get(TOUR_STORAGE_KEY)).toEqual(s.tour);
    expect(localStorage.getItem(LEGACY_USER_TYPE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_ONBOARDING_KEY)).toBeNull();
  });
});

describe('setupStore.completeSetup / completeTour', () => {
  it('writes a versioned setup record and exposes it', async () => {
    await useSetupStore.getState().completeSetup({ scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' });
    const rec = useSetupStore.getState().setup!;
    expect(rec).toMatchObject({ version: SETUP_VERSION, scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' });
    expect(typeof rec.completedAt).toBe('string');
    expect(store.get(SETUP_STORAGE_KEY)).toEqual(rec);
  });

  it('records a finished chapter once, preserving earlier chapters', async () => {
    await useSetupStore.getState().completeTour('basics', 'skipped');
    await useSetupStore.getState().completeTour('basics', 'finished');
    const rec = useSetupStore.getState().tour!;
    expect(rec.completedChapters).toEqual(['basics']);
    expect(rec.method).toBe('finished');
    expect(rec.version).toBe(TOUR_VERSION);
    expect(store.get(TOUR_STORAGE_KEY)).toEqual(rec);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/setupStore.test.ts`
Expected: FAIL — `Cannot find module './setupStore'`.

- [ ] **Step 3: Implement the store**

`src/stores/setupStore.ts`:

```ts
// src/stores/setupStore.ts
//
// Whether first-run setup has happened, and whether the tour has been seen.
// Two records, both persisted through SettingsService so they roam with the
// rest of the profile in the extension (spec §1.5, §2.3). Hydration runs the
// legacy migration (spec §3.1) exactly once: when no setup record exists yet.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ServiceFactory } from '../services/ServiceFactory';
import { SETUP_VERSION, TOUR_VERSION } from '../lib/setup/types';
import type { ProviderPath, ScenarioId, SetupRecord, TourChapter, TourRecord } from '../lib/setup/types';
import { planSetupMigration, LEGACY_USER_TYPE_KEY, LEGACY_ONBOARDING_KEY } from '../lib/setup/setupMigration';

export const SETUP_STORAGE_KEY = 'settings.setup';
export const TOUR_STORAGE_KEY = 'settings.tour';

export interface SetupStore {
  setup: SetupRecord | null;
  tour: TourRecord | null;
  /** False until hydrate() has resolved. MainLayout must not decide whether
   *  to show the wizard before this is true, or a migrated user would see it
   *  flash on every launch. */
  loaded: boolean;
  hydrate: () => Promise<void>;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
  completeTour: (chapter: TourChapter, method: 'finished' | 'skipped') => Promise<void>;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export const useSetupStore = create<SetupStore>()(
  subscribeWithSelector((set, get) => ({
    setup: null,
    tour: null,
    loaded: false,

    hydrate: async () => {
      const service = ServiceFactory.getSettingsService();
      try {
        const existing = await service.getSetting<SetupRecord | null>(SETUP_STORAGE_KEY, null);
        const tour = await service.getSetting<TourRecord | null>(TOUR_STORAGE_KEY, null);
        if (existing) {
          set({ setup: existing, tour, loaded: true });
          return;
        }
        const plan = planSetupMigration({
          persistedUiMode: await service.getSetting<string | null>('settings.common.uiMode', null),
          legacyUserType: readLocal(LEGACY_USER_TYPE_KEY),
          legacyOnboarding: readLocal(LEGACY_ONBOARDING_KEY),
          persistedProvider: await service.getSetting<string>('settings.common.provider', 'openai'),
          now: new Date().toISOString(),
        });
        if (plan.setup) await service.setSetting(SETUP_STORAGE_KEY, plan.setup);
        if (plan.tour) await service.setSetting(TOUR_STORAGE_KEY, plan.tour);
        if (plan.clearLegacyKeys) {
          removeLocal(LEGACY_USER_TYPE_KEY);
          removeLocal(LEGACY_ONBOARDING_KEY);
        }
        set({ setup: plan.setup, tour: plan.tour ?? tour, loaded: true });
      } catch (error) {
        console.error('[SetupStore] Error hydrating setup state:', error);
        set({ loaded: true });
      }
    },

    completeSetup: async ({ scenario, providerPath, provider }) => {
      const record: SetupRecord = {
        version: SETUP_VERSION,
        scenario,
        providerPath,
        provider,
        completedAt: new Date().toISOString(),
      };
      set({ setup: record });
      await ServiceFactory.getSettingsService().setSetting(SETUP_STORAGE_KEY, record);
    },

    completeTour: async (chapter, method) => {
      const prev = get().tour;
      const chapters = prev?.completedChapters ?? [];
      const record: TourRecord = {
        version: TOUR_VERSION,
        completedChapters: chapters.includes(chapter) ? chapters : [...chapters, chapter],
        completedAt: new Date().toISOString(),
        method,
      };
      set({ tour: record });
      await ServiceFactory.getSettingsService().setSetting(TOUR_STORAGE_KEY, record);
    },
  })),
);

export const useSetupRecord = () => useSetupStore((s) => s.setup);
export const useTourRecord = () => useSetupStore((s) => s.tour);
export const useSetupLoaded = () => useSetupStore((s) => s.loaded);
/** True once hydration has run AND a setup record exists — the condition
 *  MainLayout uses to skip the wizard. */
export const useSetupComplete = () => useSetupStore((s) => s.loaded && s.setup !== null);
export const useCompleteSetup = () => useSetupStore((s) => s.completeSetup);
export const useCompleteTour = () => useSetupStore((s) => s.completeTour);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/setupStore.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Hydrate from `Home`**

In `src/routes/Home.tsx`, add the import and the hydrate call:

```tsx
import { useSetupStore } from '../stores/setupStore';
```

and change the `Promise.all` at lines 22–28 to:

```tsx
    Promise.all([
      loadSettings(),
      useSubtitleStore.getState().hydrate(),
      useConversationDisplayStore.getState().hydrate(),
      useSetupStore.getState().hydrate(),
    ]).catch((err) => {
      console.warn('[Home] Settings/subtitle/conversationDisplay/setup hydration error:', err);
    });
```

- [ ] **Step 6: Run the routes tests, type-check, commit**

Run: `npx vitest run -c vitest.worktree.config.ts src/routes src/stores/setupStore.test.ts`
Expected: all pass (`src/routes` has no tests today — vitest reports "No test files found" for that path and passes the other).

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/(stores|routes)/"   # equals the pre-edit count (28 at baseline)
git add src/stores/setupStore.ts src/stores/setupStore.test.ts src/routes/Home.tsx
git commit -m "feat(setup): persist setup and tour records, migrate legacy users on hydrate"
```

---

### Task 5: Lift `showSettings` into `layoutStore`

**Files:**
- Create: `src/stores/layoutStore.ts`
- Modify: `src/components/MainLayout/MainLayout.tsx:37-39`, `:84-107`, `:144-155`, `:223-228`, `:235`, `:255-268`
- Test: `src/stores/layoutStore.test.ts`; existing `src/components/MainLayout/MainLayout.keepAlive.test.tsx` must stay green **unchanged**

**Interfaces:**
- Produces:
  ```ts
  export const SHOW_SETTINGS_SESSION_KEY = 'panelState.showSettings';
  interface LayoutStore { showSettings: boolean; setShowSettings: (v: boolean) => void }
  export const useLayoutStore; export const useShowSettings; export const useSetShowSettings;
  ```
  Plan 3's tour engine calls `useLayoutStore.getState().setShowSettings(true)` from a step's `prepare`.

- [ ] **Step 1: Write the failing test**

`src/stores/layoutStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, SHOW_SETTINGS_SESSION_KEY } from './layoutStore';

beforeEach(() => {
  sessionStorage.clear();
  useLayoutStore.setState({ showSettings: false });
});

describe('layoutStore', () => {
  it('persists showSettings to sessionStorage the way MainLayout did', () => {
    useLayoutStore.getState().setShowSettings(true);
    expect(useLayoutStore.getState().showSettings).toBe(true);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('true');
    useLayoutStore.getState().setShowSettings(false);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('false');
  });

  it('initialises from sessionStorage', () => {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, 'true');
    expect(useLayoutStore.getState().readInitial()).toBe(true);
    sessionStorage.removeItem(SHOW_SETTINGS_SESSION_KEY);
    expect(useLayoutStore.getState().readInitial()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/layoutStore.test.ts`
Expected: FAIL — `Cannot find module './layoutStore'`.

- [ ] **Step 3: Implement**

`src/stores/layoutStore.ts`:

```ts
// src/stores/layoutStore.ts
//
// The settings panel's open/closed state, lifted out of MainLayout so that a
// surface which is not MainLayout — the tour (spec §2.1) — can open the panel
// through the same state the title-bar button uses, instead of synthetically
// clicking that button. Persistence stays where it was: sessionStorage, so a
// reload within the same window keeps the panel as the user left it.
import { create } from 'zustand';

export const SHOW_SETTINGS_SESSION_KEY = 'panelState.showSettings';

function readSession(): boolean {
  try {
    return sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSession(value: boolean): void {
  try {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, value ? 'true' : 'false');
  } catch {
    /* sessionStorage unavailable — state still lives in the store */
  }
}

export interface LayoutStore {
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
  /** Exposed for tests; the store seeds itself from it at module load. */
  readInitial: () => boolean;
}

export const useLayoutStore = create<LayoutStore>()((set) => ({
  showSettings: readSession(),
  setShowSettings: (value) => {
    writeSession(value);
    set({ showSettings: value });
  },
  readInitial: readSession,
}));

export const useShowSettings = () => useLayoutStore((s) => s.showSettings);
export const useSetShowSettings = () => useLayoutStore((s) => s.setShowSettings);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/layoutStore.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Take the keepAlive baseline, then rewire `MainLayout`**

Run first: `npx vitest run -c vitest.worktree.config.ts src/components/MainLayout` — Expected: all pass (this is the guard; it must still pass after the edit with **no changes to the test file**).

In `src/components/MainLayout/MainLayout.tsx`:

Add the import after line 15:
```tsx
import { useShowSettings, useSetShowSettings } from '../../stores/layoutStore';
```

Replace lines 37–39 (`const [showSettings, setShowSettings] = useState(() => {…});`) with:
```tsx
  const showSettings = useShowSettings();
  const setShowSettings = useSetShowSettings();
```

In `toggleSettings` (lines 94–107) and the `showLogs` toggle path and the navigation effect (144–155), delete every `sessionStorage.setItem('panelState.showSettings', …)` line — the store writes it now. The three sites become:

```tsx
  const toggleSettings = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showSettings) {
      setShowSettings(false);
      trackPanelView(null);
    } else {
      setShowSettings(true);
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  };
```

```tsx
  useEffect(() => {
    if (settingsNavigationTarget) {
      // Open settings panel when navigation is requested
      setShowSettings(true);
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  }, [settingsNavigationTarget, setShowSettings]);
```

Search the file for any other `setShowSettings(` / `'panelState.showSettings'` (the logs toggle at ~84–92 closes settings when opening logs) and apply the same rule: keep the `setShowSettings(...)` call, drop the sessionStorage line for `showSettings` only. `showLogs` keeps its local state and its sessionStorage line.

- [ ] **Step 6: Run the MainLayout suite and the new store test**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/MainLayout src/stores/layoutStore.test.ts`
Expected: all pass, keepAlive test file untouched (`git diff --stat src/components/MainLayout/MainLayout.keepAlive.test.tsx` prints nothing).

- [ ] **Step 7: Type-check A/B and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/(components/MainLayout|stores)/"   # equals pre-edit count (28 at baseline)
git add src/stores/layoutStore.ts src/stores/layoutStore.test.ts src/components/MainLayout/MainLayout.tsx
git commit -m "refactor(layout): lift the settings panel state into layoutStore"
```

---

### Task 6: `credentialFields` on every descriptor

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts:210-262` (interface), `:312-367` (base)
- Modify: `src/services/providers/OpenAICompatibleProviderConfig.ts`, `PalabraAIProviderConfig.ts`, `VolcengineSTProviderConfig.ts`, `VolcengineAST2ProviderConfig.ts`, `ZoomAIProviderConfig.ts`, `SonioxProviderConfig.ts`, `LocalInferenceProviderConfig.ts`, `LocalNativeProviderConfig.ts`, `KizunaAIOpenAITranslateProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts`, `KizunaAISonioxProviderConfig.ts`
- Test: `src/services/providers/descriptorRegistry.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export interface CredentialField { key: string; labelKey: string; secret: boolean; placeholderKey?: string }
  // on ProviderDescriptor:
  readonly credentialFields: CredentialField[];
  ```
  Plan 2's credentials step renders one input per entry and writes `draft.credentials[field.key]`. `labelKey`s live under `setup.credentials.*` — Plan 2 adds them to `en`; this task only names them.

- [ ] **Step 1: Write the failing invariant**

`ProviderConfig` carries no defaults; each provider file exports its own
`default*Settings`, and the store's `PROVIDER_SLICE_REGISTRY` (private) maps slice
keys to them. The test builds the same map explicitly — do **not** import
`settingsStore` here (its import graph is the Denied-ID blast radius the registry
test's header warns about).

Append to `src/services/providers/descriptorRegistry.test.ts`:

```ts
import { defaultOpenAISettings } from './OpenAIProviderConfig';
import { defaultGeminiSettings } from './GeminiProviderConfig';
import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
import { defaultVolcengineSTSettings } from './VolcengineSTProviderConfig';
import { defaultZoomAISettings } from './ZoomAIProviderConfig';
import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { defaultSonioxSettings } from './SonioxProviderConfig';
import { defaultKizunaOpenaiTranslateSettings } from './KizunaAIOpenAITranslateProviderConfig';
import { defaultKizunaVolcengineAst2Settings } from './KizunaAIVolcengineAST2ProviderConfig';
import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';

/** Mirror of settingsStore's PROVIDER_SLICE_REGISTRY defaults, keyed the same way. */
const SLICE_DEFAULTS: Record<string, Record<string, unknown>> = {
  openai: defaultOpenAISettings,
  gemini: defaultGeminiSettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
  palabraai: defaultPalabraAISettings,
  openaiTranslate: defaultOpenAITranslateSettings,
  volcengineST: defaultVolcengineSTSettings,
  zoomAI: defaultZoomAISettings,
  volcengineAST2: defaultVolcengineAST2Settings,
  soniox: defaultSonioxSettings,
  kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
  kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
  kizunaSoniox: defaultKizunaSonioxSettings,
  localInference: defaultLocalInferenceSettings,
  localNative: defaultLocalNativeSettings,
};

describe('credentialFields (spec §1.8)', () => {
  const ctx = { getAuthToken: async () => 'session-token' };

  it('every descriptor declares the fields a user must fill, and filling exactly those completes its credentials', async () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(Array.isArray(d.credentialFields), `${id} credentialFields`).toBe(true);
      const defaults = SLICE_DEFAULTS[d.settingsSliceKey];
      expect(defaults, `${id}: SLICE_DEFAULTS lacks '${d.settingsSliceKey}' — add that provider's default*Settings export above`).toBeDefined();

      const filled: Record<string, unknown> = { ...defaults };
      for (const f of d.credentialFields) {
        expect(typeof f.key, `${id} field key`).toBe('string');
        expect(f.labelKey.startsWith('setup.credentials.'), `${id} ${f.key} labelKey`).toBe(true);
        filled[f.key] = f.secret ? 'sk-test-value' : 'https://example.test/v1';
      }
      const withFields = await d.extractCredentials(filled, ctx);
      expect(withFields.ok, `${id}: filling ${d.credentialFields.map((f) => f.key).join(',')} should complete credentials`).toBe(true);

      if (d.credentialFields.length > 0) {
        const bare = await d.extractCredentials({ ...defaults }, ctx);
        expect(bare.ok, `${id}: defaults alone must NOT be complete when fields are declared`).toBe(false);
      }
    }
  });
});
```

If any `default*Settings` name above does not match its file's export, run `grep -n "^export const default" src/services/providers/*ProviderConfig.ts` and use the real name — the map must cover every `settingsSliceKey` the registry test already enumerates.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL on the first descriptor — `expected undefined to be true` for `credentialFields`.

- [ ] **Step 3: Add the contract and the base default**

In `src/services/providers/ProviderDescriptor.ts`, after the `CredentialCtx` type (line 23) add:

```ts
/** One input the setup wizard renders for a user-managed provider. `key` is
 *  the settings-slice field the value is written to; `labelKey` is an i18n key
 *  under `setup.credentials.*`. Managed and local providers declare none. */
export interface CredentialField {
  key: string;
  labelKey: string;
  secret: boolean;
  placeholderKey?: string;
}
```

In the `ProviderDescriptor` interface, after `readonly supportsWebRTC: boolean;` add:

```ts
  /** Slice keys a user must fill for extractCredentials to succeed (spec §1.8).
   *  descriptorRegistry.test.ts proves the list is complete for every provider. */
  readonly credentialFields: CredentialField[];
```

In `BaseProviderDescriptor`, after `readonly supportsWebRTC: boolean = false;` add:

```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];
```

- [ ] **Step 4: Override where the base does not match `extractCredentials`**

Each override goes next to the descriptor's `extractCredentials`:

`OpenAICompatibleProviderConfig.ts`:
```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'customEndpoint', labelKey: 'setup.credentials.endpoint', secret: false, placeholderKey: 'setup.credentials.endpointPlaceholder' },
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];
```
`PalabraAIProviderConfig.ts` (the default slice has `authMode: 'platform'`, so the platform key is what the wizard collects):
```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];
```
`VolcengineSTProviderConfig.ts`:
```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'accessKeyId', labelKey: 'setup.credentials.accessKeyId', secret: false },
    { key: 'secretAccessKey', labelKey: 'setup.credentials.secretAccessKey', secret: true },
  ];
```
`VolcengineAST2ProviderConfig.ts`:
```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'appId', labelKey: 'setup.credentials.appId', secret: false },
    { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true },
  ];
```
`ZoomAIProviderConfig.ts`:
```ts
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
    { key: 'apiSecret', labelKey: 'setup.credentials.apiSecret', secret: true },
  ];
```
`SonioxProviderConfig.ts` (default region is `'us'` → `sonioxKeyField('us') === 'apiKey'`, so the base default is right; make it explicit so a future default-region change fails the invariant loudly rather than silently):
```ts
  readonly credentialFields: CredentialField[] = [
    { key: sonioxKeyField(DEFAULT_SONIOX_REGION), labelKey: 'setup.credentials.apiKey', secret: true },
  ];
```
(`DEFAULT_SONIOX_REGION` is exported from `src/lib/soniox/regions.ts`; import it if the file does not already.)

`LocalInferenceProviderConfig.ts`, `LocalNativeProviderConfig.ts`, `KizunaAIOpenAITranslateProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts`, `KizunaAISonioxProviderConfig.ts`:
```ts
  readonly credentialFields: CredentialField[] = [];
```

Import `CredentialField` from `'./ProviderDescriptor'` in each file you touch (type-only import is fine: `import type { CredentialField } from './ProviderDescriptor';` — check the file's existing import line from `./ProviderDescriptor` and extend it).

- [ ] **Step 5: Run the registry suite**

Run: `npx vitest run -c vitest.worktree.config.ts src/services/providers/descriptorRegistry.test.ts`
Expected: all pass, including the new invariant across 14 descriptors.

- [ ] **Step 6: Run the provider directory, type-check A/B, commit**

Run: `npx vitest run -c vitest.worktree.config.ts src/services/providers`
Expected: all pass.

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/services/providers/"   # equals pre-edit count (22 at baseline)
git add src/services/providers/
git commit -m "feat(providers): declare credentialFields on every descriptor"
```

---

### Task 7: Plan-level verification

- [ ] **Step 1: Full touched-directory run against the floor**

Run:
```bash
npx vitest run -c vitest.worktree.config.ts src/stores src/services/providers src/contexts src/components/MainLayout src/components/Settings/ src/components/TitleBar src/components/MainPanel src/components/Auth src/locales src/utils src/routes src/components/Subtitle src/lib/setup 2>&1 | grep -E "Test Files|Tests  |Errors|FAIL"
```
Expected: `Test Files  163 passed (163)` (159 + `scenarios`, `setupMigration`, `setupStore`, `layoutStore`), `Tests` = 1745 + 20 = 1765 passed, `Errors  4 errors` (the nativeGate floor), no `FAIL` lines.

- [ ] **Step 2: Repo-wide type-check A/B**

```bash
npx tsc --noEmit 2>&1 | grep -cE "error TS"    # 329 at baseline; must not exceed it
```

- [ ] **Step 3: Report**

Report the two numbers above, `git log --oneline 7a259f20..HEAD`, and anything the tasks discovered that the spec did not anticipate (e.g. the real name of `ProviderConfig`'s defaults field in Task 6).
