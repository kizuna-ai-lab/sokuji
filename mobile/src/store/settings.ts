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
  /** R13: the other side's translation read aloud to me, through headphones. */
  listen: boolean;
  /** A Soniox voice id, or null for the participant default. */
  voice: string | null;
  speed: number;
  /** R14: the microphone's device id, or null for the phone's own. */
  inputDeviceId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'auto',
  target: 'en',
  region: 'us',
  bilingual: true,
  textSize: 'medium',
  appearance: 'system',
  keepAwake: true,
  listen: false,
  voice: null,
  speed: 1,
  inputDeviceId: null,
};

export interface SettingsState {
  settings: Settings;
  set(partial: Partial<Settings>): void;
}

// Only the keys Settings has survive a read: a stored key from a version that
// no longer exists, or a stray one, is dropped rather than carried along.
// The enum-like keys accept their own values only: a stale or corrupted
// 'sepia' would otherwise reach the native appearance API.
const ALLOWED: { [K in keyof Settings]?: readonly Settings[K][] } = {
  appearance: ['system', 'light', 'dark'],
  textSize: ['small', 'medium', 'large'],
  region: ['us', 'eu', 'jp'],
};
function allowed(key: keyof Settings, value: unknown): boolean {
  const set = ALLOWED[key] as readonly unknown[] | undefined;
  if (set) return set.includes(value);
  if (key === 'speed') return typeof value === 'number' && Number.isFinite(value) && value > 0;
  return true;
}

function known(stored: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!stored || typeof stored !== 'object') return out;
  const s = stored as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!(key in s)) continue;
    const value = s[key];
    const fallback = DEFAULT_SETTINGS[key];
    const fits = fallback === null ? value === null || typeof value === 'string' : typeof value === typeof fallback;
    if (fits && allowed(key, value)) (out as Record<string, unknown>)[key] = value;
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

/** React Native's Appearance.setColorScheme value for the setting: 'unspecified' follows the system. */
export type ColorSchemeOverride = 'light' | 'dark' | 'unspecified';

// Never null: Android's AppearanceModule throws on it (a crash at every launch
// with the default setting), while iOS tolerated it.
export function colorSchemeOverride(appearance: Settings['appearance']): ColorSchemeOverride {
  return appearance === 'system' ? 'unspecified' : appearance;
}
