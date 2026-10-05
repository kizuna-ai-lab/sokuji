import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_NOTE_CODES, panelNoteWriter, usePanelNotesStore } from './panelNotesStore';

// A clipboard write or a transcript save answers later than the click or the
// run's end that asked for it. By then the conversation may have been cleared
// or another started (PR #598 review): the result belongs to the one that is
// gone, and must not be drawn after the new one.
describe('panelNoteWriter — a result that arrives later than its action', () => {
  beforeEach(() => { usePanelNotesStore.setState({ notes: [] }); });

  const saved = { severity: 'info', code: PANEL_NOTE_CODES.autoSaveSaved, message: 'saved' } as const;

  it('writes while the conversation it was taken in still stands, whatever else was noted meanwhile', () => {
    const write = panelNoteWriter();
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'copied' });
    write(saved);
    expect(usePanelNotesStore.getState().notes.map((n) => n.code)).toEqual(['export_copied', 'autosave_saved']);
  });

  it('drops what it is handed after the notes were cleared', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'copied' });
    const write = panelNoteWriter();
    usePanelNotesStore.getState().clear();
    write(saved);
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });

  it('is ended by a clear that had nothing to remove (a start with no notes)', () => {
    const write = panelNoteWriter();
    usePanelNotesStore.getState().clear();
    write(saved);
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });

  it('a writer taken after the clear writes into the new conversation', () => {
    usePanelNotesStore.getState().clear();
    panelNoteWriter()(saved);
    expect(usePanelNotesStore.getState().notes.map((n) => n.code)).toEqual(['autosave_saved']);
  });
});

describe('panelNotesStore', () => {
  beforeEach(() => { usePanelNotesStore.setState({ notes: [] }); });

  it('appends a note with its own id and time', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'Conversation copied to clipboard', lifetime: 'transient' }, 1000);
    usePanelNotesStore.getState().add({ severity: 'warning', code: PANEL_NOTE_CODES.autoSaveFailed, message: 'auto-save failed', params: { action: 'Download as .txt' } }, 2000);
    const { notes } = usePanelNotesStore.getState();
    expect(notes.map((n) => [n.code, n.at])).toEqual([['export_copied', 1000], ['autosave_failed', 2000]]);
    expect(new Set(notes.map((n) => n.id)).size).toBe(2);
  });

  it('keeps the action on the note', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.autoSaveSaved, message: 'saved', params: { filename: 'a.txt' }, action: { kind: 'show-in-folder', dir: '/d' } });
    expect(usePanelNotesStore.getState().notes[0].action).toEqual({ kind: 'show-in-folder', dir: '/d' });
  });

  it('clear empties it', () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: PANEL_NOTE_CODES.exportCopied, message: 'copied' });
    usePanelNotesStore.getState().clear();
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});
