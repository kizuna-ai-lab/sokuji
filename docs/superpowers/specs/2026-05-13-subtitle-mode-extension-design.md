# Subtitle Mode — Browser Extension (v2) — Design

**Date**: 2026-05-13
**Status**: Approved for implementation planning
**Tracking issue**: [#226](https://github.com/kizuna-ai-lab/sokuji/issues/226)
**Related**: [v1 Electron design](2026-05-10-subtitle-mode-design.md), [v1 manual test plan](2026-05-10-subtitle-mode-manual-test.md), original discussion [#118](https://github.com/kizuna-ai-lab/sokuji/discussions/118), v1 PR [#225](https://github.com/kizuna-ai-lab/sokuji/pull/225)

## Context

`v0.26.0` shipped subtitle mode for the Electron desktop app: a translucent, always-on-top floating bar that streams the live bilingual translation while the user is on a video call or watching a video. The v1 design explicitly scoped the work to Electron because the implementation reshapes the single `BrowserWindow` and relies on `setBounds`, `setAlwaysOnTop`, `frame: false`, `transparent: true`, and a `subtitle:*` IPC channel — none of which exist for the browser extension.

This v2 brings an equivalent experience to the Chrome / Edge extension. The extension's surface is the side panel, which is locked to the browser window and is taller than wide. Users running Sokuji over Google Meet / Teams / Zoom either eat horizontal screen space with the panel or lose the live-translation view entirely when the call goes fullscreen. The goal of v2 is to give those users the same compact, bottom-of-screen bilingual stream as Electron users.

The v1 React components (`SubtitleApp`, `SubtitleBar`, `SubtitleStream`, `SubtitleSettingsPopover`, `SubtitleSessionEnded`) and the `subtitle.*` settings in `settingsStore.ts` are platform-agnostic. They are reused as-is, with two small prop additions to suppress Electron-only widgets.

## Surface choice

Three candidate surfaces were evaluated:

1. **Document Picture-in-Picture** — `documentPictureInPicture.requestWindow(...)` opens a real always-on-top floating browser window driven from the side panel. Same JS / store / event loop, mounted via a second React root. Works on any tab. Floats over the OS. Survives tab switches. Chrome 116+ (already the manifest minimum).
2. **Content-script in-tab overlay** — Inject a floating DOM into the active tab from the existing content scripts. Visually adjacent to the meeting, but only works on the nine supported meeting sites, is confined to the browser viewport, dies on tab switch, and requires cross-context messaging + Shadow DOM CSS isolation.
3. **Compact side-panel mode** — Switch the side panel to a slim subtitle-only layout. Cheapest, but doesn't free screen space and doesn't float anywhere.

v2 ships **only (1)**. It is the only option that delivers the actual user benefit — a floating bar over any application — and it has the cleanest architecture by a wide margin (same React tree, no cross-context messaging, no Shadow DOM, no CSP wrangling). (2) and (3) are explicitly deferred; see [Out of Scope](#out-of-scope-for-v2).

## Non-Goals

- Content-script in-tab overlay (Approach 2). Tracked as a possible v2.1 follow-up only if user demand surfaces.
- Compact side-panel mode (Approach 3).
- Floating the subtitle bar over **non-browser** applications from the extension. (Possible via a separate desktop helper; product-level decision.)
- Replacing the existing Electron subtitle mode.
- Per-site customization beyond what `extension/src/content/` already handles.
- Persisting the PiP window's position. Chrome does not expose PiP window x/y to the calling page, so there is nothing to persist.

## User-Visible Behavior

### Entering / leaving

- The conversation toolbar in `MainPanel` shows the existing `SubtitleEnterButton`. It is disabled until `sessionStore.isActive === true`.
- In the extension, it is also disabled (with a tooltip) when the browser doesn't expose `documentPictureInPicture`. (At Chrome 116+, our manifest floor, this is defensive.)
- Click → `documentPictureInPicture.requestWindow({ width, height })` is called from the user gesture; a new floating window appears. The side panel itself does **not** change layout — `MainShell` stays visible behind it.
- Exit pathways, all equivalent:
  - The in-bar `✕` button.
  - The native OS window-chrome close button.
  - `ESC` pressed while the PiP window is focused.
  - Side-panel close (force-closes the PiP window before its JS context dies).

### Floating bar layout

The same three-segment bar from v1 (`SubtitleBar`), with two changes for the PiP surface:

- The 📌 always-on-top toggle is hidden. PiP windows are always-on-top by definition.
- The 🔒 lock toggle is hidden. Chrome handles drag/resize via native window chrome and does not expose lock semantics.

Everything else — logo, timer, language pair, speaker / participant display-mode buttons, font − / +, compact toggle, ExportButton, Clear, ⚙ settings popover, in-bar ✕ — renders unchanged.

The bar's drag region (`-webkit-app-region: drag`) is dropped on the PiP path. Native chrome already provides the drag handle.

### Auto-hide

Same as v1: 1500 ms after the cursor leaves the window, the bar fades to `opacity: 0`; mouse re-enter snaps it back. Layout is unaffected; only opacity changes. Cursor events fire normally on the PiP `document`.

### Subtitle stream

Identical to v1. `SubtitleStream` reads `combinedItems` from `sessionStore`, applies the existing `filterByDisplayMode` helper, and renders `ConversationRow`s in a fixed-height scroll container that sticks to the bottom. The CSS variable hooks `--subtitle-source-color` and `--subtitle-translation-color` are set on the stream root and resolve inside the PiP document because we copy the stylesheets across.

### Settings popover (⚙)

Identical to v1. Persisted under `settings.common.subtitle.*` (already in `settingsStore`). CSS-only effect; no surface call required.

### Session lifecycle inside subtitle mode

Identical to v1. When `sessionStore.isActive` flips to `false`, the stream is replaced by `<SubtitleSessionEnded>`; the bar with its ✕ stays. "Return to main window" calls `exitSubtitleMode()`.

## Architecture & Window Lifecycle

```
[Side panel  fullpage.html]                  [PiP window  requestWindow]
 ┌─────────────────────────────┐              ┌──────────────────────────────┐
 │ <AppProviders>              │              │ <AppProviders>               │
 │   <MainShell>               │              │   <SubtitleApp surface="pip">│
 │ React store (Zustand)       │              │ same React store via shared  │
 │ session + audio pipeline    │ ── React ───►│ JS context; second createRoot│
 │ enterSubtitleMode()         │   portal-     │ on pipWindow.document        │
 │   → PipSubtitleSurface.enter│   like        │                              │
 │     requestWindow + render  │   mount       │ Native OS chrome:            │
 │ exitSubtitleMode()          │              │   drag, resize, ✕             │
 │   → PipSubtitleSurface.exit │              │ Custom in-bar controls:      │
 │     pipWindow.close()       │              │   ESC, ✕, font, compact, …   │
 │ beforeunload → close PiP    │              └──────────────────────────────┘
 └─────────────────────────────┘
```

Invariants:

- One PiP window at a time. `enterSubtitleMode()` is idempotent — re-entrant calls while a PiP window already exists are no-ops.
- The side panel owns the session and the store; the PiP window is presentation-only.
- Closing PiP (any pathway) always sets `subtitleModeActive=false`.
- If the side panel's document unloads, the PiP window is explicitly closed first so the user never sees a frozen subtitle bar.

## Surface Abstraction

To keep `SubtitleApp`, `SubtitleBar`, and `settingsStore` free of `if (isElectron) … else if (isExtension) …` ladders, all platform-specific window machinery moves behind a thin interface.

```
src/components/Subtitle/surfaces/
  SubtitleSurface.ts          // interface { supports, enter, exit }
  ElectronSubtitleSurface.ts  // wraps existing subtitle:* IPC — refactor only
  PipSubtitleSurface.ts       // new — Document Picture-in-Picture
  getSubtitleSurface.ts       // picks via src/utils/environment.ts
  index.ts                    // re-exports
```

```ts
// SubtitleSurface.ts
export interface SubtitleSurface {
  /** True when the platform/browser can host the subtitle surface. */
  supports(): boolean;
  /** Open the subtitle surface. Must be called inside a user gesture. */
  enter(): Promise<void>;
  /** Close the subtitle surface. Idempotent. */
  exit(): Promise<void>;
}
```

`enterSubtitleMode()` and `exitSubtitleMode()` in `settingsStore.ts` delegate to `getSubtitleSurface().enter()` / `.exit()`. The store no longer references `window.electron.invoke('subtitle:enter', …)` directly. Persisted settings stay shared across surfaces.

The Electron refactor is strictly mechanical: the existing IPC payloads, channels, and clamping behavior are preserved, just relocated into `ElectronSubtitleSurface`. v1 tests continue to pass unchanged.

## PiP Surface Implementation

```ts
// PipSubtitleSurface.ts (sketch)
const DEFAULT_SIZE = { width: 720, height: 220 };

let pipWindow: Window | null = null;
let pipRoot: import('react-dom/client').Root | null = null;
let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

export function supports(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function enter(): Promise<void> {
  if (pipWindow) return;

  const size = readPersistedSize() ?? DEFAULT_SIZE;
  pipWindow = await (window as any).documentPictureInPicture.requestWindow(size);

  copyStylesheetsInto(pipWindow.document);
  pipWindow.document.title = 'Sokuji subtitle';
  pipWindow.document.body.classList.add('subtitle-pip-body');

  const mount = pipWindow.document.createElement('div');
  mount.id = 'subtitle-pip-root';
  pipWindow.document.body.appendChild(mount);

  pipRoot = createRoot(mount);
  pipRoot.render(
    <AppProviders>
      <SubtitleApp surface="pip" />
    </AppProviders>,
  );

  pipWindow.addEventListener('pagehide', handlePipClosed);
  pipWindow.addEventListener('resize', schedulePersistSize);
  window.addEventListener('beforeunload', forceClosePipOnUnload);
}

export async function exit(): Promise<void> {
  if (!pipWindow) return;
  pipWindow.close(); // triggers 'pagehide' → handlePipClosed
}

function handlePipClosed() {
  window.removeEventListener('beforeunload', forceClosePipOnUnload);
  if (resizeDebounce) clearTimeout(resizeDebounce);
  pipRoot?.unmount();
  pipRoot = null;
  pipWindow = null;
  // Flip store flag in case PiP was closed via OS ✕ rather than exitSubtitleMode().
  useSettingsStore.getState().__notifySubtitleSurfaceExited();
}
```

Implementation notes:

- **Stylesheets**: `copyStylesheetsInto(doc)` clones every `<link rel="stylesheet">` and inline `<style>` from the side panel's `<head>` into the PiP `<head>`. This is the standard PiP pattern. For Vite-built `<link>` URLs (extension-relative), the same URL resolves identically in the PiP document because the PiP origin is the side panel's origin.
- **Providers**: The current provider stack in `src/index.tsx` (i18n, theming, Auth, etc.) is extracted into a single `<AppProviders>` component and reused for both the side panel mount and the PiP mount. The Zustand store is module-level, so both roots share state automatically.
- **PiP size**: Chrome exposes the PiP window's `innerWidth` / `innerHeight` and fires `resize`. We persist them to `subtitle.pipWindowSize` (new) and read them on next enter. The PiP window's x/y are deliberately not persisted (not exposed).
- **`__notifySubtitleSurfaceExited`**: Private store action that flips `subtitleModeActive=false` without calling `surface.exit()` again. Used by the surface to report unsolicited closes (OS ✕, ESC inside PiP, side-panel unload).

### Surface gating

`SubtitleEnterButton.tsx` currently short-circuits with `if (!isElectron()) return null` (line 13). That guard is replaced by `if (!getSubtitleSurface().supports()) return null`. In Electron, `supports()` is always true (IPC is available). In the extension, `supports()` is true on Chromium ≥ 116 with PiP API exposed.

## State (settingsStore)

The existing `SubtitleSettings` interface is reused. One field is added:

```ts
export interface SubtitleSettings {
  fontSize: number;
  compactMode: boolean;
  bgOpacity: number;
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;

  // Electron-only — already persisted by v1, ignored by the PiP surface.
  alwaysOnTop: boolean;
  positionLocked: boolean;
  windowBounds: { x: number; y: number; width: number; height: number } | null;

  // New for extension PiP surface — Electron ignores.
  pipWindowSize: { width: number; height: number } | null;
}
```

New action:

| Action | Side effect |
|---|---|
| `setSubtitlePipWindowSize({ width, height })` | Persist only. Triggered by the PiP surface's debounced (≈500 ms) resize handler. |

`enterSubtitleMode` / `exitSubtitleMode` are unchanged in shape; their bodies now call the surface abstraction. A new private `__notifySubtitleSurfaceExited()` action lets the surface flip `subtitleModeActive` when the user closes the PiP window through native chrome.

Selectors `useSubtitlePipWindowSize` / `useSetSubtitlePipWindowSize` are added alongside the existing subtitle selectors.

## Component Changes

| File | Change |
|---|---|
| `src/components/Subtitle/SubtitleEnterButton.tsx` | Replace the `isElectron()` guard with `getSubtitleSurface().supports()`. Tooltip text branches on `isSessionActive` (existing) — no PiP-specific copy required at v2. |
| `src/components/Subtitle/SubtitleApp.tsx` | Add `surface?: 'electron' \| 'pip'` prop (default `'electron'`). When `surface === 'pip'`, skip the `subtitle:window-bounds-changed` listener. **Rebind the ESC `keydown` listener from the module-level `window` to `rootRef.current?.ownerDocument` (or its `.defaultView`).** The module-level `window` is bound to the side panel's window at script load even when the component renders into a second React root, so the v1 code (line 134, `window.addEventListener('keydown', onKey)`) would silently attach to the wrong window in PiP mode. The fix is single-surface (works correctly in Electron too) — adopt a `useRef` on the root `<div>` and read `rootRef.current.ownerDocument` inside the effect to get the actual hosting document. |
| `src/components/Subtitle/SubtitleBar.tsx` | Accept `surface`. When `surface === 'pip'`: hide 📌 (`alwaysOnTop`) and 🔒 (`positionLocked`); drop the `-webkit-app-region: drag` styling. |
| `src/App.tsx` | Unchanged on the extension path. The side panel keeps rendering `<MainShell>` regardless of `subtitleModeActive` — the PiP window is its own React root. Electron path keeps the existing fork (`subtitleActive ? <SubtitleApp /> : <MainShell />`). |
| `src/index.tsx` | Extract today's provider stack (i18n, theme, Auth, etc.) into a reusable `<AppProviders>` component. Used by the main mount and by `PipSubtitleSurface`. |
| `src/stores/settingsStore.ts` | (1) Add `pipWindowSize` to `SubtitleSettings` and its defaults / hydration. (2) Add `setSubtitlePipWindowSize`. (3) Refactor `enterSubtitleMode` / `exitSubtitleMode` to call the surface abstraction. (4) Add private `__notifySubtitleSurfaceExited`. |

Reused unchanged: `SubtitleStream`, `SubtitleSettingsPopover`, `SubtitleSessionEnded`, `ConversationRow`, `DisplayModeButton`, `ExportButton`, `conversationFilter.ts`, `sessionStore`.

## Error Handling & Edge Cases

1. **Browser without Document PiP** — `getSubtitleSurface().supports()` returns false. `SubtitleEnterButton` does not render. Defensive only; Chrome 116+ is the manifest floor.
2. **PiP request denied** — `requestWindow()` rejects (e.g. browser policy / permissions policy). Surface catches, logs to `logStore`, leaves `subtitleModeActive=false`. `SubtitleEnterButton` is the entry point and only flips the store after the surface resolves successfully.
3. **Side panel closes while PiP is open** — `beforeunload` listener calls `pipWindow.close()` before the side panel's JS context dies.
4. **OS ✕ closes PiP** — `'pagehide'` fires on the PiP window; `handlePipClosed` unmounts the root, clears the listener, and calls `__notifySubtitleSurfaceExited()` to set `subtitleModeActive=false`.
5. **ESC inside PiP** — `SubtitleApp`'s keydown listener (rebound to `rootRef.current.ownerDocument` per the component-change note above) fires on the PiP document. It calls `exitSubtitleMode()` → `pipWindow.close()` → `pagehide`.
6. **Session ends while PiP is open** — `<SubtitleSessionEnded>` renders inside the PiP window exactly as in Electron. "Return" button calls `exitSubtitleMode()`.
7. **Rapid enter/exit** — `enter()` is a no-op when `pipWindow` is non-null; `exit()` is a no-op when it is null.
8. **CSS / stylesheet hot reload during dev** — Vite injects new `<style>` nodes into the side panel; the PiP document doesn't observe them. v2 accepts that style changes during dev require re-entering subtitle mode. (Not a production concern.)
9. **Multiple side panels** — Side panel is one-per-window in Chrome; not relevant.
10. **PiP inside an iframe** — Side panel is a top-level document, not an iframe. OK.
11. **Locale / RTL switching while PiP is open** — i18n provider is shared; new strings render immediately in both roots.
12. **Settings panel persistence** — `bgOpacity`, `bgColor`, `sourceTextColor`, `translationTextColor`, `fontSize`, `compactMode` all apply via CSS variables on the subtitle root inside PiP. No surface call needed.

## Testing Strategy

### Unit tests (Vitest, automated)

- `src/components/Subtitle/surfaces/PipSubtitleSurface.test.ts` — mock `documentPictureInPicture`:
  - `enter` calls `requestWindow` with persisted size (default if missing), mounts root, registers `pagehide` and `resize`.
  - `enter` is a no-op when already open.
  - `exit` calls `pipWindow.close()`; `pagehide` unmounts and clears state.
  - Resize → persisted via `setSubtitlePipWindowSize` after debounce.
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts` — covers the existing IPC behavior, ported from current store tests so the refactor is byte-equivalent.
- `src/components/Subtitle/SubtitleBar.test.tsx` — adding cases that `surface="pip"` hides the lock and pin buttons.
- `src/components/Subtitle/SubtitleEnterButton.test.tsx` — adds the case that `supports()=false` renders nothing.
- `src/stores/settingsStore.subtitle.test.ts` — updated to mock the surface instead of `window.electron`. Adds a case for `__notifySubtitleSurfaceExited()` flipping the flag.

### Manual test plan

`docs/superpowers/specs/2026-05-13-subtitle-mode-extension-manual-test.md` (to be written alongside the implementation plan):

- Enter from session: button enabled when session active, disabled before.
- PiP appears at persisted size; default size on first use.
- Stream renders, scrolls to bottom on new items, picks up display-mode filters.
- Drag PiP with native chrome; resize from corners; verify resize persists across re-enter.
- Exit via in-bar ✕; via OS ✕; via ESC inside PiP.
- Close side panel while PiP is open → PiP closes.
- Session ends while PiP is open → `<SubtitleSessionEnded>` renders; Return exits.
- All settings popover controls round-trip across re-enter and across browser restart.
- Run across Chrome and Edge stable on macOS, Windows, Linux X11, Linux Wayland.

### Out of scope for v2

- Visual regression tests (PiP rendering depends on Chrome's native window chrome).
- End-to-end automation with a real PiP window — Playwright currently has limited PiP support; not worth the harness work for one feature.

## Critical Files

### Created

- `src/components/Subtitle/surfaces/SubtitleSurface.ts`
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/PipSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/getSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/index.ts`
- `src/components/Subtitle/surfaces/PipSubtitleSurface.test.ts`
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts`
- `src/components/AppProviders.tsx` (extracted from `src/index.tsx`)
- `docs/superpowers/specs/2026-05-13-subtitle-mode-extension-manual-test.md` (during implementation)

### Modified

- `src/stores/settingsStore.ts` — surface delegation in `enterSubtitleMode` / `exitSubtitleMode`; new `pipWindowSize` field + action; private `__notifySubtitleSurfaceExited`.
- `src/components/Subtitle/SubtitleEnterButton.tsx` — replace `isElectron()` guard with `supports()`.
- `src/components/Subtitle/SubtitleApp.tsx` — accept `surface` prop; guard the bounds-changed listener.
- `src/components/Subtitle/SubtitleBar.tsx` — accept `surface` prop; hide 📌 / 🔒 and drop drag region when `surface === 'pip'`.
- `src/index.tsx` — render through the new `<AppProviders>` wrapper.
- `src/i18n/*.json` — no new keys; existing `subtitle.*` keys reused.

### Reused as-is (no modification)

- `src/components/Subtitle/SubtitleStream.tsx`
- `src/components/Subtitle/SubtitleSettingsPopover.tsx`
- `src/components/Subtitle/SubtitleSessionEnded.tsx`
- `src/components/MainPanel/ConversationRow.tsx`
- `src/components/MainPanel/DisplayModeButton.tsx`
- `src/components/MainPanel/ExportButton.tsx`
- `src/components/MainPanel/conversationFilter.ts`
- `src/stores/sessionStore.ts`
- `electron/subtitle-window.js`
- `electron/preload.js`
- `electron/main.js`

## Verification

1. **Build & launch (extension)**:

   ```
   npm run build
   ```

   Load `build/` as an unpacked extension in Chrome ≥ 116.

2. **Smoke test the round trip**:
   - Open the side panel; configure a provider; start a session.
   - Click the subtitle icon in the conversation toolbar.
   - A PiP window appears at the bottom of the screen.
   - Speak / play audio; bilingual rows scroll into the subtitle area.
   - Click the in-bar ✕; PiP closes; side panel is unaffected.

3. **Settings persistence**:
   - Enter subtitle mode, resize the PiP window, change opacity and font size, exit.
   - Restart the browser.
   - Re-enter subtitle mode — same size, same opacity, same font size.

4. **Session-end behavior**:
   - With PiP open, stop the session from the side panel.
   - PiP swaps to `<SubtitleSessionEnded>`; clicking Return closes PiP.

5. **Side-panel close**:
   - With PiP open, close the side panel.
   - PiP closes automatically.

6. **Automated tests**:

   ```
   npm run test
   ```

7. **Manual test plan**: run `2026-05-13-subtitle-mode-extension-manual-test.md` on Chrome and Edge stable, macOS / Windows / Linux X11 / Linux Wayland, before release.

## Out of Scope for v2

- **Content-script in-tab overlay** (originally Approach 2 in the issue). A second surface implementation that injects subtitle DOM into the active meeting tab via the existing content scripts. Sits behind the `SubtitleSurface` interface; can be added in a future PR without disturbing the PiP path.
- **Compact side-panel mode** (Approach 3). A `SubtitleSurface` implementation that swaps the side panel into a slim subtitle-only layout instead of opening a new window. Possible graceful-degradation fallback if the PiP API ever becomes unavailable; not built proactively.
- **Floating over non-browser apps** from the extension. Would require a companion desktop helper. Separate product decision.
- **Per-site customization** beyond what `extension/src/content/` already handles.
- **Replacing the Electron subtitle mode**. The Electron surface continues to use `BrowserWindow` reshape via `ElectronSubtitleSurface`.
