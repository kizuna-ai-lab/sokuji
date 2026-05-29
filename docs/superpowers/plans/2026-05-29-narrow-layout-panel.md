# Narrow-layout panel readability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the viewport is narrow and a Settings/Logs panel is open, give the panel the space and pin a slim, readable control bar at the bottom — instead of crushing the conversation into an unreadable clipped sliver.

**Architecture:** A single responsive stylesheet change in `MainLayout.scss`. At `≤768px` with a panel open, the page stacks: panel on top (full width, scrolls), and `MainPanel` collapses to its `.control-footer` pinned at the bottom via a flex `order` swap. The transcript is hidden with `display:none` (MainPanel stays mounted, so the active session survives). The dead rules targeting stale class names (`.conversation-container`, `.audio-visualization`) are removed.

**Tech Stack:** SCSS (Sass), CSS flexbox, React (Vite dev server). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-29-narrow-layout-panel-design.md`

---

## File Structure

- **Modify:** `src/components/MainLayout/MainLayout.scss` — replace the entire `@media (max-width: 768px)` block (currently lines ~11–56). This is the only file that changes.

No other files are touched. The new rules deliberately reach into `MainPanel`'s class names (the same cross-file pattern that already exists); a comment documents that contract so a future rename in `MainPanel` is caught rather than silently no-op'ing (the root cause of the original bug).

**Resolved facts (no need to re-verify during implementation):**
- `.control-footer` already has `border-top: 1px solid #333` (in `MainPanel.scss`) → the pinned bar's separator is free; do **not** add another border.
- `Onboarding` renders `null` when inactive and uses portaled, absolutely-positioned `react-joyride` overlays (`z-index ≥ 10000`) when active → it never sits in the `.main-layout` flex flow, so the `order` swap is safe and needs no special-casing.
- Confirmed `MainPanel` class names this change depends on: `.main-content.with-panel`, `.main-panel-container`, `.main-panel-wrapper`, `.main-panel`, and the transcript elements `.conversation-toolbar`, `.conversation-display`, `.text-input-section`. The `.control-footer` (and everything inside it — ModePicker, waveforms, Start/Stop, push-to-talk, debug) is **not** touched: it renders unchanged and adapts to narrow widths via its own `@container (max-width: 768px)` styles.

---

## Task 1: Replace the narrow-viewport layout block

This is a pure-CSS change with no meaningful jsdom unit test (media-query layout needs a real browser). The TDD red→green cycle is done by **observing the broken state, applying the change, then observing the fixed state** in a browser.

**Files:**
- Modify: `src/components/MainLayout/MainLayout.scss` (the `@media (max-width: 768px)` block)

- [ ] **Step 1: Start the dev server and observe the BROKEN (red) state**

Run:
```bash
npm run dev
```
Open `http://localhost:5173`. If a "user type" / onboarding gate appears, pick any option (e.g. regular) to reach the main layout. Narrow the window to **under 768px** (or use DevTools device toolbar at ~400px wide). Click the **Settings** (⚙) toggle in the title bar.

Expected (the bug): the conversation area is crushed into a ~60px clipped sliver at the top; the transcript is unreadable. This is the state we are fixing.

- [ ] **Step 2: Replace the `@media (max-width: 768px)` block**

In `src/components/MainLayout/MainLayout.scss`, **delete** the entire current block (the comment `/* For small screens... */` plus the `@media (max-width: 768px) { ... }` it precedes — currently lines ~11–56):

```scss
  /* For small screens, change to a vertical layout with panel taking full width */
  @media (max-width: 768px) {
    flex-direction: column;
    
    .settings-panel-container {
      width: 100% !important;
      min-width: 100% !important;
      max-width: 100% !important;
      height: calc(100vh - 120px); /* Full height minus header and audio controls */
      border-top: 1px solid #333;
      border-right: none;
    }
    
    .main-content {
      height: auto;
      
      &.with-panel {
        height: 120px; /* Enough for the header and audio controls */
        min-height: 120px;
        border-right: none;
        
        .main-panel-container {
          display: block; /* Show the main panel content for audio controls */
          height: 60px; /* Just enough for the audio visualization and controls */
          overflow: hidden; /* Hide everything else */
          
          /* Ensure the audio visualization is visible */
          .main-panel {
            height: 100%;
            
            /* Hide the conversation container when panel is open */
            .conversation-container {
              display: none;
            }
            
            /* Ensure audio visualization is positioned correctly */
            .audio-visualization {
              position: relative;
              bottom: auto;
              margin-top: 10px;
            }
          }
        }
      }
    }
  }
```

**Replace** it with:

