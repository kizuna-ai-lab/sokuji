import { createStore } from 'zustand';

/**
 * Whether a session is running: the main screen reports it, and the screens
 * that lock while it runs (the languages, the microphone, signing out) read it.
 * Its own store, because those screens are routes beside the main screen, not
 * inside it. Kept apart from React Native so the node tests can import it.
 */
export interface SessionState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export function createSessionStore() {
  return createStore<SessionState>((set) => ({
    active: false,
    setActive: (active) => set({ active }),
  }));
}
