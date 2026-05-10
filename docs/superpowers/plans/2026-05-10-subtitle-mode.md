# Subtitle Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the floating-subtitle surface for the Electron app described in `docs/superpowers/specs/2026-05-10-subtitle-mode-design.md` — a single `BrowserWindow` that switches between a normal mode (custom title bar + opaque background) and a subtitle mode (no title bar, translucent floating bar at the bottom of the screen, always-on-top).

**Architecture:** Single Electron `BrowserWindow` created with `frame: false, transparent: true, hasShadow: true`. A new `subtitleModeActive` runtime flag drives a render fork at `MainLayout`: in normal mode the app shows a custom `TitleBar` plus the existing main content; in subtitle mode it shows `SubtitleApp`. Mode changes call `subtitle:*` IPC channels that `setBounds` / `setAlwaysOnTop` / `setResizable` on the same window — the window is never recreated.

**Tech Stack:** Electron 40.8.5, React + TypeScript + Zustand (`subscribeWithSelector`), Vitest + jsdom, Floating UI (`@floating-ui/react`), lucide-react icons, SCSS.

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `src/utils/clampToScreen.ts` | Pure function clamping a `Bounds` rect to a `WorkArea` rect (used by main process and renderer). |
| `src/utils/clampToScreen.test.ts` | Unit tests for the above. |
| `electron/subtitle-window.js` | Subtitle IPC handlers; debounced `bounds-changed` emitter; references `mainWindow`. |
| `src/components/TitleBar/TitleBar.tsx` + `.scss` | 30-px custom system-style title bar with platform-branched layout (macOS hiddenInset vs Win/Linux custom min/max/close). |
| `src/components/Subtitle/SubtitleApp.tsx` + `.scss` | Subtitle root: applies CSS variables, owns ESC and auto-hide, listens to `subtitle:window-bounds-changed`. |
| `src/components/Subtitle/SubtitleBar.tsx` + `.scss` | Three-segment top bar (Left / Center / Right). Drag region with no-drag children. Fade-out via `--bar-opacity`. |
| `src/components/Subtitle/SubtitleStream.tsx` + `.scss` | Renders filtered conversation items via `ConversationRow`; sticks to scroll bottom. |
| `src/components/Subtitle/SubtitleStream.test.tsx` | jsdom render test for filter behavior. |
| `src/components/Subtitle/SubtitleSettingsPopover.tsx` + `.scss` | Floating UI popover with bg opacity slider, bg-color palette, source-color palette, translation-color palette. |
| `src/components/Subtitle/SubtitleSessionEnded.tsx` | "Session ended" placeholder + return-to-main button. |
| `src/components/Subtitle/SubtitleSessionEnded.test.tsx` | Click test for the return button. |
| `src/components/Subtitle/SubtitleEnterButton.tsx` | Icon button placed in `MainPanel` toolbar; disabled until session is active. |
| `docs/superpowers/specs/2026-05-10-subtitle-mode-manual-test.md` | Cross-platform manual test plan (~30 cases). |

### Modified

| File | Change |
|---|---|
| `electron/main.js` (line 248 onward) | `mainWindow` constructor gains `frame: false, transparent: true, hasShadow: true, backgroundColor: '#00000000'`; new `window:*` IPC handlers; calls `setupSubtitleHandlers(mainWindow)`. |
| `electron/preload.js` (line 100 onward) | Adds `subtitle:enter`, `subtitle:exit`, `subtitle:set-always-on-top`, `subtitle:set-locked`, `subtitle:get-screen-bounds`, `window:minimize`, `window:maximize-toggle`, `window:close` to the `invoke` whitelist; adds `subtitle:window-bounds-changed` to `validReceiveChannels`. |
| `src/stores/settingsStore.ts` | New `SubtitleSettings` interface, `defaultSubtitleSettings`, `subtitleModeActive` runtime flag, persistence-load block in `loadSettings`, setter actions, selector hooks. |
| `src/components/MainLayout/MainLayout.tsx` | Conditionally render `<TitleBar>` (Electron only) and fork between existing main content and `<SubtitleApp>` based on `useSubtitleModeActive()`. |
| `src/components/MainPanel/MainPanel.tsx` (line 2889 conversation-toolbar) | Insert `<SubtitleEnterButton>` into the conversation toolbar; gated by Electron + `isSessionActive`. |
| `src/components/MainPanel/ConversationRow.scss` (lines 113-120) | Wrap source-text and translation-text colors in `var(--subtitle-source-color, #9aa0a6)` and `var(--subtitle-translation-color, #e8e8e8)` so the subtitle stream root can override. |
| `src/locales/en.json` (and other locale files) | Add `subtitle.*` translation keys (English baseline; other locales fall back via i18next). |

### Reused without modification

- `src/components/MainPanel/ConversationRow.tsx`
- `src/components/MainPanel/DisplayModeButton.tsx`
- `src/components/MainPanel/ExportButton.tsx`
- `src/components/MainPanel/conversationFilter.ts`
- `src/stores/sessionStore.ts`
- `src/utils/environment.ts` (`isElectron()`)

---

## Phase 1: State Foundation

### Task 1: Pure utility — `clampToScreen`

**Files:**
- Create: `src/utils/clampToScreen.ts`
- Test: `src/utils/clampToScreen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/clampToScreen.test.ts
import { describe, it, expect } from 'vitest';
import { clampToScreen } from './clampToScreen';

describe('clampToScreen', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 };

  it('returns the same bounds when fully inside', () => {
    const b = { x: 100, y: 100, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual(b);
  });

  it('clamps a window pushed off the right edge back inside', () => {
    const b = { x: 1500, y: 100, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 1120, y: 100, width: 800, height: 200 });
  });

  it('clamps a window pushed off the bottom edge back inside', () => {
    const b = { x: 100, y: 1000, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 100, y: 880, width: 800, height: 200 });
  });

  it('clamps a window with negative origin to (workArea.x, workArea.y)', () => {
    const b = { x: -50, y: -50, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 0, y: 0, width: 800, height: 200 });
  });

  it('shrinks a window that is wider than the work area', () => {
    const b = { x: 0, y: 0, width: 3000, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 0, y: 0, width: 1920, height: 200 });
  });

  it('respects a non-zero work area origin (e.g. taskbar offset)', () => {
    const offsetWork = { x: 0, y: 40, width: 1920, height: 1040 };
    const b = { x: 100, y: 0, width: 800, height: 200 };
    expect(clampToScreen(b, offsetWork)).toEqual({ x: 100, y: 40, width: 800, height: 200 });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npm run test -- src/utils/clampToScreen.test.ts`
Expected: All 6 tests fail with "Cannot find module './clampToScreen'" or "clampToScreen is not a function".

- [ ] **Step 3: Implement**

```ts
// src/utils/clampToScreen.ts
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkArea extends Bounds {}

/**
 * Clamps a window's bounds to fit inside a screen work area.
 * - Shrinks dimensions that exceed the work area.
 * - Then translates so the window stays fully inside.
 *
 * Pure function. Used by both Electron main process (subtitle:enter) and
 * any renderer code that wants to defensively normalize persisted bounds.
 */
export function clampToScreen(bounds: Bounds, work: WorkArea): Bounds {
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { x, y, width, height };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm run test -- src/utils/clampToScreen.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/clampToScreen.ts src/utils/clampToScreen.test.ts
git commit -m "feat(subtitle): add clampToScreen utility for window bounds"
```

---

### Task 2: SubtitleSettings types and defaults in `settingsStore`

**Files:**
- Modify: `src/stores/settingsStore.ts` (around lines 26-45 for types, 185-246 for defaults, 411-444 for store interface)

- [ ] **Step 1: Add the `SubtitleSettings` type**

In `src/stores/settingsStore.ts`, just after line 29 (`export type DisplayMode = ...`) add:

```ts
// Subtitle (floating-bar) mode settings — Electron-only feature.
// Persisted under settings.common.subtitle.*
export interface SubtitleWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubtitleSettings {
  fontSize: number;            // 16-48, clamped on set
  compactMode: boolean;
  bgOpacity: number;           // 0-100
  bgColor: string;             // hex
  sourceTextColor: string;     // hex
  translationTextColor: string;// hex
  alwaysOnTop: boolean;
  positionLocked: boolean;
  windowBounds: SubtitleWindowBounds | null;
}
```

- [ ] **Step 2: Add the field to `CommonSettings` and the store interface**

In `CommonSettings` (around line 32), append:

```ts
  subtitle: SubtitleSettings;
```

Search in the same file for the matching settings-state interface (around line 411 — the same fields again). Append:

```ts
  subtitle: SubtitleSettings;
  subtitleModeActive: boolean;
```

- [ ] **Step 3: Add defaults**

After `defaultCommonSettings` closes (around line 246), still inside the same const block, add the new field. Locate the `};` that ends `defaultCommonSettings` — insert before it:

