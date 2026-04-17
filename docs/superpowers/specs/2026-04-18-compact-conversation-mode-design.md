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

| Element                                | Expanded (current) | Compact        |
|----------------------------------------|--------------------|----------------|
| Row header (avatar + scope name + time)| Shown when role changes | Never shown |
| Language badge (`ZH` / `EN`)           | Shown              | Hidden         |
| Row-level play button (▶)              | Shown when available | Hidden       |
| Translation italic + light green color | Shown              | **Unchanged** (still shown) |
| Indent under header (`padding-left: 28px` on `row-body`) | Yes | No (flush left) |

### Role Switch Divider (new)

In compact mode, when two consecutive visible rows have different `source`
(`speaker` ↔ `participant`), a thin horizontal rule is rendered between them.

- Appearance: `1px` solid line, color `#2a2a2a` (matches existing toolbar divider).
- Spacing: `6px` margin top and bottom.
- Full width of the conversation list column.
- First row in the list has no divider above it.
- No divider within a same-role run, regardless of how many rows.

This is the **only** visual cue for speaker attribution in compact mode. No
color stripe, no role label, no avatar.

### Interactions That Still Apply in Compact Mode

- Speaker / participant display-mode filter (`两者 / 原文 / 译文`) works as today.
- Font size buttons (`A-` / `A+`) work as today; font size applies to `.row-text`.
- Clear conversation button works as today.
- Session-level playback (start/stop, the green Zap button) is not affected.

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
4. Pass `compact` down to the row renderer (see below).
5. When rendering the conversation list, compute `showDivider` for each row as
   `compact && index > 0 && prevVisibleItem.source !== currentItem.source`.
   Render a `<div class="role-divider" />` before the row when true.

   The "previous visible item" must be computed from `filteredItems` (the list
   already respecting display-mode filters), not `combinedItems`, so the divider
   reflects what the user actually sees.

### `ConversationRow.tsx`

1. Add `compact?: boolean` to `ConversationRowProps` (default `false`).
2. When `compact` is true:
   - Do not render `<div class="row-header">`, regardless of `showHeader`.
   - Do not render the `<span class="lang-badge">`.
   - Do not render the row-level play button, regardless of `canPlay`.
3. Add `compact` to the root `div`'s class list for SCSS hooks
   (`conversation-row compact` / `conversation-row expanded`).
4. `renderText()` behavior (playback highlight, italic for translation) is
   unchanged.

### `ConversationRow.scss` / `MainPanel.scss`

1. In `ConversationRow.scss`, add a `.conversation-row.compact .row-body`
   rule that removes the left padding previously supplied by the header
   indent (if any).
2. Add `.role-divider` rules in `MainPanel.scss`:
   ```scss
   .role-divider {
     height: 1px;
     background: #2a2a2a;
     margin: 6px 0;
   }
   ```
3. Add `.font-size-btn`-equivalent styling for the new compact toggle (reuse
   the existing toolbar button class if one exists; otherwise follow the same
   pattern).

## i18n

Add two keys under `mainPanel`:

- `mainPanel.compactView` — "Compact view" (tooltip when in expanded mode; click switches to compact)
- `mainPanel.expandedView` — "Expanded view" (tooltip when in compact mode; click switches to expanded)

Only `en` needs to be authored; other locales fall back until translated.

## Testing

- `conversationFilter.test.ts` is unaffected; compact mode does not filter items.
- Add a `ConversationRow.compact.test.tsx` (or extend existing colocated tests
  if any) that asserts:
  - Compact prop hides header, badge, and play button.
  - Non-compact preserves existing behavior.
- Add a `MainPanel.roleDivider.test.tsx` that asserts, given a filtered list
  with alternating `source` values, a divider element appears between role
  transitions and not within same-role runs. Use `@testing-library/react` +
  the existing `jsdom` setup.

## Risks & Open Questions

- **Play button removal**: power users who rely on per-line replay may prefer
  compact mode to keep ▶. We can revisit if feedback comes in; the toggle is
  one click away either way, so the cost is low.
- **Divider visibility with existing display-mode filters**: if a user sets
  `participantDisplayMode = 'off'` (hiding participant entirely), role
  transitions disappear naturally and no divider is drawn — correct behavior.
- **Accessibility**: the divider is purely visual. Screen readers should
  continue to rely on per-row content (speaker/role information is lost in
  compact mode, same as any subtitle UI). Acceptable given the feature's goal.

## Files Touched

- `src/stores/settingsStore.ts` — add field, default, action, hook, init load, persist.
- `src/components/MainPanel/MainPanel.tsx` — toolbar button, divider insertion, prop wiring.
- `src/components/MainPanel/MainPanel.scss` — `.role-divider` + new button style.
- `src/components/MainPanel/ConversationRow.tsx` — `compact` prop, conditional rendering.
- `src/components/MainPanel/ConversationRow.scss` — compact layout tweaks.
- `src/locales/en/translation.json` — two new strings under the `mainPanel` block.
- New test file(s) as listed above.
