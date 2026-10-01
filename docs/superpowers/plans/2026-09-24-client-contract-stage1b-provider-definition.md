# Client contract — Stage 1b: the provider definition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The provider-definition layer — the `Provider<S, K, C>` type, the registry with `VITE_ENABLED_PROVIDERS`, generic settings / credential / language-pair storage, one readiness state per provider, the credential form, the language section and a provider panel — brought up on the fake provider and viewable in a development preview, touching nothing the app runs today.

**Architecture:** `src/lib/provider/` holds the definition types and the shared language rules; `src/providers/registry.ts` is the ordered list (the fake is its only member in this plan, compiled into development builds only). `src/stores/providerStore.ts` loads and saves any provider's settings, credentials and language pair under today's `settings.<key>.<field>` keys and runs its `check`. Three generic components in `src/components/providers/` draw any provider from its definition; `src/components/dev/SpinePreview.tsx` mounts them on a development-only page (`?preview=spine`). The old settings panel, `ProviderConfigFactory` and every old client stay untouched until plan 1e.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `jsx: react-jsx` — never import `React` just for JSX), React 18, Zustand 5, vitest 4 (`globals`, jsdom, `@testing-library/react`, jest-dom matchers from `src/setupTests.ts`), lucide-react icons, i18next via `react-i18next`.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — sections "The provider definition" (all of it: "The shape", "Settings belong to the provider (D18)", "Credentials are not settings", "Readiness is one check", "Languages are two functions", "The registry is a list (D19)"), "Testing" (the fake provider, D24). Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` (its "Carried out of plan 1a" list for 1b is Task 2 Step 5 here).

## Global Constraints

- Work on branch `worktree-client-contract-refactor` in this worktree. Commit after every task. **Never push.**
- **Nothing the app runs changes.** No edit to `src/services/**`, `src/stores/settingsStore.ts`, `src/components/Settings/**` (importing its shared components is fine), `src/components/MainPanel/**` or any old client. The only edits to existing files are the ones a task names: `src/utils/environment.ts`, `src/utils/environment.test.ts`, `src/vite-env.d.ts`, `extension/vite.config.ts`, `.github/workflows/build.yml`, `.env.example`, `src/utils/featureGateForwarding.consistency.test.ts`, `src/providers/fake/adapter.ts` (one comment), `vite.config.ts` (one dev-server switch) and `src/App.tsx` (the dev-only preview mount).
- **Storage keys do not move** (spec: "`settings.key` is today's slice key, and values persist under `settings.<key>.<field>` exactly as now"). A provider's settings fields, credential fields and its language pair (`sourceLanguage`, `targetLanguage`) all persist at `settings.<settings.key>.<field>`; every write goes through `persistSetting` from `src/services/persistSetting.ts`.
- **Read every stored value with a default of its own type.** `SettingsService.getSetting` returns a stored string untouched only when the default is a string; with any other default it `JSON.parse`s it, so an API key `"123456"` read with a non-string default comes back as the number `123456`.
- `src/lib/provider/**` and `src/providers/**` import nothing from `src/services/**` or `src/stores/**`. A provider's own `Settings` component may import the shared UI components under `src/components/Settings/shared/`.
- No `console.*` in any new file. A failure the store notices goes out through `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts` (`consoleLedger.consistency.test.ts` counts console calls under `src/stores`).
- New UI in `src/components/providers/` uses existing locale keys only (`simpleSettings.provider`, `simpleSettings.validate`, `simpleConfig.translationLanguages`, `simpleConfig.swapLanguages`, `settings.sourceLanguage`, `settings.targetLanguage`, `common.autoDetect`, `providers.<id>.name`). The fake's own settings view is development-only and its copy is literal English.
- Match sibling markup: every new control copies the class names of the nearest existing instance of the same control (named per task). Class names are not checked by TypeScript, tests or review.
- Tests assert behaviour, not copy: i18n is mocked to return the fallback or the key, so a copy assertion proves nothing. Provider-supplied strings (a `reason`, a `missing` message) are data and may be asserted.
- English-only comments and test names. Tests are colocated next to the module.
- Conventional commit messages. Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
  ```
- Run one test file with `npx vitest run <path>`; the whole suite with `npx vitest run src` — it must report **0 failed**. It also prints 4 unhandled rejections from `src/stores/settingsStore.nativeGate.test.ts`; those predate this branch. Plain `npx vitest run` additionally collects git-ignored scratch tests under `.superpowers/` that fail on the baseline; ignore them.
- **Typecheck gate** (the Vite build does not typecheck). The baseline has ~296 unrelated errors, so run exactly:
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' \
    | grep -E '^(src/(lib/provider|providers|components/providers|components/dev/SpinePreview|stores/providerStore|utils/environment|vite-env|App\.tsx)|extension/)' \
    | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```
  It must print exactly these three baseline lines and nothing else:
  ```
  src/App.tsx: error TS6133: 'React' is declared but its value is never read.
  src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
  src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/provider/types.ts` | Types only: `Provider<S, K, C>`, `AnyProvider`, `Platform`, `ProviderKind`, `CredentialField`, `CredentialValues`, `AuthContext`, `LanguageOption`, `LanguagePair`, `ModelOption`, `CheckResult`, `SharedSettings`, `SettingsProps` |
| `src/lib/provider/languages.ts` | `AUTO`, `reverseSupported`, `swapped`, `normalizePair` — the language rules every provider shares |
| `src/lib/provider/presence.ts` | `PresenceEnv`, `isPresent` — platform and flag presence (D19) |
| `src/providers/fake/scripts.ts` | `FakeScriptName`, `FAKE_SCRIPT_NAMES`, `fakeScript(name)` — the scripts the fake plays |
| `src/providers/fake/settings.ts` | `FakeSettings`, `FAKE_DEFAULTS`, `migrateFakeSettings` |
| `src/providers/fake/FakeSettingsView.tsx` | The fake's own `Settings` component: script and fault knobs |
| `src/providers/fake/provider.ts` | `fakeProvider` — the fake's definition |
| `src/providers/registry.ts` | `PROVIDERS`, `ProviderId`, `presentProviders()`, `getProvider(id)`, `currentPresenceEnv()` |
| `src/utils/environment.ts` | + `enabledProviderIds()` reading `VITE_ENABLED_PROVIDERS` |
| `src/stores/providerStore.ts` | `useProviderStore`: `entries` (settings, credentials, pair per provider), `readiness`, `load`, `updateSettings`, `setCredential`, `setPair`, `refreshReadiness`; `Readiness`, `UNKNOWN` |
| `src/components/providers/CredentialForm.tsx` | Any provider's credential inputs plus the readiness check button |
| `src/components/providers/LanguagePairSection.tsx` | Any provider's language pair with the generic swap |
| `src/components/providers/ProviderPanel.tsx` | Provider picker + credentials + readiness + language pair + the provider's own `Settings` |
| `src/components/dev/SpinePreview.tsx` | Development-only page hosting `ProviderPanel` (`?preview=spine`) |

---

### Task 1: The definition types and the shared language rules

**Files:**
- Create: `src/lib/provider/types.ts`
- Create: `src/lib/provider/languages.ts`
- Test: `src/lib/provider/languages.test.ts`

**Interfaces:**
- Consumes: `SessionContext`, `Adapter` from `src/lib/contract/adapter.ts` (plan 1a).
- Produces: every type in `types.ts` exactly as written below; `AUTO = 'auto'`; `reverseSupported<S>(p, s, pair): boolean`; `swapped<S>(p, s, pair): LanguagePair | null`; `normalizePair<S>(p, s, pair: Partial<LanguagePair>): LanguagePair`. The three functions take any object with a `languages` member (`Pick<Provider<S, unknown, unknown>, 'languages'>`), so tests can pass a bare `{ languages }`.

- [ ] **Step 1: Write the types**

Create `src/lib/provider/types.ts`:

```ts
/**
 * The provider definition: one object per provider, and the only thing
 * generic code knows about it (spec: "The provider definition"). Types only.
 */
import type { ComponentType } from 'react';
import type { Adapter, SessionContext } from '../contract/adapter';

export type Platform = 'electron' | 'extension' | 'web';
export type ProviderKind = 'own-key' | 'managed' | 'local';

export interface LanguageOption { value: string; name: string; englishName: string }
export interface LanguagePair { source: string; target: string }

/**
 * One credential input. `key` is the field its value persists under
 * (`settings.<settings.key>.<key>`); `labelKey` and `placeholderKey` are i18n
 * keys.
 */
export interface CredentialField { key: string; labelKey: string; secret: boolean; placeholderKey?: string }

/** Credential values by field key; a field with nothing saved reads as ''. */
export type CredentialValues = Readonly<Record<string, string>>;

/** What `credentials.read` may consult besides the typed values: the sign-in session, for managed providers. */
export interface AuthContext { signedIn: boolean; getToken(): Promise<string | null> }

export interface ModelOption { id: string }

/** `models`, when present, is newest first. */
export type CheckResult = { ok: true; models?: readonly ModelOption[] } | { ok: false; reason: string };

/** What a builder may read beyond its own settings; a builder never reaches into a store. */
export interface SharedSettings {
  /** The system instructions for a direction: the user's for the speaker's direction, the participant prompt for the reverse. */
  instructions(direction: SessionContext['direction']): string;
  /** The segmentation pauses, in seconds, as stored. */
  pauses: { sourceSeconds: number; translationSeconds: number };
}

export interface SettingsProps<S> { settings: S; update(patch: Partial<S>): void }

export interface Provider<S, K, C> {
  // identity and presence
  /** Persisted as the selected provider; never renamed. */
  id: string;
  kind: ProviderKind;
  platforms: readonly Platform[];
  /** Hidden in release builds unless `VITE_ENABLED_PROVIDERS` lists the id (D19). */
  flagged?: true;
  icon: ComponentType<{ size?: string | number }>;
  docs?: string;
  vendor?: string;

  // settings — never secrets
  settings: {
    /** Storage prefix: every field persists at `settings.<key>.<field>`. */
    key: string;
    defaults: S;
    /** Turns what was stored — every field of `defaults`, each read with its default — into this version's `S`. */
    migrate?(stored: Readonly<Record<string, unknown>>): S;
  };
  Settings: ComponentType<SettingsProps<S>>;
  /** Model management, shown in Simple mode too; the local engines only. */
  Engine?: ComponentType<{ settings: S }>;

  // credentials — stored apart from settings
  credentials: {
    /** Every key `fields` can ever return, so all of them load at startup. */
    keys: readonly string[];
    fields(s: S): readonly CredentialField[];
    /** Receives the values of exactly the fields `fields(s)` returns. `K` must have no `missing` member. */
    read(values: CredentialValues, auth: AuthContext): K | { missing: string };
  };
  /** Can this provider start now: a network validation, model readiness, or a signed-in session. */
  check(k: K, s: S): Promise<CheckResult>;

