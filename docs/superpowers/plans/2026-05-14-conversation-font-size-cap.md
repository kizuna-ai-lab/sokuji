# Conversation Font-Size Cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the maximum conversation font size in MainPanel from 28 → 64 px and in Subtitle mode from 48 → 64 px so Sokuji is readable from the back of a classroom-projected screen, without changing defaults or adding new UI.

**Architecture:** Two independent Zustand stores own the two font-size knobs (`settingsStore.conversationFontSize` and `subtitleStore.fontSize`). Subtitle already clamps via `FONT_SIZE_MIN / FONT_SIZE_MAX` constants — settingsStore does not, so we add the same pattern there. Existing +/- stepper UI in `MainPanel.tsx` and `SubtitleBar.tsx` automatically picks up the new bounds via the constants. CSS already uses a relative `line-height: 1.4` so nothing in styles needs to change.

**Tech Stack:** TypeScript, React, Zustand (`subscribeWithSelector`), Vitest.

**Spec:** [docs/superpowers/specs/2026-05-14-conversation-font-size-cap-design.md](../specs/2026-05-14-conversation-font-size-cap-design.md)

---

## File Map

- **Modify** `src/stores/settingsStore.ts` — export `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX`, clamp in `setConversationFontSize`, clamp on load (line 1460).
- **Modify** `src/stores/settingsStore.test.ts` — add 3 clamp tests for `setConversationFontSize`.
- **Modify** `src/components/MainPanel/MainPanel.tsx` — import the new constants, replace literals `12` / `28` at lines 2936-2937, 2946-2947.
- **Modify** `src/stores/subtitleStore.ts` — change `FONT_SIZE_MAX` from `48` → `64` (line 65).
- **Modify** `src/stores/subtitleStore.test.ts` — update the existing `'clamps fontSize to [12, 48]'` test to assert the new upper bound (lines 31, 35).

No new files, no SCSS changes, no extension-side changes (extension shares `src/components` via vite alias).

---

## Task 1: Add MIN/MAX constants and clamping to settingsStore

**Files:**
- Modify: `src/stores/settingsStore.ts:43-50` (add constants near the `CommonSettings` interface), `src/stores/settingsStore.ts:901-911` (clamp in setter), `src/stores/settingsStore.ts:1460` (clamp on load)
- Test: `src/stores/settingsStore.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing tests**

The existing test file deliberately imports the store dynamically *after* `vi.mock` has been wired (line 28: `const { default: useSettingsStore } = await import('./settingsStore');`). Static imports of any symbol from `./settingsStore` would evaluate the module before the mocks register, so we destructure the new constants from the same dynamic import.

Replace line 28 of `src/stores/settingsStore.test.ts`:

```ts
const { default: useSettingsStore } = await import('./settingsStore');
```

with:

```ts
const {
  default: useSettingsStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} = await import('./settingsStore');
