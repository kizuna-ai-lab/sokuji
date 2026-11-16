// A record's export from the transcript the page shows: a file transcript has no conversation behind it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '../../locales';
import RecordExportMenu from './RecordExportMenu';
import type { HistoryRecord, HistoryTranscriptRow as HistoryTranscript } from '../../lib/history/types';
import type { RecordRow } from '../../lib/history/recordView';

afterEach(() => cleanup());

const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
const file: HistoryTranscript = { id: 2, origin: { service: 'soniox', kind: 'file' }, textKind: 'original', createdAt: START + 60_000, sentences: 2 };
const record = {
  id: 'import-1', startedAt: START, endedAt: START + 60_000, state: 'closed', mode: 'import', myLanguage: 'en', targetLanguage: 'en', title: 'Team sync',
  titleByUser: false, binnedAt: null, sentences: 2, hasRecording: true, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 10,
  services: { provider: 'soniox', models: { transcription: 'stt-async-v6' } }, appVersion: '1', textBytes: 1, legs: [], notes: [], tracks: [], transcripts: [file],
} as unknown as HistoryRecord;
const rows: RecordRow[] = [{
  segmentId: 'file-participant:1', leg: 'participant', side: 'other', speaker: '1', speakerLabel: 'Speaker 1', startMs: 5000, endMs: 9000,
  timeKind: 'given', sentences: [{ n: 1, text: 'Welcome.' }, { n: 2, text: 'Let us start.' }], translation: null,
}];

describe("a record's export", () => {
  it('copies and saves a file transcript from its own rows, with no conversation behind it', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RecordExportMenu record={record} legs={[]} rows={rows} transcript={file} />);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    const copy = screen.getByRole('menuitem', { name: 'Copy text' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Speaker 1\n  Welcome. Let us start.'));
  });
});
