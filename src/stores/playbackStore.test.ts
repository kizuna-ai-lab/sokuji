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
