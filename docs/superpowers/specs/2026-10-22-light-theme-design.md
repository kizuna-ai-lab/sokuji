# Light theme and the Appearance setting

Status: implemented on branch `worktree-light-theme-design` (2026-10-22; plan `docs/superpowers/plans/2026-10-22-light-theme.md`), awaiting the owner's live test. Rulings R1 to R7 below.
Rendered candidates: https://claude.ai/artifact/KBcQpzX5Xy9teefPcwCNDH (real compiled stylesheets on the components' real DOM; the harness that built it is described in §10 and was not kept).

## Goal

A light theme beside today's dark one, and an Appearance setting with three choices: Follow system, Light, Dark. Every chrome colour in the app becomes a token that each scheme sets, so no surface carries a literal that reads in one theme only. The two user-coloured surfaces, the conversation area and the subtitle view, keep the user's own colours and take their palette from their own background, not from the app theme.

## Rulings (the owner, 2026-10-22)

| # | Question | Ruling |
|---|---|---|
| R1 | Default | `dark`. A default, not a migration: a user who never picks keeps today's look. No branch on install state, no one-time conversion of anything stored. |
| R2 | Light accent | `#007255` (the website's light accent; 5.94:1 on white), hover `#005a43`. The bright `#0fbb8f` stays the dark accent. `#008261` (the viewer's) was rejected on the render. |
| R3 | The conversation view's colours | Amended 2026-10-22 after the owner saw the light app with a dark conversation in it: a colour the user never set follows the scheme (`null` in `conversationDisplayStore`, resolved by `resolveConversationColours`): under dark, today's set (`#1f1f1f` background, `#9aa0a6` source, `#e8e8e8` translation), so dark users see no change; under light, `#ffffff`, `#5f6368`, `#1a1a1a`. An unset text colour follows the tone of the background drawn rather than the scheme, so a stored dark background keeps light text in the light app and a stored white one gets dark text in the dark app (from the PR review). A colour the user set stays in both schemes. The display popover's first chip in each conversation row is "Follow theme", split diagonally between the row's dark and light colours so it never reads as a twin of a preset beside it, selected while nothing is stored, and picking it clears a stored colour; a stored colour that happens to equal a scheme's is a custom colour. Every row of both surfaces offers the same ten chips (the owner's ask, 2026-10-22: the rows line up): the fixed default or the follow chip, eight presets per surface and row (`PRESETS` in `DisplaySettingsPopover.tsx`; the subtitle's lists leave out its own defaults), and the custom chip. No migration: a stored colour is kept, an absent one follows. The first ruling, "today's dark defaults stay in both themes", stands only for the subtitle view, whose defaults are fixed (an overlay on other windows, not the app's surface). |
| R4 | The other side's colour in light | Amber, darkened: `#b45309` (person shades `#d97706`, `#92400e`). The dark value `#f39c12` is unchanged. Orange `#c2410c` and the viewer's blue-violet `#5a55d6` were rejected on the render. |
| R5 | Extension popup | Out of scope this round. Its own light stylesheet (slate greys, indigo buttons) stays as it is. |
| R6 | How the colour questions were settled | By rendering, not by argument: three boards of real components, dark beside two light candidates, with the contrast ratios beside them. |
| R7 | May the dark theme move at all this round | The collapse lands and nothing else moves in dark. A few dark literals move by one shade (`#ff4444`, `#ff6b6b`, `#ff4c4c` → `#e74c3c`; `#f1c40f`, `#ffaa00` → `#ffc107`; `#e6a23c` → `#f59e0b`; `#0d8c6d`, `#0c8c6a`, `#0d8a6a` → `#0da77f`, hover only); the contrast floors of §7 bind the light scheme only, and the dark block is pinned to today's values by test. Rejected on board 4 of the artifact: dark byte for byte (the variants would keep their own tokens), and dark meeting the floors too (a darker Stop button and balance banner, `#888` → `#9b9b9b`, `#666` → `#7d7d7d`, and `error` and `usage` each split into a text and a fill token). |

## Today (origin/main at 5d0d6ce4a)

Numbers are from a scan of `src/**/*.scss` and `src/**/*.css`:

| | |
|---|---|
| Stylesheets | 66 |
| Hex literals | 549 |
| `rgba(...)` literals | 274 |
| Distinct hex values | 112 |
| Stylesheets importing a token file | 47 of 66 |
| `rgba($variable, alpha)` Sass computations | 67 |
| `rgba(255, 255, 255, a)` overlays | 98 |
| `rgba(0, 0, 0, a)` overlays | 42 |

- **Two authoring layers, both compile-time.** `src/styles/_tokens.scss` holds the semantic colours (brand, speaker and participant with their person shades, the amber family, success, the toolbar icon). `src/components/Settings/shared/_variables.scss` holds the surfaces (`$text-*`, `$bg-*`, `$border-*`), the non-colour tokens (type, spacing, radii) and the mixins (`control-base`, `segmented-option`, `option-row*`, `status-box`, `state-selected-*`). Sass variables compile to literals, so nothing can switch at run time. The 19 stylesheets that import neither: `App.scss`, `index.scss`, `styles/scrollbar.scss`, `styles/karaoke.scss`, `ConnectionStatus.scss`, `Tooltip.scss`, `MainLayout.scss`, `SessionCountdown.scss`, `Modal.scss`, `Auth/SignInPage.scss`, `dev/SpinePreview.scss`, and the shared `PanelBar`, `TabBar`, `Button`, `ToggleSwitch`, `FormInput`, `StatusMessage`, `_download-status`.
- **Prior art in the repo.** The LAN viewer (`src/viewer/viewer.scss`) has `--v-*` tokens in three schemes (dark, light, contrast), switched by a class on its root; its light accent is `#008261`, its light participant blue-violet `#5a55d6` (the owner's 2026-10-04 ruling for that page: on a phone the amber read like the green at a glance). The website (sokuji-backend `web/src/lib/theme.tsx`, `global.scss`) has light / dark / system: `data-theme` on `<html>`, a `matchMedia('(prefers-color-scheme: dark)')` listener, `localStorage['sokuji-theme']`, and a `[data-theme="light"]` token block whose accent is already `#007255`.
- **The window.** Electron creates the main window with `frame: false`, `transparent: true`, `backgroundColor: '#00000000'`; `App.scss` keeps `html, body, #root, .App` transparent and `MainLayout.scss` paints `#1e1e1e` opaque. The title bar is React (`TitleBar.tsx`, `#1a1a1a`). `nativeTheme` is not used. Subtitle mode is the same window and document, resized (`electron/subtitle-window.js`). Popovers are either `FloatingPortal` in the same document or `ChildWindowPopover`, a `window.open` child whose document receives the app's stylesheets through `syncStyles`.
- **Half-starts.** `ModePicker.scss` and `Settings.scss` read `var(--border-color, #444)`, `var(--text-secondary, #aaa)`, `var(--bg-secondary, #333)`, `var(--bg-hover, #3a3a3a)` in 8 places; none of those variables is defined anywhere, so the fallbacks are what renders. `ModelImportModal.scss` defines `--import-accent` and `--import-danger` from the Sass tokens.
- **One literal, two meanings.** `tk.$color-participant` and `tk.$color-degraded` are distinct in Sass and both `#f39c12` in the compiled CSS.
- **Colours in TypeScript.** `panel/Waveforms.tsx` passes `#0099ff`, `#f59e0b` and `#ff9900` to `WaveformStrip`, which draws them on canvas through `utils/wav_renderer.ts`. `Icons/ProviderIcons.tsx` holds brand marks (and a white plate behind marks drawn in `currentColor`). `Display/DisplaySettingsPopover.tsx` holds the user colour presets. `conversationDisplayStore` and `subtitleStore` hold the user colour defaults. `dev/*` previews hold sample colours.
- **No `color-scheme`** is set on the app's root, so native `<select>` popups and scrollbars take the OS's choice. `index.html` carries `<meta name="theme-color" content="#000000">`.
- **Settings.** Common settings live under `settings.common.*` and are written through `persistSetting`; `uiMode` is the pattern to copy (`settingsStore.ts`: the field, the setter, `useUIMode` / `useSetUIMode`, the load with the other common keys). `HelpSection.tsx` holds the interface-language picker and tracks `language_changed`; the event map is in `src/lib/analytics.ts`. `HelpSection` is rendered by both layouts (`SimpleSettings.tsx`, `AdvancedSettings.tsx`).
- **Floors.** The extension declares `minimum_chrome_version: 116`: `color-mix()` (Chrome 111) is available and `ConversationRow.scss` already uses it; `light-dark()` (Chrome 123) is not. Electron is 44.

## Design

### 1. Mechanism: custom properties on the root, one attribute to switch

- `src/styles/theme.scss` defines every colour token twice: the dark values on `:root` (with `color-scheme: dark`) and the light values on `:root[data-theme="light"]` (with `color-scheme: light`). It is the first stylesheet the app loads (`index.scss` imports it before anything else). A token exists in both blocks or in neither; §7 tests that.
- `src/lib/theme/` resolves the setting to a scheme and applies it. `resolve(setting, systemPrefersDark)` returns `'light' | 'dark'`; `apply(document, scheme)` sets `data-theme` on `document.documentElement` and on every child document registered with it (see §5). While the setting is `system`, a `matchMedia('(prefers-color-scheme: dark)')` listener re-applies on change. The module subscribes to the settings store's `theme` field (`subscribeWithSelector`) and is installed in `shared/index.tsx` before the first render. The website's `theme.tsx` is the model; the state source is the Zustand store, not a React context.
- **First paint.** Settings arrive over async IPC in Electron and from `chrome.storage` in the extension, so the module mirrors the *resolved* scheme into `localStorage['sokuji.theme']` on every apply, and a boot script at the top of `index.html` and `extension/fullpage.html` reads that key (in a try/catch) and sets `data-theme` before the stylesheets apply. It is one small classic script file, not inline: the extension's MV3 page CSP is `script-src 'self'`, which blocks inline scripts, so the file is copied like the extension's other static scripts and both pages reference it with a `<script src>`. The stored setting stays authoritative: once the store has loaded (`settingsLoaded`), `apply` corrects the attribute if the mirror was stale. Why this matters here: the window is transparent and `MainLayout` paints the page opaque, so one dark frame before a light user's settings load is a visible flash.
- **Electron.** The renderer sends the resolved scheme over IPC and the main process sets `nativeTheme.themeSource` to match (`'light' | 'dark'`, or `'system'` while following), so native dialogs and the Linux caption context menu agree with the window. *(My call; small, lives with the module.)*
- Nothing animates on a switch; a theme change repaints.
- Not `light-dark()` (floor), not two compiled stylesheets (doubles the CSS and leaves the TypeScript colours behind), not `prefers-color-scheme` media queries in component CSS (the attribute is the one switch; the media query only feeds the resolver).

### 2. Tokens: two tiers, one spelling in components

**Names.** `--sk-<role>`, defined only in `theme.scss`. The prefix keeps them apart from the viewer's `--v-*`, the user-colour variables (`--conversation-*`, `--subtitle-*`) and component-local ones (`--import-*`, `--ear-colour`).

**Components keep the Sass aliases.** `_tokens.scss` and `_variables.scss` stay the authoring surface, but each colour variable becomes an alias: `$text-primary: var(--sk-text-primary);`, `$color-primary: var(--sk-primary);` and so on. The 47 stylesheets that already import them need no edit for the switch. Stylesheets that import neither start importing `vars` or `tk`. `var(--sk-…)` is written directly only in `theme.scss`, the two alias files, the `[data-tone]` blocks (§3) and TypeScript (§5). One spelling per thing: the ledger (§7) counts literals, and a reviewer grepping `vars.$` finds every use.

**What an alias cannot do.** Sass cannot compute `rgba($var, 0.08)` once `$var` is a `var()`. The 69 such sites, and the `$color-*-bg` / `$color-*-border` tokens and the `option-row` mixins in `_variables.scss`, become `color-mix(in srgb, var(--sk-x) 8%, transparent)`, the form `ConversationRow.scss` already uses. No token per alpha step.

**The roster.** Dark values are today's literals; light values are the website's light greys (its `[data-theme="light"]` block: panel `#f7f7f8`, controls white on a `#d9d9d9` line, text `#1a1a1a` / `#555`), the accent and participant the owner picked, and darkened status hues that clear the floors in §7. Where the render showed two literals doing one job (six reds, five yellows), they collapse into one token.

Surfaces:

| Token | Dark | Light | Today's uses |
|---|---|---|---|
| `bg-base` | `#1a1a1a` | `#f3f3f3` | title bar, `$bg-page` |
| `bg-page` | `#1e1e1e` | `#ffffff` | main layout, conversation toolbar, text input |
| `bg-surface` | `#252525` | `#f7f7f8` | settings panel, footer bars, cards, `$bg-surface` |
| `bg-bar` | `#2a2a2a` | `#f3f3f3` | the control footer |
| `bg-popover` | `#2a2a2a` | `#ffffff` | tooltip, modal, floating popovers (with `shadow`) |
| `bg-control` | `#333333` | `#ffffff` | inputs, selects, segmented options at rest (light draws the `line` border) |
| `bg-hover` | `#3a3a3a` | `#ececec` | hover and expanded states |
| `bg-elevated` | `#444444` | `#e3e3e3` | raised chips, the slider track, disabled fills |
| `bg-elevated-hover` | `#555555` | `#d4d4d4` | hover of the above, the switch's off track |
| `bg-dim` | `#666666` | `#c4c4c4` | the idle status dot, disabled button labels' fill |
| `white` | `#ffffff` | `#ffffff` | the switch thumb, the logo plate (fixed in both) |

Text (eight roles; the grey tail folds into the nearest by luminance, see §6):

| Token | Dark | Light |
|---|---|---|
| `text-primary` | `#ffffff` | `#1a1a1a` |
| `text-secondary` | `#cccccc` | `#555555` |
| `text-tertiary` | `#aaaaaa` | `#666666` |
| `text-muted` | `#888888` | `#6b6b6b` |
| `text-dim` | `#666666` | `#8c8c8c` |
| `text-disabled` | `#555555` | `#a8a8a8` |
| `text-source` | `#9aa0a6` | `#5f6368` |
| `on-accent` | `#ffffff` | `#ffffff` |

Lines: `line` `#444444` → `#d9d9d9`; `line-subtle` `#333333` → `#e5e5e5`; `line-strong` `#555555` → `#c8c8c8`.

Overlays, the trap the render was built to catch: a white tint lightens a dark surface and must darken a light one.

| Token | Dark | Light | Use |
|---|---|---|---|
| `overlay-fg` | `#ffffff` | `#000000` | every `rgba(255,255,255,a)` hover, pressed and tint becomes `color-mix(in srgb, var(--sk-overlay-fg) a%, transparent)` |
| `overlay-bg` | `#000000` | `#000000` | a darkening tint (`rgba(0,0,0,a)` as a background, a tool-call block): black in both schemes, through the same `color-mix` |
| `scrim` | `rgba(0,0,0,.6)` | `rgba(0,0,0,.6)` | modal and tour backdrops |
| `shadow` | `rgba(0,0,0,.3)` | `rgba(0,0,0,.15)` | tooltip, modal, popover shadows |
| `shadow-strong` | `rgba(0,0,0,.5)` | `rgba(0,0,0,.2)` | the tour card |

Accent, people, status:

| Token | Dark | Light |
|---|---|---|
| `primary` | `#0fbb8f` | `#006d51`: the accent as text and icons, so the owner's `#007255` (R2) stays the fill, `primary-fill` (darkened 2026-10-22 from the rendered comparison, so text on its own 10–15% tint clears 4.5:1; was `#007255`) |
| `primary-hover` | `#0da77f` | `#005a43` |
| `primary-fill` | `#008261` | `#007255` |
| `primary-fill-hover` | `#006e52` | `#005a43` |
| `speaker` / `speaker-fill` | = `primary` / `primary-fill` | = `primary` / `primary-fill` |
| `speaker-person-3` | `#005c45` | `#004d38` |
| `participant` | `#f39c12` | `#b45309` |
| `participant-person-2` | `#f8c471` | `#d97706` |
| `participant-person-3` | `#ca6f1e` | `#92400e` |
| `success` | `#10a37f` | `#0d6d52` (darkened 2026-10-22 from the rendered comparison, so text on its own 10–15% tint clears 4.5:1; was `#0e7a5c`) |
| `error` | `#e74c3c` (also `#ff4444`, `#ff6b6b`, `#ff4c4c`) | `#ad3327` (darkened 2026-10-22 from the rendered comparison, so text on its own 10–15% tint clears 4.5:1; was `#c0392b`) |
| `error-deep` | `#c0392b` | `#8e2a20` (was `#a93226`; stays darker than `error`) |
| `warning` | `#ffc107` (also `#f1c40f`, `#ffaa00`) | `#845600` (was `#9a6700`; darkened 2026-10-22 so text on its own 10–15% tint clears 4.5:1, the owner's call after the OpenCodeReview pass) |
| `recommended` | `#f59e0b` (also `#e6a23c`) | `#9a4508` (was `#b45309`, the participant's value; darkened 2026-10-22 for the same reason as `warning`) |
| `degraded` | `#f39c12` | `#b45309` |
| `usage` / `usage-hover` / `usage-deep` | `#e67e22` / `#f39c12` / `#d35400` | `#aa390b` / `#93330a` / `#7a2a0b` (darkened 2026-10-22 from the rendered comparison, so text on its own 10–15% tint clears 4.5:1; was `#c2410c / #b45309 / #9a3412`); hover and pressed stay darker than the base) |
| `info` | `#4285f4` | `#175dbe` (darkened 2026-10-22 from the rendered comparison, so text on its own 10–15% tint clears 4.5:1; was `#1967d2`) |
| `toolbar-icon` | `#8a8a8a` | `#6e6e6e` |
| `waveform-speaker` / `waveform-participant` / `waveform-output` | `#0099ff` / `#f59e0b` / `#ff9900` | `#1a73e8` / `#b45309` / `#b45309` |

The old `#0d8c6d`, `#0c8c6a`, `#0d8a6a` hover greens are `primary-hover`. Three literals that look like variants are not: `#ff0000` and `#ffff00` are stops of the `ColorPicker` hue gradient, and `#ffeb3b` is the viewer's contrast scheme; all three are on the allow-list. `participant` and `degraded` share one value in light as they do in dark today; they stay separate tokens so that either can move later, which is all the separation in `_tokens.scss` ever promised. The three dark-theme hexes the website also carries (`#1e1e1e`, `#252525`, `#333`) are the same values by coincidence, not by reference; the website is out of scope.

### 3. User-coloured surfaces follow their own background

The conversation display and the Electron subtitle view are painted in colours the user chose (`conversationDisplayStore`, `subtitleStore`). By R3 as amended, a conversation colour the user never set follows the scheme (today's dark set under dark, a white set under light), and one the user set stays in both schemes; the subtitle's defaults are fixed. Either way the surface can be the opposite of the app: if its tokens followed the app theme, the light accent (`#007255`) would land on a user's `#1f1f1f`, which the render showed unreadable; and today a white conversation background in the dark app shows `#f39c12` on white at 2.19:1.

So a user-coloured surface carries `data-tone="dark" | "light"`, computed from its own background colour, and `theme.scss` re-declares the full token set under `[data-tone="dark"]` and `[data-tone="light"]` (the same two Sass maps the root blocks are generated from, emitted a second time; custom properties set on the surface element win for everything inside it, whatever the root says). Inside a dark conversation in a light app, the speaker is `#0fbb8f` and the other side `#f39c12` again; inside a white conversation in the dark app, the light palette applies and the other side is `#b45309`.

- `toneOf(hex)` lives beside the colour code in `src/lib/view/` and returns `dark` when white contrasts better with the colour than black does (WCAG relative luminance below 0.179). A value the picker cannot produce (not a hex) is `dark`. It is the one rule for "is this user colour light or dark": `useSubtitleChrome`'s highlight overlay, which today decides the same question by YIQ brightness under 128, switches to it (the two disagree only on saturated colours such as pure red, where the contrast rule is the one that picks the legible text).
- `ConversationList` takes the tone as a prop and sets the attribute on `.conversation-display`; it does not read a store for it, because `SubtitleBands` mounts the same list painted in the subtitle store's colours. `MainPanel` passes `toneOf(display.bgColor)`; the subtitle view passes `toneOf(subtitle.bgColor)` and sets the same attribute on its own root (bands and bar chrome alike), so the bar stays dark on its black default and goes light only when the user chose a light subtitle background. *(The subtitle view's tone rule is my call: it floats over other applications, and its own background is the only surface it has.)*
- The toolbar above the conversation and the status line below it are outside the surface and follow the app theme.

### 4. The setting and its control

- `settings.common.theme`: `'system' | 'light' | 'dark'`, default `'dark'` (R1). In `settingsStore`: the field, `setTheme`, `useTheme` / `useSetTheme`, loaded with the other common keys, written through `persistSetting`, a stored value outside the three falls to the default on load.
- The control sits in `HelpSection`, in the row of help links, directly after the interface language: the Help block is where the owner put the facts about the application itself (interface language, version, updates), and appearance is one, so it takes the shape the interface language has (the owner's call, 2026-10-22, after a first cut as the labelled segmented control under the heading). That shape is a help link carrying a native `<select>` (`label.help-link.help-link--picker` with a lucide icon, `SunMoon`, at 13px, and `select.help-link__select`), wrapped in the help `Tooltip` that is suppressed while the select has focus: the icon carries the meaning, the chosen option is the whole label (an "Appearance: Dark" entry would be the row's only "label: value"), and the select joins Settings' shared base-select layer, which draws the app's own popup and sizes the control to its chosen option. The select's accessible name is "Appearance"; its options are "System", "Light", "Dark", in that order ("System" rather than "Follow system": at the panel's 300px minimum the longer label wrapped a segmented option onto two lines, and its translations are longer still; the tooltip carries the meaning). The tooltip says how the app looks and that System follows the operating system's light or dark setting, naming the option as it is labelled. Unlike the interface language beside it, it is not locked during a session: it changes nothing the session depends on.
- Strings: `settings.appearance`, `settings.appearanceTooltip`, `settings.appearanceMode.system`, `settings.appearanceMode.light`, `settings.appearanceMode.dark` (nested like `settings.noiseSuppressionMode.*`), in all 30 catalogs.
- Analytics: `theme_changed { from: Theme; to: Theme }` in the event map, tracked from the control like `language_changed`.

### 5. Surfaces, documents and the colours that are not CSS

- **Child windows.** `ChildWindowPopover` copies stylesheets into its `window.open` document; it must also mirror the root's `data-theme` onto that document's root when it opens, and register the document with the theme module so a change while it is open reaches it. `FloatingPortal` popovers live in the main document and need nothing.
- **Extension.** The side panel is this app (`fullpage.html`), on the same setting through `chrome.storage`; `fullpage.html` gets the same inline first-paint script as `index.html`. The popup is out (R5). `subtitle-overlay.html` is untouched: it pins `color-scheme: dark` so its transparent canvas never flashes white, and it draws the user's colours.
- **Viewer.** `viewer.html` loads `viewer.scss` and `present.scss`, never `index.scss`, and `viewer.scss` builds `--v-accent`, `--v-accent-fill`, `--v-on-accent` and `--v-speaker` from `tk.$color-primary` and friends; it also mounts the app's `Button` and `ToggleSwitch`. So the aliases of slice 2 would leave `var(--sk-…)` undefined on that document and the viewer's accent invalid on every phone. The repair: `viewer.scss` and `present.scss` import `theme.scss` first, and the viewer's picker sets `data-theme="light"` on the document root for its light scheme and removes it for dark and contrast. Every `--sk-*` is then defined there, the dark values are today's literals (so dark and contrast look as they do now, and contrast keeps its `--v-*` overrides on top), and the light scheme's accent becomes `#007255` / `#005a43` through the alias with no edit (R2). The viewer keeps its own picker and its `--v-*` names (a phone chooses per device, and it has a contrast scheme the app does not); its light participant stays blue-violet under its own ruling. *(My call; the builder check found the breakage.)*
- **Every document loads the theme first.** The rule behind the viewer repair: any HTML entry whose stylesheets reference a `--sk-*` name loads `theme.scss` before them (`index.html` and `fullpage.html` through `index.scss`; `viewer.html` through the two viewer stylesheets; the extension's `subtitle-overlay.html` only if its bundle comes to import an app stylesheet, which today it does not). §7 checks this per document.
- **Website.** Already `#007255`; nothing to do.
- **Waveforms.** `Waveforms.tsx` stops carrying hex: `WaveformStrip` takes a token name, and `WaveformStrip` (or the renderer) reads `getComputedStyle(document.documentElement).getPropertyValue('--sk-waveform-…')` when it starts drawing and again on a theme change (the theme module exposes a subscribe, or the strip re-reads on each frame; the builder's call, the frame rate is low).
- **Logos.** `ProviderIcons` is untouched; its plate uses `white`, fixed in both themes.
- **User colour presets.** `ColorPicker` and the subtitle store's defaults: untouched. The popover's presets are re-cut to eight per surface and row so every row is ten chips (the owner's ask, R3); a stored colour no longer among a row's presets shows on that row's custom chip and is still applied. The conversation store's three colours become nullable, null meaning "follow the scheme" (R3 as amended), with the scheme's colours in `CONVERSATION_SCHEME_COLOURS` and the popover's follow chip; a stored colour reads back as it was.
- `index.html`'s `theme-color` meta stays; it is not what paints the window.

### 6. Migration

Order, each step a slice with its own render pass:

1. `theme.scss`, the theme module, the setting, the control, the first-paint script, `nativeTheme`, the child-window mirror. The app still looks the same: the aliases are not switched yet.
2. Re-point `_tokens.scss` and `_variables.scss` at `var(--sk-*)`; convert the 69 `rgba($var, a)` sites and the alpha tokens in `_variables.scss` to `color-mix()`; define the `[data-tone]` blocks and set `data-tone` on the two surfaces; the viewer's `theme.scss` import and root attribute (§5), in the same slice, because the aliases break it otherwise. The 47 importing stylesheets switch here. Everything they still spell as a literal, and everything in the 19 others, is still dark: this slice is the first one that can be rendered light.
3. to 5. The literals, by area, largest first. The table is the ledger's starting row for each file:

| Area | Files (colour literals) |
|---|---|
| Conversation and main panel | `MainPanel.scss` (75), `ExportButton.scss` (40), `ModeDevicePopover.scss` (35), `ConversationRow.scss` (23), `ModePicker.scss` (12), `WaveformStrip.scss` (3), `SessionCountdown.scss` (2), `DisplayModeButton.scss` (2) |
| Settings | `Settings.scss` (37), `ModelManagementSection.scss` (31), `ColorPicker.scss` (22), `VoicePicker.scss` (14), `ModelImportModal.scss` (14), `EngineSection.scss` (14), `Engine.scss` (14), `DisplaySettingsPopover.scss` (9), `VoiceCreateModal.scss` (6), `UpdateSection.scss` (5), `VoiceLibrarySection.scss` (4), `SimpleSettings.scss` (2), the shared `Button`, `PanelBar`, `_download-status` (1 to 2 each) |
| Chrome | `TitleBar.scss` (10), `AccountPopover.scss` (9), `Banner.scss` (9), `Modal.scss` (8), `Tooltip.scss` (7), `scrollbar.scss` (7), `MainLayout.scss` (3), `Tour.scss` (3), `AccountButton.scss` (3), `PanelResizer.scss` (2), `index.scss` (1) |
| Auth, logs, update, subtitle | `UserAccountInfo.scss` (49), `LogsPanel.scss` (32), `SubtitleBar.scss` (27), `UpdateDialog.scss` (26), `ConnectionStatus.scss` (24), `ForgotPasswordForm.scss` (21), `SubtitleApp.scss` (20), `SubtitleStream.scss` (14), `SignUpForm.scss` (14), `SignInForm.scss` (13), `SignInPage.scss` (8), `OtherSideChoice.scss` (6), `AuthGuard.scss` (6), `AuthLayout.scss` (5), `CaptionSharePanel.scss` (4), `SetupWizard.scss` (3) |

6. The TypeScript colours (§5), the viewer's accent, CLAUDE.md.

Rules for the literal passes:

- A grey folds into the nearest role of its kind by luminance (`#ddd` and `#d8d8d8` to `text-secondary`, `#c8c8c8` and `#bdbdbd` to `text-tertiary`, `#b8bcc2` and `#a8adb0` to `text-source`, `#999` and `#777` to `text-muted`); a step or two of grey is acceptable, and the slice's render against the sibling control is what confirms it. The ledger ends with the roster in §2, not with a token per literal.
- `#f39c12` is read at the source: `tk.$color-participant` where it names a person, `tk.$color-degraded` where it names a session in trouble; the compiled merge disappears with the aliases.
- The eight undefined `var(--border-color, …)` reads become the `line` and text aliases.
- A white `color:` on an accent or status fill is `on-accent`; a white `color:` on a grey surface is `text-primary`. Nothing else on the page decides this; read the rule's background.
- A `background: #fff` is `white` (the thumb, the plate), never `text-primary`.
- Shadows and scrims keep black; only white tints flip through `overlay-fg`.
- `dev/*` previews migrate when the file is open anyway; the ledger allows them to lag.

### 7. Guardrails

- `src/styles/theme.consistency.test.ts`: compile `theme.scss` with `sass` (the `compile()` pattern of the stylesheet-invariant tests); the token set of `:root` equals that of `:root[data-theme="light"]`, of `[data-tone="dark"]` and of `[data-tone="light"]`; per document, every `--sk-` name referenced by the stylesheets that document loads is defined by one it loads first (the main document's stylesheets through `index.scss`, the viewer's through `viewer.scss` and `present.scss`, each set compiled together); and two value checks. The **dark block is pinned** to today's literals, value for value (a snapshot, so the dark theme cannot drift while the light one is tuned); the pinned values include R7's collapses. The **light block meets floors**, each role against the background it sits on: text roles except `text-dim` and `text-disabled` ≥ 4.5:1 on `bg-page`, `bg-surface` and `bg-control`; `text-dim`, `toolbar-icon` ≥ 3:1; `on-accent` ≥ 4.5:1 on `primary-fill`, `error`, `usage`; `primary`, `participant`, `success`, `error`, `warning`, `degraded`, `info` ≥ 4.5:1 on `bg-page` and `bg-surface`. `warning`, `recommended`, `success`, `error`, `info`, `usage` and `primary` also ≥ 4.5:1 on their own 10% and 15% tints over `bg-page`, `bg-surface` and `bg-base` (added 2026-10-22, the owner's calls after the OpenCodeReview pass and the rendered comparison). Lines are hairlines, not text, and have no floor. The light values in §2 pass (lowest: `info` 4.21 on `bg-surface`, so `info` moves to `#1967d2` or the like before the test lands; `success` `#0e7a5c` 5.1). The dark values do not all meet these floors today (`#888` on `#333` is 3.56:1, `#666` on `#333` 2.2:1, white on `#e74c3c` 3.82:1, white on `#e67e22` 2.85:1), which is why the floors bind light only (R7): dark is the owner's look, kept (R1). Should dark ever be asked to meet them, `error` and `usage` would each split into a text token and a `-fill` token as `primary` already does, because a red that carries white text at 4.5:1 cannot also read as text on `#252525` at 4.5:1; that is not this round.
- `src/styles/colourLedger.consistency.test.ts`, modelled on `consoleLedger.consistency.test.ts`: an exact count per file of colour literals (hex, `rgb()`/`rgba()`, `hsl()`, `white`, `black`) in `src/**/*.scss`, `*.css`, `*.tsx`, `*.ts`, excluding tests; `theme.scss`, the two alias files and the allow-list are exempt (`ProviderIcons.tsx`, `DisplaySettingsPopover.tsx`, `ColorPicker.*`, the two stores' defaults, `src/viewer/**`, `extension/**`); a guard that the scan matched something. A slice lowers rows; the last slice leaves the allow-list.
- Unit tests: `resolve` and the listener (`matchMedia` faked); `apply` on the main and a registered child document; the `localStorage` mirror, including a throwing `localStorage`; the store's load, default and invalid value; `toneOf` at the threshold; `ConversationList` and the subtitle view setting `data-tone` from the store; the Help control's class structure (pinned, as the sibling-markup rule asks), `aria-pressed`, the write and the `theme_changed` event.
- A render pass per slice, in both schemes, at the 450px default and the 300px panel minimum, against a sibling control on the same page, before the slice is called done.

### 8. Non-goals

The extension popup (R5) and its overlay; the viewer beyond one accent value; a high-contrast app theme; a custom accent; a theme per surface; animated theme transitions; `light-dark()`; any change to the subtitle's defaults (the conversation's follow the scheme, and the presets changed only to line the rows up; R3 as amended).

### 9. What the builder decides

The exact fold of the grey tail (within §6's rule); the scrollbar's two overlay percentages; how `WaveformStrip` learns of a theme change; whether `nativeTheme` ships in slice 1 or 6; test file names; the tooltip's wording within §4's meaning.

### 10. How the candidates were rendered

A throwaway script compiled 18 of the app's stylesheets with the repo's `sass`, rewrote each colour literal to a token by the property's role (text, background, line, shadow) and the rule's selector, dropped the two viewport media queries (768px and 600px, which the 1200px Electron window never meets), and emitted one standalone page per (specimen, scheme, participant candidate) for headless Chromium screenshots, plus the artifact page with the same specimens in `srcdoc` iframes. The specimens copied the components' DOM: the settings panel (tab bar, language pair, provider, speech rows with a switch, a sub-row, a greyed row, a slider, device list, segmented control, status messages, buttons, the Help block with the new control), the main panel (title bar, banner, toolbar, three conversation rows with badges and ear tags, status line, control footer with the mode picker) and the conversation at 300px over a white background for the participant candidates. The recipe for rendering candidates in this repo is in the memory note `sokuji-ui-decisions-by-rendering`.