```ts
  subtitle: {
    fontSize: 24,
    compactMode: true,
    bgOpacity: 70,
    bgColor: '#000000',
    sourceTextColor: '#FFFFFF',
    translationTextColor: '#6CC5FF',
    alwaysOnTop: true,
    positionLocked: false,
    windowBounds: null,
  },
```

- [ ] **Step 4: Add `subtitleModeActive` runtime initial value**

Locate the `create<...>` call in `settingsStore.ts` where the initial state object is built (search for `subtitleModeActive:` to confirm not already there, then for the `set` of defaults — usually the `create((set, get) => ({ ... }))` block). Add to the initial state:

```ts
  subtitleModeActive: false,
```

- [ ] **Step 5: Run typecheck and full test suite — expect pass**

Run: `npm run test`
Expected: existing tests still pass; no test for new fields yet (added in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(subtitle): add SubtitleSettings type and defaults in settingsStore"
```

---

### Task 3: SubtitleSettings hydration from persisted storage

**Files:**
- Modify: `src/stores/settingsStore.ts` (the `loadSettings` action, around line 1397)

- [ ] **Step 1: Add hydration block**

Inside `loadSettings`, just after the existing `participantDisplayMode` load (around line 1406), add:

```ts
        const subtitleFontSize = await service.getSetting<number>(
          'settings.common.subtitle.fontSize',
          defaultCommonSettings.subtitle.fontSize,
        );
        const subtitleCompactMode = await service.getSetting<boolean>(
          'settings.common.subtitle.compactMode',
          defaultCommonSettings.subtitle.compactMode,
        );
        const subtitleBgOpacity = await service.getSetting<number>(
          'settings.common.subtitle.bgOpacity',
          defaultCommonSettings.subtitle.bgOpacity,
        );
        const subtitleBgColor = await service.getSetting<string>(
          'settings.common.subtitle.bgColor',
          defaultCommonSettings.subtitle.bgColor,
        );
        const subtitleSourceTextColor = await service.getSetting<string>(
          'settings.common.subtitle.sourceTextColor',
          defaultCommonSettings.subtitle.sourceTextColor,
        );
        const subtitleTranslationTextColor = await service.getSetting<string>(
          'settings.common.subtitle.translationTextColor',
          defaultCommonSettings.subtitle.translationTextColor,
        );
        const subtitleAlwaysOnTop = await service.getSetting<boolean>(
          'settings.common.subtitle.alwaysOnTop',
          defaultCommonSettings.subtitle.alwaysOnTop,
        );
        const subtitlePositionLocked = await service.getSetting<boolean>(
          'settings.common.subtitle.positionLocked',
          defaultCommonSettings.subtitle.positionLocked,
        );
        const subtitleWindowBounds = await service.getSetting<SubtitleWindowBounds | null>(
          'settings.common.subtitle.windowBounds',
          defaultCommonSettings.subtitle.windowBounds,
        );
```

- [ ] **Step 2: Add to the final `set({ ... })` block in `loadSettings`**

In the `set({ ... })` call near the end of `loadSettings` (around line 1435+), add:

```ts
          subtitle: {
            fontSize: subtitleFontSize,
            compactMode: subtitleCompactMode,
            bgOpacity: subtitleBgOpacity,
            bgColor: subtitleBgColor,
            sourceTextColor: subtitleSourceTextColor,
            translationTextColor: subtitleTranslationTextColor,
            alwaysOnTop: subtitleAlwaysOnTop,
            positionLocked: subtitlePositionLocked,
            windowBounds: subtitleWindowBounds,
          },
```

- [ ] **Step 3: Run tests — expect pass**

Run: `npm run test`
Expected: pass (no behavior change for non-electron, default values used in tests).

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(subtitle): hydrate SubtitleSettings from persisted storage"
```

---

### Task 4: Subtitle setter actions and selectors

**Files:**
- Modify: `src/stores/settingsStore.ts` (after `setParticipantDisplayMode` around line 932; selectors block around line 1607)

- [ ] **Step 1: Add the setter action interfaces**

In the store interface (around line 422), after `setParticipantDisplayMode`, add:

```ts
  setSubtitleFontSize: (n: number) => Promise<void>;
  setSubtitleCompactMode: (b: boolean) => Promise<void>;
  setSubtitleBgOpacity: (n: number) => Promise<void>;
  setSubtitleBgColor: (s: string) => Promise<void>;
  setSubtitleSourceTextColor: (s: string) => Promise<void>;
  setSubtitleTranslationTextColor: (s: string) => Promise<void>;
  toggleSubtitleAlwaysOnTop: () => Promise<void>;
  toggleSubtitlePositionLocked: () => Promise<void>;
  saveSubtitleWindowBounds: (b: SubtitleWindowBounds) => Promise<void>;
```

- [ ] **Step 2: Implement the setters**

Inside the `create((set, get) => ({ ... }))` body, after `setParticipantDisplayMode` (line 932), add a helper and the actions:

```ts
    setSubtitleFontSize: async (fontSize) => {
      const clamped = Math.max(16, Math.min(48, Math.round(fontSize)));
      const previous = get().subtitle.fontSize;
      set((state) => ({ subtitle: { ...state.subtitle, fontSize: clamped } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.fontSize', clamped);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.fontSize:', error);
        set((state) => ({ subtitle: { ...state.subtitle, fontSize: previous } }));
      }
    },

    setSubtitleCompactMode: async (compactMode) => {
      const previous = get().subtitle.compactMode;
      set((state) => ({ subtitle: { ...state.subtitle, compactMode } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.compactMode', compactMode);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.compactMode:', error);
        set((state) => ({ subtitle: { ...state.subtitle, compactMode: previous } }));
      }
    },

    setSubtitleBgOpacity: async (n) => {
      const clamped = Math.max(0, Math.min(100, Math.round(n)));
      const previous = get().subtitle.bgOpacity;
      set((state) => ({ subtitle: { ...state.subtitle, bgOpacity: clamped } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.bgOpacity', clamped);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.bgOpacity:', error);
        set((state) => ({ subtitle: { ...state.subtitle, bgOpacity: previous } }));
      }
    },

    setSubtitleBgColor: async (s) => {
      const previous = get().subtitle.bgColor;
      set((state) => ({ subtitle: { ...state.subtitle, bgColor: s } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.bgColor', s);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.bgColor:', error);
        set((state) => ({ subtitle: { ...state.subtitle, bgColor: previous } }));
      }
    },

    setSubtitleSourceTextColor: async (s) => {
      const previous = get().subtitle.sourceTextColor;
      set((state) => ({ subtitle: { ...state.subtitle, sourceTextColor: s } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.sourceTextColor', s);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.sourceTextColor:', error);
        set((state) => ({ subtitle: { ...state.subtitle, sourceTextColor: previous } }));
      }
    },

    setSubtitleTranslationTextColor: async (s) => {
      const previous = get().subtitle.translationTextColor;
      set((state) => ({ subtitle: { ...state.subtitle, translationTextColor: s } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.translationTextColor', s);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.translationTextColor:', error);
        set((state) => ({ subtitle: { ...state.subtitle, translationTextColor: previous } }));
      }
    },

    toggleSubtitleAlwaysOnTop: async () => {
      const next = !get().subtitle.alwaysOnTop;
      set((state) => ({ subtitle: { ...state.subtitle, alwaysOnTop: next } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.alwaysOnTop', next);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.alwaysOnTop:', error);
        set((state) => ({ subtitle: { ...state.subtitle, alwaysOnTop: !next } }));
      }
    },

    toggleSubtitlePositionLocked: async () => {
      const next = !get().subtitle.positionLocked;
      set((state) => ({ subtitle: { ...state.subtitle, positionLocked: next } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.positionLocked', next);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.positionLocked:', error);
        set((state) => ({ subtitle: { ...state.subtitle, positionLocked: !next } }));
      }
    },

    saveSubtitleWindowBounds: async (b) => {
      const previous = get().subtitle.windowBounds;
      set((state) => ({ subtitle: { ...state.subtitle, windowBounds: b } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.windowBounds', b);
      } catch (error) {
        console.error('[SettingsStore] Error persisting subtitle.windowBounds:', error);
        set((state) => ({ subtitle: { ...state.subtitle, windowBounds: previous } }));
      }
    },
```

- [ ] **Step 3: Add selector hooks**

After existing selectors (around line 1607-1657, search for `useSpeakerDisplayMode`), append:

```ts
export const useSubtitleSettings = () => useSettingsStore((state) => state.subtitle);
export const useSubtitleModeActive = () => useSettingsStore((state) => state.subtitleModeActive);
export const useSetSubtitleFontSize = () => useSettingsStore((state) => state.setSubtitleFontSize);
export const useSetSubtitleCompactMode = () => useSettingsStore((state) => state.setSubtitleCompactMode);
export const useSetSubtitleBgOpacity = () => useSettingsStore((state) => state.setSubtitleBgOpacity);
export const useSetSubtitleBgColor = () => useSettingsStore((state) => state.setSubtitleBgColor);
export const useSetSubtitleSourceTextColor = () => useSettingsStore((state) => state.setSubtitleSourceTextColor);
export const useSetSubtitleTranslationTextColor = () => useSettingsStore((state) => state.setSubtitleTranslationTextColor);
export const useToggleSubtitleAlwaysOnTop = () => useSettingsStore((state) => state.toggleSubtitleAlwaysOnTop);
export const useToggleSubtitlePositionLocked = () => useSettingsStore((state) => state.toggleSubtitlePositionLocked);
export const useSaveSubtitleWindowBounds = () => useSettingsStore((state) => state.saveSubtitleWindowBounds);
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm run test`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(subtitle): add subtitle setter actions and selectors"
```

---

### Task 5: enterSubtitleMode / exitSubtitleMode actions (state-only first)

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/settingsStore.subtitle.test.ts`

These actions need access to `sessionStore.isActive`. Use `useSessionStore.getState().isSessionActive` (or the existing equivalent — verify from `src/stores/sessionStore.ts`). For now they only mutate state; IPC wiring lands in Task 11.

- [ ] **Step 1: Look up session-active selector name**

Run: `grep -nE "isSessionActive|sessionActive" src/stores/sessionStore.ts | head`
Expected: identify the property name (likely `isSessionActive`).

- [ ] **Step 2: Add the actions to the store interface**

In the store interface (near the other setters from Task 4), add:

```ts
  enterSubtitleMode: () => Promise<void>;
  exitSubtitleMode: () => Promise<void>;
```

- [ ] **Step 3: Implement (state-only, IPC stubbed)**

After `saveSubtitleWindowBounds` action body, add:

```ts
    enterSubtitleMode: async () => {
      // Idempotent: bail if already active
      if (get().subtitleModeActive) return;
      // Require an active session
      const sessionActive = useSessionStore.getState().isSessionActive;
      if (!sessionActive) {
        console.warn('[SettingsStore] enterSubtitleMode ignored — no active session');
        return;
      }
      set({ subtitleModeActive: true });
      // IPC call to Electron main is added in Task 11; until then this is a no-op.
    },

    exitSubtitleMode: async () => {
      if (!get().subtitleModeActive) return;
      set({ subtitleModeActive: false });
      // IPC call to Electron main is added in Task 11; until then this is a no-op.
    },
```

At the top of `settingsStore.ts`, add the import for `useSessionStore`:

```ts
import { useSessionStore } from './sessionStore';
```

(Place this near the other imports at the top of the file.)

- [ ] **Step 4: Add selector hooks**

```ts
export const useEnterSubtitleMode = () => useSettingsStore((state) => state.enterSubtitleMode);
export const useExitSubtitleMode = () => useSettingsStore((state) => state.exitSubtitleMode);
```

- [ ] **Step 5: Write tests**

```ts
// src/stores/settingsStore.subtitle.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { useSessionStore } from './sessionStore';

describe('settingsStore subtitle actions', () => {
  beforeEach(() => {
    useSettingsStore.setState({ subtitleModeActive: false });
    // Replace persistence service with a noop spy
    vi.mock('../services/ServiceFactory', () => ({
      ServiceFactory: {
        getSettingsService: () => ({
          getSetting: async (_k: string, d: any) => d,
          setSetting: async () => undefined,
        }),
      },
    }));
  });

  it('enterSubtitleMode is a no-op when session is not active', async () => {
    useSessionStore.setState({ isSessionActive: false } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('enterSubtitleMode sets the flag when session is active', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
  });

  it('enterSubtitleMode is idempotent', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
  });

  it('exitSubtitleMode resets the flag', async () => {
    useSettingsStore.setState({ subtitleModeActive: true });
    await useSettingsStore.getState().exitSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('setSubtitleFontSize clamps to 16-48', async () => {
    await useSettingsStore.getState().setSubtitleFontSize(8);
    expect(useSettingsStore.getState().subtitle.fontSize).toBe(16);
    await useSettingsStore.getState().setSubtitleFontSize(100);
    expect(useSettingsStore.getState().subtitle.fontSize).toBe(48);
  });

  it('setSubtitleBgOpacity clamps to 0-100', async () => {
    await useSettingsStore.getState().setSubtitleBgOpacity(-5);
    expect(useSettingsStore.getState().subtitle.bgOpacity).toBe(0);
    await useSettingsStore.getState().setSubtitleBgOpacity(150);
    expect(useSettingsStore.getState().subtitle.bgOpacity).toBe(100);
  });
});
```

If the actual session-active key on `useSessionStore` is named differently (e.g. `isActive` rather than `isSessionActive`), substitute the correct name in both the action and the test.

- [ ] **Step 6: Run tests — expect pass**

Run: `npm run test -- src/stores/settingsStore.subtitle.test.ts`
Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.subtitle.test.ts
git commit -m "feat(subtitle): add enter/exit subtitle mode actions with session guard"
```

---

## Phase 2: Custom Title Bar (prerequisite for frame:false transition)

### Task 6: window:* IPC channels for the custom title bar

**Files:**
- Modify: `electron/main.js` (after line 290, after `did-finish-load` handler is fine; near other ipcMain handlers if there's a conventional spot)
- Modify: `electron/preload.js` (line 100 onward `invoke` whitelist)

- [ ] **Step 1: Add `window:*` to the preload `invoke` whitelist**

In `electron/preload.js`, find the `invoke` function (around line 99) and the `validChannels` array. After the last existing entry, add:

```js
        // Window control IPC for custom title bar
        'window:minimize',
        'window:maximize-toggle',
        'window:close',
```

- [ ] **Step 2: Add `ipcMain.handle` for window controls in `electron/main.js`**

Search for an existing `ipcMain.handle('` block in `electron/main.js`. After one of them (any logical spot will do — convention is near the end of the createWindow function or in the handlers section), add:

```js
  // ---- Window controls for the custom title bar ----
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.handle('window:maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });
```

- [ ] **Step 3: Smoke test (manual)**

Run: `npm run electron:dev`
In the app's DevTools console, type:

```js
await window.electron.invoke('window:minimize')
```

Expected: window minimizes.
Restore the window, then:

```js
await window.electron.invoke('window:maximize-toggle')
```

Expected: window toggles maximize.
Run again to un-maximize. Do not run `window:close` during smoke test.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(subtitle): add window:* IPC for custom title bar"
```

---

### Task 7: TitleBar component (cross-platform)

**Files:**
- Create: `src/components/TitleBar/TitleBar.tsx`
- Create: `src/components/TitleBar/TitleBar.scss`

- [ ] **Step 1: Create the SCSS**

```scss
// src/components/TitleBar/TitleBar.scss
.title-bar {
  height: 30px;
  display: flex;
  align-items: center;
  background: #1a1a1a;
  color: #e8e8e8;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;

  &.platform-darwin {
    // On macOS we use titleBarStyle: 'hiddenInset' so the OS draws traffic-
    // light buttons on the left. We just need padding to keep our content
    // clear of them.
    padding-left: 78px;
    padding-right: 8px;
    justify-content: flex-start;
  }

  &.platform-other {
    padding-left: 12px;
    padding-right: 0;
    justify-content: space-between;
  }
}

.title-bar__title {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.title-bar__buttons {
  display: flex;
  -webkit-app-region: no-drag;
}

.title-bar__btn {
  width: 46px;
  height: 30px;
  border: none;
  background: transparent;
  color: #c8c8c8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &.title-bar__close:hover {
    background: #c0392b;
    color: #fff;
  }
}
```

- [ ] **Step 2: Create the component**

```tsx
// src/components/TitleBar/TitleBar.tsx
import React, { useCallback } from 'react';
import { Minus, Square, X } from 'lucide-react';
import './TitleBar.scss';

const isMac = typeof process !== 'undefined' && process.platform === 'darwin';

const TitleBar: React.FC = () => {
  const minimize = useCallback(() => {
    void window.electron?.invoke('window:minimize');
  }, []);
  const maximizeToggle = useCallback(() => {
    void window.electron?.invoke('window:maximize-toggle');
  }, []);
  const close = useCallback(() => {
    void window.electron?.invoke('window:close');
  }, []);

  if (isMac) {
    // macOS: traffic-light buttons drawn by the OS via titleBarStyle: 'hiddenInset'.
    // We just render a thin draggable area with the title.
    return (
      <div className="title-bar platform-darwin" role="banner">
        <span className="title-bar__title">Sokuji</span>
      </div>
    );
  }

  return (
    <div className="title-bar platform-other" role="banner">
      <span className="title-bar__title">Sokuji</span>
      <div className="title-bar__buttons">
        <button
          type="button"
          className="title-bar__btn title-bar__minimize"
          aria-label="Minimize"
          onClick={minimize}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__maximize"
          aria-label="Maximize"
          onClick={maximizeToggle}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__close"
          aria-label="Close"
          onClick={close}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
```

- [ ] **Step 3: Run tests — expect pass**

Run: `npm run test`
Expected: existing tests pass; no test for TitleBar (UI orchestration, will be exercised by manual test).

- [ ] **Step 4: Commit**

```bash
git add src/components/TitleBar/
git commit -m "feat(subtitle): add cross-platform custom TitleBar component"
```

---

### Task 8: Render TitleBar in MainLayout (Electron only)

**Files:**
- Modify: `src/components/MainLayout/MainLayout.tsx` (top-level JSX)

- [ ] **Step 1: Add the import + render**

At the top of `src/components/MainLayout/MainLayout.tsx`, add:

```tsx
import TitleBar from '../TitleBar/TitleBar';
import { isElectron } from '../../utils/environment';
```

Inside the rendered JSX of `MainLayout`, wrap the existing root element so `TitleBar` is the first child when running in Electron. If the current root is `<div className="main-layout">...</div>`, change it to:

```tsx
return (
  <>
    {isElectron() && <TitleBar />}
    <div className="main-layout">
      {/* existing content unchanged */}
    </div>
  </>
);
```

(Read the current MainLayout return to identify the exact wrapping element. The change is: render `<TitleBar />` immediately above the existing root in Electron.)

- [ ] **Step 2: Verify the app still runs**

Run: `npm run electron:dev`
Expected: in Electron the app now shows BOTH the system title bar AND the custom one. This is intentional for the next task.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainLayout/MainLayout.tsx
git commit -m "feat(subtitle): render custom TitleBar in MainLayout for Electron"
```

---

### Task 9: Switch mainWindow to frameless + transparent

**Files:**
- Modify: `electron/main.js` (BrowserWindow constructor at line 248)

- [ ] **Step 1: Update BrowserWindow constructor**

Change the constructor at `electron/main.js:248` from:

```js
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sokuji',
    icon: iconPath,
    webPreferences: { ... },
  });
```

to:

```js
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sokuji',
    icon: iconPath,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: !isDev,
    },
  });
```

- [ ] **Step 2: Ensure body and root containers have an opaque background in normal mode**

In `src/App.scss` (or whichever style file controls `body` / `.App`), add (without removing existing rules):

```scss
html, body, #root, .App {
  background: transparent;
}
```

Then in `src/components/MainLayout/MainLayout.scss` (or main-layout.scss), ensure the wrapping container in normal mode has the opaque background:

```scss
.main-layout {
  background: #1a1a1a; // matches existing app theme
  min-height: calc(100vh - 30px);
}
```

If existing rules already set `body` / `.App` background, just add the `transparent` rule above and let `.main-layout` carry the visible background.

- [ ] **Step 3: Run the app, smoke test normal mode**

Run: `npm run electron:dev`
Expected:
- System title bar gone.
- Custom title bar from Task 7 visible.
- App content renders with opaque dark background.
- Window can be dragged via the custom title bar.
- Min / Max / Close buttons work (Win/Linux); macOS traffic lights work.

If you see a transparent app body where content used to be, the background rules from Step 2 are not applied — fix the SCSS and re-run.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js src/App.scss src/components/MainLayout/MainLayout.scss
git commit -m "feat(subtitle): switch mainWindow to frame:false + transparent:true"
```

---

## Phase 3: Subtitle IPC Infrastructure

### Task 10: subtitle:* IPC channels in preload

**Files:**
- Modify: `electron/preload.js`

- [ ] **Step 1: Add subtitle:* to the `invoke` whitelist**

In `electron/preload.js`, in the `validChannels` array of `invoke`, add (after the `window:*` entries from Task 6):

```js
        // Subtitle mode IPC
        'subtitle:enter',
        'subtitle:exit',
        'subtitle:set-always-on-top',
        'subtitle:set-locked',
        'subtitle:get-screen-bounds',
```

- [ ] **Step 2: Add subtitle:* to the receive whitelist**

In the same file, locate `validReceiveChannels` (around line 60). Add:

```js
  // Subtitle window bounds change events
  'subtitle:window-bounds-changed',
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat(subtitle): allow subtitle:* IPC channels in preload"
```

---

### Task 11: subtitle-window.js with IPC handlers

**Files:**
- Create: `electron/subtitle-window.js`
- Modify: `electron/main.js` (call `setupSubtitleHandlers` after creating mainWindow)
- Modify: `src/stores/settingsStore.ts` (wire IPC into `enterSubtitleMode` / `exitSubtitleMode` and toggles)

- [ ] **Step 1: Create `electron/subtitle-window.js`**

```js
// electron/subtitle-window.js
const { ipcMain, screen } = require('electron');

function clampToScreen(bounds, work) {
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { x, y, width, height };
}

function defaultSubtitleBounds(work) {
  const width = Math.round(work.width * 0.8);
  const height = 200;
  return {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + work.height - height - 80,
    width,
    height,
  };
}

function setupSubtitleHandlers(mainWindow) {
  let normalBoundsSnapshot = null;

  ipcMain.handle('subtitle:get-screen-bounds', () => {
    const display = screen.getPrimaryDisplay();
    return display.workArea;
  });

  ipcMain.handle('subtitle:enter', (_event, payload) => {
    const work = screen.getPrimaryDisplay().workArea;
    const requested = payload?.bounds ?? defaultSubtitleBounds(work);
    const clamped = clampToScreen(requested, work);

    normalBoundsSnapshot = mainWindow.getBounds();
    mainWindow.setBounds(clamped);
    mainWindow.setAlwaysOnTop(Boolean(payload?.alwaysOnTop), 'floating');
    mainWindow.setResizable(!payload?.locked);
    return { ok: true, bounds: clamped };
  });

  ipcMain.handle('subtitle:exit', (_event, payload) => {
    const restore = payload?.restoreBounds ?? normalBoundsSnapshot ?? { width: 1200, height: 800 };
    if (restore.x !== undefined && restore.y !== undefined) {
      mainWindow.setBounds(restore);
    } else {
      const display = screen.getPrimaryDisplay().workArea;
      mainWindow.setBounds({
        x: display.x + Math.round((display.width - 1200) / 2),
        y: display.y + Math.round((display.height - 800) / 2),
        width: 1200,
        height: 800,
      });
    }
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    normalBoundsSnapshot = null;
    return { ok: true };
  });

  ipcMain.handle('subtitle:set-always-on-top', (_event, flag) => {
    mainWindow.setAlwaysOnTop(Boolean(flag), 'floating');
    return { ok: true };
  });

  ipcMain.handle('subtitle:set-locked', (_event, locked) => {
    mainWindow.setResizable(!locked);
    return { ok: true };
  });

  // Debounced bounds-changed broadcaster
  let debounceTimer = null;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('subtitle:window-bounds-changed', mainWindow.getBounds());
      }
    }, 200);
  };
  mainWindow.on('resize', onChange);
  mainWindow.on('move', onChange);
}

