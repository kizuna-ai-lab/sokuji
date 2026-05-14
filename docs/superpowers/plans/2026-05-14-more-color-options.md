# More Color Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship issue #231 — give Sokuji's subtitle and conversation panel each their own independent color settings (with three new dark color presets and a "+" custom-color picker), accessible from each surface's own ⚙ entry point.

**Architecture:** Extract conversation display fields (`fontSize`, `compactMode`, plus three new color fields) from `settingsStore` into a dedicated `conversationDisplayStore` mirroring the v0.26 `subtitleStore` extraction. Rename `SubtitleSettingsPopover` to `DisplaySettingsPopover` and relocate to `src/components/Display/`; the popover takes a `source: 'subtitle' | 'conversation'` prop and is rendered through two thin store-binding wrappers (rules-of-hooks compliant). MainPanel's `conversation-toolbar` gains a new ⚙ button that opens the popover bound to conversation settings. Color CSS variables for the conversation panel use a new `--conversation-*` namespace, separate from the existing `--subtitle-*` used by the subtitle surface.

**Tech Stack:** React 18 + TypeScript, Zustand (with `subscribeWithSelector` middleware), `@floating-ui/react`, `lucide-react`, `react-i18next`, Vitest + `@testing-library/react` for tests, SCSS for styling.

**Spec:** [`docs/superpowers/specs/2026-05-14-more-color-options-design.md`](../specs/2026-05-14-more-color-options-design.md)

---

## File Structure

**New files:**
- `src/stores/conversationDisplayStore.ts` — new store: `fontSize`, `compactMode`, `bgColor`, `sourceTextColor`, `translationTextColor`, with namespaced persistence under `settings.common.conversationDisplay.*`.
- `src/stores/conversationDisplayStore.test.ts` — defaults, clamping, persistence, hydration, no-old-key-read assertion.
- `src/components/Display/DisplaySettingsPopover.tsx` — relocated + renamed popover, with `source` prop and split internal structure (Inner + two store-binding wrappers + `ColorRow` subcomponent).
- `src/components/Display/DisplaySettingsPopover.scss` — relocated + renamed styles; adds `.swatch.custom` styling.
- `src/components/Display/DisplaySettingsPopover.test.tsx` — per-source rendering, preset/setter wiring, "+" chip + debounce, highlight rules.

**Modified files:**
- `src/stores/settingsStore.ts` — remove `conversationFontSize` / `conversationCompactMode` fields, defaults, action interface entries, action implementations, hydration reads, and selector/action hook exports; remove `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX` and `clampConversationFontSize`.
- `src/stores/settingsStore.test.ts` — remove the `conversationFontSize clamping` describe block and its constant imports.
- `src/routes/Home.tsx` — call `useConversationDisplayStore.getState().hydrate()` alongside `useSubtitleStore.getState().hydrate()`.
- `src/components/Subtitle/SubtitleBar.tsx` — change popover import path and pass `source="subtitle"`.
- `src/components/MainPanel/MainPanel.tsx` — switch the four conversation hook imports to come from `conversationDisplayStore`; add new ⚙ button + `<DisplaySettingsPopover source="conversation" />` to `conversation-toolbar`; set the three `--conversation-*` CSS custom properties on `.main-panel-wrapper`.
- `src/components/MainPanel/MainPanel.scss` — `.conversation-display` gets `background: var(--conversation-bg-color, #1f1f1f)`; remove the dead `.message-bubble.user` / `.assistant` / `.participant-source.*` rules and the `.message-bubble.assistant .karaoke-played` override.
- `src/components/MainPanel/ConversationRow.scss` — change `.row-body.playing` from translucent green bg to translation-color box-shadow ring; rename two existing CSS variable references from `--subtitle-source-color` / `--subtitle-translation-color` to `--conversation-source-color` / `--conversation-translation-color`.
- `src/locales/en/translation.json` — relabel `subtitle.settings.bgColor/sourceColor/translationColor` and add `subtitle.settings.customColor` + `mainPanel.displaySettings` keys.

**Deleted files:**
- `src/components/Subtitle/SubtitleSettingsPopover.tsx`
- `src/components/Subtitle/SubtitleSettingsPopover.scss`

---

## Task 1: Create `conversationDisplayStore` (TDD)

**Files:**
- Create: `src/stores/conversationDisplayStore.ts`
- Test: `src/stores/conversationDisplayStore.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/stores/conversationDisplayStore.test.ts` with the full content below:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useConversationDisplayStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
  useConversationDisplayFontSize,
  useConversationDisplayBgColor,
} from './conversationDisplayStore';

const mockSetSetting = vi.fn(async () => ({ success: true }));
const mockGetSetting = vi.fn(async (_key: string, def: unknown) => def);

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: mockGetSetting,
      setSetting: mockSetSetting,
    }),
  },
}));

