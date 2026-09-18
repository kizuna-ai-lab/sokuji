# Session-End Auto-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework PR #537 so that, when the user opts in from the Export menu, every session that actually ran is saved as a full-conversation `.txt` at the moment it ends — silently into Downloads on desktop, as a browser download elsewhere — and closing the desktop window mid-session ends the session first.

**Architecture:** `disconnectConversation` captures each leg's final items, and after both legs are down calls one module, `autoSaveTranscript`, which builds the file with the same builder the manual export uses and saves it per platform. Electron gets two small main-process modules: one that writes a transcript into Downloads, one that holds window close / app quit until the renderer has ended its session.

**Tech Stack:** React 19 + TypeScript, Zustand, i18next, Vitest (jsdom) + Testing Library, Electron main process (CommonJS), SCSS compiled by `sass` in tests.

**Spec:** `docs/superpowers/specs/2026-09-18-session-end-auto-save-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work only in the worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/pr537-auto-save-carry`, branch `worktree-pr537-auto-save-carry`. `node_modules` is a symlink to the main checkout's; it is ignored by git.
- Never push, never force-push, never rebase. Pushing to the contributor's fork is jiangzhuo's decision, taken separately.
- English-only comments. Conventional commits. Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Record failures with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`; add no `console.error` / `console.warn` (`consoleLedger.consistency.test.ts` counts them).
- Filename, always: `sokuji-conversation-<YYYYMMDD-HHMMSS>.txt` (local time). Never derived from content.
- Setting: store field `autoSaveOnStop`, persisted key `settings.common.autoSaveOnStop` (already on the branch from the PR; keep it).
- IPC channel names: `transcript:save` (invoke), `app:close-ready` (invoke), `app:close-requested` (main → renderer).
- Close/quit handshake timeout: 5000 ms. Saved toast: 6000 ms. Failed toast: 8000 ms.
- The auto-saved file is always the full conversation (both channels, originals and translations); the Export menu's scope boxes only govern the manual export.
- Type-check gate: `npx tsc --noEmit -p .` reports 317 errors on the base commit, 11 of them in `src/components/MainPanel/MainPanel.tsx`, none in any other file this plan touches. After every task the total stays 317, MainPanel stays at 11, and no new file appears in the error list.
- Run tests with `npx vitest run <paths>` from the worktree root.

## Deviations from the spec (decided while planning; flag them in the final report)

1. **Row tooltip:** native `title` in both hosts, not the project `Tooltip` in the floating host. `Tooltip` clones its child and attaches its own ref (`Tooltip.tsx:143`), which fights the roving-tabindex ref; every other toolbar control uses `title`.
2. **Failure toast copy:** "Couldn't auto-save the conversation. You can still save it with “{{action}}” in the export menu.", with `{{action}}` = the locale's own `mainPanel.export.downloadTxt`. The export button has no visible label, so "Export →" named nothing on screen.
3. **macOS `closed` handler (`main.js:440-451`):** stops registering an extra `before-quit` → `cleanupAndExit` listener per window close. That listener would run cleanup while the handshake holds a quit; the global `before-quit` listener already covers macOS.
4. **Ordering test:** replays `disconnectConversation` around the real `teardownSessionLegs` and `mergeConversationItems` with a spy for `autoSaveTranscript` (whose own behaviour is covered by Task 5's unit tests).
5. **`mergeConversationItems` signature:** takes a `languageOf(id)` callback instead of a map plus live pair, so recording-vs-reading stays with each caller.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/components/Toast/Toast.tsx`, `ToastContext.tsx`, `index.ts`, `Toast.scss` | modify | optional action button on a toast |
| `src/components/Toast/Toast.test.tsx` | create | action + auto-dismiss |
| `src/utils/conversationExport.ts` | modify | `ExportItem`, `Translate`, `buildTxtI18n`, `buildExportPayload`, `buildTxtExport`, `exportFilename`; later remove `deriveAutoSaveTitle` |
| `src/utils/conversationExport.test.ts` | modify | tests for the builders; drop `deriveAutoSaveTitle` tests |
| `src/components/MainPanel/ExportButton.tsx` | modify | use the builders; auto-save row; always-openable button |
| `src/components/MainPanel/ExportButton.test.tsx` | modify | golden `.txt`; row; empty conversation |
| `src/components/MainPanel/ExportButton.childWindow.test.tsx` | create | row in the child-window host |
| `src/components/MainPanel/ExportButton.scss`, `exportScopeStyles.test.ts` | modify | divider + switch track, compiled-CSS assertions |
| `src/components/MainPanel/conversationMerge.ts`, `.test.ts` | create | tag-and-merge both legs |
| `src/lib/transcript/autoSave.ts`, `.test.ts` | create | the session-end save |
| `src/components/MainPanel/MainPanel.tsx` | modify | use merge; capture + save in `disconnectConversation`; close listener; toolbar |
| `src/components/MainPanel/MainPanel.scss`, `toolbarDisabledState.test.ts` | modify / create | Clear's disabled state |
| `src/components/MainPanel/sessionEndAutoSave.test.ts` | create | ordering (replayed sequence) |
| `electron/transcript-save.js`, `.test.js` | create | name + write into Downloads |
| `electron/close-handshake.js`, `.test.js` | create | hold close/quit until the renderer is done |
| `electron/main.js`, `ipc-channels.js`, `preload.js` | modify | wiring |
| `electron/closeHandshake.wiring.test.js` | create | main.js / preload wiring, read as text |
| `src/components/Settings/sections/LanguageSection.tsx` | modify | remove the PR's toggle |
| `src/locales/*/translation.json` (30) | modify | add `mainPanel.export.autoSave.*`, drop `simpleConfig.autoSaveOnStop*` |

---

### Task 1: Toast action button

**Files:**
- Modify: `src/components/Toast/Toast.tsx`, `src/components/Toast/ToastContext.tsx`, `src/components/Toast/index.ts`, `src/components/Toast/Toast.scss`
- Create: `src/components/Toast/Toast.test.tsx`

**Interfaces:**
- Produces: `ToastAction = { label: string; onClick: () => void }`; `ToastOptions = { variant?: ToastVariant; durationMs?: number; action?: ToastAction }`; `showToast(text: string, opts?: ToastOptions): void` (Task 5 and Task 6 call it with `action`).

- [ ] **Step 1: Write the failing test** — create `src/components/Toast/Toast.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast, type ToastOptions } from './ToastContext';

function Trigger({ opts }: { opts?: ToastOptions }) {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast('Saved', opts)}>fire</button>;
}

const renderWith = (opts?: ToastOptions) =>
  render(<ToastProvider><Trigger opts={opts} /></ToastProvider>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast action', () => {
  it('runs the action on click, then dismisses the toast', () => {
    const onClick = vi.fn();
    renderWith({ action: { label: 'Show in folder', onClick } });
    fireEvent.click(screen.getByText('fire'));

    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('still auto-dismisses after its duration', () => {
    vi.useFakeTimers();
    renderWith({ durationMs: 6000, action: { label: 'Show in folder', onClick: vi.fn() } });
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(6000); });

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('renders no button without an action', () => {
    renderWith();
    fireEvent.click(screen.getByText('fire'));

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Toast/Toast.test.tsx`
Expected: FAIL — `ToastOptions` is not exported / no button named "Show in folder".

- [ ] **Step 3: Implement.** Replace `src/components/Toast/Toast.tsx` with:

```tsx
import React, { useEffect } from 'react';
import './Toast.scss';

export type ToastVariant = 'success' | 'error';

/** One button on the toast; clicking it runs `onClick` and dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
  action?: ToastAction;
  onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, text, variant, durationMs, action, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  return (
    <div className={`toast toast-${variant}`} role="status" aria-live="polite">
      <span className="toast-text">{text}</span>
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default Toast;
```

In `src/components/Toast/ToastContext.tsx`: change the import to `import Toast, { type ToastVariant, type ToastAction } from './Toast';`, add `action?: ToastAction;` to `ToastEntry`, and replace `ToastContextValue` plus the `showToast` callback and the `<Toast … />` element:

```tsx
export interface ToastOptions {
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (text: string, opts?: ToastOptions) => void;
}
```

```tsx
  const showToast = useCallback<ToastContextValue['showToast']>((text, opts) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, {
      id,
      text,
      variant: opts?.variant ?? 'success',
      durationMs: opts?.durationMs ?? 2000,
      action: opts?.action,
    }]);
  }, []);
```

```tsx
            <Toast
              key={t.id}
              id={t.id}
              text={t.text}
              variant={t.variant}
              durationMs={t.durationMs}
              action={t.action}
              onDismiss={dismiss}
            />
```

Replace `src/components/Toast/index.ts` with:

```ts
export { ToastProvider, useToast } from './ToastContext';
export type { ToastOptions } from './ToastContext';
export type { ToastVariant, ToastAction } from './Toast';
```

In `src/components/Toast/Toast.scss`, add to the `.toast` block (after `animation: toast-in 150ms ease-out;`):

```scss
  display: flex;
  align-items: center;
  gap: 12px;
```

and after the `.toast` block:

```scss
.toast-action {
  flex-shrink: 0;
  padding: 2px 8px;
  background: none;
  border: 1px solid #666;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Toast/Toast.test.tsx src/components/MainPanel/ExportButton.test.tsx`
