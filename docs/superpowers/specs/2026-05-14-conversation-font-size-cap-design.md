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
- Adequate for typical screens but still small for large classroom / hall projection.

Both surfaces have a cap that is too low for classroom-scale projection. **MainPanel's 28 px is the more severe gap, but subtitle's 48 px also leaves headroom for larger projection setups.**

## Proposed change

Raise the font-size cap on **both** surfaces to **64 px**:

- MainPanel: **28 → 64 px**
- Subtitle mode: **48 → 64 px**

Keep the existing +/- stepper UI, default values, persistence, and CSS variable wiring on both surfaces. No new settings surface.

## Detailed design

### 1. `src/stores/settingsStore.ts`

- Export new constants alongside the existing common-settings shape:

  ```ts
  export const CONVERSATION_FONT_SIZE_MIN = 12;
  export const CONVERSATION_FONT_SIZE_MAX = 64;
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

### 5. `src/stores/subtitleStore.ts`

- Update `FONT_SIZE_MAX` from `48` → `64` (line 65). `FONT_SIZE_MIN`, default (24), and step (2) stay the same.
- Existing clamp logic (`clamp(Math.round(n), FONT_SIZE_MIN, FONT_SIZE_MAX)` on both setter and load path) automatically picks up the new bound.
- Update the existing test in `src/stores/subtitleStore.test.ts` that hardcodes 48: line 31 description (`'clamps fontSize to [12, 48]'` → `'[12, 64]'`) and line 35 assertion (`toBe(48)` → `toBe(64)`). The line 37 in-range assertion (28) is unaffected.

## Acceptance-criteria mapping

| Criterion (from issue #230) | How met |
| --- | --- |
| User can pick a font size that is clearly readable from across a typical classroom | MainPanel cap rises 28 → 64 px (~2.3× larger max); subtitle cap rises 48 → 64 px |
| Defaults unchanged | MainPanel default stays at 14; subtitle default stays at 24 |
| Persists across sessions | Already wired through `settingsStore` and `subtitleStore`; clamp on load preserves valid stored values |
| Layout works at the largest setting — no clipping, no overlap with controls/footer, scrolling still behaves | Verified manually at 64 on both surfaces; `line-height: 1.4` scales with font; bubbles wrap; toolbars / bars sit above conversation, unaffected |
| Works in both Electron and browser extension | Shared MainPanel and Subtitle code via `@components` alias |

## Automated tests

**`src/stores/settingsStore.test.ts`** (currently has no coverage for `conversationFontSize`):

- `setConversationFontSize(5)` → state value is clamped to `CONVERSATION_FONT_SIZE_MIN` (12).
- `setConversationFontSize(100)` → state value is clamped to `CONVERSATION_FONT_SIZE_MAX` (64).
- `setConversationFontSize(20)` → state value stays at 20 (in-range pass-through).

Mirrors the existing pattern in `src/stores/subtitleStore.test.ts:31-37`.

**`src/stores/subtitleStore.test.ts`**: update the existing `'clamps fontSize to [12, 48]'` test to assert the new upper bound of 64 (description string + line 35 `toBe(48)` → `toBe(64)`).

## Manual verification (test plan)

**MainPanel** — run on Electron and on the extension side panel, in both basic and advanced UI modes:

1. Start a session, send / receive a few messages.
2. Click `A↑` repeatedly — value reaches 64 and stops; button becomes disabled.
3. Click `A↓` repeatedly — value reaches 12 and stops; button becomes disabled.
4. At 64 px, verify:
   - Bubbles wrap; no horizontal overflow.
   - Conversation scrolls correctly when content exceeds the viewport.
   - The conversation toolbar above and the footer below are unaffected.
   - Karaoke-highlighted (currently-playing) bubbles still render correctly with the new size.
5. Reload the app — the chosen size persists.
6. Manually inject an out-of-range value (e.g., 200) into stored settings, reload — value gets clamped to 64.

**Subtitle mode** — run on Electron's floating subtitle window and the extension overlay:

7. Open subtitle mode, click `+` repeatedly — value reaches 64 and stops; button becomes disabled.
8. At 64 px, verify the subtitle window/overlay still renders the original + translated text without clipping or layout breakage; controls in the bar remain usable.
9. Reload — chosen size persists.

## Out of scope

- Adding a separate "Presentation / Projection" preset (existing +/- control already implements an S/M/L/XL stepper shape; raising the cap covers the classroom use case).
- Asymmetric step sizing (e.g., step=4 above 28). Step=2 across the full range matches subtitle mode's existing behavior; consistency wins. (12 → 64 in steps of 2 is 26 clicks but still acceptable, and users typically set once and persist.)
- Per-bubble-type or per-language sizing.
- Replacing the +/- stepper with a slider or numeric input.

## Risks

- **Visual regression at large sizes**: mitigated by manual verification step 4 above. Line-height is relative so spacing scales; bubbles are flex children that wrap.
- **Stored value out of range** (forward / backward compatibility): mitigated by clamp-on-load.
