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
