# Compact Conversation Mode — Design

**Date**: 2026-04-18
**Status**: Approved for implementation planning
**Scope**: `MainPanel` conversation toolbar + `ConversationRow` rendering

## Motivation

The conversation panel currently renders a chat-style UI with avatars, speaker names,
timestamps, and per-line `ZH`/`EN` language badges. For users who use Sokuji as a
live translation feed (not a chat log), this chrome is noise. They want a denser,
more subtitle-like reading experience.

A full subtitle / floating-subtitle feature is planned for later as a dedicated
surface. This spec is the first step in that direction: a **toolbar toggle** that
strips chat chrome from the current conversation panel, without introducing any
new layout surfaces.

## Non-Goals

- Floating / overlay subtitles (separate future work).
- "Only last N messages" truncation.
- Auto-scroll / sticky-bottom changes.
- Preset system (`Chat` / `Reader` / `Subtitle`).
- Typography options (font family, weight, alignment, letter spacing).
- Background transparency, text stroke, or shadow for the conversation panel.

## User-Visible Behavior

### Toolbar

A single new icon button joins the existing conversation toolbar, placed
**between the font-size buttons and the clear (trash) button**. Its icon is
state-driven (no active-highlight treatment):

| State               | Icon displayed     | Action on click   |
|---------------------|--------------------|-------------------|
| Expanded (default)  | `ChevronsDownUp`   | Switch to compact |
| Compact             | `ChevronsUpDown`   | Switch to expanded|

Tooltip text mirrors the action: "Compact view" / "Expanded view"
(localized via `mainPanel.compactView.*` i18n keys).

The button is only rendered when the toolbar itself is rendered
(i.e. `combinedItems.length > 0`), matching the existing buttons.

### Rendering in Compact Mode

When compact mode is on, `ConversationRow` hides or changes the following,
**in addition to** whatever the existing `speakerDisplayMode` /
`participantDisplayMode` filters already do:

| Element | Expanded (current) | Compact |
|---|---|---|
| Row header (avatar + scope name + time) | Shown when role changes | Never shown |
| Language badge (`ZH` / `EN`) | Shown | Hidden |
| Row-level play button (▶) | Shown when available | Hidden |
| Source italic + gray color | Shown | **Unchanged** (still shown) |
| Translation near-white color | Shown | **Unchanged** (still shown) |
| Indent under header (`padding-left: 30px` on `row-body`) | Yes | Reduced (see dot below) |

### Role Dot (new)

In compact mode, the first row of each same-role run gets a single 6px
colored dot positioned before the text. Subsequent rows in the same run have
no dot (but keep the same horizontal text start so alignment is consistent).

- "First of run" = the existing `showHeader` condition in `ConversationRow`:
  `!prevItem || (prevItem.source ?? 'speaker') !== source`. The same boolean
  that gates the header in expanded mode now gates the dot in compact mode.
- Appearance: `6px × 6px` solid circle.
- Colors (reuse of existing avatar colors):
  - Speaker: `#10a37f`
  - Participant: `#f39c12`
- Position: absolute-positioned inside the row, at `left: 2px; top: 8px`
  relative to the row body.
- Row left padding in compact mode: `16px` (enough for the 6px dot + 8px gap).
  Rows that are not first-of-run still use the same `16px` padding so text
  edges line up with the first row's text.

No divider line, no color stripe, no role label, no avatar. The dot is the
sole visual cue for speaker attribution in compact mode.

### Divider Behavior

No horizontal role-switch divider is rendered in compact mode. Rows sit
directly adjacent to one another, separated only by the existing `gap: 2px`
used by the conversation list.

### Interactions That Still Apply in Compact Mode

- Speaker / participant display-mode filter (`两者 / 原文 / 译文`) works as today.
- Font size buttons (`A-` / `A+`) work as today; font size applies to `.row-text`.
- Clear conversation button works as today.
- Session-level playback (start/stop, the green Zap button) is not affected.

## Translation Badge Color by Role (expanded mode)

Independent of the compact toggle, the translation-side language badge
(`.lang-badge.tr`) gets a role-aware color so speaker and participant
translations are visually distinguishable at a glance. This matches the
color language already used by avatars and (in compact mode) by the role dot.

| Badge | Today | After |
|---|---|---|
| Source badge (`.src`) | Gray (unchanged) | Gray (unchanged) |
| Speaker translation (`.tr` on speaker row) | Green (`#10a37f`) | Green (`#10a37f`) — unchanged |
| Participant translation (`.tr` on participant row) | Green (`#10a37f`) | **Orange (`#f39c12`)** |

Implementation:

- `ConversationRow.tsx` already renders `<span class="lang-badge tr">` /
  `<span class="lang-badge src">`. Extend the class list to also include
  `source-speaker` or `source-participant` (same `source-<role>` convention
  used by the role dot).
- `ConversationRow.scss` splits the `.lang-badge.tr` rule into two role-scoped
  variants:
  ```scss
  .lang-badge.tr {
    &.source-speaker {
      background: rgba(16, 163, 127, 0.2);
      color: #10a37f;
      border: 1px solid rgba(16, 163, 127, 0.4);
    }
    &.source-participant {
      background: rgba(243, 156, 18, 0.2);
      color: #f39c12;
      border: 1px solid rgba(243, 156, 18, 0.4);
    }
  }
  ```
- `.lang-badge.src` is unchanged.
- The badge is hidden in compact mode, so this change is only visible when
  compact is off. The role dot provides equivalent color coding when compact
  is on.

