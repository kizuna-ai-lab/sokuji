import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, every } from './clock';

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
});
