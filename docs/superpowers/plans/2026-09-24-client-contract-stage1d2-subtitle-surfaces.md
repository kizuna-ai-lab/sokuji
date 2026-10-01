# Client contract — Stage 1d-2: the subtitle surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two subtitle surfaces rebuilt on L2's `Entry[]` and the runner: compact bands that join text as it was written, the subtitle session as plain data, one typed wire that carries entries, session and karaoke to the extension overlay (and hold-to-talk back), and a new subtitle view shared by the Electron takeover and the overlay — rendered in the development preview (the overlay inside an iframe, fed over a real `MessageChannel`) and checked in headless Chromium.

**Architecture:** Pure pieces in `src/lib/subtitle`: `buildBands` (the four compact bands), `subtitleSession` (what a surface needs from the run, serializable), and `wire.ts` (the protocol, a publisher for the side panel, a receiver for the overlay, and port adapters for `MessagePort` and `chrome.runtime.Port`). `src/components/Subtitle` gains `SubtitleBands`, `SubtitleView` and `HoldToTalk`; the window handling today's `SubtitleApp` does (auto-hiding bar, Escape, Electron fullscreen and bounds, overlay resize handles) moves into a `useSubtitleChrome` hook both views use. The old `SubtitleApp` / `SubtitleStream` keep serving the app until plan 1e swaps the Electron takeover and the extension's overlay entry over to the new view.

**Tech Stack:** TypeScript (strict), React 18, zustand, react-i18next, Vitest + @testing-library/react (jsdom), Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — read "The two subtitle surfaces are not the same thing" (through "`origin` inference lives here"), "Surfaces emit press and release", "Invariants the new structure must state", "UI rules deferred to the UI work", and "Notices reach the user localized". Plan 1d-1 (`docs/superpowers/plans/2026-09-24-client-contract-stage1d1-conversation-view.md`) built what this plan consumes; its "Rulings" section still holds. The roadmap's "Scheduled by plan 1d-1" → 1d-2 lists two items this plan takes up.

## Global Constraints

- Today's subtitle components change only where Task 4 says: `SubtitleApp.tsx` (its window handling moves into `useSubtitleChrome`, behaviour unchanged), `SubtitleBar.tsx` (`exportProps` optional) and `SubtitleIdle.tsx` / `subtitleIdleState.ts` (an `unready` variant). `SubtitleStream.tsx`, the surfaces under `src/components/Subtitle/surfaces/`, `sessionPortMirror.ts`, `subtitle-overlay-entry.tsx`, `src/types/subtitleWire.ts`, `MainLayout`, `MainPanel`, `electron/**` and `extension/**` are read only.
- `src/lib/**` never imports React. Under `src/lib`, only `src/lib/view/appViewSettings.ts` and `src/lib/subtitle/appSession.ts` read a store.
- No new locale keys: reuse `subtitle.*`, `simplePanel.holdToSpeak` / `simplePanel.release`, `mainPanel.*` and `notices.*` (every locale has them). If a task finds it truly needs a key, it adds it to all 30 locales, translated (`locales.consistency.test.ts` enforces parity).
- Record a caught failure with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`; never `console.error` / `console.warn`. Per-message paths report once per failing streak.
- Match the markup and class names of the nearest existing instance of each control (today's `SubtitleStream` bands and `SubtitleApp` layout); new components import today's stylesheets (`SubtitleApp.scss`, `SubtitleStream.scss`, `karaoke.scss`).
- New React components are tested with `@testing-library/react`, mocking `react-i18next` as the existing Subtitle tests do.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the four baseline lines:

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/environment|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  Baseline: `src/App.tsx: error TS6133: 'React'…`; `src/lib/analytics.ts: error TS6133: 'response'…`; `src/utils/environment.ts: error TS2717…`; `src/utils/environment.ts: error TS2339…`. (Adding `components/Subtitle` to the pattern must not add a line; if it surfaces an error older than this plan in an untouched file, report it rather than fixing it.)
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. Never push.

## Rulings this plan makes

1. **Beside, not over.** The new view is built beside today's; the old one keeps serving the Electron takeover and the extension overlay until 1e. Only Task 4's three edits touch old subtitle files, and the old tests guard them.
2. **Compact bands join text as it was written** (spec: "The ranges tile the segment's text"): rows of one segment concatenated as they are; a segment's outer whitespace trimmed where it meets another segment or a band's end; between segments a space only where `needsSpace` says. A notice goes into its leg's translation band, as today's error rows do (a UI rule the rendered pages settle). A newly arrived stretch is highlighted once, keyed by its segment — rows re-cut, segments do not, and segment ids carry the session, so the highlight map never collides across sessions.
3. **The expanded subtitle mode is the panel's list** — `ConversationList` with the subtitle's own display modes and no replay slot (today's expanded subtitle has none either).
4. **Idle, first match wins:** a start under way → the spinner; a provider not ready → its reason (a new `unready` variant with the `blocked` markup, its action inert — nothing maps a readiness reason to a settings page until 1e); a start that was refused or failed → `failed`, the notice in words; any other end → `ended` (a run that failed mid-way ended — its notice is in the conversation; today such a run read "Failed to start"); nothing yet → `ready`. `stopping` shows `ended`.
5. **The overlay's wire** carries the merged tail of `Entry[]` (the last 30 entries — spec invariant: sliced after the merge, never per leg), the subtitle session and karaoke; back come `subtitle:request-clear`, `subtitle:user-exit`, `subtitle:turn-press`, `subtitle:turn-release`. The overlay stays read-only for start and stop (today it is too), so its idle body stays today's "Session ended" view.
6. **Hold-to-talk:** on the overlay, a button under the bands while a run is live with manual turns — pointer down, up, leave and cancel, releasing on unmount. The "Press Space to speak" hint shows only on the Electron takeover (spec: "Surfaces emit press and release").
7. **The live wiring is 1e's:** the side panel's surface class publishing over `chrome.runtime`, the overlay entry receiving, the Electron takeover mounting the new view, and the Space key. They replace live code; this plan provides `chromePortWire` so 1e only wires them.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/subtitle/bands.ts` (new) | 1 | `buildBands`, `BandPiece`, `Band`, `BAND_MAX_CHARS` |
| `src/lib/subtitle/session.ts` (new) | 2 | `SubtitleSession`, `SubtitleIdleModel`, `idleOf`, `subtitleSession`, `sameSession` |
| `src/lib/subtitle/appSession.ts` (new) | 2 | `appSubtitleSession(runner, view)` — the one store reader here |
| `src/lib/subtitle/wire.ts` (new) | 3 | `WirePort`, `ToOverlay`, `ToPanel`, `publishSubtitles`, `receiveSubtitles`, `messagePortWire`, `chromePortWire`, `OVERLAY_ENTRIES` |
| `src/components/Subtitle/useSubtitleChrome.tsx` (new) | 4 | the window handling, moved out of `SubtitleApp` |
| `src/components/Subtitle/SubtitleApp.tsx`, `SubtitleBar.tsx`, `SubtitleIdle.tsx`, `subtitleIdleState.ts` | 4 | uses the hook; optional export; `unready` |
| `src/components/Subtitle/SubtitleBands.tsx` (new) | 5 | `SubtitleBands`, `SubtitleBody` |
| `src/components/Subtitle/SubtitleView.tsx`, `HoldToTalk.tsx` (new), `SubtitleApp.scss` | 6 | the new view; the hold button and its two rules |
| `src/components/dev/OverlayPreview.tsx` (new), `SpinePreview.tsx`, `SpinePreview.scss`, `src/App.tsx` | 7 | the preview's subtitle view and overlay iframe |
| `scripts/dev/spine-subtitle-probe.mjs` (new) | 7 | the headless check of both surfaces |

---
### Task 1: The compact bands

**Files:**
- Create: `src/lib/subtitle/bands.ts`, `src/lib/subtitle/bands.test.ts`

**Interfaces:**
- Consumes: `Entry`, `Row` (`src/lib/projection/types.ts`: rows carry `text`, `start`, `segmentId`), `needsSpace` (`src/lib/projection/join.ts`), `showsSide`, `LegFilters`, `NoticeEntry` (`src/lib/view/filter.ts`).
- Produces: `BandPiece { key; text; before: '' | ' '; segmentId?; start?; notice? }`, `Band { id; leg; side; pieces }`, `buildBands(entries, filters, words: (notice) => string, maxChars?) → Band[]`, `BAND_MAX_CHARS = 2000`. Task 5 draws them.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/subtitle/bands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Entry, Row } from '../projection/types';
import type { LegFilters, NoticeEntry } from '../view/filter';
import { buildBands, type Band } from './bands';

const row = (segmentId: string, k: number, start: number, text: string, side: 'source' | 'translation' = 'source'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start, end: start + text.length, text, final: true });
const exchange = (id: string, leg: 'speaker' | 'participant', source: Row[], translation: Row[] = []): Entry =>
  ({ kind: 'exchange', id, leg, languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t: 0 });
const both: LegFilters = { speaker: 'both', participant: 'both' };
const words = (notice: NoticeEntry) => `[${notice.message}]`;
const text = (band: Band) => band.pieces.map((piece) => piece.before + piece.text).join('');

