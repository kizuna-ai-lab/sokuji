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
  })),
);
