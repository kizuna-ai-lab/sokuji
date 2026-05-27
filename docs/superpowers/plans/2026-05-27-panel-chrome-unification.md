# Panel Chrome Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke headers of the Settings and Logs side panels with one shared `PanelBar`, formalize a small active-state token system, and fix the arrow-close / three-greens / three-rows defects — without changing MainPanel.

**Architecture:** A new presentational `PanelBar` (`[tabs] ···· [actions] [collapse]`) is rendered by both `Settings` and `LogsPanel`. Settings lifts its category-tab state up from `AdvancedSettings` so the bar can own the tabs. Active-state styling is expressed through SCSS mixins in the existing `_variables.scss`; the only behavioral style change is neutralizing the TitleBar's active treatment (green outline → neutral pill; green outline reserved for `:focus-visible`).

**Tech Stack:** React + TypeScript, SCSS (`@use` modules), lucide-react icons, react-i18next, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-27-panel-chrome-unification-design.md`

**Convention:** Every commit message ends with the trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
(Subject lines shown per step; append the trailer to each.)

---

## File Structure

**Create:**
- `src/components/Settings/shared/PanelBar.tsx` — shared panel bar (tabs slot + actions slot + collapse + Esc). One responsibility: panel-top chrome layout.
- `src/components/Settings/shared/PanelBar.scss` — bar layout + relocated segmented `.mode-toggle` styles.
- `src/components/Settings/shared/PanelBar.test.tsx` — unit tests.

**Modify:**
- `src/components/Settings/shared/_variables.scss` — add `state-selected-underline` / `state-selected-fill` mixins.
- `src/components/Settings/shared/TabBar.scss` — use the underline mixin (no visual change).
- `src/components/Settings/Settings.tsx` — own PanelBar + lifted `TABS` / `NAVIGATION_TAB_MAP` / `activeTab` / nav-effect; build mode-toggle as the actions slot; drop the header block.
- `src/components/Settings/Settings.scss` — remove `.settings-header` / `.mode-toggle` / `.close-button` rules.
- `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx` — receive `activeTab` prop; drop its `TabBar`, `activeTab` state, nav effect, and the moved constants.
- `src/components/LogsPanel/LogsPanel.tsx` — adopt PanelBar; remove bespoke header + arrow-close.
- `src/components/LogsPanel/LogsPanel.scss` — remove header layout; keep action-button styles re-scoped.
- `src/components/TitleBar/TitleBar.scss` — neutral active pill + `:focus-visible` outline.
- `src/locales/en/translation.json` — add `common.collapsePanel`.

---

## Task 1: Audit selectors before deleting markup

This task removes risk before any deletion. Several elements are removed in Tasks 5–6 (`.settings-header`, `.close-button`, `.mode-toggle` location, `.logs-panel-header`, `.close-logs-button`). Onboarding and tests may target them.

**Files:** none modified (discovery only).

- [ ] **Step 1: Grep the codebase for soon-to-change selectors**

Run:
```bash
grep -rnE "settings-header|close-button|mode-toggle|mode-button|logs-panel-header|close-logs-button|header-actions" src/ \
  --include=*.ts --include=*.tsx --include=*.js --include=*.json | grep -vE "\.scss"
```

- [ ] **Step 2: Grep onboarding specifically for any of the removed targets**

Run:
```bash
grep -rnE "settings-button|logs-button|settings-header|close-button|tab-bar|mode-toggle|panel" src/components/Onboarding/
```

- [ ] **Step 3: Record findings as constraints**

Write the hit list into a scratch note (or the PR description later). Decision rule:
- `.settings-button` / `.logs-button` (TitleBar) — **preserved** by this plan; no action.
- Any onboarding step or test targeting `.settings-header`, `.close-button`, `.mode-button`, `.tab-bar`, `.logs-panel-header` — note it; Tasks 5–6 must repoint it (e.g., to `.panel-bar`, `.panel-bar .tab-bar__tab`, or the TitleBar entry). If onboarding targets none of them, state that explicitly so Tasks 5–6 can delete freely.

(No commit — discovery only.)

---

## Task 2: Active-state token mixins

**Files:**
- Modify: `src/components/Settings/shared/_variables.scss`
- Modify: `src/components/Settings/shared/TabBar.scss`

- [ ] **Step 1: Add the two state mixins to `_variables.scss`**

Append after the existing `focus-ring` mixin (after line 116, the closing `}` of `@mixin focus-ring`):

```scss
// --- Selection state (mutually-exclusive sets) ---------------
// green = the selected item. Form is fixed per control archetype:
//   tabs        → underline
//   segmented   → fill
//   focus       → outline (focus-ring above; :focus-visible only)
@mixin state-selected-underline {
  color: $color-primary;
  border-bottom: 2px solid $color-primary;
}

