# Resizable Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right-hand side panel (`.settings-panel-container`) horizontally resizable via a draggable seam, with clamped, persisted width and keyboard support — desktop-style splitter that composes with the existing container-query labels.

**Architecture:** A pure width helper (`panelWidth.ts`) holds the constants, clamp, and persistence. A presentational `PanelResizer` (flex sibling between `.main-content` and `.settings-panel-container`) emits resize deltas. `MainLayout` owns the width state, clamps it (on drag, keypress, and window resize), applies it inline, and persists on commit.

**Tech Stack:** React + TypeScript, Pointer Events, SCSS, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-28-settings-panel-resize-design.md`

**Convention:** every commit message ends with the trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File Structure

**Create:**
- `src/components/MainLayout/panelWidth.ts` — constants + `clampPanelWidth` / `readPanelWidth` / `savePanelWidth`. One responsibility: width math + persistence.
- `src/components/MainLayout/panelWidth.test.ts` — unit tests for the above.
- `src/components/MainLayout/PanelResizer.tsx` — the draggable separator (presentational).
- `src/components/MainLayout/PanelResizer.scss` — seam styling + mobile hide + drag body class.
- `src/components/MainLayout/PanelResizer.test.tsx` — role + keyboard tests.

**Modify:**
- `src/components/MainLayout/MainLayout.tsx` — width state, window-resize clamp, render resizer, inline width.
- `src/components/MainLayout/MainLayout.scss` — drop the `max-width:450` cap, drop `.main-content.with-panel` border-right (resizer owns the seam).

---

## Task R1: Width helper (TDD)

**Files:**
- Create: `src/components/MainLayout/panelWidth.ts`
- Create: `src/components/MainLayout/panelWidth.test.ts`

- [ ] **Step 1: Write the failing test** — `src/components/MainLayout/panelWidth.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampPanelWidth, readPanelWidth, savePanelWidth,
  PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH,
} from './panelWidth';

describe('clampPanelWidth', () => {
  it('floors at the minimum', () => {
    expect(clampPanelWidth(100, 1600)).toBe(PANEL_MIN_WIDTH);
  });
  it('caps at viewport minus the MainPanel minimum (360)', () => {
    expect(clampPanelWidth(5000, 1000)).toBe(1000 - 360);
  });
  it('leaves an in-range width unchanged', () => {
    expect(clampPanelWidth(500, 1600)).toBe(500);
  });
  it('floors at the minimum on a tiny viewport', () => {
    expect(clampPanelWidth(400, 500)).toBe(PANEL_MIN_WIDTH);
  });
});

