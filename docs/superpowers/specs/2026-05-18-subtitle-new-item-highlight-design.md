# Subtitle — Visually Mark Newly-Arrived Text

**Date:** 2026-05-18
**Status:** Design approved, ready for implementation plan
**Issue:** [#236](https://github.com/kizuna-ai-lab/sokuji/issues/236)

## Problem

In **subtitle mode** with the compact band, `SubtitleStream` concatenates the most recent visible items per category (`speaker-source`, `speaker-translation`, `participant-source`, `participant-translation`) up to `BUCKET_MAX_CHARS` (~2000 chars), joins them into one `<p>`, and clips overflow to the bottom (`src/components/Subtitle/SubtitleStream.tsx:88-118`).

For **streaming** providers this works fine — text grows token-by-token at the tail, so the eye follows new content as it appears.

For **non-streaming** providers (local provider's sherpa-onnx ASR + Opus-MT / HY-MT translation, several cloud providers' transcription/translation endpoints), an item arrives as one already-complete chunk. A long sentence or several sentences appear at once; the band re-flows and the newly-arrived portion sits anywhere in the visible tail. The user has to scan back through previously-read text to figure out where the *new* content begins before resuming reading.

Expanded mode (per-item `ConversationRow`) is unaffected — each row is already its own visual unit.

## Goals & Non-Goals

**Goals**
- Make newly-arrived text visually obvious in the compact subtitle band, regardless of provider streaming behavior.
- Behave uniformly across streaming and non-streaming providers — one mental model, one code path.
- Survive existing user customization of `bgColor` / `bgOpacity` / `sourceTextColor` / `translationTextColor` without designing in a new hue that can clash.
- Do not animate the items that are already on screen when the user first enters subtitle mode (or when the subtitle window first mounts) — only items that *arrive* afterwards.

**Non-Goals**
- Touching expanded mode. Per-item `ConversationRow` already separates items visually.
- Adding a new user-facing setting for the highlight (color, duration, on/off). The treatment is opinionated and fixed.
- Solving the case where the user sets `bgOpacity` very low and the actual visible background is whatever sits behind the subtitle window. The auto-inverted overlay is computed from `bgColor` only; low-opacity scenarios accept reduced contrast as a known limitation.
- Re-animating an item when its text is corrected/replaced (same `item.id`, different text). The animation fires once per item, on first appearance.

## Design Overview

Three coordinated changes:

1. **Per-item spans in the compact branch.** Replace the `bucket.join(' ')` flat string with an array of `{id, text}` entries; render each as its own `<span key={item.id}>`. This is the "item-aware rendering in compact mode" direction from issue #236, and is the prerequisite for any per-item visual treatment.
2. **CSS keyframe highlight on first appearance.** Each new span gets a class `subtitle-stream__item--new` that triggers a `@keyframes` animation combining fade-in (opacity 0 → 1, ~400 ms) and an overlay-decay (semi-transparent background fades from ~0.30 alpha to 0 over ~2 s). The animation fires once on apply and the class stays on the span afterwards (harmless once animation completes).
3. **Background-luminance-aware overlay color.** A small pure helper picks `rgba(255,255,255, α)` for dark backgrounds and `rgba(0,0,0, α)` for light backgrounds based on the YIQ luminance of `bgColor`. Result is set on the subtitle root as a CSS variable `--subtitle-highlight-overlay` and consumed by the keyframe.

The state machine that decides *which* spans get the `--new` class lives in `SubtitleStream` as two refs:

- `itemStatesRef: Map<itemId, 'existing' | 'new'>` — records, for every item we have ever rendered, whether it was already on screen at first mount (`existing`) or arrived later (`new`).
- `isFirstRenderRef: boolean` — true only during the very first render pass; flipped to `false` in `useLayoutEffect`.

The decision rule is:

```
state = itemStatesRef.get(itemId)
if state defined        → use that
else if isFirstRender   → 'existing'   (do not animate)
else                    → 'new'        (animate)
```

After commit (`useLayoutEffect`), every currently-rendered item that has no entry in the map gets one, locking its state for the rest of the component's lifetime. The map grows monotonically; with typical conversations this is hundreds of entries, fine to leave un-pruned for v1.

## Component Changes

### `SubtitleStream.tsx`

Current shape of the memoized `lines` (compact branch):

```ts
interface SubtitleLine {
  id: string;            // e.g. 'speaker-source'
  kind: LineKind;
  source: LineSource;
  text: string;          // joined string
}
```

New shape:

```ts
interface SubtitleLineItem {
  id: string;            // item.id
  text: string;
}
interface SubtitleLine {
  id: string;
  kind: LineKind;
  source: LineSource;
  items: SubtitleLineItem[];   // chronological: oldest first, newest last
}
```

Bucket building logic stays — walk `filtered` newest-first, `unshift` into the bucket until `bucketLen[key] >= BUCKET_MAX_CHARS`. Only difference: each bucket now holds `{id, text}` objects, and `bucketLen` accumulates `text.length + 1` exactly as today (the `+1` continues to stand in for the inter-item separator).

Compact render:

```tsx
{lines.map((line) => (
  <div
    key={line.id}
    className={`subtitle-stream__line subtitle-stream__line--${line.kind} subtitle-stream__line--${line.source}`}
  >
    <p>
      {line.items.map((it, idx) => {
        const isNew = itemStateFor(it.id) === 'new';
        return (
          <span
            key={it.id}
            className={`subtitle-stream__item${isNew ? ' subtitle-stream__item--new' : ''}`}
          >
            {idx > 0 ? ' ' : ''}{it.text}
          </span>
        );
      })}
    </p>
  </div>
))}
```

The leading space for non-first items mirrors the previous `bucket.join(' ')` behavior.

State refs and commit hook:

```tsx
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

Why `useLayoutEffect` rather than `useEffect`: synchronous commit before the browser paints prevents a render-cycle race where an item is computed twice as "new" before its state lands in the map.

The expanded branch is unchanged.

### `SubtitleStream.scss`

Add inside the `&.compact` block (or alongside, keyed off `.subtitle-stream__item`):

```scss
.subtitle-stream__item {
  // The animation is only triggered by --new; without it, item is a plain inline span.
}

.subtitle-stream__item--new {
  // Combined fade-in + overlay-decay. `both` keeps end-state styling after animation
  // finishes (transparent overlay, full opacity), even though the class persists on
  // the span — animations only fire once per class application.
  animation: subtitle-item-highlight 2s ease-out both;
  border-radius: 2px;
  padding: 1px 3px;
}

@keyframes subtitle-item-highlight {
  0%   {
    opacity: 0;
    background-color: var(--subtitle-highlight-overlay, rgba(255, 255, 255, 0.30));
  }
  20%  {
    opacity: 1;
    background-color: var(--subtitle-highlight-overlay, rgba(255, 255, 255, 0.30));
  }
  100% {
    opacity: 1;
    background-color: transparent;
  }
}
```

Fade-in completes by ~20% (~400 ms in a 2 s animation); the overlay decays linearly through the remainder.

Notes:

- `padding: 1px 3px` and `border-radius: 2px` give the overlay a slightly hugged shape rather than a hard inline rectangle. The padding is small enough not to perturb line layout meaningfully even when many items are present.
- The `var(--subtitle-highlight-overlay, ...)` fallback uses dark-bg-appropriate white at 0.30 alpha, matching the default `bgColor: #000000`.

### `SubtitleApp.tsx`

Extend the existing CSS-var injection (around line 199) to add the overlay color:

```ts
const rootStyle: React.CSSProperties & Record<string, string | number> = {
  background: hexToRgba(subtitle.bgColor, bgAlpha),
  '--bar-opacity': barVisible ? 1 : 0,
  '--bar-pointer-events': barVisible ? 'auto' : 'none',
  '--subtitle-highlight-overlay': getHighlightOverlayForBg(subtitle.bgColor),
};
```

### Helper: `getHighlightOverlayForBg`

New small pure function. `hexToRgba` today is a local function inside `SubtitleApp.tsx` (line 39). Colocate `getHighlightOverlayForBg` in the same file alongside `hexToRgba`; no module extraction in this change.

```ts
const HIGHLIGHT_ALPHA = 0.30;

/**
 * Returns a CSS color for the "newly-arrived item" overlay, chosen so it
 * contrasts with the user-selected background. YIQ luminance < 128 means
 * the background is dark → use a light overlay; otherwise use dark.
 *
 * The user-set bgOpacity is intentionally not factored in. When opacity is
 * very low and the actual visible background is whatever sits behind the
 * subtitle window, this falls back to the bgColor's nominal lightness —
 * a known limitation accepted in design.
 */
export function getHighlightOverlayForBg(hex: string): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return `rgba(255, 255, 255, ${HIGHLIGHT_ALPHA})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 128
    ? `rgba(255, 255, 255, ${HIGHLIGHT_ALPHA})`
    : `rgba(0, 0, 0, ${HIGHLIGHT_ALPHA})`;
}
```

The 3-digit hex case (`#fff`) does not occur in practice — `bgColor` is always written as 6 digits by the color-picker UI — so the function only validates length 6 and otherwise returns the dark-bg default.