@mixin state-selected-fill {
  background: $color-primary;
  color: $text-primary;
}
```

- [ ] **Step 2: Refactor TabBar's active rule to use the mixin (no visual change)**

In `src/components/Settings/shared/TabBar.scss`, replace the `&--active` block:

```scss
    &--active {
      color: vars.$color-primary;
      border-bottom-color: vars.$color-primary;
    }
```

with:

```scss
    &--active {
      @include vars.state-selected-underline;
    }
```

(The base `.tab-bar__tab` keeps `border-bottom: 2px solid transparent`; the mixin overrides color+width identically.)

- [ ] **Step 3: Verify the project still builds (SCSS compiles)**

Run: `npm run build`
Expected: build succeeds, no SCSS errors. (CSS changes have no unit test; build is the gate.)

- [ ] **Step 4: Run the test suite to confirm no regressions**

Run: `npm run test`
Expected: PASS (same set as before this task).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/shared/_variables.scss src/components/Settings/shared/TabBar.scss
git commit -m "style(settings): add active-state token mixins; TabBar uses underline token"
```

---

## Task 3: PanelBar component (TDD)

**Files:**
- Create: `src/components/Settings/shared/PanelBar.tsx`
- Create: `src/components/Settings/shared/PanelBar.scss`
- Create: `src/components/Settings/shared/PanelBar.test.tsx`
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add the i18n key**

In `src/locales/en/translation.json`, inside the top-level `"common"` object, add after the `"close": "Close",` on line 6:

```json
    "collapsePanel": "Close panel",
```

- [ ] **Step 2: Write the failing test**

Create `src/components/Settings/shared/PanelBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PanelBar from './PanelBar';
import type { Tab } from './TabBar';

const TABS: Tab[] = [
  { id: 'general', labelKey: 'x.general', fallback: 'General' },
  { id: 'audio', labelKey: 'x.audio', fallback: 'Audio' },
];

describe('PanelBar', () => {
  it('renders tabs when provided', () => {
    render(<PanelBar tabs={TABS} activeTab="general" onTabChange={() => {}} onClose={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('renders no tabs when tabs is omitted', () => {
    render(<PanelBar onClose={() => {}} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('renders the actions slot', () => {
    render(<PanelBar actions={<button>my-action</button>} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'my-action' })).toBeInTheDocument();
  });

  it('calls onClose when the collapse button is clicked', () => {
    const onClose = vi.fn();
    render(<PanelBar onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<PanelBar onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when a dialog is open', () => {
    const onClose = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    render(<PanelBar onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(dialog);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/components/Settings/shared/PanelBar.test.tsx`
Expected: FAIL — cannot resolve `./PanelBar` (module does not exist yet).

- [ ] **Step 4: Implement `PanelBar.tsx`**

Create `src/components/Settings/shared/PanelBar.tsx`:

```tsx
import React, { useEffect } from 'react';
import { PanelRightClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TabBar, { Tab } from './TabBar';
import './PanelBar.scss';

interface PanelBarProps {
  /** Tab strip. Omit for tab-less panels (e.g. Settings Quick mode). */
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Panel-specific controls, rendered in the right cluster left of close. */
  actions?: React.ReactNode;
  /** Collapse the panel. */
  onClose: () => void;
}

const PanelBar: React.FC<PanelBarProps> = ({ tabs, activeTab, onTabChange, actions, onClose }) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Don't steal Escape from an open modal/dialog or floating popover.
      if (document.querySelector('[role="dialog"]')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const hasTabs = tabs && activeTab !== undefined && onTabChange;

  return (
    <div className="panel-bar">
      {hasTabs ? (
        <TabBar tabs={tabs!} activeTab={activeTab!} onTabChange={onTabChange!} />
      ) : (
        <span className="panel-bar__spacer" />
      )}
      <div className="panel-bar__actions">
        {actions}
        <button
          type="button"
          className="panel-bar__close"
          onClick={onClose}
          title={t('common.collapsePanel', 'Close panel')}
          aria-label={t('common.collapsePanel', 'Close panel')}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
    </div>
  );
};

export default PanelBar;
```

