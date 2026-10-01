# Client contract — Stage 1d-1: the conversation view and the panel list

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel's conversation list, rebuilt on L2's `Entry[]` and driven by the runner: rows that carry what a surface draws, typed notice codes, one throttled view of the conversation, pure L3 functions (filter, karaoke, notice text), and the list components — rendered in the development preview against the fake provider and checked in headless Chromium.

**Architecture:** L2 (`src/lib/projection`) keeps cutting, grouping and ordering, but each `Row` now carries its text slice, `final` and detected language, so a surface — including the extension overlay, which only ever receives `Entry[]` (plan 1d-2) — renders without reaching back into L1. A new `src/lib/view` holds what every surface shares and nothing React: a view store that re-projects at most every 50 ms, the display filter and header grouping, karaoke from the clip queues' positions (with a gap rule decided from L1's data, not a timer), and the localized text of a notice. `src/components/Conversation` renders it with the markup and stylesheets of today's `ConversationRow` and error bubble, so it looks the same. Nothing in today's `MainPanel`, `ConversationRow`, subtitle surfaces or stores changes: plan 1e swaps the new list in.

**Tech Stack:** TypeScript (strict), React 18, zustand, i18next / react-i18next, Vitest + @testing-library/react (jsdom), headless Chromium over the DevTools protocol (Node 22's global `WebSocket`).

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — read "L1 — the data model" (Segment, Notice, the language pair, re-anchoring), "L2 — the projection" through "The two subtitle surfaces are not the same thing", "The clip queue", "Notices reach the user localized", "Testing" → Rendering, and "UI rules deferred to the UI work". The roadmap (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`) lists the items this plan picks up under "Carried out of plan 1a" → 1d, "Carried out of plan 1c-1" → 1d and "Deferred by plan 1c-2" → 1d.

## Global Constraints

- Nothing outside the files each task names changes. In particular: `src/components/MainPanel/**` (read and imported, never edited), `src/components/Subtitle/**`, `src/services/**`, `electron/**`, `extension/**`, and the stores (`src/stores/**`) are read only.
- Record a caught failure with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`; never `console.error` / `console.warn`. Hot paths (per chunk, per frame, per poll tick) never report per occurrence.
- English only in code, comments and the English locale. New locale keys go into `src/locales/en/translation.json` only; the other locales are translated in plan 1e, before the new list reaches users (English is the fallback until then).
- New React components are tested with `@testing-library/react`, mocking `react-i18next` the way `src/components/MainPanel/ConversationRow.test.tsx` does.
- `src/lib/**` never imports React. Only `src/lib/view/appViewSettings.ts` reads a store.
- Match the markup and class names of the nearest existing instance of each control (today's `ConversationRow` and the error bubble in `MainPanel.tsx:161-172`); the new components import today's stylesheets rather than restating them.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and the typecheck gate prints exactly the four baseline lines:

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|dev/(SpinePreview|SessionControls))|stores/(providerStore|turnModeStore|routingStore)|utils/environment|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  Baseline: `src/App.tsx: error TS6133: 'React' is declared…`; `src/lib/analytics.ts: error TS6133: 'response'…`; `src/utils/environment.ts: error TS2717…`; `src/utils/environment.ts: error TS2339…`.
- Commits: conventional, English, one per task at least; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. Never push.

## Rulings this plan makes (the spec and roadmap left them open)

1. **A `Row` carries its text, `final` and detected language** (roadmap 1a→1d). The overlay receives `Entry[]` alone (spec: "The overlay receives `Entry[]` and renders"), so entries must be self-contained; the text is sliced once in L2. `pcm` still never leaves L1.
2. **An open segment is cut like a closed one; its last row is the live one** (spec: "An open segment ends in one live row"). As built in 1a, the sentences mode left an open segment whole and re-cut it at close.
3. **No blank rows.** A segment with no visible text yields no rows; an exchange with no rows on either side is left out; a whitespace-only range joins the row before it, so the ranges still tile the text.
4. **Pause cuts use each side's own pause** — the two stored pauses (`segmentationSourcePause`, `segmentationTranslationPause`) — instead of one `pauseMs`.
5. **Notice codes are snake_case everywhere** (roadmap 1c-1→1d), typed as `RunNoticeCode` for the runner's own; a provider's refusal may carry `code` and `params`.
6. **`busy` stays unread** until the first provider that needs text queuing (OpenAI, Stage 2): no surface draws a "responding" indicator today (`isAIResponding` is never rendered), so state with no reader is not added. `frame` gets its port now — the Logs panel is its reader.
7. **Karaoke within a clip is proportional between the clip's range ends**; a clip with no range lights nothing. In a gap between clips, the last lit state holds while the segment's speech may still continue — the segment is open, or its speech ranges do not yet reach its last letter or digit — and ends otherwise. The output element's latency is accepted as a lag (roadmap 1c-2→1d), not offset.
8. **Today's UI rules stand** (spec: "UI rules deferred"): a header opens where the leg changes; a notice never opens or breaks a header group; a notice shows on every side's filter, `none` included; an exchange's source rows come before its translation rows. The only visible change: a warning notice's label reads "Warning" instead of "Error" (same red bubble). The rendered pages of Task 7 go to jiangzhuo for review.
9. **Replay**: one button per translation segment, on its last row; replaying plays the whole segment. The slot shows on speaker translation rows when "Keep audio for replay" is on, and on participant translation rows when participant speech is on too; it is enabled when the segment kept pcm. While one segment replays the other buttons are disabled, as today.
10. **`clear()` keeps its two behaviours** (roadmap 1a→1d asked to confirm): the kept open segment's clip keys restart with its emptied `speech`, in step with `Playback.clear()` resetting its counts; and the next whole-text snapshot of a segment still open brings its text back, because an adapter's text events are whole snapshots — clearing hides what was said, it cannot shorten a sentence still being spoken.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/projection/types.ts` | 1 | `Row` gains `text`, `final`, `language?`; `CutSettings` gains the two pauses |
| `src/lib/projection/cut.ts` | 1 | rows carry their text; no blank rows; open segments cut; pause per side |
| `src/lib/projection/project.ts` | 1 | empty exchanges left out; `sameRows` compares the new fields |
| `src/lib/projection/join.ts` (new) | 2 | `needsSpace`, `joinSegmentTexts` — by code point |
| `src/lib/export/transcript.ts` | 2 | uses `joinSegmentTexts` |
| `src/lib/conversation/Conversation.ts`, `reanchor.ts` | 2 | no growth mark without a text change; re-anchor when the old skeleton is a prefix |
| `src/lib/session/codes.ts` (new) | 3 | `RUN_NOTICE_CODES`, `RunNoticeCode` |
| `src/lib/session/{run,runner,shape,ports,types}.ts`, `src/lib/provider/types.ts`, `src/providers/fake/provider.ts` | 3 | snake_case codes; `Refusal` with `code`/`params`; the frames port |
| `src/lib/view/conversationView.ts` (new) | 4 | `Readable<T>`, `createConversationView` |
| `src/lib/view/appViewSettings.ts` (new) | 4 | `projectionFrom`, `appProjectionSettings` (the one store reader) |
| `src/lib/audio/playback.ts` | 5 | `parseClipKey` next to `clipKey` |
| `src/lib/view/karaoke.ts` (new) | 5 | `litFor`, `nextLit`, `createKaraoke` |
| `src/lib/view/filter.ts` (new) | 5 | `SideFilter`, `displayItems` |
| `src/lib/view/noticeText.ts` (new) | 5 | `noticeText` and the code → words table |
| `src/locales/en/translation.json` | 5, 6 | `notices.*`, `mainPanel.warning` |
| `src/components/Conversation/ConversationList.tsx` (new) | 6 | the list: rows, notices, empty state, auto-scroll |
| `src/components/Conversation/useReadable.ts` (new) | 6 | `useReadable` over `useSyncExternalStore` |
| `src/providers/fake/scripts.ts` | 7 | a `notices` script |
| `src/components/dev/{SpinePreview,SessionControls}.tsx` | 7 | the preview renders the new list; `&script=`, `&cut=` |
| `scripts/dev/headless.mjs` (new), `scripts/dev/spine-surface-probe.mjs` (new), `scripts/dev/spine-audio-probe.mjs` | 7 | a shared headless page helper; the surface probe |

---

### Task 1: Rows carry what a surface draws

**Files:**
- Modify: `src/lib/projection/types.ts`, `src/lib/projection/cut.ts`, `src/lib/projection/project.ts`
- Test: `src/lib/projection/cut.test.ts`, `src/lib/projection/project.test.ts`, and the `rows` helper in `src/lib/export/transcript.test.ts`

**Interfaces:**
- Produces: `Row { key; segmentId; side; start; end; text: string; final: boolean; language?: string }`; `CutSettings { mode; sentencesPerRow; sourcePauseMs: number; translationPauseMs: number }`; `DEFAULT_PROJECTION` with both pauses 0. Every later task reads rows this way.

- [ ] **Step 1: Update the cut tests to the new shapes and write the failing ones**

In `src/lib/projection/cut.test.ts`, replace the whole `describe('cutSegment', …)` block with:

```ts
describe('cutSegment', () => {
  const sentences = { mode: 'sentences' as const, sentencesPerRow: 1, sourcePauseMs: 0, translationPauseMs: 0 };
  const pause = { mode: 'pause' as const, sentencesPerRow: 0, sourcePauseMs: 1500, translationPauseMs: 1500 };
  const off = { mode: 'off' as const, sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0 };

  it("cuts a final segment by sentences, keys the rows, and gives each its text and the segment's state", () => {
    const rows = cutSegment(seg({ text: 'One. Two.', language: 'en' }), sentences);
    expect(rows).toEqual([
      { key: 's:speaker:1:0', segmentId: 's:speaker:1', side: 'source', start: 0, end: 4, text: 'One.', final: true, language: 'en' },
      { key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9, text: ' Two.', final: true, language: 'en' },
    ]);
  });

  it('leaves the language off a row whose segment has none', () => {
    expect(cutSegment(seg({ text: 'One.' }), off)[0]).not.toHaveProperty('language');
  });

  it('cuts an open segment like a closed one, its last row the live one', () => {
    const rows = cutSegment(seg({ text: 'One. Tw', final: false }), sentences);
    expect(rows.map((r) => [r.start, r.end, r.final])).toEqual([[0, 4, false], [4, 7, false]]);
  });

  it('joins a whitespace-only range to the row before it, so no row is blank and the rows still tile the text', () => {
    const rows = cutSegment(seg({ text: 'One. Two. ' }), sentences);
    expect(rows.map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 10]]);
    expect(rows.map((r) => r.text).join('')).toBe('One. Two. ');
  });

  it('yields no rows for a segment with no text, or only whitespace', () => {
    expect(cutSegment(seg({ text: '' }), off)).toEqual([]);
    expect(cutSegment(seg({ text: '  ' }), sentences)).toEqual([]);
  });

  it("cuts by pause whether the segment is open or closed, with its own side's pause", () => {
    const marks = [{ at: 0, len: 4 }, { at: 3000, len: 8 }];
    expect(cutSegment(seg({ text: 'abcdefgh', final: false, marks }), pause).map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 8]]);
    const translation = seg({ side: 'translation', text: 'abcdefgh', final: false, marks });
    expect(cutSegment(translation, { ...pause, translationPauseMs: 5000 })).toHaveLength(1);
    expect(cutSegment(translation, { ...pause, sourcePauseMs: 5000 })).toHaveLength(2);
  });

  it('is one row when segmentation is off', () => {
    expect(cutSegment(seg({ text: 'One. Two.' }), off)).toHaveLength(1);
  });
});
```

In `src/lib/projection/project.test.ts`, add inside `describe('createProjector', …)`:

```ts
  it('leaves out an exchange with no text on either side', () => {
    const empty = seg('speaker', { text: '', final: false });
    expect(createProjector().project([legOf('speaker', [empty])], DEFAULT_PROJECTION)).toEqual([]);
  });

  it('makes a new entry when a segment only turned final, and its rows say so', () => {
    const projector = createProjector();
    const open = seg('speaker', { final: false });
    const first = projector.project([legOf('speaker', [open])], DEFAULT_PROJECTION);
    const second = projector.project([legOf('speaker', [{ ...open, final: true }])], DEFAULT_PROJECTION);
    expect(second[0]).not.toBe(first[0]);
    expect(exchanges(second)[0].source[0]).toMatchObject({ text: 'x.', final: true });
  });
```

In `src/lib/export/transcript.test.ts`, the `rows` helper builds `Row`s by hand; give them the new fields:

```ts
const rows = (s: Segment) => [{ key: `${s.id}:0`, segmentId: s.id, side: s.side, start: 0, end: s.text.length, text: s.text, final: s.final }];
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/projection`
Expected: FAIL — rows lack `text`/`final`/`language`, the open segment stays one row, the blank tail and the empty segment yield rows, the per-side pause is ignored, the empty exchange is kept.

- [ ] **Step 3: Change the types**

In `src/lib/projection/types.ts`, replace `Row` and `CutSettings` with:

```ts
/** A drawn line: a stretch of one segment's text, carrying what a surface draws. */
export interface Row {
  /** `${segmentId}:${k}` — stable while the cut does not change. */
  key: string;
  segmentId: SegmentId;
  side: Side;
  start: number;
  end: number;
  /**
   * The segment's text over [start, end), untrimmed: adjacent rows of one
   * segment concatenated reproduce its text. A bubble trims it for display;
   * a band joins rows as they are.
   */
  text: string;
  /** The segment is final. */
  final: boolean;
  /** The segment's detected language, when the provider reported one. */
  language?: string;
}
```

```ts
export interface CutSettings {
  mode: 'off' | 'pause' | 'sentences';
  /** 0 = whole segment. */
  sentencesPerRow: number;
  /** The pause that cuts a source segment's rows under the pause mode; 0 = none. */
  sourcePauseMs: number;
  /** The same for a translation segment. */
  translationPauseMs: number;
}
```

- [ ] **Step 4: Cut rows with their text**

In `src/lib/projection/cut.ts`, replace `cutSegment` with:

```ts
/** A segment's rows under the settings. An open segment is cut like a closed
 *  one — its last row is the live one — and a pause cut applies to open and
 *  closed alike, with the pause of the segment's own side. A segment with no
 *  visible text has no rows. */
export function cutSegment(seg: Segment, settings: CutSettings): Row[] {
  if (seg.text.trim().length === 0) return [];
  let ranges: TextRange[];
  if (settings.mode === 'sentences') {
    ranges = cutRanges(seg.text, settings.sentencesPerRow);
  } else if (settings.mode === 'pause') {
    const pauseMs = seg.side === 'source' ? settings.sourcePauseMs : settings.translationPauseMs;
    ranges = rangesFromCuts(seg.text.length, pauseCuts(seg.marks, pauseMs, seg.text.length));
  } else {
    ranges = [[0, seg.text.length]];
  }
  return withoutBlankRanges(seg.text, ranges).map(([start, end], k) => ({
    key: `${seg.id}:${k}`,
    segmentId: seg.id,
    side: seg.side,
    start,
    end,
    text: seg.text.slice(start, end),
    final: seg.final,
    ...(seg.language !== undefined ? { language: seg.language } : {}),
  }));
}

/**
 * A range holding only whitespace joins the range before it — or, at the
 * start, the one after — so no row is blank and the ranges still tile the
 * text. The caller has checked that the text is not blank as a whole.
 */
function withoutBlankRanges(text: string, ranges: TextRange[]): TextRange[] {
  const out: TextRange[] = [];
  let carried: number | null = null;
  for (const [start, end] of ranges) {
    if (text.slice(start, end).trim().length === 0) {
      if (out.length > 0) out[out.length - 1] = [out[out.length - 1][0], end];
      else carried ??= start;
      continue;
    }
    out.push([carried ?? start, end]);
    carried = null;
  }
  return out;
}
```

- [ ] **Step 5: Leave empty exchanges out and compare the new fields**

In `src/lib/projection/project.ts`:

1. Change `DEFAULT_PROJECTION` to:

```ts
export const DEFAULT_PROJECTION: ProjectionSettings = { mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING };
```

2. In `project`, build the cut from the new fields:

```ts
      const cut: CutSettings = {
        mode: settings.mode,
        sentencesPerRow: settings.sentencesPerRow,
        sourcePauseMs: settings.sourcePauseMs,
        translationPauseMs: settings.translationPauseMs,
      };
```

3. In the loop over `groupsOf(...)`, skip a candidate with no rows before it reaches `reuse` (so the cache never keeps it):

```ts
          if (candidate.source.length === 0 && candidate.translation.length === 0) continue;
          next.push(reuse(entries, kept, candidate));
```

4. Replace `sameCut` and `sameRows` with:

```ts
function sameCut(a: CutSettings, b: CutSettings): boolean {
  return a.mode === b.mode && a.sentencesPerRow === b.sentencesPerRow
    && a.sourcePauseMs === b.sourcePauseMs && a.translationPauseMs === b.translationPauseMs;
}
```

```ts
function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.key !== y.key || x.segmentId !== y.segmentId || x.side !== y.side || x.start !== y.start || x.end !== y.end) return false;
    if (x.text !== y.text || x.final !== y.final || x.language !== y.language) return false;
  }
  return true;
}
```

- [ ] **Step 6: Run the tests to see them pass, then the gates**

Run: `npx vitest run src/lib/projection src/lib/export`
Expected: PASS.
Run: `npx vitest run src` (0 failed) and the typecheck gate (four baseline lines). `grep -rn '\.pauseMs\|pauseMs:' src --include='*.ts' --include='*.tsx'` must print nothing: no setting named `pauseMs` is left (the `pauseMs` parameter of `pauseCuts` stays).

- [ ] **Step 7: Commit**

```bash
git add src/lib/projection src/lib/export/transcript.test.ts
git commit -m "feat(projection): rows carry their text, finality and language; no blank rows"
```

---

### Task 2: L1 and joining fixes

**Files:**
- Create: `src/lib/projection/join.ts`, `src/lib/projection/join.test.ts`
- Modify: `src/lib/export/transcript.ts`, `src/lib/conversation/Conversation.ts:208`, `src/lib/conversation/reanchor.ts`
- Test: `src/lib/conversation/Conversation.test.ts`, `src/lib/conversation/reanchor.test.ts`

**Interfaces:**
- Produces: `needsSpace(before: string, after: string): boolean` and `joinSegmentTexts(texts: readonly string[]): string` in `src/lib/projection/join.ts` (plan 1d-2's band surface joins with `needsSpace`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/projection/join.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { joinSegmentTexts, needsSpace } from './join';

describe('needsSpace', () => {
  it('asks for a space only between two space-delimited scripts', () => {
    expect(needsSpace('Hello.', 'World')).toBe(true);
    expect(needsSpace('今天', '天气')).toBe(false);
    expect(needsSpace('見て', 'OK')).toBe(false);
    expect(needsSpace('OK', 'です')).toBe(false);
  });

  it('reads a character outside the basic plane as one character', () => {
    // 𠮷 is Han, written as a surrogate pair.
    expect(needsSpace('𠮷', 'a')).toBe(false);
    expect(needsSpace('a', '𠮷')).toBe(false);
  });

  it('asks for none beside an empty piece', () => {
    expect(needsSpace('', 'a')).toBe(false);
    expect(needsSpace('a', '')).toBe(false);
  });
});

describe('joinSegmentTexts', () => {
  it('trims each piece, skips empty ones, and spaces only where the scripts need it', () => {
    expect(joinSegmentTexts([' Hello. ', '', 'World.'])).toBe('Hello. World.');
    expect(joinSegmentTexts(['今天天气很好。', ' 我们去公园吧。'])).toBe('今天天气很好。我们去公园吧。');
    expect(joinSegmentTexts(['𠮷', 'a'])).toBe('𠮷a');
  });
});
```

