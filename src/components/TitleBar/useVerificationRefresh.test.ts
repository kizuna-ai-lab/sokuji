// src/components/TitleBar/useVerificationRefresh.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVerificationRefresh } from './useVerificationRefresh';

beforeEach(() => { vi.useFakeTimers(); });

describe('useVerificationRefresh', () => {
  it('refetches when the window regains focus while unverified', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, false, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch once the e-mail is verified', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, true, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('does not refetch while signed out', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(false, false, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('throttles a burst of focus events to one call per 10s', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, false, refetch));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(10_001); window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
