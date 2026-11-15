// Importing a file and transcribing a record again, on the History screens.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import type { HistoryPort } from '../../lib/history/port';
import type { HistoryRecord } from '../../lib/history/types';
import { createHistoryPageStore, type FileJobs } from '../../lib/history/historyPageStore';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import { FileJobLine, ImportPanel, TranscribePanel, TranscriptChooser } from './FileJobs';

const A = 'run-000a-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
let record: HistoryRecord;

function fakePort() {
  const calls: [string, unknown][] = [];
  const answer = <T,>(name: string, value: () => T) => async (arg?: unknown) => { calls.push([name, arg]); return value(); };
  const port = {
    status: answer('status', () => ({ available: true, dir: '/h' })),
    listRecords: answer('listRecords', () => []),
    usage: answer('usage', () => ({ dbBytes: 0, audioBytes: 0, records: 0, binned: 0 })),
    getRecord: answer('getRecord', () => record),
    getLegs: answer('getLegs', () => []),
    getSentences: answer('getSentences', () => []),
    getSpeakers: answer('getSpeakers', () => []),
  };
  return { port: port as unknown as HistoryPort, calls };
}

function fakeJobs(o: { missing?: 'not-soniox' | 'no-key'; session?: boolean } = {}) {
  const pending: { resolve?: (v: unknown) => void } = {};
  const jobs: FileJobs = {
    service: vi.fn(async () => (o.missing ? { missing: o.missing } : { service: 'soniox' as const, apiKey: 'k', region: 'us' as const })),
    sessionRunning: () => o.session ?? false,
    importFile: vi.fn(() => new Promise((resolve) => { pending.resolve = resolve; })) as FileJobs['importFile'],
    transcribe: vi.fn(() => new Promise((resolve) => { pending.resolve = resolve; })) as FileJobs['transcribe'],
    notesAfterImport: vi.fn(),
  };
  return { jobs, pending };
}

let store: ReturnType<typeof createHistoryPageStore>;
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const show = (ui: React.ReactElement) => render(<HistoryPageContext.Provider value={{ store, onClose: () => {} }}>{ui}</HistoryPageContext.Provider>);
const file = new File([new Uint8Array(4)], 'Team sync.mp4', { type: 'video/mp4' });

beforeEach(() => {
  record = {
    id: A, startedAt: START, endedAt: START + 30 * 60_000, state: 'closed', mode: 'both', myLanguage: 'en', targetLanguage: 'zh', title: null,
    titleByUser: false, binnedAt: null, sentences: 3, hasRecording: true, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 10,
    services: { provider: 'soniox', models: {} }, appVersion: '1', textBytes: 1, legs: [], notes: [],
    tracks: [{ source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 30 * 60_000, bytes: 10, offsetMs: 0, goneAt: null }],
    transcripts: [{ id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: START, sentences: 3 }],
  };
});
afterEach(() => cleanup());

describe('importing a file', () => {
  it('names the service and its stage, asks the language, and starts the import', async () => {
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    const onClose = vi.fn();
    show(<ImportPanel file={file} myLanguage="zh" onClose={onClose} />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Import “Team sync.mp4”' })).toBeTruthy();
    expect(screen.getByText('Transcribed by Soniox, the recognition service in your line-up.')).toBeTruthy();
    expect(screen.getByText('About USD 0.10 an hour of audio, paid with your Soniox key.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Language spoken in it'), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(jobs.importFile).toHaveBeenCalledWith(expect.objectContaining({ file, language: 'ja', myLanguage: 'zh' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says why it cannot start, and cannot be started', async () => {
    for (const [o, text] of [
      [{ missing: 'not-soniox' }, 'Needs Soniox as the recognition service in the line-up.'],
      [{ missing: 'no-key' }, 'Needs a Soniox key in Settings.'],
      [{ session: true }, 'Available when no session is running.'],
    ] as const) {
      const { jobs } = fakeJobs(o);
      store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
      show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
      await settle();
      expect(screen.getByText(text)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
      cleanup();
    }
  });
});

describe('a file job running, and how it ended', () => {
  it('shows the phase with a way to cancel, then the reason it did not finish', async () => {
    const { jobs, pending } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().importFile(file, { language: 'en', myLanguage: 'zh' }); });
    await settle();
    expect(screen.getByText('Importing “Team sync.mp4”: Reading the file')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { pending.resolve!({ recordId: A, transcribed: false, failure: 'NO_KEY' }); await started; });
    expect(screen.getByText('Soniox did not accept the key. Check it in Settings.')).toBeTruthy();
    expect(screen.getByText('The recording was kept. Open the record to transcribe it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(store.getState().jobFailure).toBeNull();
  });
});

describe('transcribing a record again', () => {
  it('says a new version is made and what it costs, and starts it', async () => {
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    await act(() => store.getState().openRecord(A));
    const onClose = vi.fn();
    show(<TranscribePanel onClose={onClose} />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Transcribe again' })).toBeTruthy();
    expect(screen.getByText('The saved recording is transcribed again. A new version is made; the transcripts already here stay.')).toBeTruthy();
    expect(screen.getByText('About USD 0.05, paid with your Soniox key.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(jobs.transcribe).toHaveBeenCalledWith(expect.objectContaining({ recordId: A }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lets another transcript be chosen, newest first', async () => {
    record.transcripts.push({ id: 2, origin: { service: 'soniox', kind: 'file' }, textKind: 'original', createdAt: START + 3_600_000, sentences: 4 });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, fakeJobs().jobs);
    await act(() => store.getState().openRecord(A));
    show(<TranscriptChooser />);
    const select = screen.getByLabelText('Transcript version') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['2', '1']);
    expect(select.options[0].text).toMatch(/^Soniox file · /);
    expect(select.options[1].text).toMatch(/^Live · /);
    fireEvent.change(select, { target: { value: '1' } });
    await settle();
    expect(store.getState().open?.transcriptId).toBe(1);
  });

  it('shows no chooser for a single transcript', async () => {
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, fakeJobs().jobs);
    await act(() => store.getState().openRecord(A));
    show(<TranscriptChooser />);
    expect(screen.queryByLabelText('Transcript version')).toBeNull();
  });
});
