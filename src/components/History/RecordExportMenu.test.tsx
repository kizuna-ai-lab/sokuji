// A record's export from the transcript the page shows: a file transcript has no conversation behind it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { changeLanguageWithLoad } from '../../locales';
import RecordExportMenu from './RecordExportMenu';
import type { HistoryNotes, HistoryRecord, HistoryTranscriptRow as HistoryTranscript } from '../../lib/history/types';
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
  segmentId: 'file-participant:1', leg: 'participant', side: 'other', speaker: '1', speakerLabel: 'Speaker 1', sideKnown: false, startMs: 5000, endMs: 9000,
  timeKind: 'given', sentences: [{ n: 1, text: 'Welcome.' }, { n: 2, text: 'Let us start.' }], translation: null,
}];

describe("a record's export", () => {
  it('copies and saves a file transcript from its own rows, with no conversation behind it', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RecordExportMenu record={record} legs={[]} rows={rows} transcript={file} />);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    const copy = screen.getByRole('menuitem', { name: 'Copy the conversation' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Speaker 1\n  Welcome. Let us start.'));
  });

  // Owner, 2026-11-18: a saved file says both when its session started and when the file was saved, each under its
  // own name; the file's name stays the session's start.
  it('says when the session started and when the file was saved, and names the file for the start', async () => {
    const EXPORTED = new Date(2026, 1, 3, 18, 30, 0).getTime();
    const { createObjectURL, revokeObjectURL } = URL;
    vi.spyOn(Date, 'now').mockReturnValue(EXPORTED);
    let made: Blob | null = null;
    URL.createObjectURL = ((blob: Blob) => { made = blob; return 'blob:saved'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    const saved: { name: string; blob: Blob }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push({ name: this.download, blob: made! }); });
    try {
      render(<RecordExportMenu record={record} legs={[]} rows={rows} transcript={file} />);
      for (const name of ['Save the conversation (.txt)', 'Save the conversation (.json)']) {
        fireEvent.click(screen.getByRole('button', { name: /Export/ }));
        fireEvent.click(screen.getByRole('menuitem', { name }));
      }
      expect(saved.map((s) => s.name)).toEqual(['sokuji-conversation-20260115-090000.txt', 'sokuji-conversation-20260115-090000.json']);
      const read = (blob: Blob) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob); });
      const [txt, json] = await Promise.all(saved.map((s) => read(s.blob)));
      expect(txt.split('\n').slice(1, 3)).toEqual(['Session started: 2026-01-15 09:00:00', 'Exported: 2026-02-03 18:30:00']);
      expect(JSON.parse(json)).toMatchObject({ sessionStartedAt: new Date(START).toISOString(), exportedAt: new Date(EXPORTED).toISOString() });
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      vi.restoreAllMocks();
    }
  });

  // Owner, 2026-11-17: the conversation's items say they are the conversation, as the subtitles' and the notes' do;
  // and copying comes before saving, the notes' too.
  it('names what each item copies or saves, copying first', () => {
    render(<RecordExportMenu record={record} legs={[]} rows={rows} transcript={file} />);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    const names = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(names.slice(0, 3)).toEqual(['Copy the conversation', 'Save the conversation (.txt)', 'Save the conversation (.json)']);
    const notes = names.filter((n) => /notes/.test(n ?? ''));
    expect(notes).toEqual(['Copy notes', 'Save notes (.md)', 'Save notes (.txt)']);
  });

  // The items stand in one order, each says what it is in the interface's language, and an item for
  // something the record does not have (notes, a recording) stays in its place, unavailable.
  describe('its items', () => {
    const notes = {
      id: 7, recordId: record.id, transcriptId: 2, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Team sync', overview: { text: 'Plans.', format: 'plain' }, topics: [], points: [], names: [] },
    } as unknown as HistoryNotes;
    const withRecording = { ...record, tracks: [{ source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 10, offsetMs: 0, goneAt: null }] } as unknown as HistoryRecord;
    const items = () => screen.getAllByRole('menuitem') as HTMLButtonElement[];
    const open = (r: HistoryRecord, n: HistoryNotes | null) => {
      render(<RecordExportMenu record={r} legs={[]} rows={rows} transcript={file} notes={n} />);
      fireEvent.click(screen.getByRole('button', { name: /Export|导出/ }));
    };
    afterEach(async () => { await changeLanguageWithLoad('en'); });

    it('stand in one order, the record\'s notes and recording among them', () => {
      open(withRecording, notes);
      expect(items().map((m) => m.textContent)).toEqual([
        'Copy the conversation', 'Save the conversation (.txt)', 'Save the conversation (.json)',
        'Save subtitles (.srt)', 'Save subtitles (.vtt)',
        'Copy notes', 'Save notes (.md)', 'Save notes (.txt)', 'Save the recording (.opus)',
      ]);
      expect(items().every((m) => !m.disabled)).toBe(true);
    });

    it('keep their place but are unavailable for notes or a recording the record does not have', () => {
      open(record, null);
      const byName = (name: string) => items().find((m) => m.textContent === name)!;
      for (const name of ['Copy notes', 'Save notes (.md)', 'Save notes (.txt)', 'Save the recording (.opus)']) expect(byName(name).disabled, name).toBe(true);
      expect(byName('Copy the conversation').disabled).toBe(false);
    });

    it('say what they are in the interface\'s language, with no English left in them', async () => {
      await act(async () => { await changeLanguageWithLoad('zh_CN'); });
      open(withRecording, notes);
      for (const name of items().map((m) => m.textContent ?? '')) {
        expect(name.replace(/\.(txt|json|md|opus|srt|vtt)/g, ''), name).not.toMatch(/[A-Za-z]/);
      }
    });
  });
});
