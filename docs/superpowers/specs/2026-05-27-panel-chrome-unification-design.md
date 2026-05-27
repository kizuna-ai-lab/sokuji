# Panel Chrome Unification (Settings + Logs) — Design

**Date:** 2026-05-27
**Status:** Draft
**Scope:** Introduce a single shared `PanelBar` component for the Settings and Logs side panels, formalize a small active-state token system across the shell, and fix three concrete UX defects in the top-right region: (1) three competing green "active" treatments, (2) a `→`-arrow close button that sits directly under the window `✕`, and (3) three stacked horizontal navigation rows. MainPanel keeps its structure and only continues to share the same accent color.

## Problem

The Settings panel's top-right region (and, it turns out, the whole shell) suffers from chrome that was invented three separate times:

- **Three greens fighting.** On one screen, "active" is expressed three different ways: the TitleBar `Settings` entry uses a green **outline** (`TitleBar.scss` `.is-active { border-color: #10a37f }`), the `Quick/Advanced` toggle uses a green **fill** (`Settings.scss` `.mode-button.active`), and the category tab uses green **text + underline** (`TabBar.scss` `.tab-bar__tab--active`). The green outline in particular reads like a focus/error ring. Nothing tells the user which green is "the" current location.
- **A misleading close that's a mis-tap risk.** Both `Settings.tsx` (`.close-button`) and `LogsPanel.tsx:289` (`.close-logs-button`) render an `ArrowRight` icon + "Close". A right arrow conventionally means "forward/next", not "dismiss". Worse, this control sits one row directly below the window's `✕`, so a user aiming to close the panel can close the whole window.
- **Three stacked nav rows.** TitleBar (`Subtitle/Settings/Logs`) → Settings header (`Settings` title + mode toggle + close) → TabBar (`General/Audio/Provider`). In a 300–450px side panel, navigation eats three rows of vertical space before any content appears. The word "Settings" also appears twice (TitleBar entry + `<h2>`).
- **No shared panel chrome.** Settings, Logs, and MainPanel each built bespoke headers. The arrow-close bug is copy-pasted between Settings and Logs. Settings and Logs already share the `TabBar` component (`LogsPanel` imports it from `Settings/shared/TabBar`), which proves a shared header primitive is low-friction.

## Goals

1. One shared `PanelBar` grammar for both side panels: `[tabs (left)] ···· [panel-specific actions] [collapse]`.
2. A documented active-state token system where **green = the selected item in a mutually-exclusive set**, with one fixed form per control archetype and a clear hierarchy so only one prominent "you are here" signal competes at a time.
3. Replace the arrow-close with a semantically correct **"collapse panel"** affordance, visually distinct from the window `✕`, plus **Esc** to close.
4. Collapse Settings from three nav rows to two (TitleBar + PanelBar); drop the duplicate `Settings`/`Logs` `<h2>`.
5. The `Quick/Advanced` toggle never changes position when toggled.
6. No regression to onboarding step targeting, the settings-navigation deep-link flow, or mobile/macOS/extension layouts.

## Non-Goals

- No structural change to **MainPanel** (`conversation-toolbar`, `control-footer`). It already uses the same `#10a37f` accent, so it stays as-is; this spec does not retrofit its buttons onto the new tokens.
- No change to **what** the tabs are (Settings: General/Audio/Provider; Logs: per-client) or the panel contents.
- No removal of the `Quick/Advanced` mode feature, and no moving it into an overflow menu.
- No change to panel docking, width (`settings-panel-container: 450px`), or the side-by-side-with-MainPanel layout.
- No new i18n copy beyond an optional `common.collapsePanel` aria-label key.
- No relocation of `TabBar` out of `Settings/shared/` (a future cleanup, not this spec).

## Design

### Active-state token system (System A)

The fix is **not** to make every control identical — it is to assign green a single meaning and pick the correct form per control type, weighting by hierarchy.

| Control archetype | Where | Active form | Token |
|---|---|---|---|
| Tab strip | TabBar (Settings categories, Logs clients) | green text + 2px green bottom-border | `state-selected-underline` |
| Segmented control | `Quick/Advanced` toggle | green fill + light text on active segment | `state-selected-fill` |
| Panel switcher | TitleBar `Subtitle/Settings/Logs` active entry | **neutral pressed pill** — solid subtle fill + bright text, **no green** | (TitleBar-local) |
| Keyboard focus (all) | any focusable control | green **outline**, `:focus-visible` only | `focus-ring` (exists) |

Key point: most of this is already correct. `TabBar.scss` already does the underline; `Settings.scss .mode-button.active` already does the fill; `_variables.scss` already has a `focus-ring` mixin. **The only behavioral CSS change is the TitleBar**, which today borrows the green outline for "active" — that moves to a neutral pressed pill, and the green outline becomes focus-only. Net effect: on any screen there is exactly one prominent green location signal (the active tab), with the TitleBar receding to background context and the segmented control reading as a contained control.