  languages: {
    /** Includes `AUTO` when the provider detects the language. */
    sources(s: S): readonly LanguageOption[];
    /** Never includes `AUTO`. */
    targets(source: string, s: S): readonly LanguageOption[];
  };

  // the only capabilities generic code reads
  speech: 'always' | 'optional' | 'never';
  textInput: boolean;
  boundaries(s: S): 'provider' | 'silence';
  turns(s: S): ReadonlyArray<'auto' | 'manual'>;

  // one leg's session; `C` must have no `refused` member
  build(context: SessionContext, s: S, shared: SharedSettings): C | { refused: string };
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start: Adapter<C, K>['start'];
}

/**
 * A provider whose `S`, `K` and `C` are not known here. The registry holds
 * providers of different types, and generic code treats all three as opaque.
 */
export type AnyProvider = Provider<any, any, any>;
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/provider/languages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AUTO, normalizePair, reverseSupported, swapped } from './languages';
import type { LanguageOption } from './types';

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });

/** en / ja / fr with detection; fr translates only into en; `zhen` pairs only with itself (AST2's both-or-neither). */
const p = {
  languages: {
    sources: () => [opt(AUTO), opt('en'), opt('ja'), opt('fr'), opt('zhen')],
    targets: (source: string) => {
      if (source === 'zhen') return [opt('zhen')];
      if (source === 'fr') return [opt('en')];
      return [opt('en'), opt('ja'), opt('fr')].filter((o) => o.value !== source);
    },
  },
};
const s = undefined;

describe('reverseSupported', () => {
  it('holds when the target is a source and the source is among its targets', () => {
    expect(reverseSupported(p, s, { source: 'en', target: 'ja' })).toBe(true);
  });
  it('never holds for an AUTO source, since AUTO is never a target', () => {
    expect(reverseSupported(p, s, { source: AUTO, target: 'en' })).toBe(false);
  });
  it('fails when the provider does not offer the reversed direction', () => {
    expect(reverseSupported(p, s, { source: 'ja', target: 'fr' })).toBe(false);
  });
  it('holds for a pair that is its own reverse', () => {
    expect(reverseSupported(p, s, { source: 'zhen', target: 'zhen' })).toBe(true);
  });
});

describe('swapped', () => {
  it('reverses a supported pair', () => {
    expect(swapped(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en' });
  });
  it('is null for an AUTO source', () => {
    expect(swapped(p, s, { source: AUTO, target: 'en' })).toBeNull();
  });
  it('is null when the reverse is not offered', () => {
    expect(swapped(p, s, { source: 'ja', target: 'fr' })).toBeNull();
  });
  it('is null for a pair that is its own reverse, since there is nothing to swap', () => {
    expect(swapped(p, s, { source: 'zhen', target: 'zhen' })).toBeNull();
  });
});

describe('normalizePair', () => {
  it('keeps a pair the provider offers', () => {
    expect(normalizePair(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'en', target: 'ja' });
  });
  it('replaces an unlisted source with the first source, keeping a target that source offers', () => {
    expect(normalizePair(p, s, { source: 'xx', target: 'ja' })).toEqual({ source: AUTO, target: 'ja' });
  });
  it('replaces a target the source does not offer with its first target', () => {
    expect(normalizePair(p, s, { source: 'fr', target: 'ja' })).toEqual({ source: 'fr', target: 'en' });
  });
  it('fills an empty pair with the first source and its first target', () => {
    expect(normalizePair(p, s, {})).toEqual({ source: AUTO, target: 'en' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/provider/languages.test.ts`
Expected: FAIL — `Failed to resolve import "./languages"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/provider/languages.ts`:

```ts
/**
 * The language rules every provider shares (spec: "Languages are two
 * functions"). What differs between providers lives inside its `sources` and
 * `targets`; nothing here names a provider.
 */
import type { LanguageOption, LanguagePair, Provider } from './types';

/** The source value that asks the provider to detect the language. Never a target. */
export const AUTO = 'auto';

/** Only the two language functions are read, so a provider of any `K` and `C` fits. */
type Languages<S> = Pick<Provider<S, unknown, unknown>, 'languages'>;

function offers(options: readonly LanguageOption[], value: string): boolean {
  return options.some((o) => o.value === value);
}

/**
 * Whether the provider supports the reversed pair: the target among its
 * sources, and the source among that target's targets. It decides both the
 * swap button and whether the participant leg may open (D20). `AUTO` is never
 * a target, so an `AUTO` source never reverses.
 */
export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair): boolean {
  return offers(p.languages.sources(s), pair.target) && offers(p.languages.targets(pair.target, s), pair.source);
}

/** The reversed pair; null when the provider does not support it, or when it is the same pair. */
export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair): LanguagePair | null {
  if (pair.source === pair.target || !reverseSupported(p, s, pair)) return null;
  return { source: pair.target, target: pair.source };
}

/**
 * A pair the provider offers, keeping what it can of `pair`: its source when
 * listed, else the first source; its target when listed for that source, else
 * that source's first target. Every registered provider offers at least one
 * source, and at least one target for each (`registry.test.ts`).
 */
export function normalizePair<S>(p: Languages<S>, s: S, pair: Partial<LanguagePair>): LanguagePair {
  const sources = p.languages.sources(s);
  const source = pair.source !== undefined && offers(sources, pair.source) ? pair.source : sources[0].value;
  const targets = p.languages.targets(source, s);
  const target = pair.target !== undefined && offers(targets, pair.target) ? pair.target : targets[0].value;
  return { source, target };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/provider/languages.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Typecheck and commit**

Run the typecheck gate from Global Constraints; expect exactly the three baseline lines.

```bash
git add src/lib/provider/types.ts src/lib/provider/languages.ts src/lib/provider/languages.test.ts
git commit -F - <<'EOF'
feat(provider): the definition types and the shared language rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 2: The fake as a provider

**Files:**
- Create: `src/providers/fake/scripts.ts`
- Create: `src/providers/fake/settings.ts`
- Create: `src/providers/fake/FakeSettingsView.tsx`
- Create: `src/providers/fake/provider.ts`
- Modify: `src/providers/fake/adapter.ts` (the comment on `TEXT_REF_BASE` only)
- Test: `src/providers/fake/provider.test.ts`
- Test: `src/providers/fake/FakeSettingsView.test.tsx`

**Interfaces:**
- Consumes: Task 1's types and `AUTO`; plan 1a's `createFakeAdapter()`, `FakeConfig`, `FakeCredentials` (`Record<string, never>`), `exchange()`, `longScript()`, `FakeScript`; `ToggleSwitch` (default export of `src/components/Settings/shared/ToggleSwitch.tsx`, props `{ checked: boolean; onChange: () => void; label: string }`, renders `role="switch"` named by its label).
- Produces: `fakeProvider: Provider<FakeSettings, FakeCredentials, FakeConfig> & { id: 'fake' }` with `settings.key === 'fake'` and `credentials.keys === ['apiKey']`; `FakeSettings`, `FAKE_DEFAULTS`, `migrateFakeSettings`; `FakeScriptName`, `FAKE_SCRIPT_NAMES`, `fakeScript(name)`; `FakeSettingsView`.

- [ ] **Step 1: Write the failing tests**

Create `src/providers/fake/provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { fakeProvider } from './provider';
import { FAKE_SCRIPT_NAMES, fakeScript } from './scripts';
import { FAKE_DEFAULTS, migrateFakeSettings, type FakeSettings } from './settings';

const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const shared: SharedSettings = { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } };
const noAuth = { signedIn: false, getToken: async () => null };
const settings = (patch: Partial<FakeSettings> = {}): FakeSettings => ({ ...FAKE_DEFAULTS, ...patch });

describe('the fake provider', () => {
  it('shows no credential field by default, and reads without one', () => {
    expect(fakeProvider.credentials.fields(settings())).toEqual([]);
    expect(fakeProvider.credentials.read({}, noAuth)).not.toHaveProperty('missing');
  });

  it('asks for a key when requireKey is on, and reports it missing while empty', () => {
    expect(fakeProvider.credentials.fields(settings({ requireKey: true }))).toEqual([
      { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
    ]);
    expect(fakeProvider.credentials.read({ apiKey: '' }, noAuth)).toHaveProperty('missing');
    expect(fakeProvider.credentials.read({ apiKey: 'anything' }, noAuth)).not.toHaveProperty('missing');
  });

  it('lists every field it can show among its credential keys', () => {
    const shown = fakeProvider.credentials.fields(settings({ requireKey: true })).map((f) => f.key);
    for (const key of shown) expect(fakeProvider.credentials.keys).toContain(key);
  });

  it('is ready unless checkFails is on', async () => {
    await expect(fakeProvider.check({}, settings())).resolves.toEqual({ ok: true });
    await expect(fakeProvider.check({}, settings({ checkFails: true }))).resolves.toMatchObject({ ok: false });
  });

  it('refuses to build when buildRefused is on', () => {
    expect(fakeProvider.build(context, settings({ buildRefused: true }), shared)).toHaveProperty('refused');
  });

  it('builds the chosen script and passes the fault knobs, leaving zero-valued ones unset', () => {
    expect(fakeProvider.build(context, settings({ script: 'cjk', startThrows: true, failAfterMs: 2000 }), shared)).toEqual({
      script: fakeScript('cjk'),
      faults: { startThrows: expect.any(String), startDelayMs: undefined, failAfterMs: 2000 },
    });
  });

  it('offers AUTO as a source, never as a target, and never a source as its own target', () => {
    const s = settings();
    expect(fakeProvider.languages.sources(s).map((o) => o.value)).toEqual([AUTO, 'en', 'ja', 'zh']);
    expect(fakeProvider.languages.targets(AUTO, s).map((o) => o.value)).toEqual(['en', 'ja', 'zh']);
    expect(fakeProvider.languages.targets('ja', s).map((o) => o.value)).toEqual(['en', 'zh']);
  });

  it('offers both turn modes and cuts at its own boundaries', () => {
    expect(fakeProvider.turns(settings())).toEqual(['auto', 'manual']);
    expect(fakeProvider.boundaries(settings())).toBe('provider');
  });

  it('plays what it built: the first source segment opens on the clock', async () => {
    const built = fakeProvider.build(context, settings(), shared);
    if ('refused' in built) throw new Error(built.refused);
    const clock = createVirtualClock();
    const { events, log } = recordEvents();
    await fakeProvider.start({ context, config: built, credentials: {}, clock, signal: new AbortController().signal }, events);
    expect(log).toEqual([]);
    clock.advance(500);
    expect(log[0]).toEqual({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'x1' } });
  });

  it('has a script for every name in the catalogue', () => {
    for (const name of FAKE_SCRIPT_NAMES) expect(fakeScript(name).blocks.length).toBeGreaterThan(0);
  });
});

describe('migrateFakeSettings', () => {
  it('keeps valid stored values', () => {
    // A literal, not a `FakeSettings`: an interface type has no index signature, so it would not pass as a stored record.
    const stored = { ...FAKE_DEFAULTS, script: 'long', checkFails: true, startDelayMs: 300 };
    expect(migrateFakeSettings(stored)).toEqual(stored);
  });

  it('replaces an unknown script, a non-boolean flag and a bad number with their defaults', () => {
    expect(migrateFakeSettings({ ...FAKE_DEFAULTS, script: 'gone', requireKey: 'yes', failAfterMs: -1, startDelayMs: Number.NaN }))
      .toEqual(FAKE_DEFAULTS);
  });
});
```

Create `src/providers/fake/FakeSettingsView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FakeSettingsView } from './FakeSettingsView';
import { FAKE_DEFAULTS } from './settings';

describe('FakeSettingsView', () => {
  it('chooses a script', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={FAKE_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'long' } });
    expect(update).toHaveBeenCalledWith({ script: 'long' });
  });

  it('flips each fault switch', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={{ ...FAKE_DEFAULTS, checkFails: true }} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Require an API key' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Check reports not ready' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Refuse to build' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Fail to start' }));
    expect(update.mock.calls).toEqual([
      [{ requireKey: true }], [{ checkFails: false }], [{ buildRefused: true }], [{ startThrows: true }],
    ]);
  });

  it('reads a delay as whole, non-negative milliseconds', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={FAKE_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('Start delay (ms)'), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText('Fail after (ms, 0 = never)'), { target: { value: '1500.4' } });
    expect(update.mock.calls).toEqual([[{ startDelayMs: 0 }], [{ failAfterMs: 1500 }]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/fake/provider.test.ts src/providers/fake/FakeSettingsView.test.tsx`
Expected: FAIL — `Failed to resolve import "./provider"` and `"./FakeSettingsView"`.

- [ ] **Step 3: Write the script catalogue and the settings**

Create `src/providers/fake/scripts.ts`:

```ts
import { longScript } from './generate';
import { exchange, type FakeScript } from './script';

export type FakeScriptName = 'exchange' | 'cjk' | 'rewrite' | 'long';

/** In the order the fake's settings list them. */
export const FAKE_SCRIPT_NAMES: readonly FakeScriptName[] = ['exchange', 'cjk', 'rewrite', 'long'];

/** The scripts the fake can play (spec: "Testing" — script playback and the shape knobs). */
export function fakeScript(name: FakeScriptName): FakeScript {
  switch (name) {
    case 'exchange':
      // Two English → Japanese exchanges with stated origins and ranged audio.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello, how are', 'Hello, how are you?'], translation: 'こんにちは、お元気ですか？', origin: 'x1', audioChunks: 3 }),
          exchange({ startAt: 5000, ref: 3, source: ['I am fine.', 'I am fine. Thank you.'], translation: '元気です。ありがとう。', origin: 'x2', audioChunks: 2 }),
        ],
      };
    case 'cjk':
      // Several sentences with no spaces between them, so rows must tile the text.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['今日は', '今日は天気がいいですね。公園に行きましょう。'], translation: '今天天气很好。我们去公园吧。', origin: 'c1', audioChunks: 2 }),
        ],
      };
    case 'rewrite':
      // The second partial changes letters rather than growing; the translation
      // has no terminal punctuation, so punctuation fill-in runs.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['I scream', 'Ice cream'], translation: 'アイスクリーム', origin: 'r1', audioChunks: 1 }),
        ],
      };
    case 'long':
      // Enough segments to load the projection.
      return longScript(500, 3000);
  }
}
```

Create `src/providers/fake/settings.ts`:

```ts
import { FAKE_SCRIPT_NAMES, type FakeScriptName } from './scripts';