describe('buildBands', () => {
  it("joins one segment's rows as written, and puts a space between segments where the script wants one", () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'One.'), row('s1', 1, 4, ' Two.')]),
      exchange('b', 'speaker', [row('s2', 0, 0, 'Three.')]),
    ], both, words);
    expect(bands.map((band) => [band.id, text(band)])).toEqual([['speaker-source', 'One. Two. Three.']]);
  });

  it('puts no space between Chinese or Japanese segments', () => {
    const bands = buildBands([
      exchange('a', 'speaker', [], [row('t1', 0, 0, '今天天气很好。', 'translation')]),
      exchange('b', 'speaker', [], [row('t2', 0, 0, '我们去公园吧。', 'translation')]),
    ], both, words);
    expect(text(bands[0])).toBe('今天天气很好。我们去公园吧。');
  });

  it("trims a segment's edges where it meets another, and keeps karaoke's offset on the trimmed text", () => {
    const bands = buildBands([
      exchange('a', 'speaker', [row('s1', 0, 0, 'Hi. ')]),
      exchange('b', 'speaker', [row('s2', 0, 0, '  Yes.')]),
    ], both, words);
    expect(bands[0].pieces.map((piece) => [piece.text, piece.before, piece.start])).toEqual([['Hi.', '', 0], ['Yes.', ' ', 2]]);
  });

  it("puts a notice into its leg's translation band, in order, in its words", () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'hiccup', at: 1 };
    const bands = buildBands([exchange('a', 'speaker', [], [row('t1', 0, 0, 'Hello.', 'translation')]), notice], both, words);
    expect(bands.map((band) => [band.id, text(band)])).toEqual([['speaker-translation', 'Hello. [hiccup]']]);
    expect(bands[0].pieces[1]).toMatchObject({ key: 'n', notice });
  });

  it("draws the sides a leg's filter shows, in a fixed band order", () => {
    const entries = [
      exchange('p', 'participant', [row('p1', 0, 0, 'Hi.')], [row('p2', 0, 0, 'やあ。', 'translation')]),
      exchange('s', 'speaker', [row('s1', 0, 0, 'Yo.')]),
    ];
    expect(buildBands(entries, both, words).map((band) => band.id)).toEqual(['speaker-source', 'participant-source', 'participant-translation']);
    expect(buildBands(entries, { ...both, participant: 'translation' }, words).map((band) => band.id)).toEqual(['speaker-source', 'participant-translation']);
    expect(buildBands(entries, { speaker: 'none', participant: 'none' }, words)).toEqual([]);
  });

  it('keeps only the newest text past the cap, with nothing drawn before the first piece kept', () => {
    const entries = [0, 1, 2].map((i) => exchange(`e${i}`, 'speaker', [row(`s${i}`, 0, 0, `Word${i}.`)]));
    const [band] = buildBands(entries, both, words, 12);
    expect(band.pieces.map((piece) => piece.text)).toEqual(['Word1.', 'Word2.']);
    expect(band.pieces[0].before).toBe('');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/subtitle`
Expected: FAIL — `./bands` does not exist.

- [ ] **Step 3: Write `bands.ts`**

Create `src/lib/subtitle/bands.ts`:

```ts
/**
 * The compact subtitle bands (spec: "The two subtitle surfaces are not the
 * same thing"; "The ranges tile the segment's text"): four lines — each
 * leg's source and its translation — each holding the newest of its rows,
 * drawn as the text was written. Rows of one segment join as they are, since
 * they tile its text; a segment's outer whitespace goes where it meets
 * another segment or a band's end, and between two segments a space goes in
 * only where the script wants one. A notice goes into its leg's translation
 * band, as today's error rows do (a UI rule the rendered pages settle).
 */
import type { Side } from '../contract/adapter';
import type { LegName, SegmentId } from '../conversation/types';
import { needsSpace } from '../projection/join';
import type { Entry } from '../projection/types';
import { showsSide, type LegFilters, type NoticeEntry } from '../view/filter';

/** One stretch of a band. */
export interface BandPiece {
  /** The row's key, or the notice's id. */
  key: string;
  /** What to draw. */
  text: string;
  /** Drawn before `text`: '' or ' '. */
  before: string;
  /** A row's segment, for karaoke; absent on a notice. */
  segmentId?: SegmentId;
  /** Where `text` begins in its segment's text; absent on a notice. */
  start?: number;
  /** Set on a notice's piece. */
  notice?: NoticeEntry;
}

export interface Band {
  /** `${leg}-${side}` */
  id: string;
  leg: LegName;
  side: Side;
  pieces: BandPiece[];
}

/** How much text a band keeps: it shows only its tail (today's `BUCKET_MAX_CHARS`). */
export const BAND_MAX_CHARS = 2000;

const ORDER: ReadonlyArray<{ leg: LegName; side: Side }> = [
  { leg: 'speaker', side: 'source' },
  { leg: 'speaker', side: 'translation' },
  { leg: 'participant', side: 'source' },
  { leg: 'participant', side: 'translation' },
];

interface Item {
  key: string;
  text: string;
  segmentId?: SegmentId;
  start?: number;
  notice?: NoticeEntry;
}

export function buildBands(
  entries: readonly Entry[],
  filters: LegFilters,
  words: (notice: NoticeEntry) => string,
  maxChars = BAND_MAX_CHARS,
): Band[] {
  const items = new Map<string, Item[]>(ORDER.map(({ leg, side }) => [`${leg}-${side}`, []]));
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      items.get(`${entry.leg}-translation`)!.push({ key: entry.id, text: words(entry), notice: entry });
      continue;
    }
    for (const side of ['source', 'translation'] as const) {
      if (!showsSide(filters[entry.leg], side)) continue;
      const band = items.get(`${entry.leg}-${side}`)!;
      for (const row of side === 'source' ? entry.source : entry.translation) {
        band.push({ key: row.key, text: row.text, segmentId: row.segmentId, start: row.start });
      }
    }
  }
  return ORDER
    .map(({ leg, side }) => ({ id: `${leg}-${side}`, leg, side, pieces: piecesOf(items.get(`${leg}-${side}`)!, maxChars) }))
    .filter((band) => band.pieces.length > 0);
}

/** Two items of the same segment, which join as written. */
function sameSegment(a: Item | undefined, b: Item | undefined): boolean {
  return a !== undefined && b !== undefined && a.segmentId !== undefined && a.segmentId === b.segmentId;
}

/** A band's pieces: segment edges trimmed, separators decided, only the newest `maxChars` kept. */
function piecesOf(items: readonly Item[], maxChars: number): BandPiece[] {
  const pieces: BandPiece[] = [];
  let last: Item | undefined;
  items.forEach((item, i) => {
    let text = item.text;
    let start = item.start;
    if (!sameSegment(items[i - 1], item)) {
      const trimmed = text.trimStart();
      if (start !== undefined) start += text.length - trimmed.length;
      text = trimmed;
    }
    if (!sameSegment(item, items[i + 1])) text = text.trimEnd();
    if (text.length === 0) return;
    const previous = pieces[pieces.length - 1];
    const before = previous && !sameSegment(last, item) && needsSpace(previous.text, text) ? ' ' : '';
    pieces.push({
      key: item.key,
      text,
      before,
      ...(item.segmentId !== undefined ? { segmentId: item.segmentId, start } : {}),
      ...(item.notice ? { notice: item.notice } : {}),
    });
    last = item;
  });
  let kept = 0;
  let from = pieces.length;
  while (from > 0 && kept < maxChars) {
    from -= 1;
    kept += pieces[from].before.length + pieces[from].text.length;
  }
  const tail = pieces.slice(from);
  if (tail.length > 0 && tail[0].before !== '') tail[0] = { ...tail[0], before: '' };
  return tail;
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/subtitle` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subtitle/bands.ts src/lib/subtitle/bands.test.ts
git commit -m "feat(subtitle): compact bands that join text as it was written"
```

---

### Task 2: The subtitle session

**Files:**
- Create: `src/lib/subtitle/session.ts`, `src/lib/subtitle/session.test.ts`, `src/lib/subtitle/appSession.ts`, `src/lib/subtitle/appSession.test.ts`

**Interfaces:**
- Consumes: `RunState`, `RunNotice`, `TurnMode` (`src/lib/session/types.ts`), `Readiness`, `LanguagePair` (`src/lib/provider/types.ts`), `Runner` (`src/lib/session/runner.ts`: `state` is a zustand vanilla store), `Readable`, `ConversationViewState` (`src/lib/view/conversationView.ts`), `useProviderStore` (`selected`, `entries[id].pair`, `readiness[id]`), `useTurnModeStore` (`turnMode`).
- Produces: `SubtitleIdleModel`, `SubtitleSession { phase; since; legs; pair; holdToTalk; canStart; idle }`, `idleOf(run, readiness)`, `subtitleSession(input)`, `sameSession(a, b)`; `appSubtitleSession(runner, view) → Readable<SubtitleSession> & { dispose(): void }`. Tasks 3, 6 and 7 use them.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/subtitle/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { RunState } from '../session/types';
import { idleOf, sameSession, subtitleSession } from './session';

const idle: RunState = { phase: 'idle' };
const input = { run: idle, readiness: { state: 'ready' as const, models: [] }, pair: { source: 'en', target: 'ja' }, turnMode: 'auto' as const, legs: ['speaker' as const] };

describe('idleOf', () => {
  it('shows a start under way first', () => {
    expect(idleOf({ phase: 'starting', step: 'opening' }, { state: 'not-ready', reason: 'no model' })).toEqual({ kind: 'starting' });
  });

  it("puts a provider that is not ready before an older failure", () => {
    const run: RunState = { phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'boom' } } };
    expect(idleOf(run, { state: 'not-ready', reason: 'Download a model first.' })).toEqual({ kind: 'unready', message: 'Download a model first.' });
  });

  it('calls a refused or failed start a failure, with its notice', () => {
    const notice = { code: 'build_refused', message: 'no' };
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'refused', notice } }, undefined)).toEqual({ kind: 'failed', notice });
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'start-failed', notice } }, undefined)).toMatchObject({ kind: 'failed' });
  });

  it('calls any other end an ending — a run that failed mid-way included — and stopping too', () => {
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'user' } }, undefined)).toEqual({ kind: 'ended' });
    expect(idleOf({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'x' } } }, undefined)).toEqual({ kind: 'ended' });
    expect(idleOf({ phase: 'stopping' }, undefined)).toEqual({ kind: 'ended' });
  });

  it('is ready before any run', () => {
    expect(idleOf(idle, undefined)).toEqual({ kind: 'ready' });
  });
});

describe('subtitleSession', () => {
  it('carries the phase, the time the run went live, and offers hold-to-talk only while running with manual turns', () => {
    const running: RunState = { phase: 'running', since: 1000, legs: { speaker: 'live' } };
    expect(subtitleSession({ ...input, run: running, turnMode: 'push-to-talk' })).toMatchObject({ phase: 'running', since: 1000, holdToTalk: true });
    expect(subtitleSession({ ...input, run: running }).holdToTalk).toBe(false);
    expect(subtitleSession({ ...input, turnMode: 'push-to-talk' })).toMatchObject({ since: null, holdToTalk: false });
  });

  it('allows a start only while idle and not blocked by the provider', () => {
    expect(subtitleSession(input).canStart).toBe(true);
    expect(subtitleSession({ ...input, readiness: undefined }).canStart).toBe(true);
    expect(subtitleSession({ ...input, readiness: { state: 'not-ready', reason: 'x' } }).canStart).toBe(false);
    expect(subtitleSession({ ...input, readiness: { state: 'checking' } }).canStart).toBe(false);
    expect(subtitleSession({ ...input, run: { phase: 'starting', step: 'checking' } }).canStart).toBe(false);
  });
});

describe('sameSession', () => {
  it('compares by value', () => {
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, legs: ['speaker'], pair: { source: 'en', target: 'ja' } }))).toBe(true);
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, legs: ['speaker', 'participant'] }))).toBe(false);
    expect(sameSession(subtitleSession(input), subtitleSession({ ...input, readiness: { state: 'not-ready', reason: 'x' } }))).toBe(false);
  });
});
```

Create `src/lib/subtitle/appSession.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Runner } from '../session/runner';
import type { RunState } from '../session/types';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { appSubtitleSession } from './appSession';

const providersBefore = useProviderStore.getState();
const turnBefore = useTurnModeStore.getState();
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useTurnModeStore.setState(turnBefore, true);
});

function setup() {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const runner = { state } as unknown as Runner;
  const view: Readable<ConversationViewState> = { get: () => ({ legs: [], entries: [] }), subscribe: () => () => {} };
  return { state, session: appSubtitleSession(runner, view) };
}

