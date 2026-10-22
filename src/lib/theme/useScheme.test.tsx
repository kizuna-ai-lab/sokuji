import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useScheme } from './useScheme';
import { installTheme, type ThemeSetting, type ThemeSource } from './theme';

function fakeSource(theme: ThemeSetting) {
  const listeners = new Set<() => void>();
  const source: ThemeSource & { set(next: ThemeSetting): void } = {
    getTheme: () => theme,
    isLoaded: () => true,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    set(next) { theme = next; for (const l of [...listeners]) l(); },
  };
  return source;
}

const matchMedia = vi.fn(() => ({
  matches: false,
  media: '(prefers-color-scheme: dark)',
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as MediaQueryList);

let uninstall: (() => void) | null = null;
afterEach(() => {
  cleanup();
  uninstall?.();
  uninstall = null;
  document.documentElement.removeAttribute('data-theme');
});

describe('useScheme', () => {
  it('is the applied scheme, and re-renders on every apply', () => {
    const { result } = renderHook(() => useScheme());
    expect(result.current).toBe('dark');

    const source = fakeSource('light');
    act(() => { uninstall = installTheme({ source, matchMedia, storage: null }); });
    expect(result.current).toBe('light');

    act(() => { source.set('dark'); });
    expect(result.current).toBe('dark');
  });

  it('starts from a scheme the boot script already painted', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useScheme());
    expect(result.current).toBe('light');
  });
});
