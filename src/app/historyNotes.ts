// src/app/historyNotes.ts
//
// History's warnings on the panel (the transcript or the recording could not be saved) are about one record. A record
// can fail after the next session has started, or after Clear: its warning is then not about the conversation on
// screen, and is not shown (the failure is still reported to the logs by the writer and the recorder).
import { panelNoteWriter } from '../stores/panelNotesStore';

/** A tell for the writer or the recorder: the warning, shown only while `recordId`'s conversation is on screen. */
export function historyNote(note: { code: string; message: string }, shownRecord: () => string | undefined): (recordId: string) => void {
  return (recordId) => {
    if (shownRecord() !== recordId) return;
    panelNoteWriter()({ severity: 'warning', code: note.code, message: note.message, lifetime: 'transient' });
  };
}
