# Compact Conversation Mode + Role-Colored Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar toggle that strips chat chrome from the conversation panel (subtitle-style reading), and make the translation language badge color-code by role (green for speaker, orange for participant) so role attribution stays obvious in both expanded and compact modes.

**Architecture:** One new boolean setting (`conversationCompactMode`) persisted via the existing settings-service pattern. Rendering changes are localized to `ConversationRow` (hides chrome, renders a 6px role dot on first-of-run) and a new toolbar button in `MainPanel`. Role color coding is pure CSS keyed off a new `source-<role>` class. No new components, no new state machines.

**Tech Stack:** React 18 + TypeScript, Zustand (`settingsStore`), SCSS, lucide-react icons, i18next, Vitest + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-04-18-compact-conversation-mode-design.md`

---

## File Structure

**Modified files:**
- `src/stores/settingsStore.ts` — new field, default, action, loader, hooks
- `src/components/MainPanel/ConversationRow.tsx` — `compact` prop, role dot, badge class
- `src/components/MainPanel/ConversationRow.scss` — role-dot styles, badge color by role, compact body padding
- `src/components/MainPanel/MainPanel.tsx` — toolbar button, wire `compact` prop
- `src/components/MainPanel/MainPanel.scss` — new toolbar button style (if needed, else reuse `.font-size-btn`)
- `src/locales/en/translation.json` — two new strings

**New files:**
- `src/components/MainPanel/ConversationRow.test.tsx` — component tests (first component test in the project; sets the pattern)

---

## Task 1: Add `conversationCompactMode` to the settings store

**Files:**
- Modify: `src/stores/settingsStore.ts`

This follows the exact same pattern as `conversationFontSize`: a field on `CommonSettings`, a default value, an async setter with rollback-on-failure, a persistence load in `initializeSettings`, and two selector hooks.

- [ ] **Step 1: Add field to `CommonSettings` interface**

In `src/stores/settingsStore.ts`, find the `CommonSettings` interface (around line 29). Add the new field directly after `conversationFontSize`:

```ts
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
  participantSystemInstructions: string;
  textOnly: boolean;
  conversationFontSize: number;
  conversationCompactMode: boolean;   // NEW
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;
}
```

- [ ] **Step 2: Add default value**

In `defaultCommonSettings` (around line 148), add the default right after `conversationFontSize: 14,`:

```ts
const defaultCommonSettings: CommonSettings = {
  // ...
  conversationFontSize: 14,
  conversationCompactMode: false,   // NEW
  // ...
  speakerDisplayMode: 'both',
  participantDisplayMode: 'both',
};
```

- [ ] **Step 3: Add field to store state interface**

Find the block around line 348 where the top-level store state interface lists the same fields. Add the field next to `conversationFontSize`:

```ts
  // Conversation font size
  conversationFontSize: number;

  // Conversation compact mode — hide chat chrome (avatars, names, timestamps, badges, play button) in the conversation panel
  conversationCompactMode: boolean;

  // Conversation display mode filters
  speakerDisplayMode: DisplayMode;
```

- [ ] **Step 4: Add action signature**

Find the actions block (around line 360). Add the setter signature right after `setConversationFontSize`:

```ts
  setConversationFontSize: (size: number) => void;
  setConversationCompactMode: (compact: boolean) => Promise<void>;
  setSpeakerDisplayMode: (mode: DisplayMode) => Promise<void>;
```

- [ ] **Step 5: Implement the action**

Find `setConversationFontSize` implementation (around line 715). Add the new action immediately after it, mirroring its shape exactly:

```ts
    setConversationCompactMode: async (conversationCompactMode) => {
      const previous = get().conversationCompactMode;
      set({conversationCompactMode});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.conversationCompactMode', conversationCompactMode);
      } catch (error) {
        console.error('[SettingsStore] Error persisting conversationCompactMode setting:', error);
        set({conversationCompactMode: previous});
      }
    },
