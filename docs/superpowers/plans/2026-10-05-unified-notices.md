# Unified Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every notice in the main panel is drawn by the renderer its kind decides — an event as a quiet system row in the conversation, a current state as one status line above the footer, an app condition as a banner — and the toast is gone, each of its six uses moved to where it belongs.

**Architecture:**
- The runner, L1 and the stores keep recording what they record today. The view gains one selector per kind and one component per kind: `SystemRow` (replaces `NoticeBubble`), `statusLine()` + `StatusLine` (replaces the Start tooltip, the "last end" bubble, the reconnecting label and `EchoNotice`), `useBanners()` + `Banner` (replaces `UpdateBanner` and `AudioSystemBanner`).
- Results of a user action are not a kind. A result about the conversation (copied, auto-saved) is a **panel note**: a small store the panel merges into the list after the conversation's entries, never into L1, so exports and subtitle bands need no filtering. A result about a control is shown on that control (the Help link's label, the sign-in card's message slot) or not at all (e-mail verified).
- One table of actions (`noticeActions.ts`) resolves a code to Settings / Top up / Sign in / Open System Settings / Show in folder; MainPanel owns the handlers; rows and the line stay presentational.

**Tech Stack:** TypeScript (strict), React 18, Zustand (`subscribeWithSelector`), Vitest 4 + jsdom + @testing-library/react, i18next catalogs (`src/locales/*/translation.json`, 30 locales, **no key added**), SCSS compiled by `sass` (vite passes no options), lucide-react 0.515.

**Spec:** `docs/superpowers/specs/2026-10-05-unified-notices-design.md` (approved 2026-10-05). Rendered reference of the approved look: https://claude.ai/artifact/HEdyYUhSnxkeCzdBQu11zb (R2 rows, P1 line, green banner, T4 red, T5 nothing).

**Working copy:** worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/notices-unified-spec`, branch `worktree-notices-unified-spec`, base `origin/main` e2c28b61. `node_modules` is a symlink to the main checkout's; `npx vitest run <file>` and `npx tsc --noEmit -p tsconfig.json` work from the worktree root. Run every command from there. Never `git stash`; never push or open a PR without jiangzhuo's go (each of the four parts below is one PR, opened only when he says so).

## Global Constraints

**Locales:** no key is added to or removed from any of the 30 catalogs. Every string drawn here already exists: `notices.*` (via `noticeText`), `mainPanel.export.copySuccess`, `mainPanel.export.copyFailed`, `mainPanel.export.autoSave.saved|failed|showInFolder`, `mainPanel.export.downloadTxt`, `settings.title`, `common.topUp`, `common.signIn`, `common.dismiss`, `audioPanel.openSystemSettings`, `connectionStatus.reconnecting`, `echoNotice.*`, `subtitle.enterButton.refreshPageHint`, `audioSystem.*`, `update.available|linuxMigrateTitle|downloading|downloaded|downloadNow|goToDownload|restartNow|checkButton|checking|upToDate|error`, `auth.sessionExpired`. `src/locales/*/locales.consistency.test.ts` must stay green untouched. The only table that grows is `NOTICE_ALIASES` in `src/lib/view/noticeText.ts` (four rows for the panel notes — a code table, not a catalog; spec §8's "no key" sentence refers to catalogs).

**Diagnostics policy (CLAUDE.md "Error Handling"):** no new `console.error/warn`; `src/lib/diagnostics/consoleLedger.consistency.test.ts` is exact per file — when a file with a row is deleted, delete the row and leave a one-line "gone, not lowered to 0" comment in its place, as the file's own comments do. `report()` never shows UI. Adapters are untouched.

**The notice model (spec §1):**

| kind | renderer | lifetime | dismiss |
|---|---|---|---|
| event (L1 `Notice`, and a panel note) | `SystemRow` in the list, time order | with the conversation; `lifetime: 'transient'` hides after `TRANSIENT_NOTICE_MS` (8000, `src/lib/view/filter.ts`) | never |
| state | `StatusLine`, one line above the control footer | while the condition holds; priority: cannot start › reconnecting › waiting for a microphone › subtitle layer unavailable › echo | echo (per cause, reset on all-clear) and the subtitle hint only |
| app | `Banner`, top of the panel, `attention` above `brand` | until dismissed/resolved; `downloading` has no dismiss | yes |

**Visual values (spec §2–4, copied from the approved page):**
- `SystemRow`: `padding: 3px 8px; font-size: 12px; line-height: 1.4; text-align: center`; icon 13px inline (`vertical-align: -2px; margin-right: 5px`); error icon `#ff6b6b` text `#d8d8d8`; warning icon `#f39c12` text `#bdbdbd`; info icon and text `#8a8a8a`; action ` · Label` in `#0fbb8f` underlined, separator `#666`.
- `StatusLine`: `display:flex; align-items:flex-start; gap:8px; padding:6px 12px; background:#252525; border-top:1px solid #333; font-size:12px; line-height:1.4; color:#e8e8e8; flex-shrink:0`; icon 14px `#f39c12`; action button `background:rgba(255,255,255,.1); color:#fff; padding:3px 8px; border-radius:3px`; dismiss `X` 14px `#aaa`.
- `Banner`: today's `AudioSystemBanner.scss` geometry; tones `attention` `tk.$color-usage` (#e67e22), `brand` `tk.$color-primary-fill` (#008261).
- Icons: lucide **canonical** names in new code — `CircleAlert`, `TriangleAlert`, `Info`, `MicOff`, `KeyRound`, `Wallet`, `RefreshCw`, `Captions`, `Check`, `Download`, `Wrench`, `X` (the alias names `AlertCircle`/`AlertTriangle` are only in files this plan deletes).

**Tests:** vitest, colocated. Component tests mock `react-i18next` so `t` returns the key (pattern: `PanelFooter.test.tsx:1-17`) — assertions are on keys and structure, never on English copy. Stores are reset with `setState` in `beforeEach`. `src/setupTests.ts` clears `logStore` after each test. TDD: the failing test is written and run before the code.

**Code style:** English comments; conventional commits; match the neighbouring files' idiom (the comments in `MainPanel.tsx` cite the ruling or spec section a line serves — do the same, citing this spec's section). Do not touch `src/services/clients/LocalNativeClient.ts` or anything the old Local Native path owns (#578).

**Rendering check per part:** before a part is called done, render its surfaces at 450px and 300px, `en` and `zh_CN`, and compare with the approved page (the memory file `sokuji-ui-decisions-by-rendering` has the headless-chromium recipe). This is jiangzhuo's rule, not optional.

## Review Focus

Five inputs the spec implies but no test would exercise unless written here; each has its test in the task named:

1. **A lease ends a run on `budget_exhausted` and the balance is then below the floor.** The user must see the event row once (the record) and the status line once (`balance_below_floor`, Top up) — never a second Top up on the row, never a duplicated line. → Task 2.1 (`statusLine` ignores `lease-ended`), Task 1.3 (`SystemRow` draws no action for `budget_exhausted`).
2. **Clear while a failed start's line shows, then another failed start.** The first line must go on Clear and the second must appear (identity of `lastEnd`, not its code). → Task 2.1.
3. **Echo dismissed, then a reconnect comes and goes.** The reconnecting line shows on top; when it clears, the dismissed echo must stay hidden (dismissal is per cause, not per line). → Task 2.1.
4. **A panel note arrives while a transient L1 notice's hide timer is pending.** Both must hide at their own time; the next expiry must be the earliest of the two. → Task 1.2 (`visibleEntries` over merged entries).
5. **The update check fails twice in a row.** The second failure must show the Help link's red label again, although the store's status never left `error`. → Task 3.3 (the label swap keys on a change counter, not on the status alone).

## File Structure

New files (one responsibility each):

| file | responsibility |
|---|---|
| `src/lib/view/noticeActions.ts` (+ `.test.ts`) | code → `NoticeActionSpec`; action → label key. Pure. |
| `src/stores/panelNotesStore.ts` (+ `.test.ts`) | the panel notes: `add`, `clear`, selectors. No persistence. |
| `src/lib/view/panelNotes.ts` (+ `.test.ts`) | panel notes → `NoticeEntry[]` for the list; the `panel:` id prefix. Pure. |
| `src/components/Conversation/SystemRow.tsx` | the R2 row. Presentational; receives words and a resolved action. |
| `src/lib/view/echoWords.ts` | the echo causes' locale keys and fallbacks (moved out of `EchoNotice.tsx`). |
| `src/lib/view/statusLine.ts` (+ `.test.ts`) | the state selector: inputs → `StatusEntry | null`. Pure. |
| `src/components/MainPanel/StatusLine.tsx` (+ `.test.tsx`) | the P1 line. Presentational. |
| `src/components/MainPanel/useStatusLine.ts` | gathers the selector's inputs from the stores and the run; returns the entry and the two handlers. Used by MainPanel and the Electron takeover. |
| `src/components/Banner/Banner.tsx`, `Banner.scss` (+ `.test.tsx`) | the one banner. Presentational. |
| `src/components/Banner/useBanners.tsx` (+ `.test.tsx`) | `audioSystemStore` + `updateStore` → ordered banner props; the `Banners` component that draws them. |
| `src/components/Auth/SignInForm.test.tsx` | the session-expired message in the card's slot. |

Modified: `ConversationList.tsx` (+ tests), `MainPanel.tsx` (+ tests), `MainPanel.scss`, `PanelFooter.tsx` (+ test), `ExportButton.tsx` (+ tests), `lib/transcript/autoSave.ts` (+ test), `lib/export/appAutoSave.ts` (+ test), `app/session.ts` (+ test), `app/useAppSession.ts` (+ test), `lib/view/noticeText.ts` (+ test), `stores/subtitleStore.ts` (+ test), `Subtitle/SubtitleEnterButton.tsx` (+ tests), `Subtitle/SubtitleView.tsx`, `Subtitle/SubtitleTakeover.tsx`, `stores/updateStore.ts` (+ test), `Settings/sections/HelpSection.tsx` (+ test), `Settings/Settings.scss`, `stores/settingsStore.ts`, `Auth/UserAccountInfo.tsx` (+ test), `TitleBar/AccountButton.tsx` (+ test), `components/AppProviders.tsx`, `components/dev/SpinePreview.tsx`, `lib/diagnostics/consoleLedger.consistency.test.ts`.

Deleted: `lib/view/lastEnd.ts` (+ test), `components/EchoNotice/EchoNotice.tsx`, `EchoNotice.scss`, `EchoNotice.test.tsx` (the hook `useEchoNotice.ts` stays), `components/UpdateBanner/` (whole folder), `components/AudioSystemBanner/` (whole folder; its four test cases move to `useBanners.test.tsx`), `components/Toast/` (whole folder).

---

# Part 1 — event: the system row and the panel notes (PR 1)

### Task 1.1: `noticeActions.ts` — one table from a code to its action

**Files:**
- Create: `src/lib/view/noticeActions.ts`
- Test: `src/lib/view/noticeActions.test.ts`

**Interfaces:**
- Consumes: `NOTICE_TARGETS` / `settingsTargetForCode` from `src/lib/view/noticeTargets.ts`; `LOOPBACK_DENIED` from `src/lib/audio/capture/systemAudio.ts`; `BALANCE_BELOW_FLOOR` from `src/lib/session/shape.ts`.
- Produces: `NoticeActionSpec`, `actionForCode(code)`, `actionLabel(action)` — used by Tasks 1.3, 1.6, 2.1, 2.2.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/view/noticeActions.test.ts
import { describe, expect, it } from 'vitest';
import { actionForCode, actionLabel } from './noticeActions';

describe('actionForCode', () => {
  it('sends a NOTICE_TARGETS code to its Settings section', () => {
    expect(actionForCode('credentials_missing')).toEqual({ kind: 'settings', target: 'provider' });
    expect(actionForCode('no_microphone')).toEqual({ kind: 'settings', target: 'microphone' });
  });
  it('sends the balance codes to Top up', () => {
    expect(actionForCode('balance_below_floor')).toEqual({ kind: 'top-up' });
    expect(actionForCode('insufficient_balance')).toEqual({ kind: 'top-up' });
  });
  it('sends a signed-out managed provider to Sign in', () => {
    expect(actionForCode('sign_in_required')).toEqual({ kind: 'sign-in' });
  });
  it('sends loopback_denied to the Screen Recording pane', () => {
    expect(actionForCode('loopback_denied')).toEqual({ kind: 'system-settings', pane: 'screen-recording' });
  });
  it('gives the reasons a run ended no action: the status line carries the fix (spec §2)', () => {
    for (const code of ['budget_exhausted', 'segment_ended', 'leg_closed', 'source_ended', 'connection_lost', 'leg_failed']) {
      expect(actionForCode(code), code).toBeNull();
    }
    expect(actionForCode(undefined)).toBeNull();
  });
});

describe('actionLabel', () => {
  it('names each action by an existing catalog key', () => {
    expect(actionLabel({ kind: 'settings', target: 'provider' })).toEqual({ key: 'settings.title', fallback: 'Settings' });
    expect(actionLabel({ kind: 'top-up' })).toEqual({ key: 'common.topUp', fallback: 'Top up' });
    expect(actionLabel({ kind: 'sign-in' })).toEqual({ key: 'common.signIn', fallback: 'Sign In' });
    expect(actionLabel({ kind: 'system-settings', pane: 'screen-recording' })).toEqual({ key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' });
    expect(actionLabel({ kind: 'show-in-folder', dir: '/tmp' })).toEqual({ key: 'mainPanel.export.autoSave.showInFolder', fallback: 'Show in folder' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/view/noticeActions.test.ts`
Expected: FAIL — `Failed to resolve import "./noticeActions"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/view/noticeActions.ts
/**
 * What a notice offers the user to do about it, in one place (spec
 * 2026-10-05 §6). A code resolves to an action here; MainPanel owns the
 * handlers; rows and the status line only draw the label.
 */
import { LOOPBACK_DENIED } from '../audio/capture/systemAudio';
import { BALANCE_BELOW_FLOOR } from '../session/shape';
import { settingsTargetForCode } from './noticeTargets';

export type NoticeActionSpec =
  | { kind: 'settings'; target: string }
  | { kind: 'top-up' }
  | { kind: 'sign-in' }
  | { kind: 'system-settings'; pane: 'screen-recording' | 'audio-capture' }
  | { kind: 'show-in-folder'; dir: string };

/** The managed provider's lease refused a start, or the gate did, on the balance: both are fixed by topping up. */
const TOP_UP_CODES: ReadonlySet<string> = new Set([BALANCE_BELOW_FLOOR, 'insufficient_balance']);

export function actionForCode(code: string | undefined): NoticeActionSpec | null {
  if (code === undefined) return null;
  if (code === LOOPBACK_DENIED) return { kind: 'system-settings', pane: 'screen-recording' };
  if (TOP_UP_CODES.has(code)) return { kind: 'top-up' };
  if (code === 'sign_in_required') return { kind: 'sign-in' };
  const target = settingsTargetForCode(code);
  return target ? { kind: 'settings', target } : null;
}