In `src/lib/conversation/reanchor.test.ts`, add:

```ts
  it('re-anchors by skeleton when the text was re-punctuated and grew', () => {
    // A translation re-punctuated while it grows: "hello world" → "Hello, world. How".
    expect(reanchorRanges('hello world', 'Hello, world. How', [[0, 5], [6, 11]])).toEqual([[0, 7], [7, 14]]);
  });
```

In `src/lib/conversation/Conversation.test.ts`, add inside `describe('Conversation — identity and text', …)`:

```ts
  it('pushes no growth mark when only the timing or the language changed', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    const before = conv.snapshot().segments[0].marks;
    clock.advance(5000);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello', timing: { startMs: 0, endMs: 400 }, language: 'en' } });
    const seg = conv.snapshot().segments[0];
    expect(seg.timing).toEqual({ startMs: 0, endMs: 400 });
    expect(seg.language).toBe('en');
    expect(seg.marks).toEqual(before);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/projection/join.test.ts src/lib/conversation`
Expected: FAIL — `join.ts` does not exist; the prefix case drops its ranges; the timing-only change pushes a mark.

- [ ] **Step 3: Write `join.ts`**

Create `src/lib/projection/join.ts`:

```ts
/**
 * Joining the text of several segments. A separator is needed only between
 * segments — rows of one segment tile its text — and there it follows the
 * script (spec: "The ranges tile the segment's text"): Chinese and Japanese
 * take none. Characters are read by code point, so a Han character outside
 * the basic plane (𠮷) counts as Han.
 */

/** Han, kana, CJK symbols and punctuation, and fullwidth forms: no space beside them. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** The last character of `s`, a surrogate pair kept whole. */
function lastChar(s: string): string {
  const low = s.charCodeAt(s.length - 1);
  return low >= 0xdc00 && low <= 0xdfff && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

/** Whether two pieces joined here need a space: only when both sides of the boundary are space-delimited script. */
export function needsSpace(before: string, after: string): boolean {
  if (before.length === 0 || after.length === 0) return false;
  const first = String.fromCodePoint(after.codePointAt(0)!);
  return !UNSPACED.test(lastChar(before)) && !UNSPACED.test(first);
}

/** Several segments' text as one: each piece trimmed, empty ones skipped, a space only where `needsSpace` says. */
export function joinSegmentTexts(texts: readonly string[]): string {
  let out = '';
  for (const text of texts) {
    const piece = text.trim();
    if (piece.length === 0) continue;
    if (needsSpace(out, piece)) out += ' ';
    out += piece;
  }
  return out;
}
```

- [ ] **Step 4: The export writer uses it**

In `src/lib/export/transcript.ts`, delete the `UNSPACED` constant and the `joinTexts` function (with their comments), add `import { joinSegmentTexts } from '../projection/join';`, and in `sideOf` call `joinSegmentTexts(ids.map((id) => index.get(id)?.text ?? ''))`.

- [ ] **Step 5: Mark growth only when the text changed**

In `src/lib/conversation/Conversation.ts`, in `private text(...)`, change the last line to:

```ts
    // A timing- or language-only snapshot is not growth: a mark there would
    // read as the end of a pause to L2's cut.
    this.replaceText(i, text, { timing, language, mark: seg.text !== text });
```

- [ ] **Step 6: Re-anchor when the old skeleton is a prefix**

In `src/lib/conversation/reanchor.ts`, replace the skeleton-equality branch with a prefix test, and update the doc comment's middle case:

```ts
/**
 * Speech ranges are measured against the text at production time, and the
 * text is replaced repeatedly. Three cases (spec: "Re-anchoring on every text
 * replacement"): the text only grew — ranges stand; the old letters and
 * digits are still where the new text starts, in a different dress and
 * perhaps followed by more — re-anchor by skeleton; letters changed — the
 * ranges are gone, the pcm stays.
 */
export function reanchorRanges(
  oldText: string,
  newText: string,
  ranges: ReadonlyArray<TextRange | undefined>,
): Array<TextRange | undefined> {
  if (ranges.every((r) => r === undefined)) return [...ranges];
  if (newText.startsWith(oldText)) return [...ranges];
  if (skeleton(newText).startsWith(skeleton(oldText))) {
    return ranges.map((r) => (r ? [mapOffset(oldText, newText, r[0]), mapOffset(oldText, newText, r[1])] : undefined));
  }
  return ranges.map(() => undefined);
}
```

