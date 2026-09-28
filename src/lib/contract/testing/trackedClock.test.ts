import { describe, it, expect, vi } from 'vitest';
import { every } from '../clock';
import { trackedClock } from './trackedClock';

describe('trackedClock', () => {
  it('counts a timer while it is pending, and not once it fired or was cancelled', () => {
    const { clock, timers } = trackedClock();
    const fired = vi.fn();
    const cancel = clock.setTimeout(fired, 100);
    clock.setTimeout(fired, 50);
    expect(timers()).toBe(2);
    clock.advance(50);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(timers()).toBe(1);
    cancel();
    expect(timers()).toBe(0);
    clock.advance(100);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("counts an interval's armed tick, and none once it is stopped", () => {
    const { clock, timers } = trackedClock();
    const stop = every(clock, 80, () => {});
    clock.advance(400);
    expect(timers()).toBe(1);
    stop();
    expect(timers()).toBe(0);
    expect(clock.now()).toBe(400);
  });
});
