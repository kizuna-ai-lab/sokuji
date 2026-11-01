import { useStore } from 'zustand';
import { createSessionStore } from './session';

export const sessionStore = createSessionStore();

/** True while a session runs (see store/session.ts). */
export function useSessionActive(): boolean {
  return useStore(sessionStore, (s) => s.active);
}
