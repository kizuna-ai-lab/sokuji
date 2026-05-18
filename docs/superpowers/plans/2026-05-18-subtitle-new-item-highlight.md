# Subtitle New-Item Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly-arrived items in the compact subtitle band visually obvious via a one-shot fade-in plus a decaying background-luminance-aware overlay, without re-animating the items that were already on screen when subtitle mode opened.

**Architecture:** Replace the per-bucket `bucket.join(' ')` string with an array of `{id, text}` items in the `SubtitleStream` compact branch, then render each item as a `<span key={item.id}>`. Track item lifecycle in two refs (`itemStatesRef: Map<id, 'existing'|'new'>` and `isFirstRenderRef: boolean`) — `existing` for items present at first mount, `new` for items that arrive after. The `--new` modifier triggers a single combined CSS keyframe animation. The overlay color is set via the CSS variable `--subtitle-highlight-overlay`, picked by a YIQ-based helper that inverts against the user's `bgColor`.

**Tech Stack:** React 18 (refs + `useLayoutEffect`), TypeScript, Vitest + `@testing-library/react`, SCSS (`@keyframes`).

**Spec:** [`docs/superpowers/specs/2026-05-18-subtitle-new-item-highlight-design.md`](../specs/2026-05-18-subtitle-new-item-highlight-design.md)

---

## File Structure

| File | Role |
|---|---|
| `src/components/Subtitle/SubtitleApp.tsx` | Owns the YIQ helper `getHighlightOverlayForBg` and injects `--subtitle-highlight-overlay` on the subtitle root |
| `src/components/Subtitle/SubtitleApp.test.tsx` (new) | Unit tests for the helper |
| `src/components/Subtitle/SubtitleStream.tsx` | Bucket shape change, per-item span rendering, item-state refs |
| `src/components/Subtitle/SubtitleStream.scss` | `.subtitle-stream__item` styles, `.subtitle-stream__item--new`, `@keyframes subtitle-item-highlight` |
| `src/components/Subtitle/SubtitleStream.test.tsx` | New assertions for per-item spans, first-mount suppression, post-mount arrival, streaming-growth stability |

No other files change.

---

## Task 1: Helper — `getHighlightOverlayForBg`

**Files:**
- Modify: `src/components/Subtitle/SubtitleApp.tsx` (add an exported helper near the existing `hexToRgba` at line 39)
- Create: `src/components/Subtitle/SubtitleApp.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/Subtitle/SubtitleApp.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { getHighlightOverlayForBg } from './SubtitleApp';

describe('getHighlightOverlayForBg', () => {
  it('returns a translucent white overlay for the default black background', () => {
    expect(getHighlightOverlayForBg('#000000')).toBe('rgba(255, 255, 255, 0.3)');
  });

  it('returns a translucent black overlay for a white background', () => {
    expect(getHighlightOverlayForBg('#ffffff')).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('flips at the YIQ midpoint (≈ 128)', () => {
    // YIQ for #555555 = 0.299*85 + 0.587*85 + 0.114*85 = 85 < 128 → dark → white overlay
    expect(getHighlightOverlayForBg('#555555')).toBe('rgba(255, 255, 255, 0.3)');
    // YIQ for #aaaaaa = 170 > 128 → light → black overlay
    expect(getHighlightOverlayForBg('#aaaaaa')).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('weights green most heavily (YIQ luminance)', () => {
    // Pure red (#ff0000): YIQ = 0.299*255 ≈ 76 → dark → white
    expect(getHighlightOverlayForBg('#ff0000')).toBe('rgba(255, 255, 255, 0.3)');
    // Pure green (#00ff00): YIQ = 0.587*255 ≈ 150 → light → black
    expect(getHighlightOverlayForBg('#00ff00')).toBe('rgba(0, 0, 0, 0.3)');
    // Pure blue (#0000ff): YIQ = 0.114*255 ≈ 29 → dark → white
    expect(getHighlightOverlayForBg('#0000ff')).toBe('rgba(255, 255, 255, 0.3)');
  });

  it('returns the dark-bg default when the input is malformed', () => {
    expect(getHighlightOverlayForBg('#fff')).toBe('rgba(255, 255, 255, 0.3)');
    expect(getHighlightOverlayForBg('not-a-hex')).toBe('rgba(255, 255, 255, 0.3)');
    expect(getHighlightOverlayForBg('')).toBe('rgba(255, 255, 255, 0.3)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleApp.test.tsx`
