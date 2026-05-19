# Subtitle Karaoke-Style Character Highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show character-by-character karaoke highlight on the currently-playing assistant message inside subtitle mode (compact + expanded layouts), covering Electron and Extension iframe contexts.

**Architecture:** Lift `playingItemId` and playback progress into a shared Zustand `playbackStore` that runs the cumulative-time + monotonic-clamp state machine; extract `getHighlightedChars` to a pure module; consume via a single `usePlaybackHighlight(item)` hook in both `MainPanel` and `SubtitleStream`. For the Extension path, the side-panel surface forwards raw playback signals over the existing `chrome.runtime.Port` using a compact 3-decimal wire format; the iframe's `sessionPortMirror` decodes them into the iframe-side `playbackStore` so both contexts run identical state machines.

**Tech Stack:** TypeScript + React 18 (Vite + Vitest), Zustand 5 (`subscribeWithSelector` middleware, `useShallow`), SASS, `@testing-library/react`, `chrome.runtime.Port` (Manifest V3 extension).

**Spec:** [docs/superpowers/specs/2026-05-19-subtitle-karaoke-highlight-design.md](../specs/2026-05-19-subtitle-karaoke-highlight-design.md)

---

## File Map

**New:**
- `src/lib/playback/highlight.ts` — pure `getHighlightedChars(currentTime, segments, textLength, progressRatio): number`.
- `src/lib/playback/highlight.test.ts` — unit tests for the pure function.
- `src/stores/playbackStore.ts` — Zustand store with public state, internal trackers, actions, wire helpers, `usePlaybackHighlight` hook.
- `src/stores/playbackStore.test.ts` — store + wire-helper unit tests.
- `src/stores/playbackStore.usePlaybackHighlight.test.tsx` — hook tests with `@testing-library/react`.
- `src/styles/karaoke.scss` — `.karaoke-played` CSS class.

**Modified:**
- `src/components/MainPanel/MainPanel.tsx` — replace local `useState` / `useMemo` / `useEffect` blocks with store hooks; extract `ConversationBubble` subcomponent.
- `src/components/MainPanel/MainPanel.scss` — delete `.row-text-played` rule.
- `src/components/MainPanel/ConversationRow.tsx` — rename `row-text-played` → `karaoke-played`; import `karaoke.scss`.
- `src/components/Subtitle/SubtitleStream.tsx` — `itemsById` + `CompactSpan` + `SubtitleConversationRow`; import `karaoke.scss`.
- `src/components/Subtitle/SubtitleStream.test.tsx` — update existing test cases, add karaoke split assertions.
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` — install fourth subscription (`subscribePlaybackForPort`); include `playback` in `state-init`.
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts` — test playback forwarding and `state-init.playback`.
- `src/stores/sessionPortMirror.ts` — add `InboundPlayback` case + `state-init.payload.playback` decode.
- `src/stores/sessionPortMirror.test.ts` — test inbound `playback` and `state-init.playback`.

---

## Task 1: Pure `getHighlightedChars` Module — Test First

**Files:**
- Create: `src/lib/playback/highlight.ts`
- Test: `src/lib/playback/highlight.test.ts`

- [ ] **Step 1.1: Create the test file (failing tests)**

Create `src/lib/playback/highlight.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getHighlightedChars } from './highlight';

describe('getHighlightedChars', () => {
  describe('segment-based', () => {
    const segments = [
      { textEnd: 5, audioEnd: 1.0 },   // "Hello"
      { textEnd: 11, audioEnd: 2.0 },  // "Hello world"
      { textEnd: 14, audioEnd: 3.0 },  // "Hello world!!!"
    ];

    it('inside the first segment scales by segment progress', () => {
      // half-way through segment 1: 0.5s of [0, 1.0s] → 50% of "Hello" (5 chars) = 2
      expect(getHighlightedChars(0.5, segments, 14, 0)).toBe(2);
    });

    it('inside a later segment uses prevTextEnd + intra-segment progress', () => {
      // 1.5s in: 0.5/1.0 through seg 2 (textEnd 11, prev 5, width 6) → 5 + 3 = 8
      expect(getHighlightedChars(1.5, segments, 14, 0)).toBe(8);
    });

    it('past the final segment returns the last textEnd', () => {
      expect(getHighlightedChars(99, segments, 14, 0)).toBe(14);
    });

    it('zero-duration segment returns its full textEnd immediately', () => {
      const zeroDur = [
        { textEnd: 3, audioEnd: 1.0 },
        { textEnd: 7, audioEnd: 1.0 }, // same audioEnd → segDuration === 0
      ];
      // currentTime exactly at the boundary chooses seg 2 (currentTime < audioEnd false for seg 1)
      expect(getHighlightedChars(1.0, zeroDur, 7, 0)).toBe(7);
    });
  });

  describe('linear fallback', () => {
    it('uses floor(textLength * progressRatio) when segments is undefined', () => {
      expect(getHighlightedChars(0, undefined, 10, 0.5)).toBe(5);
    });

    it('uses floor(textLength * progressRatio) when segments is empty', () => {
      expect(getHighlightedChars(0, [], 10, 0.3)).toBe(3);
    });

    it('progressRatio 0 returns 0', () => {
      expect(getHighlightedChars(0, undefined, 10, 0)).toBe(0);
    });

    it('progressRatio 1 returns textLength', () => {
      expect(getHighlightedChars(0, undefined, 10, 1)).toBe(10);
    });
  });

  describe('boundaries', () => {
    it('textLength 0 returns 0', () => {
      expect(getHighlightedChars(0, undefined, 0, 0.5)).toBe(0);
    });
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

Run: `npm run test -- src/lib/playback/highlight.test.ts`
Expected: FAIL with import resolution error (`highlight` module not found).

- [ ] **Step 1.3: Create the implementation**

Create `src/lib/playback/highlight.ts`:

```ts
/**
 * Given per-sentence audio segments and the current playback time,
 * return the number of characters that should be highlighted.
 * Falls back to linear interpolation when segments are not available.
 *
 * Lifted from MainPanel.tsx:91-113; identical logic, no behavioural changes.
 */
export function getHighlightedChars(
  currentTime: number,
  segments: Array<{ textEnd: number; audioEnd: number }> | undefined,
  textLength: number,
  progressRatio: number,
): number {
  if (!segments || segments.length === 0) {
    return Math.floor(textLength * progressRatio);
  }

  let prevTextEnd = 0;
  let prevAudioEnd = 0;
  for (const seg of segments) {
    if (currentTime < seg.audioEnd) {
      const segDuration = seg.audioEnd - prevAudioEnd;
      const segProgress = segDuration > 0 ? (currentTime - prevAudioEnd) / segDuration : 1;
      return prevTextEnd + Math.floor((seg.textEnd - prevTextEnd) * segProgress);
    }
    prevTextEnd = seg.textEnd;
    prevAudioEnd = seg.audioEnd;
  }
  return prevTextEnd;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

Run: `npm run test -- src/lib/playback/highlight.test.ts`
Expected: PASS, all 9 test cases green.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/playback/highlight.ts src/lib/playback/highlight.test.ts
git commit -m "feat(playback): extract getHighlightedChars to pure module

Lifts the karaoke-highlight calculator from MainPanel.tsx to a
standalone testable module. Identical logic; behaviour unchanged.

Issue #232 prep."
```

---

## Task 2: `playbackStore` Skeleton + `setPlayingItem`

**Files:**
- Create: `src/stores/playbackStore.ts`
- Test: `src/stores/playbackStore.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `src/stores/playbackStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from './playbackStore';

function resetStore() {
  usePlaybackStore.setState({
    playingItemId: null,
    currentTime: null,
    progressRatio: 0,
    _cumOffset: 0,
    _lastBt: 0,
    _lastCt: 0,
    _maxProgress: 0,
    _raw: null,
  });
}

describe('playbackStore — setPlayingItem', () => {
  beforeEach(resetStore);

  it('starts with empty defaults', () => {
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
    expect(s.progressRatio).toBe(0);
  });

  it('setPlayingItem(id) writes id and zeros derived/trackers', () => {
    usePlaybackStore.setState({
      _cumOffset: 5,
      _lastBt: 2,
      _lastCt: 1,
      _maxProgress: 0.4,
    });
    usePlaybackStore.getState().setPlayingItem('item_a');
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(0);
    expect(s.progressRatio).toBe(0);
    expect(s._cumOffset).toBe(0);
    expect(s._lastBt).toBe(0);
    expect(s._lastCt).toBe(0);
    expect(s._maxProgress).toBe(0);
  });

  it('setPlayingItem(sameId) is a no-op (preserves trackers)', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.setState({ _maxProgress: 0.7, currentTime: 1.5 });
    usePlaybackStore.getState().setPlayingItem('item_a');
    const s = usePlaybackStore.getState();
    expect(s._maxProgress).toBe(0.7);
    expect(s.currentTime).toBe(1.5);
  });

  it('setPlayingItem(null) clears id; currentTime becomes null', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.setState({ currentTime: 1.2, _maxProgress: 0.3 });
    usePlaybackStore.getState().setPlayingItem(null);
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
    expect(s._maxProgress).toBe(0);
  });
});
```

- [ ] **Step 2.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Create the store with `setPlayingItem`**

Create `src/stores/playbackStore.ts`:

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface PlaybackPublic {
  playingItemId: string | null;
  currentTime: number | null;
  progressRatio: number;
}

interface PlaybackInternal {
  _cumOffset: number;
  _lastBt: number;
  _lastCt: number;
  _maxProgress: number;
  _raw: { currentTime: number; duration: number; bufferedTime: number } | null;
}

interface PlaybackActions {
  setPlayingItem: (id: string | null) => void;
  setProgress: (raw: { currentTime: number; duration: number; bufferedTime: number } | null) => void;
}

type PlaybackState = PlaybackPublic & PlaybackInternal & PlaybackActions;

const DEFAULTS: PlaybackPublic & PlaybackInternal = {
  playingItemId: null,
  currentTime: null,
  progressRatio: 0,
  _cumOffset: 0,
  _lastBt: 0,
  _lastCt: 0,
  _maxProgress: 0,
  _raw: null,
};

export const usePlaybackStore = create<PlaybackState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setPlayingItem(id) {
      if (get().playingItemId === id) return;
      set({
        playingItemId: id,
        currentTime: id === null ? null : 0,
        progressRatio: 0,
        _cumOffset: 0,
        _lastBt: 0,
        _lastCt: 0,
        _maxProgress: 0,
        _raw: null,
      });
    },

    setProgress(_raw) {
      // Implemented in Task 3.
    },
  })),
);
```

- [ ] **Step 2.4: Run tests to confirm they pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): add playbackStore skeleton with setPlayingItem

Zustand store with public state (playingItemId / currentTime /
progressRatio), internal trackers, and the item-change reset semantics
from MainPanel. setProgress is a stub; implemented in the next commit.

Issue #232."
```

