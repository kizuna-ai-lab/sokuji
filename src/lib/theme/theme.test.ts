import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  THEME_SETTINGS, THEME_CACHE_KEY, isThemeSetting, resolveScheme, applyScheme,
  registerThemeDocument, installTheme, appliedScheme, subscribeScheme,
  type ThemeSetting, type ThemeSource, type Scheme,
} from './theme';

/** A settings store stand-in: a value, a loaded flag, and listeners. */
function fakeSource(theme: ThemeSetting = 'dark', loaded = true) {
  const listeners = new Set<() => void>();
  const source: ThemeSource & { set(next: ThemeSetting, isLoaded?: boolean): void; listeners: Set<() => void> } = {
    listeners,
    getTheme: () => theme,
    isLoaded: () => loaded,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    set(next, isLoaded = loaded) { theme = next; loaded = isLoaded; for (const l of [...listeners]) l(); },
  };
  return source;
}

/** A `matchMedia` stand-in for `(prefers-color-scheme: dark)`. */
function fakeMedia(matches: boolean) {
  const handlers = new Set<(e: { matches: boolean }) => void>();
  const list = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, h: (e: { matches: boolean }) => void) => { handlers.add(h); }),
    removeEventListener: vi.fn((_: string, h: (e: { matches: boolean }) => void) => { handlers.delete(h); }),
  };
  return {
    matchMedia: vi.fn(() => list as unknown as MediaQueryList),
    list,
    handlers,
    flip(next: boolean) { list.matches = next; for (const h of [...handlers]) h({ matches: next }); },
  };
}

const attr = (doc: Document = document) => doc.documentElement.getAttribute('data-theme');

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveScheme', () => {
  it('resolves system to the OS preference and the two fixed settings to themselves', () => {
    expect(resolveScheme('system', true)).toBe('dark');
    expect(resolveScheme('system', false)).toBe('light');
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
  });

  it('knows the three settings, in the picker\'s order', () => {
    expect(THEME_SETTINGS).toEqual(['system', 'light', 'dark']);
    expect(isThemeSetting('light')).toBe(true);
    expect(isThemeSetting('sepia')).toBe(false);
    expect(isThemeSetting(undefined)).toBe(false);
  });
});

describe('applyScheme', () => {
  it('writes data-theme for light and removes it for dark', () => {
    applyScheme(document, 'light');
    expect(attr()).toBe('light');
    applyScheme(document, 'dark');
    expect(attr()).toBeNull();
  });
});