/** The fake's settings: which script plays, and the fault knobs (spec: "Testing", D24). */
export interface FakeSettings {
  script: FakeScriptName;
  /** Shows an API key field; `read` reports it missing until something is typed. */
  requireKey: boolean;
  /** `check` answers not ready. */
  checkFails: boolean;
  /** `build` refuses. */
  buildRefused: boolean;
  /** `start` rejects. */
  startThrows: boolean;
  /** `start` waits this long, in ms, before the session opens. */
  startDelayMs: number;
  /** The session fails this long after it starts, in ms; 0 = never. */
  failAfterMs: number;
}

export const FAKE_DEFAULTS: FakeSettings = {
  script: 'exchange',
  requireKey: false,
  checkFails: false,
  buildRefused: false,
  startThrows: false,
  startDelayMs: 0,
  failAfterMs: 0,
};

/** What was stored, made valid: an unknown script, a non-boolean flag or a bad number falls back to its default. */
export function migrateFakeSettings(stored: Readonly<Record<string, unknown>>): FakeSettings {
  const flag = (key: 'requireKey' | 'checkFails' | 'buildRefused' | 'startThrows'): boolean => {
    const value = stored[key];
    return typeof value === 'boolean' ? value : FAKE_DEFAULTS[key];
  };
  const ms = (key: 'startDelayMs' | 'failAfterMs'): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : FAKE_DEFAULTS[key];
  };
  return {
    script: FAKE_SCRIPT_NAMES.find((name) => name === stored.script) ?? FAKE_DEFAULTS.script,
    requireKey: flag('requireKey'),
    checkFails: flag('checkFails'),
    buildRefused: flag('buildRefused'),
    startThrows: flag('startThrows'),
    startDelayMs: ms('startDelayMs'),
    failAfterMs: ms('failAfterMs'),
  };
}
```

- [ ] **Step 4: Write the settings view**

Its markup copies `ProviderSpecificSettings.tsx`: a `settings-section` with an `h2`, and one `setting-item` per control, labelled with `<label className="setting-label" htmlFor=…>` (the `transcript-keywords` item there).

Create `src/providers/fake/FakeSettingsView.tsx`:

```tsx
import ToggleSwitch from '../../components/Settings/shared/ToggleSwitch';
import type { SettingsProps } from '../../lib/provider/types';
import { FAKE_SCRIPT_NAMES, type FakeScriptName } from './scripts';
import type { FakeSettings } from './settings';

type Flag = 'requireKey' | 'checkFails' | 'buildRefused' | 'startThrows';

const FLAGS: ReadonlyArray<{ key: Flag; label: string }> = [
  { key: 'requireKey', label: 'Require an API key' },
  { key: 'checkFails', label: 'Check reports not ready' },
  { key: 'buildRefused', label: 'Refuse to build' },
  { key: 'startThrows', label: 'Fail to start' },
];