Expected: FAIL — `getHighlightOverlayForBg` is not exported.

- [ ] **Step 3: Add the helper to `SubtitleApp.tsx`**

Insert this function in `src/components/Subtitle/SubtitleApp.tsx` immediately below the existing `hexToRgba` function (around line 50, right after the closing brace of `hexToRgba`):

```tsx
const HIGHLIGHT_ALPHA = 0.3;

/**
 * Returns a CSS color for the "newly-arrived item" overlay, chosen so it
 * contrasts with the user-selected background. YIQ luminance < 128 means
 * the background is dark → use a light overlay; otherwise use dark.
 *
 * The user-set bgOpacity is intentionally not factored in. When opacity is
 * very low and the actual visible background is whatever sits behind the
 * subtitle window, this falls back to the bgColor's nominal lightness —
 * a known limitation accepted in the design spec.
 */
export function getHighlightOverlayForBg(hex: string): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return `rgba(255, 255, 255, ${HIGHLIGHT_ALPHA})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(255, 255, 255, ${HIGHLIGHT_ALPHA})`;
  }
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 128
    ? `rgba(255, 255, 255, ${HIGHLIGHT_ALPHA})`
    : `rgba(0, 0, 0, ${HIGHLIGHT_ALPHA})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/SubtitleApp.test.tsx`
Expected: PASS — all 5 test cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx src/components/Subtitle/SubtitleApp.test.tsx
git commit -m "feat(subtitle): add getHighlightOverlayForBg YIQ helper"
```

---

## Task 2: Inject `--subtitle-highlight-overlay` CSS variable

**Files:**
- Modify: `src/components/Subtitle/SubtitleApp.tsx` (the `rootStyle` block around line 199)

`SubtitleApp` has heavy dependencies (`useSettingsStore`, `useSessionStore`, electron surface logic) and is not currently rendered in isolation by any test in the codebase. Building a full mock harness just to assert one CSS var would be disproportionate. The helper itself is exhaustively unit-tested in Task 1; the wiring is one declarative line and verified manually in Task 6.

- [ ] **Step 1: Wire the var into `rootStyle`**

In `src/components/Subtitle/SubtitleApp.tsx`, modify the existing `rootStyle` block (around lines 199-203):

```tsx
const bgAlpha = subtitle.bgOpacity / 100;
const rootStyle: React.CSSProperties & Record<string, string | number> = {
  background: hexToRgba(subtitle.bgColor, bgAlpha),
  '--bar-opacity': barVisible ? 1 : 0,
  '--bar-pointer-events': barVisible ? 'auto' : 'none',
  '--subtitle-highlight-overlay': getHighlightOverlayForBg(subtitle.bgColor),
};
```

- [ ] **Step 2: Run the existing tests to confirm no regression**

