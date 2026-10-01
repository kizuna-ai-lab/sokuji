# Client contract — Stage 1d-3: export and auto-save

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The conversation's export and auto-save rebuilt on L1 and L2 — the new writer grows per-leg scope, a file header and JSON metadata; an `Exporter` seam lets today's export menu serve both the old and the new conversation; auto-save runs from the runner's `onRunEnded`; the panel says why the last start failed — all drawn in the development preview and checked headlessly by exporting real files.

**Architecture:** `src/lib/export/transcript.ts` (plan 1a's writer) takes a scope per leg (the display modes' union) and an optional header; `exporter.ts` wraps it as an `Exporter` (has content, scoped content, text with or without header, JSON). `ExportButton` splits: a presentational `ExportMenuButton` over an `Exporter`, and today's default export, which builds an exporter from the old items and renders it — so `MainPanel` and `SubtitleApp` do not change. The conversation remembers which provider and models its run used (`ConversationSet.info`). Auto-save shares today's saving branch (`saveTranscriptText`) and feeds it the new writer's text. A pure `lastEndItem` turns a refused or failed start into a notice after the list.

**Tech Stack:** TypeScript (strict), React 18, zustand, i18next / react-i18next, Vitest + @testing-library/react, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Export: one block per group", "The conversation outlives the run", "Stopping, and closing the window", "Notices reach the user localized". The roadmap's "Scheduled by plan 1d-1" → 1d-3 item (the idle line) is taken up here.

## Global Constraints

- Today's export code changes only where the tasks say, and behaves exactly as before: `src/utils/conversationExport.ts` (two helpers exported), `src/lib/transcript/autoSave.ts` (its saving branch extracted), `src/components/MainPanel/ExportButton.tsx` (split in two). Their existing tests (`conversationExport.test.ts`, `autoSave.test.ts`, `ExportButton.test.tsx`, `ExportButton.childWindow.test.tsx`, `exportScopeStyles.test.ts`, `sessionEndAutoSave*.test.ts`) must pass unchanged. `MainPanel.tsx`, `SubtitleApp.tsx`, `electron/**`, `extension/**` are read only.
- `src/lib/**` never imports React. Under `src/lib`, stores are read only by `src/lib/view/appViewSettings.ts`, `src/lib/subtitle/appSession.ts`, `src/lib/transcript/autoSave.ts` (as today) and the new `src/lib/export/appAutoSave.ts`.
- New locale keys only in Task 1 — two keys, added to all 30 locales, translated (`locales.consistency.test.ts` enforces parity).
- Record a caught failure with `reportError` / `reportWarning`; never `console.error` / `console.warn`.
- Match the markup of the nearest existing instance of each control; the export menu's markup does not change at all.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the four long-standing ones plus seven older errors in `SubtitleApp.handleStart.test.tsx` and `SubtitleBar.test.tsx`, which are not to be fixed):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|MainPanel/ExportButton|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. Never push.

## Rulings this plan makes

1. **The scope is per leg**, the display modes' union (`both` / `source` / `translation` / `none` for each leg) — today's four checkboxes, not one pair for both legs. A leg scoped `none` writes nothing; a hidden side is left out of the text and absent from the JSON group (a present `null` still means "none was produced").
2. **The header is today's, from the run, not the settings**: title, generated, provider and models from the conversation's own run (`ConversationSet.info`), the speaker's language pair from its leg, and the "narrowed" line when the scope left something out. Today's "settings reflect current state at export" note is dropped — it is no longer true.
3. **The `Exporter` seam**: `ExportMenuButton` (the menu as it is today, drawn over an `Exporter`) and today's default `ExportButton` (same props as now, building a legacy exporter). The old callers do not change; plan 1e deletes the legacy half.
4. **Auto-save writes the new blocks** (one per group, segments whole) with the header, the whole conversation, through today's saving branch (the Electron `transcript:save` IPC with its toast, or a download).
5. **The idle line**: when the last start was refused or failed, its notice is drawn after the list, in the notice bubble — nothing else on screen says it (a failed start leaves empty legs; a refused one keeps the last conversation). Runs that ended on their own already carry their notice on a leg. This corrects the roadmap's 1d-3 note, which says a failed start's notice is on a leg: the runner's `end()` (`src/lib/session/runner.ts`) writes it only to `lastEnd`.
6. **File helpers are imported, not moved**: the new exporter uses `downloadFile`, `copyToClipboard`, `exportFilename`, `getAppVersion` and the two time formatters from `src/utils/conversationExport.ts`; plan 1e moves what survives.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/export/transcript.ts` | 1 | per-leg scope, the header, JSON metadata |
| `src/locales/*/translation.json` | 1 | `mainPanel.export.noTranslation`, `mainPanel.export.noSource` |
| `src/lib/session/conversationSet.ts`, `run.ts`, `runner.ts` | 2 | `ConversationInfo` — the run's provider and models, kept with the conversation |
| `src/lib/export/exporter.ts` (new) | 3 | `Exporter`, `conversationExporter`, `exportWords` |
| `src/utils/conversationExport.ts` | 3 | export `formatLocalTime`, `formatLocalDateTime` |
| `src/components/MainPanel/ExportButton.tsx` | 4 | `ExportMenuButton` over an `Exporter`; the default export builds a legacy one |
| `src/lib/transcript/autoSave.ts` | 5 | `saveTranscriptText` extracted |
| `src/lib/export/appAutoSave.ts` (new) | 5 | `autoSaveConversation` |
| `src/lib/view/lastEnd.ts` (new) | 6 | `lastEndItem` |
| `src/components/Subtitle/SubtitleBar.tsx`, `SubtitleView.tsx` | 6 | an `exporter` for the new view's bar |
| `src/components/dev/SpinePreview.tsx`, `scripts/dev/spine-export-probe.mjs` (new) | 7 | the preview's export, auto-save and idle line; the headless check |

---

### Task 1: The writer's scope, header and metadata

**Files:**
- Modify: `src/lib/export/transcript.ts`, `src/lib/export/transcript.test.ts`, the 30 `src/locales/<code>/translation.json`

**Interfaces:**
- Consumes: `SideFilter`, `showsSide` (`src/lib/view/filter.ts`), `Languages`, `LegName` (`src/lib/conversation/types.ts`).
- Produces: `TranscriptScope` (an alias of `LegFilters`), `FULL_SCOPE`, `isNarrowed(scope)`; `TranscriptHeaderLabels { title; generated; provider; models; source; target; narrowed }`; `TranscriptMeta { exportedAt: number; appVersion: string | null; provider: string | null; models: Readonly<Record<string, string>> }`; `TranscriptOptions` gains `scope?: TranscriptScope` (replacing `{ source; translation }`) and `header?: { labels; meta; formatDateTime(ms): string }`; `renderTranscriptJson(entries, legs, o?: { scope?; meta? })`; `TranscriptGroup.source` / `.translation` become optional (absent = not in scope); `TranscriptJson` gains optional `exportedAt` (ISO), `appVersion`, `provider`, `models`, `languages`, `scope`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/export/transcript.test.ts`, keep every existing test except `'honours the scope: translation only'` (their calls pass no scope and no meta, and must produce what they produce today). That one uses the old `{ source, translation }` scope; replace it with:

```ts
  it('honours the scope: translation only, leaving out a group with no translation', () => {
    const txt = renderTranscriptTxt(entries, legs, { ...options, scope: { speaker: 'translation', participant: 'translation' } });
    expect(txt).toContain('  → The weather is nice.');
    expect(txt).not.toContain('今天天气很好');
    // The lone source group has nothing in scope: no block, no "(no translation)".
    expect(txt).not.toContain('[t13000]');
    expect(txt).not.toContain('(no translation)');
  });
```

and add:

```ts
describe('scope, header and metadata', () => {
  const header = {
    labels: { title: 'Sokuji conversation export', generated: 'Generated', provider: 'Provider', models: 'Models', source: 'My Language', target: "Other's Language", narrowed: 'Note: narrowed.' },
    meta: { exportedAt: 0, appVersion: '1.2.3', provider: 'fake', models: { asr: 'a1', translation: '', tts: 't1' } },
    formatDateTime: (ms: number) => `<${ms}>`,
  };

  it("writes each leg's sides as its scope says, and none of a leg scoped out", () => {
    const text = renderTranscriptTxt(entries, legs, { ...options, scope: { speaker: 'translation', participant: 'none' } });
    expect(text).toContain('  → The weather is nice. Let us go to the park.');
    expect(text).not.toContain('今天天气很好。');
    expect(text).not.toContain('Other');
  });

  it('starts a file with the header: provider, models, the speaker pair, and the narrowed note only when narrowed', () => {
    const full = renderTranscriptTxt(entries, legs, { ...options, header });
    expect(full.split('\n').slice(0, 6)).toEqual([
      'Sokuji conversation export',
      'Generated: <0>',
      'Provider: fake',
      'Models: asr=a1, tts=t1',
      "My Language: zh → Other's Language: en",
      '',
    ]);
    const narrowed = renderTranscriptTxt(entries, legs, { ...options, header, scope: { speaker: 'both', participant: 'source' } });
    expect(narrowed).toContain('Note: narrowed.');
  });

  it("gives the JSON the run's metadata, leaves out hidden sides, and records a narrowed scope", () => {
    const json = renderTranscriptJson(entries, legs, { scope: { speaker: 'source', participant: 'none' }, meta: header.meta });
    expect(json).toMatchObject({ exportedAt: new Date(0).toISOString(), appVersion: '1.2.3', provider: 'fake', languages: { source: 'zh', target: 'en' }, scope: { speaker: 'source', participant: 'none' } });
    expect(json.groups.every((g) => g.leg === 'speaker')).toBe(true);
    expect(json.groups[0]).not.toHaveProperty('translation');
    expect(renderTranscriptJson(entries, legs, { meta: header.meta })).not.toHaveProperty('scope');
  });

  it('keeps a group with one side missing under a scope showing both, and writes no metadata without meta', () => {
    const json = renderTranscriptJson(entries, legs);
    expect(json.groups.find((g) => g.id === 'c')).toMatchObject({ source: { text: '下午三点吧。' }, translation: null });
    expect(Object.keys(json)).toEqual(['groups', 'notices']);
  });
});
```

(`entries`, `legs` and `options` are the file's existing fixtures: a speaker exchange zh→en, a notice, a participant exchange, and a lone speaker source.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/export`
Expected: the new tests FAIL.

- [ ] **Step 3: The scope, the header and the metadata**

In `src/lib/export/transcript.ts`:

```ts
import type { Languages } from '../conversation/types';
import { showsSide, type LegFilters } from '../view/filter';

/** Which sides of each leg an export writes: the display modes' union, per leg (today's four checkboxes). */
export type TranscriptScope = LegFilters;

