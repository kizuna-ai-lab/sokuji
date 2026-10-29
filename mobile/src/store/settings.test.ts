import { describe, it, expect } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { colorSchemeOverride, createSettingsStore, DEFAULT_SETTINGS } from './settings';

// A fake of the async key-value store the phone has: what one store writes,
// a second store on the same storage must read back.
function memoryStorage(initial: Record<string, string> = {}): StateStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (name) => data[name] ?? null,
    setItem: async (name, value) => { data[name] = value; },
    removeItem: async (name) => { delete data[name]; },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('settings store', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const store = createSettingsStore(memoryStorage());
    await settle();
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a change for the next store on the same storage', async () => {
    const storage = memoryStorage();
    const first = createSettingsStore(storage);
    await settle();
    first.getState().set({ target: 'ja' });
    await settle();
    const second = createSettingsStore(storage);
    await settle();
    expect(second.getState().settings.target).toBe('ja');
    expect(second.getState().settings.source).toBe('auto');
  });

  it('ignores unknown keys in what was stored', async () => {
    const stored = JSON.stringify({ state: { settings: { ...DEFAULT_SETTINGS, textSize: 'large', bogus: 1 } }, version: 0 });
    const store = createSettingsStore(memoryStorage({ 'sokuji.settings': stored }));
    await settle();
    expect(store.getState().settings).toEqual({ ...DEFAULT_SETTINGS, textSize: 'large' });
  });
});

// React Native's Appearance.setColorScheme takes 'light' | 'dark' | 'unspecified'
// (follow the system). A null reached Android's native module and crashed the
// app at every launch with the default setting; iOS tolerated it.
describe('colorSchemeOverride', () => {
  it("is 'unspecified', never null, for following the system", () => {
    expect(colorSchemeOverride('system')).toBe('unspecified');
  });

  it('passes an explicit scheme through', () => {
    expect(colorSchemeOverride('light')).toBe('light');
    expect(colorSchemeOverride('dark')).toBe('dark');
  });
});

describe('stored values outside the allowed sets', () => {
  // A corrupted or stale value such as appearance 'sepia' would reach the
  // native appearance API; the enum-like keys keep their defaults instead.
  it('fall back to the defaults', async () => {
    const stored = JSON.stringify({ state: { settings: { ...DEFAULT_SETTINGS, appearance: 'sepia', textSize: 'huge', region: 'mars', speed: -1, target: 'ja' } }, version: 0 });
    const store = createSettingsStore(memoryStorage({ 'sokuji.settings': stored }));
    await settle();
    expect(store.getState().settings).toEqual({ ...DEFAULT_SETTINGS, target: 'ja' });
  });
});