module.exports = { setupSubtitleHandlers };
```

- [ ] **Step 2: Wire `setupSubtitleHandlers` into main.js**

At the top of `electron/main.js`, add:

```js
const { setupSubtitleHandlers } = require('./subtitle-window.js');
```

After `mainWindow = new BrowserWindow({ ... })` (around line 260), call:

```js
  setupSubtitleHandlers(mainWindow);
```

- [ ] **Step 3: Wire IPC into the store actions**

In `src/stores/settingsStore.ts`, replace the placeholder bodies of `enterSubtitleMode`, `exitSubtitleMode`, `toggleSubtitleAlwaysOnTop`, and `toggleSubtitlePositionLocked` with real IPC calls.

`enterSubtitleMode`:

```ts
    enterSubtitleMode: async () => {
      if (get().subtitleModeActive) return;
      const sessionActive = useSessionStore.getState().isSessionActive;
      if (!sessionActive) {
        console.warn('[SettingsStore] enterSubtitleMode ignored — no active session');
        return;
      }
      const subtitle = get().subtitle;
      try {
        const electronApi = (window as any).electron;
        if (electronApi?.invoke) {
          const result = await electronApi.invoke('subtitle:enter', {
            bounds: subtitle.windowBounds ?? undefined,
            alwaysOnTop: subtitle.alwaysOnTop,
            locked: subtitle.positionLocked,
          });
          if (result?.bounds) {
            // Persist clamped bounds so next launch uses corrected values
            set((state) => ({ subtitle: { ...state.subtitle, windowBounds: result.bounds } }));
            const service = ServiceFactory.getSettingsService();
            await service.setSetting('settings.common.subtitle.windowBounds', result.bounds);
          }
        }
        set({ subtitleModeActive: true });
      } catch (error) {
        console.error('[SettingsStore] enterSubtitleMode IPC failed:', error);
      }
    },
