# Volcengine AST 2.0 — Chinese↔English Bidirectional Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doubao AST 2.0's Chinese↔English bidirectional mode (`source_language = target_language = 'zhen'`) reachable through the existing source/target dropdowns. Picking the bidirectional entry on either side atomically syncs the other side to `'zhen'`, so the settings never sit in a server-invalid `zhen/<other>` state.

**Architecture:** A pure-function helper `resolveAST2LanguagePair(current, change)` encodes the four sync rules from the design spec. Both Simple-mode (`LanguageSection.tsx`) and Advanced-mode (`ProviderSpecificSettings.tsx`) call this helper and then write both fields in a single `updateVolcengineAST2Settings(...)` Zustand action. `VolcengineAST2ProviderConfig.getTargetLanguages()` is widened to include `'zhen'` so it becomes selectable on the target side. The swap button's disabled condition is extended so it can't fire on `zhen/zhen`.

**Tech Stack:** TypeScript, React, Zustand (`subscribeWithSelector`), Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-05-14-volcengine-ast2-bidirectional-mode-design.md` (commit `60a0542f`).

**Tracking issue:** [#229](https://github.com/kizuna-ai-lab/sokuji/issues/229)

---

## Task ordering rationale

1. **Phase A** (Task 1): Provider-config change exposes `'zhen'` on the target list. Pure data — no behavior change in call sites yet (they still write one field at a time, but that field can now be `'zhen'`, so the bug from the issue is reproducible).
2. **Phase B** (Task 2): Build the sync helper with TDD — all 7 rule cases from the spec become Vitest tests; the helper is implemented to make them green.
3. **Phase C** (Tasks 3–4): Wire the helper into Simple-mode UI and extend the swap-button disabled condition.
4. **Phase D** (Task 5): Wire the helper into Advanced-mode UI.
5. **Phase E** (Tasks 6–7): Typecheck/full test pass + manual smoke runbook.

After Phase B the helper exists but isn't used yet — full `tsc` still passes. After Phases C–D the feature is functionally complete. Phase E verifies.

---

## Phase A: Provider config exposes `'zhen'` on target side

### Task 1: `VolcengineAST2ProviderConfig.getTargetLanguages` returns `BIDIRECTIONAL_LANGUAGES`

**Files:**
- Modify: `src/services/providers/VolcengineAST2ProviderConfig.ts:33-35`

- [ ] **Step 1: Edit `getTargetLanguages()`**

In `src/services/providers/VolcengineAST2ProviderConfig.ts`, replace lines 33–35:

```ts
  static getTargetLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.LANGUAGES;
  }
```

with:

```ts
  static getTargetLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES;
  }
```

No other line in the file changes. `BIDIRECTIONAL_LANGUAGES` at line 17 already contains the 8 single-language entries plus `{ name: '中英双语 (zh↔en)', value: 'zhen', englishName: 'Chinese-English Bidirectional' }`.

- [ ] **Step 2: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS — `BIDIRECTIONAL_LANGUAGES` already exists and has the same `LanguageOption[]` type as `LANGUAGES`.

- [ ] **Step 3: Commit**

```bash
git add src/services/providers/VolcengineAST2ProviderConfig.ts
git commit -m "feat(volcengine-ast2): expose 'zhen' on target-language list"
```

---

## Phase B: Build the language-sync helper (TDD)

### Task 2: TDD `resolveAST2LanguagePair` helper

The helper is a pure function. It lives next to the provider config it's enforcing rules for, so both UI call sites can import it without pulling React. Test file is colocated per project convention (e.g. `VolcengineAST2Client.test.ts` lives next to `VolcengineAST2Client.ts`).

**Files:**
- Create: `src/services/providers/volcengineAST2LanguageSync.ts`
- Create: `src/services/providers/volcengineAST2LanguageSync.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/services/providers/volcengineAST2LanguageSync.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAST2LanguagePair } from './volcengineAST2LanguageSync';

