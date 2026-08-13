# MainPanel Seams S3 — planBothMode + reversesDirectionViaSourceLanguage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two sync descriptor methods replace MainPanel's (and LanguageSection's) last direct imports of Soniox/Gemini decision modules: `planBothMode` (Both-mode session shape; base `{shared:false, split:false}`) and `reversesDirectionViaSourceLanguage` (auto-source gating; base `false`).

**Architecture:** Stage S3 of the spec. `sonioxBothModePlan` stays a descriptor-imported sibling module (S2 pattern) but loses its `provider` parameter — the descriptor IS the dispatch now; its twin-resolution line dies the way S1's `kizunaBaseProvider` PTT normalization did. One pre-task breaks the would-be import cycle (`sonioxBothMode → SonioxProviderConfig` exists today for `sonioxUsesSharedBothSession`; the delegation adds the reverse edge). `autoSourceReversal.ts` is absorbed entirely (its whole body is manual provider dispatch) and deleted. A new fs-scan test pins the subtitle-window import-hygiene rule the spec promises.

**Tech Stack:** TypeScript, React, zustand, vitest 4.

## Global Constraints

- Repo/worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/soniox-tts-v2`, branch `refactor/mainpanel-provider-seams` (S1+S2 complete, HEAD ≈ `fc5e54ab`). Paths relative to root.
- **Zero behavior change.** Existing module tests are the oracle where logic moves; ported tests keep their assertions.
- Full suite green at every task end (`npx vitest run`, 2518 tests at stage start); `npx vite build` green at stages T4 and T5.
- Rationale comments move with the code (sonioxBothMode's header re-worded only where the provider param dies; the twin-409 story is preserved as a registry-test comment).
- Descriptors never import settingsStore. `sessionStartGate.ts` must keep exactly its three leaf imports — the new hygiene test enforces this.
- Locate edits by grepping quoted code. Commit per task. Do not push. Sweeps use `Provider\.[A-Z_]+` generically.

---

### Task 1: Break the cycle — move `sonioxUsesSharedBothSession` into `sonioxBothMode.ts`

**Files:**
- Modify: `src/services/providers/sonioxBothMode.ts` (gains the function; drops its SonioxProviderConfig import)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (function body removed; re-export added)

**Interfaces:**
- Produces: `sonioxUsesSharedBothSession` importable from `'./sonioxBothMode'`; still importable from `'./SonioxProviderConfig'` (re-export) for existing importers (ProviderSpecificSettings, tests).

- [ ] **Step 1: Move the function**

In `SonioxProviderConfig.ts`, locate `export function sonioxUsesSharedBothSession` (~L172-176) AND its full doc comment (the long "Does Both mode run on ONE shared Soniox session?" block above it). Cut both verbatim into `sonioxBothMode.ts`, placed above `sonioxBothModePlan`. Delete the now-unused import line `import { sonioxUsesSharedBothSession } from './SonioxProviderConfig';` from `sonioxBothMode.ts`.

- [ ] **Step 2: Re-export**

Where the function was in `SonioxProviderConfig.ts`:

```ts
// Moved into sonioxBothMode.ts (its main consumer) so that this class can
// import sonioxBothModePlan for the planBothMode override without a cycle;
// re-exported here so existing importers keep working.
export { sonioxUsesSharedBothSession } from './sonioxBothMode';
```

- [ ] **Step 3: Verify no cycle and run**

`grep -n "from './SonioxProviderConfig'" src/services/providers/sonioxBothMode.ts` → no hits.
Run: `npx vitest run src/services/providers/sonioxBothMode.test.ts` then `npx vitest run` — all pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/sonioxBothMode.ts src/services/providers/SonioxProviderConfig.ts
git commit -m "refactor(providers): move sonioxUsesSharedBothSession beside its main consumer

Breaks the would-be cycle before SonioxProviderConfig gains a
planBothMode override delegating to sonioxBothModePlan; re-exported so
existing importers keep working."
```

---

### Task 2: `planBothMode` seam — base, Soniox override, module de-dispatch

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts` (type + method + base)
- Modify: `src/services/providers/sonioxBothMode.ts` (drop the `provider` param and `isSoniox` check)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (override)
- Modify: `src/services/providers/sonioxBothMode.test.ts` (signature updates; the two dispatch tests migrate)
- Test: `src/services/providers/descriptorRegistry.test.ts` (invariants)

**Interfaces:**
- Produces:

```ts
// ProviderDescriptor.ts
export interface BothModePlan {
  /** One session, mic and system audio mixed. */
  shared: boolean;
  /** Two sessions, one per audio source. */
  split: boolean;
}

  /** Session shape for Both mode. Base: neither — one client per channel,
   *  the historical fall-through every non-Soniox provider runs today.
   *  `mode` is the effective AudioMode-shaped scope ('speaker' | 'participant'
   *  | 'both'). */
  planBothMode(slice: unknown, mode: string): BothModePlan;
