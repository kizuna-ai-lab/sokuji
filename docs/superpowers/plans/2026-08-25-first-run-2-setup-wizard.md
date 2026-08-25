# First-Run Setup — Plan 2: Setup Wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Regular / Experienced" first-launch screen with the six-step setup wizard — interface language → scenario → provider path → credentials → language pair → finish — that configures the app on Finish and is re-runnable from Help.

**Architecture:** A pure draft reducer (`setupDraft.ts`) holds every choice; pure helpers resolve provider paths, filter providers by scenario, and pick default languages; one async function (`applySetup.ts`) performs the Finish writes in the spec's order. The React layer is a thin frame plus one component per step. `MainLayout` renders the wizard in place of the layout on a fresh install (`setupStore.loaded && setup === null`) and as an overlay when Help requests a re-run.

**Tech Stack:** React 19, TypeScript (strict, `noUnusedLocals`), Zustand, react-i18next, lucide-react, SASS (`@use '../Settings/shared/variables' as vars`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md` §1 (all subsections), §3.2 (deletion of `UserTypeSelection`).

**Depends on:** Plan 1 (`src/lib/setup/*`, `setupStore`, `layoutStore`, `credentialFields`, managed default). Confirm: `git log --oneline 7a259f20..HEAD` lists Plan 1's six commits.

## Global Constraints

- **Working directory**: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/first-run-setup-and-tour`. Never `cd` elsewhere.
- **Test command**: `npx vitest run -c vitest.worktree.config.ts <paths>` — always with the override config (see Plan 1). Never commit `vitest.worktree.config.ts`.
- **Baseline test noise**: the touched-directory run is all-pass with **4 unhandled rejections** from `settingsStore.nativeGate.test.ts` (exit code 1). That is the floor; no `FAIL` line is acceptable.
- **Type-check A/B before every commit**: `npx tsc --noEmit 2>&1 | grep -cE "^src/(paths you touched)"` before and after must match; new files contribute 0. Repo-wide baseline after Plan 1 is ≤ 329.
- **Never `git stash`. Do not `git push`. Do not open a PR.**
- **Language**: code, comments, commit messages in English; conventional commits.
- **TDD, strictly**: failing test first; a test that passes before the implementation is wrong.
- **Locale policy**: add new keys to `src/locales/en/translation.json` **only**. `src/locales/locales.consistency.test.ts` is **expected to fail from Task 8 until Plan 4 sweeps the other 29 catalogues** — do not hand-fill other catalogues here. When you add keys, **list their full nested paths in your report**. Every other test must be green at every task boundary.
- **Analytics**: `AnalyticsEvents` in `src/lib/analytics.ts` is a closed map with no index signature; `trackEvent('x', …)` with an undeclared `x` is a type error. Task 7 declares the new events before any component fires them.
- **Store import hygiene**: pure modules under `SetupWizard/` (`setupDraft.ts`, `providerPaths.ts`, `languageDefaults.ts`) import types only from stores; `applySetup.ts` receives store actions as an argument and imports nothing from `src/stores`.

---

## File map

| File | Responsibility |
|---|---|
| `src/components/SetupWizard/setupDraft.ts` | Draft state, reducer, `canAdvance` |
| `src/components/SetupWizard/providerPaths.ts` | Which paths exist, which providers each path offers, fit per scenario |
| `src/components/SetupWizard/languageDefaults.ts` | Default source/target from a descriptor's option lists |
| `src/components/SetupWizard/applySetup.ts` | The Finish writes, in order (§1.5) |
| `src/components/SetupWizard/SetupWizard.tsx` | Frame: step indicator, Back/Next/Finish, wires stores |
| `src/components/SetupWizard/steps/StepLanguage.tsx` … `StepFinish.tsx` | One component per step |
| `src/components/SetupWizard/SetupWizard.scss` | Full-window and overlay styles |
| `src/components/MainLayout/MainLayout.tsx` | Mounts the wizard; drops `UserTypeSelection` |
| `src/components/Settings/sections/HelpSection.tsx` | "Run setup again" |
| `src/stores/layoutStore.ts` | `setupWizardOpen` for the Help re-run |
| `src/lib/analytics.ts` | `setup_*` events |
| `src/locales/en/translation.json` | `setup.*` |

---

### Task 1: Draft reducer

**Files:**
- Create: `src/components/SetupWizard/setupDraft.ts`
- Test: `src/components/SetupWizard/setupDraft.test.ts`

**Interfaces:**
- Consumes: `ScenarioId`, `ProviderPath` from `src/lib/setup/types`; `ProviderType` from `src/types/Provider`.
- Produces:
  ```ts
  export type SetupStep = 0 | 1 | 2 | 3 | 4 | 5;
  export const LAST_STEP: SetupStep = 5;
  export interface SetupDraft { step: SetupStep; scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: ProviderType | null; credentials: Record<string, string>; credentialsValidated: boolean; credentialsPending: boolean; sourceLanguage: string | null; targetLanguage: string | null }
  export type SetupAction =
    | { type: 'setScenario'; scenario: ScenarioId; keepProvider: boolean }
    | { type: 'setPath'; path: ProviderPath; provider: ProviderType | null }
    | { type: 'setProvider'; provider: ProviderType }
    | { type: 'setCredential'; key: string; value: string }
    | { type: 'credentialsValidated' }
    | { type: 'skipCredentials' }
    | { type: 'setLanguages'; source: string; target: string }
    | { type: 'next' } | { type: 'back' };
  export interface AdvanceEnv { isSignedIn: boolean }
  export function initialDraft(): SetupDraft;
  export function draftFromRecord(r: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }, opts: { credentialsAlreadyValid: boolean }): SetupDraft;
  export function canAdvance(d: SetupDraft, env: AdvanceEnv): boolean;
  export function setupReducer(d: SetupDraft, a: SetupAction): SetupDraft;
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/SetupWizard/setupDraft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialDraft, draftFromRecord, canAdvance, setupReducer } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

const env = { isSignedIn: false };
const run = (d: SetupDraft, ...actions: Parameters<typeof setupReducer>[1][]) =>
  actions.reduce((acc, a) => setupReducer(acc, a), d);

describe('setupReducer — stepping', () => {
  it('starts on step 0 and can always leave it', () => {
    const d = initialDraft();
    expect(d.step).toBe(0);
    expect(canAdvance(d, env)).toBe(true);
    expect(run(d, { type: 'next' }).step).toBe(1);
  });

  it('refuses to advance past a step whose requirement is unmet', () => {
    const d = run(initialDraft(), { type: 'next' });          // step 1: scenario
    expect(canAdvance(d, env)).toBe(false);
    expect(run(d, { type: 'next' }).step).toBe(1);
    const withScenario = run(d, { type: 'setScenario', scenario: 'be-heard', keepProvider: true });
    expect(canAdvance(withScenario, env)).toBe(true);
  });

  it('never goes below 0 and never above the last step', () => {
    expect(run(initialDraft(), { type: 'back' }).step).toBe(0);
    const full = run(initialDraft(),
      { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'offline', provider: Provider.LOCAL_INFERENCE }, { type: 'next' },
      { type: 'next' },                                       // step 3 offline: nothing required
      { type: 'setLanguages', source: 'ja', target: 'en' }, { type: 'next' },
    );
    expect(full.step).toBe(5);
    expect(run(full, { type: 'next' }).step).toBe(5);
  });

  it('back never clears anything', () => {
    const d = run(initialDraft(),
      { type: 'next' }, { type: 'setScenario', scenario: 'two-way-text', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'own-key', provider: null }, { type: 'setProvider', provider: Provider.OPENAI },
      { type: 'setCredential', key: 'apiKey', value: 'sk-1' },
    );
    const back = run(d, { type: 'back' }, { type: 'back' });
    expect(back).toMatchObject({ step: 0, scenario: 'two-way-text', providerPath: 'own-key', provider: Provider.OPENAI, credentials: { apiKey: 'sk-1' } });
  });
});

describe('setupReducer — clearing rules (spec §1.4)', () => {
  const base = run(initialDraft(),
    { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
    { type: 'setPath', path: 'own-key', provider: null }, { type: 'setProvider', provider: Provider.OPENAI },
    { type: 'setCredential', key: 'apiKey', value: 'sk-1' }, { type: 'credentialsValidated' },
    { type: 'setLanguages', source: 'en', target: 'ja' },
  );

  it('changing the scenario keeps a still-compatible provider and everything after it', () => {
    const d = run(base, { type: 'setScenario', scenario: 'two-way-voice', keepProvider: true });
    expect(d).toMatchObject({ providerPath: 'own-key', provider: Provider.OPENAI, credentialsValidated: true, sourceLanguage: 'en' });
  });

  it('changing the scenario to one the provider cannot serve clears the path onward', () => {
    const d = run(base, { type: 'setScenario', scenario: 'subtitle-myself', keepProvider: false });
    expect(d).toMatchObject({ scenario: 'subtitle-myself', providerPath: null, provider: null, credentials: {}, credentialsValidated: false, credentialsPending: false, sourceLanguage: null, targetLanguage: null });
  });

  it('changing the path or provider clears credentials and the language pair', () => {
    const viaPath = run(base, { type: 'setPath', path: 'offline', provider: Provider.LOCAL_INFERENCE });
    expect(viaPath).toMatchObject({ provider: Provider.LOCAL_INFERENCE, credentials: {}, credentialsValidated: false, credentialsPending: false, sourceLanguage: null });
    const viaProvider = run(base, { type: 'setProvider', provider: Provider.GEMINI });
    expect(viaProvider).toMatchObject({ provider: Provider.GEMINI, credentials: {}, credentialsValidated: false, sourceLanguage: null });
  });

  it('editing a credential invalidates a previous validation and un-skips', () => {
    const skipped = run(base, { type: 'skipCredentials' });
    expect(skipped).toMatchObject({ credentialsPending: true, credentials: {} });
    const edited = run(base, { type: 'setCredential', key: 'apiKey', value: 'sk-2' });
    expect(edited).toMatchObject({ credentialsValidated: false, credentialsPending: false, credentials: { apiKey: 'sk-2' } });
  });
});

describe('canAdvance — step 3 per path', () => {
  const at3 = (path: 'managed' | 'own-key' | 'offline', provider: Provider) => run(initialDraft(),
    { type: 'next' }, { type: 'setScenario', scenario: 'understand-others', keepProvider: true }, { type: 'next' },
    { type: 'setPath', path, provider }, { type: 'next' });

  it('managed needs sign-in, or skip', () => {
    const d = at3('managed', Provider.KIZUNA_AI_SONIOX);
    expect(d.step).toBe(3);
    expect(canAdvance(d, { isSignedIn: false })).toBe(false);
    expect(canAdvance(d, { isSignedIn: true })).toBe(true);
    expect(canAdvance(run(d, { type: 'skipCredentials' }), { isSignedIn: false })).toBe(true);
  });

  it('own-key needs a validated key, or skip', () => {
    const d = at3('own-key', Provider.OPENAI);
    expect(canAdvance(d, env)).toBe(false);
    expect(canAdvance(run(d, { type: 'credentialsValidated' }), env)).toBe(true);
    expect(canAdvance(run(d, { type: 'skipCredentials' }), env)).toBe(true);
  });

  it('offline needs nothing', () => {
    expect(canAdvance(at3('offline', Provider.LOCAL_INFERENCE), env)).toBe(true);
  });

  it('own-key cannot leave step 2 without a provider', () => {
    const d = run(initialDraft(), { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'own-key', provider: null });
    expect(canAdvance(d, env)).toBe(false);
  });
});

describe('draftFromRecord (Help re-run)', () => {
  it('prefills scenario, path and provider, and treats an already-valid key as validated', () => {
    const d = draftFromRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: 'openai' }, { credentialsAlreadyValid: true });
    expect(d).toMatchObject({ step: 0, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai', credentialsValidated: true });
  });

  it('leaves a migrated record (nulls) as a blank draft', () => {
    const d = draftFromRecord({ scenario: null, providerPath: null, provider: 'openai' }, { credentialsAlreadyValid: false });
    expect(d).toEqual(initialDraft());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/setupDraft.test.ts`
Expected: FAIL — `Cannot find module './setupDraft'`.

- [ ] **Step 3: Implement**

`src/components/SetupWizard/setupDraft.ts`:

```ts
// src/components/SetupWizard/setupDraft.ts
//
// Everything the wizard collects, and the rules for moving through it. Pure:
// no store, no DOM. The UI dispatches actions; Finish hands the draft to
// applySetup. Nothing here is persisted — backing out of the wizard discards
// the draft, which is what makes every step reversible (spec §1.1).
import type { ScenarioId, ProviderPath } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';

export type SetupStep = 0 | 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: SetupStep = 5;

export interface SetupDraft {
  step: SetupStep;
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  /** Resolved from the path (managed/offline) or picked by the user (own-key). */
  provider: ProviderType | null;
  /** own-key only: slice key → value, cleared when path or provider changes. */
  credentials: Record<string, string>;
  credentialsValidated: boolean;
  /** "Skip for now" was taken on step 3 (spec §1.4). */
  credentialsPending: boolean;
  sourceLanguage: string | null;
  targetLanguage: string | null;
}