---

## Task 3: `setProgress` — Happy Path (Cumulative + Monotonic)

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/playbackStore.test.ts`

- [ ] **Step 3.1: Add failing tests for happy-path progress**

Append to `src/stores/playbackStore.test.ts`:

```ts
describe('playbackStore — setProgress happy path', () => {
  beforeEach(resetStore);

  it('first non-null tick after setPlayingItem populates derived', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({
      currentTime: 1.0,
      duration: 5.0,
      bufferedTime: 4.0,
    });
    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(1.0);
    expect(s.progressRatio).toBeCloseTo(1.0 / 4.0, 5);
    expect(s._raw).toEqual({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
  });

  it('successive ticks advance derived monotonically', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 0.5, duration: 5.0, bufferedTime: 4.0 });
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
    const s = usePlaybackStore.getState();
    expect(s.currentTime).toBe(1.0);
    expect(s.progressRatio).toBeCloseTo(0.25, 5);
  });

  it('divisor falls back to duration when bufferedTime is 0', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 4.0, bufferedTime: 0 });
    const s = usePlaybackStore.getState();
    expect(s.progressRatio).toBeCloseTo(0.25, 5);
  });

  it('ratio clamps at 1.0 when currentTime exceeds bufferedTime', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 5.0, duration: 5.0, bufferedTime: 4.0 });
    const s = usePlaybackStore.getState();
    expect(s.progressRatio).toBe(1.0);
  });
});
```

- [ ] **Step 3.2: Run to verify they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL on the new `describe` block — `setProgress` is a stub.

- [ ] **Step 3.3: Implement the happy-path body of `setProgress`**

In `src/stores/playbackStore.ts`, add the constant near the top (outside the store factory):

```ts
const ENTRY_RESET_THRESHOLD = 0.05; // seconds; matches MainPanel
```

Replace the stub `setProgress` body with:

```ts
setProgress(raw) {
  const s = get();
  if (raw === null) {
    // Implemented in Task 5.
    return;
  }
  if (s.playingItemId === null) return;

  // Cumulative tracker (Task 4 adds eviction handling; here it just passes through).
  const offset = s._cumOffset;
  const cumCurrentTime = offset + raw.currentTime;
  const cumBufferedTime = offset + raw.bufferedTime;
  const cumDuration = offset + raw.duration;

  // Monotonic-clamped ratio.
  const divisor = cumBufferedTime || cumDuration || 1;
  const calculatedRatio = Math.min(cumCurrentTime / divisor, 1);
  const progressRatio = Math.max(calculatedRatio, s._maxProgress);

  set({
    currentTime: cumCurrentTime,
    progressRatio,
    _cumOffset: offset,
    _lastBt: raw.bufferedTime,
    _lastCt: raw.currentTime,
    _maxProgress: progressRatio,
    _raw: raw,
  });
},
```

- [ ] **Step 3.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, all happy-path + setPlayingItem cases (8 total).

- [ ] **Step 3.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): implement setProgress happy-path derivation

Cumulative time + monotonic-clamped ratio, mirroring MainPanel's
existing useMemo logic. Entry-eviction handling lands in the next
commit.

Issue #232."
```

---

## Task 4: `setProgress` — Entry Eviction Detection

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/playbackStore.test.ts`

- [ ] **Step 4.1: Add failing tests for entry eviction**

Append to `src/stores/playbackStore.test.ts`:

```ts
describe('playbackStore — setProgress entry eviction', () => {
  beforeEach(resetStore);

  it('regression > 50ms with _lastBt > 0 bumps _cumOffset by _lastBt', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    // Entry 1 fills up: ct=1.0, bt=2.0
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 2.0, bufferedTime: 2.0 });
    // Entry 1 evicted; new entry: ct regresses to 0.1 (1.0 - 0.9 > 0.05)
    usePlaybackStore.getState().setProgress({ currentTime: 0.1, duration: 1.0, bufferedTime: 1.0 });
    const s = usePlaybackStore.getState();
    expect(s._cumOffset).toBe(2.0); // accumulated entry-1 bufferedTime
    expect(s.currentTime).toBe(2.1); // offset + new ct
  });

  it('regression <= 50ms does NOT bump offset', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 2.0, bufferedTime: 2.0 });
    // ct goes back 30ms — within threshold; treated as same entry jitter
    usePlaybackStore.getState().setProgress({ currentTime: 0.97, duration: 2.0, bufferedTime: 2.0 });
    expect(usePlaybackStore.getState()._cumOffset).toBe(0);
  });

  it('regression with _lastBt == 0 does NOT bump offset', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 2.0, bufferedTime: 0 });
    usePlaybackStore.getState().setProgress({ currentTime: 0.1, duration: 1.0, bufferedTime: 1.0 });
    expect(usePlaybackStore.getState()._cumOffset).toBe(0);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL on the eviction `describe` block.

- [ ] **Step 4.3: Patch the cumulative-tracker logic in `setProgress`**

In `src/stores/playbackStore.ts`, replace the line `const offset = s._cumOffset;` with:

```ts
let offset = s._cumOffset;
if (
  raw.currentTime < s._lastCt - ENTRY_RESET_THRESHOLD &&
  s._lastBt > 0
) {
  offset += s._lastBt;
}
```

- [ ] **Step 4.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 4.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): detect player-entry eviction in setProgress

When currentTime regresses by more than ENTRY_RESET_THRESHOLD (50ms)
and the last entry had non-zero bufferedTime, accumulate _lastBt into
_cumOffset so the highlight stays continuous across chunk boundaries.

Issue #232."
```

---

## Task 5: `setProgress(null)` — Preserve Derived, Null `_raw`

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/playbackStore.test.ts`

- [ ] **Step 5.1: Add failing tests**

Append to `src/stores/playbackStore.test.ts`:

```ts
describe('playbackStore — setProgress(null)', () => {
  beforeEach(resetStore);

  it('preserves currentTime, progressRatio, and trackers; flips _raw to null', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
    const before = usePlaybackStore.getState();
    const beforeSnap = {
      currentTime: before.currentTime,
      progressRatio: before.progressRatio,
      _cumOffset: before._cumOffset,
      _lastBt: before._lastBt,
      _lastCt: before._lastCt,
      _maxProgress: before._maxProgress,
    };
    usePlaybackStore.getState().setProgress(null);
    const after = usePlaybackStore.getState();
    expect(after.currentTime).toBe(beforeSnap.currentTime);
    expect(after.progressRatio).toBe(beforeSnap.progressRatio);
    expect(after._cumOffset).toBe(beforeSnap._cumOffset);
    expect(after._lastBt).toBe(beforeSnap._lastBt);
    expect(after._lastCt).toBe(beforeSnap._lastCt);
    expect(after._maxProgress).toBe(beforeSnap._maxProgress);
    expect(after._raw).toBeNull();
  });

  it('setProgress(null) when no item is playing is a no-op', () => {
    usePlaybackStore.getState().setProgress(null);
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL — current stub returns early without writing `_raw = null`.

- [ ] **Step 5.3: Implement `setProgress(null)`**

In `src/stores/playbackStore.ts`, replace the `if (raw === null) { ... return; }` block with:

```ts
if (raw === null) {
  // Preserve all derived trackers; only flip _raw to null so the port
  // surface observes the pause transition. Avoids segment-based-provider
  // chunk-gap flicker that currently affects MainPanel (improvement
  // documented in the design spec).
  if (s._raw !== null) {
    set({ _raw: null });
  }
  return;
}
```

- [ ] **Step 5.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, all 13 tests green.

- [ ] **Step 5.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): setProgress(null) preserves derived, nulls _raw

Holds the last derived currentTime/progressRatio during chunk gaps so
segment-based providers don't flicker the highlight back to 0. _raw
flip-to-null gives the port surface an explicit pause edge to forward.

Issue #232."
```

---

## Task 6: Wire Helpers — `encodePlaybackForWire` + `rawEqual`

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/playbackStore.test.ts`

- [ ] **Step 6.1: Add failing tests**

Append to `src/stores/playbackStore.test.ts`:

```ts
import { __internal__ } from './playbackStore';

describe('playbackStore wire helpers', () => {
  const { encodePlaybackForWire, rawEqual } = __internal__;

  describe('encodePlaybackForWire', () => {
    it('returns { i: null } when no item is playing', () => {
      expect(encodePlaybackForWire({ playingItemId: null, _raw: null })).toEqual({ i: null });
    });

    it('returns { i, c: null } when item is set but _raw is null (paused)', () => {
      expect(
        encodePlaybackForWire({ playingItemId: 'item_a', _raw: null }),
      ).toEqual({ i: 'item_a', c: null });
    });

    it('returns full shape and rounds c/d/b to 3 decimals', () => {
      expect(
        encodePlaybackForWire({
          playingItemId: 'item_a',
          _raw: { currentTime: 1.2345678, duration: 5.6789012, bufferedTime: 6.7890123 },
        }),
      ).toEqual({ i: 'item_a', c: 1.235, d: 5.679, b: 6.789 });
    });
  });

  describe('rawEqual', () => {
    it('returns true when both are null', () => {
      expect(rawEqual(null, null)).toBe(true);
    });

    it('returns false when one side is null', () => {
      expect(rawEqual(null, { currentTime: 0, duration: 0, bufferedTime: 0 })).toBe(false);
      expect(rawEqual({ currentTime: 0, duration: 0, bufferedTime: 0 }, null)).toBe(false);
    });

    it('returns true when fields differ only beyond 3 decimals', () => {
      expect(
        rawEqual(
          { currentTime: 1.2345, duration: 2.3455, bufferedTime: 3.4566 },
          { currentTime: 1.2347, duration: 2.3459, bufferedTime: 3.4561 },
        ),
      ).toBe(true);
    });

    it('returns false when fields differ within 3 decimals', () => {
      expect(
        rawEqual(
          { currentTime: 1.234, duration: 2.345, bufferedTime: 3.456 },
          { currentTime: 1.235, duration: 2.345, bufferedTime: 3.456 },
        ),
      ).toBe(false);
    });
  });
});
```

- [ ] **Step 6.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL — `__internal__` export missing.

- [ ] **Step 6.3: Implement and export the helpers**

In `src/stores/playbackStore.ts`, add at the bottom (after the `usePlaybackStore` definition):

```ts
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type RawProgress = { currentTime: number; duration: number; bufferedTime: number };

function encodePlaybackForWire(s: {
  playingItemId: string | null;
  _raw: RawProgress | null;
}): { i: string | null; c?: number | null; d?: number; b?: number } {
  if (s.playingItemId === null) return { i: null };
  if (s._raw === null) return { i: s.playingItemId, c: null };
  return {
    i: s.playingItemId,
    c: r3(s._raw.currentTime),
    d: r3(s._raw.duration),
    b: r3(s._raw.bufferedTime),
  };
}

function rawEqual(a: RawProgress | null, b: RawProgress | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    r3(a.currentTime) === r3(b.currentTime) &&
    r3(a.duration) === r3(b.duration) &&
    r3(a.bufferedTime) === r3(b.bufferedTime)
  );
}

/** Internal exports for unit tests only. Do not consume from app code. */
export const __internal__ = { encodePlaybackForWire, rawEqual };
```

- [ ] **Step 6.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, all 20 tests green.

- [ ] **Step 6.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): wire helpers (encodePlaybackForWire, rawEqual)

Compact wire format for chrome.runtime.Port forwarding: short keys
(i/c/d/b), 3-decimal precision. Helpers are module-private with
__internal__ test export.

Issue #232."
```

---

## Task 7: `getRawSnapshot` + `subscribePlaybackForPort`

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/playbackStore.test.ts`

- [ ] **Step 7.1: Add failing tests**

Append to `src/stores/playbackStore.test.ts`:

```ts
import { getRawSnapshot, subscribePlaybackForPort } from './playbackStore';

describe('getRawSnapshot', () => {
  beforeEach(resetStore);

  it('returns null when no progress has been written', () => {
    expect(getRawSnapshot()).toBeNull();
  });

  it('returns the latest raw input', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.234, duration: 5, bufferedTime: 4 });
    expect(getRawSnapshot()).toEqual({ currentTime: 1.234, duration: 5, bufferedTime: 4 });
  });
});