describe('installTheme', () => {
  it('does not touch the document before the settings have loaded', () => {
    const source = fakeSource('light', false);
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage: null });
    expect(attr()).toBeNull();
  });

  it('applies on load and on every later change', () => {
    const source = fakeSource('light', false);
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage: null });
    source.set('light', true);
    expect(attr()).toBe('light');
    source.set('dark');
    expect(attr()).toBeNull();
    source.set('light');
    expect(attr()).toBe('light');
  });

  it('follows the OS while the setting is system and stops when it is not', () => {
    const source = fakeSource('system');
    const media = fakeMedia(true);
    uninstall = installTheme({ source, matchMedia: media.matchMedia, storage: null });
    expect(attr()).toBeNull();                 // OS dark
    media.flip(false);
    expect(attr()).toBe('light');              // OS light
    source.set('dark');
    expect(attr()).toBeNull();
    expect(media.handlers.size).toBe(0);       // no longer listening
    media.flip(false);
    expect(attr()).toBeNull();                 // and no longer following
  });

  it('mirrors the resolved scheme into storage under sokuji.theme', () => {
    const storage = { setItem: vi.fn() };
    const source = fakeSource('system');
    uninstall = installTheme({ source, matchMedia: fakeMedia(false).matchMedia, storage });
    expect(THEME_CACHE_KEY).toBe('sokuji.theme');
    expect(storage.setItem).toHaveBeenLastCalledWith('sokuji.theme', 'light');
    source.set('dark');
    expect(storage.setItem).toHaveBeenLastCalledWith('sokuji.theme', 'dark');
  });

  it('a throwing storage does not break apply', () => {
    const storage = { setItem: vi.fn(() => { throw new Error('quota'); }) };
    const source = fakeSource('light');
    expect(() => { uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage }); }).not.toThrow();
    expect(attr()).toBe('light');
  });

  // The source is the whole settings store, which changes for every setting:
  // a change that moves neither the setting nor the scheme must not rewrite
  // the documents, the cache, the listeners or Electron's nativeTheme.
  it('a source change that moves neither the setting nor the scheme applies nothing again', () => {
    const onApply = vi.fn();
    const storage = { setItem: vi.fn() };
    const heard = vi.fn();
    const off = subscribeScheme(heard);
    const source = fakeSource('light');
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage, onApply });
    expect(onApply).toHaveBeenCalledTimes(1);
    source.set('light');
    source.set('light');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    source.set('dark');
    expect(onApply).toHaveBeenCalledTimes(2);
    off();
  });

  // System resolving to the same scheme as the fixed setting is still a
  // change Electron must hear: nativeTheme.themeSource moves to 'system'.
  it('a new setting with the same scheme still reports through onApply', () => {
    const onApply = vi.fn();
    const source = fakeSource('dark');
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage: null, onApply });
    source.set('system');
    expect(onApply).toHaveBeenLastCalledWith('system', 'dark');
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it('reports every apply through onApply', () => {
    const onApply = vi.fn();
    const source = fakeSource('system');
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage: null, onApply });
    expect(onApply).toHaveBeenLastCalledWith('system', 'dark');
    source.set('light');
    expect(onApply).toHaveBeenLastCalledWith('light', 'light');
  });

  it('a registered document receives the current scheme at once and later changes', () => {
    const source = fakeSource('light');
    uninstall = installTheme({ source, matchMedia: fakeMedia(true).matchMedia, storage: null });
    const child = document.implementation.createHTMLDocument('child');
    const unregister = registerThemeDocument(child);
    expect(attr(child)).toBe('light');
    source.set('dark');
    expect(attr(child)).toBeNull();
    unregister();
    source.set('light');
    expect(attr(child)).toBeNull();            // detached: untouched
    expect(attr()).toBe('light');
  });

  // A child window opened before the settings load (or after a load that
  // failed) takes the scheme the main document wears, not none.
  it('a document registered before any apply takes the scheme the boot script painted', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const child = document.implementation.createHTMLDocument('child');
    const unregister = registerThemeDocument(child);
    expect(attr(child)).toBe('light');
    unregister();
  });

  it('uninstall stops listening to the source and the media query', () => {
    const source = fakeSource('system');
    const media = fakeMedia(true);
    const stop = installTheme({ source, matchMedia: media.matchMedia, storage: null });
    expect(source.listeners.size).toBe(1);
    expect(media.handlers.size).toBe(1);
    stop();
    expect(source.listeners.size).toBe(0);
    expect(media.handlers.size).toBe(0);
  });
});

// The applied scheme as a value React can subscribe to: a user-coloured
// surface that has no colour stored follows it (conversationDisplayStore).
describe('appliedScheme and subscribeScheme', () => {
  it('reads the document before install, and reports every apply after', () => {
    expect(appliedScheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(appliedScheme()).toBe('light');
    document.documentElement.removeAttribute('data-theme');

    const source = fakeSource('light');
    const heard: Scheme[] = [];
    const off = subscribeScheme(() => heard.push(appliedScheme()));
    uninstall = installTheme({ source, matchMedia: fakeMedia(false).matchMedia, storage: null });
    expect(heard).toEqual(['light']);
    source.set('dark');
    expect(heard).toEqual(['light', 'dark']);
    off();
    source.set('light');
    expect(heard).toEqual(['light', 'dark']);
    expect(appliedScheme()).toBe('light');
  });
});