Run: `npx vitest run src/components/Subtitle/`
Expected: PASS — every test in `SubtitleApp.test.tsx`, `SubtitleStream.test.tsx`, and `SubtitleSessionEnded.test.tsx` still passes (Task 1's helper tests stay green; nothing else changed).

- [ ] **Step 3: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx
git commit -m "feat(subtitle): inject --subtitle-highlight-overlay CSS var on root"
```

---

## Task 3: Per-item spans in compact branch

**Files:**
- Modify: `src/components/Subtitle/SubtitleStream.tsx` (compact branch + `useMemo`)
- Modify: `src/components/Subtitle/SubtitleStream.test.tsx` (add assertions)

This task changes the bucket shape from `string` to `{id, text}[]` and renders each entry as its own `<span>`. Existing tests already assert `p.textContent` rather than checking for a single text node, so they continue to pass.

- [ ] **Step 1: Write the failing test**

Add a new `it` block inside the existing `describe('SubtitleStream — compact mode (up to 4 equal-height lines)'` block in `src/components/Subtitle/SubtitleStream.test.tsx`:

```tsx
it('renders one span per visible item with the item id as the key', () => {
  const many: any[] = [
    { id: '1', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'hello' },  sourceLanguage: 'en', targetLanguage: 'zh' },
    { id: '5', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'world' },  sourceLanguage: 'en', targetLanguage: 'zh' },
    { id: '9', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'again' }, sourceLanguage: 'en', targetLanguage: 'zh' },
  ];
  const { container } = render(
    <SubtitleStream
      items={many}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  const spans = container.querySelectorAll(
    '.subtitle-stream__line--speaker.subtitle-stream__line--source .subtitle-stream__item',
  );
  expect(spans.length).toBe(3);
  // Chronological order: oldest first
  expect(spans[0].textContent).toBe('hello');
  expect(spans[1].textContent).toBe(' world');
  expect(spans[2].textContent).toBe(' again');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleStream.test.tsx`
Expected: FAIL — selector `.subtitle-stream__item` returns 0 elements (compact branch still uses a flat `<p>{text}</p>`).

- [ ] **Step 3: Refactor bucket shape and compact render**

In `src/components/Subtitle/SubtitleStream.tsx`, replace the existing `SubtitleLine` interface, the `useMemo` body that builds `lines`, and the compact JSX render. The full replacement for the `lines` computation:

```tsx
interface SubtitleLineItem {
  id: string;
  text: string;
}
interface SubtitleLine {
  id: string;
  kind: LineKind;
  source: LineSource;
  items: SubtitleLineItem[];
}

const lines = useMemo<SubtitleLine[]>(() => {
  const buckets: Record<string, SubtitleLineItem[]> = {
    'speaker-source': [],
    'speaker-translation': [],
    'participant-source': [],
    'participant-translation': [],
  };
  const bucketLen: Record<string, number> = {
    'speaker-source': 0,
    'speaker-translation': 0,
    'participant-source': 0,
    'participant-translation': 0,
  };

  // Walk items newest-first, prepending each item's text to its bucket
  // until that bucket reaches BUCKET_MAX_CHARS. Older items beyond the
  // cap are dropped — the band only shows the tail anyway. shouldShowItem
  // lets error/system rows pass; route them to the translation bucket of
  // whichever side produced them so they remain visible.
  for (let i = filtered.length - 1; i >= 0; i--) {
    const item = filtered[i];
    const text = itemText(item).trim();
    if (!text) continue;
    const side: LineSource = item.source === 'participant' ? 'participant' : 'speaker';
    let kind: LineKind;
    if (item.role === 'user') kind = 'source';
    else if (item.role === 'assistant') kind = 'translation';
    else if (item.type === 'error' || item.role === 'system') kind = 'translation';
    else continue;
    const key = `${side}-${kind}`;
    if (bucketLen[key] >= BUCKET_MAX_CHARS) continue;
    buckets[key].unshift({ id: item.id, text });
    bucketLen[key] += text.length + 1; // +1 for the joining space
  }

  const order: Array<{ source: LineSource; kind: LineKind }> = [
    { source: 'speaker', kind: 'source' },
    { source: 'speaker', kind: 'translation' },
    { source: 'participant', kind: 'source' },
    { source: 'participant', kind: 'translation' },
  ];
  return order
    .map(({ source, kind }) => ({
      id: `${source}-${kind}`,
      source,
      kind,
      items: buckets[`${source}-${kind}`],
    }))
    .filter((l) => l.items.length > 0);
}, [filtered]);
```

Replace the compact-branch JSX inside the returned `<div className={...}>`:

```tsx
{compact
  ? lines.map((line) => (
      <div
        key={line.id}
        className={`subtitle-stream__line subtitle-stream__line--${line.kind} subtitle-stream__line--${line.source}`}
      >
        <p>
          {line.items.map((it, idx) => (
            <span key={it.id} className="subtitle-stream__item">
              {idx > 0 ? ' ' : ''}{it.text}
            </span>
          ))}
        </p>
      </div>
    ))
  : filtered.map((item, i) => (
      <ConversationRow
        key={item.id}
        item={item}
        prevItem={filtered[i - 1] ?? null}
        compact={false}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        isPlaying={false}
        highlightedChars={0}
        canPlay={false}
      />
    ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/SubtitleStream.test.tsx`
Expected: PASS — all existing test cases still green (they assert via `p.textContent`, which transparently reads through child spans), and the new per-span assertion is green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.tsx src/components/Subtitle/SubtitleStream.test.tsx
git commit -m "feat(subtitle): render compact bucket items as per-item spans"
```

---

## Task 4: First-mount suppression + new-item class

**Files:**
- Modify: `src/components/Subtitle/SubtitleStream.tsx` (refs + state machine)
- Modify: `src/components/Subtitle/SubtitleStream.test.tsx` (two new assertions)

- [ ] **Step 1: Write the failing tests**

Add these `it` blocks inside the same `describe('SubtitleStream — compact mode (up to 4 equal-height lines)'` block:

```tsx
it('does not mark items as new on the very first render (no flash for pre-existing items)', () => {
  const { container } = render(
    <SubtitleStream
      items={items}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  const newSpans = container.querySelectorAll('.subtitle-stream__item--new');
  expect(newSpans.length).toBe(0);
});

it('marks only items that arrive after the first render as new', () => {
  const { container, rerender } = render(
    <SubtitleStream
      items={items}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  // First render — none should be new
  expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);

  // A new speaker source item arrives
  const arrived: any[] = [
    ...items,
    { id: 'NEW1', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'just arrived' }, sourceLanguage: 'en', targetLanguage: 'zh' },
  ];
  rerender(
    <SubtitleStream
      items={arrived}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  const newSpans = container.querySelectorAll('.subtitle-stream__item--new');
  expect(newSpans.length).toBe(1);
  expect(newSpans[0].textContent).toContain('just arrived');
});

it('does not re-toggle the --new class when a streaming item grows in place', () => {
  // Item is present at first render → marked 'existing' permanently.
  // Then it "grows" (text changes while id stays the same).
  const initial: any[] = [
    { id: 'GROW', source: 'speaker', role: 'user', type: 'message', status: 'in_progress', formatted: { text: 'Hel' }, sourceLanguage: 'en', targetLanguage: 'zh' },
  ];
  const { container, rerender } = render(
    <SubtitleStream
      items={initial}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);

  const grown: any[] = [
    { id: 'GROW', source: 'speaker', role: 'user', type: 'message', status: 'completed', formatted: { text: 'Hello world' }, sourceLanguage: 'en', targetLanguage: 'zh' },
  ];
  rerender(
    <SubtitleStream
      items={grown}
      compact
      fontSize={24}
      speakerMode="both"
      participantMode="both"
      sourceLanguage="en"
      targetLanguage="zh"
    />,
  );
  // Same id → 'existing' state preserved → still no --new class.
  expect(container.querySelectorAll('.subtitle-stream__item--new').length).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Subtitle/SubtitleStream.test.tsx`
Expected: FAIL — the streaming-growth test passes (no class yet), but the "marks items that arrive after first render as new" assertion fails (`querySelectorAll('.subtitle-stream__item--new').length` is 0 instead of 1).

- [ ] **Step 3: Add refs and decision rule**

In `src/components/Subtitle/SubtitleStream.tsx`, after the `useEffect` for `endRef` (around the existing block at line 126), add:

```tsx
// Each item is classified once and locked: 'existing' = present at first
// render of this component instance (never animates), 'new' = arrived later
// (animates exactly once on first paint via CSS @keyframes).
const itemStatesRef = useRef<Map<string, 'existing' | 'new'>>(new Map());
const isFirstRenderRef = useRef(true);

const itemStateFor = (id: string): 'existing' | 'new' => {
  const known = itemStatesRef.current.get(id);
  if (known) return known;
  return isFirstRenderRef.current ? 'existing' : 'new';
};

useLayoutEffect(() => {
  for (const line of lines) {
    for (const it of line.items) {
      if (!itemStatesRef.current.has(it.id)) {
        itemStatesRef.current.set(
          it.id,
          isFirstRenderRef.current ? 'existing' : 'new',
        );
      }
    }
  }
  isFirstRenderRef.current = false;
});
```

Then update the import line at the top of the file to include `useLayoutEffect`:

```tsx
import React, { useEffect, useLayoutEffect, useRef, useMemo } from 'react';
```

Then update the compact-branch JSX so the span carries `--new` when applicable:

```tsx
{line.items.map((it, idx) => {
  const className =
    itemStateFor(it.id) === 'new'
      ? 'subtitle-stream__item subtitle-stream__item--new'
      : 'subtitle-stream__item';
  return (
    <span key={it.id} className={className}>
      {idx > 0 ? ' ' : ''}{it.text}
    </span>
  );
})}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Subtitle/SubtitleStream.test.tsx`
Expected: PASS — all three new tests green, and previously-passing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.tsx src/components/Subtitle/SubtitleStream.test.tsx
git commit -m "feat(subtitle): mark newly-arrived bucket items with --new modifier"
```

---

## Task 5: SCSS keyframe + item styles

**Files:**
- Modify: `src/components/Subtitle/SubtitleStream.scss`

This task is visual; the JSX assertions in Task 4 already verified the class is applied to the right elements. We add the styles, then re-run the full test suite to confirm no regression.

- [ ] **Step 1: Add styles**

In `src/components/Subtitle/SubtitleStream.scss`, append inside the existing `.subtitle-stream` block (right after the `&.compact { ... }` block closes — same indentation level as `&.compact` and `&.expanded`). Place this block above `&.expanded`:

```scss
  // ------------------------------------------------------------------
  // Per-item highlight in compact mode.
  // The item-aware spans created by SubtitleStream are styled here.
  // `--new` modifier triggers a one-shot fade-in + decaying overlay
  // animation; the class persists on the span afterwards (harmless —
  // CSS animations only fire once per class application).
  // ------------------------------------------------------------------
  .subtitle-stream__item {
    // No styles in the un-animated case — the span is a plain inline.
  }

  .subtitle-stream__item--new {
    animation: subtitle-item-highlight 2s ease-out both;
    border-radius: 2px;
    padding: 1px 3px;
  }
}

@keyframes subtitle-item-highlight {
  0% {
    opacity: 0;
    background-color: var(--subtitle-highlight-overlay, rgba(255, 255, 255, 0.3));
  }
  20% {
    opacity: 1;
    background-color: var(--subtitle-highlight-overlay, rgba(255, 255, 255, 0.3));
  }
  100% {
    opacity: 1;
    background-color: transparent;
  }
}
```

Important: the closing brace `}` shown above on the line "}" closes the outer `.subtitle-stream` block. Place the `@keyframes` *outside* that block (keyframes cannot be nested inside a selector — well, Sass would let you, but keeping it top-level is clearer). Adjust placement to match the file's existing structure if needed.

- [ ] **Step 2: Run all relevant tests**

Run: `npx vitest run src/components/Subtitle/`
Expected: PASS — every test in `SubtitleApp.test.tsx`, `SubtitleStream.test.tsx`, and `SubtitleSessionEnded.test.tsx` still passes. The SCSS change is a no-op for jsdom (which doesn't run animations) but JSX assertions still validate class application.

- [ ] **Step 3: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.scss
git commit -m "feat(subtitle): add highlight keyframe and per-item span styles"
```

---

## Task 6: Full test suite + manual verification

This task locks the work in: full suite run, then a short manual checklist against the spec's "Manual verification" section.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test -- --run`
Expected: PASS — no regressions anywhere in the repo. If anything else breaks, debug and fix before continuing.

- [ ] **Step 2: Manual verification — local provider (non-streaming)**

If a local-provider environment is set up locally:

1. `npm run electron:dev`
2. Configure local provider with HY-MT translation.
3. Start a session, open subtitle mode (compact band).
4. Speak a long sentence. Observe the translation: fade-in + light overlay should appear and decay over ~2 s.

If no local provider available, skip — Task 7 covers OpenAI Realtime as a streaming smoke test.

- [ ] **Step 3: Manual verification — streaming provider**

1. With the same dev electron app, switch to OpenAI Realtime.
2. Start a session, open subtitle mode.
3. Speak a short utterance. Observe the streaming item: it fades in once at first text, then continues growing without re-animating.

- [ ] **Step 4: Manual verification — first-mount suppression**

1. Have a few items already in the conversation (speak briefly in the main panel).
2. Toggle subtitle mode on.
3. Observe: the pre-existing items appear without any animation. Only the *next* arriving item animates.

- [ ] **Step 5: Manual verification — overlay color flip**

1. Open subtitle settings (⚙).
2. Change `bgColor` to white (`#ffffff`).
3. Speak again. Observe: the next arriving item has a dark (translucent black) overlay instead of light.
4. Revert `bgColor` to black to keep dev state clean.

- [ ] **Step 6: Final commit (if any tweaks)**

If steps 2-5 surface a visual issue (e.g., padding too aggressive, 2 s too slow), tweak `SubtitleStream.scss` and commit:

```bash
git add src/components/Subtitle/SubtitleStream.scss
git commit -m "fix(subtitle): tune highlight animation timing / padding"
```

Otherwise, no commit needed — the previous task already finalised the implementation.

---

## Self-Review Checklist (against spec)

The implementation must satisfy every item in this checklist before considering the work done.

- [ ] **Visual treatment**: fade-in (opacity 0 → 1 by ~20% of animation = 400 ms in a 2 s run) + overlay decay to transparent → covered by Task 5 keyframe.
- [ ] **Overlay color auto-inverts**: YIQ < 128 → white, else black → covered by Task 1 helper + Task 2 CSS var injection.
- [ ] **All four buckets supported**: speaker source / speaker translation / participant source / participant translation → covered by Task 3 (per-item rendering replaces the per-bucket join uniformly).
- [ ] **Error / system items get the same highlight**: bucket routing for `type==='error'` / `role==='system'` to translation bucket is unchanged → handled by Task 3 preserving existing routing logic.
- [ ] **Per-item span keyed by `item.id`**: covered by Task 3.
- [ ] **First-mount suppression** (no flash for items present at component mount): covered by Task 4's `isFirstRenderRef` gate + tests.
- [ ] **New-arrival animation** (one-shot per item via CSS keyframe + class): covered by Task 4 (state) + Task 5 (CSS).
- [ ] **Streaming-growth stability** (same id → state preserved → no re-toggle): covered by Task 4's `itemStatesRef.has(it.id)` short-circuit + dedicated test.
- [ ] **`BUCKET_MAX_CHARS` truncation honored**: Task 3 keeps the `bucketLen[key] += text.length + 1` accumulator + threshold check identical to today.
- [ ] **Expanded mode unchanged**: Task 3 leaves the expanded-branch JSX untouched.
- [ ] **No new persisted settings, no new UI controls**: confirmed — nothing in `subtitleStore`, `DisplaySettingsPopover`, or i18n changes.
- [ ] **Helper exported for testing**: Task 1 declares `getHighlightOverlayForBg` with `export`.
- [ ] **`useLayoutEffect` rather than `useEffect`** for committing item states: Task 4 specifies this explicitly to avoid a paint-race on the first arrival after mount.
- [ ] **`bgOpacity` low limitation accepted**: documented in helper JSDoc (Task 1) and spec.

---

## Out of Scope (reminder)

- Tuning constants beyond the spec's defaults (2 s animation, 0.30 peak alpha, 1 px / 3 px padding) — these are *implementation* choices the engineer can adjust if visually awkward, but the design accepts them.
- Settings UI for highlight customisation.
- Touching expanded mode.
- Extracting `hexToRgba` to a shared utility module.
- Any test infrastructure beyond what already exists (Vitest + jsdom).

---

## Follow-up Task 7: User Toggle (post-approval)

Added after the original 6 tasks were implemented, in response to a user
request to make the highlight feature opt-out. See the spec's
"Follow-up Addition (post-approval)" section for design details.

**Files modified:**

- `src/stores/subtitleStore.ts` — new `newItemHighlightEnabled: boolean`
  field (default `true`), `setNewItemHighlightEnabled` setter, hydration
  entry, `useSubtitleNewItemHighlightEnabled` /
  `useSetSubtitleNewItemHighlightEnabled` hooks.
- `src/stores/subtitleStore.test.ts` — new `setNewItemHighlightEnabled`
  test; reset state includes the new field.
- `src/components/Subtitle/SubtitleStream.tsx` — new optional prop
  `newItemHighlightEnabled?: boolean` (default `true`); compact branch
  gates the `--new` modifier on this flag.
- `src/components/Subtitle/SubtitleStream.test.tsx` — new test asserting
  that `newItemHighlightEnabled={false}` suppresses the `--new` class
  even for items arriving post-mount.
- `src/components/Subtitle/SubtitleApp.tsx` — reads the setting and
  passes it through to `SubtitleStream`.
- `src/components/Display/DisplaySettingsPopover.tsx` — adds a
  subtitle-only `ToggleSwitch` row consuming the new setter.
- `src/components/Display/DisplaySettingsPopover.test.tsx` — verifies
  the toggle renders in subtitle mode only and that clicking it flips
  the store.
- `src/locales/en/translation.json` — new English key
  `subtitle.settings.newItemHighlight` → "Highlight newly-arrived text".

The earlier "self-review checklist" item **"No new persisted settings,
no new UI controls"** no longer holds; the toggle was explicitly added.
All other checklist items still apply.
