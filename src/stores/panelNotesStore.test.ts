import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_NOTE_CODES, usePanelNotesStore } from './panelNotesStore';

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