Expected: PASS (ExportButton mocks `useToast`, so it is unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/Toast
git commit -F - <<'EOF'
feat(toast): optional action button

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: One builder for every export

**Files:**
- Modify: `src/utils/conversationExport.ts`, `src/utils/conversationExport.test.ts`, `src/components/MainPanel/ExportButton.tsx`, `src/components/MainPanel/ExportButton.test.tsx`

**Interfaces:**
- Produces (all exported from `src/utils/conversationExport.ts`):
  - `type ExportItem = ConversationItem & { source?: string; sourceLanguage?: string; targetLanguage?: string }`
  - `type Translate = (key: string, defaultValue: string) => string`
  - `buildTxtI18n(t: Translate): TxtI18n`
  - `interface ExportInput { items: ExportItem[]; provider: string; providerSettings: any; localInferenceSettings: any; fallbackLanguages: { sourceLanguage: string; targetLanguage: string }; scope?: ExportScope }`
  - `buildExportPayload(input: ExportInput): { messages: NormalizedMessage[]; metadata: SessionMetadata }`
  - `exportFilename(extension: 'txt' | 'json', now?: number): string`
  - `buildTxtExport(input: ExportInput, i18n: TxtI18n): { content: string; filename: string }`

- [ ] **Step 1: Pin today's manual `.txt` output (golden, written BEFORE the refactor).** In `src/components/MainPanel/ExportButton.test.tsx`, add this test at the end of the `describe` block:

```tsx
  it('downloads exactly this .txt (golden, pinned before the export refactor)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 18, 15, 30, 0)); // local time
    try {
      renderMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

      const [content, filename, mime] = downloadFile.mock.calls[0];
      const pad = (n: number) => String(n).padStart(2, '0');
      const hms = (ts: number) => {
        const d = new Date(ts);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      // Longest label is "Other (trans):" (14), so the column is 15 wide.
      const row = (ts: number | undefined, label: string, text: string) =>
        `[${hms(ts!)}] ${`${label}:`.padEnd(15, ' ')}${text}`;

      expect(filename).toBe('sokuji-conversation-20260918-153000.txt');
      expect(mime).toBe('text/plain;charset=utf-8');
      expect(content).toBe([
        'Sokuji conversation export',
        'Generated: 2026-09-18 15:30:00',
        'Provider: openai',
        "My Language: EN → Other's Language: JA",
        'Note: settings reflect current state at export, not mid-session changes.',
        '',
        row(ITEMS[0].createdAt, 'Me', 'MY-ORIGINAL'),
        row(ITEMS[1].createdAt, 'Me (trans)', 'MY-TRANSLATION'),
        row(ITEMS[2].createdAt, 'Other', 'THEIR-ORIGINAL'),
        row(ITEMS[3].createdAt, 'Other (trans)', 'THEIR-TRANSLATION'),
      ].join('\n') + '\n');
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run it against the unrefactored code — it must PASS now** (it pins current behaviour).

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx -t golden`
Expected: PASS. If it fails, fix the expectation to match current output before going on — the refactor must not move it.

- [ ] **Step 3: Write failing tests for the builders.** In `src/utils/conversationExport.test.ts`, extend the import list with `buildExportPayload, buildTxtExport, buildTxtI18n, exportFilename,` and append:

```ts
describe('buildTxtI18n', () => {
  it('looks up every label under mainPanel.export with its English default', () => {
    const seen: string[] = [];
    const out = buildTxtI18n((key, def) => { seen.push(key); return def; });

    expect(out.speakerYou).toBe('Me');
    expect(out.headerTarget).toBe("Other's Language");
    expect(seen).toHaveLength(11);
    expect(seen.every(k => k.startsWith('mainPanel.export.'))).toBe(true);
  });
});

describe('buildExportPayload / buildTxtExport', () => {
  const input = {
    items: [
      makeItem({ id: 'a', source: 'speaker', role: 'user', formatted: { text: 'hello' } }),
      makeItem({ id: 'b', source: 'participant', role: 'assistant', formatted: { text: 'bonjour' } }),
      makeItem({ id: 'c', status: 'in_progress', formatted: { text: 'unfinished' } }),
    ],
    provider: 'openai',
    providerSettings: { model: 'gpt-x' },
    localInferenceSettings: {},
    fallbackLanguages: { sourceLanguage: 'EN', targetLanguage: 'FR' },
  };

  it('normalizes the items and snapshots the metadata', () => {
    const { messages, metadata } = buildExportPayload(input);
    expect(messages.map(m => m.text)).toEqual(['hello', 'bonjour']);
    expect(metadata.provider).toBe('openai');
    expect(metadata.models).toEqual({ translation: 'gpt-x' });
    expect(metadata.sourceLanguage).toBe('EN');
    expect(metadata.scope).toBeUndefined();
  });

  it('writes the full conversation with no narrowed note when no scope is given', () => {
    const { content } = buildTxtExport(input, i18n);
    expect(content).toContain('hello');
    expect(content).toContain('bonjour');
    expect(content).not.toContain('unfinished');
    expect(content).not.toContain(i18n.headerNarrowed);
  });

  it('names the file after the time only', () => {
    const { filename } = buildTxtExport(input, i18n);
    expect(filename).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
    expect(filename).not.toContain('hello');
  });
});

describe('exportFilename', () => {
  it('stamps local time and the extension', () => {
    const ts = new Date(2026, 8, 18, 9, 5, 7).getTime();
    expect(exportFilename('txt', ts)).toBe('sokuji-conversation-20260918-090507.txt');
    expect(exportFilename('json', ts)).toBe('sokuji-conversation-20260918-090507.json');
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run src/utils/conversationExport.test.ts`
Expected: FAIL — `buildTxtI18n is not a function` (and the other three).

- [ ] **Step 5: Implement the builders.** In `src/utils/conversationExport.ts`:

After the `TxtI18n` interface, add:

```ts
/** A conversation item as the exporters take it: MainPanel's merged, source-tagged rows. */
export type ExportItem = ConversationItem & {
  source?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
};

/**
 * A key lookup with an English default. Narrow on purpose, so a component's
 * hook `t` and the module-level `i18n.t` both fit behind a one-line adapter.
 */
export type Translate = (key: string, defaultValue: string) => string;

/** The .txt labels, looked up once. Shared by the manual export and the auto-save. */
export function buildTxtI18n(t: Translate): TxtI18n {
  return {
    speakerYou: t('mainPanel.export.speakerYou', 'Me'),
    speakerOther: t('mainPanel.export.speakerOther', 'Other'),
    translationSuffix: t('mainPanel.export.translationSuffix', '(trans)'),
    headerTitle: t('mainPanel.export.headerTitle', 'Sokuji conversation export'),
    headerGenerated: t('mainPanel.export.headerGenerated', 'Generated'),
    headerProvider: t('mainPanel.export.headerProvider', 'Provider'),
    headerModels: t('mainPanel.export.headerModels', 'Models'),
    headerSource: t('mainPanel.export.headerSource', 'My Language'),
    headerTarget: t('mainPanel.export.headerTarget', "Other's Language"),
    headerNote: t('mainPanel.export.headerNote', 'Note: settings reflect current state at export, not mid-session changes.'),
    headerNarrowed: t('mainPanel.export.headerNarrowed', 'Note: this export was narrowed at export time — some lines were left out.'),
  };
}
```

Change `normalizeMessages`'s parameter type to `combinedItems: ExportItem[]` (same shape as before).

After `buildSessionMetadata`, add:

```ts
/** What every export format is built from. */
export interface ExportInput {
  /** The rows to export — already scoped by the caller when a scope applies. */
  items: ExportItem[];
  provider: string;
  providerSettings: any;
  localInferenceSettings: any;
  /** Used only when no message carries its own language snapshot. */
  fallbackLanguages: { sourceLanguage: string; targetLanguage: string };
  /** The manual export's scope; recorded in the file only when it left something out. */
  scope?: ExportScope;
}

/** Normalize the items and snapshot the session metadata. */
export function buildExportPayload(input: ExportInput): { messages: NormalizedMessage[]; metadata: SessionMetadata } {
  const messages = normalizeMessages(input.items);
  const models = getActiveModelInfo(input.provider, input.providerSettings, input.localInferenceSettings);
  // Prefer the pair captured on the messages over the live config — the
  // conversation may have ended and the user may have since switched languages.
  const pair = deriveSessionLanguagePair(messages, input.fallbackLanguages);
  const metadata = buildSessionMetadata({
    provider: input.provider,
    models,
    sourceLanguage: pair.sourceLanguage,
    targetLanguage: pair.targetLanguage,
    languagePairs: collectLanguagePairs(messages),
    scope: input.scope,
  });
  return { messages, metadata };
}

/** The name every export uses: the time, never the content. */
export function exportFilename(extension: 'txt' | 'json', now: number = Date.now()): string {
  return `sokuji-conversation-${formatTimestampForFilename(now)}.${extension}`;
}

/** The .txt file, header included, and its name. */
export function buildTxtExport(input: ExportInput, i18n: TxtI18n): { content: string; filename: string } {
  const { messages, metadata } = buildExportPayload(input);
  return {
    content: formatAsTxt(messages, metadata, i18n, { includeHeader: true }),
    filename: exportFilename('txt'),
  };
}
```

- [ ] **Step 6: Run the builder tests**

Run: `npx vitest run src/utils/conversationExport.test.ts`
Expected: PASS.

- [ ] **Step 7: Move ExportButton onto the builders.** In `src/components/MainPanel/ExportButton.tsx`:

Replace the `../../utils/conversationExport` import with:

```ts
import {
  buildExportPayload,
  buildTxtExport,
  buildTxtI18n,
  copyToClipboard,
  downloadFile,
  exportFilename,
  formatAsJson,
  formatAsTxt,
  normalizeMessages,
  type ExportInput,
  type TxtI18n,
} from '../../utils/conversationExport';
```

Replace the `txtI18n` `useMemo` (`ExportButton.tsx:239-251`) with:

```tsx
  // Collect i18n strings once per render.
  const txtI18n: TxtI18n = useMemo(() => buildTxtI18n((key, def) => t(key, def)), [t]);
```

Replace `buildPayload` (`:260-280`) with:

```tsx
  /** The export input for the current scope, computed at click time. */
  const exportInput = useCallback((): ExportInput => ({
    items: scopedItems,
    provider,
    providerSettings: currentProviderSettings,
    localInferenceSettings,
    fallbackLanguages: { sourceLanguage, targetLanguage },
    // Recorded so the file says whether it is the whole conversation. A full
    // scope is dropped inside buildSessionMetadata.
    scope: { speaker: togglesToMode(speaker), participant: togglesToMode(participant) },
  }), [scopedItems, provider, currentProviderSettings, localInferenceSettings, sourceLanguage, targetLanguage, speaker, participant]);
```

Replace the three handlers:

```tsx
  const handleCopy = useCallback(async () => {
    closeMenu();
    const { messages, metadata } = buildExportPayload(exportInput());
    const text = formatAsTxt(messages, metadata, txtI18n, { includeHeader: false });
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast(t('mainPanel.export.copySuccess', 'Conversation copied to clipboard'), { variant: 'success' });
    } else {
      showToast(t('mainPanel.export.copyFailed', 'Failed to copy. Check browser permissions.'), { variant: 'error', durationMs: 4000 });
    }
  }, [exportInput, showToast, t, txtI18n, closeMenu]);

  const handleDownloadTxt = useCallback(() => {
    closeMenu();
    const { content, filename } = buildTxtExport(exportInput(), txtI18n);
    downloadFile(content, filename, 'text/plain;charset=utf-8');
  }, [exportInput, txtI18n, closeMenu]);

  const handleDownloadJson = useCallback(() => {
    closeMenu();
    const { messages, metadata } = buildExportPayload(exportInput());
    downloadFile(formatAsJson(messages, metadata), exportFilename('json'), 'application/json');
  }, [exportInput, closeMenu]);
```

Remove the now-unused imports if the compiler flags them (`collectLanguagePairs`, `deriveSessionLanguagePair`, `getActiveModelInfo`, `buildSessionMetadata`, `formatTimestampForFilename` are no longer referenced in this file). `normalizeMessages` is still used by `normalizedMessages` and `hasContent`.

- [ ] **Step 8: Run the ExportButton and export tests — the golden must still pass unchanged**

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx src/utils/conversationExport.test.ts`
Expected: PASS, including `golden`.

- [ ] **Step 9: Type-check gate**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "ExportButton|conversationExport"`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/utils/conversationExport.ts src/utils/conversationExport.test.ts src/components/MainPanel/ExportButton.tsx src/components/MainPanel/ExportButton.test.tsx
git commit -F - <<'EOF'
refactor(export): one builder for manual and automatic exports

Pins the manual .txt output first, then moves ExportButton onto
buildTxtI18n / buildExportPayload / buildTxtExport so the session-end
auto-save can reuse them instead of copying them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `mergeConversationItems`

**Files:**
- Create: `src/components/MainPanel/conversationMerge.ts`, `src/components/MainPanel/conversationMerge.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx:1291-1328` (the `combinedItems` `useMemo`)

**Interfaces:**
- Produces: `interface LanguagePair { sourceLanguage: string; targetLanguage: string }`; `type TaggedConversationItem = ConversationItem & { source: 'speaker' | 'participant'; sourceLanguage: string; targetLanguage: string }`; `mergeConversationItems(speaker: ConversationItem[], participant: ConversationItem[], languageOf: (id: string) => LanguagePair): TaggedConversationItem[]`.

- [ ] **Step 1: Write the failing test** — create `src/components/MainPanel/conversationMerge.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { mergeConversationItems, type LanguagePair } from './conversationMerge';

const item = (id: string, createdAt?: number, source?: 'speaker' | 'participant'): ConversationItem => ({
  id,
  role: 'user',
  type: 'message',
  status: 'completed',
  formatted: { text: id },
  createdAt,
  source,
} as ConversationItem);

const EN_JA: LanguagePair = { sourceLanguage: 'EN', targetLanguage: 'JA' };

describe('mergeConversationItems', () => {
  it('tags untagged rows with the side they came from', () => {
    const out = mergeConversationItems([item('a', 1)], [item('b', 2)], () => EN_JA);
    expect(out.map(i => [i.id, i.source])).toEqual([['a', 'speaker'], ['b', 'participant']]);
  });

  it("keeps a row's own source tag", () => {
    const out = mergeConversationItems([item('a', 1, 'participant')], [], () => EN_JA);
    expect(out[0].source).toBe('participant');
  });

  it('orders both sides together by createdAt; a missing createdAt sorts first', () => {
    const out = mergeConversationItems([item('s2', 20), item('s0')], [item('p1', 10), item('p3', 30)], () => EN_JA);
    expect(out.map(i => i.id)).toEqual(['s0', 'p1', 's2', 'p3']);
  });

  it('keeps speaker before participant when their createdAt ties', () => {
    const out = mergeConversationItems([item('s', 5)], [item('p', 5)], () => EN_JA);
    expect(out.map(i => i.id)).toEqual(['s', 'p']);
  });

  it("takes each row's language pair from languageOf", () => {
    const languageOf = vi.fn((id: string) => (id === 'a' ? EN_JA : { sourceLanguage: 'ZH', targetLanguage: 'KO' }));
    const out = mergeConversationItems([item('a', 1)], [item('b', 2)], languageOf);
    expect(out.map(i => [i.sourceLanguage, i.targetLanguage])).toEqual([['EN', 'JA'], ['ZH', 'KO']]);
    expect(languageOf).toHaveBeenCalledTimes(2);
  });

  it('does not mutate its inputs', () => {
    const speaker = [item('a', 1)];
    mergeConversationItems(speaker, [], () => EN_JA);
    expect(speaker[0]).not.toHaveProperty('sourceLanguage');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/MainPanel/conversationMerge.test.ts`
Expected: FAIL — cannot resolve `./conversationMerge`.

- [ ] **Step 3: Implement** — create `src/components/MainPanel/conversationMerge.ts`:

```ts
import type { ConversationItem } from '../../services/interfaces/IClient';

export interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

/** A row of the merged conversation: which side it came from and its language pair. */
export type TaggedConversationItem = ConversationItem & {
  source: 'speaker' | 'participant';
  sourceLanguage: string;
  targetLanguage: string;
};

/**
 * Tag each side's rows with their side and language pair, then merge them into
 * one list ordered by createdAt. The conversation view and the session-end
 * auto-save both build their conversation here, so the saved file holds what
 * the screen shows.
 *
 * `languageOf` decides each row's pair. The view records a pair the first time
 * it sees a row, so switching languages later cannot relabel history; the
 * session-end snapshot only reads. That policy stays with the caller.
 */
export function mergeConversationItems(
  speaker: ConversationItem[],
  participant: ConversationItem[],
  languageOf: (id: string) => LanguagePair,
): TaggedConversationItem[] {
  const tag = (item: ConversationItem, fallbackSource: 'speaker' | 'participant'): TaggedConversationItem => {
    const langs = languageOf(item.id);
    return {
      ...item,
      source: item.source ?? fallbackSource,
      sourceLanguage: langs.sourceLanguage,
      targetLanguage: langs.targetLanguage,
    };
  };
  // Array.prototype.sort is stable, so on a createdAt tie the speaker row
  // stays ahead of the participant row, as it always has.
  return [
    ...speaker.map(item => tag(item, 'speaker')),
    ...participant.map(item => tag(item, 'participant')),
  ].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/MainPanel/conversationMerge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Use it in MainPanel.** Add `import { mergeConversationItems } from './conversationMerge';` next to `import { shouldShowItem } from './conversationFilter';`. Replace the whole `combinedItems` `useMemo` (from `// Combine speaker and participant items for display with source tagging` through `}, [items, participantItems, getCurrentProviderSettings]);`) with:

```tsx
  // Combine speaker and participant items for display with source tagging
  const combinedItems = useMemo(() => {
    const liveSettings = getCurrentProviderSettings();
    const live = {
      sourceLanguage: liveSettings.sourceLanguage ?? 'EN',
      targetLanguage: liveSettings.targetLanguage ?? 'EN',
    };

    // Record a row's pair the first time it is seen, so switching languages
    // after a session cannot relabel its history.
    const languageOf = (id: string) => {
      let langs = itemLanguagesRef.current.get(id);
      if (!langs) {
        langs = { ...live };
        itemLanguagesRef.current.set(id, langs);
      }
      return langs;
    };

    const merged = mergeConversationItems(items, participantItems, languageOf);

    // Prune snapshots for items that no longer exist (handles clearConversation
    // and session restart, which empty both arrays).
    const liveIds = new Set(merged.map(it => it.id));
    for (const id of Array.from(itemLanguagesRef.current.keys())) {
      if (!liveIds.has(id)) itemLanguagesRef.current.delete(id);
    }

    return merged;
  }, [items, participantItems, getCurrentProviderSettings]);
```

- [ ] **Step 6: Type-check gate and neighbouring tests**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "src/components/MainPanel/MainPanel.tsx"` → Expected: `11`.
Run: `npx tsc --noEmit -p . 2>&1 | grep conversationMerge` → Expected: no output.
Run: `npx vitest run src/components/MainPanel` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/conversationMerge.ts src/components/MainPanel/conversationMerge.test.ts src/components/MainPanel/MainPanel.tsx
git commit -F - <<'EOF'
refactor(main-panel): extract the two-side conversation merge

The session-end auto-save needs the same merge on a snapshot taken
during teardown, which cannot wait for a render.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Electron `transcript:save`

**Files:**
- Create: `electron/transcript-save.js`, `electron/transcript-save.test.js`
- Modify: `electron/main.js` (require + one call inside `app.whenReady()` before `createWindow();` at `main.js:548`), `electron/ipc-channels.js`

**Interfaces:**
- Produces: renderer calls `window.electron.invoke('transcript:save', { content: string })` → `Promise<{ ok: true; path: string; dir: string } | { ok: false; error: string }>`. Any other field in the payload is ignored.

- [ ] **Step 1: Write the failing test** — create `electron/transcript-save.test.js`:

```js
// electron/transcript-save.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { saveTranscript, setupTranscriptSaveHandler } = nodeRequire('./transcript-save.js');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sokuji-transcript-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const NOW = new Date(2026, 8, 18, 15, 30, 5);
const NAME = 'sokuji-conversation-20260918-153005';

describe('saveTranscript', () => {
  it('writes the text under a name it generates from the time', async () => {
    const res = await saveTranscript({ dir, content: 'hello\n', now: NOW });
    expect(res).toEqual({ ok: true, path: join(dir, `${NAME}.txt`), dir });
    expect(readFileSync(res.path, 'utf8')).toBe('hello\n');
  });

  it('never overwrites: a clash gets " (1)", then " (2)"', async () => {
    writeFileSync(join(dir, `${NAME}.txt`), 'older');
    const first = await saveTranscript({ dir, content: 'a', now: NOW });
    const second = await saveTranscript({ dir, content: 'b', now: NOW });
    expect(first.path).toBe(join(dir, `${NAME} (1).txt`));
    expect(second.path).toBe(join(dir, `${NAME} (2).txt`));
    expect(readFileSync(join(dir, `${NAME}.txt`), 'utf8')).toBe('older');
  });

  it('rejects content that is not a string and writes nothing', async () => {
    const res = await saveTranscript({ dir, content: { evil: true }, now: NOW });
    expect(res.ok).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a directory it cannot write to', async () => {
    const res = await saveTranscript({ dir: join(dir, 'missing'), content: 'x', now: NOW });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT|no such file/i);
  });
});