- [ ] **Step 5: Implement `PanelBar.scss`**

Create `src/components/Settings/shared/PanelBar.scss`:

```scss
@use 'variables' as vars;

.panel-bar {
  display: flex;
  align-items: center;
  padding: 0 15px;
  border-bottom: 1px solid vars.$border-subtle;
  flex-shrink: 0;

  // TabBar provides its own item styling; the bar owns padding + the divider.
  .tab-bar {
    border-bottom: none;
    padding: 0;
    flex: 0 1 auto;
  }

  &__spacer {
    flex: 1;
  }

  &__actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: vars.$space-3;
    padding: vars.$space-2 0;
  }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-left: 1px solid vars.$border-subtle;
    color: vars.$text-muted;
    cursor: pointer;
    padding: 6px 6px 6px 12px;
    transition: color vars.$transition-fast;

    &:hover { color: vars.$text-primary; }
    &:focus-visible { @include vars.focus-ring; }
  }

  // Segmented mode toggle (relocated from Settings.scss).
  .mode-toggle {
    display: flex;
    background: vars.$bg-page;
    border-radius: vars.$radius-md;
    padding: 2px;
    gap: 2px;

    .mode-button {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-radius: vars.$radius-sm;
      color: vars.$text-muted;
      font-size: vars.$font-caption;
      font-weight: 500;
      cursor: pointer;
      transition: all vars.$transition-fast;

      svg { width: 14px; height: 14px; }

      &:hover:not(:disabled):not(.active) {
        color: vars.$text-secondary;
        background: rgba(255, 255, 255, 0.05);
      }

      &.active { @include vars.state-selected-fill; }
      &:disabled { @include vars.disabled-state; }
      &:focus-visible { @include vars.focus-ring; }
    }
  }

  @media (max-width: 768px) {
    .mode-toggle .mode-button {
      padding: 6px 8px;
      span { display: none; }
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- src/components/Settings/shared/PanelBar.test.tsx`
Expected: PASS (all 6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/shared/PanelBar.tsx src/components/Settings/shared/PanelBar.scss src/components/Settings/shared/PanelBar.test.tsx src/locales/en/translation.json
git commit -m "feat(settings): add shared PanelBar component with Esc-to-close"
```

---

## Task 4: Neutralize the TitleBar active state

**Files:**
- Modify: `src/components/TitleBar/TitleBar.scss`

- [ ] **Step 1: Replace the active rule and add a focus-visible outline**

In `src/components/TitleBar/TitleBar.scss`, replace the `&.is-active` block inside `.title-bar__action`:

```scss
  &.is-active {
    background: rgba(255, 255, 255, 0.12);
    border-color: #10a37f;
    color: #fff;
  }
```

with (drop the green border; brighten the neutral pill; reserve green for focus):

```scss
  &.is-active {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #10a37f;
    outline-offset: -1px;
  }
```

(The base `.title-bar__action` keeps `border: 1px solid transparent`, so layout is unchanged when the border color is no longer set.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success, no SCSS errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TitleBar/TitleBar.scss
git commit -m "style(titlebar): neutral active pill; reserve green outline for focus"
```

---

## Task 5: Settings adopts PanelBar (lift tab state)

**Files:**
- Modify: `src/components/Settings/Settings.tsx`
- Modify: `src/components/Settings/Settings.scss`
- Modify: `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx`

- [ ] **Step 1: Rewrite `Settings.tsx`**

Replace the entire contents of `src/components/Settings/Settings.tsx` with:

```tsx
import React, { useState, useEffect } from 'react';
import { LayoutGrid, Sliders, Settings as SettingsIcon, Headphones, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIMode, useSetUIMode, useNavigateToSettings, useSettingsNavigationTarget } from '../../stores/settingsStore';
import { useIsSessionActive } from '../../stores/sessionStore';
import { useAnalytics } from '../../lib/analytics';
import SimpleSettings from './SimpleSettings/SimpleSettings';
import AdvancedSettings from './AdvancedSettings/AdvancedSettings';
import PanelBar from './shared/PanelBar';
import type { Tab } from './shared/TabBar';
import './Settings.scss';

interface SettingsProps {
  toggleSettings?: () => void;
  /** External highlight section prop */
  highlightSection?: string | null;
}

const TABS: Tab[] = [
  { id: 'general', labelKey: 'settings.tabs.general', fallback: 'General', icon: SettingsIcon },
  { id: 'audio', labelKey: 'settings.tabs.audio', fallback: 'Audio', icon: Headphones },
  { id: 'provider', labelKey: 'settings.tabs.provider', fallback: 'Provider', icon: Cpu },
];

const NAVIGATION_TAB_MAP: Record<string, string> = {
  'user-account': 'general',
  'languages': 'general',
  'microphone': 'audio',
  'speaker': 'audio',
  'system-audio': 'audio',
  'participant': 'audio',
  'provider': 'provider',
  'system-instructions': 'provider',
  'voice-settings': 'provider',
  'turn-detection': 'provider',
  'model-management': 'provider',
  'model-asr': 'provider',
  'model-translation': 'provider',
  'model-tts': 'provider',
};

const Settings: React.FC<SettingsProps> = ({ toggleSettings, highlightSection }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const isSessionActive = useIsSessionActive();

  const uiMode = useUIMode();
  const setUIMode = useSetUIMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // 'basic' maps to Simple/Quick, 'advanced' maps to Advanced.
  const isSimpleMode = uiMode === 'basic';

  const [activeTab, setActiveTab] = useState('general');

  // Advanced-only: switch to the target tab and scroll/highlight its section.
  // Quick mode highlights via SimpleSettings' highlightSection instead.
  useEffect(() => {
    if (isSimpleMode) return;
    if (settingsNavigationTarget) {
      const targetTab = NAVIGATION_TAB_MAP[settingsNavigationTarget];
      if (targetTab && targetTab !== activeTab) {
        setActiveTab(targetTab);
      }
      setTimeout(() => {
        const element = document.getElementById(`${settingsNavigationTarget}-section`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          element.classList.add('highlight');
          setTimeout(() => {
            element.classList.remove('highlight');
            navigateToSettings(null);
          }, 3000);
        }
      }, 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsNavigationTarget, navigateToSettings, isSimpleMode]);

  const handleModeToggle = () => {
    const newMode = isSimpleMode ? 'advanced' : 'basic';
    setUIMode(newMode);
    trackEvent('settings_mode_switched', {
      from_mode: uiMode,
      to_mode: newMode,
      during_session: isSessionActive,
    });
  };

  const modeToggle = (
    <div className="mode-toggle">
      <button
        className={`mode-button ${isSimpleMode ? 'active' : ''}`}
        onClick={() => !isSimpleMode && handleModeToggle()}
        title={t('settings.simpleMode', 'Simple')}
      >
        <LayoutGrid size={14} />
        <span>{t('settings.simple', 'Simple')}</span>
      </button>
      <button
        className={`mode-button ${!isSimpleMode ? 'active' : ''}`}
        onClick={() => isSimpleMode && handleModeToggle()}
        title={t('settings.advancedMode', 'Advanced')}
      >
        <Sliders size={14} />
        <span>{t('settings.advanced', 'Advanced')}</span>
      </button>
    </div>
  );

  return (
    <div className="settings-container">
      <PanelBar
        tabs={isSimpleMode ? undefined : TABS}
        activeTab={isSimpleMode ? undefined : activeTab}
        onTabChange={isSimpleMode ? undefined : setActiveTab}
        actions={modeToggle}
        onClose={toggleSettings ?? (() => {})}
      />

      <div className="settings-body">
        {isSimpleMode ? (
          <SimpleSettings highlightSection={highlightSection || settingsNavigationTarget} />
        ) : (
          <AdvancedSettings toggleSettings={toggleSettings} activeTab={activeTab} />
        )}
      </div>
    </div>
  );
};

export default Settings;
```

- [ ] **Step 2: Remove the old header styles from `Settings.scss`**

In `src/components/Settings/Settings.scss`, delete the entire `.settings-header { ... }` block (the block beginning `.settings-header {` and ending with its matching `}` — it contains `h2`, `.header-actions`, `.mode-toggle`, and `.close-button`). Keep `.settings-container`, `.settings-body`, and everything below.

Then, in the responsive section at the bottom, delete the now-dangling `.header-actions .mode-toggle .mode-button` override (the `@media (max-width: 768px)` rule's `.settings-container .settings-header ...` nest), since that responsive behavior now lives in `PanelBar.scss`. Leave the `.language-pair-row` part of that media query intact.

- [ ] **Step 3: Update `AdvancedSettings.tsx` to consume `activeTab` as a prop**

Apply these edits to `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx`:

(a) Line 1 — drop `useEffect`:
```tsx
import React, { useState } from 'react';
```

(b) Line 2 — drop the tab icons (`Settings`, `Headphones`, `Cpu`), keep `AlertCircle`:
```tsx
import { AlertCircle } from 'lucide-react';
```

(c) In the settingsStore import block (lines 6–15) remove `useSettingsNavigationTarget` and `useNavigateToSettings` (they were only used by the moved effect). Result:
```tsx
import {
  useProvider,
  useAvailableModels,
  useLoadingModels,
  useFetchAvailableModels,
  useGetProcessedSystemInstructions,
  useCurrentTurnDetectionMode,
} from '../../../stores/settingsStore';
```

(d) Remove the `TabBar` import (line 20). It is no longer used here.

(e) Delete the `TABS` constant (lines 33–37) and the `NAVIGATION_TAB_MAP` constant (lines 39–54) — they moved to `Settings.tsx`.

(f) Extend the props to accept `activeTab` and destructure it:
```tsx
interface AdvancedSettingsProps {
  toggleSettings?: () => void;
  activeTab: string;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ toggleSettings, activeTab }) => {
```

(g) Delete the local tab state line `const [activeTab, setActiveTab] = useState('general');` (line 107). Keep the other `useState` lines (`isPreviewExpanded`, `warningType`).

(h) Delete the navigation `useEffect` block (lines 102–132: the `settingsNavigationTarget` / `navigateToSettings` consts and the whole effect).

(i) Delete the `<TabBar tabs={TABS} ... />` line (line 149). The `settings-content` tabpanel `<div>` immediately below stays and still reads `activeTab` (now the prop).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `activeTab` prop wiring, removed imports, and that no dangling reference to `setActiveTab`/`TABS`/`NAVIGATION_TAB_MAP` remains in `AdvancedSettings`.)

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: build succeeds; test suite PASS (PanelBar tests included; existing `settingsStore.providerSettings.test` unaffected).

- [ ] **Step 6: Repoint any onboarding/test targets found in Task 1**

If Task 1 found references to `.settings-header`, `.close-button`, or `.mode-toggle` (as a location target), update them now to `.panel-bar` / `.panel-bar .mode-toggle`. If Task 1 found none, skip.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/Settings.tsx src/components/Settings/Settings.scss src/components/Settings/AdvancedSettings/AdvancedSettings.tsx
git commit -m "refactor(settings): adopt PanelBar; lift tab state out of AdvancedSettings"
```

---

## Task 6: LogsPanel adopts PanelBar

**Files:**
- Modify: `src/components/LogsPanel/LogsPanel.tsx`
- Modify: `src/components/LogsPanel/LogsPanel.scss`

- [ ] **Step 1: Swap imports in `LogsPanel.tsx`**

Line 2 — remove `ArrowRight` (used only by the old close):
```tsx
import { Terminal, Trash2, ArrowUp, ArrowDown, FastForward, Mic, Users, ClipboardCopy } from 'lucide-react';
```

Line 3 — keep the `Tab` type but import `PanelBar` and stop importing `TabBar` as a value:
```tsx
import PanelBar from '../Settings/shared/PanelBar';
import type { Tab } from '../Settings/shared/TabBar';
```

- [ ] **Step 2: Replace the header + standalone TabBar with PanelBar**

In the `return` of `LogsPanel`, replace this block (the `.logs-panel-header` div through the `<TabBar ... />`, currently lines 266–299):

```tsx
      <div className="logs-panel-header">
        <h2>{t('logsPanel.title')}</h2>
        <div className="header-actions">
          <button
            className={`auto-scroll-button ${autoScroll ? 'active' : ''}`}
            onClick={toggleAutoScroll}
            title={autoScroll ? t('logsPanel.disableAutoScroll') : t('logsPanel.enableAutoScroll')}
          >
            <FastForward size={16} />
            <span>{autoScroll ? t('logsPanel.autoScrollOn') : t('logsPanel.autoScrollOff')}</span>
          </button>
          {filteredLogs.length > 0 && (
            <button className="copy-logs-button" onClick={handleCopyLogs}>
              <ClipboardCopy size={16} />
              <span>{copyLabel || t('logsPanel.copyLogs')}</span>
            </button>
          )}
          {logs.length > 0 && (
            <button className="clear-logs-button" onClick={clearLogs}>
              <Trash2 size={16} />
              <span>{t('common.clear')}</span>
            </button>
          )}
          <button className="close-logs-button" onClick={toggleLogs}>
            <ArrowRight size={16} />
            <span>{t('common.close')}</span>
          </button>
        </div>
      </div>
      <TabBar
        tabs={LOG_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ClientId)}
      />
