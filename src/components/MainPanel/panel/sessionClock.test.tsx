import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { formatDuration, useSessionClock } from './sessionClock';
import type { RunState } from '../../../lib/session/types';

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [61_000, '01:01'],
    [3_661_000, '01:01:01'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('useSessionClock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is null while not running', () => {
    const { result } = renderHook(() => useSessionClock({ phase: 'idle' }));
    expect(result.current).toBeNull();
  });

  it('formats the elapsed time from the given now', () => {
    const run: RunState = { phase: 'running', since: 1_000, legs: {} };
    const { result } = renderHook(() => useSessionClock(run, () => 62_000));
    expect(result.current).toBe('01:01');
  });

  it('re-renders once a second while running', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const run: RunState = { phase: 'running', since: 0, legs: {} };
    const { result } = renderHook(() => useSessionClock(run, () => now));
    expect(result.current).toBe('00:01');

    now = 2_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe('00:02');

    now = 3_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe('00:03');
  });

  it('stops ticking once the run leaves running', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const { result, rerender } = renderHook(
      ({ run }: { run: RunState }) => useSessionClock(run, () => now),
      { initialProps: { run: { phase: 'running', since: 0, legs: {} } as RunState } },
    );
    expect(result.current).toBe('00:01');

    rerender({ run: { phase: 'idle' } });
    expect(result.current).toBeNull();

    now = 5_000;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBeNull();
  });
});
