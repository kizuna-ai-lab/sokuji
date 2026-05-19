import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { getHighlightedChars } from '../lib/playback/highlight';

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

const ENTRY_RESET_THRESHOLD = 0.05; // seconds; matches MainPanel

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

    setProgress(raw) {
      const s = get();
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
      if (s.playingItemId === null) return;

      // Cumulative tracker: when currentTime regresses by more than ENTRY_RESET_THRESHOLD
      // and the last entry had non-zero bufferedTime, the player evicted that entry and
      // started a new one — accumulate the previous entry's bufferedTime into the offset.
      let offset = s._cumOffset;
      if (
        raw.currentTime < s._lastCt - ENTRY_RESET_THRESHOLD &&
        s._lastBt > 0
      ) {
        offset += s._lastBt;
      }
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
  })),
);

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

export function getRawSnapshot(): RawProgress | null {
  return usePlaybackStore.getState()._raw;
}

/**
 * Wire-encoded snapshot of the current playback state, suitable for
 * forwarding over chrome.runtime.Port as the initial state-init payload.
 * Returns null when nothing is playing.
 */
export function getWirePlaybackSnapshot(): PlaybackWire | null {
  const state = usePlaybackStore.getState();
  if (state.playingItemId === null) return null;
  return encodePlaybackForWire(state);
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
  textOverride?: string,
): PlaybackHighlight {
  return usePlaybackStore(
    useShallow((s): PlaybackHighlight => {
      if (!item || s.playingItemId !== item.id) return EMPTY_HIGHLIGHT;
      const originalText = item.formatted?.transcript || item.formatted?.text || '';
      const renderedText = textOverride ?? originalText;
      const segments = item.formatted?.audioSegments;
      const usingSegments = !!(segments && segments.length > 0);

      let highlightedChars: number;
      if (usingSegments) {
        // Segments carry textEnd values indexed against the original transcript.
        // Pass originalText.length so the segment math is correct, then shift by
        // the caller's leading-whitespace strip (if any) and clamp to the
        // rendered text the caller will actually slice.
        const rawIndex = getHighlightedChars(
          s.currentTime ?? 0,
          segments,
          originalText.length,
          s.progressRatio,
        );
        let offset = 0;
        if (textOverride && textOverride !== originalText) {
          const idx = originalText.indexOf(textOverride);
          if (idx > 0) offset = idx;
        }
        highlightedChars = Math.max(0, Math.min(rawIndex - offset, renderedText.length));
      } else {
        // Linear fallback indexes against textLength directly — no offset needed.
        highlightedChars = getHighlightedChars(
          s.currentTime ?? 0,
          undefined,
          renderedText.length,
          s.progressRatio,
        );
      }

      return { isPlaying: true, highlightedChars };
    }),
  );
}
