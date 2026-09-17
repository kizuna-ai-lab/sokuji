# Sentence Segmentation — Slice 2: Settings, Store and Section UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user the switch, the sentences-per-bubble control and the three model rows, backed by a status store and the one place in the app that constructs a `PunctuationRuntime`.

**Architecture:** Three new `CommonSettings` fields follow the `keepReplayAudio` shape exactly (interface, defaults, action with inline rollback, hydration, two hooks). A small `segmentationStore` mirrors per-model status for the UI to read. `useSegmentationRuntime` is the single app-layer owner: it builds the runtime, forwards its events into the store and into `reportWarning`, and hands the runtime to MainPanel. The section itself is a normal `config-section` sitting right after `LanguageSection` in both modes.

**Tech Stack:** React + TypeScript, Zustand, i18next (30 catalogs), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, "Settings UI" and "Diagnostics and analytics".

**Depends on:** slice 1 (`docs/superpowers/plans/2026-09-16-sentence-segmentation-1-foundation-and-runtime.md`). `PunctuationRuntime`, `SegmentationRuntime` and the three manifest entries must exist.

**Typecheck:** the repo's baseline is **not clean** — `npx tsc --noEmit` reports 319 errors across 154 files as of `6dd46986`, all pre-existing. Never ask anyone to "confirm tsc is clean"; the bar is **zero contribution**: run it and confirm its output names none of the files your task created or modified. Tests: `npm run test -- <path>`.

---

## Global Constraints

- **English only** in code, comments and commits. Locale catalogs get real translations, never English placeholders.
- **`persistSetting` returns a boolean; the rollback is written inline in the action.** Copy `setKeepReplayAudio` (`settingsStore.ts:734-740`), not the older actions above it that call `service.setSetting` with no rollback.
- **Storage keys** are `settings.common.<fieldName>`.
- **Stores and components must not add `console.error` / `console.warn`** — `consoleLedger.consistency.test.ts` holds an exact count per file and unlisted files must be 0. `src/stores/settingsStore.ts` is not in the ledger at all.
- **`locales.consistency.test.ts` enforces exact key parity in both directions**, no empty strings, and identical placeholders. One new `en` key means 30 file edits.
- **`SimpleSettings.order.test.tsx` requires `HelpSection` to remain the last `.config-section`.** Insert before it.
- **N is clamped to 1–5 on read**, and a stream reads it once at construction, so a change never cuts an open bubble.

---

## File Structure

| Path | Change |
|---|---|
| `src/stores/settingsStore.ts` | modify — 3 fields, 3 defaults, 3 action types, 3 actions, 2 hydration spots, 6 hooks |
| `src/stores/settingsStore.test.ts` | modify — default / persist / rollback per field, plus the 1–5 clamp |
| `src/stores/segmentationStore.ts` | **new** — per-model status, progress and error; UI reads only |
| `src/stores/segmentationStore.test.ts` | **new** |
| `src/hooks/useSegmentationRuntime.ts` | **new** — the app-layer owner: builds the runtime, forwards its events |
| `src/hooks/useSegmentationRuntime.test.ts` | **new** |
| `src/components/Settings/sections/SentenceSegmentationSection.tsx` | **new** |
| `src/components/Settings/sections/SentenceSegmentationSection.test.tsx` | **new** |
| `src/components/Settings/sections/SentenceSegmentationSection.scss` | **new** — the equal-width 1–5 control |
| `src/components/Settings/sections/index.ts` | modify — export the new section |
| `src/components/Settings/SimpleSettings/SimpleSettings.tsx:214` | modify — mount after `LanguageSection` |
| `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx:118` | modify — mount after `LanguageSection` on the General tab |
| `src/components/Settings/Settings.tsx:35` | modify — `sentence-segmentation` → `general` |
| `src/locales/*/translation.json` | modify — 30 catalogs |

---

## Task 1: Three settings on `CommonSettings`

