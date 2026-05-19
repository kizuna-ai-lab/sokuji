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

import { __internal__, getRawSnapshot, subscribePlaybackForPort } from './playbackStore';

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
          { currentTime: 1.2347, duration: 2.3459, bufferedTime: 3.4569 },
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
