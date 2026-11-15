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

/** Each action that comes from a loop names its record: an answer of a session that has ended changes nothing once the
 *  screen shows another (or none). */
export interface LiveNotesActions {
  begin(recordId: string): void;
  update(recordId: string, state: LiveState): void;
  setHint(recordId: string, shown: boolean): void;
  /** The session ended (its last update is in). */
  end(recordId: string): void;
  turnedOff(recordId: string): void;
  /** Clear: the notes on screen go; a running loop goes on. After the session, nothing is left. */
  clear(): void;
  /** A new run starts: the last session's notes go, and nothing of it lands here any more. */
  reset(): void;
}

const EMPTY: LiveNotesView = { recordId: null, state: null, hint: false, running: false, off: false, ended: false };

export const useLiveNotes = create<LiveNotesView & LiveNotesActions>((set) => {
  /** Applies `change` only while the screen shows `recordId`'s notes. */
  const forRecord = (recordId: string, change: Partial<LiveNotesView>) =>
    set((s) => (s.recordId === recordId ? change : s));
  return {
    ...EMPTY,
    begin: (recordId) => set({ ...EMPTY, recordId, running: true }),
    update: (recordId, state) => forRecord(recordId, { state }),
    setHint: (recordId, hint) => forRecord(recordId, { hint }),
    end: (recordId) => forRecord(recordId, { running: false, ended: true, hint: false }),
    turnedOff: (recordId) => forRecord(recordId, { running: false, off: true, hint: false }),
    clear: () => set((s) => (s.running ? { state: null } : EMPTY)),
    reset: () => set(EMPTY),
  };
});
