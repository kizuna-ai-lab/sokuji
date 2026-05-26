# Subtitle True Fullscreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Electron-only true-fullscreen toggle to subtitle mode (taskbar/dock hidden), driven by a visible subtitle-bar button, with layered ESC (fullscreen → windowed → exit).

**Architecture:** A new `subtitle:set-fullscreen` IPC calls `BrowserWindow.setFullScreen()`. An ephemeral `subtitleFullscreen` flag in `settingsStore` is the single source of truth, applied live through a new `SubtitleSurface.setFullscreen()` method. The main process forwards OS fullscreen changes back so the flag stays in sync. The flag always resets to `false` on enter (start windowed) and exit.

**Tech Stack:** Electron (main + preload IPC), React + TypeScript, Zustand, Vitest + jsdom, react-i18next, lucide-react.

**Design doc:** `docs/superpowers/specs/2026-05-26-subtitle-fullscreen-design.md`

---

## File Structure

**Main process (no unit tests; manual QA + verified by build):**
- Modify `electron/subtitle-window.js` — add `subtitle:set-fullscreen` handler; force-exit fullscreen in `subtitle:exit`; forward `enter/leave-full-screen`; guard the bounds broadcaster against fullscreen geometry.
- Modify `electron/preload.js` — whitelist the new invoke + receive channels.

**Renderer:**
- Modify `src/components/Subtitle/surfaces/SubtitleSurface.ts` — add `setFullscreen` to the interface.
- Modify `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts` — implement `setFullscreen` (IPC).
- Modify `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` — implement `setFullscreen` (no-op).
- Modify `src/stores/settingsStore.ts` — `subtitleFullscreen` state, `setSubtitleFullscreen`, `__syncSubtitleFullscreen`, reset on enter/exit, selector hooks.
- Modify `src/components/Subtitle/SubtitleBar.tsx` — Electron-only fullscreen toggle button.
- Modify `src/components/Subtitle/SubtitleApp.tsx` — layered ESC + `subtitle:fullscreen-changed` sync effect.
- Modify `src/locales/en/translation.json` — two new `subtitle.bar` keys.

**Tests:**
- Modify `src/stores/settingsStore.subtitle.test.ts` — fullscreen action tests.
- Modify `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts` — `setFullscreen` invokes IPC.
- Create `src/components/Subtitle/SubtitleBar.test.tsx` — button render/toggle.

**Build order rationale:** interface → surfaces (with tests) → store (with tests) → UI button (with test) → ESC/sync wiring → main process IPC → i18n. Each task is independently committable; the renderer compiles at every step because the IPC channels are referenced only through the surface, and the surface no-ops until the main handler exists.

---

## Task 1: Add `setFullscreen` to the surface interface + both implementations