describe('subscribePlaybackForPort', () => {
  beforeEach(resetStore);

  it('fires callback when playingItemId changes', () => {
    const calls: any[] = [];
    const unsub = subscribePlaybackForPort((encoded) => calls.push(encoded));
    usePlaybackStore.getState().setPlayingItem('item_a');
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ i: 'item_a', c: null });
    unsub();
  });

  it('fires callback when _raw changes (compared by rounded values)', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    const calls: any[] = [];
    const unsub = subscribePlaybackForPort((encoded) => calls.push(encoded));
    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 5, bufferedTime: 4 });
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ i: 'item_a', c: 1.0, d: 5, b: 4 });
    unsub();
  });

  it('does NOT fire callback when round-equal raw is re-written', () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.2345, duration: 5, bufferedTime: 4 });
    const calls: any[] = [];
    const unsub = subscribePlaybackForPort((encoded) => calls.push(encoded));
    usePlaybackStore.getState().setProgress({ currentTime: 1.2347, duration: 5, bufferedTime: 4 });
    expect(calls.length).toBe(0);
    unsub();
  });

  it('unsub() detaches the listener', () => {
    const calls: any[] = [];
    const unsub = subscribePlaybackForPort((encoded) => calls.push(encoded));
    unsub();
    usePlaybackStore.getState().setPlayingItem('item_a');
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 7.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 7.3: Implement `getRawSnapshot` and `subscribePlaybackForPort`**

In `src/stores/playbackStore.ts`, add after the `__internal__` export:

```ts
export function getRawSnapshot(): RawProgress | null {
  return usePlaybackStore.getState()._raw;
}

export type PlaybackWire = { i: string | null; c?: number | null; d?: number; b?: number };

export function subscribePlaybackForPort(callback: (encoded: PlaybackWire) => void): () => void {
  return usePlaybackStore.subscribe(
    (s) => ({ playingItemId: s.playingItemId, _raw: s._raw }),
    (next) => callback(encodePlaybackForWire(next)),
    {
      equalityFn: (a, b) =>
        a.playingItemId === b.playingItemId && rawEqual(a._raw, b._raw),
    },
  );
}
```

- [ ] **Step 7.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.test.ts`
Expected: PASS, all 26 tests green.

- [ ] **Step 7.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(playback): getRawSnapshot + subscribePlaybackForPort

Exposes the playback signal to the extension content-script surface
without leaking internal state shape: snapshot helper for initial
state-init push, subscribe helper that wraps zustand subscribe with the
wire-encoding and per-field dedup.

Issue #232."
```

---

## Task 8: `usePlaybackHighlight` Hook

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Create: `src/stores/playbackStore.usePlaybackHighlight.test.tsx`

- [ ] **Step 8.1: Write the failing hook tests**

Create `src/stores/playbackStore.usePlaybackHighlight.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useRef } from 'react';
import { usePlaybackStore, usePlaybackHighlight } from './playbackStore';

function resetStore() {
  usePlaybackStore.setState({
    playingItemId: null,
    currentTime: null,
    progressRatio: 0,
    _cumOffset: 0,
    _lastBt: 0,
    _lastCt: 0,
    _maxProgress: 0,
    _raw: null,
  });
}

function Probe({ item }: { item: any }) {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  const renders = useRef(0);
  renders.current += 1;
  return (
    <div>
      <span data-testid="playing">{String(isPlaying)}</span>
      <span data-testid="chars">{highlightedChars}</span>
      <span data-testid="renders">{renders.current}</span>
    </div>
  );
}

describe('usePlaybackHighlight', () => {
  beforeEach(resetStore);

  it('returns isPlaying=false / 0 when item is null', () => {
    render(<Probe item={null} />);
    expect(screen.getByTestId('playing').textContent).toBe('false');
    expect(screen.getByTestId('chars').textContent).toBe('0');
  });

  it('returns isPlaying=true with linear fallback when no audioSegments', () => {
    const item = { id: 'item_a', formatted: { text: 'Hello world' } };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ progressRatio: 0.5, currentTime: 2.0 });
    });
    render(<Probe item={item} />);
    expect(screen.getByTestId('playing').textContent).toBe('true');
    expect(screen.getByTestId('chars').textContent).toBe('5'); // floor(11 * 0.5)
  });

  it('uses audioSegments when present', () => {
    const item = {
      id: 'item_a',
      formatted: {
        transcript: 'Hello world',
        audioSegments: [
          { textEnd: 5, audioEnd: 1.0 },
          { textEnd: 11, audioEnd: 2.0 },
        ],
      },
    };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.setState({ currentTime: 1.5, progressRatio: 0 });
    });
    render(<Probe item={item} />);
    // 1.5s → 0.5/1.0 through seg 2 (textEnd 11, prev 5, width 6) → 5 + 3 = 8
    expect(screen.getByTestId('chars').textContent).toBe('8');
  });

  it('non-playing item does not re-render on currentTime tick', () => {
    const itemA = { id: 'item_a', formatted: { text: 'A' } };
    act(() => {
      usePlaybackStore.getState().setPlayingItem('item_b');
      usePlaybackStore.setState({ currentTime: 1.0, progressRatio: 0.1 });
    });
    render(<Probe item={itemA} />);
    const initialRenders = Number(screen.getByTestId('renders').textContent);

    act(() => {
      usePlaybackStore.setState({ currentTime: 1.1, progressRatio: 0.2 });
    });
    act(() => {
      usePlaybackStore.setState({ currentTime: 1.2, progressRatio: 0.3 });
    });

    const finalRenders = Number(screen.getByTestId('renders').textContent);
    expect(finalRenders).toBe(initialRenders);
  });
});
```

- [ ] **Step 8.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/playbackStore.usePlaybackHighlight.test.tsx`
Expected: FAIL — `usePlaybackHighlight` not exported.

- [ ] **Step 8.3: Implement the hook**

In `src/stores/playbackStore.ts`, add at the top with the other imports:

```ts
import { useShallow } from 'zustand/shallow';
import { getHighlightedChars } from '../lib/playback/highlight';
```

Add at the bottom of the file:

```ts
export interface PlaybackHighlight {
  isPlaying: boolean;
  highlightedChars: number;
}

const EMPTY_HIGHLIGHT: PlaybackHighlight = { isPlaying: false, highlightedChars: 0 };

export function usePlaybackHighlight(
  item:
    | {
        id: string;
        formatted?: {
          transcript?: string;
          text?: string;
          audioSegments?: Array<{ textEnd: number; audioEnd: number }>;
        };
      }
    | null
    | undefined,
): PlaybackHighlight {
  return usePlaybackStore(
    useShallow((s): PlaybackHighlight => {
      if (!item || s.playingItemId !== item.id) return EMPTY_HIGHLIGHT;
      const text = item.formatted?.transcript || item.formatted?.text || '';
      const segments = item.formatted?.audioSegments;
      return {
        isPlaying: true,
        highlightedChars: getHighlightedChars(
          s.currentTime ?? 0,
          segments,
          text.length,
          s.progressRatio,
        ),
      };
    }),
  );
}
```

- [ ] **Step 8.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/playbackStore.usePlaybackHighlight.test.tsx`
Expected: PASS, all 4 tests green.

- [ ] **Step 8.5: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/playbackStore.usePlaybackHighlight.test.tsx
git commit -m "feat(playback): usePlaybackHighlight(item) hook

Single hook consumed by MainPanel and SubtitleStream. Returns the
EMPTY_HIGHLIGHT sentinel for non-playing rows so useShallow bails out
of the 10Hz tick storm; only the active row re-renders per tick.

Issue #232."
```

---

## Task 9: `karaoke.scss` Shared Class + Rename in `ConversationRow`

**Files:**
- Create: `src/styles/karaoke.scss`
- Modify: `src/components/MainPanel/ConversationRow.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss`
- Modify: `src/components/MainPanel/MainPanel.tsx` (import only)
- Modify: `src/components/Subtitle/SubtitleStream.tsx` (import only)

- [ ] **Step 9.1: Create the shared stylesheet**

Create `src/styles/karaoke.scss`:

```scss
.karaoke-played {
  color: var(--karaoke-played-color, #10a37f);
  transition: color 80ms ease-out;
}
```

- [ ] **Step 9.2: Rename the class in `ConversationRow.tsx`**

In `src/components/MainPanel/ConversationRow.tsx`, line 88, replace:

```tsx
        <span className="row-text-played">{text.slice(0, highlightedChars)}</span>
```

with:

```tsx
        <span className="karaoke-played">{text.slice(0, highlightedChars)}</span>
```

Add at the top of the file (after the existing `import './ConversationRow.scss';` line):

```tsx
import '../../styles/karaoke.scss';
```

- [ ] **Step 9.3: Add the import to `MainPanel.tsx`**

In `src/components/MainPanel/MainPanel.tsx`, add near the other style imports:

```tsx
import '../../styles/karaoke.scss';
```

- [ ] **Step 9.4: Add the import to `SubtitleStream.tsx`**

In `src/components/Subtitle/SubtitleStream.tsx`, add after the `import './SubtitleStream.scss';` line:

```tsx
import '../../styles/karaoke.scss';
```

- [ ] **Step 9.5: Delete the old rule from `MainPanel.scss`**

Open `src/components/MainPanel/MainPanel.scss`, find the `.row-text-played` rule on or near line 240, and delete the entire block. (If the rule is nested inside another selector, delete just the inner `.row-text-played { ... }` block.)

- [ ] **Step 9.6: Verify nothing else references `row-text-played`**

Run: `git grep "row-text-played" -- ':!docs/'`
Expected: empty output.

- [ ] **Step 9.7: Run the full test suite**

Run: `npm run test`
Expected: PASS — no behavioural change, only a CSS class rename + style file move. (`SubtitleStream.test.tsx` may still pass against the unmodified hard-coded zeros at this point; that's fine.)

- [ ] **Step 9.8: Commit**

```bash
git add src/styles/karaoke.scss \
        src/components/MainPanel/ConversationRow.tsx \
        src/components/MainPanel/MainPanel.tsx \
        src/components/MainPanel/MainPanel.scss \
        src/components/Subtitle/SubtitleStream.tsx
git commit -m "refactor(subtitle): extract karaoke-played to shared stylesheet

Renames row-text-played -> karaoke-played and moves the rule to
src/styles/karaoke.scss so it's available to SubtitleStream too. No
behaviour change.

Issue #232 prep."
```

---

## Task 10: Extract `ConversationBubble` From `MainPanel.tsx`

This task is pure refactor: behaviour is preserved by threading the existing local `playingItemId` / `playbackProgress` values through props. Task 11 will switch those props to the store hook.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 10.1: Read the current `renderConversationItem` body**

Read `src/components/MainPanel/MainPanel.tsx` lines 2820–2920 (or whichever range covers the helper). Identify every prop it uses from the enclosing closure (`item`, `index`, `playingItemId`, `cumulativeProgress`, `playbackProgress`, `progressRatio`, language, callbacks, `uiMode`, etc.).

- [ ] **Step 10.2: Define the `ConversationBubble` component**

At an appropriate location in `MainPanel.tsx` (just above the `MainPanel` component definition, or in a new co-located block), add:

```tsx
interface ConversationBubbleProps {
  item: ConversationItem & { source?: string };
  index: number;
  prevItem: (ConversationItem & { source?: string }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  isPlaying: boolean;
  highlightedChars: number;
  canPlay: boolean;
  onPlay?: () => void;
  playDisabled: boolean;
  uiMode: string;
  // ... any other props the original helper consumed
}

const ConversationBubble: React.FC<ConversationBubbleProps> = (props) => {
  // Move the entire body of renderConversationItem here, reading from
  // props instead of from the MainPanel closure.
};
```

Move the body of the existing `renderConversationItem` function into `ConversationBubble`, replacing closure reads with prop reads. The Karaoke calculation (`highlightedChars = ...`) still uses the local closure values for now — they will be replaced by the hook in Task 11.

- [ ] **Step 10.3: Update the render site**

Where `MainPanel` currently calls `filteredItems.map(renderConversationItem)`, replace with:

```tsx
filteredItems.map((item, i) => {
  const prevItem = (() => {
    // … keep the existing prevItem lookup logic
  })();
  const text = item.formatted?.transcript || item.formatted?.text || '';
  const isItemPlaying = playingItemId === item.id;
  const highlightedChars = isItemPlaying
    ? getHighlightedChars(
        cumulativeProgress?.currentTime ?? playbackProgress?.currentTime ?? 0,
        item.formatted?.audioSegments,
        text.length,
        progressRatio,
      )
    : 0;
  return (
    <ConversationBubble
      key={`${(item as any).source || 'speaker'}_${item.id || i}`}
      item={item}
      index={i}
      prevItem={prevItem}
      sourceLanguage={sourceLanguage}
      targetLanguage={targetLanguage}
      isPlaying={isItemPlaying}
      highlightedChars={highlightedChars}
      canPlay={/* existing canPlay logic */}
      onPlay={/* existing onPlay handler */}
      playDisabled={playingItemId !== null && !isItemPlaying}
      uiMode={uiMode}
      // … any other props
    />
  );
})
```

Keep the imports of `getHighlightedChars` from `../../lib/playback/highlight` (or from MainPanel-local if you haven't deleted it yet). Delete the inline definition at MainPanel.tsx:91-113 if it still exists — replace with `import { getHighlightedChars } from '../../lib/playback/highlight';`.

- [ ] **Step 10.4: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: no new errors. If new errors point at missing props on `ConversationBubble`, add them to the interface + thread through.

- [ ] **Step 10.5: Run the full test suite**

Run: `npm run test`
Expected: PASS — refactor preserves behaviour.

- [ ] **Step 10.6: Manual smoke test (optional but recommended)**

Run: `npm run electron:dev`. Start a brief session; confirm assistant message still shows karaoke highlight in MainPanel.

- [ ] **Step 10.7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(main-panel): extract ConversationBubble subcomponent

Pulls the row-rendering helper out of MainPanel.renderConversationItem
into a real component so we can call hooks per row. Behaviour
unchanged; getHighlightedChars now imported from the shared module.

Issue #232 prep."
```

---

## Task 11: Wire `MainPanel` to `playbackStore`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 11.1: Switch audio callbacks and progress poll to store actions**

In `src/components/MainPanel/MainPanel.tsx`, near the top of the component body (after other store hooks), add:

```tsx
import {
  usePlaybackStore,
  usePlaybackHighlight,
} from '../../stores/playbackStore';

// inside the component:
const setPlayingItem = usePlaybackStore((s) => s.setPlayingItem);
const setProgress = usePlaybackStore((s) => s.setProgress);
```

Find every `setPlayingItemId(...)` call in MainPanel (audio status callback around L2188-2229) and replace with `setPlayingItem(...)`. Find every `setPlaybackProgress(...)` call (progress interval around L2232-2245) and replace with `setProgress(...)`.

Example, in the progress interval body:

```tsx
const progressInterval = setInterval(() => {
  const status = player.getCurrentPlaybackStatus();
  if (status && status.isPlaying) {
    setProgress({
      currentTime: status.currentTime,
      duration: status.duration,
      bufferedTime: status.bufferedTime,
    });
  } else {
    setProgress(null);
  }
}, PROGRESS_UPDATE_INTERVAL);
```

The `ITEM_END_DEBOUNCE_MS` debounce that wraps `setPlayingItemId(null) + setPlaybackProgress(null)` becomes `setPlayingItem(null) + setProgress(null)` — keep the timer logic.

- [ ] **Step 11.2: Delete the obsolete local state and derivations**

Delete (in `src/components/MainPanel/MainPanel.tsx`):

- The two `useState` declarations near L254–259:
  ```tsx
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<...>(null);
  ```
- The `cumulativeAudioRef` declaration and the `lastMaxProgressRef` declaration (~L775).
- The `cumulativeProgress` `useMemo` block (L2099–2131).
- The `progressRatio` `useMemo` block (L2141–2154).
- The two `useEffect`s — "Reset max progress and cumulative tracker when playing a new item" (L2163–2166) and "Update max progress ref after calculation" (L2171–2176).
- The inline `function getHighlightedChars(...)` at L91–113 if it still exists. (Step 10.3 should already have replaced its usage with the import.)

If any remaining code still references `playingItemId` or `playbackProgress` as locals, replace them with selectors from the store:

```tsx
const playingItemId = usePlaybackStore((s) => s.playingItemId);
```

(Some callsites — like the test-tone effect or the `playDisabled` calculation — may need this.)

- [ ] **Step 11.3: Update `ConversationBubble` callsite to use the hook**

In the render block introduced in Step 10.3, replace the manual `isItemPlaying` / `highlightedChars` calculation with the hook. The simplest way: move the hook call into `ConversationBubble` itself so we don't compute it twice. Inside `ConversationBubble`:

```tsx
const ConversationBubble: React.FC<ConversationBubbleProps> = (props) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(props.item);
  // ... use isPlaying / highlightedChars in the body
};
```

Remove `isPlaying` and `highlightedChars` from `ConversationBubbleProps`, and remove the corresponding props from the caller in `MainPanel`. The `playDisabled` prop still needs to know whether *some other* item is playing — pass `someItemPlaying = playingItemId !== null` instead, or read it from the store inside `ConversationBubble`. Simplest: keep a `someItemPlaying` boolean prop:

```tsx
// In MainPanel render:
const playingItemId = usePlaybackStore((s) => s.playingItemId);
// ...
<ConversationBubble
  /* ... */
  someItemPlaying={playingItemId !== null}
/>

// In ConversationBubble:
const playDisabled = props.someItemPlaying && !isPlaying;
```

- [ ] **Step 11.4: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11.5: Run the full test suite**

Run: `npm run test`
Expected: PASS. Existing MainPanel-related tests (if any) should still pass; they don't depend on the deleted internals.

- [ ] **Step 11.6: Manual smoke test**

Run: `npm run electron:dev`. Start a session, generate an assistant message, verify karaoke highlight tracks playback as before. Specifically watch for chunk-gap behaviour — segment-based providers should no longer flicker to char 0 between chunks (improvement).

- [ ] **Step 11.7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(main-panel): consume playbackStore via usePlaybackHighlight

Removes the local useState/useMemo/useEffect machinery that owned
playingItemId, playbackProgress, cumulativeProgress, progressRatio,
and the monotonic-clamp ref. MainPanel now writes to playbackStore
and reads via usePlaybackHighlight, identical to SubtitleStream.

Side benefit: segment-based providers no longer flicker the highlight
to char 0 during chunk gaps (setProgress(null) preserves derived).

Issue #232."
```

---

## Task 12: `SubtitleStream` — Expanded Mode Highlight

**Files:**
- Modify: `src/components/Subtitle/SubtitleStream.tsx`

- [ ] **Step 12.1: Add an `itemsById` memo and a `SubtitleConversationRow` wrapper**

In `src/components/Subtitle/SubtitleStream.tsx`, add at the top of the `SubtitleStream` component (after the `filtered` and `lines` memos):

```tsx
const itemsById = useMemo(
  () => new Map<string, any>(items.map((it) => [it.id, it])),
  [items],
);
```

Add at the top of the file with the other imports:

```tsx
import { usePlaybackHighlight } from '../../stores/playbackStore';
```

At the bottom of the file (below the `SubtitleStream` component, above `export default`):

```tsx
const SubtitleConversationRow: React.FC<{
  item: any;
  prevItem: any;
  sourceLanguage: string;
  targetLanguage: string;
}> = ({ item, prevItem, sourceLanguage, targetLanguage }) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  return (
    <ConversationRow
      item={item}
      prevItem={prevItem}
      compact={false}
      sourceLanguage={sourceLanguage}
      targetLanguage={targetLanguage}
      isPlaying={isPlaying}
      highlightedChars={highlightedChars}
      canPlay={false}
    />
  );
};
```

- [ ] **Step 12.2: Replace the expanded-mode mapping**

In the JSX returned by `SubtitleStream`, replace the existing expanded-mode block:

```tsx
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

with:

```tsx
: filtered.map((item, i) => (
    <SubtitleConversationRow
      key={item.id}
      item={item}
      prevItem={filtered[i - 1] ?? null}
      sourceLanguage={sourceLanguage}
      targetLanguage={targetLanguage}
    />
  ))}
```

- [ ] **Step 12.3: Run the existing test suite**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: existing expanded-mode test cases that asserted `isPlaying={false}` / `highlightedChars={0}` may FAIL. That's expected — they reflected the bug we're fixing.

- [ ] **Step 12.4: Update / rewrite the affected existing test cases**

Open `src/components/Subtitle/SubtitleStream.test.tsx`. Find any test that asserts `isPlaying === false` or `highlightedChars === 0` for an expanded-mode ConversationRow. Replace those assertions with:

- "When playbackStore has no playing item, expanded rows receive `isPlaying=false` and `highlightedChars=0`" — mock the store before render via `usePlaybackStore.setState({ playingItemId: null, currentTime: null, progressRatio: 0 })`. Assert the same thing as before.

(If no existing tests assert this specifically, no update needed — only the new test cases below.)

- [ ] **Step 12.5: Add a new expanded-mode test**

Append to `src/components/Subtitle/SubtitleStream.test.tsx`:

```tsx
import { usePlaybackStore } from '../../stores/playbackStore';

describe('SubtitleStream — expanded karaoke highlight', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      playingItemId: null,
      currentTime: null,
      progressRatio: 0,
      _cumOffset: 0,
      _lastBt: 0,
      _lastCt: 0,
      _maxProgress: 0,
      _raw: null,
    });
  });

  it('renders karaoke split on the playing assistant item', () => {
    const items = [
      {
        id: 'item_a',
        role: 'assistant',
        type: 'message',
        formatted: { transcript: 'Hello world' },
      },
    ];
    act(() => {
      usePlaybackStore.setState({
        playingItemId: 'item_a',
        currentTime: 0,
        progressRatio: 0.5,
      });
    });
    const { container } = render(
      <SubtitleStream
        items={items as any}
        compact={false}
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    // floor(11 * 0.5) = 5 → "Hello"
    const played = container.querySelector('.karaoke-played');
    expect(played?.textContent).toBe('Hello');
  });
});
```

Add the required imports at the top of the test file: `act` from `@testing-library/react`. (`render`, `screen` are likely already there.)

- [ ] **Step 12.6: Run the test file**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: PASS.

- [ ] **Step 12.7: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.tsx \
        src/components/Subtitle/SubtitleStream.test.tsx
git commit -m "feat(subtitle): wire expanded-mode ConversationRow to playbackStore

SubtitleConversationRow wrapper calls usePlaybackHighlight(item) and
forwards the result to ConversationRow's existing karaoke props. The
hard-coded isPlaying=false / highlightedChars=0 are gone.

Issue #232 — phase 1 (Electron path)."
```

---

## Task 13: `SubtitleStream` — Compact Mode `CompactSpan`

**Files:**
- Modify: `src/components/Subtitle/SubtitleStream.tsx`
- Modify: `src/components/Subtitle/SubtitleStream.test.tsx`

- [ ] **Step 13.1: Add the failing test for compact karaoke**

Append to `src/components/Subtitle/SubtitleStream.test.tsx`:

```tsx
describe('SubtitleStream — compact karaoke highlight', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      playingItemId: null,
      currentTime: null,
      progressRatio: 0,
      _cumOffset: 0,
      _lastBt: 0,
      _lastCt: 0,
      _maxProgress: 0,
      _raw: null,
    });
  });

  it('compact band splits the playing assistant item into played/unplayed spans', () => {
    const items = [
      {
        id: 'item_a',
        role: 'assistant',
        type: 'message',
        source: 'speaker',
        formatted: { transcript: 'Hello world' },
      },
    ];
    act(() => {
      usePlaybackStore.setState({
        playingItemId: 'item_a',
        currentTime: 0,
        progressRatio: 0.5,
      });
    });
    const { container } = render(
      <SubtitleStream
        items={items as any}
        compact={true}
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    const played = container.querySelector('.karaoke-played');
    expect(played?.textContent).toBe('Hello');
  });

  it('compact band does not split spans for non-playing items', () => {
    const items = [
      {
        id: 'item_a',
        role: 'assistant',
        type: 'message',
        source: 'speaker',
        formatted: { transcript: 'Hello world' },
      },
    ];
    // playingItemId is null in the beforeEach reset
    const { container } = render(
      <SubtitleStream
        items={items as any}
        compact={true}
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    expect(container.querySelector('.karaoke-played')).toBeNull();
  });

  it('compact band renders plain text when item is missing from items[]', () => {
    // line bucket has an id that isn't in items (rare timing race)
    const items: any[] = [];
    act(() => {
      usePlaybackStore.setState({
        playingItemId: 'item_a',
        currentTime: 0,
        progressRatio: 0.5,
      });
    });
    // We can't simulate "in lines but not in items" directly without
    // restructuring the test; assert at minimum that an empty items
    // array doesn't crash and renders no .karaoke-played.
    const { container } = render(
      <SubtitleStream
        items={items as any}
        compact={true}
        fontSize={24}
        speakerMode="both"
        participantMode="both"
        sourceLanguage="en"
        targetLanguage="zh"
      />,
    );
    expect(container.querySelector('.karaoke-played')).toBeNull();
  });
});
```

- [ ] **Step 13.2: Run to confirm the compact karaoke test fails**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: FAIL on the new compact test cases — current compact branch hardcodes plain text.

- [ ] **Step 13.3: Add the `CompactSpan` subcomponent**

In `src/components/Subtitle/SubtitleStream.tsx`, add at the bottom of the file (above or below `SubtitleConversationRow`):

```tsx
interface CompactSpanProps {
  it: SubtitleLineItem;
  item: any | undefined;
  showNewHighlight: boolean;
  leadingSpace: boolean;
}

