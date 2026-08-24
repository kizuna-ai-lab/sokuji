// src/stores/layoutStore.ts
//
// The settings panel's open/closed state, lifted out of MainLayout so that a
// surface which is not MainLayout — the tour (spec §2.1) — can open the panel
// through the same state the title-bar button uses, instead of synthetically
// clicking that button. Persistence stays where it was: sessionStorage, so a
// reload within the same window keeps the panel as the user left it.
import { create } from 'zustand';

export const SHOW_SETTINGS_SESSION_KEY = 'panelState.showSettings';

/** Reads the persisted panel state directly from sessionStorage. Exported so
 *  the store's initial value and callers that need a fresh read (tests) share
 *  one implementation. */
export function readShowSettingsFromSession(): boolean {
  try {
    return sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSession(value: boolean): void {
  try {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, value ? 'true' : 'false');
  } catch {
    /* sessionStorage unavailable — state still lives in the store */
  }
}

export interface LayoutStore {
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>()((set) => ({
  showSettings: readShowSettingsFromSession(),
  setShowSettings: (value) => {
    writeSession(value);
    set({ showSettings: value });
  },
}));

export const useShowSettings = () => useLayoutStore((s) => s.showSettings);
export const useSetShowSettings = () => useLayoutStore((s) => s.setShowSettings);
