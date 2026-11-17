// The notes language starts on a sensible default — the first language offered, which is "my language".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '../../locales';
import type { HistoryRecord } from '../../lib/history/types';
import RecordNotes, { type RecordNotesProps } from './RecordNotes';
import { notesLanguagesOf } from './notesLanguages';

const record: HistoryRecord = {
  id: 'run-000a-aaaa', startedAt: 0, endedAt: 60_000, state: 'closed', mode: 'both', myLanguage: 'zh', targetLanguage: 'ja', title: null,
  titleByUser: false, binnedAt: null, sentences: 9, hasRecording: false, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 0,
  services: { provider: 'soniox', models: {} }, appVersion: '1', textBytes: 0, legs: [], tracks: [], transcripts: [], notes: [],
};
const props = (over: Partial<RecordNotesProps> = {}): RecordNotesProps => ({
  record, notes: null, writing: false, tooShort: false, languages: notesLanguagesOf(record, 'en'),
  onWrite: vi.fn(), onCancel: vi.fn(), onShowVersion: vi.fn(), onJump: vi.fn(), onDismissName: vi.fn(),
  explainWith: null, onExplained: vi.fn(), latest: null, ...over,
});
// jsdom has no canvas; the select measures its option labels with one (selectWidth.ts).
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ font: '', measureText: () => ({ width: 10 }) }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the notes language default', () => {
  it('without a change, notes are written in my language of the record', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    expect(screen.getByRole('combobox', { name: 'Language of the notes' })).toHaveValue('zh');
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'zh', name: 'Chinese' });
  });

  it('with my side detected automatically, the default is the interface language', () => {
    const p = props({ languages: notesLanguagesOf({ myLanguage: 'auto', targetLanguage: 'en' }, 'ja') });
    render(<RecordNotes {...p} />);
    expect(screen.getByRole('combobox', { name: 'Language of the notes' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'ja', name: 'Japanese' });
  });
});
