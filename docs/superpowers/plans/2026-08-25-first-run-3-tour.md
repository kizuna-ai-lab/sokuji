# First-Run Setup — Plan 3: Tour

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two `react-joyride` catalogues and their choreography with one predicate-gated step catalogue rendered by a small spotlight engine on `@floating-ui/react`, started once after the wizard finishes and again from Help, and delete `OnboardingContext`, `Onboarding/`, and `react-joyride`.

**Architecture:** Pure catalogue (`steps.ts`) + pure DOM helpers (`dom.ts`) + one context provider (`TourProvider`) that runs the state machine (prepare → wait for anchor → highlight; skip on timeout; persist on finish/skip) + one overlay component (`TourOverlay`) that draws the scrim, the cutout and the popover. Anchors are `data-tour` attributes on eight existing elements. Steps open the settings panel through `layoutStore` and `navigateToSettings`, never by synthetic clicks.

**Tech Stack:** React 19, TypeScript (strict), Zustand, `@floating-ui/react` ^0.27, react-i18next, SASS, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md` §2 (all), §3.2 (deletions), §1.7/§2.3 (analytics).

**Depends on:** Plans 1 and 2. Confirm `git log --oneline 7a259f20..HEAD` shows both plans' commits.

## Global Constraints

- **Working directory**: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/first-run-setup-and-tour`. Never `cd` elsewhere.
- **Test command**: `npx vitest run -c vitest.worktree.config.ts <paths>`. Never commit the override config.
- **Baseline noise**: all-pass with 4 unhandled rejections (`settingsStore.nativeGate.test.ts`), exit code 1; `src/locales` is red on the 29 non-`en` catalogues since Plan 2 Task 8 and stays red until Plan 4. Nothing else may be red.
- **Type-check A/B before every commit**; new files contribute 0; repo-wide count must not exceed the end-of-Plan-2 figure. Deleting `OnboardingContext.tsx` and `Onboarding.tsx` will *reduce* the count if they carried errors — that is fine; growth is not.
- **Never `git stash`. Do not `git push`. Do not open a PR.**
- **`node_modules` is a symlink into the main checkout.** Never run a bare `npm install`/`npm uninstall` here — it would mutate the shared tree. Lockfile-only: `npm uninstall react-joyride --package-lock-only --ignore-scripts`.
- **Language**: English code/comments/commits; conventional commits.
- **TDD, strictly.**
- **Locale policy**: `en` only; list every added key path in the report. Deleting the `onboarding.*` and `userTypeSelection.*` keys from `en` is Plan 4's job (with the sweep), **not** this plan's — they stay in `en` until then even though nothing reads them.
- **One deviation from the spec, recorded here**: §2.3 has `MainLayout` auto-start the tour after Finish with `apiKeyValid` seeded from the wizard's outcome. `MainLayout` cannot know `credentialsPending` (§1.4 says it is not persisted), so the **first-run wizard starts the tour itself** right after `applySetupDraft` resolves — `TourProvider` lives in `Home`, above `MainLayout`, so it survives the wizard unmounting. "Exactly once" and "seeded from the wizard" both hold; only the caller moved.

---

## File map

| File | Responsibility |
|---|---|
| `src/components/Tour/tourContext.ts` (new) | `TourCtx` and `buildTourCtx` |
| `src/components/Tour/steps.ts` (new) | `TourStep`, `BASICS_STEPS`, `visibleSteps`, `contentKey` |
| `src/components/Tour/dom.ts` (new) | `isVisible`, `resolveAnchor`, `waitForAnchor` |
| `src/components/Tour/TourProvider.tsx` (new) | State machine, persistence, analytics, `useTour` |
| `src/components/Tour/TourOverlay.tsx` + `Tour.scss` (new) | Scrim, spotlight, popover |
| `src/components/Tour/useStartBasicsTour.ts` (new) | Builds a ctx from live stores and starts (Help) |
| `src/components/Tour/anchors.test.ts` (new) | Every catalogue anchor exists as `data-tour` in `src/` |
| 8 existing components | `data-tour` attributes |
| `src/routes/Home.tsx`, `MainLayout.tsx`, `HelpSection.tsx`, `SetupWizard.tsx` | Wiring |
| `src/lib/analytics.ts` | Reshaped `onboarding_*` events |
| Deleted | `src/contexts/OnboardingContext.tsx` + test, `src/components/Onboarding/`, `react-joyride` |

---

### Task 1: `TourCtx` and the catalogue

