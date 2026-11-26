// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from './deadline';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('withDeadline', () => {
  it('resolves untouched before the deadline', async () => {
    const onStuck = vi.fn();
    const p = withDeadline(new Promise<number>((r) => setTimeout(() => r(7), 100)), 1000, 'asr_run', onStuck);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe(7);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it('rejects and calls onStuck once after the deadline', async () => {
    const onStuck = vi.fn();
    const p = withDeadline(new Promise<number>(() => {}), 2500, 'asr_run', onStuck);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await caught).toBe('asr_run did not finish within 2.5 s');
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onStuck).toHaveBeenCalledWith('asr_run');
  });

  it('a late settle after the deadline is ignored', async () => {
    const onStuck = vi.fn();
    let late!: (n: number) => void;
    const p = withDeadline(new Promise<number>((r) => { late = r; }), 1000, 'job', onStuck);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    await caught;
    late(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });
});