`CommonSettings` has no numeric member today, so `sentenceSegmentationChunkSentences` is the first. That is why the clamp lives in the store rather than in the UI: a value written by an older build, a corrupt store or a hand-edited settings file must never reach a `SentenceStream`.

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/settingsStore.test.ts`

**Interfaces:**
- Consumes: `persistSetting` from `../services/persistSetting`.
- Produces: `sentenceSegmentation: boolean`, `sentenceSegmentationChunkSentences: number`, `sentenceSegmentationNoticeShown: boolean`; actions `setSentenceSegmentation`, `setSentenceSegmentationChunkSentences`, `markSentenceSegmentationNoticeShown`; hooks `useSentenceSegmentation`, `useSetSentenceSegmentation`, `useSentenceSegmentationChunkSentences`, `useSetSentenceSegmentationChunkSentences`, `useSentenceSegmentationNoticeShown`, `useMarkSentenceSegmentationNoticeShown`; and `clampChunkSentences(value: unknown): number`.

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/settingsStore.test.ts`, following the `describe('keepReplayAudio')` block at line 334:

```typescript
import { clampChunkSentences } from './settingsStore';

describe('clampChunkSentences', () => {
  it.each([
    [1, 1], [3, 3], [5, 5],
    [0, 1], [-4, 1], [6, 5], [99, 5],
    [2.4, 2], [2.6, 3],
    ['3', 3], [null, 3], [undefined, 3], [NaN, 3], ['abc', 3],
  ])('clamps %s to %i', (input, expected) => {
    expect(clampChunkSentences(input)).toBe(expected);
  });
});

describe('sentenceSegmentation', () => {
  it('defaults to on', async () => {
    useSettingsStore.setState({ sentenceSegmentation: false });
    mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().sentenceSegmentation).toBe(true);
  });

  it('persists a change', async () => {
    mockSetSetting.mockResolvedValueOnce(undefined);
    await useSettingsStore.getState().setSentenceSegmentation(false);
    expect(useSettingsStore.getState().sentenceSegmentation).toBe(false);
    expect(mockSetSetting).toHaveBeenCalledWith('settings.common.sentenceSegmentation', false);
  });

  it('rolls back when persistence fails', async () => {
    useSettingsStore.setState({ sentenceSegmentation: true });
    mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
    await useSettingsStore.getState().setSentenceSegmentation(false);
    expect(useSettingsStore.getState().sentenceSegmentation).toBe(true);
  });
});

describe('sentenceSegmentationChunkSentences', () => {
  it('defaults to 3', async () => {
    useSettingsStore.setState({ sentenceSegmentationChunkSentences: 5 });
    mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(3);
  });

  it('clamps a stored value that is out of range', async () => {
    mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
      key === 'settings.common.sentenceSegmentationChunkSentences' ? 42 : fallback);
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(5);
  });

  it('persists a change and clamps before writing', async () => {
    mockSetSetting.mockResolvedValueOnce(undefined);
    await useSettingsStore.getState().setSentenceSegmentationChunkSentences(9);
    expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(5);
    expect(mockSetSetting).toHaveBeenCalledWith('settings.common.sentenceSegmentationChunkSentences', 5);
  });

  it('rolls back when persistence fails', async () => {
    useSettingsStore.setState({ sentenceSegmentationChunkSentences: 3 });
    mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
    await useSettingsStore.getState().setSentenceSegmentationChunkSentences(1);
    expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(3);
  });
});

describe('sentenceSegmentationNoticeShown', () => {
  it('defaults to false and is written once, fire and forget', async () => {
    useSettingsStore.setState({ sentenceSegmentationNoticeShown: false });
    mockSetSetting.mockResolvedValue(undefined);
    useSettingsStore.getState().markSentenceSegmentationNoticeShown();
    expect(useSettingsStore.getState().sentenceSegmentationNoticeShown).toBe(true);
    useSettingsStore.getState().markSentenceSegmentationNoticeShown();
    expect(mockSetSetting).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/stores/settingsStore.test.ts`
Expected: FAIL — the fields and actions do not exist.

- [ ] **Step 3: Add the fields, defaults and clamp**

`settingsStore.ts`, in `CommonSettings` (after `diagnosticLogs`, line 117):