/** Whole, non-negative milliseconds from an input's text; anything else is 0. */
function toMs(text: string): number {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The fake's own settings: which script plays, and its fault knobs (D24). The
 * fake exists in development builds only, so this copy is not localized.
 */
export function FakeSettingsView({ settings, update }: SettingsProps<FakeSettings>) {
  return (
    <div className="settings-section">
      <h2>Fake provider</h2>
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-script"><span>Script</span></label>
        <select
          id="fake-script"
          className="select-dropdown"
          value={settings.script}
          onChange={(e) => update({ script: e.target.value as FakeScriptName })}
        >
          {FAKE_SCRIPT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      {FLAGS.map(({ key, label }) => (
        <div className="setting-item" key={key}>
          <ToggleSwitch
            checked={settings[key]}
            onChange={() => update({ [key]: !settings[key] } as Partial<FakeSettings>)}
            label={label}
          />
        </div>
      ))}
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-start-delay"><span>Start delay (ms)</span></label>
        <input
          id="fake-start-delay"
          className="settings-input"
          type="number"
          min={0}
          step={100}
          value={settings.startDelayMs}
          onChange={(e) => update({ startDelayMs: toMs(e.target.value) })}
        />
      </div>
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-fail-after"><span>Fail after (ms, 0 = never)</span></label>
        <input
          id="fake-fail-after"
          className="settings-input"
          type="number"
          min={0}
          step={1000}
          value={settings.failAfterMs}
          onChange={(e) => update({ failAfterMs: toMs(e.target.value) })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the definition, and correct the stale adapter comment**

Create `src/providers/fake/provider.ts`:

```ts
import { FlaskConical } from 'lucide-react';
import { AUTO } from '../../lib/provider/languages';
import type { LanguageOption, Provider } from '../../lib/provider/types';
import { createFakeAdapter, type FakeConfig, type FakeCredentials } from './adapter';
import { FakeSettingsView } from './FakeSettingsView';
import { fakeScript } from './scripts';
import { FAKE_DEFAULTS, migrateFakeSettings, type FakeSettings } from './settings';

const LANGUAGES: readonly LanguageOption[] = [
  { value: 'en', name: 'English', englishName: 'English' },
  { value: 'ja', name: '日本語', englishName: 'Japanese' },
  { value: 'zh', name: '中文', englishName: 'Chinese' },
];

const adapter = createFakeAdapter();

/**
 * The fake provider (D24): a real definition, compiled into development builds
 * only, whose adapter plays a timed script. Its settings pick the script and
 * turn faults on, so every generic path — credentials, readiness, a refused
 * build, a failing start — can be driven without a network or a model.
 */
export const fakeProvider: Provider<FakeSettings, FakeCredentials, FakeConfig> & { id: 'fake' } = {
  id: 'fake',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: FlaskConical,
  vendor: 'Sokuji',

  settings: { key: 'fake', defaults: FAKE_DEFAULTS, migrate: migrateFakeSettings },
  Settings: FakeSettingsView,

  credentials: {
    keys: ['apiKey'],
    fields: (s) => (s.requireKey ? [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true }] : []),
    // `values` holds exactly the fields shown: nothing at all unless requireKey is on.
    read: (values) => (values.apiKey === '' ? { missing: 'Type any key: the fake accepts anything.' } : {}),
  },
  check: async (_k, s) => (s.checkFails ? { ok: false, reason: 'The fake reports not ready (fault knob).' } : { ok: true }),

  languages: {
    sources: () => [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...LANGUAGES],
    targets: (source) => LANGUAGES.filter((l) => l.value !== source),
  },

  speech: 'optional',
  textInput: true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: (_context, s) => (s.buildRefused
    ? { refused: 'The fake refuses to build (fault knob).' }
    : {
        script: fakeScript(s.script),
        faults: {
          startThrows: s.startThrows ? 'The fake failed to start (fault knob).' : undefined,
          startDelayMs: s.startDelayMs || undefined,
          failAfterMs: s.failAfterMs || undefined,
        },
      }),
  describe: () => ({ asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' }),
  start: adapter.start,
};
```

In `src/providers/fake/adapter.ts`, replace the comment line above `const TEXT_REF_BASE = 1000;` —

```ts
/** Refs minted for `appendText` start here, above any script ref. */
```

— with (this is the roadmap's carried item for plan 1b; `FakeSession`'s constructor already starts at `Math.max(TEXT_REF_BASE, maxRef(script) + 1)`):

```ts
/** The lowest ref minted for `appendText`; a script whose refs reach it moves the first one past its largest ref. */
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/providers/fake`
Expected: PASS — the two new files (15 tests) plus plan 1a's `adapter.test.ts` and `spine.e2e.test.ts`, unchanged.

- [ ] **Step 7: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/providers/fake
git commit -F - <<'EOF'
feat(fake): the fake as a registered provider definition

Its settings choose the script and turn on the fault knobs D24 names:
a required key, a failing check, a refused build, a failing start, a
start delay and a failure after N ms.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 3: The registry, presence and `VITE_ENABLED_PROVIDERS`

**Files:**
- Create: `src/lib/provider/presence.ts`
- Create: `src/providers/registry.ts`
- Modify: `src/utils/environment.ts` (add `enabledProviderIds` after `isLocalNativeEnabled`)
- Modify: `src/vite-env.d.ts`
- Modify: `extension/vite.config.ts` (the `define` block)
- Modify: `.github/workflows/build.yml` (every build env block)
- Modify: `.env.example`
- Modify: `src/utils/featureGateForwarding.consistency.test.ts`
- Test: `src/lib/provider/presence.test.ts`
- Test: `src/providers/registry.test.ts`
- Test: `src/utils/environment.test.ts` (append one `describe`)

**Interfaces:**
- Consumes: Task 1's types, `AUTO`; Task 2's `fakeProvider`; `getEnvironment(): 'electron' | 'extension' | 'web'` and `isDevelopmentMode(): boolean` from `src/utils/environment.ts`.
- Produces: `enabledProviderIds(): ReadonlySet<string>`; `PresenceEnv { platform: Platform; dev: boolean; enabled: ReadonlySet<string> }`; `isPresent(p, env): boolean`; `PROVIDERS: readonly AnyProvider[]`; `type ProviderId` (`'fake'` for now); `currentPresenceEnv(): PresenceEnv`; `presentProviders(env?): readonly AnyProvider[]`; `getProvider(id: string): AnyProvider | undefined`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/provider/presence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPresent, type PresenceEnv } from './presence';

const release = (platform: PresenceEnv['platform'], enabled: string[] = []): PresenceEnv =>
  ({ platform, dev: false, enabled: new Set(enabled) });

const plain = { id: 'plain', platforms: ['electron', 'extension'] as const };
const gated = { id: 'gated', platforms: ['electron'] as const, flagged: true as const };

describe('isPresent', () => {
  it('offers a provider on its platforms only', () => {
    expect(isPresent(plain, release('electron'))).toBe(true);
    expect(isPresent(plain, release('web'))).toBe(false);
  });

  it('hides a flagged provider in a release build unless the release lists it', () => {
    expect(isPresent(gated, release('electron'))).toBe(false);
    expect(isPresent(gated, release('electron', ['other']))).toBe(false);
    expect(isPresent(gated, release('electron', ['gated']))).toBe(true);
  });

  it('offers every flagged provider in a development build', () => {
    expect(isPresent(gated, { platform: 'electron', dev: true, enabled: new Set() })).toBe(true);
  });

  it('never offers a provider off its platforms, listed or not', () => {
    expect(isPresent(gated, { platform: 'web', dev: true, enabled: new Set(['gated']) })).toBe(false);
  });
});
```

Create `src/providers/registry.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AUTO } from '../lib/provider/languages';
import { fakeProvider } from './fake/provider';
import { PROVIDERS, getProvider, presentProviders } from './registry';

/** The keys the language pair persists under, beside every provider's settings. */
const PAIR_KEYS = ['sourceLanguage', 'targetLanguage'];

describe('the registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('has unique ids and unique settings keys', () => {
    const ids = PROVIDERS.map((p) => p.id);
    const keys = PROVIDERS.map((p) => p.settings.key);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps settings fields, credential keys and the language pair apart, since all share one storage prefix', () => {
    for (const p of PROVIDERS) {
      const fields = Object.keys(p.settings.defaults as object);
      for (const key of PAIR_KEYS) expect(fields, p.id).not.toContain(key);
      for (const key of p.credentials.keys) {
        expect(fields, p.id).not.toContain(key);
        expect(PAIR_KEYS, p.id).not.toContain(key);
      }
    }
  });

  it('lists every credential field its default settings show among its credential keys', () => {
    for (const p of PROVIDERS) {
      for (const field of p.credentials.fields(p.settings.defaults)) expect(p.credentials.keys, p.id).toContain(field.key);
    }
  });

  it('offers a source, a target for every source, and never AUTO as a target', () => {
    for (const p of PROVIDERS) {
      const s = p.settings.defaults;
      const sources = p.languages.sources(s);
      expect(sources.length, p.id).toBeGreaterThan(0);
      for (const source of sources) {
        const targets = p.languages.targets(source.value, s);
        expect(targets.length, `${p.id} ${source.value}`).toBeGreaterThan(0);
        expect(targets.map((t) => t.value), `${p.id} ${source.value}`).not.toContain(AUTO);
      }
    }
  });

  it('offers at least one turn mode', () => {
    for (const p of PROVIDERS) expect(p.turns(p.settings.defaults).length, p.id).toBeGreaterThan(0);
  });

  it('includes the fake in development builds, on every platform', () => {
    expect(getProvider('fake')).toBe(fakeProvider);
    for (const platform of ['electron', 'extension', 'web'] as const) {
      expect(presentProviders({ platform, dev: true, enabled: new Set() }).map((p) => p.id)).toContain('fake');
    }
  });

  it('leaves the fake out of release builds', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const released = await import('./registry');
    expect(released.PROVIDERS.map((p) => p.id)).not.toContain('fake');
  });
});
```

Append to `src/utils/environment.test.ts` — add `enabledProviderIds` to the file's existing import from `./environment` (and `afterEach`, `vi` to its vitest import if they are not there), then add at the end of the file:

```ts
describe('enabledProviderIds', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads a comma-separated list, ignoring spaces and empty items', () => {
    vi.stubEnv('VITE_ENABLED_PROVIDERS', ' palabra_ai, local_native ,,');
    expect([...enabledProviderIds()]).toEqual(['palabra_ai', 'local_native']);
  });

  it('is empty when nothing is listed', () => {
    vi.stubEnv('VITE_ENABLED_PROVIDERS', '');
    expect(enabledProviderIds().size).toBe(0);
  });
});
```

In `src/utils/featureGateForwarding.consistency.test.ts`, make the gate derivation also find `VITE_ENABLED_PROVIDERS` (its name has `D_` where the other gates have `_`, so today's regex skips it silently). Replace

```ts
  const found = source.match(/import\.meta\.env\.(VITE_ENABLE_[A-Z0-9_]+)/g) ?? [];
```

with

```ts
  // `VITE_ENABLED_PROVIDERS` is a list, not a boolean, but it has to reach the
  // same builds; spelled `ENABLED_`, it needs its own alternative here.
  const found = source.match(/import\.meta\.env\.(VITE_ENABLE(?:_[A-Z0-9_]+|D_PROVIDERS))/g) ?? [];
```

and in the test `'finds the gates environment.ts reads'` add after the existing `toContain` line:

```ts
    expect(GATES).toContain('VITE_ENABLED_PROVIDERS');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/provider/presence.test.ts src/providers/registry.test.ts src/utils/environment.test.ts src/utils/featureGateForwarding.consistency.test.ts`
Expected: FAIL — `presence` and `registry` do not resolve; `enabledProviderIds` is not exported; the consistency test fails `expect(GATES).toContain('VITE_ENABLED_PROVIDERS')`.

- [ ] **Step 3: Read the list from the environment**

In `src/utils/environment.ts`, directly after the `isLocalNativeEnabled` function, add:

```ts
/**
 * The flagged providers a release offers (D19): `VITE_ENABLED_PROVIDERS`, a
 * comma-separated list of provider ids. It gates providers in the new
 * registry (`src/providers/registry.ts`) only; the per-provider gates above
 * keep gating `ProviderConfigFactory` until those providers move over.
 * Development builds offer every flagged provider regardless (see
 * `isPresent`).
 */
export function enabledProviderIds(): ReadonlySet<string> {
  const raw = import.meta.env.VITE_ENABLED_PROVIDERS ?? '';
  return new Set(raw.split(',').map((id) => id.trim()).filter((id) => id !== ''));
}
```

In `src/vite-env.d.ts`, add inside `interface ImportMetaEnv`, after `VITE_ENABLE_LOCAL_NATIVE`:

```ts
  /** Comma-separated ids of the flagged providers a release offers (D19). */
  readonly VITE_ENABLED_PROVIDERS?: string;
```

- [ ] **Step 4: Forward it to every build**

In `extension/vite.config.ts`, inside `define`, directly after the `'import.meta.env.VITE_ENABLE_VOLCENGINE_AST2'` entry, add:

```ts
      // The flagged providers a release offers (D19), one comma-separated
      // list. Dev builds offer every flagged provider in code, so there is no
      // dev override here.
      'import.meta.env.VITE_ENABLED_PROVIDERS': JSON.stringify(
        envVal('VITE_ENABLED_PROVIDERS', '')
      ),
```

In `.github/workflows/build.yml`, every env block that builds the app has a `VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}` line (five blocks today). Directly after each of them add a line at the same indentation:

```yaml
          VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
```

A one-liner that does it and a check that the counts agree:

```bash
sed -i -E 's/^( +)VITE_ENABLE_LOCAL_NATIVE: \$\{\{ vars\.VITE_ENABLE_LOCAL_NATIVE \}\}$/&\n\1VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}/' .github/workflows/build.yml
grep -c 'VITE_ENABLED_PROVIDERS:' .github/workflows/build.yml   # must equal the next count
grep -c 'VITE_BACKEND_URL:' .github/workflows/build.yml
```

The repository variable is left unset: no flagged provider is in the new registry yet, and an unset variable reads as an empty list.

In `.env.example`, after the `VITE_ENABLE_KIZUNA_VOLCENGINE_AST2=false` line, add:

```
# Flagged providers in the new provider registry that a release offers, by id,
# comma-separated (development builds offer all of them). Empty: none.
VITE_ENABLED_PROVIDERS=
```

- [ ] **Step 5: Write presence and the registry**

Create `src/lib/provider/presence.ts`:

```ts
import type { Platform, Provider } from './types';

export interface PresenceEnv {
  platform: Platform;
  /** A development build, which offers every flagged provider. */
  dev: boolean;
  /** `VITE_ENABLED_PROVIDERS`. */
  enabled: ReadonlySet<string>;
}

/**
 * Whether a provider is offered here (D19): only on its platforms, and when
 * flagged only in a development build or when the release lists its id.
 */
export function isPresent(
  p: Pick<Provider<unknown, unknown, unknown>, 'id' | 'platforms' | 'flagged'>,
  env: PresenceEnv,
): boolean {
  if (!p.platforms.includes(env.platform)) return false;
  return !p.flagged || env.dev || env.enabled.has(p.id);
}
```

Create `src/providers/registry.ts`:

```ts
/**
 * The providers, in UI order (D19). One list: its order is the order the
 * picker shows, `ProviderId` is derived from it, and `isPresent` decides what
 * this build and platform offer.
 */
