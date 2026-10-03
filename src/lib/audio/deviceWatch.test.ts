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

  it('polls while shouldPoll says so, and stops polling when it does not', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    let displaced = true;
    watchDevices({ sync, mediaDevices: target, shouldPoll: () => displaced, pollMs: 3000 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    displaced = false;
    await vi.advanceTimersByTimeAsync(9000);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('a poll shares the single flight with devicechange', async () => {
    const target = devices();
    let finish!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    watchDevices({ sync, mediaDevices: target, delayMs: 10, shouldPoll: () => true, pollMs: 100 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(sync).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('tells the sync what asked for it: a devicechange run is "change", a poll run is "poll"', async () => {
    const target = devices();
    const sync = vi.fn(async (_reason: 'change' | 'poll') => {});
    watchDevices({ sync, mediaDevices: target, delayMs: 10, shouldPoll: () => true, pollMs: 100 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync.mock.calls).toEqual([['change']]);
    await vi.advanceTimersByTimeAsync(90);
    expect(sync.mock.calls).toEqual([['change'], ['poll']]);
  });

  it('makes the trailing run "change" when a change arrives during a poll\'s flight, and a later poll does not undo it', async () => {
    const target = devices();
    let finish!: () => void;
    const sync = vi.fn((_reason: 'change' | 'poll') => new Promise<void>((resolve) => { finish = resolve; }));
    watchDevices({ sync, mediaDevices: target, delayMs: 10, shouldPoll: () => true, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(sync.mock.calls).toEqual([['poll']]);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    // The next poll beat lands in the same flight, after the change.
    await vi.advanceTimersByTimeAsync(90);
    expect(sync).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.mock.calls).toEqual([['poll'], ['change']]);
  });

  it('stops polling when unwatched', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    const unwatch = watchDevices({ sync, mediaDevices: target, shouldPoll: () => true, pollMs: 100 });
    unwatch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).not.toHaveBeenCalled();
  });
});
