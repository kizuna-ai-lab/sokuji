import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Entry } from '../../lib/projection/types';
import { TRANSIENT_NOTICE_MS } from '../../lib/view/filter';
import { useVisibleEntries } from './useVisibleEntries';

const notice = (id: string, at: number, lifetime?: 'transient'): Entry =>
  ({ kind: 'notice', id, leg: 'speaker', severity: 'warning', message: id, at, ...(lifetime ? { lifetime } : {}) });

describe('useVisibleEntries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => vi.useRealTimers());

  it('hides a transient notice when its time is up, without anything else changing', () => {
    const entries = [notice('a', 10_000, 'transient'), notice('b', 10_000)];
    const { result } = renderHook(() => useVisibleEntries(entries));
    expect(result.current.map((e) => e.id)).toEqual(['a', 'b']);
    act(() => { vi.advanceTimersByTime(TRANSIENT_NOTICE_MS - 1); });
    expect(result.current.map((e) => e.id)).toEqual(['a', 'b']);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.map((e) => e.id)).toEqual(['b']);
  });

  it('shows a transient notice that arrives later for its own full time', () => {
    const { result, rerender } = renderHook(({ entries }) => useVisibleEntries(entries), { initialProps: { entries: [] as Entry[] } });
    act(() => { vi.advanceTimersByTime(5_000); });
    rerender({ entries: [notice('late', 15_000, 'transient')] });
    act(() => { vi.advanceTimersByTime(TRANSIENT_NOTICE_MS - 1); });
    expect(result.current.map((e) => e.id)).toEqual(['late']);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual([]);
  });

  it('hides at once a transient notice whose time was already up when it reached the surface', () => {
    const { result } = renderHook(() => useVisibleEntries([notice('old', 10_000 - TRANSIENT_NOTICE_MS - 1, 'transient')]));
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toEqual([]);
  });

  it('sets no timer when there is no transient notice', () => {
    renderHook(() => useVisibleEntries([notice('b', 10_000)]));
    expect(vi.getTimerCount()).toBe(0);
  });
});