describe('resolveAST2LanguagePair', () => {
  // R1: picking 'zhen' on source atomically syncs target to 'zhen'.
  it('R1: zh/en → source=zhen ⇒ zhen/zhen', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'source', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  it("R1': ja/zh → source=zhen ⇒ zhen/zhen", () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'ja', targetLanguage: 'zh' },
        { side: 'source', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  // R2: picking 'zhen' on target atomically syncs source to 'zhen'.
  it('R2: zh/en → target=zhen ⇒ zhen/zhen', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'target', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  // R3: leaving 'zhen' on the source resets target to the provider default 'en'.
  it('R3: zhen/zhen → source=ja ⇒ ja/en', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'source', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  // R3 degenerate same-language case — helper does not block; server will reject.
  it('R3 same-lang: zhen/zhen → source=en ⇒ en/en', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'source', value: 'en' },
      ),
    ).toEqual({ sourceLanguage: 'en', targetLanguage: 'en' });
  });

  // R4: leaving 'zhen' on the target resets source to the provider default 'zh'.
  it('R4: zhen/zhen → target=fr ⇒ zh/fr', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'target', value: 'fr' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
  });

  // R4 degenerate same-language case.
  it('R4 same-lang: zhen/zhen → target=zh ⇒ zh/zh', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'target', value: 'zh' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'zh' });
  });

  // Normal (non-bidirectional → non-bidirectional) update: passes through
  // without touching the other side. Not in the spec's rule table, but the
  // helper must support being called for every change to be useful as the
  // single VOLCENGINE_AST2 update path in the UI.
  it('passthrough: zh/en → source=ja ⇒ ja/en (target unchanged)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'source', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('passthrough: zh/en → target=fr ⇒ zh/fr (source unchanged)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'target', value: 'fr' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (no module)**

Run: `npx vitest run src/services/providers/volcengineAST2LanguageSync.test.ts`
Expected: FAIL with a module-not-found error (`Cannot find module './volcengineAST2LanguageSync'` or similar from the import statement). The exact failure mode is "no source file yet", which is the correct red.

- [ ] **Step 3: Implement the helper**

Create `src/services/providers/volcengineAST2LanguageSync.ts` with this exact content:

```ts
/**
 * Synchronisation rules for the Volcengine AST 2.0 provider's source/target
 * language pair. The server requires both fields to be 'zhen' for Chinese↔English
 * bidirectional mode (and rejects any mixed combination involving 'zhen'). This
 * helper enforces that constraint as a pure transformation so call sites can
 * write both fields in a single Zustand update.
 *
 * Rules (from docs/superpowers/specs/2026-05-14-volcengine-ast2-bidirectional-mode-design.md §2):
 *   R1: picks 'zhen' on source → both become 'zhen'
 *   R2: picks 'zhen' on target → both become 'zhen'
 *   R3: leaves 'zhen' on source (current state was zhen/zhen) → target resets to 'en'
 *   R4: leaves 'zhen' on target (current state was zhen/zhen) → source resets to 'zh'
 *   passthrough: any other change updates only the side the user touched
 */
export interface AST2LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface AST2LanguageChange {
  side: 'source' | 'target';
  value: string;
}

const ZHEN = 'zhen';
const DEFAULT_SOURCE = 'zh';
const DEFAULT_TARGET = 'en';

export function resolveAST2LanguagePair(
  current: AST2LanguagePair,
  change: AST2LanguageChange,
): AST2LanguagePair {
  // R1 / R2: picking 'zhen' on either side forces both to 'zhen'.
  if (change.value === ZHEN) {
    return { sourceLanguage: ZHEN, targetLanguage: ZHEN };
  }

  // R3 / R4: leaving 'zhen' on one side while the other was also 'zhen' means
  // we must reset the other side to its provider default to avoid a transient
  // 'zhen / <other>' state that the server rejects.
  if (change.side === 'source' && current.sourceLanguage === ZHEN && current.targetLanguage === ZHEN) {
    return { sourceLanguage: change.value, targetLanguage: DEFAULT_TARGET };
  }
  if (change.side === 'target' && current.sourceLanguage === ZHEN && current.targetLanguage === ZHEN) {
    return { sourceLanguage: DEFAULT_SOURCE, targetLanguage: change.value };
  }

  // Passthrough: ordinary source/target edit, no cross-side effect.
  if (change.side === 'source') {
    return { sourceLanguage: change.value, targetLanguage: current.targetLanguage };
  }
  return { sourceLanguage: current.sourceLanguage, targetLanguage: change.value };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/providers/volcengineAST2LanguageSync.test.ts`
Expected: PASS — all 9 tests green (7 spec cases + 2 passthrough cases).

- [ ] **Step 5: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS — pure TS with no React imports.

- [ ] **Step 6: Commit**

```bash
git add src/services/providers/volcengineAST2LanguageSync.ts src/services/providers/volcengineAST2LanguageSync.test.ts
git commit -m "feat(volcengine-ast2): add resolveAST2LanguagePair sync helper"
```

---

## Phase C: Wire helper into Simple-mode UI

### Task 3: Replace `Provider.VOLCENGINE_AST2` branches in `LanguageSection.tsx`

The current `updateSourceLanguage` and `updateTargetLanguage` call `updateVolcengineAST2Settings({ sourceLanguage: value })` (or `{ targetLanguage: value }`) — one field at a time. We replace each with a call that runs the helper, writes both fields in one update, and emits a second `language_changed` analytics event when the other side also changed (per spec §5).

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx:156-158`
- Modify: `src/components/Settings/sections/LanguageSection.tsx:200-202`
- Modify: `src/components/Settings/sections/LanguageSection.tsx` (top, add import)

- [ ] **Step 1: Add the helper import**

In `src/components/Settings/sections/LanguageSection.tsx`, find the existing provider import block. Add a new import right under the line that imports from `'../../../services/providers/ProviderConfig'`:

```ts
import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
```

- [ ] **Step 2: Replace the source-side `VOLCENGINE_AST2` branch**

Find lines 156–158 in `src/components/Settings/sections/LanguageSection.tsx`:

```ts
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ sourceLanguage: value });
        break;