export type SetupAction =
  | { type: 'setScenario'; scenario: ScenarioId; keepProvider: boolean }
  | { type: 'setPath'; path: ProviderPath; provider: ProviderType | null }
  | { type: 'setProvider'; provider: ProviderType }
  | { type: 'setCredential'; key: string; value: string }
  | { type: 'credentialsValidated' }
  | { type: 'skipCredentials' }
  | { type: 'setLanguages'; source: string; target: string }
  | { type: 'next' }
  | { type: 'back' };

export interface AdvanceEnv {
  isSignedIn: boolean;
}

export function initialDraft(): SetupDraft {
  return {
    step: 0,
    scenario: null,
    providerPath: null,
    provider: null,
    credentials: {},
    credentialsValidated: false,
    credentialsPending: false,
    sourceLanguage: null,
    targetLanguage: null,
  };
}

/** Pre-fill for a Help re-run (spec §1.6). A migrated record carries nulls and
 *  yields a blank draft. */
export function draftFromRecord(
  r: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string },
  opts: { credentialsAlreadyValid: boolean },
): SetupDraft {
  if (!r.scenario || !r.providerPath) return initialDraft();
  return {
    ...initialDraft(),
    scenario: r.scenario,
    providerPath: r.providerPath,
    provider: r.provider as ProviderType,
    credentialsValidated: r.providerPath === 'own-key' && opts.credentialsAlreadyValid,
  };
}

const cleared = {
  credentials: {} as Record<string, string>,
  credentialsValidated: false,
  credentialsPending: false,
  sourceLanguage: null,
  targetLanguage: null,
};

export function canAdvance(d: SetupDraft, env: AdvanceEnv): boolean {
  switch (d.step) {
    case 0: return true;
    case 1: return d.scenario !== null;
    case 2: return d.providerPath !== null && d.provider !== null;
    case 3:
      if (d.credentialsPending) return true;
      if (d.providerPath === 'managed') return env.isSignedIn;
      if (d.providerPath === 'own-key') return d.credentialsValidated;
      return true; // offline: nothing to provide
    case 4: return d.sourceLanguage !== null && d.targetLanguage !== null;
    case 5: return true;
  }
}

export function setupReducer(d: SetupDraft, a: SetupAction): SetupDraft {
  switch (a.type) {
    case 'setScenario':
      if (a.keepProvider) return { ...d, scenario: a.scenario };
      return { ...d, scenario: a.scenario, providerPath: null, provider: null, ...cleared };
    case 'setPath':
      return { ...d, providerPath: a.path, provider: a.provider, ...cleared };
    case 'setProvider':
      return { ...d, provider: a.provider, ...cleared };
    case 'setCredential':
      return {
        ...d,
        credentials: { ...d.credentials, [a.key]: a.value },
        credentialsValidated: false,
        credentialsPending: false,
      };
    case 'credentialsValidated':
      return { ...d, credentialsValidated: true, credentialsPending: false };
    case 'skipCredentials':
      return { ...d, credentials: {}, credentialsValidated: false, credentialsPending: true };
    case 'setLanguages':
      return { ...d, sourceLanguage: a.source, targetLanguage: a.target };
    case 'next':
      return d.step < LAST_STEP ? { ...d, step: (d.step + 1) as SetupStep } : d;
    case 'back':
      return d.step > 0 ? { ...d, step: (d.step - 1) as SetupStep } : d;
  }
}
```

Note `next` does **not** check `canAdvance` — the frame disables the button; the reducer stays a pure step counter so tests can build drafts quickly. The test "refuses to advance past a step whose requirement is unmet" therefore must assert on `canAdvance`, not on `next`: change that test's `expect(run(d, { type: 'next' }).step).toBe(1)` line to `expect(canAdvance(d, env)).toBe(false)` only (delete the `run(...next)` assertion) before running.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/setupDraft.test.ts`
Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/SetupWizard/"   # 0
git add src/components/SetupWizard/setupDraft.ts src/components/SetupWizard/setupDraft.test.ts
git commit -m "feat(setup): add the wizard draft reducer"
```

---

### Task 2: Provider paths and scenario filtering

**Files:**
- Create: `src/components/SetupWizard/providerPaths.ts`
- Test: `src/components/SetupWizard/providerPaths.test.ts`

**Interfaces:**
- Consumes: `ProviderConfigFactory` (`getAvailableProviders`, `getDescriptor`, `getConfig`, `getDefaultManagedProvider`, `isProviderSupported`); `getScenario`, `providerFitForScenario` (Plan 1); `isKizunaManagedProvider` from `src/types/Provider`.
- Produces:
  ```ts
  export interface ProviderOption { id: ProviderType; fit: ProviderFit }
  export function availablePaths(): ProviderPath[];
  export function managedProvider(): ProviderType | null;
  export function ownKeyOptions(scenario: ScenarioId): ProviderOption[];
  export function offlineOptions(): ProviderType[];
  export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/SetupWizard/providerPaths.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
// All gates on, Electron: the widest registry, so every path has something to offer.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { Provider } from '../../types/Provider';
import { availablePaths, managedProvider, ownKeyOptions, offlineOptions, providerFits } from './providerPaths';