const CompactSpan: React.FC<CompactSpanProps> = ({
  it,
  item,
  showNewHighlight,
  leadingSpace,
}) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  const baseClass = showNewHighlight
    ? 'subtitle-stream__item subtitle-stream__item--new'
    : 'subtitle-stream__item';
  const prefix = leadingSpace ? ' ' : '';

  if (!isPlaying || highlightedChars <= 0 || highlightedChars >= it.text.length) {
    return <span className={baseClass}>{prefix}{it.text}</span>;
  }
  return (
    <span className={baseClass}>
      {prefix}
      <span className="karaoke-played">{it.text.slice(0, highlightedChars)}</span>
      <span>{it.text.slice(highlightedChars)}</span>
    </span>
  );
};
```

- [ ] **Step 13.4: Replace the inline compact-mode `<span>` mapping**

In the compact branch inside the `SubtitleStream` return JSX, replace:

```tsx
<p>
  {line.items.map((it, idx) => {
    const showHighlight =
      newItemHighlightEnabled && itemStateFor(it.id) === 'new';
    const className = showHighlight
      ? 'subtitle-stream__item subtitle-stream__item--new'
      : 'subtitle-stream__item';
    return (
      <span key={it.id} className={className}>
        {idx > 0 ? ' ' : ''}{it.text}
      </span>
    );
  })}