## Behavior Across Item Categories

The highlight applies uniformly to all four buckets:

- `speaker-source`
- `speaker-translation`
- `participant-source`
- `participant-translation`

Error and system items are already routed to the translation bucket of whichever side produced them (`SubtitleStream.tsx:96`). They receive the same highlight treatment — surfacing transient error messages with the same "new arrival" cue is desirable.

## Behavior Across Provider Types

| Provider class | Item lifecycle | Highlight behavior |
|---|---|---|
| **Streaming** (OpenAI Realtime, Gemini Live, Palabra, etc.) | Item created → token-by-token deltas → finalized | Span mounts the moment the item first has non-empty text. Animation fires once on mount. Subsequent deltas update the existing span's text — no re-trigger. |
| **Non-streaming** (local provider ASR + Opus-MT / HY-MT, several cloud transcription endpoints) | Item arrives once with complete text | Span mounts with full text. Animation fires once on mount. |
| **Text correction/replacement** (rare; same `item.id`, new text) | Span re-renders with new text content | Same span, no remount → no re-trigger. By design. |

The "first non-empty text" boundary is implicit in today's bucket-building loop: `if (!text) continue;` already drops empty items, so a streaming item only enters a bucket when it has text.

## First-Mount Semantics

When the subtitle window first mounts — either because the user just toggled subtitle mode on, or because the Electron app restarted into a session that already has many history items — the bucket can contain dozens of items at once. Without first-mount suppression, every visible item would animate simultaneously: a screen-wide flicker that is more distracting than informative.