export const FULL_SCOPE: TranscriptScope = { speaker: 'both', participant: 'both' };

/** The scope left something out. */
export function isNarrowed(scope: TranscriptScope): boolean {
  return scope.speaker !== 'both' || scope.participant !== 'both';
}

export interface TranscriptHeaderLabels {
  title: string;
  generated: string;
  provider: string;
  models: string;
  source: string;
  target: string;
  /** Written only when the scope left something out. */
  narrowed: string;
}

/** What a file says about itself: from the conversation's own run, never the current settings. */
export interface TranscriptMeta {
  exportedAt: number;
  appVersion: string | null;
  /** The provider the conversation ran on; null before any run. */
  provider: string | null;
  models: Readonly<Record<string, string>>;
}
```

`TranscriptOptions` becomes:

```ts
export interface TranscriptOptions {
  labels: TranscriptLabels;
  formatTime: (ms: number) => string;
  /** Default: everything. */
  scope?: TranscriptScope;
  /** A file's header; absent for the clipboard. */
  header?: { labels: TranscriptHeaderLabels; meta: TranscriptMeta; formatDateTime: (ms: number) => string };
}
```

`TranscriptGroup`'s sides become `source?: TranscriptSide | null; translation?: TranscriptSide | null;` with the doc comment "absent: not in the export's scope; null: none was produced". `TranscriptJson` gains, all optional: `exportedAt?: string` (ISO), `appVersion?: string | null`, `provider?: string | null`, `models?: Readonly<Record<string, string>>`, `languages?: Languages | null`, `scope?: TranscriptScope` (present only when narrowed).

Add:

```ts
const ARROW = '→';

/** The speaker's pair: the speaker leg's, or the participant's reversed when only it ran. */
function pairOf(legs: readonly Leg[]): Languages | null {
  const speaker = legs.find((leg) => leg.leg === 'speaker');
  if (speaker) return speaker.languages;
  const participant = legs.find((leg) => leg.leg === 'participant');
  return participant ? { source: participant.languages.target, target: participant.languages.source } : null;
}

function modelsLine(models: Readonly<Record<string, string>>): string {
  return Object.entries(models).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ');
}

function headerLines(header: NonNullable<TranscriptOptions['header']>, legs: readonly Leg[], narrowed: boolean): string[] {
  const { labels, meta } = header;
  const lines = [labels.title, `${labels.generated}: ${header.formatDateTime(meta.exportedAt)}`];
  if (meta.provider) lines.push(`${labels.provider}: ${meta.provider}`);
  const models = modelsLine(meta.models);
  if (models) lines.push(`${labels.models}: ${models}`);
  const pair = pairOf(legs);
  if (pair) lines.push(`${labels.source}: ${pair.source} ${ARROW} ${labels.target}: ${pair.target}`);
  if (narrowed) lines.push(labels.narrowed);
  lines.push('');
  return lines;
}
```

`renderTranscriptJson(entries, legs, o: { scope?: TranscriptScope; meta?: TranscriptMeta } = {})` (scope defaults to `FULL_SCOPE`): set a side only when `showsSide(scope[e.leg], side)` (otherwise leave the property out); skip a group none of whose in-scope sides was produced (this covers a leg scoped `none`, and a lone source under a translation-only scope — no block that says only "(no translation)"); prepend, when `o.meta` is given, `exportedAt: new Date(meta.exportedAt).toISOString()`, `appVersion`, `provider`, `models` and `languages: pairOf(legs)`; add `scope` only when `isNarrowed(scope)`. Notices are metadata and ignore the scope.

`renderTranscriptTxt(entries, legs, o)`: start with `headerLines(...)` when `o.header` is given (narrowed = `isNarrowed(scope)`), then one block per group of the scoped JSON: the time-and-speaker line; the source line when the leg's filter shows the source (`g.source ? g.source.text : labels.noSource`); the translation line when it shows the translation (`g.translation ? `→ ${…}` : labels.noTranslation`); a blank line.

- [ ] **Step 4: The two labels in every locale**

Add to each `src/locales/<code>/translation.json`, inside `"mainPanel"` → `"export"`, beside its existing keys: `"noTranslation": "(no translation)"` and `"noSource": "(no source)"` in English, translated in the other 29 (keep the parentheses; reuse each locale's own word for "translation" — see its `mainPanel.export.translationSuffix` and `mainPanel.displayMode.translation`). Insert lines; do not re-serialize a file.

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/lib/export src/locales` — PASS (the locale parity suite included). Then `npx vitest run src` (0 failed) and the typecheck gate (11 lines).

- [ ] **Step 6: Commit**