```typescript
  /** The sentence segmentation stage. On by default; see the design's D12. */
  sentenceSegmentation: boolean;
  /** How many sentences fill one bubble. 1-5, clamped on read. */
  sentenceSegmentationChunkSentences: number;
  /** The first background model download has already been announced once. */
  sentenceSegmentationNoticeShown: boolean;
```

Above `defaultCommonSettings`:

```typescript
/**
 * The only place 1-5 is enforced.
 *
 * This is CommonSettings' first numeric field, and it reaches a SentenceStream
 * that multiplies it into three thresholds. A value from an older build, a
 * corrupted store or a hand-edited settings file must never get that far, so
 * the clamp sits on the read and on the write rather than in the picker.
 */
export function clampChunkSentences(value: unknown): number {
  // `null` means the setting is absent, so it takes the default like
  // `undefined` does. Without this line it would fall through to
  // `Number(null) === 0` and clamp up to 1, silently halving the smallest
  // bubble for anyone whose stored value went missing.
  if (value === null || value === undefined) return 3;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}
```

In `defaultCommonSettings` (after `diagnosticLogs: false`, line 143):

```typescript
  sentenceSegmentation: true,
  sentenceSegmentationChunkSentences: 3,
  sentenceSegmentationNoticeShown: false,
```

- [ ] **Step 4: Add the action types and the actions**

In `interface SettingsStore`, next to `setDiagnosticLogs` (line 297):

```typescript
  setSentenceSegmentation: (enabled: boolean) => Promise<void>;
  setSentenceSegmentationChunkSentences: (n: number) => Promise<void>;
  markSentenceSegmentationNoticeShown: () => void;
```

In the store body, after `setDiagnosticLogs` (line 752):

```typescript
    setSentenceSegmentation: async (sentenceSegmentation) => {
      const previous = get().sentenceSegmentation;
      set({sentenceSegmentation});
      if (!await persistSetting('settings.common.sentenceSegmentation', sentenceSegmentation)) {
        set({sentenceSegmentation: previous});
      }
    },

    setSentenceSegmentationChunkSentences: async (n) => {
      const previous = get().sentenceSegmentationChunkSentences;
      const clamped = clampChunkSentences(n);
      set({sentenceSegmentationChunkSentences: clamped});
      if (!await persistSetting('settings.common.sentenceSegmentationChunkSentences', clamped)) {
        set({sentenceSegmentationChunkSentences: previous});
      }
    },

    // A seen-marker, not a preference: fire and forget with no rollback, the
    // same shape as audioStore's markParticipantTapAudioSeen. Showing the
    // notice twice after a failed write is a smaller harm than a dialog that
    // blocks on storage.
    markSentenceSegmentationNoticeShown: () => {
      if (get().sentenceSegmentationNoticeShown) return;
      set({sentenceSegmentationNoticeShown: true});
      void persistSetting('settings.common.sentenceSegmentationNoticeShown', true);
    },
```

- [ ] **Step 5: Hydrate in `loadSettings`**

Two edits. Read, next to `keepReplayAudio` (line 1172):

```typescript
        const sentenceSegmentation = await service.getSetting('settings.common.sentenceSegmentation', defaultCommonSettings.sentenceSegmentation);
        const sentenceSegmentationChunkSentences = clampChunkSentences(
          await service.getSetting('settings.common.sentenceSegmentationChunkSentences', defaultCommonSettings.sentenceSegmentationChunkSentences),
        );
        const sentenceSegmentationNoticeShown = await service.getSetting('settings.common.sentenceSegmentationNoticeShown', defaultCommonSettings.sentenceSegmentationNoticeShown);
```

Apply, in the `set({...})` payload (line 1231, after `diagnosticLogs,`):

```typescript
          sentenceSegmentation,
          sentenceSegmentationChunkSentences,
          sentenceSegmentationNoticeShown,
```

- [ ] **Step 6: Export the hooks**

After `useSetDiagnosticLogs` (line 1449):