```scss
  /* Narrow viewports: stack vertically. When a side panel (Settings/Logs) is
     open, the panel takes the space and MainPanel collapses to its control
     footer, pinned as a bar at the bottom; the footer renders unchanged (its
     own @container styles handle narrow widths).
     See docs/superpowers/specs/2026-05-29-narrow-layout-panel-design.md.

     CONTRACT: the rules below reach into MainPanel's class names
     (.conversation-toolbar, .conversation-display, .text-input-section) to hide
     the transcript. If those names change in MainPanel, update them here too —
     a stale selector silently matches nothing (this is exactly what broke the
     previous version). */
  @media (max-width: 768px) {
    flex-direction: column;

    .panel-resizer { display: none; } /* meaningless when stacked */

    .settings-panel-container {
      order: 1; /* panel on top */
      width: 100% !important;
      min-width: 100% !important;
      max-width: 100% !important;
      flex: 1 1 auto;
      min-height: 0; /* allow internal scrolling */
      overflow-y: auto;
      border-top: none;
      border-right: none;
    }

    .main-content.with-panel {
      order: 2; /* control footer pinned below the panel */
      flex: 0 0 auto; /* size to the footer, not a flex-grow region */
      height: auto;
      min-height: 0;
      border-right: none;

      .main-panel-container {
        height: auto;
        overflow: visible;
      }

      .main-panel-wrapper,
      .main-panel {
        height: auto;
        min-height: 0;
      }

      /* Hide the transcript while a panel is open. MainPanel stays mounted
         (display:none, NOT unmounted) so the active session survives. The
         .control-footer is intentionally left untouched — it renders exactly
         as in the normal layout and adapts via its own @container styles. */
      .conversation-toolbar,
      .conversation-display,
      .text-input-section {
        display: none;
      }
    }
  }
```

Save the file. The Vite dev server hot-reloads the styles.

- [ ] **Step 3: Observe the FIXED (green) state — manual verification**

With the window still under 768px, run through this checklist (each should pass):

1. **Settings open:** the Settings panel fills the area under the title bar and scrolls internally; a slim one-line bar is pinned at the bottom showing the status dot, the Start/Stop button, and the `EN → JA`-style language pair. No transcript sliver; nothing clipped.
2. **Logs open:** click the Logs (📋) toggle — same behavior (Logs panel on top, slim bar pinned at bottom).
3. **Advanced mode:** open Settings → switch UI mode to **advanced** (or relaunch and pick the "experienced" user type). With a panel open and narrow, confirm the control footer renders **normally** pinned at the bottom — ModePicker, waveforms, Start/Stop and language all present — adapting to the narrow width via its own `@container` styles (e.g. collapsed button labels). It is not stripped down.
4. **Close restores transcript:** click the open panel's toggle to close it → the full conversation transcript returns at full height.
5. **Widen restores side-by-side:** drag the window wider than 768px with a panel open → the layout returns to side-by-side (main content left, panel right, `PanelResizer` visible between them).
6. **Session not interrupted (lightweight):** this is guaranteed because `MainPanel` is only `display`-toggled, never unmounted. If a provider/API key is configured, optionally start a session, open a panel, confirm the session keeps running and Start/Stop in the slim bar ends it.

If any check fails, fix the CSS and re-run this step before committing.

- [ ] **Step 4: Build to confirm SCSS compiles**

Run:
```bash
npm run build
```
Expected: build succeeds with no Sass errors referencing `MainLayout.scss`. (Sass deprecation warnings are silenced project-wide and are not failures.)

- [ ] **Step 5: Commit**

```bash
git add src/components/MainLayout/MainLayout.scss
git commit -m "fix(layout): readable narrow-viewport layout when a panel is open

When narrow and a side panel is open, give the panel the space and pin a
slim control bar (status + Start/Stop + language) at the bottom instead of
crushing the conversation into a clipped sliver. Hide the transcript via
display:none (MainPanel stays mounted, session survives). Remove the dead
rules that targeted stale class names (.conversation-container,
.audio-visualization)."
```

(Optionally include the spec and plan docs in the same or a preceding commit:
`git add docs/superpowers/specs/2026-05-29-narrow-layout-panel-design.md docs/superpowers/plans/2026-05-29-narrow-layout-panel.md`.)

---

## Optional follow-up (not required)

A Playwright responsive snapshot (narrow viewport, panel open) would guard against regressions, but Playwright is not currently configured as a test runner in this repo (tests use Vitest + jsdom, which can't evaluate media-query layout). Skip unless/until a browser-based test setup is added.

---

## Self-Review

- **Spec coverage:** Every spec section maps to Task 1 — vertical stack + panel-on-top + scroll (Step 2 `.settings-panel-container`), transcript hidden / session preserved (Step 2 `display:none`, verified Step 3.4/3.6), control footer left unchanged and pinned (no `.control-footer` rules; verified Step 3.3), reorder without `:has()` (Step 2 `order`), remove dead selectors (Step 2 deletion), no-panel-narrow untouched (only `.with-panel` targeted), breakpoint 768px (unchanged), separator reused not re-added (File Structure note). Edge cases (banners/warnings stay visible, Onboarding overlay) resolved in File Structure.
- **Placeholder scan:** none — full before/after CSS shown, exact commands and expected results given.
- **Type/name consistency:** class names used in the CSS (`.panel-resizer`, `.settings-panel-container`, `.main-content.with-panel`, `.main-panel-container`, `.main-panel-wrapper`, `.main-panel`, `.conversation-toolbar`, `.conversation-display`, `.text-input-section`) match the verified names in the spec's File Structure facts. The footer's internal classes are no longer referenced (the footer is left unchanged).