describe('providerPaths', () => {
  it('offers all three paths when a managed provider is registered', () => {
    expect(availablePaths()).toEqual(['managed', 'own-key', 'offline']);
    expect(managedProvider()).toBe(Provider.KIZUNA_AI_SONIOX);
  });

  it('own-key lists every user-managed provider in registration order, never managed or local ones', () => {
    const ids = ownKeyOptions('understand-others').map((o) => o.id);
    expect(ids).toEqual([
      Provider.OPENAI, Provider.OPENAI_TRANSLATE, Provider.VOLCENGINE_AST2, Provider.GEMINI,
      Provider.SONIOX, Provider.PALABRA_AI, Provider.OPENAI_COMPATIBLE, Provider.VOLCENGINE_ST, Provider.ZOOM_AI,
    ]);
  });

  it('marks providers that cannot serve the scenario instead of hiding them', () => {
    const speak = Object.fromEntries(ownKeyOptions('be-heard').map((o) => [o.id, o.fit]));
    expect(speak[Provider.VOLCENGINE_ST]).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(speak[Provider.ZOOM_AI]).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(speak[Provider.OPENAI]).toEqual({ ok: true });

    const text = Object.fromEntries(ownKeyOptions('subtitle-myself').map((o) => [o.id, o.fit]));
    expect(text[Provider.PALABRA_AI]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.SONIOX]).toEqual({ ok: true });
  });

  it('offline offers WASM and, on Electron, Native', () => {
    expect(offlineOptions()).toEqual([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
  });

  it('providerFits answers for any provider, including managed and local ones', () => {
    expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
    expect(providerFits(Provider.KIZUNA_AI_OPENAI_TRANSLATE, 'subtitle-myself')).toBe(false);
    expect(providerFits(Provider.LOCAL_NATIVE, 'two-way-voice')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/providerPaths.test.ts`
Expected: FAIL — `Cannot find module './providerPaths'`.

- [ ] **Step 3: Implement**

`src/components/SetupWizard/providerPaths.ts`:

```ts
// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. Reads the same registry and gates the rest of the app does, so
// it can never offer a provider ProviderConfigFactory did not register.
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import { getScenario, providerFitForScenario } from '../../lib/setup/scenarios';
import type { ProviderFit } from '../../lib/setup/scenarios';

export interface ProviderOption {
  id: ProviderType;
  fit: ProviderFit;
}

const LOCAL: ProviderType[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];

export function managedProvider(): ProviderType | null {
  return ProviderConfigFactory.getDefaultManagedProvider();
}

/** The managed card is rendered only when a managed provider exists in this build. */
export function availablePaths(): ProviderPath[] {
  const paths: ProviderPath[] = [];
  if (managedProvider()) paths.push('managed');
  paths.push('own-key', 'offline');
  return paths;
}

export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean {
  const cap = ProviderConfigFactory.getConfig(provider).capabilities.textOnlyCapability;
  return providerFitForScenario(cap, getScenario(scenario)).ok;
}

/** User-managed providers in registration order, each with its fit for the
 *  scenario — unfit ones are shown greyed with the reason, never hidden. */
export function ownKeyOptions(scenario: ScenarioId): ProviderOption[] {
  const preset = getScenario(scenario);
  return ProviderConfigFactory.getAvailableProviders()
    .filter((id) => !isKizunaManagedProvider(id) && !LOCAL.includes(id))
    .map((id) => ({
      id,
      fit: providerFitForScenario(ProviderConfigFactory.getConfig(id).capabilities.textOnlyCapability, preset),
    }));
}

/** WASM everywhere; Native only where its gate (Electron) registered it. */
export function offlineOptions(): ProviderType[] {
  return LOCAL.filter((id) => ProviderConfigFactory.isProviderSupported(id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/providerPaths.test.ts`
Expected: 5 passed. If the own-key order assertion fails, the registration order in `ProviderConfigFactory.ts:23-85` has changed since the spec — fix the **test's expected list** to the current registration order (the code is right by construction), and say so in the report.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/SetupWizard/"   # 0
git add src/components/SetupWizard/providerPaths.ts src/components/SetupWizard/providerPaths.test.ts
git commit -m "feat(setup): resolve provider paths and scenario fit from the registry"
```

---

### Task 3: Default language pair

**Files:**
- Create: `src/components/SetupWizard/languageDefaults.ts`
- Test: `src/components/SetupWizard/languageDefaults.test.ts`

**Interfaces:**
- Consumes: `LanguageOption` from `src/services/providers/ProviderConfig`.
- Produces:
  ```ts
  export function matchLanguage(options: LanguageOption[], code: string): string | null;
  export function defaultLanguagePair(args: { sources: LanguageOption[]; targetsFor: (source: string) => LanguageOption[]; uiLanguage: string; providerDefault: { source: string; target: string } }): { source: string; target: string };
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/SetupWizard/languageDefaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchLanguage, defaultLanguagePair } from './languageDefaults';

const opt = (value: string) => ({ value, name: value, englishName: value });
const L = ['en', 'zh_CN', 'ja-JP', 'es'].map(opt);

describe('matchLanguage', () => {
  it('matches exact, then case/separator-insensitively, then by primary subtag', () => {
    expect(matchLanguage(L, 'en')).toBe('en');
    expect(matchLanguage(L, 'zh-cn')).toBe('zh_CN');
    expect(matchLanguage(L, 'ja')).toBe('ja-JP');
    expect(matchLanguage(L, 'zh')).toBe('zh_CN');
    expect(matchLanguage(L, 'fr')).toBeNull();
  });
});

describe('defaultLanguagePair (spec §1.2 step 4)', () => {
  const targetsFor = () => L;
  const providerDefault = { source: 'es', target: 'ja-JP' };

  it('uses the interface language as source and English as target when both are offered', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'zh_CN', providerDefault })).toEqual({ source: 'zh_CN', target: 'en' });
  });

  it('falls back to the provider default source when the UI language is not offered', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'fr', providerDefault })).toEqual({ source: 'es', target: 'en' });
  });

  it('falls the target to the provider default when source and target would coincide', () => {
    expect(defaultLanguagePair({ sources: L, targetsFor, uiLanguage: 'en', providerDefault })).toEqual({ source: 'en', target: 'ja-JP' });
  });

  it('respects a source-dependent target list', () => {
    const only = (s: string) => (s === 'en' ? [opt('ja-JP')] : L);
    expect(defaultLanguagePair({ sources: L, targetsFor: only, uiLanguage: 'en', providerDefault })).toEqual({ source: 'en', target: 'ja-JP' });
  });

  it('picks the first target the list offers when neither English nor the default is in it', () => {
    const onlyEs = () => [opt('es')];
    expect(defaultLanguagePair({ sources: L, targetsFor: onlyEs, uiLanguage: 'ja', providerDefault })).toEqual({ source: 'ja-JP', target: 'es' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/languageDefaults.test.ts`
Expected: FAIL — `Cannot find module './languageDefaults'`.

- [ ] **Step 3: Implement**

`src/components/SetupWizard/languageDefaults.ts`:

```ts
// src/components/SetupWizard/languageDefaults.ts
//
// Sensible starting values for the language-pair step. Providers spell codes
// differently ('zh_CN', 'zh-CN', 'ja', 'ja-JP'), so matching is tolerant, in
// that order of strictness: exact, normalised, primary subtag.
import type { LanguageOption } from '../../services/providers/ProviderConfig';

const norm = (code: string) => code.toLowerCase().replace(/_/g, '-');
const primary = (code: string) => norm(code).split('-')[0];

export function matchLanguage(options: LanguageOption[], code: string): string | null {
  const exact = options.find((o) => o.value === code);
  if (exact) return exact.value;
  const loose = options.find((o) => norm(o.value) === norm(code));
  if (loose) return loose.value;
  const sub = options.find((o) => primary(o.value) === primary(code));
  return sub ? sub.value : null;
}

export function defaultLanguagePair(args: {
  sources: LanguageOption[];
  targetsFor: (source: string) => LanguageOption[];
  uiLanguage: string;
  providerDefault: { source: string; target: string };
}): { source: string; target: string } {
  const source =
    matchLanguage(args.sources, args.uiLanguage) ??
    matchLanguage(args.sources, args.providerDefault.source) ??
    args.sources[0]?.value ?? args.providerDefault.source;

  const targets = args.targetsFor(source);
  const english = matchLanguage(targets, 'en');
  const fallback = matchLanguage(targets, args.providerDefault.target) ?? targets[0]?.value ?? args.providerDefault.target;
  const target = english && english !== source ? english : fallback;
  return { source, target };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/languageDefaults.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/SetupWizard/languageDefaults.ts src/components/SetupWizard/languageDefaults.test.ts
git commit -m "feat(setup): derive a default language pair from a provider's lists"
```

---

### Task 4: `applySetupDraft` — the Finish writes

**Files:**
- Create: `src/components/SetupWizard/applySetup.ts`
- Test: `src/components/SetupWizard/applySetup.test.ts`

**Interfaces:**
- Consumes: `SetupDraft` (Task 1); `getScenario` (Plan 1).
- Produces:
  ```ts
  export interface ApplySetupDeps {
    currentProvider: ProviderType;
    sliceKeyFor: (p: ProviderType) => string;
    setMode: (m: 'speaker' | 'participant' | 'both') => void;
    setTextOnly: (v: boolean) => void;
    setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
    setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
    updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
    setProvider: (p: ProviderType) => void;
    completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
    validateApiKey: () => Promise<unknown>;
  }
  export async function applySetupDraft(draft: SetupDraft, deps: ApplySetupDeps): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/SetupWizard/applySetup.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applySetupDraft } from './applySetup';
import type { ApplySetupDeps } from './applySetup';
import { initialDraft } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
  return {
    currentProvider: Provider.OPENAI,
    sliceKeyFor: (p) => (p === Provider.SONIOX ? 'soniox' : p === Provider.OPENAI ? 'openai' : 'kizunaSoniox'),
    setMode: vi.fn(),
    setTextOnly: vi.fn(),
    setSpeakerDisplayMode: vi.fn(),
    setParticipantDisplayMode: vi.fn(),
    updateProviderSlice: vi.fn(async () => {}),
    setProvider: vi.fn(),
    completeSetup: vi.fn(async () => {}),
    validateApiKey: vi.fn(async () => ({})),
    ...overrides,
  };
}

const order = (fns: Array<ReturnType<typeof vi.fn>>) =>
  fns.map((f) => f.mock.invocationCallOrder[0]);

const draft = (over: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX,
  credentials: { apiKey: 'sk-1' }, credentialsValidated: true, sourceLanguage: 'en', targetLanguage: 'ja', ...over,
});

describe('applySetupDraft (spec §1.5)', () => {
  it('writes preset, slice, provider, record — in that order — and not uiMode', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);

    expect(d.setMode).toHaveBeenCalledWith('speaker');
    expect(d.setTextOnly).toHaveBeenCalledWith(false);
    expect(d.setSpeakerDisplayMode).toHaveBeenCalledWith('both');
    expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
    expect(d.updateProviderSlice).toHaveBeenCalledWith('soniox', { sourceLanguage: 'en', targetLanguage: 'ja', apiKey: 'sk-1' });
    expect(d.setProvider).toHaveBeenCalledWith(Provider.SONIOX);
    expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });

    const seq = order([d.setMode, d.setTextOnly, d.setSpeakerDisplayMode, d.updateProviderSlice, d.setProvider, d.completeSetup] as any);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
    expect(Object.keys(d)).not.toContain('setUIMode');
  });

  it('writes the slice before the provider so the validation effect fires once with final values', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);
    expect((d.updateProviderSlice as any).mock.invocationCallOrder[0]).toBeLessThan((d.setProvider as any).mock.invocationCallOrder[0]);
  });

  it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
    const skipped = deps();
    await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
    expect(skipped.updateProviderSlice).toHaveBeenCalledWith('soniox', { sourceLanguage: 'en', targetLanguage: 'ja' });

    const managed = deps();
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managed);
    expect(managed.updateProviderSlice).toHaveBeenCalledWith('kizunaSoniox', { sourceLanguage: 'en', targetLanguage: 'ja' });
  });

  it('sets participant display for the listening scenario and leaves the speaker one alone', async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), d);
    expect(d.setMode).toHaveBeenCalledWith('participant');
    expect(d.setTextOnly).toHaveBeenCalledWith(true);
    expect(d.setParticipantDisplayMode).toHaveBeenCalledWith('translation');
    expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
  });

  it('re-validates only on own-key when the provider did not change (the Soniox-keys gap)', async () => {
    const same = deps({ currentProvider: Provider.SONIOX });
    await applySetupDraft(draft({}), same);
    expect(same.validateApiKey).toHaveBeenCalledTimes(1);
    expect((same.validateApiKey as any).mock.invocationCallOrder[0]).toBeGreaterThan((same.completeSetup as any).mock.invocationCallOrder[0]);

    const changed = deps({ currentProvider: Provider.OPENAI });
    await applySetupDraft(draft({}), changed);
    expect(changed.validateApiKey).not.toHaveBeenCalled();

    const managedSame = deps({ currentProvider: Provider.KIZUNA_AI_SONIOX });
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managedSame);
    expect(managedSame.validateApiKey).not.toHaveBeenCalled();
  });

  it('refuses an incomplete draft', async () => {
    await expect(applySetupDraft(draft({ scenario: null }), deps())).rejects.toThrow(/incomplete/);
    await expect(applySetupDraft(draft({ targetLanguage: null }), deps())).rejects.toThrow(/incomplete/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/applySetup.test.ts`
Expected: FAIL — `Cannot find module './applySetup'`.

- [ ] **Step 3: Implement**

`src/components/SetupWizard/applySetup.ts`:

```ts
// src/components/SetupWizard/applySetup.ts
//
// The one place the wizard writes anything (spec §1.5). Store actions come in
// as an argument so this stays testable without the stores' import graph, and
// so the ORDER is a fact of this file rather than of whichever component calls
// it: slice before provider (SettingsInitializer's validation effect then fires
// once, over final values), record last.
import { getScenario } from '../../lib/setup/scenarios';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';
import type { SetupDraft } from './setupDraft';

export interface ApplySetupDeps {
  /** settingsStore.provider BEFORE the writes — decides the re-validate gap. */
  currentProvider: ProviderType;
  sliceKeyFor: (p: ProviderType) => string;
  setMode: (m: 'speaker' | 'participant' | 'both') => void;
  setTextOnly: (v: boolean) => void;
  setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
  setProvider: (p: ProviderType) => void;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
  /** settingsStore.validateApiKey, bound by the caller with its auth getter. */
  validateApiKey: () => Promise<unknown>;
}

export async function applySetupDraft(draft: SetupDraft, deps: ApplySetupDeps): Promise<void> {
  const { scenario, providerPath, provider, sourceLanguage, targetLanguage } = draft;
  if (!scenario || !providerPath || !provider || !sourceLanguage || !targetLanguage) {
    throw new Error('applySetupDraft: draft is incomplete');
  }
  const preset = getScenario(scenario);

  deps.setMode(preset.mode);
  deps.setTextOnly(preset.textOnly);
  if (preset.speakerDisplayMode) await deps.setSpeakerDisplayMode(preset.speakerDisplayMode);
  if (preset.participantDisplayMode) await deps.setParticipantDisplayMode(preset.participantDisplayMode);

  const credentials = providerPath === 'own-key' && !draft.credentialsPending ? draft.credentials : {};
  await deps.updateProviderSlice(deps.sliceKeyFor(provider), { sourceLanguage, targetLanguage, ...credentials });

  deps.setProvider(provider);
  await deps.completeSetup({ scenario, providerPath, provider });

  // SettingsInitializer re-validates on a provider change, and on credential
  // changes for every API provider EXCEPT Soniox's regional keys. Only the
  // "same provider, new key" re-run can slip through; cover exactly that.
  if (providerPath === 'own-key' && provider === deps.currentProvider) {
    await deps.validateApiKey();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/applySetup.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/SetupWizard/"   # 0
git add src/components/SetupWizard/applySetup.ts src/components/SetupWizard/applySetup.test.ts
git commit -m "feat(setup): apply a finished wizard draft to the stores in spec order"
```

---

### Task 5: Analytics events and `layoutStore.setupWizardOpen`

**Files:**
- Modify: `src/lib/analytics.ts` (inside `AnalyticsEvents`, after the `user_type_applied` entry ~line 139)
- Modify: `src/stores/layoutStore.ts`
- Test: `src/stores/layoutStore.test.ts` (append)

**Interfaces:**
- Produces (analytics):
  ```ts
  'setup_started': { variant: 'first-run' | 'rerun' };
  'setup_step_viewed': { step: number; step_id: string };
  'setup_abandoned': { step: number };
  'setup_completed': { scenario: string; provider_path: string; provider: string; source_language: string; target_language: string; credentials_pending: boolean };
  ```
- Produces (layoutStore): `setupWizardOpen: boolean; setSetupWizardOpen: (v: boolean) => void; useSetupWizardOpen; useSetSetupWizardOpen`.

- [ ] **Step 1: Failing test for the store field**

Append to `src/stores/layoutStore.test.ts`:

```ts
describe('layoutStore.setupWizardOpen', () => {
  it('is an ephemeral flag — not persisted', () => {
    useLayoutStore.getState().setSetupWizardOpen(true);
    expect(useLayoutStore.getState().setupWizardOpen).toBe(true);
    expect(sessionStorage.length).toBe(0);
    useLayoutStore.getState().setSetupWizardOpen(false);
    expect(useLayoutStore.getState().setupWizardOpen).toBe(false);
  });
});
```

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/layoutStore.test.ts` — Expected: FAIL (`setSetupWizardOpen is not a function`).

- [ ] **Step 2: Implement both**

`src/stores/layoutStore.ts` — add to the interface and the store:

```ts
  /** Ephemeral: Help's "Run setup again" raises it; MainLayout mounts the
   *  wizard as an overlay while it is true. Never persisted. */
  setupWizardOpen: boolean;
  setSetupWizardOpen: (value: boolean) => void;
```
```ts
  setupWizardOpen: false,
  setSetupWizardOpen: (value) => set({ setupWizardOpen: value }),
```
```ts
export const useSetupWizardOpen = () => useLayoutStore((s) => s.setupWizardOpen);
export const useSetSetupWizardOpen = () => useLayoutStore((s) => s.setSetupWizardOpen);
```

`src/lib/analytics.ts` — inside `AnalyticsEvents`, after `'user_type_applied': {…};`:

```ts
  // Setup wizard (spec §1.7)
  'setup_started': { variant: 'first-run' | 'rerun' };
  'setup_step_viewed': { step: number; step_id: string };
  'setup_abandoned': { step: number };
  'setup_completed': {
    scenario: string;
    provider_path: string;
    provider: string;
    source_language: string;
    target_language: string;
    credentials_pending: boolean;
  };
```

- [ ] **Step 3: Run, type-check, commit**

Run: `npx vitest run -c vitest.worktree.config.ts src/stores/layoutStore.test.ts` — Expected: 3 passed.

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/(stores/layoutStore|lib/analytics)"   # 1 at baseline (analytics.ts has 1 pre-existing); must not grow
git add src/lib/analytics.ts src/stores/layoutStore.ts src/stores/layoutStore.test.ts
git commit -m "feat(setup): declare setup analytics events and the wizard re-run flag"
```

---

### Task 6: The wizard UI

**Files:**
- Create: `src/components/SetupWizard/SetupWizard.tsx`, `SetupWizard.scss`
- Create: `src/components/SetupWizard/steps/StepLanguage.tsx`, `StepScenario.tsx`, `StepProviderPath.tsx`, `StepCredentials.tsx`, `StepLanguagePair.tsx`, `StepFinish.tsx`
- Create: `src/components/SetupWizard/useApplySetup.ts`
- Test: `src/components/SetupWizard/SetupWizard.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `INTERFACE_LANGUAGES` (`src/components/Settings/sections/interfaceLanguages.ts`); `changeLanguageWithLoad` (`src/locales`); `useAuth` (`src/lib/auth/hooks`: `{ isSignedIn, getToken }`); `useSetAuthOverlay`, `useUILanguage`, `useSetUILanguage`, `useProvider`, `useIsApiKeyValid`, `useSettingsStore` (settingsStore); `useSetMode` (audioStore); `useCompleteSetup`, `useSetupRecord` (setupStore); `useAnalytics`; `PROVIDER_ICONS`-style icons from `src/components/Icons/ProviderIcons`; `Button`, `FormInput`, `StatusMessage` from `src/components/Settings/shared/`.
- Produces: `<SetupWizard variant="first-run" />` and `<SetupWizard variant="rerun" onClose={…} />`.

- [ ] **Step 1: Write the failing render tests**

`src/components/SetupWizard/SetupWizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string | object) => (typeof d === 'string' ? d : k), i18n: { language: 'en' } }),
}));
vi.mock('../../locales', () => ({ changeLanguageWithLoad: vi.fn(async (l: string) => l) }));
let signedIn = false;
const setAuthOverlay = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: signedIn, getToken: async () => null }) }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const applied: unknown[] = [];
vi.mock('./useApplySetup', () => ({ useApplySetup: () => async (draft: unknown) => { applied.push(draft); } }));
vi.mock('../../stores/settingsStore', () => ({
  useUILanguage: () => 'en',
  useSetUILanguage: () => vi.fn(async () => {}),
  useSetAuthOverlay: () => setAuthOverlay,
  useProvider: () => 'openai',
  useIsApiKeyValid: () => null,
  useSettingsStore: Object.assign((sel: (s: any) => unknown) => sel({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }), {
    getState: () => ({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }),
  }),
}));
vi.mock('../../stores/setupStore', () => ({ useSetupRecord: () => null }));