```bash
git add src/lib/export src/locales
git commit -m "feat(export): per-leg scope, a file header and JSON metadata for the new writer"
```

---

### Task 2: The conversation remembers its run

**Files:**
- Modify: `src/lib/session/conversationSet.ts`, `src/lib/session/run.ts` (`RunHost.conversations`, the call at the opening step), `src/lib/session/runner.ts` (`hostFor`)
- Test: `src/lib/session/conversationSet.test.ts`, `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: `ConversationInfo { provider: string; models: { asrModel?: string; translationModel?: string; ttsModel?: string } }`; `ConversationSet.info: ConversationInfo | null`; `ConversationSet.replace(next, info?)`. Tasks 3, 5 and 7 read `runner.conversation.info`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/session/conversationSet.test.ts`:

```ts
  it("keeps the run's provider and models with the conversation, through a clear, until the next replace", () => {
    const set = new ConversationSet();
    expect(set.info).toBeNull();
    set.replace(new Map(), { provider: 'fake', models: { asrModel: 'a' } });
    set.clear();
    expect(set.info).toEqual({ provider: 'fake', models: { asrModel: 'a' } });
    set.replace(new Map(), { provider: 'other', models: {} });
    expect(set.info?.provider).toBe('other');
  });
```

In `src/lib/session/runner.test.ts`:

```ts
  it('records the provider and the models its run described on the conversation', async () => {
    const { runner } = setup();
    expect(runner.conversation.info).toBeNull();
    await runner.start();
    // The fake describes every stage as 'fake' (`src/providers/fake/provider.ts`).
    expect(runner.conversation.info).toEqual({ provider: 'fake', models: { asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' } });
  });
```

