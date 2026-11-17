// src/lib/notes/live/liveStore.ts
//
// The live notes the screen shows: one session's at a time. They live as long as the screen keeps them (until the next
// start or Clear) and are never written to the record (ruling 16).
import { create } from 'zustand';
import type { NotesUsage } from '../chat';
import type { NotesUsed } from '../notesPricing';
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
  /** What History said of the session once it closed it: not yet, it is there, it did not keep it, or it could not
   *  tell (its writes were given up and it did not close it). */
  history: 'pending' | 'kept' | 'notKept' | 'unknown';
  /** Full notes are being written for the session (decided when History closed it). */
  fullNotes: boolean;
  /** Kizuna AI stopped the live notes for the account (`relayChat`'s code: no-balance, daily-limit…), or null. */
  stopped: string | null;
  /** What this session's live notes have used so far (Kizuna AI reports it). */
  used: NotesUsed;
  /** The balance after the last live notes call, in µUSD; null until one is known. */
  balanceMicroUsd: number | null;
}

/** Each action that comes from a loop names its record: an answer of a session that has ended changes nothing once the
 *  screen shows another (or none). */
export interface LiveNotesActions {
  begin(recordId: string): void;
  update(recordId: string, state: LiveState): void;
  setHint(recordId: string, shown: boolean): void;
  /** The session ended (its last update is in). */
  end(recordId: string): void;
  /** History closed the session: whether it kept it (null: not known), and whether full notes are being written for it. */
  closed(recordId: string, o: { kept: boolean | null; fullNotes: boolean }): void;
  turnedOff(recordId: string): void;
  /** Kizuna AI refused for the account: the loop stopped for good. */
  stoppedFor(recordId: string, why: string): void;
  /** An update's usage, added to the session's. */
  addUsage(recordId: string, usage: NotesUsage): void;
  /** The balance after a call. */
  balanceAfter(recordId: string, microUsd: number): void;
  /** Turned on again in the same session: the notes on screen stay, and go on. */
  resume(recordId: string): void;
  /**
   * Clear: during a session the notes stay, as does their loop (the captions alone go); after it, nothing is left, and
   * a last update still on its way lands nowhere. Whether the session runs is the runner's to say: after Stop the loop
   * runs on until its last update is back.
   */
  clear(sessionRunning: boolean): void;
  /** A new run starts: the last session's notes go, and nothing of it lands here any more. */
  reset(): void;
}

const EMPTY: LiveNotesView = { recordId: null, state: null, hint: false, running: false, off: false, ended: false, history: 'pending', fullNotes: false, stopped: null,
  used: { input: 0, cached: 0, output: 0 }, balanceMicroUsd: null };

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
    closed: (recordId, o) => forRecord(recordId, {
      history: o.kept === null ? 'unknown' : o.kept ? 'kept' : 'notKept',
      fullNotes: o.kept === true && o.fullNotes,
    }),
    turnedOff: (recordId) => forRecord(recordId, { running: false, off: true, hint: false }),
    stoppedFor: (recordId, why) => forRecord(recordId, { running: false, stopped: why, hint: false }),
    addUsage: (recordId, usage) => set((s) => (s.recordId === recordId ? {
      used: {
        input: s.used.input + usage.prompt_tokens,
        cached: s.used.cached + (usage.prompt_tokens_details?.cached_tokens ?? 0),
        output: s.used.output + usage.completion_tokens,
      },
    } : s)),
    balanceAfter: (recordId, balanceMicroUsd) => forRecord(recordId, { balanceMicroUsd }),
    // A new loop: an earlier stop for the account is forgotten (a refusal stops this one too, and says so again).
    resume: (recordId) => forRecord(recordId, { running: true, off: false, hint: false, stopped: null }),
    // Clear empties the captions. During a session the live notes stay: they are the whole meeting's, and the loop
    // would bring them back with its next update anyway (owner, 2026-11-17). After the session they go with Clear.
    clear: (sessionRunning) => set((s) => (sessionRunning ? s : EMPTY)),
    reset: () => set(EMPTY),
  };
});