`_variables.scss` gains two mixins extracted from the existing patterns so future code references one source:

```scss
@mixin state-selected-underline {
  color: $color-primary;
  border-bottom: 2px solid $color-primary;
}
@mixin state-selected-fill {
  background: $color-primary;
  color: $text-primary;
}
// focus-ring already exists; reserve it for :focus-visible only.
```

`TabBar.scss` and the mode-toggle styles are refactored to `@include` these mixins (no visual change) so the tokens have real call sites.

### Component: PanelBar

New presentational component, placed at `src/components/Settings/shared/PanelBar.tsx` to sit beside the already-shared `TabBar`.

**Props:**

```ts
interface PanelBarProps {
  // Tab strip (optional — Settings Quick mode and any tab-less panel omit it)
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  // Panel-specific controls rendered in the right cluster, left of close.
  // Settings: the Quick/Advanced toggle. Logs: auto-scroll / copy / clear.
  actions?: React.ReactNode;
  // Collapse the panel. Wired to the owning panel's existing toggle fn.
  onClose: () => void;
}
```

**Layout (single flex row):**

```
[ TabBar (or nothing) ]  → margin-left:auto →  [ actions ]  | divider |  [ collapse ]
```

- When `tabs` is provided, PanelBar renders `<TabBar>` internally; otherwise the left side is empty (Settings Quick mode). The actions+collapse cluster is right-anchored via `margin-left:auto`, so **it occupies the same pixels whether or not tabs are present** — toggling Quick⇄Advanced only adds/removes the left tabs; the right cluster never moves.
- **Collapse control:** lucide `PanelRightClose` icon (the panel docks on the right; the icon depicts the side panel sliding shut), `aria-label`/`title` = `t('common.collapsePanel', 'Close panel')`, separated from the actions by a thin vertical divider. No visible text label.
- **Esc to close:** PanelBar attaches a `keydown` listener while mounted; on `Escape`, if `!event.defaultPrevented` and there is no open modal/dialog (`document.querySelector('[role="dialog"]')` is null), it calls `onClose()`. This lets `WarningModal` and popovers keep their own Escape behavior. (Settings/Logs panels and Electron subtitle takeover are mutually exclusive, so there is no conflict with the subtitle ESC layering.)

`PanelBar.scss` carries the bar container styles plus the relocated `.mode-toggle` segmented-control styles (moved out of `Settings.scss`), built on the state tokens. It keeps the existing `@media (max-width: 768px)` rule that hides the mode-button text labels on narrow widths (icon-only).

### Settings integration

`Settings.tsx` becomes the single owner of the panel bar and the category-tab state:

- **Remove** the `.settings-header` block entirely (the `<h2>`, `.mode-toggle`, and `.close-button`).
- **Lift** `activeTab`, the `TABS` constant, and the `settingsNavigationTarget → targetTab` effect up from `AdvancedSettings.tsx` into `Settings.tsx`. The lifted effect is **guarded to `!isSimpleMode`** so it only switches Advanced tabs — preserving today's behavior exactly (the effect currently lives in `AdvancedSettings`, which mounts only in Advanced). Quick mode keeps using `highlightSection` in `SimpleSettings`; navigation does **not** force a switch into Advanced.
- Render `<PanelBar>` once:
  - `tabs` / `activeTab` / `onTabChange` are passed **only in Advanced mode** (`!isSimpleMode`); omitted in Quick mode.
  - `actions` = the `Quick/Advanced` segmented toggle (the existing `handleModeToggle` logic, markup moved into a small local `ModeToggle` element or kept inline).
  - `onClose` = `toggleSettings`.
- `AdvancedSettings` no longer renders `TabBar` or owns `activeTab`; it receives `activeTab` as a prop and renders only the matching tabpanel. The tabpanel a11y ids (`tabpanel-${id}` / `tab-${id}`) still match because `TabBar` (now inside `PanelBar`) emits the same ids and shares the same `activeTab`.
- `Settings.scss`: delete `.settings-header`, `.mode-toggle`, `.mode-button`, `.close-button` rules (mode-toggle styles relocate to `PanelBar.scss`); keep the responsive section.

Resulting Settings layout:

- **Advanced:** `[General | Audio | Provider] ···· [Quick|Advanced] | [⇥▕]`
- **Quick:** `(empty) ···· [Quick|Advanced] | [⇥▕]` — right cluster pixel-identical to Advanced.

### Logs integration

`LogsPanel.tsx`:

