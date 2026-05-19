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
