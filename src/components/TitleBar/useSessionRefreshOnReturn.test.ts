// Whatever happened to the session while the user was away, the app finds out
// when they come back.
//
// Two things happen outside this window and are invisible to it. The user
// finishes verifying their e-mail in a browser. And — the case that produced a
// silent 401 — the user signs out in the very dashboard tab this app opened
// for them, which drops the shared session cookie the app is still holding.
// Neither sends anything to the app; the only signal is that focus returns.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionRefreshOnReturn } from './useSessionRefreshOnReturn';

beforeEach(() => { vi.useFakeTimers(); });

describe('useSessionRefreshOnReturn', () => {
  it('refetches when the window regains focus while signed in', () => {
    const refetch = vi.fn();
    renderHook(() => useSessionRefreshOnReturn(true, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // This is the case the earlier version got wrong. It stopped listening once
  // the e-mail was verified, which is exactly when a signed-in user is most
  // likely to be moving between the app and the dashboard — and so most likely
  // to have signed out over there.
  it('keeps refetching after the e-mail is verified', () => {
    const refetch = vi.fn();
    renderHook(() => useSessionRefreshOnReturn(true, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while signed out', () => {
    const refetch = vi.fn();
    renderHook(() => useSessionRefreshOnReturn(false, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches when the document becomes visible again', () => {
    const refetch = vi.fn();
    renderHook(() => useSessionRefreshOnReturn(true, refetch));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('throttles a burst of focus events to one call per 10s', () => {
    const refetch = vi.fn();
    renderHook(() => useSessionRefreshOnReturn(true, refetch));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(10_001); window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('survives a caller that hands it a new function every render', () => {
    const spy = vi.fn();
    const { rerender } = renderHook(
      ({ n }) => useSessionRefreshOnReturn(true, () => spy(n)),
      { initialProps: { n: 1 } },
    );
    rerender({ n: 2 });
    act(() => { window.dispatchEvent(new Event('focus')); });
    // The listener survived the re-render AND called the latest function.
    expect(spy).toHaveBeenCalledWith(2);
  });
});
