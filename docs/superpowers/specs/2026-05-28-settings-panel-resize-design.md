# Resizable Side Panel — Design

**Date:** 2026-05-28
**Status:** Draft
**Scope:** Make the right-hand side panel (`.settings-panel-container`, which hosts Settings or Logs) horizontally resizable via a draggable seam between it and MainPanel, in the side-by-side layout. Width is clamped, persists across sessions, and is keyboard-accessible. Builds directly on `2026-05-27-panel-chrome-unification-design.md` (same branch) — the panel is already a CSS query container, so widening it makes the PanelBar labels reappear for free.

## Problem
The side panel is fixed at `width: 450px` (`max-width: 450px`). After the panel-chrome unification, a 300–450px panel is tight: in Settings Advanced and in Logs the right-cluster labels collapse to icon-only because they don't fit. Desktop (Electron) users have a resizable window and plenty of horizontal room, but no way to give the panel more of it — to read logs comfortably or to see the full `Quick/Advanced` and `auto-scroll/copy/clear` labels.

## Goals
1. A full-height vertical drag handle on the seam between MainPanel and the side panel; drag left widens, right narrows.
2. Width clamped to **[300px, viewportWidth − 360px]** (MainPanel keeps ≥360px); re-clamped on window resize so a saved wide width can't strand MainPanel.
3. Width persists across sessions (`localStorage`, key `panelState.settingsPanelWidth`).
4. Keyboard-accessible: the handle is a focusable `role="separator"`; Arrow Left/Right resize in 16px steps.
5. Hidden and inert on mobile (`<768px`, where the layout stacks vertically and the panel is full-width).
6. Composes with the existing container query — no extra label logic; widening reveals labels, narrowing collapses them.

## Non-Goals
- No direct resizing of `.main-content`/MainPanel (it stays `flex: 1`, the elastic member).
- No vertical resize, no resizer in the stacked mobile layout.
- No change to which panels exist, their content, or the 300px minimum.
- No new runtime dependency — custom ~60-line implementation (the existing `useOverlayDragResize` hook is iframe/postMessage-specific and not reusable here).
- No restructuring of the layout tree beyond inserting one sibling and relocating the 1px seam.

## Layout context (from research)
The only flex container is `.main-layout` (row; `flex-direction: column` under `@media (max-width: 768px)`). Its flex children, when a panel is open:
- `.main-content` — `flex: 1` (elastic, holds MainPanel). `.with-panel` currently draws the `border-right` seam.
- `.settings-panel-container` — fixed `width:450 / min:300 / max:450` (the member we size).
- `<Onboarding>` — react-joyride, portals / `return null`, takes no flex space.

`.settings-panel-container` is referenced only in `MainLayout.tsx`, `MainLayout.scss`, and `scrollbar.scss`; **no JS reads its width** and `450` is hardcoded only in `MainLayout.scss`. So driving its width is safe.

## Design

### Width helper — `src/components/MainLayout/panelWidth.ts`
Pure, testable constants + functions (single source of truth, shared by MainLayout and PanelResizer):

```ts
export const PANEL_MIN_WIDTH = 300;
export const MAIN_CONTENT_MIN = 360;
export const PANEL_DEFAULT_WIDTH = 450;
const STORAGE_KEY = 'panelState.settingsPanelWidth';

/** Clamp to [MIN, viewport − MAIN_CONTENT_MIN], floored at MIN for tiny viewports. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, viewportWidth - MAIN_CONTENT_MIN);
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), max);
}
export function readPanelWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : PANEL_DEFAULT_WIDTH;
}
export function savePanelWidth(width: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
}
```

### Component — `src/components/MainLayout/PanelResizer.tsx`
A presentational flex sibling inserted **between `.main-content` and `.settings-panel-container`** (inside the existing `showLogs || showSettings` conditional, wrapped with the container in a fragment).

Props:
```ts
interface PanelResizerProps {
  width: number;                 // current panel width (for aria + drag origin)
  min: number;                   // PANEL_MIN_WIDTH
  max: number;                   // computed max (for aria)
  onResize: (next: number) => void; // live, during drag/keys (caller clamps)
  onCommit: (next: number) => void; // on pointerup / keypress (caller clamps + persists)
}
```