```

Replace with:

```ts
      case Provider.VOLCENGINE_AST2: {
        const prev = volcengineAST2Settings;
        const next = resolveAST2LanguagePair(
          { sourceLanguage: prev.sourceLanguage, targetLanguage: prev.targetLanguage },
          { side: 'source', value },
        );
        updateVolcengineAST2Settings({
          sourceLanguage: next.sourceLanguage,
          targetLanguage: next.targetLanguage,
        });
        // Spec §5: when bidirectional sync also changes the other side, emit a
        // second analytics event so consumers see both transitions. The trailing
        // `trackEvent` below this switch still emits the source-side event.
        if (next.targetLanguage !== prev.targetLanguage) {
          trackEvent('language_changed', {
            to_language: next.targetLanguage,
            language_type: 'target',
          });
        }
        break;
      }
```

- [ ] **Step 3: Replace the target-side `VOLCENGINE_AST2` branch**

Find lines 200–202 in `src/components/Settings/sections/LanguageSection.tsx`:

```ts
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ targetLanguage: value });
        break;
```

Replace with:

```ts
      case Provider.VOLCENGINE_AST2: {
        const prev = volcengineAST2Settings;
        const next = resolveAST2LanguagePair(
          { sourceLanguage: prev.sourceLanguage, targetLanguage: prev.targetLanguage },
          { side: 'target', value },
        );
        updateVolcengineAST2Settings({
          sourceLanguage: next.sourceLanguage,
          targetLanguage: next.targetLanguage,
        });
        if (next.sourceLanguage !== prev.sourceLanguage) {
          trackEvent('language_changed', {
            to_language: next.sourceLanguage,
            language_type: 'source',
          });
        }
        break;
      }
```

- [ ] **Step 4: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run existing test suite for LanguageSection's neighbours**

Run: `npx vitest run src/services/providers/`
Expected: PASS — the new helper tests stay green, no other test in this directory regresses.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx
git commit -m "feat(volcengine-ast2): atomic zhen sync in LanguageSection (Simple mode)"
```

---

### Task 4: Extend swap-button disabled condition + early-return guard

Two spots in `LanguageSection.tsx` short-circuit swap when `sourceLanguage === 'auto'`. Add `'zhen'` to both — swapping `zhen/zhen` is a no-op (the server-required state stays `zhen/zhen`), so the button should be inert.

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx:217`
- Modify: `src/components/Settings/sections/LanguageSection.tsx:422`

- [ ] **Step 1: Update the `handleSwapLanguages` early-return guard**

In `src/components/Settings/sections/LanguageSection.tsx`, find line 217:

```ts
    if (!src || !tgt || src === 'auto') return;
```

Replace with:

```ts
    if (!src || !tgt || src === 'auto' || src === 'zhen') return;
```

- [ ] **Step 2: Update the swap-button `disabled` prop**

Find line 422 in the same file:

```ts
                disabled={isSessionActive || currentProviderSettings.sourceLanguage === 'auto'}
