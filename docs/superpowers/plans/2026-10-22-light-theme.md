# Light Theme and the Appearance Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A light theme beside the dark one and a three-way Appearance setting (Follow system / Light / Dark), with every chrome colour a `--sk-*` token each scheme sets and the two user-coloured surfaces taking their palette from their own background.

**Architecture:** `src/styles/theme.scss` defines every colour token twice (dark on `:root`, light on `:root[data-theme="light"]`) and twice more under `[data-tone="dark"|"light"]` for the conversation and subtitle surfaces; a small module resolves the stored setting (and the OS preference) to a scheme and writes `data-theme` on every document the app owns; the two Sass token files become aliases of the custom properties so the 47 stylesheets that import them switch at once, and the literals in every other rule are migrated area by area under an exact per-file ledger.

**Tech Stack:** React 19 + TypeScript, Sass (`sass` 1.101, `@use` modules), Zustand (`subscribeWithSelector`), Vitest + Testing Library (jsdom), Electron 44 (`nativeTheme`, `ipcMain.handle`), MV3 extension, 30 locale catalogs under `src/locales/<id>/translation.json`.

**Spec:** `docs/superpowers/specs/2026-10-22-light-theme-design.md` (rulings R1–R7, the token roster in §2, the migration rules in §6, the guardrails in §7). The plan argues from it; executors read both.

**Worktree:** `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/light-theme-design`, branch `worktree-light-theme-design` (local, unpushed; the spec is its first commit). Tests: `npm run test -- <path>` from the worktree. Stylesheet tests compile with the repo's own `sass` (`import { compile } from 'sass'`, the `src/uiFont.test.ts` pattern).

## Global Constraints

- Token names are `--sk-<role>`, defined only in `src/styles/theme.scss`; components spell colours through the Sass aliases `vars.$…` / `tk.$…`; `var(--sk-…)` is written directly only in `theme.scss`, `_tokens.scss`, `_variables.scss` and TypeScript (spec §2).
- The setting is `settings.common.theme`, values `'system' | 'light' | 'dark'`, default `'dark'` (R1). A stored value outside the three loads as `'dark'`. No migration of anything stored.
- Light accent `#007255`, hover `#005a43`; light participant `#b45309` (shades `#d97706`, `#92400e`); dark values are today's literals plus R7's collapses, pinned by test; the contrast floors bind the light block only (spec §2, §7).
- The conversation view's user defaults (`#1f1f1f`, `#9aa0a6`, `#e8e8e8`) and the subtitle defaults do not change (R3). Their surfaces carry `data-tone` from their own background (spec §3). *Superseded after execution by R3 as amended (spec §R3): an unset conversation colour follows the scheme; only the subtitle's defaults stay fixed.*
- `color-mix(in srgb, …)` is allowed (Chrome 116 floor); `light-dark()` is not.
- The first-paint script is a file, never inline (the extension's `script-src 'self'`).
- Strings: new keys in all 30 catalogs; `src/locales/locales.consistency.test.ts` fails on a missing key. UI labels in tests and commits use the `en` catalog's words ("Appearance", "Follow system").
- Every stylesheet task ends with a render check in both schemes, at the settings panel's default width (450px) and its 300px minimum, against a sibling control on the same page, before it is called done (spec §7; the owner's rule).
- Commits: conventional, English, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.

## Review Focus

1. A stored `settings.common.theme` of an unknown value (a hand edit, a downgrade) must load as `dark`, never leave the attribute half-set — Task 3's `an unknown stored value loads as dark`.
2. `localStorage` that throws or is empty (a private window, cleared site data, the first run) must leave the page dark with no error on the console — Task 4's `the boot script survives a throwing storage` and Task 2's `a throwing storage does not break apply`.
3. The OS flipping its theme while the setting is `system` and a child-window popover is open must recolour both documents — Task 7's `a scheme change reaches a registered child document`.
4. A white conversation background in the dark app must put the light palette inside the conversation (the other side `#b45309`, not `#f39c12`) — Task 8's `MainPanel passes the tone of the conversation background` and the Task 10 render.
5. A `--sk-*` name a stylesheet references but no block defines (a typo in a migration) must fail a test, not render transparent — Task 1's `every --sk- name a stylesheet references is defined`.

---

## Slice 1: the switch, with nothing switched yet

### Task 1: `theme.scss` and its parity, pin and contrast test

**Files:**
- Create: `src/styles/theme.scss`
- Modify: `src/index.scss:1` (first line: `@use './styles/theme';`)
- Test: `src/styles/theme.consistency.test.ts` (create)