```typescript
export const useSentenceSegmentation = () => useSettingsStore((state) => state.sentenceSegmentation);
export const useSetSentenceSegmentation = () => useSettingsStore((state) => state.setSentenceSegmentation);
export const useSentenceSegmentationChunkSentences = () => useSettingsStore((state) => state.sentenceSegmentationChunkSentences);
export const useSetSentenceSegmentationChunkSentences = () => useSettingsStore((state) => state.setSentenceSegmentationChunkSentences);
export const useSentenceSegmentationNoticeShown = () => useSettingsStore((state) => state.sentenceSegmentationNoticeShown);
export const useMarkSentenceSegmentationNoticeShown = () => useSettingsStore((state) => state.markSentenceSegmentationNoticeShown);
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npm run test -- src/stores/settingsStore.test.ts`
Expected: PASS.

Then run `npx tsc --noEmit` on its own — **not** chained with `&&`, because it
exits non-zero on the 319-error baseline and would mask the test result.
Expected: it still reports 319 errors and names none of the files you touched.

- [ ] **Step 8: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(segmentation): add the three sentence-segmentation settings"
```

---

## Task 2: `segmentationStore`

A read-only mirror of the runtime's per-model state, so the section can render without importing the runtime.

**Files:**
- Create: `src/stores/segmentationStore.ts`
- Create: `src/stores/segmentationStore.test.ts`

**Interfaces:**
- Consumes: `PunctuationModelId`, and `PunctuationStatus` from `src/lib/segmentation/PunctuationRuntime`.
- Produces: `useSegmentationStore`, `useSegmentationModelState(model)`, and the actions `setModelStatus`, `setModelProgress`, `resetSession`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useSegmentationStore } from './segmentationStore';

beforeEach(() => { useSegmentationStore.getState().resetSession(); });

describe('segmentationStore', () => {
  it('starts every model as not-downloaded with no progress and no error', () => {
    const state = useSegmentationStore.getState();
    for (const model of ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'] as const) {
      expect(state.models[model]).toEqual({ status: 'not-downloaded', percent: 0, error: null });
    }
  });

  it('records a status and clears the error when it recovers', () => {
    const { setModelStatus } = useSegmentationStore.getState();
    setModelStatus('fireredpunc', 'error', 'network unreachable');
    expect(useSegmentationStore.getState().models.fireredpunc.error).toBe('network unreachable');
    setModelStatus('fireredpunc', 'ready');
    expect(useSegmentationStore.getState().models.fireredpunc).toEqual({ status: 'ready', percent: 100, error: null });
  });

  it('tracks download progress', () => {
    useSegmentationStore.getState().setModelProgress('sat-3l-sm', 42);
    expect(useSegmentationStore.getState().models['sat-3l-sm'].percent).toBe(42);
  });

  it('keeps a downloaded model downloaded across a session reset', () => {
    useSegmentationStore.getState().setModelStatus('edge-punct-en', 'ready');
    useSegmentationStore.getState().resetSession();
    // 'ready' is a session fact; 'downloaded' is not.
    expect(useSegmentationStore.getState().models['edge-punct-en'].status).toBe('downloaded');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test -- src/stores/segmentationStore.test.ts` → FAIL (module not found).

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
import type { PunctuationStatus } from '../lib/segmentation/PunctuationRuntime';

export interface SegmentationModelState {
  status: PunctuationStatus;
  percent: number;
  error: string | null;
}

const MODELS: PunctuationModelId[] = ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'];

const blank = (): Record<PunctuationModelId, SegmentationModelState> =>
  Object.fromEntries(
    MODELS.map((m) => [m, { status: 'not-downloaded', percent: 0, error: null }]),
  ) as Record<PunctuationModelId, SegmentationModelState>;

interface SegmentationStore {
  models: Record<PunctuationModelId, SegmentationModelState>;
  setModelStatus(model: PunctuationModelId, status: PunctuationStatus, error?: string): void;
  setModelProgress(model: PunctuationModelId, percent: number): void;
  /** Drop what was only true for the session that just ended. */
  resetSession(): void;
}

/**
 * What the Sentence segmentation section renders.
 *
 * The runtime owns the truth and pushes into here; nothing reads back out of
 * the store into the runtime. That is what keeps PunctuationRuntime free of a
 * store import, so it stays unit-testable with a fake worker.
 */