```

Replace with:

```ts
                disabled={isSessionActive || currentProviderSettings.sourceLanguage === 'auto' || currentProviderSettings.sourceLanguage === 'zhen'}
```

- [ ] **Step 3: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx
git commit -m "feat(volcengine-ast2): disable swap button in zhen/zhen bidirectional mode"
```

---

## Phase D: Wire helper into Advanced-mode UI

### Task 5: Replace `onChange` bodies in `renderVolcengineAST2Settings()`

The two `<select>` `onChange` handlers in Advanced mode currently write one field at a time, just like the Simple-mode handlers did before Task 3. Apply the same helper-driven pattern. Advanced mode does not have a swap button, so no equivalent of Task 4 is needed here.

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (top, add import)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1462-1472` (source-language `onChange`)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1487-1497` (target-language `onChange`)

- [ ] **Step 1: Add the helper import**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, find the existing line:

```ts
import { VolcengineAST2ProviderConfig } from '../../../services/providers/VolcengineAST2ProviderConfig';
```

Add immediately below it:

```ts
import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
```

- [ ] **Step 2: Replace the source-side `onChange` body**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, find lines 1462–1472 (the source-language `<select>`'s `onChange`):

```ts
              onChange={(e) => {
                const oldSourceLang = volcengineAST2Settings.sourceLanguage;
                const newSourceLang = e.target.value;
                updateVolcengineAST2Settings({ sourceLanguage: newSourceLang });

                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: newSourceLang,
                  language_type: 'source'
                });
              }}
```

Replace with:

```ts
              onChange={(e) => {
                const oldSourceLang = volcengineAST2Settings.sourceLanguage;
                const oldTargetLang = volcengineAST2Settings.targetLanguage;
                const newSourceLang = e.target.value;
                const next = resolveAST2LanguagePair(
                  { sourceLanguage: oldSourceLang, targetLanguage: oldTargetLang },
                  { side: 'source', value: newSourceLang },
                );
                updateVolcengineAST2Settings({
                  sourceLanguage: next.sourceLanguage,
                  targetLanguage: next.targetLanguage,
                });

                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: next.sourceLanguage,
                  language_type: 'source'
                });
                if (next.targetLanguage !== oldTargetLang) {
                  trackEvent('language_changed', {
                    from_language: oldTargetLang,
                    to_language: next.targetLanguage,
                    language_type: 'target'
                  });
                }
              }}
```

- [ ] **Step 3: Replace the target-side `onChange` body**

Find lines 1487–1497 (the target-language `<select>`'s `onChange`):

```ts
              onChange={(e) => {
                const oldTargetLang = volcengineAST2Settings.targetLanguage;
                const newTargetLang = e.target.value;
                updateVolcengineAST2Settings({ targetLanguage: newTargetLang });

                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: newTargetLang,
                  language_type: 'target'
                });
              }}
```

Replace with:

```ts
              onChange={(e) => {
                const oldSourceLang = volcengineAST2Settings.sourceLanguage;
                const oldTargetLang = volcengineAST2Settings.targetLanguage;
                const newTargetLang = e.target.value;
                const next = resolveAST2LanguagePair(
                  { sourceLanguage: oldSourceLang, targetLanguage: oldTargetLang },
                  { side: 'target', value: newTargetLang },
                );
                updateVolcengineAST2Settings({
                  sourceLanguage: next.sourceLanguage,
                  targetLanguage: next.targetLanguage,
                });

                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: next.targetLanguage,
                  language_type: 'target'
                });
                if (next.sourceLanguage !== oldSourceLang) {
                  trackEvent('language_changed', {
                    from_language: oldSourceLang,
                    to_language: next.sourceLanguage,
                    language_type: 'source'
                  });
                }
              }}
```

- [ ] **Step 4: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(volcengine-ast2): atomic zhen sync in ProviderSpecificSettings (Advanced mode)"
```

---

## Phase E: Verification

### Task 6: Full typecheck and test suite

- [ ] **Step 1: Run full TypeScript compile**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 2: Run the full Vitest suite**

Run: `npm run test -- --run`
Expected: PASS for every test file. The new `volcengineAST2LanguageSync.test.ts` reports 9 passing tests. No pre-existing test regresses.

- [ ] **Step 3: If anything fails, stop and investigate**

Do not mark this task complete with a red bar. Failures here mean an earlier task's edit introduced a regression — re-read the failing test's assertion, diff against the source, and fix forward (do NOT silence the test). Once green, return to Step 1 for confirmation.

- [ ] **Step 4: No commit for this task (verification-only)**

---

### Task 7: Manual smoke runbook

Run through the spec §6 manual list against a real build. Do these checks against the Electron app (`npm run electron:dev`); the same UI ships to the extension, but the language section behaviour is identical there.

**Setup (one-time):**

- [ ] Launch the app: `npm run electron:dev`
- [ ] In Settings → Provider, switch to **Doubao AST 2.0** (`volcengine_ast2`). Enter a valid App Key / Access Token if not already configured.
- [ ] Confirm you can see **Simple mode**'s language pair row and **Advanced mode**'s `renderVolcengineAST2Settings()` — both are dropdowns showing source and target.

**Simple mode checks (left/right dropdowns + ↔ swap button):**

- [ ] **R1** — Set source to anything other than `中英双语 (zh↔en)`. Set source to `中英双语 (zh↔en)`. Expected: target jumps to `中英双语 (zh↔en)` automatically; both stay synced.
- [ ] **R2** — Reset to `中文 / English`. Set target to `中英双语 (zh↔en)`. Expected: source jumps to `中英双语 (zh↔en)` automatically.
- [ ] **R3** — With state `zhen / zhen`, change source dropdown to `日本語`. Expected: state becomes `ja / en` (target visibly resets to `English`).
- [ ] **R4** — Reset to `zhen / zhen`. Change target dropdown to `Français`. Expected: state becomes `zh / fr` (source visibly resets to `中文`).
- [ ] **Swap button** — Set `zhen / zhen`. Confirm the swap button is disabled (greyed out, no hover affordance). Set source back to `zh`, target to `en` — swap button re-enables.

**Advanced mode checks (no swap button):**

- [ ] Switch to Advanced mode (Settings → toggle to `advanced`).
- [ ] Repeat R1, R2, R3, R4 above against the Advanced-mode dropdowns inside `renderVolcengineAST2Settings()`. Expected: identical behaviour.

**End-to-end session check:**

- [ ] In either mode, set the pair to `zhen / zhen`.
- [ ] Start a live session (Start button).
- [ ] Speak a short Chinese sentence (e.g. "你好，今天天气怎么样"). Expected: English audio + transcript out within ~1–2 s.
- [ ] **Without ending the session**, speak a short English sentence (e.g. "How are you doing today"). Expected: Chinese audio + transcript out within ~1–2 s, no reconnection or settings prompt.
- [ ] End the session.

**Analytics spot-check (optional):**

- [ ] Open the LogsPanel (or browser/Electron DevTools console) and confirm that picking `中英双语` on the source emits **two** `language_changed` events (one with `language_type: 'source'`, one with `language_type: 'target'`, both with `to_language: 'zhen'`).

This task makes no code changes — the plan file itself is the runbook. No commit needed.

---

## Self-Review Notes

**Spec coverage map** (each spec §, tracked against task IDs):

- §1 Provider config (target list) → Task 1 ✓
- §2 Sync semantics (R1–R4 + edge cases) → Task 2 (helper + 9 unit tests) ✓
- §3 Simple-mode UI wiring → Task 3 ✓
- §3 Swap button extension → Task 4 ✓
- §3 No new warnings → not a code change, explicit non-action ✓
- §4 Advanced-mode UI wiring → Task 5 ✓
- §5 Analytics (two events when both sides change) → embedded in Tasks 3 and 5 ✓
- §6 Unit testing → Task 2 ✓
- §6 Manual testing → Task 7 ✓
- Non-goals (i18n, defaults, ja↔de validation, schema changes) → none of these have tasks, as intended ✓

**Files touched** (matches spec §Files touched):

- `src/services/providers/VolcengineAST2ProviderConfig.ts` → Task 1
- `src/services/providers/volcengineAST2LanguageSync.ts` (new) → Task 2
- `src/services/providers/volcengineAST2LanguageSync.test.ts` (new) → Task 2
- `src/components/Settings/sections/LanguageSection.tsx` → Tasks 3, 4
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` → Task 5

No store schema change, no i18n key change, no manifest/version change — consistent with spec.
