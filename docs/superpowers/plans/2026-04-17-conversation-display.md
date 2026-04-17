# Conversation Display — Visual Language & Filter Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current alignment+color message-bubble grammar with a Slack-style flush-left row layout, and add two per-scope click-to-cycle filter buttons (Me / Participants, each with Source / Translation / Both states) to the conversation toolbar. Participant button is shown only when system audio is selected. Filter state persists via `settingsService`.

**Architecture:** Pure render-layer change. `sessionStore.items` / `systemAudioItems` and the `ConversationItem` type are untouched; filtering and pairing happen in components only. Two new `CommonSettings` fields persist filter state using the existing `setConversationFontSize` persistence pattern. One pure predicate (`conversationFilter.ts`) drives visibility; two new components (`DisplayModeButton`, `ConversationRow`) handle the UI.

**Tech Stack:** React 18 + TypeScript, Zustand (`subscribeWithSelector`), Vitest, i18next, `@floating-ui/react` (via existing Tooltip), lucide-react icons, SCSS.

**Reference spec:** `docs/superpowers/specs/2026-04-17-conversation-display-design.md`

---

## File structure

Files to **create**:
- `src/components/MainPanel/conversationFilter.ts` — pure predicate
- `src/components/MainPanel/conversationFilter.test.ts` — unit tests
- `src/components/MainPanel/DisplayModeButton.tsx` — cycle button
- `src/components/MainPanel/DisplayModeButton.scss` — button styles (co-located)
- `src/components/MainPanel/ConversationRow.tsx` — Approach C row
- `src/components/MainPanel/ConversationRow.scss` — row styles (co-located)

Files to **modify**:
- `src/stores/settingsStore.ts` — add `speakerDisplayMode`, `participantDisplayMode`, their setters, loader wiring, and read/write hooks
- `src/components/MainPanel/MainPanel.tsx` — consume new hooks, apply filter, render toolbar buttons (with participant gate), swap `renderConversationItem` body
- `src/components/MainPanel/MainPanel.scss` — delete old `.message-bubble` rules (lines 118–224) and import new partial styles (or inline)
- `src/locales/en/translation.json` — add six `mainPanel.displayMode.*` keys

---

## Task 1: Extend `settingsStore` with `speakerDisplayMode` + `participantDisplayMode`

**Files:**
- Modify: `src/stores/settingsStore.ts`

This task is not TDD (settings wiring is structural). All edits are interdependent, so group into one commit. TypeScript compilation is the verification.

- [ ] **Step 1.1: Add `DisplayMode` type export**

Add near the top of the file, just below the existing `TransportType` type (line 39):

```ts
// Conversation display mode — which half of a bilingual utterance to show
export type DisplayMode = 'source' | 'translation' | 'both';
```

- [ ] **Step 1.2: Add two fields to `CommonSettings` interface**

Modify `src/stores/settingsStore.ts` at lines 26–36. Append two fields after `conversationFontSize: number;` so the interface becomes:

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
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;
}
```

- [ ] **Step 1.3: Add defaults to `defaultCommonSettings`**

Modify `src/stores/settingsStore.ts` around line 200. The existing block ends:

```ts
  useTemplateMode: true,
  participantSystemInstructions: '',
};
```

Add two lines before the closing brace so the block becomes:

```ts
  useTemplateMode: true,
  participantSystemInstructions: '',
  speakerDisplayMode: 'both',
  participantDisplayMode: 'both',
};
```

(The existing object literal already contains `conversationFontSize: 14,` at line 148 — leave that alone.)

- [ ] **Step 1.4: Add action signatures to the store type**

Modify `src/stores/settingsStore.ts` around lines 343–353. In the `// Common settings actions` block, after the existing `setTextOnly` and `setConversationFontSize` signatures, add:

```ts
  setSpeakerDisplayMode: (mode: DisplayMode) => Promise<void>;
  setParticipantDisplayMode: (mode: DisplayMode) => Promise<void>;
```

Also add the two fields to the state type (around line 341, where `conversationFontSize: number;` lives):