</p>
```

with:

```tsx
<p>
  {line.items.map((it, idx) => (
    <CompactSpan
      key={it.id}
      it={it}
      item={itemsById.get(it.id)}
      showNewHighlight={newItemHighlightEnabled && itemStateFor(it.id) === 'new'}
      leadingSpace={idx > 0}
    />
  ))}
</p>
```

- [ ] **Step 13.5: Run the tests to confirm pass**

Run: `npm run test -- src/components/Subtitle/SubtitleStream.test.tsx`
Expected: PASS, all new compact tests green; existing tests still green.

- [ ] **Step 13.6: Manual smoke test (Electron)**

Run: `npm run electron:dev`. Start a session. Open the subtitle window. Confirm:
- Compact band shows assistant translation;
- During playback, the currently-playing item shows a colour change advancing character by character;
- Non-playing items in the same band remain plain.

- [ ] **Step 13.7: Commit**

```bash
git add src/components/Subtitle/SubtitleStream.tsx \
        src/components/Subtitle/SubtitleStream.test.tsx
git commit -m "feat(subtitle): karaoke split in compact band via CompactSpan

CompactSpan calls usePlaybackHighlight per item; only the actively-
playing span re-renders per tick (useShallow + EMPTY_HIGHLIGHT bailout).
Leading space stays on the outer span to keep playback-induced colour
changes off whitespace.

Issue #232 — phase 1 (Electron path) complete."
```

---

## Task 14: Extension Surface — Forward Playback Over the Port

**Files:**
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`

- [ ] **Step 14.1: Add failing tests for the new playback forwarding**

Append to `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts` (uses the existing `listeners` + `makePort` pattern from the "port reconnect does not leak" test in the same file):