Behavior:
- Renders `<div className="panel-resizer" role="separator" aria-orientation="vertical" aria-valuenow={round(width)} aria-valuemin aria-valuemax tabIndex={0}>`.
- **Pointer:** on `pointerdown`, record `startX`/`startWidth` and attach `pointermove`/`pointerup` to `window`; add `is-resizing-panel` to `document.body` (global `col-resize` cursor + `user-select:none`). Panel is docked right, so `next = startWidth + (startX − clientX)` (drag left → wider). Call `onResize(next)` on move, `onCommit(next)` on up, then detach listeners and remove the body class.
- **Keyboard:** `ArrowLeft` → `onResize/onCommit(width + 16)` (wider), `ArrowRight` → `width − 16` (narrower); `preventDefault`.
- Caller (MainLayout) is responsible for clamping `next`; `aria-valuenow` reflects the clamped `width` prop.

### Wiring — `MainLayout.tsx`
- `const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));`
- `useEffect` on mount: `resize` listener → `setPanelWidth(w => clampPanelWidth(w, window.innerWidth))`; cleanup on unmount.
- `const handleResize = (w) => setPanelWidth(clampPanelWidth(w, window.innerWidth));`
- `const handleCommit = (w) => { const c = clampPanelWidth(w, window.innerWidth); setPanelWidth(c); savePanelWidth(c); };`
- In the conditional, render the resizer immediately before the container, and apply the inline width:
```tsx
{(showLogs || showSettings) && (
  <>
    <PanelResizer
      width={panelWidth}
      min={PANEL_MIN_WIDTH}
      max={Math.max(PANEL_MIN_WIDTH, window.innerWidth - MAIN_CONTENT_MIN)}
      onResize={handleResize}
      onCommit={handleCommit}
    />
    <div className="settings-panel-container" style={{ width: panelWidth }}>
      {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
      {showSettings && <SettingsComponent toggleSettings={toggleSettings} highlightSection={settingsNavigationTarget} />}
    </div>
  </>
)}
```

### CSS — `MainLayout.scss` + new `PanelResizer.scss`
- `.settings-panel-container`: **remove `max-width: 450px`** (the JS clamp governs the max; inline `width` sets the value). Keep `min-width: 300px` as the floor and `width: 450px` as a fallback. Keep `container-*`. The mobile `@media (max-width:768px)` rule already forces `width:100% !important`, which overrides the inline width — mobile unaffected.
- `.main-content.with-panel`: **remove `border-right`** — the resizer now owns the seam.
- New `PanelResizer.scss` (hardcoded hex to match MainLayout/TitleBar convention, not the Settings tokens): `.panel-resizer { flex: 0 0 4px; align-self: stretch; cursor: col-resize; background: #333; transition: background .15s; &:hover, &:focus-visible { background: #10a37f; } &:focus-visible { outline: none; } @media (max-width: 768px) { display: none; } }` plus `body.is-resizing-panel { cursor: col-resize; user-select: none; }`.

## Edge cases & risks
- **Tiny viewport** (`viewport − 360 < 300`): `clampPanelWidth` floors at 300; MainPanel may dip below 360 only on a genuinely small window — acceptable, and the mobile layout takes over below 768px anyway.
- **Stale wide saved width** after the window shrank: re-clamped on mount and on every `resize` event.
- **Mobile**: resizer `display:none`; container width `100% !important` wins over inline style. No JS branching needed.
- **Drag selection/iframes**: `is-resizing-panel` sets `user-select:none` on body for the drag duration; `pointerup` always cleans up listeners + class even if the cursor leaves the window (listeners are on `window`).
- **SSR/no-DOM**: not applicable (Electron/extension/browser runtime; `window`/`localStorage` always present).

## Testing
- **`panelWidth.test.ts`** (pure): `clampPanelWidth` — below min → 300; above max → `viewport−360`; within → unchanged; tiny viewport → 300. `readPanelWidth` → default when unset/garbage, parsed when set. `savePanelWidth` → writes rounded string. (Mock `localStorage`.)
- **`PanelResizer.test.tsx`**: renders `role="separator"` with `aria-orientation` + aria-value attrs from props; `ArrowLeft` calls `onResize`+`onCommit` with `width+16`; `ArrowRight` with `width−16`.
- **Manual** (Electron): drag widens/narrows live; release persists; reload restores width; shrinking the window re-clamps; widening reveals PanelBar labels; below 768px the handle disappears and the panel goes full-width; keyboard arrows on the focused seam resize.