**Files:**
- Modify: `src/components/Subtitle/surfaces/SubtitleSurface.ts`
- Modify: `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts`
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`
- Test: `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('ElectronSubtitleSurface', …)` block in `ElectronSubtitleSurface.test.ts` (before its closing `});`):

```ts
  it('setFullscreen(true) invokes subtitle:set-fullscreen with true', async () => {
    const surface = new ElectronSubtitleSurface();
    await surface.setFullscreen(true);
    expect(invoke).toHaveBeenCalledWith('subtitle:set-fullscreen', true);
  });

  it('setFullscreen(false) invokes subtitle:set-fullscreen with false', async () => {
    const surface = new ElectronSubtitleSurface();
    await surface.setFullscreen(false);
    expect(invoke).toHaveBeenCalledWith('subtitle:set-fullscreen', false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts`
Expected: FAIL — `surface.setFullscreen is not a function`.

- [ ] **Step 3: Add `setFullscreen` to the interface**

In `src/components/Subtitle/surfaces/SubtitleSurface.ts`, replace the whole file with:

```ts
export interface SubtitleSurface {
  /** Open subtitle mode. Must be called inside a user gesture. */
  enter(): Promise<void>;
  /** Exit subtitle mode. Idempotent. */
  exit(): Promise<void>;
  /**
   * Toggle OS-level fullscreen for the subtitle surface. Electron-only;
   * other surfaces implement this as a no-op.
   */
  setFullscreen(flag: boolean): Promise<void>;
}
```

- [ ] **Step 4: Implement in `ElectronSubtitleSurface`**

In `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts`, add this method inside the class, after `exit()`:

```ts
  async setFullscreen(flag: boolean): Promise<void> {
    await window.electron?.invoke('subtitle:set-fullscreen', flag);
  }
```

- [ ] **Step 5: Implement no-op in `ExtensionContentScriptSubtitleSurface`**

In `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`, add this method inside the class, after `exit()` (before the private `tearDown()`):

```ts
  // Fullscreen is an Electron-window concept; the extension overlay lives
  // inside the host page and has no equivalent. No-op by design.
  async setFullscreen(_flag: boolean): Promise<void> {
    /* no-op */
  }
```

- [ ] **Step 6: Update the `NoopSubtitleSurface` so it still satisfies the interface**

In `src/components/Subtitle/surfaces/getSubtitleSurface.ts`, add a `setFullscreen` method to the `NoopSubtitleSurface` class, after its `exit()`:

```ts
  async setFullscreen(): Promise<void> { /* no-op */ }
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test -- src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts`
Expected: PASS (all, including the 2 new).
Run: `npx tsc --noEmit`
Expected: no errors (all three `SubtitleSurface` implementers now have `setFullscreen`).

- [ ] **Step 8: Commit**

```bash
git add src/components/Subtitle/surfaces/SubtitleSurface.ts \
        src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts \
        src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts \
        src/components/Subtitle/surfaces/getSubtitleSurface.ts \
        src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts
git commit -m "feat(subtitle): add setFullscreen to subtitle surface abstraction"
```

---

## Task 2: Add `subtitleFullscreen` state + actions to `settingsStore`

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/settingsStore.subtitle.test.ts`

Context: `getSubtitleSurface` is already imported at the top of `settingsStore.ts` (line 22). The state interface has `subtitleModeActive: boolean;` at line 407; actions `enterSubtitleMode`/`exitSubtitleMode`/`__notifySubtitleSurfaceExited` are declared at lines 417-425 and implemented at lines 913-953.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('settingsStore subtitle actions', …)` block in `settingsStore.subtitle.test.ts`, before its closing `});`:

```ts
  it('setSubtitleFullscreen(true) sets the flag and invokes subtitle:set-fullscreen', async () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    await useSettingsStore.getState().setSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('subtitle:set-fullscreen', true);
  });

  it('setSubtitleFullscreen rolls back the flag if the surface rejects', async () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockImplementationOnce(async (channel: string) => {
      if (channel === 'subtitle:set-fullscreen') throw new Error('boom');
      return { ok: true };
    });
    await useSettingsStore.getState().setSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('enterSubtitleMode resets subtitleFullscreen to false (always start windowed)', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    useSettingsStore.setState({ subtitleFullscreen: true });
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('exitSubtitleMode resets subtitleFullscreen to false', async () => {
    useSettingsStore.setState({ subtitleModeActive: true, subtitleFullscreen: true });
    await useSettingsStore.getState().exitSubtitleMode();
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('__syncSubtitleFullscreen sets state only and does not call the surface', () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    useSettingsStore.getState().__syncSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
```

Also reset the new flag in the block's existing `beforeEach` — change line 47 from:

```ts
    useSettingsStore.setState({ subtitleModeActive: false });
```

to:

```ts
    useSettingsStore.setState({ subtitleModeActive: false, subtitleFullscreen: false });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/settingsStore.subtitle.test.ts`
Expected: FAIL — `subtitleFullscreen` is `undefined` and `setSubtitleFullscreen`/`__syncSubtitleFullscreen` are not functions.

- [ ] **Step 3: Declare the state + actions on the interface**

In `src/stores/settingsStore.ts`, change the subtitle state line (407) from:

```ts
  // Subtitle runtime flag (lifecycle only — subtitle settings live in subtitleStore)
  subtitleModeActive: boolean;
```

to:

```ts
  // Subtitle runtime flags (lifecycle only — subtitle settings live in subtitleStore)
  subtitleModeActive: boolean;
  // Ephemeral: true while subtitle mode is in OS fullscreen. Never persisted;
  // always reset to false on enter (start windowed) and exit. Electron-only.
  subtitleFullscreen: boolean;
```

Then add the action declarations directly after `exitSubtitleMode: () => Promise<void>;` (line 418):

```ts
  /** Toggle OS fullscreen for the active subtitle surface (Electron-only). */
  setSubtitleFullscreen: (flag: boolean) => Promise<void>;
  /**
   * Internal: invoked when the OS fullscreen state changes outside of our
   * setSubtitleFullscreen() call (app menu, F11, macOS gesture). Updates the
   * flag only — does NOT re-invoke the surface, which would loop.
   */
  __syncSubtitleFullscreen: (flag: boolean) => void;
```

- [ ] **Step 4: Initialize the state default**

Find the initial-state object that sets `subtitleModeActive: false` (line ~793) and add the new flag right after it:

```ts
    subtitleModeActive: false,
    subtitleFullscreen: false,
```

- [ ] **Step 5: Implement the actions + reset on enter/exit**

In `src/stores/settingsStore.ts`, in `enterSubtitleMode` (line 924), change:

```ts
      set({ subtitleModeActive: true });
```

to:

```ts
      set({ subtitleModeActive: true, subtitleFullscreen: false });
```

In `exitSubtitleMode` (line 943), change:

```ts
      set({ subtitleModeActive: false });
```

to:

```ts
      set({ subtitleModeActive: false, subtitleFullscreen: false });
```

Then add the two new actions immediately after the `__notifySubtitleSurfaceExited` action (after line 953):

```ts
    setSubtitleFullscreen: async (flag) => {
      const previous = get().subtitleFullscreen;
      if (previous === flag) return;
      set({ subtitleFullscreen: flag });
      try {
        await getSubtitleSurface().setFullscreen(flag);
      } catch (error) {
        console.error('[SettingsStore] setSubtitleFullscreen failed:', error);
        set({ subtitleFullscreen: previous });
      }
    },

    __syncSubtitleFullscreen: (flag) => {
      set({ subtitleFullscreen: flag });
    },
```

- [ ] **Step 6: Add selector hooks**

In the selector-hook cluster near the bottom of `settingsStore.ts` (around line 1620+), `useSubtitleModeActive` is at ~1625 and `useExitSubtitleMode` at ~1627. Add the two new hooks immediately after `useExitSubtitleMode`:

```ts
export const useSubtitleFullscreen = () =>
  useSettingsStore((state) => state.subtitleFullscreen);
export const useSetSubtitleFullscreen = () =>
  useSettingsStore((state) => state.setSubtitleFullscreen);
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test -- src/stores/settingsStore.subtitle.test.ts`
Expected: PASS (existing + 5 new).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.subtitle.test.ts
git commit -m "feat(subtitle): add ephemeral subtitleFullscreen state and actions"
```

---

## Task 3: Add the fullscreen toggle button to `SubtitleBar`

**Files:**
- Modify: `src/components/Subtitle/SubtitleBar.tsx`
- Modify: `src/locales/en/translation.json`
- Test: `src/components/Subtitle/SubtitleBar.test.tsx` (create)

Context: `SubtitleBar` renders an Electron-only `Pin` (always-on-top) button gated by `surface === 'electron'` at lines 178-188, followed by the `Lock` and `X` buttons. Icons are imported from `lucide-react` at the top (line 4-7).

- [ ] **Step 1: Add the i18n strings**

In `src/locales/en/translation.json`, inside `subtitle.bar`, add two keys (after `"alwaysOnTop"`):

```json
    "fullscreen": "Fullscreen",
    "exitFullscreen": "Exit fullscreen",
```

- [ ] **Step 2: Write the failing test**

Create `src/components/Subtitle/SubtitleBar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SubtitleBar from './SubtitleBar';

// i18n: return the default string passed to t(key, default).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

// The fullscreen flag + setter come from settingsStore.
const setSubtitleFullscreen = vi.fn(async () => {});
let fullscreenValue = false;
vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({}) },
  useExitSubtitleMode: () => vi.fn(),
  useSubtitleFullscreen: () => fullscreenValue,
  useSetSubtitleFullscreen: () => setSubtitleFullscreen,
}));

// subtitleStore: provide the settings object + the action hooks SubtitleBar uses.
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({
    fontSize: 24, compactMode: false, positionLocked: false, alwaysOnTop: false,
  }),
  useSetSubtitleFontSize: () => vi.fn(),
  useSetSubtitleCompactMode: () => vi.fn(),
  useToggleSubtitleAlwaysOnTop: () => vi.fn(),
  useToggleSubtitlePositionLocked: () => vi.fn(),
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSetSubtitleSpeakerDisplayMode: () => vi.fn(),
  useSetSubtitleParticipantDisplayMode: () => vi.fn(),
  FONT_SIZE_MIN: 12,
  FONT_SIZE_MAX: 64,
}));

// Drag/resize hook is irrelevant here.
vi.mock('./useOverlayDragResize', () => ({
  useOverlayDragResize: () => ({ dragHandleProps: {}, resizeHandleProps: {} }),
}));

// Stub the child components so we only assert SubtitleBar's own controls and
// don't pull conversationDisplayStore / ServiceFactory transitively.
vi.mock('../MainPanel/DisplayModeButton', () => ({ default: () => null }));
vi.mock('../MainPanel/ExportButton', () => ({ default: () => null }));
vi.mock('../Display/DisplaySettingsPopover', () => ({ default: () => null }));

const baseProps = {
  sessionElapsedMs: 0,
  sourceLanguageCode: 'EN',
  targetLanguageCode: 'ZH',
  onClearConversation: vi.fn(),
  speakerActive: false,
  participantActive: false,
  exportProps: {} as any,
};

beforeEach(() => {
  cleanup();
  setSubtitleFullscreen.mockClear();
  fullscreenValue = false;
});

describe('SubtitleBar fullscreen button', () => {
  it('renders the fullscreen button on the electron surface', () => {
    render(<SubtitleBar {...baseProps} surface="electron" />);
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('does NOT render the fullscreen button on the extension-overlay surface', () => {
    render(<SubtitleBar {...baseProps} surface="extension-overlay" />);
    expect(screen.queryByLabelText('Fullscreen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Exit fullscreen')).not.toBeInTheDocument();
  });

  it('clicking the button enters fullscreen when currently windowed', () => {
    fullscreenValue = false;
    render(<SubtitleBar {...baseProps} surface="electron" />);
    fireEvent.click(screen.getByLabelText('Fullscreen'));
    expect(setSubtitleFullscreen).toHaveBeenCalledWith(true);
  });

  it('shows the exit-fullscreen affordance and exits when already fullscreen', () => {
    fullscreenValue = true;
    render(<SubtitleBar {...baseProps} surface="electron" />);
    fireEvent.click(screen.getByLabelText('Exit fullscreen'));
    expect(setSubtitleFullscreen).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- src/components/Subtitle/SubtitleBar.test.tsx`
Expected: FAIL — `getByLabelText('Fullscreen')` finds nothing (button not implemented).

- [ ] **Step 4: Import the icons + hooks**

In `src/components/Subtitle/SubtitleBar.tsx`, add `Maximize, Minimize` to the existing `lucide-react` import (line 4-7). The block becomes:

```tsx
import {
  AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown,
  Pin, Lock, X, Settings, Trash2, Maximize, Minimize,
} from 'lucide-react';
```

Add the settings-store hooks to the existing import from `../../stores/settingsStore` (currently `import { useExitSubtitleMode } from '../../stores/settingsStore';`):

```tsx
import {
  useExitSubtitleMode,
  useSubtitleFullscreen,
  useSetSubtitleFullscreen,
} from '../../stores/settingsStore';
```

- [ ] **Step 5: Read the hooks in the component body**

In `SubtitleBar`, after `const exitSubtitleMode = useExitSubtitleMode();` (line 71), add:

```tsx
  const fullscreen = useSubtitleFullscreen();
  const setFullscreen = useSetSubtitleFullscreen();
```

- [ ] **Step 6: Render the button (Electron-only), next to the Pin button**

In `SubtitleBar.tsx`, find the Electron-only `Pin` button block (the `{surface === 'electron' && ( … <Pin size={14} /> … )}` at lines 178-188). Insert this new block immediately **before** that `{surface === 'electron' && (` line:

```tsx
        {surface === 'electron' && (
          <button
            type="button"
            className={`subtitle-bar__btn ${fullscreen ? 'active' : ''}`}
            onClick={() => void setFullscreen(!fullscreen)}
            title={fullscreen
              ? t('subtitle.bar.exitFullscreen', 'Exit fullscreen')
              : t('subtitle.bar.fullscreen', 'Fullscreen')}
            aria-label={fullscreen
              ? t('subtitle.bar.exitFullscreen', 'Exit fullscreen')
              : t('subtitle.bar.fullscreen', 'Fullscreen')}
          >
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        )}
```

- [ ] **Step 7: Run test + typecheck**

Run: `npm run test -- src/components/Subtitle/SubtitleBar.test.tsx`
Expected: PASS (4 tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Subtitle/SubtitleBar.tsx \
        src/components/Subtitle/SubtitleBar.test.tsx \
        src/locales/en/translation.json
git commit -m "feat(subtitle): add fullscreen toggle button to subtitle bar"
```

---

## Task 4: Layered ESC + OS-sync effect in `SubtitleApp`

**Files:**
- Modify: `src/components/Subtitle/SubtitleApp.tsx`

Context: `SubtitleApp` currently has an ESC effect at lines 182-190 that always calls `requestExit()`. It already imports hooks from `settingsStore` (line 7-13) and computes `surface` from props. The root element ref (`rootRef`) is used to find the owner document for keyboard listeners.

This task has no new unit test: the ESC layering and the IPC receive wiring depend on `window.electron` + a full component render that the existing `SubtitleApp.test.tsx` (pure-function only) doesn't set up, and the underlying branch logic (`setSubtitleFullscreen` vs `requestExit`) is already covered by the store tests in Task 2. It is verified by typecheck + the manual QA matrix.

- [ ] **Step 1: Import the fullscreen hooks**

In `src/components/Subtitle/SubtitleApp.tsx`, add to the existing `settingsStore` import (lines 7-13):

```tsx
  useSubtitleFullscreen,
  useSetSubtitleFullscreen,
```

so the import reads (keep the other existing names):

```tsx
import useSettingsStore, {
  useExitSubtitleMode,
  useProvider,
  useCurrentProviderSettings,
  useLocalInferenceSettings,
  useCurrentTurnDetectionMode,
  useSubtitleFullscreen,
  useSetSubtitleFullscreen,
} from '../../stores/settingsStore';
```

- [ ] **Step 2: Read the hooks in the component body**

Near the other hook calls at the top of `SubtitleApp` (after `const exitSubtitleMode = useExitSubtitleMode();`, line 82), add:

```tsx
  const fullscreen = useSubtitleFullscreen();
  const setFullscreen = useSetSubtitleFullscreen();
```

- [ ] **Step 3: Make ESC layered**

Replace the existing ESC effect (lines 182-190):

```tsx
  // ESC to exit subtitle mode
  useEffect(() => {
    const target = rootRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestExit();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [requestExit]);
```

with:

```tsx
  // ESC is layered: if we're in fullscreen, the first ESC drops back to the
  // windowed bar; otherwise (or on the next ESC) it exits subtitle mode.
  useEffect(() => {
    const target = rootRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fullscreen) {
        void setFullscreen(false);
      } else {
        requestExit();
      }
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [requestExit, fullscreen, setFullscreen]);
```

- [ ] **Step 4: Sync OS-driven fullscreen changes back into the store (Electron only)**

Add this effect immediately after the ESC effect:

```tsx
  // The OS fullscreen state can change outside our button (app menu, F11,
  // macOS gesture). Mirror it into the store so the bar button + layered ESC
  // stay correct. Electron surface only.
  useEffect(() => {
    if (surface !== 'electron') return;
    if (!window.electron?.receive) return;
    const handler = (flag: boolean) => {
      useSettingsStore.getState().__syncSubtitleFullscreen(Boolean(flag));
    };
    window.electron.receive('subtitle:fullscreen-changed', handler);
    return () => {
      window.electron?.removeListener?.('subtitle:fullscreen-changed', handler);
    };
  }, [surface]);
```

- [ ] **Step 5: Typecheck + run the full subtitle test suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run test -- src/components/Subtitle`
Expected: PASS (existing SubtitleApp/SubtitleStream tests + the new SubtitleBar test).

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx
git commit -m "feat(subtitle): layered ESC and OS fullscreen sync in SubtitleApp"
```

---

## Task 5: Main-process IPC — `subtitle:set-fullscreen`, exit cleanup, event forwarding, bounds guard

**Files:**
- Modify: `electron/subtitle-window.js`
- Modify: `electron/preload.js`

Context (`electron/subtitle-window.js`): `getLiveWindow()` returns the active window or null; `beginTransition()` sets a 600 ms blackout; the `subtitle:exit` handler is at lines 76-99; `setupSubtitleHandlers(mainWindow)` at lines 115-151 wires the resize/move broadcaster (`onChange`, which checks `transitionUntil`) and the `closed` handler. No unit tests for the main process — verified by `npm run build` (no syntax errors) + the manual QA matrix in Task 6.

- [ ] **Step 1: Add the `subtitle:set-fullscreen` IPC handler**

In `electron/subtitle-window.js`, add this handler immediately after the `subtitle:set-locked` handler (it ends at line 113, `});`):

```js
ipcMain.handle('subtitle:set-fullscreen', (_event, flag) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  // Suppress the resize/move broadcaster while the WM animates in/out of
  // fullscreen, so the fullscreen geometry is never persisted as the bar's
  // windowBounds. The isFullScreen() guard added to onChange backs this up.
  beginTransition();
  win.setFullScreen(Boolean(flag));
  return { ok: true };
});
```

- [ ] **Step 2: Force-exit fullscreen on `subtitle:exit` before restoring bounds**

In the `subtitle:exit` handler, add the fullscreen reset right after the `if (!win) return { ok: false };` line (currently line 78) and before `const restore = …`:

```js
  // If the user exits subtitle mode while fullscreen, drop fullscreen first;
  // otherwise setBounds() fights the fullscreen state and the window can be
  // left stuck. Safe to call unconditionally, but guard to avoid a needless
  // transition on the common (windowed) path.
  if (win.isFullScreen()) win.setFullScreen(false);
```

- [ ] **Step 3: Forward OS fullscreen changes + guard the bounds broadcaster**

In `setupSubtitleHandlers(mainWindow)`, locate the `onChange` function (the debounced broadcaster, lines 128-136). Add an `isFullScreen()` short-circuit as its first statement:

```js
  const onChange = () => {
    if (mainWindow.isFullScreen()) return; // never persist fullscreen geometry as bar bounds
    if (Date.now() < transitionUntil) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed() && Date.now() >= transitionUntil) {
        mainWindow.webContents.send('subtitle:window-bounds-changed', mainWindow.getBounds());
      }
    }, 200);
  };
```

Then, immediately after the existing `mainWindow.on('resize', onChange);` / `mainWindow.on('move', onChange);` lines (137-138), add the fullscreen-event forwarders:

```js
  const onFullScreen = () =>
    mainWindow.webContents.send('subtitle:fullscreen-changed', true);
  const onLeaveFullScreen = () =>
    mainWindow.webContents.send('subtitle:fullscreen-changed', false);
  mainWindow.on('enter-full-screen', onFullScreen);
  mainWindow.on('leave-full-screen', onLeaveFullScreen);
```

- [ ] **Step 4: Whitelist the new invoke channel in preload**

In `electron/preload.js`, in the `invoke` `validChannels` array, add `'subtitle:set-fullscreen'` to the Subtitle mode IPC group (after `'subtitle:set-locked'`, line 141):

```js
        'subtitle:set-always-on-top',
        'subtitle:set-locked',
        'subtitle:set-fullscreen',
        'subtitle:get-screen-bounds',
```

- [ ] **Step 5: Whitelist the new receive channel in preload**

In `electron/preload.js`, in `validReceiveChannels` (lines 57-65), add `'subtitle:fullscreen-changed'` after `'subtitle:window-bounds-changed'`:

```js
  // Subtitle window bounds change events
  'subtitle:window-bounds-changed',
  'subtitle:fullscreen-changed',
```

- [ ] **Step 6: Build to verify no syntax errors**

Run: `npm run build`
Expected: build succeeds (Vite builds the renderer; the Electron JS is plain CommonJS — confirm no syntax error by `node --check`):
Run: `node --check electron/subtitle-window.js && node --check electron/preload.js`
Expected: no output (both parse cleanly).

- [ ] **Step 7: Commit**

```bash
git add electron/subtitle-window.js electron/preload.js
git commit -m "feat(subtitle): add subtitle:set-fullscreen IPC and fullscreen event sync"
```

---

## Task 6: Full verification + manual QA

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm run test`
Expected: PASS (no regressions; new tests from Tasks 1-3 green).

- [ ] **Step 2: Typecheck the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual QA in the Electron app**

Run: `npm run electron:dev`

Verify (repeat the bullets on Linux, then Windows, then macOS where available):
- [ ] Start a session, enter subtitle mode → it opens **windowed** (bar at bottom), not fullscreen.
- [ ] Click the new ⤢ button → window goes **true fullscreen**, taskbar/dock hidden; the bar auto-hides ~1.5 s after the mouse leaves, leaving only captions.
- [ ] Move the mouse → bar reappears; the button now shows the Minimize icon / "Exit fullscreen" label.
- [ ] Click ⤢ again (or press **ESC**) → returns to the **windowed bar** at its previous size/position (does NOT exit subtitle mode).
- [ ] Press **ESC** again from windowed → exits subtitle mode back to the normal app window.
- [ ] Enter subtitle mode → fullscreen → press the bar's **✕** → exits cleanly to the normal window (not stuck fullscreen, correct pre-subtitle size).
- [ ] Resize the windowed bar, exit and re-enter subtitle mode → the bar keeps your resized geometry (a fullscreen round-trip did NOT overwrite `windowBounds`).
- [ ] (If reachable) Trigger OS fullscreen via the app menu / F11 / macOS gesture while in subtitle mode → the bar button label and ESC behavior stay correct.
- [ ] macOS only: compare `win.setFullScreen(true)` vs `win.setSimpleFullScreen(true)` — if the native-Space animation is jarring or fights always-on-top, switch the `subtitle:set-fullscreen` handler to `setSimpleFullScreen` on `process.platform === 'darwin'` and re-verify.

- [ ] **Step 4: Commit any QA-driven fix (e.g. macOS simpleFullScreen)**

If a fix was needed:

```bash
git add electron/subtitle-window.js
git commit -m "fix(subtitle): use setSimpleFullScreen on macOS for in-place fullscreen"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** every spec section maps to a task — surface method (T1), settingsStore flag/actions/reset/hooks (T2), bar button + i18n (T3), layered ESC + OS-sync effect (T4), main IPC + exit cleanup + event forwarding + bounds guard + preload whitelists (T5), test matrix incl. manual QA (T1-T3 unit, T6 manual). Non-goals (extension fullscreen, persistence, F11 entry, kiosk) are respected: extension surface no-ops (T1), flag is ephemeral and reset on enter/exit (T2), toggle is button + ESC only with OS-sync tolerance (T4).
- **Type consistency:** `setFullscreen(flag: boolean): Promise<void>` is identical across the interface and all implementers; `setSubtitleFullscreen`/`__syncSubtitleFullscreen` and the hooks `useSubtitleFullscreen`/`useSetSubtitleFullscreen` are named identically wherever referenced; IPC channels `subtitle:set-fullscreen` (invoke) and `subtitle:fullscreen-changed` (receive) match across preload, main, surface, and SubtitleApp.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; the macOS `setSimpleFullScreen` choice is a bounded, optional QA-driven refinement (T6 Step 3/4), not a placeholder.
