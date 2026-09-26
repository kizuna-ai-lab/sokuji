import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVirtualClock, every, pinnedRealClock, type Clock } from './clock';

afterEach(() => {
  vi.useRealTimers();
});

describe('createVirtualClock', () => {
  it('starts at the given time and advances', () => {
    const clock = createVirtualClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(250);
    expect(clock.now()).toBe(1250);
  });

  it('fires timers in due order, with now() equal to each due time inside the callback', () => {
    const clock = createVirtualClock();
    const seen: Array<[string, number]> = [];
    clock.setTimeout(() => seen.push(['b', clock.now()]), 200);
    clock.setTimeout(() => seen.push(['a', clock.now()]), 100);
    clock.setTimeout(() => seen.push(['c', clock.now()]), 200);
    clock.advance(300);
    expect(seen).toEqual([['a', 100], ['b', 200], ['c', 200]]);
    expect(clock.now()).toBe(300);
  });

  it('does not fire a cancelled timer', () => {
    const clock = createVirtualClock();
    let fired = false;
    const cancel = clock.setTimeout(() => { fired = true; }, 50);
    cancel();
    clock.advance(100);
    expect(fired).toBe(false);
  });

  it('fires a timer scheduled from inside a callback when it is due within the same advance', () => {
    const clock = createVirtualClock();
    const seen: number[] = [];
    clock.setTimeout(() => {
      seen.push(clock.now());
      clock.setTimeout(() => seen.push(clock.now()), 10);
    }, 10);
    clock.advance(50);
    expect(seen).toEqual([10, 20]);
  });
});