```

Then append this `describe` block inside `describe('settingsStore', …)`, before its closing `});`:

```ts
describe('conversationFontSize clamping', () => {
  it('exports MIN=12 and MAX=64 constants', () => {
    expect(CONVERSATION_FONT_SIZE_MIN).toBe(12);
    expect(CONVERSATION_FONT_SIZE_MAX).toBe(64);
  });

  it('clamps values below MIN', async () => {
    await useSettingsStore.getState().setConversationFontSize(5);
    expect(useSettingsStore.getState().conversationFontSize).toBe(
      CONVERSATION_FONT_SIZE_MIN,
    );
  });

  it('clamps values above MAX', async () => {
    await useSettingsStore.getState().setConversationFontSize(200);
    expect(useSettingsStore.getState().conversationFontSize).toBe(
      CONVERSATION_FONT_SIZE_MAX,
    );
  });

  it('passes through in-range values', async () => {
    await useSettingsStore.getState().setConversationFontSize(20);
    expect(useSettingsStore.getState().conversationFontSize).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/settingsStore.test.ts --run`

Expected: 4 failures. The "exports MIN=12 and MAX=64" test fails at the `import` (constants not exported); the three clamp tests fail because the setter currently writes raw input.

- [ ] **Step 3: Add the constants**

In `src/stores/settingsStore.ts`, locate the `CommonSettings` interface (line 34) and the `defaultCommonSettings` const (line 187). Add the two constants between them, right above `defaultCommonSettings`:

```ts
export const CONVERSATION_FONT_SIZE_MIN = 12;
export const CONVERSATION_FONT_SIZE_MAX = 64;

const clampConversationFontSize = (n: number): number =>
  Math.max(
    CONVERSATION_FONT_SIZE_MIN,
    Math.min(CONVERSATION_FONT_SIZE_MAX, Math.round(n)),
  );
```

(Pattern mirrors `subtitleStore.ts:64-71`. Keep the helper file-local since it's only consumed in two places below.)

- [ ] **Step 4: Clamp in the setter**

Replace the body of `setConversationFontSize` at `src/stores/settingsStore.ts:901-911`. Current code:

```ts
    setConversationFontSize: async (conversationFontSize) => {
      const previous = get().conversationFontSize;
      set({conversationFontSize});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.conversationFontSize', conversationFontSize);
      } catch (error) {
        console.error('[SettingsStore] Error persisting conversationFontSize setting:', error);
        set({conversationFontSize: previous});
      }
    },
```

New code:

```ts
    setConversationFontSize: async (conversationFontSize) => {
      const clamped = clampConversationFontSize(conversationFontSize);
      const previous = get().conversationFontSize;
      set({conversationFontSize: clamped});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.conversationFontSize', clamped);
      } catch (error) {
        console.error('[SettingsStore] Error persisting conversationFontSize setting:', error);
        set({conversationFontSize: previous});
      }
    },
```

- [ ] **Step 5: Clamp on load**

Modify `src/stores/settingsStore.ts:1460` so any out-of-range stored value gets corrected on load. Current line:

```ts
        const conversationFontSize = await service.getSetting('settings.common.conversationFontSize', defaultCommonSettings.conversationFontSize);
```

New (split for clarity):

```ts
        const conversationFontSizeRaw = await service.getSetting('settings.common.conversationFontSize', defaultCommonSettings.conversationFontSize);
        const conversationFontSize = clampConversationFontSize(conversationFontSizeRaw);
```

The downstream `set({…, conversationFontSize, …})` at line 1499 picks up the clamped local automatically — no other change required there.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- src/stores/settingsStore.test.ts --run`

Expected: all 4 new tests pass; existing tests in the file continue to pass.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`

Expected: clean (no new errors).

- [ ] **Step 8: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(ui): clamp conversation font size to [12, 64] in store

Adds CONVERSATION_FONT_SIZE_MIN/MAX exports and clamps both the setter
and the persisted value on load. Mirrors the pattern already used by
subtitleStore. Refs #230."
```

---

## Task 2: Wire MainPanel buttons to the new constants

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (import + lines 2936-2937, 2946-2947)

This task widens the user-visible cap from 28 → 64 by replacing hard-coded literals with the constants exported in Task 1.

- [ ] **Step 1: Update the imports**

Find the existing import from `../../stores/settingsStore` in `src/components/MainPanel/MainPanel.tsx` (search for `useConversationFontSize`). Add `CONVERSATION_FONT_SIZE_MIN` and `CONVERSATION_FONT_SIZE_MAX` to that import. For example, if the current import is:

```ts
import {
  useConversationFontSize,
  useSetConversationFontSize,
  // …other imports…
} from '../../stores/settingsStore';
```

Make it:

```ts
import {
  useConversationFontSize,
  useSetConversationFontSize,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
  // …other imports…
} from '../../stores/settingsStore';
```

(If the existing import is a single-line form, expand it to multi-line; preserve all other named imports.)

- [ ] **Step 2: Replace the literals**

At `src/components/MainPanel/MainPanel.tsx:2934-2953`, replace the four occurrences of `12` and `28` with the imported constants. Current code:

```tsx
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.max(12, conversationFontSize - 2))}
              disabled={conversationFontSize <= 12}
              title={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              aria-label={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              type="button"
            >
              <AArrowDown size={14} />
            </button>
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.min(28, conversationFontSize + 2))}
              disabled={conversationFontSize >= 28}
              title={t('mainPanel.increaseFontSize', 'Increase font size')}
              aria-label={t('mainPanel.increaseFontSize', 'Increase font size')}
              type="button"
            >
              <AArrowUp size={14} />
            </button>
```

New code:

```tsx
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.max(CONVERSATION_FONT_SIZE_MIN, conversationFontSize - 2))}
              disabled={conversationFontSize <= CONVERSATION_FONT_SIZE_MIN}
              title={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              aria-label={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              type="button"
            >
              <AArrowDown size={14} />
            </button>
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.min(CONVERSATION_FONT_SIZE_MAX, conversationFontSize + 2))}
              disabled={conversationFontSize >= CONVERSATION_FONT_SIZE_MAX}
              title={t('mainPanel.increaseFontSize', 'Increase font size')}
              aria-label={t('mainPanel.increaseFontSize', 'Increase font size')}
              type="button"
            >
              <AArrowUp size={14} />
            </button>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Run the existing test suite**

Run: `npm run test -- --run`

Expected: all tests pass. (No new test added here — behavior is exercised by the store tests in Task 1; the buttons simply forward to the clamped setter.)

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(ui): raise MainPanel font-size cap to 64 px

Replaces hard-coded 12/28 button bounds with the new
CONVERSATION_FONT_SIZE_MIN/MAX constants from settingsStore so the
conversation can be set up to 64 px for classroom projection. Default
stays 14. Closes part of #230."
```

---

## Task 3: Raise subtitle font-size cap to 64

**Files:**
- Modify: `src/stores/subtitleStore.ts:65` (constant change)
- Modify: `src/stores/subtitleStore.test.ts:31, 35` (description + assertion)

- [ ] **Step 1: Update the failing test first**

In `src/stores/subtitleStore.test.ts`, change lines 31-38. Current code:

```ts
  it('clamps fontSize to [12, 48]', async () => {
    await useSubtitleStore.getState().setFontSize(8);
    expect(useSubtitleStore.getState().fontSize).toBe(12);
    await useSubtitleStore.getState().setFontSize(99);
    expect(useSubtitleStore.getState().fontSize).toBe(48);
    await useSubtitleStore.getState().setFontSize(28);
    expect(useSubtitleStore.getState().fontSize).toBe(28);
  });
```

New code:

```ts
  it('clamps fontSize to [12, 64]', async () => {
    await useSubtitleStore.getState().setFontSize(8);
    expect(useSubtitleStore.getState().fontSize).toBe(12);
    await useSubtitleStore.getState().setFontSize(99);
    expect(useSubtitleStore.getState().fontSize).toBe(64);
    await useSubtitleStore.getState().setFontSize(28);
    expect(useSubtitleStore.getState().fontSize).toBe(28);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/stores/subtitleStore.test.ts --run`

Expected: the `'clamps fontSize to [12, 64]'` test fails — the second assertion sees `48` (current cap) instead of `64`. Other tests in the file continue to pass.

- [ ] **Step 3: Bump the constant**

In `src/stores/subtitleStore.ts:65`, change:

```ts
export const FONT_SIZE_MAX = 48;
```

to:

```ts
export const FONT_SIZE_MAX = 64;
```

No other change in this file. The clamp at line 95 and the bounds reads in `SubtitleBar.tsx:122-133` already pull from `FONT_SIZE_MAX`, so they update automatically.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/stores/subtitleStore.test.ts --run`

Expected: all tests pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/stores/subtitleStore.ts src/stores/subtitleStore.test.ts
git commit -m "feat(subtitle): raise font-size cap to 64 px

Brings subtitle mode's max in line with the new MainPanel cap so larger
projection setups have headroom. Default stays 24. Closes #230."
```

---

## Task 4: Manual verification

No code changes. Run through the spec's manual test plan and record results in the PR.

- [ ] **Step 1: Run the full automated suite once more**

Run: `npm run test -- --run`

Expected: all green.

- [ ] **Step 2: Electron — MainPanel**

Run: `npm run electron:dev`

Verify on both Basic and Advanced UI mode (toggle in Settings):

  1. Start a session, send / receive a few messages.
  2. Click `A↑` in the conversation toolbar repeatedly. Value should reach 64 and the button becomes disabled.
  3. Click `A↓` repeatedly. Value should reach 12 and the button becomes disabled.
  4. At 64 px:
     - Bubbles wrap; no horizontal overflow.
     - Conversation scrolls correctly.
     - Conversation toolbar (above) and footer (below) remain unaffected.
     - Karaoke-highlighted bubbles render correctly.
  5. Reload the app — chosen size persists.

- [ ] **Step 3: Electron — Subtitle mode**

From the same Electron session, open the floating subtitle window:

  1. Click the `+` button in the SubtitleBar repeatedly. Value should reach 64; button becomes disabled.
  2. At 64 px, original + translated text both render without clipping; SubtitleBar controls remain usable.
  3. Close & reopen the subtitle window — chosen size persists.

- [ ] **Step 4: Browser extension — both surfaces**

Build and load the extension (per project README), then in the side panel and the on-page subtitle overlay, repeat the equivalent of Steps 2-3 in a Chromium browser.

- [ ] **Step 5: Out-of-range storage check (optional but recommended)**

In Electron DevTools (or extension storage), set `settings.common.conversationFontSize` to `200`, reload. Verify the value clamps to 64 in the UI on next load. Repeat for `subtitle.fontSize`.

- [ ] **Step 6: Open the PR**

Once verification is clean, push the worktree branch and open a PR referencing #230. Use the spec and this plan as supporting documents in the PR body. Include a screenshot of the conversation at 64 px.

---

## Notes for the implementer

- **No SCSS edits**: `.message-content` already uses `line-height: 1.4` (relative). Padding and `max-width` stay in px and remain proportionate at 64 px.
- **No extension-side edits**: `extension/vite.config.ts` aliases `@components` to `../src/components`, so MainPanel and SubtitleBar are shared.
- **No i18n edits**: button `title` / `aria-label` already say "Increase / Decrease font size" — agnostic to the cap value.
- **Defaults unchanged**: MainPanel stays at 14 px, subtitle stays at 24 px.
- **Step size unchanged**: ±2 on both surfaces. 12 → 64 in steps of 2 is 26 clicks; acceptable since users typically set once and the value persists.
