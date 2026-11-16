// src/app/historyNotes.ts
//
// History's warnings on the panel (the transcript or the recording could not be saved) are about one record. A record
// can fail after the next session has started, or after Clear: its warning is then not about the conversation on
// screen, and is not shown (the failure is still reported to the logs by the writer and the recorder).
import type { ConversationSet } from '../lib/session/conversationSet';
import { panelNoteWriter } from '../stores/panelNotesStore';

/** A tell for the writer or the recorder: the warning, shown only while `recordId`'s conversation is on screen. */
export function historyNote(note: { code: string; message: string }, shownRecord: () => string | undefined): (recordId: string) => void {
  return (recordId) => {
    if (shownRecord() !== recordId) return;
    panelNoteWriter()({ severity: 'warning', code: note.code, message: note.message, lifetime: 'transient' });
  };
}

/** The run's phase, as the session's runner state has it. */
type RunPhase = { getState(): { phase: string }; subscribe(listener: (now: { phase: string }, before: { phase: string }) => void): () => void };

/**
 * The record whose conversation is on screen: the run's. Clear keeps the legs (their snapshots still name the run), and
 * a start clears the panel's notes before it replaces the conversation (a refused start never replaces it), so the last
 * record is forgotten at a Clear once the run has ended and as a start begins: no record is on screen until the next
 * run replaces the conversation. A Clear while a run goes on changes nothing: its conversation goes on.
 */
export function shownRecordOf(conversation: Pick<ConversationSet, 'snapshot' | 'onReset'>, state: RunPhase): () => string | undefined {
  const session = () => conversation.snapshot()[0]?.session;
  let forgotten: string | undefined;
  conversation.onReset((reason) => {
    if (reason === 'restart') forgotten = undefined;
    else if (state.getState().phase === 'idle') forgotten = session();
  });
  state.subscribe((now, before) => { if (now.phase === 'starting' && before.phase !== 'starting') forgotten = session(); });
  return () => {
    const now = session();
    return now !== undefined && now === forgotten ? undefined : now;
  };
}