```ts
import { usePlaybackStore } from '../../../stores/playbackStore';

describe('ExtensionContentScriptSubtitleSurface — playback forwarding', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      playingItemId: null,
      currentTime: null,
      progressRatio: 0,
      _cumOffset: 0,
      _lastBt: 0,
      _lastCt: 0,
      _maxProgress: 0,
      _raw: null,
    });
  });

  const makePort = () => ({
    name: 'sokuji-subtitle',
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  });

  it('state-init carries playback=null when nothing is playing', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    const port = makePort();
    listeners.onConnect[0](port);
    // Drain the lazy import + initial state-init push.
    await new Promise((r) => setTimeout(r, 0));

    const init = port.postMessage.mock.calls.find(
      (call: any[]) => call[0]?.type === 'state-init',
    );
    expect(init).toBeDefined();
    expect(init![0].payload.playback).toBeNull();
  });

  it('state-init carries playback snapshot when item is playing', async () => {
    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.234, duration: 5, bufferedTime: 4 });

    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    const port = makePort();
    listeners.onConnect[0](port);
    await new Promise((r) => setTimeout(r, 0));

    const init = port.postMessage.mock.calls.find(
      (call: any[]) => call[0]?.type === 'state-init',
    );
    expect(init![0].payload.playback).toEqual({ i: 'item_a', c: 1.234, d: 5, b: 4 });
  });

  it('forwards playback changes as typed messages', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    const port = makePort();
    listeners.onConnect[0](port);
    await new Promise((r) => setTimeout(r, 0));
    port.postMessage.mockClear();

    usePlaybackStore.getState().setPlayingItem('item_a');
    await new Promise((r) => setTimeout(r, 0));
    expect(port.postMessage.mock.calls).toContainEqual([
      { type: 'playback', i: 'item_a', c: null },
    ]);

    usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(port.postMessage.mock.calls).toContainEqual([
      { type: 'playback', i: 'item_a', c: 1, d: 5, b: 4 },
    ]);
  });

  it('dedupes round-equal raw values', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    const port = makePort();
    listeners.onConnect[0](port);
    await new Promise((r) => setTimeout(r, 0));

    usePlaybackStore.getState().setPlayingItem('item_a');
    usePlaybackStore.getState().setProgress({ currentTime: 1.2345, duration: 5, bufferedTime: 4 });
    await new Promise((r) => setTimeout(r, 0));
    port.postMessage.mockClear();

    usePlaybackStore.getState().setProgress({ currentTime: 1.2347, duration: 5, bufferedTime: 4 });
    await new Promise((r) => setTimeout(r, 0));

    const playbackMsgs = port.postMessage.mock.calls.filter(
      (c: any[]) => c[0]?.type === 'playback',
    );
    expect(playbackMsgs.length).toBe(0);
  });
});
```

- [ ] **Step 14.2: Run to confirm tests fail**

Run: `npm run test -- src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`
Expected: FAIL.

- [ ] **Step 14.3: Implement the playback subscription in the surface**

In `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`, inside `installStoreSubscriptions()`:

Just after the existing line:

```ts
const { default: useSessionStore } = await import('../../../stores/sessionStore');
```

add a second lazy import for the playback module:

```ts
const {
  usePlaybackStore,
  getRawSnapshot,
  subscribePlaybackForPort,
} = await import('../../../stores/playbackStore');
```

Extend the initial `state-init` push to include the playback snapshot. Find the existing block:

```ts
this.port.postMessage({
  type: 'state-init',
  payload: {
    items: session.items,
    systemAudioItems: session.systemAudioItems,
    isSessionActive: session.isSessionActive,
    sessionStartTime: session.sessionStartTime,
    provider: lastConfig.provider,
    sourceLanguage: lastConfig.sourceLanguage,
    targetLanguage: lastConfig.targetLanguage,
    turnDetectionMode: lastConfig.turnDetectionMode,
  },
});
```

Add `playback` to the payload:

```ts
const playbackSnapshot = (() => {
  const playingItemId = usePlaybackStore.getState().playingItemId;
  const raw = getRawSnapshot();
  if (playingItemId === null) return null;
  if (raw === null) return { i: playingItemId, c: null };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { i: playingItemId, c: r3(raw.currentTime), d: r3(raw.duration), b: r3(raw.bufferedTime) };
})();

this.port.postMessage({
  type: 'state-init',
  payload: {
    items: session.items,
    systemAudioItems: session.systemAudioItems,
    isSessionActive: session.isSessionActive,
    sessionStartTime: session.sessionStartTime,
    provider: lastConfig.provider,
    sourceLanguage: lastConfig.sourceLanguage,
    targetLanguage: lastConfig.targetLanguage,
    turnDetectionMode: lastConfig.turnDetectionMode,
    playback: playbackSnapshot,
  },
});
```

Below the existing three subscriptions (`unsubItems`, `unsubSession`, `unsubConfig`), add the fourth:

```ts
const unsubPlayback = subscribePlaybackForPort((encoded) => {
  this.port?.postMessage({ type: 'playback', ...encoded });
});
```

Append it to the subscriptions array:

```ts
this.subscriptions = [unsubItems, unsubSession, unsubConfig, unsubPlayback];
```

- [ ] **Step 14.4: Run tests to confirm pass**

Run: `npm run test -- src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`
Expected: PASS.

- [ ] **Step 14.5: Run the full test suite**

Run: `npm run test`
Expected: PASS — no regressions elsewhere.

- [ ] **Step 14.6: Commit**

```bash
git add src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts \
        src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts
git commit -m "feat(subtitle/ext): forward playback over chrome.runtime.Port

Side-panel surface subscribes to playbackStore and pushes a compact
'playback' message (short keys, 3-decimal precision) to the iframe.
Initial state-init carries a snapshot so mid-playback joiners pick
up the correct highlight immediately.

Issue #232 — phase 2 (side-panel side)."
```

---

## Task 15: `sessionPortMirror` — Iframe-Side Inbound Decode

**Files:**
- Modify: `src/stores/sessionPortMirror.ts`
- Modify: `src/stores/sessionPortMirror.test.ts`

- [ ] **Step 15.1: Add failing tests for `playback` inbound**

