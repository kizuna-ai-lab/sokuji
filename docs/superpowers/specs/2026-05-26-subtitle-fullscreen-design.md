# Subtitle — True Fullscreen Mode

**Date:** 2026-05-26
**Status:** Design approved, ready for implementation plan
**Scope:** Electron desktop only

## Problem

Subtitle mode is meant for projecting live captions onto a big screen during classes, training sessions, and speaking contests. Today a user can get close to a clean presentation:

1. Enter subtitle mode (the captions button in the title bar).
2. Adjust font size (`A− / A+`) and background/opacity/text colors (the gear popover).
3. Double-click the subtitle bar's drag region — the OS **maximizes** the frameless window so the captions fill the screen.
4. Move the mouse away — the control bar auto-hides after ~1.5 s, leaving only the source/translated text.

The gap: step 3 is **window maximize**, not true fullscreen. The window fills the work area, but the **OS taskbar/dock at the bottom is still visible**, so the result isn't a fully immersive, distraction-free projection. The maximize gesture is also an undiscoverable OS behavior (double-clicking a drag region), which is why users don't realize a near-fullscreen presentation is already possible.

This feature adds a real, taskbar-free fullscreen toggle to subtitle mode.

## Goals & Non-Goals

**Goals**
- Add a one-click **true fullscreen** toggle to subtitle mode that hides the taskbar/dock entirely (`BrowserWindow.setFullScreen`).
- Make it discoverable: a visible button in the subtitle bar, alongside the existing Pin / Lock controls.
- Layered exit that protects a live class: in fullscreen, ESC returns to the windowed bar; only a second ESC (from windowed) exits subtitle mode.
- Fullscreen is an intentional, in-the-moment action: entering subtitle mode always starts windowed.
- Keep the saved subtitle bar geometry (`windowBounds`) intact across a fullscreen round-trip.

**Non-Goals**
- The browser extension overlay. "Fullscreen" there is a fundamentally different mechanism (the Web Fullscreen API on the host tab, user-gesture constraints) and is out of scope. The extension surface keeps its current behavior; the fullscreen button is not rendered there.
- Persisting the fullscreen state across subtitle sessions. It is ephemeral by design (see "always start windowed").
- A second keybinding (e.g. F11). Toggle is the bar button; exit is ESC. F11/menu-driven toggles are still *tolerated* and synced (see edge cases) but not a designed entry point.
- Changing the existing double-click-to-maximize behavior, font/color controls, auto-hide bar, or the windowed bar geometry.
- Kiosk mode (`setKiosk`). Too locked-down for a classroom toggle and easy to trap a non-technical user.

## Background — how subtitle mode works today

- Subtitle mode **reuses the main `BrowserWindow`**. `electron/subtitle-window.js` handles `subtitle:enter` by snapshotting the current ("normal") bounds, then resizing the window to a bar (80% width × 200 px, bottom-center), setting always-on-top / resizable, and hiding the macOS traffic lights. `subtitle:exit` restores the snapshot.
- Existing subtitle IPC: `subtitle:enter`, `subtitle:exit`, `subtitle:set-always-on-top`, `subtitle:set-locked`, `subtitle:get-screen-bounds`, plus the `subtitle:window-bounds-changed` event (renderer ← main).
- A resize/move broadcaster persists the user's bar geometry as `windowBounds`. It is guarded by a `TRANSITION_BLACKOUT_MS = 600` window (`beginTransition()`) so WM-settling intermediate sizes aren't saved.
- **Note discovered during design:** `subtitle:set-always-on-top` / `subtitle:set-locked` are registered in the main process and whitelisted in preload, but **no renderer code currently invokes them** — `alwaysOnTop` / `positionLocked` are applied only at `subtitle:enter` via the payload. There is therefore no existing "live-apply mid-session" path to copy; fullscreen introduces the first one.
- The subtitle surface abstraction (`SubtitleSurface { enter(); exit() }`) has two implementations selected by `getSubtitleSurface()`: `ElectronSubtitleSurface` and `ExtensionContentScriptSubtitleSurface`.
- Persisted subtitle preferences live in `subtitleStore` (colors, font size, `alwaysOnTop`, `positionLocked`, `windowBounds`). Subtitle **session/lifecycle** state (`subtitleModeActive`, enter/exit orchestration) lives in `settingsStore`.

## Design

### Where the fullscreen flag lives

An ephemeral `subtitleFullscreen: boolean` in **`settingsStore`**, next to `subtitleModeActive` — **not** in `subtitleStore`.