```

`exitSubtitleMode`:

```ts
    exitSubtitleMode: async () => {
      if (!get().subtitleModeActive) return;
      try {
        const electronApi = (window as any).electron;
        if (electronApi?.invoke) {
          await electronApi.invoke('subtitle:exit', {});
        }
      } catch (error) {
        console.error('[SettingsStore] exitSubtitleMode IPC failed:', error);
      } finally {
        set({ subtitleModeActive: false });
      }
    },
```

Update `toggleSubtitleAlwaysOnTop` to also fire IPC when in subtitle mode:

```ts
    toggleSubtitleAlwaysOnTop: async () => {
      const next = !get().subtitle.alwaysOnTop;
      set((state) => ({ subtitle: { ...state.subtitle, alwaysOnTop: next } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.alwaysOnTop', next);
        if (get().subtitleModeActive) {
          const electronApi = (window as any).electron;
          await electronApi?.invoke('subtitle:set-always-on-top', next);
        }
      } catch (error) {
        console.error('[SettingsStore] toggleSubtitleAlwaysOnTop failed:', error);
        set((state) => ({ subtitle: { ...state.subtitle, alwaysOnTop: !next } }));
      }
    },
```

Update `toggleSubtitlePositionLocked`:

```ts
    toggleSubtitlePositionLocked: async () => {
      const next = !get().subtitle.positionLocked;
      set((state) => ({ subtitle: { ...state.subtitle, positionLocked: next } }));
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.subtitle.positionLocked', next);
        if (get().subtitleModeActive) {
          const electronApi = (window as any).electron;
          await electronApi?.invoke('subtitle:set-locked', next);
        }
      } catch (error) {
        console.error('[SettingsStore] toggleSubtitlePositionLocked failed:', error);
        set((state) => ({ subtitle: { ...state.subtitle, positionLocked: !next } }));
      }
    },
```

- [ ] **Step 4: Smoke test from DevTools**

Run: `npm run electron:dev`
In the renderer DevTools console:

```js
await window.electron.invoke('subtitle:get-screen-bounds')
```

Expected: `{x, y, width, height}` of the primary display work area.

```js
await window.electron.invoke('subtitle:enter', {
  alwaysOnTop: true,
  locked: false,
})
```

Expected: window snaps to a bottom-centered floating bar (≈80% width, 200 px height), stays on top of other windows. Custom title bar still rendered (this is fine — it gets hidden by React in Task 19).

```js
await window.electron.invoke('subtitle:exit', {})
```

Expected: window restores to its previous size and position; alwaysOnTop turns off.

- [ ] **Step 5: Run unit tests**

Run: `npm run test`
Expected: existing pass.

- [ ] **Step 6: Commit**

```bash
git add electron/subtitle-window.js electron/main.js src/stores/settingsStore.ts
git commit -m "feat(subtitle): add subtitle:* IPC handlers and wire them into store actions"
```

---

## Phase 4: Subtitle UI Components

### Task 12: ConversationRow.scss CSS variables for source/translation colors

**Files:**
- Modify: `src/components/MainPanel/ConversationRow.scss` (lines 110-121)

- [ ] **Step 1: Replace the color literals with var() fallbacks**

Find:

```scss
.row-text {
  overflow-wrap: anywhere;

  &.src {
    color: #9aa0a6;
    font-style: italic;
  }

  &.tr {
    color: #e8e8e8;
  }
}
```

Replace with:

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

- [ ] **Step 2: Verify main panel still looks the same**

Run: `npm run electron:dev`, start a session, send a message.
Expected: conversation rows render in the same colors as before (gray italic source, light translation). The `--subtitle-*` variables are not set anywhere outside subtitle mode, so the fallback values apply.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/ConversationRow.scss
git commit -m "refactor(subtitle): make conversation row text colors override-able via CSS vars"
```

---

### Task 13: SubtitleSessionEnded component

**Files:**
- Create: `src/components/Subtitle/SubtitleSessionEnded.tsx`
- Test: `src/components/Subtitle/SubtitleSessionEnded.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Subtitle/SubtitleSessionEnded.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubtitleSessionEnded from './SubtitleSessionEnded';

describe('SubtitleSessionEnded', () => {
  it('renders the ended message and a return button', () => {
    render(<SubtitleSessionEnded onReturn={() => {}} />);
    expect(screen.getByText(/session ended|会话已结束/i)).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('calls onReturn when the button is clicked', () => {
    const onReturn = vi.fn();
    render(<SubtitleSessionEnded onReturn={onReturn} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test -- src/components/Subtitle/SubtitleSessionEnded.test.tsx`
Expected: fail with module-not-found.

- [ ] **Step 3: Implement**

```tsx
// src/components/Subtitle/SubtitleSessionEnded.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onReturn: () => void;
}

const SubtitleSessionEnded: React.FC<Props> = ({ onReturn }) => {
  const { t } = useTranslation();
  return (
    <div className="subtitle-session-ended">
      <p>{t('subtitle.sessionEnded', 'Session ended')}</p>
      <button type="button" onClick={onReturn}>
        {t('subtitle.backToMain', 'Return to main window')}
      </button>
    </div>
  );
};

export default SubtitleSessionEnded;
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test -- src/components/Subtitle/SubtitleSessionEnded.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleSessionEnded.tsx src/components/Subtitle/SubtitleSessionEnded.test.tsx
git commit -m "feat(subtitle): add SubtitleSessionEnded component"
```

---

### Task 14: SubtitleStream component

**Files:**
- Create: `src/components/Subtitle/SubtitleStream.tsx`
- Create: `src/components/Subtitle/SubtitleStream.scss`
- Test: `src/components/Subtitle/SubtitleStream.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Subtitle/SubtitleStream.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SubtitleStream from './SubtitleStream';

const items: any[] = [
  { id: '1', source: 'speaker', role: 'user',      formatted: { text: 'hello' },        sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '2', source: 'speaker', role: 'assistant', formatted: { text: '你好' },          sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '3', source: 'participant', role: 'user',      formatted: { text: '再见' },     sourceLanguage: 'en', targetLanguage: 'zh' },
  { id: '4', source: 'participant', role: 'assistant', formatted: { text: 'goodbye' },  sourceLanguage: 'en', targetLanguage: 'zh' },
];

describe('SubtitleStream', () => {
  it('renders both speaker and participant rows when both display modes are "both"', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    expect(container.querySelectorAll('.conversation-row').length).toBe(4);
  });

  it('hides participant rows when participant mode filters them all out (e.g. "source" hides assistant rows)', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={24}
        speakerMode="both"
        participantMode="source"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    // 4 rows total minus 1 participant assistant
    expect(container.querySelectorAll('.conversation-row').length).toBe(3);
  });

  it('applies fontSize and color CSS variables', () => {
    const { container } = render(
      <SubtitleStream
        items={items}
        compact
        fontSize={36}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
        sourceTextColor="#FF0000"
        translationTextColor="#00FF00"
      />,
    );
    const root = container.querySelector('.subtitle-stream') as HTMLElement;
    expect(root.style.fontSize).toBe('36px');
    expect(root.style.getPropertyValue('--subtitle-source-color')).toBe('#FF0000');
    expect(root.style.getPropertyValue('--subtitle-translation-color')).toBe('#00FF00');
  });
});
```

If `filterByDisplayMode` from `conversationFilter.ts` has a different signature than this test assumes, adjust the test inputs. The point is exercising filter pass-through.

- [ ] **Step 2: Run — expect failure**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: fail.

- [ ] **Step 3: Implement SCSS**

```scss
// src/components/Subtitle/SubtitleStream.scss
.subtitle-stream {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px 16px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  scroll-behavior: smooth;
  font-size: var(--subtitle-font-size, 24px);

  // Hide scrollbar; subtitle area should look clean
  &::-webkit-scrollbar {
    width: 0;
    background: transparent;
  }
}
```

- [ ] **Step 4: Implement component**

```tsx
// src/components/Subtitle/SubtitleStream.tsx
import React, { useEffect, useRef, useMemo } from 'react';
import ConversationRow from '../MainPanel/ConversationRow';
import { filterByDisplayMode } from '../MainPanel/conversationFilter';
import type { DisplayMode } from '../../stores/settingsStore';
import './SubtitleStream.scss';

interface Props {
  items: any[];                  // ConversationItem[]; reusing the broad type already used by ConversationRow
  compact: boolean;
  fontSize: number;
  speakerMode: DisplayMode;
  participantMode: DisplayMode;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTextColor?: string;
  translationTextColor?: string;
}

const SubtitleStream: React.FC<Props> = ({
  items,
  compact,
  fontSize,
  speakerMode,
  participantMode,
  sourceLanguage,
  targetLanguage,
  sourceTextColor,
  translationTextColor,
}) => {
  const filtered = useMemo(
    () => filterByDisplayMode(items, speakerMode, participantMode),
    [items, speakerMode, participantMode],
  );

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [filtered.length]);

  const style: React.CSSProperties = { fontSize: `${fontSize}px` };
  if (sourceTextColor) (style as any)['--subtitle-source-color'] = sourceTextColor;
  if (translationTextColor) (style as any)['--subtitle-translation-color'] = translationTextColor;

  return (
    <div className="subtitle-stream" style={style}>
      {filtered.map((item, i) => (
        <ConversationRow
          key={item.id}
          item={item}
          prevItem={filtered[i - 1] ?? null}
          compact={compact}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          isPlaying={false}
          highlightedChars={0}
          canPlay={false}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
};

export default SubtitleStream;
```

If `filterByDisplayMode`'s real signature differs, adjust the call. Read `src/components/MainPanel/conversationFilter.ts` to confirm.

- [ ] **Step 5: Run — expect pass**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: 3 tests pass. If `filterByDisplayMode` signature mismatches, update either the test or the component until they agree, keeping the same behavior.

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.tsx src/components/Subtitle/SubtitleStream.scss src/components/Subtitle/SubtitleStream.test.tsx
git commit -m "feat(subtitle): add SubtitleStream component with bottom-stick rendering"
```

---

### Task 15: SubtitleSettingsPopover component

**Files:**
- Create: `src/components/Subtitle/SubtitleSettingsPopover.tsx`
- Create: `src/components/Subtitle/SubtitleSettingsPopover.scss`

- [ ] **Step 1: Implement SCSS**

```scss
// src/components/Subtitle/SubtitleSettingsPopover.scss
.subtitle-settings-popover {
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

      .swatch {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        padding: 0;

        &.selected {
          border-color: #10a37f;
        }
      }
    }
  }
}
```

- [ ] **Step 2: Implement component**

```tsx
// src/components/Subtitle/SubtitleSettingsPopover.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSubtitleSettings,
  useSetSubtitleBgOpacity,
  useSetSubtitleBgColor,
  useSetSubtitleSourceTextColor,
  useSetSubtitleTranslationTextColor,
} from '../../stores/settingsStore';
import './SubtitleSettingsPopover.scss';