**Files:**
- Create: `src/components/Tour/tourContext.ts`, `src/components/Tour/steps.ts`
- Test: `src/components/Tour/steps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TourCtx { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: ProviderType; platform: 'electron' | 'extension'; os: 'linux' | 'mac' | 'windows' | 'other'; mode: 'speaker' | 'participant' | 'both'; textOnly: boolean; isSignedIn: boolean; apiKeyValid: boolean | null }
  export function buildTourCtx(i: { record: { scenario: ScenarioId | null; providerPath: ProviderPath | null } | null; provider: ProviderType; mode: TourCtx['mode']; textOnly: boolean; isSignedIn: boolean; apiKeyValid: boolean | null; env: { isElectron: boolean; isLinux: boolean; isMacOS: boolean; isWindows: boolean } }): TourCtx;
  export interface TourActions { openSettings: (target: string | null) => void; closeSettings: () => void }
  export interface TourStep { id: string; anchor?: string; when?: (ctx: TourCtx) => boolean; prepare?: (ctx: TourCtx, actions: TourActions) => void; placement?: Placement; copyVariant?: (ctx: TourCtx) => string | null }
  export const BASICS_STEPS: readonly TourStep[];
  export function visibleSteps(ctx: TourCtx, catalogue?: readonly TourStep[]): TourStep[];
  export function contentKey(step: TourStep, ctx: TourCtx): string;   // 'tour.steps.<id>.content' or '…content_<variant>'
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/Tour/steps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BASICS_STEPS, visibleSteps, contentKey } from './steps';
import { buildTourCtx } from './tourContext';
import type { TourCtx } from './tourContext';
import { getScenario, SCENARIOS } from '../../lib/setup/scenarios';
import { Provider } from '../../types/Provider';

const electron = { isElectron: true, isLinux: true, isMacOS: false, isWindows: false };
const extension = { isElectron: false, isLinux: false, isMacOS: false, isWindows: true };

function ctxFor(scenarioId: TourCtx['scenario'], providerPath: TourCtx['providerPath'], env = electron, extra: Partial<TourCtx> = {}): TourCtx {
  const preset = scenarioId ? getScenario(scenarioId) : { mode: 'speaker' as const, textOnly: false };
  return {
    ...buildTourCtx({
      record: { scenario: scenarioId, providerPath },
      provider: providerPath === 'managed' ? Provider.KIZUNA_AI_SONIOX : providerPath === 'offline' ? Provider.LOCAL_INFERENCE : Provider.OPENAI,
      mode: preset.mode, textOnly: preset.textOnly, isSignedIn: true, apiKeyValid: true, env,
    }),
    ...extra,
  };
}
const ids = (ctx: TourCtx) => visibleSteps(ctx).map((s) => s.id);

describe('visibleSteps — the spec §2.2 table', () => {
  it('managed path, per scenario', () => {
    expect(ids(ctxFor('understand-others', 'managed'))).toEqual(['welcome', 'mode-picker', 'participant-source', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('be-heard', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'monitor', 'output-routing', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('subtitle-myself', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('two-way-voice', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'output-routing', 'participant-source', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('two-way-text', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'participant-source', 'subtitle', 'account', 'start', 'done']);
  });

  it('own-key swaps account for provider-settings; offline swaps it for models', () => {
    expect(ids(ctxFor('understand-others', 'own-key'))).toContain('provider-settings');
    expect(ids(ctxFor('understand-others', 'own-key'))).not.toContain('account');
    expect(ids(ctxFor('understand-others', 'offline'))).toContain('models');
    expect(ids(ctxFor('understand-others', 'offline'))).not.toContain('account');
  });

  it('a migrated user (no scenario) gets device steps from the current mode', () => {
    expect(ids(ctxFor(null, null, electron, { mode: 'speaker', textOnly: false }))).toEqual(['welcome', 'mode-picker', 'microphone', 'monitor', 'output-routing', 'subtitle', 'start', 'done']);
    expect(ids(ctxFor(null, null, electron, { mode: 'participant', textOnly: true }))).toEqual(['welcome', 'mode-picker', 'participant-source', 'subtitle', 'start', 'done']);
    expect(ids(ctxFor(null, null, electron, { mode: 'both', textOnly: true }))).toEqual(['welcome', 'mode-picker', 'microphone', 'participant-source', 'subtitle', 'start', 'done']);
  });

  it('covers every scenario × path × platform without throwing and always ends with start, done', () => {
    for (const s of SCENARIOS) for (const p of ['managed', 'own-key', 'offline'] as const) for (const env of [electron, extension]) {
      const list = ids(ctxFor(s.id, p, env));
      expect(list.slice(0, 2)).toEqual(['welcome', 'mode-picker']);
      expect(list.slice(-2)).toEqual(['start', 'done']);
    }
  });
});

describe('contentKey — copy variants', () => {
  const step = (id: string) => BASICS_STEPS.find((s) => s.id === id)!;

  it('output-routing varies by platform and OS', () => {
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', extension))).toBe('tour.steps.output-routing.content_extension');
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', electron))).toBe('tour.steps.output-routing.content_electronLinux');
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', { isElectron: true, isLinux: false, isMacOS: true, isWindows: false }))).toBe('tour.steps.output-routing.content_electronOther');
  });

  it('participant-source varies by platform', () => {
    expect(contentKey(step('participant-source'), ctxFor('understand-others', 'managed', extension))).toBe('tour.steps.participant-source.content_extension');
    expect(contentKey(step('participant-source'), ctxFor('understand-others', 'managed', electron))).toBe('tour.steps.participant-source.content_electron');
  });

  it('account, provider-settings and start vary by readiness', () => {
    expect(contentKey(step('account'), ctxFor('be-heard', 'managed', electron, { isSignedIn: false }))).toBe('tour.steps.account.content_signedOut');
    expect(contentKey(step('account'), ctxFor('be-heard', 'managed'))).toBe('tour.steps.account.content');
    expect(contentKey(step('provider-settings'), ctxFor('be-heard', 'own-key', electron, { apiKeyValid: null }))).toBe('tour.steps.provider-settings.content_pending');
    expect(contentKey(step('provider-settings'), ctxFor('be-heard', 'own-key'))).toBe('tour.steps.provider-settings.content');
    expect(contentKey(step('start'), ctxFor('be-heard', 'offline'))).toBe('tour.steps.start.content_offline');
    expect(contentKey(step('start'), ctxFor('be-heard', 'managed', electron, { isSignedIn: false }))).toBe('tour.steps.start.content_signedOut');
    expect(contentKey(step('start'), ctxFor('be-heard', 'own-key', electron, { apiKeyValid: false }))).toBe('tour.steps.start.content_pendingKey');
    expect(contentKey(step('start'), ctxFor('be-heard', 'own-key'))).toBe('tour.steps.start.content');
  });

  it('a step without variants keys plainly', () => {
    expect(contentKey(step('welcome'), ctxFor('be-heard', 'managed'))).toBe('tour.steps.welcome.content');
  });
});

describe('buildTourCtx', () => {
  it('maps environment flags to platform and os', () => {
    const c = buildTourCtx({ record: null, provider: Provider.OPENAI, mode: 'speaker', textOnly: false, isSignedIn: false, apiKeyValid: null, env: extension });
    expect(c).toMatchObject({ scenario: null, providerPath: null, platform: 'extension', os: 'windows' });
    expect(buildTourCtx({ ...c, record: null, env: { isElectron: true, isLinux: false, isMacOS: false, isWindows: false } }).os).toBe('other');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour/steps.test.ts`
Expected: FAIL — `Cannot find module './steps'`.

- [ ] **Step 3: Implement `tourContext.ts`**

```ts
// src/components/Tour/tourContext.ts
//
// What the catalogue's predicates and copy variants read (spec §2.2). Built
// once at tour start from the setup record and the live stores; predicates
// read `mode`/`textOnly`, never the scenario id, so a migrated user with
// `scenario: null` still gets the right device steps.
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';

export interface TourCtx {
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  provider: ProviderType;
  platform: 'electron' | 'extension';
  os: 'linux' | 'mac' | 'windows' | 'other';
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  isSignedIn: boolean;
  /** settingsStore.isApiKeyValid — or, right after the wizard, its outcome. */
  apiKeyValid: boolean | null;
}

export function buildTourCtx(i: {
  record: { scenario: ScenarioId | null; providerPath: ProviderPath | null } | null;
  provider: ProviderType;
  mode: TourCtx['mode'];
  textOnly: boolean;
  isSignedIn: boolean;
  apiKeyValid: boolean | null;
  env: { isElectron: boolean; isLinux: boolean; isMacOS: boolean; isWindows: boolean };
}): TourCtx {
  const os: TourCtx['os'] = i.env.isLinux ? 'linux' : i.env.isMacOS ? 'mac' : i.env.isWindows ? 'windows' : 'other';
  return {
    scenario: i.record?.scenario ?? null,
    providerPath: i.record?.providerPath ?? null,
    provider: i.provider,
    platform: i.env.isElectron ? 'electron' : 'extension',
    os,
    mode: i.mode,
    textOnly: i.textOnly,
    isSignedIn: i.isSignedIn,
    apiKeyValid: i.apiKeyValid,
  };
}
```

- [ ] **Step 4: Implement `steps.ts`**