describe('conversationDisplayStore', () => {
  beforeEach(() => {
    mockSetSetting.mockClear();
    mockGetSetting.mockClear();
    useConversationDisplayStore.setState({
      fontSize: 14,
      compactMode: false,
      bgColor: '#1f1f1f',
      sourceTextColor: '#9aa0a6',
      translationTextColor: '#e8e8e8',
    });
  });

  it('exports CONVERSATION_FONT_SIZE_MIN=12 and CONVERSATION_FONT_SIZE_MAX=64', () => {
    expect(CONVERSATION_FONT_SIZE_MIN).toBe(12);
    expect(CONVERSATION_FONT_SIZE_MAX).toBe(64);
  });

  it('has the documented defaults', () => {
    const s = useConversationDisplayStore.getState();
    expect(s.fontSize).toBe(14);
    expect(s.compactMode).toBe(false);
    expect(s.bgColor).toBe('#1f1f1f');
    expect(s.sourceTextColor).toBe('#9aa0a6');
    expect(s.translationTextColor).toBe('#e8e8e8');
  });

  it('clamps setFontSize to [12, 64]', async () => {
    await useConversationDisplayStore.getState().setFontSize(8);
    expect(useConversationDisplayStore.getState().fontSize).toBe(12);
    await useConversationDisplayStore.getState().setFontSize(99);
    expect(useConversationDisplayStore.getState().fontSize).toBe(64);
    await useConversationDisplayStore.getState().setFontSize(28);
    expect(useConversationDisplayStore.getState().fontSize).toBe(28);
  });

  it('persists each setter under the conversationDisplay namespace', async () => {
    await useConversationDisplayStore.getState().setBgColor('#FFFFFF');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.bgColor',
      '#FFFFFF',
    );
    await useConversationDisplayStore.getState().setSourceTextColor('#000000');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.sourceTextColor',
      '#000000',
    );
    await useConversationDisplayStore.getState().setTranslationTextColor('#003B6F');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.translationTextColor',
      '#003B6F',
    );
    await useConversationDisplayStore.getState().setFontSize(20);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.fontSize',
      20,
    );
    await useConversationDisplayStore.getState().setCompactMode(true);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.compactMode',
      true,
    );
  });

  it('hydrate reads only from settings.common.conversationDisplay.* keys', async () => {
    await useConversationDisplayStore.getState().hydrate();
    const calls = mockGetSetting.mock.calls.map((c) => c[0] as string);
    expect(calls.length).toBeGreaterThan(0);
    for (const key of calls) {
      expect(key.startsWith('settings.common.conversationDisplay.')).toBe(true);
    }
    // Defaults applied since the mock returns the supplied default
    const s = useConversationDisplayStore.getState();
    expect(s.fontSize).toBe(14);
    expect(s.bgColor).toBe('#1f1f1f');
  });

  it('hydrate does NOT read the old conversationFontSize / conversationCompactMode keys', async () => {
    await useConversationDisplayStore.getState().hydrate();
    const calls = mockGetSetting.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain('settings.common.conversationFontSize');
    expect(calls).not.toContain('settings.common.conversationCompactMode');
  });

  it('selector hooks exist', () => {
    expect(typeof useConversationDisplayFontSize).toBe('function');
    expect(typeof useConversationDisplayBgColor).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test -- src/stores/conversationDisplayStore.test.ts`
Expected: FAIL with "Cannot find module './conversationDisplayStore'"

- [ ] **Step 3: Create the store**

Create `src/stores/conversationDisplayStore.ts` with the full content below:

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { ServiceFactory } from '../services/ServiceFactory';

interface ConversationDisplayState {
  // Typography
  fontSize: number;            // clamped [CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX]
  compactMode: boolean;
  // Colors (hex)
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;

  // Actions (async because persistence is async — matches subtitleStore)
  setFontSize: (n: number) => Promise<void>;
  setCompactMode: (b: boolean) => Promise<void>;
  setBgColor: (s: string) => Promise<void>;
  setSourceTextColor: (s: string) => Promise<void>;
  setTranslationTextColor: (s: string) => Promise<void>;

  // Hydration (called once at app boot from src/routes/Home.tsx)
  hydrate: () => Promise<void>;
}

const DEFAULTS = {
  fontSize: 14,
  compactMode: false,
  bgColor: '#1f1f1f',
  sourceTextColor: '#9aa0a6',
  translationTextColor: '#e8e8e8',
};

export const CONVERSATION_FONT_SIZE_MIN = 12;
export const CONVERSATION_FONT_SIZE_MAX = 64;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const KEY = (suffix: string) => `settings.common.conversationDisplay.${suffix}`;

async function persist(
  keySuffix: string,
  value: unknown,
  fieldNameForLog: string,
): Promise<{ ok: boolean }> {
  try {
    await ServiceFactory.getSettingsService().setSetting(KEY(keySuffix), value);
    return { ok: true };
  } catch (error) {
    console.error(`[ConversationDisplayStore] Error persisting ${fieldNameForLog}:`, error);
    return { ok: false };
  }
}

export const useConversationDisplayStore = create<ConversationDisplayState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setFontSize: async (n) => {
      const clamped = clamp(Math.round(n), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX);
      const previous = get().fontSize;
      set({ fontSize: clamped });
      const { ok } = await persist('fontSize', clamped, 'fontSize');
      if (!ok) set({ fontSize: previous });
    },
    setCompactMode: async (b) => {
      const previous = get().compactMode;
      set({ compactMode: b });
      const { ok } = await persist('compactMode', b, 'compactMode');
      if (!ok) set({ compactMode: previous });
    },
    setBgColor: async (s) => {
      const previous = get().bgColor;
      set({ bgColor: s });
      const { ok } = await persist('bgColor', s, 'bgColor');
      if (!ok) set({ bgColor: previous });
    },
    setSourceTextColor: async (s) => {
      const previous = get().sourceTextColor;
      set({ sourceTextColor: s });
      const { ok } = await persist('sourceTextColor', s, 'sourceTextColor');
      if (!ok) set({ sourceTextColor: previous });
    },
    setTranslationTextColor: async (s) => {
      const previous = get().translationTextColor;
      set({ translationTextColor: s });
      const { ok } = await persist('translationTextColor', s, 'translationTextColor');
      if (!ok) set({ translationTextColor: previous });
    },

    hydrate: async () => {
      const svc = ServiceFactory.getSettingsService();
      const [fontSize, compactMode, bgColor, sourceTextColor, translationTextColor] =
        await Promise.all([
          svc.getSetting(KEY('fontSize'), DEFAULTS.fontSize),
          svc.getSetting(KEY('compactMode'), DEFAULTS.compactMode),
          svc.getSetting(KEY('bgColor'), DEFAULTS.bgColor),
          svc.getSetting(KEY('sourceTextColor'), DEFAULTS.sourceTextColor),
          svc.getSetting(KEY('translationTextColor'), DEFAULTS.translationTextColor),
        ]);
      set({
        fontSize: clamp(Math.round(fontSize), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX),
        compactMode,
        bgColor,
        sourceTextColor,
        translationTextColor,
      });
    },
  })),
);

// ──────────── Selector hooks ────────────
export const useConversationDisplayFontSize = () => useConversationDisplayStore((s) => s.fontSize);
export const useConversationDisplayCompactMode = () => useConversationDisplayStore((s) => s.compactMode);
export const useConversationDisplayBgColor = () => useConversationDisplayStore((s) => s.bgColor);
export const useConversationDisplaySourceTextColor = () => useConversationDisplayStore((s) => s.sourceTextColor);
export const useConversationDisplayTranslationTextColor = () => useConversationDisplayStore((s) => s.translationTextColor);

export const useConversationDisplaySettings = () =>
  useConversationDisplayStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      compactMode: s.compactMode,
      bgColor: s.bgColor,
      sourceTextColor: s.sourceTextColor,
      translationTextColor: s.translationTextColor,
    })),
  );

// ──────────── Action hooks ────────────
export const useSetConversationDisplayFontSize = () => useConversationDisplayStore((s) => s.setFontSize);
export const useSetConversationDisplayCompactMode = () => useConversationDisplayStore((s) => s.setCompactMode);
export const useSetConversationDisplayBgColor = () => useConversationDisplayStore((s) => s.setBgColor);
export const useSetConversationDisplaySourceTextColor = () => useConversationDisplayStore((s) => s.setSourceTextColor);
export const useSetConversationDisplayTranslationTextColor = () => useConversationDisplayStore((s) => s.setTranslationTextColor);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test -- src/stores/conversationDisplayStore.test.ts`
Expected: PASS — all 7 test cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/conversationDisplayStore.ts src/stores/conversationDisplayStore.test.ts
git commit -m "feat(stores): add conversationDisplayStore for MainPanel display settings

Mirrors subtitleStore: holds fontSize, compactMode, and three new color
fields, persisted under settings.common.conversationDisplay.*. No
migration from the old settingsStore.conversationFontSize keys; spec
explicitly accepts the one-time reset.

Refs #231"
```

---

## Task 2: Wire `conversationDisplayStore.hydrate()` into app boot

**Files:**
- Modify: `src/routes/Home.tsx:15-26`

- [ ] **Step 1: Read the current hydration block**

Run: `grep -n "useSubtitleStore\|loadSettings\|hydrate" src/routes/Home.tsx | head -10`
Expected: Find the `Promise.all([loadSettings(), useSubtitleStore.getState().hydrate()])` block.

- [ ] **Step 2: Add the new hydrate call**

Edit `src/routes/Home.tsx`. Find the import block at the top of the file (the one importing `useSubtitleStore`) and add the new store import:

```tsx
import { useSubtitleStore } from '../stores/subtitleStore';
import { useConversationDisplayStore } from '../stores/conversationDisplayStore';
```

Then update the Promise.all to include the new hydrate. Find:

```tsx
    Promise.all([
      loadSettings(),
      useSubtitleStore.getState().hydrate(),
    ]).catch((err) => {
      console.warn('[Home] Settings/subtitle hydration error:', err);
    });
```

Replace with:

```tsx
    Promise.all([
      loadSettings(),
      useSubtitleStore.getState().hydrate(),
      useConversationDisplayStore.getState().hydrate(),
    ]).catch((err) => {
      console.warn('[Home] Settings/subtitle/conversationDisplay hydration error:', err);
    });
```

- [ ] **Step 3: Run the test suite to confirm nothing broke**

Run: `npm run test -- src/routes`
Expected: PASS (or no tests for this route — that's also fine; absence of test failure proves the import resolves).

- [ ] **Step 4: Commit**

```bash
git add src/routes/Home.tsx
git commit -m "feat(home): hydrate conversationDisplayStore at app boot

Wires the new store's hydrate() alongside settingsStore and
subtitleStore so MainPanel's persisted display settings are restored
before the panel renders.

Refs #231"
```

---

## Task 3: Update English locale strings

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Locate the current `subtitle.settings` block**

Run: `grep -n "bgOpacity\|bgColor\|sourceColor\|translationColor" src/locales/en/translation.json`
Expected: Four lines reading the four current label strings inside the `subtitle.settings` object.

- [ ] **Step 2: Edit the block**

Find this block in `src/locales/en/translation.json`:

```json
    "settings": {
      "bgOpacity": "Background opacity",
      "bgColor": "Background color",
      "sourceColor": "Source text color",
      "translationColor": "Translation color"
    },
```

Replace with:

```json
    "settings": {
      "bgOpacity": "Background opacity",
      "bgColor": "Display background",
      "sourceColor": "Source text",
      "translationColor": "Translation text",
      "customColor": "Custom color"
    },
```

- [ ] **Step 3: Add the `mainPanel.displaySettings` key**

Run: `grep -n "decreaseFontSize\|increaseFontSize\|compactView" src/locales/en/translation.json | head -5`
Expected: Lines for the existing MainPanel toolbar tooltips.

Find the cluster of `mainPanel.*` font-size and view keys (next to `decreaseFontSize`). Add a new key alongside them, e.g. after `"compactView"`:

```json
      "displaySettings": "Display settings",
```

- [ ] **Step 4: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json'))"`
Expected: No output (silent success). Any parse error means a misplaced comma or brace; fix.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(en): rename color labels and add custom-color/displaySettings keys

- subtitle.settings.bgColor: 'Background color' -> 'Display background'
- subtitle.settings.sourceColor: 'Source text color' -> 'Source text'
- subtitle.settings.translationColor: 'Translation color' -> 'Translation text'
- new subtitle.settings.customColor: 'Custom color' (for the '+' chip aria-label)
- new mainPanel.displaySettings: 'Display settings' (for the new MainPanel cog button)

Other locales fall back to these via the t(key, fallback) defaults; per-locale
translations land separately.

Refs #231"
```

---

## Task 4: Switch MainPanel to use `conversationDisplayStore` for fontSize and compactMode

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:25-30, 129-132` (and any other reference)

- [ ] **Step 1: Read current import block**

Run: `sed -n '20,35p' src/components/MainPanel/MainPanel.tsx`
Expected: Imports including `useConversationFontSize`, `useSetConversationFontSize`, `CONVERSATION_FONT_SIZE_MIN`, `CONVERSATION_FONT_SIZE_MAX`, `useConversationCompactMode`, `useSetConversationCompactMode` from `../../stores/settingsStore`.

- [ ] **Step 2: Update the import block**

Edit `src/components/MainPanel/MainPanel.tsx`. Find the existing settingsStore import block that contains the conversation hooks (lines ~22-40 area) and **remove these specific entries** from it:

```ts
  useConversationFontSize,
  useSetConversationFontSize,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
  useConversationCompactMode,
  useSetConversationCompactMode,
```

Then add a new import block immediately after the settingsStore import:

```ts
import {
  useConversationDisplayFontSize,
  useSetConversationDisplayFontSize,
  useConversationDisplayCompactMode,
  useSetConversationDisplayCompactMode,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../stores/conversationDisplayStore';
```

- [ ] **Step 3: Update the in-component hook calls**

Find lines around 129-132 in `src/components/MainPanel/MainPanel.tsx`:

```tsx
  const conversationFontSize = useConversationFontSize();
  const setConversationFontSize = useSetConversationFontSize();
  const conversationCompactMode = useConversationCompactMode();
  const setConversationCompactMode = useSetConversationCompactMode();
```

Replace with:

```tsx
  const conversationFontSize = useConversationDisplayFontSize();
  const setConversationFontSize = useSetConversationDisplayFontSize();
  const conversationCompactMode = useConversationDisplayCompactMode();
  const setConversationCompactMode = useSetConversationDisplayCompactMode();
```

The local variable names stay the same so no other in-body references need to change.

- [ ] **Step 4: Run the test suite**

Run: `npm run test -- src/components/MainPanel`
Expected: PASS. If a test fails due to missing settingsStore hook, the test mocks need the new store path; resolve by mocking `../../stores/conversationDisplayStore` instead.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors related to MainPanel imports. (Other unrelated errors in the repo, if any, are out of scope.)

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(mainpanel): read fontSize/compactMode from conversationDisplayStore

Switches MainPanel's four conversation display hooks to point at the
new store. settingsStore still owns these fields at this commit; the
removal happens in the next commit (sequenced this way so each commit
keeps the suite green).

Refs #231"
```

---

## Task 5: Remove conversation display fields from `settingsStore`

**Files:**
- Modify: `src/stores/settingsStore.ts` (multiple locations: lines 43-44, 187-195, 203-204, 418-421, 436-437, 912-934, 1472-1474, 1512-1513, 1676-1677, 1730-1731)
- Modify: `src/stores/settingsStore.test.ts` (the `conversationFontSize clamping` describe block + imports)

- [ ] **Step 1: Remove the type interface entries**

Edit `src/stores/settingsStore.ts`. Find this block (around lines 43-44):

```ts
  conversationFontSize: number;
  conversationCompactMode: boolean;
```

Delete both lines.

Find the duplicate in the actions interface (around lines 418-421):

```ts
  // Conversation font size
  conversationFontSize: number;

  // Conversation compact mode — hide chat chrome (avatars, names, timestamps, badges, play button) in the conversation panel
  conversationCompactMode: boolean;
```

Delete all four lines (including the comments and blank line).

Find (around lines 436-437):

```ts
  setConversationFontSize: (size: number) => void;
  setConversationCompactMode: (compact: boolean) => Promise<void>;
```

Delete both lines.

- [ ] **Step 2: Remove constants and helper**

Find (around lines 187-195):

```ts
// ==================== Font Size Constants ====================

export const CONVERSATION_FONT_SIZE_MIN = 12;
export const CONVERSATION_FONT_SIZE_MAX = 64;

const clampConversationFontSize = (n: number): number =>
  Math.max(
    CONVERSATION_FONT_SIZE_MIN,
    Math.min(CONVERSATION_FONT_SIZE_MAX, Math.round(n)),
  );
```

Delete the entire block (heading comment, two `export const`, and the `clampConversationFontSize` function).

- [ ] **Step 3: Remove the default values**

Find (around lines 203-204):

```ts
  conversationFontSize: 14,
  conversationCompactMode: false,
```

Delete both lines.

- [ ] **Step 4: Remove the action implementations**

Find (around lines 912-934, the two consecutive `setConversationFontSize` and `setConversationCompactMode` async function blocks). Delete the entire block:

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

    setConversationCompactMode: async (conversationCompactMode) => {
      const previous = get().conversationCompactMode;
      set({conversationCompactMode});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.conversationCompactMode', conversationCompactMode);
      } catch (error) {
        console.error('[SettingsStore] Error persisting conversationCompactMode setting:', error);
        set({conversationCompactMode: previous});
      }
    },
```

- [ ] **Step 5: Remove hydration reads and setState entries**

Find (around lines 1472-1474):

```ts
        const conversationFontSizeRaw = await service.getSetting('settings.common.conversationFontSize', defaultCommonSettings.conversationFontSize);
        const conversationFontSize = clampConversationFontSize(conversationFontSizeRaw);
        const conversationCompactMode = await service.getSetting('settings.common.conversationCompactMode', defaultCommonSettings.conversationCompactMode);
```

Delete all three lines.

Find (around lines 1512-1513) the `conversationFontSize,` and `conversationCompactMode,` entries inside the `set({ ... })` call within `loadSettings`. Delete both lines.

- [ ] **Step 6: Remove selector and action hook exports**

Find (around lines 1676-1677):

```ts
export const useConversationFontSize = () => useSettingsStore((state) => state.conversationFontSize);
export const useConversationCompactMode = () => useSettingsStore((state) => state.conversationCompactMode);
```

Delete both lines.

Find (around lines 1730-1731):

```ts
export const useSetConversationFontSize = () => useSettingsStore((state) => state.setConversationFontSize);
export const useSetConversationCompactMode = () => useSettingsStore((state) => state.setConversationCompactMode);
```

Delete both lines.

- [ ] **Step 7: Update settingsStore.test.ts — remove the conversationFontSize describe block**

Edit `src/stores/settingsStore.test.ts`. Find the `describe('conversationFontSize clamping', ...)` block (around line 319). Delete the entire describe block (likely 25-40 lines including its `it` cases).

Then remove these unused imports at the top of the file:

```ts
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
```

- [ ] **Step 8: Run the full test suite to confirm nothing else broke**

Run: `npm run test`
Expected: PASS. If any failure references `conversationFontSize` or `useConversationFontSize`, that file still references the deleted symbols; locate and fix (most likely a test fixture or mock).

- [ ] **Step 9: Type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors referencing the removed symbols. If `useConversationFontSize` is referenced anywhere outside `MainPanel.tsx` (already updated in Task 4), update those import sites too.

- [ ] **Step 10: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "refactor(settings): remove conversationFontSize/CompactMode (moved to conversationDisplayStore)

Removes the two fields, their defaults, action interface entries,
async actions, hydration reads, selector/action hook exports, and
the test describe block. The fields now live in conversationDisplayStore
(see prior commit). The old persistence keys (settings.common.conversationFontSize
and ...conversationCompactMode) are abandoned, not migrated.

Refs #231"
```

---

## Task 6: Move and rename popover file (no-behavior-change move)

**Files:**
- Delete: `src/components/Subtitle/SubtitleSettingsPopover.tsx`
- Delete: `src/components/Subtitle/SubtitleSettingsPopover.scss`
- Create: `src/components/Display/DisplaySettingsPopover.tsx` (initial copy of old file with name change + `source` prop hardcoded to `'subtitle'`)
- Create: `src/components/Display/DisplaySettingsPopover.scss` (copy of old SCSS, root class renamed)
- Modify: `src/components/Subtitle/SubtitleBar.tsx:27, 205` (popover import path + JSX)

- [ ] **Step 1: Make the new directory**

Run: `mkdir -p src/components/Display`
Expected: No output. Directory now exists.

- [ ] **Step 2: Use git mv to preserve history**

Run:
```bash
git mv src/components/Subtitle/SubtitleSettingsPopover.tsx src/components/Display/DisplaySettingsPopover.tsx
git mv src/components/Subtitle/SubtitleSettingsPopover.scss src/components/Display/DisplaySettingsPopover.scss
```
Expected: No output. `git status` shows two renames.

- [ ] **Step 3: Update the new SCSS file's root class**

Edit `src/components/Display/DisplaySettingsPopover.scss`. Replace the root selector:

```scss
.subtitle-settings-popover {
```

With:

```scss
.display-settings-popover {
```

That's the only SCSS change in this task; the rest of the styles stay.

- [ ] **Step 4: Update the new TSX file — class name, import path, and add `source` prop**

Edit `src/components/Display/DisplaySettingsPopover.tsx`. Replace the entire file content with:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSubtitleSettings,
  useSetSubtitleBgOpacity,
  useSetSubtitleBgColor,
  useSetSubtitleSourceTextColor,
  useSetSubtitleTranslationTextColor,
} from '../../stores/subtitleStore';
import './DisplaySettingsPopover.scss';

const BG_PRESETS = ['#000000', '#1a1a1a', '#0d2032', '#0f2419', '#FFFFFF', '#2a2a2a'];
const SOURCE_PRESETS = ['#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#9aa0a6', '#FF6B6B'];
const TRANSLATION_PRESETS = ['#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9'];

export interface DisplaySettingsPopoverProps {
  source: 'subtitle' | 'conversation';
}

const DisplaySettingsPopover: React.FC<DisplaySettingsPopoverProps> = ({ source }) => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const setBgOpacity = useSetSubtitleBgOpacity();
  const setBgColor = useSetSubtitleBgColor();
  const setSourceColor = useSetSubtitleSourceTextColor();
  const setTranslationColor = useSetSubtitleTranslationTextColor();

  // Task 7 will add the source='conversation' branch; today this file
  // still serves only the subtitle path.
  if (source !== 'subtitle') {
    return <div className="display-settings-popover" role="dialog" />;
  }

  return (
    <div className="display-settings-popover" role="dialog">
      <div className="field">
        <label>{t('subtitle.settings.bgOpacity', 'Background opacity')} ({subtitle.bgOpacity}%)</label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={subtitle.bgOpacity}
          onChange={(e) => setBgOpacity(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>{t('subtitle.settings.bgColor', 'Display background')}</label>
        <div className="palette">
          {BG_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.bgColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setBgColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('subtitle.settings.sourceColor', 'Source text')}</label>
        <div className="palette">
          {SOURCE_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.sourceTextColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setSourceColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('subtitle.settings.translationColor', 'Translation text')}</label>
        <div className="palette">
          {TRANSLATION_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.translationTextColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setTranslationColor(c)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default DisplaySettingsPopover;
```

Note: this is a transitional file. Task 7 will fully refactor the component into Inner + two wrappers + ColorRow. For this task we only:
- Renamed the component to `DisplaySettingsPopover`.
- Added a `source` prop (subtitle path works; conversation path renders empty as a stub).
- Updated label fallbacks to the new English strings.
- Renamed the root CSS class.

- [ ] **Step 5: Update SubtitleBar.tsx import and usage**

Edit `src/components/Subtitle/SubtitleBar.tsx`. Find:

```tsx
import SubtitleSettingsPopover from './SubtitleSettingsPopover';
```

Replace with:

```tsx
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
```

Then find (around line 205):

```tsx
            <SubtitleSettingsPopover />
```

Replace with:

```tsx
            <DisplaySettingsPopover source="subtitle" />
```

- [ ] **Step 6: Run the test suite**

Run: `npm run test`
Expected: PASS. The subtitle popover behavior is preserved — only the file path and component name changed.

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Display/ src/components/Subtitle/SubtitleBar.tsx
# (the deletes are tracked via git mv)
git commit -m "refactor(popover): rename SubtitleSettingsPopover -> DisplaySettingsPopover and relocate

Pure rename + path change + 'source' prop scaffold. The conversation
branch is a no-op stub; the next commit fills it in. The renamed
labels (Background color -> Display background, etc.) ride along since
they're trivial.

Refs #231"
```

---

## Task 7: Refactor popover into source-aware structure (Inner + wrappers + ColorRow)

**Files:**
- Modify: `src/components/Display/DisplaySettingsPopover.tsx` (full rewrite)

This task introduces the conversation-bound rendering path, the rules-of-hooks-compliant wrapper structure, the new dark color presets, and the "+" custom-color chip with debounced picker. It is a large change but ships as one task because the structure does not work in pieces.

- [ ] **Step 1: Replace `DisplaySettingsPopover.tsx` content**

Edit `src/components/Display/DisplaySettingsPopover.tsx` and replace the full content with:

```tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  useSubtitleBgOpacity,
  useSubtitleBgColor,
  useSubtitleSourceTextColor,
  useSubtitleTranslationTextColor,
  useSetSubtitleBgOpacity,
  useSetSubtitleBgColor,
  useSetSubtitleSourceTextColor,
  useSetSubtitleTranslationTextColor,
} from '../../stores/subtitleStore';
import {
  useConversationDisplayBgColor,
  useConversationDisplaySourceTextColor,
  useConversationDisplayTranslationTextColor,
  useSetConversationDisplayBgColor,
  useSetConversationDisplaySourceTextColor,
  useSetConversationDisplayTranslationTextColor,
} from '../../stores/conversationDisplayStore';
import './DisplaySettingsPopover.scss';

const BG_PRESETS = ['#000000', '#1a1a1a', '#0d2032', '#0f2419', '#FFFFFF', '#2a2a2a'];
const SOURCE_PRESETS = [
  '#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#9aa0a6', '#FF6B6B',
  '#000000', '#003B6F', '#1B5E20',
];
const TRANSLATION_PRESETS = [
  '#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9',
  '#000000', '#003B6F', '#7B1FA2',
];

const PICKER_DEBOUNCE_MS = 150;

type Source = 'subtitle' | 'conversation';

export interface DisplaySettingsPopoverProps {
  source: Source;
}

interface InnerBindings {
  bgOpacity: number | undefined;
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;
  setBgOpacity: ((n: number) => Promise<void>) | undefined;
  setBgColor: (s: string) => Promise<void>;
  setSourceTextColor: (s: string) => Promise<void>;
  setTranslationTextColor: (s: string) => Promise<void>;
}

const DisplaySettingsPopover: React.FC<DisplaySettingsPopoverProps> = ({ source }) =>
  source === 'subtitle' ? <SubtitleBoundPopover /> : <ConversationBoundPopover />;

export default DisplaySettingsPopover;

// ──────────── Source-bound wrappers ────────────
// Each wrapper subscribes ONLY to its own store. This keeps the rules
// of hooks satisfied: hooks are always called in the same order within
// a given wrapper component.

const SubtitleBoundPopover: React.FC = () => {
  const bindings: InnerBindings = {
    bgOpacity: useSubtitleBgOpacity(),
    bgColor: useSubtitleBgColor(),
    sourceTextColor: useSubtitleSourceTextColor(),
    translationTextColor: useSubtitleTranslationTextColor(),
    setBgOpacity: useSetSubtitleBgOpacity(),
    setBgColor: useSetSubtitleBgColor(),
    setSourceTextColor: useSetSubtitleSourceTextColor(),
    setTranslationTextColor: useSetSubtitleTranslationTextColor(),
  };
  return <DisplaySettingsPopoverInner bindings={bindings} />;
};

const ConversationBoundPopover: React.FC = () => {
  const bindings: InnerBindings = {
    bgOpacity: undefined,
    bgColor: useConversationDisplayBgColor(),
    sourceTextColor: useConversationDisplaySourceTextColor(),
    translationTextColor: useConversationDisplayTranslationTextColor(),
    setBgOpacity: undefined,
    setBgColor: useSetConversationDisplayBgColor(),
    setSourceTextColor: useSetConversationDisplaySourceTextColor(),
    setTranslationTextColor: useSetConversationDisplayTranslationTextColor(),
  };
  return <DisplaySettingsPopoverInner bindings={bindings} />;
};

// ──────────── Pure presentational inner ────────────

const DisplaySettingsPopoverInner: React.FC<{ bindings: InnerBindings }> = ({ bindings }) => {
  const { t } = useTranslation();
  const includeOpacity =
    bindings.bgOpacity !== undefined && bindings.setBgOpacity !== undefined;

  return (
    <div className="display-settings-popover" role="dialog">
      {includeOpacity && (
        <div className="field">
          <label>
            {t('subtitle.settings.bgOpacity', 'Background opacity')} ({bindings.bgOpacity}%)
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={bindings.bgOpacity}
            onChange={(e) => bindings.setBgOpacity!(Number(e.target.value))}
          />
        </div>
      )}

      <ColorRow
        labelKey="subtitle.settings.bgColor"
        labelDefault="Display background"
        presets={BG_PRESETS}
        value={bindings.bgColor}
        onChange={bindings.setBgColor}
      />
      <ColorRow
        labelKey="subtitle.settings.sourceColor"
        labelDefault="Source text"
        presets={SOURCE_PRESETS}
        value={bindings.sourceTextColor}
        onChange={bindings.setSourceTextColor}
      />
      <ColorRow
        labelKey="subtitle.settings.translationColor"
        labelDefault="Translation text"
        presets={TRANSLATION_PRESETS}
        value={bindings.translationTextColor}
        onChange={bindings.setTranslationTextColor}
      />
    </div>
  );
};

// ──────────── Reusable row with presets + custom chip ────────────

interface ColorRowProps {
  labelKey: string;
  labelDefault: string;
  presets: readonly string[];
  value: string;
  onChange: (s: string) => Promise<void>;
}

const ColorRow: React.FC<ColorRowProps> = ({
  labelKey,
  labelDefault,
  presets,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const valueLower = value.toLowerCase();
  const isCustom = !presets.some((p) => p.toLowerCase() === valueLower);

  // Debounce the high-frequency change events emitted while the user
  // drags inside the OS color picker.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPickerChange = useCallback(
    (next: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(next);
      }, PICKER_DEBOUNCE_MS);
    },
    [onChange],
  );
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div className="field">
      <label>{t(labelKey, labelDefault)}</label>
      <div className="palette">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            className={`swatch ${valueLower === c.toLowerCase() ? 'selected' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <label
          className={`swatch custom ${isCustom ? 'selected' : ''}`}
          style={{ background: value }}
          title={t('subtitle.settings.customColor', 'Custom color')}
          aria-label={t('subtitle.settings.customColor', 'Custom color')}
        >
          <Plus size={10} />
          <input
            type="color"
            value={value}
            onChange={(e) => onPickerChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run tests to confirm subtitle path still works**

Run: `npm run test`
Expected: PASS. The subtitle popover behavior is functionally unchanged from the user's perspective — just newly factored. (No popover-specific tests exist yet; they land in Task 9.)

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Display/DisplaySettingsPopover.tsx
git commit -m "feat(popover): split into source wrappers, add dark presets and '+' picker

- DisplaySettingsPopover dispatches by source prop to one of two
  wrappers (SubtitleBoundPopover, ConversationBoundPopover) that each
  call only their own store's hooks (rules of hooks satisfied).
- Inner presentational component takes resolved bindings as props.
- ColorRow subcomponent renders the chip palette plus a '+' custom
  chip with a hidden <input type=color>, debounced 150ms.
- Source/translation rows gain three dark presets each:
    SOURCE: #000000, #003B6F, #1B5E20
    TRANSLATION: #000000, #003B6F, #7B1FA2
- Conversation source path now reads/writes conversationDisplayStore.

Refs #231"
```

---

## Task 8: Update DisplaySettingsPopover SCSS for `.swatch.custom`

**Files:**
- Modify: `src/components/Display/DisplaySettingsPopover.scss`

- [ ] **Step 1: Replace the file content**

Edit `src/components/Display/DisplaySettingsPopover.scss`. Replace the full content with:

```scss
.display-settings-popover {
  background: #1a1a1a;
  color: #e8e8e8;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 16px;
  width: 280px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);

  .field {
    margin-bottom: 12px;

    label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: #c8c8c8;
    }

    input[type="range"] {
      width: 100%;
    }

    .palette {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;

      .swatch {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        padding: 0;
        position: relative;

        &.selected {
          border-color: #10a37f;
        }

        // Custom-color chip: a <label> wrapping a hidden <input type="color">.
        // The chip's background reflects the current chosen color so it
        // doubles as a "current value" indicator. The Plus icon is rendered
        // in white with a thin dark outline so it stays legible regardless
        // of the chip background.
        &.custom {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9));

          input[type="color"] {
            position: absolute;
            inset: 0;
            opacity: 0;
            cursor: pointer;
            border: none;
            padding: 0;
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Manual visual sanity check**

Run: `npm run dev`
Expected: Dev server starts on port 5173. Open the app, enter subtitle mode, click the ⚙ icon. Expected popover layout: opacity slider on top (subtitle source), then three rows of color chips. Each row ends in a circular "+" chip showing the current color with a small white plus glyph. Clicking the "+" opens the OS color picker. (Stop the dev server with Ctrl-C after a quick check.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Display/DisplaySettingsPopover.scss
git commit -m "style(popover): add .swatch.custom for the '+' custom-color chip

Circular chip backed by current value; hidden <input type=color>
covers the chip footprint so any click opens the OS picker. Plus
icon rendered white with a thin drop-shadow for legibility on any
chip background.

Refs #231"
```

---

## Task 9: Add `DisplaySettingsPopover` tests

**Files:**
- Create: `src/components/Display/DisplaySettingsPopover.test.tsx`

- [ ] **Step 1: Write the test file**

Create `src/components/Display/DisplaySettingsPopover.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import DisplaySettingsPopover from './DisplaySettingsPopover';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

describe('DisplaySettingsPopover', () => {
  beforeEach(() => {
    // Reset both stores to known starting state
    useSubtitleStore.setState({
      bgColor: '#000000',
      sourceTextColor: '#FFFFFF',
      translationTextColor: '#6CC5FF',
      bgOpacity: 80,
    } as Partial<ReturnType<typeof useSubtitleStore.getState>> as never);
    useConversationDisplayStore.setState({
      bgColor: '#1f1f1f',
      sourceTextColor: '#9aa0a6',
      translationTextColor: '#e8e8e8',
    } as Partial<ReturnType<typeof useConversationDisplayStore.getState>> as never);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders opacity slider when source=subtitle', () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('does NOT render opacity slider when source=conversation', () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it('clicking a preset chip in subtitle mode updates only subtitleStore', async () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    const whiteChip = container.querySelector(
      'button.swatch[aria-label="#FFFFFF"]',
    ) as HTMLButtonElement;
    expect(whiteChip).not.toBeNull();
    await act(async () => { fireEvent.click(whiteChip); });
    expect(useSubtitleStore.getState().bgColor).toBe('#FFFFFF');
    expect(useConversationDisplayStore.getState().bgColor).toBe('#1f1f1f');
  });

  it('clicking a preset chip in conversation mode updates only conversationDisplayStore', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const whiteChip = container.querySelector(
      'button.swatch[aria-label="#FFFFFF"]',
    ) as HTMLButtonElement;
    await act(async () => { fireEvent.click(whiteChip); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#FFFFFF');
    expect(useSubtitleStore.getState().bgColor).toBe('#000000');
  });

  it('clicking the new dark source-text preset updates the source color', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // The new "#1B5E20" deep-forest chip is in the SOURCE row only.
    const allChips = container.querySelectorAll('button.swatch[aria-label="#1B5E20"]');
    expect(allChips.length).toBe(1);
    await act(async () => { fireEvent.click(allChips[0] as HTMLButtonElement); });
    expect(useConversationDisplayStore.getState().sourceTextColor).toBe('#1B5E20');
  });

  it('preset chip is selected when current value matches', () => {
    useConversationDisplayStore.setState({ bgColor: '#000000' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const blackChip = container.querySelector('button.swatch[aria-label="#000000"]');
    expect(blackChip?.classList.contains('selected')).toBe(true);
    const customChip = container.querySelector('label.swatch.custom');
    expect(customChip?.classList.contains('selected')).toBe(false);
  });

  it('"+" chip is selected when current value is not in the row presets', () => {
    useConversationDisplayStore.setState({ bgColor: '#abcdef' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // BG row's custom chip
    const customChips = container.querySelectorAll('label.swatch.custom');
    expect(customChips.length).toBe(3);
    expect(customChips[0].classList.contains('selected')).toBe(true);
  });

  it('debounces "+" chip color picker changes by ~150ms (only last value applied)', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // The first custom chip's hidden input is the BG row's picker.
    const colorInput = container.querySelector(
      'label.swatch.custom input[type="color"]',
    ) as HTMLInputElement;
    expect(colorInput).not.toBeNull();

    fireEvent.change(colorInput, { target: { value: '#aaaaaa' } });
    fireEvent.change(colorInput, { target: { value: '#bbbbbb' } });
    fireEvent.change(colorInput, { target: { value: '#cccccc' } });

    // Before debounce window: setter NOT called yet
    expect(useConversationDisplayStore.getState().bgColor).toBe('#1f1f1f');

    // Advance past the 150ms debounce
    await act(async () => { vi.advanceTimersByTime(160); });

    // After debounce: only the LAST value applied
    expect(useConversationDisplayStore.getState().bgColor).toBe('#cccccc');
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `npm run test -- src/components/Display/DisplaySettingsPopover.test.tsx`
Expected: PASS — all 8 cases pass. If a case fails:
- "rendered opacity slider when source=conversation" — verify the inner component's `includeOpacity` check is `bindings.bgOpacity !== undefined && bindings.setBgOpacity !== undefined`.
- preset chip click test fails with no setter call — verify `onClick={() => onChange(c)}` is on the chip button.
- debounce test fails — verify `useFakeTimers` is called before render, and `act(async)` is used for `advanceTimersByTime`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Display/DisplaySettingsPopover.test.tsx
git commit -m "test(popover): cover both source variants, presets, custom chip, debounce

8 cases: opacity-slider visibility per source, preset clicks scoped to
the right store, new dark preset added to source row, preset/custom
highlight rules, debounced custom-color picker keeps only the last
value of a rapid sequence.

Refs #231"
```

---

## Task 10: Add ⚙ button + popover to MainPanel `conversation-toolbar`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports near line 1-90; new state near line 130; new JSX near line 2980, after the existing clear button)

- [ ] **Step 1: Verify the @floating-ui imports already exist**

Run: `grep -n "@floating-ui/react\|FloatingPortal\|useFloating" src/components/MainPanel/MainPanel.tsx | head -5`
Expected: One or more matches. If MainPanel doesn't import these yet, also add the import in the next step.

- [ ] **Step 2: Add new imports**

Edit `src/components/MainPanel/MainPanel.tsx`. Find the `lucide-react` import block. Add `Settings` to the existing destructured imports if not present. Example:

```tsx
import { /* ... existing icons ..., */ Settings } from 'lucide-react';
```

Find the `@floating-ui/react` import. If it doesn't exist, add at the top alongside other lib imports:

```tsx
import {
  useFloating, useClick, useDismiss, useInteractions, offset, flip, FloatingPortal,
} from '@floating-ui/react';
```

If it does exist, ensure the destructure includes all these names; add any missing.

Add the popover import below the other component imports:

```tsx
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
```

- [ ] **Step 3: Add popover state at the top of the component body**

Find the existing `useState` calls at the top of the MainPanel component body (around lines 126-200). Add this block in the same area, after the other state initialisations:

```tsx
  // Display settings popover (conversation-toolbar ⚙)
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);
  const displayPopoverFloating = useFloating({
    open: displayPopoverOpen,
    onOpenChange: setDisplayPopoverOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip()],
  });
  const displayPopoverInteractions = useInteractions([
    useClick(displayPopoverFloating.context),
    useDismiss(displayPopoverFloating.context),
  ]);
```

(Naming the bundles `displayPopover*` keeps them obviously associated and doesn't collide with any existing local names.)

- [ ] **Step 4: Add the ⚙ button to `conversation-toolbar`**

Find the `<div className="conversation-toolbar">` JSX block (around line 2923). Locate the existing `clear-conversation-btn` (around line 2986). Add a new button **before** the clear button:

```tsx
            <button
              className="font-size-btn"
              ref={displayPopoverFloating.refs.setReference}
              {...displayPopoverInteractions.getReferenceProps()}
              title={t('mainPanel.displaySettings', 'Display settings')}
              aria-label={t('mainPanel.displaySettings', 'Display settings')}
              type="button"
            >
              <Settings size={14} />
            </button>
```

Reusing the `font-size-btn` class keeps the visual style identical to the other toolbar icon buttons; introducing a new class is unnecessary.

- [ ] **Step 5: Add the FloatingPortal popover**

Immediately after the closing `</div>` of `conversation-toolbar` (around line 2995), add the popover render:

```tsx
            {displayPopoverOpen && (
              <FloatingPortal>
                <div
                  ref={displayPopoverFloating.refs.setFloating}
                  style={displayPopoverFloating.floatingStyles}
                  {...displayPopoverInteractions.getFloatingProps()}
                >
                  <DisplaySettingsPopover source="conversation" />
                </div>
              </FloatingPortal>
            )}
```

- [ ] **Step 6: Run the test suite**

Run: `npm run test`
Expected: PASS. The new button and popover JSX shouldn't break any existing tests; if a snapshot test exists for MainPanel and fails, update the snapshot (the change is intentional).

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 8: Manual visual sanity check**

Run: `npm run dev`
Expected: Open the app, start a session (or load a previous conversation if items exist), confirm a new ⚙ button appears at the right end of the conversation toolbar (just before the trash icon). Click it — the same popover from subtitle mode opens, but **without** the opacity slider. Click any color preset; the conversation panel updates while the subtitle window (if visible) does not. Stop the dev server with Ctrl-C.

- [ ] **Step 9: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(mainpanel): add ⚙ display-settings entry on conversation-toolbar

New cog button at the end of the toolbar (before clear). Opens
DisplaySettingsPopover bound to source='conversation' via @floating-ui.
Hidden when there are no items / no session, same gating as the rest
of the toolbar.

Refs #231"
```

---

## Task 11: Apply `--conversation-*` CSS variables on `.main-panel-wrapper`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports near top; hooks near line 130; root JSX near line 2917)

- [ ] **Step 1: Add the new selector hooks to imports**

Edit `src/components/MainPanel/MainPanel.tsx`. Find the `conversationDisplayStore` import added in Task 4 and add the three color selector hooks:

```tsx
import {
  useConversationDisplayFontSize,
  useSetConversationDisplayFontSize,
  useConversationDisplayCompactMode,
  useSetConversationDisplayCompactMode,
  useConversationDisplayBgColor,
  useConversationDisplaySourceTextColor,
  useConversationDisplayTranslationTextColor,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../stores/conversationDisplayStore';
```

- [ ] **Step 2: Read the three color values in the component body**

Find the four conversation hook calls added in Task 4 (around line 129-132 area). Add three more lines after them:

```tsx
  const conversationBgColor = useConversationDisplayBgColor();
  const conversationSourceTextColor = useConversationDisplaySourceTextColor();
  const conversationTranslationTextColor = useConversationDisplayTranslationTextColor();
```

- [ ] **Step 3: Set the CSS variables on `.main-panel-wrapper`**

Find the root JSX element of MainPanel (around line 2917):

```tsx
    <div className="main-panel-wrapper">
```

Replace with:

```tsx
    <div
      className="main-panel-wrapper"
      style={{
        '--conversation-bg-color': conversationBgColor,
        '--conversation-source-color': conversationSourceTextColor,
        '--conversation-translation-color': conversationTranslationTextColor,
      } as React.CSSProperties}
    >
```

- [ ] **Step 4: Run the test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(mainpanel): expose conversation color CSS variables on wrapper

Sets --conversation-bg-color, --conversation-source-color, and
--conversation-translation-color from the conversationDisplayStore on
.main-panel-wrapper so .conversation-display and ConversationRow
descendants can consume them.

Refs #231"
```

---

## Task 12: Update MainPanel.scss — `.conversation-display` background + dead-code cleanup

**Files:**
- Modify: `src/components/MainPanel/MainPanel.scss` (lines ~24, 127-180, 244-247)

- [ ] **Step 1: Add background to `.conversation-display`**

Edit `src/components/MainPanel/MainPanel.scss`. Find:

```scss
.conversation-display {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 12px 12px;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  position: relative;
```

Add this line directly after `position: relative;` and before the `&::-webkit-scrollbar` block:

```scss
  background: var(--conversation-bg-color, #1f1f1f);
```

- [ ] **Step 2: Remove the dead `.message-bubble.user` block**

Find this block (around line 127):

```scss
  &.user {
    align-self: flex-end;
    background: #2a2a2a;
    margin-left: auto;
    border-bottom-right-radius: 4px;

    &.playing {
      background: #353535;
      box-shadow: 0 0 10px rgba(16, 163, 127, 0.3);
    }
  }
```

Delete the entire block including the trailing blank line.

- [ ] **Step 3: Remove the dead `.message-bubble.assistant` block**

Find this block (around line 140):

```scss
  &.assistant {
    align-self: flex-start;
    background: #10a37f;
    margin-right: auto;
    border-bottom-left-radius: 4px;

    &.playing {
      background: #12b88f;
      box-shadow: 0 0 10px rgba(16, 163, 127, 0.5);
    }
  }
```

Delete the entire block including the trailing blank line.

- [ ] **Step 4: Remove the dead `.message-bubble.participant-source` block**

Find this block (around line 165):

```scss
  // ── Participant source (orange) ──

  &.participant-source {
    border-left: 3px solid #f39c12;

    &.user {
      background: rgba(243, 156, 18, 0.15);
      &.playing { background: rgba(243, 156, 18, 0.25); box-shadow: 0 0 10px rgba(243, 156, 18, 0.3); }
    }

    &.assistant {
      background: #e67e22;
      &.playing { background: #f39c12; box-shadow: 0 0 10px rgba(243, 156, 18, 0.5); }
    }
  }
```

Delete the entire block, including the `// ── Participant source (orange) ──` heading comment line and the trailing blank line.

- [ ] **Step 5: Remove the `.message-bubble.assistant .karaoke-played` override**

Find (around line 244):

```scss
// Assistant bubble (green bg) → white highlight
.message-bubble.assistant .karaoke-played {
  color: #fff;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}
```

Delete the entire block including the heading comment.

- [ ] **Step 6: Sanity-grep for stragglers**

Run: `grep -n "message-bubble.user\|message-bubble.assistant\|message-bubble.participant-source\|\\.message-bubble \\.karaoke" src/components/MainPanel/MainPanel.scss`
Expected: No output (all dead-code rules removed). If output remains, delete those rules too.

- [ ] **Step 7: Build to confirm SCSS still compiles**

Run: `npm run build`
Expected: Build succeeds. If SCSS errors appear, the deletions left a dangling `}` or selector — re-read MainPanel.scss in the area you edited and fix balance.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.scss
git commit -m "feat(mainpanel-scss): theme conversation-display bg; drop dead message-bubble rules

- .conversation-display gets background: var(--conversation-bg-color, #1f1f1f)
- removes .message-bubble.user/.assistant/.participant-source.user/.assistant
  rules (and their .playing variants) plus the .message-bubble.assistant
  .karaoke-played override; MainPanel.tsx hasn't rendered these classes
  for conversation rows since the move to <ConversationRow>, so they
  were dead.
- .message-bubble.error and .message-bubble.system stay; those are
  still rendered for error / tool-call rows.

Refs #231"
```

---

## Task 13: Update ConversationRow.scss — playing ring + CSS variable rename

**Files:**
- Modify: `src/components/MainPanel/ConversationRow.scss:60-78, 110-121`

- [ ] **Step 1: Update `.row-body.playing` to use a translation-color ring**

Edit `src/components/MainPanel/ConversationRow.scss`. Find this block (around lines 60-78):

```scss
.row-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 2px 30px; // indent so the line aligns under the name, avatar reserves space
  line-height: 1.4;
  font-size: var(--conversation-font-size, 14px);
  transition: background-color 0.3s ease;

  .conversation-row.grouped & {
    padding-left: 30px;
  }

  &.playing {
    background: rgba(16, 163, 127, 0.1);
    border-radius: 4px;
  }
}
```

Replace with:

```scss
.row-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 2px 30px; // indent so the line aligns under the name, avatar reserves space
  line-height: 1.4;
  font-size: var(--conversation-font-size, 14px);
  transition: box-shadow 0.15s ease, border-radius 0.15s ease;

  .conversation-row.grouped & {
    padding-left: 30px;
  }

  &.playing {
    box-shadow: 0 0 0 1px var(--conversation-translation-color, #10a37f);
    border-radius: 4px;
  }
}
```

The transition was animating `background-color` for the now-removed playing background; switching it to `box-shadow / border-radius` matches the new ring effect.

- [ ] **Step 2: Rename two CSS variable references**

Find (around lines 110-121):

```scss
.row-text {
  overflow-wrap: anywhere;

  &.src {
    color: var(--subtitle-source-color, #9aa0a6);
    font-style: italic;
  }

  &.tr {
    color: var(--subtitle-translation-color, #e8e8e8);
  }
}
```

Replace with:

```scss
.row-text {
  overflow-wrap: anywhere;

  &.src {
    color: var(--conversation-source-color, #9aa0a6);
    font-style: italic;
  }

  &.tr {
    color: var(--conversation-translation-color, #e8e8e8);
  }
}
```

- [ ] **Step 3: Sanity-grep for any remaining `--subtitle-*` references in MainPanel scope**

Run: `grep -rn "subtitle-source-color\|subtitle-translation-color" src/components/MainPanel/`
Expected: No output. (`--subtitle-*` names live only under `src/components/Subtitle/`.)

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npm run test`
Expected: Build succeeds; all tests pass.

- [ ] **Step 5: Manual visual verification**

Run: `npm run dev`
Expected:
1. Start a session, get some conversation rows.
2. Click conversation toolbar's ⚙, choose a white background and black source/translation text. The conversation panel should turn white with black text.
3. Click a row's play button — instead of a translucent green box, the row should be ringed by a 1-px line in the chosen translation color.
4. Open subtitle mode, the subtitle window's colors should be unaffected by step 2's choice.

Stop the dev server with Ctrl-C after the check.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/ConversationRow.scss
git commit -m "feat(conversation-row): theme via --conversation-* and use ring for playing state

- .row-body.playing changes from translucent green bg to a 1px
  box-shadow ring in --conversation-translation-color, which stays
  visible against any background color the user picks.
- .row-text.src / .tr now consume --conversation-source-color /
  --conversation-translation-color instead of the previous --subtitle-*
  names. ConversationRow only renders inside MainPanel, so this
  rename has no other consumers.

Refs #231"
```

---

## Task 14: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS for all suites. Note any new failures and resolve before proceeding.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit -p .`
Expected: No errors. If errors reference any of the removed `useConversationFontSize` / `useConversationCompactMode` / `CONVERSATION_FONT_SIZE_*` from `settingsStore`, find and update the importing site.

- [ ] **Step 3: Build the project**

Run: `npm run build`
Expected: Build succeeds. SCSS validation runs as part of the build.

- [ ] **Step 4: Sanity grep for orphaned references**

Run:
```bash
grep -rn "SubtitleSettingsPopover" src/ --include="*.tsx" --include="*.ts"
grep -rn "useConversationFontSize\b\|useConversationCompactMode\b" src/ --include="*.tsx" --include="*.ts" | grep -v conversationDisplayStore | grep -v "\\.test\\."
grep -rn "settings.common.conversationFontSize\|settings.common.conversationCompactMode" src/ --include="*.tsx" --include="*.ts"
grep -rn "subtitle-source-color\|subtitle-translation-color" src/components/MainPanel/
```
Expected: All four greps produce **no output**.

- [ ] **Step 5: Manual end-to-end smoke test**

Run: `npm run dev`

Verify in the browser:
1. **Subtitle popover entry point**: enter subtitle mode → click ⚙ → confirm popover opens with opacity slider, three color rows (each with new presets visible at the end of source/translation rows), and a "+" custom-color chip at the end of every row.
2. **Conversation popover entry point**: in MainPanel toolbar, click the new ⚙ → confirm popover opens **without** opacity slider; otherwise identical layout.
3. **Independent stores**: pick black bg in subtitle popover; pick white bg in conversation popover. Confirm both surfaces show their own choice and neither is overwritten by the other.
4. **Custom color**: click any "+" chip → OS color picker opens → pick a non-preset color → that color applies to the surface, the other "+" chip swatches keep showing the current value of their own field, and the previously highlighted preset chip is unhighlighted.
5. **Reset behavior**: pick a custom color, restart the app (or close + reopen). The custom color persists.
6. **Default reset of font size**: open the app on a profile that previously had `conversationFontSize !== 14`. Confirm font size shows 14 (the documented persistence reset). Adjust via toolbar buttons; confirm the new value persists across a restart (now stored under the new namespace).
7. **Playing ring**: in MainPanel, click play on a row. Confirm the ring (1px translation-color) shows around the row body, not a translucent green background.

Stop the dev server with Ctrl-C.

- [ ] **Step 6: Final commit (if any straggler changes from Step 5 manual fixes)**

```bash
git status
# If any files were touched in Step 5 fixes:
git add -A
git commit -m "chore(231): wrap-up fixes from manual smoke test

[describe specific issues found and fixed]

Refs #231"
```

If no fixes needed, skip this step.

- [ ] **Step 7: Show the final log**

Run: `git log --oneline main..HEAD`
Expected: 12-13 commits, all prefixed with `feat(...)`, `refactor(...)`, `i18n(...)`, `test(...)`, `style(...)`, or `chore(...)`, ending with `Refs #231`.

---

## Spec Coverage Self-Review (run after all tasks done)

Spec sections vs tasks (manual cross-check):

- ✅ **Conversation popover entry point at conversation-toolbar ⚙** — Task 10
- ✅ **Subtitle popover entry point at subtitle bar ⚙** — preserved by Task 6
- ✅ **`source: 'subtitle' | 'conversation'` prop with two wrappers + Inner** — Task 7
- ✅ **Opacity slider only when source=subtitle** — Task 7
- ✅ **New dark presets on source row** (`#000000`, `#003B6F`, `#1B5E20`) — Task 7
- ✅ **New dark presets on translation row** (`#000000`, `#003B6F`, `#7B1FA2`) — Task 7
- ✅ **"+" custom-color chip on every row with debounced OS picker** — Tasks 7-8
- ✅ **Highlight rules: preset chip when value matches; "+" chip when not** — Task 7 + tested in Task 9
- ✅ **Updated label strings (Display background / Source text / Translation text)** — Tasks 3 (i18n) + 7 (fallbacks)
- ✅ **`subtitle.settings.customColor` i18n key** — Task 3
- ✅ **`mainPanel.displaySettings` i18n key** — Task 3
- ✅ **MainPanel reads colors from `conversationDisplayStore`** — Task 11
- ✅ **`.conversation-display` background follows `--conversation-bg-color`** — Task 12
- ✅ **`.row-body.playing` becomes a 1px translation-color ring** — Task 13
- ✅ **`--subtitle-*` → `--conversation-*` rename in ConversationRow.scss** — Task 13
- ✅ **Dead code cleanup of `.message-bubble.user/.assistant/.participant-source`** — Task 12
- ✅ **New `conversationDisplayStore` with all 5 fields** — Task 1
- ✅ **`conversationFontSize` / `conversationCompactMode` removed from settingsStore** — Task 5
- ✅ **No persistence migration; old keys abandoned** — Task 1 (test asserts no read of old keys), Task 5 (no rewrite logic)
- ✅ **Subtitle store / window / overlay completely unchanged** — only Task 6 touches subtitle bar's import line
- ✅ **`subtitleStore.bgColor` default unchanged at `#000000`** — verified by absence of any task touching `subtitleStore.ts`
- ✅ **Boot-time hydration call** — Task 2
- ✅ **Tests** — Task 1 (store), Task 9 (popover)
- ⚠️ **Spec mentions a MainPanel test asserting the three `--conversation-*` CSS custom properties on the wrapper** — intentionally omitted from this plan. There is no existing `MainPanel.test.tsx` to extend (only `ConversationRow.test.tsx`, which renders below the wrapper). Adding a brand-new render test for MainPanel just to assert `style={{...}}` props is testing React itself; the manual smoke test in Task 14 step 5 verifies the user-visible behavior end-to-end (subtitle vs conversation independence, default reset, ring playing state). If a follow-up wants this assertion, the simplest landing is to add it to the existing `ConversationRow.test.tsx` after wrapping the row in a small test harness that mounts a `<div style="--conversation-bg-color: ..."></div>` parent.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-14-more-color-options.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