The `isFirstRenderRef` gate ensures every item present in `filtered` during the first render is recorded as `'existing'` and therefore never animates, even on subsequent renders. Items that arrive after first commit are recorded as `'new'` and animate exactly once.

A subtle consequence: if the user *leaves* subtitle mode and re-enters, the `SubtitleStream` component unmounts and remounts. `itemStatesRef` and `isFirstRenderRef` reset. Items already present in the bucket at re-entry are again classified as `'existing'` — they don't animate. This matches the intent ("don't flash a wall of old text").

## Files Affected

| File | Change |
|---|---|
| `src/components/Subtitle/SubtitleStream.tsx` | Bucket shape, render compact spans, item-state refs |
| `src/components/Subtitle/SubtitleStream.scss` | `.subtitle-stream__item` styles, `@keyframes` |
| `src/components/Subtitle/SubtitleApp.tsx` | Add `getHighlightOverlayForBg` (alongside existing `hexToRgba`); inject `--subtitle-highlight-overlay` CSS var |
| `src/components/Subtitle/SubtitleStream.test.tsx` | Update existing assertions, add per-item and first-mount tests |
| `src/components/Subtitle/SubtitleApp.test.tsx` (new file or extend if exists) | Unit-test `getHighlightOverlayForBg` |

Not touched:

- `subtitleStore` — no new persisted settings.
- `DisplaySettingsPopover` — no new controls.
- `ConversationRow` and the expanded subtitle branch.
- Any provider client or audio-pipeline code.
- i18n files.

## Testing

### `SubtitleStream.test.tsx` updates

Existing tests assert that the compact branch joins text into one paragraph per line. These need updating to assert per-item spans.

New tests to add:

- **Per-item rendering in compact mode**: bucket of 3 visible items in one category produces 3 `<span class*="subtitle-stream__item">` children inside the line's `<p>`, in chronological order.
- **First-mount suppression**: render with 3 items present from the start; assert no span carries the `--new` modifier.
- **Subsequent arrival**: render with 2 items, re-render with a third appended; only the third span has `--new`.
- **Stable across text growth (streaming)**: render with an item whose text grows across renders (`'Hello'` → `'Hello world'`); the span retains its state — no toggling of `--new` after the first render that introduced it (or absence of it if first-mount).
- **Bucket cap honored**: existing `BUCKET_MAX_CHARS` behavior unaffected (older items truncated when too many).
- **Existing CSS-var passthrough**: the assertions that `--subtitle-source-color` and `--subtitle-translation-color` flow through stay; add an assertion for `--subtitle-highlight-overlay` set from `SubtitleApp`.

### Helper unit tests

`getHighlightOverlayForBg`:

- Dark hex `#000000` → `rgba(255, 255, 255, 0.3)`.
- Light hex `#ffffff` → `rgba(0, 0, 0, 0.3)`.
- Mid-luminance hex on either side of YIQ 128 → flips as expected.
- Invalid length → safe default (light overlay).

### Manual verification

- Toggle subtitle mode on mid-session — observe no flicker across already-shown items.
- Speak a long sentence with the local provider (HY-MT translation) — observe a clear fade-in + overlay decay on the arriving translation item.
- Speak a short sentence with OpenAI Realtime — observe the streaming text fades in once at item creation and continues to grow without further animation.
- Change `bgColor` from black to white in the settings popover — observe the overlay flip from white-on-dark to dark-on-light on the next item arrival.
- Customize `sourceTextColor` to bright green — observe the overlay still works (it's the background behind the text, not the text color).

## Open Questions Resolved During Brainstorming

| Question | Resolution |
|---|---|
| Apply to non-streaming items only, or to all new items? | All. Uniform across providers; trigger is "item span first mount". |
| Tint with the speaker/participant accent color (green/orange)? | No. User-customizable text colors can clash. Use luminance-inverted neutral overlay. |
| Add a new "highlight color" setting? | No. Keeps surface clean; auto-inverted overlay is good enough for the customization range we expose. |
| What about session-start where many items are already on screen? | Suppress first-mount animation (`isFirstRenderRef`). Only items arriving after first commit animate. |
| Error / system items? | Same highlight. |
| `bgOpacity` very low (transparent subtitle window over an arbitrary backdrop)? | Accepted limitation. Overlay color uses `bgColor` only. |
