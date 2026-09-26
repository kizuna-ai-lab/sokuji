import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';

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
