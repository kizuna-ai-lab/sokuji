import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// This store is a leftover of the pre-client-contract session path. Nothing
// writes it any more — the new session lives under `src/app/`. It survives
// only because kept old-provider UI still reads it: `ProviderSpecificSettings`
// (useSessionIsInitializing, useLockedMode) and, through the same imports,
// `ProviderSection` / `LanguageSection` (useLockedMode), which are unmounted
// at run time but still type-checked. Each Stage 2 port that removes one of
// those readers moves this store a step closer to deletion; once the last
// reader is gone, delete the file.
export type LockedFooterMode = 'speaker' | 'participant' | 'both';

interface SessionStore {
  // Footer mode snapshot captured at session start. While non-null the
  // mode picker (and any consumer of "effective mode") reads this so
  // mid-session mute toggles don't visually change the locked mode.
  // Settings panel uses it too to decide which channel sections are
  // editable during the session.
  lockedMode: LockedFooterMode | null;
  isInitializing: boolean;

  // Actions
  setLockedMode: (mode: LockedFooterMode | null) => void;
  setIsInitializing: (initializing: boolean) => void;
}

const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set) => ({
    // Initial state
    lockedMode: null,
    isInitializing: false,

    // Setters
    setLockedMode: (mode) => set({ lockedMode: mode }),
    setIsInitializing: (isInitializing) => set({ isInitializing }),
  }))
);

export const useLockedMode = () => useSessionStore((state) => state.lockedMode);
// Named useSessionIsInitializing to avoid colliding with MainPanel's local
// isInitializing state when both are in scope.
export const useSessionIsInitializing = () => useSessionStore((state) => state.isInitializing);

export default useSessionStore;
