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
import { PIN_SEPARATOR } from '../../lib/language/order';

/** A language list's two parts, as the source and target lists have them: the likely languages, a line, then all. */
function parts(select: HTMLSelectElement) {
  const values = [...select.options].map((o) => o.value).filter(Boolean);
  const line = values.indexOf(PIN_SEPARATOR);
  expect(line, 'the line between the two parts').toBeGreaterThan(0);
  expect(select.querySelector(`option[value="${PIN_SEPARATOR}"]`)).toBeDisabled();
  return { likely: values.slice(0, line), all: values.slice(line + 1) };
}
import { useSettingsStore } from '../../stores/settingsStore';
import en from '../../locales/en/translation.json';
import zhCN from '../../locales/zh_CN/translation.json';
import zhTW from '../../locales/zh_TW/translation.json';

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

function fakeJobs(o: { missing?: 'no-file-service' | 'hosted-soniox' | 'no-key'; session?: boolean; serviceFails?: boolean } = {}) {
  const pending: { resolve?: (v: unknown) => void; reject?: (e: unknown) => void } = {};
  const jobs: FileJobs = {
    service: vi.fn(async () => {
      if (o.serviceFails) throw new Error('The key store could not be read');
      return o.missing ? { missing: o.missing } : { service: 'soniox' as const, apiKey: 'k', region: 'us' as const, languages: ['en', 'fr', 'ja', 'zh'] };
    }),
    sessionRunning: () => o.session ?? false,
    importFile: vi.fn(() => new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; })) as FileJobs['importFile'],
    transcribe: vi.fn(() => new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; })) as FileJobs['transcribe'],
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
  it('names the service and its stage, asks the languages and the translation, and starts the import', async () => {
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    const onClose = vi.fn();
    show(<ImportPanel file={file} myLanguage="zh" onClose={onClose} />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Import “Team sync.mp4”' })).toBeTruthy();
    expect(screen.getByText('Transcribed by Soniox, with your own key.')).toBeTruthy();
    // With the user's own key there is no price to show (owner, 2026-11-16).
    expect(screen.queryByText(/USD/)).toBeNull();
    // The app's own dropdowns, as every other one, offering the service's languages; the user's language to start.
    const main = screen.getByLabelText<HTMLSelectElement>('Main language');
    const into = screen.getByLabelText<HTMLSelectElement>('Translate into');
    expect(main).toHaveClass('select-dropdown');
    expect(into).toHaveClass('select-dropdown');
    expect([main.value, into.value]).toEqual(['zh', 'zh']);
    // The language chosen and the interface's first, then every language the service has.
    expect(parts(main)).toEqual({ likely: ['zh', 'en'], all: expect.arrayContaining(['en', 'fr', 'ja', 'zh']) });
    expect(parts(main).all).toHaveLength(4);
    expect(parts(into).likely).toEqual(['zh', 'en']);
    fireEvent.change(main, { target: { value: 'ja' } });
    // Other languages it may contain: added one by one, each shown with a way to take it out again; the ones already
    // chosen are not offered.
    const add = screen.getByLabelText<HTMLSelectElement>('Add another language');
    expect(parts(add)).toEqual({ likely: ['zh', 'en'], all: expect.arrayContaining(['en', 'fr', 'zh']) });
    expect(parts(add).all).toHaveLength(3);
    fireEvent.change(add, { target: { value: 'en' } });
    fireEvent.change(add, { target: { value: 'fr' } });
    expect(screen.getByRole('button', { name: 'Remove English' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove French' }));
    expect(screen.queryByRole('button', { name: 'Remove French' })).toBeNull();
    fireEvent.change(into, { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(jobs.importFile).toHaveBeenCalledWith(expect.objectContaining({ file, options: { languages: ['ja', 'en'], translateTo: 'en' }, myLanguage: 'zh' }));
    expect(onClose).toHaveBeenCalled();
    // A file has no sides: no "each side" to choose.
    expect([...into.options].map((o) => o.value)).not.toContain('each-side');
  });

  // B-35 (owner, 2026-11-17): only the reason and what to do, then a link to the setting to change; the line that
  // names the service only when the service can do it.
  it('says the service could not be checked when its languages could not be read, and cannot be started', async () => {
    const { jobs } = fakeJobs();
    // The check that the import can start answers; asking the service for its languages then fails.
    const service = jobs.service as ReturnType<typeof vi.fn>;
    service.mockImplementationOnce(async () => ({ service: 'soniox', apiKey: 'k', region: 'us', languages: ['en', 'zh'] }))
      .mockRejectedValueOnce(new Error('The key store could not be read'));
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
    await settle();
    expect(screen.getByText('The transcription service could not be checked. Close this and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('says why it cannot start and what to do, links to the setting, and cannot be started', async () => {
    for (const [o, text, link, target, serviceLine] of [
      [{ missing: 'no-file-service' }, 'Files are transcribed only by Soniox with your own key. Choose it for transcription in the line-up.', 'Open Languages and line-up', 'lineup', false],
      [{ missing: 'hosted-soniox' }, 'Files are transcribed only with your own Soniox key: Kizuna AI’s Soniox is for live sessions only, for now.', 'Open Languages and line-up', 'lineup', false],
      // The key missing is Soniox's: the link opens Soniox's row, whatever provider the session runs on.
      [{ missing: 'no-key' }, 'Your Soniox key is not filled in yet.', 'Open Accounts and keys', 'provider:soniox', false],
      [{ session: true }, 'Available when no session is running.', null, null, true],
      [{ serviceFails: true }, 'The transcription service could not be checked. Close this and try again.', null, null, false],
    ] as const) {
      useSettingsStore.setState({ settingsNavigationTarget: null });
      const { jobs } = fakeJobs(o);
      store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
      store.getState().follow();
      const onClose = vi.fn();
      show(<ImportPanel file={file} myLanguage="zh" onClose={onClose} />);
      await settle();
      expect(screen.getByText(text)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByText('Transcribed by Soniox, with your own key.') !== null).toBe(serviceLine);
      if (link) {
        fireEvent.click(screen.getByRole('button', { name: link }));
        expect(useSettingsStore.getState().settingsNavigationTarget).toBe(target);
        expect(onClose).toHaveBeenCalled();
      } else {
        expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
      }
      cleanup();
    }
  });

  // With another import or transcription running, the reason has no link: no setting would change it.
  it('says another job is running, with no link to Settings', async () => {
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    act(() => { void store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
    await settle();
    show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Another import or transcription is running.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
    // The service can do it: the line that names it stays.
    expect(screen.getByText('Transcribed by Soniox, with your own key.')).toBeTruthy();
  });

  it('calls the line-up\'s stage "transcription", never "recognition"', () => {
    const texts = (d: { history: { file: Record<string, unknown> } }) => Object.values(d.history.file).filter((v): v is string => typeof v === 'string');
    expect(texts(en).filter((v) => /recogni/i.test(v))).toEqual([]);
    expect(texts(zhCN).filter((v) => v.includes('识别'))).toEqual([]);
    expect(texts(zhTW).filter((v) => v.includes('辨識'))).toEqual([]);
  });
});

describe('a file job running, and how it ended', () => {
  it('shows the phase with a way to cancel, then the reason it did not finish', async () => {
    const { jobs, pending } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
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

describe('the line of a file job, in each case', () => {
  const running = async () => {
    const { jobs, pending } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
    await settle();
    return { jobs, pending, started: () => started };
  };

  it('offers no Cancel while the transcript is written: that step cannot be stopped', async () => {
    const { jobs, pending, started } = await running();
    act(() => { vi.mocked(jobs.importFile).mock.calls[0][0].onProgress?.({ phase: 'writing' }); });
    expect(screen.getByText('Importing “Team sync.mp4”: Writing the transcript')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await act(async () => { pending.resolve!({ recordId: A, transcribed: true }); await started(); });
  });

  it('says a failure on this computer as such, not as the service’s', async () => {
    for (const error of [new Error('SQLITE_FULL'), Object.assign(new Error('closed'), { code: 'RECORD_CLOSED' })]) {
      const { pending, started } = await running();
      await act(async () => { pending.reject!(error); await started(); });
      expect(screen.getByText('It could not be saved on this computer. Try again.')).toBeTruthy();
      expect(screen.queryByText(/Soniox could not transcribe/)).toBeNull();
      cleanup();
    }
  });

  // Each file the import cannot take says why in a sentence of its own (the import keeps nothing of
  // it: importFile.test.ts).
  it('says why a file could not be imported: too long, too large, silent, unreadable', async () => {
    for (const [code, text] of [
      ['TOO_LONG', 'The file is longer than five hours.'],
      ['TOO_BIG', 'The file is larger than 16 GB.'],
      ['NO_AUDIO', 'The file holds no sound.'],
      ['UNSUPPORTED', 'The audio of this file cannot be read. Convert it to AAC or MP3 and import it again.'],
    ] as const) {
      const { pending, started } = await running();
      await act(async () => { pending.reject!(Object.assign(new Error(code), { code })); await started(); });
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByText('The recording was kept. Open the record to transcribe it.')).toBeNull();
      cleanup();
    }
  });

  it('says a recording too long for the service as the recording’s, not a file’s', async () => {
    const { jobs, pending } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(async () => { await store.getState().openRecord(A); });
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().transcribeOpen({ languages: ['en'], translateTo: 'zh' }); });
    await settle();
    await act(async () => { pending.reject!(Object.assign(new Error('too long'), { code: 'TOO_LONG' })); await started; });
    expect(screen.getByText('The recording is longer than five hours, more than Soniox transcribes at once.')).toBeTruthy();
  });
});

describe('transcribing a record again', () => {
  it('says a new version is made, asks the same as an import, and starts it', async () => {
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    const onClose = vi.fn();
    show(<TranscribePanel onClose={onClose} />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Transcribe again' })).toBeTruthy();
    expect(screen.getByText('The saved recording is transcribed again. A new version is made; the transcripts already here stay.')).toBeTruthy();
    expect(screen.queryByText(/USD/)).toBeNull();
    // A session: the other side's language first, the user's among the others, translated into the user's.
    expect(screen.getByLabelText<HTMLSelectElement>('Main language').value).toBe('zh');
    expect(screen.getByRole('button', { name: 'Remove English' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Translate into').value).toBe('en');
    fireEvent.change(screen.getByLabelText('Translate into'), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(jobs.transcribe).toHaveBeenCalledWith(expect.objectContaining({ recordId: A, options: { languages: ['zh', 'en'], translateTo: 'ja' } }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a session with both sides kept: each side into the other\u2019s language, as in the session, unless one is chosen', async () => {
    const leg = (name: 'speaker' | 'participant', source: string, target: string) => ({ leg: name, languages: { source, target }, input: null, inputName: null, inputId: null, translated: true, spoken: false });
    record = {
      ...record, myLanguage: 'en', targetLanguage: 'ja',
      legs: [leg('speaker', 'en', 'ja'), leg('participant', 'ja', 'en')],
      tracks: [...record.tracks, { ...record.tracks[0], source: 'speaker', file: 'speaker.opus' }],
    } as typeof record;
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    const into = screen.getByLabelText<HTMLSelectElement>('Translate into');
    expect(into.value).toBe('each-side');
    expect(into.options[0].textContent).toBe('Each side into the other’s language');
    expect(screen.getByLabelText<HTMLSelectElement>('Main language').value).toBe('ja');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(jobs.transcribe).toHaveBeenLastCalledWith(expect.objectContaining({ options: { languages: ['ja', 'en'], translateTo: 'each-side' } }));
  });

  it('a session whose other side the service cannot translate into offers no "each side"', async () => {
    const leg = (name: 'speaker' | 'participant', source: string, target: string) => ({ leg: name, languages: { source, target }, input: null, inputName: null, inputId: null, translated: true, spoken: false });
    record = {
      ...record, myLanguage: 'en', targetLanguage: 'am',
      legs: [leg('speaker', 'en', 'am'), leg('participant', 'am', 'en')],
      tracks: [...record.tracks, { ...record.tracks[0], source: 'speaker', file: 'speaker.opus' }],
    } as typeof record;
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    const into = screen.getByLabelText<HTMLSelectElement>('Translate into');
    expect([...into.options].map((o) => o.value)).not.toContain('each-side');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    const calls = vi.mocked(jobs.transcribe).mock.calls;
    expect(calls[calls.length - 1][0].options.translateTo).not.toBe('each-side');
  });

  it('a session that said "automatic" starts from languages the service has', async () => {
    record = { ...record, myLanguage: 'auto', targetLanguage: 'auto' };
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    const main = screen.getByLabelText<HTMLSelectElement>('Main language');
    const into = screen.getByLabelText<HTMLSelectElement>('Translate into');
    expect(['en', 'fr', 'ja', 'zh']).toContain(main.value);
    expect(['en', 'fr', 'ja', 'zh']).toContain(into.value);
    expect(screen.queryByText('Auto Detect')).toBeNull();
  });

  it('starts from what the newest file transcript was asked for', async () => {
    record = {
      ...record,
      transcripts: [...record.transcripts, { id: 2, origin: { service: 'soniox', kind: 'file', options: { languages: ['fr'], translateTo: 'ja' } }, textKind: 'original', createdAt: START + 1, sentences: 3 }],
    };
    const { jobs } = fakeJobs();
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('Main language').value).toBe('fr');
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>('Translate into').value).toBe('ja');
  });

  // No setting brings back a recording: the reason stands alone, whatever the line-up's transcription is (B-35 review).
  it('says a record without a recording keeps none, with no link to Settings', async () => {
    record = { ...record, tracks: record.tracks.map((t) => ({ ...t, goneAt: START })) };
    const { jobs } = fakeJobs({ missing: 'hosted-soniox' });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('This record keeps no recording.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the same reason and link as the import when Kizuna AI\'s Soniox transcribes the line-up', async () => {
    useSettingsStore.setState({ settingsNavigationTarget: null });
    const { jobs } = fakeJobs({ missing: 'hosted-soniox' });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Files are transcribed only with your own Soniox key: Kizuna AI’s Soniox is for live sessions only, for now.')).toBeTruthy();
    expect(screen.queryByText('Transcribed by Soniox, with your own key.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open Languages and line-up' }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('lineup');
  });

  it('lets another transcript be chosen, newest first', async () => {
    record.transcripts.push({ id: 2, origin: { service: 'soniox', kind: 'file' }, textKind: 'original', createdAt: START + 3_600_000, sentences: 4 });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, fakeJobs().jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscriptChooser />);
    const select = screen.getByLabelText('Transcript version') as HTMLSelectElement;
    expect(select).toHaveClass('select-dropdown');
    expect([...select.options].map((o) => o.value)).toEqual(['2', '1']);
    expect(select.options[0].text).toMatch(/^Soniox file · /);
    expect(select.options[1].text).toMatch(/^Live · /);
    fireEvent.change(select, { target: { value: '1' } });
    await settle();
    expect(store.getState().open?.transcriptId).toBe(1);
  });

  it('shows no chooser for a single transcript', async () => {
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, fakeJobs().jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscriptChooser />);
    expect(screen.queryByLabelText('Transcript version')).toBeNull();
  });
});
