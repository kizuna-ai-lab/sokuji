# Narrow-layout readability when a side panel is open

**Date:** 2026-05-29
**Status:** Approved design — ready for implementation plan
**Area:** `src/components/MainLayout/` (responsive layout)

## Summary

On narrow viewports, opening the Settings or Logs panel crushes the main
conversation area into a clipped, unreadable sliver. This spec replaces that
behavior: when the viewport is narrow **and** a side panel is open, the panel
takes the available space and the conversation transcript is cleanly hidden,
while the control footer — rendered exactly as it normally is — stays pinned at
the bottom so the session remains controllable. Closing the panel restores the
transcript; widening the viewport restores the side-by-side layout.

The change is confined to one stylesheet — `MainLayout.scss` — and does not
alter `MainPanel`'s markup or behavior.

## Problem

`.main-layout` is a flex **row** by default: `.main-content` (the `MainPanel`,
i.e. conversation + control footer) on the left, `.settings-panel-container`
(Settings or Logs) on the right, with a `PanelResizer` between them.

At `@media (max-width: 768px)` it flips to `flex-direction: column`. When a
panel is open, the current rules force:

- `.main-content.with-panel { height: 120px; min-height: 120px; }`
- `.main-panel-container { height: 60px; overflow: hidden; }`

This squeezes the entire `MainPanel` (toolbar + scrolling transcript + control
footer) into ~60px and clips it — the "上下很窄、不可读" (vertically tiny,
unreadable) state.

### Root cause

Two compounding issues:

1. **The squeeze itself** — the hard `120px` / `60px` height caps on
   `.main-content.with-panel` and `.main-panel-container`.
2. **Dead selectors** — the rules that were *supposed* to hide the transcript
   target `.conversation-container` and `.audio-visualization`, but `MainPanel`
   now renders `.conversation-display` and `.control-footer`. Those old class
   names exist nowhere in the rendered component, so the rules silently match
   nothing. Nothing is hidden; it is merely clipped by `overflow: hidden`.

The original intent behind reserving 60–120px was to keep the **session
controls** (Start/Stop, status) reachable while a panel is open. The new design
preserves that intent without crushing the transcript.

## Goals

- On narrow viewports with a panel open, both the panel and the session
  controls are fully usable; nothing is clipped.
- Start/Stop and connection status remain reachable while a panel is open.
- The active session is never interrupted by opening/closing a panel
  (`MainPanel` stays mounted).
- Wide-viewport (side-by-side) behavior is unchanged.
- Change stays localized; remove the dead/stale CSS.

## Non-goals

- No redesign of the wide-screen side-by-side layout or the `PanelResizer`.
- No changes to `MainPanel`'s component structure, props, or rendering logic.
- No bottom-sheet/drawer gestures or animations (considered and rejected as
  more code than this fix warrants — see Alternatives).

## Design

Chosen direction: **Panel takeover with the control footer pinned as a bar at
the bottom — rendered unchanged.**

> **Decision update (2026-05-29):** an earlier revision slimmed the footer in
> narrow mode (hiding ModePicker / waveforms / push-to-talk / debug). That was
> dropped: the footer is left exactly as it renders normally. The footer's own
> `@container (max-width: 768px)` styles already adapt it to narrow widths, so a
> parallel slim variant added coupling and a horizontal-overflow risk for no
> real gain.

### Target behavior — narrow (`≤768px`) AND a panel open

1. `.main-layout` stays `flex-direction: column`.
2. **Settings/Logs panel** is on top, full width, `flex: 1`, scrolls
   internally — the prime space directly under the `TitleBar`.
3. **Transcript hidden, session preserved**: `.conversation-toolbar`,
   `.conversation-display`, and `.text-input-section` are set to
   `display: none`. `MainPanel` is **not** unmounted, so the active session
   survives. Closing the panel restores the transcript.
4. **Control footer pinned at the bottom**: the existing `.control-footer`
   renders **unchanged** (basic or advanced, including its ModePicker and
   waveforms), full width, below the panel. Its own
   `@container (max-width: 768px)` styles already adapt it to narrow widths.

### Ordering (bar at the bottom)

The bar lives inside `.main-content`, which is the **first** flex child in DOM
order. To render it below the panel, swap flex `order`. `:has()` is **not**
needed because `.settings-panel-container` is only rendered when a panel is open:

- `.settings-panel-container { order: 1; }` → top
- `.main-content.with-panel { order: 2; }` → bottom
- `.panel-resizer { display: none; }` → meaningless when stacked

### Control footer: unchanged

The footer is **not** modified in narrow mode — no controls are stripped. It
renders exactly as in the normal (wide / full-height) layout, in both its
`.control-footer.basic` and `.control-footer.advanced` variants. The footer
already carries its own `@container (max-width: 768px)` rules (e.g. collapsing
button labels), so it adapts to a narrow bar on its own. Consequently the
narrow-mode rules reach into `MainPanel` only to hide the transcript
(`.conversation-toolbar`, `.conversation-display`, `.text-input-section`) — not
the footer's internals.