```ts
  // Conversation font size
  conversationFontSize: number;

  // Conversation display mode filters
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;
```

- [ ] **Step 1.5: Add setter implementations**

Modify `src/stores/settingsStore.ts` immediately after `setConversationFontSize` (which ends at line 712). Insert:

```ts
    setSpeakerDisplayMode: async (speakerDisplayMode) => {
      const previous = get().speakerDisplayMode;
      set({speakerDisplayMode});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.speakerDisplayMode', speakerDisplayMode);
      } catch (error) {
        console.error('[SettingsStore] Error persisting speakerDisplayMode setting:', error);
        set({speakerDisplayMode: previous});
      }
    },

    setParticipantDisplayMode: async (participantDisplayMode) => {
      const previous = get().participantDisplayMode;
      set({participantDisplayMode});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.participantDisplayMode', participantDisplayMode);
      } catch (error) {
        console.error('[SettingsStore] Error persisting participantDisplayMode setting:', error);
        set({participantDisplayMode: previous});
      }
    },
```

- [ ] **Step 1.6: Hydrate values in `loadSettings`**

Modify `src/stores/settingsStore.ts` around line 1166 (inside `loadSettings`, right after `conversationFontSize` is loaded). Add:

```ts
        const conversationFontSize = await service.getSetting('settings.common.conversationFontSize', defaultCommonSettings.conversationFontSize);
        const speakerDisplayMode = await service.getSetting<DisplayMode>('settings.common.speakerDisplayMode', defaultCommonSettings.speakerDisplayMode);
        const participantDisplayMode = await service.getSetting<DisplayMode>('settings.common.participantDisplayMode', defaultCommonSettings.participantDisplayMode);
```

