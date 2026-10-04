import { describe, expect, it } from 'vitest';
import type { Entry } from '../projection/types';
import { nextNoticeExpiry, TRANSIENT_NOTICE_MS, visibleEntries } from './filter';
import { isPanelNoteId, PANEL_NOTE_ID_PREFIX, panelNoteEntries } from './panelNotes';
import type { PanelNote } from '../../stores/panelNotesStore';

const note = (over: Partial<PanelNote> = {}): PanelNote => ({
  id: 'n1', at: 5000, severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient', ...over,
});

describe('panelNoteEntries', () => {
  it('turns a note into a notice entry on the speaker leg, with a prefixed id', () => {
    const [entry] = panelNoteEntries([note({ params: { filename: 'a.txt' } })]);
    expect(entry).toEqual({
      kind: 'notice', id: `${PANEL_NOTE_ID_PREFIX}n1`, leg: 'speaker', severity: 'info', message: 'copied',
      code: 'export_copied', params: { filename: 'a.txt' }, lifetime: 'transient', at: 5000,
    });
    expect(isPanelNoteId(entry.id)).toBe(true);
    expect(isPanelNoteId('speaker:n:3')).toBe(false);
  });

  it('returns the same array for the same notes, so memoized lists keep their items', () => {
    const notes = [note()];
    expect(panelNoteEntries(notes)).toBe(panelNoteEntries(notes));
  });

  // Review Focus 4: a note and an L1 transient notice hide each at its own time.
  it('hides with the conversation\'s transient rule, the earliest expiry first', () => {
    const l1: Entry = { kind: 'notice', id: 'speaker:n:1', leg: 'speaker', severity: 'warning', message: 'm', code: 'mic_lost_using_other', lifetime: 'transient', at: 1000 };
    const merged = [l1, ...panelNoteEntries([note({ at: 4000 })])];
    expect(nextNoticeExpiry(merged, 0)).toBe(1000 + TRANSIENT_NOTICE_MS);
    expect(visibleEntries(merged, 1000 + TRANSIENT_NOTICE_MS).map((e) => e.id)).toEqual([`${PANEL_NOTE_ID_PREFIX}n1`]);
    expect(visibleEntries(merged, 4000 + TRANSIENT_NOTICE_MS)).toEqual([]);
  });

  it('a note without a lifetime stays', () => {
    const merged = panelNoteEntries([note({ lifetime: undefined, code: 'autosave_saved' })]);
    expect(visibleEntries(merged, 10 ** 12)).toHaveLength(1);
  });
});
