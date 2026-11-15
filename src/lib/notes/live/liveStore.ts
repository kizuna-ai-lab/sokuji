// src/lib/notes/live/liveStore.ts
//
// The live notes the screen shows: one session's at a time. They live as long as the screen keeps them (until the next
// start or Clear) and are never written to the record (ruling 16).
import { create } from 'zustand';
import type { LiveState } from './state';

export interface LiveNotesView {
  /** The record whose session the notes are of. */
  recordId: string | null;
  state: LiveState | null;
  /** Three updates in a row failed; gone with the next success. */
  hint: boolean;
  /** The loop is running. */
  running: boolean;
  /** Live notes were turned off during the session. */
  off: boolean;
  /** The session ended (the last update is in). */
  ended: boolean;
}

export interface LiveNotesActions {
  begin(recordId: string): void;
  update(state: LiveState): void;
  setHint(shown: boolean): void;
  /** The session ended (its last update is in). */
  end(): void;
  turnedOff(): void;
  /** Clear: the notes on screen go; a running loop goes on. */
  clear(): void;
}

const EMPTY: LiveNotesView = { recordId: null, state: null, hint: false, running: false, off: false, ended: false };

export const useLiveNotes = create<LiveNotesView & LiveNotesActions>((set) => ({
  ...EMPTY,
  begin: (recordId) => set({ ...EMPTY, recordId, running: true }),
  update: (state) => set({ state }),
  setHint: (hint) => set({ hint }),
  end: () => set({ running: false, ended: true, hint: false }),
  turnedOff: () => set({ running: false, off: true, hint: false }),
  clear: () => set((s) => ({ state: null, ended: s.running ? false : s.ended, off: s.running ? false : s.off })),
}));