export const useSegmentationStore = create<SegmentationStore>()(
  subscribeWithSelector((set) => ({
    models: blank(),

    setModelStatus: (model, status, error) =>
      set((state) => ({
        models: {
          ...state.models,
          [model]: {
            status,
            percent: status === 'ready' || status === 'downloaded' ? 100 : state.models[model].percent,
            error: status === 'error' ? (error ?? 'unknown error') : null,
          },
        },
      })),

    setModelProgress: (model, percent) =>
      set((state) => ({
        models: { ...state.models, [model]: { ...state.models[model], percent } },
      })),

    resetSession: () =>
      set((state) => ({
        models: Object.fromEntries(
          MODELS.map((m) => {
            const prev = state.models[m];
            // Downloaded bytes survive a session; a loaded model and a
            // session-scoped disable do not.
            const keepsDownload = prev.status === 'ready' || prev.status === 'loading'
              || prev.status === 'downloaded' || prev.status === 'disabled';
            return [m, keepsDownload
              ? { status: 'downloaded' as PunctuationStatus, percent: 100, error: null }
              : { status: 'not-downloaded' as PunctuationStatus, percent: 0, error: null }];
          }),
        ) as Record<PunctuationModelId, SegmentationModelState>,
      })),
  })),
);

export const useSegmentationModelState = (model: PunctuationModelId) =>
  useSegmentationStore((state) => state.models[model]);
```

- [ ] **Step 3: Run the tests and the typecheck, then commit**

Run: `npm run test -- src/stores/segmentationStore.test.ts`, then `npx tsc --noEmit`
separately — chaining with `&&` hides the test result, because `tsc` exits
non-zero on the 319-error baseline. Expected: tests pass, and `tsc` still reports
319 errors naming none of your files.

```bash
git add src/stores/segmentationStore.ts src/stores/segmentationStore.test.ts
git commit -m "feat(segmentation): add the segmentation status store"
```

---

## Task 3: `useSegmentationRuntime` — the one place the runtime is built

`PunctuationRuntime` imports no store and no `report.ts`. This hook is where those two wires are attached, and the only place in the app that constructs a runtime.

**Files:**
- Create: `src/hooks/useSegmentationRuntime.ts`
- Create: `src/hooks/useSegmentationRuntime.test.ts`

**Interfaces:**
- Consumes: `PunctuationRuntime`, `useSentenceSegmentation`, `useSegmentationStore`, `reportWarning`.
- Produces: `useSegmentationRuntime(): SegmentationRuntime`.

- [ ] **Step 1: Write the failing test**

Cases, each a real `it(...)`:
- the runtime is created once and survives re-renders (`useRef`, not `useMemo` with changing deps);
- `enabled` follows the setting without rebuilding the runtime;
- a status event reaches `segmentationStore`;
- a download progress event reaches the store;
- a failure reports **once** through `reportWarning('Segmentation', …, { dedupeKey })` and a second identical failure does not report again;
- no transcript text appears in any reported message.

- [ ] **Step 2: Implement**

```typescript
import { useEffect, useRef } from 'react';
import { PunctuationRuntime } from '../lib/segmentation/PunctuationRuntime';
import type { SegmentationRuntime } from '../lib/segmentation/SegmentationRuntime';
import { useSentenceSegmentation } from '../stores/settingsStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { reportWarning } from '../lib/diagnostics/report';

/**
 * Builds the app's single PunctuationRuntime and attaches the two wires the
 * runtime deliberately does not have: the status store and diagnostics.
 *
 * The runtime is created once for the app's lifetime. It reads the enabled
 * flag through a getter rather than a prop, so flipping the switch takes
 * effect on the next call without tearing down a loaded model.
 */