```

with:

```tsx
      <PanelBar
        tabs={LOG_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ClientId)}
        onClose={toggleLogs}
        actions={
          <div className="logs-actions">
            <button
              className={`auto-scroll-button ${autoScroll ? 'active' : ''}`}
              onClick={toggleAutoScroll}
              title={autoScroll ? t('logsPanel.disableAutoScroll') : t('logsPanel.enableAutoScroll')}
            >
              <FastForward size={16} />
              <span>{autoScroll ? t('logsPanel.autoScrollOn') : t('logsPanel.autoScrollOff')}</span>
            </button>
            {filteredLogs.length > 0 && (
              <button className="copy-logs-button" onClick={handleCopyLogs}>
                <ClipboardCopy size={16} />
                <span>{copyLabel || t('logsPanel.copyLogs')}</span>
              </button>
            )}
            {logs.length > 0 && (
              <button className="clear-logs-button" onClick={clearLogs}>
                <Trash2 size={16} />
                <span>{t('common.clear')}</span>
              </button>
            )}
          </div>
        }
      />
```

- [ ] **Step 3: Re-scope the button styles in `LogsPanel.scss`**

In `src/components/LogsPanel/LogsPanel.scss`:

(a) Delete the `.logs-panel-header { ... }` block's outer wrapper rules (the `display/justify-content/padding/border-bottom` and the `h2` and `.header-actions` layout) **but keep** the three action-button style blocks (`.auto-scroll-button`, `.copy-logs-button`, `.clear-logs-button`). Move those three button blocks so they are nested under `.logs-panel .logs-actions` instead of `.logs-panel .logs-panel-header .header-actions`.

(b) Delete the `.close-logs-button { ... }` block entirely (the collapse button now comes from `PanelBar`).

(c) Add a small flex container rule for the relocated actions:
```scss
  .logs-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