import SetupWizard from './SetupWizard';

beforeEach(() => { cleanup(); applied.length = 0; signedIn = false; setAuthOverlay.mockClear(); });

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

describe('SetupWizard', () => {
  it('starts on the interface-language step with Next enabled and no Back', () => {
    render(<SetupWizard variant="first-run" />);
    expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('will not leave the scenario step until a card is chosen, and Back returns without losing it', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    back(); next();
    expect(screen.getByRole('radio', { name: /Be understood in a meeting/ })).toBeChecked();
  });

  it('greys out a provider that cannot serve the scenario and says why', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    const zoom = screen.getByRole('radio', { name: /Zoom AI Services/ });
    expect(zoom).toBeDisabled();
    expect(zoom.closest('label')?.textContent).toMatch(/cannot produce spoken translation/);
  });

  it('lets an own-key user skip the credentials for now and finish', async () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Subtitle my own speech/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI$/ }));
    next();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    next();                                           // language pair, defaults filled
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    next();                                           // finish
    expect(screen.getByText(/No API key yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ scenario: 'subtitle-myself', providerPath: 'own-key', provider: 'openai', credentialsPending: true });
  });

  it('opens the sign-in overlay from the managed path and passes once signed in', () => {
    const { rerender } = render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Start right away/ }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(setAuthOverlay).toHaveBeenCalledWith('sign-in');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    signedIn = true;
    rerender(<SetupWizard variant="first-run" />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('shows the hardware notice on the offline path and needs nothing else', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();
    expect(screen.getByText(/GPU/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('rerun variant shows a close control', () => {
    const onClose = vi.fn();
    render(<SetupWizard variant="rerun" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

The accessible names in these tests are the **English default strings** the components pass as `t(key, default)` — the mocked `t` returns the default. Card titles: "Understand what others say", "Be understood in a meeting", "Subtitle my own speech", "Two-way online conversation", "Two-way online conversation, subtitles only"; path cards: "Start right away", "I have my own API key", "Free, offline"; the unfit reason contains "cannot produce spoken translation"; buttons "Back", "Next", "Finish", "Skip for now", "Sign in", "Close"; the language select is labelled "Interface language"; pending line contains "No API key yet".

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard/SetupWizard.test.tsx`
Expected: FAIL — `Cannot find module './SetupWizard'`.

- [ ] **Step 3: The store-binding hook**

`src/components/SetupWizard/useApplySetup.ts`:

```ts
// Binds applySetupDraft to the live stores. Mocked out in SetupWizard's render
// tests so the component can be exercised without the stores' import graph.
import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only — there is no named useAudioStore
import { useSetupStore } from '../../stores/setupStore';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../lib/auth/hooks';
import { applySetupDraft } from './applySetup';
import type { SetupDraft } from './setupDraft';

export function useApplySetup(): (draft: SetupDraft) => Promise<void> {
  const { getToken, isSignedIn } = useAuth();
  return useCallback(async (draft: SetupDraft) => {
    const s = useSettingsStore.getState();
    await applySetupDraft(draft, {
      currentProvider: s.provider,
      sliceKeyFor: (p) => ProviderConfigFactory.getDescriptor(p).settingsSliceKey,
      setMode: useAudioStore.getState().setMode,
      setTextOnly: s.setTextOnly,
      setSpeakerDisplayMode: s.setSpeakerDisplayMode,
      setParticipantDisplayMode: s.setParticipantDisplayMode,
      updateProviderSlice: s.updateProviderSlice,
      setProvider: s.setProvider,
      completeSetup: useSetupStore.getState().completeSetup,
      validateApiKey: () => useSettingsStore.getState().validateApiKey(getToken, isSignedIn),
    });
  }, [getToken, isSignedIn]);
}
```

- [ ] **Step 4: The frame**

`src/components/SetupWizard/SetupWizard.tsx`:

```tsx
// src/components/SetupWizard/SetupWizard.tsx
//
// First-run setup (spec §1). Six steps over one draft; nothing is written until
// Finish. `variant="first-run"` fills the window in place of MainLayout;
// `variant="rerun"` is an overlay Help opens over the running app.
import React, { useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAuth } from '../../lib/auth/hooks';
import { useAnalytics } from '../../lib/analytics';
import { useIsApiKeyValid, useProvider } from '../../stores/settingsStore';
import { useSetupRecord } from '../../stores/setupStore';
import { initialDraft, draftFromRecord, setupReducer, canAdvance, LAST_STEP } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { useApplySetup } from './useApplySetup';
import StepLanguage from './steps/StepLanguage';
import StepScenario from './steps/StepScenario';
import StepProviderPath from './steps/StepProviderPath';
import StepCredentials from './steps/StepCredentials';
import StepLanguagePair from './steps/StepLanguagePair';
import StepFinish from './steps/StepFinish';
import Button from '../Settings/shared/Button';
import './SetupWizard.scss';

const STEP_IDS = ['language', 'scenario', 'path', 'credentials', 'language-pair', 'finish'] as const;

interface SetupWizardProps {
  variant: 'first-run' | 'rerun';
  onClose?: () => void;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ variant, onClose }) => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { trackEvent } = useAnalytics();
  const record = useSetupRecord();
  const currentProvider = useProvider();
  const apiKeyValid = useIsApiKeyValid();
  const apply = useApplySetup();

  const [draft, dispatch] = useReducer(setupReducer, undefined, (): SetupDraft =>
    variant === 'rerun' && record
      ? draftFromRecord({ ...record, provider: record.provider || currentProvider }, { credentialsAlreadyValid: apiKeyValid === true })
      : initialDraft());
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  useEffect(() => { trackEvent('setup_started', { variant }); }, [trackEvent, variant]);
  useEffect(() => { trackEvent('setup_step_viewed', { step: draft.step, step_id: STEP_IDS[draft.step] }); }, [draft.step, trackEvent]);

  const advance = canAdvance(draft, { isSignedIn });

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      trackEvent('setup_completed', {
        scenario: draft.scenario ?? '', provider_path: draft.providerPath ?? '', provider: draft.provider ?? '',
        source_language: draft.sourceLanguage ?? '', target_language: draft.targetLanguage ?? '',
        credentials_pending: draft.credentialsPending,
      });
      await apply(draft);
      onClose?.();
    } catch (err) {
      console.error('[SetupWizard] Finish failed:', err);
      setFinishError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishing(false);
    }
  };

  const close = () => {
    trackEvent('setup_abandoned', { step: draft.step });
    onClose?.();
  };

  return (
    <div className={`setup-wizard setup-wizard--${variant}`} role="dialog" aria-labelledby="setup-wizard-title">
      <div className="setup-wizard__card">
        <header className="setup-wizard__header">
          <h1 id="setup-wizard-title">{t('setup.title', 'Set up Sokuji')}</h1>
          <span className="setup-wizard__progress" aria-live="polite">
            {t('setup.stepOf', 'Step {{current}} of {{total}}', { current: draft.step + 1, total: LAST_STEP + 1 })}
          </span>
          {onClose && (
            <button type="button" className="setup-wizard__close" onClick={close} aria-label={t('setup.close', 'Close')}>
              <X size={16} />
            </button>
          )}
        </header>

        <main className="setup-wizard__body">
          {draft.step === 0 && <StepLanguage />}
          {draft.step === 1 && <StepScenario draft={draft} dispatch={dispatch} />}
          {draft.step === 2 && <StepProviderPath draft={draft} dispatch={dispatch} />}
          {draft.step === 3 && <StepCredentials draft={draft} dispatch={dispatch} />}
          {draft.step === 4 && <StepLanguagePair draft={draft} dispatch={dispatch} />}
          {draft.step === 5 && <StepFinish draft={draft} isSignedIn={isSignedIn} error={finishError} />}
        </main>

        <footer className="setup-wizard__footer">
          {draft.step > 0 && (
            <Button variant="secondary" onClick={() => dispatch({ type: 'back' })} disabled={finishing}>
              {t('setup.back', 'Back')}
            </Button>
          )}
          <span className="setup-wizard__spacer" />
          {draft.step < LAST_STEP ? (
            <Button variant="primary" onClick={() => dispatch({ type: 'next' })} disabled={!advance}>
              {t('setup.next', 'Next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={finish} loading={finishing} disabled={finishing}>
              {t('setup.finish', 'Finish')}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default SetupWizard;
```

- [ ] **Step 5: The steps**

Every step component receives `draft` and `dispatch` (except `StepLanguage`, which is self-contained, and `StepFinish`, which is read-only). Shared card markup is a `<label>` wrapping a visually-hidden `<input type="radio">` so tests can address cards by role and name.

`src/components/SetupWizard/steps/StepLanguage.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { INTERFACE_LANGUAGES } from '../../Settings/sections/interfaceLanguages';
import { changeLanguageWithLoad } from '../../../locales';
import { useSetUILanguage, useUILanguage } from '../../../stores/settingsStore';

// The one setting applied DURING the wizard (spec §1.2 step 0): the rest of it
// has to be read in the chosen language.
const StepLanguage: React.FC = () => {
  const { t } = useTranslation();
  const uiLanguage = useUILanguage();
  const setUILanguage = useSetUILanguage();

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    try {
      await changeLanguageWithLoad(next);
      await setUILanguage(next);
    } catch (err) {
      console.error('[SetupWizard] Could not change the interface language:', err);
    }
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.language.title', 'Which language should Sokuji speak to you in?')}</h2>
      <p>{t('setup.steps.language.desc', 'This is the language of menus and buttons. You choose the languages to translate between later.')}</p>
      <label className="setup-field">
        <span>{t('setup.steps.language.label', 'Interface language')}</span>
        <select value={uiLanguage} onChange={onChange} aria-label={t('setup.steps.language.label', 'Interface language')}>
          {INTERFACE_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>
    </section>
  );
};

export default StepLanguage;
```

`src/components/SetupWizard/steps/StepScenario.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SCENARIOS } from '../../../lib/setup/scenarios';
import { providerFits } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

// Titles double as the accessible names the tests use; keep the English
// defaults in sync with SetupWizard.test.tsx.
const TITLES: Record<string, string> = {
  'understand-others': 'Understand what others say',
  'be-heard': 'Be understood in a meeting',
  'subtitle-myself': 'Subtitle my own speech',
  'two-way-voice': 'Two-way online conversation',
  'two-way-text': 'Two-way online conversation, subtitles only',
};
const DESCS: Record<string, string> = {
  'understand-others': 'Online meetings, classes, talks, videos, streams — read a live translation of what you hear.',
  'be-heard': 'They hear your translated voice through a virtual microphone.',
  'subtitle-myself': 'Talks, streams, presentations — your audience reads translated subtitles; no audio is generated.',
  'two-way-voice': 'They hear your translated voice; you read their subtitles.',
  'two-way-text': 'Bilingual captions, meeting minutes — both sides as text, no synthetic voice.',
};

const StepScenario: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const modeLabel = (m: string) => t(`setup.modes.${m}`, m === 'speaker' ? 'Me' : m === 'participant' ? 'Others' : 'Both');
  const outputLabel = (textOnly: boolean) => (textOnly ? t('setup.output.subtitles', 'subtitles') : t('setup.output.voice', 'spoken'));

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.scenario.title', 'What do you want to do?')}</h2>
      <p>{t('setup.steps.scenario.desc', 'Pick the closest match. You can change any of this later.')}</p>
      <div className="setup-cards" role="radiogroup" aria-label={t('setup.steps.scenario.title', 'What do you want to do?')}>
        {SCENARIOS.map((s) => (
          <label key={s.id} className={`setup-card${draft.scenario === s.id ? ' is-selected' : ''}`}>
            <input
              type="radio" name="scenario" value={s.id} checked={draft.scenario === s.id}
              onChange={() => dispatch({
                type: 'setScenario', scenario: s.id,
                keepProvider: draft.provider ? providerFits(draft.provider, s.id) : true,
              })}
            />
            <span className="setup-card__title">{t(`setup.scenarios.${s.id}.title`, TITLES[s.id])}</span>
            <span className="setup-card__desc">{t(`setup.scenarios.${s.id}.desc`, DESCS[s.id])}</span>
            <span className="setup-card__sets">
              {t('setup.scenarios.sets', 'Sets: mode {{mode}} · {{output}}', { mode: modeLabel(s.mode), output: outputLabel(s.textOnly) })}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
};

export default StepScenario;
```

`src/components/SetupWizard/steps/StepProviderPath.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { Provider } from '../../../types/Provider';
import type { ProviderType } from '../../../types/Provider';
import type { ProviderPath } from '../../../lib/setup/types';
import { availablePaths, managedProvider, ownKeyOptions, offlineOptions } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const PATH_COPY: Record<ProviderPath, { title: string; desc: string; cost: string }> = {
  managed: {
    title: 'Start right away',
    desc: 'Sokuji runs the translation for you.',
    cost: 'Needs a Kizuna AI account (email) with a balance. New accounts get a trial credit.',
  },
  'own-key': {
    title: 'I have my own API key',
    desc: 'Use OpenAI, Gemini, Soniox and others directly.',
    cost: 'You pay the provider for usage.',
  },
  offline: {
    title: 'Free, offline',
    desc: 'Runs on your own machine. Nothing leaves it.',
    cost: 'Downloads models onto your disk (gigabytes). Runs well with a GPU and enough VRAM; CPU-only is noticeably slower.',
  },
};

const StepProviderPath: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const scenario = draft.scenario!;
  const nameOf = (id: ProviderType) => {
    const key = ProviderConfigFactory.getDescriptor(id).i18nKey ?? id;
    return t(`providers.${key}.name`, ProviderConfigFactory.getConfig(id).displayName);
  };
  const reasonOf = (reason: 'cannot-speak' | 'cannot-be-text-only') => reason === 'cannot-speak'
    ? t('setup.fit.cannotSpeak', 'This provider cannot produce spoken translation.')
    : t('setup.fit.cannotBeTextOnly', 'This provider always speaks; it cannot run subtitles-only.');

  const choosePath = (path: ProviderPath) => {
    if (path === 'managed') dispatch({ type: 'setPath', path, provider: managedProvider() });
    else if (path === 'offline') dispatch({ type: 'setPath', path, provider: Provider.LOCAL_INFERENCE });
    else dispatch({ type: 'setPath', path, provider: null });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.path.title', 'What do you have?')}</h2>
      <div className="setup-cards" role="radiogroup" aria-label={t('setup.steps.path.title', 'What do you have?')}>
        {availablePaths().map((path) => (
          <label key={path} className={`setup-card${draft.providerPath === path ? ' is-selected' : ''}`}>
            <input type="radio" name="path" value={path} checked={draft.providerPath === path} onChange={() => choosePath(path)} />
            <span className="setup-card__title">
              {t(`setup.paths.${path}.title`, PATH_COPY[path].title)}
              {path === 'managed' && <em className="setup-card__badge">{t('setup.paths.recommended', 'Recommended')}</em>}
            </span>
            <span className="setup-card__desc">{t(`setup.paths.${path}.desc`, PATH_COPY[path].desc)}</span>
            <span className="setup-card__cost">{t(`setup.paths.${path}.cost`, PATH_COPY[path].cost)}</span>
          </label>
        ))}
      </div>

      {draft.providerPath === 'own-key' && (
        <div className="setup-cards setup-cards--compact" role="radiogroup" aria-label={t('setup.paths.pickProvider', 'Which provider?')}>
          {ownKeyOptions(scenario).map(({ id, fit }) => (
            <label key={id} className={`setup-card${draft.provider === id ? ' is-selected' : ''}${fit.ok ? '' : ' is-disabled'}`}>
              <input type="radio" name="provider" value={id} checked={draft.provider === id} disabled={!fit.ok}
                onChange={() => dispatch({ type: 'setProvider', provider: id })} />
              <span className="setup-card__title">{nameOf(id)}</span>
              {!fit.ok && <span className="setup-card__reason">{reasonOf(fit.reason)}</span>}
            </label>
          ))}
        </div>
      )}

      {draft.providerPath === 'offline' && offlineOptions().length > 1 && (
        <div className="setup-cards setup-cards--compact" role="radiogroup" aria-label={t('setup.paths.offlineFlavor', 'Which engine?')}>
          {offlineOptions().map((id) => (
            <label key={id} className={`setup-card${draft.provider === id ? ' is-selected' : ''}`}>
              <input type="radio" name="provider" value={id} checked={draft.provider === id}
                onChange={() => dispatch({ type: 'setProvider', provider: id })} />
              <span className="setup-card__title">{nameOf(id)}</span>
              <span className="setup-card__desc">
                {id === Provider.LOCAL_NATIVE
                  ? t('setup.paths.offline.native', 'Native engine — faster, uses your GPU where available.')
                  : t('setup.paths.offline.wasm', 'In-app engine — works everywhere, slower.')}
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
};

export default StepProviderPath;
```

`src/components/SetupWizard/steps/StepCredentials.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../../lib/auth/hooks';
import { useSetAuthOverlay, useSettingsStore } from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import Button from '../../Settings/shared/Button';
import FormInput from '../../Settings/shared/FormInput';
import StatusMessage from '../../Settings/shared/StatusMessage';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepCredentials: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const { isSignedIn, getToken } = useAuth();
  const setAuthOverlay = useSetAuthOverlay();
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const skip = (
    <Button variant="ghost" onClick={() => dispatch({ type: 'skipCredentials' })}>
      {t('setup.skipForNow', 'Skip for now')}
    </Button>
  );

  if (draft.providerPath === 'offline') {
    return (
      <section className="setup-step">
        <h2>{t('setup.steps.credentials.offlineTitle', 'Nothing to enter')}</h2>
        <StatusMessage variant="info">
          {t('setup.credentials.offlineNotice', 'Models are downloaded after setup, from Settings. They take gigabytes of disk. Sokuji runs well with a GPU and enough VRAM; on CPU alone it is noticeably slower.')}
        </StatusMessage>
      </section>
    );
  }

  if (draft.providerPath === 'managed') {
    return (
      <section className="setup-step">
        <h2>{t('setup.steps.credentials.managedTitle', 'Your Kizuna AI account')}</h2>
        {isSignedIn ? (
          <StatusMessage variant="success">{t('setup.credentials.signedIn', 'Signed in. You can continue.')}</StatusMessage>
        ) : (
          <>
            <p>{t('setup.credentials.managedDesc', 'Sign in or create an account. Translation is billed from your balance; new accounts get a trial credit.')}</p>
            <div className="setup-actions">
              <Button variant="primary" onClick={() => setAuthOverlay('sign-in')}>{t('setup.credentials.signIn', 'Sign in')}</Button>
              <Button variant="secondary" onClick={() => setAuthOverlay('sign-up')}>{t('setup.credentials.createAccount', 'Create account')}</Button>
              {skip}
            </div>
            {draft.credentialsPending && <StatusMessage variant="warning">{t('setup.credentials.pendingSignIn', 'You can sign in later from the account button. Start stays locked until then.')}</StatusMessage>}
          </>
        )}
      </section>
    );
  }

  // own-key
  const provider = draft.provider!;
  const descriptor = ProviderConfigFactory.getDescriptor(provider);
  const fields = descriptor.credentialFields;

  const validate = async () => {
    setValidating(true);
    setMessage(null);
    try {
      // The live slice stands in for the provider's defaults (untouched on a
      // fresh install); the draft overlays it. Nothing is written.
      const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore] as Record<string, unknown>;
      const creds = await descriptor.extractCredentials({ ...slice, ...draft.credentials }, { getAuthToken: getToken });
      if (!creds.ok) { setMessage({ ok: false, text: creds.missing }); return; }
      const { validation } = await descriptor.validateAndFetchModels(creds);
      if (validation.valid) {
        dispatch({ type: 'credentialsValidated' });
        setMessage({ ok: true, text: t('setup.credentials.valid', 'Key accepted.') });
      } else {
        setMessage({ ok: false, text: validation.message || t('setup.credentials.invalid', 'The key was rejected.') });
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setValidating(false);
    }
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2>
      {fields.map((f) => (
        <label key={f.key} className="setup-field">
          <span>{t(f.labelKey, f.key)}</span>
          <FormInput
            type={f.secret ? 'password' : 'text'}
            value={draft.credentials[f.key] ?? ''}
            placeholder={f.placeholderKey ? t(f.placeholderKey, '') : ''}
            onChange={(e) => dispatch({ type: 'setCredential', key: f.key, value: e.target.value })}
            status={draft.credentialsValidated ? 'valid' : message && !message.ok ? 'invalid' : null}
          />
        </label>
      ))}
      <div className="setup-actions">
        <Button variant="primary" onClick={validate} loading={validating} disabled={validating || fields.some((f) => !draft.credentials[f.key])}>
          {t('setup.credentials.validate', 'Validate')}
        </Button>
        {skip}
      </div>
      {message && <StatusMessage variant={message.ok ? 'success' : 'error'}>{message.text}</StatusMessage>}
      {draft.credentialsPending && <StatusMessage variant="warning">{t('setup.credentials.pendingKey', 'You can add the key later in Settings → Provider. Start stays locked until it validates.')}</StatusMessage>}
    </section>
  );
};

export default StepCredentials;
```

`src/components/SetupWizard/steps/StepLanguagePair.tsx`:

```tsx
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useSettingsStore, useUILanguage } from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { defaultLanguagePair } from '../languageDefaults';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepLanguagePair: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const uiLanguage = useUILanguage();
  const descriptor = ProviderConfigFactory.getDescriptor(draft.provider!);
  const sources = useMemo(() => descriptor.resolveSourceLanguages(), [descriptor]);
  const targetsFor = (s: string) => descriptor.resolveTargetLanguages(s);

  // Seed once from the provider's lists (spec §1.2 step 4); Back/Next keeps the
  // user's picks because the draft already holds them.
  useEffect(() => {
    if (draft.sourceLanguage && draft.targetLanguage) return;
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore] as { sourceLanguage?: string; targetLanguage?: string };
    const pair = defaultLanguagePair({
      sources, targetsFor, uiLanguage,
      providerDefault: { source: slice?.sourceLanguage ?? sources[0]?.value ?? 'en', target: slice?.targetLanguage ?? 'en' },
    });
    dispatch({ type: 'setLanguages', source: pair.source, target: pair.target });
  }, [descriptor, sources, uiLanguage, draft.sourceLanguage, draft.targetLanguage, dispatch]);

  const source = draft.sourceLanguage ?? '';
  const targets = source ? targetsFor(source) : [];

  const setSource = (s: string) => {
    const nextTargets = targetsFor(s);
    const keep = nextTargets.some((o) => o.value === draft.targetLanguage) ? draft.targetLanguage! : (nextTargets[0]?.value ?? '');
    dispatch({ type: 'setLanguages', source: s, target: keep });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.languagePair.title', 'Which languages?')}</h2>
      <p>{t('setup.steps.languagePair.desc', 'What you (or they) speak, and what it should become.')}</p>
      <label className="setup-field">
        <span>{t('setup.languagePair.source', 'From')}</span>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t('setup.languagePair.source', 'From')}>
          {sources.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        </select>
      </label>
      <label className="setup-field">
        <span>{t('setup.languagePair.target', 'To')}</span>
        <select value={draft.targetLanguage ?? ''} onChange={(e) => dispatch({ type: 'setLanguages', source, target: e.target.value })} aria-label={t('setup.languagePair.target', 'To')}>
          {targets.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        </select>
      </label>
    </section>
  );
};

export default StepLanguagePair;
```

`src/components/SetupWizard/steps/StepFinish.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { getScenario } from '../../../lib/setup/scenarios';
import StatusMessage from '../../Settings/shared/StatusMessage';
import type { SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; isSignedIn: boolean; error: string | null }

const StepFinish: React.FC<Props> = ({ draft, isSignedIn, error }) => {
  const { t } = useTranslation();
  const preset = getScenario(draft.scenario!);
  const descriptor = ProviderConfigFactory.getDescriptor(draft.provider!);
  const providerName = t(`providers.${descriptor.i18nKey ?? draft.provider}.name`, ProviderConfigFactory.getConfig(draft.provider!).displayName);
  const nameOf = (list: { value: string; name: string }[], v: string | null) => list.find((o) => o.value === v)?.name ?? v ?? '';
  const modeLabel = t(`setup.modes.${preset.mode}`, preset.mode === 'speaker' ? 'Me' : preset.mode === 'participant' ? 'Others' : 'Both');
  const output = preset.textOnly ? t('setup.output.subtitles', 'subtitles') : t('setup.output.voice', 'spoken');

  const pending = draft.credentialsPending || (draft.providerPath === 'managed' && !isSignedIn);

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.finish.title', 'Ready')}</h2>
      <dl className="setup-summary">
        <dt>{t('setup.summary.scenario', 'Scenario')}</dt><dd>{t(`setup.scenarios.${preset.id}.title`, preset.id)}</dd>
        <dt>{t('setup.summary.mode', 'Mode')}</dt><dd>{modeLabel} · {output}</dd>
        <dt>{t('setup.summary.provider', 'Provider')}</dt><dd>{providerName}</dd>
        <dt>{t('setup.summary.languages', 'Languages')}</dt>
        <dd>{nameOf(descriptor.resolveSourceLanguages(), draft.sourceLanguage)} → {nameOf(descriptor.resolveTargetLanguages(draft.sourceLanguage ?? ''), draft.targetLanguage)}</dd>
      </dl>
      {pending && (
        <StatusMessage variant="warning">
          {draft.providerPath === 'managed'
            ? t('setup.summary.pendingSignIn', 'Not signed in — sign in from the account button before you start.')
            : t('setup.summary.pendingKey', 'No API key yet — add it in Settings → Provider before you start.')}
        </StatusMessage>
      )}
      {error && <StatusMessage variant="error">{error}</StatusMessage>}
    </section>
  );
};

export default StepFinish;
```

- [ ] **Step 6: Styles**

`src/components/SetupWizard/SetupWizard.scss`:

```scss
@use '../Settings/shared/variables' as vars;

.setup-wizard {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: vars.$bg-page;
  z-index: 1500; // above panels, below .auth-overlay-scrim (2000) so sign-in paints over it

  &--rerun { background: rgba(0, 0, 0, 0.66); }

  &__card {
    width: min(720px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: vars.$bg-surface;
    border: 1px solid vars.$border-subtle;
    border-radius: vars.$radius-lg;
    overflow: hidden;
  }

  &__header {
    display: flex;
    align-items: center;
    gap: vars.$space-3;
    padding: vars.$space-4 vars.$space-5;
    border-bottom: 1px solid vars.$border-subtle;
    h1 { margin: 0; font-size: 16px; font-weight: vars.$weight-semibold; color: vars.$text-primary; }
  }
  &__progress { margin-left: auto; font-size: vars.$font-caption; color: vars.$text-muted; }
  &__close {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    border: 1px solid vars.$border-default; border-radius: vars.$radius-md; background: transparent; color: vars.$text-secondary; cursor: pointer;
    &:hover { border-color: vars.$color-primary; color: vars.$text-primary; }
    &:focus-visible { @include vars.focus-ring; }
  }
  &__body { padding: vars.$space-5; overflow-y: auto; }
  &__footer {
    display: flex; align-items: center; gap: vars.$space-2;
    padding: vars.$space-3 vars.$space-5; border-top: 1px solid vars.$border-subtle;
  }
  &__spacer { flex: 1; }
}

.setup-step {
  h2 { margin: 0 0 vars.$space-2; font-size: vars.$font-title; color: vars.$text-primary; }
  > p { margin: 0 0 vars.$space-4; font-size: vars.$font-body; color: vars.$text-secondary; }
}

.setup-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: vars.$space-3;
  margin-bottom: vars.$space-4;
  &--compact { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}

.setup-card {
  @include vars.option-row;
  display: flex; flex-direction: column; gap: vars.$space-1;
  padding: vars.$space-3; cursor: pointer;
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  &:hover { @include vars.option-row-hover; }
  &.is-selected { @include vars.option-row-selected; }
  &.is-disabled { @include vars.disabled-state; }
  &:has(input:focus-visible) { @include vars.focus-ring; }
  &__title { font-weight: vars.$weight-medium; color: vars.$text-primary; display: flex; align-items: center; gap: vars.$space-2; }
  &__badge { font-style: normal; font-size: 10px; padding: 1px 6px; border-radius: 10px; background: rgba(vars.$color-primary, 0.15); color: vars.$color-primary; }
  &__desc { font-size: vars.$font-caption; color: vars.$text-secondary; }
  &__sets, &__cost, &__reason { font-size: vars.$font-caption; color: vars.$text-muted; }
  &__reason { color: vars.$color-warning; }
}

.setup-field {
  display: flex; flex-direction: column; gap: vars.$space-1; margin-bottom: vars.$space-3;
  > span { font-size: vars.$font-caption; color: vars.$text-secondary; }
  select { @include vars.control-base; padding: 6px 8px; }
}

.setup-actions { display: flex; gap: vars.$space-2; margin: vars.$space-3 0; flex-wrap: wrap; }

.setup-summary {
  display: grid; grid-template-columns: max-content 1fr; gap: vars.$space-1 vars.$space-4; margin: 0 0 vars.$space-4;
  dt { color: vars.$text-muted; font-size: vars.$font-caption; }
  dd { margin: 0; color: vars.$text-primary; font-size: vars.$font-body; }
}
```

`_variables.scss` is imported elsewhere as `@use '../shared/variables' as vars` — check one existing section stylesheet (`src/components/Settings/sections/*.scss`) for the exact relative form and match it; from `SetupWizard/` the path is `../Settings/shared/variables`.

- [ ] **Step 7: Run the render tests**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/SetupWizard`
Expected: all pass (7 render tests + the pure suites). Common failures and their fixes: an accessible-name mismatch means a component's English default drifted from the test's regex — change the component, not the test; `useSettingsStore` selector usage in a step that the mock does not cover means the mock in the test file needs that selector added.

- [ ] **Step 8: Type-check A/B and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/SetupWizard/"   # 0
git add src/components/SetupWizard/
git commit -m "feat(setup): add the six-step setup wizard"
```

---

### Task 7: Mount the wizard; retire `UserTypeSelection`; Help re-run

**Files:**
- Modify: `src/components/MainLayout/MainLayout.tsx` (imports 6–7, 17; hooks 31; `handleUserTypeSelection` 157–169; early return 208–211; JSX end)
- Modify: `src/components/MainLayout/MainLayout.keepAlive.test.tsx:19`, `:44-46`
- Modify: `src/components/Settings/sections/HelpSection.tsx` (add a link after the restart-tour link at `:57-61`)
- Delete: `src/components/UserTypeSelection/UserTypeSelection.tsx`, `UserTypeSelection.scss`
- Test: `src/components/MainLayout/MainLayout.setup.test.tsx` (new)

**Interfaces:**
- Consumes: `useSetupLoaded`, `useSetupComplete` (setupStore); `useSetupWizardOpen`, `useSetSetupWizardOpen` (layoutStore); `SetupWizard`.

- [ ] **Step 1: Write the failing MainLayout test**

`src/components/MainLayout/MainLayout.setup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MainLayout from './MainLayout';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Onboarding/Onboarding', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleApp', () => ({ default: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../Settings', () => ({ Settings: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`wizard-${variant}`} /> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('../../contexts/OnboardingContext', () => ({ useOnboarding: () => ({}) }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai', useUIMode: () => 'basic', useSetProvider: () => vi.fn(),
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false,
}));
let loaded = true; let complete = true; let wizardOpen = false;
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => loaded, useSetupComplete: () => complete }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => wizardOpen, useSetSetupWizardOpen: () => vi.fn(),
}));

beforeEach(() => { cleanup(); loaded = true; complete = true; wizardOpen = false; });

describe('MainLayout first-run gating (spec §1.1)', () => {
  it('renders nothing until setup state has loaded — no wizard flash for migrated users', () => {
    loaded = false; complete = false;
    render(<MainLayout />);
    expect(screen.queryByTestId('wizard-first-run')).toBeNull();
    expect(screen.queryByTestId('title-bar')).toBeNull();
  });

  it('shows the first-run wizard instead of the layout on a fresh install', () => {
    complete = false;
    render(<MainLayout />);
    expect(screen.getByTestId('wizard-first-run')).toBeInTheDocument();
    expect(screen.queryByTestId('title-bar')).toBeNull();
  });

  it('shows the layout once setup is complete', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-first-run')).toBeNull();
  });

  it('overlays the rerun wizard over the layout when Help asked for it', () => {
    wizardOpen = true;
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-rerun')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.worktree.config.ts src/components/MainLayout/MainLayout.setup.test.tsx` — Expected: FAIL (`Cannot find module '../SetupWizard/SetupWizard'` is not it — the module exists; the failures are `wizard-first-run` not found / `useSetupLoaded` not used).

- [ ] **Step 2: Rewire `MainLayout`**

In `src/components/MainLayout/MainLayout.tsx`:

Replace the import at line 7 (`import UserTypeSelection …`) with:
```tsx
import SetupWizard from '../SetupWizard/SetupWizard';
```
Replace line 17 (`import { useOnboarding } …`) — delete it; add:
```tsx
import { useSetupLoaded, useSetupComplete } from '../../stores/setupStore';
import { useSetupWizardOpen, useSetSetupWizardOpen } from '../../stores/layoutStore';
```
(The `layoutStore` import line from Plan 1 already exists — extend it: `import { useShowSettings, useSetShowSettings, useSetupWizardOpen, useSetSetupWizardOpen } from '../../stores/layoutStore';`.)

Replace line 31 (`const { userTypeSelected, setUserType } = useOnboarding();`) with:
```tsx
  const setupLoaded = useSetupLoaded();
  const setupComplete = useSetupComplete();
  const setupWizardOpen = useSetupWizardOpen();
  const setSetupWizardOpen = useSetSetupWizardOpen();
```
Delete `setUIMode` from the store import at line 15 and its `const setUIMode = useSetUIMode();` if `handleUserTypeSelection` was its only consumer (it was — verify with a grep for `setUIMode` in the file before deleting; `noUnusedLocals` will fail the type-check otherwise).

Delete `handleUserTypeSelection` (lines 157–169).

Replace the early return (lines 208–211) with:
```tsx
  // Nothing until setup state is known: a migrated user must never see the
  // wizard flash. Then the wizard in place of the layout on a fresh install.
  if (!setupLoaded) return null;
  if (!setupComplete) return <SetupWizard variant="first-run" />;
```

Before the final `{electronSubtitleTakeover && <SubtitleApp />}` line add:
```tsx
    {setupWizardOpen && <SetupWizard variant="rerun" onClose={() => setSetupWizardOpen(false)} />}
```

- [ ] **Step 3: Update the keepAlive mocks**

In `src/components/MainLayout/MainLayout.keepAlive.test.tsx` replace line 19 (`vi.mock('../UserTypeSelection/UserTypeSelection', …)`) with:
```tsx
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
```
Replace lines 44–46 (the `OnboardingContext` mock) with:
```tsx
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));
vi.mock('../../stores/layoutStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/layoutStore')>()),
  useSetupWizardOpen: () => false,
  useSetSetupWizardOpen: () => vi.fn(),
}));
```
(The real `useShowSettings`/`useSetShowSettings` stay real — that is what the keep-alive test exercises.)

- [ ] **Step 4: Delete `UserTypeSelection`**

```bash
git rm -r src/components/UserTypeSelection
grep -rn "UserTypeSelection" src --include='*.ts' --include='*.tsx' --include='*.scss'   # must print nothing
```
(In zsh, quote the `--include` globs exactly as shown.)

- [ ] **Step 5: Help re-run link**

In `src/components/Settings/sections/HelpSection.tsx`, add to the imports:
```tsx
import { Wand2 } from 'lucide-react';   // extend the existing lucide-react import line
import { useSetSetupWizardOpen } from '../../../stores/layoutStore';
```
add `const setSetupWizardOpen = useSetSetupWizardOpen();` beside the other hooks, and after the restart-tour `<a>` (ends at `:61`) add:
```tsx
        <a
          className={`help-link${isSessionActive ? ' is-disabled' : ''}`}
          aria-disabled={isSessionActive}
          title={isSessionActive ? t('settings.sessionActiveNotice') : undefined}
          onClick={() => { if (isSessionActive) return; setSetupWizardOpen(true); if (toggleSettings) toggleSettings(); }}
        >
          <Wand2 size={13} />
          <span>{t('setup.rerun', 'Run setup again')}</span>
        </a>
```
`HelpSection.scss` (or wherever `.help-link` is styled — `grep -rn "help-link" src/components/Settings --include='*.scss'`) gets `.help-link.is-disabled { opacity: 0.5; cursor: not-allowed; }` if no disabled rule exists.

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/MainLayout src/components/Settings/ src/components/SetupWizard`
Expected: all pass. `SimpleSettings.*.test.tsx` stub `HelpSection`, so the new link needs no changes there.

- [ ] **Step 7: Type-check A/B and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/(MainLayout|Settings/sections/HelpSection|SetupWizard)"   # 1 at baseline (MainLayout.tsx unused import); must not grow
git add -A src/components/MainLayout src/components/Settings/sections/HelpSection.tsx src/components/UserTypeSelection
git commit -m "feat(setup): show the wizard on first run and from Help; retire UserTypeSelection"
```

---

### Task 8: English strings

**Files:**
- Modify: `src/locales/en/translation.json` — add a top-level `"setup"` object (insert it after `"userTypeSelection"`, i.e. before `"onboarding"` at line 682; `userTypeSelection` itself is deleted in Plan 4 together with the sweep)

- [ ] **Step 1: Add the keys**

Every `t(key, default)` in Task 6/7 must have its key here with the **same** English text as the default (the tests read defaults; users read this file). Insert:

```json
  "setup": {
    "title": "Set up Sokuji",
    "stepOf": "Step {{current}} of {{total}}",
    "back": "Back",
    "next": "Next",
    "finish": "Finish",
    "close": "Close",
    "skipForNow": "Skip for now",
    "rerun": "Run setup again",
    "steps": {
      "language": {
        "title": "Which language should Sokuji speak to you in?",
        "desc": "This is the language of menus and buttons. You choose the languages to translate between later.",
        "label": "Interface language"
      },
      "scenario": { "title": "What do you want to do?", "desc": "Pick the closest match. You can change any of this later." },
      "path": { "title": "What do you have?" },
      "credentials": {
        "offlineTitle": "Nothing to enter",
        "managedTitle": "Your Kizuna AI account",
        "ownKeyTitle": "Your API key"
      },
      "languagePair": { "title": "Which languages?", "desc": "What you (or they) speak, and what it should become." },
      "finish": { "title": "Ready" }
    },
    "scenarios": {
      "sets": "Sets: mode {{mode}} · {{output}}",
      "understand-others": { "title": "Understand what others say", "desc": "Online meetings, classes, talks, videos, streams — read a live translation of what you hear." },
      "be-heard": { "title": "Be understood in a meeting", "desc": "They hear your translated voice through a virtual microphone." },
      "subtitle-myself": { "title": "Subtitle my own speech", "desc": "Talks, streams, presentations — your audience reads translated subtitles; no audio is generated." },
      "two-way-voice": { "title": "Two-way online conversation", "desc": "They hear your translated voice; you read their subtitles." },
      "two-way-text": { "title": "Two-way online conversation, subtitles only", "desc": "Bilingual captions, meeting minutes — both sides as text, no synthetic voice." }
    },
    "modes": { "speaker": "Me", "participant": "Others", "both": "Both" },
    "output": { "voice": "spoken", "subtitles": "subtitles" },
    "paths": {
      "recommended": "Recommended",
      "pickProvider": "Which provider?",
      "offlineFlavor": "Which engine?",
      "managed": { "title": "Start right away", "desc": "Sokuji runs the translation for you.", "cost": "Needs a Kizuna AI account (email) with a balance. New accounts get a trial credit." },
      "own-key": { "title": "I have my own API key", "desc": "Use OpenAI, Gemini, Soniox and others directly.", "cost": "You pay the provider for usage." },
      "offline": {
        "title": "Free, offline",
        "desc": "Runs on your own machine. Nothing leaves it.",
        "cost": "Downloads models onto your disk (gigabytes). Runs well with a GPU and enough VRAM; CPU-only is noticeably slower.",
        "native": "Native engine — faster, uses your GPU where available.",
        "wasm": "In-app engine — works everywhere, slower."
      }
    },
    "fit": {
      "cannotSpeak": "This provider cannot produce spoken translation.",
      "cannotBeTextOnly": "This provider always speaks; it cannot run subtitles-only."
    },
    "credentials": {
      "apiKey": "API key",
      "endpoint": "Endpoint URL",
      "endpointPlaceholder": "https://api.example.com/v1",
      "accessKeyId": "Access Key ID",
      "secretAccessKey": "Secret Access Key",
      "appId": "App ID",
      "accessToken": "Access Token",
      "apiSecret": "API Secret",
      "validate": "Validate",
      "valid": "Key accepted.",
      "invalid": "The key was rejected.",
      "signIn": "Sign in",
      "createAccount": "Create account",
      "signedIn": "Signed in. You can continue.",
      "managedDesc": "Sign in or create an account. Translation is billed from your balance; new accounts get a trial credit.",
      "offlineNotice": "Models are downloaded after setup, from Settings. They take gigabytes of disk. Sokuji runs well with a GPU and enough VRAM; on CPU alone it is noticeably slower.",
      "pendingKey": "You can add the key later in Settings → Provider. Start stays locked until it validates.",
      "pendingSignIn": "You can sign in later from the account button. Start stays locked until then."
    },
    "languagePair": { "source": "From", "target": "To" },
    "summary": {
      "scenario": "Scenario",
      "mode": "Mode",
      "provider": "Provider",
      "languages": "Languages",
      "pendingKey": "No API key yet — add it in Settings → Provider before you start.",
      "pendingSignIn": "Not signed in — sign in from the account button before you start."
    }
  },
```

- [ ] **Step 2: Verify JSON and the expected locale failure**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json','utf8')); console.log('ok')"` — Expected: `ok`.
Run: `npx vitest run -c vitest.worktree.config.ts src/locales` — Expected: **FAIL** for the 29 non-`en` catalogues, each missing exactly the `setup.*` keys. That is the documented state until Plan 4.

- [ ] **Step 3: Commit and list the keys**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(setup): add English strings for the setup wizard"
```
In the report, paste the flattened key list: `node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?f(v,p+k+'.'):[p+k]); console.log(f(require('./src/locales/en/translation.json').setup,'setup.').join('\n'))"`.

---

### Task 9: Plan-level verification

- [ ] **Step 1: Touched-directory run**

```bash
npx vitest run -c vitest.worktree.config.ts src/stores src/services/providers src/contexts src/components/MainLayout src/components/Settings/ src/components/TitleBar src/components/MainPanel src/components/Auth src/utils src/routes src/components/Subtitle src/lib/setup src/components/SetupWizard 2>&1 | grep -E "Test Files|Tests  |Errors|FAIL"
```
Expected: no `FAIL`; `Errors  4 errors` (the floor). `src/locales` is deliberately excluded from this line — run it separately and confirm its only failures are the 29 missing-`setup.*` cases.

- [ ] **Step 2: Repo-wide type-check A/B** — `npx tsc --noEmit 2>&1 | grep -cE "error TS"` must not exceed the count at the end of Plan 1.

- [ ] **Step 3: Render it** — per the house rule, before reporting, start the app (`npm run dev`, open the Electron renderer or `http://localhost:5173`) with `localStorage` and settings cleared so the wizard shows, and walk all three paths once. Screenshot each step at the narrowest width the side panel allows (extension `fullpage.html` ≈ 360px). Fix layout breakage in `SetupWizard.scss` before committing; copy changes go through Task 8's JSON **and** the components' defaults together.

- [ ] **Step 4: Report** — numbers, `git log --oneline` for this plan, the full `setup.*` key list, and screenshots' paths.