(inside `describe('runner — the conversation', …)`, beside `'outlives the run until the next start replaces it'`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session`
Expected: FAIL — `info` does not exist.

- [ ] **Step 3: Keep it**

In `src/lib/session/conversationSet.ts`:

```ts
/** Which provider and models a conversation's run used: what its export says about itself (plan 1d-3). */
export interface ConversationInfo {
  provider: string;
  models: { asrModel?: string; translationModel?: string; ttsModel?: string };
}
```

a `private current: ConversationInfo | null = null;`, a getter `get info(): ConversationInfo | null`, and `replace(next, info: ConversationInfo | null = null)` setting it with the legs (`clear()` keeps it — the conversation's run did not change). In `run.ts`, `RunHost.conversations(legs, info: ConversationInfo)`, called at the opening step with `{ provider: this.shape.provider.id, models: this.models }` (`this.models` is described before the opening step). In `runner.ts`'s `hostFor`, `conversations: (map, info) => conversation.replace(map, info)`.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session
git commit -m "feat(session): the conversation keeps its run's provider and models"
```

---
### Task 3: The exporter

**Files:**
- Create: `src/lib/export/exporter.ts`, `src/lib/export/exporter.test.ts`
- Modify: `src/utils/conversationExport.ts` (export `formatLocalTime` and `formatLocalDateTime`: add `export` to the two existing functions, nothing else)

**Interfaces:**
- Consumes: Task 1's writer, scope, header and meta types; Task 2's `ConversationInfo`.
- Produces (Tasks 4–7 rely on these names):

```ts
export interface Exporter {
  readonly hasContent: boolean;
  hasScopedContent(scope: TranscriptScope): boolean;
  text(scope: TranscriptScope, withHeader: boolean): string;
  json(scope: TranscriptScope): string;
}
export interface ExportWords { labels: TranscriptLabels; header: TranscriptHeaderLabels }
export function exportWords(t: (key: string, defaultValue: string) => string): ExportWords;
export interface ConversationExportInput {
  entries: readonly Entry[]; legs: readonly Leg[]; info: ConversationInfo | null;
  words: ExportWords; appVersion: string | null; now: () => number;
}
export function conversationExporter(input: ConversationExportInput): Exporter;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/exporter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Leg, Segment } from '../conversation/types';
import type { Entry } from '../projection/types';
import { conversationExporter, exportWords } from './exporter';
import { FULL_SCOPE } from './transcript';

// Local times, so the formatted clock reads the same in every timezone.
const said = new Date(2026, 8, 24, 10, 0, 5).getTime();
const exported = new Date(2026, 8, 24, 10, 1, 0).getTime();

const seg = (over: Partial<Segment>): Segment => ({ id: 'x', ref: 1, side: 'source', text: '', final: true, openedAt: said, marks: [], speech: [], ...over });
const src = seg({ id: 'r:speaker:1', text: '今日は天気がいいですね。' });
const tr = seg({ id: 'r:speaker:2', side: 'translation', text: '今天天气很好。', openedAt: said + 400 });
const legs: Leg[] = [{ leg: 'speaker', session: 'r', languages: { source: 'ja', target: 'zh' }, segments: [src, tr], notices: [] }];
const row = (s: Segment) => ({ key: `${s.id}:0`, segmentId: s.id, side: s.side, start: 0, end: s.text.length, text: s.text, final: true });
const entries: Entry[] = [
  { kind: 'exchange', id: 'g', leg: 'speaker', languages: legs[0].languages, pairing: 'stated', source: [row(src)], translation: [row(tr)], t: said },
];
const words = exportWords((_key, defaultValue) => defaultValue);
const exporter = (over: Partial<Parameters<typeof conversationExporter>[0]> = {}) => conversationExporter({
  entries, legs, info: { provider: 'fake', models: { asrModel: 'a', ttsModel: 't' } }, words, appVersion: '9.9.9', now: () => exported, ...over,
});

describe('conversationExporter', () => {
  it("copies without a header and writes a file with one, from the run's own provider and models", () => {
    expect(exporter().text(FULL_SCOPE, false)).toBe('[10:00:05] Me\n  今日は天気がいいですね。\n  → 今天天气很好。\n');
    expect(exporter().text(FULL_SCOPE, true)).toBe([
      'Sokuji conversation export',
      'Generated: 2026-09-24 10:01:00',
      'Provider: fake',
      'Models: asr=a, tts=t',
      "My Language: ja → Other's Language: zh",
      '',
      '[10:00:05] Me',
      '  今日は天気がいいですね。',
      '  → 今天天气很好。',
      '',
    ].join('\n'));
  });

  it('answers the menu: is there a conversation, and does the scope select any of it', () => {
    expect(exporter().hasContent).toBe(true);
    expect(exporter().hasScopedContent({ speaker: 'source', participant: 'both' })).toBe(true);
    expect(exporter().hasScopedContent({ speaker: 'none', participant: 'both' })).toBe(false);
    expect(exporter({ entries: [], legs: [] }).hasContent).toBe(false);
  });

  it('writes the JSON with the metadata of the export and the run', () => {
    expect(JSON.parse(exporter().json(FULL_SCOPE))).toMatchObject({
      exportedAt: new Date(exported).toISOString(),
      appVersion: '9.9.9',
      provider: 'fake',
      models: { asr: 'a', tts: 't' },
      languages: { source: 'ja', target: 'zh' },
      groups: [{ id: 'g', source: { text: '今日は天気がいいですね。' }, translation: { text: '今天天气很好。' } }],
    });
  });

  it('names no provider and no models before any run', () => {
    const text = exporter({ info: null }).text(FULL_SCOPE, true);
    expect(text).not.toContain('Provider:');
    expect(text).not.toContain('Models:');
  });
});

describe('exportWords', () => {
  it("reads today's export keys, and the two new ones", () => {
    const keyed = exportWords((key, defaultValue) => `${key}|${defaultValue}`);
    expect(keyed.labels).toEqual({
      me: 'mainPanel.export.speakerYou|Me',
      other: 'mainPanel.export.speakerOther|Other',
      noTranslation: 'mainPanel.export.noTranslation|(no translation)',
      noSource: 'mainPanel.export.noSource|(no source)',
    });
    expect(keyed.header.narrowed).toBe('mainPanel.export.headerNarrowed|Note: this export was narrowed at export time — some lines were left out.');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/export`
Expected: FAIL — `./exporter` does not exist.

- [ ] **Step 3: The exporter**

In `src/utils/conversationExport.ts`, add `export` before `function formatLocalDateTime` and before `function formatLocalTime`. Create `src/lib/export/exporter.ts`:

```ts
/**
 * An export menu's view of one conversation (plan 1d-3): the new writer,
 * with the file header and the metadata of the conversation's own run. The
 * menu draws over this seam; today's conversation builds its own
 * (`ExportButton`) until plan 1e deletes it.
 */
import { formatLocalDateTime, formatLocalTime } from '../../utils/conversationExport';
import type { Leg } from '../conversation/types';
import type { Entry } from '../projection/types';
import type { ConversationInfo } from '../session/conversationSet';
import {
  renderTranscriptJson,
  renderTranscriptTxt,
  type TranscriptHeaderLabels,
  type TranscriptLabels,
  type TranscriptMeta,
  type TranscriptScope,
} from './transcript';

export interface Exporter {
  /** There is a conversation at all: the button's question, so a narrow scope never locks the menu. */
  readonly hasContent: boolean;
  /** The scope selects something: the actions' question. */
  hasScopedContent(scope: TranscriptScope): boolean;
  /** Plain text: the clipboard's without the header, a file's with it. */
  text(scope: TranscriptScope, withHeader: boolean): string;
  /** A .json file's content. */
  json(scope: TranscriptScope): string;
}

export interface ExportWords {
  labels: TranscriptLabels;
  header: TranscriptHeaderLabels;
}

/** The words an export writes: today's `mainPanel.export.*` keys, plus the two for a missing side. */
export function exportWords(t: (key: string, defaultValue: string) => string): ExportWords {
  return {
    labels: {
      me: t('mainPanel.export.speakerYou', 'Me'),
      other: t('mainPanel.export.speakerOther', 'Other'),
      noTranslation: t('mainPanel.export.noTranslation', '(no translation)'),
      noSource: t('mainPanel.export.noSource', '(no source)'),
    },
    header: {
      title: t('mainPanel.export.headerTitle', 'Sokuji conversation export'),
      generated: t('mainPanel.export.headerGenerated', 'Generated'),
      provider: t('mainPanel.export.headerProvider', 'Provider'),
      models: t('mainPanel.export.headerModels', 'Models'),
      source: t('mainPanel.export.headerSource', 'My Language'),
      target: t('mainPanel.export.headerTarget', "Other's Language"),
      narrowed: t('mainPanel.export.headerNarrowed', 'Note: this export was narrowed at export time — some lines were left out.'),
    },
  };
}

export interface ConversationExportInput {
  entries: readonly Entry[];
  legs: readonly Leg[];
  /** The conversation's run; null before any. */
  info: ConversationInfo | null;
  words: ExportWords;
  appVersion: string | null;
  /** The export's own moment: the header's "Generated" and the JSON's `exportedAt`. */
  now: () => number;
}

/** The run's models under the header's keys; a stage it did not name is left out. */
function modelsOf(info: ConversationInfo | null): Record<string, string> {
  const models: Record<string, string> = {};
  if (info?.models.asrModel) models.asr = info.models.asrModel;
  if (info?.models.translationModel) models.translation = info.models.translationModel;
  if (info?.models.ttsModel) models.tts = info.models.ttsModel;
  return models;
}

const formatTime = (ms: number) => `[${formatLocalTime(ms)}]`;

export function conversationExporter({ entries, legs, info, words, appVersion, now }: ConversationExportInput): Exporter {
  const meta = (): TranscriptMeta => ({ exportedAt: now(), appVersion, provider: info?.provider ?? null, models: modelsOf(info) });
  return {
    hasContent: renderTranscriptJson(entries, legs).groups.length > 0,
    hasScopedContent: (scope) => renderTranscriptJson(entries, legs, { scope }).groups.length > 0,
    text: (scope, withHeader) => renderTranscriptTxt(entries, legs, {
      labels: words.labels,
      formatTime,
      scope,
      ...(withHeader ? { header: { labels: words.header, meta: meta(), formatDateTime: formatLocalDateTime } } : {}),
    }),
    json: (scope) => JSON.stringify(renderTranscriptJson(entries, legs, { scope, meta: meta() }), null, 2),
  };
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/export src/utils` — PASS (`conversationExport.test.ts` unchanged). Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export src/utils/conversationExport.ts
git commit -m "feat(export): an exporter over the new conversation, with the run's header and metadata"
```

---

### Task 4: The export menu over an exporter

**Files:**
- Modify: `src/components/MainPanel/ExportButton.tsx`
- Create: `src/components/MainPanel/ExportMenuButton.test.tsx`

**Interfaces:**
- Consumes: Task 3's `Exporter`; `TranscriptScope` (Task 1).
- Produces: named export `ExportMenuButton(props: ExportMenuButtonProps)` with `ExportMenuButtonProps { exporter: Exporter; speakerMode: DisplayMode; participantMode: DisplayMode; popoverHost?: 'floating' | 'child-window' }`. The default export `ExportButton` keeps its props and behaviour exactly.

The menu's markup, keyboard ring, scope seeding, auto-save switch and child-window host do not change by a character; only where the text comes from changes. `ExportButton.test.tsx`, `ExportButton.childWindow.test.tsx` and `exportScopeStyles.test.ts` pass unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/MainPanel/ExportMenuButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Exporter } from '../../lib/export/exporter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, unknown>) => {
      let s = typeof def === 'string' ? def : key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => false,
  useSetAutoSaveOnStop: () => vi.fn(),
}));
vi.mock('../../utils/environment', async (orig) => ({ ...(await orig<Record<string, unknown>>()), isElectron: () => true }));
const downloadFile = vi.fn<(content: string, filename: string, mime: string) => void>();
const copyToClipboard = vi.fn<(text: string) => Promise<boolean>>(async () => true);
vi.mock('../../utils/conversationExport', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadFile: (content: string, filename: string, mime: string) => downloadFile(content, filename, mime),
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

const { ExportMenuButton } = await import('./ExportButton');

const fake = (over: Partial<Exporter> = {}): Exporter => ({
  hasContent: true,
  hasScopedContent: vi.fn(() => true),
  text: vi.fn((_scope, withHeader: boolean) => (withHeader ? 'FILE-TEXT' : 'CLIP-TEXT')),
  json: vi.fn(() => '{"groups":[]}'),
  ...over,
});
const open = () => fireEvent.click(screen.getByLabelText('Export conversation'));
const action = (name: string) => screen.getByRole('menuitem', { name });

beforeEach(() => {
  cleanup();
  downloadFile.mockClear();
  copyToClipboard.mockClear();
});

describe('ExportMenuButton', () => {
  it("copies the exporter's text without a header, under the scope seeded from the toolbar", async () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="translation" participantMode="both" />);
    open();
    await act(async () => { fireEvent.click(action('Copy to clipboard')); });
    expect(exporter.text).toHaveBeenCalledWith({ speaker: 'translation', participant: 'both' }, false);
    expect(copyToClipboard).toHaveBeenCalledWith('CLIP-TEXT');
  });

  it("downloads the .txt with the header and the .json, under today's file names", () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="both" participantMode="both" />);
    open();
    fireEvent.click(action('Download as .txt'));
    open();
    fireEvent.click(action('Download as .json'));
    expect(downloadFile.mock.calls[0]).toEqual(['FILE-TEXT', expect.stringMatching(/^sokuji-conversation-\d{8}-\d{6}\.txt$/), 'text/plain;charset=utf-8']);
    expect(downloadFile.mock.calls[1]).toEqual(['{"groups":[]}', expect.stringMatching(/^sokuji-conversation-\d{8}-\d{6}\.json$/), 'application/json']);
  });

  it('passes a cleared checkbox on as a narrower scope', () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="both" participantMode="both" />);
    open();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Me — Src' }));
    fireEvent.click(action('Download as .txt'));
    expect(exporter.text).toHaveBeenCalledWith({ speaker: 'translation', participant: 'both' }, true);
  });

  it('disables the actions, and says so, when the scope selects nothing of a conversation that exists', () => {
    render(<ExportMenuButton exporter={fake({ hasScopedContent: () => false })} speakerMode="both" participantMode="both" />);
    open();
    expect(action('Download as .txt')).toBeDisabled();
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/MainPanel/ExportMenuButton.test.tsx`
Expected: FAIL — `ExportMenuButton` is not exported.

- [ ] **Step 3: Split the component**

In `src/components/MainPanel/ExportButton.tsx`:

1. Imports: drop `buildTxtExport` from the `conversationExport` import; add

```ts
import type { Exporter } from '../../lib/export/exporter';
import type { TranscriptScope } from '../../lib/export/transcript';
```

2. After `interface ExportButtonProps { … }`, add:

```ts
export interface ExportMenuButtonProps {
  /** What the menu exports: the new conversation's, or a legacy one built from today's items (below). */
  exporter: Exporter;
  /** Speaker-side toolbar filter. Seeds the scope checkboxes; never written back. */
  speakerMode: DisplayMode;
  /** Participant-side toolbar filter. Seeds the scope checkboxes; never written back. */
  participantMode: DisplayMode;
  /** See `ExportButtonProps.popoverHost`. */
  popoverHost?: 'floating' | 'child-window';
}
```

3. Replace `const ExportButton: React.FC<ExportButtonProps> = ({` … `}) => {` (the component's opening, with its nine destructured props) with

```ts
/** The export menu: scope checkboxes, the three actions and the auto-save switch, over an `Exporter` (plan 1d-3). */
export function ExportMenuButton({ exporter, speakerMode, participantMode, popoverHost = 'floating' }: ExportMenuButtonProps) {
```

and its closing `};` (just before `export default ExportButton;`) with `}`.

4. Replace everything from the comment `// Apply the scope with the same predicate the conversation view uses, so` down to and including `const scopeHasContent = normalizedMessages.length > 0;` with:

```ts
  const scope: TranscriptScope = useMemo(
    () => ({ speaker: togglesToMode(speaker), participant: togglesToMode(participant) }),
    [speaker, participant],
  );

  // Two different questions. The button asks "is there a conversation at all",
  // so a filter that currently selects nothing cannot lock the user out of the
  // menu that would let them widen it. The actions ask "does the current scope
  // select anything".
  const hasContent = exporter.hasContent;
  const scopeHasContent = useMemo(() => exporter.hasScopedContent(scope), [exporter, scope]);
```

(the two `useState<ScopeToggles>` lines and their comment stay above it).

5. Delete the `txtI18n` memo (`// Collect i18n strings once per render.` and the line after it) and the `exportInput` callback (its doc comment through its closing `]);`). Replace the three handlers with:

```ts
  const handleCopy = useCallback(async () => {
    closeMenu();
    // The text is taken before the await, so the copy is the scope as clicked.
    const ok = await copyToClipboard(exporter.text(scope, false));
    if (ok) {
      showToast(t('mainPanel.export.copySuccess', 'Conversation copied to clipboard'), { variant: 'success' });
    } else {
      showToast(t('mainPanel.export.copyFailed', 'Failed to copy. Check browser permissions.'), { variant: 'error', durationMs: 4000 });
    }
  }, [exporter, scope, showToast, t, closeMenu]);

  const handleDownloadTxt = useCallback(() => {
    closeMenu();
    downloadFile(exporter.text(scope, true), exportFilename('txt'), 'text/plain;charset=utf-8');
  }, [exporter, scope, closeMenu]);

  const handleDownloadJson = useCallback(() => {
    closeMenu();
    downloadFile(exporter.json(scope), exportFilename('json'), 'application/json');
  }, [exporter, scope, closeMenu]);
```

6. Before `export default ExportButton;`, add today's component over a legacy exporter:

```tsx
/**
 * Today's export over today's conversation items: the menu above, over an
 * exporter that writes exactly what this component wrote before plan 1d-3.
 * `MainPanel` and `SubtitleApp` render this; plan 1e deletes it.
 */
const ExportButton: React.FC<ExportButtonProps> = ({
  combinedItems,
  speakerMode,
  participantMode,
  provider,
  currentProviderSettings,
  localInferenceSettings,
  sourceLanguage,
  targetLanguage,
  popoverHost = 'floating',
}) => {
  const { t } = useTranslation();
  const txtI18n: TxtI18n = useMemo(() => buildTxtI18n((key, def) => t(key, def)), [t]);
  const exporter: Exporter = useMemo(() => {
    // The scope is applied with the same predicate the conversation view
    // uses, so "what the file contains" and "what the screen shows" can never
    // drift apart by having two filters to keep in step.
    const scoped = (scope: TranscriptScope) =>
      combinedItems.filter((item) => shouldShowItem(item, scope.speaker, scope.participant));
    const input = (scope: TranscriptScope): ExportInput => ({
      items: scoped(scope),
      provider,
      providerSettings: currentProviderSettings,
      localInferenceSettings,
      fallbackLanguages: { sourceLanguage, targetLanguage },
      // Recorded so the file says whether it is the whole conversation. A full
      // scope is dropped inside buildSessionMetadata.
      scope: { speaker: scope.speaker, participant: scope.participant },
    });
    return {
      hasContent: normalizeMessages(combinedItems).length > 0,
      hasScopedContent: (scope) => normalizeMessages(scoped(scope)).length > 0,
      text: (scope, withHeader) => {
        const { messages, metadata } = buildExportPayload(input(scope));
        return formatAsTxt(messages, metadata, txtI18n, { includeHeader: withHeader });
      },
      json: (scope) => {
        const { messages, metadata } = buildExportPayload(input(scope));
        return formatAsJson(messages, metadata);
      },
    };
  }, [combinedItems, provider, currentProviderSettings, localInferenceSettings, sourceLanguage, targetLanguage, txtI18n]);
  return (
    <ExportMenuButton exporter={exporter} speakerMode={speakerMode} participantMode={participantMode} popoverHost={popoverHost} />
  );
};
```

(`formatAsTxt(…, { includeHeader: true })` is what `buildTxtExport` returned as `content`; its `filename` was `exportFilename('txt')`, which the menu now asks for itself.)

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/components/MainPanel src/components/Subtitle` — PASS, the old export tests unchanged. Then `npx vitest run src` (0 failed) and the typecheck gate (11 lines).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/ExportButton.tsx src/components/MainPanel/ExportMenuButton.test.tsx
git commit -m "refactor(export): draw the export menu over an exporter; today's button builds a legacy one"
```

---

### Task 5: Auto-save from the run's end

**Files:**
- Modify: `src/lib/transcript/autoSave.ts`
- Create: `src/lib/export/appAutoSave.ts`, `src/lib/export/appAutoSave.test.ts`

**Interfaces:**
- Consumes: Task 3's `conversationExporter`, `exportWords`; Task 2's `ConversationInfo`; `createProjector`, `DEFAULT_PROJECTION` (`src/lib/projection/project.ts`); `AutoSaveNotifier`, `AutoSaveOutcome` (`src/lib/transcript/autoSave.ts`).
- Produces: `saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'>` and `saveFailed(error: unknown, notify: AutoSaveNotifier): 'failed'` (both exported from `autoSave.ts`); `autoSaveConversation(legs: readonly Leg[], info: ConversationInfo | null, notify: AutoSaveNotifier, now?: () => number): Promise<AutoSaveOutcome>` (Task 7 calls it from the preview runner's `onRunEnded`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/appAutoSave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Leg, Segment } from '../conversation/types';

const state = { autoSaveOnStop: true };
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
let electron = false;
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

import { autoSaveConversation } from './appAutoSave';

const seg = (over: Partial<Segment>): Segment => ({ id: 'x', ref: 1, side: 'source', text: '', final: true, openedAt: 1_700_000_000_000, marks: [], speech: [], ...over });
const legs: Leg[] = [{
  leg: 'speaker', session: 'r', languages: { source: 'ja', target: 'zh' }, notices: [],
  segments: [
    seg({ id: 'r:speaker:1', text: '今日は天気がいいですね。公園に行きましょう。', origin: 'c1' }),
    seg({ id: 'r:speaker:2', side: 'translation', text: '今天天气很好。我们去公园吧。', origin: 'c1' }),
  ],
}];
const info = { provider: 'fake', models: { asrModel: 'fake' } };
const invoke = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  state.autoSaveOnStop = true;
  electron = false;
  invoke.mockReset();
  showToast.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
  (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
});

describe('autoSaveConversation', () => {
  it('saves the whole conversation, header first, one block per exchange', async () => {
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('saved');
    const [content, filename, mime] = downloadFile.mock.calls[0];
    expect(content).toMatch(/^Sokuji conversation export\nGenerated: /);
    expect(content).toContain('Provider: fake\nModels: asr=fake\n');
    expect(content).toMatch(/\[\d{2}:\d{2}:\d{2}\] Me\n  今日は天気がいいですね。公園に行きましょう。\n  → 今天天气很好。我们去公园吧。\n/);
    expect(filename).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
    expect(mime).toBe('text/plain;charset=utf-8');
  });

  it('does nothing while the switch is off, or when nothing was said', async () => {
    state.autoSaveOnStop = false;
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('disabled');
    state.autoSaveOnStop = true;
    expect(await autoSaveConversation([{ ...legs[0], segments: [] }], info, { showToast })).toBe('empty');
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("desktop: hands the text to the main process and offers the folder, as today's auto-save does", async () => {
    electron = true;
    invoke.mockResolvedValueOnce({ ok: true, path: '/home/u/Downloads/sokuji-conversation-20260924-100100.txt', dir: '/home/u/Downloads' });
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('saved');
    expect(invoke).toHaveBeenCalledWith('transcript:save', { content: expect.stringContaining('今天天气很好。我们去公园吧。') });
    expect(showToast.mock.calls[0][0]).toBe('Conversation saved: sokuji-conversation-20260924-100100.txt');
  });

  it('reports a failed save and tells the user how to save by hand', async () => {
    electron = true;
    invoke.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('failed');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toMatchObject({ variant: 'error' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/export/appAutoSave.test.ts`
Expected: FAIL — `./appAutoSave` does not exist.

- [ ] **Step 3: Extract today's saving branch**

In `src/lib/transcript/autoSave.ts`, split `autoSaveTranscript` in three without changing what it does (its seven tests in `autoSave.test.ts` guard this):

```ts
/** A failed save, reported and told to the user with the way to save by hand. */
export function saveFailed(error: unknown, notify: AutoSaveNotifier): 'failed' {
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

/**
 * Saves a finished conversation's text: on Electron through the main process
 * into Downloads, with a toast that can show the folder; in a browser as a
 * download, whose own UI is the confirmation. Never rejects.
 */
export async function saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'> {
  try {
    // … today's body from `if (!isElectron()) {` through the success toast and
    // its `return 'saved';`, moved here unchanged …
  } catch (error) {
    return saveFailed(error, notify);
  }
}

export async function autoSaveTranscript(items: ExportItem[], notify: AutoSaveNotifier): Promise<AutoSaveOutcome> {
  let text: { content: string; filename: string };
  try {
    const settings = useSettingsStore.getState();
    if (!settings.autoSaveOnStop) return 'disabled';
    if (normalizeMessages(items).length === 0) return 'empty';
    const providerSettings = settings.getCurrentProviderSettings();
    text = buildTxtExport(/* … today's arguments, unchanged … */);
  } catch (error) {
    return saveFailed(error, notify);
  }
  return saveTranscriptText(text.content, text.filename, notify);
}
```

(The `/* … */` and `// …` lines above name code that already exists in the file and moves as it is — write it out in full, not as comments. Keep `autoSaveTranscript`'s doc comment.)

- [ ] **Step 4: The new auto-save**

Create `src/lib/export/appAutoSave.ts`:

```ts
/**
 * The session-end auto-save over the new conversation (plan 1d-3): the
 * runner's `onRunEnded` hands over the legs, and the whole conversation —
 * both sides, every leg, header first — goes through today's saving branch.
 * The Export menu's scope never applies here, as today.
 */
import useSettingsStore from '../../stores/settingsStore';
import i18n from '../../locales';
import { exportFilename, getAppVersion } from '../../utils/conversationExport';
import type { Leg } from '../conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '../projection/project';
import type { ConversationInfo } from '../session/conversationSet';
import { saveFailed, saveTranscriptText, type AutoSaveNotifier, type AutoSaveOutcome } from '../transcript/autoSave';
import { conversationExporter, exportWords } from './exporter';
import { FULL_SCOPE } from './transcript';

export async function autoSaveConversation(
  legs: readonly Leg[],
  info: ConversationInfo | null,
  notify: AutoSaveNotifier,
  now: () => number = Date.now,
): Promise<AutoSaveOutcome> {
  let content: string;
  try {
    if (!useSettingsStore.getState().autoSaveOnStop) return 'disabled';
    const exporter = conversationExporter({
      // The export writes each segment whole, so the stored cut never reaches
      // it: the default projection groups exactly as the app's does.
      entries: createProjector().project(legs, DEFAULT_PROJECTION),
      legs,
      info,
      words: exportWords((key, defaultValue) => i18n.t(key, { defaultValue })),
      appVersion: getAppVersion(),
      now,
    });
    if (!exporter.hasContent) return 'empty';
    content = exporter.text(FULL_SCOPE, true);
  } catch (error) {
    return saveFailed(error, notify);
  }
  return saveTranscriptText(content, exportFilename('txt', now()), notify);
}
```

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/lib/export src/lib/transcript` — PASS, `autoSave.test.ts` and the `sessionEndAutoSave*` tests unchanged. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/transcript/autoSave.ts src/lib/export
git commit -m "feat(export): auto-save the new conversation through today's saving branch"
```

---

### Task 6: The idle line, the exporter hook and the subtitle bar's export

**Files:**
- Create: `src/lib/view/lastEnd.ts`, `src/lib/view/lastEnd.test.ts`, `src/components/Conversation/useConversationExporter.ts`
- Modify: `src/components/Subtitle/SubtitleBar.tsx`, `src/components/Subtitle/SubtitleView.tsx`
- Test: `src/components/Subtitle/SubtitleBar.test.tsx`, `src/components/Subtitle/SubtitleView.test.tsx`

**Interfaces:**
- Consumes: `RunState` (`src/lib/session/types.ts`), `DisplayItem` (`src/lib/view/filter.ts`), Task 3's `Exporter` / `conversationExporter` / `exportWords`, Task 4's `ExportMenuButton` / `ExportMenuButtonProps`.
- Produces: `lastEndItem(state: RunState): DisplayItem | null`; `useConversationExporter(view: ConversationViewState, info: ConversationInfo | null): Exporter`; `SubtitleBar`'s `exportMenu?: Omit<ExportMenuButtonProps, 'popoverHost'>`; `SubtitleView`'s `exporter?: Exporter`. Task 7 uses all four.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/view/lastEnd.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lastEndItem } from './lastEnd';

describe('lastEndItem', () => {
  it('says why the last start was refused, as an error notice after the list', () => {
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_provider', message: 'No provider is chosen, or it has not loaded.' } } })).toEqual({
      kind: 'notice',
      notice: { kind: 'notice', id: 'last-end', leg: 'speaker', severity: 'error', code: 'no_provider', message: 'No provider is chosen, or it has not loaded.', at: 0 },
    });
  });

  it("keeps a failed start's leg and detail", () => {
    const item = lastEndItem({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket closed', leg: 'participant' } } });
    expect(item?.kind === 'notice' && item.notice).toMatchObject({ leg: 'participant', code: 'start_failed', message: 'socket closed' });
  });

  it('says nothing while a run is on, after a stop, or for an end its legs already record', () => {
    expect(lastEndItem({ phase: 'running', since: 0, legs: {} })).toBeNull();
    expect(lastEndItem({ phase: 'idle' })).toBeNull();
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'user' } })).toBeNull();
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'x' } } })).toBeNull();
  });
});
```

In `src/components/Subtitle/SubtitleBar.test.tsx`, give the `ExportButton` mock a named export beside its default, and add a test to the export `describe` (the one holding `'renders no export button without exportProps'`):

```tsx
vi.mock('../MainPanel/ExportButton', () => ({
  default: () => require('react').createElement('div', { 'data-testid': 'export-button' }),
  ExportMenuButton: (p: { popoverHost?: string }) =>
    require('react').createElement('div', { 'data-testid': 'export-menu-button', 'data-host': p.popoverHost }),
}));
```

```tsx
  it("renders the new view's export menu in its own window, on the electron surface only", () => {
    const { exportProps: _unused, ...withoutExport } = baseProps;
    const exportMenu = { exporter: {} as any, speakerMode: 'both' as const, participantMode: 'both' as const };
    render(<SubtitleBar {...withoutExport} exportMenu={exportMenu} surface="electron" />);
    expect(screen.getByTestId('export-menu-button').dataset.host).toBe('child-window');
    cleanup();
    render(<SubtitleBar {...withoutExport} exportMenu={exportMenu} surface="extension-overlay" />);
    expect(screen.queryByTestId('export-menu-button')).not.toBeInTheDocument();
  });