/** The action's label: a key every catalog has, and the English `defaultValue`. */
export function actionLabel(action: NoticeActionSpec): { key: string; fallback: string } {
  switch (action.kind) {
    case 'settings': return { key: 'settings.title', fallback: 'Settings' };
    case 'top-up': return { key: 'common.topUp', fallback: 'Top up' };
    case 'sign-in': return { key: 'common.signIn', fallback: 'Sign In' };
    case 'system-settings': return { key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' };
    case 'show-in-folder': return { key: 'mainPanel.export.autoSave.showInFolder', fallback: 'Show in folder' };
  }
}
```

Note: `NOTICE_TARGETS` already maps `sign_in_required` to `'provider'`; `actionForCode` checks `sign-in` before the Settings lookup on purpose — the sign-in overlay is the fix, not the provider section.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/view/noticeActions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/view/noticeActions.ts src/lib/view/noticeActions.test.ts
git commit -m "feat(view): one table from a notice code to its action (#481)"
```

### Task 1.2: The panel notes store, their entries, and the four alias rows

**Files:**
- Create: `src/stores/panelNotesStore.ts`, `src/stores/panelNotesStore.test.ts`
- Create: `src/lib/view/panelNotes.ts`, `src/lib/view/panelNotes.test.ts`
- Modify: `src/lib/view/noticeText.ts:75-127` (four `NOTICE_ALIASES` rows), `src/lib/view/noticeText.test.ts` (if it enumerates the alias table — check with `grep -n "NOTICE_ALIASES\|insufficient_balance" src/lib/view/noticeText.test.ts`; add the four rows wherever the existing rows are listed)

**Interfaces:**
- Consumes: `NoticeActionSpec` (Task 1.1); `NoticeEntry` from `src/lib/view/filter.ts`; `visibleEntries`, `nextNoticeExpiry`, `TRANSIENT_NOTICE_MS` from the same file.
- Produces: `PanelNote`, `PanelNoteInput`, `PANEL_NOTE_CODES`, `usePanelNotesStore` (`notes`, `add`, `clear`), `usePanelNotes()`; `PANEL_NOTE_ID_PREFIX`, `panelNoteEntries(notes)`, `isPanelNoteId(id)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/panelNotesStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_NOTE_CODES, usePanelNotesStore } from './panelNotesStore';

describe('panelNotesStore', () => {
  beforeEach(() => { usePanelNotesStore.setState({ notes: [] }); });

  it('appends a note with its own id and time', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'Conversation copied to clipboard', lifetime: 'transient' }, 1000);
    usePanelNotesStore.getState().add({ severity: 'warning', code: PANEL_NOTE_CODES.autoSaveFailed, message: 'auto-save failed', params: { action: 'Download as .txt' } }, 2000);
    const { notes } = usePanelNotesStore.getState();
    expect(notes.map((n) => [n.code, n.at])).toEqual([['export_copied', 1000], ['autosave_failed', 2000]]);
    expect(new Set(notes.map((n) => n.id)).size).toBe(2);
  });

  it('keeps the action on the note', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.autoSaveSaved, message: 'saved', params: { filename: 'a.txt' }, action: { kind: 'show-in-folder', dir: '/d' } });
    expect(usePanelNotesStore.getState().notes[0].action).toEqual({ kind: 'show-in-folder', dir: '/d' });
  });

  it('clear empties it', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'copied' });
    usePanelNotesStore.getState().clear();
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});
```

```ts
// src/lib/view/panelNotes.test.ts
import { describe, expect, it } from 'vitest';
import type { Entry } from '../projection/types';
import { nextNoticeExpiry, TRANSIENT_NOTICE_MS, visibleEntries } from './filter';
import { isPanelNoteId, PANEL_NOTE_ID_PREFIX, panelNoteEntries } from './panelNotes';
import type { PanelNote } from '../../stores/panelNotesStore';

const note = (over: Partial<PanelNote> = {}): PanelNote => ({
  id: 'n1', at: 5000, severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient', ...over,
});

describe('panelNoteEntries', () => {
  it('turns a note into a notice entry on the speaker leg, with a prefixed id', () => {
    const [entry] = panelNoteEntries([note({ params: { filename: 'a.txt' } })]);
    expect(entry).toEqual({
      kind: 'notice', id: `${PANEL_NOTE_ID_PREFIX}n1`, leg: 'speaker', severity: 'info', message: 'copied',
      code: 'export_copied', params: { filename: 'a.txt' }, lifetime: 'transient', at: 5000,
    });
    expect(isPanelNoteId(entry.id)).toBe(true);
    expect(isPanelNoteId('speaker:n:3')).toBe(false);
  });

  it('returns the same array for the same notes, so memoized lists keep their items', () => {
    const notes = [note()];
    expect(panelNoteEntries(notes)).toBe(panelNoteEntries(notes));
  });

  // Review Focus 4: a note and an L1 transient notice hide each at its own time.
  it('hides with the conversation’s transient rule, the earliest expiry first', () => {
    const l1: Entry = { kind: 'notice', id: 'speaker:n:1', leg: 'speaker', severity: 'warning', message: 'm', code: 'mic_lost_using_other', lifetime: 'transient', at: 1000 };
    const merged = [l1, ...panelNoteEntries([note({ at: 4000 })])];
    expect(nextNoticeExpiry(merged, 0)).toBe(1000 + TRANSIENT_NOTICE_MS);
    expect(visibleEntries(merged, 1000 + TRANSIENT_NOTICE_MS).map((e) => e.id)).toEqual([`${PANEL_NOTE_ID_PREFIX}n1`]);
    expect(visibleEntries(merged, 4000 + TRANSIENT_NOTICE_MS)).toEqual([]);
  });

  it('a note without a lifetime stays', () => {
    const merged = panelNoteEntries([note({ lifetime: undefined, code: 'autosave_saved' })]);
    expect(visibleEntries(merged, 10 ** 12)).toHaveLength(1);
  });
});
```

Also add to `src/lib/view/noticeText.test.ts`, in the describe that covers aliases:

```ts
  it('words the panel notes by the export keys (spec 2026-10-05 §5)', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => `${key}|${opts?.defaultValue ?? ''}`) as unknown as import('i18next').TFunction;
    expect(noticeText(t, { code: 'export_copied', message: 'copied' })).toBe('mainPanel.export.copySuccess|copied');
    expect(noticeText(t, { code: 'export_copy_failed', message: 'failed' })).toBe('mainPanel.export.copyFailed|failed');
    expect(noticeText(t, { code: 'autosave_saved', message: 'saved' })).toBe('mainPanel.export.autoSave.saved|saved');
    expect(noticeText(t, { code: 'autosave_failed', message: 'failed' })).toBe('mainPanel.export.autoSave.failed|failed');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/panelNotesStore.test.ts src/lib/view/panelNotes.test.ts src/lib/view/noticeText.test.ts`
Expected: the first two FAIL on unresolved imports; the new `noticeText` case FAILS with the raw message (`'copied'`) because no alias exists.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/stores/panelNotesStore.ts
/**
 * Panel notes: the results of a user's action that concern the conversation
 * — copied, auto-saved — drawn as system rows after the conversation's own
 * entries (spec 2026-10-05 §5). They are not L1 notices on purpose: the
 * exports and the subtitle bands read L1 only, so nothing has to filter them
 * out. Cleared by Clear and by the next start; never persisted.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { NoticeActionSpec } from '../lib/view/noticeActions';

export const PANEL_NOTE_CODES = {
  exportCopied: 'export_copied',
  exportCopyFailed: 'export_copy_failed',
  autoSaveSaved: 'autosave_saved',
  autoSaveFailed: 'autosave_failed',
} as const;

export interface PanelNote {
  id: string;
  at: number;
  severity: 'error' | 'warning' | 'info';
  /** A `NOTICE_ALIASES` code: the words come from `noticeText`. */
  code: string;
  /** Diagnostic English, as a Notice's. */
  message: string;
  params?: Record<string, string | number>;
  lifetime?: 'transient';
  action?: NoticeActionSpec;
}

export type PanelNoteInput = Omit<PanelNote, 'id' | 'at'>;

interface PanelNotesState {
  notes: readonly PanelNote[];
  /** `at` is for tests; the app stamps `Date.now()`, the clock `useVisibleEntries` reads. */
  add(input: PanelNoteInput, at?: number): void;
  clear(): void;
}

let seq = 0;

export const usePanelNotesStore = create<PanelNotesState>()(
  subscribeWithSelector((set) => ({
    notes: [],
    add: (input, at = Date.now()) => {
      seq += 1;
      set((state) => ({ notes: [...state.notes, { ...input, id: `${at}-${seq}`, at }] }));
    },
    clear: () => set({ notes: [] }),
  })),
);

export const usePanelNotes = () => usePanelNotesStore((s) => s.notes);
```

```ts
// src/lib/view/panelNotes.ts
/**
 * Panel notes as the list draws them: notice entries on the speaker leg, with
 * an id the panel can tell from L1's, so the note's own action is found
 * (spec 2026-10-05 §5). The same notes give the same array, so a memoized
 * list keeps its items.
 */
import type { PanelNote } from '../../stores/panelNotesStore';
import type { NoticeEntry } from './filter';

export const PANEL_NOTE_ID_PREFIX = 'panel:';

export function isPanelNoteId(id: string): boolean {
  return id.startsWith(PANEL_NOTE_ID_PREFIX);
}

const cache = new WeakMap<readonly PanelNote[], NoticeEntry[]>();

export function panelNoteEntries(notes: readonly PanelNote[]): NoticeEntry[] {
  const hit = cache.get(notes);
  if (hit) return hit;
  const entries = notes.map((n): NoticeEntry => ({
    kind: 'notice',
    id: `${PANEL_NOTE_ID_PREFIX}${n.id}`,
    leg: 'speaker',
    severity: n.severity,
    message: n.message,
    code: n.code,
    ...(n.params ? { params: n.params } : {}),
    ...(n.lifetime ? { lifetime: n.lifetime } : {}),
    at: n.at,
  }));
  cache.set(notes, entries);
  return entries;
}
```

In `src/lib/view/noticeText.ts`, add to `NOTICE_ALIASES` (after the `region_unsupported` row):

```ts
  // The panel notes (spec 2026-10-05 §5): a result about the conversation,
  // worded by the export menu's own sentences.
  export_copied: 'mainPanel.export.copySuccess',
  export_copy_failed: 'mainPanel.export.copyFailed',
  autosave_saved: 'mainPanel.export.autoSave.saved',
  autosave_failed: 'mainPanel.export.autoSave.failed',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/panelNotesStore.test.ts src/lib/view/panelNotes.test.ts src/lib/view/noticeText.test.ts`
Expected: PASS. If `noticeText.test.ts` has a table asserting the exact set of alias codes, add the four codes there too and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/stores/panelNotesStore.ts src/stores/panelNotesStore.test.ts src/lib/view/panelNotes.ts src/lib/view/panelNotes.test.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts
git commit -m "feat(view): panel notes — results about the conversation, drawn after it (#481)"
```

### Task 1.3: `SystemRow` replaces `NoticeBubble`

**Files:**
- Create: `src/components/Conversation/SystemRow.tsx`
- Modify: `src/components/Conversation/ConversationList.tsx:1-31, 92-95, 205-243` (import, the `NoticeAction` type, the notice branch, delete `NoticeBubble`)
- Modify: `src/components/MainPanel/MainPanel.scss:127-213` (replace the `.message-bubble` block with `.sys-row`)
- Test: `src/components/Conversation/ConversationList.test.tsx` (replace the bubble assertions; add the system-row cases), `src/components/MainPanel/MainPanel.test.tsx` (its `.message-bubble` / `.message-action` / `.error-content` selectors become `.sys-row` / `.sys-row__action`; find them with `grep -n "message-bubble\|message-action\|error-content\|message-header" src/components/MainPanel/MainPanel.test.tsx src/components/Conversation/*.test.tsx`)