```

- [ ] **Step 6: Load the setting on initialization**

In `loadSettings` (search for the line `const conversationFontSize = await service.getSetting(` around line 1203), add the new load line immediately after it:

```ts
const conversationFontSize = await service.getSetting('settings.common.conversationFontSize', defaultCommonSettings.conversationFontSize);
const conversationCompactMode = await service.getSetting('settings.common.conversationCompactMode', defaultCommonSettings.conversationCompactMode);
```

Then find the `set({...})` block that applies loaded settings (search for `conversationFontSize,` around line 1239) and add the new key right after it:

```ts
          conversationFontSize,
          conversationCompactMode,
          speakerDisplayMode,
          participantDisplayMode,
```

- [ ] **Step 7: Export selector hooks**

Find the hooks section (around line 1376, `useConversationFontSize`). Add the new hook right after it:

```ts
export const useConversationFontSize = () => useSettingsStore((state) => state.conversationFontSize);
export const useConversationCompactMode = () => useSettingsStore((state) => state.conversationCompactMode);
```

Then find `useSetConversationFontSize` (around line 1426). Add its counterpart right after:

```ts
export const useSetConversationFontSize = () => useSettingsStore((state) => state.setConversationFontSize);
export const useSetConversationCompactMode = () => useSettingsStore((state) => state.setConversationCompactMode);
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add conversationCompactMode to common settings

Boolean flag persisted via settings service, default off, mirrors the
conversationFontSize pattern exactly (field, default, action with
rollback, loader, two selector hooks)."
```

---

## Task 2: Add i18n strings

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add compact/expanded view tooltips**

Find the `mainPanel` block (around line 500+). Look for `"increaseFontSize": "Increase font size",` (line 528). Add two new keys right after:

```json
    "clearConversation": "Clear conversation",
    "decreaseFontSize": "Decrease font size",
    "increaseFontSize": "Increase font size",
    "compactView": "Compact view",
    "expandedView": "Expanded view",
    "displayMode": {
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(en): add compactView/expandedView strings for main panel toolbar"
```

---

## Task 3: Write failing tests for `ConversationRow`

**Files:**
- Create: `src/components/MainPanel/ConversationRow.test.tsx`

This is the first React component test in the project. It establishes the pattern: vitest + @testing-library/react + a lightweight `react-i18next` mock.

- [ ] **Step 1: Create the test file**

Create `src/components/MainPanel/ConversationRow.test.tsx` with this full content:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import ConversationRow from './ConversationRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

type RowItem = ConversationItem & { source?: 'speaker' | 'participant' };

function makeItem(over: Partial<RowItem>): RowItem {
  return {
    id: 'i1',
    role: 'user',
    type: 'message',
    status: 'completed',
    formatted: { text: 'hello' },
    source: 'speaker',
    createdAt: 1700000000000,
    ...over,
  } as RowItem;
}

const baseProps = {
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  isPlaying: false,
  highlightedChars: 0,
};

describe('ConversationRow — expanded (default) mode', () => {
  it('renders the row header when there is no previous item', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.row-header')).not.toBeNull();
  });

  it('renders the lang-badge', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.lang-badge')).not.toBeNull();
  });

  it('renders the row play button when canPlay is true', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
      />,
    );
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
  });

  it('does not render a role dot in expanded mode', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.row-role-dot')).toBeNull();
  });

  it('tags the translation badge with source-speaker on speaker rows', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', role: 'assistant' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.tr');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('source-speaker')).toBe(true);
  });

  it('tags the translation badge with source-participant on participant rows', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant', role: 'assistant' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.tr');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('source-participant')).toBe(true);
  });

  it('tags the source badge with source-<role> too (for future theming)', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant', role: 'user' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.src');
    expect(badge?.classList.contains('source-participant')).toBe(true);
  });
});

describe('ConversationRow — compact mode', () => {
  it('hides the row header', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    expect(container.querySelector('.row-header')).toBeNull();
  });

  it('hides the lang-badge', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    expect(container.querySelector('.lang-badge')).toBeNull();
  });

  it('hides the row play button even when canPlay is true', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
        compact
      />,
    );
    expect(container.querySelector('.row-play-btn')).toBeNull();
  });

  it('renders a speaker-colored role dot on the first row of a speaker run', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    const dot = container.querySelector('.row-role-dot');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('source-speaker')).toBe(true);
  });

  it('renders a participant-colored role dot on the first row of a participant run', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant' })}
        prevItem={makeItem({ source: 'speaker' })}
        compact
      />,
    );
    const dot = container.querySelector('.row-role-dot');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('source-participant')).toBe(true);
  });

  it('does NOT render a role dot when prevItem has the same source', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', id: 'b' })}
        prevItem={makeItem({ source: 'speaker', id: 'a' })}
        compact
      />,
    );
    expect(container.querySelector('.row-role-dot')).toBeNull();
  });

  it('adds a compact class on the root element', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    const root = container.querySelector('.conversation-row');
    expect(root?.classList.contains('compact')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (red phase)**

Run: `npx vitest run src/components/MainPanel/ConversationRow.test.tsx`
Expected: FAIL. The existing tests that match current behavior (header/badge/play button in expanded mode) should pass. The new assertions will fail:
- `source-speaker` / `source-participant` classes on badges (not yet added)
- `compact` prop is ignored (currently not a prop) → compact-mode tests fail because header/badge/button are still rendered and `.row-role-dot` is never rendered
- `.compact` class on root not present

Confirm the failures before moving on. The test count you should see is 14 total; roughly 3 pass (header/badge/play in expanded mode), 11 fail.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/components/MainPanel/ConversationRow.test.tsx
git commit -m "test(conversation-row): failing tests for compact mode + role-colored badge"
```

---

## Task 4: Implement `ConversationRow` changes

**Files:**
- Modify: `src/components/MainPanel/ConversationRow.tsx`

- [ ] **Step 1: Update the props interface**

In `ConversationRow.tsx`, change the `ConversationRowProps` interface to add `compact`:

```ts
interface ConversationRowProps {
  item: ConversationItem & { source?: 'speaker' | 'participant' };
  prevItem?: (ConversationItem & { source?: 'speaker' | 'participant' }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  isPlaying: boolean;
  highlightedChars: number;
  canPlay?: boolean;
  onPlay?: () => void;
  playDisabled?: boolean;
  compact?: boolean;
}
```

- [ ] **Step 2: Accept `compact` in the component signature**

Add the destructured prop with a default:

```tsx
const ConversationRow: React.FC<ConversationRowProps> = ({
  item,
  prevItem,
  sourceLanguage,
  targetLanguage,
  isPlaying,
  highlightedChars,
  canPlay = false,
  onPlay,
  playDisabled = false,
  compact = false,
}) => {
```

- [ ] **Step 3: Rewrite the returned JSX**

Replace the entire `return ( ... )` block at the bottom of the component with:

```tsx
  return (
    <div
      className={`conversation-row source-${source} ${showHeader ? 'with-header' : 'grouped'} ${compact ? 'compact' : 'expanded'}`}
    >
      {!compact && showHeader && (
        <div className="row-header">
          <div className={`row-avatar avatar-${source}`}>
            {source === 'speaker' ? <User size={12} /> : <Users size={12} />}
          </div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.createdAt)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${isPlaying ? 'playing' : ''}`}>
        {compact && showHeader && (
          <span className={`row-role-dot source-${source}`} aria-hidden="true" />
        )}
        {!compact && (
          <span className={`lang-badge ${isTranslation ? 'tr' : 'src'} source-${source}`}>
            {lang.toUpperCase()}
          </span>
        )}
        <span className={`row-text ${isTranslation ? 'tr' : 'src'}`}>{renderText()}</span>
        {!compact && canPlay && onPlay && (
          <button
            type="button"
            className={`row-play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={onPlay}
            disabled={playDisabled}
            aria-label={t('mainPanel.playItemAudio', 'Play this item\'s audio')}
            title={t('mainPanel.playItemAudio', 'Play this item\'s audio')}
          >
            <Play size={10} />
          </button>
        )}
      </div>
    </div>
  );
```

Key changes vs the original:
- Root element gains `compact` / `expanded` class.
- `row-header` is rendered only when `!compact && showHeader`.
- `row-role-dot` is rendered only when `compact && showHeader`, inside `row-body` so it can absolute-position relative to it.
- `lang-badge` is rendered only when `!compact`, and gains the `source-<source>` class.
- `row-play-btn` is rendered only when `!compact && canPlay && onPlay`.

- [ ] **Step 4: Run the tests to verify they pass (green phase)**

Run: `npx vitest run src/components/MainPanel/ConversationRow.test.tsx`
Expected: PASS. All 14 tests pass.

If any fail: re-read the failing assertion, compare to the JSX you wrote. Don't change the test, change the component.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/ConversationRow.tsx
git commit -m "feat(conversation-row): compact mode + role-colored badge class

Adds compact prop that hides header, language badge, and row-level play
button. When compact + first-of-run, renders a 6px role dot sourced by
speaker/participant. In both modes, tags the language badge with
source-<role> so CSS can color speaker vs participant translations."
```

---

## Task 5: Add SCSS rules

**Files:**
- Modify: `src/components/MainPanel/ConversationRow.scss`

The styling lives in the row's own SCSS — role dot, role-colored translation badge, and compact-mode layout tweaks all belong here. Toolbar-button styling is handled in Task 6 by reusing the existing `.font-size-btn` class.

- [ ] **Step 1: Replace the `.lang-badge` rule block**

Find the existing `.lang-badge` block (around line 80). Replace it with:

```scss
.lang-badge {
  flex-shrink: 0;
  font-size: 0.55rem;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;

  &.src {
    background: #2a2a2a;
    color: #9aa0a6;
    border: 1px solid #3a3a3a;
  }

  &.tr {
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
}
```

- [ ] **Step 2: Add role-dot and compact-mode body rules**

Append these blocks to the end of `ConversationRow.scss`:

```scss
.row-role-dot {
  position: absolute;
  left: 2px;
  top: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;

  &.source-speaker {
    background: #10a37f;
  }

  &.source-participant {
    background: #f39c12;
  }
}

.conversation-row.compact {
  .row-body {
    position: relative;
    padding-left: 16px;
  }

  // Compact disables the grouped indent that normally aligns text under the header.
  &.grouped .row-body {
    padding-left: 16px;
  }
}
```

- [ ] **Step 3: Build to verify no SCSS errors**

Run: `npm run build`
Expected: build completes without SCSS compile errors. If you don't want to wait for the full build, `npx vite build` is equivalent. Alternatively run the dev server: `npm run dev` and open the app — any SCSS error surfaces in the console.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/ConversationRow.scss
git commit -m "style(conversation-row): role-colored translation badge + compact layout

Splits .lang-badge.tr into source-speaker (green) and source-participant
(orange) variants. Adds .row-role-dot (6px circle, positioned absolutely
inside .row-body) and compact padding rules."
```

---

## Task 6: MainPanel toolbar button + wire `compact` prop

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Import the new icons**

Find the `lucide-react` import line (line 2):

```tsx
import {X, Zap, Mic, MicOff, Loader, Play, Volume2, VolumeX, Wrench, Send, AlertCircle, MessageSquare, Trash2, AArrowDown, AArrowUp} from 'lucide-react';
```

Replace with:

```tsx
import {X, Zap, Mic, MicOff, Loader, Play, Volume2, VolumeX, Wrench, Send, AlertCircle, MessageSquare, Trash2, AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown} from 'lucide-react';
```

- [ ] **Step 2: Read the compact state in the component body**

Find where other settings hooks are read (search for `conversationFontSize` — there should be lines like `const conversationFontSize = useConversationFontSize();` and a corresponding setter). Add the new hook calls next to them. If `useConversationCompactMode` is not already imported from `../../stores/settingsStore`, add it to the existing import list:

```tsx
// In the existing import from settingsStore, add:
useConversationCompactMode,
useSetConversationCompactMode,
```

Then in the component body:

```tsx
const conversationCompactMode = useConversationCompactMode();
const setConversationCompactMode = useSetConversationCompactMode();
```

- [ ] **Step 3: Insert the toolbar button**

Find the toolbar JSX (around line 2693). Locate the block that renders the two font-size buttons, then the trash button. Insert the new compact toggle **between the two font-size buttons and the trash button**:

```tsx
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.min(28, conversationFontSize + 2))}
              disabled={conversationFontSize >= 28}
              title={t('mainPanel.increaseFontSize', 'Increase font size')}
              aria-label={t('mainPanel.increaseFontSize', 'Increase font size')}
              type="button"
            >
              <AArrowUp size={14} />
            </button>
            {/* NEW: compact/expanded toggle */}
            <button
              className="font-size-btn"
              onClick={() => setConversationCompactMode(!conversationCompactMode)}
              title={
                conversationCompactMode
                  ? t('mainPanel.expandedView', 'Expanded view')
                  : t('mainPanel.compactView', 'Compact view')
              }
              aria-label={
                conversationCompactMode
                  ? t('mainPanel.expandedView', 'Expanded view')
                  : t('mainPanel.compactView', 'Compact view')
              }
              type="button"
            >
              {conversationCompactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
            <button
              className="clear-conversation-btn"
              onClick={clearConversation}
```

Reusing `.font-size-btn` is intentional — it gives matching hover/padding without a new SCSS rule.

- [ ] **Step 4: Pass `compact` prop down to `ConversationRow`**

Find the `<ConversationRow` invocation inside `renderConversationItem` (around line 2599). Add the `compact` prop:

```tsx
      return (
        <ConversationRow
          key={`${(item as any).source || 'speaker'}_${item.id || index}`}
          item={item}
          prevItem={prevItem as (ConversationItem & { source?: 'speaker' | 'participant' }) | null}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          isPlaying={isItemPlaying}
          highlightedChars={highlightedChars}
          canPlay={canPlay}
          onPlay={() => handlePlayAudio(item)}
          playDisabled={playingItemId !== null && !isItemPlaying}
          compact={conversationCompactMode}
        />
      );
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (your new ConversationRow tests + existing tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(main-panel): compact/expanded toolbar toggle

Adds a state-driven icon button (ChevronsDownUp in expanded mode,
ChevronsUpDown in compact mode) between the font-size buttons and the
clear button. Wires conversationCompactMode through to ConversationRow."
```

---

## Task 7: Manual verification

**Files:** none (run-and-click validation in the dev server).

Agentic workers: if you do not have a human operator available, skip the click-through and treat the automated tests + type check as sufficient evidence of correctness. Mark this task complete after running the two commands below.

- [ ] **Step 1: Start the dev server**

Run: `npm run electron:dev` (desktop) or `npm run dev` (web — faster for UI-only verification).

- [ ] **Step 2: Click through the verification checklist**

Start a translation session with both speaker and participant turns, then:

1. Toolbar button appears between the font-size buttons and the trash button.
2. Icon is `ChevronsDownUp` while expanded.
3. Click it → icon becomes `ChevronsUpDown`; conversation collapses to compact:
   - No avatars, names, or timestamps.
   - No `ZH` / `EN` badges.
   - No row-level ▶ buttons.
   - First row of each speaker/participant run has a 6px green / orange dot before the text.
   - No horizontal divider between role switches.
4. Click again → expanded view returns exactly as before.
5. Reload the app → previously-selected mode is restored (persistence works).
6. In expanded mode, the translation badge (`.lang-badge.tr`) is green on speaker rows and orange on participant rows.
7. The source badge (`.lang-badge.src`) stays gray on both.
8. Font size buttons and the trash button still work in both modes.
9. Speaker / participant display-mode filters (两者 / 原文 / 译文) still work and don't interact weirdly with compact mode.

- [ ] **Step 3: Run the full test suite one final time**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4 (optional): If any manual step fails**

Fix in a new commit. Do not amend.

---

## Rollback Plan

Every task is an independent commit on top of `main`. If a later task breaks something, `git revert <sha>` of the offending commit cleanly backs out that slice without touching the others.
