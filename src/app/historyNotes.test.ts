// A record's History warning goes to the panel only while that record's conversation is the one on screen.
import { describe, it, expect, beforeEach } from 'vitest';
import { usePanelNotesStore } from '../stores/panelNotesStore';
import { historyNote } from './historyNotes';

let shown: string | undefined;
beforeEach(() => { usePanelNotesStore.setState({ notes: [], epoch: 0 }); shown = 'run-a'; });

describe("a record's History warning", () => {
  const tell = () => historyNote({ code: 'history_recording_stopped', message: 'The recording of this session stopped.' }, () => shown);

  it("is shown on the record's own conversation", () => {
    tell()('run-a');
    expect(usePanelNotesStore.getState().notes.map((n) => n.code)).toEqual(['history_recording_stopped']);
  });

  it('is not shown on a later session, nor after Clear', () => {
    shown = 'run-b';
    tell()('run-a');
    shown = undefined;
    tell()('run-a');
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});