### CSS sketch (single file: `MainLayout.scss`)

Replace the current `@media (max-width: 768px)` block with:

```scss
@media (max-width: 768px) {
  flex-direction: column;

  .panel-resizer { display: none; }            // meaningless when stacked

  .settings-panel-container {
    order: 1;                                   // panel on top
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    flex: 1 1 auto;
    min-height: 0;                              // allow internal scroll
    overflow-y: auto;
    border-top: none;
    border-right: none;
  }

  .main-content.with-panel {
    order: 2;                                   // slim bar pinned below
    flex: 0 0 auto;                             // size to the footer
    height: auto;
    min-height: 0;
    border-right: none;

    .main-panel-container { height: auto; overflow: visible; }
    .main-panel-wrapper,
    .main-panel { height: auto; min-height: 0; }

    // Hide the transcript while a panel is open. MainPanel stays mounted
    // (display:none, not unmounted) so the active session survives.
    // The .control-footer is intentionally left untouched.
    .conversation-toolbar,
    .conversation-display,
    .text-input-section { display: none; }
  }
}
```

A comment will document that these descendant selectors depend on `MainPanel`'s
class names — the contract whose drift (`.conversation-container` →
`.conversation-display`) caused the original bug. This keeps the next renamer
aware of the cross-file coupling.

### Separator

Ensure a 1px top border on the pinned bar so it reads as distinct from the
panel above it. Reuse `.control-footer`'s existing top border if present;
otherwise add `border-top: 1px solid #333;` to `.main-content.with-panel`.

### Accessibility trade-off (accepted)

The bottom-pinned bar is produced with CSS flex `order` (panel `order: 1`,
main-content `order: 2`). `order` changes visual position only, not DOM/focus
order — so in the narrow + panel-open state, keyboard and screen-reader users
traverse the footer (Start/Stop, language) **before** the panel, the reverse of
the visual top→bottom (WCAG 2.4.3 Focus Order / 1.3.2 Meaningful Sequence).

This is **accepted, not fixed**: the mismatch is confined to one state, the
reordered-first region (the footer) holds only a few controls, and the clean
alternatives each cost more — a top-pinned bar abandons the chosen
bottom-bar ergonomics, and a JS/`matchMedia` DOM reorder re-couples a responsive
concern to React that this CSS-only design deliberately avoids. If WCAG focus
order later becomes a priority for this viewport, reorder the DOM in
`MainLayout.tsx` (render the panel before `.main-content` when narrow +
panel-open) and drop the `order` swap. (Raised in PR #254 review by Gemini Code
Assist.)

## Edge cases & verification items

- **`UpdateBanner` / `UpdateDialog` / `AudioFeedbackWarning`** live inside
  `.main-panel-wrapper` / `.main-panel` and remain visible (transient and
  important). Acceptable; revisit only if they visibly crowd the slim bar.
- **`Onboarding`** is a sibling inside `.main-layout`. Implementation must
  verify it is an overlay (fixed/absolute or portal) so the flex `order` swap
  does not misposition it. If it is in normal flow, give it `order: 0` or
  otherwise exclude it from the reordering.
- **No-panel narrow** (`.main-content.full-width`) is untouched: `MainPanel`
  renders normally at full height.
- **Breakpoint** stays at `768px`. The browser-extension side panel is
  typically narrower than this, so it is effectively always in column mode —
  the takeover is its normal state there, which is intended.

## Alternatives considered

- **B · Proportional split** (conversation + panel both visible, each scrolls):
  rejected — comfortable only when the narrow view is also tall; cramped on
  short viewports, and shows a partial transcript that competes with the panel.
- **C · Bottom-sheet drawer** (panel slides up over the conversation): rejected
  — most mobile-native feel but the most new code (gesture/animation, overlay
  z-index, focus management) for little gain over A.

## Testing / verification

Primary verification is a manual responsive check (CSS media-query layout is
not meaningfully testable in jsdom):

1. Narrow the viewport below 768px. Open **Settings**, then **Logs**:
   - Panel fills the space above and scrolls internally.
   - The control footer is pinned at the bottom and renders normally (basic or
     advanced — ModePicker, waveforms, Start/Stop, language all present),
     adapting to the narrow width via its own `@container` styles.
   - Nothing is clipped; no transcript sliver.
2. Start a session, then open a panel → session persists and Start/Stop works.
   Stop from the slim bar → session ends.
3. Close the panel → transcript returns at full height.
4. Widen past 768px → side-by-side layout (with `PanelResizer`) restored.

A Playwright responsive snapshot is optional. No new unit tests are warranted
for a pure-CSS change.

## Files touched

- `src/components/MainLayout/MainLayout.scss` — replace the
  `@media (max-width: 768px)` block (the only required change).
