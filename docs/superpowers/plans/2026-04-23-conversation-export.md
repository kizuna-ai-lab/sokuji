# Conversation Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Export button to the conversation toolbar in `MainPanel` that lets users copy a conversation transcript to clipboard or download it as `.txt` / `.json`.

**Architecture:** A new pure-function module `src/utils/conversationExport.ts` does all data normalization, formatting, and side effects (clipboard / download). A new `<ExportButton/>` component owns the dropdown UI (built on `@floating-ui/react`, the same library that powers the existing `Tooltip`). A minimal `<Toast/>` component is added because none exists. `MainPanel` is touched in only two places: a new import and a new `<ExportButton/>` element inserted into the toolbar between the Compact toggle and the Clear button.

**Tech Stack:** React + TypeScript + Zustand + `@floating-ui/react` + Lucide icons + i18next + SCSS modules.

**Spec:** `docs/superpowers/specs/2026-04-23-conversation-export-design.md`

**Testing approach:** Per user direction, no automated unit/component tests are written. Each task ends with a manual verification step describing exactly what to check.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/utils/conversationExport.ts` | Create | Pure functions: normalize, format `.txt`/`.json`, copy, download |
| `src/components/Toast/Toast.tsx` | Create | Minimal portal-mounted toast with auto-dismiss |
| `src/components/Toast/Toast.scss` | Create | Toast styles |
| `src/components/Toast/ToastContext.tsx` | Create | Provider + `useToast()` hook |
| `src/components/MainPanel/ExportButton.tsx` | Create | Toolbar button + dropdown menu |
| `src/components/MainPanel/ExportButton.scss` | Create | Button + dropdown styles |
| `src/locales/en/translation.json` | Modify | Add `mainPanel.export.*` and `mainPanel.toolbar.export` keys |
| `src/components/MainPanel/MainPanel.tsx` | Modify | Insert `<ExportButton/>` in toolbar; import |
| `src/App.tsx` (or wherever providers are mounted) | Modify | Wrap app with `<ToastProvider/>` |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Open the translation file and locate the `mainPanel` block**

Run: `grep -n '"mainPanel"' src/locales/en/translation.json`
Expected: a line number for the `"mainPanel": {` key. Other locales (e.g. `zh-CN`) are intentionally not modified — they will fall back to English via i18next missing-key behavior. A future translation PR can backfill.

- [ ] **Step 2: Add new keys to `mainPanel` block**

Inside the existing `"mainPanel": { ... }` object, add (or merge with existing) the following keys. If `mainPanel.toolbar` already exists, merge into it; if not, create the sub-object:

```json
"toolbar": {
  "export": "Export conversation"
},
"export": {
  "copyToClipboard": "Copy to clipboard",
  "downloadTxt": "Download as .txt",
  "downloadJson": "Download as .json",
  "copySuccess": "Conversation copied to clipboard",
  "copyFailed": "Failed to copy. Check browser permissions.",
  "speakerYou": "You",
  "speakerOther": "Other",
  "headerTitle": "Sokuji conversation export",
  "headerGenerated": "Generated",
  "headerProvider": "Provider",
  "headerModels": "Models",
  "headerSource": "Source",
  "headerTarget": "Target",
  "headerNote": "settings reflect current state at export, not mid-session changes",
  "noTranscript": "(no transcript)",
  "noTranslation": "(no translation)"
}
```

If `mainPanel` already has an `export` or `toolbar` sub-key, MERGE — do not overwrite siblings.

- [ ] **Step 3: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json','utf8')); console.log('ok')"`
Expected: prints `ok`. If it errors, fix the trailing-comma or brace mismatch reported.

- [ ] **Step 4: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "feat(i18n): add conversation export keys (en)"
```

---

## Task 2: Create the conversationExport utility — types and helpers

**Files:**
- Create: `src/utils/conversationExport.ts`

- [ ] **Step 1: Confirm needed imports are available**

Run: `grep -n "ConversationItem" src/services/interfaces/IClient.ts | head -3`
Expected: line ~9 with `export interface ConversationItem`. Also confirm `Provider` enum location:
Run: `grep -n "export enum Provider" src/types/Provider.ts`
Expected: line ~10.

- [ ] **Step 2: Create the file with types, constants, and helpers (no formatting yet)**

Write `src/utils/conversationExport.ts`:

```ts
import type { ConversationItem } from '../services/interfaces/IClient';
import { Provider } from '../types/Provider';

// Build-time injected by vite.config.ts (define: { __APP_VERSION__ })
declare const __APP_VERSION__: string | undefined;

/** A conversation message after filtering and field extraction. */
export interface NormalizedMessage {
  id: string;
  /** ms since epoch */
  createdAt: number;
  source: 'speaker' | 'participant';
  /** From `formatted.transcript`. `null` when missing or empty. */
  originalText: string | null;
  /** From `formatted.text`. `null` when missing or empty. */
  translatedText: string | null;
}

/** Snapshot of session-level metadata captured at export time. */
export interface SessionMetadata {
  /** ISO 8601 UTC */
  exportedAt: string;
  /** From __APP_VERSION__; null if unavailable */
  appVersion: string | null;
  /** Raw provider id (e.g. 'openai', 'local_inference') */
  provider: string;
  /** Variable shape per provider — see getActiveModelInfo */
  models: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
}

/** i18n strings the txt formatter needs (kept as parameter to keep this module React-free). */
export interface TxtI18n {
  speakerYou: string;
  speakerOther: string;
  headerTitle: string;
  headerGenerated: string;
  headerProvider: string;
  headerModels: string;
  headerSource: string;
  headerTarget: string;
  headerNote: string;
  noTranscript: string;
  noTranslation: string;
}

const SPEAKER_COLUMN_WIDTH = 8; // includes trailing colon: "You:    " / "Other:  "
const ARROW = '→'; // →

/** Build "key=value, key=value" or empty string. */
function formatModelsLine(models: Record<string, string>): string {
  const entries = Object.entries(models).filter(([, v]) => v && v.length > 0);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

/** Format ms timestamp as local "YYYY-MM-DD HH:MM:SS". */
function formatLocalDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp as local "HH:MM:SS". */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp for use in filename: "YYYYMMDD-HHMMSS" (local time). */
export function formatTimestampForFilename(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Get the `__APP_VERSION__` build constant safely. */
export function getAppVersion(): string | null {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Confirm the file compiles in the project's TS check**

Run: `npx tsc --noEmit -p .` (or whatever the project uses — try `npm run build` if tsc isn't direct)
Expected: no errors mentioning `conversationExport.ts`. Other errors unrelated to this file are acceptable for this checkpoint (we'll re-check at end of next task).

- [ ] **Step 4: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): scaffold conversationExport types and helpers"
```

---

## Task 3: conversationExport — normalize and getActiveModelInfo

**Files:**
- Modify: `src/utils/conversationExport.ts`

- [ ] **Step 1: Append `normalizeMessages` to the file**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Filter and project a combined items array into NormalizedMessage[].
 * Input is the already-merged-and-sorted `combinedItems` from MainPanel
 * (each item carries a `source: 'speaker' | 'participant'` tag).
 */
export function normalizeMessages(
  combinedItems: Array<ConversationItem & { source?: string }>
): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const item of combinedItems) {
    if (item.status !== 'completed') continue;
    if (item.type !== 'message') continue;
    if (item.role === 'system') continue;

    const transcript = item.formatted?.transcript?.trim() || '';
    const text = item.formatted?.text?.trim() || '';
    if (!transcript && !text) continue;

    const source = item.source === 'participant' ? 'participant' : 'speaker';

    out.push({
      id: item.id,
      createdAt: item.createdAt ?? 0,
      source,
      originalText: transcript || null,
      translatedText: text || null,
    });
  }
  return out;
}
```

- [ ] **Step 2: Append `getActiveModelInfo`**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Extract per-provider model identifiers as a flat object.
 * Empty / unselected fields are omitted (never serialized as "" or null).
 * Caller passes in the already-resolved current-provider settings object
 * (whatever `getCurrentProviderSettings()` returns), plus the provider id,
 * plus the local-inference settings (needed for the LOCAL_INFERENCE branch
 * because its model fields are not in the "current provider settings"
 * returned by the dispatcher — they're separate sub-objects on the store).
 */
export function getActiveModelInfo(
  provider: string,
  currentSettings: any,
  localInferenceSettings: any
): Record<string, string> {
  const result: Record<string, string> = {};

  const put = (key: string, value: any) => {
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  };

  switch (provider) {
    case Provider.OPENAI:
    case Provider.KIZUNA_AI:
    case Provider.OPENAI_COMPATIBLE:
      put('translation', currentSettings?.model);
      put('transcription', currentSettings?.transcriptModel);
      break;
    case Provider.GEMINI:
      put('translation', currentSettings?.model);
      break;
    case Provider.PALABRA_AI:
    case Provider.VOLCENGINE_ST:
    case Provider.VOLCENGINE_AST2:
      // These providers don't expose a user-selectable model on settings;
      // their model name is fixed inside the client code. Leave models empty.
      break;
    case Provider.LOCAL_INFERENCE:
      put('asr', localInferenceSettings?.asrModel);
      put('translation', localInferenceSettings?.translationModel);
      put('tts', localInferenceSettings?.ttsModel);
      break;
    default:
      // Unknown provider — leave models empty rather than guess
      break;
  }

  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): add normalizeMessages and getActiveModelInfo"
```

---

## Task 4: conversationExport — buildSessionMetadata

**Files:**
- Modify: `src/utils/conversationExport.ts`

- [ ] **Step 1: Append `buildSessionMetadata`**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Snapshot the session-level metadata at export time.
 * Caller passes pre-resolved values to keep this module free of store deps.
 */
export function buildSessionMetadata(args: {
  provider: string;
  models: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
}): SessionMetadata {
  return {
    exportedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    provider: args.provider,
    models: args.models,
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): add buildSessionMetadata"
```

---

## Task 5: conversationExport — formatAsTxt

**Files:**
- Modify: `src/utils/conversationExport.ts`

- [ ] **Step 1: Append `formatAsTxt`**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Format messages as the plain-text representation defined in the spec.
 *
 * Header (5 or 6 lines depending on whether models is empty), blank line, then
 * one line per message. The clipboard payload uses `includeHeader: false` to
 * skip the header + blank line.
 */
export function formatAsTxt(
  messages: NormalizedMessage[],
  metadata: SessionMetadata,
  i18n: TxtI18n,
  opts: { includeHeader: boolean }
): string {
  const lines: string[] = [];

  if (opts.includeHeader) {
    lines.push(i18n.headerTitle);
    lines.push(`${i18n.headerGenerated}: ${formatLocalDateTime(Date.parse(metadata.exportedAt))}`);
    lines.push(`${i18n.headerProvider}: ${metadata.provider}`);
    const modelsLine = formatModelsLine(metadata.models);
    if (modelsLine.length > 0) {
      lines.push(`${i18n.headerModels}: ${modelsLine}`);
    }
    lines.push(`${i18n.headerSource}: ${metadata.sourceLanguage} ${ARROW} ${i18n.headerTarget}: ${metadata.targetLanguage}`);
    lines.push(`Note: ${i18n.headerNote}.`);
    lines.push('');
  }

  // Speaker label column width: max of the two labels + 1 for the colon, but
  // never less than the spec's recommended 8. Computed dynamically so longer
  // localized labels still align.
  const colWidth = Math.max(
    SPEAKER_COLUMN_WIDTH,
    i18n.speakerYou.length + 1 + 1, // label + ":" + at-least-one-space
    i18n.speakerOther.length + 1 + 1
  );

  for (const msg of messages) {
    const label = msg.source === 'speaker' ? i18n.speakerYou : i18n.speakerOther;
    const speakerField = `${label}:`.padEnd(colWidth, ' ');
    const original = msg.originalText ?? i18n.noTranscript;
    const translated = msg.translatedText ?? i18n.noTranslation;
    lines.push(`[${formatLocalTime(msg.createdAt)}] ${speakerField}${original}  ${ARROW}  ${translated}`);
  }

  return lines.join('\n') + '\n';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): add formatAsTxt"
```

---

## Task 6: conversationExport — formatAsJson

**Files:**
- Modify: `src/utils/conversationExport.ts`

- [ ] **Step 1: Append `formatAsJson`**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Format messages as the JSON representation defined in the spec.
 * Output is pretty-printed with 2-space indent and a trailing newline.
 */
export function formatAsJson(
  messages: NormalizedMessage[],
  metadata: SessionMetadata
): string {
  const payload = {
    exportedAt: metadata.exportedAt,
    appVersion: metadata.appVersion,
    session: {
      provider: metadata.provider,
      models: metadata.models,
      sourceLanguage: metadata.sourceLanguage,
      targetLanguage: metadata.targetLanguage,
      note: 'settings reflect current state at export, not mid-session changes',
    },
    messageCount: messages.length,
    messages: messages.map(m => ({
      id: m.id,
      timestamp: new Date(m.createdAt).toISOString(),
      speaker: m.source === 'speaker' ? 'you' : 'other',
      originalText: m.originalText,
      translatedText: m.translatedText,
    })),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): add formatAsJson"
```

---

## Task 7: conversationExport — copyToClipboard and downloadFile

**Files:**
- Modify: `src/utils/conversationExport.ts`

- [ ] **Step 1: Append the side-effect helpers**

Append to `src/utils/conversationExport.ts`:

```ts
/**
 * Copy a text payload to the system clipboard.
 * Returns true on success, false if both the modern and legacy paths fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Trigger a file download using a synthetic anchor + blob URL.
 * Works in both Electron renderer and Chrome extension side panel without
 * any extension permissions (uses HTML's standard `download` attribute).
 */
export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Verify the file builds**

Run: `npm run build`
Expected: build succeeds. If TS errors point at `conversationExport.ts`, fix them before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/utils/conversationExport.ts
git commit -m "feat(export): add copyToClipboard and downloadFile"
```

---

## Task 8: Toast component and provider

**Files:**
- Create: `src/components/Toast/Toast.tsx`
- Create: `src/components/Toast/Toast.scss`
- Create: `src/components/Toast/ToastContext.tsx`
- Create: `src/components/Toast/index.ts`

- [ ] **Step 1: First confirm no existing Toast exists**

Run: `grep -rln "showToast\|<Toast\|ToastProvider" src/ 2>/dev/null`
Expected: empty output. If anything appears, STOP this task and reuse the existing component instead — adapt subsequent tasks accordingly.

- [ ] **Step 2: Create the Toast view component**

Write `src/components/Toast/Toast.tsx`:

```tsx
import React, { useEffect } from 'react';
import './Toast.scss';

export type ToastVariant = 'success' | 'error';

export interface ToastProps {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
  onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, text, variant, durationMs, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  return (
    <div className={`toast toast-${variant}`} role="status" aria-live="polite">
      {text}
    </div>
  );
};

export default Toast;
```

- [ ] **Step 3: Create the Toast styles**

Write `src/components/Toast/Toast.scss`:

```scss
.toast-stack {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  color: #fff;
  background: #2a2a2a;
  border: 1px solid #444;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  max-width: 80vw;
  animation: toast-in 150ms ease-out;

  &.toast-success {
    border-color: #10a37f;
  }
  &.toast-error {
    border-color: #e74c3c;
    background: #3a1a1a;
  }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 4: Create the ToastProvider + useToast hook**

Write `src/components/Toast/ToastContext.tsx`:

```tsx
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast, { type ToastVariant } from './Toast';

interface ToastEntry {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
}

interface ToastContextValue {
  showToast: (text: string, opts?: { variant?: ToastVariant; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue['showToast']>((text, opts) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, {
      id,
      text,
      variant: opts?.variant ?? 'success',
      durationMs: opts?.durationMs ?? 2000,
    }]);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map(t => (
            <Toast
              key={t.id}
              id={t.id}
              text={t.text}
              variant={t.variant}
              durationMs={t.durationMs}
              onDismiss={dismiss}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Defensive fallback: returns a no-op so call sites don't crash if the
    // provider is missing. Logs once to surface the integration gap.
    if (typeof console !== 'undefined') {
      console.warn('[Toast] useToast() called outside ToastProvider; falling back to no-op.');
    }
    return { showToast: () => {} };
  }
  return ctx;
}
```

- [ ] **Step 5: Create the index re-export**

Write `src/components/Toast/index.ts`:

```ts
export { ToastProvider, useToast } from './ToastContext';
export type { ToastVariant } from './Toast';
```

- [ ] **Step 6: Wire `<ToastProvider/>` into the app root**

Find the root provider mounting point:
Run: `grep -rln "ReactDOM.createRoot\|<App />\|<App/>" src/main.tsx src/index.tsx src/App.tsx 2>/dev/null`

Open the file that wraps the app's other providers (most likely `src/App.tsx`). Find where other React contexts are nested. Add the import and wrap the **outermost** application content with `<ToastProvider>...</ToastProvider>` — toasts should be reachable from anywhere in the tree.

Example pattern (adjust to actual file structure):

```tsx
import { ToastProvider } from './components/Toast';

// inside the existing JSX, wrap so other providers are inside it:
<ToastProvider>
  {/* ...existing providers and routes... */}
</ToastProvider>
```

- [ ] **Step 7: Manual verification — temporary toast smoke test**

Add a one-shot test invocation inside an existing component (e.g. as a `useEffect` in `App.tsx`):

```tsx
import { useToast } from './components/Toast';
// inside component body:
const { showToast } = useToast();
useEffect(() => { showToast('Toast wiring works'); }, [showToast]);
```

Run: `npm run dev` and load the app. Expected: a "Toast wiring works" pill appears at the bottom and disappears after ~2 seconds. After verifying, **REMOVE** the temporary code.

- [ ] **Step 8: Commit**

```bash
git add src/components/Toast/ src/App.tsx
# (or whichever root file you modified in step 6)
git commit -m "feat(toast): minimal ToastProvider with auto-dismiss"
```

---

## Task 9: ExportButton component

**Files:**
- Create: `src/components/MainPanel/ExportButton.tsx`
- Create: `src/components/MainPanel/ExportButton.scss`

- [ ] **Step 1: Create the ExportButton component**

Write `src/components/MainPanel/ExportButton.tsx`:

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ChevronDown, Copy, FileText, FileJson } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingFocusManager,
  FloatingPortal,
} from '@floating-ui/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import {
  buildSessionMetadata,
  copyToClipboard,
  downloadFile,
  formatAsJson,
  formatAsTxt,
  formatTimestampForFilename,
  getActiveModelInfo,
  normalizeMessages,
  type TxtI18n,
} from '../../utils/conversationExport';
import { useToast } from '../Toast';
import './ExportButton.scss';

interface ExportButtonProps {
  /** Already-merged-and-sorted items from MainPanel's combinedItems memo. */
  combinedItems: Array<ConversationItem & { source?: string }>;
  /** Current provider id from useProvider(). */
  provider: string;
  /** Snapshot of the current provider's settings (from getCurrentProviderSettings()). */
  currentProviderSettings: any;
  /** Local-inference settings sub-object (from useLocalInferenceSettings()), used only when provider === LOCAL_INFERENCE. */
  localInferenceSettings: any;
  /** Source language code (read from current provider settings). */
  sourceLanguage: string;
  /** Target language code (read from current provider settings). */
  targetLanguage: string;
}

const ExportButton: React.FC<ExportButtonProps> = ({
  combinedItems,
  provider,
  currentProviderSettings,
  localInferenceSettings,
  sourceLanguage,
  targetLanguage,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = React.useRef<Array<HTMLElement | null>>([]);

  // Snapshot: how many completed messages we have right now. If zero, disable.
  const hasContent = useMemo(
    () => normalizeMessages(combinedItems).length > 0,
    [combinedItems]
  );

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click, dismiss, role, listNav,
  ]);

  // Collect i18n strings once per render.
  const txtI18n: TxtI18n = useMemo(() => ({
    speakerYou: t('mainPanel.export.speakerYou', 'You'),
    speakerOther: t('mainPanel.export.speakerOther', 'Other'),
    headerTitle: t('mainPanel.export.headerTitle', 'Sokuji conversation export'),
    headerGenerated: t('mainPanel.export.headerGenerated', 'Generated'),
    headerProvider: t('mainPanel.export.headerProvider', 'Provider'),
    headerModels: t('mainPanel.export.headerModels', 'Models'),
    headerSource: t('mainPanel.export.headerSource', 'Source'),
    headerTarget: t('mainPanel.export.headerTarget', 'Target'),
    headerNote: t('mainPanel.export.headerNote', 'settings reflect current state at export, not mid-session changes'),
    noTranscript: t('mainPanel.export.noTranscript', '(no transcript)'),
    noTranslation: t('mainPanel.export.noTranslation', '(no translation)'),
  }), [t]);

  /** Compute a fresh export payload at click time. */
  const buildPayload = useCallback(() => {
    const messages = normalizeMessages(combinedItems);
    const models = getActiveModelInfo(provider, currentProviderSettings, localInferenceSettings);
    const metadata = buildSessionMetadata({
      provider,
      models,
      sourceLanguage,
      targetLanguage,
    });
    return { messages, metadata };
  }, [combinedItems, provider, currentProviderSettings, localInferenceSettings, sourceLanguage, targetLanguage]);

  const handleCopy = useCallback(async () => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const text = formatAsTxt(messages, metadata, txtI18n, { includeHeader: false });
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast(t('mainPanel.export.copySuccess', 'Conversation copied to clipboard'), { variant: 'success' });
    } else {
      showToast(t('mainPanel.export.copyFailed', 'Failed to copy. Check browser permissions.'), { variant: 'error', durationMs: 4000 });
    }
  }, [buildPayload, showToast, t, txtI18n]);

  const handleDownloadTxt = useCallback(() => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const content = formatAsTxt(messages, metadata, txtI18n, { includeHeader: true });
    const filename = `sokuji-conversation-${formatTimestampForFilename(Date.now())}.txt`;
    downloadFile(content, filename, 'text/plain;charset=utf-8');
  }, [buildPayload, txtI18n]);

  const handleDownloadJson = useCallback(() => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const content = formatAsJson(messages, metadata);
    const filename = `sokuji-conversation-${formatTimestampForFilename(Date.now())}.json`;
    downloadFile(content, filename, 'application/json');
  }, [buildPayload]);

  const items = useMemo(() => ([
    { key: 'copy', label: t('mainPanel.export.copyToClipboard', 'Copy to clipboard'), Icon: Copy, onClick: handleCopy },
    { key: 'txt',  label: t('mainPanel.export.downloadTxt',     'Download as .txt'),    Icon: FileText, onClick: handleDownloadTxt },
    { key: 'json', label: t('mainPanel.export.downloadJson',    'Download as .json'),   Icon: FileJson, onClick: handleDownloadJson },
  ]), [t, handleCopy, handleDownloadTxt, handleDownloadJson]);

  return (
    <>
      <button
        ref={refs.setReference}
        className="export-btn"
        type="button"
        disabled={!hasContent}
        title={t('mainPanel.toolbar.export', 'Export conversation')}
        aria-label={t('mainPanel.toolbar.export', 'Export conversation')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...getReferenceProps()}
      >
        <Download size={14} />
        <ChevronDown size={12} className="export-btn-chevron" />
      </button>

      {isOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              className="export-menu"
              style={{ ...floatingStyles, zIndex: 9999 }}
              {...getFloatingProps()}
            >
              {items.map((it, idx) => {
                const { Icon } = it;
                return (
                  <button
                    key={it.key}
                    ref={(node) => { listRef.current[idx] = node; }}
                    role="menuitem"
                    type="button"
                    className="export-menu-item"
                    tabIndex={activeIndex === idx ? 0 : -1}
                    {...getItemProps({
                      onClick: it.onClick,
                    })}
                  >
                    <Icon size={14} />
                    <span>{it.label}</span>
                  </button>
                );
              })}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

export default ExportButton;
```

- [ ] **Step 2: Create the SCSS**

Write `src/components/MainPanel/ExportButton.scss`:

```scss
.export-btn {
  // Inherits the existing .conversation-toolbar button look (background,
  // border, color, hover) by sitting inside that container.
  display: inline-flex;
  align-items: center;
  gap: 2px;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.export-btn-chevron {
  margin-top: 1px;
  opacity: 0.7;
}

.export-menu {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: 4px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.export-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: #ddd;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;

  &:hover,
  &:focus {
    background: #3a3a3a;
    color: #fff;
    outline: none;
  }
}
```

- [ ] **Step 3: Verify the file builds**

Run: `npm run build`
Expected: build succeeds. If TS complains about `useListNavigation` not existing, run `npm ls @floating-ui/react` to confirm the package version supports it (it has since v0.18). If missing in this version, replace `useListNavigation` with manual `onKeyDown` arrow handling — but this is not expected because the existing `Tooltip` already imports several `@floating-ui/react` hooks.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/ExportButton.tsx src/components/MainPanel/ExportButton.scss
git commit -m "feat(export): add ExportButton with floating-ui dropdown"
```

---

## Task 10: Wire ExportButton into MainPanel toolbar

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add the import**

Open `src/components/MainPanel/MainPanel.tsx`. Find the existing imports for the MainPanel folder (other components imported from `'./...'`). Add:

```tsx
import ExportButton from './ExportButton';
```

Also confirm these selectors are already in scope (they are, per `MainPanel.tsx:109,131`):
```tsx
const provider = useProvider();
const getCurrentProviderSettings = useGetCurrentProviderSettings();
```

If `useLocalInferenceSettings` is not yet imported in MainPanel, add it:
Run: `grep -n "useLocalInferenceSettings\|localInference" src/components/MainPanel/MainPanel.tsx | head -5`
If absent, add to the existing settingsStore import line (around `MainPanel.tsx:33`):

```tsx
import useSettingsStore, {
  createParticipantLocalInferenceConfig,
  useLocalInferenceSettings,   // ADD THIS
} from '../../stores/settingsStore';
```

Then in the component body, near the other selector usages (~`MainPanel.tsx:131`):

```tsx
const localInferenceSettings = useLocalInferenceSettings();
```

- [ ] **Step 2: Insert the ExportButton in the toolbar**

In `MainPanel.tsx` find the `conversation-toolbar` block (around `MainPanel.tsx:2704`). Locate the Compact toggle button (the one rendering `ChevronsUpDown` / `ChevronsDownUp`, around line 2737–2754) and the Clear button below it (around line 2755–2763).

Insert `<ExportButton/>` **between** the Compact toggle's closing `</button>` and the `<button className="clear-conversation-btn">` opening:

```tsx
            </button>
            {/* NEW: Export */}
            <ExportButton
              combinedItems={combinedItems}
              provider={provider}
              currentProviderSettings={getCurrentProviderSettings()}
              localInferenceSettings={localInferenceSettings}
              sourceLanguage={(getCurrentProviderSettings() as any)?.sourceLanguage ?? ''}
              targetLanguage={(getCurrentProviderSettings() as any)?.targetLanguage ?? ''}
            />
            <button
              className="clear-conversation-btn"
```

- [ ] **Step 3: Run TS check / dev server**

Run: `npm run dev`
Expected: server starts, no TS errors. Open the app in a browser.

- [ ] **Step 4: Manual verification — the button appears and is wired**

In the running app, with a conversation that has at least one completed message:

1. Confirm a Download icon (with a small chevron) appears in the toolbar between the Compact toggle and the Clear (trash) button.
2. Hover over it — tooltip "Export conversation" should show.
3. Click it — a dropdown menu should appear below, anchored to the button's right edge, containing three items: "Copy to clipboard", "Download as .txt", "Download as .json".
4. Press `Esc` — menu should close, focus should return to the button.
5. Re-open with a click; click outside — menu should close.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(mainpanel): wire ExportButton into conversation toolbar"
```

---

## Task 11: End-to-end manual smoke test

**Files:** none (test-only)

This task has no code; it is the formal acceptance check.

- [ ] **Step 1: Start the app and run a real translation session**

Run: `npm run dev` (or `npm run electron:dev` if testing the desktop binary).
Speak (or paste text) at least four turns so you have a mix of speaker and assistant messages. If possible, also enable system audio capture so participant items appear.

- [ ] **Step 2: Verify Copy to clipboard**

Open the Export dropdown → "Copy to clipboard". Expected:
- A green-bordered toast says "Conversation copied to clipboard" and disappears after ~2s.
- Paste into a text editor — content should match the message lines (no header), each line `[HH:MM:SS] You:    <original>  →  <translation>` (or `Other:` for system audio).
- Speaker column should be visually aligned.

- [ ] **Step 3: Verify Download as .txt**

Open the dropdown → "Download as .txt". Expected:
- Browser/Electron native download UI shows a file like `sokuji-conversation-20260423-143000.txt`.
- Open the file. The first 5 or 6 lines are the header (title, generated, provider, [models], source/target, note), then a blank line, then messages identical to the clipboard payload.
- For local-inference provider, the `Models:` line shows `asr=...`, `translation=...`, `tts=...`.
- For OpenAI provider, the `Models:` line shows `translation=...`, `transcription=...`.
- For Palabra/Volcengine provider, the `Models:` line is omitted.

- [ ] **Step 4: Verify Download as .json**

Open the dropdown → "Download as .json". Expected:
- File `sokuji-conversation-20260423-143000.json` downloads.
- Open and pretty-print is preserved (2-space indent).
- Top-level keys: `exportedAt`, `appVersion`, `session`, `messageCount`, `messages`.
- `session.models` is the right shape per provider (no empty-string values).
- Each `messages[i]` has `id`, `timestamp` (ISO 8601 UTC), `speaker` (`"you"` or `"other"`), `originalText`, `translatedText`. Missing fields are `null`, not `""`.
- `messageCount === messages.length`.

- [ ] **Step 5: Verify disabled state**

Click "Clear conversation" (trash icon) to empty the conversation. Expected:
- The whole toolbar disappears (matches existing `combinedItems.length > 0` rendering condition).
- Re-start a session; while only `in_progress` messages exist, the Export button should appear disabled (faded). Once at least one message completes, it should become enabled.

- [ ] **Step 6: Verify both platforms**

Run the Extension build (`npm run dev` then load the extension in Chrome → open side panel) AND Electron (`npm run electron:dev`). Repeat steps 2–4 in each environment. Expected:
- Same UI behavior in both.
- Downloads land in the user's default Downloads folder in both.
- Browser download bar / Electron download UI provides feedback.

If anything in steps 1–6 fails, file the deviation, fix the relevant earlier task, and re-run from Step 1.

- [ ] **Step 7: No commit**

This is a verification task; nothing to commit.

---

## Summary of Commits

After all tasks, the branch should contain (in order):

1. `feat(i18n): add conversation export keys (en)`
2. `feat(export): scaffold conversationExport types and helpers`
3. `feat(export): add normalizeMessages and getActiveModelInfo`
4. `feat(export): add buildSessionMetadata`
5. `feat(export): add formatAsTxt`
6. `feat(export): add formatAsJson`
7. `feat(export): add copyToClipboard and downloadFile`
8. `feat(toast): minimal ToastProvider with auto-dismiss`
9. `feat(export): add ExportButton with floating-ui dropdown`
10. `feat(mainpanel): wire ExportButton into conversation toolbar`

(11 tasks → 10 commits — the smoke test task does not commit.)