```

In `src/components/Subtitle/SubtitleView.test.tsx`, add `exportMenu?: unknown` to the `SubtitleBar` stub's props type and `'data-export': p.exportMenu ? 'yes' : 'no'` to its attributes, then add:

```tsx
  it('hands the bar an export menu over the exporter it was given, and none without one', () => {
    const exporter = { hasContent: true, hasScopedContent: () => true, text: () => '', json: () => '' };
    render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} exporter={exporter} />);
    expect(screen.getByTestId('bar').dataset.export).toBe('yes');
    cleanup();
    render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(screen.getByTestId('bar').dataset.export).toBe('no');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/view/lastEnd.test.ts src/components/Subtitle/SubtitleBar.test.tsx src/components/Subtitle/SubtitleView.test.tsx`
Expected: FAIL — `./lastEnd` does not exist; no `exportMenu` / `exporter` props.

- [ ] **Step 3: The idle line**

Create `src/lib/view/lastEnd.ts`:

```ts
/**
 * Why the last start did not happen, drawn after the list (plan 1d-3). A
 * refused or failed start is recorded only on the runner's idle state — a
 * refused one keeps the last conversation, a failed one leaves empty legs —
 * so nothing else on screen would say it. A run that ended on its own
 * already carries its notice on a leg, and says nothing here.
 */