**Interfaces:**
- Produces: the 50 tokens of spec §2, by these names (the Sass maps' keys, each emitted as `--sk-<key>`): surfaces `bg-base`, `bg-page`, `bg-surface`, `bg-bar`, `bg-popover`, `bg-control`, `bg-hover`, `bg-elevated`, `bg-elevated-hover`, `bg-dim`, `white`; text `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`, `text-dim`, `text-disabled`, `text-source`, `on-accent`; lines `line`, `line-subtle`, `line-strong`; overlays `overlay-fg`, `scrim`, `shadow`, `shadow-strong`; accent, people and status `primary`, `primary-hover`, `primary-fill`, `primary-fill-hover`, `speaker`, `speaker-fill`, `speaker-person-3`, `participant`, `participant-person-2`, `participant-person-3`, `success`, `error`, `error-deep`, `warning`, `recommended`, `degraded`, `usage`, `usage-hover`, `usage-deep`, `info`, `toolbar-icon`, `waveform-speaker`, `waveform-participant`, `waveform-output`.
- Produces: four blocks in this order: `:root` (dark, `color-scheme: dark`), `:root[data-theme="light"]` (light, `color-scheme: light`), `[data-tone="dark"]` (dark values again, no `color-scheme`), `[data-tone="light"]` (light values again).
- `speaker` is `var(--sk-primary)` and `speaker-fill` is `var(--sk-primary-fill)` in both maps (one line to give the conversation its own colour, as `_tokens.scss` promises today).

- [ ] **Step 1: Write the failing test**

`src/styles/theme.consistency.test.ts`: compile `theme.scss`; a `block(css, selector)` helper returns the declarations of one top-level rule; a `tokens(body)` helper returns `Map<name, value>` of its `--sk-` declarations, with `var(--sk-x)` references resolved within the same block.

```ts
describe('theme.scss', () => {
  it('defines the same token set in all four blocks', () => {
    const names = (sel: string) => [...tokens(block(css, sel)).keys()].sort();
    expect(names(':root[data-theme="light"]')).toEqual(names(':root'));
    expect(names('[data-tone="dark"]')).toEqual(names(':root'));
    expect(names('[data-tone="light"]')).toEqual(names(':root'));
    expect(names(':root')).toHaveLength(50);
  });
  it('sets color-scheme on the two root blocks only', () => { /* dark on :root, light on the light block, none under [data-tone] */ });
  it('pins the dark block to the owner\'s values', () => {
    expect(Object.fromEntries(tokens(block(css, ':root')))).toEqual(DARK_PINNED); // the dark column of spec §2, verbatim, 51 entries
  });
  it.each(LIGHT_FLOORS)('light: %s on %s reaches %s:1', (fg, bg, floor) => {
    const light = tokens(block(css, ':root[data-theme="light"]'));
    expect(contrast(light.get(fg)!, light.get(bg)!)).toBeGreaterThanOrEqual(floor);
  });
  it('every --sk- name a stylesheet references is defined', () => {
    // compile every non-partial .scss under src/ (viewer/** included) and collect var(--sk-…) names
    for (const name of referenced) expect(defined).toContain(name);
  });
});
```

`LIGHT_FLOORS` is the spec §7 table written out: each of `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`, `text-source` against `bg-page`, `bg-surface`, `bg-control` at 4.5; `text-dim` and `toolbar-icon` against the same three at 3; `on-accent` against `primary-fill`, `error`, `usage` at 4.5; `primary`, `participant`, `success`, `error`, `warning`, `degraded`, `info` against `bg-page` and `bg-surface` at 4.5. `contrast(a, b)` is WCAG 2.x relative-luminance contrast on 6-digit hex.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test -- src/styles/theme.consistency.test.ts`
Expected: FAIL (the file to compile does not exist).

- [ ] **Step 3: Write `src/styles/theme.scss`**

Two Sass maps, `$dark` and `$light`, keyed by the token names above with the values of spec §2 (dark column, light column); one mixin `emit($map)` that writes `--sk-#{$key}: #{$value}` for each entry; the four blocks. Add `@use './styles/theme';` as the first line of `src/index.scss`.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npm run test -- src/styles/theme.consistency.test.ts src/uiFont.test.ts`
Expected: PASS. (`uiFont.test.ts` still finds `:root`'s font rule after the theme block is emitted before it.)

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.scss src/styles/theme.consistency.test.ts src/index.scss
git commit -m "feat(theme): define the colour tokens for both schemes"
```

### Task 2: the theme module

**Files:**
- Create: `src/lib/theme/theme.ts`
- Test: `src/lib/theme/theme.test.ts` (create)

**Interfaces:**
```ts
export type ThemeSetting = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';
export const THEME_SETTINGS: readonly ThemeSetting[];          // ['system', 'light', 'dark'], the picker's order
export const THEME_CACHE_KEY = 'sokuji.theme';                 // holds the resolved Scheme
export function isThemeSetting(v: unknown): v is ThemeSetting;
export function resolveScheme(setting: ThemeSetting, systemPrefersDark: boolean): Scheme;
export function applyScheme(doc: Document, scheme: Scheme): void;   // 'light' sets data-theme="light" on documentElement; 'dark' removes the attribute
export function registerThemeDocument(doc: Document): () => void;   // the main document is implicit; child documents register and get the current scheme at once
export interface ThemeSource { getTheme(): ThemeSetting; isLoaded(): boolean; subscribe(listener: () => void): () => void }
export interface ThemeDeps {
  source: ThemeSource;
  matchMedia?: (query: string) => MediaQueryList;              // default window.matchMedia
  storage?: Pick<Storage, 'setItem'> | null;                   // default localStorage; every write in try/catch
  onApply?: (setting: ThemeSetting, scheme: Scheme) => void;   // the entry's hook for Electron (Task 5)
}
export function installTheme(deps: ThemeDeps): () => void;      // applies nothing until source.isLoaded(); then on every change; returns uninstall
```

- [ ] **Step 1: Write the failing tests**

```ts
it('resolves system to the OS preference and the two fixed settings to themselves', () => {
  expect(resolveScheme('system', true)).toBe('dark'); expect(resolveScheme('system', false)).toBe('light');
  expect(resolveScheme('light', true)).toBe('light'); expect(resolveScheme('dark', false)).toBe('dark');
});
it('applyScheme writes data-theme for light and removes it for dark', ...);
it('does not touch the document before the settings have loaded', ...);        // source.isLoaded() false, theme 'light' → no attribute
it('applies on load and on every later change', ...);                           // fake source with a listener set
it('follows the OS while the setting is system and stops when it is not', ...); // fake matchMedia with addEventListener/removeEventListener
it('mirrors the resolved scheme into storage under sokuji.theme', ...);
it('a throwing storage does not break apply', ...);                             // storage.setItem throws; attribute still set
it('a registered document receives the current scheme at once and later changes', ...);
it('uninstall stops listening to the source and the media query', ...);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test -- src/lib/theme/theme.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/theme/theme.ts`** with the interfaces above. Module state: the set of registered documents and the current scheme; `installTheme` subscribes once, re-applies to every document, writes the cache, calls `onApply`; the media listener is attached only while the setting is `system`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test -- src/lib/theme/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/theme.ts src/lib/theme/theme.test.ts
git commit -m "feat(theme): resolve the appearance setting to a scheme and apply it"
```

### Task 3: the setting in the store

**Files:**
- Modify: `src/stores/settingsStore.ts` (`CommonSettings`, `defaultCommonSettings`, `SettingsStore`, the setter beside `setDiagnosticLogs`, the load beside `uiMode`, the hooks at the bottom)
- Test: `src/stores/settingsStore.theme.test.ts` (create; mock `ServiceFactory` the way the store's neighbouring tests do)

**Interfaces:**
- Consumes: `ThemeSetting`, `isThemeSetting` from Task 2.
- Produces: state `theme: ThemeSetting` (default `'dark'`); `setTheme(theme: ThemeSetting): Promise<void>` (set, `persistSetting('settings.common.theme', theme)`, roll back on a failed write, the `setDiagnosticLogs` shape); hooks `useThemeSetting()` and `useSetThemeSetting()`.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults to dark', () => expect(useSettingsStore.getState().theme).toBe('dark'));
it('loads a stored light', async () => { /* getSetting resolves 'light' for settings.common.theme */ expect(state.theme).toBe('light'); });
it('an unknown stored value loads as dark', async () => { /* getSetting resolves 'sepia' */ expect(state.theme).toBe('dark'); });
it('setTheme writes settings.common.theme and keeps the value', ...);
it('setTheme rolls back when the write fails', ...);
```

- [ ] **Step 2: Run them to make sure they fail** — `npm run test -- src/stores/settingsStore.theme.test.ts` → FAIL.

- [ ] **Step 3: Implement** the field, default, setter, load (`isThemeSetting(v) ? v : 'dark'`) and hooks.

- [ ] **Step 4: Run the store's tests** — `npm run test -- src/stores/` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(settings): store the appearance setting"`.

### Task 4: the entry installs the theme; the boot script paints the first frame

**Files:**
- Create: `public/theme-boot.js`
- Modify: `index.html` (a `<script src="./theme-boot.js"></script>` as the first child of `<head>` after the charset meta), `extension/fullpage.html` (the same tag), `extension/vite.config.ts` (static copy `{ src: '../public/theme-boot.js', dest: '.' }` beside `popup.css`), `shared/index.tsx` (install the theme before `initializeApp` runs)
- Test: `src/lib/theme/themeBoot.test.ts` (create)

**Interfaces:**
- Consumes: `installTheme`, `THEME_CACHE_KEY` (Task 2); `useSettingsStore` (Task 3).
- Produces: `public/theme-boot.js`, a classic script: read `localStorage.getItem('sokuji.theme')` inside `try`; if it is `'light'`, set `data-theme="light"` on `document.documentElement`; otherwise nothing. No other behaviour.
- The entry's `ThemeSource` is the store: `getTheme: () => useSettingsStore.getState().theme`, `isLoaded: () => useSettingsStore.getState().settingsLoaded`, `subscribe: (l) => useSettingsStore.subscribe(l)`. `onApply` is wired in Task 5.

- [ ] **Step 1: Write the failing tests**

```ts
it('the boot script sets data-theme from the cache', () => { /* jsdom: localStorage sokuji.theme = 'light'; run the file's source with new Function; expect attribute */ });
it('the boot script leaves dark alone', ...);                       // cache absent or 'dark' → no attribute
it('the boot script survives a throwing storage', ...);             // Object.defineProperty(window, 'localStorage', { get() { throw } })
it('index.html and fullpage.html load theme-boot.js before any stylesheet or module', () => { /* read both files; the script tag's index is before the first <link rel="stylesheet"> and the first <script type="module"> */ });
it('the extension build copies theme-boot.js', () => { /* read extension/vite.config.ts; expect "../public/theme-boot.js" */ });
```

- [ ] **Step 2: Run them to make sure they fail** — `npm run test -- src/lib/theme/themeBoot.test.ts` → FAIL.

- [ ] **Step 3: Implement** the script, the two tags, the copy entry, and in `shared/index.tsx` a top-level `installTheme({ source })` before `initializeApp`.

- [ ] **Step 4: Run the tests** — `npm run test -- src/lib/theme/` → PASS. Then `npm run build` and `npm run build` inside `extension/` → both succeed and `theme-boot.js` sits beside each build's HTML.

- [ ] **Step 5: Commit** — `git commit -m "feat(theme): apply the scheme at boot, before the first paint"`.

### Task 5: Electron follows the choice

**Files:**
- Modify: `electron/ipc-channels.js` (`'theme:set'` in `INVOKE_CHANNELS`), `electron/main.js` (`nativeTheme` in the `require('electron')` list; `ipcMain.handle('theme:set', (event, setting) => …)` beside `app:session-busy`, main window only), `shared/index.tsx` (`onApply: (setting) => (window as any).electron?.invoke?.('theme:set', setting)`)
- Test: `electron/ipc-channels.test.js` (exists; the guard that every allowlisted channel has a handler)

- [ ] **Step 1: Add the channel first and run the guard** — `npm run test -- electron/ipc-channels.test.js` → FAIL (allowlisted channel without a handler).
- [ ] **Step 2: Implement the handler**: `nativeTheme.themeSource = setting` for `'light' | 'dark' | 'system'`, anything else ignored; sender must be the main window. Wire `onApply` in the entry.
- [ ] **Step 3: Run the guard** → PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat(electron): native theme follows the appearance setting"`.

### Task 6: the Appearance control

**Files:**
- Modify: `src/components/Settings/sections/HelpSection.tsx` (between the `<h3>` and `.help-links`), `src/lib/analytics.ts` (event map, after `language_changed`), the 30 catalogs `src/locales/<id>/translation.json`
- Test: `src/components/Settings/sections/HelpSection.test.tsx` (extend: mock `useThemeSetting`/`useSetThemeSetting` beside the existing store mocks)

**Interfaces:**
- Consumes: `useThemeSetting`, `useSetThemeSetting` (Task 3); `THEME_SETTINGS` (Task 2).
- Produces: analytics event `'theme_changed': { from: ThemeSetting; to: ThemeSetting }`.
- Markup, copied from the noise-suppression block in `AudioDeviceSection.tsx:154-186` class for class: `div.noise-suppression-control > div.noise-suppression-header > (span.noise-suppression-label + Tooltip{content, position:"top", icon:"help", maxWidth:300})` then `div.segmented-control.noise-suppression-modes > button.segmented-option[.active][aria-pressed]` × 3 in `THEME_SETTINGS` order. A click on the current value does nothing.
- Strings (en): `settings.appearance` = "Appearance"; `settings.appearanceTooltip` = "How the app looks. Follow system takes the operating system's light or dark setting."; `settings.appearanceMode.system` = "Follow system"; `settings.appearanceMode.light` = "Light"; `settings.appearanceMode.dark` = "Dark". The other 29 catalogs carry translations of the same five keys.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders the Appearance control as the labelled segmented control, dark active', () => {
  // class structure pinned: .noise-suppression-control > .noise-suppression-header > .noise-suppression-label; .segmented-control.noise-suppression-modes with three .segmented-option
  // the "Dark" option has .active and aria-pressed="true"; the others aria-pressed="false"
});
it('picking Light writes the setting and tracks theme_changed', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Light' }));
  expect(setTheme).toHaveBeenCalledWith('light');
  expect(trackEvent).toHaveBeenCalledWith('theme_changed', { from: 'dark', to: 'light' });
});
it('picking the current value writes nothing', ...);
```

- [ ] **Step 2: Run them to make sure they fail** — `npm run test -- src/components/Settings/sections/HelpSection.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the control, the event type, the five keys in all 30 catalogs.

