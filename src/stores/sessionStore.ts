import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// This store is a leftover of the pre-client-contract session path. Nothing
// writes it any more — the new session lives under `src/app/`. It survives
// only because the old settings shell, kept for Local Native until
// kizuna-ai-lab/sokuji#578 (Stage 2 deletion, ruling 1), still reads its
// locked mode: `ProviderSpecificSettings`, `ProviderSection` and
// `LanguageSection` (useLockedMode), unmounted at run time but still
// type-checked. When #578 ports Local Native, delete the file.
export type LockedFooterMode = 'speaker' | 'participant' | 'both';

interface SessionStore {
  // Footer mode snapshot captured at session start. While non-null the
  // mode picker (and any consumer of "effective mode") reads this so
  // mid-session mute toggles don't visually change the locked mode.
  // Settings panel uses it too to decide which channel sections are
  // editable during the session.
  lockedMode: LockedFooterMode | null;

  // Actions
  setLockedMode: (mode: LockedFooterMode | null) => void;
}

const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set) => ({
    // Initial state
    lockedMode: null,

    // Setters
    setLockedMode: (mode) => set({ lockedMode: mode }),
  }))
);

export const useLockedMode = () => useSessionStore((state) => state.lockedMode);

export default useSessionStore;