export function useSegmentationRuntime(): SegmentationRuntime {
  const enabled = useSentenceSegmentation();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const runtimeRef = useRef<PunctuationRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = new PunctuationRuntime({
      isEnabled: () => enabledRef.current,
      onStatus: (model, status, detail) => {
        useSegmentationStore.getState().setModelStatus(model, status, detail);
        if (status === 'error') {
          // One line per model per failure class: a settings backend or a
          // network that is down fails for every model at once, and one
          // entry per attempt would bury the session's real events. No
          // transcript text is in scope here — only the model id.
          reportWarning('Segmentation', `${model} is unavailable: ${detail ?? 'unknown error'}`, {
            dedupeKey: `segmentation:${model}`,
          });
        }
      },
      onDownloadProgress: (model, percent) => {
        useSegmentationStore.getState().setModelProgress(model, percent);
      },
    });
  }

  useEffect(() => () => { runtimeRef.current?.dispose(); }, []);

  return runtimeRef.current;
}
```

- [ ] **Step 3: Run the tests, the typecheck and the console ledger**

Run: `npm run test -- src/hooks/useSegmentationRuntime.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`, then `npx tsc --noEmit` on its own — chaining with `&&` hides the test result, because `tsc` exits non-zero on the 319-error baseline.
Expected: tests PASS, and `tsc` still reports 319 errors naming none of your files. `src/hooks/` is not under the ledger's scanned roots (`src/stores`, `src/services`, `src/contexts`, `src/components`, `src/lib`, `shared`), but keep it console-free anyway.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSegmentationRuntime.ts src/hooks/useSegmentationRuntime.test.ts
git commit -m "feat(segmentation): build the runtime once and forward its events"
```

---

## Task 4: `SentenceSegmentationSection`

**Files:**
- Create: `src/components/Settings/sections/SentenceSegmentationSection.tsx`
- Create: `src/components/Settings/sections/SentenceSegmentationSection.scss`
- Create: `src/components/Settings/sections/SentenceSegmentationSection.test.tsx`

**Interfaces:**
- Consumes: the six settings hooks, `useSegmentationModelState`, `ToggleSwitch`, `Tooltip`, `ModelManager`, `getManifestEntry`, `getModelSizeMb`.
- Produces: `SentenceSegmentationSection` (default export), props `{ isSessionActive: boolean; className?: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// Cases, each a real it(...):
//  - renders the section with id="sentence-segmentation-section";
//  - the toggle reflects the setting and calls the setter on click;
//  - the five buttons render, the active one carries `active`, and clicking
//    another calls the setter with that number;
//  - re-clicking the active button calls nothing;
//  - toggling off disables the segmented control and the model rows;
//  - a model row shows its size in MB from the manifest;
//  - the row for the current source language is marked "used by current
//    languages", and so is the row for the current target language;
//  - during a session, Delete on a model in use is disabled;
//  - on a low-memory device every row is greyed out with the reason;
//  - a model in `error` shows Retry.
```

- [ ] **Step 2: Implement the component**

Copy the section shell from `LanguageSection.tsx:601-610`: a `div.config-section` with an `id`, an `h3` carrying a lucide icon, the title and a help `Tooltip`.

For the switch use the shared `ToggleSwitch` (`src/components/Settings/shared/ToggleSwitch.tsx`), **not** the `help-link--toggle` mini switch. The mini switch exists only for the Help links row; the nearest instance of the same control in a section body is `LanguageSection.tsx:762-768`, which is likewise a boolean common setting with `disabled={isSessionActive}` and a tooltip:

```tsx
      <ToggleSwitch
        checked={sentenceSegmentation}
        onChange={() => { void setSentenceSegmentation(!sentenceSegmentation); }}
        label={t('settings.sentenceSegmentation', 'Subtitle segmentation')}
        disabled={isSessionActive}
        tooltip={t('settings.sentenceSegmentationDesc', 'When a transcript arrives without punctuation, add it and start a new bubble every few sentences. A small model is downloaded only when it is first needed.')}
      />
```

For the 1–5 control, copy the equal-width segmented control. The JSX shape is `AudioDeviceSection.tsx:206-240` — a literal array mapped to buttons with `onClick` guarded against re-picking the active value, as in `NativeDeviceControl.tsx:70-78`:

```tsx
      <div className="sentence-segmentation__chunk">
        <div className="sentence-segmentation__chunk-header">
          <span className="sentence-segmentation__chunk-label">
            {t('settings.sentenceSegmentationChunk', 'Sentences per bubble')}
          </span>
          <Tooltip
            content={t('settings.sentenceSegmentationChunkTooltip', 'How much speech goes into one bubble before a new one starts. On local engines this is also the translation unit, so 1 translates sentence by sentence and 5 stays close to whole-utterance translation.')}
            position="top"
            icon="help"
            maxWidth={350}
          />
        </div>
        <div className="segmented-control sentence-segmentation__chunk-options">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`segmented-option ${chunkSentences === n ? 'active' : ''}`}
              disabled={isSessionActive || !sentenceSegmentation}
              onClick={() => { if (chunkSentences !== n) void setChunkSentences(n); }}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="sentence-segmentation__chunk-effect">
          {t('settings.sentenceSegmentationChunkEffect', 'Long speech starts a new bubble every {{count}} sentences.', { count: chunkSentences })}
        </p>
      </div>
```

Model rows: one per model, each showing the manifest `name`, `getModelSizeMb(entry)` MB, the store's status, and the actions Download / Delete / Retry. Mark the rows the current languages need — compute from both legs, using `modelForLanguage(sourceLanguage)` and `modelForLanguage(targetLanguage)` from `PunctuationRuntime`, so the mark covers speaker and participant together. Disable Delete while `isSessionActive` and the model is in use. When `deviceMemory <= 4`, grey every row and render the reason.

- [ ] **Step 3: Write the SCSS**

Base the equal-width control on `Settings.scss:2288-2335` (the noise-suppression block) — `display: flex` with `flex: 1` per option, so the five numbers share the row evenly. Use `vars.$` tokens as `NativeDeviceControl.scss` does, not raw hex.

- [ ] **Step 4: Settle the visuals by rendering**

Do not ship this on the strength of reading the markup. Render the section and look at it, then check every locale for width: the effect line and the model-row labels are the two places a long translation wraps. German and Japanese are the usual first failures.

- [ ] **Step 5: Run the tests and the typecheck, then commit**

```bash
git add src/components/Settings/sections/SentenceSegmentationSection.tsx src/components/Settings/sections/SentenceSegmentationSection.scss src/components/Settings/sections/SentenceSegmentationSection.test.tsx
git commit -m "feat(segmentation): add the Sentence segmentation settings section"
```

---

## Task 5: Mount the section and register the deep link

**Files:**
- Modify: `src/components/Settings/sections/index.ts`
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx`
- Modify: `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx`
- Modify: `src/components/Settings/Settings.tsx`

- [ ] **Step 1: Export it from the sections barrel**

Add to `src/components/Settings/sections/index.ts`, after `LanguageSection`:

```typescript
export { default as SentenceSegmentationSection } from './SentenceSegmentationSection';
```

`src/components/Settings/index.ts` re-exports with `export * from './sections';`, so nothing else needs editing.

- [ ] **Step 2: Mount in Simple mode**

`SimpleSettings.tsx`: add to the import at line 14, then insert between the closing `/>` of `LanguageSection` (line 214) and the `{/* Provider and API Key */}` comment (line 216):

```tsx
        {/* Subtitle segmentation */}
        <SentenceSegmentationSection isSessionActive={isSessionActive} />
```

Note the second, earlier `return` at lines 153–198: that branch replaces the whole section list with `EngineSurface`, so the new section is correctly absent there — the user leaves the engine surface first. No edit needed.

- [ ] **Step 3: Mount in Advanced mode**

`AdvancedSettings.tsx`: add to the import at line 18, then insert on the General tab between line 118 and line 120:

```tsx
            {/* Subtitle segmentation */}
            <SentenceSegmentationSection isSessionActive={isSessionActive} />
```

- [ ] **Step 4: Register the deep link**

`Settings.tsx`, in `NAVIGATION_TAB_MAP` (line 35), after `'languages': 'general',`:

```typescript
  'sentence-segmentation': 'general',