(If `getSetting` is not generic, drop the `<DisplayMode>` type argument — check the signature in `src/services/interfaces/ISettingsService.ts` and drop the generic if it doesn't accept one.)

Then add the two values to the `set({...})` block around line 1191:

```ts
        set({
          provider: validProvider,
          uiLanguage,
          uiMode,
          systemInstructions,
          templateSystemInstructions,
          useTemplateMode,
          participantSystemInstructions,
          textOnly,
          conversationFontSize,
          speakerDisplayMode,
          participantDisplayMode,
          openai,
          gemini,
          openaiCompatible,
          palabraai,
          kizunaai,
          volcengineST,
          volcengineAST2,
          localInference,
          settingsLoaded: true,
        });
```

- [ ] **Step 1.7: Add read & write hooks**

Modify `src/stores/settingsStore.ts`. After line 1338 (`useConversationFontSize`), add:

```ts
export const useSpeakerDisplayMode = () => useSettingsStore((state) => state.speakerDisplayMode);
export const useParticipantDisplayMode = () => useSettingsStore((state) => state.participantDisplayMode);
```

After line 1383 (`useSetConversationFontSize`), add:

```ts
export const useSetSpeakerDisplayMode = () => useSettingsStore((state) => state.setSpeakerDisplayMode);
export const useSetParticipantDisplayMode = () => useSettingsStore((state) => state.setParticipantDisplayMode);
```

- [ ] **Step 1.8: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: No errors related to `settingsStore.ts`, `DisplayMode`, `speakerDisplayMode`, or `participantDisplayMode`. (Pre-existing unrelated errors are acceptable — only fail if the diff introduced new ones.)

- [ ] **Step 1.9: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add speakerDisplayMode / participantDisplayMode store fields

Adds two persisted CommonSettings fields (default 'both') plus setters,
loader wiring, and read/write hooks, following the existing
conversationFontSize persistence pattern. These drive the conversation
display filter introduced in the next commits.

Related: #147"
```

---

## Task 2: Create pure filter predicate with tests (TDD)

**Files:**
- Create: `src/components/MainPanel/conversationFilter.ts`
- Create: `src/components/MainPanel/conversationFilter.test.ts`

- [ ] **Step 2.1: Write the failing tests first**

Create `src/components/MainPanel/conversationFilter.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { shouldShowItem } from './conversationFilter';

const baseItem = (over: Partial<ConversationItem>): ConversationItem => ({
  id: 'i',
  role: 'user',
  type: 'message',
  status: 'completed',
  formatted: { text: 't' },
  ...over,
});

describe('shouldShowItem', () => {
  it('keeps speaker source when speakerMode=source', () => {
    const item = baseItem({ source: 'speaker', role: 'user' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(true);
  });

  it('hides speaker translation when speakerMode=source', () => {
    const item = baseItem({ source: 'speaker', role: 'assistant' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(false);
  });

  it('hides speaker source when speakerMode=translation', () => {
    const item = baseItem({ source: 'speaker', role: 'user' });
    expect(shouldShowItem(item, 'translation', 'both')).toBe(false);
  });

  it('keeps speaker translation when speakerMode=translation', () => {
    const item = baseItem({ source: 'speaker', role: 'assistant' });
    expect(shouldShowItem(item, 'translation', 'both')).toBe(true);
  });

  it('keeps both speaker roles when speakerMode=both', () => {
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'user' }), 'both', 'both')).toBe(true);
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'assistant' }), 'both', 'both')).toBe(true);
  });

  it('keeps participant source when participantMode=source', () => {
    const item = baseItem({ source: 'participant', role: 'user' });
    expect(shouldShowItem(item, 'both', 'source')).toBe(true);
  });

  it('hides participant translation when participantMode=source', () => {
    const item = baseItem({ source: 'participant', role: 'assistant' });
    expect(shouldShowItem(item, 'both', 'source')).toBe(false);
  });

  it('hides participant source when participantMode=translation', () => {
    const item = baseItem({ source: 'participant', role: 'user' });
    expect(shouldShowItem(item, 'both', 'translation')).toBe(false);
  });

  it('keeps participant translation when participantMode=translation', () => {
    const item = baseItem({ source: 'participant', role: 'assistant' });
    expect(shouldShowItem(item, 'both', 'translation')).toBe(true);
  });

  it('applies speaker mode to items without a source field (default speaker)', () => {
    const item = baseItem({ source: undefined, role: 'assistant' });
    expect(shouldShowItem(item, 'source', 'both')).toBe(false);
    expect(shouldShowItem(item, 'translation', 'both')).toBe(true);
  });

  it('always shows error items regardless of filter', () => {
    const item = baseItem({ type: 'error', role: 'assistant', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
  });

  it('always shows system-role items regardless of filter', () => {
    const item = baseItem({ role: 'system', source: 'speaker' });
    expect(shouldShowItem(item, 'source', 'source')).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run tests — confirm they fail**

Run: `npm run test -- src/components/MainPanel/conversationFilter.test.ts --run 2>&1 | tail -20`
Expected: FAIL with "Cannot find module './conversationFilter'" or similar.

- [ ] **Step 2.3: Implement the predicate**

Create `src/components/MainPanel/conversationFilter.ts` with:

```ts
import type { ConversationItem } from '../../services/interfaces/IClient';
import type { DisplayMode } from '../../stores/settingsStore';

/**
 * Returns true if the item should be visible under the current display-mode filters.
 * Error and system items are always shown.
 */
export function shouldShowItem(
  item: ConversationItem,
  speakerMode: DisplayMode,
  participantMode: DisplayMode,
): boolean {
  if (item.type === 'error' || item.role === 'system') return true;

  const source = item.source ?? 'speaker';
  const mode = source === 'speaker' ? speakerMode : participantMode;

  if (mode === 'both') return true;
  if (mode === 'source') return item.role === 'user';
  if (mode === 'translation') return item.role === 'assistant';
  return true;
}
```

- [ ] **Step 2.4: Run tests — confirm they pass**

Run: `npm run test -- src/components/MainPanel/conversationFilter.test.ts --run 2>&1 | tail -20`
Expected: PASS — 12 tests pass, 0 fail.

- [ ] **Step 2.5: Commit**

```bash
git add src/components/MainPanel/conversationFilter.ts src/components/MainPanel/conversationFilter.test.ts
git commit -m "feat(mainpanel): add conversationFilter.shouldShowItem predicate

Pure predicate that drops source or translation rows based on per-scope
DisplayMode filters. Error and system items bypass filtering. Covers
all nine mode x role combinations plus undefined-source fallback.

Related: #147"
```

---

## Task 3: Add i18n keys

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 3.1: Open the file and find the `mainPanel` block**

Open `src/locales/en/translation.json`. The `mainPanel` object begins around line 496.

- [ ] **Step 3.2: Add six new keys inside `mainPanel`**

Inside the `mainPanel` object, add a `displayMode` sub-object. Place it alphabetically near other `d*` keys (or simply before `error`). Add:

```json
    "displayMode": {
      "speaker": "Me",
      "participant": "Them",
      "both": "Both",
      "source": "Src",
      "translation": "Trans",
      "tooltip": "{{scope}}: {{mode}} — click to change"
    },
```

Verify the surrounding commas are correct (add a trailing comma after the closing `}` if more keys follow, omit it if this is the last key in `mainPanel`).

- [ ] **Step 3.3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json', 'utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 3.4: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "chore(i18n): add mainPanel.displayMode keys for filter buttons"
```

---

## Task 4: Create `DisplayModeButton` component

**Files:**
- Create: `src/components/MainPanel/DisplayModeButton.tsx`
- Create: `src/components/MainPanel/DisplayModeButton.scss`

- [ ] **Step 4.1: Write the component**

Create `src/components/MainPanel/DisplayModeButton.tsx`:

```tsx
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Users } from 'lucide-react';
import Tooltip from '../Tooltip/Tooltip';
import type { DisplayMode } from '../../stores/settingsStore';
import './DisplayModeButton.scss';

export type DisplayScope = 'speaker' | 'participant';

interface DisplayModeButtonProps {
  scope: DisplayScope;
  value: DisplayMode;
  onChange: (next: DisplayMode) => void;
}

const CYCLE: Record<DisplayMode, DisplayMode> = {
  both: 'source',
  source: 'translation',
  translation: 'both',
};

const DisplayModeButton: React.FC<DisplayModeButtonProps> = ({ scope, value, onChange }) => {
  const { t } = useTranslation();

  const scopeLabel = t(
    scope === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    scope === 'speaker' ? 'Me' : 'Them'
  );
  const modeLabel = useMemo(() => {
    if (value === 'both') return t('mainPanel.displayMode.both', 'Both');
    if (value === 'source') return t('mainPanel.displayMode.source', 'Src');
    return t('mainPanel.displayMode.translation', 'Trans');
  }, [value, t]);

  const tooltip = t('mainPanel.displayMode.tooltip', '{{scope}}: {{mode}} — click to change', {
    scope: scopeLabel,
    mode: modeLabel,
  });

  const handleClick = useCallback(() => {
    onChange(CYCLE[value]);
  }, [onChange, value]);

  const Icon = scope === 'speaker' ? Mic : Users;

  return (
    <Tooltip content={tooltip} icon="none" position="bottom">
      <button
        type="button"
        className="display-mode-btn"
        onClick={handleClick}
        aria-label={tooltip}
      >
        <Icon size={14} />
        <span className="display-mode-label">{modeLabel}</span>
      </button>
    </Tooltip>
  );
};

export default DisplayModeButton;
```

- [ ] **Step 4.2: Write the component styles**

Create `src/components/MainPanel/DisplayModeButton.scss`:

```scss
.display-mode-btn {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  padding: 4px 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 4px;
  font-size: 0.72rem;
  line-height: 1;
  transition: color 0.15s, background-color 0.15s;

  &:hover {
    color: #ccc;
    background: rgba(255, 255, 255, 0.1);
  }
}

.display-mode-label {
  font-size: 0.72rem;
}
```

- [ ] **Step 4.3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(DisplayModeButton|error TS)" | head -20`
Expected: No errors referencing `DisplayModeButton.tsx`.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/MainPanel/DisplayModeButton.tsx src/components/MainPanel/DisplayModeButton.scss
git commit -m "feat(mainpanel): add DisplayModeButton — click-to-cycle filter control

Icon + short-label button wrapped in the existing Tooltip component.
Click cycles both → source → translation → both. Scope (speaker or
participant) determines icon (Mic or Users) and i18n label.

Related: #147"
```

---

## Task 5: Create `ConversationRow` component

**Files:**
- Create: `src/components/MainPanel/ConversationRow.tsx`
- Create: `src/components/MainPanel/ConversationRow.scss`

This replaces only the text-message rendering branch. Errors continue to use the existing bubble path in `MainPanel.tsx`.

- [ ] **Step 5.1: Write the component**

Create `src/components/MainPanel/ConversationRow.tsx`:

```tsx
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../services/interfaces/IClient';

interface ConversationRowProps {
  item: ConversationItem & { source?: 'speaker' | 'participant' };
  prevItem?: (ConversationItem & { source?: 'speaker' | 'participant' }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  isPlaying: boolean;
  highlightedChars: number;
}

function languageForItem(
  source: 'speaker' | 'participant',
  role: 'user' | 'assistant' | 'system',
  sourceLanguage: string,
  targetLanguage: string,
): string {
  // speaker/user       -> sourceLanguage  (I speak my language)
  // speaker/assistant  -> targetLanguage  (translated for others)
  // participant/user   -> targetLanguage  (they speak the other language)
  // participant/assistant -> sourceLanguage (translated back to me)
  if (source === 'speaker') {
    return role === 'user' ? sourceLanguage : targetLanguage;
  }
  return role === 'user' ? targetLanguage : sourceLanguage;
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const ConversationRow: React.FC<ConversationRowProps> = ({
  item,
  prevItem,
  sourceLanguage,
  targetLanguage,
  isPlaying,
  highlightedChars,
}) => {
  const { t } = useTranslation();
  const source: 'speaker' | 'participant' = item.source ?? 'speaker';
  const role = item.role;
  const text = item.formatted?.transcript || item.formatted?.text || '';

  const showHeader = (prevItem?.source ?? 'speaker') !== source;
  const isTranslation = role === 'assistant';
  const lang = useMemo(
    () => languageForItem(source, role, sourceLanguage, targetLanguage),
    [source, role, sourceLanguage, targetLanguage],
  );

  const scopeName = t(
    source === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    source === 'speaker' ? 'Me' : 'Them',
  );

  const renderText = () => {
    if (!isPlaying || highlightedChars <= 0 || highlightedChars >= text.length) {
      return <span>{text}</span>;
    }
    return (
      <>
        <span className="row-text-played">{text.slice(0, highlightedChars)}</span>
        <span>{text.slice(highlightedChars)}</span>
      </>
    );
  };

  return (
    <div className={`conversation-row source-${source} ${showHeader ? 'with-header' : 'grouped'}`}>
      {showHeader && (
        <div className="row-header">
          <div className={`row-avatar avatar-${source}`}>{scopeName.slice(0, 2)}</div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.createdAt)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${isPlaying ? 'playing' : ''}`}>
        <span className={`lang-badge ${isTranslation ? 'tr' : 'src'}`}>{lang.toUpperCase()}</span>
        <span className={`row-text ${isTranslation ? 'tr' : 'src'}`}>{renderText()}</span>
      </div>
    </div>
  );
};

export default ConversationRow;
```

- [ ] **Step 5.2: Write the styles**

Create `src/components/MainPanel/ConversationRow.scss`:

```scss
.conversation-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;

  &.grouped {
    padding-top: 0;
    margin-top: -2px;
  }

  &.with-header {
    margin-top: 8px;
  }
}

.row-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.row-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 600;

  &.avatar-speaker {
    background: #10a37f;
    color: #fff;
  }

  &.avatar-participant {
    background: #f39c12;
    color: #1a1a1a;
  }
}

.row-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.7rem;
  color: #9aa0a6;
}

.row-name-text {
  font-weight: 500;
}

.row-time {
  font-size: 0.65rem;
  opacity: 0.7;
}

.row-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 2px 30px; // indent so the line aligns under the name, avatar reserves space
  line-height: 1.4;
  font-size: var(--conversation-font-size, 14px);
  transition: background-color 0.3s ease;

  .conversation-row.grouped & {
    padding-left: 30px;
  }

  &.playing {
    background: rgba(16, 163, 127, 0.1);
    border-radius: 4px;
  }
}

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
    background: rgba(16, 163, 127, 0.2);
    color: #10a37f;
    border: 1px solid rgba(16, 163, 127, 0.4);
  }
}

.row-text {
  word-break: break-word;

  &.src {
    color: #9aa0a6;
    font-style: italic;
  }

  &.tr {
    color: #e8e8e8;
  }
}

.row-text-played {
  color: #10a37f;
}
```

- [ ] **Step 5.3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(ConversationRow|error TS)" | head -20`
Expected: No errors referencing `ConversationRow.tsx`.

- [ ] **Step 5.4: Commit**

```bash
git add src/components/MainPanel/ConversationRow.tsx src/components/MainPanel/ConversationRow.scss
git commit -m "feat(mainpanel): add ConversationRow — Slack-style flush-left row

Replaces the alignment+color message-bubble with a single flush-left
layout. Header (avatar + name + time) appears only when the previous
row's source differs, so consecutive same-speaker rows visually group.
Each line carries a language-code badge derived from (source, role) and
the active source/target languages. Preserves karaoke highlighting via
highlightedChars.

Related: #147"
```

---

## Task 6: Integrate into `MainPanel.tsx`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 6.1: Add imports**

Modify `src/components/MainPanel/MainPanel.tsx` at the top imports block (line 2 onwards). Add to the lucide-react import:

```ts
import {X, Zap, Mic, MicOff, Loader, Play, Volume2, VolumeX, Wrench, Send, AlertCircle, MessageSquare, Trash2, AArrowDown, AArrowUp, Users} from 'lucide-react';
```

(We already have `Mic`; just add `Users`.)

After the existing component imports (around line 41–48), add:

```ts
import DisplayModeButton from './DisplayModeButton';
import ConversationRow from './ConversationRow';
import { shouldShowItem } from './conversationFilter';
```

And extend the settingsStore import to include the new hooks. Find the existing settingsStore import line and append the new names:

```ts
import {
  // ...existing imports...
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
  useSetSpeakerDisplayMode,
  useSetParticipantDisplayMode,
} from '../../stores/settingsStore';
```

Also add the audioStore hook:

```ts
import { useSelectedSystemAudioSource } from '../../stores/audioStore';
```

(If this file already imports from `audioStore`, extend that line instead of adding a new one.)

- [ ] **Step 6.2: Consume hooks inside the component**

Inside the `MainPanel` component body, near where `conversationFontSize` is consumed, add:

```ts
  const speakerDisplayMode = useSpeakerDisplayMode();
  const participantDisplayMode = useParticipantDisplayMode();
  const setSpeakerDisplayMode = useSetSpeakerDisplayMode();
  const setParticipantDisplayMode = useSetParticipantDisplayMode();
  const selectedSystemAudioSource = useSelectedSystemAudioSource();
```

Also pull the active source/target languages. The exact hook depends on the active provider; use the existing helper if present:

```ts
  // Active source/target languages for badge labels (provider-agnostic).
  // Pulls from whatever getCurrentProviderSettings() returns; both fields
  // exist on every provider's settings type.
  const providerSettings = useSettingsStore((s) => s.getCurrentProviderSettings());
  const sourceLanguage = (providerSettings as { sourceLanguage?: string }).sourceLanguage ?? 'EN';
  const targetLanguage = (providerSettings as { targetLanguage?: string }).targetLanguage ?? 'EN';
```

(If a dedicated `useActiveSourceLanguage` / `useActiveTargetLanguage` selector is added later, swap to that.)

- [ ] **Step 6.3: Apply the display-mode filter**

Modify the `filteredItems` useMemo at line 541. Change from:

```ts
  const filteredItems = useMemo(() => {
    return combinedItems.filter(item => {
      const hasText = item.formatted?.transcript || item.formatted?.text;
      const isBasic = (item.type === 'error' || item.role === 'user' || item.role === 'assistant') && hasText;
      if (uiMode === 'basic') return isBasic;
      // Advanced: also show tool calls, audio-only, system messages
      return isBasic || item.formatted?.tool || item.formatted?.output ||
        (item.formatted?.audio && !item.formatted?.transcript && !item.formatted?.text);
    });
  }, [combinedItems, uiMode]);
```

to:

```ts
  const filteredItems = useMemo(() => {
    return combinedItems.filter(item => {
      const hasText = item.formatted?.transcript || item.formatted?.text;
      const isBasic = (item.type === 'error' || item.role === 'user' || item.role === 'assistant') && hasText;
      const passesUiMode = uiMode === 'basic'
        ? isBasic
        : (isBasic || item.formatted?.tool || item.formatted?.output ||
           (item.formatted?.audio && !item.formatted?.transcript && !item.formatted?.text));
      if (!passesUiMode) return false;
      return shouldShowItem(item, speakerDisplayMode, participantDisplayMode);
    });
  }, [combinedItems, uiMode, speakerDisplayMode, participantDisplayMode]);
```

- [ ] **Step 6.4: Add the toolbar buttons**

Modify the `.conversation-toolbar` JSX block (lines 2663–2693). Insert the two new buttons at the top, before the font-size buttons. The participant button is wrapped in `selectedSystemAudioSource && (...)`:

```tsx
<div className="conversation-toolbar">
  <DisplayModeButton
    scope="speaker"
    value={speakerDisplayMode}
    onChange={setSpeakerDisplayMode}
  />
  {selectedSystemAudioSource && (
    <DisplayModeButton
      scope="participant"
      value={participantDisplayMode}
      onChange={setParticipantDisplayMode}
    />
  )}
  <button
    className="font-size-btn"
    onClick={() => setConversationFontSize(Math.max(12, conversationFontSize - 2))}
    // ...existing props unchanged
  >
    <AArrowDown size={14} />
  </button>
  {/* ...rest of existing toolbar unchanged... */}
</div>
```

- [ ] **Step 6.5: Swap text-message rendering inside `renderConversationItem`**

Modify `renderConversationItem` starting at line 2526. Keep the error-branch path unchanged (it continues to render as a bubble). The text-message path (`if (text) { ... }`, which begins around line 2557) must return a `ConversationRow` instead of the current bubble tree.

Replace the text-message branch to call the new component. Example target structure:

```tsx
  // Text / transcript bubble (common for both modes)
  if (text) {
    const prevItem = index > 0 ? filteredItems[index - 1] : null;
    const isItemPlaying = playingItemId === item.id;

    return (
      <ConversationRow
        key={item.id || index}
        item={item}
        prevItem={prevItem as (ConversationItem & { source?: 'speaker' | 'participant' }) | null}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        isPlaying={isItemPlaying}
        highlightedChars={highlightedChars}
      />
    );
  }
```

Leave the rest of `renderConversationItem` (audio-only indicator, tool calls, function outputs for advanced mode) **unchanged** — these keep rendering from the flat item array as before.

- [ ] **Step 6.6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -v "^node_modules" | head -30`
Expected: No new errors introduced by the diff. (Pre-existing unrelated errors acceptable.)

- [ ] **Step 6.7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(mainpanel): wire display-mode filter and render rows with ConversationRow

- Consume speaker/participantDisplayMode from settingsStore.
- Render one DisplayModeButton per scope in the toolbar; hide the
  participant button when no system audio device is selected.
- Apply shouldShowItem to filteredItems after the uiMode gate.
- Replace the message-bubble text branch with <ConversationRow />.
  Error branch unchanged. Advanced-mode audio/tool rows unchanged.

Related: #147"
```

---

## Task 7: Verify SCSS — no changes needed

**Files:** none modified.

The spec called for deleting the `.message-bubble` role rules (`&.user`, `&.assistant`, `&.participant-source`) from `MainPanel.scss`. In practice those rules are **still consumed** by non-text branches of `renderConversationItem` that we deliberately leave untouched in Task 6:
- The `error` branch (`<div className="message-bubble error">`, line 2544).
- The advanced-mode audio-only indicator (`message-bubble ${item.role} ${isParticipant ? 'participant-source' : 'speaker-source'} audio-only`, line 2591).
- Advanced-mode tool calls (`message-bubble system`, line 2622) and tool outputs (line 2641).

Removing the role variants would break right/left alignment of audio-only rows and the system styling of tool calls/outputs. Therefore leave `MainPanel.scss` unchanged; the new `ConversationRow` styles live in their own co-located stylesheet added in Task 5, with no name collision.

- [ ] **Step 7.1: Sanity check — build compiles and SCSS is not orphaned**

Run: `npm run build 2>&1 | tail -15`
Expected: Build succeeds with no errors.

No commit in this task.

---

## Task 8: Manual verification

**Files:** none modified.

- [ ] **Step 8.1: Start the dev server**

Run: `npm run dev`
Open the URL the server prints (typically http://localhost:5173) in Chrome.

- [ ] **Step 8.2: Verify filter persistence**

1. Start a translation session with a provider that works (e.g. OpenAI Realtime with a valid key, or local inference).
2. Speak one utterance — confirm a speaker row appears with source (muted) and translation (primary) lines and a language badge on each.
3. Click the Me button once — cycle to "Src"; confirm only the source line remains visible for that utterance.
4. Click twice more to reach "Trans"; confirm only the translation line is visible.
5. Reload the page. Confirm the filter state persists (mode label on the button matches pre-reload state).

- [ ] **Step 8.3: Verify participant-button gating**

1. With no system audio device selected, confirm the Them button is NOT visible in the toolbar.
2. Open Settings → enable a system audio device. Return to the main panel.
3. Confirm the Them button is now visible.
4. Capture a participant utterance (e.g. play audio from a browser tab). Confirm a second avatar (orange) appears.
5. Cycle the Them button and confirm filtering applies only to participant rows; Me rows remain visible.
6. Disable the system audio device. Confirm the Them button disappears but the existing participant rows remain visible under the persisted participant filter.

- [ ] **Step 8.4: Verify same-speaker grouping**

1. Speak two consecutive utterances without participant interruption.
2. Confirm the second utterance does NOT render its avatar/name header; it shares the first's header.
3. Trigger a participant utterance between two of your own. Confirm the third of your own utterances gets its own header again.

- [ ] **Step 8.5: Verify karaoke highlight + error rendering**

1. Let the assistant audio play fully. Confirm the translation text highlights progressively as audio plays.
2. Force an error (e.g. invalid API key temporarily). Confirm the error bubble renders using the existing red `.message-bubble.error` style — unchanged.

- [ ] **Step 8.6: Run the full test suite**

Run: `npm run test -- --run 2>&1 | tail -20`
Expected: All tests pass, including the new `conversationFilter.test.ts`.

- [ ] **Step 8.7: Final commit (if manual fixes needed)**

If any of the verification steps revealed bugs, fix them in separate commits. If all pass, nothing to commit here.

---

## Summary of commits

1. `feat(settings): add speakerDisplayMode / participantDisplayMode store fields`
2. `feat(mainpanel): add conversationFilter.shouldShowItem predicate`
3. `chore(i18n): add mainPanel.displayMode keys for filter buttons`
4. `feat(mainpanel): add DisplayModeButton — click-to-cycle filter control`
5. `feat(mainpanel): add ConversationRow — Slack-style flush-left row`
6. `feat(mainpanel): wire display-mode filter and render rows with ConversationRow`

(Task 7 is a no-op sanity check and Task 8 is manual verification — neither produces a commit unless verification reveals a bug.)
