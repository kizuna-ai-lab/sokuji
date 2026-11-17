// The window narrowing below 768 px and widening again, as the toolbar's live notes switch follows it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNarrowWindow } from './useNarrowWindow';

/** A window whose width the test sets. */
function windowOf(width: number) {
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const matches = (q: string) => Number(/max-width:\s*(\d+)px/.exec(q)?.[1]) >= state.width;
  const state = { width };
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return {
      media: query,
      get matches() { return matches(query); },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
  });
  return { queries, listeners, resize: (w: number) => { state.width = w; for (const l of [...listeners]) l(); } };
}

afterEach(() => vi.unstubAllGlobals());

describe('a narrow window', () => {
  it('is narrow below 768 px and wide from 768 px', () => {
    windowOf(767);
    expect(renderHook(() => useNarrowWindow()).result.current).toBe(true);
    windowOf(768);
    expect(renderHook(() => useNarrowWindow()).result.current).toBe(false);
  });

  it('follows the window as it is narrowed to a phone\'s width and widened again, and stops listening when gone', () => {
    const win = windowOf(1280);
    const { result, unmount } = renderHook(() => useNarrowWindow());
    expect(result.current).toBe(false);
    act(() => win.resize(390));
    expect(result.current).toBe(true);
    act(() => win.resize(1024));
    expect(result.current).toBe(false);
    unmount();
    expect(win.listeners.size).toBe(0);
  });
});