Append to `src/stores/sessionPortMirror.test.ts` (uses the file's existing `connectedPort` + `installSessionPortMirror` pattern; the inbound `onMessage` handler is captured via `connectedPort.onMessage.addListener.mock.calls[0][0]`):

```ts
import { usePlaybackStore } from './playbackStore';

describe('sessionPortMirror — playback inbound', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      playingItemId: null,
      currentTime: null,
      progressRatio: 0,
      _cumOffset: 0,
      _lastBt: 0,
      _lastCt: 0,
      _maxProgress: 0,
      _raw: null,
    });
    useSessionStore.setState({
      items: [],
      systemAudioItems: [],
      isSessionActive: false,
      sessionStartTime: null,
    } as any);

    connectedPort = {
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    globalThis.chrome = {
      runtime: { connect: vi.fn(() => connectedPort) },
    };
  });

  it('applies playback message with full c/d/b', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(1.0);
    expect(s._raw).toEqual({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
  });

  it('applies playback message with c:null (pause) preserving derived', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    onMessage({ type: 'playback', i: 'item_a', c: null });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(1.0);
    expect(s._raw).toBeNull();
  });

  it('applies playback message with i:null (clear)', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    onMessage({ type: 'playback', i: null });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
  });

  it('state-init.payload.playback populates the store on connect', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'state-init',
      payload: { items: [], playback: { i: 'item_a', c: 0.5, d: 5, b: 4 } },
    });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(0.5);
  });

  it('state-init without playback leaves the playback store at defaults', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'state-init', payload: { items: [] } });
    expect(usePlaybackStore.getState().playingItemId).toBeNull();
  });
});
```

Add `import useSessionStore from './sessionStore';` to the top of the file if it isn't already imported in the same scope as this describe block.

- [ ] **Step 15.2: Run tests to confirm they fail**

Run: `npm run test -- src/stores/sessionPortMirror.test.ts`
Expected: FAIL.

- [ ] **Step 15.3: Implement inbound handling in `sessionPortMirror.ts`**

In `src/stores/sessionPortMirror.ts`:

Add the import at the top:

```ts
import usePlaybackStore from './playbackStore';
```

Wait — `usePlaybackStore` is exported as a named export from `playbackStore.ts`. Use the named import:

```ts
import { usePlaybackStore } from './playbackStore';
```

Add the new inbound type to the union near the existing interfaces:

```ts
interface InboundPlayback {
  type: 'playback';
  i: string | null;
  c?: number | null;
  d?: number;
  b?: number;
}

type Inbound =
  | InboundStateInit
  | InboundItems
  | InboundSession
  | InboundConfig
  | InboundPlayback;
```

Extend `InboundStateInit.payload` with an optional `playback` field:

```ts
interface InboundStateInit {
  type: 'state-init';
  payload: {
    items?: any[];
    systemAudioItems?: any[];
    isSessionActive?: boolean;
    sessionStartTime?: number | null;
    provider?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    turnDetectionMode?: string;
    playback?: { i: string | null; c?: number | null; d?: number; b?: number } | null;
  };
}
```

Add an `applyPlayback` helper near `applyConfig`:

```ts
function applyPlayback(msg: { i: string | null; c?: number | null; d?: number; b?: number }) {
  const playback = usePlaybackStore.getState();
  if (msg.i === null) {
    playback.setPlayingItem(null);
    return;
  }
  playback.setPlayingItem(msg.i);
  if (msg.c === null || msg.c === undefined) {
    playback.setProgress(null);
    return;
  }
  playback.setProgress({
    currentTime: msg.c,
    duration: msg.d ?? 0,
    bufferedTime: msg.b ?? 0,
  });
}
```

Update `handle()` to dispatch on the new type and read the new `state-init` field:

```ts
function handle(msg: Inbound): void {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'state-init') {
    useSessionStore.setState({
      items: msg.payload.items ?? [],
      systemAudioItems: msg.payload.systemAudioItems ?? [],
      isSessionActive: msg.payload.isSessionActive ?? false,
      sessionStartTime: msg.payload.sessionStartTime ?? null,
    } as any);
    if (msg.payload.provider) {
      applyConfig(
        msg.payload.provider,
        msg.payload.sourceLanguage ?? 'en',
        msg.payload.targetLanguage ?? 'zh',
        msg.payload.turnDetectionMode,
      );
    }
    if (msg.payload.playback) applyPlayback(msg.payload.playback);
  } else if (msg.type === 'playback') {
    applyPlayback(msg);
  } else if (msg.type === 'items') {
    useSessionStore.setState({
      items: msg.items,
      systemAudioItems: msg.systemAudioItems ?? useSessionStore.getState().systemAudioItems,
    } as any);
  } else if (msg.type === 'session') {
    useSessionStore.setState({
      isSessionActive: msg.isSessionActive,
      sessionStartTime: msg.sessionStartTime ?? null,
    } as any);
  } else if (msg.type === 'config') {
    applyConfig(msg.provider, msg.sourceLanguage, msg.targetLanguage, msg.turnDetectionMode);
  }
}
```

- [ ] **Step 15.4: Run tests to confirm pass**

Run: `npm run test -- src/stores/sessionPortMirror.test.ts`
Expected: PASS.

- [ ] **Step 15.5: Run the full test suite**

Run: `npm run test`
Expected: PASS — no regressions.

- [ ] **Step 15.6: Commit**

```bash
git add src/stores/sessionPortMirror.ts src/stores/sessionPortMirror.test.ts
git commit -m "feat(subtitle/ext): decode playback messages in iframe mirror

sessionPortMirror handles the new 'playback' inbound type and the
optional state-init.payload.playback snapshot, dispatching to the
iframe-side playbackStore. The same setPlayingItem + setProgress
calls run on both sides; derivation logic is identical.

Issue #232 — phase 2 complete."
```

---

## Task 16: TypeScript & Tests Full Sweep

**Files:**
- Verify only (no edits).

- [ ] **Step 16.1: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: clean. Investigate and fix any new errors before moving on.

- [ ] **Step 16.2: Full test suite**

Run: `npm run test`
Expected: PASS, all suites green.

- [ ] **Step 16.3: Lint (if configured)**

Run: `npm run lint 2>/dev/null || echo "no lint script"`
Expected: no errors (or "no lint script" if the project has none — that's fine).

- [ ] **Step 16.4: Grep for leftover references**

Run:
```bash
git grep -nE "row-text-played" -- ':!docs/'
git grep -nE "playingItemId.*useState|playbackProgress.*useState" src/
```
Expected: both empty. (`row-text-played` is gone; the two `useState`s have moved to `playbackStore`.)

- [ ] **Step 16.5: Commit a no-op marker if anything was cleaned up**

If any leftovers were found and removed, commit. Otherwise skip.

```bash
git status
# If there are changes:
git add -A
git commit -m "chore(playback): clean up leftover references after refactor"
```

---

## Task 17: Manual Verification (Electron + Extension)

**Files:** none.

- [ ] **Step 17.1: Electron MainPanel smoke test**

Run: `npm run electron:dev`
- Start a session with the default provider.
- Generate an assistant message (say something into the mic).
- Verify the assistant translation in MainPanel still shows the karaoke colour advance.
- Specifically: during long assistant messages with chunk gaps, confirm the highlight does NOT flash back to character 0 between chunks (this is the intentional improvement from `setProgress(null)` preserving derived).

- [ ] **Step 17.2: Electron subtitle window**

In the same dev session:
- Open the subtitle window from the UI.
- Confirm the **compact** band shows the assistant translation with character-by-character colour fill during playback.
- Toggle to **expanded** mode; confirm the same highlight via ConversationRow.

- [ ] **Step 17.3: Extension build + sideload**

Run: `cd extension && npm install && npm run build`
(Refer to existing extension docs in the repo if these scripts differ.)

- Load the unpacked extension in Chrome → `chrome://extensions/` → Developer mode → "Load unpacked" → select `extension/dist`.
- Join `https://meet.google.com/<test-room>`.
- Click the Sokuji icon → enter subtitle mode on the meeting tab.
- Speak into the mic; confirm the overlay subtitle bar shows karaoke highlight on the assistant translation.

- [ ] **Step 17.4: Bandwidth verification (Extension)**

Temporarily instrument `ExtensionContentScriptSubtitleSurface.installStoreSubscriptions()` to log the size of each `postMessage`:

```ts
// inside subscribePlaybackForPort callback (TEMP — remove before merge):
const encoded = { type: 'playback', ...e };
const bytes = new TextEncoder().encode(JSON.stringify(encoded)).length;
console.info('[Sokuji bandwidth]', bytes, 'B');
this.port?.postMessage(encoded);
```

- Open the side-panel DevTools (`chrome://extensions/` → Sokuji → "Inspect views: service worker" / side panel).
- Generate a continuous assistant message ~30 s long.
- Sum the per-message bytes from the console; divide by elapsed seconds.
- Confirm the average is under 1 KB/s. Record the number for the PR description.
- **Remove the instrumentation log before final commit.**

- [ ] **Step 17.5: Smoothness comparison**

- Open Electron MainPanel and the Electron subtitle bar side by side.
- Play the same assistant message in both.
- Visually confirm the subtitle highlight motion is at least as smooth as MainPanel's.

- [ ] **Step 17.6: Edge case — non-streaming provider**

- Switch the provider to a non-streaming one (local inference Opus-MT, or any provider where translations arrive as one chunk).
- Play an assistant message; confirm the karaoke linear fallback still advances smoothly.

- [ ] **Step 17.7: Edge case — chunk-gap-prone provider**

- Switch to a streaming provider (OpenAI Realtime / Gemini) that produces chunk-segmented audio.
- Watch the highlight during chunk boundaries; confirm no flash-to-zero.

- [ ] **Step 17.8: Note manual-verification results**

In the PR description (template separately), include:
- Bandwidth measurement (e.g., "Measured 780 B/s over 30 s continuous playback").
- Brief note that Electron + Extension paths were verified.
- Mention any visual co-occurrence between `subtitle-stream__item--new` and `karaoke-played` on freshly-arrived playing items (likely fine; only mitigate if conspicuous).

- [ ] **Step 17.9: Final commit if instrumentation was added/removed**

```bash
git status
# Should be clean. If there were temporary edits:
git restore .
```

---

## Verification Checklist (Acceptance Criteria from Issue #232)

- [ ] Subtitle bar highlights the currently-playing assistant message character-by-character in Electron. *(Task 12 + Task 13 + Task 17.2)*
- [ ] No regression in MainPanel highlighting. *(Task 11.6, Task 17.1)*
- [ ] Subtitle bar highlights work in extension iframe overlay when an assistant message is playing in the sidepanel. *(Task 14 + Task 15 + Task 17.3)*
- [ ] Sustained port-tick bandwidth < 1 KB/s. *(Task 6, Task 7, Task 17.4)*
- [ ] Smoothness ≥ what MainPanel currently delivers. *(Task 17.5)*

---

## Out of Scope (Already Documented in Spec)

- Word-level timing.
- Speaker (user) message highlighting.
- Cross-port-disconnect `_maxProgress` continuity (single ≤ 100 ms snap on iframe reconnect is acceptable).
- Visual coordination polish between `subtitle-stream__item--new` and `karaoke-played` — observe; only mitigate if conspicuous.
- A user toggle for the karaoke highlight (treatment is opinionated and ships on by default).