import type { RunState } from '../session/types';
import type { DisplayItem } from './filter';

export function lastEndItem(state: RunState): DisplayItem | null {
  if (state.phase !== 'idle' || !state.lastEnd?.notice) return null;
  const { reason, notice } = state.lastEnd;
  if (reason !== 'refused' && reason !== 'start-failed') return null;
  return {
    kind: 'notice',
    notice: {
      kind: 'notice',
      id: 'last-end',
      leg: notice.leg ?? 'speaker',
      severity: 'error',
      message: notice.message,
      ...(notice.code !== undefined ? { code: notice.code } : {}),
      ...(notice.params ? { params: notice.params } : {}),
      at: 0,
    },
  };
}
```

- [ ] **Step 4: The exporter hook**

Create `src/components/Conversation/useConversationExporter.ts`:

```ts
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationExporter, exportWords, type Exporter } from '../../lib/export/exporter';
import type { ConversationInfo } from '../../lib/session/conversationSet';
import type { ConversationViewState } from '../../lib/view/conversationView';
import { getAppVersion } from '../../utils/conversationExport';

/** The export menu's exporter over a conversation view: a new one only when the view's legs or entries change. */
export function useConversationExporter({ legs, entries }: ConversationViewState, info: ConversationInfo | null): Exporter {
  const { t } = useTranslation();
  const words = useMemo(() => exportWords((key, defaultValue) => t(key, defaultValue)), [t]);
  return useMemo(
    () => conversationExporter({ entries, legs, info, words, appVersion: getAppVersion(), now: Date.now }),
    [entries, legs, info, words],
  );
}
```

- [ ] **Step 5: The subtitle bar's export**

In `src/components/Subtitle/SubtitleBar.tsx`: import `ExportMenuButton` and `type ExportMenuButtonProps` from `'../MainPanel/ExportButton'` beside the default import; change the `exportProps` comment to `// today's SubtitleApp: the export over its items` and add after it:

```ts
  /** The new subtitle view's export (plan 1d-3): the menu over its conversation's exporter. */
  exportMenu?: Omit<ExportMenuButtonProps, 'popoverHost'>;
```

destructure `exportMenu`, and after the existing `{surface === 'electron' && exportProps && …}` line add:

```tsx
        {surface === 'electron' && exportMenu && <ExportMenuButton {...exportMenu} popoverHost="child-window" />}
```

In `src/components/Subtitle/SubtitleView.tsx`: take `exporter?: Exporter` (import the type from `'../../lib/export/exporter'`) as a fourth prop, with the doc line "The conversation's export, Electron only: the overlay's tail is not the whole conversation.", and pass the bar `exportMenu={exporter ? { exporter, speakerMode: speaker, participantMode: participant } : undefined}` (`speaker` / `participant` are the subtitle display modes it already reads).

- [ ] **Step 6: Run the tests, then the gates**

Run: `npx vitest run src/lib/view src/components/Subtitle src/components/Conversation` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate — still the same 11 lines (the six `SubtitleBar.test.tsx` lines move, but the gate strips positions).

- [ ] **Step 7: Commit**

```bash
git add src/lib/view src/components/Conversation src/components/Subtitle
git commit -m "feat(view): the idle line for a refused or failed start; the subtitle view's export menu"
```

---

### Task 7: The preview's export, auto-save and idle line, checked headlessly

**Files:**
- Modify: `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`
- Create: `scripts/dev/spine-export-probe.mjs`

**Interfaces:**
- Consumes: `autoSaveConversation` (Task 5), `lastEndItem`, `useConversationExporter`, `ExportMenuButton`, `SubtitleView`'s `exporter` (Task 6), `runner.conversation.info` (Task 2).
- Produces: preview parameters `&autosave=1` (turns the stored auto-save switch on before the run) and `&refuse=1` (the preview runner reads no shape, so every start is refused with `no_provider`); the probe.