import { isPresent, type PresenceEnv } from '../lib/provider/presence';
import type { AnyProvider } from '../lib/provider/types';
import { enabledProviderIds, getEnvironment, isDevelopmentMode } from '../utils/environment';
import { fakeProvider } from './fake/provider';

/** Shipped providers, in UI order. Plan 1e adds LocalInference here first. */
const RELEASED = [] as const;
/** Compiled into development builds only (D24). */
const DEV_ONLY = [fakeProvider] as const;

export type ProviderId = (typeof RELEASED)[number]['id'] | (typeof DEV_ONLY)[number]['id'];

// `import.meta.env.DEV` itself, not `isDevelopmentMode()`: the literal is what
// a release build replaces with `false`, which drops the fake from the bundle.
export const PROVIDERS: readonly AnyProvider[] = import.meta.env.DEV ? [...RELEASED, ...DEV_ONLY] : [...RELEASED];

export function currentPresenceEnv(): PresenceEnv {
  return { platform: getEnvironment(), dev: isDevelopmentMode(), enabled: enabledProviderIds() };
}

/** The providers offered here, in UI order. */
export function presentProviders(env: PresenceEnv = currentPresenceEnv()): readonly AnyProvider[] {
  return PROVIDERS.filter((p) => isPresent(p, env));
}

export function getProvider(id: string): AnyProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/provider/presence.test.ts src/providers/registry.test.ts src/utils/environment.test.ts src/utils/featureGateForwarding.consistency.test.ts`
Expected: PASS — including the consistency test's per-block checks, which now also require `VITE_ENABLED_PROVIDERS` in `extension/vite.config.ts` and in every build env block, read from `vars.`.

- [ ] **Step 7: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/lib/provider/presence.ts src/lib/provider/presence.test.ts src/providers/registry.ts src/providers/registry.test.ts \
  src/utils/environment.ts src/utils/environment.test.ts src/vite-env.d.ts extension/vite.config.ts \
  .github/workflows/build.yml .env.example src/utils/featureGateForwarding.consistency.test.ts
git commit -F - <<'EOF'
feat(provider): the registry, presence and VITE_ENABLED_PROVIDERS

One ordered list is the registry (D19); the fake is compiled into
development builds only (D24). Flagged providers in it are offered in a
release only when VITE_ENABLED_PROVIDERS lists them; the variable is
forwarded to the extension build and to every CI build step. The old
per-provider gates keep gating ProviderConfigFactory until 1e.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 4: The provider store — settings, credentials, language pair

**Files:**
- Create: `src/stores/providerStore.ts`
- Test: `src/stores/providerStore.test.ts`

**Interfaces:**
- Consumes: Task 1's `AnyProvider`, `CredentialValues`, `LanguagePair`, `normalizePair`; `ServiceFactory.getSettingsService()` (named export of `src/services/ServiceFactory.ts`; `getSetting<T>(key: string, defaultValue: T): Promise<T>`, never rejects); `persistSetting(key, value): Promise<boolean>` from `src/services/persistSetting.ts` (never rejects).
- Produces: `useProviderStore` (Zustand) with `entries: Readonly<Record<string, ProviderEntry>>`, `load(p): Promise<void>`, `updateSettings(p, patch: Readonly<Record<string, unknown>>): void`, `setCredential(p, key: string, value: string): void`, `setPair(p, pair: LanguagePair): void`; `ProviderEntry { settings: unknown; credentials: CredentialValues; pair: LanguagePair }`. Every action takes the provider object, not its id, so the store never imports the registry. Writing to a provider before `load` resolves throws `Provider "<id>" is not loaded`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/providerStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, LanguageOption } from '../lib/provider/types';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { useProviderStore } from './providerStore';

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });

interface ProbeSettings { region: 'us' | 'eu'; count: number; on: boolean }
/** Turning `on` stops offering fr, as a model choice can narrow a provider's languages. */
const langs = (s: ProbeSettings) => [opt('en'), opt('ja'), ...(s.on ? [] : [opt('fr')])];

const probe = {
  id: 'probe',
  kind: 'own-key',
  settings: { key: 'probe', defaults: { region: 'us', count: 1, on: false } satisfies ProbeSettings },
  credentials: {
    keys: ['apiKey', 'apiKeyEu'],
    fields: (s: ProbeSettings) => [{ key: s.region === 'eu' ? 'apiKeyEu' : 'apiKey', labelKey: 'k', secret: true }],
    read: () => ({}),
  },
  languages: {
    sources: (s: ProbeSettings) => langs(s),
    targets: (source: string, s: ProbeSettings) => langs(s).filter((o) => o.value !== source),
  },
} as unknown as AnyProvider;

const entry = () => useProviderStore.getState().entries.probe;

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {} });
});

describe('load', () => {
  it("reads each settings field at settings.<key>.<field>, with that field's default", async () => {
    stored.set('settings.probe.count', 7);
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.count', 1);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.on', false);
    expect(entry().settings).toEqual({ region: 'us', count: 7, on: false });
  });

  it('runs migrate over what was stored', async () => {
    const migrating = {
      ...probe,
      settings: { ...probe.settings, migrate: (s: Record<string, unknown>) => ({ ...s, count: Number(s.count) * 10 }) },
    } as AnyProvider;
    stored.set('settings.probe.count', 2);
    await useProviderStore.getState().load(migrating);
    expect(entry().settings).toMatchObject({ count: 20 });
  });

  it('reads credentials as strings under their own keys, apart from the settings', async () => {
    stored.set('settings.probe.apiKey', 'sk-1');
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.apiKey', '');
    expect(entry().credentials).toEqual({ apiKey: 'sk-1', apiKeyEu: '' });
    expect(entry().settings).not.toHaveProperty('apiKey');
  });

  it('keeps a stored pair the provider offers', async () => {
    stored.set('settings.probe.sourceLanguage', 'ja');
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'ja', target: 'fr' });
  });

  it('repairs a stored pair the provider does not offer', async () => {
    stored.set('settings.probe.sourceLanguage', 'xx');
    stored.set('settings.probe.targetLanguage', 'en');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('starts from the first source and its first target when nothing is stored', async () => {
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('does not overwrite a provider that is already loaded', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().updateSettings(probe, { count: 5 });
    await useProviderStore.getState().load(probe);
    expect(entry().settings).toMatchObject({ count: 5 });
  });
});

describe('writes', () => {
  it('merges a settings patch and persists each patched field', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().updateSettings(probe, { count: 3 });
    expect(entry().settings).toEqual({ region: 'us', count: 3, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.count', 3));
  });

  it('moves the pair when new settings stop offering it, and persists only what moved', async () => {
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'fr' });
    useProviderStore.getState().updateSettings(probe, { on: true });
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'ja'));
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.sourceLanguage', expect.anything());
  });

  it('saves a credential under its key without touching the settings', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setCredential(probe, 'apiKeyEu', 'eu-1');
    expect(entry().credentials.apiKeyEu).toBe('eu-1');
    expect(entry().settings).toEqual({ region: 'us', count: 1, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.apiKeyEu', 'eu-1'));
  });

  it('saves a new pair', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setPair(probe, { source: 'ja', target: 'en' });
    expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.probe.sourceLanguage', 'ja');
      expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'en');
    });
  });

  it('refuses writes to a provider that is not loaded', () => {
    expect(() => useProviderStore.getState().updateSettings(probe, { count: 2 })).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setCredential(probe, 'apiKey', 'x')).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setPair(probe, { source: 'en', target: 'ja' })).toThrow('Provider "probe" is not loaded');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/providerStore.test.ts`
Expected: FAIL — `Failed to resolve import "./providerStore"`.

- [ ] **Step 3: Write the store**

Create `src/stores/providerStore.ts`:

```ts
/**
 * One store for every provider in the new registry: its settings, its
 * credentials and its language pair, loaded and saved generically from its
 * definition (spec: "Settings belong to the provider", "Credentials are not
 * settings", "Languages are two functions"). Values persist under today's
 * `settings.<key>.<field>` keys, so no saved value moves.
 */
import { create } from 'zustand';
import { normalizePair } from '../lib/provider/languages';
import type { AnyProvider, CredentialValues, LanguagePair } from '../lib/provider/types';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

/** One provider's saved state. */
export interface ProviderEntry {
  /** The provider's `S`; generic code never looks inside. */
  settings: unknown;
  /** Every key in `credentials.keys`; '' where nothing is saved. */
  credentials: CredentialValues;
  pair: LanguagePair;
}

export interface ProviderStore {
  /** Loaded providers, by id; a provider is absent until `load` resolves. */
  entries: Readonly<Record<string, ProviderEntry>>;
  load(p: AnyProvider): Promise<void>;
  updateSettings(p: AnyProvider, patch: Readonly<Record<string, unknown>>): void;
  setCredential(p: AnyProvider, key: string, value: string): void;
  setPair(p: AnyProvider, pair: LanguagePair): void;
}

/** The pair persists beside the settings, under the field names every slice uses today. */
const SOURCE = 'sourceLanguage';
const TARGET = 'targetLanguage';

function storageKey(p: AnyProvider, field: string): string {
  return `settings.${p.settings.key}.${field}`;
}

export const useProviderStore = create<ProviderStore>()((set, get) => {
  /** Writing to a provider before `load` resolves is a bug in the caller. */
  const loaded = (p: AnyProvider): ProviderEntry => {
    const entry = get().entries[p.id];
    if (!entry) throw new Error(`Provider "${p.id}" is not loaded`);
    return entry;
  };
  const put = (p: AnyProvider, entry: ProviderEntry) => set((st) => ({ entries: { ...st.entries, [p.id]: entry } }));
  const persistPair = (p: AnyProvider, before: LanguagePair, after: LanguagePair) => {
    if (after.source !== before.source) void persistSetting(storageKey(p, SOURCE), after.source);
    if (after.target !== before.target) void persistSetting(storageKey(p, TARGET), after.target);
  };

  return {
    entries: {},

    async load(p) {
      const service = ServiceFactory.getSettingsService();
      const defaults = p.settings.defaults as Record<string, unknown>;
      const fields = Object.keys(defaults);
      // Every value is read with a default of its own type: getSetting returns
      // a stored string untouched only when the default is a string, and
      // JSON-parses it otherwise — a key "123456" would come back a number.
      const [values, secrets, source, target] = await Promise.all([
        Promise.all(fields.map((f) => service.getSetting<unknown>(storageKey(p, f), defaults[f]))),
        Promise.all(p.credentials.keys.map((k) => service.getSetting(storageKey(p, k), ''))),
        service.getSetting(storageKey(p, SOURCE), ''),
        service.getSetting(storageKey(p, TARGET), ''),
      ]);
      // A second load racing the first (a remounted panel) must not undo an
      // edit made after the first one landed.
      if (get().entries[p.id]) return;
      const stored = Object.fromEntries(fields.map((f, i) => [f, values[i]]));
      const settings = p.settings.migrate ? p.settings.migrate(stored) : stored;
      put(p, {
        settings,
        credentials: Object.fromEntries(p.credentials.keys.map((k, i) => [k, secrets[i]])),
        pair: normalizePair(p, settings, { source: source || undefined, target: target || undefined }),
      });
    },

    updateSettings(p, patch) {
      const entry = loaded(p);
      const settings = { ...(entry.settings as Record<string, unknown>), ...patch };
      // New settings can change the languages on offer; the pair follows.
      const pair = normalizePair(p, settings, entry.pair);
      put(p, { ...entry, settings, pair });
      for (const [field, value] of Object.entries(patch)) void persistSetting(storageKey(p, field), value);
      persistPair(p, entry.pair, pair);
    },

    setCredential(p, key, value) {
      const entry = loaded(p);
      put(p, { ...entry, credentials: { ...entry.credentials, [key]: value } });
      void persistSetting(storageKey(p, key), value);
    },

    setPair(p, pair) {
      const entry = loaded(p);
      const next = normalizePair(p, entry.settings, pair);
      put(p, { ...entry, pair: next });
      persistPair(p, entry.pair, next);
    },
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/stores/providerStore.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck, the console ledger, and commit**

Run the typecheck gate; expect exactly the three baseline lines. Then `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts` — expect PASS (the new store has no `console.*`).

```bash
git add src/stores/providerStore.ts src/stores/providerStore.test.ts
git commit -F - <<'EOF'
feat(provider): one store for every provider's settings, credentials and pair