```ts
// src/components/Tour/steps.ts
//
// Chapter 1 of the tour (spec §2.2): one catalogue, each step gated by a
// predicate over TourCtx. No store imports — `prepare` receives the actions
// it may take, so this file stays pure and its predicate table is testable
// as data.
import type { Placement } from '@floating-ui/react';
import type { TourCtx } from './tourContext';

export interface TourActions {
  /** Open the settings panel and scroll/highlight `target` (a navigateToSettings key). */
  openSettings: (target: string | null) => void;
  closeSettings: () => void;
}

export interface TourStep {
  /** Also the i18n key root: tour.steps.<id>.{title,content[,content_<variant>]} */
  id: string;
  /** data-tour value; absent = centred card over a full scrim. */
  anchor?: string;
  when?: (ctx: TourCtx) => boolean;
  prepare?: (ctx: TourCtx, actions: TourActions) => void;
  placement?: Placement;
  copyVariant?: (ctx: TourCtx) => string | null;
}

const speaks = (c: TourCtx) => c.mode !== 'participant' && !c.textOnly;
const hasMic = (c: TourCtx) => c.mode !== 'participant';
const hasParticipant = (c: TourCtx) => c.mode !== 'speaker';

export const BASICS_STEPS: readonly TourStep[] = [
  { id: 'welcome' },
  { id: 'mode-picker', anchor: 'mode-picker', placement: 'top' },
  { id: 'microphone', anchor: 'microphone-section', when: hasMic, prepare: (_c, a) => a.openSettings('microphone'), placement: 'left' },
  { id: 'monitor', anchor: 'speaker-section', when: (c) => c.mode === 'speaker' && !c.textOnly, prepare: (_c, a) => a.openSettings('speaker'), placement: 'left' },
  {
    id: 'output-routing', when: speaks,
    copyVariant: (c) => (c.platform === 'extension' ? 'extension' : c.os === 'linux' ? 'electronLinux' : 'electronOther'),
  },
  {
    id: 'participant-source', anchor: 'participant-section', when: hasParticipant,
    prepare: (_c, a) => a.openSettings('participant'), placement: 'left',
    copyVariant: (c) => c.platform,
  },
  { id: 'subtitle', anchor: 'subtitle-enter', prepare: (_c, a) => a.closeSettings(), placement: 'bottom' },
  {
    id: 'account', anchor: 'account-button', when: (c) => c.providerPath === 'managed', placement: 'bottom',
    copyVariant: (c) => (c.isSignedIn ? null : 'signedOut'),
  },
  {
    id: 'provider-settings', anchor: 'provider-section', when: (c) => c.providerPath === 'own-key',
    prepare: (_c, a) => a.openSettings('provider'), placement: 'left',
    copyVariant: (c) => (c.apiKeyValid === true ? null : 'pending'),
  },
  { id: 'models', anchor: 'engine-chips', when: (c) => c.providerPath === 'offline', prepare: (_c, a) => a.openSettings('provider'), placement: 'left' },
  {
    id: 'start', anchor: 'main-action', prepare: (_c, a) => a.closeSettings(), placement: 'top',
    copyVariant: (c) =>
      c.providerPath === 'offline' ? 'offline'
      : c.providerPath === 'managed' && !c.isSignedIn ? 'signedOut'
      : c.providerPath === 'own-key' && c.apiKeyValid !== true ? 'pendingKey'
      : null,
  },
  { id: 'done' },
];

export function visibleSteps(ctx: TourCtx, catalogue: readonly TourStep[] = BASICS_STEPS): TourStep[] {
  return catalogue.filter((s) => !s.when || s.when(ctx));
}

export function titleKey(step: TourStep): string {
  return `tour.steps.${step.id}.title`;
}

export function contentKey(step: TourStep, ctx: TourCtx): string {
  const variant = step.copyVariant?.(ctx) ?? null;
  return `tour.steps.${step.id}.content${variant ? `_${variant}` : ''}`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour/steps.test.ts`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/Tour/"   # 0
git add src/components/Tour/tourContext.ts src/components/Tour/steps.ts src/components/Tour/steps.test.ts
git commit -m "feat(tour): add the chapter-1 step catalogue with predicates and copy variants"
```

---

### Task 2: Anchors and the anchor-consistency test

**Files:**
- Modify: `src/components/MainPanel/ModePicker.tsx:66`; `src/components/Settings/sections/AudioDeviceSection.tsx:167`, `:245`; `src/components/Settings/sections/SystemAudioSection.tsx:84-88`; `src/components/Settings/sections/ProviderSection.tsx:603` and the chip-row container; `src/components/Subtitle/SubtitleEnterButton.tsx:68`; `src/components/TitleBar/AccountButton.tsx:166`; `src/components/MainPanel/MainPanel.tsx:4288`, `:4405`; `src/components/TitleBar/TitleBar.tsx:64-70`
- Test: `src/components/Tour/anchors.test.ts`

- [ ] **Step 1: Write the failing consistency test**

`src/components/Tour/anchors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASICS_STEPS } from './steps';

// Every anchor the catalogue names must exist as data-tour="…" in a component.
// A file scan rather than a render: the anchors live in eight components with
// eight different mock surfaces, and the property we want is "the string is in
// the source", which is what a scan measures exactly.
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

const declared = new Set<string>();
for (const file of walk(join(process.cwd(), 'src/components'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/data-tour="([a-z-]+)"/g)) declared.add(m[1]);
}

describe('tour anchors', () => {
  it.each(BASICS_STEPS.filter((s) => s.anchor).map((s) => [s.id, s.anchor!]))('%s → data-tour="%s" exists in src/components', (_id, anchor) => {
    expect(declared.has(anchor)).toBe(true);
  });

  it('main-action is declared in both footers (basic and advanced)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/MainPanel/MainPanel.tsx'), 'utf8');
    expect(src.match(/data-tour="main-action"/g)?.length).toBe(2);
  });
});
```

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour/anchors.test.ts` — Expected: FAIL for every anchor (none declared yet).

- [ ] **Step 2: Add the attributes**

| File:line | Change |
|---|---|
| `ModePicker.tsx:66` | `<div className={…} role="group" data-tour="mode-picker" aria-label={…}>` |
| `AudioDeviceSection.tsx:167` | `<div className={`config-section microphone-section ${className}`} id="microphone-section" data-tour="microphone-section">` |
| `AudioDeviceSection.tsx:245` | same with `speaker-section` |
| `SystemAudioSection.tsx:84-88` | add `data-tour="participant-section"` beside `id="participant-section"` |
| `ProviderSection.tsx:603` | add `data-tour="provider-section"` beside `id="provider-section"` |
| `ProviderSection.tsx` chip container | the fragment at `:380-392` is rendered inside a container — `grep -n "renderChips\|model-chips\|chip-row" src/components/Settings/sections/ProviderSection.tsx` to find the `<div className="…">` that wraps the chip fragment's call site and add `data-tour="engine-chips"` to it. If the chips are rendered in more than one place (speaker/participant groups), put the anchor on the **outermost** wrapper that contains all of them. |
| `SubtitleEnterButton.tsx:68` | `<button type="button" data-tour="subtitle-enter" className={…}` |
| `AccountButton.tsx:166` | `<button … data-tour="account-button"` |
| `MainPanel.tsx:4288` | `<button data-tour="main-action" className={`main-action-btn …`}` |
| `MainPanel.tsx:4405` | `<button data-tour="main-action" className={`session-button …`}` |
| `TitleBar.tsx:64-70` | add `data-tour="settings-button"`; **delete the three comment lines** ("Keep the legacy `settings-button` class …"); keep the `settings-button` class only if `grep -rn "settings-button" src --include='*.scss'` finds a rule — otherwise drop it from the className too |

- [ ] **Step 3: Run the consistency test and the touched suites**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour/anchors.test.ts src/components/MainPanel src/components/Settings/ src/components/TitleBar src/components/Subtitle`
Expected: all pass.

- [ ] **Step 4: Type-check A/B and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/(MainPanel|Settings|TitleBar|Subtitle)/"   # equals pre-edit count
git add -A src/components/MainPanel src/components/Settings/sections src/components/TitleBar src/components/Subtitle src/components/Tour/anchors.test.ts
git commit -m "feat(tour): anchor tour targets with data-tour attributes"
```

