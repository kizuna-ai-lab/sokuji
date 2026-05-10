# Subtitle Mode — Design

**Date**: 2026-05-10
**Status**: Approved for implementation planning
**Scope**: New floating-subtitle surface for the Electron app, sharing one `BrowserWindow` with the existing main UI. Spawned by GitHub Discussion [#118](https://github.com/kizuna-ai-lab/sokuji/discussions/118).

## Context

Discussion #118 asks for a "subtitle mode" similar to the floating subtitle bar in iFlytek Tingjian — a compact, always-on-top translucent window that shows the live bilingual translation while the user is on a video call or watching a video. Today Sokuji renders translations only in the main window; if the user wants the translation visible while doing something else, they have to keep the whole 1200×800 main window in the foreground.

The intended outcome is a dedicated subtitle surface that:

- Shows the live source-language transcription and target-language translation as a continuous bilingual stream,
- Floats above other windows with adjustable opacity, position, and size,
- Does not occupy a separate Electron window — it is the same `mainWindow` switching between two visual modes.

This v1 covers Electron only. The browser extension surface is out of scope.

## Non-Goals

- Browser extension overlay (in-tab content-script) — deferred to v2.
- A pause / mute-stream control on the floating bar.
- Dynamic source/target language switching from inside subtitle mode.
- A "history" view inside subtitle mode (the main window already serves that).
- System tray entry, global hotkeys (other than ESC).
- Quota / usage-time display content (DOM placeholder reserved; backend not ready).
- Per-platform native title-bar widgets beyond the minimal min/max/close set.
- Multi-monitor "follow cursor" behavior, snap-to-edge, magnetic docking.

## User-Visible Behavior

### Entering / leaving

- Main panel toolbar gets a new icon button. It is `disabled` until `sessionStore.isActive === true`.
- Click → main window transforms in place: custom title bar hides, bounds shift to a screen-bottom-centered floating bar (default 80% width × 200 px on first use; otherwise restored from persisted bounds), `alwaysOnTop` turns on.
- `ESC` while the subtitle window is focused, or click the `✕` icon → reverse the transformation. Bounds restore to whatever the main window was at before entering subtitle mode (or the saved normal-mode bounds across restarts).

### Floating bar layout

Three-segment bar across the top of the window. The whole bar is a drag region; individual interactive elements opt out via `-webkit-app-region: no-drag`.

```
┌── -webkit-app-region: drag ────────────────────────────────────────────────┐
│ Left              │ Center                  │ Right                        │
│ [S] sokuji  ___   │  00:00:08   ZH → EN     │ [Spk DM][Ptp DM][A-][A+]     │
│ logo  quota slot  │  timer      lang pair   │ [compact][Export][Clear]     │
│                   │                         │ │ ⚙ 📌 🔒 ✕                  │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Left**: small Sokuji logo (14–16 px). Quota slot is a stable empty `<div className="subtitle-bar__quota">` — content rendered when the backend exposes a quota signal.
- **Center**: session timer (monospace `HH:MM:SS`, derived from `sessionStore` start time) and the language pair as ISO short codes (`ZH → EN`). Read-only.
- **Right**: in left-to-right order:
  - `DisplayModeButton scope="speaker"` (always shown when toolbar shown)
  - `DisplayModeButton scope="participant"` (only when `systemAudioItems.length > 0`)
  - Font − / Font + (bound to **subtitle**-specific `subtitleFontSize`, range 16–48)
  - Compact toggle (bound to **subtitle**-specific `subtitleCompactMode`)
  - `ExportButton` (reused as-is)
  - Clear (`Trash2`, calls `clearConversation`)
  - Visual divider
  - ⚙ Settings popover trigger
  - 📌 Always-on-top toggle (active state highlights the icon)
  - 🔒 Lock toggle (active state highlights; locks both position and size)
  - ✕ Exit subtitle mode

### Auto-hide

When the cursor leaves the window, an idle timer of **1500 ms** triggers the bar to fade out (`opacity: 0`). Mouse re-enter cancels and snaps it back. The bar's height stays in the layout (the subtitle area does not jump); only opacity changes.

### Subtitle stream

The subtitle area renders the same `combinedItems` from `sessionStore` that the main panel uses. The component is `ConversationRow` (the existing one) in a fixed-height scroll container that always sticks to the bottom. As new items arrive, older ones scroll off the top.

- `subtitleCompactMode` is the default `true`, which uses `ConversationRow`'s existing compact layout (color dot, no header, no language badge, no play button).
- Speaker vs. participant rows are colored via the existing `source-${source}` SCSS classes in `ConversationRow.scss`. v1 reuses those classes as-is for role coloring.
- Filtering for "source / translation / both" per side is driven by the existing `speakerDisplayMode` and `participantDisplayMode` — no new state. The helper `src/components/MainPanel/conversationFilter.ts` is already extracted; `SubtitleStream` imports it directly.
- For the user-customizable source/translation text colors, `ConversationRow.scss` is lightly modified so the source-text and translation-text color rules read from CSS variables `--subtitle-source-color` and `--subtitle-translation-color` with the current hardcoded colors as fallbacks. Main panel does not set these variables, so it keeps its current appearance; subtitle mode sets them on the stream root.

### Settings popover (⚙)

Floating UI popover anchored to the ⚙ button (reuses Sokuji's existing `Tooltip` patterns built on `@floating-ui/react`).

| Field | Control | Persisted key |
|---|---|---|
| Background opacity | slider 0–100 % | `settings.common.subtitle.bgOpacity` |
| Background color | 6-swatch palette | `settings.common.subtitle.bgColor` |
| Source text color | 6-swatch palette | `settings.common.subtitle.sourceTextColor` |
| Translation text color | 6-swatch palette | `settings.common.subtitle.translationTextColor` |

Changes apply live via CSS variables on the subtitle window root. No font-family selector in v1.

### Session lifecycle inside subtitle mode

Subtitle mode is purely a "presentation mode" — it does **not** own session lifecycle controls. If `sessionStore.isActive` flips to `false` while in subtitle mode (manual stop from outside, network drop, provider error), the subtitle stream is replaced by `<SubtitleSessionEnded>` containing the localized "Session ended" message and a "Return to main window" button. The subtitle bar (with its ✕) stays visible.

### Window pin / lock semantics

| Toggle | React effect | Electron effect |
|---|---|---|
| 📌 Always-on-top | none | `setAlwaysOnTop(flag, 'floating')` |
| 🔒 Lock | switches subtitle bar `-webkit-app-region` between `drag` and `no-drag` | `setResizable(!locked)` |

Locking therefore disables both moving (no drag region) and resizing (Chromium native edge-drag turned off). Both controls cross-platform consistent (no Linux-specific fallback needed because we no longer rely on `setMovable`).

## Architecture & Window Lifecycle

Single `mainWindow` for the entire app's lifetime. It is created **frameless and transparent** so that subtitle mode can use rounded-corner translucent backgrounds without recreating the window. Normal mode renders a custom title bar and an opaque background. Subtitle mode hides the title bar, switches the background to translucent, calls `setBounds` to the floating-bar geometry, and turns on `setAlwaysOnTop`.

```
[Normal mode]                           [Subtitle mode]
 ┌─────────────────────────┐             ┌──────────────────────────┐
 │  TitleBar (custom)      │   IPC       │ (no title bar)           │
 │  MainShell              │  ──────►    │ SubtitleApp              │
 │                         │  subtitle:  │   - SubtitleBar          │
 │  bg: opaque theme       │  enter      │   - SubtitleStream       │
 │  alwaysOnTop: false     │             │ bg: rgba(...)            │
 │  bounds: 1200×800       │  ◄──────    │ alwaysOnTop: true        │
 │  resizable: true        │  subtitle:  │ resizable: !locked       │
 │                         │  exit       │ bounds: bottom-centered  │
 └─────────────────────────┘             └──────────────────────────┘
```

Invariants:
- The window instance is never destroyed across mode switches.
- `subtitleModeActive` (in `settingsStore`) is the single source of truth for the React render fork.
- The Electron main process holds no mode state; it only executes specific window-attribute commands sent over IPC.

## State (settingsStore)

Two new pieces of state, both inside `settingsStore` (no new store).

### Persisted: `subtitle: SubtitleSettings`

Persisted via the existing `IElectronSettingsService`. New paths under `settings.common.subtitle.*`. Hydration follows the same pattern as the rest of `settingsStore.ts:1397+`.

```ts
export interface SubtitleSettings {
  fontSize: number              // 16–48, default 24
  compactMode: boolean          // default true
  bgOpacity: number             // 0–100, default 70
  bgColor: string               // hex, default '#000000'
  sourceTextColor: string       // hex, default '#FFFFFF'
  translationTextColor: string  // hex, default '#6CC5FF'
  alwaysOnTop: boolean          // default true
  positionLocked: boolean       // default false
  windowBounds: { x: number; y: number; width: number; height: number } | null
}
```

### Runtime-only: `subtitleModeActive: boolean`

Always `false` at app start; not persisted.

### Actions (mirroring existing `setSpeakerDisplayMode` etc.)

| Action | Side effect |
|---|---|
| `enterSubtitleMode()` | Bail if `!sessionStore.isActive`. Set `subtitleModeActive=true`. IPC `subtitle:enter` with `{bounds, alwaysOnTop, locked}`. |
| `exitSubtitleMode()` | Set `subtitleModeActive=false`. IPC `subtitle:exit`. |
| `setSubtitleFontSize(n)` | Clamp 16–48, persist. |
| `setSubtitleCompactMode(b)` | Persist. |
| `setSubtitleBgOpacity(n)` / `setSubtitleBgColor(s)` | Persist. CSS-only effect; no IPC. |
| `setSubtitleSourceTextColor(s)` / `setSubtitleTranslationTextColor(s)` | Persist. CSS-only. |
| `toggleSubtitleAlwaysOnTop()` | Persist. If `subtitleModeActive`, IPC `subtitle:set-always-on-top`. |
| `toggleSubtitlePositionLocked()` | Persist. Always toggle drag-region CSS. If `subtitleModeActive`, IPC `subtitle:set-locked`. |
| `saveSubtitleWindowBounds(b)` | Persist only. Triggered by the `subtitle:window-bounds-changed` IPC event with debounce ~500 ms. |

### Selectors

```ts
useSubtitleModeActive
useSubtitleSettings
useSubtitleFontSize / useSubtitleCompactMode / ...
useSetSubtitleFontSize / ...
```

### Relationship to existing state

| Existing state | Used in subtitle mode? |
|---|---|
| `speakerDisplayMode` | Yes, shared (no copy). |
| `participantDisplayMode` | Yes, shared. |
| `sourceLanguage`, `targetLanguage` | Read-only display. |
| `conversationFontSize` | Untouched. Subtitle has its own `subtitleFontSize`. |
| `conversationCompactMode` | Untouched. Subtitle has its own `subtitleCompactMode`. |
| `combinedItems` (sessionStore) | Read directly. |
| `uiMode` (`'basic' \| 'advanced'`) | Untouched. |

## IPC Protocol

All channels are added to the whitelists in `electron/preload.js`. The naming prefix is `subtitle:`.

### Renderer → Main (`invoke`)

| Channel | Payload | Main process handler |
|---|---|---|
| `subtitle:enter` | `{ bounds?: Bounds, alwaysOnTop: boolean, locked: boolean }` | Snapshot current bounds for later restore. `clampToScreen(bounds)`. `setBounds`, `setAlwaysOnTop(flag, 'floating')`, `setResizable(!locked)`. Returns `{ ok, bounds }` (clamped). |
| `subtitle:exit` | `{ restoreBounds?: Bounds }` | `setBounds(restoreBounds ?? snapshot)`, `setAlwaysOnTop(false)`, `setResizable(true)`. Returns `{ ok }`. |
| `subtitle:set-always-on-top` | `boolean` | `setAlwaysOnTop(flag, 'floating')`. Returns `{ ok }`. |
| `subtitle:set-locked` | `boolean` | `setResizable(!locked)`. Returns `{ ok }`. |
| `subtitle:get-screen-bounds` | — | `screen.getPrimaryDisplay().workArea`. Used to compute the bottom-centered default. |

### Main → Renderer (`receive`)

| Channel | Payload | Trigger |
|---|---|---|
| `subtitle:window-bounds-changed` | `{ x, y, width, height }` | `mainWindow.on('resize' \| 'move')` debounced ~200 ms. SubtitleApp ignores it when `!subtitleModeActive`; otherwise calls `saveSubtitleWindowBounds` (further debounced ~500 ms in the action). |

### Window-control IPC for the new TitleBar (separate from subtitle:* channels)

Added to support the custom title bar. Used in normal mode only.

| Channel | Direction | Effect |
|---|---|---|
| `window:minimize` | invoke | `mainWindow.minimize()` |
| `window:maximize-toggle` | invoke | `mainWindow.isMaximized() ? unmaximize() : maximize()` |
| `window:close` | invoke | `mainWindow.close()` |

## Component Structure

### Top-level fork (`src/App.tsx`)

```tsx
function App() {
  const subtitleActive = useSubtitleModeActive()
  return (
    <>
      {!subtitleActive && <TitleBar />}
      {subtitleActive ? <SubtitleApp /> : <MainShell />}
    </>
  )
}
```

`MainShell` is a thin wrapper around the existing main app content (MainPanel + LogsPanel + SettingsPanel + modals) — extracted to make the fork explicit.

### New file tree (`src/components/Subtitle/`)

```
SubtitleApp.tsx              Root container. Applies CSS vars (--bg-opacity,
                             --subtitle-source-color, etc.). Owns the auto-hide
                             timer, ESC handler, and `subtitle:window-bounds-changed`
                             listener.
├── SubtitleBar.tsx          Three-segment top bar. Drag region with no-drag
│                             children. Fades out via opacity CSS variable.
│   ├── SubtitleBarLeft      Logo + empty quota slot.
│   ├── SubtitleBarCenter    Timer + language pair.
│   └── SubtitleBarRight     Reused conversation-toolbar buttons + subtitle-
│                            specific cluster.
├── SubtitleStream.tsx       Renders ConversationRow per filtered item, sticks
│                            to bottom on new content.
├── SubtitleSettingsPopover.tsx  ⚙ popover (Floating UI).
├── SubtitleSessionEnded.tsx     Shown when !sessionStore.isActive.
└── SubtitleEnterButton.tsx      Small icon button placed in MainPanel toolbar
                                 (top of MainPanel). Disabled until session active.
```

### Custom title bar (`src/components/TitleBar/TitleBar.tsx`)

- Fixed 30 px height.
- Drag region across most of the bar; min/max/close buttons opt out.
- Platform branch: macOS leaves room on the left for system traffic-light buttons (`titleBarStyle: 'hiddenInset'` so the OS draws them); Windows / Linux render custom min/max/close buttons on the right.
- Buttons call `window:*` IPC channels.

### Render data flow inside SubtitleStream

```ts
import { filterByDisplayMode } from '../MainPanel/conversationFilter'

const items = useCombinedItems()
const compact = useSubtitleCompactMode()
const fontSize = useSubtitleFontSize()
const speakerMode = useSpeakerDisplayMode()
const participantMode = useParticipantDisplayMode()

const filtered = filterByDisplayMode(items, speakerMode, participantMode)

return (
  <div className="subtitle-stream"
       style={{ fontSize, '--source-color': ..., '--translation-color': ... }}
       ref={endScrollRef}>
    {filtered.map((item, i) => (
      <ConversationRow
        key={item.id}
        item={item}
        prevItem={filtered[i - 1]}
        compact={compact}
        sourceLanguage={...}
        targetLanguage={...}
        canPlay={false}    // Hide play button in subtitle mode
      />
    ))}
  </div>
)
```

The DisplayMode filter helper already exists at `src/components/MainPanel/conversationFilter.ts` (extracted in prior work) and is reused unchanged.

## Error Handling & Edge Cases

1. **Session ends while in subtitle mode** — `SubtitleApp` subscribes to `sessionStore.isActive`. When `false`, the stream is replaced by `<SubtitleSessionEnded>`; the bar with its ✕ stays. Exiting (ESC / ✕ / clicking "Return to main window") leaves the subtitle window state and resumes normal main-window UI.

2. **Entering subtitle mode without an active session** — Both the entry button and `enterSubtitleMode` action check `isSessionActive`. The action no-ops with a log entry if violated. Avoids race between button and store.

3. **Window bounds out of screen** — `clampToScreen(bounds, displays)` runs in the main process before any `setBounds` and returns the clamped value to the renderer for re-persistence. Handles disconnected displays, resolution changes, secondary monitor unplug.

4. **Rapid mode toggling** — `enterSubtitleMode` / `exitSubtitleMode` are idempotent (return early if already in target state). Main process `setBounds` / `setAlwaysOnTop` are inherently idempotent.

5. **CSS transparency on Linux** — `transparent: true` works on most modern X11 / Wayland desktops but not all old DEs. We do not write a runtime detection. Users on unsupported environments will see an opaque background — the feature degrades gracefully on its own.

6. **Window closed via Alt+F4 / Cmd+Q from subtitle mode** — Standard Electron `before-quit` flow. Persisted bounds were already saved on every change. Next launch comes up in normal mode (subtitleModeActive doesn't persist).

7. **IPC failure** — Renderer wraps `invoke` calls in try/catch. On failure, rolls back React state (`subtitleModeActive` flips back) and logs to `logStore`.

8. **Drag region death-traps** — Every interactive element inside the drag region must have `-webkit-app-region: no-drag`. Reviewed at PR time.

9. **Language change inside subtitle mode** — Not possible by construction. `SimpleConfigPanel` only renders in normal mode; subtitle mode has no language UI. No defensive code needed.

10. **Session start delay** — Session takes 1–2 s to become active after the user clicks Start. Entry button stays disabled until then. No special handling.

11. **Locking on Linux** — Lock is implemented via React drag-region toggle (works everywhere) plus `setResizable` (works on all platforms in Electron 40). No platform-specific UI degradation needed.

## Testing Strategy

### Unit tests (Vitest, automated)

Files alongside components:

- `src/utils/clampToScreen.test.ts` — out-of-bounds, multi-display, zero-size, negative coords.
- `src/stores/settingsStore.subtitle.test.ts` — `enterSubtitleMode` blocked when session inactive; `setSubtitleFontSize` clamping; `toggleSubtitle*` invariants; mocked persistence call counts.
- `src/components/Subtitle/SubtitleStream.test.tsx` — given items + display modes, asserts filtered rendering (jsdom).
- `src/components/Subtitle/SubtitleSessionEnded.test.tsx` — content + button click triggers exit.

### Manual test plan

A `manual-test.md` next to this design lists ~30 cases across entering, interaction, lock/pin, settings, toolbar, exit / errors, and the new TitleBar. Run on macOS, Windows, Linux X11, Linux Wayland before each release that touches subtitle mode.

### Out of scope for v1

- Spectron / `@vscode/test-electron` integration tests — Sokuji has no Electron e2e baseline; not worth adding for one feature.
- Visual regression — too platform-dependent for screenshot diffs to be useful here.

## Critical Files

### Created

- `src/components/Subtitle/SubtitleApp.tsx` + `.scss`
- `src/components/Subtitle/SubtitleBar.tsx` + `.scss`
- `src/components/Subtitle/SubtitleStream.tsx` + `.scss`
- `src/components/Subtitle/SubtitleSettingsPopover.tsx` + `.scss`
- `src/components/Subtitle/SubtitleSessionEnded.tsx`
- `src/components/Subtitle/SubtitleEnterButton.tsx`
- `src/components/TitleBar/TitleBar.tsx` + `.scss`
- `electron/subtitle-window.js` (IPC handlers + bounds clamping)
- `src/utils/clampToScreen.ts` (pure function, also imported by main process)

### Modified

- `electron/main.js` — `mainWindow` constructor (`frame: false`, `transparent: true`, `hasShadow: true`, `backgroundColor: '#00000000'`); call `setupSubtitleHandlers(mainWindow)`; add `window:*` handlers for the title bar.
- `electron/preload.js` — channel whitelists for `subtitle:*` and `window:*`.
- `src/App.tsx` — top-level fork between `MainShell` and `SubtitleApp`; conditional `<TitleBar>`.
- `src/stores/settingsStore.ts` — new `SubtitleSettings` interface, defaults, hydration, actions, selectors.
- `src/components/MainPanel/MainPanel.tsx` — add `<SubtitleEnterButton>` to the conversation toolbar (gated on `isSessionActive`).
- `src/components/MainPanel/ConversationRow.scss` — switch source-text and translation-text `color` rules to `var(--subtitle-source-color, <existing default>)` and `var(--subtitle-translation-color, <existing default>)` so subtitle mode can override while main panel keeps its current appearance.
- `src/i18n/*.json` — keys under `subtitle.*`.

### Reused as-is (no modification)

- `src/components/MainPanel/ConversationRow.tsx`
- `src/components/MainPanel/DisplayModeButton.tsx`
- `src/components/MainPanel/ExportButton.tsx`
- `src/components/MainPanel/conversationFilter.ts`
- `src/stores/sessionStore.ts`

## Verification

1. **Build & launch (Electron)**:

   ```
   npm run electron:dev
   ```

   The main window opens frameless with the new custom title bar.

2. **Smoke test the round trip**:
   - Start a session (provider already configured).
   - Click the new subtitle button in the conversation toolbar.
   - Window snaps to a translucent floating bar at the bottom of the screen.
   - Speak / play audio; bilingual rows scroll into the subtitle area.
   - Press ESC; main window restores to its prior size and position.

3. **Settings persistence**:
   - Enter subtitle mode, drag to a new position, resize, change opacity.
   - Quit the app entirely and relaunch.
   - Re-enter subtitle mode → it should appear with the previously saved bounds and opacity.

4. **Lock behavior**:
   - In subtitle mode, click 🔒.
   - Drag the bar (should not move) and drag the window edge (should not resize).
   - Click 🔒 again; both should work.

5. **Always-on-top behavior**:
   - With 📌 active, click on another app's window. The subtitle bar stays on top.
   - Toggle 📌 off; clicking another window now hides the subtitle bar behind it.

6. **Run automated tests**:

   ```
   npm run test
   ```

7. **Run manual test plan** (see `manual-test.md` once created): ~30 cases across the four target platforms.