## State & Persistence

Add one field to `CommonSettings` in `src/stores/settingsStore.ts`, mirroring
the existing `conversationFontSize` pattern:

```ts
// CommonSettings
conversationCompactMode: boolean;   // default: false
```

- Default: `false` (existing users see no change on upgrade).
- Persistence: via `ServiceFactory.getSettingsService().setSetting(
  'settings.common.conversationCompactMode', value)`, loaded in the same
  `initializeSettings` block that loads `conversationFontSize`.
- Store actions:
  - `setConversationCompactMode(value: boolean)` — optimistic set with
    rollback on persistence failure, same shape as `setConversationFontSize`.
- Hooks:
  - `useConversationCompactMode()` selector, paralleling `useConversationFontSize`.

## Component Changes

### `MainPanel.tsx`

1. Import `ChevronsDownUp`, `ChevronsUpDown` from `lucide-react`.
2. Read `conversationCompactMode` + setter from `settingsStore`.
3. In the toolbar JSX (around the existing font-size / clear buttons), insert
   a new `<button>` between the font-size group and the trash button. Icon is
   chosen by current state; `onClick` toggles the store value.
4. Pass `compact` down to each `<ConversationRow>` instance. The existing
   `prevItem` argument passed to the row is sufficient for the row to compute
   its own "first of run" status — no extra wiring needed from MainPanel.

   Note: `prevItem` must continue to come from `filteredItems` (the list
   already respecting display-mode filters), not `combinedItems`, so the role
   dot reflects what the user actually sees.

### `ConversationRow.tsx`

1. Add `compact?: boolean` to `ConversationRowProps` (default `false`).
2. When `compact` is true:
   - Do not render `<div class="row-header">`, regardless of `showHeader`.
   - Do not render the `<span class="lang-badge">`.
   - Do not render the row-level play button, regardless of `canPlay`.
   - When `showHeader` is true (first row of a same-role run), render a
     `<span class="row-role-dot source-<source>" />` as the first child of
     `.row-body`. No dot when `showHeader` is false.
3. Regardless of `compact`, extend the `.lang-badge` class list to include
   `source-<source>` so SCSS can color the translation badge by role
   (see "Translation Badge Color by Role" section).
4. Add `compact` to the root `div`'s class list for SCSS hooks
   (`conversation-row compact` / `conversation-row expanded`).
5. `renderText()` behavior (playback highlight, italic for source text) is
   unchanged.

### `ConversationRow.scss` / `MainPanel.scss`

1. In `ConversationRow.scss`, add a `.conversation-row.compact .row-body`
   rule that sets `padding-left: 16px` (replacing the `30px` indent used in
   expanded mode) and `position: relative` so the dot can be absolutely
   positioned.
2. Add `.row-role-dot` rules:
   ```scss
   .row-role-dot {
     position: absolute;
     left: 2px;
     top: 8px;
     width: 6px;
     height: 6px;
     border-radius: 50%;

     &.source-speaker     { background: #10a37f; }
     &.source-participant { background: #f39c12; }
   }
   ```
3. Add styling for the new compact toggle. Reuse `.font-size-btn` class if
   that works visually; otherwise follow the same pattern with a new
   class name.

## i18n

Add two keys under `mainPanel`:

- `mainPanel.compactView` — "Compact view" (tooltip when in expanded mode; click switches to compact)
- `mainPanel.expandedView` — "Expanded view" (tooltip when in compact mode; click switches to expanded)

Only `en` needs to be authored; other locales fall back until translated.

## Testing

- `conversationFilter.test.ts` is unaffected; compact mode does not filter items.
- Add a `ConversationRow.compact.test.tsx` (or extend existing colocated tests
  if any) that asserts:
  - Compact + first-of-run → renders `.row-role-dot` with the correct
    `source-speaker` / `source-participant` class.
  - Compact + not first-of-run → no `.row-role-dot` rendered.
  - Compact hides header, language badge, and play button regardless of input.
  - Non-compact preserves existing behavior (no dot; header / badge / play
    button appear per existing rules).
  - Translation badge carries `source-speaker` or `source-participant` class
    in both compact and expanded rendering (so the SCSS color rules apply).

## Risks & Open Questions

- **Play button removal**: power users who rely on per-line replay may prefer
  compact mode to keep ▶. We can revisit if feedback comes in; the toggle is
  one click away either way, so the cost is low.
- **Role attribution with display-mode filters**: if a user sets
  `participantDisplayMode = 'off'` (hiding participant entirely), no
  participant rows are rendered, so no orange dots appear — correct behavior.
  First-of-run detection uses `prevItem` from `filteredItems`, so it always
  matches what the user sees.
- **Accessibility**: the role dot is purely visual. Screen readers should
  continue to rely on per-row content (speaker/role information is lost in
  compact mode, same as any subtitle UI). Acceptable given the feature's goal.

## Files Touched

- `src/stores/settingsStore.ts` — add field, default, action, hook, init load, persist.
- `src/components/MainPanel/MainPanel.tsx` — toolbar button, `compact` prop wiring.
- `src/components/MainPanel/MainPanel.scss` — new toolbar button style (if needed).
- `src/components/MainPanel/ConversationRow.tsx` — `compact` prop, role dot rendering, conditional hides.
- `src/components/MainPanel/ConversationRow.scss` — `.row-role-dot` + compact layout tweaks.
- `src/locales/en/translation.json` — two new strings under the `mainPanel` block.
- New test file(s) as listed above.