```

(Keep `.auto-scroll-button.active` using its existing green; it represents a binary "on" toggle, consistent with `state-selected-fill`. Leaving it as-is is acceptable — no visual change required.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `ArrowRight`/`TabBar` value import removed cleanly and `Tab` type still resolves for `LOG_TABS`).

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: build succeeds; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/LogsPanel/LogsPanel.tsx src/components/LogsPanel/LogsPanel.scss
git commit -m "refactor(logs): adopt shared PanelBar; drop arrow-close header"
```

---

## Task 7: Full verification & manual checklist

**Files:** none (verification only).

- [ ] **Step 1: Typecheck, build, and test the whole project**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: all green.

- [ ] **Step 2: Run the app and walk the manual checklist**

Run: `npm run electron:dev` (or `npm run dev` for the extension build), open Settings, and verify:
- **Settings · Advanced:** one row of tabs + `Quick/Advanced` toggle + collapse icon; only the active tab shows green (underline); TitleBar `Settings` entry is a neutral pill (no green outline).
- **Settings · Quick:** no tabs on the left; the `Quick/Advanced` toggle + collapse icon are in the **same horizontal position** as in Advanced (toggle Quick⇄Advanced and confirm the right cluster does not move).
- **Close:** the collapse icon closes the panel; **Esc** closes the panel; opening a WarningModal and pressing **Esc** closes the modal (not the panel).
- **Deep-link:** trigger a "navigate to setting" path (e.g. from the footer/popover) and confirm Advanced switches to the right tab and scrolls/highlights; in Quick mode the section still highlights via `SimpleSettings`.
- **Logs:** same PanelBar grammar — client tabs + autoscroll/copy/clear + collapse; copy/clear appear only when logs exist; collapse + Esc close it.
- **Keyboard focus:** Tab through the TitleBar entries and panel controls; the green outline appears only on `:focus-visible`.
- **Narrow width / mobile:** shrink below 768px — mode-button text labels hide (icon-only); the right cluster still fits.

- [ ] **Step 3: Confirm onboarding still highlights valid targets**

Restart onboarding (Settings → Help → restart onboarding) and confirm every step points at an element that still exists (especially any step that previously targeted the Settings header / mode toggle / tabs). Fix repointing if a step lands on nothing.

- [ ] **Step 4: Final commit if any fixes were made in Steps 2–3**

```bash
git add -A
git commit -m "fix(panel-chrome): address manual-verification findings"
```

(Skip if no changes were needed.)
