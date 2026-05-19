# Subtitle — Karaoke-Style Character Highlighting

**Date:** 2026-05-19
**Status:** Design approved, ready for implementation plan
**Issue:** [#232](https://github.com/kizuna-ai-lab/sokuji/issues/232)

## Problem

`MainPanel` already paints a karaoke-style character-by-character highlight on the currently-playing assistant message: `getHighlightedChars()` (`MainPanel.tsx:91-113`) maps cumulative playback time to a character offset using per-sentence `audioSegments` from the provider (with a linear-interpolation fallback), and `ConversationRow` (`ConversationRow.tsx:83-89`) renders the result as two spans — a `row-text-played` prefix + an unstyled remainder.

In **subtitle mode**, that same data is dropped. `SubtitleStream.tsx` forwards `highlightedChars={0}` and `isPlaying={false}` to `ConversationRow` in expanded mode, and concatenates plain `<span>` items per band in compact mode with no per-item highlight at all. The view layer is ready; the blocker is plumbing — `playingItemId` and the playback progress are MainPanel-local `useState` (`MainPanel.tsx:254-259`), so subtitle mode has no way to read them.

Two contexts:

- **Electron**: `MainPanel` and `SubtitleApp` share the same React tree (the side-panel surface). Lifting the state into a shared store is all that's needed.
- **Extension**: `SubtitleApp` lives in an iframe injected into the meeting page (Google Meet, Teams, Zoom, …). The iframe has no audio of its own — audio plays in the side panel. The side panel already maintains a long-lived `chrome.runtime.Port` to the iframe for items / session / config mirroring (`sessionPortMirror.ts`); playback state needs to ride the same port.

## Goals & Non-Goals

**Goals**

- Show the same character-by-character highlight in subtitle mode that the main panel shows for the currently-playing assistant message.
- Cover both compact and expanded subtitle layouts.
- No regression in `MainPanel` highlighting.
- Sustained port-tick bandwidth < 1 KB/s during continuous playback.
- Subtitle smoothness ≥ what `MainPanel` currently delivers (10 Hz).
- Source-of-truth playback logic lives in **one** module; both Electron and Extension paths share the same state machine.

**Non-Goals**

- Word-level timing. Current upstream data is character-level (`audioSegments` from the provider).
- Highlighting the speaker (user) message. Only the assistant playback gets highlighted today, and that doesn't change.
- Per-character animation polish (CSS transitions beyond the existing `karaoke-played` colour change).
- Cross-port-disconnect monotonic-progress continuity. Mid-playback port reconnects are rare and a single ≤ 100 ms visual snap-back is acceptable.

## Design Overview

A new Zustand store `playbackStore` owns playback state and runs the existing derivation logic (cumulative time across player-entry boundaries + monotonic-clamped progress ratio). Both `MainPanel` and `SubtitleApp` consume it via a single hook `usePlaybackHighlight(item)` that returns `{ isPlaying, highlightedChars }`. The pure `getHighlightedChars()` function moves out of `MainPanel.tsx` to `src/lib/playback/highlight.ts`.

For the Extension path, the side-panel surface (`ExtensionContentScriptSubtitleSurface`) subscribes to its local `playbackStore` and forwards raw playback signals over the existing `chrome.runtime.Port` using a compact wire format. The iframe's `sessionPortMirror` decodes them and feeds the iframe-side `playbackStore` through the same setters. Both sides run identical derivation; `MainPanel` and `SubtitleApp` (Electron or iframe) consume identical results.

```
                      ┌───────────────────────────────────┐
                      │  ModernAudioPlayer (side panel)   │
                      │  status callback + 100ms poll     │
                      └───────────┬───────────────────────┘
                                  │ raw signal @10Hz
                                  ▼
   ┌──────────────────────────────────────────────────────────┐
   │  playbackStore (Zustand) — side-panel process            │
   │   actions: setPlayingItem(id), setProgress(raw)          │
   │   public:  playingItemId, currentTime, progressRatio     │
   │   internal:_cumOffset, _lastBt, _lastCt, _maxProgress,   │
   │            _raw                                          │
   └──────┬─────────────────────────────────────────┬──────────┘
          │ in-process subscribe                    │ in-process subscribe
          ▼                                         ▼
   ┌──────────────┐                          ┌──────────────────────────────┐
   │  MainPanel   │                          │ ExtensionContentScriptSubt…  │
   │  Conversation│                          │  subscribePlaybackForPort →  │
   │  Bubble      │                          │  port.postMessage(wire)      │
   └──────────────┘                          └────────────┬─────────────────┘
                                                          │ ≤ 90 B × 10 Hz
                                                          ▼ ≈ 800 B/s
                                          ┌────────────────────────────────┐
                                          │ sessionPortMirror (iframe)     │
                                          │  decode → playbackStore        │
                                          │  setPlayingItem + setProgress  │
                                          └────────────┬───────────────────┘
                                                       ▼
                                          ┌───────────────────────────────┐
                                          │ SubtitleApp / SubtitleStream  │
                                          │  usePlaybackHighlight(item)   │
                                          └───────────────────────────────┘
```

## Component Changes

### New file: `src/lib/playback/highlight.ts`

Lifts `getHighlightedChars()` from `MainPanel.tsx:91-113` verbatim. Pure function, zero dependencies, exported. Imported by `playbackStore.usePlaybackHighlight` and (optionally) reused by tests.

### New file: `src/stores/playbackStore.ts`

Zustand store with `subscribeWithSelector` middleware (matches the existing store style in `audioStore.ts` / `sessionStore.ts`).

**Public state** (read via selector hooks):

```ts
interface PlaybackPublic {
  playingItemId: string | null;
  currentTime: number | null;  // cumulative-adjusted seconds in the item's timeline
  progressRatio: number;        // monotonic-clamped [0, 1]
}
```

**Internal state** (in the same state object, underscore-prefixed; not read by consumers):

```ts
interface PlaybackInternal {
  _cumOffset: number;   // cumulative offset across player-entry resets
  _lastBt: number;      // last raw bufferedTime
  _lastCt: number;      // last raw currentTime
  _maxProgress: number; // monotonic-clamp guard
  _raw: { currentTime: number; duration: number; bufferedTime: number } | null;
}
```

**Actions**:

- `setPlayingItem(id: string | null)` — writes id; on actual change (not same-id no-op) resets all internal trackers and clears public derived values (`currentTime` to `null` if `id === null`, else `0`; `progressRatio` to `0`).
- `setProgress(raw)` — accepts the raw `{ currentTime, duration, bufferedTime }` from the player. Stores `_raw`. Computes cumulative time (offset bumps by `_lastBt` when `raw.currentTime` regresses by more than `ENTRY_RESET_THRESHOLD = 0.05`) and monotonic-clamped ratio (`max(calculated, _maxProgress)`); writes both into public state. `setProgress(null)` **preserves all derived trackers and writes `_raw = null`** (improved from `MainPanel`'s current behaviour, which transiently snaps segment-based providers' highlight to 0 between chunk gaps; see "Behaviour Differences" below). The `_raw = null` write is what the port surface observes to forward a `c: null` pause signal.

**Helpers**:

- `getRawSnapshot(): InternalRaw | null` — exported pure function returning `state._raw`. Used by the surface for the initial `state-init` push and by tests.
- `subscribePlaybackForPort(callback): unsub` — exported. Wraps `useStore.subscribe` with the wire-encoding pipeline:
  - Selector reads `{ playingItemId, _raw }`.
  - Equality fn compares `playingItemId` and a per-field, 3-decimal-rounded comparison of `_raw` (`rawEqual`).
  - On change, encodes via `encodePlaybackForWire(...)` and invokes `callback(encoded)`.
  - `encodePlaybackForWire` and `rawEqual` are module-private but exported under `__internal__` for `playbackStore.test.ts`.

**Selector hooks** (granular, for low-level use; SubtitleStream / MainPanel use `usePlaybackHighlight` instead):

- `usePlayingItemId()`, `usePlaybackCurrentTime()`, `usePlaybackProgressRatio()`, `usePlaybackActions()`.

### New file: `src/stores/playbackStore.ts` — `usePlaybackHighlight(item)` hook

Co-located with the store. Signature: `(item: ConversationItem | null | undefined) => { isPlaying: boolean; highlightedChars: number }`.

Internally uses a single `useStore` call with a per-item selector and `useShallow`:

```ts
const EMPTY_HIGHLIGHT: PlaybackHighlight = { isPlaying: false, highlightedChars: 0 };

return usePlaybackStore(
  useShallow((s): PlaybackHighlight => {
    if (!item || s.playingItemId !== item.id) return EMPTY_HIGHLIGHT;
    const text = item.formatted?.transcript || item.formatted?.text || '';
    const segments = item.formatted?.audioSegments;
    return {
      isPlaying: true,
      highlightedChars: getHighlightedChars(s.currentTime ?? 0, segments, text.length, s.progressRatio),
    };
  }),
);
```

The selector returns the module-level `EMPTY_HIGHLIGHT` reference for all non-playing rows, so Zustand's shallow-equality bailout suppresses re-renders during the 10 Hz tick storm for rows that aren't currently highlighted. Only the actively-playing row re-renders per tick.

### New file: `src/styles/karaoke.scss`

```scss
.karaoke-played {
  color: var(--karaoke-played-color, #10a37f);
  transition: color 80ms ease-out;
}
```

Imported once in each consuming TSX (SCSS files in this project compile to flat global CSS; duplicate `@import` is idempotent).

### Modified: `src/components/MainPanel/MainPanel.tsx`

Removals:

- `function getHighlightedChars` (`L91-113`) — moved to `src/lib/playback/highlight.ts`.
- `const [playingItemId, setPlayingItemId]` and `const [playbackProgress, setPlaybackProgress]` (`L254-259`).
- `const lastMaxProgressRef = useRef<number>(0)` (`L775`).
- `const cumulativeProgress = useMemo(...)` (`L2099-2131`).
- `const progressRatio = useMemo(...)` (`L2141-2154`).
- `useEffect` "reset on playingItemId change" (`L2163-2166`).
- `useEffect` "update max progress ref" (`L2171-2176`).
- `cumulativeAudioRef` declaration (paired with the above blocks).
- The inline `getHighlightedChars(...)` call inside `renderConversationItem` (`L2832-2839`).

Edits:

- `setPlayingItemId(...)` callsites → `usePlaybackActions().setPlayingItem(...)`.
- `setPlaybackProgress(...)` callsites → `usePlaybackActions().setProgress(...)`.
- `ITEM_END_DEBOUNCE_MS` debounce timer logic stays — it compensates for `ModernAudioPlayer`'s entry-eviction "ended" events during chunk gaps. The debounce wraps the calls to `setPlayingItem(null)` + `setProgress(null)`.
- `PROGRESS_UPDATE_INTERVAL` (100 ms) stays. The interval body changes to feed the store instead of local state.
- Audio status callback (`L2188-2229`) updated analogously.

`renderConversationItem` extraction: the helper function currently lives inside MainPanel and is called from `filteredItems.map(...)`. To call `usePlaybackHighlight` per row, the row body becomes a real subcomponent `ConversationBubble` (new, in the same file or a sibling file) that owns the hook call. The map becomes:

```tsx
filteredItems.map((item, i) => (
  <ConversationBubble
    key={`${item.source || 'speaker'}_${item.id || i}`}
    item={item}
    index={i}
    prevItem={/* same lookup as before */}
    {/* … other props that the existing helper consumed: callbacks, language, mode flags, etc. */}
  />
))
```

`ConversationBubble` internally calls `usePlaybackHighlight(item)` and passes `isPlaying` / `highlightedChars` to the inner `<ConversationRow>` instance (and to the message-bubble basic-mode rendering path). The remainder of MainPanel's render logic is unchanged.

### Modified: `src/components/MainPanel/ConversationRow.tsx`

Single rename: `className="row-text-played"` → `className="karaoke-played"` (`L88`). Add `import '../../styles/karaoke.scss';`.

### Modified: `src/components/MainPanel/MainPanel.scss`

Delete the `.row-text-played` rule on `L240`. Replaced by `karaoke.scss`.

### Modified: `src/components/Subtitle/SubtitleStream.tsx`

Add `import '../../styles/karaoke.scss';`.

Add a memoized id→item index used by both rendering paths:

```ts
const itemsById = useMemo(
  () => new Map<string, any>(items.map((it) => [it.id, it])),
  [items],
);
```

Compact branch: replace the inline `<span>` mapping with a new local subcomponent `CompactSpan` (defined at the bottom of the same file). `CompactSpan` receives `{ it, item, showNewHighlight, leadingSpace }`; calls `usePlaybackHighlight(item)`; renders either a plain `<span>` (not playing, or no chars to highlight) or a `<span>` containing a `karaoke-played` prefix span + plain remainder span. Leading space stays on the outer span so it never participates in the played/unplayed split.

Expanded branch: replace the inline `<ConversationRow ... isPlaying={false} highlightedChars={0} />` with a local subcomponent `SubtitleConversationRow` that calls `usePlaybackHighlight(item)` and passes its result to `<ConversationRow>`. The wrapper exists because `usePlaybackHighlight` must be called per row, and React's rules-of-hooks forbid calling hooks inside the map callback when iteration count varies.

### Modified: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`

In `installStoreSubscriptions()`:

- After the lazy-import of `useSessionStore`, also lazy-import `playbackStore`'s `getRawSnapshot` and `subscribePlaybackForPort`.
- The initial `state-init` payload gains a `playback` field populated via `getRawSnapshot()` + `playingItemId`.
- A 4th subscription is installed via `subscribePlaybackForPort(encoded => this.port?.postMessage({ type: 'playback', ...encoded }))`; the unsubscribe is appended to `this.subscriptions`.

### Modified: `src/stores/sessionPortMirror.ts`

Add `InboundPlayback` to the inbound union:

```ts
interface InboundPlayback {
  type: 'playback';
  i: string | null;
  c?: number | null;
  d?: number;
  b?: number;
}
```

Extend `InboundStateInit.payload` with an optional `playback` field of the same shape (minus `type`).

Add `applyPlayback(p)` helper (translates wire fields back to store actions) and a `msg.type === 'playback'` branch in `handle()`. The `state-init` branch invokes `applyPlayback(msg.payload.playback)` if present.

## Wire Protocol

Message type `'playback'`. Fields:

```ts
// active playback tick
{ type: 'playback', i: 'item_AbC123XyZ', c: 1.234, d: 5.679, b: 6.789 }

// player paused, item still selected
{ type: 'playback', i: 'item_AbC123XyZ', c: null }

// nothing playing
{ type: 'playback', i: null }
```

`c`, `d`, `b` are rounded to 3 decimal places (1 ms precision) before serialisation. The dedup `rawEqual` also compares rounded values, so two consecutive ticks whose raw values differ only in sub-millisecond noise produce no port message.

`state-init` carries the same payload under `playback` (optional):

```ts
{ type: 'state-init', payload: { /* items, session, config */ playback: { i, c, d, b } | null } }
```

### Bandwidth

Per-tick worst case (UUID-style 36-char item ID, full payload):

```
{"type":"playback","i":"550e8400-e29b-41d4-a716-446655440000","c":1.234,"d":5.679,"b":6.789}
```

≈ 90 B; 10 Hz → 900 B/s. Common case (item_ prefix ~24 chars): ≈ 78 B × 10 Hz ≈ 780 B/s. Both fit the acceptance ceiling < 1 KB/s with margin. Paused / idle states emit at most one transition message per state change due to `rawEqual` dedup.

## Behaviour Differences From Current `MainPanel`

`setProgress(null)` in the new store **preserves all derived values**. In current `MainPanel`, when `playbackProgress` momentarily becomes `null` during chunk gaps, the `cumulativeProgress` useMemo returns `null` and the highlight call falls back to `playbackProgress?.currentTime ?? 0` — for segment-based providers this snaps the highlight to character 0 for one frame before the next non-null tick (`progressRatio` stays clamped, so linear-fallback providers don't see this). The new behaviour holds the last derived `currentTime` through the gap, eliminating the per-chunk flicker. This change is intentional, lives at the boundary between "regression" and "improvement", and is in scope.

No other observable behaviour changes for `MainPanel`.

## Files Affected

**New (6):**

- `src/lib/playback/highlight.ts`
- `src/lib/playback/highlight.test.ts`
- `src/stores/playbackStore.ts`
- `src/stores/playbackStore.test.ts`
- `src/stores/playbackStore.usePlaybackHighlight.test.tsx`
- `src/styles/karaoke.scss`

**Modified (6):**

- `src/components/MainPanel/MainPanel.tsx` — remove ~120 lines of state/derivation, extract `ConversationBubble`, switch to store actions.
- `src/components/MainPanel/MainPanel.scss` — delete `.row-text-played` rule.
- `src/components/MainPanel/ConversationRow.tsx` — class rename + karaoke.scss import.
- `src/components/Subtitle/SubtitleStream.tsx` — `itemsById` + `CompactSpan` + `SubtitleConversationRow` + karaoke.scss import.
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` — fourth subscription + `state-init.playback`.
- `src/stores/sessionPortMirror.ts` — inbound `playback` case + `state-init.playback` decode.

## Testing

### Unit — `src/lib/playback/highlight.test.ts`

- Segment-based: `currentTime` inside segment N → `prevTextEnd + floor(progressInSeg * width)`.
- Segment-based: `currentTime` past last segment → final `prevTextEnd`.
- Linear fallback: `segments` is undefined / `[]` → `floor(textLength * progressRatio)`.
- Boundary: `textLength = 0`, `progressRatio = 0`, `progressRatio = 1`.
- Boundary: segment with `audioEnd === prevAudioEnd` (zero duration) returns full `textEnd` for that segment.

### Unit — `src/stores/playbackStore.test.ts`

- `setPlayingItem(id)` resets all trackers; `currentTime = 0`, `progressRatio = 0`.
- `setPlayingItem(sameId)` is a no-op.
- `setPlayingItem(null)` sets `currentTime = null`; trackers cleared.
- `setProgress(raw)` happy path: derived `currentTime` and `progressRatio` advance.
- `setProgress(raw)` entry eviction: `raw.currentTime` regresses > 50 ms, `_lastBt > 0` → `_cumOffset` increments by `_lastBt`.
- `setProgress(raw)` entry-eviction edge cases: regression ≤ 50 ms or `_lastBt === 0` → no offset bump.
- `setProgress(raw)` monotonic clamp: calculated ratio drops → returns `_maxProgress`.
- `setProgress(null)`: all public + internal derived trackers (`currentTime`, `progressRatio`, `_cumOffset`, `_lastBt`, `_lastCt`, `_maxProgress`) preserved; only `_raw` is set to `null`. This is what lets the surface observe the pause transition and forward it over the port without dropping derived continuity.
- `getRawSnapshot()` returns the latest raw input.
- `subscribePlaybackForPort` fires callback on `playingItemId` change; on `_raw` change (compared by rounded fields); does not fire on round-equal changes; returns working unsub.
- `encodePlaybackForWire` shapes for `i = null` / `c = null` / full path; rounds c/d/b to 3 decimals.
- `rawEqual`: same / different / null↔non-null paths.

### Unit — `src/stores/playbackStore.usePlaybackHighlight.test.tsx`

Uses `@testing-library/react` (already a dev dep).

- Item is playing → returns `isPlaying: true`, correct `highlightedChars`.
- Item is not playing → returns the `EMPTY_HIGHLIGHT` constant (assert via `Object.is`).
- Store ticks while item is not playing → component does not re-render (track via a `useRef` render counter inside a test-only wrapper).
- `item` is `null` / `undefined` → returns `EMPTY_HIGHLIGHT`.
- `item` lacks `audioSegments` → linear-fallback path through `getHighlightedChars`.

### Unit — `src/components/Subtitle/SubtitleStream.test.tsx` (updates)

- Compact: store mocked with `setState({ playingItemId, currentTime, progressRatio, ... })`; the matching `CompactSpan` contains a `.karaoke-played` child span; text is split at the correct boundary.
- Compact: non-playing spans contain no `.karaoke-played`.
- Compact: `itemsById.get(it.id)` returns `undefined` (rare timing where the line still has the id but `items` has dropped it) → renders plain text, no error.
- Expanded: playing item's wrapped `ConversationRow` receives `isPlaying = true` and a non-zero `highlightedChars`.
- Replace the existing test cases that hard-coded `isPlaying = false` / `highlightedChars = 0` to instead assert the empty-store default produces those values.

### Unit — `src/stores/sessionPortMirror.test.ts` (updates)

- `state-init` with `payload.playback` populated → iframe `playbackStore` reaches the expected state.
- `state-init` without `playback` → iframe `playbackStore` remains at defaults.
- Inbound `{ type: 'playback', i, c, d, b }` → `setPlayingItem(i)` + `setProgress({ ... })`.
- Inbound `{ type: 'playback', i: null }` → `setPlayingItem(null)`.
- Inbound `{ type: 'playback', i, c: null }` → `setPlayingItem(i)` + `setProgress(null)`; derived values preserved.

### Unit — `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts` (updates)

- On connect, `state-init.payload.playback` is populated from `getRawSnapshot()`.
- `playbackStore` mutation fires exactly one `port.postMessage({ type: 'playback', ... })`.
- Two consecutive raws differing only beyond 3 decimals produce one message (dedup).
- Port reconnect: previous subscription is torn down; new subscription is installed (no duplicate fan-out).

### Manual verification

Mapped to the issue's acceptance criteria:

| Criterion | Procedure |
|---|---|
| Karaoke highlight in Electron subtitle bar | `npm run electron:dev`; start a session with a chatty assistant; enter subtitle mode; visually confirm assistant translation in compact band shows character-by-character colour-fill |
| No MainPanel regression | Same session; toggle between subtitle / main views; confirm MainPanel highlight matches pre-change behaviour |
| Karaoke in extension iframe overlay | Build extension; load into Chrome; join meet.google.com; start session; enter subtitle; visually confirm overlay band shows highlight |
| Port bandwidth < 1 KB/s | Add a temporary instrumentation log in `ExtensionContentScriptSubtitleSurface` summing `postMessage` JSON byte lengths over a rolling 10 s window during continuous playback. Record the average in the PR description. Remove the log before merge |
| Smoothness ≥ MainPanel | Side-by-side comparison: open MainPanel and Electron subtitle bar simultaneously, play the same item, confirm subtitle highlight motion is at least as smooth as MainPanel |

## Risk Register

| Risk | Mitigation |
|---|---|
| Compact band's `--new` keyframe (issue #236) visually clashes with `karaoke-played` overlay on freshly-arrived items that immediately begin playing | Accept on first pass; only add a `:not(.subtitle-stream__item--new)` guard if manual testing surfaces a visible conflict |
| `karaoke.scss` not loaded in some render path (e.g. SubtitleStream mounted without ConversationRow ever rendering) | Import in all three consuming TSX files; verified by code review, not by automated test (jsdom does not apply CSS) |
| Mid-playback port disconnect resets `_maxProgress` on the iframe side → momentary highlight regression | Out of scope; documented as known minor — single ≤ 100 ms snap-back, extremely rare trigger |
| Refactor breaks an obscure MainPanel callsite of `playingItemId` / `playbackProgress` | TypeScript catches accidental removals at compile time; `grep -rn 'playingItemId\|playbackProgress\|getHighlightedChars' src/` after the refactor should yield only intended references |
| `setPlayingItem(null)` debounce timing differs between MainPanel and iframe | Debounce lives in MainPanel only — the side-panel store sees the already-debounced signal; the iframe sees what the side panel sends. Both layers are coherent with the side panel as source of truth |

## Out of Scope

- Word-level timing.
- Speaker (user) message highlighting.
- Cross-port-disconnect `_maxProgress` continuity.
- Visual coordination polish between `subtitle-stream__item--new` and `karaoke-played`.
- A user toggle for the karaoke highlight. The treatment is opinionated and ships on by default.

## Open Questions Resolved During Brainstorming

- **Scope**: both compact and expanded subtitle modes get the highlight.
- **Hook API**: `usePlaybackHighlight(item)` — takes the full item, so the store stays decoupled from `sessionStore`.
- **Derivation location**: inside the store. Identical state machines run on both Electron and iframe sides, fed identical raw inputs over the port.
- **Wire format**: compact short-key object (`i/c/d/b`) keeping `type: 'playback'`; 3-decimal precision; ≈ 800 B/s sustained.
- **Tracker storage**: in store state (underscore-prefixed) rather than module-level — improves testability and avoids HMR pitfalls.
- **`setProgress(null)` semantics**: preserves derived values — improvement over current MainPanel behaviour, eliminates segment-based-provider chunk-gap flicker.
- **`_raw` exposure**: internal only; surfaced through `getRawSnapshot()` and `subscribePlaybackForPort` helpers.
- **`karaoke-played` class**: new shared class in `src/styles/karaoke.scss`; old `row-text-played` deleted and renamed at its single render site.
- **Compact span subcomponent**: required for React's rules of hooks (loop iteration count varies); also provides per-span subscription granularity so only the active span re-renders per tick.