describe('read/savePanelWidth', () => {
  beforeEach(() => localStorage.clear());
  it('returns the default when unset or garbage', () => {
    expect(readPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
    localStorage.setItem('panelState.settingsPanelWidth', 'abc');
    expect(readPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
  });
  it('round-trips a saved width', () => {
    savePanelWidth(523.6);
    expect(localStorage.getItem('panelState.settingsPanelWidth')).toBe('524');
    expect(readPanelWidth()).toBe(524);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm run test -- src/components/MainLayout/panelWidth.test.ts`
Expected: FAIL — cannot resolve `./panelWidth`.

- [ ] **Step 3: Implement** — `src/components/MainLayout/panelWidth.ts`

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

- [ ] **Step 4: Run, verify PASS**

Run: `npm run test -- src/components/MainLayout/panelWidth.test.ts`
Expected: PASS (6 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainLayout/panelWidth.ts src/components/MainLayout/panelWidth.test.ts
git commit -m "feat(layout): add panel width clamp + persistence helper"
```

---

## Task R2: PanelResizer component (TDD)

**Files:**
- Create: `src/components/MainLayout/PanelResizer.tsx`
- Create: `src/components/MainLayout/PanelResizer.scss`
- Create: `src/components/MainLayout/PanelResizer.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/MainLayout/PanelResizer.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PanelResizer from './PanelResizer';

const base = { width: 450, min: 300, max: 900 };

describe('PanelResizer', () => {
  it('renders a vertical separator with aria values', () => {
    render(<PanelResizer {...base} onResize={() => {}} onCommit={() => {}} />);
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '450');
    expect(sep).toHaveAttribute('aria-valuemin', '300');
    expect(sep).toHaveAttribute('aria-valuemax', '900');
  });

  it('ArrowLeft widens by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(466);
    expect(onCommit).toHaveBeenCalledWith(466);
  });

  it('ArrowRight narrows by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(434);
    expect(onCommit).toHaveBeenCalledWith(434);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm run test -- src/components/MainLayout/PanelResizer.test.tsx`
Expected: FAIL — cannot resolve `./PanelResizer`.

- [ ] **Step 3: Implement** — `src/components/MainLayout/PanelResizer.tsx`

```tsx
import React, { useCallback, useRef } from 'react';
import './PanelResizer.scss';

interface PanelResizerProps {
  width: number;
  min: number;
  max: number;
  /** Live updates during drag / keypress. Caller clamps. */
  onResize: (next: number) => void;
  /** On pointerup / keypress. Caller clamps + persists. */
  onCommit: (next: number) => void;
}

const STEP = 16;

const PanelResizer: React.FC<PanelResizerProps> = ({ width, min, max, onResize, onCommit }) => {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    // Panel is docked on the right: dragging left (smaller clientX) widens it.
    const widthFrom = (clientX: number) => drag.current!.startWidth + (drag.current!.startX - clientX);

    const onMove = (ev: PointerEvent) => { if (drag.current) onResize(widthFrom(ev.clientX)); };
    const onUp = (ev: PointerEvent) => {
      if (drag.current) onCommit(widthFrom(ev.clientX));
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-panel');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('is-resizing-panel');
  }, [width, onResize, onCommit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = width + STEP;       // wider
    else if (e.key === 'ArrowRight') next = width - STEP; // narrower
    if (next !== null) {
      e.preventDefault();
      onResize(next);
      onCommit(next);
    }
  }, [width, onResize, onCommit]);

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
};

export default PanelResizer;
```

- [ ] **Step 4: Implement** — `src/components/MainLayout/PanelResizer.scss`

```scss
.panel-resizer {
  flex: 0 0 4px;
  align-self: stretch;
  cursor: col-resize;
  background: #333;
  transition: background 0.15s;

  &:hover,
  &:focus-visible {
    background: #10a37f;
  }
  &:focus-visible {
    outline: none;
  }

  @media (max-width: 768px) {
    display: none;
  }
}

body.is-resizing-panel {
  cursor: col-resize;
  user-select: none;
}
```

- [ ] **Step 5: Run, verify PASS**

Run: `npm run test -- src/components/MainLayout/PanelResizer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/MainLayout/PanelResizer.tsx src/components/MainLayout/PanelResizer.scss src/components/MainLayout/PanelResizer.test.tsx
git commit -m "feat(layout): add PanelResizer separator (pointer + keyboard)"
```

---

## Task R3: Wire into MainLayout + CSS

**Files:**
- Modify: `src/components/MainLayout/MainLayout.tsx`
- Modify: `src/components/MainLayout/MainLayout.scss`

- [ ] **Step 1: Imports + state in `MainLayout.tsx`**

Add imports near the other component imports:
```tsx
import PanelResizer from './PanelResizer';
import { clampPanelWidth, readPanelWidth, savePanelWidth, PANEL_MIN_WIDTH, MAIN_CONTENT_MIN } from './panelWidth';
```

Inside the `MainLayout` component, alongside the other `useState` hooks, add the width state:
```tsx
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));
```

- [ ] **Step 2: Window-resize re-clamp + handlers**

Add (near the other `useEffect`s):
```tsx
  // Re-clamp the saved/active width when the window shrinks so a wide panel
  // can never strand MainPanel below its minimum.
  useEffect(() => {
    const onResize = () => setPanelWidth((w) => clampPanelWidth(w, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePanelResize = useCallback((next: number) => {
    setPanelWidth(clampPanelWidth(next, window.innerWidth));
  }, []);
  const handlePanelResizeCommit = useCallback((next: number) => {
    const clamped = clampPanelWidth(next, window.innerWidth);
    setPanelWidth(clamped);
    savePanelWidth(clamped);
  }, []);
```
(`useEffect`, `useCallback`, `useState` are already imported in this file.)

- [ ] **Step 3: Render the resizer + apply inline width**

Replace the panel-render block:
```tsx
      {(showLogs || showSettings) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && (
            <SettingsComponent
              toggleSettings={toggleSettings}
              highlightSection={settingsNavigationTarget}
            />
          )}
        </div>
      )}
```
with:
```tsx
      {(showLogs || showSettings) && (
        <>
          <PanelResizer
            width={panelWidth}
            min={PANEL_MIN_WIDTH}
            max={Math.max(PANEL_MIN_WIDTH, window.innerWidth - MAIN_CONTENT_MIN)}
            onResize={handlePanelResize}
            onCommit={handlePanelResizeCommit}
          />
          <div className="settings-panel-container" style={{ width: panelWidth }}>
            {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
            {showSettings && (
              <SettingsComponent
                toggleSettings={toggleSettings}
                highlightSection={settingsNavigationTarget}
              />
            )}
          </div>
        </>
      )}
```

- [ ] **Step 4: `MainLayout.scss` — drop the width cap and the duplicate seam**

(a) In the base `.settings-panel-container` rule, remove the `max-width: 450px;` line. Keep `width: 450px;` (fallback) and `min-width: 300px;` and the `container-*` lines.

(b) In `.main-content`, remove the `&.with-panel { border-right: 1px solid #333; }` seam (the resizer now draws it). If `.with-panel` then has no remaining declarations, delete the empty `&.with-panel { }` block.

(Leave the `@media (max-width: 768px)` block untouched — its `width:100% !important` on the container still overrides the inline width on mobile, and the resizer is `display:none` there.)

- [ ] **Step 5: Typecheck + build + test**

Run: `npx tsc --noEmit 2>&1 | grep MainLayout` — Expected: no NEW MainLayout errors (the pre-existing `MainLayout.tsx(2,1) 'useTranslation' unused` may remain — do not "fix" it, it's out of scope).
Run: `npm run build && npm run test`
Expected: build OK; full suite PASS (now includes panelWidth + PanelResizer tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/MainLayout/MainLayout.tsx src/components/MainLayout/MainLayout.scss
git commit -m "feat(layout): make the side panel resizable via a draggable seam"
```

---

## Task R4: Verification & manual checklist

**Files:** none (verification only).

- [ ] **Step 1: Full automated gate**

Run: `npx tsc --noEmit && npm run build && npm run test` — confirm build OK, suite green, no NEW tsc errors vs. the pre-existing baseline.

- [ ] **Step 2: Manual (Electron — `npm run electron:dev`)**

Open Settings (and Logs) and verify:
- Dragging the seam left/right resizes the panel live; MainPanel reflows to fill the rest.
- Can't drag the panel below 300px or wide enough to leave MainPanel under ~360px.
- Releasing persists: reload the app → the panel reopens at the chosen width.
- Shrink the OS window very narrow → the panel re-clamps (never strands MainPanel).
- As you widen the panel, the PanelBar labels (`Quick/Advanced`, Logs `auto-scroll/copy/clear`) reappear; narrowing collapses them again (container-query synergy).
- Focus the seam (Tab) → Arrow Left/Right resize in steps; `aria-valuenow` updates.
- Resize the window below 768px → layout stacks, the seam disappears, the panel is full-width.
- During a drag, text doesn't get selected and the cursor stays `col-resize`.

- [ ] **Step 3: Commit any manual-fix follow-ups (skip if none)**

```bash
git add -A && git commit -m "fix(panel-resize): address manual-verification findings"
```