Rationale:
- It is session/lifecycle state, not a persisted preference (contrast with colors / alwaysOnTop, which persist).
- `settingsStore` already owns the subtitle lifecycle and imports `getSubtitleSurface()`, so the live-apply call has a natural, cycle-free home. (`subtitleStore` is imported *by* `ElectronSubtitleSurface`, so having `subtitleStore` reach back to the surface would create an import cycle.)
- It must reset to `false` on every `enterSubtitleMode` — the "always start windowed" requirement.

### Components & responsibilities

1. **`electron/subtitle-window.js`** — the real mechanism
   - New `ipcMain.handle('subtitle:set-fullscreen', (_event, flag) => …)`: resolve the live window (`getLiveWindow()`); if none, return `{ ok: false }` (same contract as the other handlers); else `beginTransition()` then `win.setFullScreen(Boolean(flag))`, return `{ ok: true }`.
   - `subtitle:exit`: if `win.isFullScreen()`, call `win.setFullScreen(false)` **before** restoring the bounds snapshot, so exit never leaves a "normal-size window stuck in a fullscreen Space" state.
   - `setupSubtitleHandlers(mainWindow)`: forward `mainWindow.on('enter-full-screen' | 'leave-full-screen')` to the renderer as `subtitle:fullscreen-changed(boolean)`; and add `if (mainWindow.isFullScreen()) return;` at the top of the bounds-changed broadcaster (`onChange`) so a fullscreen-sized geometry is never persisted as the bar's `windowBounds`.

2. **`electron/preload.js`** — whitelist `subtitle:set-fullscreen` (invoke) and `subtitle:fullscreen-changed` (receive).

3. **`src/components/Subtitle/surfaces/SubtitleSurface.ts`** — add `setFullscreen(flag: boolean): Promise<void>`.
   - `ElectronSubtitleSurface.setFullscreen` → `window.electron?.invoke('subtitle:set-fullscreen', flag)`.
   - `ExtensionContentScriptSubtitleSurface.setFullscreen` → no-op (Electron-only scope).

4. **`src/stores/settingsStore.ts`**
   - State: `subtitleFullscreen: boolean` (ephemeral, default `false`).
   - `setSubtitleFullscreen(flag)`: optimistic `set({ subtitleFullscreen: flag })`, then `await getSubtitleSurface().setFullscreen(flag)`; revert the flag on rejection.
   - `__syncSubtitleFullscreen(flag)`: state-only setter for the OS-driven `subtitle:fullscreen-changed` event — **does not** call the surface (prevents an IPC feedback loop).
   - Reset `subtitleFullscreen = false` in **both** `enterSubtitleMode` (start windowed) and `exitSubtitleMode` (clean teardown).
   - Selector hooks: `useSubtitleFullscreen`, `useSetSubtitleFullscreen`.

5. **`src/components/Subtitle/SubtitleBar.tsx`** — an Electron-only Maximize/Minimize toggle button beside the Pin/Lock buttons (gated on `surface === 'electron'`). Reads `useSubtitleFullscreen`; `onClick` → `setSubtitleFullscreen(!current)`; icon and `aria-label` reflect enter-vs-exit.