describe('every', () => {
  it('ticks every ms on the clock', () => {
    const clock = createVirtualClock(0);
    const fn = vi.fn();
    every(clock, 100, fn);
    clock.advance(350);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops when cancelled, from outside or from inside a tick', () => {
    const clock = createVirtualClock(0);
    const fn = vi.fn();
    const cancel = every(clock, 100, fn);
    clock.advance(100);
    cancel();
    clock.advance(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    const self = vi.fn();
    const cancelSelf = every(clock, 100, () => {
      self();
      cancelSelf();
    });
    clock.advance(1000);
    expect(self).toHaveBeenCalledTimes(1);
  });

  it('refuses an interval that is not positive', () => {
    const clock = createVirtualClock(0);
    expect(() => every(clock, 0, vi.fn())).toThrow(RangeError);
    expect(() => every(clock, -1, vi.fn())).toThrow(RangeError);
  });

  it('a long advance runs every tick inside it', () => {
    const clock = createVirtualClock(0);
    const fn = vi.fn();
    every(clock, 100, fn);
    // Each tick arms the next inside the same advance; the virtual clock fires
    // a timer a callback scheduled when it falls due within the advance.
    clock.advance(1000);
    expect(fn).toHaveBeenCalledTimes(10);
  });

  // A browser fires every timer a little late (main-thread work, timer
  // granularity). Re-arming a fresh `ms` from each late tick would add that
  // lateness to every later deadline; `setInterval` does not drift, and
  // neither may `every()`.
  it('does not drift when every timer fires late: 600 ticks in 60 s, each on the 100-ms grid', () => {
    const v = createVirtualClock(0);
    const late = 2;
    const clock: Clock = { now: v.now, setTimeout: (fn, ms) => v.setTimeout(fn, ms + late) };
    const at: number[] = [];
    const cancel = every(clock, 100, () => at.push(v.now()));
    // The 600th tick is due at 60 000 ms and fires `late` after it.
    v.advance(60_000 + late);
    cancel();
    expect(at).toHaveLength(600);
    expect(at).toEqual(Array.from({ length: 600 }, (_, k) => (k + 1) * 100 + late));
  });

  it('skips the beats a stall longer than the interval missed: one tick, then back on the grid', () => {
    const v = createVirtualClock(0);
    let arms = 0;
    // The third timer armed (the tick due at 300) stalls 250 ms past its due time.
    const clock: Clock = { now: v.now, setTimeout: (fn, ms) => v.setTimeout(fn, ms + (++arms === 3 ? 250 : 0)) };
    const at: number[] = [];
    const cancel = every(clock, 100, () => at.push(v.now()));
    v.advance(800);
    cancel();
    // 300, 400 and 500 were missed: no burst to catch up, one late tick at
    // 550, and the next on the grid at 600.
    expect(at).toEqual([100, 200, 550, 600, 700, 800]);
  });

  // In the renderer the timers run on a monotonic clock while `realClock.now()`
  // is an integer `Date.now()`: a timer that fires on time can read a
  // millisecond short of its grid point. That early fire is still its beat's
  // tick — reading the phase from `now()` would arm a 1-ms timer and tick the
  // same beat twice (a mostly silent extra frame from the mixer).
  it('never doubles a tick when every timer fires a little early: 600 ticks in 60 s, one per beat', () => {
    const v = createVirtualClock(0);
    const clock: Clock = { now: v.now, setTimeout: (fn, ms) => v.setTimeout(fn, ms > 1 ? ms - 1 : ms) };
    const at: number[] = [];
    const cancel = every(clock, 100, () => at.push(v.now()));
    v.advance(60_000);
    cancel();
    expect(at.length).toBeGreaterThanOrEqual(599);
    expect(at.length).toBeLessThanOrEqual(601);
    const gaps = at.slice(1).map((t, k) => t - at[k]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(99);
  });

  it('a wall clock that jumps backwards keeps ticking about every interval: no gap the size of the jump', () => {
    const v = createVirtualClock(0);
    let offset = 0;
    // `realClock.now()` is `Date.now()`, which a system clock change can move backwards.
    const clock: Clock = { now: () => v.now() + offset, setTimeout: v.setTimeout };
    const at: number[] = [];
    const cancel = every(clock, 100, () => at.push(v.now()));
    v.advance(2_000);
    offset = -10_000;
    v.advance(3_000);
    cancel();
    const after = at.filter((t) => t > 2_000);
    expect(after.length).toBeGreaterThanOrEqual(29);
    expect(after.length).toBeLessThanOrEqual(31);
    const gaps = at.slice(1).map((t, k) => t - at[k]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(200);
  });
});

describe('pinnedRealClock', () => {
  it("keeps an interval on the timers it started with: a fake clock installed afterwards can't reach it, and it keeps ticking on real time", async () => {
    // Captured before any fake install, so this wait is genuinely real even
    // once `vi.useFakeTimers()` swaps out the global `setTimeout`.
    const realSetTimeout = globalThis.setTimeout;
    const fn = vi.fn();
    const cancel = every(pinnedRealClock(), 20, fn);
    // In a `finally`: a failed assertion must not leave a real 20-ms interval
    // ticking for the rest of this file.
    try {
      vi.useFakeTimers();
      // A real wait long enough for the already-pinned tick to fire, and to
      // re-arm, while the fake clock is installed. Built on `realClock`
      // instead, this is the exact moment the interval would hand its next
      // re-arm to whichever `setTimeout` is global right then: the fake one.
      await new Promise((resolve) => realSetTimeout(resolve, 80));
      const callsDuringFake = fn.mock.calls.length;
      expect(callsDuringFake).toBeGreaterThan(0);

      // The fake clock never sees it: advancing it fires nothing further.
      vi.advanceTimersByTime(10_000);
      expect(fn.mock.calls.length).toBe(callsDuringFake);

      vi.useRealTimers();
      // Still alive: it keeps ticking on real time, unharmed by the excursion.
      await new Promise((resolve) => realSetTimeout(resolve, 60));
      expect(fn.mock.calls.length).toBeGreaterThan(callsDuringFake);
    } finally {
      cancel();
    }
  });
});
