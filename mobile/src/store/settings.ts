import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { SonioxRegion } from '@shared/lib/soniox/regions';

// What the user chose, kept on the device (Task 3). `source` is a Soniox
// language code or 'auto'; the pair is the desktop's initial pair for Soniox.
export interface Settings {
  source: string;
  target: string;
  region: SonioxRegion;
  bilingual: boolean;
  textSize: 'small' | 'medium' | 'large';
  appearance: 'system' | 'light' | 'dark';
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'auto',
  target: 'en',
  region: 'us',
  bilingual: true,
  textSize: 'medium',
  appearance: 'system',
  keepAwake: true,
};

export interface SettingsState {
  settings: Settings;
  set(partial: Partial<Settings>): void;
}

// Only the keys Settings has survive a read: a stored key from a version that
// no longer exists, or a stray one, is dropped rather than carried along.
function known(stored: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!stored || typeof stored !== 'object') return out;
  const s = stored as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (key in s && typeof s[key] === typeof DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = s[key];
  }
  return out;
}

export function createSettingsStore(storage: StateStorage) {
  return createStore<SettingsState>()(
    persist(
      (set) => ({
        settings: DEFAULT_SETTINGS,
        set: (partial) => set((state) => ({ settings: { ...state.settings, ...partial } })),
      }),
      {
        name: 'sokuji.settings',
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ settings: state.settings }),
        merge: (persisted, current) => ({
          ...current,
          settings: { ...DEFAULT_SETTINGS, ...known((persisted as { settings?: unknown } | undefined)?.settings) },
        }),
      },
    ),
  );
}