---

### Task 3: DOM helpers — visibility and waiting

**Files:**
- Create: `src/components/Tour/dom.ts`
- Test: `src/components/Tour/dom.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isVisible(el: Element): boolean;
  export function resolveAnchor(id: string, root?: ParentNode): HTMLElement | null;
  export interface WaitOptions { timeoutMs?: number; schedule?: (cb: () => void) => void; now?: () => number; root?: ParentNode }
  export function waitForAnchor(id: string, opts?: WaitOptions): Promise<HTMLElement | null>;
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/Tour/dom.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isVisible, resolveAnchor, waitForAnchor } from './dom';

// jsdom has no layout: getClientRects() is always empty. Stand in for layout
// with an attribute: data-hidden ⇒ no rects, otherwise one rect.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-hidden') ? [] : [{} as DOMRect]) as unknown as DOMRectList;
  });
  document.body.innerHTML = '';
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('isVisible / resolveAnchor', () => {
  it('treats an element with no client rects as absent — that is how <Activity hidden> reports', () => {
    document.body.innerHTML = '<div data-tour="a"></div><div data-tour="b" data-hidden></div>';
    expect(isVisible(document.querySelector('[data-tour="a"]')!)).toBe(true);
    expect(resolveAnchor('a')).not.toBeNull();
    expect(resolveAnchor('b')).toBeNull();
    expect(resolveAnchor('nope')).toBeNull();
  });
});

describe('waitForAnchor', () => {
  it('resolves immediately when the anchor is already visible', async () => {
    document.body.innerHTML = '<div data-tour="a"></div>';
    await expect(waitForAnchor('a', { schedule: () => { throw new Error('should not poll'); } })).resolves.not.toBeNull();
  });

  it('polls until the anchor appears', async () => {
    vi.useFakeTimers();
    const p = waitForAnchor('late', { timeoutMs: 1500, schedule: (cb) => setTimeout(cb, 16), now: () => Date.now() });
    vi.advanceTimersByTime(100);
    document.body.innerHTML = '<div data-tour="late"></div>';
    vi.advanceTimersByTime(20);
    await expect(p).resolves.not.toBeNull();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const p = waitForAnchor('never', { timeoutMs: 1500, schedule: (cb) => setTimeout(cb, 16), now: () => Date.now() });
    vi.advanceTimersByTime(1600);
    await expect(p).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run -c vitest.worktree.config.ts src/components/Tour/dom.test.ts` → `Cannot find module './dom'`.

- [ ] **Step 3: Implement**

`src/components/Tour/dom.ts`:

```ts
// src/components/Tour/dom.ts
//
// Finding a step's target. "Visible" means it has layout: panels kept alive
// inside <Activity mode="hidden"> are display:none and report no client rects,
// which is exactly the case the tour must treat as "not there yet".
export function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

export function resolveAnchor(id: string, root: ParentNode = document): HTMLElement | null {
  const el = root.querySelector(`[data-tour="${id}"]`);
  return el instanceof HTMLElement && isVisible(el) ? el : null;
}

export interface WaitOptions {
  timeoutMs?: number;
  /** Injected for tests; defaults to requestAnimationFrame. */
  schedule?: (cb: () => void) => void;
  now?: () => number;
  root?: ParentNode;
}

/** Poll until the anchor is visible or the timeout passes (spec §2.1: 1.5 s). */
export function waitForAnchor(id: string, opts: WaitOptions = {}): Promise<HTMLElement | null> {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
  const now = opts.now ?? (() => performance.now());
  const root = opts.root ?? document;

  const first = resolveAnchor(id, root);
  if (first) return Promise.resolve(first);

  const deadline = now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const el = resolveAnchor(id, root);
      if (el) return resolve(el);
      if (now() >= deadline) return resolve(null);
      schedule(tick);
    };
    schedule(tick);
  });
}
```

- [ ] **Step 4: Run to verify it passes** — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tour/dom.ts src/components/Tour/dom.test.ts
git commit -m "feat(tour): resolve and wait for data-tour anchors"
```

---

### Task 4: Analytics events for the tour

**Files:**
- Modify: `src/lib/analytics.ts` — the three `onboarding_*` entries (lines ~10-27) and the two `user_type_*` entries (~132-139)

The old `OnboardingContext` still fires the old shapes until Task 6 deletes it, so this task **adds** the new shapes under new keys is *not* the approach — the spec keeps the names. Instead: reshape the entries **and** delete the old context in the same commit as Task 6. So this task only stages the text; commit it together with Task 6. Concretely, replace:

```ts
  'onboarding_started': {
    chapter: string;
    is_first_time_user: boolean;
    onboarding_version: number;
  };
  'onboarding_completed': {
    chapter: string;
    completion_method: 'finished' | 'skipped';
    steps_completed: number;
    total_steps: number;
    duration_ms: number;
    onboarding_version: number;
  };
  'onboarding_step_viewed': {
    chapter: string;
    step_index: number;
    step_id: string;
  };
  'onboarding_step_skipped': {
    chapter: string;
    step_id: string;
    reason: 'target-missing';
  };
```

and **delete** `'user_type_selected'` and `'user_type_applied'` (their only callers are `OnboardingContext.tsx` and the `MainLayout` handler Plan 2 removed).

- [ ] **Step 1: Make the edit; do not commit yet** — `npx tsc --noEmit 2>&1 | grep -E "OnboardingContext|MainLayout" | head` will show the expected errors in `OnboardingContext.tsx` (old shapes). They disappear in Task 6.

---

### Task 5: `TourProvider` — the state machine

**Files:**
- Create: `src/components/Tour/TourProvider.tsx`
- Test: `src/components/Tour/TourProvider.test.tsx`

**Interfaces:**
- Consumes: `visibleSteps`, `contentKey`, `titleKey`, `TourActions` (Task 1); `waitForAnchor` (Task 3); `useLayoutStore` (Plan 1); `useSettingsStore.getState().navigateToSettings`; `useSetupStore.getState().completeTour`; `useAnalytics`.
- Produces:
  ```ts
  export interface TourApi {
    active: boolean; chapter: 'basics'; ctx: TourCtx | null;
    steps: TourStep[]; index: number; step: TourStep | null; target: HTMLElement | null; resolving: boolean;
    start: (ctx: TourCtx) => void; next: () => void; back: () => void; skip: () => void;
  }
  export const TourProvider: React.FC<{ children: React.ReactNode; waitOptions?: WaitOptions }>;
  export function useTour(): TourApi;
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/Tour/TourProvider.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const completeTour = vi.fn(async () => {});
vi.mock('../../stores/setupStore', () => ({ useSetupStore: { getState: () => ({ completeTour }) } }));
const navigateToSettings = vi.fn();
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ navigateToSettings }) } }));
const setShowSettings = vi.fn();
vi.mock('../../stores/layoutStore', () => ({ useLayoutStore: { getState: () => ({ setShowSettings }) } }));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

import { TourProvider, useTour } from './TourProvider';
import type { TourCtx } from './tourContext';

