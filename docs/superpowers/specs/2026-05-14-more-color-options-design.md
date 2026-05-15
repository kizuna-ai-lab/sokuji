# More Color Options for Subtitle and Conversation Panel — Design

**Date**: 2026-05-14
**Status**: Approved for implementation planning
**Tracking issue**: [#231](https://github.com/kizuna-ai-lab/sokuji/issues/231)
**Related**: [#230 conversation font-size cap](2026-05-14-conversation-font-size-cap-design.md) — touches the same `conversationFontSize` field this spec moves out of `settingsStore`.

## Context

Issue #231 ("add high-contrast subtitle themes") came from a classroom user (Ray Chow, Youth Night School English group) projecting Sokuji on a large screen under varying lighting. The original email asked for "more background and font color options" and listed four example combinations (white-on-black, black-on-white, dark-blue-on-light, larger high-contrast). The issue draft re-cast the request as a "theme presets" feature with a `presentation` preset that bundles colors with a larger font size.

Re-reading the email against the existing UI confirms a simpler diagnosis: the subtitle settings popover already exposes background, source-text, and translation-text color chips, but the source/translation chip palettes contain only light and warm colors. The user can configure three of the four example combinations today; the fourth (white background with dark text) is unreachable because no chip palette includes a dark color. Larger font is tracked separately in [#230](2026-05-14-conversation-font-size-cap-design.md) and is out of scope here.

This spec drops the "theme" abstraction. It adds the missing dark color chips, adds an "any color" picker as a final fallback, and brings color options to the conversation panel as well — but as **independent settings** from the subtitle window's, not a shared one. Subtitle mode and the conversation panel each get their own colors, their own popover entry point, their own store, and their own persistence keys. They do not influence each other.

The conversation panel currently has no display-settings store of its own; `conversationFontSize` and `conversationCompactMode` live in `settingsStore` mixed in with auth, provider keys, and UI mode. As part of this work, those two fields plus the new color fields are extracted into a dedicated `conversationDisplayStore`, mirroring the v0.26 extraction of `subtitleStore` from `settingsStore`. This keeps `settingsStore` focused on cross-cutting concerns and lets the conversation panel evolve display settings independently.

## Non-Goals

- Theme presets (named combinations of colors stored as a single setting).
- Saving named custom themes.
- Per-side colors (different bubble color per speaker / participant).
- Larger font sizes — tracked in [#230](2026-05-14-conversation-font-size-cap-design.md).
- An app-wide light theme for chrome (titlebar, sidebar, control footer, input section). Chrome and content are already physically separate surfaces; a dark chrome does not break a white content area, and no user has asked for it. Re-evaluate if a second projector user reports it.
- Removing or restyling the subtitle background opacity slider (still meaningful for the floating subtitle window; not applied to the conversation panel).
- A single "apply theme to both surfaces" toggle. The two surfaces are configured independently by design — see [Context](#context).
- Persistence migration for the existing `settings.common.conversationFontSize` and `settings.common.conversationCompactMode` keys. The new `conversationDisplayStore` uses a fresh key namespace; old persisted values are abandoned. See [Compatibility](#compatibility).
- Renaming `subtitleStore` or its persistence keys.

## User-Visible Behavior

### Two entry points, one popover component

The same color-and-display-settings popover is reachable from two places, each scoped to one surface's settings:

- **Subtitle bar's ⚙ button** (existing) — opens the popover bound to subtitle settings. Changes here update the floating subtitle window (Electron) and the in-tab overlay (extension); they do **not** touch the conversation panel.
- **Conversation toolbar's ⚙ button** (new, in `MainPanel`'s `conversation-toolbar`) — opens the same popover component bound to conversation-panel settings. Changes here update the side-panel `MainPanel` view; they do **not** touch the subtitle window.

The popover is the same component (`<DisplaySettingsPopover source="subtitle" | "conversation" />`); the `source` prop selects which store it reads from and writes to, and which controls it renders.

### Inside the popover

- **Background opacity slider** — present only when `source === 'subtitle'`. The conversation panel does not apply opacity.
- **Background color row** — three chips with current presets (`#000000`, `#1a1a1a`, `#0d2032`, `#0f2419`, `#FFFFFF`, `#2a2a2a`) plus a "+" custom-color chip.
- **Source text color row** — current presets (`#FFFFFF`, `#E8E8E8`, `#FFD27D`, `#FFAA66`, `#9aa0a6`, `#FF6B6B`) plus three new dark presets (`#000000`, `#003B6F` deep navy, `#1B5E20` deep forest), plus a "+" custom-color chip.
- **Translation text color row** — current presets (`#6CC5FF`, `#10a37f`, `#FFFFFF`, `#A8E6CF`, `#FFB86C`, `#BD93F9`) plus three new dark presets (`#000000`, `#003B6F`, `#7B1FA2` deep purple), plus a "+" custom-color chip.
- **Labels** — neutralised so they read correctly from either entry point:
  - "Background opacity" → unchanged.
  - "Background color" → "Display background".
  - "Source text color" → "Source text".
  - "Translation color" → "Translation text".
  - No more cross-surface caption ("Applies to..."): the two entry points are now scoped to their own surface, so a caption claiming both would be wrong.

### Highlight rules in the popover

- A preset chip is highlighted when its hex equals the current stored value for the active `source`.
- The "+" chip is highlighted when the current stored value is **not** in the preset row. The "+" chip's swatch background reflects the current stored value so the user always sees what color is active.

### "+" custom color chip behavior

- Clicking the "+" chip opens the operating system's native color picker (`<input type="color">`).
- Any hex the user picks is saved to the same setting as the preset chips (`bgColor` / `sourceTextColor` / `translationTextColor` on whichever store the popover is bound to).
- There is no new "custom theme" concept; the picked color is just a value for the same field a preset chip would set.

### In the conversation panel (MainPanel)

When the user changes any of the three color settings via the conversation-toolbar popover, the conversation panel updates immediately:

- **Conversation content area background** follows `conversationDisplayStore.bgColor`.
- **Original-language text** in conversation rows follows `conversationDisplayStore.sourceTextColor`.
- **Translated text** in conversation rows follows `conversationDisplayStore.translationTextColor`.
- **Currently-playing row** is indicated by a translucent overlay in the translation-text color (`color-mix(in srgb, var(--conversation-translation-color, #10a37f) 15%, transparent)`) on top of the row body, replacing the previous hardcoded translucent green. The overlay stays subtle and follows the user's chosen translation color so it remains visible (and consistent with the theme) against any background. An earlier draft of this spec called for a 1px translation-color ring around the row; that was reverted during review because, on a row that spans the full conversation-display width, the ring read as an oversized box around the row rather than a subtle now-playing hint.

The chrome (control footer, text input section, titlebar, sidebar) does **not** change color and stays on its existing dark tokens.

The conversation panel does not apply any opacity. It uses the chosen `bgColor` as a flat color.

### In subtitle mode

Subtitle window behavior is unchanged from today's implementation, except that the popover is now the renamed `<DisplaySettingsPopover source="subtitle" />` instead of `<SubtitleSettingsPopover />`. The user sees the same chips (now with the additional dark presets and a "+" picker), the same opacity slider, and the same labels (re-worded as above).

## Implementation

### File-level changes

#### New: `src/stores/conversationDisplayStore.ts`

Mirrors the structure of `src/stores/subtitleStore.ts`. Owns:

- `fontSize: number` — clamped `[12, 64]`, default `14`. Moved from `settingsStore.conversationFontSize`.
- `compactMode: boolean` — default `false`. Moved from `settingsStore.conversationCompactMode`.
- `bgColor: string` — hex, default `'#1f1f1f'` (matches today's implicit MainPanel dark).
- `sourceTextColor: string` — hex, default `'#9aa0a6'` (matches today's `ConversationRow.scss` fallback).
- `translationTextColor: string` — hex, default `'#e8e8e8'` (matches today's `ConversationRow.scss` fallback).

Async setters for each field, mirroring `subtitleStore`'s persist-and-rollback-on-error pattern. Persistence key namespace: `settings.common.conversationDisplay.*` (e.g., `settings.common.conversationDisplay.fontSize`, `settings.common.conversationDisplay.bgColor`).

Selector hooks: `useConversationDisplayFontSize`, `useConversationDisplayCompactMode`, `useConversationDisplayBgColor`, `useConversationDisplaySourceTextColor`, `useConversationDisplayTranslationTextColor`, `useConversationDisplaySettings` (shallow snapshot).

Action hooks: `useSetConversationDisplayFontSize`, `useSetConversationDisplayCompactMode`, `useSetConversationDisplayBgColor`, `useSetConversationDisplaySourceTextColor`, `useSetConversationDisplayTranslationTextColor`.

Constants: `CONVERSATION_FONT_SIZE_MIN = 12`, `CONVERSATION_FONT_SIZE_MAX = 64` exported from this store (moved from `settingsStore`).

`hydrate()` reads the new keys with defaults; **does not** read or migrate the old `settings.common.conversationFontSize` / `settings.common.conversationCompactMode` keys.

#### Modified: `src/stores/settingsStore.ts`

Remove:

- The `conversationFontSize: number` and `conversationCompactMode: boolean` fields from the state interface.
- Their entries in `defaultCommonSettings`.
- The `setConversationFontSize` / `setConversationCompactMode` action implementations.
- The `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX` constants (moved to the new store).
- The `clampConversationFontSize` helper (moved or inlined into the new store).
- The hydration reads for `settings.common.conversationFontSize` / `settings.common.conversationCompactMode`.
- Any selector or action hook re-exports for these fields.

#### Modified: `src/stores/settingsStore.test.ts`

Remove the `conversationFontSize clamping` describe block (lines 319+) and its imports of `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX`. The clamping behavior moves to the new `conversationDisplayStore.test.ts` below.

#### New: `src/stores/conversationDisplayStore.test.ts`

Mirrors the structure of `src/stores/subtitleStore.test.ts` (assumed to follow the same pattern as `settingsStore.test.ts`). Covers:

- Default values for all five fields.
- `setFontSize` clamps to `[CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX]` and persists the clamped value.
- Each color setter persists its value with the correct namespaced key.
- `hydrate()` reads from the new `settings.common.conversationDisplay.*` keys with correct defaults when missing.
- `hydrate()` ignores any persisted `settings.common.conversationFontSize` / `...conversationCompactMode` (the old keys) — sanity test that no migration happens.

#### Renamed and relocated: `src/components/Subtitle/SubtitleSettingsPopover.tsx` → `src/components/Display/DisplaySettingsPopover.tsx`

The new path lives in a new `src/components/Display/` directory (peer to `Subtitle/` and `MainPanel/`). The `.scss` companion is renamed and moved alongside.

The component gains a `source: 'subtitle' | 'conversation'` prop:

```tsx
interface Props {
  source: 'subtitle' | 'conversation';
}
```

To respect React's rules of hooks (no conditional hook calls based on `source`), the popover is structured as a thin presentational `<DisplaySettingsPopoverInner>` that takes already-resolved bindings as props, plus two thin source-specific wrappers that read from their respective stores:

```tsx
// DisplaySettingsPopover.tsx — entry point dispatched by source prop
export default function DisplaySettingsPopover({ source }: Props) {
  return source === 'subtitle'
    ? <SubtitleBoundPopover />
    : <ConversationBoundPopover />;
}

function SubtitleBoundPopover() {
  // Calls only subtitleStore hooks. Resolved bindings passed down.
  const bgColor = useSubtitleBgColor();
  // ... other subtitle hooks ...
  return <DisplaySettingsPopoverInner
    bindings={{ bgColor, /* ... */, includeOpacity: true }}
  />;
}

function ConversationBoundPopover() {
  // Calls only conversationDisplayStore hooks.
  const bgColor = useConversationDisplayBgColor();
  // ...
  return <DisplaySettingsPopoverInner
    bindings={{ bgColor, /* ... */, includeOpacity: false }}
  />;
}
```

Each wrapper subscribes only to its own store, so re-renders are scoped correctly. `<DisplaySettingsPopoverInner>` is the JSX that renders the rows and slider; it has no store dependencies.

The popover then renders:

- The "Background opacity" slider only when `bindings.includeOpacity === true`.
- The three color rows, each as a reusable `<ColorRow label preset value onChange />` subcomponent. Each row renders the existing chips, then one extra "+" custom-color chip.
- The "+" chip is a `<label>` containing a hidden `<input type="color">`. Clicking the chip triggers the OS color dialog. The chip's swatch background is the current `value` so it doubles as a "current color" indicator.
- The `onChange` of `<input type="color">` is debounced ~150ms before calling the corresponding setter (raw `onChange` fires continuously while the user drags inside the OS picker; without debounce this would flood the persistence layer).

Translation-key changes per [i18n](#i18n).

#### Modified: `src/components/Display/DisplaySettingsPopover.scss`

Migrated from the old SCSS (rename + path change), then:

- Add `.swatch.custom` style: same circular footprint as the other chips, hosts a hidden `<input type="color">` (`position: absolute; opacity: 0; pointer-events: none; width: 100%; height: 100%`), shows current color via inline `style={{ background: value }}`, and overlays a small `+` icon (e.g., a `::after` glyph or a Lucide `Plus` rendered at 10–12px).

#### Modified: `src/components/Subtitle/SubtitleBar.tsx`

Update the import path and component name for the popover:

- `import SubtitleSettingsPopover from './SubtitleSettingsPopover';` → `import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';`
- `<SubtitleSettingsPopover />` → `<DisplaySettingsPopover source="subtitle" />` (in the `FloatingPortal` block at line ~205).

#### Modified: `src/components/MainPanel/MainPanel.tsx`

Two distinct changes:

1. **Replace `useSettingsStore` reads with `useConversationDisplayStore` reads** for the two moved fields. Search-and-replace targets:
   - `useConversationFontSize()` → import from `conversationDisplayStore` instead of `settingsStore`.
   - `useConversationCompactMode()` → same.
   - `useSetConversationFontSize()` / `useSetConversationCompactMode()` → import from new store.
   - `CONVERSATION_FONT_SIZE_MIN` / `CONVERSATION_FONT_SIZE_MAX` import path changes.
2. **Add a ⚙ Settings button to `conversation-toolbar`** (the `<div className="conversation-toolbar">` block around line 2923). Place it after the existing compact-mode button. Wire it to a `useFloating` instance (mirroring `SubtitleBar`'s approach) and render `<DisplaySettingsPopover source="conversation" />` inside a `FloatingPortal` when open.
3. **Apply CSS custom properties on the wrapper** for the conversation panel's color theming. At the existing root `<div className="main-panel-wrapper">`, add an inline `style` setting three CSS custom properties from `useConversationDisplaySettings()`:

   ```tsx
   const conversationDisplay = useConversationDisplaySettings();
   // ...
   <div
     className="main-panel-wrapper"
     style={{
       '--conversation-bg-color': conversationDisplay.bgColor,
       '--conversation-source-color': conversationDisplay.sourceTextColor,
       '--conversation-translation-color': conversationDisplay.translationTextColor,
     } as React.CSSProperties}
   >
   ```

#### Modified: `src/components/MainPanel/MainPanel.scss`

Two functional edits and one cleanup:

1. `.conversation-display` gets `background: var(--conversation-bg-color, #1f1f1f);` — the conversation content area becomes themable from `conversationDisplayStore`.
2. `.conversation-list .row-body.playing` (currently `background: rgba(16, 163, 127, 0.1)`) keeps the translucent-overlay shape but derives its color from the active translation color via `color-mix`: `background: color-mix(in srgb, var(--conversation-translation-color, #10a37f) 15%, transparent); border-radius: 4px;`. The transition stays on `background-color`. Earlier drafts proposed a `box-shadow` ring; see the User-Visible Behavior section for why the overlay shape was kept.
3. **Cleanup**: remove the `.message-bubble.user`, `.message-bubble.assistant`, `.message-bubble.user.playing`, `.message-bubble.assistant.playing`, `.message-bubble.participant-source.user`, `.message-bubble.participant-source.assistant` (and their `.playing` nested rules) blocks, plus the `.message-bubble.assistant .karaoke-played` override. These selectors are no longer rendered: `MainPanel.tsx` only emits `message-bubble error` and `message-bubble system` for the bubble class today; conversation rows go through `<ConversationRow>`. Removing them prevents future readers from inferring user/assistant visual differentiation that no longer exists.

`.message-bubble.error`, `.message-bubble.system`, `.text-input-section`, `.control-footer`, and `.conversation-toolbar` are unchanged: error and system are status-semantic colors; the rest are chrome.

#### Modified: `src/components/MainPanel/ConversationRow.scss`

The two existing `var(--subtitle-source-color, ...)` / `var(--subtitle-translation-color, ...)` references in `.row-text.src` (line 114) and `.row-text.tr` (line 119) are renamed to `var(--conversation-source-color, ...)` / `var(--conversation-translation-color, ...)`. `ConversationRow` is only rendered inside `MainPanel`, so this change has no other consumer to break.

`.row-name`, `.row-role-dot`, `.lang-badge`, and `.row-avatar` keep their existing hard-coded colors — they are row chrome (timestamps, role dots, language badges, avatars) and are not part of the readable conversation content the user theming targets.

#### Unchanged: subtitle surface

`SubtitleApp.tsx`, `SubtitleStream.tsx`, `SubtitleApp.scss`, and `SubtitleStream.scss` all keep their existing `--subtitle-bg-color` / `--subtitle-source-color` / `--subtitle-translation-color` CSS variable names and their existing `setProperty` calls reading from `subtitleStore`. The `subtitleStore` itself is unchanged: same fields, same defaults (including `bgColor: '#000000'`), same persistence keys.

#### i18n

Translation-key changes in `public/locales/*/translation.json` (English source first; other languages picked up via the existing fallback while translations land):

- Update existing keys (label string changes; key names stay the same):
  - `subtitle.settings.bgColor`: "Background color" → "Display background"
  - `subtitle.settings.sourceColor`: "Source text color" → "Source text"
  - `subtitle.settings.translationColor`: "Translation color" → "Translation text"
- Add new key:
  - `subtitle.settings.customColor`: "Custom color" (used as the "+" chip's `aria-label` and `title`)

The `subtitle.settings.*` namespace is reused (not renamed to `display.settings.*`) to keep the diff small. The labels are display-neutral despite the namespace name; renaming the namespace would force every `t()` call site to update for no functional benefit.

### Compatibility

This change has three compatibility considerations:

1. **`conversationFontSize` and `conversationCompactMode` persistence is reset.** Users who previously customised conversation font size (range was 12–28 pre-#230, then 12–64 after #230) or toggled compact mode will see those settings revert to defaults (`14px`, `false`) on first launch after this change. The old `settings.common.conversationFontSize` / `...conversationCompactMode` keys remain in storage but are abandoned (orphaned). Users can re-set their preferences from the conversation toolbar; they persist normally afterward to the new keys. This is an explicit decision: the migration code would be simple but adds maintenance debt for an audience that can re-tap a font-size button once.
2. **No migration cleanup.** We do not write code to delete the orphaned old keys. They are tiny, only-on-disk, and will be ignored by all current code paths. A future cleanup could remove them with no functional impact.
3. **Subtitle window behavior is fully unchanged.** No defaults change, no keys move, no fields are removed from `subtitleStore`. Existing subtitle users see no difference except the popover now has more chips on the source/translation rows and a "+" custom-color chip; their previously-saved colors continue to apply.

### Persistence and port mirror

No new persisted fields beyond the new namespace. No changes to `sessionPortMirror` (which mirrors session/conversation state from side panel to extension overlay; the overlay reads its own `subtitleStore` for color settings and is unaffected by this change — it does not read `conversationDisplayStore`, since the overlay does not render `MainPanel`).

The new `conversationDisplayStore` is hydrated at app boot from the same `SettingsService` infrastructure as the existing stores. Wire its `hydrate()` into the same boot path as `subtitleStore.hydrate()` (search `subtitleStore.*hydrate` for the existing call site).

## Testing

### Automated

- **New `src/stores/conversationDisplayStore.test.ts`** — described in [the new store section](#new-srcstoresconversationdisplaystorets) above.
- **Modified `src/stores/settingsStore.test.ts`** — described in [the modified settings store section](#modified-srcstoressettingsstoretestts) above. Confirm the rest of the suite still passes.
- **New `src/components/Display/DisplaySettingsPopover.test.tsx`** (about 80 lines, rewritten from the old `SubtitleSettingsPopover.test.tsx` if it exists; today there is no test file at that path, so this is net-new):
  - With `source="subtitle"`: clicking a preset chip calls the corresponding `subtitleStore` setter; opacity slider is rendered.
  - With `source="conversation"`: clicking a preset chip calls the corresponding `conversationDisplayStore` setter; opacity slider is **not** rendered.
  - With either source: clicking the "+" chip dispatches a `click` on the underlying hidden `<input type="color">`.
  - Firing `change` events on the hidden input batches into a single setter call after the debounce window (test the debounce by advancing fake timers).
  - When the current store value is in the preset row, the matching preset chip has the `selected` class and the "+" chip does not.
  - When the current store value is not in the preset row, no preset chip is selected and the "+" chip is selected.
- **New MainPanel test assertion** — extend the existing MainPanel render test to confirm the wrapper element receives the three `--conversation-*` CSS custom properties matching the current `conversationDisplayStore` values.
- **Search-and-replace audit** — grep for old field names and CSS variable references that should no longer exist:
  - `useConversationFontSize` / `useConversationCompactMode` imported from `settingsStore` (should be from `conversationDisplayStore`).
  - `--subtitle-source-color` / `--subtitle-translation-color` references in `MainPanel.scss` or `ConversationRow.scss` (should be `--conversation-*` in those files; the `--subtitle-*` names live only under `Subtitle/`).

### Manual

- In the Electron app: open the **subtitle** ⚙ popover, click a preset chip, confirm the floating subtitle window updates and the side-panel MainPanel **does not change**.
- Open the **conversation toolbar** ⚙ popover, click a preset chip, confirm the side-panel MainPanel updates and the floating subtitle window **does not change**.
- Click the "+" chip in each popover, on each of the three color rows; confirm the OS color picker opens and that picking a color updates only the corresponding surface (debounce: dragging inside the picker should not stutter or flood logs).
- Reproduce the four email examples in the conversation toolbar popover (white background + black text, black background + white text, deep-blue background + white text; the "larger high-contrast" example confirms the colors part — font size is in #230). Confirm the conversation panel renders them correctly. Repeat in the subtitle popover for the subtitle window.
- In Electron with the floating subtitle window pinned always-on-top, open the OS color picker from the subtitle popover; confirm the picker appears above the always-on-top window and is interactive.
- In the browser extension, open the side-panel **conversation toolbar** popover and the in-tab subtitle overlay's popover separately; confirm the OS color picker opens in both contexts (the overlay runs inside an iframe; verify there is no blocked-popup behavior).
- In `uiMode === 'basic'` and `uiMode === 'advanced'`, visually inspect MainPanel after changing colors via the conversation toolbar: the conversation content area changes background; control footer and text input section keep their existing dark colors.
- Confirm no `.message-bubble.user` / `.assistant` / `.participant-source` rules survive in the built CSS (grep the build output) — sanity check for the SCSS cleanup.
- Fresh-install on a new profile: confirm the conversation panel renders at `#1f1f1f` (matches today's implicit dark) and the subtitle window opens at pure black at 80% opacity (unchanged from today). Confirm font-size and compact-mode start at default `14px` / `false`.
- Existing-install with previously-customised `conversationFontSize` (e.g., 22): confirm font size resets to `14` on first launch (the documented persistence reset). Adjust via the toolbar buttons; confirm the new value persists across a restart.
- Existing-install that had customised subtitle colors: confirm those still apply to the subtitle window.

## Out of Scope / Future Follow-ups

- **Saved named themes** for either surface: a future "+ Save current as theme" affordance can layer on top of either store without changing the underlying fields. Defer until at least one user reports cycling between configurations frequently.
- **Per-side colors** (different speaker / participant colors): would require additional fields on `conversationDisplayStore` and a matching popover row. Out of scope until requested.
- **App-wide light chrome theme**: would require a full design-token pass across all chrome components. Out of scope until a second projector user reports chrome readability problems.
- **Hex / named color text input**: the OS color picker covers this need.
- **Larger font sizes**: tracked in [#230](2026-05-14-conversation-font-size-cap-design.md).
- **Cleanup of orphaned `settings.common.conversationFontSize` / `...conversationCompactMode` keys in storage**: harmless to leave; can be added later if the SettingsService grows a `removeSetting` helper.
- **A "copy from subtitle" / "copy from conversation" button** in either popover that snapshots the other surface's settings into the current one: a possible UX shortcut once we see how often users want to keep them in sync.
- **Renaming the `subtitle.settings.*` i18n key namespace** to something display-neutral like `display.settings.*`: deferred — the labels are already display-neutral; the namespace name is internal.