const BG_PRESETS = ['#000000', '#1a1a1a', '#0d2032', '#0f2419', '#FFFFFF', '#2a2a2a'];
const SOURCE_PRESETS = ['#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#9aa0a6', '#FF6B6B'];
const TRANSLATION_PRESETS = ['#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9'];

const SubtitleSettingsPopover: React.FC = () => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const setBgOpacity = useSetSubtitleBgOpacity();
  const setBgColor = useSetSubtitleBgColor();
  const setSourceColor = useSetSubtitleSourceTextColor();
  const setTranslationColor = useSetSubtitleTranslationTextColor();

  return (
    <div className="subtitle-settings-popover" role="dialog">
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
        <label>{t('subtitle.settings.bgColor', 'Background color')}</label>
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
        <label>{t('subtitle.settings.sourceColor', 'Source text color')}</label>
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
        <label>{t('subtitle.settings.translationColor', 'Translation color')}</label>
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

export default SubtitleSettingsPopover;
```

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: existing tests pass; no new tests for this component (orchestration-heavy, exercised by manual test).

- [ ] **Step 4: Commit**

```bash
git add src/components/Subtitle/SubtitleSettingsPopover.tsx src/components/Subtitle/SubtitleSettingsPopover.scss
git commit -m "feat(subtitle): add SubtitleSettingsPopover with sliders and palettes"
```

---

### Task 16: SubtitleBar component (three-segment top bar)

**Files:**
- Create: `src/components/Subtitle/SubtitleBar.tsx`
- Create: `src/components/Subtitle/SubtitleBar.scss`

- [ ] **Step 1: Implement SCSS**

```scss
// src/components/Subtitle/SubtitleBar.scss
.subtitle-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 12px;
  background: rgba(20, 20, 20, 0.95);
  color: #e8e8e8;
  -webkit-app-region: drag;
  font-size: 12px;
  flex-shrink: 0;
  opacity: var(--bar-opacity, 1);
  transition: opacity 200ms ease-in-out;

  &.locked {
    -webkit-app-region: no-drag;
  }

  .subtitle-bar__left,
  .subtitle-bar__center,
  .subtitle-bar__right {
    display: flex;
    align-items: center;
    gap: 8px;
    -webkit-app-region: no-drag;
  }

  .subtitle-bar__logo {
    font-weight: 600;
    color: #10a37f;
  }

  .subtitle-bar__quota {
    color: #9aa0a6;
    font-size: 11px;
  }

  .subtitle-bar__timer {
    font-family: monospace;
    font-size: 13px;
  }

  .subtitle-bar__lang {
    color: #c8c8c8;
    font-weight: 500;
  }

  .subtitle-bar__btn {
    background: transparent;
    border: none;
    color: #c8c8c8;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    &.active {
      color: #10a37f;
      background: rgba(16, 163, 127, 0.15);
    }
  }

  .subtitle-bar__divider {
    width: 1px;
    height: 18px;
    background: #3a3a3a;
    margin: 0 4px;
  }
}
```

- [ ] **Step 2: Implement component**

```tsx
// src/components/Subtitle/SubtitleBar.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown,
  Pin, Lock, X, Settings, Trash2,
} from 'lucide-react';
import DisplayModeButton from '../MainPanel/DisplayModeButton';
import ExportButton from '../MainPanel/ExportButton';
import {
  useSubtitleSettings,
  useSetSubtitleFontSize,
  useSetSubtitleCompactMode,
  useToggleSubtitleAlwaysOnTop,
  useToggleSubtitlePositionLocked,
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
  useSetSpeakerDisplayMode,
  useSetParticipantDisplayMode,
  useExitSubtitleMode,
} from '../../stores/settingsStore';
import { useFloating, useClick, useDismiss, useInteractions, offset, flip, FloatingPortal } from '@floating-ui/react';
import SubtitleSettingsPopover from './SubtitleSettingsPopover';
import './SubtitleBar.scss';