const ctx: TourCtx = { scenario: 'understand-others', providerPath: 'managed', provider: 'kizunaai_soniox' as any, platform: 'electron', os: 'linux', mode: 'participant', textOnly: true, isSignedIn: true, apiKeyValid: true };
// visible for ctx: welcome, mode-picker, participant-source, subtitle, account, start, done

const Probe: React.FC = () => {
  const t = useTour();
  return (
    <div>
      <span data-testid="state">{t.active ? `${t.index}:${t.step?.id}:${t.resolving ? 'wait' : t.target ? 'on' : 'center'}` : 'idle'}</span>
      <button onClick={() => t.start(ctx)}>start</button>
      <button onClick={t.next}>next</button>
      <button onClick={t.back}>back</button>
      <button onClick={t.skip}>skip</button>
    </div>
  );
};

const anchors = (ids: string[]) => { document.body.innerHTML = ids.map((id) => `<div data-tour="${id}"></div>`).join(''); };
// Drains enough microtask turns for the polling wait (fastWait below polls on
// microtasks and times out after ~10 of them) plus the resolution that follows.
const flush = () => act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-hidden') ? [] : [{} as DOMRect]) as unknown as DOMRectList;
  });
  completeTour.mockClear(); navigateToSettings.mockClear(); setShowSettings.mockClear(); trackEvent.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Polls synchronously up to `n` times so a test never waits on real frames.
const fastWait = { timeoutMs: 10, schedule: (cb: () => void) => queueMicrotask(cb), now: (() => { let t = 0; return () => (t += 1); })() };

const mount = () => { anchors([]); render(<TourProvider waitOptions={fastWait}><Probe /></TourProvider>); };

