import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchDevices } from './deviceWatch';

const devices = () => new EventTarget() as unknown as Pick<MediaDevices, 'addEventListener' | 'removeEventListener'> & EventTarget;
const change = (target: EventTarget) => target.dispatchEvent(new Event('devicechange'));

describe('watchDevices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('syncs once after a burst of changes settles', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    watchDevices({ sync, mediaDevices: target, delayMs: 500 });
    change(target);
    await vi.advanceTimersByTimeAsync(200);
    change(target);
    change(target);
    await vi.advanceTimersByTimeAsync(499);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('runs one sync at a time, and a change during a sync queues exactly one more', async () => {
    const target = devices();
    let finish!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(1);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('stops listening when unwatched, a pending sync included', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    const unwatch = watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    unwatch();
    await vi.advanceTimersByTimeAsync(50);
    change(target);
    await vi.advanceTimersByTimeAsync(50);
    expect(sync).not.toHaveBeenCalled();
  });

  it('survives a sync that throws', async () => {
    const target = devices();
    const sync = vi.fn(async () => { throw new Error('boom'); });
    watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('does nothing where there are no media devices', () => {
    expect(() => watchDevices({ sync: vi.fn(), mediaDevices: undefined })()).not.toThrow();
  });
});