```

The key must equal the DOM id minus `-section`, because both `Settings.tsx:104` and `SimpleSettings.tsx:106` build `` `${target}-section` `` and call `getElementById`. The section's root therefore has `id="sentence-segmentation-section"`.

- [ ] **Step 5: Run the placement tests**

Run: `npm run test -- src/components/Settings/SimpleSettings/SimpleSettings.order.test.tsx src/components/Settings/sections/HelpSection.test.tsx`, then `npx tsc --noEmit` on its own — chaining with `&&` hides the test result, because `tsc` exits non-zero on the 319-error baseline.
Expected: tests PASS, and `tsc` still reports 319 errors naming none of your files. `SimpleSettings.order.test.tsx` asserts `expect(help).toBe(ids.length - 1)`, so `HelpSection` must stay last — inserting after `LanguageSection` keeps that true. If either suite throws on a missing hook, add the new hooks to its `vi.mock` block (`HelpSection.test.tsx:18-22` mocks the settings store wholesale).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/index.ts src/components/Settings/SimpleSettings/SimpleSettings.tsx src/components/Settings/AdvancedSettings/AdvancedSettings.tsx src/components/Settings/Settings.tsx
git commit -m "feat(segmentation): mount the section in both modes and add its deep link"
```

---

## Task 6: Locale keys across all 30 catalogs

`locales.consistency.test.ts` asserts `Object.keys(cat).sort()` equals `Object.keys(EN).sort()` for each of the 29 non-English catalogs — missing **and** stale both fail — plus no empty strings and identical placeholders. So every key lands in all 30 files in one commit.

**Files:** `src/locales/{ar,bn,de,en,es,fa,fi,fil,fr,he,hi,id,it,ja,ko,ms,nl,pl,pt_BR,pt_PT,ru,sv,ta,te,th,tr,uk,vi,zh_CN,zh_TW}/translation.json`

- [ ] **Step 1: Add the English keys**

Under the existing flat `settings` object (the convention is flat `settings.<camelCase>`; a nested object only where a key is built from a value):

```json
"sentenceSegmentation": "Subtitle segmentation",
"sentenceSegmentationDesc": "When a transcript arrives without punctuation, add it and start a new bubble every few sentences. A small model is downloaded only when it is first needed.",
"sentenceSegmentationChunk": "Sentences per bubble",
"sentenceSegmentationChunkTooltip": "How much speech goes into one bubble before a new one starts. On local engines this is also the translation unit, so 1 translates sentence by sentence and 5 stays close to whole-utterance translation.",
"sentenceSegmentationChunkEffect": "Long speech starts a new bubble every {{count}} sentences.",
"sentenceSegmentationModels": "Models",
"sentenceSegmentationModelZh": "Chinese",
"sentenceSegmentationModelEn": "English",
"sentenceSegmentationModelOther": "Other languages",
"sentenceSegmentationInUse": "Used by your current languages",
"sentenceSegmentationLowMemory": "This device does not have enough memory to load a segmentation model.",
"sentenceSegmentationStatusNotDownloaded": "Not downloaded",
"sentenceSegmentationStatusDownloading": "Downloading",
"sentenceSegmentationStatusDownloaded": "Downloaded",
"sentenceSegmentationStatusLoading": "Loading",
"sentenceSegmentationStatusReady": "Ready",
"sentenceSegmentationStatusError": "Error",
"sentenceSegmentationStatusDisabled": "Unavailable this session"
```

- [ ] **Step 2: Translate into the other 29 catalogs**

Real translations, not English copies. `{{count}}` must appear verbatim in every one — the placeholder check compares the sorted placeholder list per key.

- [ ] **Step 3: Run the consistency test**

Run: `npm run test -- src/locales/locales.consistency.test.ts`
Expected: PASS on all three assertions for all 29 locales.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "i18n(segmentation): add the Sentence segmentation section strings"
```

---

## Done when

- The section renders in both modes after the language picker, and the deep link reaches it.
- The switch and the 1–5 control persist, roll back on a failed write, and lock during a session.
- The three model rows show size, status and the right actions, and mark the ones the current language pair needs.
- `npm run test` is green — including the locale and section-order consistency
  tests — apart from the three `hfRevision` assertions in
  `modelManifest.punctuation.test.ts`, which fail by design until the three
  Hugging Face repositories are published, an outward action needing jiangzhuo's
  explicit per-repository confirmation.
- `npx tsc --noEmit` adds no errors to the pre-existing baseline of 319 across
  154 files. The bar is zero contribution, not a clean run.
- Nothing is segmented yet: no client has a runtime. Slice 3 wires the local ones.