- [ ] **Step 4: Run** `npm run test -- src/components/Settings/sections/HelpSection.test.tsx src/locales/locales.consistency.test.ts` → PASS. Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Render check**: `npm run electron:dev`, open Settings → General → Help; the control sits under the heading in the 28px dialect, label 13px secondary like "Noise suppression" on the Audio tab; the toggle changes nothing visible yet (the stylesheets are still literal). Screenshot at 450px and 300px.

- [ ] **Step 6: Commit** — `git commit -m "feat(settings): an Appearance control in Help"`.

### Task 7: child windows follow

**Files:**
- Modify: `src/components/Subtitle/ChildWindowPopover.tsx` (after `syncStyles(document, win.document, …)` in `createWindow`: `registerThemeDocument(win.document)`, unregistered in the teardown)
- Test: `src/components/Subtitle/ChildWindowPopover.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — `it('a scheme change reaches a registered child document', ...)`: open the popover with a fake `window.open` returning a document; apply light through the module; expect `data-theme="light"` on the child's root; close; apply dark; the detached document is untouched.
- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** the register/unregister.
- [ ] **Step 4: Run** `npm run test -- src/components/Subtitle/ChildWindowPopover.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(theme): child-window popovers take the document's scheme"`.

### Task 8: a user-coloured surface carries its tone