describe('the transcript:save handler', () => {
  it('ignores any name or path the renderer sends and writes into the downloads dir', async () => {
    const handlers = new Map();
    setupTranscriptSaveHandler({
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      getDownloadsDir: () => dir,
    });

    const res = await handlers.get('transcript:save')({}, {
      content: 'x',
      filename: '../../evil.txt',
      path: '/etc/passwd',
    });

    expect(res.ok).toBe(true);
    expect(res.dir).toBe(dir);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(readdirSync(dir)[0]).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/transcript-save.test.js`
Expected: FAIL — `Cannot find module './transcript-save.js'`.

- [ ] **Step 3: Implement** — create `electron/transcript-save.js`:

```js
// electron/transcript-save.js
//
// Writes a session-end auto-save transcript into a directory — the user's
// Downloads folder in production. The renderer supplies only the text: the
// name is generated here, so a renderer cannot choose where a file lands.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');

/** "YYYYMMDD-HHMMSS" in local time — the stamp the manual export uses too. */
function timestamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Enough for any burst of sessions ending within one second.
const MAX_SUFFIX = 99;

/**
 * Write `content` as sokuji-conversation-<stamp>.txt in `dir`, adding " (1)",
 * " (2)", … when that name is taken. Exclusive create, so it never overwrites.
 * Resolves { ok: true, path, dir } or { ok: false, error }; never rejects.
 */
async function saveTranscript({ dir, content, now = new Date() }) {
  if (typeof content !== 'string') {
    return { ok: false, error: 'Transcript content must be a string' };
  }
  const base = `sokuji-conversation-${timestamp(now)}`;
  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const name = n === 0 ? `${base}.txt` : `${base} (${n}).txt`;
    const filePath = path.join(dir, name);
    try {
      await fs.promises.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, path: filePath, dir };
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }
  return { ok: false, error: `Too many transcripts named ${base}` };
}

/** Register the renderer's `transcript:save` channel. Call once, at startup. */
function setupTranscriptSaveHandler({ ipcMain, getDownloadsDir }) {
  ipcMain.handle('transcript:save', (_event, payload) =>
    saveTranscript({ dir: getDownloadsDir(), content: payload && payload.content }));
}

module.exports = { saveTranscript, setupTranscriptSaveHandler };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/transcript-save.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire and register the channel.** In `electron/main.js`, after `const { setupPopoverWindowHandlers } = require('./popover-windows.js');` add:

```js
const { setupTranscriptSaveHandler } = require('./transcript-save.js');
```

Inside `app.whenReady().then(async () => { … })`, immediately before the `createWindow();` call at `main.js:548`, add:

```js
  // Session-end auto-save writes straight into Downloads (no Save As dialog).
  setupTranscriptSaveHandler({ ipcMain, getDownloadsDir: () => app.getPath('downloads') });
```

In `electron/ipc-channels.js`, append to `INVOKE_CHANNELS` (before its closing `];`):

```js
  // Session-end auto-save: the renderer hands over the text, main names and
  // writes the file into Downloads.
  'transcript:save',
```

- [ ] **Step 6: Run the IPC drift guard**

Run: `npx vitest run electron/ipc-channels.test.js electron/transcript-save.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/transcript-save.js electron/transcript-save.test.js electron/main.js electron/ipc-channels.js
git commit -F - <<'EOF'
feat(electron): transcript:save writes into Downloads without a dialog

Main names the file itself, so the renderer cannot pick a path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `autoSaveTranscript`

**Files:**
- Create: `src/lib/transcript/autoSave.ts`, `src/lib/transcript/autoSave.test.ts`

**Interfaces:**
- Consumes: `buildTxtExport`, `buildTxtI18n`, `downloadFile`, `normalizeMessages`, `ExportItem` (Task 2); `transcript:save` (Task 4); `open-directory` (existing, `main.js:872`); `useSettingsStore.getState()` fields `autoSaveOnStop`, `provider`, `localInference`, `getCurrentProviderSettings()`.
- Produces: `autoSaveTranscript(items: ExportItem[], notify: AutoSaveNotifier): Promise<AutoSaveOutcome>` where `AutoSaveOutcome = 'disabled' | 'empty' | 'saved' | 'failed'` and `AutoSaveNotifier = { showToast: (text: string, opts?: { variant?: 'success' | 'error'; durationMs?: number; action?: { label: string; onClick: () => void } }) => void }`. Never rejects.

- [ ] **Step 1: Write the failing test** — create `src/lib/transcript/autoSave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExportItem } from '../../utils/conversationExport';

const state = {
  autoSaveOnStop: true,
  provider: 'openai',
  localInference: {},
  getCurrentProviderSettings: (): Record<string, unknown> => ({ sourceLanguage: 'EN', targetLanguage: 'JA' }),
};
vi.mock('../../stores/settingsStore', () => ({ default: { getState: () => state } }));

vi.mock('../../locales', () => ({
  default: {
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      let s = opts?.defaultValue ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  },
}));

let electron = true;
vi.mock('../../utils/environment', () => ({ isElectron: () => electron }));

const reportError = vi.fn();
vi.mock('../diagnostics/report', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
  describeCause: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const downloadFile = vi.fn();
vi.mock('../../utils/conversationExport', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

import { autoSaveTranscript } from './autoSave';

const invoke = vi.fn();
const showToast = vi.fn();
const notify = { showToast };

const row = (id: string, source: 'speaker' | 'participant', role: 'user' | 'assistant', text: string): ExportItem => ({
  id, source, role, type: 'message', status: 'completed', createdAt: 1_700_000_000_000, formatted: { text },
} as ExportItem);

const CONVERSATION = [
  row('1', 'speaker', 'user', 'MY-ORIGINAL'),
  row('2', 'speaker', 'assistant', 'MY-TRANSLATION'),
  row('3', 'participant', 'user', 'THEIR-ORIGINAL'),
  row('4', 'participant', 'assistant', 'THEIR-TRANSLATION'),
];

beforeEach(() => {
  state.autoSaveOnStop = true;
  state.getCurrentProviderSettings = () => ({ sourceLanguage: 'EN', targetLanguage: 'JA' });
  electron = true;
  invoke.mockReset();
  showToast.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
  (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
});

describe('autoSaveTranscript', () => {
  it('does nothing while the toggle is off', async () => {
    state.autoSaveOnStop = false;
    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('disabled');
    expect(invoke).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does nothing when nothing was said', async () => {
    const unfinished = { ...row('9', 'speaker', 'user', 'x'), status: 'in_progress' } as ExportItem;
    expect(await autoSaveTranscript([unfinished], notify)).toBe('empty');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('desktop: hands main the full conversation text only, then offers the folder', async () => {
    invoke.mockResolvedValueOnce({ ok: true, path: '/home/u/Downloads/sokuji-conversation-20260918-153000.txt', dir: '/home/u/Downloads' });

    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('saved');

    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, payload] = invoke.mock.calls[0];
    expect(channel).toBe('transcript:save');
    expect(Object.keys(payload)).toEqual(['content']);
    for (const text of ['MY-ORIGINAL', 'MY-TRANSLATION', 'THEIR-ORIGINAL', 'THEIR-TRANSLATION']) {
      expect(payload.content).toContain(text);
    }
    expect(payload.content).not.toContain('some lines were left out');

    const [text, opts] = showToast.mock.calls[0];
    expect(text).toBe('Conversation saved: sokuji-conversation-20260918-153000.txt');
    expect(opts).toMatchObject({ variant: 'success', durationMs: 6000 });
    opts.action.onClick();
    expect(invoke).toHaveBeenLastCalledWith('open-directory', '/home/u/Downloads');
  });

  it('browser: downloads the file and leaves the confirmation to the browser', async () => {
    electron = false;
    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('saved');
    const [content, filename, mime] = downloadFile.mock.calls[0];
    expect(content).toContain('THEIR-TRANSLATION');
    expect(filename).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
    expect(mime).toBe('text/plain;charset=utf-8');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reports and tells the user when main could not write the file', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' });

    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('failed');

    expect(reportError).toHaveBeenCalledWith(
      'AutoSave',
      'Failed to auto-save the conversation: EACCES: permission denied',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
    const [text, opts] = showToast.mock.calls[0];
    expect(text).toContain('Download as .txt');
    expect(opts).toMatchObject({ variant: 'error' });
  });

  it('resolves, never rejects, when the IPC itself throws', async () => {
    invoke.mockRejectedValueOnce(new Error('No handler registered'));
    await expect(autoSaveTranscript(CONVERSATION, notify)).resolves.toBe('failed');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('resolves when building the file throws', async () => {
    state.getCurrentProviderSettings = () => { throw new Error('store not loaded'); };
    await expect(autoSaveTranscript(CONVERSATION, notify)).resolves.toBe('failed');
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/transcript/autoSave.test.ts`
Expected: FAIL — cannot resolve `./autoSave`.

- [ ] **Step 3: Implement** — create `src/lib/transcript/autoSave.ts`:

```ts
import useSettingsStore from '../../stores/settingsStore';
import i18n from '../../locales';
import { isElectron } from '../../utils/environment';
import { reportError, describeCause } from '../diagnostics/report';
import {
  buildTxtExport,
  buildTxtI18n,
  downloadFile,
  normalizeMessages,
  type ExportItem,
} from '../../utils/conversationExport';

/** The slice of the toast API this needs; `useToast().showToast` fits it. */
export interface AutoSaveNotifier {
  showToast: (
    text: string,
    opts?: {
      variant?: 'success' | 'error';
      durationMs?: number;
      action?: { label: string; onClick: () => void };
    },
  ) => void;
}

/** What happened. The user has already been told whatever they need to know. */
export type AutoSaveOutcome = 'disabled' | 'empty' | 'saved' | 'failed';

const SAVED_TOAST_MS = 6000;
const FAILED_TOAST_MS = 8000;

/**
 * Save a finished session's conversation, if the user turned that on.
 *
 * Called once per session end, after both legs are down, with the merged
 * final rows. Always the full conversation: the Export menu's scope boxes only
 * govern the manual export. Never rejects — a failure is reported and shown,
 * and the teardown awaiting this carries on.
 */
export async function autoSaveTranscript(
  items: ExportItem[],
  notify: AutoSaveNotifier,
): Promise<AutoSaveOutcome> {
  try {
    const settings = useSettingsStore.getState();
    if (!settings.autoSaveOnStop) return 'disabled';
    if (normalizeMessages(items).length === 0) return 'empty';

    const providerSettings = settings.getCurrentProviderSettings();
    const { content, filename } = buildTxtExport(
      {
        items,
        provider: settings.provider,
        providerSettings,
        localInferenceSettings: settings.localInference,
        fallbackLanguages: {
          sourceLanguage: providerSettings.sourceLanguage ?? 'EN',
          targetLanguage: providerSettings.targetLanguage ?? 'EN',
        },
      },
      buildTxtI18n((key, defaultValue) => i18n.t(key, { defaultValue })),
    );

    if (!isElectron()) {
      // The browser's own download UI is the confirmation. The page cannot
      // tell whether Chrome's download limiter let the file through, so a
      // "saved" toast here could be false.
      downloadFile(content, filename, 'text/plain;charset=utf-8');
      return 'saved';
    }

    const result = await window.electron.invoke('transcript:save', { content });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'The main process did not save the transcript');
    }
    const savedName: string = String(result.path).split(/[\\/]/).pop() ?? String(result.path);
    notify.showToast(
      i18n.t('mainPanel.export.autoSave.saved', {
        defaultValue: 'Conversation saved: {{filename}}',
        filename: savedName,
      }),
      {
        variant: 'success',
        durationMs: SAVED_TOAST_MS,
        action: {
          label: i18n.t('mainPanel.export.autoSave.showInFolder', { defaultValue: 'Show in folder' }),
          onClick: () => { void window.electron.invoke('open-directory', result.dir); },
        },
      },
    );
    return 'saved';
  } catch (error) {
    reportError('AutoSave', `Failed to auto-save the conversation: ${describeCause(error)}`, { cause: error });
    notify.showToast(
      i18n.t('mainPanel.export.autoSave.failed', {
        defaultValue: "Couldn't auto-save the conversation. You can still save it with “{{action}}” in the export menu.",
        action: i18n.t('mainPanel.export.downloadTxt', { defaultValue: 'Download as .txt' }),
      }),
      { variant: 'error', durationMs: FAILED_TOAST_MS },
    );
    return 'failed';
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/transcript/autoSave.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check gate and the console ledger**

Run: `npx tsc --noEmit -p . 2>&1 | grep "lib/transcript"` → Expected: no output.
Run: `npx vitest run src/lib/diagnostics` → Expected: PASS (the ledger does not move: no `console.*` was added).

- [ ] **Step 6: Commit**

```bash
git add src/lib/transcript
git commit -F - <<'EOF'
feat(transcript): autoSaveTranscript for the session-end save

Full conversation, silent write to Downloads on desktop, browser
download elsewhere; reports and toasts on failure and never rejects.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Save at session end; remove the PR's render-timed effect

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`, `src/utils/conversationExport.ts`, `src/utils/conversationExport.test.ts`
- Create: `src/components/MainPanel/sessionEndAutoSave.test.ts`

**Interfaces:**
- Consumes: `mergeConversationItems` (Task 3), `autoSaveTranscript` (Task 5), `useToast` (Task 1), `teardownSessionLegs` (existing).
- Produces: the `disconnectConversation` behaviour Task 7's close listener relies on — the save completes before `disconnectDoneRef.current` resolves.

- [ ] **Step 1: Write the ordering test** — create `src/components/MainPanel/sessionEndAutoSave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { teardownSessionLegs } from '../../services/providers/managedSonioxSplit';
import { mergeConversationItems } from './conversationMerge';

/**
 * Ordering coverage for MainPanel.disconnectConversation's session-end save.
 * There is no React rendering harness in this repo (see
 * splitDegradedWiring.test.ts), so `stopSession` below replays the steps
 * disconnectConversation takes, around the REAL teardownSessionLegs and
 * mergeConversationItems. Keep it in step with MainPanel.tsx.
 *
 * THE BUG (PR #537 as submitted): the save was armed inside the speaker leg and
 * fired by an effect on the next render. In split Both mode that render commits
 * while the participant leg is still awaiting disconnect(), so the other
 * party's last line — flushed by that disconnect — is not in the file.
 */

type Fake = {
  disconnect: () => Promise<void>;
  getConversationItems: () => ConversationItem[];
  reset: () => void;
};

const line = (id: string, text: string, createdAt: number): ConversationItem => ({
  id, role: 'user', type: 'message', status: 'completed', createdAt, formatted: { text },
} as ConversationItem);

/** A client whose disconnect() flushes `flushed` into its items, like a real final completion. */
function client(items: ConversationItem[], flushed: ConversationItem[] = [], fail = false): Fake {
  let current = [...items];
  return {
    disconnect: async () => {
      await Promise.resolve();
      current = [...current, ...flushed];
      if (fail) throw new Error('socket already closed');
    },
    getConversationItems: () => [...current],
    reset: () => { current = []; },
  };
}

const LANGS = { sourceLanguage: 'EN', targetLanguage: 'JA' };
const saved = vi.fn(async (_items: ConversationItem[]) => 'saved' as const);
const texts = (items: ConversationItem[]) => items.map(i => i.formatted?.text);

/** Replays disconnectConversation's capture-and-save steps. */
async function stopSession(opts: { wasActive: boolean; speaker?: Fake; participant?: Fake }) {
  let speakerFinal: ConversationItem[] = [];
  let participantFinal: ConversationItem[] = [];
  try {
    await teardownSessionLegs({
      speaker: async () => {
        const c = opts.speaker;
        if (!c) return;
        try { await c.disconnect(); } catch { /* MainPanel warns and carries on */ }
        speakerFinal = c.getConversationItems();
        c.reset();
      },
      participant: async () => {
        const c = opts.participant;
        if (!c) return;
        participantFinal = c.getConversationItems();
        try {
          await c.disconnect();
          participantFinal = c.getConversationItems();
          c.reset();
        } catch { /* MainPanel warns and carries on */ }
      },
    });
  } finally {
    if (opts.wasActive) {
      await saved(mergeConversationItems(speakerFinal, participantFinal, () => LANGS));
    }
  }
}

beforeEach(() => saved.mockClear());

describe('session-end auto-save ordering', () => {
  it('Both mode: the line the other party finishes during disconnect() is in the file', async () => {
    await stopSession({
      wasActive: true,
      speaker: client([line('s1', 'MINE', 1)]),
      participant: client([line('p1', 'THEIRS', 2)], [line('p2', 'THEIR-LAST', 3)]),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS', 'THEIR-LAST']);
  });

  it('pre-fix contrast: saving on the render the speaker leg causes loses that line', async () => {
    const speaker = client([line('s1', 'MINE', 1)]);
    const participant = client([line('p1', 'THEIRS', 2)], [line('p2', 'THEIR-LAST', 3)]);
    let participantState = participant.getConversationItems(); // what React held mid-session
    let file: ConversationItem[] = [];
    await teardownSessionLegs({
      speaker: async () => {
        await speaker.disconnect();
        const speakerState = speaker.getConversationItems();
        speaker.reset();
        file = [...speakerState, ...participantState]; // the PR's effect, on this render
      },
      participant: async () => {
        await participant.disconnect();
        participantState = participant.getConversationItems();
        participant.reset();
      },
    });
    expect(texts(file)).not.toContain('THEIR-LAST');
  });

  it('Others mode, no speaker client: still saves', async () => {
    await stopSession({ wasActive: true, participant: client([line('p1', 'THEIRS', 1)]) });
    expect(texts(saved.mock.calls[0][0])).toEqual(['THEIRS']);
  });

  it('a session that never became active (Cancel during Start, connect failure) saves nothing', async () => {
    await stopSession({ wasActive: false, speaker: client([line('s1', 'MINE', 1)]) });
    expect(saved).not.toHaveBeenCalled();
  });

  it("a participant disconnect that throws still leaves that side's lines in the file", async () => {
    await stopSession({
      wasActive: true,
      speaker: client([line('s1', 'MINE', 1)]),
      participant: client([line('p1', 'THEIRS', 2)], [], true),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS']);
  });

  it('a leg that throws out of teardown still gets the save, and the error still propagates', async () => {
    const speaker = client([line('s1', 'MINE', 1)]);
    speaker.reset = () => { throw new Error('reset blew up'); };
    await expect(stopSession({ wasActive: true, speaker })).rejects.toThrow('reset blew up');
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE']);
  });
});
```

- [ ] **Step 2: Run it** — it exercises the new sequence against real `teardownSessionLegs` and `mergeConversationItems`, so it passes before MainPanel changes; it is the spec MainPanel is edited to match.

Run: `npx vitest run src/components/MainPanel/sessionEndAutoSave.test.ts`
Expected: PASS (6 tests). If "pre-fix contrast" fails, the replay no longer reproduces the bug — fix the replay, not the assertion.

- [ ] **Step 3: Remove the PR's effect and imports from MainPanel.** In `src/components/MainPanel/MainPanel.tsx`:
  - Delete the import block `import { buildSessionMetadata, … type TxtI18n, } from '../../utils/conversationExport';` (`:85-96`).
  - Delete `useAutoSaveOnStop,` from the `../../stores/settingsStore` import list and the line `const autoSaveOnStop = useAutoSaveOnStop();`.
  - Delete the `pendingAutoSaveRef` declaration and its comment block (`// Armed by disconnectConversation's speaker-leg teardown …` through `const pendingAutoSaveRef = useRef(false);`).
  - Delete the whole auto-save `useEffect` (from `// Auto-save the conversation as a .txt file after a session ends` through `}, [combinedItems, autoSaveOnStop, provider, currentSettings, localInferenceSettings, sourceLanguage, targetLanguage, t]);`).
  - In the speaker leg, delete the four comment lines and `pendingAutoSaveRef.current = true;` that follow `setItems(client.getConversationItems());`.

- [ ] **Step 4: Add the capture and the save.** Add imports next to the other local imports:

```ts
import { autoSaveTranscript } from '../../lib/transcript/autoSave';
import { useToast } from '../Toast';
```

Next to `const getCurrentProviderSettings = useGetCurrentProviderSettings();` add:

```ts
  const { showToast } = useToast();
```

In `disconnectConversation`, right after `const speakerToTearDown = speakerClientRef.current;`, add:

```ts
    // Read BEFORE setIsSessionActive(false) below. isSessionActive turns true
    // only once both legs are up, so Cancel during Start and the
    // connect-failure cleanup (which also runs this) read false: those never
    // ran a session, and never auto-save.
    const wasActive = useSessionStore.getState().isSessionActive;
    // Each leg's final items, captured before its reset() empties the client.
    let speakerFinal: ConversationItem[] = [];
    let participantFinal: ConversationItem[] = [];
```

In the speaker leg, replace `setItems(client.getConversationItems());` with:

```ts
          speakerFinal = client.getConversationItems();
          setItems(speakerFinal);
```

Replace the participant leg body with:

```ts
        participant: async () => {
          const participantClient = participantClientRef.current;
          if (!participantClient) return;
          // Last known items first, so a disconnect() that throws still leaves
          // the auto-save the other party's lines; refreshed once disconnect()
          // has flushed the final ones.
          participantFinal = participantClient.getConversationItems();
          try {
            await participantClient.disconnect();
            participantFinal = participantClient.getConversationItems();
            participantClient.reset();
            participantClientRef.current = null;
            console.info('[Sokuji] [MainPanel] Disconnected participant client');
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
          }
        },
```

(The `console.warn` is the existing line, unchanged; do not add or remove `console.*` calls.)

Now wrap the whole existing `await teardownSessionLegs({ speaker…, participant…, afterBothLegs… });` statement — its object literal unchanged apart from the two edits above — in a `try`, and put this `finally` directly after it (the statement moves one indent level in):

```ts
      try {
        await teardownSessionLegs({ /* the existing object literal, unchanged */ });
      } finally {
        if (wasActive) {
          // After both legs are down, and before the `finally` below resolves
          // disconnectDoneRef — so a queued Start, or the desktop close
          // handshake, waits for the file. Reads the language snapshots
          // without recording new ones: the view's useMemo owns that.
          // autoSaveTranscript never rejects, so a throw from a leg still
          // propagates unchanged.
          const live = useSettingsStore.getState().getCurrentProviderSettings();
          const fallback = {
            sourceLanguage: live.sourceLanguage ?? 'EN',
            targetLanguage: live.targetLanguage ?? 'EN',
          };
          await autoSaveTranscript(
            mergeConversationItems(speakerFinal, participantFinal, id => itemLanguagesRef.current.get(id) ?? fallback),
            { showToast },
          );
        }
      }
```

Change the `disconnectConversation` dependency list from `[refetchAll, setIsReconnecting]` to `[refetchAll, setIsReconnecting, showToast]`.

- [ ] **Step 5: Remove `deriveAutoSaveTitle`.** In `src/utils/conversationExport.ts`, delete the `deriveAutoSaveTitle` function and its doc comment. In `src/utils/conversationExport.test.ts`, delete `deriveAutoSaveTitle,` from the import list and the whole `describe('deriveAutoSaveTitle', …)` block.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "src/components/MainPanel/MainPanel.tsx"` → Expected: `11`.
Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → Expected: `317`.
Run: `grep -n "pendingAutoSaveRef\|deriveAutoSaveTitle\|useAutoSaveOnStop" src/components/MainPanel/MainPanel.tsx src/utils/conversationExport.ts` → Expected: no output.
Run: `npx vitest run src/components/MainPanel src/utils src/lib` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/sessionEndAutoSave.test.ts src/utils/conversationExport.ts src/utils/conversationExport.test.ts
git commit -F - <<'EOF'
fix(main-panel): auto-save from disconnectConversation, not a render

Captures both legs' final items during teardown and saves once both are
down, gated on the session having been active. Fixes the other party's
last lines missing in Both mode and Others-mode sessions never saving.
Removes the ref + effect and the ten export imports, and the
content-derived filename.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Desktop close/quit ends the session first

**Files:**
- Create: `electron/close-handshake.js`, `electron/close-handshake.test.js`, `electron/closeHandshake.wiring.test.js`
- Modify: `electron/main.js`, `electron/ipc-channels.js`, `electron/preload.js`, `src/components/MainPanel/MainPanel.tsx`, `src/components/MainPanel/sessionEndAutoSave.test.ts`

**Interfaces:**
- Produces (`electron/close-handshake.js`): `createCloseHandshake({ quitApp: () => void, timeoutMs?: number, setTimer?, clearTimer? })` → `{ attachWindow(win), onWindowClose(event), onBeforeQuit(event): boolean, ready() }`; `DEFAULT_TIMEOUT_MS = 5000`.
- Wire protocol: main sends `app:close-requested` (no payload); renderer answers with `invoke('app:close-ready')`.

- [ ] **Step 1: Write the failing handshake test** — create `electron/close-handshake.test.js`:

```js
// electron/close-handshake.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createCloseHandshake, DEFAULT_TIMEOUT_MS } = nodeRequire('./close-handshake.js');

function fakeWindow() {
  const w = {
    destroyed: false,
    sent: [],
    close: vi.fn(),
    isDestroyed: () => w.destroyed,
    webContents: {
      destroyed: false,
      crashed: false,
      isDestroyed: () => w.webContents.destroyed,
      isCrashed: () => w.webContents.crashed,
      send: (channel) => w.sent.push(channel),
    },
  };
  return w;
}
const event = () => ({ preventDefault: vi.fn() });

let timer;
let quitApp;
let hs;
let win;
beforeEach(() => {
  timer = null;
  quitApp = vi.fn();
  hs = createCloseHandshake({
    quitApp,
    setTimer: (fn, ms) => { timer = { fn, ms }; return 1; },
    clearTimer: () => { timer = null; },
  });
  win = fakeWindow();
  hs.attachWindow(win);
});

describe('close handshake', () => {
  it('holds a close, asks the renderer, and closes once it answers', () => {
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested']);
    expect(timer.ms).toBe(DEFAULT_TIMEOUT_MS);

    hs.ready();
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(timer).toBeNull();

    const again = event();
    hs.onWindowClose(again); // the close() above re-enters 'close'
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores repeated close clicks while waiting', () => {
    hs.onWindowClose(event());
    const second = event();
    hs.onWindowClose(second);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested']);
  });

  it('closes anyway when the renderer never answers', () => {
    hs.onWindowClose(event());
    timer.fn();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('holds a quit, then re-issues it instead of closing the window', () => {
    const e = event();
    expect(hs.onBeforeQuit(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    hs.ready();
    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(win.close).not.toHaveBeenCalled();

    const again = event();
    expect(hs.onBeforeQuit(again)).toBe(true);
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('a quit that arrives while a close is pending wins', () => {
    hs.onWindowClose(event());
    expect(hs.onBeforeQuit(event())).toBe(false);
    hs.ready();
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('lets the close through when there is no live page to ask', () => {
    win.webContents.crashed = true;
    const e = event();
    expect(hs.onBeforeQuit(e)).toBe(true);
    hs.onWindowClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.sent).toEqual([]);
  });

  it('lets a quit through when no window is attached', () => {
    const bare = createCloseHandshake({ quitApp });
    expect(bare.onBeforeQuit(event())).toBe(true);
  });

  it('starts fresh for a new window (macOS re-creates it from the dock)', () => {
    hs.onWindowClose(event());
    hs.ready();
    const next = fakeWindow();
    hs.attachWindow(next);
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(next.sent).toEqual(['app:close-requested']);
  });

  it('an answer with nothing pending does nothing', () => {
    hs.ready();
    expect(win.close).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/close-handshake.test.js`
Expected: FAIL — `Cannot find module './close-handshake.js'`.

- [ ] **Step 3: Implement** — create `electron/close-handshake.js`:

```js
// electron/close-handshake.js
//
// Closing the main window, or quitting, while a session runs used to drop the
// session: nothing ended it, so nothing captured its final lines and the
// session-end auto-save never ran. The main process now holds the close, asks
// the renderer to end its session, and lets the close through when the
// renderer answers — or after a timeout, so a hung teardown can never leave a
// window that will not close.
const DEFAULT_TIMEOUT_MS = 5000;

function createCloseHandshake({
  quitApp,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let win = null;
  let state = 'idle'; // 'idle' | 'waiting' | 'approved'
  let quitPending = false;
  let timer = null;

  const hasLivePage = () =>
    !!win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed();

  function finish() {
    if (state !== 'waiting') return;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    state = 'approved';
    if (quitPending) {
      quitApp();
    } else if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  /** True when the close/quit may proceed now; otherwise it is held. */
  function hold(event, quit) {
    if (state === 'approved') return true;
    if (state === 'waiting') {
      event.preventDefault();
      if (quit) quitPending = true;
      return false;
    }
    if (!hasLivePage()) return true;
    event.preventDefault();
    state = 'waiting';
    quitPending = quit;
    win.webContents.send('app:close-requested');
    timer = setTimer(finish, timeoutMs);
    return false;
  }

  return {
    /** A new main window starts a fresh handshake. */
    attachWindow(nextWin) {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      win = nextWin;
      state = 'idle';
      quitPending = false;
    },
    /** The main window's 'close' listener. */
    onWindowClose(event) {
      hold(event, false);
    },
    /** From 'before-quit': true means proceed with the quit (and its cleanup). */
    onBeforeQuit(event) {
      return hold(event, true);
    },
    /** The renderer has ended its session ('app:close-ready'). */
    ready() {
      finish();
    },
  };
}

module.exports = { createCloseHandshake, DEFAULT_TIMEOUT_MS };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/close-handshake.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing wiring test** — create `electron/closeHandshake.wiring.test.js`:

```js
// electron/closeHandshake.wiring.test.js
//
// main.js and preload.js cannot be booted in vitest; their wiring of the close
// handshake is asserted on their source text, like ipc-channels.test.js does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');
const preload = readFileSync(join(__dirname, 'preload.js'), 'utf8');

describe('close handshake wiring', () => {
  it('holds the main window close', () => {
    expect(main).toMatch(/mainWindow\.on\('close',\s*\(event\)\s*=>\s*closeHandshake\.onWindowClose\(event\)\)/);
    expect(main).toMatch(/closeHandshake\.attachWindow\(mainWindow\)/);
  });

  it('runs quit cleanup only once the handshake lets the quit through', () => {
    expect(main).toMatch(/if \(!closeHandshake\.onBeforeQuit\(event\)\) return;\s*cleanupAndExit\(\);/);
    // A bare registration would run cleanup while the quit is held.
    expect(main).not.toMatch(/app\.on\('before-quit',\s*cleanupAndExit\)/);
  });

  it("answers the renderer's app:close-ready", () => {
    expect(main).toMatch(/ipcMain\.handle\('app:close-ready'/);
  });

  it('lets the renderer hear app:close-requested', () => {
    const list = preload.match(/const validReceiveChannels = \[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toContain("'app:close-requested'");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run electron/closeHandshake.wiring.test.js`
Expected: FAIL (all four).

- [ ] **Step 7: Wire main, preload and the channel registry.** In `electron/main.js`:

After the `transcript-save.js` require (Task 4), add:

```js
const { createCloseHandshake } = require('./close-handshake.js');
```

After `const sandboxRecovery = … ;` (`main.js:133`), add:

```js
// Closing the window or quitting mid-session ends the session first, so its
// final lines are captured and auto-saved like any other Stop.
const closeHandshake = createCloseHandshake({ quitApp: () => app.quit() });
ipcMain.handle('app:close-ready', () => {
  closeHandshake.ready();
});
```

In `createWindow()`, right after `setupPopoverWindowHandlers(mainWindow);` (`main.js:396`), add:

```js
  closeHandshake.attachWindow(mainWindow);
  mainWindow.on('close', (event) => closeHandshake.onWindowClose(event));
```

Replace the `closed` handler (`main.js:440-451`) with:

```js
  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    // On macOS closing the window does not quit the app; the before-quit
    // listener below runs the cleanup when it actually quits. (This used to
    // register a second before-quit listener per close, which would run the
    // cleanup while the close handshake holds a quit.)
    if (process.platform !== 'darwin') {
      cleanupAndExit();
    }
    mainWindow = null;
  });
```

Replace `app.on('before-quit', cleanupAndExit);` (`main.js:579`) with:

```js
// Register cleanup with before-quit — but not while the close handshake holds
// the quit for the renderer to end its session: cleanup stops the native host
// and removes the virtual audio devices that session may still be using.
app.on('before-quit', (event) => {
  if (!closeHandshake.onBeforeQuit(event)) return;
  cleanupAndExit();
});
```

In `electron/ipc-channels.js`, append to `INVOKE_CHANNELS` after `'transcript:save',`:

```js
  // Window-close handshake: the renderer has ended its session.
  'app:close-ready',
```

In `electron/preload.js`, append to `validReceiveChannels` (before its closing `];`):

```js
  // Window close / app quit: end the session before the window goes
  'app:close-requested',
```

- [ ] **Step 8: Run the Electron tests**

Run: `npx vitest run electron`
Expected: PASS (includes `ipc-channels.test.js`, which now finds both handlers).

- [ ] **Step 9: Listen in the renderer.** In `src/components/MainPanel/MainPanel.tsx`, directly after the effect that keeps `disconnectConversationRef` in sync (`useEffect(() => { disconnectConversationRef.current = disconnectConversation; }, [disconnectConversation]);`), add:

```tsx
  // Desktop: closing the window (or quitting) mid-session ends the session
  // first, so its final lines are captured and auto-saved like any other Stop.
  // The main process holds the close until this answers, or 5 s pass.
  useEffect(() => {
    if (!isElectron()) return;
    const onCloseRequested = async () => {
      try {
        if (useSessionStore.getState().isSessionActive) {
          await disconnectConversationRef.current?.();
        }
        // Covers a Stop already in flight: disconnectConversation's re-entry
        // guard returns at once, so wait for that teardown — save included.
        await disconnectDoneRef.current;
      } finally {
        void window.electron.invoke('app:close-ready');
      }
    };
    window.electron.receive('app:close-requested', onCloseRequested);
    return () => window.electron.removeListener('app:close-requested', onCloseRequested);
  }, []);
```

- [ ] **Step 10: Add the in-flight ordering case** to `src/components/MainPanel/sessionEndAutoSave.test.ts`, inside the `describe`:

```ts
  it('a close request during an in-flight Stop answers only after the file is saved', async () => {
    const order: string[] = [];
    saved.mockImplementationOnce(async () => { order.push('saved'); return 'saved'; });
    const inFlight = stopSession({
      wasActive: true,
      participant: client([line('p1', 'THEIRS', 1)], [line('p2', 'THEIR-LAST', 2)]),
    });
    // What MainPanel's close listener does: the session already reads
    // inactive, so it only awaits disconnectDoneRef, then answers.
    const onCloseRequested = async (done: Promise<void>) => {
      try { await done; } finally { order.push('close-ready'); }
    };
    await onCloseRequested(inFlight);
    expect(order).toEqual(['saved', 'close-ready']);
  });
```

- [ ] **Step 11: Verify**

Run: `npx vitest run src/components/MainPanel/sessionEndAutoSave.test.ts electron` → Expected: PASS.
Run: `npx tsc --noEmit -p . 2>&1 | grep -c "src/components/MainPanel/MainPanel.tsx"` → Expected: `11`.

- [ ] **Step 12: Commit**

```bash
git add electron/close-handshake.js electron/close-handshake.test.js electron/closeHandshake.wiring.test.js electron/main.js electron/ipc-channels.js electron/preload.js src/components/MainPanel/MainPanel.tsx src/components/MainPanel/sessionEndAutoSave.test.ts
git commit -F - <<'EOF'
feat(electron): closing or quitting mid-session ends the session first

Main holds the close (or quit) and asks the renderer to end its session;
it closes on the answer or after 5 s. Quit cleanup waits for the
handshake, and macOS no longer registers a second before-quit cleanup
per window close.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: The Export menu row

**Files:**
- Modify: `src/components/MainPanel/ExportButton.tsx`, `src/components/MainPanel/ExportButton.test.tsx`, `src/components/MainPanel/ExportButton.scss`, `src/components/MainPanel/exportScopeStyles.test.ts`
- Create: `src/components/MainPanel/ExportButton.childWindow.test.tsx`

**Interfaces:**
- Consumes: `useAutoSaveOnStop(): boolean`, `useSetAutoSaveOnStop(): (v: boolean) => Promise<void>` (on the branch from the PR).

- [ ] **Step 1: Update the ExportButton tests.** In `src/components/MainPanel/ExportButton.test.tsx`, add these mocks after the `vi.mock('../Toast', …)` line:

```tsx
let autoSaveOn = false;
const setAutoSaveOnStop = vi.fn(async (v: boolean) => { autoSaveOn = v; });
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => autoSaveOn,
  useSetAutoSaveOnStop: () => setAutoSaveOnStop,
}));

let electronEnv = true;
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isElectron: () => electronEnv,
}));
```

Extend `beforeEach` with:

```tsx
  autoSaveOn = false;
  electronEnv = true;
  setAutoSaveOnStop.mockClear();
```

Replace the test `'still disables the button when the conversation itself is empty'` with:

```tsx
  it('keeps the button usable with an empty conversation, so auto-save can be set before anyone speaks', () => {
    render(
      <ExportButton
        combinedItems={[]}
        provider="openai"
        currentProviderSettings={{}}
        localInferenceSettings={{}}
        sourceLanguage="EN"
        targetLanguage="JA"
        speakerMode="both"
        participantMode="both"
      />,
    );
    fireEvent.click(button());

    expect(button()).not.toBeDisabled();
    for (const name of ['Copy to clipboard', 'Download as .txt', 'Download as .json']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
    // "Nothing selected" means the scope left out a conversation that exists.
    expect(screen.queryByText('Nothing selected')).not.toBeInTheDocument();
    expect(autoSaveRow()).not.toBeDisabled();
  });
```

Add a helper next to `box`:

```tsx
const autoSaveRow = () => screen.getByRole('menuitemcheckbox', { name: 'Auto-save when session ends' });
```

In `'includes the scope checkboxes in the menu keyboard ring'`, change the ring to end with the row:

```tsx
    const ring = [
      box('Me — Src'), box('Me — Trans'), box('Other — Src'), box('Other — Trans'),
      ...['Copy to clipboard', 'Download as .txt', 'Download as .json']
        .map((name) => screen.getByRole('menuitem', { name })),
      autoSaveRow(),
    ];
```

Append a new `describe` block:

```tsx
describe('ExportButton auto-save row', () => {
  it('shows the stored state', () => {
    autoSaveOn = true;
    renderMenu();
    expect(autoSaveRow()).toHaveAttribute('aria-checked', 'true');
  });

  it('writes the store on click and leaves the menu open', () => {
    renderMenu();
    expect(autoSaveRow()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(autoSaveRow());

    expect(setAutoSaveOnStop).toHaveBeenCalledWith(true);
    expect(screen.getByRole('menuitem', { name: 'Download as .txt' })).toBeInTheDocument();
  });

  it('explains where the file goes on desktop', () => {
    renderMenu();
    expect(autoSaveRow().getAttribute('title')).toContain('Downloads folder');
  });

  it('warns about the side panel in the browser', () => {
    electronEnv = false;
    renderMenu();
    expect(autoSaveRow().getAttribute('title')).toContain('side panel');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx`
Expected: FAIL — no `menuitemcheckbox` named "Auto-save when session ends"; the empty-conversation button is disabled.

- [ ] **Step 3: Implement the row.** In `src/components/MainPanel/ExportButton.tsx`, add imports:

```tsx
import { useAutoSaveOnStop, useSetAutoSaveOnStop } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
```

After `const listRef = …;` add:

```tsx
  // The session-end auto-save lives here, next to the export it automates.
  const autoSaveOnStop = useAutoSaveOnStop();
  const setAutoSaveOnStop = useSetAutoSaveOnStop();
  const toggleAutoSave = () => { void setAutoSaveOnStop(!autoSaveOnStop); };
```

Change the "Nothing selected" condition in `renderScope` from `{!scopeHasContent && (` to:

```tsx
    {hasContent && !scopeHasContent && (
```

After the `items` `useMemo`, add:

```tsx
  const autoSaveLabel = t('mainPanel.export.autoSave.label', 'Auto-save when session ends');
  // A native title, like the toolbar buttons: the Tooltip component clones its
  // child and would fight the roving-tabindex ref, and the child-window host's
  // 240px OS window would clip a floating tooltip anyway.
  const autoSaveTooltip = isElectron()
    ? t('mainPanel.export.autoSave.tooltipDesktop', 'When a session ends, save the whole conversation — both sides, originals and translations — as a .txt file in your Downloads folder.')
    : t('mainPanel.export.autoSave.tooltipBrowser', 'When a session ends, download the whole conversation — both sides, originals and translations — as a .txt file. Closing the side panel during a session does not save it; stop the session first.');
  /** Last stop in the keyboard ring, after the three actions. */
  const autoSaveRingIndex = scopeRingSize + items.length;

  /** The persisted auto-save switch, shared by both menu hosts. */
  const renderAutoSave = (roving: boolean) => (
    <>
      <div className="export-menu-divider" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={autoSaveOnStop}
        className="export-menu-item export-auto-save"
        title={autoSaveTooltip}
        {...(roving
          ? {
              ref: (node: HTMLButtonElement | null) => { listRef.current[autoSaveRingIndex] = node; },
              tabIndex: activeIndex === autoSaveRingIndex ? 0 : -1,
              ...getItemProps({ onClick: toggleAutoSave }),
            }
          : { onClick: toggleAutoSave })}
      >
        <span className="export-auto-save__switch" aria-hidden="true" />
        <span>{autoSaveLabel}</span>
      </button>
    </>
  );
```

In the child-window host: delete `disabled={!hasContent}` from the button, change `height={140}` to `height={182}`, and add `{renderAutoSave(false)}` after the `{items.map(…)}` block inside `.export-menu`.

In the floating host: delete `disabled={!hasContent}` from the button and add `{renderAutoSave(true)}` after the `{items.map(…)}` block inside `.export-menu`.

- [ ] **Step 4: Add the styles.** Append to `src/components/MainPanel/ExportButton.scss`:

```scss
.export-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: #444;
}

// The auto-save row is a setting, not an action, so it carries a switch track:
// the Help section's "Diagnostic logs" shape (help-link__switch in
// Settings.scss), scaled to a menu row. Like the scope boxes, its state lives
// in aria-checked. Off track and knob are Settings' $toggle-bg-off (#555) and
// the menu's muted text (#9aa0a6); on is the scope boxes' #10a37f.
.export-auto-save__switch {
  position: relative;
  flex-shrink: 0;
  width: 20px;
  height: 11px;
  border-radius: 6px;
  background: #555;
  transition: background 0.2s ease;

  &::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #9aa0a6;
    transition: transform 0.2s ease, background 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    &, &::before { transition: none; }
  }
}

.export-auto-save[aria-checked='true'] .export-auto-save__switch {
  background: #10a37f;

  &::before {
    transform: translateX(9px);
    background: #fff;
  }
}
```

(Use `background`, never `background-color`: `toolbarRestColour.test.ts` fails on any `color: #555` in this file, and `\bcolor:` also matches inside `background-color:`.)

- [ ] **Step 5: Assert the compiled CSS.** Append to `src/components/MainPanel/exportScopeStyles.test.ts`:

```ts
describe('auto-save switch shows its state', () => {
  it('fills the track when on', () => {
    expect(css).toMatch(
      /\.export-auto-save\[aria-checked=["']?true["']?\]\s+\.export-auto-save__switch\s*\{[^}]*\bbackground:\s*#10a37f/,
    );
  });

  it('moves the knob when on', () => {
    expect(css).toMatch(
      /\.export-auto-save\[aria-checked=["']?true["']?\]\s+\.export-auto-save__switch::before\s*\{[^}]*\btransform:\s*translateX\(9px\)/,
    );
  });
});
```

- [ ] **Step 6: Child-window host test** — create `src/components/MainPanel/ExportButton.childWindow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ExportButton from './ExportButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => (typeof def === 'string' ? def : key) }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const setAutoSaveOnStop = vi.fn(async () => {});
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => false,
  useSetAutoSaveOnStop: () => setAutoSaveOnStop,
}));
// The real host opens an OS child window; render its children inline instead.
vi.mock('../Subtitle/ChildWindowPopover', () => ({
  ChildWindowPopover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    (open ? <div>{children}</div> : null),
  useChildPopoverToggle: () => ({ open: true, toggle: vi.fn(), onClose: vi.fn() }),
}));

describe('ExportButton in the subtitle bar child window', () => {
  it('carries the auto-save row, without the roving ring', () => {
    render(
      <ExportButton
        combinedItems={[]}
        provider="openai"
        currentProviderSettings={{}}
        localInferenceSettings={{}}
        sourceLanguage="EN"
        targetLanguage="JA"
        speakerMode="both"
        participantMode="both"
        popoverHost="child-window"
      />,
    );
    const row = screen.getByRole('menuitemcheckbox', { name: 'Auto-save when session ends' });
    expect(row).not.toHaveAttribute('tabindex');

    fireEvent.click(row);
    expect(setAutoSaveOnStop).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx src/components/MainPanel/ExportButton.childWindow.test.tsx src/components/MainPanel/exportScopeStyles.test.ts src/components/MainPanel/toolbarRestColour.test.ts src/components/Subtitle`
Expected: PASS (the golden from Task 2 included).

- [ ] **Step 8: Type-check gate**

Run: `npx tsc --noEmit -p . 2>&1 | grep ExportButton` → Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/components/MainPanel/ExportButton.tsx src/components/MainPanel/ExportButton.test.tsx src/components/MainPanel/ExportButton.childWindow.test.tsx src/components/MainPanel/ExportButton.scss src/components/MainPanel/exportScopeStyles.test.ts
git commit -F - <<'EOF'
feat(export): auto-save switch in the Export menu

The menu opens with an empty conversation too, so the switch can be set
before anyone speaks; the three actions stay disabled until there is
something to export.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Toolbar always shown; Clear disabled while empty

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (the toolbar condition and the Clear button), `src/components/MainPanel/MainPanel.scss:56-72`
- Create: `src/components/MainPanel/toolbarDisabledState.test.ts`

- [ ] **Step 1: Write the failing stylesheet test** — create `src/components/MainPanel/toolbarDisabledState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The toolbar is now shown before any conversation exists, so Clear can be
// visible with nothing to clear. It must look disabled then, like the font
// size buttons at their limits. Asserted on the compiled CSS.
const css = compile(resolve(__dirname, 'MainPanel.scss')).css;

describe('Clear conversation disabled state', () => {
  it('dims when disabled', () => {
    expect(css).toMatch(/\.clear-conversation-btn:disabled\s*\{[^}]*\bopacity:\s*0\.3/);
  });

  it('keeps the red hover off a disabled button', () => {
    expect(css).toMatch(/\.clear-conversation-btn:hover:not\(:disabled\)\s*\{/);
    expect(css).not.toMatch(/\.clear-conversation-btn:hover\s*\{/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/MainPanel/toolbarDisabledState.test.ts`
Expected: FAIL (both).

- [ ] **Step 3: Implement the styles.** In `src/components/MainPanel/MainPanel.scss`, in `.clear-conversation-btn`, replace:

```scss
  &:hover {
    color: #e74c3c;
    background: rgba(231, 76, 60, 0.1);
  }
```

with (the sibling `.font-size-btn` pattern):

```scss
  &:hover:not(:disabled) {
    color: #e74c3c;
    background: rgba(231, 76, 60, 0.1);
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
```

- [ ] **Step 4: Implement the markup.** In `src/components/MainPanel/MainPanel.tsx`, replace:

```tsx
        {/* Conversation toolbar */}
        {(isSessionActive || combinedItems.length > 0) && (
```

with:

```tsx
        {/* Conversation toolbar. Always shown: it once held only the Clear
            button, which is why it used to wait for a conversation, and the
            Export menu now carries a setting worth reaching before a
            session. While the extension's subtitle overlay owns the
            conversation, the old condition still applies. */}
        {(!subtitleTakeover || isSessionActive || combinedItems.length > 0) && (
```

On the Clear button (`className="clear-conversation-btn"`), add after `onClick={requestClearConversation}`:

```tsx
              disabled={combinedItems.length === 0}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/components/MainPanel` → Expected: PASS.
Run: `npx tsc --noEmit -p . 2>&1 | grep -c "src/components/MainPanel/MainPanel.tsx"` → Expected: `11`.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss src/components/MainPanel/toolbarDisabledState.test.ts
git commit -F - <<'EOF'
feat(main-panel): show the conversation toolbar before a session

It used to wait for a conversation because it once held only Clear.
Clear is disabled while there is nothing to clear.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: Strings; remove the PR's Languages toggle

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx`, `src/locales/*/translation.json` (30 files)

- [ ] **Step 1: Remove the PR's toggle.** In `src/components/Settings/sections/LanguageSection.tsx`:
  - In the `../../../stores/settingsStore` import, change `useSetKeepReplayAudio,\n  useAutoSaveOnStop,\n  useSetAutoSaveOnStop` back to `useSetKeepReplayAudio` (no trailing comma after it).
  - Delete the two lines `const autoSaveOnStop = useAutoSaveOnStop();` / `const setAutoSaveOnStop = useSetAutoSaveOnStop();` and the blank line after them.
  - Delete the `<ToggleSwitch checked={autoSaveOnStop} … />` element and the blank line after it.

Run: `grep -n "autoSaveOnStop\|AutoSaveOnStop" src/components/Settings/sections/LanguageSection.tsx` → Expected: no output.

- [ ] **Step 2: Write the locale script** to `$CLAUDE_JOB_DIR/tmp/autosave_locales.py` (a scratch file, not committed):

```python
import json
import glob

KEYS = ('label', 'tooltipDesktop', 'tooltipBrowser', 'saved', 'showInFolder', 'failed')

T = {
 'en': ("Auto-save when session ends",
        "When a session ends, save the whole conversation — both sides, originals and translations — as a .txt file in your Downloads folder.",
        "When a session ends, download the whole conversation — both sides, originals and translations — as a .txt file. Closing the side panel during a session does not save it; stop the session first.",
        "Conversation saved: {{filename}}", "Show in folder",
        "Couldn't auto-save the conversation. You can still save it with “{{action}}” in the export menu."),
 'ar': ("حفظ تلقائي عند انتهاء الجلسة",
        "عند انتهاء الجلسة، تُحفظ المحادثة كاملة — الطرفان، النصوص الأصلية والترجمات — كملف .txt في مجلد التنزيلات.",
        "عند انتهاء الجلسة، تُنزَّل المحادثة كاملة — الطرفان، النصوص الأصلية والترجمات — كملف .txt. إغلاق اللوحة الجانبية أثناء الجلسة لا يحفظها؛ أنهِ الجلسة أولاً.",
        "تم حفظ المحادثة: {{filename}}", "إظهار في المجلد",
        "تعذّر حفظ المحادثة تلقائيًا. لا يزال بإمكانك حفظها عبر «{{action}}» في قائمة التصدير."),
 'bn': ("সেশন শেষ হলে স্বয়ংক্রিয়ভাবে সংরক্ষণ",
        "সেশন শেষ হলে পুরো কথোপকথন — উভয় পক্ষ, মূল লেখা ও অনুবাদ — .txt ফাইল হিসেবে আপনার ডাউনলোড ফোল্ডারে সংরক্ষিত হয়।",
        "সেশন শেষ হলে পুরো কথোপকথন — উভয় পক্ষ, মূল লেখা ও অনুবাদ — .txt ফাইল হিসেবে ডাউনলোড হয়। সেশন চলাকালীন সাইড প্যানেল বন্ধ করলে এটি সংরক্ষিত হয় না; আগে সেশন শেষ করুন।",
        "কথোপকথন সংরক্ষিত: {{filename}}", "ফোল্ডারে দেখান",
        "কথোপকথন স্বয়ংক্রিয়ভাবে সংরক্ষণ করা যায়নি। আপনি এখনও এক্সপোর্ট মেনুর “{{action}}” দিয়ে এটি সংরক্ষণ করতে পারেন।"),
 'de': ("Bei Sitzungsende automatisch speichern",
        "Wenn eine Sitzung endet, wird die gesamte Unterhaltung – beide Seiten, Originale und Übersetzungen – als .txt-Datei im Downloads-Ordner gespeichert.",
        "Wenn eine Sitzung endet, wird die gesamte Unterhaltung – beide Seiten, Originale und Übersetzungen – als .txt-Datei heruntergeladen. Wird die Seitenleiste während einer Sitzung geschlossen, wird nichts gespeichert; zuerst die Sitzung beenden.",
        "Unterhaltung gespeichert: {{filename}}", "Im Ordner anzeigen",
        "Die Unterhaltung konnte nicht automatisch gespeichert werden. Sie lässt sich weiterhin über „{{action}}“ im Exportmenü speichern."),
 'es': ("Guardar automáticamente al terminar la sesión",
        "Al terminar una sesión, se guarda la conversación completa —ambas partes, originales y traducciones— como archivo .txt en tu carpeta de Descargas.",
        "Al terminar una sesión, se descarga la conversación completa —ambas partes, originales y traducciones— como archivo .txt. Cerrar el panel lateral durante una sesión no la guarda; termina la sesión primero.",
        "Conversación guardada: {{filename}}", "Mostrar en la carpeta",
        "No se pudo guardar automáticamente la conversación. Aún puedes guardarla con «{{action}}» en el menú de exportación."),
 'fa': ("ذخیره خودکار هنگام پایان جلسه",
        "هنگام پایان جلسه، کل گفتگو — هر دو طرف، متن‌های اصلی و ترجمه‌ها — به صورت فایل .txt در پوشه دانلودهای شما ذخیره می‌شود.",
        "هنگام پایان جلسه، کل گفتگو — هر دو طرف، متن‌های اصلی و ترجمه‌ها — به صورت فایل .txt دانلود می‌شود. بستن پنل کناری در حین جلسه آن را ذخیره نمی‌کند؛ ابتدا جلسه را پایان دهید.",
        "گفتگو ذخیره شد: {{filename}}", "نمایش در پوشه",
        "ذخیره خودکار گفتگو انجام نشد. همچنان می‌توانید آن را با «{{action}}» در منوی خروجی ذخیره کنید."),
 'fi': ("Tallenna automaattisesti istunnon päättyessä",
        "Kun istunto päättyy, koko keskustelu – molemmat osapuolet, alkuperäiset ja käännökset – tallennetaan .txt-tiedostona Lataukset-kansioon.",
        "Kun istunto päättyy, koko keskustelu – molemmat osapuolet, alkuperäiset ja käännökset – ladataan .txt-tiedostona. Sivupaneelin sulkeminen istunnon aikana ei tallenna sitä; lopeta istunto ensin.",
        "Keskustelu tallennettu: {{filename}}", "Näytä kansiossa",
        "Keskustelun automaattinen tallennus epäonnistui. Voit yhä tallentaa sen vientivalikon kohdasta ”{{action}}”."),
 'fil': ("Awtomatikong i-save kapag natapos ang session",
         "Kapag natapos ang isang session, ise-save ang buong usapan — parehong panig, mga orihinal at salin — bilang .txt file sa iyong Downloads folder.",
         "Kapag natapos ang isang session, ida-download ang buong usapan — parehong panig, mga orihinal at salin — bilang .txt file. Hindi ito nase-save kapag isinara ang side panel habang may session; tapusin muna ang session.",
         "Na-save ang usapan: {{filename}}", "Ipakita sa folder",
         "Hindi awtomatikong na-save ang usapan. Maaari mo pa rin itong i-save gamit ang “{{action}}” sa export menu."),
 'fr': ("Enregistrer automatiquement en fin de session",
        "À la fin d'une session, la conversation complète — les deux côtés, originaux et traductions — est enregistrée en fichier .txt dans votre dossier Téléchargements.",
        "À la fin d'une session, la conversation complète — les deux côtés, originaux et traductions — est téléchargée en fichier .txt. Fermer le panneau latéral pendant une session ne l'enregistre pas ; terminez d'abord la session.",
        "Conversation enregistrée : {{filename}}", "Afficher dans le dossier",
        "Impossible d'enregistrer automatiquement la conversation. Vous pouvez toujours l'enregistrer avec « {{action}} » dans le menu d'exportation."),
 'he': ("שמירה אוטומטית בסיום ההפעלה",
        "בסיום הפעלה, השיחה המלאה — שני הצדדים, המקור והתרגומים — נשמרת כקובץ .txt בתיקיית ההורדות.",
        "בסיום הפעלה, השיחה המלאה — שני הצדדים, המקור והתרגומים — מורדת כקובץ .txt. סגירת החלונית הצדדית במהלך הפעלה לא שומרת אותה; יש לסיים את ההפעלה קודם.",
        "השיחה נשמרה: {{filename}}", "הצג בתיקייה",
        "לא ניתן היה לשמור את השיחה אוטומטית. עדיין אפשר לשמור אותה דרך „{{action}}” בתפריט הייצוא."),
 'hi': ("सत्र समाप्त होने पर स्वतः सहेजें",
        "सत्र समाप्त होने पर पूरा वार्तालाप — दोनों पक्ष, मूल और अनुवाद — .txt फ़ाइल के रूप में आपके डाउनलोड फ़ोल्डर में सहेजा जाता है।",
        "सत्र समाप्त होने पर पूरा वार्तालाप — दोनों पक्ष, मूल और अनुवाद — .txt फ़ाइल के रूप में डाउनलोड होता है। सत्र के दौरान साइड पैनल बंद करने से यह सहेजा नहीं जाता; पहले सत्र समाप्त करें।",
        "वार्तालाप सहेजा गया: {{filename}}", "फ़ोल्डर में दिखाएँ",
        "वार्तालाप स्वतः सहेजा नहीं जा सका। आप अभी भी निर्यात मेनू में “{{action}}” से इसे सहेज सकते हैं।"),
 'id': ("Simpan otomatis saat sesi berakhir",
        "Saat sesi berakhir, seluruh percakapan — kedua pihak, teks asli dan terjemahan — disimpan sebagai file .txt di folder Unduhan Anda.",
        "Saat sesi berakhir, seluruh percakapan — kedua pihak, teks asli dan terjemahan — diunduh sebagai file .txt. Menutup panel samping selama sesi tidak menyimpannya; akhiri sesi terlebih dahulu.",
        "Percakapan disimpan: {{filename}}", "Tampilkan di folder",
        "Percakapan tidak dapat disimpan otomatis. Anda masih bisa menyimpannya dengan “{{action}}” di menu ekspor."),
 'it': ("Salva automaticamente a fine sessione",
        "Al termine di una sessione, l'intera conversazione — entrambe le parti, originali e traduzioni — viene salvata come file .txt nella cartella Download.",
        "Al termine di una sessione, l'intera conversazione — entrambe le parti, originali e traduzioni — viene scaricata come file .txt. Chiudere il pannello laterale durante una sessione non la salva; termina prima la sessione.",
        "Conversazione salvata: {{filename}}", "Mostra nella cartella",
        "Impossibile salvare automaticamente la conversazione. Puoi ancora salvarla con «{{action}}» nel menu di esportazione."),
 'ja': ("セッション終了時に自動保存",
        "セッションが終わると、会話全体（双方の原文と訳文）を .txt ファイルとして「ダウンロード」フォルダに保存します。",
        "セッションが終わると、会話全体（双方の原文と訳文）を .txt ファイルとしてダウンロードします。セッション中にサイドパネルを閉じると保存されません。先にセッションを終了してください。",
        "会話を保存しました：{{filename}}", "フォルダで表示",
        "会話を自動保存できませんでした。エクスポートメニューの「{{action}}」から保存できます。"),
 'ko': ("세션 종료 시 자동 저장",
        "세션이 끝나면 전체 대화(양쪽의 원문과 번역)를 .txt 파일로 다운로드 폴더에 저장합니다.",
        "세션이 끝나면 전체 대화(양쪽의 원문과 번역)를 .txt 파일로 다운로드합니다. 세션 중에 사이드 패널을 닫으면 저장되지 않으니 먼저 세션을 종료하세요.",
        "대화를 저장했습니다: {{filename}}", "폴더에서 보기",
        "대화를 자동 저장하지 못했습니다. 내보내기 메뉴의 “{{action}}”으로 저장할 수 있습니다."),
 'ms': ("Simpan secara automatik apabila sesi tamat",
        "Apabila sesi tamat, keseluruhan perbualan — kedua-dua pihak, teks asal dan terjemahan — disimpan sebagai fail .txt dalam folder Muat Turun anda.",
        "Apabila sesi tamat, keseluruhan perbualan — kedua-dua pihak, teks asal dan terjemahan — dimuat turun sebagai fail .txt. Menutup panel sisi semasa sesi tidak menyimpannya; tamatkan sesi dahulu.",
        "Perbualan disimpan: {{filename}}", "Tunjukkan dalam folder",
        "Perbualan tidak dapat disimpan secara automatik. Anda masih boleh menyimpannya dengan “{{action}}” dalam menu eksport."),
 'nl': ("Automatisch opslaan als de sessie eindigt",
        "Als een sessie eindigt, wordt het hele gesprek — beide kanten, originelen en vertalingen — als .txt-bestand opgeslagen in je map Downloads.",
        "Als een sessie eindigt, wordt het hele gesprek — beide kanten, originelen en vertalingen — als .txt-bestand gedownload. Het zijpaneel sluiten tijdens een sessie slaat het niet op; beëindig eerst de sessie.",
        "Gesprek opgeslagen: {{filename}}", "Tonen in map",
        "Het gesprek kon niet automatisch worden opgeslagen. Je kunt het nog opslaan met ‘{{action}}’ in het exportmenu."),
 'pl': ("Zapisuj automatycznie po zakończeniu sesji",
        "Po zakończeniu sesji cała rozmowa — obie strony, oryginały i tłumaczenia — zostaje zapisana jako plik .txt w folderze Pobrane.",
        "Po zakończeniu sesji cała rozmowa — obie strony, oryginały i tłumaczenia — zostaje pobrana jako plik .txt. Zamknięcie panelu bocznego w trakcie sesji jej nie zapisuje; najpierw zakończ sesję.",
        "Rozmowa zapisana: {{filename}}", "Pokaż w folderze",
        "Nie udało się automatycznie zapisać rozmowy. Nadal możesz ją zapisać, używając „{{action}}” w menu eksportu."),
 'pt_BR': ("Salvar automaticamente ao encerrar a sessão",
           "Ao encerrar uma sessão, a conversa inteira — os dois lados, originais e traduções — é salva como arquivo .txt na sua pasta Downloads.",
           "Ao encerrar uma sessão, a conversa inteira — os dois lados, originais e traduções — é baixada como arquivo .txt. Fechar o painel lateral durante uma sessão não a salva; encerre a sessão primeiro.",
           "Conversa salva: {{filename}}", "Mostrar na pasta",
           "Não foi possível salvar a conversa automaticamente. Você ainda pode salvá-la com “{{action}}” no menu de exportação."),
 'pt_PT': ("Guardar automaticamente ao terminar a sessão",
           "Ao terminar uma sessão, a conversa completa — os dois lados, originais e traduções — é guardada como ficheiro .txt na sua pasta Transferências.",
           "Ao terminar uma sessão, a conversa completa — os dois lados, originais e traduções — é transferida como ficheiro .txt. Fechar o painel lateral durante uma sessão não a guarda; termine primeiro a sessão.",
           "Conversa guardada: {{filename}}", "Mostrar na pasta",
           "Não foi possível guardar a conversa automaticamente. Ainda pode guardá-la com «{{action}}» no menu de exportação."),
 'ru': ("Автосохранение по окончании сессии",
        "По окончании сессии весь разговор — обе стороны, оригиналы и переводы — сохраняется в файл .txt в папке «Загрузки».",
        "По окончании сессии весь разговор — обе стороны, оригиналы и переводы — скачивается как файл .txt. Если закрыть боковую панель во время сессии, он не сохранится; сначала завершите сессию.",
        "Разговор сохранён: {{filename}}", "Показать в папке",
        "Не удалось автоматически сохранить разговор. Его по-прежнему можно сохранить через «{{action}}» в меню экспорта."),
 'sv': ("Spara automatiskt när sessionen avslutas",
        "När en session avslutas sparas hela konversationen – båda sidor, original och översättningar – som en .txt-fil i mappen Hämtade filer.",
        "När en session avslutas laddas hela konversationen – båda sidor, original och översättningar – ned som en .txt-fil. Om sidopanelen stängs under en session sparas den inte; avsluta sessionen först.",
        "Konversationen sparad: {{filename}}", "Visa i mapp",
        "Konversationen kunde inte sparas automatiskt. Du kan fortfarande spara den med ”{{action}}” i exportmenyn."),
 'ta': ("அமர்வு முடிந்ததும் தானாகச் சேமி",
        "அமர்வு முடிந்ததும் முழு உரையாடலும் — இரு தரப்பும், மூலமும் மொழிபெயர்ப்பும் — .txt கோப்பாக உங்கள் பதிவிறக்கங்கள் கோப்புறையில் சேமிக்கப்படும்.",
        "அமர்வு முடிந்ததும் முழு உரையாடலும் — இரு தரப்பும், மூலமும் மொழிபெயர்ப்பும் — .txt கோப்பாகப் பதிவிறக்கப்படும். அமர்வின்போது பக்கப் பலகத்தை மூடினால் சேமிக்கப்படாது; முதலில் அமர்வை முடிக்கவும்.",
        "உரையாடல் சேமிக்கப்பட்டது: {{filename}}", "கோப்புறையில் காட்டு",
        "உரையாடலைத் தானாகச் சேமிக்க முடியவில்லை. ஏற்றுமதி மெனுவில் உள்ள “{{action}}” மூலம் இன்னும் சேமிக்கலாம்."),
 'te': ("సెషన్ ముగిసినప్పుడు స్వయంచాలకంగా సేవ్ చేయి",
        "సెషన్ ముగిసినప్పుడు మొత్తం సంభాషణ — రెండు వైపులా, అసలు పాఠం మరియు అనువాదాలు — .txt ఫైల్‌గా మీ డౌన్‌లోడ్‌ల ఫోల్డర్‌లో సేవ్ అవుతుంది.",
        "సెషన్ ముగిసినప్పుడు మొత్తం సంభాషణ — రెండు వైపులా, అసలు పాఠం మరియు అనువాదాలు — .txt ఫైల్‌గా డౌన్‌లోడ్ అవుతుంది. సెషన్ జరుగుతుండగా సైడ్ ప్యానెల్ మూసివేస్తే అది సేవ్ కాదు; ముందుగా సెషన్‌ను ముగించండి.",
        "సంభాషణ సేవ్ అయింది: {{filename}}", "ఫోల్డర్‌లో చూపించు",
        "సంభాషణను స్వయంచాలకంగా సేవ్ చేయలేకపోయాం. ఎగుమతి మెనూలోని “{{action}}” ద్వారా ఇంకా సేవ్ చేయవచ్చు."),
 'th': ("บันทึกอัตโนมัติเมื่อจบเซสชัน",
        "เมื่อเซสชันจบ บทสนทนาทั้งหมด — ทั้งสองฝ่าย ต้นฉบับและคำแปล — จะถูกบันทึกเป็นไฟล์ .txt ในโฟลเดอร์ดาวน์โหลดของคุณ",
        "เมื่อเซสชันจบ บทสนทนาทั้งหมด — ทั้งสองฝ่าย ต้นฉบับและคำแปล — จะถูกดาวน์โหลดเป็นไฟล์ .txt การปิดแผงด้านข้างระหว่างเซสชันจะไม่บันทึก ให้จบเซสชันก่อน",
        "บันทึกบทสนทนาแล้ว: {{filename}}", "แสดงในโฟลเดอร์",
        "ไม่สามารถบันทึกบทสนทนาอัตโนมัติได้ คุณยังบันทึกได้ด้วย “{{action}}” ในเมนูส่งออก"),
 'tr': ("Oturum bitince otomatik kaydet",
        "Bir oturum bittiğinde sohbetin tamamı — iki taraf, orijinaller ve çeviriler — .txt dosyası olarak İndirilenler klasörüne kaydedilir.",
        "Bir oturum bittiğinde sohbetin tamamı — iki taraf, orijinaller ve çeviriler — .txt dosyası olarak indirilir. Oturum sırasında yan paneli kapatmak sohbeti kaydetmez; önce oturumu sonlandırın.",
        "Sohbet kaydedildi: {{filename}}", "Klasörde göster",
        "Sohbet otomatik olarak kaydedilemedi. Dışa aktarma menüsündeki “{{action}}” ile yine de kaydedebilirsiniz."),
 'uk': ("Автозбереження після завершення сесії",
        "Після завершення сесії вся розмова — обидві сторони, оригінали й переклади — зберігається у файл .txt у теці «Завантаження».",
        "Після завершення сесії вся розмова — обидві сторони, оригінали й переклади — завантажується як файл .txt. Якщо закрити бічну панель під час сесії, її не буде збережено; спершу завершіть сесію.",
        "Розмову збережено: {{filename}}", "Показати в теці",
        "Не вдалося автоматично зберегти розмову. Її все ще можна зберегти через «{{action}}» у меню експорту."),
 'vi': ("Tự động lưu khi kết thúc phiên",
        "Khi một phiên kết thúc, toàn bộ hội thoại — cả hai bên, bản gốc và bản dịch — được lưu thành tệp .txt trong thư mục Tải xuống của bạn.",
        "Khi một phiên kết thúc, toàn bộ hội thoại — cả hai bên, bản gốc và bản dịch — được tải xuống dưới dạng tệp .txt. Đóng bảng bên khi đang có phiên sẽ không lưu; hãy kết thúc phiên trước.",
        "Đã lưu hội thoại: {{filename}}", "Hiện trong thư mục",
        "Không thể tự động lưu hội thoại. Bạn vẫn có thể lưu bằng “{{action}}” trong menu xuất."),
 'zh_CN': ("会话结束时自动保存",
           "会话结束时，把完整对话（双方的原文和译文）保存为 .txt 文件，放在「下载」文件夹。",
           "会话结束时，把完整对话（双方的原文和译文）下载为 .txt 文件。会话进行中关闭侧边栏不会保存，请先结束会话。",
           "对话已保存：{{filename}}", "在文件夹中显示",
           "对话自动保存失败。你仍可以在导出菜单中用「{{action}}」保存。"),
 'zh_TW': ("工作階段結束時自動儲存",
           "工作階段結束時，將完整對話（雙方的原文與譯文）儲存為 .txt 檔案，放在「下載」資料夾。",
           "工作階段結束時，將完整對話（雙方的原文與譯文）下載為 .txt 檔案。工作階段進行中關閉側邊欄不會儲存，請先結束工作階段。",
           "對話已儲存：{{filename}}", "在資料夾中顯示",
           "對話自動儲存失敗。你仍可在匯出選單中使用「{{action}}」儲存。"),
}

for path in sorted(glob.glob('src/locales/*/translation.json')):
    loc = path.split('/')[2]
    data = json.load(open(path, encoding='utf-8'))
    data['mainPanel']['export']['autoSave'] = dict(zip(KEYS, T[loc]))
    data.get('simpleConfig', {}).pop('autoSaveOnStop', None)
    data.get('simpleConfig', {}).pop('autoSaveOnStopDesc', None)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print('updated', loc)

missing = sorted(set(p.split('/')[2] for p in glob.glob('src/locales/*/translation.json')) - set(T))
assert not missing, f'no strings for {missing}'
```

(The locale files round-trip byte-for-byte through `json.dumps(…, ensure_ascii=False, indent=2) + '\n'` — verified on the base commit — so only the touched keys change.)

- [ ] **Step 3: Run the script**

Run: `python3 "$CLAUDE_JOB_DIR/tmp/autosave_locales.py"`
Expected: 30 `updated <locale>` lines, no assertion error.

- [ ] **Step 4: Verify keys and placeholders**

Run: `npx vitest run src/locales/locales.consistency.test.ts src/components/Settings/sections` → Expected: PASS.
Run: `git diff --stat -- src/locales | tail -1` → Expected: `30 files changed`.
Run: `grep -rl "autoSaveOnStop" src/locales` → Expected: no output.
Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → Expected: `317`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx src/locales
git commit -F - <<'EOF'
feat(i18n): auto-save strings; move the switch out of Languages

Adds mainPanel.export.autoSave.* in all 30 locales and drops the PR's
simpleConfig.autoSaveOnStop keys and its Languages toggle — the switch
now lives in the Export menu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 11: Verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: every file passes. Compare against `origin/main` if a failure looks unrelated: `git stash` is shared across sessions — do NOT use it; check out `origin/main` in a scratch worktree instead.

- [ ] **Step 2: Type-check totals**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → Expected: `317`.
Run: `npx tsc --noEmit -p . 2>&1 | grep -c "src/components/MainPanel/MainPanel.tsx"` → Expected: `11`.

- [ ] **Step 3: Nothing of the PR's first shape is left**

Run: `grep -rn "pendingAutoSaveRef\|deriveAutoSaveTitle\|simpleConfig.autoSaveOnStop" src electron` → Expected: no output.
Run: `git diff 80bc11b9 --stat -- src/components/MainPanel/MainPanel.tsx` and confirm MainPanel imports nothing from `utils/conversationExport` (`grep -n "conversationExport" src/components/MainPanel/MainPanel.tsx` → no output).

- [ ] **Step 4: Render every locale (menu row + subtitle-bar child window height).** Follow the headless-Chromium + CDP recipe in memory `sokuji-ui-decisions-by-rendering`: `npm run dev` from the worktree (restart it after edits — memory `sokuji-worktree-vite-stale-transforms`), open the app, start nothing, open the Export menu, and for each of the 30 locales screenshot the menu. Check that the row's label fits on at most two lines within the menu's width, and measure `.export-menu`'s `scrollHeight` in a 240px-wide container: if it exceeds 182, raise `height={182}` in `ExportButton.tsx` to that value and commit `fix(export): child-window menu height fits the auto-save row`.

- [ ] **Step 5: Real-environment checks — run them, or list what was not run in the report.**

| Where | Check |
|---|---|
| Desktop on this GB10 box: `npm run electron:dev` in the worktree | Toolbar visible before a session; Clear disabled; toggle on; start a session, say something, Stop → toast "Conversation saved: …"; the file is in `~/Downloads`; "Show in folder" opens it |
| same | Start a session, speak, close the window mid-session → the window closes after a moment; the file is in `~/Downloads` |
| same | Start, then Cancel during Start → no file |
| Mac mini M4 (memory `sokuji-test-fleet`) | Cmd+Q mid-session → file written, app quits, no leftover virtual devices |
| Chrome extension (`npm run build` + load `extension/`) | Stop → download bubble; a stop caused by a network drop (no click) → note whether Chrome's limiter prompts |
| A live Both session | The other party mid-sentence at Stop → their last line is in the file |

- [ ] **Step 6: Report** — commits on the branch, test and type-check results, the deviations listed at the top of this plan, which real-environment checks ran and which did not, and that nothing has been pushed. Pushing to `sivertillia`'s fork (branch `claude/function-auto-save-titles-kwsi32`, PR `kizuna-ai-lab/sokuji#537`) waits for jiangzhuo's explicit go.