describe('appSubtitleSession', () => {
  it("reads the selected provider's readiness and pair, and the turn mode", () => {
    useProviderStore.setState({
      selected: 'fake',
      readiness: { fake: { state: 'not-ready', reason: 'no key' } },
      entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { session } = setup();
    expect(session.get()).toMatchObject({ pair: { source: 'en', target: 'ja' }, idle: { kind: 'unready', message: 'no key' }, canStart: false });
  });

  it('tells its listeners when the run changes, and keeps its identity when nothing it shows changed', () => {
    const { state, session } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    const first = session.get();
    state.setState({ phase: 'idle' });
    expect(session.get()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    state.setState({ phase: 'starting', step: 'checking' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.get().idle).toEqual({ kind: 'starting' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/subtitle`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write `session.ts`**

Create `src/lib/subtitle/session.ts`:

```ts
/**
 * The run as a subtitle surface needs it — plain data, so the extension
 * overlay can receive it over its wire (spec: "The two subtitle surfaces are
 * not the same thing").
 */
import type { LegName } from '../conversation/types';
import type { LanguagePair, Readiness } from '../provider/types';
import type { RunNotice, RunState, TurnMode } from '../session/types';

/** What the subtitle body shows while no run is live. */
export type SubtitleIdleModel =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting' }
  | { kind: 'unready'; message: string }
  | { kind: 'failed'; notice: RunNotice };

export interface SubtitleSession {
  phase: RunState['phase'];
  /** The wall clock the run went live; null unless running. */
  since: number | null;
  /** The legs of the conversation on screen: the bar's display-mode buttons follow them. */
  legs: readonly LegName[];
  /** The selected provider's language pair, for the bar. */
  pair: LanguagePair | null;
  /** A run is live under manual turns: the surface offers its hold control. */
  holdToTalk: boolean;
  /** Start is offered: idle, and the provider neither known to be unready nor being checked. */
  canStart: boolean;
  idle: SubtitleIdleModel;
}

export interface SubtitleSessionInput {
  run: RunState;
  readiness: Readiness | undefined;
  pair: LanguagePair | null;
  turnMode: TurnMode;
  legs: readonly LegName[];
}

/**
 * The idle body, first match wins: a start under way; a provider that is not
 * ready (a live blocker outranks a stale failure, as today); a start that was
 * refused or failed; any other end — a run that failed mid-way ended, and its
 * notice is in the conversation; nothing yet.
 */
export function idleOf(run: RunState, readiness: Readiness | undefined): SubtitleIdleModel {
  if (run.phase === 'starting') return { kind: 'starting' };
  if (run.phase !== 'idle') return { kind: 'ended' };
  if (readiness?.state === 'not-ready') return { kind: 'unready', message: readiness.reason };
  const end = run.lastEnd;
  if (end && (end.reason === 'refused' || end.reason === 'start-failed') && end.notice) return { kind: 'failed', notice: end.notice };
  return end ? { kind: 'ended' } : { kind: 'ready' };
}

export function subtitleSession({ run, readiness, pair, turnMode, legs }: SubtitleSessionInput): SubtitleSession {
  return {
    phase: run.phase,
    since: run.phase === 'running' ? run.since : null,
    legs,
    pair,
    holdToTalk: run.phase === 'running' && turnMode !== 'auto',
    // The runner checks readiness at start; only a known blocker or a check in flight keeps Start off.
    canStart: run.phase === 'idle' && readiness?.state !== 'not-ready' && readiness?.state !== 'checking',
    idle: idleOf(run, readiness),
  };
}

function sameIdle(a: SubtitleIdleModel, b: SubtitleIdleModel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'unready' && b.kind === 'unready') return a.message === b.message;
  if (a.kind === 'failed' && b.kind === 'failed') return a.notice === b.notice || (a.notice.code === b.notice.code && a.notice.message === b.notice.message);
  return true;
}

/** Two sessions that draw the same, compared by value, so a source can keep its identity. */
export function sameSession(a: SubtitleSession, b: SubtitleSession): boolean {
  return a.phase === b.phase && a.since === b.since && a.holdToTalk === b.holdToTalk && a.canStart === b.canStart
    && a.legs.length === b.legs.length && a.legs.every((leg, i) => leg === b.legs[i])
    && a.pair?.source === b.pair?.source && a.pair?.target === b.pair?.target
    && sameIdle(a.idle, b.idle);
}
```

- [ ] **Step 4: Write `appSession.ts`**

Create `src/lib/subtitle/appSession.ts`:

```ts
/**
 * The app's subtitle session, live from the runner, the conversation view and
 * two stores (the selected provider's readiness and pair, the turn mode). The
 * only module under `src/lib/subtitle` that reads a store.
 */
import { describeCause, reportError } from '../diagnostics/report';
import type { Runner } from '../session/runner';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { sameSession, subtitleSession, type SubtitleSession } from './session';

export function appSubtitleSession(
  runner: Pick<Runner, 'state'>,
  view: Readable<ConversationViewState>,
): Readable<SubtitleSession> & { dispose(): void } {
  const read = (): SubtitleSession => {
    const providers = useProviderStore.getState();
    const id = providers.selected;
    return subtitleSession({
      run: runner.state.getState(),
      readiness: id ? providers.readiness[id] : undefined,
      pair: id ? providers.entries[id]?.pair ?? null : null,
      turnMode: useTurnModeStore.getState().turnMode,
      legs: view.get().legs.map((leg) => leg.leg),
    });
  };
  let state = read();
  const listeners = new Set<() => void>();
  const update = () => {
    const next = read();
    if (sameSession(next, state)) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('SubtitleSession', `A session subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-session-subscriber' });
      }
    }
  };
  const offs = [runner.state.subscribe(update), useProviderStore.subscribe(update), useTurnModeStore.subscribe(update), view.subscribe(update)];
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      offs.forEach((off) => off());
      listeners.clear();
    },
  };
}
```

(If `ProviderEntry`'s field names differ from `pair` / the store's `readiness` map, use the store's actual names — read `src/stores/providerStore.ts` first — and say so in the report.)

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/lib/subtitle` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts src/lib/subtitle/appSession.ts src/lib/subtitle/appSession.test.ts
git commit -m "feat(subtitle): the run as a subtitle surface needs it, as plain data"
```

---

### Task 3: The overlay's wire

**Files:**
- Create: `src/lib/subtitle/wire.ts`, `src/lib/subtitle/wire.test.ts`

**Interfaces:**
- Consumes: `Entry` (`src/lib/projection/types.ts`), `SegmentId` (`src/lib/conversation/types.ts`), `SubtitleSession` (Task 2), `KaraokeState` (`src/lib/view/karaoke.ts`: `lit: ReadonlyMap<SegmentId, number>`, `replaying`), `Readable` (`src/lib/view/conversationView.ts`).
- Produces: `WirePort { post(message: unknown): void; onMessage(listener: (message: unknown) => void): () => void; onDisconnect(listener: () => void): () => void; close(): void }`; `ToOverlay`, `ToPanel`; `OVERLAY_ENTRIES = 30`; `publishSubtitles(port, sources: { entries: Readable<readonly Entry[]>; session: Readable<SubtitleSession>; karaoke: Readable<KaraokeState> }, controls: { clear(): void; exit(): void; press(): void; release(): void }) → () => void`; `OverlayModel { entries: readonly Entry[]; session: SubtitleSession | null; lit: ReadonlyMap<SegmentId, number> }`; `receiveSubtitles(port) → Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void }`; `messagePortWire(port: MessagePort): WirePort`; `ChromePortLike` and `chromePortWire(port: ChromePortLike): WirePort`. Task 7 uses the publisher, the receiver and `messagePortWire`; plan 1e uses `chromePortWire`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/subtitle/wire.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';
import { chromePortWire, messagePortWire, OVERLAY_ENTRIES, publishSubtitles, receiveSubtitles, type WirePort } from './wire';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

/** Two connected ends that deliver synchronously; `disconnect` tells the other end. */
function portPair(): [WirePort & { disconnect(): void }, WirePort & { disconnect(): void }] {
  const make = () => ({ messages: new Set<(m: unknown) => void>(), gone: new Set<() => void>() });
  const a = make();
  const b = make();
  const end = (self: typeof a, other: typeof a) => ({
    post: (message: unknown) => other.messages.forEach((listener) => listener(structuredClone(message))),
    onMessage: (listener: (m: unknown) => void) => { self.messages.add(listener); return () => { self.messages.delete(listener); }; },
    onDisconnect: (listener: () => void) => { self.gone.add(listener); return () => { self.gone.delete(listener); }; },
    close: () => {},
    disconnect: () => other.gone.forEach((listener) => listener()),
  });
  return [end(a, b), end(b, a)];
}

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const notice = (n: number): Entry => ({ kind: 'notice', id: `n${n}`, leg: 'speaker', severity: 'warning', message: `m${n}`, at: n });
const session: SubtitleSession = { phase: 'running', since: 5, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } };
const controls = () => ({ clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() });

function setup(entries: Entry[] = [notice(1)]) {
  const [panel, overlay] = portPair();
  const sources = {
    entries: box<readonly Entry[]>(entries),
    session: box(session),
    karaoke: box<KaraokeState>({ lit: new Map([['s:speaker:2', 4]]), replaying: null }),
  };
  const received = receiveSubtitles(overlay);
  const acts = controls();
  const stop = publishSubtitles(panel, sources, acts);
  return { panel, overlay, sources, received, acts, stop };
}

describe('the subtitle wire', () => {
  it('sends the overlay the tail of the merged entries, the session and the karaoke when it connects', () => {
    const { received } = setup(Array.from({ length: 40 }, (_, i) => notice(i)));
    const model = received.get();
    expect(model.entries).toHaveLength(OVERLAY_ENTRIES);
    expect(model.entries[0]).toMatchObject({ id: 'n10' });
    expect(model.session).toEqual(session);
    expect(model.lit.get('s:speaker:2')).toBe(4);
  });

  it('sends each change, and tells the overlay view', () => {
    const { sources, received } = setup();
    const listener = vi.fn();
    received.subscribe(listener);
    sources.entries.set([notice(1), notice(2)]);
    sources.karaoke.set({ lit: new Map([['s:speaker:2', 9]]), replaying: null });
    expect(received.get().entries).toHaveLength(2);
    expect(received.get().lit.get('s:speaker:2')).toBe(9);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("acts on the overlay's controls", () => {
    const { received, acts } = setup();
    received.send({ type: 'subtitle:turn-press' });
    received.send({ type: 'subtitle:turn-release' });
    received.send({ type: 'subtitle:request-clear' });
    received.send({ type: 'subtitle:user-exit' });
    expect(acts.press).toHaveBeenCalledTimes(1);
    expect(acts.release).toHaveBeenCalledTimes(1);
    expect(acts.clear).toHaveBeenCalledTimes(1);
    expect(acts.exit).toHaveBeenCalledTimes(1);
  });

  it('ignores a message it does not know, on either end', () => {
    const { panel, overlay, received, acts } = setup();
    overlay.post({ type: 'subtitle:turn-press-please' });
    panel.post({ nonsense: true });
    expect(acts.press).not.toHaveBeenCalled();
    expect(received.get().session).toEqual(session);
  });

  it('stops publishing when the overlay disconnects', () => {
    const { overlay, sources, received } = setup();
    overlay.disconnect();
    sources.entries.set([notice(7)]);
    expect(received.get().entries.map((e) => e.id)).toEqual(['n1']);
  });

  it('stops, reporting once, when posting throws', () => {
    reportErrorSpy.mockClear();
    const [panel] = portPair();
    const broken: WirePort = { ...panel, post: () => { throw new Error('port closed'); } };
    const entries = box<readonly Entry[]>([notice(1)]);
    publishSubtitles(broken, { entries, session: box(session), karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }) }, controls());
    entries.set([notice(2)]);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('carries messages over a real MessageChannel', async () => {
    const channel = new MessageChannel();
    const received = receiveSubtitles(messagePortWire(channel.port2));
    publishSubtitles(messagePortWire(channel.port1), {
      entries: box<readonly Entry[]>([notice(3)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
    }, controls());
    await vi.waitFor(() => expect(received.get().entries.map((e) => e.id)).toEqual(['n3']));
    channel.port1.close();
    channel.port2.close();
  });

  it('adapts a chrome.runtime port', () => {
    const messageListeners: Array<(m: unknown) => void> = [];
    const goneListeners: Array<() => void> = [];
    const chromePort = {
      postMessage: vi.fn(),
      onMessage: { addListener: (fn: (m: unknown) => void) => messageListeners.push(fn), removeListener: vi.fn() },
      onDisconnect: { addListener: (fn: () => void) => goneListeners.push(fn), removeListener: vi.fn() },
      disconnect: vi.fn(),
    };
    const wire = chromePortWire(chromePort);
    const heard = vi.fn();
    const gone = vi.fn();
    wire.onMessage(heard);
    wire.onDisconnect(gone);
    wire.post({ type: 'x' });
    messageListeners[0]({ type: 'y' });
    goneListeners[0]();
    wire.close();
    expect(chromePort.postMessage).toHaveBeenCalledWith({ type: 'x' });
    expect(heard).toHaveBeenCalledWith({ type: 'y' });
    expect(gone).toHaveBeenCalledTimes(1);
    expect(chromePort.disconnect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/subtitle/wire.test.ts`
Expected: FAIL — `./wire` does not exist.

- [ ] **Step 3: Write `wire.ts`**

Create `src/lib/subtitle/wire.ts`:

```ts
/**
 * The extension overlay's wire (spec: "The two subtitle surfaces are not the
 * same thing"): the side panel sends what the overlay draws — the tail of the
 * merged `Entry[]`, the subtitle session, karaoke — and the overlay sends back
 * its controls. `Entry[]` holds rows, never pcm, so there is nothing heavy to
 * strip. The tail is cut after the legs are merged, never per leg (spec:
 * "Invariants"). The transport is a `WirePort`: a `chrome.runtime` port in the
 * extension, a `MessagePort` in the development preview.
 */
import type { SegmentId } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';

export interface WirePort {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): void;
}

/** Side panel → overlay. */
export type ToOverlay =
  | { type: 'subtitle:entries'; entries: readonly Entry[] }
  | { type: 'subtitle:session'; session: SubtitleSession }
  | { type: 'subtitle:karaoke'; lit: ReadonlyArray<readonly [SegmentId, number]> };

/** Overlay → side panel. */
export type ToPanel =
  | { type: 'subtitle:request-clear' }
  | { type: 'subtitle:user-exit' }
  | { type: 'subtitle:turn-press' }
  | { type: 'subtitle:turn-release' };

/** How many entries the overlay gets: the tail of the merged conversation. */
export const OVERLAY_ENTRIES = 30;

const TO_PANEL = new Set<string>(['subtitle:request-clear', 'subtitle:user-exit', 'subtitle:turn-press', 'subtitle:turn-release']);

function typeOf(message: unknown): string | undefined {
  return typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
    ? (message as { type: string }).type
    : undefined;
}

export interface PanelSources {
  entries: Readable<readonly Entry[]>;
  session: Readable<SubtitleSession>;
  karaoke: Readable<KaraokeState>;
}

export interface PanelControls {
  clear(): void;
  exit(): void;
  press(): void;
  release(): void;
}

/**
 * The side panel's end: sends everything once when the overlay connects, then
 * each change, and acts on the overlay's controls. Stops when the overlay
 * disconnects, or — reporting it once — when posting throws. Returns the stop.
 */
export function publishSubtitles(port: WirePort, sources: PanelSources, controls: PanelControls): () => void {
  let stopped = false;
  const offs: Array<() => void> = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    offs.forEach((off) => off());
  };
  const post = (message: ToOverlay) => {
    if (stopped) return;
    try {
      port.post(message);
    } catch (error) {
      reportError('SubtitleWire', `The overlay's port did not take a message: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-post' });
      stop();
    }
  };
  let entries: readonly Entry[] | null = null;
  let session: SubtitleSession | null = null;
  let karaoke: KaraokeState | null = null;
  const sendEntries = () => {
    const next = sources.entries.get();
    if (next === entries) return;
    entries = next;
    post({ type: 'subtitle:entries', entries: next.slice(-OVERLAY_ENTRIES) });
  };
  const sendSession = () => {
    const next = sources.session.get();
    if (next === session) return;
    session = next;
    post({ type: 'subtitle:session', session: next });
  };
  const sendKaraoke = () => {
    const next = sources.karaoke.get();
    if (next === karaoke) return;
    karaoke = next;
    post({ type: 'subtitle:karaoke', lit: [...next.lit] });
  };
  // Subscribed before the first sends, so a port that throws on the first
  // message leaves nothing subscribed behind it.
  offs.push(
    sources.entries.subscribe(sendEntries),
    sources.session.subscribe(sendSession),
    sources.karaoke.subscribe(sendKaraoke),
    port.onMessage((message) => {
      switch (typeOf(message)) {
        case 'subtitle:request-clear': return controls.clear();
        case 'subtitle:user-exit': return controls.exit();
        case 'subtitle:turn-press': return controls.press();
        case 'subtitle:turn-release': return controls.release();
        default: return undefined;
      }
    }),
    port.onDisconnect(stop),
  );
  sendEntries();
  sendSession();
  sendKaraoke();
  return stop;
}

/** What the overlay draws, as it last heard it. */
export interface OverlayModel {
  entries: readonly Entry[];
  /** Null until the side panel has sent one. */
  session: SubtitleSession | null;
  lit: ReadonlyMap<SegmentId, number>;
}

const NOTHING: OverlayModel = { entries: [], session: null, lit: new Map() };

/** The overlay's end: the last model the side panel sent, and a way to send it controls. */
export function receiveSubtitles(port: WirePort): Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void } {
  let model = NOTHING;
  const listeners = new Set<() => void>();
  const set = (next: OverlayModel) => {
    model = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('SubtitleWire', `An overlay subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-subscriber' });
      }
    }
  };
  const off = port.onMessage((message) => {
    const m = message as ToOverlay;
    switch (typeOf(message)) {
      case 'subtitle:entries':
        if (Array.isArray((m as { entries?: unknown }).entries)) set({ ...model, entries: (m as Extract<ToOverlay, { type: 'subtitle:entries' }>).entries });
        return;
      case 'subtitle:session':
        set({ ...model, session: (m as Extract<ToOverlay, { type: 'subtitle:session' }>).session });
        return;
      case 'subtitle:karaoke':
        if (Array.isArray((m as { lit?: unknown }).lit)) set({ ...model, lit: new Map((m as Extract<ToOverlay, { type: 'subtitle:karaoke' }>).lit) });
        return;
      default:
        return;
    }
  });
  return {
    get: () => model,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    send(message) {
      if (!TO_PANEL.has(message.type)) return;
      try {
        port.post(message);
      } catch (error) {
        reportError('SubtitleWire', `The side panel's port did not take a control: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-send' });
      }
    },
    dispose() {
      off();
      listeners.clear();
    },
  };
}

/** A `MessagePort` as a wire: the development preview's iframe. A `MessagePort` has no disconnect event. */
export function messagePortWire(port: MessagePort): WirePort {
  port.start();
  return {
    post: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (event: MessageEvent) => listener(event.data);
      port.addEventListener('message', handler);
      return () => port.removeEventListener('message', handler);
    },
    onDisconnect: () => () => {},
    close: () => port.close(),
  };
}

/** The parts of a `chrome.runtime.Port` the wire uses, typed here so nothing imports `chrome`. */
export interface ChromePortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener(listener: () => void): void };
  disconnect(): void;
}

/** A `chrome.runtime` port as a wire: the extension's side panel and overlay (plan 1e wires them). */
export function chromePortWire(port: ChromePortLike): WirePort {
  return {
    post: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (message: unknown) => listener(message);
      port.onMessage.addListener(handler);
      return () => port.onMessage.removeListener(handler);
    },
    onDisconnect(listener) {
      const handler = () => listener();
      port.onDisconnect.addListener(handler);
      return () => port.onDisconnect.removeListener(handler);
    },
    close: () => port.disconnect(),
  };
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/subtitle` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subtitle/wire.ts src/lib/subtitle/wire.test.ts
git commit -m "feat(subtitle): the overlay's wire — entries, session and karaoke out, controls back"
```

---
### Task 4: Today's subtitle components, made shareable

**Files:**
- Create: `src/components/Subtitle/useSubtitleChrome.tsx`, `src/components/Subtitle/useSubtitleChrome.test.tsx`
- Modify: `src/components/Subtitle/SubtitleApp.tsx`, `src/components/Subtitle/SubtitleBar.tsx`, `src/components/Subtitle/SubtitleIdle.tsx`, `src/components/Subtitle/subtitleIdleState.ts`
- Test: `src/components/Subtitle/SubtitleBar.test.tsx`, `src/components/Subtitle/SubtitleIdle.test.tsx`; every existing Subtitle test must stay green unchanged (they are the guard for the move).

**Interfaces:**
- Produces: `useSubtitleChrome({ surface, onExit }) → { rootRef, rootProps: { className; style; onMouseEnter; onMouseMove; onMouseLeave }, resizeHandles: ReactNode }`, `SubtitleSurfaceKind`, `getHighlightOverlayForBg` (moved; `SubtitleApp` re-exports both, so existing importers keep working); `SubtitleBar`'s `exportProps` becomes optional; `SubtitleIdleState` gains `{ kind: 'unready'; message: string }`. Task 6 uses all three.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Subtitle/useSubtitleChrome.test.tsx`. Its mocks mirror `SubtitleApp.rootStyle.test.tsx` (the stores and `useOverlayDragResize`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

const setFullscreen = vi.fn(async () => {});
let fullscreen = false;
let locked = false;

vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({ __syncSubtitleFullscreen: vi.fn(), subtitleModeActive: false }) },
  useSubtitleFullscreen: () => fullscreen,
  useSetSubtitleFullscreen: () => setFullscreen,
}));
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({ bgColor: '#000000', bgOpacity: 80, fontSize: 24, compactMode: false, sourceTextColor: '#FF00FF', translationTextColor: '#00FF00' }),
  useSaveSubtitleWindowBounds: () => vi.fn(async () => {}),
  useSubtitlePositionLocked: () => locked,
}));
vi.mock('./useOverlayDragResize', () => ({ useOverlayDragResize: () => ({ resizeHandleProps: {} }) }));

const { useSubtitleChrome } = await import('./useSubtitleChrome');

function Probe({ surface, onExit }: { surface: 'electron' | 'extension-overlay'; onExit: () => void }) {
  const chrome = useSubtitleChrome({ surface, onExit });
  return <div ref={chrome.rootRef} {...chrome.rootProps}>{chrome.resizeHandles}</div>;
}

beforeEach(() => {
  cleanup();
  fullscreen = false;
  locked = false;
  setFullscreen.mockClear();
});

describe('useSubtitleChrome', () => {
  it('leaves subtitle mode on Escape, and leaves fullscreen first when in it', () => {
    const onExit = vi.fn();
    const { unmount } = render(<Probe surface="electron" onExit={onExit} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
    unmount();
    fullscreen = true;
    render(<Probe surface="electron" onExit={onExit} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setFullscreen).toHaveBeenCalledWith(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('gives the root its class, background and the text colour variable', () => {
    const { container } = render(<Probe surface="electron" onExit={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('subtitle-app');
    expect(root.style.background).not.toBe('');
    expect(root.style.getPropertyValue('--subtitle-source-color')).toBe('#FF00FF');
  });

  it('draws the resize handles only on an unlocked overlay', () => {
    const count = (surface: 'electron' | 'extension-overlay') => {
      const { container, unmount } = render(<Probe surface={surface} onExit={() => {}} />);
      const n = container.querySelectorAll('.subtitle-app__resize').length;
      unmount();
      return n;
    };
    expect(count('extension-overlay')).toBe(8);
    expect(count('electron')).toBe(0);
    locked = true;
    expect(count('extension-overlay')).toBe(0);
  });
});
```

In `src/components/Subtitle/SubtitleBar.test.tsx`, inside `describe('SubtitleBar export button', …)`, add:

```tsx
  it('renders no export button without exportProps', () => {
    const { exportProps: _unused, ...withoutExport } = baseProps;
    render(<SubtitleBar {...withoutExport} surface="electron" />);
    expect(screen.queryByTestId('export-button')).not.toBeInTheDocument();
  });
```

In `src/components/Subtitle/SubtitleIdle.test.tsx`, add (its `handlers()` helper sets `allowSessionControl: true`):

```tsx
describe('SubtitleIdle unready state', () => {
  it("shows a provider that is not ready by its reason, punctuation trimmed, with an inert action", () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'unready', message: 'Download a model first.' }} {...h} />);
    expect(screen.getByRole('button', { name: 'Download a model first' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /return to main window/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Subtitle`
Expected: the new tests FAIL (no hook module; `exportProps` required; no `unready` state); every existing test passes.

- [ ] **Step 3: Move the window handling into `useSubtitleChrome`**

Create `src/components/Subtitle/useSubtitleChrome.tsx`. Move into it, unchanged, from `SubtitleApp.tsx`: `AUTO_HIDE_MS`, `hexToRgba`, `HIGHLIGHT_ALPHA`, `getHighlightOverlayForBg` (with its doc comment, exported), `SubtitleSurfaceKind` (exported); and from the component body: the root ref, the auto-hiding bar (`barVisible`, `hideTimer`, `revealBar`, `onMouseLeave`, the unmount cleanup), the layered Escape effect, the `subtitle:fullscreen-changed` effect, the `subtitle:window-bounds-changed` effect, the resize handles, and the root style. The hook's shape:

```tsx
/**
 * The subtitle window's own handling, shared by today's `SubtitleApp` and the
 * new `SubtitleView`: the bar hides after a quiet spell, Escape leaves
 * fullscreen and then subtitle mode, the Electron window's fullscreen and
 * bounds are mirrored into the stores, and the overlay gets its resize
 * handles. None of it touches conversation data. Moved out of `SubtitleApp`
 * unchanged.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import useSettingsStore, { useSetSubtitleFullscreen, useSubtitleFullscreen } from '../../stores/settingsStore';
import { useSaveSubtitleWindowBounds, useSubtitlePositionLocked, useSubtitleSettings } from '../../stores/subtitleStore';
import { useOverlayDragResize } from './useOverlayDragResize';

export type SubtitleSurfaceKind = 'electron' | 'extension-overlay';

// … AUTO_HIDE_MS, hexToRgba, HIGHLIGHT_ALPHA, getHighlightOverlayForBg, moved as they are …

export interface SubtitleChrome {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  rootProps: {
    className: string;
    style: CSSProperties;
    onMouseEnter: () => void;
    onMouseMove: () => void;
    onMouseLeave: () => void;
  };
  /** The overlay's eight resize handles, or null. */
  resizeHandles: ReactNode;
}

/** `onExit` should keep its identity across renders (a `useCallback`): the Escape listener re-attaches whenever it changes. */
export function useSubtitleChrome({ surface, onExit }: { surface: SubtitleSurfaceKind; onExit: () => void }): SubtitleChrome {
  // … the moved state, effects and style, with `requestExit` read as `onExit` …
  return {
    rootRef,
    rootProps: {
      className: `subtitle-app${fullscreen ? ' fullscreen' : ''}`,
      style: rootStyle,
      onMouseEnter: revealBar,
      onMouseMove: revealBar,
      onMouseLeave,
    },
    resizeHandles: showResizeHandles ? (
      <>
        {/* the eight `.subtitle-app__resize` divs, as they are in SubtitleApp today */}
      </>
    ) : null,
  };
}
```

Every moved line keeps its comment. In `SubtitleApp.tsx`: import `useSubtitleChrome`, `getHighlightOverlayForBg` and `SubtitleSurfaceKind` from `./useSubtitleChrome`; re-export the last two (`export { getHighlightOverlayForBg } from './useSubtitleChrome';` and `export type { SubtitleSurfaceKind } from './useSubtitleChrome';`) so `SubtitleApp.test.tsx`, `SubtitleBar.tsx` and `useOverlayDragResize.ts` keep importing them from `./SubtitleApp`; call `const chrome = useSubtitleChrome({ surface, onExit: requestExit });` after `requestExit` is defined; render the root as `<div ref={chrome.rootRef} {...chrome.rootProps}>` and replace the resize-handle block with `{chrome.resizeHandles}`; delete the imports only the moved code used. Nothing else in `SubtitleApp` changes.

- [ ] **Step 4: `exportProps` optional; the `unready` idle state**

In `src/components/Subtitle/SubtitleBar.tsx`: `exportProps?: React.ComponentProps<typeof ExportButton>;` with a comment ("absent: no export button — the new subtitle view gets its own in plan 1d-3"), and render `{surface === 'electron' && exportProps && <ExportButton {...exportProps} popoverHost="child-window" />}`.

In `src/components/Subtitle/subtitleIdleState.ts`, add to `SubtitleIdleState`:

```ts
  /** The new runner's provider is not ready (plan 1d-2): its reason, in words the provider gave. */
  | { kind: 'unready'; message: string }
```

(`deriveSubtitleIdleState` never produces it.) In `src/components/Subtitle/SubtitleIdle.tsx`, before the `blocked` branch:

```tsx
  if (state.kind === 'unready') {
    // The `blocked` markup, with the provider's own reason as the label. No
    // settings page is mapped to a readiness reason yet (plan 1e), so the
    // action is inert, as `blocked` is when it has no destination.
    const label = state.message.replace(/[.。！!]+$/, '');
    return (
      <div className="subtitle-idle">
        <button type="button" className="subtitle-idle__action subtitle-idle__action--fix" disabled>
          <AlertTriangle size={15} />
          <span>{label}</span>
        </button>
        <button type="button" className="subtitle-idle__link" onClick={onReturn}>
          {t('subtitle.backToMain', 'Return to main window')}
        </button>
      </div>
    );
  }
```

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/components/Subtitle` — PASS, the old tests unchanged. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle
git commit -m "refactor(subtitle): the window handling in a shared hook; optional export; an unready idle state"
```

---

### Task 5: The bands, drawn

**Files:**
- Create: `src/components/Subtitle/SubtitleBands.tsx`, `src/components/Subtitle/SubtitleBands.test.tsx`

**Interfaces:**
- Consumes: `buildBands`, `BandPiece` (Task 1), `displayItems`, `LegFilters` (`src/lib/view/filter.ts`), `noticeText` (`src/lib/view/noticeText.ts`), `ConversationList` (`src/components/Conversation/ConversationList.tsx`), today's `SubtitleStream.scss` classes (`subtitle-stream compact|expanded`, `subtitle-stream__line subtitle-stream__line--{side} subtitle-stream__line--{leg}`, `subtitle-stream__item`, `subtitle-stream__item--new`) and `karaoke.scss` (`karaoke-played`).
- Produces: `SubtitleBody(props: SubtitleBodyProps)` — compact bands or the expanded list; `SubtitleBodyProps { entries; lit; compact; fontSize; filters; sourceTextColor?; translationTextColor?; newItemHighlightEnabled }`. Task 6 renders it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Subtitle/SubtitleBands.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Entry, Row } from '../../lib/projection/types';
import { SubtitleBody, type SubtitleBodyProps } from './SubtitleBands';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

const row = (segmentId: string, k: number, start: number, text: string, side: 'source' | 'translation' = 'source'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start, end: start + text.length, text, final: true });
const exchange = (id: string, source: Row[], translation: Row[] = []): Entry =>
  ({ kind: 'exchange', id, leg: 'speaker', languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t: 0 });
const props = (over: Partial<SubtitleBodyProps> = {}): SubtitleBodyProps => ({
  entries: [exchange('a', [row('s1', 0, 0, 'Hello.')], [row('t1', 0, 0, 'こんにちは。', 'translation')])],
  lit: new Map(),
  compact: true,
  fontSize: 24,
  filters: { speaker: 'both', participant: 'both' },
  newItemHighlightEnabled: true,
  ...over,
});

describe('SubtitleBody — compact', () => {
  it("draws a band per leg and side with today's classes", () => {
    const { container } = render(<SubtitleBody {...props()} />);
    expect(container.querySelector('.subtitle-stream.compact')).not.toBeNull();
    const lines = [...container.querySelectorAll('.subtitle-stream__line')];
    expect(lines.map((line) => line.className)).toEqual([
      'subtitle-stream__line subtitle-stream__line--source subtitle-stream__line--speaker',
      'subtitle-stream__line subtitle-stream__line--translation subtitle-stream__line--speaker',
    ]);
    expect(lines.map((line) => line.textContent)).toEqual(['Hello.', 'こんにちは。']);
  });

  it('joins Japanese segments without a space and English ones with one', () => {
    const entries = [
      exchange('a', [row('s1', 0, 0, 'One.')], [row('t1', 0, 0, '一つ。', 'translation')]),
      exchange('b', [row('s2', 0, 0, 'Two.')], [row('t2', 0, 0, '二つ。', 'translation')]),
    ];
    const { container } = render(<SubtitleBody {...props({ entries })} />);
    const lines = [...container.querySelectorAll('.subtitle-stream__line')].map((line) => line.textContent);
    expect(lines).toEqual(['One. Two.', '一つ。二つ。']);
  });

  it('lights the spoken characters of a stretch', () => {
    const { container } = render(<SubtitleBody {...props({ lit: new Map([['t1', 3]]) })} />);
    expect(container.querySelector('.subtitle-stream__line--translation .karaoke-played')?.textContent).toBe('こんに');
  });

  it('highlights a segment that arrives after the first draw, once, and not the ones already there', () => {
    const first = props();
    const { container, rerender } = render(<SubtitleBody {...first} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
    const later = [...first.entries, exchange('b', [row('s2', 0, 0, 'Again.')])];
    rerender(<SubtitleBody {...props({ entries: later })} />);
    const fresh = [...container.querySelectorAll('.subtitle-stream__item--new')].map((span) => span.textContent);
    expect(fresh).toEqual([' Again.']);
  });

  it('draws no highlight when the setting is off', () => {
    const first = props({ newItemHighlightEnabled: false });
    const { container, rerender } = render(<SubtitleBody {...first} />);
    rerender(<SubtitleBody {...props({ newItemHighlightEnabled: false, entries: [...first.entries, exchange('b', [row('s2', 0, 0, 'Again.')])] })} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
  });
});

describe('SubtitleBody — expanded', () => {
  it("draws the panel's list with the subtitle's filters and no replay", () => {
    const { container } = render(<SubtitleBody {...props({ compact: false, filters: { speaker: 'translation', participant: 'both' } })} />);
    expect(container.querySelector('.subtitle-stream.expanded')).not.toBeNull();
    expect([...container.querySelectorAll('.conversation-row .row-text')].map((el) => el.textContent)).toEqual(['こんにちは。']);
    expect(container.querySelector('.row-play-btn')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Subtitle/SubtitleBands.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/Subtitle/SubtitleBands.tsx`. Its markup is today's `SubtitleStream` (`CompactSpan` for a stretch), class for class:

```tsx
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { LegName, SegmentId } from '../../lib/conversation/types';
import type { Entry } from '../../lib/projection/types';
import { buildBands, type BandPiece } from '../../lib/subtitle/bands';
import { displayItems, type LegFilters } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';
import { ConversationList } from '../Conversation/ConversationList';
import './SubtitleStream.scss';
import '../../styles/karaoke.scss';

export interface SubtitleBodyProps {
  entries: readonly Entry[];
  /** Characters spoken so far, per segment. */
  lit: ReadonlyMap<SegmentId, number>;
  compact: boolean;
  fontSize: number;
  /** The subtitle's own display modes (independent of the panel's). */
  filters: LegFilters;
  sourceTextColor?: string;
  translationTextColor?: string;
  newItemHighlightEnabled: boolean;
}

const NO_REPLAY: ReadonlySet<LegName> = new Set();
const cannotReplay = () => false;
const noReplay = () => {};

/**
 * The subtitle's body: compact bands (four flowing lines) or, expanded, the
 * panel's own list with the subtitle's filters and no replay. The font size
 * and the two text colours are published under today's names for both
 * (`--subtitle-*` for the bands, `--conversation-*` for the list).
 */
export function SubtitleBody(props: SubtitleBodyProps) {
  const { entries, lit, compact, fontSize, filters, sourceTextColor, translationTextColor } = props;
  const style: CSSProperties & Record<string, string> = {
    fontSize: `${fontSize}px`,
    '--conversation-font-size': `${fontSize}px`,
  };
  if (sourceTextColor) {
    style['--subtitle-source-color'] = sourceTextColor;
    style['--conversation-source-color'] = sourceTextColor;
  }
  if (translationTextColor) {
    style['--subtitle-translation-color'] = translationTextColor;
    style['--conversation-translation-color'] = translationTextColor;
  }
  const items = useMemo(() => (compact ? [] : displayItems(entries, filters)), [compact, entries, filters]);
  return (
    <div className={`subtitle-stream ${compact ? 'compact' : 'expanded'}`} style={style}>
      {compact ? (
        <SubtitleBands entries={entries} lit={lit} filters={filters} newItemHighlightEnabled={props.newItemHighlightEnabled} />
      ) : (
        <ConversationList
          items={items}
          lit={lit}
          replaying={null}
          replayLegs={NO_REPLAY}
          canReplay={cannotReplay}
          onReplay={noReplay}
          compact={false}
          fontSize={fontSize}
          empty={null}
        />
      )}
    </div>
  );
}

function SubtitleBands({ entries, lit, filters, newItemHighlightEnabled }: Pick<SubtitleBodyProps, 'entries' | 'lit' | 'filters' | 'newItemHighlightEnabled'>) {
  const { t } = useTranslation();
  const bands = useMemo(() => buildBands(entries, filters, (notice) => noticeText(t, notice)), [entries, filters, t]);

  // A stretch is highlighted once, on the first draw after it arrives; what was
  // there at the first draw never is. Keyed by segment — rows re-cut, segments
  // do not — and segment ids carry the session, so the map never collides.
  const seen = useRef(new Map<string, 'existing' | 'new'>());
  const firstDraw = useRef(true);
  const stateOf = (id: string) => seen.current.get(id) ?? (firstDraw.current ? 'existing' : 'new');
  useLayoutEffect(() => {
    for (const band of bands) {
      for (const piece of band.pieces) {
        const id = piece.segmentId ?? piece.key;
        if (!seen.current.has(id)) seen.current.set(id, firstDraw.current ? 'existing' : 'new');
      }
    }
    firstDraw.current = false;
  });

  return (
    <>
      {bands.map((band) => (
        <div key={band.id} className={`subtitle-stream__line subtitle-stream__line--${band.side} subtitle-stream__line--${band.leg}`}>
          <p>
            {band.pieces.map((piece) => (
              <Stretch
                key={piece.key}
                piece={piece}
                upTo={piece.segmentId === undefined ? undefined : lit.get(piece.segmentId)}
                isNew={newItemHighlightEnabled && stateOf(piece.segmentId ?? piece.key) === 'new'}
              />
            ))}
          </p>
        </div>
      ))}
    </>
  );
}

function Stretch({ piece, upTo, isNew }: { piece: BandPiece; upTo: number | undefined; isNew: boolean }) {
  const className = isNew ? 'subtitle-stream__item subtitle-stream__item--new' : 'subtitle-stream__item';
  const played = upTo === undefined || piece.start === undefined ? 0 : Math.min(piece.text.length, Math.max(0, upTo - piece.start));
  if (played <= 0) return <span className={className}>{piece.before}{piece.text}</span>;
  if (played >= piece.text.length) {
    return (
      <span className={className}>
        {piece.before}
        <span className="karaoke-played">{piece.text}</span>
      </span>
    );
  }
  return (
    <span className={className}>
      {piece.before}
      <span className="karaoke-played">{piece.text.slice(0, played)}</span>
      <span>{piece.text.slice(played)}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/components/Subtitle` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleBands.tsx src/components/Subtitle/SubtitleBands.test.tsx
git commit -m "feat(subtitle): the bands drawn from entries, and the expanded list"
```

---

### Task 6: The subtitle view and its hold button

**Files:**
- Create: `src/components/Subtitle/SubtitleView.tsx`, `src/components/Subtitle/SubtitleView.test.tsx`, `src/components/Subtitle/HoldToTalk.tsx`, `src/components/Subtitle/HoldToTalk.test.tsx`
- Modify: `src/components/Subtitle/SubtitleApp.scss` (the hold button's two rules)

**Interfaces:**
- Consumes: `useSubtitleChrome`, `SubtitleSurfaceKind` (Task 4), `SubtitleBar` (props: `sessionElapsedMs`, `sourceLanguageCode`, `targetLanguageCode`, `onClearConversation`, `speakerActive`, `participantActive`, `exportProps?`, `surface`, `sessionControl?`), `SubtitleIdle` (+ `unready`), `SubtitleBody` (Task 5), `SubtitleSession` / `SubtitleIdleModel` (Task 2), `noticeText`, the subtitle store's hooks (`useSubtitleSettings`, `useSubtitleSpeakerDisplayMode`, `useSubtitleParticipantDisplayMode`, `useSubtitleNewItemHighlightEnabled`).
- Produces: `SubtitleModel { entries: readonly Entry[]; lit: ReadonlyMap<SegmentId, number>; session: SubtitleSession | null }`, `SubtitleControls { exit(); clear(); press(); release(); start?(); stop?() }`, `SubtitleView({ surface, model, controls })`, `HoldToTalk({ onPress, onRelease })`. Task 7 mounts the view; plan 1e mounts it in the app.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Subtitle/HoldToTalk.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HoldToTalk } from './HoldToTalk';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('HoldToTalk', () => {
  it('presses on pointer down and releases on up, leave and cancel — once each', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    for (const end of ['pointerUp', 'pointerLeave', 'pointerCancel'] as const) {
      fireEvent.pointerDown(button);
      expect(button.textContent).toBe('Release');
      fireEvent[end](button);
      expect(button.textContent).toBe('Hold');
    }
    fireEvent.pointerUp(button);
    expect(onPress).toHaveBeenCalledTimes(3);
    expect(onRelease).toHaveBeenCalledTimes(3);
  });

  it('releases a held button when it goes away', () => {
    const onRelease = vi.fn();
    const { unmount } = render(<HoldToTalk onPress={() => {}} onRelease={onRelease} />);
    fireEvent.pointerDown(screen.getByRole('button'));
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/components/Subtitle/SubtitleView.test.tsx`. The bar, the chrome hook and the stores are stubbed — the view's own choices are what is under test:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleSession } from '../../lib/subtitle/session';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // i18next's two call shapes: t(key, fallback, values) and t(key, { defaultValue, ...values }).
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
vi.mock('./useSubtitleChrome', () => ({
  useSubtitleChrome: () => ({ rootRef: { current: null }, rootProps: { className: 'subtitle-app', style: {}, onMouseEnter() {}, onMouseMove() {}, onMouseLeave() {} }, resizeHandles: null }),
}));
vi.mock('./SubtitleBar', () => ({
  default: (p: { sessionControl?: unknown; speakerActive: boolean; participantActive: boolean; sourceLanguageCode: string }) =>
    require('react').createElement('div', {
      'data-testid': 'bar',
      'data-control': p.sessionControl ? 'yes' : 'no',
      'data-legs': `${p.speakerActive}/${p.participantActive}`,
      'data-pair': p.sourceLanguageCode,
    }),
}));
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({ fontSize: 24, compactMode: true, sourceTextColor: '#fff', translationTextColor: '#9ad0ff' }),
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSubtitleNewItemHighlightEnabled: () => false,
}));

const { SubtitleView } = await import('./SubtitleView');

const entry: Entry = {
  kind: 'exchange', id: 'a', leg: 'speaker', languages: { source: 'en', target: 'ja' }, pairing: 'stated', t: 0,
  source: [{ key: 's1:0', segmentId: 's1', side: 'source', start: 0, end: 6, text: 'Hello.', final: true }],
  translation: [],
};
const session = (over: Partial<SubtitleSession> = {}): SubtitleSession => ({
  phase: 'running', since: 0, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: false, canStart: false, idle: { kind: 'ended' }, ...over,
});
const controls = () => ({ exit: vi.fn(), clear: vi.fn(), press: vi.fn(), release: vi.fn(), start: vi.fn(), stop: vi.fn() });

beforeEach(() => cleanup());

describe('SubtitleView', () => {
  it('draws the bands while a run is live', () => {
    const { container } = render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(container.querySelector('.subtitle-stream__line')?.textContent).toBe('Hello.');
    expect(screen.getByTestId('bar').dataset).toMatchObject({ control: 'yes', legs: 'true/false', pair: 'EN' });
  });

  it('shows the Space hint on the Electron takeover under manual turns before anything is said, and never on the overlay', () => {
    const live = session({ holdToTalk: true });
    const { container, unmount } = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: live }} controls={controls()} />);
    expect(container.querySelector('.subtitle-ptt-hint')?.textContent).toBe('Press Space to speak');
    expect(container.querySelector('.subtitle-hold')).toBeNull();
    unmount();
    const acts = controls();
    const overlay = render(<SubtitleView surface="extension-overlay" model={{ entries: [], lit: new Map(), session: live }} controls={acts} />);
    expect(overlay.container.querySelector('.subtitle-ptt-hint')).toBeNull();
    fireEvent.pointerDown(overlay.getByRole('button', { name: 'Hold' }));
    fireEvent.pointerUp(overlay.getByRole('button', { name: 'Release' }));
    expect(acts.press).toHaveBeenCalledTimes(1);
    expect(acts.release).toHaveBeenCalledTimes(1);
  });

  it('offers no hold button under automatic turns, and no session control on the overlay', () => {
    const { container } = render(<SubtitleView surface="extension-overlay" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(container.querySelector('.subtitle-hold')).toBeNull();
    expect(screen.getByTestId('bar').dataset.control).toBe('no');
  });

  it("shows the idle body when no run is live: a provider's reason, a failed start in words", () => {
    const unready = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'unready', message: 'Download a model first.' } }) }} controls={controls()} />);
    expect(unready.container.querySelector('.subtitle-idle__action--fix')?.textContent).toBe('Download a model first');
    unready.unmount();
    const failed = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'failed', notice: { code: 'start_failed', message: 'socket closed' } } }) }} controls={controls()} />);
    expect(failed.container.querySelector('.subtitle-idle__error')?.textContent).toBe("Failed to start: The session didn't start: socket closed");
  });

  it('starts from the idle body on the Electron takeover', () => {
    const acts = controls();
    render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, canStart: true, idle: { kind: 'ready' } }) }} controls={acts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start translating' }));
    expect(acts.start).toHaveBeenCalledTimes(1);
  });

  it('shows the overlay its idle body before the side panel has said anything', () => {
    const { container } = render(<SubtitleView surface="extension-overlay" model={{ entries: [], lit: new Map(), session: null }} controls={controls()} />);
    expect(container.querySelector('.subtitle-idle__message')?.textContent).toBe('Session ended');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Subtitle`
Expected: the new tests FAIL — the modules do not exist.

- [ ] **Step 3: The hold button**

Create `src/components/Subtitle/HoldToTalk.tsx` — the overlay's hold control (spec: "Surfaces emit press and release"), with the overlay's own button class and the panel's labels:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';

/**
 * Hold to talk, on the extension overlay: pointer down presses; up, leave and
 * cancel release — dragging off the button must release, which today's panel
 * button does not do. A held button that goes away releases too.
 */
export function HoldToTalk({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const press = () => {
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    onPress();
  };
  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    onRelease();
  };
  useEffect(() => () => {
    if (heldRef.current) releaseRef.current();
  }, []);
  return (
    <div className="subtitle-hold">
      <button
        type="button"
        className={`subtitle-idle__action subtitle-hold__button${held ? ' is-held' : ''}`}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        <Mic size={15} />
        <span>{held ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
      </button>
    </div>
  );
}
```

Append to `src/components/Subtitle/SubtitleApp.scss`:

```scss
// The overlay's hold-to-talk control, under the bands (plan 1d-2).
.subtitle-hold {
  display: flex;
  justify-content: center;
  padding: 6px 0 10px;
}

.subtitle-hold__button.is-held {
  background: #e74c3c;
}
```

- [ ] **Step 4: The view**

Create `src/components/Subtitle/SubtitleView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SegmentId } from '../../lib/conversation/types';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleIdleModel, SubtitleSession } from '../../lib/subtitle/session';
import { noticeText } from '../../lib/view/noticeText';
import {
  useSubtitleNewItemHighlightEnabled,
  useSubtitleParticipantDisplayMode,
  useSubtitleSettings,
  useSubtitleSpeakerDisplayMode,
} from '../../stores/subtitleStore';
import { HoldToTalk } from './HoldToTalk';
import SubtitleBar from './SubtitleBar';
import { SubtitleBody } from './SubtitleBands';
import SubtitleIdle from './SubtitleIdle';
import type { SubtitleIdleState } from './subtitleIdleState';
import { useSubtitleChrome, type SubtitleSurfaceKind } from './useSubtitleChrome';
import './SubtitleApp.scss';

/** What a subtitle surface draws: the conversation's entries (the overlay gets their tail), karaoke, and the run. */
export interface SubtitleModel {
  entries: readonly Entry[];
  lit: ReadonlyMap<SegmentId, number>;
  /** Null on the overlay until the side panel has sent one. */
  session: SubtitleSession | null;
}

export interface SubtitleControls {
  exit(): void;
  clear(): void;
  press(): void;
  release(): void;
  /** The Electron takeover starts and stops the run itself; the overlay does not. */
  start?(): void;
  stop?(): void;
}

function languageCodeShort(code: string | undefined): string {
  return code ? code.slice(0, 2).toUpperCase() : '?';
}

function idleState(idle: SubtitleIdleModel | undefined, t: TFunction): SubtitleIdleState {
  if (!idle) return { kind: 'ended' };
  if (idle.kind === 'failed') return { kind: 'failed', message: noticeText(t, idle.notice) };
  return idle;
}

const noop = () => {};

/**
 * The subtitle surface over the new model (spec: "The two subtitle surfaces
 * are not the same thing"): the Electron takeover draws it from the runner in
 * its own window, the extension overlay from its wire. Today's `SubtitleApp`
 * layout, class for class.
 */
export function SubtitleView({ surface, model, controls }: { surface: SubtitleSurfaceKind; model: SubtitleModel; controls: SubtitleControls }) {
  const { t } = useTranslation();
  const chrome = useSubtitleChrome({ surface, onExit: controls.exit });
  const subtitle = useSubtitleSettings();
  const speaker = useSubtitleSpeakerDisplayMode();
  const participant = useSubtitleParticipantDisplayMode();
  const newItemHighlightEnabled = useSubtitleNewItemHighlightEnabled();
  const filters = useMemo(() => ({ speaker, participant }), [speaker, participant]);
  const { entries, lit, session } = model;
  const running = session?.phase === 'running';

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const elapsedMs = running && session.since !== null ? now - session.since : 0;

  // A leg's display-mode button shows when the conversation has that leg (today: the mode's intent, or items for it).
  const legs = session?.legs ?? [];
  const speakerActive = legs.includes('speaker') || entries.some((e) => e.leg === 'speaker');
  const participantActive = legs.includes('participant') || entries.some((e) => e.leg === 'participant');
  const { start, stop } = controls;

  return (
    <div ref={chrome.rootRef} {...chrome.rootProps}>
      <SubtitleBar
        sessionElapsedMs={elapsedMs}
        sourceLanguageCode={languageCodeShort(session?.pair?.source)}
        targetLanguageCode={languageCodeShort(session?.pair?.target)}
        onClearConversation={controls.clear}
        speakerActive={speakerActive}
        participantActive={participantActive}
        surface={surface}
        sessionControl={surface === 'electron' && start && stop ? {
          isSessionActive: running,
          isInitializing: session?.phase === 'starting',
          canStart: session?.canStart ?? false,
          onStart: start,
          onStop: stop,
        } : undefined}
      />
      {running ? (
        <>
          {surface === 'electron' && session.holdToTalk && entries.length === 0 ? (
            // The takeover is the same window, and the panel's Space key works in it; on the overlay Space is the meeting's.
            <div className="subtitle-ptt-hint">
              <p>{t('subtitle.pttHint', 'Press Space to speak')}</p>
            </div>
          ) : (
            <SubtitleBody
              entries={entries}
              lit={lit}
              compact={subtitle.compactMode}
              fontSize={subtitle.fontSize}
              filters={filters}
              sourceTextColor={subtitle.sourceTextColor}
              translationTextColor={subtitle.translationTextColor}
              newItemHighlightEnabled={newItemHighlightEnabled}
            />
          )}
          {surface === 'extension-overlay' && session.holdToTalk && (
            <HoldToTalk onPress={controls.press} onRelease={controls.release} />
          )}
        </>
      ) : (
        <SubtitleIdle
          state={idleState(session?.idle, t)}
          onStart={start ?? noop}
          onFix={noop}
          onReturn={controls.exit}
          allowSessionControl={surface === 'electron'}
          canStart={session?.canStart ?? false}
        />
      )}
      {chrome.resizeHandles}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/components/Subtitle` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle
git commit -m "feat(subtitle): the subtitle view over entries and the run, with hold-to-talk on the overlay"
```

---

### Task 7: Both surfaces in the preview; a headless check

**Files:**
- Create: `src/components/dev/OverlayPreview.tsx`, `src/components/dev/OverlayPreview.test.tsx`, `scripts/dev/spine-subtitle-probe.mjs`
- Modify: `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`, `src/components/dev/SpinePreview.test.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `SubtitleView`, `SubtitleModel`, `SubtitleControls` (Task 6); `publishSubtitles`, `receiveSubtitles`, `messagePortWire` (Task 3); `appSubtitleSession` (Task 2); the preview's runner, view (`getPreviewView`) and karaoke (plan 1d-1); `useSubtitleStore` (`setCompactMode`); `useTurnModeStore` (`setTurnMode`); `createFakeSource(clock, { voiced })`; `scripts/dev/headless.mjs` (`withPage`, `evaluate`, `sleep`).
- Produces: preview URL parameters `&subtitle=1` (the Electron-style view on the page), `&overlay=1` (the overlay in an iframe), `&compact=1`, `&turn=push-to-talk|push-to-translate`; `?preview=overlay` (the iframe's page); `scripts/dev/spine-subtitle-probe.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/dev/OverlayPreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('../Subtitle/SubtitleView', () => ({
  SubtitleView: (p: { surface: string; model: { entries: unknown[]; session: unknown } }) =>
    require('react').createElement('div', { 'data-testid': 'view', 'data-surface': p.surface, 'data-entries': String(p.model.entries.length), 'data-session': p.model.session ? 'yes' : 'no' }),
}));

const { OverlayPreview } = await import('./OverlayPreview');

describe('OverlayPreview', () => {
  it('draws the overlay once its parent hands it a port, from what arrives on it', async () => {
    const { findByTestId, queryByTestId } = render(<OverlayPreview />);
    expect(queryByTestId('view')).toBeNull();
    const channel = new MessageChannel();
    await act(async () => {
      // A plain event carrying what a MessageEvent would: jsdom's MessageEvent rejects Node's MessagePort.
      window.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'sokuji-subtitle:connect' }, ports: [channel.port2], origin: window.location.origin }));
    });
    channel.port1.postMessage({ type: 'subtitle:entries', entries: [{ kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'm', at: 0 }] });
    const view = await findByTestId('view');
    expect(view.dataset.surface).toBe('extension-overlay');
    await vi.waitFor(() => expect(view.dataset.entries).toBe('1'));
    channel.port1.close();
  });
});
```

In `src/components/dev/SpinePreview.test.tsx` (reusing its mocks; add `waitFor` to its `@testing-library/react` import if missing):

```tsx
  it('draws the subtitle view on the page with &subtitle=1', async () => {
    const before = window.location.href;
    window.history.replaceState(null, '', '/?preview=spine&subtitle=1');
    try {
      const { container } = render(<SpinePreview />);
      await waitFor(() => expect(container.querySelector('.spine-subtitle .subtitle-app')).not.toBeNull());
    } finally {
      window.history.replaceState(null, '', before);
    }
  });
```

Run: `npx vitest run src/components/dev` — the new tests FAIL.

- [ ] **Step 2: The overlay's page**

Create `src/components/dev/OverlayPreview.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { messagePortWire, receiveSubtitles, type OverlayModel } from '../../lib/subtitle/wire';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useReadable } from '../Conversation/useReadable';
import { SubtitleView, type SubtitleControls } from '../Subtitle/SubtitleView';

type Receiver = ReturnType<typeof receiveSubtitles>;

/**
 * Development builds only (`?preview=overlay`): the extension overlay's
 * stand-in, drawn inside the preview's iframe. Its parent hands it one end of
 * a `MessageChannel` — the wire the extension carries over `chrome.runtime`
 * (plan 1e) — and it draws what arrives.
 */
export function OverlayPreview() {
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  useEffect(() => {
    // `&compact=1`: this page has its own subtitle store, like the real overlay's iframe.
    if (new URLSearchParams(window.location.search).get('compact') === '1') void useSubtitleStore.getState().setCompactMode(true);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'sokuji-subtitle:connect' || !event.ports[0]) return;
      setReceiver((previous) => {
        previous?.dispose();
        return receiveSubtitles(messagePortWire(event.ports[0]));
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  if (!receiver) return null;
  return <ConnectedOverlay receiver={receiver} />;
}

function ConnectedOverlay({ receiver }: { receiver: Receiver }) {
  const model: OverlayModel = useReadable(receiver);
  const controls: SubtitleControls = useMemo(() => ({
    exit: () => receiver.send({ type: 'subtitle:user-exit' }),
    clear: () => receiver.send({ type: 'subtitle:request-clear' }),
    press: () => receiver.send({ type: 'subtitle:turn-press' }),
    release: () => receiver.send({ type: 'subtitle:turn-release' }),
  }), [receiver]);
  return <SubtitleView surface="extension-overlay" model={model} controls={controls} />;
}
```

In `src/App.tsx`, next to the `preview === 'spine'` branch and behind the same `import.meta.env.DEV` guard, render `<div className="App"><OverlayPreview /></div>` for `preview === 'overlay'` (lazy-loaded the same way the spine preview is, if it is lazy-loaded; otherwise a static import like `SpinePreview`'s).

- [ ] **Step 3: The preview draws both surfaces**

In `src/components/dev/SpinePreview.tsx`:

1. Read the new parameters once (a `useMemo` over `window.location.search`): `subtitle`, `overlay`, `compact`, `turn`.
2. In the autostart effect, before `runner.start()`, after the existing `script` / `cut` handling: `&turn=push-to-talk|push-to-translate` → `useTurnModeStore.getState().setTurnMode(turn)`; `&compact=1` → `void useSubtitleStore.getState().setCompactMode(true)`.
3. The page's fake source: when `turn` is a manual mode, the bridge's `openSource` builds `createFakeSource(realClock, { voiced: true })` — a turn needs voice to end rather than be cancelled (`MIN_VOICED_MS`).
4. A session source per page, beside `previewView`: `appSubtitleSession(getPreviewRunner(), getPreviewView(runner))`, created once (module level, like the view).
5. `&subtitle=1`: under the conversation list, a fixed box (`.spine-subtitle`, 900 × 240) holding `<SubtitleView surface="electron" model={…} controls={…} />` — model from the view's entries, the karaoke's `lit` and the session (`useReadable` on each); controls: `start: () => void runner.start()`, `stop: () => void runner.stop()`, `press`/`release` → the runner's, `clear: () => runner.clear()`, `exit: () => {}` (the preview has no subtitle mode to leave). Keep the controls object stable (`useMemo`).
6. `&overlay=1`: an iframe (`.spine-overlay-frame`, 900 × 240, `src` = `?preview=overlay` plus `&compact=1` when the page has it) and, on its `load`, one `MessageChannel`: post `{ type: 'sokuji-subtitle:connect' }` to `iframe.contentWindow` with `window.location.origin` as the target origin and `[channel.port2]` as the transfer list, and `publishSubtitles(messagePortWire(channel.port1), { entries, session, karaoke }, { clear, exit, press, release })` with the same runner controls (`exit` does nothing). `entries` is `{ get: () => view.get().entries, subscribe: view.subscribe }`; `karaoke` is the page's karaoke once the playback loaded — until then a `Readable` of the empty state (reuse `NO_KARAOKE`). Stop the publisher and close the port when the iframe reloads or the page unmounts.
7. In `SpinePreview.scss`:

```scss
.spine-subtitle,
.spine-overlay-frame {
  display: block;
  width: 900px;
  height: 240px;
  margin-top: 12px;
  border: 1px solid #444;
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/components/dev` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: The headless check**

Create `scripts/dev/spine-subtitle-probe.mjs`:

```js
#!/usr/bin/env node
/**
 * Plays the development preview's fake session with both subtitle surfaces on
 * the page — the Electron-style view, and the overlay in an iframe fed over a
 * MessageChannel — and checks what each drew (plan 1d-2).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-subtitle-probe.mjs [url] [seconds] [screenshot.png]
 *
 * Default url: http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1.
 * Add `&script=cjk&cut=sentences:1` (bands unspaced between CJK segments) or
 * `&turn=push-to-talk` (the probe holds the overlay's button for 1.5 s, and
 * the fake's first block must then reach both surfaces).
 *
 * Exits 1 unless both surfaces end with the same texts — with `&compact=1`
 * the bands (at least a source and a translation band), without it the
 * expanded list's rows (at least four) — the overlay lit karaoke at least
 * once, and:
 * for `script=cjk`, no ASCII space sits between two CJK characters in any
 * band; for `turn=`, the Electron view showed the Space hint and the overlay
 * its hold button before the press, and both drew bands after it.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1';
const seconds = Number(process.argv[3] ?? 12);
const screenshot = process.argv[4] ?? null;
const manual = /[?&]turn=push-to-/.test(url);
const cjk = url.includes('script=cjk');

const READ = `(() => {
  // Compact: the band texts. Expanded: the list's row texts.
  const lines = (doc) => doc
    ? [...doc.querySelectorAll(${compact ? "'.subtitle-app .subtitle-stream__line'" : "'.subtitle-app .conversation-row .row-text'"})].map((l) => l.textContent)
    : null;
  const frame = document.querySelector('iframe.spine-overlay-frame');
  const inner = frame && frame.contentDocument;
  return {
    page: lines(document.querySelector('.spine-subtitle') ? document : null),
    overlay: lines(inner),
    lit: inner ? inner.querySelectorAll('.karaoke-played').length : 0,
    hint: !!document.querySelector('.spine-subtitle .subtitle-ptt-hint'),
    hold: !!(inner && inner.querySelector('.subtitle-hold__button')),
  };
})()`;

const HOLD = (type) => `(() => {
  const inner = document.querySelector('iframe.spine-overlay-frame')?.contentDocument;
  const button = inner && inner.querySelector('.subtitle-hold__button');
  if (!button) return false;
  button.dispatchEvent(new PointerEvent('${type}', { bubbles: true }));
  return true;
})()`;

const CJK_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}] [\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const compact = url.includes('compact=1');

process.exitCode = await withPage(url, async (send) => {
  const failures = [];
  let litEver = false;
  let before = null;
  let last = null;
  if (manual) {
    await sleep(3000);
    before = await evaluate(send, READ);
    if (!(await evaluate(send, HOLD('pointerdown')))) failures.push('no hold button to press');
    await sleep(1500);
    await evaluate(send, HOLD('pointerup'));
  }
  for (let waited = 0; waited < seconds * 1000; waited += 250) {
    await sleep(250);
    last = await evaluate(send, READ);
    if (last) litEver ||= last.lit > 0;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  const page = last?.page ?? [];
  const overlay = last?.overlay ?? [];
  console.log(`page ${compact ? 'bands' : 'rows'}: ${JSON.stringify(page)}`);
  console.log(`overlay ${compact ? 'bands' : 'rows'}: ${JSON.stringify(overlay)}`);
  console.log(`overlay karaoke: ${litEver ? 'lit' : 'never'}` + (manual ? ` · before the press: hint ${before?.hint}, hold ${before?.hold}` : ''));
  if (page.length < (compact ? 2 : 4)) failures.push(compact ? 'the page view drew fewer than two bands' : 'the page view drew fewer than four rows');
  if (JSON.stringify(page) !== JSON.stringify(overlay)) failures.push('the two surfaces drew different bands');
  if (!litEver) failures.push('the overlay never lit karaoke');
  if (cjk && [...page, ...overlay].some((text) => CJK_SPACE.test(text))) failures.push('a space sits between CJK characters');
  if (manual && !(before?.hint && before?.hold)) failures.push('before the press: no Space hint on the page view or no hold button on the overlay');
  for (const failure of failures) console.log(`FAIL: ${failure}`);
  return failures.length === 0 ? 0 : 1;
}, { viewport: { width: 1000, height: 2200 } });
```

- [ ] **Step 6: Run the checks against the running preview**

Start `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort` in the background and wait until it answers 200 on port 5199. Then run, saving each screenshot under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`:

```bash
node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1' 12 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d2-exchange.png
node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1&script=cjk&cut=sentences:1' 10 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d2-cjk.png
node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1&turn=push-to-talk' 10 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d2-hold.png
node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1' 12 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d2-expanded.png
node scripts/dev/spine-surface-probe.mjs
node scripts/dev/spine-audio-probe.mjs
```

The fourth run is the expanded mode (no `&compact=1`): the probe compares the list's rows there. Every command must exit 0. Record each command's printed lines and exit code in the report; open the screenshots with your Read tool and describe what each shows. Stop vite afterwards and confirm port 5199 is free.

If a probe fails for a reason in the page, debug the page; never loosen the probe. If the cause lies outside Task 7's files, report DONE_WITH_CONCERNS with the evidence.

- [ ] **Step 7: Commit**

```bash
git add src/components/dev src/App.tsx scripts/dev/spine-subtitle-probe.mjs
git commit -m "feat(dev): both subtitle surfaces in the preview, the overlay over a real MessageChannel; a headless check"
```

---

## Self-review notes (for the executor)

- `Readable.get()` must return the same object while nothing changes (`useSyncExternalStore`): the view, the karaoke, `appSubtitleSession` and the receiver all do; a `Readable` built inline in the preview (`entries`) must read through, not rebuild.
- The overlay's page has its own stores (a separate document, like the real iframe): whatever it needs from settings it sets itself (`&compact=1`).
- The rendered pages of Task 7 go to jiangzhuo with ruling 2's notice placement and the hold button's place for review.