**Interfaces:**
- Consumes: `NoticeEntry` (`src/lib/view/filter.ts`), `noticeText`.
- Produces: `SystemRow({ notice, action })`, `NoticeAction { label; run() }` (moved here; `ConversationList` re-exports it so `MainPanel.tsx:48`'s import keeps working).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/Conversation/ConversationList.test.tsx` (the file already mocks `react-i18next` so `t(key, fallback)` returns the fallback):

```tsx
const noticeItem = (over: Partial<Extract<DisplayItem, { kind: 'notice' }>['notice']> = {}): DisplayItem => ({
  kind: 'notice',
  notice: { kind: 'notice', id: 'speaker:n:1', leg: 'speaker', severity: 'error', message: 'Session budget exhausted', code: 'budget_exhausted', at: 0, ...over },
});

describe('ConversationList — system rows (spec 2026-10-05 §2)', () => {
  it('draws a notice as a centred row: the severity on the icon and class, no header word, no bubble', () => {
    const { container } = render(<ConversationList {...props({ items: [noticeItem()] })} />);
    const row = container.querySelector('.sys-row');
    expect(row?.className).toBe('sys-row sys-row--error');
    expect(row?.querySelector('svg')).not.toBeNull();
    expect(row?.querySelector('.sys-row__text')?.textContent).toBe('Session budget exhausted');
    expect(container.querySelector('.message-bubble')).toBeNull();
    expect(container.querySelector('.message-header')).toBeNull();
  });

  it('tells the three severities apart by class alone', () => {
    const { container } = render(<ConversationList {...props({ items: [
      noticeItem({ id: 'a', severity: 'warning', code: 'tts_degraded', message: 'degraded' }),
      noticeItem({ id: 'b', severity: 'info', code: 'mic_now_using', message: 'now using', params: { device: 'USB Mic' } }),
    ] })} />);
    expect(container.querySelectorAll('.sys-row--warning')).toHaveLength(1);
    expect(container.querySelectorAll('.sys-row--info')).toHaveLength(1);
  });

  it('offers the caller’s action as an inline link after the words, and runs it', () => {
    const run = vi.fn();
    const { container } = render(<ConversationList {...props({
      items: [noticeItem({ severity: 'warning', code: 'voice_fallback', message: 'fallback' })],
      noticeAction: () => ({ label: 'Settings', run }),
    })} />);
    const link = container.querySelector('.sys-row__text .sys-row__action');
    expect(link?.textContent).toBe('Settings');
    fireEvent.click(link!);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('draws no link when the caller gives no action', () => {
    const { container } = render(<ConversationList {...props({ items: [noticeItem()], noticeAction: () => null })} />);
    expect(container.querySelector('.sys-row__action')).toBeNull();
  });
});
```

Then update the file's existing notice tests: every `.message-bubble.error` / `.message-bubble.system` selector becomes `.sys-row--error` / `.sys-row--info` (warning: `.sys-row--warning`), `.message-action` becomes `.sys-row__action`, and assertions on the header words `Error` / `Warning` / `Notice` are deleted (the row has no header). Do the same in `MainPanel.test.tsx`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Conversation/ConversationList.test.tsx`
Expected: the four new cases FAIL (`.sys-row` is null); the updated old cases FAIL the same way.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/Conversation/SystemRow.tsx
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { NoticeEntry } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';

/** What a system row offers below its words (spec 2026-10-05 §2: rarely). */
export interface NoticeAction {
  label: string;
  run(): void;
}

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

/**
 * An event in the conversation, drawn as a chat system row (spec 2026-10-05
 * §2, R2): centred, 12px, no background and no header word. The severity is
 * the icon's colour and the text's brightness, nothing else; an action is an
 * inline link after the words.
 */
export const SystemRow = memo(function SystemRow({ notice, action }: { notice: NoticeEntry; action: NoticeAction | null }) {
  const { t } = useTranslation();
  // A code-less notice with an empty message has no words at all: the same
  // "Unknown error" the bubble fell back to, rather than an empty row.
  const words = noticeText(t, notice) || t('mainPanel.unknownError', 'Unknown error');
  const Icon = ICON[notice.severity];
  return (
    <div className={`sys-row sys-row--${notice.severity}`}>
      <Icon size={13} aria-hidden="true" />
      <span className="sys-row__text">
        {words}
        {action && (
          <button type="button" className="sys-row__action" onClick={action.run}>
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
});
```

In `src/components/Conversation/ConversationList.tsx`:
- line 3: `import { AlertCircle, Info, Play, User, Users } from 'lucide-react';` → `import { Play, User, Users } from 'lucide-react';`
- lines 27-31 (the `NoticeAction` interface): delete, and add after the imports: `import { SystemRow, type NoticeAction } from './SystemRow';` and `export type { NoticeAction } from './SystemRow';`
- line 94: `return <NoticeBubble key={item.notice.id} notice={item.notice} action={actionFor(item.notice)} />;` → `return <SystemRow key={item.notice.id} notice={item.notice} action={actionFor(item.notice)} />;`
- lines 205-243: delete the whole `NoticeBubble` component.

In `src/components/MainPanel/MainPanel.scss`, replace lines 127-213 (from `.message-bubble {` through its closing `}` just before the `// ─── Karaoke Highlighting` comment) with:

```scss
// ─── System rows (spec 2026-10-05 §2, R2) ──────────
// An event in the conversation: a chat system row, not a message. No
// background, no header word; the severity is the icon's colour and the
// text's brightness. Nothing else in src/ draws `.message-bubble` any more.

.sys-row {
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #9aa0a6;
  text-align: center;

  > svg {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 5px;
  }

  &--error { color: #d8d8d8; > svg { color: #ff6b6b; } }
  &--warning { color: #bdbdbd; > svg { color: tk.$color-degraded; } }
  &--info { color: #8a8a8a; > svg { color: tk.$color-toolbar-icon; } }

  &__text { display: inline; }

  // The action is a link after the words: ` · Settings`.
  &__action {
    font: inherit;
    background: none;
    border: none;
    padding: 0;
    color: tk.$color-primary;
    text-decoration: underline;
    cursor: pointer;
    // `pre` keeps the spaces around the dot: an inline-block drops the leading and trailing space of its own line.
    &::before { content: ' · '; color: #666; text-decoration: none; display: inline-block; white-space: pre; }
    &:hover { opacity: 0.8; }
    &:focus-visible { @include vars.focus-ring; }
  }
}
```

(`tk.$color-degraded` is `#f39c12`, `tk.$color-toolbar-icon` is `#8a8a8a`, `tk.$color-primary` is `#0fbb8f` — `src/styles/_tokens.scss`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Conversation src/components/MainPanel/MainPanel.test.tsx`
Expected: PASS. Then `grep -rn "message-bubble\|NoticeBubble\|error-content" src --include='*.tsx' --include='*.ts' --include='*.scss'` prints nothing but comments.

- [ ] **Step 5: Commit**

```bash
git add src/components/Conversation/SystemRow.tsx src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.test.tsx src/components/MainPanel/MainPanel.scss src/components/MainPanel/MainPanel.test.tsx
git commit -m "feat(conversation): draw a notice as a system row, not a bubble (#481)"
```

### Task 1.4: Auto-save tells the user through a panel note, not a toast

**Files:**
- Modify: `src/lib/transcript/autoSave.ts` (whole file: the notifier type, `saveFailed`, `saveTranscriptText`)
- Modify: `src/lib/export/appAutoSave.ts` (type import only — it passes `notify` through)
- Modify: `src/app/session.ts:22, 36-43, 97-103, 145-152` and the subscriptions near `:270-285`; `src/app/useAppSession.ts:9, 22, 28`
- Test: `src/lib/transcript/autoSave.test.ts`, `src/lib/export/appAutoSave.test.ts`, `src/app/session.test.ts:242`

**Interfaces:**
- Consumes: `PanelNoteInput`, `PANEL_NOTE_CODES`, `usePanelNotesStore` (Task 1.2).
- Produces: `AutoSaveNotifier = { note(input: PanelNoteInput): void }`; `AppBridges` loses `notify`; the session clears the panel notes when a run starts.

- [ ] **Step 1: Write the failing tests**

In `src/lib/transcript/autoSave.test.ts`, replace the notifier (lines 30-31) and every `showToast` assertion:

```ts
const note = vi.fn();
const notify = { note };
// beforeEach (line 45): note.mockReset();
```

The saved case (around line 62) becomes:

```ts
    const [input] = note.mock.calls[0];
    expect(input).toMatchObject({
      severity: 'info',
      code: 'autosave_saved',
      params: { filename: 'sokuji-conversation-20260924-100100.txt' },
      action: { kind: 'show-in-folder', dir: '/home/u/Downloads' },
    });
    expect(input.lifetime).toBeUndefined();
```

(use the filename and `dir` the test's mocked `transcript:save` result already returns). The browser case (line 73): `expect(note).not.toHaveBeenCalled();`. The failed case (line 86):

```ts
    const [input] = note.mock.calls[0];
    expect(input).toMatchObject({ severity: 'warning', code: 'autosave_failed', params: { action: 'Download as .txt' } });
    expect(input.action).toBeUndefined();
```

In `src/lib/export/appAutoSave.test.ts` (lines 47-101): `const note = vi.fn();` replaces `showToast`; every `{ showToast }` argument becomes `{ note }`; line 93 becomes `expect(note.mock.calls[0][0]).toMatchObject({ code: 'autosave_saved', params: { filename: 'sokuji-conversation-20260924-100100.txt' } });`; line 101 becomes `expect(note.mock.calls[0][0]).toMatchObject({ severity: 'warning', code: 'autosave_failed' });`.

In `src/app/session.test.ts:242`, delete `expect(notify).toEqual({ showToast: expect.any(Function) });` (and the `notify` destructuring that fed it, if nothing else uses it). Add, in the same describe, with the file's existing session fixture:

```ts
  it('clears the panel notes when a run starts (spec 2026-10-05 §5)', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied' });
    session.runner.state.setState({ phase: 'starting', step: 'checking' });
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
```

(`import { usePanelNotesStore } from '../stores/panelNotesStore';` at the top.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/transcript/autoSave.test.ts src/lib/export/appAutoSave.test.ts src/app/session.test.ts`
Expected: FAIL — `notify.showToast is not a function` in the first two; the new session case fails with one note left.

- [ ] **Step 3: Write minimal implementation**

`src/lib/transcript/autoSave.ts`, whole file:

```ts
import i18n from '../../locales';
import { isElectron } from '../../utils/environment';
import { reportError, describeCause } from '../diagnostics/report';
import { downloadFile } from '../../utils/conversationExport';
import { PANEL_NOTE_CODES, type PanelNoteInput } from '../../stores/panelNotesStore';

/** Where the save's result goes: a panel note, drawn after the conversation (spec 2026-10-05 §5). */
export interface AutoSaveNotifier {
  note(input: PanelNoteInput): void;
}

/** What happened. The user has already been told whatever they need to know. */
export type AutoSaveOutcome = 'disabled' | 'empty' | 'saved' | 'failed';

/** A failed save, reported and told to the user with the way to save by hand. */
export function saveFailed(error: unknown, notify: AutoSaveNotifier): 'failed' {
  reportError('AutoSave', `Failed to auto-save the conversation: ${describeCause(error)}`, { cause: error });
  notify.note({
    severity: 'warning',
    code: PANEL_NOTE_CODES.autoSaveFailed,
    message: "Couldn't auto-save the conversation.",
    // The way out is the export menu's own item, named as that locale names it.
    params: { action: i18n.t('mainPanel.export.downloadTxt', { defaultValue: 'Download as .txt' }) },
  });
  return 'failed';
}

/**
 * Saves a finished conversation's text: on Electron through the main process
 * into Downloads, with a note that can show the folder; in a browser as a
 * download, whose own UI is the confirmation. Never rejects.
 */
export async function saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'> {
  try {
    if (!isElectron()) {
      // The browser's own download UI is the confirmation. The page cannot
      // tell whether Chrome's download limiter let the file through, so a
      // "saved" note here could be false.
      downloadFile(content, filename, 'text/plain;charset=utf-8');
      return 'saved';
    }

    const result = await window.electron.invoke('transcript:save', { content });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'The main process did not save the transcript');
    }
    const savedName: string = String(result.path).split(/[\\/]/).pop() ?? String(result.path);
    // Not transient: the file's name is the one thing the user may want to find again.
    notify.note({
      severity: 'info',
      code: PANEL_NOTE_CODES.autoSaveSaved,
      message: `Conversation saved: ${savedName}`,
      params: { filename: savedName },
      action: { kind: 'show-in-folder', dir: String(result.dir) },
    });
    return 'saved';
  } catch (error) {
    return saveFailed(error, notify);
  }
}
```

`src/lib/export/appAutoSave.ts`: no code change — it imports `type AutoSaveNotifier` and passes `notify` through; confirm it compiles.

`src/app/session.ts`:
- line 22: keep `import type { AutoSaveNotifier } from '../lib/transcript/autoSave';` and add `import { usePanelNotesStore } from '../stores/panelNotesStore';`
- `AppBridges` (36-43): delete the `notify: AutoSaveNotifier;` member.
- default bridges (99-103): delete `notify: { showToast: () => {} },`.
- before `const runner: Runner = createRunner({`, add:

```ts
  // The results of the auto-save are panel notes (spec 2026-10-05 §5): drawn
  // after the conversation, cleared by Clear and by the next start.
  const panelNotes: AutoSaveNotifier = { note: (input) => usePanelNotesStore.getState().add(input) };
```

- `onRunEnded` (145-152): `await autoSaveConversation(legs, runner.conversation.info, bridges.notify);` → `await autoSaveConversation(legs, runner.conversation.info, panelNotes);`
- beside the existing `runner.state.subscribe(...)` calls (around 270-285), add:

```ts
  // A new run starts a new record: the previous run's panel notes go with the
  // conversation they belonged to (spec 2026-10-05 §5).
  runner.state.subscribe((now, before) => {
    if (now.phase === 'starting' && before.phase === 'idle') usePanelNotesStore.getState().clear();
  });
```

`src/app/useAppSession.ts`: delete line 9 (`import { useToast } ...`), line 22 (`const { showToast } = useToast();`), and the `notify: { showToast },` member in `setBridges` (line 28); update the doc comments that mention toasts ("the bridges the runner reads — sign-in, analytics, the balance refetch").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/transcript src/lib/export src/app`
Expected: PASS. `npx tsc --noEmit -p tsconfig.json` reports nothing about `notify`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcript/autoSave.ts src/lib/transcript/autoSave.test.ts src/lib/export/appAutoSave.ts src/lib/export/appAutoSave.test.ts src/app/session.ts src/app/session.test.ts src/app/useAppSession.ts
git commit -m "feat(export): the auto-save's result is a panel note, kept until the next run (#481)"
```

### Task 1.5: Copying the conversation leaves a transient panel note

**Files:**
- Modify: `src/components/MainPanel/ExportButton.tsx:22, 48, 196-216`
- Test: `src/components/MainPanel/ExportButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/MainPanel/ExportButton.test.tsx`, using the file's existing render helper and its `copyToClipboard` mock (`grep -n "copyToClipboard" src/components/MainPanel/ExportButton.test.tsx` shows how it is stubbed; make it resolve `true` for the first case and `false` for the second):

```tsx
import { usePanelNotesStore } from '../../stores/panelNotesStore';

describe('copy → panel note (spec 2026-10-05 §5)', () => {
  beforeEach(() => { usePanelNotesStore.setState({ notes: [] }); });

  // The copy item's text: the key, or its English default — whichever this file's `t` mock yields.
  const copyItem = () => screen.getByText(/mainPanel\.export\.copyToClipboard|Copy to clipboard/);

  it('leaves a transient info note when the copy succeeds', async () => {
    copyToClipboard.mockResolvedValueOnce(true);
    const { container } = render(<ExportMenuButton {...menuProps()} />);   // the file's own props builder
    fireEvent.click(container.querySelector('.export-btn')!);
    fireEvent.click(copyItem());
    await waitFor(() => expect(usePanelNotesStore.getState().notes).toHaveLength(1));
    expect(usePanelNotesStore.getState().notes[0]).toMatchObject({ severity: 'info', code: 'export_copied', lifetime: 'transient' });
  });

  it('leaves a transient warning note when the copy fails', async () => {
    copyToClipboard.mockResolvedValueOnce(false);
    const { container } = render(<ExportMenuButton {...menuProps()} />);
    fireEvent.click(container.querySelector('.export-btn')!);
    fireEvent.click(copyItem());
    await waitFor(() => expect(usePanelNotesStore.getState().notes).toHaveLength(1));
    expect(usePanelNotesStore.getState().notes[0]).toMatchObject({ severity: 'warning', code: 'export_copy_failed', lifetime: 'transient' });
  });
});
```

`copyToClipboard` is the file's existing `vi.fn` mock of `../../utils/conversationExport`; `menuProps()` is whatever builder the file's existing copy test renders with (use its name). Then delete that test's `showToast` assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx`
Expected: FAIL — `notes` stays empty.

- [ ] **Step 3: Write minimal implementation**

In `src/components/MainPanel/ExportButton.tsx`:
- line 22: `import { useToast } from '../Toast';` → `import { PANEL_NOTE_CODES, usePanelNotesStore } from '../../stores/panelNotesStore';`
- line 48: delete `const { showToast } = useToast();`
- lines 203-211 (`handleCopy`):

```tsx
  const handleCopy = useCallback(async () => {
    closeMenu();
    // The text is taken before the await, so the copy is the scope as clicked.
    const ok = await copyToClipboard(exporter.text(scope, false));
    // The result is a passing event about the conversation: a transient panel
    // note after it (spec 2026-10-05 §5), not feedback on this button.
    usePanelNotesStore.getState().add(ok
      ? { severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'Conversation copied to clipboard', lifetime: 'transient' }
      : { severity: 'warning', code: PANEL_NOTE_CODES.exportCopyFailed, message: 'Failed to copy. Check browser permissions.', lifetime: 'transient' });
  }, [exporter, scope, closeMenu]);
```

`t` leaves the dependency list with `showToast`; if `t` is now unused in this component, remove it from the destructuring too (the file still uses `t` for the menu items, so it stays).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/MainPanel/ExportButton.test.tsx src/components/MainPanel/ExportMenuButton.test.tsx src/components/MainPanel/ExportButton.childWindow.test.tsx`
Expected: PASS (their `vi.mock('../Toast', …)` lines are now unused but harmless; Task 4.3 deletes them).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/ExportButton.tsx src/components/MainPanel/ExportButton.test.tsx
git commit -m "feat(export): the copy's result is a transient panel note (#481)"
```

### Task 1.6: MainPanel draws the panel notes and resolves actions through the table

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:14-23, 47-48, 169-186, 197-209, 245-252`
- Test: `src/components/MainPanel/MainPanel.test.tsx`

**Interfaces:**
- Consumes: `usePanelNotes`, `usePanelNotesStore` (1.2), `panelNoteEntries`, `isPanelNoteId`, `PANEL_NOTE_ID_PREFIX` (1.2), `actionForCode`, `actionLabel`, `NoticeActionSpec` (1.1), `useSetAccountPopoverRequested`, `useSetAuthOverlay` (`settingsStore.ts:821-828`).
- Produces: `runNoticeAction(spec)` inside MainPanel — Task 2.4 reuses it for the status line.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/MainPanel/MainPanel.test.tsx`, next to its notice tests (it renders `<MainPanel />` over a fake session; reuse its `render` and the `t` that returns keys):

```tsx
import { usePanelNotesStore } from '../../stores/panelNotesStore';

describe('panel notes (spec 2026-10-05 §5)', () => {
  beforeEach(() => { usePanelNotesStore.setState({ notes: [] }); });

  it('draws a note after the conversation as a system row with its own action', () => {
    const invoke = vi.fn();
    (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
    usePanelNotesStore.getState().add({ severity: 'info', code: 'autosave_saved', message: 'saved', params: { filename: 'a.txt' }, action: { kind: 'show-in-folder', dir: '/d' } });
    const { container } = render(<MainPanel />);
    const row = container.querySelector('.sys-row--info');
    expect(row).not.toBeNull();
    fireEvent.click(row!.querySelector('.sys-row__action')!);
    expect(invoke).toHaveBeenCalledWith('open-directory', '/d');
  });

  it('Clear removes the notes with the conversation', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient' });
    const { container } = render(<MainPanel />);
    expect(container.querySelector('.sys-row--info')).not.toBeNull();
    fireEvent.click(container.querySelector('.clear-conversation-btn')!);
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});
```

(If the file's environment mock makes `isElectron()` false, set it true for the first case the way the file's other Electron cases do.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/MainPanel/MainPanel.test.tsx`
Expected: the two new cases FAIL (`.sys-row--info` is null).

- [ ] **Step 3: Write minimal implementation**

In `src/components/MainPanel/MainPanel.tsx`:

Imports — replace `import { settingsTargetForCode } from '../../lib/view/noticeTargets';` with:

```tsx
import { actionForCode, actionLabel, type NoticeActionSpec } from '../../lib/view/noticeActions';
import { isPanelNoteId, PANEL_NOTE_ID_PREFIX, panelNoteEntries } from '../../lib/view/panelNotes';
import { usePanelNotes, usePanelNotesStore } from '../../stores/panelNotesStore';
```

delete `import { LOOPBACK_DENIED } from '../../lib/audio/capture/systemAudio';` (no longer read here), add `useSetAccountPopoverRequested, useSetAuthOverlay` to the `settingsStore` import, and `isElectron` to the `utils/environment` import.

Hooks (after `const navigateToSettings = useNavigateToSettings();`):

```tsx
  const setAccountPopoverRequested = useSetAccountPopoverRequested();
  const setAuthOverlay = useSetAuthOverlay();
  const notes = usePanelNotes();
```

The conversation (lines 169-177): feed the merged entries to `useVisibleEntries`:

```tsx
  // The conversation, then the panel notes after it (spec 2026-10-05 §5), through the display filter,
  // reusing unchanged lines (ruling 14). A transient notice or note leaves the panel once its time is up.
  const entries = useMemo(() => (notes.length === 0 ? viewState.entries : [...viewState.entries, ...panelNoteEntries(notes)]), [viewState.entries, notes]);
  const shown = useVisibleEntries(entries);
```

Actions (replace lines 197-209, the `noticeAction` callback):

```tsx
  // One table of actions (spec 2026-10-05 §6); the panel owns the handlers.
  const runNoticeAction = useCallback((spec: NoticeActionSpec) => {
    switch (spec.kind) {
      case 'settings': navigateToSettings(spec.target); return;
      case 'top-up': setAccountPopoverRequested(true); return;
      case 'sign-in': setAuthOverlay('sign-in'); return;
      case 'system-settings': openWarning(spec.pane === 'screen-recording' ? 'screen-recording-denied' : 'audio-capture-denied'); return;
      case 'show-in-folder': if (isElectron()) void window.electron.invoke('open-directory', spec.dir); return;
    }
  }, [navigateToSettings, setAccountPopoverRequested, setAuthOverlay, openWarning]);
  // A panel note carries its own action; an L1 notice's follows its code. `t` is not stable — a
  // language bundle arriving swaps it — and ConversationList's per-notice cache keys off this
  // callback's identity, so it rebuilds then rather than serving stale text (ruling 14).
  const noticeAction = useCallback((notice: NoticeEntry): NoticeAction | null => {
    const spec = isPanelNoteId(notice.id)
      ? notes.find((n) => `${PANEL_NOTE_ID_PREFIX}${n.id}` === notice.id)?.action ?? null
      : actionForCode(notice.code);
    if (!spec) return null;
    const { key, fallback } = actionLabel(spec);
    return { label: t(key, fallback), run: () => runNoticeAction(spec) };
  }, [t, notes, runNoticeAction]);
```

`hasConversation` (line 247): `const hasConversation = viewState.entries.length > 0 || lastEnd !== null || notes.length > 0;`

`onClear` (249-252): add `usePanelNotesStore.getState().clear();` after `runner.clear();`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/MainPanel && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors (an unused `LOOPBACK_DENIED` import would be one).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.test.tsx
git commit -m "feat(panel): draw the panel notes after the conversation; actions through one table (#481)"
```

### Task 1.7: Part 1 render check and the PR

- [ ] **Step 1:** `npx vitest run` (whole suite) and `npx tsc --noEmit -p tsconfig.json` — both clean.
- [ ] **Step 2:** Render the panel at 450px and 300px in `en` and `zh_CN` with: an error row (`budget_exhausted`), a warning with an action (`voice_fallback`), an info row, the two auto-save notes and the copy note; compare with sections 1 and 4 (T1, T2) of the approved page. Fix only what differs from it.
- [ ] **Step 3:** Ask jiangzhuo for the go, then push `worktree-notices-unified-spec` to `kizuna-ai-lab/sokuji` and open the PR titled `feat(notices): event rows and panel notes (#481, 1/4)`. Do not merge.

---

# Part 2 — state: the status line (PR 2)

### Task 2.1: `echoWords.ts` and the `statusLine` selector

**Files:**
- Create: `src/lib/view/echoWords.ts` (the table now at `src/components/EchoNotice/EchoNotice.tsx:20-51`, moved)
- Create: `src/lib/view/statusLine.ts`, `src/lib/view/statusLine.test.ts`

**Interfaces:**
- Consumes: `RunState`, `RunEnd` (`src/lib/session/types.ts`), `SubtitleIdleModel` (`src/lib/subtitle/session.ts`), `EchoCause`, `EchoNoticeState` (`src/lib/modern-audio/EchoMonitor.ts`), `NO_MICROPHONE`, `BALANCE_BELOW_FLOOR`, `QUOTA_PENDING`, `QUOTA_UNKNOWN` (`src/lib/session/shape.ts`), `actionForCode` (Task 1.1).
- Produces: `ECHO_WORDS`, `StatusIcon`, `StatusWords`, `StatusEntry`, `StatusLineInput`, `statusLine(input)` — used by Tasks 2.2, 2.4, 2.5.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/view/statusLine.test.ts
import { describe, expect, it } from 'vitest';
import type { EchoNoticeState } from '../modern-audio/EchoMonitor';
import type { RunEnd, RunState } from '../session/types';
import { statusLine, type StatusLineInput } from './statusLine';

const idleRun: RunState = { phase: 'idle' };
const running = (legs: Partial<Record<'speaker' | 'participant', 'opening' | 'live' | 'reconnecting'>> = { speaker: 'live' }): RunState =>
  ({ phase: 'running', since: 0, legs });
const echo: EchoNoticeState = { cause: 'tts-echo', lagMs: 120, rho: 0.7 } as EchoNoticeState;
const input = (over: Partial<StatusLineInput> = {}): StatusLineInput => ({
  run: idleRun, idle: { kind: 'ready' }, canStart: true, dismissedEnd: null,
  waitingForMicrophone: false, subtitleEntryHint: false, echo: null, ...over,
});

describe('statusLine — cannot start (priority 1)', () => {
  it('words the gate’s refusal with its code and the fix (spec §3)', () => {
    const entry = statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'No microphone is chosen for the speaker leg.', code: 'no_microphone' } }));
    expect(entry).toMatchObject({ key: 'unready:no_microphone', icon: 'mic-off', words: { kind: 'notice', code: 'no_microphone' }, action: { kind: 'settings', target: 'microphone' }, dismiss: null });
  });
  it('picks the icon by the code: credentials → key, balance → wallet, anything else → alert', () => {
    const unready = (code: string, params?: Record<string, string>) => statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'm', code, params } }));
    expect(unready('credentials_missing')?.icon).toBe('key-round');
    expect(unready('sign_in_required')?.icon).toBe('key-round');
    expect(unready('balance_below_floor', { balance: '$0.01' })).toMatchObject({ icon: 'wallet', action: { kind: 'top-up' } });
    expect(unready('quota_pending')?.icon).toBe('wallet');
    expect(unready('not_ready')).toMatchObject({ icon: 'circle-alert', action: null });
  });
  it('an uncoded readiness reason keeps its message and offers nothing', () => {
    expect(statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'HTTP 500' } }))).toMatchObject({ words: { kind: 'notice', code: '', message: 'HTTP 500' }, action: null });
  });
  it('after a start the gate refused or that failed, says why until the next start', () => {
    const lastEnd: RunEnd = { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'denied', leg: 'participant' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd } }))).toMatchObject({ key: 'last-end:loopback_denied', action: { kind: 'system-settings', pane: 'screen-recording' } });
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'credentials_missing', message: 'm' } } } }))).toMatchObject({ key: 'last-end:credentials_missing', icon: 'key-round' });
  });
  // Review Focus 1: a run the lease ended is an event row, never a line.
  it('says nothing for a run that ended on its own, by the user or by the lease', () => {
    for (const lastEnd of [
      { reason: 'user' }, { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'm' } },
      { reason: 'lease-ended', notice: { code: 'budget_exhausted', message: 'm' } }, { reason: 'source-ended', notice: { code: 'source_ended', message: 'm' } },
    ] as RunEnd[]) {
      expect(statusLine(input({ run: { phase: 'idle', lastEnd } })), lastEnd.reason).toBeNull();
    }
  });
  // Review Focus 2: Clear hides this end; the next end, even with the same code, shows.
  it('Clear hides the last end by identity, not by code', () => {
    const first: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket' } };
    const second: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: first }, dismissedEnd: first }))).toBeNull();
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: second }, dismissedEnd: first }))).not.toBeNull();
  });
  it('a live gate refusal outranks the last end', () => {
    const lastEnd: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'm' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd }, canStart: false, idle: { kind: 'unready', message: 'm', code: 'no_microphone' } }))?.key).toBe('unready:no_microphone');
  });
  it('is quiet while starting', () => {
    expect(statusLine(input({ run: { phase: 'starting', step: 'checking' }, idle: { kind: 'starting' }, canStart: false }))).toBeNull();
  });
});