- [ ] **Step 7: Run the tests, then the gates**

Run: `npx vitest run src/lib/projection src/lib/conversation src/lib/export`
Expected: PASS (the existing "drops ranges when letters changed" case still passes: `hallo world` does not start with `helloworld`'s skeleton).
Run: `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 8: Commit**

```bash
git add src/lib/projection/join.ts src/lib/projection/join.test.ts src/lib/export/transcript.ts src/lib/conversation
git commit -m "fix(conversation): join by code point, mark growth only on new text, re-anchor re-punctuated growth"
```

---

### Task 3: Typed notice codes, refusals with codes, and the frames port

**Files:**
- Create: `src/lib/session/codes.ts`
- Modify: `src/lib/session/shape.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/session/ports.ts`, `src/lib/session/types.ts`, `src/lib/provider/types.ts`, `src/providers/fake/provider.ts`
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/runner.hooks.test.ts`, `src/lib/session/shape.test.ts`, `src/components/dev/SessionControls.test.tsx`, `src/providers/fake/provider.test.ts`

**Interfaces:**
- Produces: `RUN_NOTICE_CODES` / `RunNoticeCode` (Task 5's notice table keys on them); `ProviderRefusal { refused: string; code?: string; params?: Record<string, string | number> }` in `src/lib/provider/types.ts` (`build` returns `C | ProviderRefusal`, `admit` returns `true | ProviderRefusal`; the session module's own `Refusal` in `shape.ts` is a different type, the notice a refused start records); `FramePort { frame(leg: LegName, frame: AdapterFrame): void }` and `RunnerDeps.frames?: FramePort`, where `AdapterFrame = { direction: 'in' | 'out'; type: string; payload?: unknown }` (plan 1e wires it to `logStore`).

- [ ] **Step 1: Write the failing tests**

In `src/lib/session/runner.test.ts`:

1. Add `frames?: FramePort` to `Options` (import `FramePort` from `./ports`) and pass `frames: o.frames` to `createRunner({...})` in `setup`.
2. Change the expected codes: `'build-refused'` → the fake's own code (next step), `'not-ready'` → `'not_ready'`, `'credentials-missing'` → `'credentials_missing'`. The build-refusal expectation becomes:

```ts
      lastEnd: { reason: 'refused', notice: { code: 'fake_build_refused', message: 'The fake refuses to build (fault knob).', params: { knob: 'buildRefused' }, leg: 'speaker' } },
```

3. Add:

```ts
  it("names the runner's own refusals in snake_case", async () => {
    const { runner } = setup({ ready: { state: 'not-ready', reason: 'model not downloaded' } });
    await runner.start();
    expect(RUN_NOTICE_CODES).toContain((runner.state.getState() as { lastEnd?: RunEnd }).lastEnd?.notice?.code);
  });

  it("hands every frame an adapter reports to the frames port, with its leg", async () => {
    const frames: Array<[string, unknown]> = [];
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
        const session = await fakeProvider.start(request as never, events);
        events.frame({ direction: 'in', type: 'fake.hello', payload: { n: 1 } });
        return session;
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider }, frames: { frame: (leg, frame) => frames.push([leg, frame]) } });
    await runner.start();
    expect(frames).toEqual([['speaker', { direction: 'in', type: 'fake.hello', payload: { n: 1 } }]]);
  });

  it('keeps a throwing frames port away from the adapter', async () => {
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
        const session = await fakeProvider.start(request as never, events);
        events.frame({ direction: 'out', type: 'fake.one' });
        events.frame({ direction: 'out', type: 'fake.two' });
        return session;
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider }, frames: { frame: () => { throw new Error('sink gone'); } } });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    // One report per failing streak, not one per frame.
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('frames.frame'))).toHaveLength(1);
  });
```

(`RUN_NOTICE_CODES` from `./codes`, `RunEnd` from `./types`, `AdapterEvents` and `StartRequest` are already imported.) If `reportErrorSpy` carries calls from earlier tests in the file, clear it at the top of this test with `reportErrorSpy.mockClear()`.

In `src/lib/session/runner.hooks.test.ts:98`, expect `code: 'admit_refused'`. In `src/lib/session/shape.test.ts`, change each gate code to snake_case (`no_legs`, `turn_mode_unsupported`, `participant_source_unavailable`, `participant_unsupported`). In `src/components/dev/SessionControls.test.tsx:87`, use `code: 'not_ready'`. In `src/providers/fake/provider.test.ts`, make the refusal test exact:

```ts
  it('refuses to build when buildRefused is on, with a code of its own', () => {
    expect(fakeProvider.build(context, settings({ buildRefused: true }), shared)).toEqual({
      refused: 'The fake refuses to build (fault knob).',
      code: 'fake_build_refused',
      params: { knob: 'buildRefused' },
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session src/providers/fake src/components/dev`
Expected: FAIL on the codes, the refusal's params, and the frames port.

- [ ] **Step 3: The code list**

Create `src/lib/session/codes.ts`:

```ts
/**
 * The notice codes the runner itself records (spec: "Notices reach the user
 * localized"). snake_case, like the adapters' `CLIENT_DIAGNOSTICS` codes and
 * the capture's degradations, so one table of words serves them all. A
 * provider's own codes — a refusal's, a lease's end — stay open strings.
 */
export const RUN_NOTICE_CODES = [
  'no_provider',
  'no_legs',
  'turn_mode_unsupported',
  'participant_source_unavailable',
  'participant_unsupported',
  'credentials_missing',
  'not_ready',
  'build_refused',
  'admit_refused',
  'start_failed',
  'leg_failed',
  'leg_closed',
  'source_ended',
] as const;

export type RunNoticeCode = (typeof RUN_NOTICE_CODES)[number];
```

- [ ] **Step 4: A refusal may carry a code**

In `src/lib/provider/types.ts`, add before `Provider`:

```ts
/** A refusal to build or admit: diagnostic English, and a code a surface can put into words. */
export interface ProviderRefusal {
  refused: string;
  /** Default: the runner's `build_refused` / `admit_refused`. */
  code?: string;
  params?: Record<string, string | number>;
}
```

and change `build`'s return type to `C | ProviderRefusal`. In `src/lib/session/types.ts`, import `ProviderRefusal` and change `admit?(configs: Partial<Record<LegName, C>>): true | ProviderRefusal;`.

- [ ] **Step 5: snake_case codes, typed, and refusals passed through**

Every literal `code:` the session module writes names a `RunNoticeCode`, checked with `satisfies`:

- `src/lib/session/shape.ts`: `'no-legs'` → `'no_legs'`, `'turn-mode-unsupported'` → `'turn_mode_unsupported'` (both places), `'participant-source-unavailable'` → `'participant_source_unavailable'`, `'participant-unsupported'` → `'participant_unsupported'`; write each as e.g. `code: 'no_legs' satisfies RunNoticeCode`.
- `src/lib/session/runner.ts`: `'no-provider'` → `'no_provider'`, `'start-failed'` → `'start_failed'` (the notice code only; the `EndReason` values stay as they are).
- `src/lib/session/run.ts`: `'credentials-missing'` → `'credentials_missing'`, `'not-ready'` → `'not_ready'`; `'leg_failed'`, `'leg_closed'`, `'source_ended'` gain `satisfies RunNoticeCode`. The build and admit refusals pass the provider's code and params through:

```ts
      if (typeof built?.refused === 'string') {
        throw new RefusedError({
          code: built.code ?? ('build_refused' satisfies RunNoticeCode),
          message: built.refused,
          ...(built.params ? { params: built.params } : {}),
          leg,
        });
      }
```

```ts
      if (admitted !== true) {
        throw new RefusedError({
          code: admitted.code ?? ('admit_refused' satisfies RunNoticeCode),
          message: admitted.refused,
          ...(admitted.params ? { params: admitted.params } : {}),
        });
      }
```

(`RefusedError` takes `shape.ts`'s `Refusal`, which extends `RunNotice`, so `params` already fits.)

In `src/providers/fake/provider.ts`, the refusal becomes:

```ts
    ? { refused: 'The fake refuses to build (fault knob).', code: 'fake_build_refused', params: { knob: 'buildRefused' } }
```

- [ ] **Step 6: The frames port**

In `src/lib/session/ports.ts`, add:

```ts
/** One protocol frame an adapter reported (spec D8): what the Logs panel lists. */
export interface AdapterFrame {
  direction: 'in' | 'out';
  type: string;
  payload?: unknown;
}

/** Where a run's frames go: the app's log store (plan 1e). */
export interface FramePort {
  frame(leg: LegName, frame: AdapterFrame): void;
}
```

add `frames?: FramePort;` to `RunnerDeps` (after `analytics`, with the comment `/** The Logs panel's feed; absent, frames are dropped. */`), and in `guardPorts` return a guarded `frames` when `deps.frames` is given — frames arrive per message, so, like `audio`, it reports when the port starts failing and not on every frame after:

```ts
export function guardPorts(deps: RunnerDeps): Pick<RunnerDeps, 'playback' | 'analytics' | 'frames'> {
```

```ts
  let framesFailing = false;
  const frames = deps.frames;
  return {
    // … playback and analytics as they are …
    ...(frames ? {
      frames: {
        frame: (leg: LegName, frame: AdapterFrame) => {
          try {
            frames.frame(leg, frame);
            framesFailing = false;
          } catch (error) {
            if (!framesFailing) report('frames.frame', error);
            framesFailing = true;
          }
        },
      },
    } : {}),
  };
```

In `src/lib/session/run.ts`, `onEvent` hands frames over before the `ending` check returns (a frame is a log line, wanted until the run is finished):

```ts
  private onEvent(leg: LegName, event: AdapterEvent): void {
    if (this.finished) return;
    if (event.kind === 'frame') {
      this.deps.frames?.frame(leg, event.payload);
      return;
    }
    this.conversations.get(leg)?.apply(event);
```

(`Conversation.apply` ignores `frame` today, so skipping it changes nothing there.)

- [ ] **Step 7: Run the tests, then the gates**

Run: `npx vitest run src/lib/session src/providers/fake src/components/dev src/lib/conversation`
Expected: PASS.
Run: `grep -rn "code: '[a-z]*-[a-z-]*'" src/lib/session src/providers` — must print nothing.
Run: `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 8: Commit**

```bash
git add src/lib/session src/lib/provider/types.ts src/providers/fake src/components/dev/SessionControls.test.tsx
git commit -m "feat(session): snake_case notice codes, refusals with codes, and a frames port"
```

---
### Task 4: One throttled view of the conversation

**Files:**
- Create: `src/lib/view/conversationView.ts`, `src/lib/view/conversationView.test.ts`, `src/lib/view/appViewSettings.ts`, `src/lib/view/appViewSettings.test.ts`

**Interfaces:**
- Consumes: `ConversationSet` (`runner.conversation`: `snapshot()` returns the same array until a leg changes, `subscribe`), `createProjector` / `ProjectionSettings` (Task 1's shapes), `Clock` from `src/lib/contract/clock.ts` (`setTimeout(fn, ms)` returns a cancel function; `realClock`, `createVirtualClock`).
- Produces: `Readable<T> { get(): T; subscribe(listener: () => void): () => void }`; `ConversationViewState { legs: readonly Leg[]; entries: readonly Entry[] }`; `createConversationView(conversation, settings: Readable<ProjectionSettings>, clock, intervalMs?) → Readable<ConversationViewState> & { dispose(): void }`; `VIEW_INTERVAL_MS = 50`; `projectionFrom(stored: StoredSegmentation): ProjectionSettings`; `appProjectionSettings(): Readable<ProjectionSettings>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/view/conversationView.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { Leg, Segment } from '../conversation/types';
import { DEFAULT_PROJECTION } from '../projection/project';
import type { ProjectionSettings } from '../projection/types';
import { createConversationView, VIEW_INTERVAL_MS, type Readable } from './conversationView';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

const segment = (text: string): Segment => ({ id: 's:speaker:1', ref: 1, side: 'source', text, final: true, openedAt: 0, marks: [], speech: [] });
const legWith = (text: string): Leg => ({ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [segment(text)], notices: [] });

function conversation(initial: readonly Leg[]) {
  let legs = initial;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => legs,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: readonly Leg[]) { legs = next; listeners.forEach((listener) => listener()); },
    listening: () => listeners.size,
  };
}