**Files:**
- Create: `src/lib/view/tone.ts`
- Modify: `src/components/Conversation/ConversationList.tsx` (`tone: Tone` prop, required; `data-tone={tone}` on `.conversation-display`), `src/components/MainPanel/MainPanel.tsx:332,345` (pass `toneOf(display.bgColor)` to both the takeover's `.conversation-display` and `ConversationList`), `src/components/Subtitle/SubtitleBands.tsx:71` (pass `toneOf(subtitle.bgColor)`), `src/components/Subtitle/useSubtitleChrome.tsx` (`rootProps['data-tone'] = toneOf(subtitle.bgColor)`; `getHighlightOverlayForBg` decides by `toneOf`, not YIQ), `src/components/dev/SpinePreview.tsx` (pass a tone)
- Test: `src/lib/view/tone.test.ts` (create), `src/components/Conversation/ConversationList.test.tsx` (extend or create), `src/components/Subtitle/useSubtitleChrome.test.tsx` (extend)

**Interfaces:**
```ts
export type Tone = 'dark' | 'light';
export function relativeLuminance(hex: string): number;   // WCAG 2.x; 6-digit hex with or without '#'
export function toneOf(hex: string): Tone;                // 'dark' when relativeLuminance < 0.179 or the value is not a 6-digit hex
```

- [ ] **Step 1: Write the failing tests**

```ts
it.each([['#1f1f1f', 'dark'], ['#000000', 'dark'], ['#ffffff', 'light'], ['#f7f7f8', 'light'], ['#ff0000', 'light'], ['#003b6f', 'dark'], ['#757575', 'dark'], ['#777777', 'light'], ['not-a-colour', 'dark']])('toneOf(%s) is %s', ...); // #757575 sits just under the 0.179 threshold, #777777 just over it
it('ConversationList sets data-tone on .conversation-display', ...);
it('MainPanel passes the tone of the conversation background', ...);              // bgColor '#FFFFFF' → data-tone="light"
it('the subtitle root carries the tone of the subtitle background', ...);         // '#000000' → dark
it('the highlight overlay is white on a dark background and black on a light one, by the same rule as the tone', () => {
  expect(getHighlightOverlayForBg('#ff0000')).toMatch(/^rgba\(0,0,0/);          // the one place YIQ and luminance disagree
});
```

- [ ] **Step 2: Run them** → FAIL.
- [ ] **Step 3: Implement** `tone.ts` and the wiring. `useSubtitleChrome`'s existing comment about YIQ is replaced by one sentence pointing at `toneOf`.
- [ ] **Step 4: Run** `npm run test -- src/lib/view/tone.test.ts src/components/Conversation src/components/Subtitle src/components/MainPanel` → PASS; `npx tsc --noEmit` → clean (every `ConversationList` caller passes `tone`).
- [ ] **Step 5: Commit** — `git commit -m "feat(view): a user-coloured surface carries the tone of its background"`.

## Slice 2: the aliases switch

### Task 9: the viewer loads the theme first

**Files:**
- Modify: `src/viewer/viewer.scss:7` and `src/viewer/present.scss:2` (`@use '../styles/theme';` before the other `@use`s), `src/viewer/ViewerApp.tsx` (an effect: `theme === 'light'` sets `data-theme="light"` on `document.documentElement`, otherwise removes it; runs on mount and on change)
- Test: `src/viewer/viewerSideStyles.test.ts` (extend: the compiled `viewer.scss` and `present.scss` each contain the `:root{` theme block), `src/viewer/ViewerApp.test.tsx` (extend or create: `it('the light scheme sets data-theme on the document', ...)`, contrast and dark remove it)

- [ ] **Step 1: Write the failing tests** → run → FAIL.
- [ ] **Step 2: Implement** the two imports and the effect.
- [ ] **Step 3: Run** `npm run test -- src/viewer` → PASS. `node scripts/check-viewer-bundle.mjs` after `npm run build` → still passes (nothing loads from another origin).
- [ ] **Step 4: Commit** — `git commit -m "feat(viewer): load the theme tokens and set the scheme on the document"`.

### Task 10: the token files become aliases

**Files:**
- Modify: `src/styles/_tokens.scss` (every `$color-*` becomes `var(--sk-…)` by the spec §2 mapping; `$color-speaker: var(--sk-speaker)` etc.), `src/components/Settings/shared/_variables.scss` (every `$text-*`, `$bg-*`, `$border-*`, `$color-*`, `$toggle-bg-off`, `$slider-track-bg` to its alias; `$color-*-bg`/`-border` to `color-mix(in srgb, var(--sk-x) 10%|30%, transparent)`; `option-row`'s `rgba(255,255,255,.02|.05)` to `color-mix(in srgb, var(--sk-overlay-fg) 2%|5%, transparent)`; `option-row-selected`'s two `rgba($color-primary, …)` to `color-mix`), and the 69 `rgba($var, a)` sites listed by `grep -rnE 'rgba\(\s*(\$|tk\.\$|vars\.\$)' src --include='*.scss'` (each to `color-mix(in srgb, <alias> <a×100>%, transparent)`)
- Test: `src/styles/theme.consistency.test.ts` (the existing `every --sk- name … is defined` case now exercises every stylesheet through the aliases), plus a new case `it('no stylesheet still computes alpha on a token', () => { expect(grep of rgba($…)).toEqual([]) })`

**Interfaces:**
- Produces: `vars.$text-primary` … `tk.$color-participant` now mean `var(--sk-…)`. Sass refuses `rgba($alias, a)` ("not a color"), so this task converts all 69 sites or the build fails; that is the intended loud failure.

- [ ] **Step 1: Write the failing test** (the `rgba($…)` grep case) → `npm run test -- src/styles/theme.consistency.test.ts` → FAIL (69 sites).
- [ ] **Step 2: Re-point the two token files**, then convert the sites until `npx sass --no-source-map --quiet --load-path=src src/components/Settings/Settings.scss > /dev/null` and the rest compile (`npm run build` compiles every stylesheet).
- [ ] **Step 3: Run** `npm run test -- src/styles src/components/Settings/shared src/uiFont.test.ts src/viewer` → PASS; `npm run build` → succeeds.
- [ ] **Step 4: Render check, the first light one**: `npm run electron:dev`, Appearance → Light. The settings page, the control footer and everything that reaches its colour through an alias is light; the title bar, the main layout and every literal rule are still dark. Screenshot both schemes at 450px and 300px; confirm the conversation stays dark inside the light app (R3 as first ruled; under the amended R3 an unset conversation turns white with the app, so check that instead) and that a white conversation background (display popover) turns its badges amber `#b45309`.
- [ ] **Step 5: Commit** — `git commit -m "refactor(styles): the token files alias the --sk- custom properties"`.

### Task 11: the colour ledger

**Files:**
- Create: `src/styles/colourLedger.consistency.test.ts`

**Interfaces:**
- Scans `src/**/*.{scss,css,ts,tsx}` and `shared/**`, skipping `*.test.*`, `*.d.ts`, `src/styles/theme.scss`, `src/styles/_tokens.scss`, `src/components/Settings/shared/_variables.scss`, and the allow-list `src/components/Icons/ProviderIcons.tsx`, `src/components/Display/DisplaySettingsPopover.tsx`, `src/components/Display/ColorPicker.tsx`, `src/components/Display/ColorPicker.scss`, `src/stores/subtitleStore.ts`, `src/stores/conversationDisplayStore.ts`, `src/viewer/**`, `src/components/dev/**`.
- Counts, per file: in SCSS/CSS, after stripping `//` and `/* */` comments, every `#[0-9a-f]{3,8}\b`, `rgba?(`, `hsla?(`, and the words `white`/`black` used as a value; in TS/TSX, through `ts.createSourceFile` (the `consoleLedger` way), every string or template literal whose text matches `^#[0-9a-f]{3,8}$` or starts with `rgb(`/`rgba(`/`hsl(`.
- One `LEDGER: Record<string, number>` of exact counts, asserted with `toBe` per file, a guard that the scan matched at least one file, and a guard that no file outside the ledger has a count above zero.

- [ ] **Step 1: Write the test with an empty ledger** → run → FAIL, printing the measured counts.
- [ ] **Step 2: Paste the measured counts into `LEDGER`** (the numbers after Task 10, not the spec's pre-alias table).
- [ ] **Step 3: Run** `npm run test -- src/styles/colourLedger.consistency.test.ts` → PASS. Mutation-check: add `color: #123456` to `src/components/Tooltip/Tooltip.scss`, run, see the row fail, revert.
- [ ] **Step 4: Commit** — `git commit -m "test(styles): an exact ledger of colour literals per file"`.

## Slices 3–5: the literals, area by area

Each task below follows the same five steps; only the file list and the render surfaces differ. The rules are spec §6: greys fold into the nearest role of their kind; `#f39c12` is `tk.$color-participant` where it names a person and `tk.$color-degraded` where it names the session; a white `color:` on an accent or status fill is `vars.$color-on-primary` (`--sk-on-accent`), on a grey surface `vars.$text-primary`; `background: #fff` is `--sk-white`; shadows and scrims keep black; white tints become `color-mix(in srgb, var(--sk-overlay-fg) N%, transparent)` through a `vars.$overlay-fg` alias; a file that imports neither token file starts with `@use '…/Settings/shared/variables' as vars;` or `@use '…/styles/tokens' as tk;`.

**Steps for each area task:**
- [ ] **Step 1:** Lower the task's rows in `LEDGER` to the target (zero unless the row is an allow-listed file) and run `npm run test -- src/styles/colourLedger.consistency.test.ts` → FAIL on those rows.
- [ ] **Step 2:** Convert the files. `npx tsc --noEmit` and `npm run build` → clean.
- [ ] **Step 3:** `npm run test -- src/styles src/components/<area>` → PASS (the ledger rows, the definedness case, the area's own tests).
- [ ] **Step 4: Render check**: both schemes, 450px and 300px, every converted surface beside a sibling control on the same page: same font size, same colour role, same track and thumb where there is a slider; the greyed row still shows OFF; hover and pressed tints visible in both schemes (hover with the mouse, screenshot).
- [ ] **Step 5: Commit** — one commit per task: `refactor(<area>): colours through the theme tokens`.

### Task 12: the conversation and the main panel

**Files:** `src/components/MainPanel/MainPanel.scss` (75), `ExportButton.scss` (40), `ModeDevicePopover.scss` (35), `ConversationRow.scss` (23), `ModePicker.scss` (12; also the four undefined `var(--border-color|--text-secondary|--bg-secondary|--bg-hover, …)` reads become aliases), `WaveformStrip.scss` (3), `SessionCountdown.scss` (2), `DisplayModeButton.scss` (2), `src/styles/karaoke.scss`.
**Render surfaces:** the conversation (dark default and a white user background), the toolbar, the status line in its three tones, the control footer basic and advanced, the mode picker, the mode-device popover, the export menu.

### Task 13: settings

**Files:** `src/components/Settings/Settings.scss` (37; also its four undefined `var(…)` reads), `sections/ModelManagementSection.scss` (31), `sections/VoicePicker.scss` (14), `sections/ModelImportModal.scss` (14; `--import-accent`/`--import-danger` keep their names, now from the aliases), `sections/EngineSection.scss` (14), `engine/Engine.scss` (14), `Display/DisplaySettingsPopover.scss` (9), `sections/VoiceCreateModal.scss` (6), `sections/UpdateSection.scss` (5), `sections/VoiceLibrarySection.scss` (4), `SimpleSettings/SimpleSettings.scss` (2), `shared/Button.scss`, `shared/PanelBar.scss`, `shared/_download-status.scss`, `shared/TabBar.scss`, `shared/ToggleSwitch.scss`, `shared/FormInput.scss`, `shared/StatusMessage.scss`.
**Render surfaces:** all three tabs of Advanced and the Simple layout; the engine page; the model and voice pickers; the import modal; the display popover.

### Task 14: chrome

**Files:** `src/components/TitleBar/TitleBar.scss` (10), `TitleBar/AccountPopover.scss` (9), `TitleBar/AccountButton.scss` (3), `Banner/Banner.scss` (9), `Modal/Modal.scss` (8), `Tooltip/Tooltip.scss` (7), `src/styles/scrollbar.scss` (7; thumb and track as `overlay-fg` tints, the two percentages the builder's), `MainLayout/MainLayout.scss` (3), `Tour/Tour.scss` (3), `MainLayout/PanelResizer.scss` (2), `src/index.scss` (1), `src/App.scss` (`color: white` → `vars.$text-primary`).
**Render surfaces:** the window at rest in both schemes (title bar, layout, scrollbars), a tooltip, a modal, the tour, each banner tone, the account popover (a child window: confirm it follows the scheme live).

### Task 15: auth, logs, update, subtitle, the rest

**Files:** `src/components/Auth/UserAccountInfo.scss` (49), `LogsPanel/LogsPanel.scss` (32), `Subtitle/SubtitleBar.scss` (27), `UpdateDialog/UpdateDialog.scss` (26), `ConnectionStatus/ConnectionStatus.scss` (24), `Auth/ForgotPasswordForm.scss` (21), `Subtitle/SubtitleApp.scss` (20), `Subtitle/SubtitleStream.scss` (14), `Auth/SignUpForm.scss` (14), `Auth/SignInForm.scss` (13), `Auth/SignInPage.scss` (8), `FaceToFace/OtherSideChoice.scss` (6), `Auth/AuthGuard.scss` (6), `Auth/AuthLayout.scss` (5), `CaptionShare/CaptionSharePanel.scss` (4), `SetupWizard/SetupWizard.scss` (3).
**Render surfaces:** sign-in, sign-up and the account page; the logs panel (diagnostic logs on); the update dialog; the subtitle view on its black default and on a white user background (bands and bar chrome follow the tone); the caption-share panel; the setup wizard.

## Slice 6: what is not CSS, and the docs

### Task 16: the waveforms read tokens

**Files:**
- Modify: `src/components/MainPanel/WaveformStrip.tsx` (`color: string` → `colorToken: string`, a `--sk-…` name; `useWaveform` resolves `getComputedStyle(canvas).getPropertyValue(colorToken).trim()` each frame before `drawBars`), `src/components/MainPanel/panel/Waveforms.tsx` (`'--sk-waveform-speaker'`, `'--sk-waveform-participant'`, `'--sk-waveform-output'`)
- Test: `src/components/MainPanel/panel/Waveforms.test.tsx` (extend: the three strips carry the three token names), `src/components/MainPanel/WaveformStrip.test.tsx` (extend or create: `drawBars` receives the computed value of the token, and a changed value on the next frame)

- [ ] **Step 1: Write the failing tests** → FAIL. **Step 2: Implement.** **Step 3:** `npm run test -- src/components/MainPanel` → PASS; the ledger rows for the two files reach zero (lower them in the same diff). **Step 4: Render check**: the three strips in both schemes (advanced footer). **Step 5: Commit** — `refactor(waveforms): colours from the theme tokens`.

### Task 17: the final ledger and the docs

**Files:**
- Modify: `src/styles/colourLedger.consistency.test.ts` (the `LEDGER` holds only allow-listed files; everything else is absent and the no-stray guard covers it), `CLAUDE.md` ("UI Design System": two themes, `--sk-*` tokens defined in `theme.scss`, the Sass aliases, the tone rule for user-coloured surfaces, the two guard tests; "Error Handling" untouched), `docs/superpowers/specs/2026-10-22-light-theme-design.md` (Status line: implemented, the branch)

- [ ] **Step 1:** Run the whole suite: `npm run test` → PASS; `npx tsc --noEmit` → clean; `npm run build` and the extension build → succeed.
- [ ] **Step 2:** Write the CLAUDE.md paragraph and the spec status.
- [ ] **Step 3: Final render pass**: Appearance → Follow system with the OS set to light, then to dark, with a child popover open: both documents follow; Light and Dark fixed; restart the app under Light: no dark first frame.
- [ ] **Step 4: Commit** — `git commit -m "docs: two themes in the design system notes"`.

---

## Self-review notes

- Spec §1 → Tasks 2, 4, 5; §2 → Tasks 1, 10; §3 → Task 8 (and the `[data-tone]` blocks in Task 1); §4 → Tasks 3, 6; §5 → Tasks 7, 9, 16 (logos and presets untouched by the allow-list in Task 11); §6 → Tasks 10, 12–15; §7 → Tasks 1, 11 and each task's own tests; §8 non-goals: no task touches `extension/popup.*`, `subtitle-overlay.html` or the viewer's participant colour.
- Names used across tasks: `ThemeSetting`, `Scheme`, `THEME_SETTINGS`, `THEME_CACHE_KEY`, `isThemeSetting`, `resolveScheme`, `applyScheme`, `registerThemeDocument`, `installTheme`, `ThemeSource` (Task 2) ← Tasks 3, 4, 5, 6, 7; `theme`, `setTheme`, `useThemeSetting`, `useSetThemeSetting` (Task 3) ← Tasks 4, 6; `Tone`, `toneOf`, `relativeLuminance` (Task 8) ← Tasks 8, 10's render; `colorToken` (Task 16); the 50 token names (Task 1) ← Tasks 10, 16.
- Task 10 is the one large task by design: Sass fails the build until every `rgba($alias, a)` is converted, so the conversion cannot be split without leaving the branch unbuildable between commits.