Loads and saves any definition's settings, credentials and language pair
under today's settings.<key>.<field> keys, reading each value with a
default of its own type.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 5: Readiness

**Files:**
- Modify: `src/stores/providerStore.ts`
- Test: `src/stores/providerStore.readiness.test.ts`

**Interfaces:**
- Consumes: Task 4's store; Task 1's `AuthContext`, `ModelOption`, `CheckResult`; `reportError(scope, message, { cause })` and `describeCause(cause): string` from `src/lib/diagnostics/report.ts`.
- Produces: `type Readiness = { state: 'unknown' } | { state: 'checking' } | { state: 'ready'; models: readonly ModelOption[] } | { state: 'not-ready'; reason: string }`; `UNKNOWN: Readiness`; on the store, `readiness: Readonly<Record<string, Readiness>>` (absent = unknown) and `refreshReadiness(p, auth: AuthContext): Promise<Readiness>`. `updateSettings` and `setCredential` now reset that provider's readiness to unknown and drop the result of any check still running for it.

- [ ] **Step 1: Write the failing test**

Create `src/stores/providerStore.readiness.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, CheckResult, LanguageOption } from '../lib/provider/types';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// Fresh module per test: the store keeps its check bookkeeping at module scope.
let store: typeof import('./providerStore');
beforeEach(async () => {
  vi.resetModules();
  store = await import('./providerStore');
});

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });
const noAuth = { signedIn: false, getToken: async () => null };

function probe(kind: 'own-key' | 'local', check: (k: unknown, s: unknown) => Promise<CheckResult>): AnyProvider {
  return {
    id: 'probe',
    kind,
    settings: { key: 'probe', defaults: { mode: 'a' } },
    credentials: {
      keys: ['apiKey'],
      fields: () => [{ key: 'apiKey', labelKey: 'k', secret: true }],
      read: (values: Record<string, string>) => (values.apiKey ? { key: values.apiKey } : { missing: 'no key' }),
    },
    check,
    languages: { sources: () => [opt('en')], targets: () => [opt('ja')] },
  } as unknown as AnyProvider;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function loadedWithKey(p: AnyProvider, key = 'k1') {
  const s = store.useProviderStore.getState();
  await s.load(p);
  s.setCredential(p, 'apiKey', key);
}

const readiness = () => store.useProviderStore.getState().readiness.probe;

describe('refreshReadiness', () => {
  it('reports missing credentials without calling check', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await store.useProviderStore.getState().load(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'no key' });
    expect(check).not.toHaveBeenCalled();
  });

  it('is checking while the check runs, then ready with its models', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(readiness()).toEqual({ state: 'checking' });
    answer.resolve({ ok: true, models: [{ id: 'm2' }, { id: 'm1' }] });
    await expect(done).resolves.toEqual({ state: 'ready', models: [{ id: 'm2' }, { id: 'm1' }] });
    expect(readiness()).toEqual({ state: 'ready', models: [{ id: 'm2' }, { id: 'm1' }] });
  });

  it('passes what read returned, and the settings, to check', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p, 'sk-9');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledWith({ key: 'sk-9' }, { mode: 'a' });
  });

  it('records a refusal as not ready, with its reason', async () => {
    const p = probe('own-key', async () => ({ ok: false, reason: 'bad key' }));
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'bad key' });
  });

  it('shows a thrown check as not ready, and asks again next time', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => { throw new Error('offline'); });
    const p = probe('own-key', check);
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'offline' });
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps a network answer for the same inputs, and asks again when they change', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p, 'k1');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(1);
    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k2');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('asks a local engine every time, since its readiness changes as models download', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('local', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('lets the newest check win over an older one that finishes later', async () => {
    const first = deferred<CheckResult>();
    const second = deferred<CheckResult>();
    const answers = [first.promise, second.promise];
    const p = probe('local', () => answers.shift()!);
    await loadedWithKey(p);
    const a = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    const b = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    second.resolve({ ok: true });
    await b;
    first.resolve({ ok: false, reason: 'stale' });
    await a;
    expect(readiness()).toEqual({ state: 'ready', models: [] });
  });

  it('forgets readiness when a credential or setting changes, and drops the check that change outdated', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k2');
    expect(readiness()).toEqual({ state: 'unknown' });
    answer.resolve({ ok: true });
    await done;
    expect(readiness()).toEqual({ state: 'unknown' });
    store.useProviderStore.getState().updateSettings(p, { mode: 'b' });
    expect(readiness()).toEqual({ state: 'unknown' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/providerStore.readiness.test.ts`
Expected: FAIL — `refreshReadiness is not a function`.

- [ ] **Step 3: Add readiness to the store**

In `src/stores/providerStore.ts`:

Change the imports to:

```ts
import { create } from 'zustand';
import { describeCause, reportError } from '../lib/diagnostics/report';
import { normalizePair } from '../lib/provider/languages';
import type { AnyProvider, AuthContext, CredentialValues, LanguagePair, ModelOption } from '../lib/provider/types';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';
```

After the `ProviderEntry` interface, add:

```ts
/** Whether a provider can start now (spec: "Readiness is one check"). */
export type Readiness =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'ready'; models: readonly ModelOption[] }
  | { state: 'not-ready'; reason: string };

export const UNKNOWN: Readiness = { state: 'unknown' };
```

In the `ProviderStore` interface, add after `entries`:

```ts
  /** One readiness per provider, by id; absent means unknown. */
  readiness: Readonly<Record<string, Readiness>>;
```

and after `setPair`:

```ts
  /** Runs the provider's `check` on its saved settings and credentials, and records the answer. */
  refreshReadiness(p: AnyProvider, auth: AuthContext): Promise<Readiness>;
```

After `storageKey`, add the module-scope bookkeeping:

```ts
/** The latest check per provider: a check that finishes after a newer one began, or after its inputs changed, is dropped. */
const checkSeq = new Map<string, number>();
/** The last answer per network provider, with the inputs it answered. */
const lastAnswer = new Map<string, { inputs: string; readiness: Readiness }>();
```

Inside `create(...)`, after `persistPair`, add:

```ts
  const setReadiness = (p: AnyProvider, readiness: Readiness): Readiness => {
    set((st) => ({ readiness: { ...st.readiness, [p.id]: readiness } }));
    return readiness;
  };
  /** Starts a new check generation for `p`; whatever check is still running no longer counts. */
  const supersede = (p: AnyProvider): number => {
    const seq = (checkSeq.get(p.id) ?? 0) + 1;
    checkSeq.set(p.id, seq);
    return seq;
  };
  /** What `check` answered no longer describes these settings or credentials. */
  const forgetReadiness = (p: AnyProvider) => {
    supersede(p);
    setReadiness(p, UNKNOWN);
  };
```

Add `readiness: {},` after `entries: {},` in the returned object. At the end of `updateSettings` and of `setCredential` add:

```ts
      forgetReadiness(p);
```

And add the action after `setPair`:

```ts
    async refreshReadiness(p, auth) {
      const entry = loaded(p);
      const seq = supersede(p);
      // `read` receives exactly the fields these settings show.
      const values: CredentialValues = Object.fromEntries(
        p.credentials.fields(entry.settings).map((f) => [f.key, entry.credentials[f.key] ?? '']),
      );
      const credentials: unknown = p.credentials.read(values, auth);
      // `K` has no `missing` member (see Provider.credentials.read), so this tells the two apart.
      if (typeof credentials === 'object' && credentials !== null && 'missing' in credentials) {
        return setReadiness(p, { state: 'not-ready', reason: String((credentials as { missing: unknown }).missing) });
      }
      // A network check gives the same answer to the same inputs, so its answer
      // is kept; a local engine's readiness changes as models download.
      const inputs = JSON.stringify([entry.settings, values, auth.signedIn]);
      const kept = p.kind === 'local' ? undefined : lastAnswer.get(p.id);
      if (kept && kept.inputs === inputs) return setReadiness(p, kept.readiness);

      setReadiness(p, { state: 'checking' });
      let answer: Readiness;
      try {
        const result = await p.check(credentials, entry.settings);
        answer = result.ok ? { state: 'ready', models: result.models ?? [] } : { state: 'not-ready', reason: result.reason };
        if (p.kind !== 'local') lastAnswer.set(p.id, { inputs, readiness: answer });
      } catch (error) {
        // A check that threw did not find out; show it, never keep it.
        reportError('ProviderStore', `The readiness check for ${p.id} failed: ${describeCause(error)}`, { cause: error });
        answer = { state: 'not-ready', reason: describeCause(error) };
      }
      if (checkSeq.get(p.id) !== seq) return get().readiness[p.id] ?? UNKNOWN;
      return setReadiness(p, answer);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/providerStore.readiness.test.ts src/stores/providerStore.test.ts`
Expected: PASS, 9 + 12 tests.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts
git commit -F - <<'EOF'
feat(provider): one readiness state per provider, from its check

Missing credentials answer without a check; a network provider's answer
is kept for the same inputs, a local engine is asked every time; a newer
check, or a change to what was checked, drops an older answer.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 6: The credential form

**Files:**
- Create: `src/components/providers/CredentialForm.tsx`
- Test: `src/components/providers/CredentialForm.test.tsx`

**Interfaces:**
- Consumes: Task 1's `CredentialField`, `CredentialValues`; Task 5's `Readiness`.
- Produces: `CredentialForm` with props `{ fields: readonly CredentialField[]; values: CredentialValues; readiness: Readiness; onChange(key: string, value: string): void; onCheck(): void }`.