- **Remove** `.logs-panel-header` (the `<h2>`, the `header-actions` wrapper) and the standalone `<TabBar>` call, plus the `ArrowRight` `.close-logs-button`.
- Render `<PanelBar tabs={LOG_TABS} activeTab={activeTab} onTabChange={...} actions={<>auto-scroll / copy / clear</>} onClose={toggleLogs} />`.
- The conditional visibility of copy (`filteredLogs.length > 0`) and clear (`logs.length > 0`) stays inside the `actions` JSX — the slot is plain `ReactNode`.
- `LogsPanel.scss`: drop the header layout rules; the action-button styles either move into `PanelBar.scss` (if generic) or stay scoped to the buttons passed into the slot.

### TitleBar change

`TitleBar.scss` only:

- `.title-bar__action.is-active`: remove `border-color: #10a37f`; keep the subtle background and brighten text (neutral pressed pill).
- Add `.title-bar__action:focus-visible { outline: 2px solid #10a37f; outline-offset: -1px; }` so keyboard focus is the *only* place the green outline appears.

`TitleBar.tsx` is unchanged — the `settings-button` / `logs-button` classes (onboarding targets) and window-control logic stay as-is.

## Files

**Create:**
- `src/components/Settings/shared/PanelBar.tsx`
- `src/components/Settings/shared/PanelBar.scss`
- `src/components/Settings/shared/PanelBar.test.tsx`

**Modify:**
- `src/components/Settings/shared/_variables.scss` — add `state-selected-underline` / `state-selected-fill` mixins.
- `src/components/Settings/shared/TabBar.scss` — `@include state-selected-underline` (no visual change).
- `src/components/Settings/Settings.tsx` — own PanelBar + lifted tab state + nav-target effect; remove header block.
- `src/components/Settings/Settings.scss` — remove header/mode/close rules.
- `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx` — receive `activeTab` prop; drop internal TabBar + tab state + nav effect.
- `src/components/LogsPanel/LogsPanel.tsx` — adopt PanelBar; remove bespoke header + arrow-close.
- `src/components/LogsPanel/LogsPanel.scss` — remove header rules.
- `src/components/TitleBar/TitleBar.scss` — neutral active pill + focus-visible outline.
- i18n locale files — add `common.collapsePanel` (English source; other locales fall back).

## Edge cases & risks

- **Onboarding selectors (highest risk).** Before deleting any markup, audit `src/components/Onboarding/` for selectors targeting removed elements (`.settings-header`, `.close-button`, `.mode-toggle`, `.mode-button`, `.logs-panel-header`, or `.tab-bar` if it expects a specific DOM position). The TitleBar `.settings-button` / `.logs-button` targets are preserved. Any onboarding step pointing at a removed node must be repointed (likely to the PanelBar tab or the TitleBar entry).
- **Settings deep-link / navigation target.** `settingsNavigationTarget` both opens the panel (handled in `MainLayout`) and selects a tab (effect lifted into `Settings.tsx`, guarded to Advanced as above). Verify a deep-link still switches to the correct Advanced tab when already in Advanced, and that arriving in Quick mode still highlights the section via `SimpleSettings`/`highlightSection` (no behavior change).
- **Esc handler conflicts.** Guard against closing while a `WarningModal`/dialog or floating popover is open (the `[role="dialog"]` check + `defaultPrevented`). Confirm no double-close with any global Esc handling.
- **Mobile (`<768px`).** The panel goes full-width and the mode-button labels hide (icon-only). Confirm the right cluster still fits and the empty-left Quick bar looks intentional.
- **macOS / extension TitleBar.** No in-app window controls there; the neutral-pill + focus-outline change is independent of window-control rendering and applies uniformly.
- **Collapse-icon discoverability.** `PanelRightClose` is less universally understood than `✕`; the `title`/`aria-label` tooltip plus Esc mitigate this. Acceptable given the mis-tap risk of the current arrow-under-`✕` arrangement.

## Testing

- **PanelBar unit (`PanelBar.test.tsx`):** renders TabBar when `tabs` given and omits it when not; renders the `actions` slot; clicking the collapse button calls `onClose`; `Escape` calls `onClose`; `Escape` is a no-op when a `[role="dialog"]` is present.
- **Settings:** PanelBar is present in both Quick and Advanced; `actions` (mode toggle) renders in both; switching modes does not unmount/remount the right cluster; Advanced shows tabs, Quick does not; existing `settingsStore.providerSettings.test` and `ModePicker.test` remain green.
- **Logs:** PanelBar replaces the old header; copy/clear appear only under their existing conditions; collapse calls `toggleLogs`.
- **TabBar.test.tsx:** unchanged behavior (component itself is untouched) — must still pass.
- **Manual/visual:** right-cluster pixel alignment across Quick⇄Advanced; single green location signal per screen; `:focus-visible` outline appears on keyboard nav only; Esc closes each panel; onboarding walkthrough still highlights valid targets; narrow-width and macOS/extension renders.
