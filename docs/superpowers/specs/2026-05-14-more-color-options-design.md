# More Color Options for Subtitle and Conversation Panel — Design

**Date**: 2026-05-14
**Status**: Approved for implementation planning
**Tracking issue**: [#231](https://github.com/kizuna-ai-lab/sokuji/issues/231)
**Scope**: `SubtitleSettingsPopover`, `MainPanel`, `subtitleStore` defaults

## Context

Issue #231 ("add high-contrast subtitle themes") came from a classroom user (Ray Chow, Youth Night School English group) projecting Sokuji on a large screen under varying lighting. The user's original email asked for "more background and font color options" and listed four example combinations (white-on-black, black-on-white, dark-blue-on-light, larger high-contrast). The issue draft re-cast the request as a "theme presets" feature with a `presentation` preset that bundles colors with a larger font size.

Re-reading the email against the existing UI confirms a simpler diagnosis: the subtitle settings popover already exposes background, source-text, and translation-text color chips, but the source/translation chip palettes contain only light and warm colors. The user can configure three of the four example combinations today; the fourth (white background with dark text) is unreachable because no chip palette includes a dark color. Larger font is tracked separately and is out of scope here.

This spec therefore drops the "theme" abstraction. It adds the missing dark color chips, adds an "any color" picker as a final fallback, wires the existing color fields into the conversation panel (today they are observed only by the dedicated subtitle surface), and rewords the popover labels so the user sees that one setting now affects two surfaces.

## Non-Goals

- Theme presets (named combinations of colors stored as a single setting).
- Saving named custom themes.
- Per-side colors (different bubble color per speaker / participant).
- Larger font sizes — tracked in the separate font-size issue.
- An app-wide light theme for chrome (titlebar, sidebar, control footer, input section). Chrome and content are already physically separate surfaces; a dark chrome does not break a white content area, and no user has asked for it. Re-evaluate if a second projector user reports it.
- Removing or restyling the subtitle background opacity slider (still meaningful for the floating subtitle window; not applied to the conversation panel).
- Changing chip colors that are already present.

## User-Visible Behavior

### In the subtitle settings popover

The ⚙ Settings popover on the subtitle bar gains:

- **Three additional dark chips on the source-text row**: black (`#000000`), deep navy (`#003B6F`), deep forest (`#1B5E20`). These let the user configure readable source text against a white or light background.
- **Three additional dark chips on the translation-text row**: black (`#000000`), deep navy (`#003B6F`), deep purple (`#7B1FA2`).
- **A "+" custom-color chip at the end of every chip row** (background, source, translation). Clicking opens the operating system's native color picker. Any hex the user picks is saved to the same setting as the preset chips (`bgColor` / `sourceTextColor` / `translationTextColor`); there is no new "custom theme" concept.
- **Updated labels** that no longer pretend the settings only affect the subtitle window:
  - "Background opacity" → unchanged (still subtitle-window only — the conversation panel does not apply opacity).
  - "Background color" → "Display background".
  - "Source text color" → "Source text".
  - "Translation color" → "Translation text".
  - A small one-line caption at the top of the popover: "Applies to the subtitle window and the conversation panel."

### Highlight rules in the popover

- A preset chip is highlighted when its hex equals the current stored value.
- The "+" chip is highlighted when the current stored value is **not** in the preset row (i.e., the user picked a custom color). The "+" chip's swatch background reflects the current stored value so the user always sees what color is active.

### In the conversation panel (MainPanel)

When the user changes any of the three color settings, the conversation panel updates immediately:

- **Conversation content area background** follows `bgColor`.
- **Original-language text** in conversation rows follows `sourceTextColor`.
- **Translated text** in conversation rows follows `translationTextColor`.
- **Currently-playing row** is indicated by a 1px ring in the translation-text color around the row body, instead of the existing translucent green background. The ring works against any background color; the translucent green stops being visible against translation-color backgrounds.

The chrome (control footer, text input section, titlebar, sidebar) does **not** change color and stays on its existing dark tokens.

The conversation panel does not apply the subtitle-window background opacity. It uses the chosen `bgColor` as a flat color.

### Default value change

The `subtitleStore` default `bgColor` changes from `#000000` (pure black) to `#1f1f1f` (the conversation panel's existing implicit dark color). Rationale and migration are in [Compatibility](#compatibility).

## Implementation

### File-level changes

#### `src/components/Subtitle/SubtitleSettingsPopover.tsx`

- Extend `SOURCE_PRESETS` with `'#000000', '#003B6F', '#1B5E20'`.
- Extend `TRANSLATION_PRESETS` with `'#000000', '#003B6F', '#7B1FA2'`.
- `BG_PRESETS` is unchanged — it already covers the email's three background examples (black, white, deep navy `#0d2032`).
- Extract a `<ColorRow label preset value onChange />` subcomponent reused by all three rows. Each row renders the existing chips, then one extra "+" custom-color chip.
- The "+" chip is a `<label>` containing a hidden `<input type="color">`. Clicking the chip triggers the OS color dialog. The chip's swatch background is the current `value` so it doubles as a "current color" indicator.
- The `onChange` of `<input type="color">` is debounced ~150ms before calling the corresponding setter (raw `onChange` fires continuously while the user drags inside the OS picker — without debounce this would flood the persistence layer).
- Wrap the popover body in a small caption row showing the new "Applies to the subtitle window and the conversation panel" string from i18n.
- Update label translation keys per [i18n](#i18n).

#### `src/components/Subtitle/SubtitleSettingsPopover.scss`

- Add `.swatch.custom` style: same circular footprint as the other chips, hosts a hidden `<input type="color">` (`position: absolute; opacity: 0; pointer-events: none; width: 100%; height: 100%`), shows current color via inline `style={{ background: value }}`, and overlays a small `+` icon (e.g., a `::after` glyph or a Lucide `Plus` rendered at 10–12px).
- Caption row style: small font, low-emphasis foreground.

#### `src/components/MainPanel/MainPanel.tsx`

- At the existing root `<div className="main-panel-wrapper">` element, add inline `style` setting three CSS custom properties from `useSubtitleSettings()`:

  ```tsx
  const subtitle = useSubtitleSettings();
  // ...
  <div
    className="main-panel-wrapper"
    style={{
      '--subtitle-bg-color': subtitle.bgColor,
      '--subtitle-source-color': subtitle.sourceTextColor,
      '--subtitle-translation-color': subtitle.translationTextColor,
    } as React.CSSProperties}
  >
  ```

- This is the only change in this file. The rest of the wiring is in SCSS variable consumption.
- Note on isolation: `SubtitleStream` already sets the same two text-color properties on its own subtree. Because that subtree only renders inside the floating subtitle window or the extension overlay iframe (separate DOM trees from the side-panel's MainPanel), the two scopes never overlap.

#### `src/components/MainPanel/MainPanel.scss`

Two functional edits and one cleanup:

1. `.conversation-display` gets `background: var(--subtitle-bg-color, #1f1f1f);` — the conversation content area becomes themable.
2. `.conversation-list .row-body.playing` (which currently has `background: rgba(16, 163, 127, 0.1)`) drops the background and gets `box-shadow: 0 0 0 1px var(--subtitle-translation-color, #10a37f); border-radius: 4px;` — playing-state indicator becomes a translation-color ring that survives any background.
3. **Cleanup**: remove the `.message-bubble.user`, `.message-bubble.assistant`, `.message-bubble.user.playing`, `.message-bubble.assistant.playing`, `.message-bubble.participant-source.user`, `.message-bubble.participant-source.assistant` (and their `.playing` nested rules) blocks, plus the `.message-bubble.assistant .karaoke-played` override. These selectors are no longer rendered: `MainPanel.tsx` only emits `message-bubble error` and `message-bubble system` for the bubble class today; the conversation rows are rendered through `<ConversationRow>` instead. Removing them prevents future readers from inferring user/assistant visual differentiation that no longer exists.

`.message-bubble.error`, `.message-bubble.system`, `.text-input-section`, `.control-footer`, and `.conversation-toolbar` are unchanged: error and system are status-semantic colors; the rest are chrome.

#### `src/components/MainPanel/ConversationRow.scss`

Unchanged. `.row-text.src` and `.row-text.tr` already consume `--subtitle-source-color` and `--subtitle-translation-color` via `var(...)` with sensible fallbacks. `.row-name`, `.row-role-dot`, `.lang-badge`, and `.row-avatar` keep their existing hard-coded colors — they are row chrome (timestamps, role dots, language badges, avatars) and are not part of the readable conversation content the user theming targets.

#### `src/stores/subtitleStore.ts`

Single change: `DEFAULTS.bgColor` from `'#000000'` to `'#1f1f1f'`. See [Compatibility](#compatibility).

#### i18n

Translation-key changes in `public/locales/*/translation.json` (English source first; other languages picked up via the existing fallback while translations land):

- Update existing keys:
  - `subtitle.settings.bgColor`: "Background color" → "Display background"
  - `subtitle.settings.sourceColor`: "Source text color" → "Source text"
  - `subtitle.settings.translationColor`: "Translation color" → "Translation text"
- Add new keys:
  - `subtitle.settings.appliesToBoth`: "Applies to the subtitle window and the conversation panel"
  - `subtitle.settings.customColor`: "Custom color" (used as the "+" chip's `aria-label` and `title`)

### Compatibility

The `bgColor` default change has three user populations to consider:

- **New users (no persisted `bgColor`)**: hydration falls through to the new default `#1f1f1f`. Subtitle window starts as `rgba(31,31,31, 0.8)` (deep grey at 80% opacity); MainPanel content area is `#1f1f1f`, identical to the current implicit dark. No regression.
- **Users who used subtitle mode but never changed `bgColor`**: their persisted `bgColor` is `#000000`. Subtitle window stays as it was (pure black at 80% opacity). MainPanel content area becomes `#000000` instead of the current `#1f1f1f` — a small visual regression that is one click to revert (open subtitle popover → pick `#1f1f1f` from the BG row, which is already a preset). The release note will mention this.
- **Users who changed `bgColor` to anything**: their choice is respected; subtitle window and MainPanel both use it.

We do not run a hydration migration that rewrites persisted `#000000` to `#1f1f1f`. Distinguishing "user explicitly chose pure black" from "user was on the old default of pure black" is impossible without a flag, and rewriting the second silently overrides the first. The small regression for the second population is the lesser evil.

The subtitle window's visual difference between pure-black-at-80%-opacity and dark-grey-at-80%-opacity is below typical perceptual threshold (about 5% lightness delta after compositing), so the new-user default does not look meaningfully different from the old default.

### Persistence and port mirror

No new persisted fields. No changes to `sessionPortMirror` (which mirrors session/conversation state from side panel to extension overlay; the overlay reads its own `subtitleStore` for color settings and is unaffected by this change).

## Testing

### Automated

- New `src/components/Subtitle/SubtitleSettingsPopover.test.tsx` (about 60 lines):
  - Clicking a preset chip calls the corresponding setter with the chip's hex.
  - Clicking the "+" chip dispatches a `click` on the underlying hidden `<input type="color">`.
  - Firing `change` events on the hidden input batches into a single setter call after the debounce window.
  - When the current store value is in the preset row, the matching preset chip has the `selected` class and the "+" chip does not.
  - When the current store value is not in the preset row, no preset chip is selected and the "+" chip is selected.
- Extend the existing `subtitleStore` test to assert the new default `bgColor === '#1f1f1f'` and that hydration of a persisted `'#000000'` is preserved (no migration).
- No new MainPanel test. Add one assertion to the existing MainPanel render test (or its closest analogue) confirming the wrapper element receives the three CSS custom properties matching the current store values.

### Manual

- In the Electron app: open the subtitle settings popover, click each preset chip, confirm both the floating subtitle window and the side-panel MainPanel update.
- Click the "+" chip on each of the three rows; confirm the OS color picker opens and that picking a color updates the corresponding surface (debounce: dragging inside the picker should not stutter or flood logs).
- Reproduce the four email examples (white background + black text, black background + white text, deep-blue background + white text; the "larger high-contrast" example confirms the colors part — font size is out of scope) and confirm both the subtitle window and the conversation panel render them correctly.
- In Electron with the floating subtitle window pinned always-on-top, open the OS color picker from the popover; confirm the picker appears above the always-on-top window and is interactive.
- In the browser extension, open the side-panel popover and the in-tab overlay's popover separately; confirm the OS color picker opens in both contexts (the overlay runs inside an iframe; verify there is no blocked-popup behavior).
- In `uiMode === 'basic'` and `uiMode === 'advanced'`, visually inspect MainPanel after a theme change: the conversation content area changes background; control footer and text input section keep their existing dark colors.
- Confirm no `.message-bubble.user` / `.assistant` / `.participant-source` rules survive in the built CSS (grep the build output) — sanity check for the SCSS cleanup.
- Fresh-install on a new profile: confirm the subtitle window opens at `#1f1f1f` and the MainPanel matches.
- Existing-install with persisted `bgColor === '#000000'`: confirm subtitle window opens at pure black and MainPanel content area is also pure black (the documented small regression). Pick `#1f1f1f` from the BG row and confirm it reverts.

## Out of Scope / Future Follow-ups

- **Saved named themes**: a future "+ Save current as theme" affordance can layer cleanly on top of this design without changing the underlying fields. Defer until at least one user reports cycling between configurations frequently.
- **Per-side colors**: would require additional fields (`participantSourceTextColor`, etc.) and a matching popover row. Out of scope until requested.
- **App-wide light chrome theme**: would require a full design-token pass across all chrome components. Out of scope until a second projector user reports chrome readability problems.
- **Hex / named color text input**: the OS color picker covers this need.
- **Larger font sizes**: tracked separately.
- **Migration that rewrites persisted `#000000` to `#1f1f1f`**: deliberately avoided to preserve users' explicit choice of pure black.