Markup copies `ProviderSection.tsx`'s multi-field credential groups (the Volcengine AST2 branch): each field is an `api-key-input-group` holding an `input.api-key-input` whose class gains `valid` / `invalid`; the `button.validate-button` sits in the last group and shows `span.spinner` while checking, `<CheckCircle size={16} />` when ready, the `simpleSettings.validate` label otherwise; a failure shows as `div.validation-message.error` (the panel's shared message line).

- [ ] **Step 1: Write the failing test**

Create `src/components/providers/CredentialForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CredentialField } from '../../lib/provider/types';
import { CredentialForm } from './CredentialForm';

// Every label resolves to its key, so the inputs are found by the i18n key their field names.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const appId: CredentialField = { key: 'appId', labelKey: 'setup.credentials.appId', secret: false };
const token: CredentialField = { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true };
const unknown = { state: 'unknown' } as const;

describe('CredentialForm', () => {
  it('draws one input per field, masking secrets, and reports typing by key', () => {
    const onChange = vi.fn();
    render(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: '' }} readiness={unknown} onChange={onChange} onCheck={vi.fn()} />);
    const id = screen.getByLabelText('setup.credentials.appId') as HTMLInputElement;
    const secret = screen.getByLabelText('setup.credentials.accessToken') as HTMLInputElement;
    expect(id.type).toBe('text');
    expect(id.value).toBe('a1');
    expect(secret.type).toBe('password');
    fireEvent.change(secret, { target: { value: 't1' } });
    expect(onChange).toHaveBeenCalledWith('accessToken', 't1');
  });

  it('puts the check beside the last field, enabled only once every field is filled', () => {
    const onCheck = vi.fn();
    const { rerender } = render(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: '' }} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    const groups = document.querySelectorAll('.api-key-input-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.validate-button')).toBeNull();
    const button = groups[1].querySelector('.validate-button') as HTMLButtonElement;
    expect(button).toBeDisabled();
    rerender(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: 't1' }} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('offers the check alone when the provider has no fields', () => {
    const onCheck = vi.fn();
    render(<CredentialForm fields={[]} values={{}} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('disables the check while it runs', () => {
    render(<CredentialForm fields={[]} values={{}} readiness={{ state: 'checking' }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('marks the inputs valid when ready', () => {
    render(<CredentialForm fields={[token]} values={{ accessToken: 't1' }} readiness={{ state: 'ready', models: [] }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByLabelText('setup.credentials.accessToken')).toHaveClass('api-key-input', 'valid');
  });

  it('marks the inputs invalid and shows the reason when not ready', () => {
    render(<CredentialForm fields={[token]} values={{ accessToken: 't1' }} readiness={{ state: 'not-ready', reason: 'bad key' }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByLabelText('setup.credentials.accessToken')).toHaveClass('api-key-input', 'invalid');
    expect(screen.getByText('bad key')).toHaveClass('validation-message', 'error');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/providers/CredentialForm.test.tsx`
Expected: FAIL — `Failed to resolve import "./CredentialForm"`.

- [ ] **Step 3: Write the component**

Create `src/components/providers/CredentialForm.tsx`:

```tsx
import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CredentialField, CredentialValues } from '../../lib/provider/types';
import type { Readiness } from '../../stores/providerStore';

interface CredentialFormProps {
  fields: readonly CredentialField[];
  values: CredentialValues;
  readiness: Readiness;
  onChange(key: string, value: string): void;
  onCheck(): void;
}

/**
 * Any provider's credential inputs, drawn from its `credentials.fields`, with
 * the readiness check beside the last one. The markup is ProviderSection's
 * multi-field credential groups.
 */
export function CredentialForm({ fields, values, readiness, onChange, onCheck }: CredentialFormProps) {
  const { t } = useTranslation();
  const checking = readiness.state === 'checking';
  const status = readiness.state === 'ready' ? 'valid' : readiness.state === 'not-ready' ? 'invalid' : '';
  const check = (
    <button
      type="button"
      className="validate-button"
      onClick={onCheck}
      disabled={checking || fields.some((f) => !values[f.key])}
      title={t('simpleSettings.validate')}
    >
      {checking ? <span className="spinner" /> : readiness.state === 'ready' ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
    </button>
  );

  return (
    <>
      {fields.length === 0 ? (
        <div className="api-key-input-group">{check}</div>
      ) : (
        fields.map((f, i) => (
          <div className="api-key-input-group" key={f.key}>
            <input
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              placeholder={t(f.placeholderKey ?? f.labelKey, f.key)}
              aria-label={t(f.labelKey, f.key)}
              className={`api-key-input ${status}`.trim()}
            />
            {i === fields.length - 1 && check}
          </div>
        ))
      )}
      {readiness.state === 'not-ready' && <div className="validation-message error">{readiness.reason}</div>}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/providers/CredentialForm.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/components/providers/CredentialForm.tsx src/components/providers/CredentialForm.test.tsx
git commit -F - <<'EOF'
feat(provider): one credential form for every provider

Drawn from credentials.fields(s), with the readiness check beside the
last field, in ProviderSection's credential markup.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 7: The language section

**Files:**
- Create: `src/components/providers/LanguagePairSection.tsx`
- Test: `src/components/providers/LanguagePairSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `AnyProvider`, `LanguagePair`, `AUTO`, `normalizePair`, `swapped`; Task 2's `fakeProvider` (test only).
- Produces: `LanguagePairSection` with props `{ provider: AnyProvider; settings: unknown; pair: LanguagePair; onChange(pair: LanguagePair): void }`. It emits only pairs the provider offers.

Markup copies `LanguageSection.tsx`'s translation-languages block: `div.config-section#languages-section` > `h3` (`<Languages size={18} />` + title) > `div.language-pair-row` > two `div.language-select-group` (a `label` and a `select.language-select`) around `div.language-arrow` > `button.language-swap-btn` (`<ArrowLeftRight size={18} />`). The `label`s gain `htmlFor` and the selects `id`s, so the controls are named.

- [ ] **Step 1: Write the failing test**

Create `src/components/providers/LanguagePairSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AUTO } from '../../lib/provider/languages';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { LanguagePairSection } from './LanguagePairSection';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const draw = (pair: { source: string; target: string }, onChange = vi.fn()) => {
  render(<LanguagePairSection provider={fakeProvider} settings={FAKE_DEFAULTS} pair={pair} onChange={onChange} />);
  return onChange;
};
const values = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => o.value);

describe('LanguagePairSection', () => {
  it("lists the provider's sources, and the targets of the chosen source", () => {
    draw({ source: 'en', target: 'ja' });
    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual([AUTO, 'en', 'ja', 'zh']);
    expect(values(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja', 'zh']);
  });

  it('names the AUTO source with the shared auto-detect label', () => {
    draw({ source: AUTO, target: 'en' });
    expect((screen.getByRole('option', { name: 'common.autoDetect' }) as HTMLOptionElement).value).toBe(AUTO);
  });

  it('moves the target when the new source does not offer it', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
  });

  it('keeps the target when the new source offers it', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'zh' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'zh', target: 'ja' });
  });

  it('changes the target', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.targetLanguage'), { target: { value: 'zh' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'en', target: 'zh' });
  });

  it('swaps a pair the provider supports in reverse', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.click(screen.getByTitle('simpleConfig.swapLanguages'));
    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
  });

  it('cannot swap an AUTO source', () => {
    draw({ source: AUTO, target: 'en' });
    expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/providers/LanguagePairSection.test.tsx`
Expected: FAIL — `Failed to resolve import "./LanguagePairSection"`.

- [ ] **Step 3: Write the component**

Create `src/components/providers/LanguagePairSection.tsx`:

```tsx
import { ArrowLeftRight, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO, normalizePair, swapped } from '../../lib/provider/languages';
import type { AnyProvider, LanguageOption, LanguagePair } from '../../lib/provider/types';

interface LanguagePairSectionProps {
  provider: AnyProvider;
  settings: unknown;
  pair: LanguagePair;
  onChange(pair: LanguagePair): void;
}

/**
 * Any provider's language pair (spec: "Languages are two functions"): the
 * lists are its `sources` and `targets`, and the swap is the generic one,
 * allowed whenever the provider supports the reversed pair. Markup is
 * LanguageSection's translation-languages block.
 */
export function LanguagePairSection({ provider, settings, pair, onChange }: LanguagePairSectionProps) {
  const { t } = useTranslation();
  const sources = provider.languages.sources(settings);
  const targets = provider.languages.targets(pair.source, settings);
  const reversed = swapped(provider, settings, pair);
  const option = (o: LanguageOption) => (
    <option key={o.value} value={o.value}>{o.value === AUTO ? t('common.autoDetect') : o.name}</option>
  );

  return (
    <div className="config-section" id="languages-section">
      <h3>
        <Languages size={18} />
        <span>{t('simpleConfig.translationLanguages')}</span>
      </h3>
      <div className="language-pair-row">
        <div className="language-select-group">
          <label htmlFor="language-pair-source">{t('settings.sourceLanguage')}</label>
          <select
            id="language-pair-source"
            className="language-select"
            value={pair.source}
            onChange={(e) => onChange(normalizePair(provider, settings, { source: e.target.value, target: pair.target }))}
          >
            {sources.map(option)}
          </select>
        </div>
        <div className="language-arrow">
          <button
            type="button"
            className="language-swap-btn"
            onClick={() => reversed && onChange(reversed)}
            disabled={!reversed}
            title={t('simpleConfig.swapLanguages')}
          >
            <ArrowLeftRight size={18} />
          </button>
        </div>
        <div className="language-select-group">
          <label htmlFor="language-pair-target">{t('settings.targetLanguage')}</label>
          <select
            id="language-pair-target"
            className="language-select"
            value={pair.target}
            onChange={(e) => onChange({ source: pair.source, target: e.target.value })}
          >
            {targets.map(option)}
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/providers/LanguagePairSection.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/components/providers/LanguagePairSection.tsx src/components/providers/LanguagePairSection.test.tsx
git commit -F - <<'EOF'
feat(provider): one language section for every provider

The lists are the provider's sources and targets; the swap is allowed
whenever the reversed pair is supported, so AUTO never swaps.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 8: The provider panel

**Files:**
- Create: `src/components/providers/ProviderPanel.tsx`
- Test: `src/components/providers/ProviderPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–5's `useProviderStore`, `UNKNOWN`; Tasks 6–7's components; Task 1's `AnyProvider`, `AuthContext`; Task 2's `fakeProvider` (test only).
- Produces: `ProviderPanel` with props `{ providers: readonly AnyProvider[]; auth: AuthContext }`. It loads the chosen provider on first show and draws, in order: the provider section (picker, credentials, readiness), the language section, then the provider's own `Settings`. The choice lives in the panel's state for now; plan 1e persists it under `settings.common.provider`.

Markup: the provider section copies `ProviderSection.tsx`'s outer block — `div.config-section.provider-section#provider-section` > `h3` (`<Cpu size={18} />` + `simpleSettings.provider`) > `div.provider-selection-area` > `select.select-dropdown.provider-select` with `aria-label`. Options are plain text (`providers.<id>.name`, falling back to the id); rich options come with the real panel in 1e.

