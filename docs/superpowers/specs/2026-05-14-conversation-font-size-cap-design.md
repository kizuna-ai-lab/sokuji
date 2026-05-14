# Conversation Font-Size Cap for Classroom Projection — Design

**Issue**: [#230](https://github.com/kizuna-ai-lab/sokuji/issues/230) — _allow larger font sizes for original and translated text in subtitle/conversation view_
**Date**: 2026-05-14
**Status**: Draft

## Problem

Reported by **Ray Chow**, who runs Sokuji in a Youth Night School English learning group projected onto a large classroom screen. At the current maximum, students sitting farther from the screen cannot read the original speech and the translation.

## Existing state

The plumbing for adjustable font sizes already exists on both surfaces:

**MainPanel** (used in both Electron and the browser extension, in basic and advanced UI modes):
- Conversation toolbar already exposes `A↓ / A↑` font-size buttons (`src/components/MainPanel/MainPanel.tsx:2934-2953`).
- Range hard-coded to **12 → 28 px**, step 2, default 14.
- State persisted via `settingsStore.conversationFontSize` (`src/stores/settingsStore.ts` lines 43, 192, 901-911, 1460).
- CSS variable `--conversation-font-size` is set on `.conversation-display` and consumed by `.message-content` in `MainPanel.scss:218` and `ConversationRow.scss:67`. Line-height is `1.4` (unitless), so spacing scales with font size.
- Toolbar is shown whenever a session is active or there are existing messages; no `uiMode` gating.

**Subtitle mode** (Electron floating window + extension overlay):
- Has its own +/- buttons in `SubtitleBar.tsx:122-133`.
- Range `FONT_SIZE_MIN=12 → FONT_SIZE_MAX=48`, step 2, default 24, persisted via `subtitleStore`.
- Already adequate for projection; no change needed.

The single concrete gap blocking the classroom use case is that **MainPanel's cap of 28 px is too small for projection**.

## Proposed change

Raise MainPanel's font-size cap from **28 → 48 px**, matching subtitle mode's existing range. Keep the existing +/- stepper UI, default value, persistence, and CSS variable wiring. No new settings surface.

## Detailed design

### 1. `src/stores/settingsStore.ts`

- Export new constants alongside the existing common-settings shape:

  ```ts
  export const CONVERSATION_FONT_SIZE_MIN = 12;
  export const CONVERSATION_FONT_SIZE_MAX = 48;
  ```

  (Mirrors the `FONT_SIZE_MIN` / `FONT_SIZE_MAX` exports from `subtitleStore.ts:64-65`.)

- In `setConversationFontSize`, clamp the incoming value to `[MIN, MAX]` before writing to state and persisting. Today the setter writes whatever it is given.

- In the load path (around line 1460, where `conversationFontSize` is read from settings storage), clamp the value as well so any stored out-of-range value gets corrected on next load. This protects users who already have a value stored from a future change.

### 2. `src/components/MainPanel/MainPanel.tsx`

- Import the two new constants from `settingsStore`.
- Replace the literal `12` / `28` in the two button handlers (lines 2936-2937, 2946-2947) with `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX`. The `disabled` state continues to derive from the same bounds.

### 3. Styles

No SCSS change. `.message-content { font-size: var(--conversation-font-size, 14px); line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; }` already scales correctly:

- `line-height: 1.4` is unitless, so it scales with the font.
- Bubble paddings/max-widths stay in px and remain proportionate.
- `word-wrap: break-word` and `.conversation-display`'s flex layout ensure long lines wrap rather than clip.

### 4. Extension

No extension-specific change. `extension/vite.config.ts` aliases `@components` to `../src/components`, so the same MainPanel ships in both targets.

### 5. Subtitle mode

Untouched. Already 12-48.

## Acceptance-criteria mapping

| Criterion (from issue #230) | How met |
| --- | --- |
| User can pick a font size that is clearly readable from across a typical classroom | Cap rises 28 → 48 px (~70% larger maximum), matching subtitle-mode max |
| Default size unchanged | Default stays at 14 |
| Persists across sessions | Already wired through `settingsStore`; clamp on load preserves valid stored values |
| Layout works at the largest setting — no clipping, no overlap with controls/footer, scrolling still behaves | Verified manually at the new max; `line-height: 1.4` scales with font; bubbles wrap; toolbar sits above conversation, unaffected |
| Works in both Electron and browser extension | Shared MainPanel code via `@components` alias |

## Automated tests

Add to `src/stores/settingsStore.test.ts` (currently has no coverage for `conversationFontSize`):

- `setConversationFontSize(5)` → state value is clamped to `CONVERSATION_FONT_SIZE_MIN` (12).
- `setConversationFontSize(100)` → state value is clamped to `CONVERSATION_FONT_SIZE_MAX` (48).
- `setConversationFontSize(20)` → state value stays at 20 (in-range pass-through).

Mirrors the existing pattern in `src/stores/subtitleStore.test.ts:31-37`.

## Manual verification (test plan)

Run on Electron and on the extension side panel, in both basic and advanced UI modes:

1. Start a session, send / receive a few messages.
2. Click `A↑` repeatedly — value reaches 48 and stops; button becomes disabled.
3. Click `A↓` repeatedly — value reaches 12 and stops; button becomes disabled.
4. At 48 px, verify:
   - Bubbles wrap; no horizontal overflow.
   - Conversation scrolls correctly when content exceeds the viewport.
   - The conversation toolbar above and the footer below are unaffected.
   - Karaoke-highlighted (currently-playing) bubbles still render correctly with the new size.
5. Reload the app — the chosen size persists.
6. Manually inject an out-of-range value (e.g., 200) into stored settings, reload — value gets clamped to 48.

## Out of scope

- Adding a separate "Presentation / Projection" preset (existing +/- control already implements an S/M/L/XL stepper shape; raising the cap covers the classroom use case).
- Bumping subtitle mode's max (already adequate at 48).
- Asymmetric step sizing (e.g., step=4 above 28). Subtitle mode lives with step=2 across its full range; consistency wins.
- Per-bubble-type or per-language sizing.
- Replacing the +/- stepper with a slider or numeric input.

## Risks

- **Visual regression at large sizes**: mitigated by manual verification step 4 above. Line-height is relative so spacing scales; bubbles are flex children that wrap.
- **Stored value out of range** (forward / backward compatibility): mitigated by clamp-on-load.