function settings(initial: ProjectionSettings): Readable<ProjectionSettings> & { set(next: ProjectionSettings): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const firstSourceTexts = (view: Readable<{ entries: readonly import('../projection/types').Entry[] }>) => {
  const entry = view.get().entries[0];
  return entry?.kind === 'exchange' ? entry.source.map((row) => row.text) : [];
};

describe('createConversationView', () => {
  it('projects the conversation at once', () => {
    const view = createConversationView(conversation([legWith('Hello.')]), settings(DEFAULT_PROJECTION), createVirtualClock(0));
    expect(firstSourceTexts(view)).toEqual(['Hello.']);
  });

  it('gathers changes and projects them once per interval', () => {
    const clock = createVirtualClock(0);
    const conv = conversation([legWith('He')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const listener = vi.fn();
    view.subscribe(listener);
    conv.set([legWith('Hel')]);
    conv.set([legWith('Hello.')]);
    expect(listener).not.toHaveBeenCalled();
    clock.advance(VIEW_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(firstSourceTexts(view)).toEqual(['Hello.']);
  });

  it('re-projects when the settings change', () => {
    const clock = createVirtualClock(0);
    const cut = settings(DEFAULT_PROJECTION);
    const view = createConversationView(conversation([legWith('One. Two.')]), cut, clock);
    cut.set({ ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    clock.advance(VIEW_INTERVAL_MS);
    expect(firstSourceTexts(view)).toEqual(['One.', ' Two.']);
  });

  it('tells no one when nothing it shows changed', () => {
    const clock = createVirtualClock(0);
    const legs = [legWith('Hello.')];
    const conv = conversation(legs);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const listener = vi.fn();
    view.subscribe(listener);
    conv.set(legs);
    clock.advance(VIEW_INTERVAL_MS);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps telling the others when one listener throws', () => {
    const clock = createVirtualClock(0);
    const conv = conversation([legWith('a.')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const after = vi.fn();
    view.subscribe(() => { throw new Error('boom'); });
    view.subscribe(after);
    conv.set([legWith('ab.')]);
    clock.advance(VIEW_INTERVAL_MS);
    expect(after).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('lets go of its sources when disposed', () => {
    const conv = conversation([legWith('a.')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), createVirtualClock(0));
    view.dispose();
    expect(conv.listening()).toBe(0);
  });
});
```

Create `src/lib/view/appViewSettings.test.ts`:

```ts
import { afterEach, describe, it, expect } from 'vitest';
import { DEFAULT_PAIRING } from '../projection/pair';
import { useSettingsStore } from '../../stores/settingsStore';
import { appProjectionSettings, projectionFrom } from './appViewSettings';

const initial = useSettingsStore.getState();
afterEach(() => useSettingsStore.setState(initial, true));

const stored = { segmentationMode: 'pause' as const, sentenceSegmentationChunkSentences: 3, segmentationSourcePause: 1.5, segmentationTranslationPause: 0.8 };

describe('projectionFrom', () => {
  it('maps the pause mode to both pauses, in milliseconds', () => {
    expect(projectionFrom(stored)).toEqual({ mode: 'pause', sentencesPerRow: 0, sourcePauseMs: 1500, translationPauseMs: 800, pairing: DEFAULT_PAIRING });
  });

  it('maps the sentences mode to its size, Auto (0) keeping each segment whole', () => {
    expect(projectionFrom({ ...stored, segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 2 }))
      .toEqual({ mode: 'sentences', sentencesPerRow: 2, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
    expect(projectionFrom({ ...stored, segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 0 }).sentencesPerRow).toBe(0);
  });

  it('maps off to whole segments', () => {
    expect(projectionFrom({ ...stored, segmentationMode: 'off' })).toEqual({ mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
  });
});

describe('appProjectionSettings', () => {
  it('returns the same object until one of the four stored fields changes', () => {
    const source = appProjectionSettings();
    const first = source.get();
    useSettingsStore.setState({ keepReplayAudio: !initial.keepReplayAudio });
    expect(source.get()).toBe(first);
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 1 });
    expect(source.get()).not.toBe(first);
    expect(source.get()).toMatchObject({ mode: 'sentences', sentencesPerRow: 1 });
  });

  it('tells its listener about a store change', () => {
    const source = appProjectionSettings();
    let heard = 0;
    const off = source.subscribe(() => { heard += 1; });
    useSettingsStore.setState({ segmentationMode: 'off' });
    off();
    expect(heard).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/view`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the view**

Create `src/lib/view/conversationView.ts`:

```ts
/**
 * The conversation as a surface process sees it: the legs and L2's entries,
 * projected once for every surface in the process (spec: "L2 … runs once per
 * session, not once per surface"). Driven directly, the projection would run
 * on every audio chunk and every partial; it runs at most once per interval
 * instead — today's list updates at the same 20 Hz (`UPDATE_THROTTLE_MS`).
 */
import type { Clock } from '../contract/clock';
import type { Leg } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import { createProjector } from '../projection/project';
import type { Entry, ProjectionSettings } from '../projection/types';

/** A value that can be read and watched: the view, a settings source, karaoke. */
export interface Readable<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface ConversationViewState {
  legs: readonly Leg[];
  entries: readonly Entry[];
}

/** How long changes are gathered before one projection. */
export const VIEW_INTERVAL_MS = 50;

export function createConversationView(
  conversation: { snapshot(): readonly Leg[]; subscribe(listener: () => void): () => void },
  settings: Readable<ProjectionSettings>,
  clock: Pick<Clock, 'setTimeout'>,
  intervalMs = VIEW_INTERVAL_MS,
): Readable<ConversationViewState> & { dispose(): void } {
  const projector = createProjector();
  const listeners = new Set<() => void>();
  const compute = (): ConversationViewState => {
    const legs = conversation.snapshot();
    return { legs, entries: projector.project(legs, settings.get()) };
  };
  let state = compute();
  let cancel: (() => void) | null = null;

  const flush = () => {
    cancel = null;
    const next = compute();
    // The snapshot and the projection both keep their identity when nothing changed.
    if (next.legs === state.legs && next.entries === state.entries) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('ConversationView', `A view subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'view-subscriber' });
      }
    }
  };
  const schedule = () => { cancel ??= clock.setTimeout(flush, intervalMs); };
  const offConversation = conversation.subscribe(schedule);
  const offSettings = settings.subscribe(schedule);

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      offConversation();
      offSettings();
      cancel?.();
      cancel = null;
      listeners.clear();
    },
  };
}
```

- [ ] **Step 4: Write the settings source**

Create `src/lib/view/appViewSettings.ts`:

```ts
/**
 * The stored segmentation choice as the projection's cut (spec:
 * "Segmentation is one fact"): cutting by sentences and by pause is L2's for
 * every provider, so the per-provider clamp of today's descriptors has no
 * part here. The only module under `src/lib/view` that reads a store.
 */
import { DEFAULT_PAIRING } from '../projection/pair';
import type { ProjectionSettings } from '../projection/types';
import { segmentPauseMs, type SegmentationMode } from '../segmentation/segmentationMode';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Readable } from './conversationView';

/** The four stored fields the cut follows (`settingsStore`). */
export interface StoredSegmentation {
  segmentationMode: SegmentationMode;
  /** 0 is Auto: each segment whole. */
  sentenceSegmentationChunkSentences: number;
  /** Seconds. */
  segmentationSourcePause: number;
  segmentationTranslationPause: number;
}

export function projectionFrom(s: StoredSegmentation): ProjectionSettings {
  const pauses = s.segmentationMode === 'pause';
  return {
    mode: s.segmentationMode,
    sentencesPerRow: s.segmentationMode === 'sentences' ? s.sentenceSegmentationChunkSentences : 0,
    sourcePauseMs: pauses ? segmentPauseMs(s.segmentationSourcePause) : 0,
    translationPauseMs: pauses ? segmentPauseMs(s.segmentationTranslationPause) : 0,
    pairing: DEFAULT_PAIRING,
  };
}

/** The app's cut, live from the settings store: the same object until one of the four fields changes. */
export function appProjectionSettings(): Readable<ProjectionSettings> {
  let key = '';
  let cached: ProjectionSettings | null = null;
  return {
    get() {
      const s = useSettingsStore.getState();
      const next = `${s.segmentationMode}|${s.sentenceSegmentationChunkSentences}|${s.segmentationSourcePause}|${s.segmentationTranslationPause}`;
      if (next !== key || !cached) {
        key = next;
        cached = projectionFrom(s);
      }
      return cached;
    },
    subscribe: (listener) => useSettingsStore.subscribe(() => listener()),
  };
}
```

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/lib/view`
Expected: PASS.
Run: `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/view
git commit -m "feat(view): one throttled projection of the conversation, and the stored cut"
```

---

### Task 5: Karaoke, the display filter, and the words for a notice

**Files:**
- Modify: `src/lib/audio/playback.ts` (add `parseClipKey`), `src/lib/audio/playback.test.ts`, `src/locales/en/translation.json`
- Create: `src/lib/view/karaoke.ts`, `src/lib/view/karaoke.test.ts`, `src/lib/view/filter.ts`, `src/lib/view/filter.test.ts`, `src/lib/view/noticeText.ts`, `src/lib/view/noticeText.test.ts`

**Interfaces:**
- Consumes: `QueueView<ClipKey>` / `Playing` (`src/lib/audio/clipQueue.ts`: `position()` is exact and null in a gap and when idle; `pending`; `subscribe` fires on enqueue, clip end and clear), `Playback.queues` (`speaker`, `participant`, `replay`), `clipKey`, `Readable` (Task 4), `RUN_NOTICE_CODES` (Task 3), `CLIENT_DIAGNOSTICS`, `APP_CAPTURE_LOST` / `APP_MONITOR_MISSING` (`src/lib/audio/capture/systemAudio.ts`).
- Produces: `parseClipKey(key: ClipKey): { leg: LegName; ref: number | undefined; index: number }`; `Lit { segmentId; leg; upTo }`, `litFor`, `nextLit`, `KaraokeState { lit: ReadonlyMap<SegmentId, number>; replaying: SegmentId | null }`, `createKaraoke(queues, view, clock, intervalMs?) → Readable<KaraokeState> & { dispose(): void }`, `KARAOKE_INTERVAL_MS = 100`; `SideFilter`, `LegFilters`, `NoticeEntry`, `DisplayItem`, `showsSide`, `displayItems(entries, filters)`; `NOTICE_WORDS`, `noticeText(t: TFunction, notice: NoticeWords): string`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/audio/playback.test.ts`, add (import `clipKey`, `parseClipKey` from `./playback`):

```ts
describe('parseClipKey', () => {
  it('reads back what clipKey wrote', () => {
    expect(parseClipKey(clipKey('participant', 7, 2))).toEqual({ leg: 'participant', ref: 7, index: 2 });
    expect(parseClipKey(clipKey('speaker', undefined, 0))).toEqual({ leg: 'speaker', ref: undefined, index: 0 });
  });
});
```

Create `src/lib/view/karaoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Playing, QueueView } from '../audio/clipQueue';
import type { ClipKey } from '../audio/playback';
import { createVirtualClock } from '../contract/clock';
import type { Leg, Segment } from '../conversation/types';
import type { Readable } from './conversationView';
import { createKaraoke, KARAOKE_INTERVAL_MS, litFor, nextLit, type QueueName } from './karaoke';

const SECOND = new Int16Array(24_000);
// 13 characters: こんにちは、お元気ですか？
const TEXT = 'こんにちは、お元気ですか？';
const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's:speaker:2', ref: 2, side: 'translation', text: TEXT, final: true, openedAt: 0, marks: [],
  speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }],
  ...over,
});
const legs = (s: Segment): readonly Leg[] => [{ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [s], notices: [] }];

function fakeQueue() {
  let playing: Playing<ClipKey> | null = null;
  let pending = 0;
  const listeners = new Set<() => void>();
  const view: QueueView<ClipKey> = {
    position: () => playing,
    get pending() { return pending; },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    view,
    /** A clip starts, ends or the queue clears: the queue tells its listeners. */
    set(next: Playing<ClipKey> | null, n: number) { playing = next; pending = n; listeners.forEach((listener) => listener()); },
    /** Playback moves on without telling anyone. */
    move(t: number) { if (playing) playing = { ...playing, t }; },
  };
}

function setup(s: Segment) {
  const clock = createVirtualClock(0);
  const queues = { speaker: fakeQueue(), participant: fakeQueue(), replay: fakeQueue() };
  let current = legs(s);
  const listeners = new Set<() => void>();
  const view: Readable<{ legs: readonly Leg[] }> = {
    get: () => ({ legs: current }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const karaoke = createKaraoke(
    { speaker: queues.speaker.view, participant: queues.participant.view, replay: queues.replay.view } as Record<QueueName, QueueView<ClipKey>>,
    view,
    clock,
  );
  const setSegment = (next: Segment) => { current = legs(next); listeners.forEach((listener) => listener()); };
  return { clock, queues, karaoke, setSegment };
}

describe('litFor', () => {
  it("lights a clip's range in proportion to how far into the clip playback is", () => {
    expect(litFor({ key: 'speaker:2:0', t: 500 }, legs(segment()))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 3 });
    expect(litFor({ key: 'speaker:2:1', t: 1000 }, legs(segment()))).toMatchObject({ upTo: 13 });
  });

  it('lights nothing for a clip without a range, a segment it cannot find, or audio that names none', () => {
    expect(litFor({ key: 'speaker:2:0', t: 500 }, legs(segment({ speech: [{ pcm: SECOND }] })))).toBeNull();
    expect(litFor({ key: 'speaker:9:0', t: 500 }, legs(segment()))).toBeNull();
    expect(litFor({ key: 'speaker:none:0', t: 500 }, legs(segment()))).toBeNull();
  });
});

describe('nextLit in a gap', () => {
  const prev = { segmentId: 's:speaker:2', leg: 'speaker' as const, upTo: 6 };

  it('holds while the segment is open', () => {
    expect(nextLit(prev, null, legs(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] })))).toBe(prev);
  });

  it('holds while the speech has not reached its last letter', () => {
    expect(nextLit(prev, null, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }] })))).toBe(prev);
  });

  it('ends once the segment is final and its speech reached its last letter', () => {
    expect(nextLit(prev, null, legs(segment()))).toBeNull();
    // Only the closing punctuation is left unspoken: that is the end.
    expect(nextLit(prev, null, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 12], pcm: SECOND }] })))).toBeNull();
  });
});

describe('createKaraoke', () => {
  it('samples positions while clips are queued and someone listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0 }, 2);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(3);
  });

  it('holds through a gap, and lets go once the segment is final and spoken to its end', () => {
    const { queues, karaoke, setSegment } = setup(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 1000 }, 1);
    queues.speaker.set(null, 0);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
    setSegment(segment());
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('names the segment a replay is playing, and ends with the replay', () => {
    const { queues, karaoke } = setup(segment());
    karaoke.subscribe(() => {});
    queues.replay.set({ key: 'speaker:2:0', t: 0 }, 2);
    expect(karaoke.get().replaying).toBe('s:speaker:2');
    queues.replay.set(null, 0);
    expect(karaoke.get()).toMatchObject({ replaying: null });
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('reads nothing while no one listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    const off = karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0 }, 2);
    off();
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS * 5);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
  });
});
```

Create `src/lib/view/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Entry, Row } from '../projection/types';
import { displayItems, type LegFilters } from './filter';

const row = (segmentId: string, side: 'source' | 'translation', k = 0, text = 'x'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start: 0, end: text.length, text, final: true });
const exchange = (id: string, leg: 'speaker' | 'participant', source: Row[], translation: Row[], t = 0): Entry =>
  ({ kind: 'exchange', id, leg, languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t });
const both: LegFilters = { speaker: 'both', participant: 'both' };
const shape = (items: ReturnType<typeof displayItems>) =>
  items.map((i) => (i.kind === 'notice' ? 'notice' : `${i.row.key}${i.header ? '+h' : ''}${i.endsSegment ? '+e' : ''}`));

describe('displayItems', () => {
  it("draws an exchange's source rows before its translation rows, and opens a header where the leg changes", () => {
    const entries = [
      exchange('a', 'speaker', [row('s1', 'source')], [row('s2', 'translation')]),
      exchange('b', 'speaker', [row('s3', 'source')], []),
      exchange('c', 'participant', [row('p1', 'source')], []),
    ];
    expect(shape(displayItems(entries, both))).toEqual(['s1:0+h+e', 's2:0+e', 's3:0+e', 'p1:0+h+e']);
  });

  it("marks only a segment's last drawn row as its end", () => {
    const entries = [exchange('a', 'speaker', [], [row('s2', 'translation', 0), row('s2', 'translation', 1)])];
    expect(shape(displayItems(entries, both))).toEqual(['s2:0+h', 's2:1+e']);
  });

  it('shows the side a filter asks for, and nothing of a leg filtered to none', () => {
    const entries = [exchange('a', 'speaker', [row('s1', 'source')], [row('s2', 'translation')])];
    expect(shape(displayItems(entries, { ...both, speaker: 'translation' }))).toEqual(['s2:0+h+e']);
    expect(shape(displayItems(entries, { ...both, speaker: 'source' }))).toEqual(['s1:0+h+e']);
    expect(displayItems(entries, { ...both, speaker: 'none' })).toEqual([]);
  });

  it('draws a notice under every filter, and a notice neither opens nor breaks a header group', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'w', at: 1 };
    const entries = [
      exchange('a', 'speaker', [row('s1', 'source')], []),
      notice,
      exchange('b', 'speaker', [row('s2', 'source')], []),
    ];
    expect(shape(displayItems(entries, both))).toEqual(['s1:0+h+e', 'notice', 's2:0+e']);
    expect(shape(displayItems(entries, { ...both, speaker: 'none' }))).toEqual(['notice']);
  });
});
```

Create `src/lib/view/noticeText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import en from '../../locales/en/translation.json';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING } from '../audio/capture/systemAudio';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { RUN_NOTICE_CODES } from '../session/codes';
import { NOTICE_WORDS, noticeText } from './noticeText';

/** A stand-in for i18next: fills `{{name}}` from the options. */
const t = ((key: string, options: Record<string, unknown>) =>
  `${key}|${String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))}`) as unknown as TFunction;

describe('noticeText', () => {
  it("looks a known code up, with the notice's own message as its detail", () => {
    expect(noticeText(t, { code: 'leg_failed', message: 'Invalid API key' })).toBe('notices.leg_failed|The session stopped: Invalid API key');
  });

  it('passes the params through', () => {
    const words = noticeText(((key: string, options: Record<string, unknown>) => `${key}:${String(options.minutes)}`) as unknown as TFunction, { code: 'source_ended', message: 'x', params: { minutes: 3 } });
    expect(words).toBe('notices.source_ended:3');
  });

  it('shows the message itself for a code it has no words for, or no code', () => {
    expect(noticeText(t, { code: 'fake_build_refused', message: 'The fake refuses to build (fault knob).' })).toBe('The fake refuses to build (fault knob).');
    expect(noticeText(t, { message: 'plain' })).toBe('plain');
  });

  it('has words for every code the runner, the capture and the adapters record', () => {
    for (const code of [...RUN_NOTICE_CODES, ...Object.keys(CLIENT_DIAGNOSTICS), APP_CAPTURE_LOST, APP_MONITOR_MISSING]) {
      expect(NOTICE_WORDS[code], code).toBeDefined();
    }
  });

  it('matches the English locale word for word', () => {
    expect((en as unknown as { notices: Record<string, string> }).notices).toEqual(NOTICE_WORDS);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/view src/lib/audio/playback.test.ts`
Expected: FAIL — the modules and `parseClipKey` do not exist.

- [ ] **Step 3: `parseClipKey`**

In `src/lib/audio/playback.ts`, after `clipKey`:

```ts
/** A clip key's parts; `ref` is undefined for audio that names no segment. Surfaces read keys through this, never by splitting them. */
export function parseClipKey(key: ClipKey): { leg: LegName; ref: number | undefined; index: number } {
  const [leg, ref, index] = key.split(':') as [LegName, string, string];
  return { leg, ref: ref === 'none' ? undefined : Number(ref), index: Number(index) };
}
```

- [ ] **Step 4: Karaoke**

Create `src/lib/view/karaoke.ts`:

```ts
/**
 * Karaoke for one surface process (spec: "Karaoke … only where an observed
 * alignment exists"; "The clip queue"). The clock is the clip queues', not a
 * sink's: the speaker's translation normally plays only into the virtual
 * microphone, which a real-output clock would never see. Positions move
 * without an event between a clip's start and its end, so they are sampled
 * while a queue holds clips and someone listens; otherwise this costs nothing.
 * What the user hears lags the queue's clock by the output element's latency
 * — accepted, not offset.
 */
import type { Playing, QueueView } from '../audio/clipQueue';
import { parseClipKey, type ClipKey } from '../audio/playback';
import { SAMPLE_RATE } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { Leg, LegName, Segment, SegmentId } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import { countSkeleton } from '../segmentation/sealCursor';
import type { Readable } from './conversationView';

/** The queues karaoke reads: each leg's live speech, and the replay. */
export type QueueName = 'speaker' | 'participant' | 'replay';
const QUEUES: readonly QueueName[] = ['speaker', 'participant', 'replay'];

/** Where one queue's karaoke stands: characters [0, upTo) of a segment are spoken. */
export interface Lit {
  segmentId: SegmentId;
  leg: LegName;
  upTo: number;
}

export interface KaraokeState {
  /** Characters spoken so far, per segment. */
  lit: ReadonlyMap<SegmentId, number>;
  /** The segment a replay is playing, with or without ranges; null when none is. */
  replaying: SegmentId | null;
}

/** How often positions are read while clips are queued: today's `PROGRESS_UPDATE_INTERVAL`. */
export const KARAOKE_INTERVAL_MS = 100;

const NOTHING: KaraokeState = { lit: new Map(), replaying: null };

function clipOf(key: ClipKey, legs: readonly Leg[]): { leg: LegName; segment: Segment; index: number } | null {
  const { leg, ref, index } = parseClipKey(key);
  if (ref === undefined) return null;
  const segment = legs.find((l) => l.leg === leg)?.segments.find((s) => s.ref === ref);
  return segment ? { leg, segment, index } : null;
}

/** The characters a playing clip has spoken: its range, reached in proportion to how far into the clip playback is. No range, nothing lit. */
export function litFor(playing: Playing<ClipKey>, legs: readonly Leg[]): Lit | null {
  const clip = clipOf(playing.key, legs);
  const speech = clip?.segment.speech[clip.index];
  if (!clip || !speech?.range) return null;
  const [a, b] = speech.range;
  const ms = (speech.pcm.length / SAMPLE_RATE) * 1000;
  const f = ms > 0 ? Math.min(1, Math.max(0, playing.t / ms)) : 1;
  return { segmentId: clip.segment.id, leg: clip.leg, upTo: a + Math.round((b - a) * f) };
}

/**
 * What a live queue's karaoke shows now, given what it showed. Playing: the
 * clip decides. In a gap — the clip queue has no seal, so `position()` is
 * null between a segment's clips, and a local engine's speech can arrive
 * after its segment closed — the last state holds while the segment's speech
 * may still continue: it is open, or its speech ranges have not reached its
 * last letter or digit. Otherwise the gap ends it. Decided from L1's data,
 * never a timer.
 */
export function nextLit(prev: Lit | null, playing: Playing<ClipKey> | null, legs: readonly Leg[]): Lit | null {
  if (playing) return litFor(playing, legs);
  if (!prev) return null;
  const segment = legs.find((l) => l.leg === prev.leg)?.segments.find((s) => s.id === prev.segmentId);
  if (!segment) return null;
  const reached = segment.speech.reduce((end, s) => Math.max(end, s.range?.[1] ?? 0), 0);
  const mayContinue = !segment.final || countSkeleton(segment.text.slice(reached)) > 0;
  return mayContinue ? prev : null;
}

function sameLit(a: ReadonlyMap<SegmentId, number>, b: ReadonlyMap<SegmentId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, upTo] of a) if (b.get(id) !== upTo) return false;
  return true;
}

export function createKaraoke(
  queues: Readonly<Record<QueueName, QueueView<ClipKey>>>,
  view: Readable<{ readonly legs: readonly Leg[] }>,
  clock: Pick<Clock, 'setTimeout'>,
  intervalMs = KARAOKE_INTERVAL_MS,
): Readable<KaraokeState> & { dispose(): void } {
  const held: Record<QueueName, Lit | null> = { speaker: null, participant: null, replay: null };
  const listeners = new Set<() => void>();
  let state = NOTHING;
  let cancel: (() => void) | null = null;

  const sample = () => {
    const legs = view.get().legs;
    const lit = new Map<SegmentId, number>();
    for (const name of QUEUES) {
      const playing = queues[name].position();
      // A replay's clips are enqueued at once, back to back: no position means it has not begun or has ended.
      held[name] = name === 'replay' ? (playing ? litFor(playing, legs) : null) : nextLit(held[name], playing, legs);
      const l = held[name];
      if (l) lit.set(l.segmentId, Math.max(lit.get(l.segmentId) ?? 0, l.upTo));
    }
    const replayKey = queues.replay.position()?.key;
    const replaying = replayKey ? clipOf(replayKey, legs)?.segment.id ?? null : null;
    if (replaying === state.replaying && sameLit(lit, state.lit)) return;
    state = { lit, replaying };
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('Karaoke', `A karaoke subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'karaoke-subscriber' });
      }
    }
  };
  const schedule = () => {
    if (cancel || listeners.size === 0) return;
    if (QUEUES.some((name) => queues[name].pending > 0)) cancel = clock.setTimeout(tick, intervalMs);
  };
  const tick = () => {
    cancel = null;
    sample();
    schedule();
  };
  // A clip was enqueued, ended or cleared, or the conversation changed: read now, then keep reading while clips remain.
  const wake = () => {
    if (listeners.size === 0) return;
    sample();
    schedule();
  };
  const offs = [...QUEUES.map((name) => queues[name].subscribe(wake)), view.subscribe(wake)];

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      wake();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          cancel?.();
          cancel = null;
        }
      };
    },
    dispose() {
      offs.forEach((off) => off());
      cancel?.();
      cancel = null;
      listeners.clear();
    },
  };
}
```

- [ ] **Step 5: The display filter**

Create `src/lib/view/filter.ts`:

```ts
/**
 * Filtering is L3's (spec: "L2 — the projection"): one function, called by
 * each bubble surface with its own settings. The cut and the grouping are
 * computed once, upstream; what differs per surface is which rows it shows.
 */
import type { Side } from '../contract/adapter';
import type { Languages, LegName } from '../conversation/types';
import type { Entry, Row } from '../projection/types';

/** Which sides of a leg a surface shows: the same union as the stored display modes. */
export type SideFilter = 'both' | 'source' | 'translation' | 'none';
export type LegFilters = Readonly<Record<LegName, SideFilter>>;
export type NoticeEntry = Extract<Entry, { kind: 'notice' }>;

/** One line a bubble surface draws, in order. */
export type DisplayItem =
  | {
      kind: 'row';
      row: Row;
      leg: LegName;
      languages: Languages;
      /** The group's time: its earliest `openedAt`. */
      t: number;
      /** A header opens here: the leg changed since the last row drawn. */
      header: boolean;
      /** The last row drawn of its segment: where that segment's replay button goes. */
      endsSegment: boolean;
    }
  | { kind: 'notice'; notice: NoticeEntry };

export function showsSide(filter: SideFilter, side: Side): boolean {
  return filter === 'both' || filter === side;
}

/**
 * The lines a bubble surface draws. Within an exchange the source rows come
 * first. A header opens where the leg changes from the last row drawn; a
 * notice is drawn under every filter and neither opens nor breaks a header
 * group — today's panel on each count (spec: "UI rules deferred to the UI
 * work").
 */
export function displayItems(entries: readonly Entry[], filters: LegFilters): DisplayItem[] {
  const out: DisplayItem[] = [];
  let lastLeg: LegName | null = null;
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      out.push({ kind: 'notice', notice: entry });
      continue;
    }
    const filter = filters[entry.leg];
    const rows = [
      ...(showsSide(filter, 'source') ? entry.source : []),
      ...(showsSide(filter, 'translation') ? entry.translation : []),
    ];
    rows.forEach((row, i) => {
      out.push({
        kind: 'row',
        row,
        leg: entry.leg,
        languages: entry.languages,
        t: entry.t,
        header: lastLeg !== entry.leg,
        endsSegment: rows[i + 1]?.segmentId !== row.segmentId,
      });
      lastLeg = entry.leg;
    });
  }
  return out;
}
```

- [ ] **Step 6: The words for a notice**

Create `src/lib/view/noticeText.ts`:

```ts
/**
 * A notice put into the user's words (spec: "Notices reach the user
 * localized"): `message` is diagnostic English; a surface looks the text up
 * by `code`, under `notices.<code>`. `{{detail}}` is the notice's own
 * message — the provider's error text, which today's error bubbles show.
 */
import type { TFunction } from 'i18next';

export interface NoticeWords {
  code?: string;
  params?: Record<string, string | number>;
  message: string;
}

/** The English for every code a surface puts into words; `src/locales/en/translation.json`'s `notices` holds the same, word for word. */
export const NOTICE_WORDS: Readonly<Record<string, string>> = {
  // The runner's own (RUN_NOTICE_CODES).
  no_provider: 'Choose a provider in Settings before starting.',
  no_legs: 'Choose what to translate before starting.',
  turn_mode_unsupported: "This provider doesn't offer the chosen talk mode.",
  participant_source_unavailable: "Translating other participants isn't available here.",
  participant_unsupported: "This provider can't translate the other participants for this language pair.",
  credentials_missing: 'Enter your API key in Settings before starting.',
  not_ready: 'The provider is not ready: {{detail}}',
  build_refused: "The provider can't start with these settings: {{detail}}",
  admit_refused: "The provider can't run this combination: {{detail}}",
  start_failed: "The session didn't start: {{detail}}",
  leg_failed: 'The session stopped: {{detail}}',
  leg_closed: 'The provider ended the session.',
  source_ended: 'The audio source went away (unplugged, closed or stopped).',
  // The capture's degradations.
  app_capture_lost_using_system_audio: 'The app capture stopped, so all system audio is being translated instead.',
  app_capture_monitor_missing: "The app capture didn't start, so all system audio is being translated instead.",
  // The adapters' degradations (CLIENT_DIAGNOSTICS).
  parse_error: "A message from the provider couldn't be read; the session continues.",
  cleanup_failed: 'A step while closing the session failed.',
  input_pipeline_failed: 'Audio capture stopped working; nothing further will be translated.',
  tts_degraded: 'Speech playback is degraded; the translated text still arrives.',
  resume_attempt_failed: 'Reconnecting failed; trying again.',
  send_dropped: "Some audio or text couldn't be sent and was dropped.",
  voice_fallback: 'The chosen voice was unavailable, so another voice is used.',
  lease_notify_failed: "The service couldn't be told about the session's state.",
};

/** The notice in the user's words; the message itself for a code with no words, as today's bubbles show it. */
export function noticeText(t: TFunction, notice: NoticeWords): string {
  const words = notice.code === undefined ? undefined : NOTICE_WORDS[notice.code];
  if (words === undefined) return notice.message;
  return t(`notices.${notice.code}`, { defaultValue: words, ...notice.params, detail: notice.message });
}
```

In `src/locales/en/translation.json`, add a top-level `"notices"` object holding exactly the entries of `NOTICE_WORDS` (same keys, same English, including the `{{detail}}` placeholders), and inside `"mainPanel"`, right after its `"error": "Error"` line (line 566 today), `"warning": "Warning"`. Keep the file valid JSON with its existing two-space indentation.

- [ ] **Step 7: Run the tests, then the gates**

Run: `npx vitest run src/lib/view src/lib/audio`
Expected: PASS.
Run: `npx vitest run src` (0 failed; the locale consistency suites must still pass) and the typecheck gate.

- [ ] **Step 8: Commit**

```bash
git add src/lib/view src/lib/audio/playback.ts src/lib/audio/playback.test.ts src/locales/en/translation.json
git commit -m "feat(view): karaoke from the clip queues, the display filter, and notices in words"
```

---
### Task 6: The conversation list

**Files:**
- Create: `src/components/Conversation/ConversationList.tsx`, `src/components/Conversation/ConversationList.test.tsx`, `src/components/Conversation/useReadable.ts`, `src/components/Conversation/useReadable.test.tsx`

**Interfaces:**
- Consumes: `DisplayItem`, `NoticeEntry` (Task 5's `filter.ts`), `noticeText` (Task 5), `Readable` (Task 4); today's stylesheets `src/components/MainPanel/MainPanel.scss` (`.conversation-display`, `.empty-state`, `.conversation-list`, `.message-bubble.error`), `src/components/MainPanel/ConversationRow.scss` and `src/styles/karaoke.scss`.
- Produces: `ConversationList(props: ConversationListProps)` and `ConversationListProps` (below); `useReadable<T>(source: Readable<T>): T`. Plan 1e mounts the list in `MainPanel`; plan 1d-2's subtitle surface does not use it (it draws bands).

- [ ] **Step 1: Write the failing tests**

Create `src/components/Conversation/useReadable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Readable } from '../../lib/view/conversationView';
import { useReadable } from './useReadable';

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

describe('useReadable', () => {
  it("returns the source's value and follows its changes", () => {
    const source = box(1);
    const { result } = renderHook(() => useReadable(source));
    expect(result.current).toBe(1);
    act(() => source.set(2));
    expect(result.current).toBe(2);
  });
});
```

Create `src/components/Conversation/ConversationList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Row } from '../../lib/projection/types';
import type { DisplayItem } from '../../lib/view/filter';
import { ConversationList, type ConversationListProps } from './ConversationList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

const TEXT = 'こんにちは、お元気ですか？';
const row = (over: Partial<Row> = {}): Row => ({
  key: 's:speaker:2:0', segmentId: 's:speaker:2', side: 'translation', start: 0, end: TEXT.length, text: TEXT, final: true, ...over,
});
const rowItem = (over: Partial<Extract<DisplayItem, { kind: 'row' }>> = {}): DisplayItem => ({
  kind: 'row', row: row(), leg: 'speaker', languages: { source: 'en', target: 'ja' }, t: 0, header: true, endsSegment: true, ...over,
});
const props = (over: Partial<ConversationListProps> = {}): ConversationListProps => ({
  items: [rowItem()],
  lit: new Map(),
  replaying: null,
  replayLegs: new Set(['speaker']),
  canReplay: () => true,
  onReplay: vi.fn(),
  compact: false,
  fontSize: 14,
  empty: 'Nothing yet',
  ...over,
});

describe('ConversationList — rows', () => {
  it("draws a row with today's bubble markup: header, badge and text", () => {
    const { container } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.conversation-row.source-speaker.with-header.expanded')).not.toBeNull();
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Me');
    expect(container.querySelector('.lang-badge.tr.source-speaker')?.textContent).toBe('JA');
    expect(container.querySelector('.row-text.tr')?.textContent).toBe(TEXT);
  });

  it("takes a detected language over the leg's pair, and the source side's language on a source row", () => {
    const { container, rerender } = render(<ConversationList {...props({ items: [rowItem({ row: row({ language: 'zh' }) })] })} />);
    expect(container.querySelector('.lang-badge')?.textContent).toBe('ZH');
    rerender(<ConversationList {...props({ items: [rowItem({ row: row({ side: 'source' }) })] })} />);
    expect(container.querySelector('.lang-badge.src')?.textContent).toBe('EN');
  });

  it('draws a grouped row without a header, and a dot instead of header and badge when compact', () => {
    const { container, rerender } = render(<ConversationList {...props({ items: [rowItem({ header: false })] })} />);
    expect(container.querySelector('.conversation-row.grouped')).not.toBeNull();
    expect(container.querySelector('.row-header')).toBeNull();
    rerender(<ConversationList {...props({ compact: true })} />);
    expect(container.querySelector('.row-role-dot.source-speaker')).not.toBeNull();
    expect(container.querySelector('.lang-badge')).toBeNull();
  });

  it('lights the spoken characters and marks the row as playing', () => {
    const { container } = render(<ConversationList {...props({ lit: new Map([['s:speaker:2', 6]]) })} />);
    expect(container.querySelector('.karaoke-played')?.textContent).toBe('こんにちは、');
    expect(container.querySelector('.row-body.playing')).not.toBeNull();
  });

  it('trims a row for display and keeps karaoke on the trimmed text', () => {
    const item = rowItem({ row: row({ key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9, text: ' Two.' }) });
    const { container } = render(<ConversationList {...props({ items: [item], lit: new Map([['s:speaker:1', 6]]) })} />);
    expect(container.querySelector('.row-text')?.textContent).toBe('Two.');
    expect(container.querySelector('.karaoke-played')?.textContent).toBe('T');
  });
});

describe('ConversationList — replay', () => {
  it("offers replay on a translation segment's last row, and replays that segment", () => {
    const onReplay = vi.fn();
    const { container } = render(<ConversationList {...props({ onReplay })} />);
    const button = container.querySelector('.row-play-btn') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onReplay).toHaveBeenCalledWith('speaker', 's:speaker:2');
  });

  it('disables the button while another segment replays, and where no pcm was kept', () => {
    const { container, rerender } = render(<ConversationList {...props({ replaying: 's:speaker:9' })} />);
    expect((container.querySelector('.row-play-btn') as HTMLButtonElement).disabled).toBe(true);
    rerender(<ConversationList {...props({ canReplay: () => false })} />);
    expect((container.querySelector('.row-play-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no replay slot on a source row, a row that does not end its segment, a leg without replay, or a compact list', () => {
    for (const p of [
      props({ items: [rowItem({ row: row({ side: 'source' }) })] }),
      props({ items: [rowItem({ endsSegment: false })] }),
      props({ replayLegs: new Set() }),
      props({ compact: true }),
    ]) {
      const { container, unmount } = render(<ConversationList {...p} />);
      expect(container.querySelector('.row-play-btn')).toBeNull();
      unmount();
    }
  });
});

describe('ConversationList — notices and the empty state', () => {
  it("draws a notice as today's error bubble, labelled by its severity and put into words", () => {
    const notice: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'Invalid API key', code: 'leg_failed', at: 0 },
    };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-bubble.error.warning')).not.toBeNull();
    expect(container.querySelector('.message-header')?.textContent).toBe('Warning');
    expect(container.querySelector('.message-content.error-content')?.textContent).toContain('The session stopped');
  });

  it('labels an error notice as an error', () => {
    const notice: DisplayItem = { kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'gone', at: 0 } };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-bubble.error.warning')).toBeNull();
    expect(container.querySelector('.message-header')?.textContent).toBe('Error');
    expect(container.querySelector('.message-content')?.textContent).toBe('gone');
  });

  it('shows the empty state when there is nothing to draw', () => {
    const { container } = render(<ConversationList {...props({ items: [] })} />);
    expect(container.querySelector('.empty-state')?.textContent).toBe('Nothing yet');
    expect(container.querySelector('.conversation-list')).toBeNull();
  });

  it('sets the font size on the display', () => {
    const { container } = render(<ConversationList {...props({ fontSize: 20 })} />);
    expect((container.querySelector('.conversation-display') as HTMLElement).style.getPropertyValue('--conversation-font-size')).toBe('20px');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Conversation`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: `useReadable`**

Create `src/components/Conversation/useReadable.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';
import type { Readable } from '../../lib/view/conversationView';

/** A `Readable`'s value, re-rendering when it changes. */
export function useReadable<T>(source: Readable<T>): T {
  // A stable subscribe per source: a new function on every render would resubscribe every render.
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  return useSyncExternalStore(subscribe, source.get);
}
```

- [ ] **Step 4: The list**

Create `src/components/Conversation/ConversationList.tsx`. Its row markup is `ConversationRow`'s (`src/components/MainPanel/ConversationRow.tsx`) and its notice markup the error bubble's (`MainPanel.tsx:161-172`), class for class:

```tsx
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Play, User, Users } from 'lucide-react';
import type { LegName, SegmentId } from '../../lib/conversation/types';
import type { DisplayItem, NoticeEntry } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';
import '../MainPanel/MainPanel.scss';
import '../MainPanel/ConversationRow.scss';
import '../../styles/karaoke.scss';

export interface ConversationListProps {
  items: readonly DisplayItem[];
  /** Characters spoken so far, per segment (karaoke). */
  lit: ReadonlyMap<SegmentId, number>;
  /** The segment a replay is playing, if any. */
  replaying: SegmentId | null;
  /** Legs whose translation rows carry a replay slot. */
  replayLegs: ReadonlySet<LegName>;
  /** The segment kept pcm to replay. */
  canReplay(segmentId: SegmentId): boolean;
  onReplay(leg: LegName, segmentId: SegmentId): void;
  compact: boolean;
  /** In px: the display's `--conversation-font-size`. */
  fontSize: number;
  /** Shown when there is nothing to draw. */
  empty: ReactNode;
}

type RowItem = Extract<DisplayItem, { kind: 'row' }>;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ConversationList({ items, lit, replaying, replayLegs, canReplay, onReplay, compact, fontSize, empty }: ConversationListProps) {
  const display = useRef<HTMLDivElement>(null);
  // Follow the newest line, as today's panel does; layout has run by the time this fires.
  useLayoutEffect(() => {
    const el = display.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className="conversation-display" ref={display} style={{ '--conversation-font-size': `${fontSize}px` } as CSSProperties}>
      {items.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="conversation-list">
          {items.map((item) =>
            item.kind === 'notice' ? (
              <NoticeBubble key={item.notice.id} notice={item.notice} />
            ) : (
              <RowBubble
                key={item.row.key}
                item={item}
                upTo={lit.get(item.row.segmentId)}
                replaying={replaying}
                replaySlot={!compact && item.row.side === 'translation' && item.endsSegment && replayLegs.has(item.leg)}
                canReplay={canReplay}
                onReplay={onReplay}
                compact={compact}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface RowBubbleProps {
  item: RowItem;
  /** Characters [0, upTo) of the row's segment are spoken; undefined when karaoke is not on it. */
  upTo: number | undefined;
  replaying: SegmentId | null;
  replaySlot: boolean;
  canReplay(segmentId: SegmentId): boolean;
  onReplay(leg: LegName, segmentId: SegmentId): void;
  compact: boolean;
}

function RowBubble({ item, upTo, replaying, replaySlot, canReplay, onReplay, compact }: RowBubbleProps) {
  const { t } = useTranslation();
  const { row, leg, languages } = item;
  const isTranslation = row.side === 'translation';
  // A detected language wins; otherwise the leg's pair, frozen at start (spec: "The language pair belongs to the leg").
  const lang = row.language || (isTranslation ? languages.target : languages.source);
  const scopeName = t(
    leg === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    leg === 'speaker' ? 'Me' : 'Other',
  );
  // Rows tile the segment's text untrimmed; a bubble shows it trimmed, and karaoke counts from the trimmed start.
  const text = row.text.trim();
  const lead = row.text.length - row.text.trimStart().length;
  const played = upTo === undefined ? 0 : Math.min(text.length, Math.max(0, upTo - row.start - lead));
  const segmentId = row.segmentId;
  const enabled = canReplay(segmentId);

  return (
    <div className={`conversation-row source-${leg} ${item.header ? 'with-header' : 'grouped'} ${compact ? 'compact' : 'expanded'}`}>
      {!compact && item.header && (
        <div className="row-header">
          <div className={`row-avatar avatar-${leg}`}>
            {leg === 'speaker' ? <User size={12} /> : <Users size={12} />}
          </div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.t)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${upTo !== undefined ? 'playing' : ''}`}>
        {compact && item.header && (
          <span className={`row-role-dot source-${leg}`} role="img" aria-label={scopeName} />
        )}
        {!compact && (
          <span className={`lang-badge ${isTranslation ? 'tr' : 'src'} source-${leg}`}>{lang.toUpperCase()}</span>
        )}
        <span className={`row-text ${isTranslation ? 'tr' : 'src'}`}>
          {played <= 0 ? (
            <span>{text}</span>
          ) : played >= text.length ? (
            <span className="karaoke-played">{text}</span>
          ) : (
            <>
              <span className="karaoke-played">{text.slice(0, played)}</span>
              <span>{text.slice(played)}</span>
            </>
          )}
        </span>
        {replaySlot && (
          // The slot's presence depends on the session-wide setting only, never on
          // whether this segment kept pcm, so no row reflows when its audio lands
          // (today's `ConversationRow` rule). One replay plays at a time.
          <button
            type="button"
            className={`row-play-btn ${replaying === segmentId ? 'playing' : ''}`}
            onClick={enabled ? () => onReplay(leg, segmentId) : undefined}
            disabled={!enabled || (replaying !== null && replaying !== segmentId)}
            aria-label={t('mainPanel.playItemAudio', "Play this item's audio")}
            title={t('mainPanel.playItemAudio', "Play this item's audio")}
          >
            <Play size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function NoticeBubble({ notice }: { notice: NoticeEntry }) {
  const { t } = useTranslation();
  const warning = notice.severity === 'warning';
  return (
    <div className={`message-bubble error${warning ? ' warning' : ''}`}>
      <div className="message-header">
        <AlertCircle size={12} />
        {warning ? t('mainPanel.warning', 'Warning') : t('mainPanel.error', 'Error')}
      </div>
      <div className="message-content error-content">{noticeText(t, notice)}</div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/components/Conversation`
Expected: PASS.
Run: `npx vitest run src` (0 failed — `consoleLedger.consistency.test.ts` included: the new files hold no `console.*`) and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/components/Conversation
git commit -m "feat(conversation): the conversation list over L2's entries, with today's bubble markup"
```

---

### Task 7: The preview draws the new list; a headless check of what it drew

**Files:**
- Modify: `src/providers/fake/scripts.ts` (a `notices` script), `src/providers/fake/provider.test.ts`, `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`, `src/components/dev/SpinePreview.test.tsx`, `src/components/dev/SessionControls.tsx`, `src/components/dev/SessionControls.test.tsx`, `scripts/dev/spine-audio-probe.mjs`
- Create: `scripts/dev/headless.mjs`, `scripts/dev/spine-surface-probe.mjs`

**Interfaces:**
- Consumes: everything above; `presentProviders()`, `useProviderStore` (`selected`, `updateSettings(p, patch)` — synchronous in memory, so a start right after reads the patched settings), `useSettingsStore` (`speakerDisplayMode`, `participantDisplayMode`, `keepReplayAudio`, `setSegmentationMode`, `setSentenceSegmentationChunkSentences`), `useRoutingStore` (`participantSpeech`), `useConversationDisplayStore` (`fontSize`, `compactMode`, `bgColor`, `sourceTextColor`, `translationTextColor`), `getAppAudio()` → `AppAudio.playback`.
- Produces: the preview's list; `withPage(url, fn, options?)`, `evaluate(send, expression)`, `sleep(ms)` in `scripts/dev/headless.mjs`; `scripts/dev/spine-surface-probe.mjs`.

- [ ] **Step 1: A script with a notice**

In `src/providers/fake/scripts.ts`, add `'notices'` to `FakeScriptName` and to the end of `FAKE_SCRIPT_NAMES`, and a case:

```ts
    case 'notices':
      // A degradation between two exchanges: the list draws a notice among the rows.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Testing', 'Testing notices.'], translation: 'お知らせのテストです。', origin: 'n1', audioChunks: 1 }),
          { startAt: 3500, steps: [{ at: 0, degraded: { code: 'tts_degraded', message: 'The fake degraded its speech (script).' } }] },
          exchange({ startAt: 4500, ref: 3, source: ['Still here.'], translation: 'まだいます。', origin: 'n2', audioChunks: 1 }),
        ],
      };
```

In `src/providers/fake/provider.test.ts`, add (import `fakeScript` if it is not imported yet):

```ts
  it('offers a script that raises a notice between two exchanges', () => {
    const steps = fakeScript('notices').blocks.flatMap((block) => block.steps);
    expect(steps.some((step) => 'degraded' in step)).toBe(true);
  });
```

If `FakeSettingsView` keeps a label per script name, give `notices` one.

- [ ] **Step 2: Write the failing preview tests**

In `src/components/dev/SessionControls.test.tsx`, delete the test "replays an exchange's translation" (the list replays now; Task 6 tests it), and any assertion on the old `<ol>` of entries.

In `src/components/dev/SpinePreview.test.tsx`, add:

```tsx
  it("draws the conversation list's empty state before a session", async () => {
    const { container } = render(<SpinePreview />);
    await waitFor(() => expect(container.querySelector('.conversation-display .empty-state')).not.toBeNull());
  });
```

(Use the file's existing imports and mocks; add `waitFor` to the `@testing-library/react` import if missing.)

Run: `npx vitest run src/components/dev src/providers/fake`
Expected: the new SpinePreview test FAILS (no list yet); the rest pass.

- [ ] **Step 3: The preview draws the list**

In `src/components/dev/SessionControls.tsx`, remove the `<ol className="setting-item">…</ol>` block, the `projector` / `entries` / `segments` locals, and the imports only they used (`createProjector`, `DEFAULT_PROJECTION`, `Segment`, `useSyncExternalStore` if unused, `useMemo` if unused). Update the component's doc comment: "Development builds only: drive a runner by hand and check the playback by ear; the conversation is drawn by the list beside it (plan 1d-1). Its copy is not localized."

In `src/components/dev/SpinePreview.tsx`:

1. Next to `previewRunner`, a lazily built view per page:

```ts
let previewView: (Readable<ConversationViewState> & { dispose(): void }) | null = null;

/** One view per page, over the preview runner's conversation and the stored cut. */
function getPreviewView(runner: Runner) {
  previewView ??= createConversationView(runner.conversation, appProjectionSettings(), realClock);
  return previewView;
}

const NO_KARAOKE: Readable<KaraokeState> = { get: () => ({ lit: new Map(), replaying: null }), subscribe: () => () => {} };
```

(Hoist `NO_KARAOKE`'s state into a constant so `get` returns the same object every call — `useSyncExternalStore` requires it: `const IDLE: KaraokeState = { lit: new Map(), replaying: null };` and `get: () => IDLE`.)

2. In `SpinePreview`, build the karaoke once the playback has loaded — keep it in state beside `audio`, created in the `getAppAudio().then(...)` callback with `createKaraoke(loaded.playback.queues, getPreviewView(runner), realClock)` — and apply two development URL parameters in the autostart effect, before `runner.start()`:

```ts
    const params = new URLSearchParams(window.location.search);
    // `&script=<name>`: which script the fake plays (the headless checks pick theirs).
    const script = params.get('script');
    const fake = providers.find((p) => p.id === 'fake');
    if (fake && script && (FAKE_SCRIPT_NAMES as readonly string[]).includes(script)) {
      useProviderStore.getState().updateSettings(fake, { script });
    }
    // `&cut=off|pause|sentences:<n>`: the stored segmentation choice.
    const cut = params.get('cut');
    if (cut) {
      const [mode, size] = cut.split(':');
      if (mode === 'off' || mode === 'pause' || mode === 'sentences') void useSettingsStore.getState().setSegmentationMode(mode);
      if (mode === 'sentences' && size) void useSettingsStore.getState().setSentenceSegmentationChunkSentences(Number(size));
    }
```

3. A local component draws the list, and `SpinePreview` renders it after `<SessionControls … />`:

```tsx
/** The new conversation list over the preview's view (plan 1d-1). Its copy is not localized. */
function PreviewConversation({ view, karaoke, playback }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  playback: Playback | null;
}) {
  const { legs, entries } = useReadable(view);
  const { lit, replaying } = useReadable(karaoke);
  const speaker = useSettingsStore((s) => s.speakerDisplayMode);
  const participant = useSettingsStore((s) => s.participantDisplayMode);
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const display = useConversationDisplayStore();
  const items = useMemo(() => displayItems(entries, { speaker, participant }), [entries, speaker, participant]);
  const segments = useMemo(() => new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const))), [legs]);
  const replayLegs = useMemo(
    () => new Set<LegName>(keepReplayAudio ? (participantSpeech ? ['speaker', 'participant'] : ['speaker']) : []),
    [keepReplayAudio, participantSpeech],
  );
  return (
    <div
      className="spine-conversation"
      style={{
        '--conversation-bg-color': display.bgColor,
        '--conversation-source-color': display.sourceTextColor,
        '--conversation-translation-color': display.translationTextColor,
      } as CSSProperties}
    >
      <ConversationList
        items={items}
        lit={lit}
        replaying={replaying}
        replayLegs={replayLegs}
        // Retention may have dropped a segment's pcm: then there is nothing to replay.
        canReplay={(id) => segments.get(id)?.speech.some((s) => s.pcm.length > 0) ?? false}
        onReplay={(leg, id) => {
          const segment = segments.get(id);
          if (playback && segment) playback.replay(leg, segment);
        }}
        compact={display.compactMode}
        fontSize={display.fontSize}
        empty={<p>Start a session to see the conversation.</p>}
      />
    </div>
  );
}
```

rendered as `<PreviewConversation view={getPreviewView(runner)} karaoke={karaoke ?? NO_KARAOKE} playback={audio?.playback ?? null} />`.

4. In `src/components/dev/SpinePreview.scss`, give the list room to scroll:

```scss
.spine-conversation {
  display: flex;
  flex-direction: column;
  height: 420px;
  background: var(--conversation-bg-color, #1f1f1f);
}
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/components/dev src/providers/fake`
Expected: PASS.
Run: `npx vitest run src` (0 failed) and the typecheck gate.

- [ ] **Step 5: A shared headless helper, and the surface probe**

Create `scripts/dev/headless.mjs`, holding what `spine-audio-probe.mjs` does today to reach a page:

```js
/**
 * Headless Chromium over the DevTools protocol, for the development
 * preview's checks. Uses the Chromium Playwright caches under
 * ~/.cache/ms-playwright and Node's global WebSocket (Node 22+).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocketUrl(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('chromium did not come up');
}

/**
 * Opens `url` in a fresh headless Chromium (its own profile, so nothing
 * persists between runs) and hands `fn` a `send(method, params)`; returns what
 * `fn` returns, and always closes the browser.
 */
export async function withPage(url, fn, { port = 9333, flags = [], viewport = null } = {}) {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!build) throw new Error(`no Playwright chromium under ${cache}`);
  const browser = spawn(join(cache, build, 'chrome-linux', 'chrome'), [
    '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', ...flags,
    `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spine-probe-'))}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await pageSocketUrl(port));
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    let nextId = 0;
    const waiting = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    try {
      await send('Page.enable');
      if (viewport) await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url });
      return await fn(send);
    } finally {
      ws.close();
    }
  } finally {
    browser.kill();
  }
}

/** The value of `expression` in the page. */
export async function evaluate(send, expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.result?.value;
}
```

Rewrite `scripts/dev/spine-audio-probe.mjs` on it, with the same usage, output and exit rule as today:

```js
#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played and the loudest
 * sample the tts tap heard (the page's `[data-probe=playback]` line).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&capture=device'] [seconds]
 *
 * Exits 1 when no clip played or the tap heard nothing; with `capture=device`,
 * the fake microphone is captured too, and it must deliver.
 */
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);

process.exitCode = await withPage(url, async (send) => {
  await sleep(seconds * 1000);
  const text = (await evaluate(send, 'document.querySelector("[data-probe=playback]")?.textContent ?? ""')) ?? '';
  console.log(text || 'no playback probe on the page');
  const heard = /heard: (\S+)/.exec(text)?.[1] ?? '-';
  const peak = Number(/tap peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const deviceCapture = url.includes('capture=device');
  const chunks = Number(/captured: (\d+)/.exec(text)?.[1] ?? 0);
  const micPeak = Number(/mic peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const captureOk = !deviceCapture || (chunks > 0 && micPeak > 0);
  return heard !== '-' && peak > 0 && captureOk ? 0 : 1;
}, { flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
```

Create `scripts/dev/spine-surface-probe.mjs`:

```js
#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * checks what the conversation list drew (plan 1d-1): rows with text, the
 * headers, karaoke lit at least once, notices — and saves a screenshot to
 * look at.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-surface-probe.mjs [url] [seconds] [screenshot.png]
 *
 * Default url: http://localhost:5199/?preview=spine&autostart=1. Others worth
 * running: `&script=cjk&cut=sentences:1` (rows tile CJK text) and
 * `&script=notices` (a notice among the rows).
 *
 * Exits 1 unless the list ended with at least four rows, never drew a blank
 * row, lit karaoke at least once, and — for `script=notices` — drew a notice.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);
const screenshot = process.argv[4] ?? null;

const READ = `(() => {
  const rows = [...document.querySelectorAll('.conversation-display .conversation-row')];
  return {
    rows: rows.length,
    headers: document.querySelectorAll('.conversation-display .row-header').length,
    blank: rows.filter((r) => (r.querySelector('.row-text')?.textContent ?? '').trim() === '').length,
    lit: document.querySelectorAll('.conversation-display .karaoke-played').length,
    notices: document.querySelectorAll('.conversation-display .message-bubble.error').length,
    texts: rows.map((r) => (r.querySelector('.lang-badge')?.textContent ?? '') + ' ' + (r.querySelector('.row-text')?.textContent ?? '')),
  };
})()`;

process.exitCode = await withPage(url, async (send) => {
  let last = { rows: 0, headers: 0, blank: 0, lit: 0, notices: 0, texts: [] };
  let litEver = false;
  let blankEver = false;
  for (let waited = 0; waited < seconds * 1000; waited += 250) {
    await sleep(250);
    const now = await evaluate(send, READ);
    if (!now) continue;
    litEver ||= now.lit > 0;
    blankEver ||= now.blank > 0;
    last = now;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  console.log(`rows: ${last.rows} · headers: ${last.headers} · karaoke: ${litEver ? 'lit' : 'never'} · notices: ${last.notices} · blank rows: ${blankEver ? 'seen' : 'none'}`);
  for (const text of last.texts) console.log(`  | ${text}`);
  const wantsNotice = url.includes('script=notices');
  return last.rows >= 4 && !blankEver && litEver && (!wantsNotice || last.notices > 0) ? 0 : 1;
}, { viewport: { width: 900, height: 1600 } });
```

- [ ] **Step 6: Run the checks against the running preview**

In one shell: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort` (background it and wait until it answers on 5199). Then run, saving each screenshot under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`:

```bash
node scripts/dev/spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1' 12 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d1-exchange.png
node scripts/dev/spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=cjk&cut=sentences:1' 10 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d1-cjk.png
node scripts/dev/spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=notices' 10 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1d1-notices.png
node scripts/dev/spine-audio-probe.mjs
node scripts/dev/spine-audio-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&capture=device'
```

Expected: every command exits 0. The `cjk` run lists four rows (two source, two translation) with no space inside the Japanese or Chinese text; the `notices` run lists at least one notice. Record each command's printed lines in the report, then stop the vite server (and make sure port 5199 is free again).

If a probe fails, the page is the thing to debug (open the screenshot); the probe's thresholds are not to be lowered.

- [ ] **Step 7: Commit**

```bash
git add src/providers/fake src/components/dev scripts/dev
git commit -m "feat(dev): the preview draws the new conversation list; a headless check of what it drew"
```

---

## Self-review notes (for the executor)

- Rows now carry text: anything that builds `Row` literals by hand (tests) needs `text` and `final`. Task 1 names the two files that do today; `grep -rn "segmentId:" src` finds any other.
- `useSyncExternalStore` needs `get()` to return the same object while nothing changed: every `Readable` in this plan caches its state; `NO_KARAOKE` in the preview must too.
- The typecheck gate's pattern now covers `src/lib/view` and `src/components/Conversation`.
- The screenshots of Task 7 are for jiangzhuo's review of ruling 8 (today's UI rules, and the "Warning" label).