interface Props {
  // Callers in this codebase pass session-aware data; keeping props explicit
  // makes SubtitleBar usable in tests and storybook in the future.
  sessionElapsedMs: number;
  sourceLanguageCode: string;     // e.g. 'ZH'
  targetLanguageCode: string;     // e.g. 'EN'
  combinedItems: any[];            // for ExportButton
  onClearConversation: () => void;
  participantHasAudio: boolean;    // controls participant DisplayModeButton visibility
  // ExportButton has more required props in the existing implementation; the
  // wrapper that mounts SubtitleBar (SubtitleApp) supplies them. See Task 17.
  exportProps: React.ComponentProps<typeof ExportButton>;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const SubtitleBar: React.FC<Props> = ({
  sessionElapsedMs,
  sourceLanguageCode,
  targetLanguageCode,
  combinedItems,
  onClearConversation,
  participantHasAudio,
  exportProps,
}) => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const setFontSize = useSetSubtitleFontSize();
  const setCompactMode = useSetSubtitleCompactMode();
  const toggleAlwaysOnTop = useToggleSubtitleAlwaysOnTop();
  const togglePositionLocked = useToggleSubtitlePositionLocked();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const setSpeakerMode = useSetSpeakerDisplayMode();
  const setParticipantMode = useSetParticipantDisplayMode();
  const exitSubtitleMode = useExitSubtitleMode();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: popoverOpen,
    onOpenChange: setPopoverOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip()],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <div className={`subtitle-bar ${subtitle.positionLocked ? 'locked' : ''}`} role="toolbar">
      <div className="subtitle-bar__left">
        <span className="subtitle-bar__logo">Sokuji</span>
        <span className="subtitle-bar__quota" />
      </div>

      <div className="subtitle-bar__center">
        <span className="subtitle-bar__timer">{formatElapsed(sessionElapsedMs)}</span>
        <span className="subtitle-bar__lang">
          {sourceLanguageCode} → {targetLanguageCode}
        </span>
      </div>

      <div className="subtitle-bar__right">
        <DisplayModeButton scope="speaker" value={speakerMode} onChange={setSpeakerMode} />
        {participantHasAudio && (
          <DisplayModeButton scope="participant" value={participantMode} onChange={setParticipantMode} />
        )}
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setFontSize(subtitle.fontSize - 2)}
          disabled={subtitle.fontSize <= 16}
          title={t('subtitle.bar.fontDecrease', 'Decrease font size')}
        >
          <AArrowDown size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setFontSize(subtitle.fontSize + 2)}
          disabled={subtitle.fontSize >= 48}
          title={t('subtitle.bar.fontIncrease', 'Increase font size')}
        >
          <AArrowUp size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setCompactMode(!subtitle.compactMode)}
          title={subtitle.compactMode ? t('subtitle.bar.expand', 'Expanded view') : t('subtitle.bar.compact', 'Compact view')}
        >
          {subtitle.compactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        <ExportButton {...exportProps} />
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={onClearConversation}
          title={t('subtitle.bar.clear', 'Clear conversation')}
        >
          <Trash2 size={14} />
        </button>

        <span className="subtitle-bar__divider" />

        <button
          type="button"
          className="subtitle-bar__btn"
          ref={refs.setReference}
          {...getReferenceProps()}
          title={t('subtitle.bar.settings', 'Settings')}
        >
          <Settings size={14} />
        </button>
        <button
          type="button"
          className={`subtitle-bar__btn ${subtitle.alwaysOnTop ? 'active' : ''}`}
          onClick={toggleAlwaysOnTop}
          title={t('subtitle.bar.alwaysOnTop', 'Always on top')}
        >
          <Pin size={14} />
        </button>
        <button
          type="button"
          className={`subtitle-bar__btn ${subtitle.positionLocked ? 'active' : ''}`}
          onClick={togglePositionLocked}
          title={t('subtitle.bar.lock', 'Lock position and size')}
        >
          <Lock size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={exitSubtitleMode}
          title={t('subtitle.bar.exit', 'Exit subtitle mode')}
        >
          <X size={14} />
        </button>
      </div>

      {popoverOpen && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
            <SubtitleSettingsPopover />
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};

export default SubtitleBar;
```

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Subtitle/SubtitleBar.tsx src/components/Subtitle/SubtitleBar.scss
git commit -m "feat(subtitle): add three-segment SubtitleBar with reused toolbar buttons"
```

---

### Task 17: SubtitleApp shell with auto-hide and ESC handler

**Files:**
- Create: `src/components/Subtitle/SubtitleApp.tsx`
- Create: `src/components/Subtitle/SubtitleApp.scss`

This component wires SubtitleBar + SubtitleStream + SubtitleSessionEnded together, and owns the auto-hide timer, ESC keybinding, and bounds-changed IPC listener.

- [ ] **Step 1: Implement SCSS**

```scss
// src/components/Subtitle/SubtitleApp.scss
.subtitle-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, var(--subtitle-bg-alpha, 0.7));
  color: var(--subtitle-source-color, #FFFFFF);
}
```

- [ ] **Step 2: Implement component**

```tsx
// src/components/Subtitle/SubtitleApp.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SubtitleBar from './SubtitleBar';
import SubtitleStream from './SubtitleStream';
import SubtitleSessionEnded from './SubtitleSessionEnded';
import {
  useSubtitleSettings,
  useExitSubtitleMode,
  useSaveSubtitleWindowBounds,
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
} from '../../stores/settingsStore';
import { useSessionStore, useCombinedItems, useClearConversation } from '../../stores/sessionStore';
import { useProvider, useCurrentProviderSettings, useLocalInferenceSettings } from '../../stores/settingsStore';
import './SubtitleApp.scss';

const AUTO_HIDE_MS = 1500;

function languageCodeShort(longCode: string): string {
  // Heuristic: take the first 2 chars of the language code, uppercased.
  // 'en' -> 'EN', 'zh_CN' -> 'ZH', 'ja-JP' -> 'JA'.
  if (!longCode) return '?';
  return longCode.slice(0, 2).toUpperCase();
}

const SubtitleApp: React.FC = () => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const exitSubtitleMode = useExitSubtitleMode();
  const saveBounds = useSaveSubtitleWindowBounds();
  const items = useCombinedItems();
  const clearConversation = useClearConversation();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const provider = useProvider();
  const providerSettings = useCurrentProviderSettings();
  const localInferenceSettings = useLocalInferenceSettings();

  const isSessionActive = useSessionStore((s) => s.isSessionActive);
  const sessionStartedAt = useSessionStore((s) => s.startedAt);

  // Heuristics: derive sourceLanguage / targetLanguage from provider settings.
  // The provider settings shape varies; here we read whatever the codebase
  // already exposes. If your provider uses different keys, adjust below.
  const sourceLanguage = (providerSettings as any)?.sourceLanguage ?? 'en';
  const targetLanguage = (providerSettings as any)?.targetLanguage ?? 'zh';

  // Session timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isSessionActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isSessionActive]);
  const elapsedMs = isSessionActive && sessionStartedAt ? now - sessionStartedAt : 0;

  // Auto-hide bar
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMouseEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setBarVisible(true);
  };
  const onMouseLeave = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), AUTO_HIDE_MS);
  };

  // ESC to exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void exitSubtitleMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitSubtitleMode]);

  // Bounds-changed listener (debounced 500 ms before persistence)
  useEffect(() => {
    const electronApi = (window as any).electron;
    if (!electronApi?.receive) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = (bounds: { x: number; y: number; width: number; height: number }) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void saveBounds(bounds), 500);
    };
    electronApi.receive('subtitle:window-bounds-changed', handler);
    return () => electronApi.removeListener?.('subtitle:window-bounds-changed', handler);
  }, [saveBounds]);

  // CSS variables for background
  const bgAlpha = subtitle.bgOpacity / 100;
  const rootStyle: React.CSSProperties = {
    background: hexToRgba(subtitle.bgColor, bgAlpha),
    '--subtitle-bg-alpha': bgAlpha,
    '--bar-opacity': barVisible ? 1 : 0,
  } as any;

  // Detect whether participant has produced any items (proxy for participantHasAudio)
  const participantHasAudio = useMemo(
    () => items.some((it: any) => it.source === 'participant'),
    [items],
  );

  return (
    <div
      className="subtitle-app"
      style={rootStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SubtitleBar
        sessionElapsedMs={elapsedMs}
        sourceLanguageCode={languageCodeShort(sourceLanguage)}
        targetLanguageCode={languageCodeShort(targetLanguage)}
        combinedItems={items}
        onClearConversation={clearConversation}
        participantHasAudio={participantHasAudio}
        exportProps={{
          combinedItems: items,
          provider,
          currentProviderSettings: providerSettings,
          localInferenceSettings,
          sourceLanguage,
          targetLanguage,
        }}
      />
      {isSessionActive ? (
        <SubtitleStream
          items={items}
          compact={subtitle.compactMode}
          fontSize={subtitle.fontSize}
          speakerMode={speakerMode}
          participantMode={participantMode}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          sourceTextColor={subtitle.sourceTextColor}
          translationTextColor={subtitle.translationTextColor}
        />
      ) : (
        <SubtitleSessionEnded onReturn={() => void exitSubtitleMode()} />
      )}
    </div>
  );
};

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default SubtitleApp;
```

If `useCombinedItems`, `useClearConversation`, `useCurrentProviderSettings`, `useLocalInferenceSettings`, or `useSessionStore.startedAt` are named differently in the actual stores, adjust the imports/usages while keeping behavior equivalent. Run `grep -n "combinedItems\|clearConversation\|startedAt\|currentProviderSettings\|localInferenceSettings" src/stores/sessionStore.ts src/stores/settingsStore.ts` to confirm.

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx src/components/Subtitle/SubtitleApp.scss
git commit -m "feat(subtitle): add SubtitleApp shell with auto-hide, ESC, and bounds listener"
```

---

## Phase 5: Wiring

### Task 18: SubtitleEnterButton + MainPanel integration

**Files:**
- Create: `src/components/Subtitle/SubtitleEnterButton.tsx`
- Modify: `src/components/MainPanel/MainPanel.tsx` (line 2889 conversation-toolbar)

- [ ] **Step 1: Create the entry button**

```tsx
// src/components/Subtitle/SubtitleEnterButton.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Captions } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useEnterSubtitleMode } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';

const SubtitleEnterButton: React.FC = () => {
  const { t } = useTranslation();
  const enterSubtitleMode = useEnterSubtitleMode();
  const isSessionActive = useSessionStore((s) => s.isSessionActive);

  if (!isElectron()) return null;

  return (
    <button
      type="button"
      className="font-size-btn"
      onClick={() => void enterSubtitleMode()}
      disabled={!isSessionActive}
      title={
        isSessionActive
          ? t('subtitle.enterButton.title', 'Enter subtitle mode')
          : t('subtitle.enterButton.disabled', 'Start a session first')
      }
      aria-label={t('subtitle.enterButton.title', 'Enter subtitle mode')}
    >
      <Captions size={14} />
    </button>
  );
};

export default SubtitleEnterButton;
```

(`Captions` is from lucide-react. If unavailable in the installed version, swap for `Subtitles` or `MessageSquare` — `npm ls lucide-react` then check the package's icons.)

- [ ] **Step 2: Add to MainPanel conversation-toolbar**

In `src/components/MainPanel/MainPanel.tsx`, add the import at the top:

```tsx
import SubtitleEnterButton from '../Subtitle/SubtitleEnterButton';
```

In the conversation-toolbar JSX (line 2889 onward), insert `<SubtitleEnterButton />` between the participant DisplayMode button and the font-size buttons. The exact spot:

```tsx
{systemAudioItems.length > 0 && (
  <DisplayModeButton
    scope="participant"
    value={participantDisplayMode}
    onChange={setParticipantDisplayMode}
  />
)}
<SubtitleEnterButton />
<button className="font-size-btn" onClick={() => setConversationFontSize(...)}>
  ...
</button>
```

- [ ] **Step 3: Run app, smoke test**

Run: `npm run electron:dev`
Start a session.
Expected: a new captions icon appears in the conversation toolbar between the DisplayMode buttons and the font-size buttons. Clicking it transitions to subtitle mode.

After clicking it: window should snap to the floating-bar layout. (At this point `MainLayout` still renders the main content under the snapped window — that gets fixed in Task 19.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Subtitle/SubtitleEnterButton.tsx src/components/MainPanel/MainPanel.tsx
git commit -m "feat(subtitle): add SubtitleEnterButton in conversation toolbar"
```

---

### Task 19: MainLayout subtitle mode fork

**Files:**
- Modify: `src/components/MainLayout/MainLayout.tsx`

- [ ] **Step 1: Add the fork**

At the top of `src/components/MainLayout/MainLayout.tsx`, import the subtitle parts and the selector:

```tsx
import SubtitleApp from '../Subtitle/SubtitleApp';
import { useSubtitleModeActive } from '../../stores/settingsStore';
```

In the component body, read the flag:

```tsx
const subtitleActive = useSubtitleModeActive();
```

Update the return JSX so that:
- TitleBar is hidden in subtitle mode.
- The existing main content is replaced by `<SubtitleApp />` in subtitle mode.

```tsx
return (
  <>
    {!subtitleActive && isElectron() && <TitleBar />}
    {subtitleActive ? (
      <SubtitleApp />
    ) : (
      <div className="main-layout">
        {/* existing content unchanged */}
      </div>
    )}
  </>
);
```

- [ ] **Step 2: Smoke test the round trip**

Run: `npm run electron:dev`
Start a session, click the captions button.
Expected: window snaps to floating bar; the **only** content rendered is the subtitle bar + stream (no leftover MainLayout body underneath).

Speak / send audio. Expected: bilingual rows scroll into the subtitle stream area.

Press ESC. Expected: window restores to its previous size, custom title bar reappears, MainLayout body returns.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainLayout/MainLayout.tsx
git commit -m "feat(subtitle): fork MainLayout between normal and subtitle mode"
```

---

## Phase 6: i18n + Documentation

### Task 20: Add subtitle.* translation keys

**Files:**
- Modify: `src/locales/en.json` (or whichever file holds the English baseline)

- [ ] **Step 1: Identify the base locale file**

Run: `ls src/locales/` (or `grep -rn "i18next" src/i18n* src/locales*` to find the path).

- [ ] **Step 2: Add subtitle keys to the English locale**

Append (or merge) the following keys into the appropriate JSON object — keep the existing structure:

```json
{
  "subtitle": {
    "sessionEnded": "Session ended",
    "backToMain": "Return to main window",
    "enterButton": {
      "title": "Enter subtitle mode",
      "disabled": "Start a session first"
    },
    "bar": {
      "fontDecrease": "Decrease font size",
      "fontIncrease": "Increase font size",
      "expand": "Expanded view",
      "compact": "Compact view",
      "clear": "Clear conversation",
      "settings": "Subtitle settings",
      "alwaysOnTop": "Always on top",
      "lock": "Lock position and size",
      "exit": "Exit subtitle mode"
    },
    "settings": {
      "bgOpacity": "Background opacity",
      "bgColor": "Background color",
      "sourceColor": "Source text color",
      "translationColor": "Translation color"
    }
  }
}
```

For other locales, leave them missing — i18next will fall back to English. Native-speaker translations can land in a follow-up.

- [ ] **Step 3: Smoke test i18n**

Run: `npm run electron:dev`, hover over each subtitle bar button, open the settings popover.
Expected: tooltips and labels render in English without the literal key path showing.

- [ ] **Step 4: Commit**

```bash
git add src/locales/en.json
git commit -m "feat(subtitle): add English subtitle.* i18n keys"
```

---

### Task 21: Manual test plan document

**Files:**
- Create: `docs/superpowers/specs/2026-05-10-subtitle-mode-manual-test.md`

- [ ] **Step 1: Write the manual test plan**

```markdown
# Subtitle Mode — Manual Test Plan

Run on each target platform: macOS, Windows, Linux X11, Linux Wayland.

## A. Entering subtitle mode

- [ ] 1. Subtitle button is disabled before a session starts.
- [ ] 2. After session start, button is clickable.
- [ ] 3. Click → window transforms to ~80% width × 200 px at the bottom-center of the screen on first use.
- [ ] 4. Custom title bar disappears; subtitle bar appears.
- [ ] 5. Background is translucent; desktop is visible behind it.
- [ ] 6. Live conversation rows scroll into the subtitle area.

## B. Floating bar interaction

- [ ] 7. Drag the bar — window moves.
- [ ] 8. Drag a window edge — window resizes (no visual handle, but cursor + drag work).
- [ ] 9. Cursor leaves window for 1.5 s → bar fades out.
- [ ] 10. Cursor re-enters → bar fades back in.

## C. Lock + always-on-top

- [ ] 11. Click 🔒. Cursor on bar shows it's no longer draggable; window edges no longer resize.
- [ ] 12. Click 🔒 again — restored.
- [ ] 13. With 📌 active, click another app's window. Subtitle stays in front.
- [ ] 14. Toggle 📌 off. Click another app — subtitle goes behind. (Linux Wayland may behave differently per compositor.)

## D. Settings popover

- [ ] 15. Click ⚙ — popover opens; click outside or press Escape — popover closes.
- [ ] 16. Drag opacity slider — background opacity changes live.
- [ ] 17. Click each background color preset — applies live.
- [ ] 18. Source text color preset — speaker source-text rows update.
- [ ] 19. Translation color preset — translation rows update.

## E. Toolbar buttons

- [ ] 20. Speaker DisplayMode cycles `Both → Src → Trans → Both`; subtitle stream filters accordingly.
- [ ] 21. Participant DisplayMode appears only when system audio is connected; same cycle.
- [ ] 22. Font − / Font + change subtitle font size; main panel font does NOT change.
- [ ] 23. Compact toggle changes subtitle row layout; main panel layout unchanged.
- [ ] 24. Export downloads a transcript file.
- [ ] 25. Clear empties the subtitle stream.

## F. Exit and error paths

- [ ] 26. Click ✕ → window restores to prior size and position; main UI returns.
- [ ] 27. Press ESC → same as ✕.
- [ ] 28. While in subtitle mode, manually stop the session (from outside, or by killing network) → "Session ended" placeholder appears with "Return to main window" button.
- [ ] 29. Click "Return to main window" → exits subtitle mode.
- [ ] 30. Quit the app, relaunch, start a session, enter subtitle mode → bounds + opacity match the last session.
- [ ] 31. Enter subtitle mode on an external monitor, save bounds, disconnect the monitor, relaunch → bounds clamp to the primary display.

## G. Custom TitleBar (normal mode)

- [ ] 32. macOS traffic-light buttons render and work.
- [ ] 33. Win/Linux: min, max, close buttons work; double-click on drag region toggles maximize.

## Known platform caveats

- Linux Wayland: alwaysOnTop behavior depends on the compositor (KWin / Mutter / Sway). If `subtitle:set-always-on-top` doesn't keep the window in front, that's a Wayland-level limitation.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-10-subtitle-mode-manual-test.md
git commit -m "docs(specs): add manual test plan for subtitle mode"
```

---

## Self-review notes (already addressed)

- Spec sections all map to tasks: window lifecycle (T1, T9, T11), state (T2-T5), IPC protocol (T6, T10, T11), components (T7, T13-T18), error paths (T5 session-active guard; T11 IPC try/catch; T17 ESC + bounds listener; T19 fork; T13 SubtitleSessionEnded), testing (T1, T5, T13, T14, T21).
- All file paths are concrete; all code is in-line; no `TODO` / `TBD` / `similar to Task N` references.
- Type names used in later tasks (`SubtitleSettings`, `SubtitleWindowBounds`, `DisplayMode`) match the names introduced in Tasks 2-3.
- Method names referenced across tasks: `enterSubtitleMode`, `exitSubtitleMode`, `setSubtitle*`, `toggleSubtitle*`, `saveSubtitleWindowBounds` — all defined in Tasks 4-5 and used consistently in Tasks 11, 16, 17, 18.
- The IPC handler names match the spec exactly (`subtitle:enter`, `subtitle:exit`, `subtitle:set-always-on-top`, `subtitle:set-locked`, `subtitle:get-screen-bounds`, `subtitle:window-bounds-changed`, `window:minimize`, `window:maximize-toggle`, `window:close`).
- The CSS-variable bridge (`--subtitle-source-color`, `--subtitle-translation-color`) is consistent between Task 12 (declares fallback in ConversationRow.scss) and Task 14 (applies on the SubtitleStream root).