describe('TourProvider', () => {
  it('is idle until started, then shows the centred welcome', async () => {
    mount();
    expect(state()).toBe('idle');
    fireEvent.click(screen.getByText('start'));
    await flush();
    expect(state()).toBe('0:welcome:center');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_started', expect.objectContaining({ chapter: 'basics' }));
    expect(trackEvent).toHaveBeenCalledWith('onboarding_step_viewed', expect.objectContaining({ step_id: 'welcome', step_index: 0 }));
  });

  it('runs prepare, waits for the anchor, and highlights it', async () => {
    mount();
    anchors(['mode-picker', 'participant-section']);
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();
    expect(state()).toBe('1:mode-picker:on');
    fireEvent.click(screen.getByText('next')); await flush();
    expect(setShowSettings).toHaveBeenCalledWith(true);
    expect(navigateToSettings).toHaveBeenCalledWith('participant');
    expect(state()).toBe('2:participant-source:on');
  });

  it('skips a step whose anchor never becomes visible, and says so', async () => {
    mount();
    anchors(['mode-picker', 'subtitle-enter']);           // participant-section absent
    document.body.insertAdjacentHTML('beforeend', '<div data-tour="participant-section" data-hidden></div>');
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();      // mode-picker
    fireEvent.click(screen.getByText('next')); await flush(); await flush();
    expect(state()).toBe('3:subtitle:on');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_step_skipped', { chapter: 'basics', step_id: 'participant-source', reason: 'target-missing' });
  });

  it('back goes to the previous visible step', async () => {
    mount();
    anchors(['mode-picker']);
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();
    fireEvent.click(screen.getByText('back')); await flush();
    expect(state()).toBe('0:welcome:center');
  });

  it('finishing the last step persists "finished"; skip persists "skipped"', async () => {
    mount();
    anchors(['mode-picker', 'participant-section', 'subtitle-enter', 'account-button', 'main-action']);
    fireEvent.click(screen.getByText('start')); await flush();
    for (let i = 0; i < 6; i++) { fireEvent.click(screen.getByText('next')); await flush(); }
    expect(state()).toBe('6:done:center');
    fireEvent.click(screen.getByText('next')); await flush();
    expect(state()).toBe('idle');
    expect(completeTour).toHaveBeenCalledWith('basics', 'finished');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_completed', expect.objectContaining({ completion_method: 'finished', total_steps: 7 }));

    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('skip')); await flush();
    expect(state()).toBe('idle');
    expect(completeTour).toHaveBeenCalledWith('basics', 'skipped');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module './TourProvider'`.

- [ ] **Step 3: Implement**

`src/components/Tour/TourProvider.tsx`:

```tsx
// src/components/Tour/TourProvider.tsx
//
// The tour's state machine (spec §2.1, §2.3). Owns: which steps are visible for
// the context, which one is current, the resolved target element, and the
// persistence + analytics on finish/skip. Rendering is TourOverlay's job.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { TOUR_VERSION } from '../../lib/setup/types';
import { visibleSteps } from './steps';
import type { TourActions, TourStep } from './steps';
import { waitForAnchor } from './dom';
import type { WaitOptions } from './dom';
import type { TourCtx } from './tourContext';

const CHAPTER = 'basics' as const;

export interface TourApi {
  active: boolean;
  chapter: typeof CHAPTER;
  ctx: TourCtx | null;
  steps: TourStep[];
  index: number;
  step: TourStep | null;
  target: HTMLElement | null;
  resolving: boolean;
  start: (ctx: TourCtx) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const TourContext = createContext<TourApi | null>(null);

interface State {
  ctx: TourCtx | null;
  steps: TourStep[];
  index: number;
  target: HTMLElement | null;
  resolving: boolean;
  startedAt: number;
}

const idle: State = { ctx: null, steps: [], index: -1, target: null, resolving: false, startedAt: 0 };

export const TourProvider: React.FC<{ children: React.ReactNode; waitOptions?: WaitOptions }> = ({ children, waitOptions }) => {
  const { trackEvent } = useAnalytics();
  const [state, setState] = useState<State>(idle);
  // Guards a stale resolution from a step the user already left.
  const generation = useRef(0);

  const actions = useMemo<TourActions>(() => ({
    openSettings: (target) => {
      useLayoutStore.getState().setShowSettings(true);
      useSettingsStore.getState().navigateToSettings(target);
    },
    closeSettings: () => useLayoutStore.getState().setShowSettings(false),
  }), []);

  const finish = useCallback((method: 'finished' | 'skipped', s: State) => {
    generation.current += 1;
    setState(idle);
    trackEvent('onboarding_completed', {
      chapter: CHAPTER, completion_method: method,
      steps_completed: method === 'finished' ? s.steps.length : Math.max(0, s.index),
      total_steps: s.steps.length, duration_ms: Date.now() - s.startedAt, onboarding_version: TOUR_VERSION,
    });
    useSetupStore.getState().completeTour(CHAPTER, method).catch((err) => console.error('[Tour] Could not persist tour completion:', err));
  }, [trackEvent]);

  // Move to `index`, resolving its anchor; on a missing anchor, keep moving in
  // `dir` until a step resolves or the catalogue runs out.
  const goTo = useCallback(async (s: State, index: number, dir: 1 | -1) => {
    const gen = ++generation.current;
    let i = index;
    while (i >= 0 && i < s.steps.length) {
      const step = s.steps[i];
      setState({ ...s, index: i, target: null, resolving: Boolean(step.anchor) });
      step.prepare?.(s.ctx!, actions);
      const target = step.anchor ? await waitForAnchor(step.anchor, waitOptions) : null;
      if (gen !== generation.current) return;
      if (step.anchor && !target) {
        console.warn(`[Tour] Anchor "${step.anchor}" for step "${step.id}" did not appear; skipping.`);
        trackEvent('onboarding_step_skipped', { chapter: CHAPTER, step_id: step.id, reason: 'target-missing' });
        i += dir;
        continue;
      }
      setState({ ...s, index: i, target, resolving: false });
      trackEvent('onboarding_step_viewed', { chapter: CHAPTER, step_index: i, step_id: step.id });
      return;
    }
    // Ran off either end: treat as finished (forward) or stay put (backward).
    if (dir === 1) finish('finished', s); else setState({ ...s, resolving: false });
  }, [actions, finish, trackEvent, waitOptions]);

  const start = useCallback((ctx: TourCtx) => {
    const steps = visibleSteps(ctx);
    const s: State = { ctx, steps, index: -1, target: null, resolving: false, startedAt: Date.now() };
    trackEvent('onboarding_started', { chapter: CHAPTER, is_first_time_user: ctx.scenario !== null, onboarding_version: TOUR_VERSION });
    void goTo(s, 0, 1);
  }, [goTo, trackEvent]);

  const next = useCallback(() => {
    setState((s) => {
      if (!s.ctx) return s;
      if (s.index >= s.steps.length - 1) { finish('finished', s); return idle; }
      void goTo(s, s.index + 1, 1);
      return s;
    });
  }, [finish, goTo]);

  const back = useCallback(() => {
    setState((s) => {
      if (!s.ctx || s.index <= 0) return s;
      void goTo(s, s.index - 1, -1);
      return s;
    });
  }, [goTo]);

  const skip = useCallback(() => {
    setState((s) => { if (s.ctx) finish('skipped', s); return idle; });
  }, [finish]);

  const api = useMemo<TourApi>(() => ({
    active: state.ctx !== null, chapter: CHAPTER, ctx: state.ctx, steps: state.steps, index: state.index,
    step: state.index >= 0 ? state.steps[state.index] ?? null : null, target: state.target, resolving: state.resolving,
    start, next, back, skip,
  }), [state, start, next, back, skip]);

  return <TourContext.Provider value={api}>{children}</TourContext.Provider>;
};

export function useTour(): TourApi {
  const api = useContext(TourContext);
  if (!api) throw new Error('useTour must be used within a TourProvider');
  return api;
}
```

Note on `next`/`back`/`skip` calling `goTo`/`finish` inside a `setState` updater: React may invoke updaters twice in StrictMode/dev. If the Task 5 tests show doubled `onboarding_step_viewed` events, restructure to read the latest state from a `useRef` mirror (`stateRef.current = state` in a `useEffect`) and call `goTo(stateRef.current, …)` directly instead of from inside `setState`. Either form must keep the tests green; prefer the ref form if in doubt.

- [ ] **Step 4: Run to verify it passes** — 5 passed. If the "skips a step" case is flaky, raise the turn count inside `flush` (it drains microtasks; the timeout poll needs ~10 of them) rather than loosening the assertion.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE "^src/components/Tour/"   # 0
git add src/components/Tour/TourProvider.tsx src/components/Tour/TourProvider.test.tsx
git commit -m "feat(tour): add the tour state machine with anchor waiting and persistence"
```

---

### Task 6: `TourOverlay`, wiring, and the deletions

**Files:**
- Create: `src/components/Tour/TourOverlay.tsx`, `src/components/Tour/Tour.scss`, `src/components/Tour/useStartBasicsTour.ts`
- Modify: `src/routes/Home.tsx`, `src/components/MainLayout/MainLayout.tsx`, `src/components/Settings/sections/HelpSection.tsx`, `src/components/SetupWizard/SetupWizard.tsx`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/components/MainLayout/MainLayout.keepAlive.test.tsx`, `src/components/MainLayout/MainLayout.setup.test.tsx`, `src/components/Settings/SimpleSettings/SimpleSettings.order.test.tsx`, `SimpleSettings.account.test.tsx` (the `OnboardingContext` mocks), `package.json`, `package-lock.json`, `src/lib/analytics.ts` (Task 4's staged edit)
- Delete: `src/contexts/OnboardingContext.tsx`, `src/contexts/OnboardingContext.steps.test.ts`, `src/components/Onboarding/Onboarding.tsx`, `src/components/Onboarding/Onboarding.scss`
- Test: `src/components/Tour/TourOverlay.test.tsx`

- [ ] **Step 1: Write the failing overlay test**

`src/components/Tour/TourOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));
const api = { active: true, chapter: 'basics', ctx: { platform: 'electron', os: 'linux', isSignedIn: true, apiKeyValid: true, providerPath: 'managed', mode: 'speaker', textOnly: false, scenario: 'be-heard', provider: 'x' },
  steps: [{ id: 'welcome' }, { id: 'mode-picker', anchor: 'mode-picker' }, { id: 'done' }], index: 0, step: { id: 'welcome' }, target: null, resolving: false,
  start: vi.fn(), next: vi.fn(), back: vi.fn(), skip: vi.fn() };
vi.mock('./TourProvider', () => ({ useTour: () => api }));

import TourOverlay from './TourOverlay';

beforeEach(() => { api.index = 0; api.step = { id: 'welcome' }; api.target = null; api.active = true; api.next.mockClear(); api.back.mockClear(); api.skip.mockClear(); });
afterEach(cleanup);

describe('TourOverlay', () => {
  it('renders nothing when the tour is idle', () => {
    api.active = false;
    const { container } = render(<TourOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a centred card with progress, no Back on the first step', () => {
    render(<TourOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.next).toHaveBeenCalled();
  });

  it('Escape skips, Enter advances, and the last step says Finish', () => {
    render(<TourOverlay />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(api.next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(api.skip).toHaveBeenCalled();
    cleanup();
    api.index = 2; api.step = { id: 'done' };
    render(<TourOverlay />);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('draws the spotlight over the target when there is one', () => {
    document.body.innerHTML = '<div data-tour="mode-picker"></div>';
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = document.querySelector('[data-tour="mode-picker"]') as HTMLElement;
    render(<TourOverlay />);
    expect(document.querySelector('.tour-spotlight')).not.toBeNull();
    expect(document.querySelector('.tour-scrim--full')).toBeNull();
  });
});
```

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour/TourOverlay.test.tsx` — Expected: FAIL (`Cannot find module './TourOverlay'`).

- [ ] **Step 2: Implement `TourOverlay`**

`src/components/Tour/TourOverlay.tsx`:

```tsx
// src/components/Tour/TourOverlay.tsx
//
// Draws the current tour step (spec §2.1): a scrim with a cutout over the
// target, or a full scrim with a centred card when the step has no anchor,
// plus the popover with title, body, progress and controls. The target is not
// interactive during the tour — the tour teaches, it does not operate.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useFloating, useDismiss, useRole, useInteractions, FloatingFocusManager, FloatingPortal,
  offset, flip, shift, autoUpdate,
} from '@floating-ui/react';
import { useTour } from './TourProvider';
import { contentKey, titleKey } from './steps';
import './Tour.scss';

const PAD = 6;

const TourOverlay: React.FC = () => {
  const { t } = useTranslation();
  const tour = useTour();
  const { active, step, ctx, index, steps, target, resolving } = tour;
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Keep the cutout glued to the target through scrolls and resizes.
  useLayoutEffect(() => {
    if (!target) { setRect(null); return; }
    return autoUpdate(target, document.body, () => setRect(target.getBoundingClientRect()));
  }, [target]);

  const { refs, floatingStyles, context } = useFloating({
    open: active,
    onOpenChange: (isOpen) => { if (!isOpen) tour.skip(); },
    placement: step?.placement ?? 'bottom',
    elements: { reference: target ?? undefined },
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => { if (active && target) target.scrollIntoView({ block: 'center', inline: 'nearest' }); }, [active, target]);

  if (!active || !step || !ctx) return null;

  const isLast = index >= steps.length - 1;
  const centred = !target;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); tour.next(); }
  };

  return (
    <FloatingPortal>
      {centred
        ? <div className="tour-scrim tour-scrim--full" />
        : rect && (
          <div
            className="tour-spotlight"
            style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          />
        )}
      <FloatingFocusManager context={context} modal returnFocus>
        <div
          ref={refs.setFloating}
          className={`tour-popover${centred ? ' tour-popover--centred' : ''}${resolving ? ' is-resolving' : ''}`}
          style={centred ? undefined : floatingStyles}
          aria-label={t(titleKey(step), step.id)}
          onKeyDown={onKeyDown}
          {...getFloatingProps()}
        >
          <h2 className="tour-popover__title">{t(titleKey(step), step.id)}</h2>
          <p className="tour-popover__body">{t(contentKey(step, ctx), '')}</p>
          <div className="tour-popover__footer">
            <span className="tour-popover__progress">{`${index + 1} / ${steps.length}`}</span>
            <span className="tour-popover__spacer" />
            {!isLast && (
              <button type="button" className="tour-popover__btn tour-popover__btn--ghost" onClick={tour.skip}>{t('tour.skip', 'Skip')}</button>
            )}
            {index > 0 && (
              <button type="button" className="tour-popover__btn" onClick={tour.back}>{t('tour.back', 'Back')}</button>
            )}
            <button type="button" className="tour-popover__btn tour-popover__btn--primary" onClick={tour.next} autoFocus>
              {isLast ? t('tour.finish', 'Finish') : t('tour.next', 'Next')}
            </button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

export default TourOverlay;
```

`src/components/Tour/Tour.scss`:

```scss
@use '../Settings/shared/variables' as vars;

// The cutout: a box over the target whose enormous box-shadow IS the scrim.
.tour-spotlight {
  position: fixed;
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 1800;
  transition: top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease;
}

.tour-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1800;
}

.tour-popover {
  position: fixed;
  z-index: 1801;
  width: min(360px, calc(100vw - 24px));
  background: vars.$bg-surface;
  border: 1px solid vars.$border-default;
  border-radius: vars.$radius-lg;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: vars.$space-4;
  color: vars.$text-primary;

  &--centred { top: 50%; left: 50%; transform: translate(-50%, -50%); }
  &.is-resolving { visibility: hidden; }

  &__title { margin: 0 0 vars.$space-2; font-size: vars.$font-title; font-weight: vars.$weight-semibold; }
  &__body { margin: 0 0 vars.$space-3; font-size: vars.$font-body; color: vars.$text-secondary; line-height: 1.45; }
  &__footer { display: flex; align-items: center; gap: vars.$space-2; }
  &__progress { font-size: vars.$font-caption; color: vars.$text-muted; }
  &__spacer { flex: 1; }
  &__btn {
    @include vars.control-base;
    padding: 5px 10px; cursor: pointer;
    &--ghost { background: transparent; border-color: transparent; color: vars.$text-muted; }
    &--primary { @include vars.state-selected-fill; border-color: vars.$color-primary; }
    &:focus-visible { @include vars.focus-ring; }
  }
}
```

- [ ] **Step 3: `useStartBasicsTour` (Help restart)**

`src/components/Tour/useStartBasicsTour.ts`:

```ts
// Builds a TourCtx from the live stores and starts chapter 1. Help's
// "Restart Setup Guide" uses it; the wizard seeds its own ctx instead
// (it knows the credential outcome the store does not yet).
import { useCallback } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only
import { isElectron, isLinux, isMacOS, isWindows } from '../../utils/environment';
import { buildTourCtx } from './tourContext';
import { useTour } from './TourProvider';

export function useStartBasicsTour(): () => void {
  const { isSignedIn } = useAuth();
  const { start } = useTour();
  return useCallback(() => {
    const s = useSettingsStore.getState();
    start(buildTourCtx({
      record: useSetupStore.getState().setup,
      provider: s.provider,
      mode: useAudioStore.getState().mode,
      textOnly: s.textOnly,
      isSignedIn,
      apiKeyValid: s.isApiKeyValid,
      env: { isElectron: isElectron(), isLinux: isLinux(), isMacOS: isMacOS(), isWindows: isWindows() },
    }));
  }, [isSignedIn, start]);
}
```

- [ ] **Step 4: Wire `Home`, `MainLayout`, `HelpSection`, `SetupWizard`**

`src/routes/Home.tsx`: replace the `OnboardingProvider` import with `import { TourProvider } from '../components/Tour/TourProvider';` and the JSX wrapper `<OnboardingProvider>…</OnboardingProvider>` with `<TourProvider>…</TourProvider>`.

`src/components/MainLayout/MainLayout.tsx`: replace `import Onboarding from '../Onboarding/Onboarding';` with `import TourOverlay from '../Tour/TourOverlay';`; replace `<Onboarding />` (inside the `main-layout` div) with nothing there, and add **after** the `main-layout` div, before `{electronSubtitleTakeover && <SubtitleApp />}`:
```tsx
    {!electronSubtitleTakeover && <TourOverlay />}
```
(Outside the div so the Electron subtitle takeover's `display: none` cannot hide a running tour's popover — the tour simply does not render during takeover.)

`src/components/Settings/sections/HelpSection.tsx`: replace `import { useOnboarding } …` with `import { useStartBasicsTour } from '../../Tour/useStartBasicsTour';`, replace `const { startOnboarding } = useOnboarding();` with `const startTour = useStartBasicsTour();`, and `startOnboarding()` with `startTour()` in the restart link. Change that link's label key from `onboarding.restartTour` to `tour.restart` (default 'Restart Setup Guide').

`src/components/SetupWizard/SetupWizard.tsx`: after `await apply(draft);` in `finish`, and only for `variant === 'first-run'`, start the tour:

```tsx
      if (variant === 'first-run') {
        const preset = getScenario(draft.scenario!);
        startTour(buildTourCtx({
          record: { scenario: draft.scenario, providerPath: draft.providerPath },
          provider: draft.provider!,
          mode: preset.mode, textOnly: preset.textOnly, isSignedIn,
          apiKeyValid: draft.providerPath === 'own-key' ? !draft.credentialsPending : null,
          env: { isElectron: isElectron(), isLinux: isLinux(), isMacOS: isMacOS(), isWindows: isWindows() },
        }));
      }
```
with imports `import { getScenario } from '../../lib/setup/scenarios';`, `import { buildTourCtx } from '../Tour/tourContext';`, `import { useTour } from '../Tour/TourProvider';`, `import { isElectron, isLinux, isMacOS, isWindows } from '../../utils/environment';` and `const { start: startTour } = useTour();` beside the other hooks. In `SetupWizard.test.tsx` add `vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ start: vi.fn() }) }));` and, in the "skip for now" test, assert nothing extra (the mock swallows the start).

- [ ] **Step 5: Delete the old system**

```bash
git rm -r src/contexts/OnboardingContext.tsx src/contexts/OnboardingContext.steps.test.ts src/components/Onboarding
npm uninstall react-joyride --package-lock-only --ignore-scripts
grep -rn "OnboardingContext\|react-joyride\|useOnboarding\|components/Onboarding" src package.json --include='*.ts' --include='*.tsx' --include='*.json'
```
The grep must print nothing except test mocks, which you now fix:
- `MainLayout.keepAlive.test.tsx:17` and `MainLayout.setup.test.tsx`: replace `vi.mock('../Onboarding/Onboarding', …)` with `vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));` and delete any `vi.mock('../../contexts/OnboardingContext', …)` line.
- `SimpleSettings.order.test.tsx:19`, `SimpleSettings.account.test.tsx:17`: these mock `HelpSection` because it used `useOnboarding`; the mock can stay (comment updated to say `useStartBasicsTour` needs a `TourProvider`).

Confirm `package.json` no longer lists `react-joyride` and `git diff --stat package-lock.json` shows only removals.

**Retire the legacy localStorage keys in this same commit.** Plan 1's final review found that `setupStore.hydrate` must not delete `sokuji_user_type` / `sokuji_onboarding_completed` while `OnboardingContext` still reads them, so Plan 1 gated the removal behind `LEGACY_KEYS_RETIRED = false` in `src/lib/setup/setupMigration.ts`. `OnboardingContext` dies here, so: flip the constant to `true` (and reword its comment to say the reader is gone), and change `src/stores/setupStore.test.ts`'s migration test back to asserting both keys are **removed** (`localStorage.getItem(LEGACY_USER_TYPE_KEY)` → `null`, likewise the onboarding key) — TDD: flip the test first, watch it fail, then flip the constant. Run `npx vitest run -c vitest.worktree.config.ts src/stores/setupStore.test.ts src/lib/setup`.

- [ ] **Step 6: Run everything this task touches**

Run: `npx vitest run -c vitest.worktree.config.ts src/components/Tour src/components/MainLayout src/components/Settings/ src/components/SetupWizard src/routes`
Expected: all pass.

- [ ] **Step 7: Type-check A/B and commit (with Task 4's analytics edit)**

```bash
npx tsc --noEmit 2>&1 | grep -cE "error TS"   # must be ≤ the end-of-Plan-2 count (deleting two error-carrying files may lower it)
git add -A src/components/Tour src/routes/Home.tsx src/components/MainLayout src/components/Settings src/components/SetupWizard src/contexts src/components/Onboarding src/lib/analytics.ts package.json package-lock.json
git commit -m "feat(tour): render the tour on floating-ui; start it after setup and from Help; drop react-joyride"
```

---

### Task 7: English strings

**Files:**
- Modify: `src/locales/en/translation.json` — add a top-level `"tour"` object after `"setup"`

- [ ] **Step 1: Add the keys** (content is the spec's §2.2 "Says" column, one or two sentences each; wording is settled by rendering in Plan 4):

```json
  "tour": {
    "back": "Back",
    "next": "Next",
    "skip": "Skip",
    "finish": "Finish",
    "restart": "Restart Setup Guide",
    "steps": {
      "welcome": { "title": "You're set up", "content": "Sokuji is configured for your scenario. Here is a short look around — it takes under a minute." },
      "mode-picker": { "title": "Translation mode", "content": "This is set for you. Switch it any time; switching also changes whether the translation is spoken or shown as subtitles." },
      "microphone": { "title": "Your microphone", "content": "Your speech comes in here. The system default is already selected. Do not pick the Sokuji virtual microphone — that one is for your meeting app." },
      "monitor": { "title": "Hear yourself translated", "content": "Play the translated voice to your own headphones so you can check how it sounds. Turn it off if you do not need it." },
      "output-routing": {
        "title": "How the other side hears you",
        "content": "Your translated voice goes to a virtual microphone; pick it as the mic in your meeting app.",
        "content_extension": "In Google Meet, Zoom or Teams, choose \"Sokuji Virtual Microphone\" as your microphone. Sokuji adds it to supported meeting sites automatically.",
        "content_electronLinux": "Sokuji created a virtual microphone on this system. Choose it as the microphone in your meeting app.",
        "content_electronOther": "You need a virtual audio cable (for example VB-Cable). Send Sokuji's output to it, and choose it as the microphone in your meeting app."
      },
      "participant-source": {
        "title": "The other side's voice",
        "content": "Sokuji listens to the other side here.",
        "content_electron": "Choose the app to translate, or all system audio. Their original voice keeps playing as usual.",
        "content_extension": "Sokuji translates the audio of the current tab. Their original voice keeps playing as usual."
      },
      "subtitle": { "title": "Subtitle mode", "content": "Opens a floating subtitle view — a window on desktop, an overlay on the page in the extension. OBS and screen sharing can capture it." },
      "account": {
        "title": "Your account",
        "content": "Your balance and top-up live here.",
        "content_signedOut": "Sign in here. Start unlocks once you are signed in."
      },
      "provider-settings": {
        "title": "Provider settings",
        "content": "Change your key or switch provider here.",
        "content_pending": "Paste your API key here. Start unlocks once it validates."
      },
      "models": { "title": "Models", "content": "Download models here — one per stage. Try a few; the first pick is not the only good one." },
      "start": {
        "title": "Start",
        "content": "Press here to start translating.",
        "content_offline": "This lights up once your models are ready.",
        "content_signedOut": "This lights up once you sign in.",
        "content_pendingKey": "This lights up once your API key validates."
      },
      "done": { "title": "That's it", "content": "Advanced settings — speech detection, prompts, voices, logs — live behind the Advanced toggle at the top of Settings. Replay this guide any time from Help." }
    }
  },
```

- [ ] **Step 2: Verify JSON; expect the locale suite to stay red only for the 29 catalogues**

`node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json','utf8')); console.log('ok')"`

- [ ] **Step 3: Commit and list keys**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(tour): add English strings for the tour"
```
Report the flattened `tour.*` key list (same one-liner as Plan 2 Task 8, with `.tour`).

---

### Task 8: Plan-level verification

- [ ] **Step 1: Touched-directory run** — same command as Plan 2 Task 9 plus `src/components/Tour`; expected: no `FAIL`, `Errors  4 errors`.
- [ ] **Step 2: `grep -rn "data-onboarding\|joyride\|OnboardingProvider" src extension` must print nothing.**
- [ ] **Step 3: Repo-wide type-check A/B** — count ≤ end of Plan 2.
- [ ] **Step 4: Render it** — with a cleared profile, finish the wizard on the managed path with scenario #4 and watch the tour walk 9 steps; confirm the settings panel opens for `microphone` and `participant-source` without a click, the spotlight follows a scrolled section, Escape ends it, and `settings.tour` is written (`localStorage` in Electron: key `settings.tour`). Then Help → Restart Setup Guide. Screenshots to the report.
- [ ] **Step 5: Report** — numbers, commits, key list, screenshots, and the deviation noted in Global Constraints restated for the record.