6. **`src/components/Subtitle/SubtitleApp.tsx`**
   - Layered ESC: if `subtitleFullscreen` → `setSubtitleFullscreen(false)`; else → `requestExit()` (today's behavior).
   - Electron-surface effect: subscribe to `subtitle:fullscreen-changed` → `__syncSubtitleFullscreen(flag)`; clean up on unmount.

7. **i18n** — `subtitle.bar.fullscreen` / `subtitle.bar.exitFullscreen` in `en/translation.json`. English fallback covers the other locales (existing convention).

### State machine (within an active subtitle session)

```
                 ┌─────────────────────── ESC ◄─────────────────────┐
                 ▼                                                   │
        ┌──────────────────┐  ⤢ button / setFullscreen(true)   ┌──────────────────┐
        │  WINDOWED bar    │ ───────────────────────────────►  │   FULLSCREEN     │
        │ (80%×200 bottom) │ ◄───────────────────────────────  │ (setFullScreen)  │
        └──────────────────┘  ⤢ button / ESC / setFullscreen(false) └─────────────┘
                 │ ESC (windowed)                                       │
                 ▼                                                      │
        ┌──────────────────┐                                           │
        │ subtitle EXITED   │ ◄── exit always forces setFullScreen(false)
        │ (normal window)   │
        └──────────────────┘
```

- Enter subtitle mode → always **WINDOWED** (`subtitleFullscreen` reset on enter).
- **⤢ button** toggles WINDOWED ⇄ FULLSCREEN.
- **ESC**: FULLSCREEN → WINDOWED; WINDOWED → EXITED.
- **✕ / exit** from any state → EXITED; `subtitle:exit` forces `setFullScreen(false)` first, then restores pre-subtitle bounds.

### Data flow — entering fullscreen (button click)

1. `SubtitleBar` ⤢ click → `setSubtitleFullscreen(true)`.
2. Store optimistically sets `subtitleFullscreen = true`, then `await getSubtitleSurface().setFullscreen(true)`.
3. `ElectronSubtitleSurface` → `invoke('subtitle:set-fullscreen', true)`.
4. Main: `beginTransition()` → `win.setFullScreen(true)`. The 600 ms blackout + `isFullScreen()` guard prevent the fullscreen geometry from being persisted as the bar bounds.
5. Window emits `enter-full-screen` → main sends `subtitle:fullscreen-changed(true)` → `SubtitleApp` effect → `__syncSubtitleFullscreen(true)` (state-only; idempotent here).
6. Auto-hide bar fades after ~1.5 s → only captions on the chosen background fill the screen; taskbar/dock gone.

Exiting fullscreen runs the same path with `false`; Electron restores the previous (bar) bounds; `leave-full-screen` keeps the button state correct.

### Edge cases

- **OS-initiated fullscreen toggle** (app menu `togglefullscreen`, macOS gesture, F11): caught by `enter/leave-full-screen` → `__syncSubtitleFullscreen` keeps the flag and button label correct, without re-invoking the IPC (no loop).
- **Exit subtitle mode while fullscreen** (✕ or second ESC): `subtitle:exit` forces `setFullScreen(false)` before restoring bounds — no stuck state.
- **Bounds persistence**: `beginTransition()` on every toggle + `if (isFullScreen()) return;` in the broadcaster guarantee `windowBounds` keeps the bar geometry, never fullscreen geometry.
- **Window recreated / `activeWindow` null** (macOS dock-close/reopen): `set-fullscreen` returns `{ ok: false }`; the optimistic store update reverts.
- **macOS**: `setFullScreen(true)` uses a native Space with animation. Evaluate `setSimpleFullScreen(true)` as a macOS refinement (instant, in-place, plays nicer with always-on-top) during implementation/QA; baseline is `setFullScreen` cross-platform.
- **always-on-top / lock / resize while fullscreen**: moot (OS owns the window); buttons remain but have no harmful effect. No special handling.
- **Extension surface**: `setFullscreen` is a no-op and the ⤢ button isn't rendered, so nothing changes there.

## Testing

Renderer/unit tests (Vitest + jsdom, colocated `*.test.tsx`); the main-process IPC is verified by manual QA. Mock `window.electron` and the surface.

1. **`settingsStore`**
   - `setSubtitleFullscreen(true)` sets the flag and calls `surface.setFullscreen(true)`.
   - On surface rejection, the flag reverts.
   - `enterSubtitleMode` and `exitSubtitleMode` both reset `subtitleFullscreen` to `false`.
   - `__syncSubtitleFullscreen(flag)` sets state only; does not call the surface.

2. **`SubtitleBar`**
   - ⤢ button renders only when `surface === 'electron'` (absent for `extension-overlay`).
   - Click toggles via `setSubtitleFullscreen(!current)`; icon/`aria-label` reflect Maximize vs Minimize.

3. **`SubtitleApp`**
   - ESC with `subtitleFullscreen=true` → `setSubtitleFullscreen(false)`, does not exit subtitle mode.
   - ESC while windowed → `requestExit()` (unchanged).
   - `subtitle:fullscreen-changed` event drives `__syncSubtitleFullscreen`.

4. **`ElectronSubtitleSurface`** — `setFullscreen(flag)` invokes `'subtitle:set-fullscreen'` with the flag; the extension surface's `setFullscreen` is a no-op.

**Manual QA matrix** (Linux / Windows / macOS): enter/exit fullscreen via the button; ESC layering (FULLSCREEN → WINDOWED → EXITED); exit-from-fullscreen via ✕; confirm the taskbar/dock is hidden in fullscreen; confirm the bar returns to its prior size/position on exit; confirm `windowBounds` is unchanged after a fullscreen round-trip. macOS: compare `setFullScreen` vs `setSimpleFullScreen`.