describe('statusLine — while running (priorities 2–5)', () => {
  it('reconnecting, with no action', () => {
    expect(statusLine(input({ run: running({ speaker: 'reconnecting' }), echo }))).toMatchObject({ key: 'reconnecting', icon: 'refresh-cw', words: { kind: 'key', key: 'connectionStatus.reconnecting' }, action: null, dismiss: null });
  });
  it('waiting for a microphone, below reconnecting', () => {
    expect(statusLine(input({ run: running(), waitingForMicrophone: true }))).toMatchObject({ key: 'mic-waiting', icon: 'mic-off', words: { kind: 'notice', code: 'mic_lost_waiting' } });
    expect(statusLine(input({ run: running({ speaker: 'reconnecting' }), waitingForMicrophone: true }))?.key).toBe('reconnecting');
  });
  it('the subtitle layer’s hint, dismissible, above echo (the user just pressed the button)', () => {
    expect(statusLine(input({ run: running(), subtitleEntryHint: true, echo }))).toMatchObject({ key: 'subtitle-entry', icon: 'captions', words: { kind: 'key', key: 'subtitle.enterButton.refreshPageHint' }, dismiss: 'subtitle-entry' });
  });
  it('echo last, dismissible, with its cause', () => {
    expect(statusLine(input({ run: running(), echo }))).toMatchObject({ key: 'echo:tts-echo', icon: 'triangle-alert', words: { kind: 'echo', cause: 'tts-echo' }, dismiss: 'echo' });
  });
  // Review Focus 3: the dismissal lives on the echo source (`useEchoNotice`), so a dismissed
  // echo arrives here as null and stays hidden once the reconnect clears.
  it('nothing when every condition has cleared', () => {
    expect(statusLine(input({ run: running() }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/view/statusLine.test.ts`
Expected: FAIL — `Failed to resolve import "./statusLine"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/view/echoWords.ts
import type { EchoCause } from '../modern-audio/EchoMonitor';

/** The echo causes' words: the problem and what fixes it (moved from EchoNotice.tsx; spec 2026-10-05 §3). */
export const ECHO_WORDS: Readonly<Record<EchoCause, { message: string; fallback: string; action: string; actionFallback: string }>> = {
  'tts-echo': {
    message: 'echoNotice.ttsEcho',
    fallback: "Your speakers are feeding Sokuji's translated speech back into the microphone.",
    action: 'echoNotice.actionHeadphones',
    actionFallback: 'Using headphones will break the loop.',
  },
  'meeting-echo': {
    message: 'echoNotice.meetingEcho',
    fallback: 'Meeting audio from your speakers is reaching the microphone.',
    action: 'echoNotice.actionHeadphones',
    actionFallback: 'Using headphones will break the loop.',
  },
  'far-end-echo': {
    message: 'echoNotice.farEndEcho',
    fallback: "A participant's device is echoing your translation back into the meeting.",
    action: 'echoNotice.actionAskRemote',
    actionFallback: 'Ask that participant to use headphones.',
  },
  'self-capture': {
    message: 'echoNotice.selfCapture',
    fallback: "The participant source is capturing Sokuji's own audio.",
    action: 'echoNotice.actionPickApp',
    actionFallback: 'Pick the meeting application as the participant source instead of system audio.',
  },
  'routing-loop': {
    message: 'echoNotice.routingLoop',
    fallback: "The selected input device is capturing this computer's playback directly.",
    action: 'echoNotice.actionChangeInput',
    actionFallback: 'Pick a physical microphone as the input device.',
  },
};
```

```ts
// src/lib/view/statusLine.ts
/**
 * The status line (spec 2026-10-05 §3): why the user cannot start, or what is
 * wrong right now. Not a record — the condition's presence is the line's. One
 * line at a time, the highest of: cannot start › reconnecting › waiting for a
 * microphone › the subtitle layer unavailable › echo. Pure: the inputs come
 * from `useStatusLine`, so this is testable without React.
 */
import type { EchoCause, EchoNoticeState } from '../modern-audio/EchoMonitor';
import { BALANCE_BELOW_FLOOR, NO_MICROPHONE, QUOTA_PENDING, QUOTA_UNKNOWN } from '../session/shape';
import type { RunEnd, RunState } from '../session/types';
import type { SubtitleIdleModel } from '../subtitle/session';
import { actionForCode, type NoticeActionSpec } from './noticeActions';

export type StatusIcon = 'mic-off' | 'key-round' | 'wallet' | 'refresh-cw' | 'triangle-alert' | 'captions' | 'circle-alert';

export type StatusWords =
  /** Worded by `noticeText` (a notice code, or the diagnostic message for an uncoded one). */
  | { kind: 'notice'; code: string; params?: Record<string, string | number>; message: string }
  /** One catalog key. */
  | { kind: 'key'; key: string; fallback: string }
  /** An echo cause: its message and its advice, from `ECHO_WORDS`. */
  | { kind: 'echo'; cause: EchoCause };

export interface StatusEntry {
  /** Stable per condition: the same line across renders, another line when the condition changes. */
  key: string;
  icon: StatusIcon;
  words: StatusWords;
  action: NoticeActionSpec | null;
  /** What a dismiss means, when the line offers one. */
  dismiss: 'echo' | 'subtitle-entry' | null;
}

export interface StatusLineInput {
  run: RunState;
  /** The subtitle session's idle model (`idleOf`), the gate both surfaces read. */
  idle: SubtitleIdleModel;
  canStart: boolean;
  /** The end Clear hid (MainPanel's `dismissedEnd`): compared by identity, so a later end draws again. */
  dismissedEnd: RunEnd | null;
  /** Running with a speaker leg and no usable input selected (`audioStore.selectedInputDevice === null`). */
  waitingForMicrophone: boolean;
  /** The extension's content script was missing on the last attempt to enter subtitle mode (`subtitleStore.entryHint`). */
  subtitleEntryHint: boolean;
  /** `useEchoNotice`'s visible notice: already null while its cause is dismissed. */
  echo: EchoNoticeState | null;
}

const KEY_CODES: ReadonlySet<string> = new Set(['credentials_missing', 'sign_in_required', 'sign_in_pending', 'auth']);
const WALLET_CODES: ReadonlySet<string> = new Set([BALANCE_BELOW_FLOOR, 'insufficient_balance', QUOTA_PENDING, QUOTA_UNKNOWN, 'wallet_frozen']);

function iconFor(code: string | undefined): StatusIcon {
  if (code === NO_MICROPHONE) return 'mic-off';
  if (code !== undefined && KEY_CODES.has(code)) return 'key-round';
  if (code !== undefined && WALLET_CODES.has(code)) return 'wallet';
  return 'circle-alert';
}

function blocker(key: string, code: string | undefined, message: string, params?: Record<string, string | number>): StatusEntry {
  return {
    key,
    icon: iconFor(code),
    words: { kind: 'notice', code: code ?? '', message, ...(params ? { params } : {}) },
    action: actionForCode(code),
    dismiss: null,
  };
}

export function statusLine(input: StatusLineInput): StatusEntry | null {
  const { run, idle, canStart, dismissedEnd, waitingForMicrophone, subtitleEntryHint, echo } = input;
  if (run.phase === 'idle') {
    // 1a. The live gate: what the stores refuse now (a stale failure never outranks it).
    if (!canStart && idle.kind === 'unready') return blocker(`unready:${idle.code ?? 'message'}`, idle.code, idle.message, idle.params);
    // 1b. The last start, refused or failed, until the next start or Clear. A run that
    // ended on its own already carries its notice on a leg (spec §2); this is not it.
    const end = run.lastEnd;
    if (end && (end.reason === 'refused' || end.reason === 'start-failed') && end.notice && end !== dismissedEnd) {
      return blocker(`last-end:${end.notice.code}`, end.notice.code, end.notice.message, end.notice.params);
    }
  }
  if (run.phase === 'running') {
    // 2. Reconnecting: the footer's dot pulses; the line carries the words in both modes.
    if (Object.values(run.legs).includes('reconnecting')) {
      return { key: 'reconnecting', icon: 'refresh-cw', words: { kind: 'key', key: 'connectionStatus.reconnecting', fallback: 'Reconnecting...' }, action: null, dismiss: null };
    }
    // 3. Waiting for a microphone (#596): the moment it went away was an event row; this is the wait.
    if (waitingForMicrophone) {
      return { key: 'mic-waiting', icon: 'mic-off', words: { kind: 'notice', code: 'mic_lost_waiting', message: 'The microphone went away; waiting for one to be connected.' }, action: null, dismiss: null };
    }
  }
  // 4. The subtitle layer could not be entered (the extension): the user just pressed the button, so this outranks the ambient echo.
  if (subtitleEntryHint) {
    return { key: 'subtitle-entry', icon: 'captions', words: { kind: 'key', key: 'subtitle.enterButton.refreshPageHint', fallback: 'Refresh the meeting tab and try again' }, action: null, dismiss: 'subtitle-entry' };
  }
  // 5. Echo: per-cause dismissal and the all-clear reset stay on `useEchoNotice`.
  if (echo) return { key: `echo:${echo.cause}`, icon: 'triangle-alert', words: { kind: 'echo', cause: echo.cause }, action: null, dismiss: 'echo' };
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/view/statusLine.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/view/echoWords.ts src/lib/view/statusLine.ts src/lib/view/statusLine.test.ts
git commit -m "feat(view): the status line's selector — one current state, by priority (#481)"
```

### Task 2.2: The `StatusLine` component and its styles

**Files:**
- Create: `src/components/MainPanel/StatusLine.tsx`, `src/components/MainPanel/StatusLine.test.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss` (add the `.status-line` block just before `.control-footer {`, line 326)

**Interfaces:**
- Consumes: `StatusEntry`, `StatusWords` (2.1), `ECHO_WORDS` (2.1), `actionLabel`, `NoticeActionSpec` (1.1), `noticeText`.
- Produces: `StatusLine({ entry, onAction, onDismiss })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/MainPanel/StatusLine.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine';
import type { StatusEntry } from '../../lib/view/statusLine';

// t returns the key, so every assertion is against the key the component asks for.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);

const entry = (over: Partial<StatusEntry> = {}): StatusEntry => ({
  key: 'unready:no_microphone', icon: 'mic-off',
  words: { kind: 'notice', code: 'no_microphone', message: 'No microphone is chosen for the speaker leg.' },
  action: { kind: 'settings', target: 'microphone' }, dismiss: null, ...over,
});

describe('StatusLine', () => {
  it('draws the words by their notice code, with the action’s label', () => {
    const onAction = vi.fn();
    const { container } = render(<StatusLine entry={entry()} onAction={onAction} onDismiss={vi.fn()} />);
    expect(container.querySelector('.status-line')).not.toBeNull();
    expect(container.querySelector('.status-line__text')?.textContent).toBe('notices.no_microphone');
    const button = container.querySelector('.status-line__action') as HTMLButtonElement;
    expect(button.textContent).toBe('settings.title');
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith({ kind: 'settings', target: 'microphone' });
    expect(container.querySelector('.status-line__dismiss')).toBeNull();
  });

  it('draws a key, and an echo cause as its message and advice', () => {
    const a = render(<StatusLine entry={entry({ words: { kind: 'key', key: 'connectionStatus.reconnecting', fallback: 'Reconnecting...' }, action: null })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(a.container.querySelector('.status-line__text')?.textContent).toBe('connectionStatus.reconnecting');
    const b = render(<StatusLine entry={entry({ words: { kind: 'echo', cause: 'tts-echo' }, action: null, dismiss: 'echo' })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(b.container.querySelector('.status-line__text')?.textContent).toBe('echoNotice.ttsEcho echoNotice.actionHeadphones');
  });

  it('offers a dismiss, labelled by common.dismiss, that reports what it dismisses', () => {
    const onDismiss = vi.fn();
    const { container } = render(<StatusLine entry={entry({ words: { kind: 'echo', cause: 'tts-echo' }, action: null, dismiss: 'echo' })} onAction={vi.fn()} onDismiss={onDismiss} />);
    const button = container.querySelector('.status-line__dismiss') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('common.dismiss');
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledWith('echo');
  });

  it('never has an action and a dismiss at once', () => {
    const { container } = render(<StatusLine entry={entry({ dismiss: 'echo' })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.querySelectorAll('.status-line__action, .status-line__dismiss')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MainPanel/StatusLine.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/MainPanel/StatusLine.tsx
import { useTranslation } from 'react-i18next';
import { Captions, CircleAlert, KeyRound, MicOff, RefreshCw, TriangleAlert, Wallet, X } from 'lucide-react';
import { actionLabel, type NoticeActionSpec } from '../../lib/view/noticeActions';
import { ECHO_WORDS } from '../../lib/view/echoWords';
import { noticeText } from '../../lib/view/noticeText';
import type { StatusEntry, StatusIcon, StatusWords } from '../../lib/view/statusLine';

const ICON: Record<StatusIcon, typeof MicOff> = {
  'mic-off': MicOff, 'key-round': KeyRound, wallet: Wallet, 'refresh-cw': RefreshCw,
  'triangle-alert': TriangleAlert, captions: Captions, 'circle-alert': CircleAlert,
};

export interface StatusLineProps {
  entry: StatusEntry;
  onAction(spec: NoticeActionSpec): void;
  onDismiss(what: 'echo' | 'subtitle-entry'): void;
}

/**
 * The one line above the control footer (spec 2026-10-05 §3, P1): why the
 * user cannot start, or what is wrong now, with the fix on the right. The
 * same in both modes; it wraps rather than truncates. A line has an action
 * or a dismiss, never both.
 */
export function StatusLine({ entry, onAction, onDismiss }: StatusLineProps) {
  const { t } = useTranslation();
  const Icon = ICON[entry.icon];
  const words = wordsOf(entry.words, t);
  const action = entry.action;
  const label = action ? actionLabel(action) : null;
  return (
    <div className="status-line" data-status={entry.key}>
      <Icon size={14} aria-hidden="true" />
      <span className="status-line__text">{words}</span>
      {action && label && (
        <button type="button" className="status-line__action" onClick={() => onAction(action)}>
          {t(label.key, label.fallback)}
        </button>
      )}
      {!action && entry.dismiss && (
        <button type="button" className="status-line__dismiss" aria-label={t('common.dismiss', 'Dismiss')} onClick={() => onDismiss(entry.dismiss!)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function wordsOf(words: StatusWords, t: ReturnType<typeof useTranslation>['t']): string {
  switch (words.kind) {
    case 'notice': return noticeText(t, { code: words.code || undefined, params: words.params, message: words.message });
    case 'key': return t(words.key, words.fallback);
    case 'echo': {
      const w = ECHO_WORDS[words.cause];
      return `${t(w.message, w.fallback)} ${t(w.action, w.actionFallback)}`;
    }
  }
}
```

(`noticeText` takes `code?: string`; an empty code is passed as `undefined` so it returns the message.)

Add to `src/components/MainPanel/MainPanel.scss`, immediately before the `.control-footer {` rule:

```scss
// ─── Status line (spec 2026-10-05 §3, P1) ──────────
// Why the user cannot start, or what is wrong now: one line above the footer,
// the text-input row's colours, the same in both modes. It wraps.

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #252525;
  border-top: 1px solid #333;
  font-size: 12px;
  line-height: 1.4;
  color: #e8e8e8;
  flex-shrink: 0;

  > svg { flex-shrink: 0; color: tk.$color-degraded; }

  &__text { flex: 1; min-width: 0; }

  &__action {
    flex-shrink: 0;
    font: inherit;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    &:hover { background: rgba(255, 255, 255, 0.18); }
    &:focus-visible { @include vars.focus-ring; }
  }

  &__dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #aaa;
    padding: 1px;
    margin: 0 -2px 0 0;
    display: inline-flex;
    cursor: pointer;
    &:hover { color: #fff; }
    &:focus-visible { @include vars.focus-ring; }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/MainPanel/StatusLine.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/StatusLine.tsx src/components/MainPanel/StatusLine.test.tsx src/components/MainPanel/MainPanel.scss
git commit -m "feat(panel): the status line component (#481)"
```

### Task 2.3: The subtitle layer's hint becomes a state, not a toast

**Files:**
- Modify: `src/stores/subtitleStore.ts:38-54` (state type), `:72-85` (`DEFAULTS`), the store body (an action), `:221-270` (hooks)
- Modify: `src/components/Subtitle/SubtitleEnterButton.tsx:11, 21, 48-58`
- Test: `src/stores/subtitleStore.test.ts`, `src/components/Subtitle/SubtitleEnterButton.test.tsx`, `src/components/Subtitle/SubtitleEnterButton.integration.test.tsx`

**Interfaces:**
- Produces: `SubtitleState.entryHint: 'refresh' | null`, `setEntryHint(hint)`, `useSubtitleEntryHint()`, `useSetSubtitleEntryHint()` — read by Task 2.4's hook.

- [ ] **Step 1: Write the failing tests**

In `src/stores/subtitleStore.test.ts`, add `entryHint: null,` to the `beforeEach` `setState` and:

```ts
  it('entryHint is in-memory only: set, cleared, never persisted', async () => {
    expect(useSubtitleStore.getState().entryHint).toBeNull();
    useSubtitleStore.getState().setEntryHint('refresh');
    expect(useSubtitleStore.getState().entryHint).toBe('refresh');
    useSubtitleStore.getState().setEntryHint(null);
    expect(useSubtitleStore.getState().entryHint).toBeNull();
  });
```

In `src/components/Subtitle/SubtitleEnterButton.test.tsx`, find the case that asserts `showToast` on `CONTENT_SCRIPT_UNAVAILABLE` (grep `showToast`), and replace its assertion with:

```tsx
    await waitFor(() => expect(useSubtitleStore.getState().entryHint).toBe('refresh'));
```

and add a case: a successful `enterSubtitleMode` resolves and `entryHint` is `null` afterwards (set it to `'refresh'` before the click). The button now imports `subtitleStore`, which imports `ServiceFactory`: add the same `vi.mock('../../services/ServiceFactory', …)` block `subtitleStore.test.ts:5-12` uses if the test fails to load.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/subtitleStore.test.ts src/components/Subtitle/SubtitleEnterButton.test.tsx`
Expected: FAIL — `setEntryHint is not a function`; `entryHint` undefined.

- [ ] **Step 3: Write minimal implementation**

`src/stores/subtitleStore.ts`:
- in `SubtitleState`, after `participantDisplayMode: DisplayMode;`:

```ts
  /** The extension's content script was missing on the last attempt to enter subtitle mode (spec 2026-10-05 §3, priority 4). In memory only; cleared by the next successful entry or by the user. */
  entryHint: 'refresh' | null;
```

  and among the actions: `setEntryHint: (hint: 'refresh' | null) => void;`
- in `DEFAULTS`: `entryHint: null as 'refresh' | null,`
- in the store body, after `setParticipantDisplayMode`: `setEntryHint: (hint) => set({ entryHint: hint }),` (no `persist`, and `hydrate` does not read it).
- hooks: `export const useSubtitleEntryHint = () => useSubtitleStore((s) => s.entryHint);` and `export const useSetSubtitleEntryHint = () => useSubtitleStore((s) => s.setEntryHint);`

`src/components/Subtitle/SubtitleEnterButton.tsx`:
- line 11: `import { useToast } from '../Toast';` → `import { useSetSubtitleEntryHint } from '../../stores/subtitleStore';`
- line 21: `const { showToast } = useToast();` → `const setEntryHint = useSetSubtitleEntryHint();`
- `handleEnter`:

```tsx
  const handleEnter = async () => {
    try {
      await enterSubtitleMode();
      setEntryHint(null);
    } catch (err) {
      // Most common case (extension): the meeting tab was open before the
      // extension was reloaded, so the new content script was never
      // injected and chrome.tabs.sendMessage has no receiver. The hint is a
      // state the status line shows until the next entry or a dismiss (spec
      // 2026-10-05 §3), not a toast that is gone in five seconds.
      const code = (err as { code?: string } | null)?.code;
      if (code === CONTENT_SCRIPT_UNAVAILABLE) setEntryHint('refresh');
    }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/subtitleStore.test.ts src/components/Subtitle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/subtitleStore.ts src/stores/subtitleStore.test.ts src/components/Subtitle/SubtitleEnterButton.tsx src/components/Subtitle/SubtitleEnterButton.test.tsx src/components/Subtitle/SubtitleEnterButton.integration.test.tsx
git commit -m "feat(subtitle): the refresh hint is a state the status line shows (#481)"
```

### Task 2.4: MainPanel draws the line; the tooltip, the "last end" bubble, the reconnecting label and `EchoNotice` go

**Files:**
- Create: `src/components/MainPanel/useStatusLine.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports; lines 178-186 `dismissedEnd`/`lastEnd`/`items`; 214-219 `startBlockMessage`/`missingDevice`; 235-242 echo; 245-252 `hasConversation`/`onClear`; 255-266 footer props; 298-302 the mount)
- Modify: `src/components/MainPanel/panel/PanelFooter.tsx:43, 81, 113-117, 145, 220, 236-238`
- Modify: `src/components/MainPanel/MainPanel.scss` (`.reconnecting-label` 313-318 deleted; advanced `.status-dot` gains `&.reconnecting`; `.session-button:disabled` loses the `.tooltip` rules 501-536; the `@container` selector at 583 loses `:not(.tooltip)`)
- Modify: `src/components/dev/SpinePreview.tsx:17, 167` (the dev preview's idle line goes with `lastEndItem`)
- Delete: `src/lib/view/lastEnd.ts`, `src/lib/view/lastEnd.test.ts`, `src/components/EchoNotice/EchoNotice.tsx`, `src/components/EchoNotice/EchoNotice.scss`
- Rename: `src/components/EchoNotice/EchoNotice.test.tsx` → `src/components/EchoNotice/useEchoNotice.test.tsx`, keeping only the `useEchoNotice` cases
- Test: `src/components/MainPanel/panel/PanelFooter.test.tsx:27, 65-70, 180-182`, `src/components/MainPanel/MainPanel.test.tsx` (the last-end cases around lines 395-568)

**Interfaces:**
- Consumes: `statusLine`, `StatusEntry` (2.1), `StatusLine` (2.2), `useSubtitleEntryHint`, `useSetSubtitleEntryHint` (2.3), `useSelectedInputDevice` (`audioStore.ts:582`), `runNoticeAction` (1.6).
- Produces: `useStatusLine({ run, idle, canStart, dismissedEnd, echo }): StatusEntry | null` — Task 2.5 reuses it. `PanelFooterProps` loses `startBlockMessage`.

- [ ] **Step 1: Write the failing tests**

`src/components/MainPanel/panel/PanelFooter.test.tsx`: delete `startBlockMessage` from `baseProps` (line 27 area) and replace the case at 65-70 with:

```tsx
  it.each(SITES)('%s: canStart false disables Start and says nothing on the button — the status line says why', (site) => {
    const { container } = render(<PanelFooter {...baseProps(site, { canStart: false })} />);
    const button = container.querySelector('[data-tour="main-action"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBeNull();
    expect(container.querySelector('.tooltip')).toBeNull();
  });

  it.each(SITES)('%s: a reconnecting leg marks the dot; no label in the footer', (site) => {
    const { container } = render(<PanelFooter {...baseProps(site, { run: { phase: 'running', since: 0, legs: { speaker: 'reconnecting' } } })} />);
    expect(container.querySelector('.status-dot.reconnecting')).not.toBeNull();
    expect(container.querySelector('.reconnecting-label')).toBeNull();
  });
```

`src/components/MainPanel/MainPanel.test.tsx`: the cases that set the runner idle with a `lastEnd` (`no_microphone` at ~484/506, `loopback_denied` at ~434/451, `start_failed` at ~546/557) asserted a bubble; each now asserts the line. Pattern (the file's `t` returns keys):

```tsx
    // was: a notice row with the code's words; now: the status line
    const line = container.querySelector('.status-line');
    expect(line?.getAttribute('data-status')).toBe('last-end:loopback_denied');
    expect(line?.querySelector('.status-line__text')?.textContent).toBe('notices.loopback_denied');
    fireEvent.click(line!.querySelector('.status-line__action')!);   // label audioPanel.openSystemSettings
    // the modal opens, as the bubble's action did
```

and the Clear case (~497-506) asserts the line is gone after Clear and `.sys-row` for last ends never existed. Add two cases:

```tsx
  it('shows why Start is off as the status line, not as a tooltip (spec 2026-10-05 §3)', () => {
    // make the fake session's subtitle.idle `{ kind: 'unready', code: 'no_microphone', message: 'x' }` and canStart false, as the no_microphone case does
    const { container } = render(<MainPanel />);
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('unready:no_microphone');
    expect(container.querySelector('.main-action-btn')?.getAttribute('title')).toBeNull();
  });

  it('a transient mic event stays a row; the wait is the line', () => {
    // running, legs { speaker: 'live' }, audioStore.selectedInputDevice null
    const { container } = render(<MainPanel />);
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('mic-waiting');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/MainPanel/panel/PanelFooter.test.tsx src/components/MainPanel/MainPanel.test.tsx`
Expected: FAIL — the tooltip/title are still there; `.status-line` is null.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/MainPanel/useStatusLine.ts
import { useMemo } from 'react';
import type { EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';
import type { RunEnd, RunState } from '../../lib/session/types';
import type { SubtitleIdleModel } from '../../lib/subtitle/session';
import { statusLine, type StatusEntry } from '../../lib/view/statusLine';
import { useSelectedInputDevice } from '../../stores/audioStore';
import { useSubtitleEntryHint } from '../../stores/subtitleStore';

export interface UseStatusLineArgs {
  run: RunState;
  idle: SubtitleIdleModel;
  canStart: boolean;
  dismissedEnd: RunEnd | null;
  /** `useEchoNotice`'s visible notice; null where no echo is watched (the takeover window). */
  echo: EchoNoticeState | null;
}

/**
 * The status line's inputs from the stores (spec 2026-10-05 §3): the
 * selected input for the microphone wait, the subtitle store for the entry
 * hint; the run, the gate and the echo come from the caller. Shared by
 * MainPanel and the Electron takeover, so both draw the same line.
 */
export function useStatusLine({ run, idle, canStart, dismissedEnd, echo }: UseStatusLineArgs): StatusEntry | null {
  const selectedInput = useSelectedInputDevice();
  const entryHint = useSubtitleEntryHint();
  // No usable input is selected: `audioStore` clears the selection when none is left (#596).
  const waitingForMicrophone = run.phase === 'running' && run.legs.speaker !== undefined && selectedInput === null;
  return useMemo(
    () => statusLine({ run, idle, canStart, dismissedEnd, waitingForMicrophone, subtitleEntryHint: entryHint === 'refresh', echo }),
    [run, idle, canStart, dismissedEnd, waitingForMicrophone, entryHint, echo],
  );
}
```

`src/components/MainPanel/MainPanel.tsx`:
- imports: delete `import { lastEndItem } from '../../lib/view/lastEnd';`, `import { noticeText } from '../../lib/view/noticeText';` (if nothing else in the file uses it), `import EchoNotice from '../EchoNotice/EchoNotice';`; keep `echoSource, useEchoNotice`; add `import { StatusLine } from './StatusLine';`, `import { useStatusLine } from './useStatusLine';`, and `useSetSubtitleEntryHint` from `../../stores/subtitleStore`.
- lines 178-186: keep `dismissedEnd` (it now hides the line); delete `lastEnd` and make `const items = drawn;` (or use `drawn` directly in the JSX).
- lines 214-219: delete `startBlockMessage`; keep `const idle = subtitle.idle;` and `missingDevice`.
- after the `useEchoNotice` call (235-242), add:

```tsx
  const setEntryHint = useSetSubtitleEntryHint();
  const status = useStatusLine({ run, idle, canStart: subtitle.canStart, dismissedEnd, echo });
  const onDismissStatus = useCallback((what: 'echo' | 'subtitle-entry') => {
    if (what === 'echo') dismissEcho(); else setEntryHint(null);
  }, [dismissEcho, setEntryHint]);
```

- `hasConversation` (247): `const hasConversation = shown.length > 0 || (status?.key.startsWith('last-end:') ?? false);` — what the list draws (`shown`, the entries after the transient rule), so an expired transient note never leaves Clear on over an empty list (Ruling 6 during execution; the first draft counted `notes.length`). Clear still takes a failed start's line away, as it took the bubble.
- the footer (255-266): drop `startBlockMessage={startBlockMessage}`.
- the mount (298-302): replace `<EchoNotice state={echo} onDismiss={dismissEcho} />` with nothing, and insert between `{canSendText && <TypedText … />}` and `{footer(...)}`:

```tsx
        {status && <StatusLine entry={status} onAction={runNoticeAction} onDismiss={onDismissStatus} />}
```

`src/components/MainPanel/panel/PanelFooter.tsx`: delete the `startBlockMessage?: string;` prop (43) and its destructuring (81); delete the reconnecting label block (113-117); line 145: `title={isStarting ? t('mainPanel.clickToCancel', 'Click to cancel') : undefined}`; delete lines 236-238 (the `.tooltip` span). Update the component's doc comment: the reason Start is off is the status line's.

`src/components/MainPanel/MainPanel.scss`:
- delete the `.reconnecting-label { … }` rule (313-318);
- in `&.advanced .status-dot` (360-368) add, after `&.active { … }`: `&.reconnecting { background: tk.$color-degraded; animation: pulse 1s ease-in-out infinite; }`
- in `.session-button:disabled` (495-537): keep `background: #666; opacity: 0.6; cursor: not-allowed; box-shadow: none; &:hover { background: #666; }` and delete the `.tooltip { … }` block and the `.tooltip` line inside `&:hover`;
- line 583: `> span:not(.stop-icon):not(.play-icon):not(.status-dot):not(.tooltip)` → `> span:not(.stop-icon):not(.play-icon):not(.status-dot)`.

`src/components/dev/SpinePreview.tsx`: delete line 17; at line 167 the preview appended `lastEndItem(runState)` to its items — remove that append (read the ten lines around it first; the preview's list becomes the drawn items only).

Delete `src/lib/view/lastEnd.ts` and `src/lib/view/lastEnd.test.ts`; delete `src/components/EchoNotice/EchoNotice.tsx` and `EchoNotice.scss`; `git mv src/components/EchoNotice/EchoNotice.test.tsx src/components/EchoNotice/useEchoNotice.test.tsx` and delete its `EchoNotice` component cases (keep every `useEchoNotice` case; `src/components/MainPanel/panel/usePermissionWarning.test.tsx:4` keeps importing `echoSource` from the hook file, which stays).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/MainPanel src/components/EchoNotice src/components/dev && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `grep -rn "lastEndItem\|EchoNotice/EchoNotice\|startBlockMessage\|reconnecting-label\|className=\"tooltip\"" src` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/MainPanel src/components/EchoNotice src/components/dev/SpinePreview.tsx src/lib/view
git commit -m "feat(panel): one status line above the footer replaces the tooltip, the idle bubble, the reconnecting label and the echo chip (#481)"
```

### Task 2.5: The Electron takeover draws the same line

**Files:**
- Create: `src/components/Subtitle/TakeoverStatusLine.tsx`
- Modify: `src/components/Subtitle/SubtitleView.tsx:25-42` (props), `:137-164` (render), and the Electron host that renders `<SubtitleView surface="electron" …>` (`src/components/Subtitle/SubtitleTakeover.tsx` — read it first; it is the file `SubtitleTakeover.test.tsx` exercises)

**Interfaces:**
- Consumes: `useStatusLine` (2.4), `StatusLine` (2.2), `useRunState` (`src/app/useRun`), `getAppSession().subtitle` + `useReadable`, `useNavigateToSettings`, `useSetSubtitleEntryHint`.
- Produces: `SubtitleViewProps.statusLine?: ReactNode`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/Subtitle/SubtitleView.test.tsx` (or the nearest existing SubtitleView test; it mocks the stores it needs):

```tsx
  it('draws the host’s status line under the body while running, on the Electron surface only', () => {
    const line = <div data-testid="status-line-slot" />;
    const a = render(<SubtitleView {...viewProps({ surface: 'electron', running: true })} statusLine={line} />);
    expect(a.queryByTestId('status-line-slot')).not.toBeNull();
    const b = render(<SubtitleView {...viewProps({ surface: 'extension', running: true })} statusLine={line} />);
    expect(b.queryByTestId('status-line-slot')).toBeNull();
    const c = render(<SubtitleView {...viewProps({ surface: 'electron', running: false })} statusLine={line} />);
    expect(c.queryByTestId('status-line-slot')).toBeNull();
  });
```

(`viewProps` is whatever helper that file builds its `model`/`controls` with; `running` means `model.session.phase === 'running'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleView.test.tsx`
Expected: FAIL — the slot is never rendered.

- [ ] **Step 3: Write minimal implementation**

`src/components/Subtitle/SubtitleView.tsx`: add to its props `statusLine?: ReactNode;` (documented: "The Electron takeover's status line (spec 2026-10-05 §7); the overlay has none."), and in the render, directly after the `running ? (…SubtitleBody…) : (…SubtitleIdle…)` expression and before `{chrome.resizeHandles}`:

```tsx
      {running && surface === 'electron' && statusLine}
```

`SubtitleIdle` and `SubtitleView.idleState()` stay as they are: `idleOf` is the selector's own input and their words come from the same `noticeText`, so the idle window already says what the line says (spec §7).

```tsx
// src/components/Subtitle/TakeoverStatusLine.tsx
import { useCallback } from 'react';
import { getAppSession } from '../../app/session';
import { useRunState } from '../../app/useRun';
import type { NoticeActionSpec } from '../../lib/view/noticeActions';
import { useNavigateToSettings } from '../../stores/settingsStore';
import { useSetSubtitleEntryHint } from '../../stores/subtitleStore';
import { useReadable } from '../Conversation/useReadable';
import { StatusLine } from '../MainPanel/StatusLine';
import { useStatusLine } from '../MainPanel/useStatusLine';

/**
 * The status line in the Electron takeover (spec 2026-10-05 §7): the same
 * selector as MainPanel's, without the echo (the takeover watches no
 * capture). Of the actions, Settings is the one this window can honour; the
 * others belong to the title bar, which the takeover hides.
 */
export function TakeoverStatusLine() {
  const run = useRunState();
  const subtitle = useReadable(getAppSession().subtitle);
  const navigateToSettings = useNavigateToSettings();
  const setEntryHint = useSetSubtitleEntryHint();
  const entry = useStatusLine({ run, idle: subtitle.idle, canStart: subtitle.canStart, dismissedEnd: null, echo: null });
  const onAction = useCallback((spec: NoticeActionSpec) => {
    if (spec.kind === 'settings') navigateToSettings(spec.target);
  }, [navigateToSettings]);
  const onDismiss = useCallback(() => setEntryHint(null), [setEntryHint]);
  if (!entry) return null;
  return <StatusLine entry={entry} onAction={onAction} onDismiss={onDismiss} />;
}
```

In the Electron host (`SubtitleTakeover.tsx`), where `<SubtitleView surface="electron" …/>` is rendered, add the prop `statusLine={<TakeoverStatusLine />}` and the import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Subtitle && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleView.tsx src/components/Subtitle/SubtitleView.test.tsx src/components/Subtitle/TakeoverStatusLine.tsx src/components/Subtitle/SubtitleTakeover.tsx
git commit -m "feat(subtitle): the takeover window draws the status line (#481)"
```

### Task 2.6: Part 2 render check and the PR

- [ ] **Step 1:** `npx vitest run` and `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] **Step 2:** Render at 450px and 300px, `en` and `zh_CN`: basic and advanced idle with `credentials_missing`, `balance_below_floor` (Top up) and `no_microphone` (the amber ring stays); running with a reconnecting leg (advanced dot amber); the microphone wait; the echo line with its dismiss at 300px; compare with section 2 (S1–S3) of the approved page.
- [ ] **Step 3:** Ask jiangzhuo for the go, then push and open the PR `feat(notices): the status line (#481, 2/4)` on `kizuna-ai-lab/sokuji`, stacked on part 1's branch state. Do not merge.

---

# Part 3 — app: one Banner (PR 3)

### Task 3.1: The `Banner` component

**Files:**
- Create: `src/components/Banner/Banner.tsx`, `src/components/Banner/Banner.scss`, `src/components/Banner/Banner.test.tsx`

**Interfaces:**
- Produces: `BannerProps { id; tone: 'attention' | 'brand'; icon; text; action?; progress?; onDismiss?; dismissLabel }`, `Banner(props)` — used by Task 3.2.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Banner/Banner.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Banner } from './Banner';

afterEach(cleanup);

describe('Banner', () => {
  it('draws the tone as a class, the text, one action and a dismiss', () => {
    const onClick = vi.fn(); const onDismiss = vi.fn();
    const { container } = render(
      <Banner id="x" tone="attention" icon={<i data-testid="icon" />} text="body" action={{ label: 'Repair', onClick }} onDismiss={onDismiss} dismissLabel="Dismiss" />,
    );
    const root = container.querySelector('.banner');
    expect(root?.className).toBe('banner banner--attention');
    expect(root?.querySelector('.banner__text')?.textContent).toBe('body');
    fireEvent.click(root!.querySelector('.banner__btn')!);
    expect(onClick).toHaveBeenCalledTimes(1);
    const dismiss = root!.querySelector('.banner__dismiss') as HTMLButtonElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a busy action is disabled; no onDismiss means no dismiss button; progress draws a bar', () => {
    const { container } = render(
      <Banner id="x" tone="brand" icon={null} text="downloading" action={{ label: 'Wait', onClick: vi.fn(), busy: true }} progress={42} dismissLabel="Dismiss" />,
    );
    expect((container.querySelector('.banner__btn') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.banner__dismiss')).toBeNull();
    expect((container.querySelector('.banner__progress-fill') as HTMLElement).style.width).toBe('42%');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Banner/Banner.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/Banner/Banner.tsx
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import './Banner.scss';

export interface BannerProps {
  /** Stable per condition (`'audio-system'`, `'update'`). */
  id: string;
  /** `attention`: the user has to fix something (amber). `brand`: good news with an optional action (the brand green). */
  tone: 'attention' | 'brand';
  icon: ReactNode;
  text: ReactNode;
  action?: { label: string; icon?: ReactNode; onClick(): void; busy?: boolean };
  /** 0–100: a progress bar after the text. */
  progress?: number;
  onDismiss?(): void;
  dismissLabel: string;
}

/**
 * The one app-level banner (spec 2026-10-05 §4): an environment condition
 * unrelated to the session, drawn at the top of the panel. Today's
 * AudioSystemBanner geometry; the text is never a button — the action is.
 */
export function Banner({ tone, icon, text, action, progress, onDismiss, dismissLabel }: BannerProps) {
  return (
    <div className={`banner banner--${tone}`}>
      <div className="banner__content">
        {icon}
        <div className="banner__text">{text}</div>
        {progress !== undefined && (
          <div className="banner__progress"><div className="banner__progress-fill" style={{ width: `${progress}%` }} /></div>
        )}
      </div>
      <div className="banner__actions">
        {action && (
          <button type="button" className="banner__btn" onClick={action.onClick} disabled={action.busy}>
            {action.icon}{action.label}
          </button>
        )}
        {onDismiss && (
          <button type="button" className="banner__dismiss" onClick={onDismiss} aria-label={dismissLabel}><X size={12} /></button>
        )}
      </div>
    </div>
  );
}
```

```scss
// src/components/Banner/Banner.scss
@use '../../styles/tokens' as tk;

// The app-level banner (spec 2026-10-05 §4): AudioSystemBanner's geometry,
// two tones. `attention` wears the usage amber: it asks the user to act.
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;

  &--attention { background-color: tk.$color-usage; }
  &--brand { background-color: tk.$color-primary-fill; }

  &__content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    > svg { flex-shrink: 0; }
  }

  &__text {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  // A command the user copies (pactl-missing).
  &__code {
    font-family: monospace;
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 6px;
    border-radius: 3px;
    user-select: all;
  }

  &__progress {
    flex: 1;
    max-width: 200px;
    height: 4px;
    background-color: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    overflow: hidden;
    &-fill { height: 100%; background-color: #fff; border-radius: 2px; transition: width 0.3s ease; }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: #fff;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.25); }
    &:disabled { cursor: default; opacity: 0.7; }
  }

  &__dismiss {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    &:hover { color: #fff; }
  }

  .spinning { animation: banner-spin 1s linear infinite; }
}

@keyframes banner-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Banner/Banner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Banner
git commit -m "feat(banner): one banner component, two tones (#481)"
```

### Task 3.2: `useBanners` over the two stores; MainPanel mounts `Banners`; the old banners go

**Files:**
- Create: `src/components/Banner/useBanners.tsx`, `src/components/Banner/useBanners.test.tsx`
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports at 47, 56; the mount at 272-273)
- Delete: `src/components/UpdateBanner/UpdateBanner.tsx`, `UpdateBanner.scss`; `src/components/AudioSystemBanner/AudioSystemBanner.tsx`, `AudioSystemBanner.scss`, `AudioSystemBanner.test.tsx` (its four cases move into the new test)

**Interfaces:**
- Consumes: `Banner`, `BannerProps` (3.1); the `audioSystemStore` hooks (`:148-162`) and `updateStore` hooks (`:188-215`).
- Produces: `useBanners(): BannerProps[]`, `Banners()`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Banner/useBanners.test.tsx
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Banners } from './useBanners';
import useAudioSystemStore from '../../stores/audioSystemStore';
import useUpdateStore from '../../stores/updateStore';

// t(key) renders the key itself, so these assertions pin which keys the
// banners use, not their English copy.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

const unavailable = (reason: string, extra: Record<string, unknown> = {}) =>
  useAudioSystemStore.setState({
    status: 'unavailable', platform: reason === 'mac-driver-not-loaded' ? 'darwin' : 'linux',
    reason: reason as never, message: null, dismissed: false, retrying: false, repairing: false, repairFailed: false, ...extra,
  });
const update = (extra: Partial<ReturnType<typeof useUpdateStore.getState>>) =>
  useUpdateStore.setState({ status: 'idle', newVersion: '0.43.0', downloadProgress: 0, errorMessage: null, supportsAutoUpdate: true, bannerDismissed: false, ...extra });

beforeEach(() => {
  useAudioSystemStore.setState({ status: 'ok', dismissed: false, retry: vi.fn(async () => {}), repair: vi.fn(async () => {}) });
  update({ downloadUpdate: vi.fn(), installUpdate: vi.fn(), openDialog: vi.fn(), dismissBanner: vi.fn() });
});

describe('Banners — the audio system (today’s AudioSystemBanner cases)', () => {
  it('offers a repair, not a retry, for a macOS driver that was never loaded', () => {
    unavailable('mac-driver-not-loaded');
    render(<Banners />);
    expect(screen.getByText('audioSystem.macDriverNotLoadedBody')).toBeTruthy();
    expect(screen.queryByText('audioSystem.retry')).toBeNull();
    fireEvent.click(screen.getByText('audioSystem.repair'));
    expect(useAudioSystemStore.getState().repair).toHaveBeenCalledWith('audioSystem.macRepairPrompt');
  });
  it('says so when the repair did not bring the device back', () => {
    unavailable('mac-driver-not-loaded', { repairFailed: true });
    render(<Banners />);
    expect(screen.getByText('audioSystem.macRepairFailedBody')).toBeTruthy();
  });
  it('disables the button while the repair runs', () => {
    unavailable('mac-driver-not-loaded', { repairing: true });
    render(<Banners />);
    expect((screen.getByText('audioSystem.repairing').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the retry for the other reasons, and the command for a missing pactl', () => {
    unavailable('pulseaudio-unavailable');
    const { unmount } = render(<Banners />);
    fireEvent.click(screen.getByText('audioSystem.retry'));
    expect(useAudioSystemStore.getState().retry).toHaveBeenCalled();
    unmount();
    unavailable('pactl-missing');
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner__code')?.textContent).toBe('audioSystem.installCommand');
  });
  it('is attention-toned, dismissible, and gone once dismissed', () => {
    unavailable('pulseaudio-unavailable');
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner--attention')).not.toBeNull();
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(useAudioSystemStore.getState().dismissed).toBe(true);
  });
});

describe('Banners — the update (spec 2026-10-05 §4)', () => {
  it('available: brand tone, update.available, Download Now starts the download, dismissible', () => {
    update({ status: 'available' });
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner--brand')).not.toBeNull();
    expect(screen.getByText('update.available')).toBeTruthy();
    fireEvent.click(screen.getByText('update.downloadNow'));
    expect(useUpdateStore.getState().downloadUpdate).toHaveBeenCalled();
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(useUpdateStore.getState().dismissBanner).toHaveBeenCalled();
  });
  it('available without auto-update: the Linux title and Go to Download opens the dialog', () => {
    update({ status: 'available', supportsAutoUpdate: false });
    render(<Banners />);
    expect(screen.getByText('update.linuxMigrateTitle')).toBeTruthy();
    fireEvent.click(screen.getByText('update.goToDownload'));
    expect(useUpdateStore.getState().openDialog).toHaveBeenCalled();
  });
  it('downloading: progress, no action, no dismiss', () => {
    update({ status: 'downloading', downloadProgress: 37 });
    const { container } = render(<Banners />);
    expect(screen.getByText('update.downloading')).toBeTruthy();
    expect((container.querySelector('.banner__progress-fill') as HTMLElement).style.width).toBe('37%');
    expect(container.querySelector('.banner__btn')).toBeNull();
    expect(container.querySelector('.banner__dismiss')).toBeNull();
  });
  it('downloaded: Restart and Update installs', () => {
    update({ status: 'downloaded' });
    render(<Banners />);
    fireEvent.click(screen.getByText('update.restartNow'));
    expect(useUpdateStore.getState().installUpdate).toHaveBeenCalled();
  });
  it('a dismissed banner stays hidden except while downloading or downloaded', () => {
    update({ status: 'available', bannerDismissed: true });
    expect(render(<Banners />).container.querySelector('.banner')).toBeNull();
    cleanup();
    update({ status: 'downloaded', bannerDismissed: true });
    expect(render(<Banners />).container.querySelector('.banner')).not.toBeNull();
  });
  it('error, idle, checking and not-available draw nothing', () => {
    for (const status of ['error', 'idle', 'checking', 'not-available'] as const) {
      update({ status });
      expect(render(<Banners />).container.querySelector('.banner'), status).toBeNull();
      cleanup();
    }
  });
  it('attention sits above brand', () => {
    unavailable('pulseaudio-unavailable');
    update({ status: 'available' });
    const { container } = render(<Banners />);
    const tones = Array.from(container.querySelectorAll('.banner')).map((el) => el.className);
    expect(tones).toEqual(['banner banner--attention', 'banner banner--brand']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Banner/useBanners.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/Banner/useBanners.tsx
import { Download, RefreshCw, TriangleAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAudioSystemDismiss, useAudioSystemDismissed, useAudioSystemReason, useAudioSystemRepair, useAudioSystemRepairFailed,
  useAudioSystemRepairing, useAudioSystemRetry, useAudioSystemRetrying, useAudioSystemStatus,
} from '../../stores/audioSystemStore';
import {
  useDismissBanner, useDownloadUpdate, useInstallUpdate, useOpenUpdateDialog, useUpdateBannerDismissed,
  useUpdateNewVersion, useUpdateProgressPercent, useUpdateStatus, useUpdateSupportsAutoUpdate,
} from '../../stores/updateStore';
import { Banner, type BannerProps } from './Banner';

/**
 * The app-level banners to draw, in order (spec 2026-10-05 §4): the audio
 * system (attention) above the update (brand). An update check's failure is
 * not a banner any more; the Help link shows it.
 */
export function useBanners(): BannerProps[] {
  const { t } = useTranslation();
  const dismissLabel = t('common.dismiss', 'Dismiss');
  const banners: BannerProps[] = [];

  const audioStatus = useAudioSystemStatus();
  const reason = useAudioSystemReason();
  const audioDismissed = useAudioSystemDismissed();
  const retrying = useAudioSystemRetrying();
  const retry = useAudioSystemRetry();
  const repairing = useAudioSystemRepairing();
  const repairFailed = useAudioSystemRepairFailed();
  const repair = useAudioSystemRepair();
  const dismissAudio = useAudioSystemDismiss();
  if (audioStatus === 'unavailable' && !audioDismissed) {
    const pactlMissing = reason === 'pactl-missing';
    // macOS: the driver is installed but was never loaded; the fix is a re-sign behind macOS's administrator prompt, not another retry.
    const macDriver = reason === 'mac-driver-not-loaded';
    let body = t('audioSystem.unavailableBody');
    if (pactlMissing) body = t('audioSystem.pactlMissingBody');
    if (macDriver) body = repairFailed ? t('audioSystem.macRepairFailedBody') : t('audioSystem.macDriverNotLoadedBody');
    banners.push({
      id: 'audio-system',
      tone: 'attention',
      icon: <TriangleAlert size={14} />,
      text: <><span>{body}</span>{pactlMissing && <code className="banner__code">{t('audioSystem.installCommand')}</code>}</>,
      action: macDriver
        ? { label: repairing ? t('audioSystem.repairing') : t('audioSystem.repair'), icon: <Wrench size={12} className={repairing ? 'spinning' : ''} />, onClick: () => { void repair(t('audioSystem.macRepairPrompt')); }, busy: repairing }
        : { label: retrying ? t('audioSystem.retrying') : t('audioSystem.retry'), icon: <RefreshCw size={12} className={retrying ? 'spinning' : ''} />, onClick: () => { void retry(); }, busy: retrying },
      onDismiss: dismissAudio,
      dismissLabel,
    });
  }

  const status = useUpdateStatus();
  const newVersion = useUpdateNewVersion();
  const percent = useUpdateProgressPercent();
  const bannerDismissed = useUpdateBannerDismissed();
  const supportsAutoUpdate = useUpdateSupportsAutoUpdate();
  const dismissBanner = useDismissBanner();
  const openDialog = useOpenUpdateDialog();
  const downloadUpdate = useDownloadUpdate();
  const installUpdate = useInstallUpdate();
  const shown = !(bannerDismissed && status !== 'downloading' && status !== 'downloaded');
  if (shown && status === 'available') {
    banners.push({
      id: 'update', tone: 'brand', icon: <Download size={14} />,
      text: supportsAutoUpdate ? t('update.available', { version: newVersion }) : t('update.linuxMigrateTitle', { version: newVersion }),
      // Auto-update builds download here; the others open the dialog, which holds the AppImage/deb links.
      action: supportsAutoUpdate ? { label: t('update.downloadNow'), onClick: downloadUpdate } : { label: t('update.goToDownload'), onClick: openDialog },
      onDismiss: dismissBanner, dismissLabel,
    });
  } else if (shown && status === 'downloading') {
    banners.push({
      id: 'update', tone: 'brand', icon: <RefreshCw size={14} className="spinning" />,
      text: t('update.downloading', { percent: Math.round(percent) }), progress: percent, dismissLabel,
    });
  } else if (shown && status === 'downloaded') {
    banners.push({
      id: 'update', tone: 'brand', icon: <RefreshCw size={14} />, text: t('update.downloaded'),
      action: { label: t('update.restartNow'), onClick: installUpdate }, onDismiss: dismissBanner, dismissLabel,
    });
  }
  return banners;
}

/** The banners at the top of the panel. */
export function Banners() {
  const banners = useBanners();
  return <>{banners.map((banner) => <Banner key={banner.id} {...banner} />)}</>;
}
```

`src/components/MainPanel/MainPanel.tsx`: replace the imports of `AudioSystemBanner` (47) and `UpdateBanner` (56) with `import { Banners } from '../Banner/useBanners';`, and `<UpdateBanner />\n      <AudioSystemBanner />` (272-273) with `<Banners />`. Then `git rm -r src/components/UpdateBanner src/components/AudioSystemBanner`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Banner src/components/MainPanel && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `grep -rn "UpdateBanner\|AudioSystemBanner" src` prints nothing (UpdateDialog is a separate folder and stays).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Banner src/components/UpdateBanner src/components/AudioSystemBanner src/components/MainPanel/MainPanel.tsx
git commit -m "feat(banner): the audio-system and update banners are one component, attention above brand (#481)"
```

### Task 3.3: The update check's result lives on the Help link; the error banner and its timer go

**Files:**
- Modify: `src/stores/updateStore.ts:170-185` (delete the auto-hide subscription), `src/stores/updateStore.test.ts`
- Modify: `src/components/Settings/sections/HelpSection.tsx:1-3, 20-22, 76-84`, `src/components/Settings/Settings.scss:2139-2180` (`.help-link` gains `--ok` / `--error`), `src/components/Settings/sections/HelpSection.test.tsx:9-43`

- [ ] **Step 1: Write the failing tests**

`src/stores/updateStore.test.ts`:

```ts
  it('an error status stays until the next check (spec 2026-10-05 §4: the Help link shows it, not a timer)', () => {
    vi.useFakeTimers();
    useUpdateStore.setState({ status: 'error', errorMessage: 'offline' });
    vi.advanceTimersByTime(10_000);
    expect(useUpdateStore.getState().status).toBe('error');
    vi.useRealTimers();
  });
```

(add `vi` to the vitest import.)

`src/components/Settings/sections/HelpSection.test.tsx`: make the `updateStore` mock live — replace lines 39-43 with:

```tsx
let updateStatus: 'idle' | 'checking' | 'not-available' | 'error' | 'available' = 'idle';
const checkForUpdates = vi.fn();
vi.mock('../../../stores/updateStore', () => ({
  useUpdateStatus: () => updateStatus,
  useCheckForUpdates: () => checkForUpdates,
  useOpenUpdateDialog: () => vi.fn(),
}));
```

and add (with `electron = true` so the link renders; the file's `t` returns the default value, so assert on the English defaults it passes — or pass none and assert keys; follow the file):

```tsx
describe('the update check’s result on its link (spec 2026-10-05 §5)', () => {
  beforeEach(() => { electron = true; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const link = () => screen.getByText(/update\.(checkButton|checking|upToDate|error)/).closest('button') as HTMLButtonElement;

  it('says Up to date for five seconds, then offers the check again', () => {
    updateStatus = 'not-available';
    const { rerender } = render(<HelpSection />);
    expect(link().className).toContain('help-link--ok');
    expect(link().textContent).toBe('update.upToDate');
    act(() => { vi.advanceTimersByTime(5000); });
    rerender(<HelpSection />);
    expect(link().textContent).toBe('update.checkButton');
  });

  // Review Focus 5: a second failure shows again although the status returns to the same value.
  it('says the check failed, in red, every time it fails', () => {
    updateStatus = 'error';
    const { rerender } = render(<HelpSection />);
    expect(link().className).toContain('help-link--error');
    act(() => { vi.advanceTimersByTime(5000); });
    rerender(<HelpSection />);
    expect(link().textContent).toBe('update.checkButton');
    updateStatus = 'checking'; rerender(<HelpSection />);
    updateStatus = 'error'; rerender(<HelpSection />);
    expect(link().textContent).toBe('update.error');
  });
});
```

(This test file's `t` returns `d ?? key`; the check link passes no defaults for the `update.*` keys, so the keys render. `act` comes from `@testing-library/react`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/updateStore.test.ts src/components/Settings/sections/HelpSection.test.tsx`
Expected: FAIL — the status resets to `idle` after 5 s; the link never shows `update.upToDate` / `update.error`.

- [ ] **Step 3: Write minimal implementation**

`src/stores/updateStore.ts`: delete lines 170-185 (the `errorTimer` and its `subscribe`).

`src/components/Settings/sections/HelpSection.tsx`:
- line 2: add `Check, CircleAlert` to the lucide import.
- after `const wantedLanguageRef …` (around line 40), add:

```tsx
  // The check's result, on the link that asked for it (spec 2026-10-05 §5):
  // "Up to date" or "Failed to check" for five seconds, then the link again.
  // A new check passes through 'checking' first, so a second failure re-runs this.
  const [checkResult, setCheckResult] = useState<'not-available' | 'error' | null>(null);
  // Only a check the user started shows a result: a stale status held by the
  // store (or the one present at mount) must not flash on every reopen (Ruling 7).
  const previousStatusRef = useRef(updateStatus);
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = updateStatus;
    if (previous !== 'checking' || (updateStatus !== 'not-available' && updateStatus !== 'error')) {
      setCheckResult(null);
      return;
    }
    setCheckResult(updateStatus);
    const timer = setTimeout(() => setCheckResult(null), 5000);
    return () => clearTimeout(timer);
  }, [updateStatus]);
```

- replace the check link (76-84) with:

```tsx
        {isElectron() && (
          <button
            type="button"
            className={[
              'help-link',
              updateStatus === 'checking' ? 'disabled' : '',
              checkResult === 'not-available' ? 'help-link--ok' : '',
              checkResult === 'error' ? 'help-link--error' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => { if (updateStatus !== 'checking') checkForUpdates(); }}
          >
            {updateStatus === 'checking' ? <RefreshCw size={13} className="spinning" />
              : checkResult === 'not-available' ? <Check size={13} />
              : checkResult === 'error' ? <CircleAlert size={13} />
              : <RefreshCw size={13} />}
            <span>
              {updateStatus === 'checking' ? t('update.checking')
                : checkResult === 'not-available' ? t('update.upToDate')
                : checkResult === 'error' ? t('update.error')
                : t('update.checkButton')}
            </span>
          </button>
        )}
```

`src/components/Settings/Settings.scss`, inside `.help-link { … }` after `&.is-disabled { … }`:

```scss
  // The update check's result, for five seconds (spec 2026-10-05 §5).
  &--ok { color: vars.$color-primary; }
  &--error { color: #ff6b6b; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/updateStore.test.ts src/components/Settings/sections/HelpSection.test.tsx`
Expected: PASS. The ledger row `'src/components/Settings/sections/HelpSection.tsx': 2` is unchanged (no console call added or removed).

- [ ] **Step 5: Commit**

```bash
git add src/stores/updateStore.ts src/stores/updateStore.test.ts src/components/Settings/sections/HelpSection.tsx src/components/Settings/sections/HelpSection.test.tsx src/components/Settings/Settings.scss
git commit -m "feat(help): the update check's result shows on its link; no error banner, no timer in the store (#481)"
```

### Task 3.4: Part 3 render check and the PR

- [ ] **Step 1:** `npx vitest run` and `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] **Step 2:** Render at 450px: the mac-driver banner (Repair), the pactl banner (command), the update banner in `available` / `downloading` / `downloaded`, both banners stacked; the Help link in its two result states; compare with section 3 and T3 of the approved page.
- [ ] **Step 3:** Ask jiangzhuo for the go, then push and open the PR `feat(notices): one banner; the update check's result on its link (#481, 3/4)`. Do not merge.

---

# Part 4 — no toast (PR 4)

### Task 4.1: Session expired goes into the sign-in card

**Files:**
- Modify: `src/stores/settingsStore.ts:92, 195-203, 308-311, 393-396, 775-781, 821-828`
- Modify: `src/components/Auth/SignInForm.tsx:8, 16-22`
- Modify: `src/components/Auth/UserAccountInfo.tsx:26, 41, 274-278`
- Create: `src/components/Auth/SignInForm.test.tsx`, `src/stores/settingsStore.authOverlay.test.ts`
- Test: `src/components/Auth/UserAccountInfo.sessionFeedback.test.tsx:58-63, 118-138, 149-155`

**Interfaces:**
- Produces: `AuthOverlayReason = 'session_expired'`, `settingsStore.authOverlayReason: AuthOverlayReason | null`, `setAuthOverlay(next, reason?)`, `useAuthOverlayReason()`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/settingsStore.authOverlay.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('authOverlay reason (spec 2026-10-05 §5)', () => {
  beforeEach(() => { useSettingsStore.setState({ authOverlay: null, authOverlayReason: null }); });

  it('opening the sign-in form with a reason keeps it; closing clears it', () => {
    useSettingsStore.getState().setAuthOverlay('sign-in', 'session_expired');
    expect(useSettingsStore.getState()).toMatchObject({ authOverlay: 'sign-in', authOverlayReason: 'session_expired' });
    useSettingsStore.getState().setAuthOverlay(null);
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
  });

  it('a reason belongs to the sign-in form only', () => {
    useSettingsStore.getState().setAuthOverlay('sign-in', 'session_expired');
    useSettingsStore.getState().setAuthOverlay('sign-up');
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
    useSettingsStore.getState().setAuthOverlay('sign-in');
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
  });
});
```

(If `settingsStore` needs the `ServiceFactory` mock to import in a test — see `src/stores/settingsStore.subtitle.test.ts` for the mocks it uses — copy them.)

```tsx
// src/components/Auth/SignInForm.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SignInForm } from './SignInForm';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }) }));
vi.mock('../../lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn(async () => ({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } })) } } }));

let reason: 'session_expired' | null = null;
const setAuthOverlay = vi.fn();
vi.mock('../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => setAuthOverlay,
  useAuthOverlayReason: () => reason,
}));

beforeEach(() => { reason = null; setAuthOverlay.mockClear(); });
afterEach(cleanup);

describe('SignInForm — why it opened (spec 2026-10-05 §5, T4)', () => {
  it('opens clean by default', () => {
    const { container } = render(<SignInForm />);
    expect(container.querySelector('.error-message')).toBeNull();
  });

  it('says the session expired, in the card’s own message slot, when that is why it opened', () => {
    reason = 'session_expired';
    const { container } = render(<SignInForm />);
    expect(container.querySelector('.error-message')?.textContent).toBe('auth.sessionExpired');
  });

  it('a submit replaces it with the submit’s own outcome', async () => {
    reason = 'session_expired';
    const { container, findByText } = render(<SignInForm />);
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'a@b.c' } });
    fireEvent.change(container.querySelector('#password')!, { target: { value: 'pw' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await findByText('auth.invalidCredentials')).toBeTruthy();
  });
});
```

`src/components/Auth/UserAccountInfo.sessionFeedback.test.tsx`: delete the `showToast` mock (58-59) and its `mockClear`; the two cases at 118-138 assert `setAuthOverlay` instead:

```tsx
    await waitFor(() => expect(setAuthOverlay).toHaveBeenCalledWith('sign-in', 'session_expired'));
```

(the case "tells the user, instead of failing silently" keeps its name: the sign-in card now tells them). The assertion at 149-155 that `setAuthOverlay` was called with `'sign-in'` becomes `('sign-in', 'session_expired')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/settingsStore.authOverlay.test.ts src/components/Auth/SignInForm.test.tsx src/components/Auth/UserAccountInfo.sessionFeedback.test.tsx`
Expected: FAIL — `authOverlayReason` undefined; `useAuthOverlayReason` is not exported; `setAuthOverlay` called with one argument.

- [ ] **Step 3: Write minimal implementation**

`src/stores/settingsStore.ts`:
- after line 92: `export type AuthOverlayReason = 'session_expired';`
- state (after `authOverlay: AuthOverlayKind;`): `/** Why the sign-in form opened, when the form should say so (spec 2026-10-05 §5): the session expired. Null for any other form or none. */\n  authOverlayReason: AuthOverlayReason | null;`
- action signature (310): `setAuthOverlay: (next: AuthOverlayKind, reason?: AuthOverlayReason) => void;`
- defaults (396): add `authOverlayReason: null,`
- setter (775-777):

```ts
    setAuthOverlay: (next: AuthOverlayKind, reason?: AuthOverlayReason) => {
      set({authOverlay: next, authOverlayReason: next === 'sign-in' ? reason ?? null : null});
    },
```

- hooks (after `useSetAuthOverlay`): `export const useAuthOverlayReason = () =>\n  useSettingsStore((state: SettingsStore) => state.authOverlayReason);`

`src/components/Auth/SignInForm.tsx`:
- line 8: `import { useAuthOverlayReason, useSetAuthOverlay } from '../../stores/settingsStore';`
- after `const setAuthOverlay = useSetAuthOverlay();`: `const reason = useAuthOverlayReason();`
- line 21: `const [error, setError] = useState(reason === 'session_expired' ? t('auth.sessionExpired', 'Your session has expired. Please sign in again.') : '');` — with a comment: `// Why the form opened, in its own message slot (spec 2026-10-05 §5, T4): once, as the initial state; a submit replaces it.`

`src/components/Auth/UserAccountInfo.tsx`: delete line 26 (`import {useToast} …`) and line 41 (`const {showToast} = useToast();`); replace lines 274-278 with `setAuthOverlay('sign-in', 'session_expired');` and update the comment above it ("the sign-in card says why it opened").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/settingsStore.authOverlay.test.ts src/components/Auth && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. The ledger row `'src/components/Auth/UserAccountInfo.tsx': 5` is unchanged (no console call touched); if it is not, lower it in the same commit.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.authOverlay.test.ts src/components/Auth/SignInForm.tsx src/components/Auth/SignInForm.test.tsx src/components/Auth/UserAccountInfo.tsx src/components/Auth/UserAccountInfo.sessionFeedback.test.tsx
git commit -m "feat(auth): the sign-in card says the session expired; no toast (#481)"
```

### Task 4.2: E-mail verified needs no toast

**Files:**
- Modify: `src/components/TitleBar/AccountButton.tsx:22, 30, 60-73`
- Test: `src/components/TitleBar/AccountButton.test.tsx:37-38, 75, 276-308`

- [ ] **Step 1: Change the tests first**

Delete the three cases at 276-308 (`confirms the transition with a toast`, `does not toast again on later renders`, `does not toast when an already-verified session merely finishes loading`), the `showToast` spy and `vi.mock('../Toast', …)` at 37-38, and the `mockClear` at 75. Add one case, next to the dot cases:

```tsx
  it('verification shows as the dot clearing; nothing else (spec 2026-10-05 §5, T5)', () => {
    signIn(false);
    const { container, rerender } = render(<AccountButton />);
    expect(container.querySelector('.account-button__dot[data-tone="unverified"]')).not.toBeNull();
    signIn(true);
    rerender(<AccountButton />);
    expect(container.querySelector('.account-button__dot')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: the new case PASSES already (the dot clears today) and the file compiles. This task removes behaviour; the test pins what must stay. Proceed to Step 3.

- [ ] **Step 3: Write minimal implementation**

In `src/components/TitleBar/AccountButton.tsx`: delete line 22 (`import { useToast } from '../Toast';`), line 30 (`const { showToast } = useToast();`) and the whole block 60-73 (the `wasVerified` ref and its effect, with its comment). `useRef` may now be used only for `btnRef`; keep the import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/TitleBar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.test.tsx
git commit -m "feat(account): e-mail verified is the dot clearing; no toast (#481)"
```

### Task 4.3: Delete the toast, and make its return impossible

**Files:**
- Delete: `src/components/Toast/` (`index.ts`, `Toast.tsx`, `ToastContext.tsx`, `Toast.scss`, `Toast.test.tsx`)
- Modify: `src/components/AppProviders.tsx:4, 15`
- Modify (tests that still mock or wrap the toast): `src/app/useAppSession.test.tsx:70, 114-150`, `src/app/AppSessionRoot.test.tsx:70, 88`, `src/components/MainPanel/MainPanel.test.tsx:129`, `src/components/MainPanel/MainPanel.microphone.test.tsx:70`, `src/components/MainPanel/ExportMenuButton.test.tsx:14`, `src/components/MainPanel/ExportButton.test.tsx:22`, `src/components/MainPanel/ExportButton.childWindow.test.tsx:10`, `src/components/Auth/UserAccountInfo.verificationTone.test.tsx:47`, `src/components/Auth/UserAccountInfo.quotaPending.test.tsx:35`, `src/components/Auth/UserAccountInfo.topUp.test.tsx:29`, `src/components/Auth/UserAccountInfo.signOutIdentity.test.tsx:48-49`, `src/components/Subtitle/SubtitleEnterButton.test.tsx:23`, `src/components/Subtitle/SubtitleEnterButton.integration.test.tsx:22`
- Modify: `src/lib/diagnostics/consoleLedger.consistency.test.ts:194` (the `ToastContext.tsx` row) and its `describe` (a new `it`)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/diagnostics/consoleLedger.consistency.test.ts`, inside `describe('console ledger', …)`, modelled on the import scan at 350-359:

```ts
  it('nothing draws a notice through a surface this design retired (spec 2026-10-05)', () => {
    // Relative imports carry no `components/`: match the module path's tail, quoted.
    const retired = /['"][^'"]*\/(Toast|UpdateBanner\/UpdateBanner|AudioSystemBanner\/AudioSystemBanner|EchoNotice\/EchoNotice|view\/lastEnd)['"]/;
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      for (const line of read(file).split('\n')) {
        if (!/^\s*import\b/.test(line)) continue;
        if (retired.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: FAIL — `src/components/AppProviders.tsx` and `src/components/Toast/index.ts` import `./Toast` / `./ToastContext`.

- [ ] **Step 3: Delete, and lower the ledger**

- `git rm -r src/components/Toast`
- `src/components/AppProviders.tsx`: delete line 4 and unwrap: `<PostHogProvider client={posthogClient}>{children}</PostHogProvider>`.
- In every test listed above: delete the `vi.mock('../Toast', …)` / `vi.mock('../../components/Toast', …)` line and any `showToast` spy it fed; in `useAppSession.test.tsx` and `AppSessionRoot.test.tsx` remove the `ToastProvider` import and the `{ wrapper: ToastProvider }` / `<ToastProvider>` wrappers (render the hook/component bare).
- `consoleLedger.consistency.test.ts:194`: replace `'src/components/Toast/ToastContext.tsx': 1,` with the comment `// ToastContext.tsx's row (1) is gone, not lowered to 0: spec 2026-10-05 removed the toast; its uses became panel notes, the status line, or the control's own state.`

- [ ] **Step 4: Run the whole suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `grep -rn "Toast\b" src --include='*.ts' --include='*.tsx' | grep -v "toast-" ` prints nothing (comments aside).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Toast src/components/AppProviders.tsx src/app src/components src/lib/diagnostics/consoleLedger.consistency.test.ts
git commit -m "refactor: remove the toast; a consistency test keeps the retired surfaces out (#481)"
```

### Task 4.4: Close out — spec note, render check, the PR that closes #481

- [ ] **Step 1:** In `docs/superpowers/specs/2026-10-05-unified-notices-design.md` §8, change "`noticeText`, `NOTICE_WORDS`, `NOTICE_ALIASES` (no key is added or removed)" to "`noticeText`, `NOTICE_WORDS` (no locale key is added or removed; `NOTICE_ALIASES` gains four rows for the panel notes — a code table, not a catalog)". Commit: `docs(specs): note the four alias rows the panel notes add`.
- [ ] **Step 2:** `npx vitest run` and `npx tsc --noEmit -p tsconfig.json` — clean. `grep -rn "console\.\(error\|warn\)(" src/components/Banner src/components/MainPanel/StatusLine.tsx src/stores/panelNotesStore.ts src/lib/view/statusLine.ts` prints nothing.
- [ ] **Step 3:** Render the two composites (X1 at 450px running: audio banner + mic-lost row + copied row + echo line; X2 at 300px idle: update banner + budget row + saved row + balance line with Top up) in `en` and `zh_CN`; compare with section 5 of the approved page.
- [ ] **Step 4:** Ask jiangzhuo for the go, then push and open the PR `feat(notices): no toast — session expired in the sign-in card, nothing for e-mail verified (#481, 4/4)` with `Closes #481`. Do not merge.