- [ ] **Step 1: Write the failing test**

Create `src/components/providers/ProviderPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

import { fakeProvider } from '../../providers/fake/provider';
import { useProviderStore } from '../../stores/providerStore';
import { ProviderPanel } from './ProviderPanel';

const noAuth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {} });
});

describe('ProviderPanel', () => {
  it("loads the provider and shows its language pair and its own settings", async () => {
    stored.set('settings.fake.script', 'long');
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    expect(await screen.findByLabelText('Script')).toHaveValue('long');
    expect(screen.getByLabelText('settings.sourceLanguage')).toHaveValue('auto');
    expect(screen.getByLabelText('settings.targetLanguage')).toHaveValue('en');
    expect(screen.getByLabelText('simpleSettings.provider')).toHaveValue('fake');
  });

  it("saves the provider's own settings where they persist today", async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Refuse to build' }));
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.buildRefused', true));
  });

  it('shows a credential field when the settings ask for one, and saves what is typed', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Require an API key' }));
    fireEvent.change(await screen.findByLabelText('setup.credentials.apiKey'), { target: { value: 'k1' } });
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.apiKey', 'k1'));
  });

  it('runs the check and marks the credentials valid', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Require an API key' }));
    fireEvent.change(await screen.findByLabelText('setup.credentials.apiKey'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByTitle('simpleSettings.validate'));
    await waitFor(() => expect(screen.getByLabelText('setup.credentials.apiKey')).toHaveClass('valid'));
  });

  it("shows the check's reason when the provider is not ready", async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Check reports not ready' }));
    fireEvent.click(screen.getByTitle('simpleSettings.validate'));
    expect(await screen.findByText('The fake reports not ready (fault knob).')).toHaveClass('validation-message', 'error');
  });

  it('saves a new language pair', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.change(await screen.findByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.sourceLanguage', 'ja'));
  });

  it('draws nothing when no provider is offered', () => {
    const { container } = render(<ProviderPanel providers={[]} auth={noAuth} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/providers/ProviderPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./ProviderPanel"`.

- [ ] **Step 3: Write the panel**

Create `src/components/providers/ProviderPanel.tsx`:

```tsx
import { Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { UNKNOWN, useProviderStore } from '../../stores/providerStore';
import { CredentialForm } from './CredentialForm';
import { LanguagePairSection } from './LanguagePairSection';

interface ProviderPanelProps {
  providers: readonly AnyProvider[];
  auth: AuthContext;
}

/**
 * Every provider, drawn from its definition alone: the picker, its
 * credentials and readiness, its language pair, then its own `Settings`
 * component (D18). Nothing here names a provider.
 */
export function ProviderPanel({ providers, auth }: ProviderPanelProps) {
  const { t } = useTranslation();
  const [chosenId, setChosenId] = useState(providers[0]?.id);
  const provider = providers.find((p) => p.id === chosenId) ?? providers[0];
  const entry = useProviderStore((st) => (provider ? st.entries[provider.id] : undefined));
  const readiness = useProviderStore((st) => (provider ? st.readiness[provider.id] : undefined)) ?? UNKNOWN;
  const { load, updateSettings, setCredential, setPair, refreshReadiness } = useProviderStore.getState();

  useEffect(() => {
    if (provider && !entry) void load(provider);
  }, [provider, entry, load]);

  if (!provider) return null;
  const Settings = provider.Settings;

  return (
    <>
      <div className="config-section provider-section" id="provider-section">
        <h3>
          <Cpu size={18} />
          <span>{t('simpleSettings.provider')}</span>
        </h3>
        <div className="provider-selection-area">
          <select
            className="select-dropdown provider-select"
            value={provider.id}
            onChange={(e) => setChosenId(e.target.value)}
            aria-label={t('simpleSettings.provider')}
          >
            {providers.map((p) => <option key={p.id} value={p.id}>{t(`providers.${p.id}.name`, p.id)}</option>)}
          </select>
        </div>
        {entry && (
          <CredentialForm
            fields={provider.credentials.fields(entry.settings)}
            values={entry.credentials}
            readiness={readiness}
            onChange={(key, value) => setCredential(provider, key, value)}
            onCheck={() => void refreshReadiness(provider, auth)}
          />
        )}
      </div>
      {entry && (
        <>
          <LanguagePairSection provider={provider} settings={entry.settings} pair={entry.pair} onChange={(pair) => setPair(provider, pair)} />
          <Settings settings={entry.settings} update={(patch) => updateSettings(provider, patch)} />
        </>
      )}
    </>
  );
}
```

Note: with the test's `t: (key) => key` mock, `t('providers.fake.name', 'fake')` renders the key. The test reads the select's value, not its option text, so this does not matter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/providers/ProviderPanel.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/components/providers/ProviderPanel.tsx src/components/providers/ProviderPanel.test.tsx
git commit -F - <<'EOF'
feat(provider): a provider panel drawn from the definition alone

Picker, credentials and readiness, the language pair, then the
provider's own Settings component (D18).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

### Task 9: The development preview, and looking at it

**Files:**
- Create: `src/components/dev/SpinePreview.tsx`
- Modify: `src/App.tsx`
- Modify: `vite.config.ts` (the Electron `onstart` hook)
- Test: `src/components/dev/SpinePreview.test.tsx`

**Interfaces:**
- Consumes: Task 3's `presentProviders()`; Task 8's `ProviderPanel`; `useAuth()` from `src/lib/auth/hooks.ts` (`{ isSignedIn: boolean; getToken(): Promise<string | null>; … }`).
- Produces: `SpinePreview` — a development-only page reached with `?preview=spine`, where plans 1c and 1d will add a live session and the surfaces; `SOKUJI_DEV_NO_ELECTRON=1`, which makes the dev server serve the renderer without launching Electron (for headless Chromium, spec "Testing": "Rendering").

- [ ] **Step 1: Write the failing test**

Create `src/components/dev/SpinePreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: async () => null }),
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { SpinePreview } from './SpinePreview';

describe('SpinePreview', () => {
  it('shows the providers this build offers, starting with the fake', async () => {
    render(<SpinePreview />);
    expect(await screen.findByLabelText('Script')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/dev/SpinePreview.test.tsx`
Expected: FAIL — `Failed to resolve import "./SpinePreview"`.

- [ ] **Step 3: Write the preview and mount it**

Create `src/components/dev/SpinePreview.tsx`:

```tsx
import { useMemo } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import { presentProviders } from '../../providers/registry';
import { ProviderPanel } from '../providers/ProviderPanel';
import '../Settings/Settings.scss';

/**
 * Development builds only: the new provider layer on a page of its own, so it
 * can be looked at and screenshotted before plan 1e moves it into the
 * settings panel. Open the dev server at `/?preview=spine`.
 */
export function SpinePreview() {
  const { isSignedIn, getToken } = useAuth();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  const providers = useMemo(() => presentProviders(), []);
  return (
    <div className="settings-container">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} />
      </div>
    </div>
  );
}
```

In `src/App.tsx`, add the import beside the `NativeTtsProto` import:

```tsx
import { SpinePreview } from './components/dev/SpinePreview';
```

and inside `App()`, directly before its `return (`, add:

```tsx
  // Dev-only: `?preview=spine` shows the new provider layer alone (plans 1b–1d).
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'spine') {
    return (
      <div className="App">
        <SpinePreview />
      </div>
    );
  }
```

In `vite.config.ts`, change the Electron plugin's `onstart` hook from

```ts
          onstart(args) {
            // Override default [".", "--no-sandbox"] to fix DevTools crash on Linux
            args.startup(["."])
          },
```

to

```ts
          onstart(args) {
            // SOKUJI_DEV_NO_ELECTRON=1 serves the renderer alone, for headless
            // Chromium against `?preview=spine`, without opening a window.
            if (process.env.SOKUJI_DEV_NO_ELECTRON) return
            // Override default [".", "--no-sandbox"] to fix DevTools crash on Linux
            args.startup(["."])
          },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/dev/SpinePreview.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Render the preview and look at it**

Start the dev server without Electron, in the background:

```bash
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort
```

Wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:5199/` prints `200`. Prove the served app is current (a worktree's dev server can serve stale transforms): `curl -s http://localhost:5199/src/App.tsx | grep -c "SpinePreview"` must print a number ≥ 1 (comments do not survive the transform, so grep for code).

Screenshot the page at the default panel width and at the minimum one (`PANEL_MIN_WIDTH` = 300):

```bash
OUT="${CLAUDE_JOB_DIR:-/tmp}/spine-preview"; mkdir -p "$OUT"
CHROME=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1)
for W in 450 300; do
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=$W,1400 \
    --virtual-time-budget=8000 --screenshot="$OUT/spine-$W.png" 'http://localhost:5199/?preview=spine'
done
```

Open both PNGs and look at them. Expected: a dark page with, top to bottom, the provider section (a select showing the fake, and a lone validate button), the translation-languages row (a source select showing the auto-detect label, the swap button greyed out, a target select showing English), and the fake's section headed "Fake provider" with a Script select, four switches and two number inputs. At 300px nothing overflows horizontally. If a block renders unstyled, compare its wrapper chain with the real `Settings` panel's (`settings-container` > `settings-body` > sections) before changing any class name, and record what you found in your report.

Stop the dev server. Record both PNG paths in the report.

- [ ] **Step 6: Run everything, typecheck and commit**

Run: `npx vitest run src` — expect 0 failed (plus the 4 baseline unhandled rejections from `settingsStore.nativeGate.test.ts`).
Run the typecheck gate; expect exactly the three baseline lines.

```bash
git add src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx src/App.tsx vite.config.ts
git commit -F - <<'EOF'
feat(dev): a spine preview page for the new provider layer

?preview=spine in a development build shows the provider panel against
the registry; SOKUJI_DEV_NO_ELECTRON=1 serves the renderer without
launching Electron, so headless Chromium can render it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
EOF
```

---

## What this plan leaves to later plans

- **1c:** `SessionHooks` (`prepare`, `admit`, `acquire`, `startBoth`, `minimumBalance`) join `Provider` with the runner that calls them; the runner builds `SharedSettings` from the settings store and runs `check` at start through `refreshReadiness`.
- **1e:** the selected provider persists under `settings.common.provider`; the settings panel (`ProviderSection`, `LanguageSection`, `ProviderSpecificSettings`) and the setup wizard switch to the components here, with rich picker options and the `Engine` slot; LocalInference becomes `RELEASED`'s first member; `CLAUDE.md`'s "Adding a New AI Provider" checklist is rewritten for the registry.
- **Stage 2:** each flagged provider that moves into the registry is listed in the `VITE_ENABLED_PROVIDERS` repository variable at release, and its old `VITE_ENABLE_*` gate goes with its `ProviderConfigFactory` registration. The socket seam (`openSocket`, spec "Sockets that need upgrade headers") arrives with the first provider that needs upgrade headers.