- [ ] **Step 1: The preview**

In `src/components/dev/SpinePreview.tsx`:

1. The bridge gains a notifier, set from the page's toast:

```ts
const bridge: { …; notify: AutoSaveNotifier } = {
  …,
  notify: { showToast: () => {} },
};
```

and in `SpinePreview`, beside `bridge.track = …`: `bridge.notify = { showToast };` with `const { showToast } = useToast();` (from `'../Toast'`).

2. `getPreviewRunner`'s `createRunner` gets:

```ts
    // `&refuse=1`: no shape, so every start is refused — the idle line's check.
    readShape: () => (new URLSearchParams(window.location.search).get('refuse') === '1' ? null : readShapeFromStores(bridge.auth)),
    …
    onRunEnded: (legs) => autoSaveConversation(legs, getPreviewRunner().conversation.info, bridge.notify),
```

3. `PreviewConversation` takes `runner: Runner` too; above the list it draws today's toolbar markup with the menu, and after the items the idle line:

```tsx
  const runState = useStore(runner.state);
  const viewState = useReadable(view);
  const exporter = useConversationExporter(viewState, runner.conversation.info);
  const items = useMemo(() => {
    const drawn = displayItems(entries, { speaker, participant });
    const last = lastEndItem(runState);
    return last ? [...drawn, last] : drawn;
  }, [entries, speaker, participant, runState]);
  …
      <div className="conversation-toolbar">
        <ExportMenuButton exporter={exporter} speakerMode={speaker} participantMode={participant} />
      </div>
      <ConversationList … />
```

(`const { legs, entries } = viewState;` replaces the existing `useReadable(view)` line, so the view is read once.) `SpinePreview` passes `runner={runner}`.

4. `PreviewSubtitle` takes `info: ConversationInfo | null`; its `const { entries } = useReadable(view);` becomes `const viewState = useReadable(view); const { entries } = viewState; const exporter = useConversationExporter(viewState, info);`, and it passes `exporter={exporter}` to `SubtitleView`. `SpinePreview` passes `info={runner.conversation.info}` (read during render: a start replaces it, and a start also changes the phase this component subscribes to).

5. In the autostart effect, beside the `&compact=1` line:

```ts
    // `&autosave=1`: the stored auto-save switch, on — the run's end saves the conversation.
    if (params.get('autosave') === '1') void useSettingsStore.getState().setAutoSaveOnStop(true);
```

6. In `SpinePreview.scss`, inside `.spine-conversation`'s block: `.conversation-toolbar { justify-content: flex-end; }` only if the toolbar does not already sit right-aligned in the rendered page (look before adding anything).

- [ ] **Step 2: The probe**

Create `scripts/dev/spine-export-probe.mjs`:

```js
#!/usr/bin/env node
/**
 * Plays the preview's `cjk` script in headless Chromium and exports it two
 * ways (plan 1d-3): the export menu's "Download as .txt" while the run is
 * on, and the session-end auto-save after Stop. Both files must carry the
 * header, the run's provider and models, and one block with the source
 * whole (no space inside the Japanese) and its translation. Then a refused
 * start (`&refuse=1`) must leave the idle line in words.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-export-probe.mjs [origin] [screenshot.png]
 *
 * Default origin: http://localhost:5199. Exits 1 on any miss.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep, withPage } from './headless.mjs';

const origin = process.argv[2] ?? 'http://localhost:5199';
const screenshot = process.argv[3] ?? null;
// `NOTICE_WORDS.no_provider` (src/lib/view/noticeText.ts).
const NO_PROVIDER_WORDS = 'Choose a provider in Settings before starting.';
const BLOCK = /\[\d{2}:\d{2}:\d{2}\] Me\n  今日は天気がいいですね。公園に行きましょう。\n  → 今天天气很好。我们去公园吧。\n/;

const click = (send, js) => evaluate(send, `(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;

async function waitForFiles(dir, count, ms) {
  for (let waited = 0; waited < ms; waited += 250) {
    const done = readdirSync(dir).filter((f) => f.endsWith('.txt'));
    if (done.length >= count) return done.sort();
    await sleep(250);
  }
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
}

function check(label, text, failures) {
  const want = [
    ['the header title', text.startsWith('Sokuji conversation export\n')],
    ['the provider', text.includes('\nProvider: fake\n')],
    ['the models', text.includes('\nModels: asr=fake, translation=fake, tts=fake\n')],
    ['the block', BLOCK.test(text)],
  ];
  for (const [what, ok] of want) if (!ok) failures.push(`${label}: missing ${what}`);
}

const failures = [];
const downloads = mkdtempSync(join(tmpdir(), 'spine-export-'));

await withPage(`${origin}/?preview=spine&autostart=1&script=cjk&autosave=1`, async (send) => {
  const allowed = await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  if (allowed.error) await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  // Until the cjk exchange's translation is drawn whole, then a beat for the source to close.
  for (let waited = 0; waited < 12000; waited += 250) {
    await sleep(250);
    if (await evaluate(send, `!!document.querySelector('.spine-conversation .conversation-display')?.textContent.includes('我们去公园吧。')`)) break;
  }
  await sleep(1000);
  if (!(await click(send, `document.querySelector('.spine-conversation .export-btn')`))) failures.push('no export button in the panel');
  await sleep(300);
  if (!(await click(send, byText('[role="menuitem"]', 'Download as .txt')))) failures.push('no "Download as .txt" in the menu');
  const manual = await waitForFiles(downloads, 1, 5000);
  if (manual.length < 1) failures.push('the export menu saved no file');
  else check('export menu', readFileSync(join(downloads, manual[0]), 'utf8'), failures);
  await sleep(1100); // a different second, so the auto-saved file gets its own name
  if (!(await click(send, byText('button', 'Stop')))) failures.push('no Stop button');
  const all = await waitForFiles(downloads, 2, 8000);
  const saved = all.filter((f) => !manual.includes(f));
  if (saved.length < 1) failures.push('the run ended but auto-save wrote no file');
  else check('auto-save', readFileSync(join(downloads, saved[0]), 'utf8'), failures);
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
});

await withPage(`${origin}/?preview=spine&autostart=1&refuse=1`, async (send) => {
  let words = [];
  for (let waited = 0; waited < 8000 && words.length === 0; waited += 250) {
    await sleep(250);
    words = (await evaluate(send, `[...document.querySelectorAll('.conversation-display .message-bubble.error .message-content')].map((b) => b.textContent)`)) ?? [];
  }
  if (!words.includes(NO_PROVIDER_WORDS)) failures.push(`the refused start drew ${JSON.stringify(words)}, not the idle line`);
});

console.log(failures.length === 0 ? `ok — both files and the idle line (files in ${downloads})` : failures.join('\n'));
process.exitCode = failures.length === 0 ? 0 : 1;
```

- [ ] **Step 3: Run it**

```
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # background
node scripts/dev/spine-export-probe.mjs http://localhost:5199 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d3-export.png
```

Expected: `ok — both files and the idle line`. Look at the screenshot: the export button sits in the panel's toolbar as it does in the app (right of the list's top edge, today's `.export-btn` look). If a check fails, fix the cause, not the probe — the probe's expectations are this plan's contract. If the download reaches the directory under a different mechanism in this Chromium build (for example only after `Browser.setDownloadBehavior` with `eventsEnabled`), adjust the probe's setup, never its assertions.

- [ ] **Step 4: The gates**

`npx vitest run src` (0 failed) and the typecheck gate (11 lines).

- [ ] **Step 5: Commit**

```bash
git add src/components/dev scripts/dev/spine-export-probe.mjs
git commit -m "test(dev): export and auto-save from the preview, and the idle line, checked headlessly"
```