```

- [ ] **Step 1: Write the failing registry invariants**

Append to `descriptorRegistry.test.ts`:

```ts
describe('S3 planBothMode', () => {
  it('is inert for every non-Soniox descriptor in every mode', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      if (id === Provider.SONIOX || id === Provider.KIZUNA_AI_SONIOX) continue;
      const d = ProviderConfigFactory.getDescriptor(id);
      for (const mode of ['speaker', 'participant', 'both']) {
        expect(d.planBothMode(DEFAULTS_BY_SLICE[d.settingsSliceKey], mode), `${id}/${mode}`)
          .toEqual({ shared: false, split: false });
      }
    }
  });

  it('the managed twin answers exactly like BYOK Soniox (the 409 twin bug, pinned at this layer)', () => {
    // Historically a raw `provider === Provider.SONIOX` dispatch was always
    // false for the twin, which opened two independent managed sessions and
    // had the second refused with a 409. Dispatch now lives in the registry:
    // the twin inherits the override by class extension, pinned here.
    const byok = ProviderConfigFactory.getDescriptor(Provider.SONIOX);
    const twin = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
    for (const settings of [
      { bothModeSharedSession: true, sourceLanguage: 'en' },
      { bothModeSharedSession: true, sourceLanguage: 'auto' },
      { bothModeSharedSession: false, sourceLanguage: 'en' },
      undefined,
    ]) {
      for (const mode of ['speaker', 'both']) {
        expect(twin.planBothMode(settings, mode), `${JSON.stringify(settings)}/${mode}`)
          .toEqual(byok.planBothMode(settings, mode));
      }
    }
  });

  it('Soniox Both mode: shared needs the toggle AND a concrete source; split is the toggle off', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.SONIOX);
    expect(d.planBothMode({ bothModeSharedSession: true, sourceLanguage: 'en' }, 'both')).toEqual({ shared: true, split: false });
    expect(d.planBothMode({ bothModeSharedSession: true, sourceLanguage: 'auto' }, 'both')).toEqual({ shared: false, split: false });
    expect(d.planBothMode({ bothModeSharedSession: false, sourceLanguage: 'en' }, 'both')).toEqual({ shared: false, split: true });
    expect(d.planBothMode({ bothModeSharedSession: true, sourceLanguage: 'en' }, 'speaker')).toEqual({ shared: false, split: false });
  });
});
```

Run → FAIL (method missing).

- [ ] **Step 2: Add type + base to ProviderDescriptor.ts** (as in Interfaces above; base in `BaseProviderDescriptor` returns `{ shared: false, split: false }`).

- [ ] **Step 3: De-dispatch the module**

In `sonioxBothMode.ts`: remove `provider` from `SonioxBothModeInput` and the two lines
```ts
  const isSoniox = (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX;
  if (!isSoniox || mode !== 'both') return { shared: false, split: false };
```
become
```ts
  if (mode !== 'both') return { shared: false, split: false };
```
Drop the now-unused `Provider, kizunaBaseProvider` import. Update the module header: the paragraph about the twin/`isSoniox` moves conceptually to the registry test (Step 1) — replace it with:

```ts
// Provider dispatch no longer lives here: this module is the Soniox
// descriptor's planBothMode implementation (twin included, by class
// extension), so "is this Soniox at all" is answered by which descriptor
// you asked. The registry test pins that the managed twin and BYOK answer
// identically — the 409 twin bug this module's old isSoniox line existed for.
```

Keep everything else (the `SonioxBothModePlan` interface may stay as a local alias but the descriptor type is `BothModePlan`; simplest: `export type SonioxBothModePlan = BothModePlan;` importing the type from `./ProviderDescriptor` — type-only import, no runtime edge).

- [ ] **Step 4: Soniox override**

In `SonioxProviderConfig.ts` (imports `sonioxBothModePlan` from `'./sonioxBothMode'` — the T1 move made this cycle-free):

```ts
  planBothMode(slice: unknown, mode: string): BothModePlan {
    return sonioxBothModePlan({
      settings: slice as { bothModeSharedSession?: boolean; sourceLanguage?: string } | null | undefined,
      mode: mode as SonioxBothModeScope,
    });
  }
```

- [ ] **Step 5: Update the module tests**

In `sonioxBothMode.test.ts`: remove `provider` from every call; DELETE the two dispatch-era tests ('is inert for a provider that is not Soniox' and the twin-follows test if present) — their registry replacements landed in Step 1; keep the remaining behavior tests unchanged.

- [ ] **Step 6: Run everything**

`npx vitest run src/services/providers/sonioxBothMode.test.ts src/services/providers/descriptorRegistry.test.ts` then full suite → all green.

- [ ] **Step 7: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/sonioxBothMode.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/sonioxBothMode.test.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): planBothMode seam; sonioxBothModePlan loses its own dispatch

The provider parameter and isSoniox check existed because callers
dispatched by hand; the descriptor is the dispatch now, and the twin
inherits by class extension — pinned in the registry test with the 409
story that line carried."
```

---

### Task 3: `reversesDirectionViaSourceLanguage` seam — base false, two overrides

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`, `SonioxProviderConfig.ts`, `GeminiProviderConfig.ts`
- Test: `src/services/providers/descriptorRegistry.test.ts`

- [ ] **Step 1: Failing registry test** (port of autoSourceReversal.test.ts's five cases, at the descriptor layer):

```ts
describe('S3 reversesDirectionViaSourceLanguage', () => {
  const TRANSLATE = 'gemini-3.5-live-translate-preview';
  const DIALOGUE = 'gemini-3.1-flash-live-preview';

  it('true for Soniox and its managed twin regardless of model', () => {
    expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
  });

  it('gemini: only the live-translate models', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    expect(d.reversesDirectionViaSourceLanguage(TRANSLATE)).toBe(true);
    expect(d.reversesDirectionViaSourceLanguage(DIALOGUE)).toBe(false);
    expect(d.reversesDirectionViaSourceLanguage(undefined)).toBe(false);
  });

  it('false for every other descriptor, any model', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.GEMINI].includes(id)) continue;
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.reversesDirectionViaSourceLanguage(TRANSLATE), `${id}`).toBe(false);
      expect(d.reversesDirectionViaSourceLanguage(undefined), `${id}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Interface + base + overrides**

`ProviderDescriptor.ts` — method with the doc comment carried over from `autoSourceReversal.ts` (the whole "Does this provider/model build its participant session by swapping a *concrete* source language…" block, reworded only to say "base: false — most providers carry direction in the system instruction"):

```ts
  reversesDirectionViaSourceLanguage(model: string | null | undefined): boolean;
```
Base returns `false` (ignore the arg: `reversesDirectionViaSourceLanguage(_model: …): boolean { return false; }`).

`SonioxProviderConfig.ts`:
```ts
  // Soniox reverses sourceLanguage/targetLanguage directly for the
  // participant leg, whatever the model — an 'auto' source would reverse into
  // the literal 'auto' as the participant's translate target.
  reversesDirectionViaSourceLanguage(): boolean { return true; }
```

`GeminiProviderConfig.ts` (imports `isGeminiTranslateModel` from `'./geminiTranslateModel'` — already imported? check; add if not):
```ts
  // Only the Live Translate models: their translationConfig.targetLanguageCode
  // overrules the instruction, so the instruction swap cannot stand in for it.
  // Dialogue Live models carry direction in the instruction like everyone else.
  reversesDirectionViaSourceLanguage(model: string | null | undefined): boolean {
    return isGeminiTranslateModel(model);
  }
```

- [ ] **Step 3: Run** registry + full suite → green (autoSourceReversal.ts still exists and passes its own tests; deletion is T4).

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/GeminiProviderConfig.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): reversesDirectionViaSourceLanguage seam with base false"
```

---

### Task 4: Migrate the call sites; delete `autoSourceReversal.ts`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (two sonioxBothModePlan call sites → descriptor; one reversesDirectionViaSourceLanguage call site → descriptor; imports)
- Modify: `src/components/Settings/sections/LanguageSection.tsx` (one call site → descriptor; import)
- Delete: `src/services/providers/autoSourceReversal.ts` + `autoSourceReversal.test.ts`

- [ ] **Step 1: MainPanel render-time call (grep `const sonioxBothSplit = useMemo`)**

The memo body becomes (comment above it unchanged):
```ts
  const sonioxBothSplit = useMemo(
    () => ProviderConfigFactory.getDescriptor(provider).planBothMode({
      bothModeSharedSession: activeProviderBothModeShared,
      sourceLanguage: activeProviderSourceLanguage,
    }, effectiveMode).split,
    [provider, effectiveMode, activeProviderBothModeShared, activeProviderSourceLanguage],
  );
```
(The two primitive reactive selectors above it stay exactly as they are — the perf reasoning in their comments is untouched.)

- [ ] **Step 2: MainPanel connect-time call (grep `const sonioxBothPlan`)**

`sonioxActiveSettings` snapshot stays; the call becomes:
```ts
      const sonioxBothPlan: BothModePlan = ProviderConfigFactory.getDescriptor(provider).planBothMode(sonioxActiveSettings, effectiveMode);
```
Type import: replace MainPanel's `SonioxBothModePlan` type import (from `sonioxBothMode`) with `import type { BothModePlan } from '../../services/providers/ProviderDescriptor';`. Keep the explanatory comment above the call verbatim.

- [ ] **Step 3: MainPanel auto-source call (grep `reversesDirectionViaSourceLanguage(`)**

Becomes `ProviderConfigFactory.getDescriptor(provider).reversesDirectionViaSourceLanguage(<same model expr>)` — keep the surrounding comment; check which model expression the site passes and keep it identical.

- [ ] **Step 4: LanguageSection call**

Same substitution with its own in-scope provider variable (it passes `effectiveProvider` — keep passing exactly that variable as the descriptor lookup id; the twin resolves via registry + inheritance). Replace the import with ProviderConfigFactory (check whether LanguageSection already imports it; add if not). Keep the comment.

- [ ] **Step 5: Delete the module**

`git rm src/services/providers/autoSourceReversal.ts src/services/providers/autoSourceReversal.test.ts` (its five cases were ported in T3). Remove MainPanel's imports of `sonioxBothModePlan`/`autoSourceReversal`. Verify: `grep -rn "autoSourceReversal\|sonioxBothModePlan" src/components/` → no hits (sonioxBothModePlan remains only in services/providers).

- [ ] **Step 6: Gates**

`npx vitest run` all green; `npx vite build` success.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(mainpanel): both-mode plan and auto-source gate from the descriptors

MainPanel and LanguageSection stop importing the Soniox/Gemini decision
modules; autoSourceReversal.ts — whose whole body was manual provider
dispatch — is absorbed by the seam and deleted, its tests ported to the
registry layer."
```

---

### Task 5: Subtitle-window hygiene test + stage close-out

**Files:**
- Create: `src/components/MainPanel/sessionStartGate.imports.test.ts`

- [ ] **Step 1: Write the hygiene test** (follows the repo's fs-scan precedent in `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts` — readFileSync + regex on import specifiers, `import.meta.url` for resolution):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// sessionStartGate is loaded by the Electron subtitle window. Its import list
// is a CONTRACT: exactly three leaf modules, none of which reach
// ProviderConfigFactory — that barrel imports every descriptor, and the
// descriptors pull the client graph and the i18n bootstrap behind them.
// planBothMode/capabilities answers reach the gate as derived primitives
// computed by MainPanel, never via a descriptor lookup inside the gate.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'sessionStartGate.ts'), 'utf8');

describe('sessionStartGate import hygiene (subtitle window contract)', () => {
  it('imports only the three sanctioned leaf modules', () => {
    const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual([
      '../../services/providers/sonioxManagedMinBalance',
      '../../types/Provider',
      '../../utils/formatters',
    ]);
  });

  it('never names ProviderConfigFactory or a descriptor module', () => {
    expect(src).not.toMatch(/ProviderConfigFactory/);
    expect(src).not.toMatch(/ProviderConfig'/);
    expect(src).not.toMatch(/sonioxBothMode/);
  });
});
```

Run: PASS immediately (the contract holds today) — this test exists to fail LOUDLY if a later stage wires the gate to a descriptor.

- [ ] **Step 2: Stage sweep + gates**

- `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — classify every hit; all must be S4+ territory (analytics fallbacks, kizuna-soniox lease/voice-prep/budget, local revalidation, comments). Any both-mode/auto-source hit = BLOCKED.
- `grep -rn "sonioxBothModePlan" src/ --include='*.tsx'` → no hits.
- `npx vitest run` all green; `npx vite build` success.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/sessionStartGate.imports.test.ts
git commit -m "test(mainpanel): pin sessionStartGate's leaf-import contract

The gate is loaded by the subtitle window; a descriptor import would
drag every client and the i18n bootstrap into that bundle. The spec's
S3 promise, now enforced."
```

---

## Self-review notes (already applied)

- **Spec coverage**: planBothMode ✓ (T2), reversesDirectionViaSourceLanguage ✓ (T3), MainPanel stops importing sonioxBothModePlan ✓ (T4), sessionStartGate hygiene test ✓ (T5). T1 is cycle-enabling work named as such (S2-T1 precedent).
- **Deliberate deltas, each pinned by ported tests**: sonioxBothModePlan's provider param + isSoniox check die (registry inertness + twin-equivalence tests replace the module-level dispatch tests); autoSourceReversal.ts deleted (five cases ported verbatim to the registry layer).
- **Type consistency**: `BothModePlan` (ProviderDescriptor) is the public type; `SonioxBothModePlan` survives as a type alias so the module's internal naming keeps meaning; `planBothMode(slice, mode)` / `reversesDirectionViaSourceLanguage(model)` used identically across T2-T4.
