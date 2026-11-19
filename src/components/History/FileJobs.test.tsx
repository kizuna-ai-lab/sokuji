// Importing a file and transcribing a record again, on the History screens.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import type { HistoryPort } from '../../lib/history/port';
import type { HistoryRecord } from '../../lib/history/types';
import { createHistoryPageStore, type FileJobs } from '../../lib/history/historyPageStore';
import type { HostedFileTerms } from '../../lib/history/file/hostedFile';
import type { AccountState } from '../../lib/session/types';
import { useAccountStore } from '../../stores/accountStore';
import { openExternalUrl } from '../../utils/openExternalUrl';
import i18n from '../../locales';
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
import he from '../../locales/he/translation.json';

vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));

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

/** Kizuna AI's published terms: 4 hours at most, $0.20 an hour, $0.32 translated. */
const TERMS: HostedFileTerms = { usdPerHour: 0.2, translatedUsdPerHour: 0.32, maxAudioMs: 14_400_000, maxBytes: 100_663_296, maxBytesPerMs: 8, bytesSlack: 65_536 };
/** Kizuna AI's Soniox as the line-up's transcription, signed in. */
const HOSTED = {
  service: 'kizunaai_soniox' as const, hosted: true as const, region: 'jp', languages: ['en', 'fr', 'ja', 'zh'],
  access: { apiUrl: 'https://service.example/api', token: async () => 'tok' },
};

function fakeJobs(o: {
  missing?: 'no-file-service' | 'no-key' | 'sign-in'; session?: boolean; serviceFails?: boolean;
  /** Kizuna AI's Soniox, with these terms (none: it has no file jobs yet; an Error: they cannot be read). */
  hosted?: boolean; terms?: HostedFileTerms | null | Error;
} = {}) {
  const pending: { resolve?: (v: unknown) => void; reject?: (e: unknown) => void } = {};
  const jobs: FileJobs = {
    service: vi.fn(async () => {
      if (o.serviceFails) throw new Error('The key store could not be read');
      if (o.missing) return { missing: o.missing };
      return o.hosted ? HOSTED : { service: 'soniox' as const, apiKey: 'k', region: 'us' as const, languages: ['en', 'fr', 'ja', 'zh'] };
    }),
    hostedTerms: vi.fn(async () => {
      if (o.terms instanceof Error) throw o.terms;
      return o.terms === undefined ? TERMS : o.terms;
    }),
    // As the app reads it: the account the title bar shows, read again through the app's account.
    account: () => useAccountStore.getState().account,
    refreshAccount: async () => { await useAccountStore.getState().refreshAccount?.(); },
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
afterEach(() => {
  cleanup();
  useAccountStore.setState({ account: null, refreshAccount: null });
  vi.mocked(openExternalUrl).mockClear();
});

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
      [{ missing: 'no-file-service' }, 'Files are transcribed only by Soniox. Choose it for transcription in the line-up.', 'Open Languages and line-up', 'lineup', false],
      // Kizuna AI's Soniox signed out: the link opens the Kizuna AI account's row.
      [{ missing: 'sign-in' }, 'Sign in to Kizuna AI to transcribe files with it.', 'Open Accounts and keys', 'user-account', false],
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
    const { jobs } = fakeJobs({ missing: 'sign-in' });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('This record keeps no recording.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the same reason and link as the import when Kizuna AI\'s Soniox transcribes the line-up signed out', async () => {
    useSettingsStore.setState({ settingsNavigationTarget: null });
    const { jobs } = fakeJobs({ missing: 'sign-in' });
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Sign in to Kizuna AI to transcribe files with it.')).toBeTruthy();
    expect(screen.queryByText('Transcribed by Soniox, with your own key.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open Accounts and keys' }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
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

describe('through Kizuna AI’s Soniox', () => {
  const HOUR = 3_600_000;
  const SERVICE_HOSTED = 'Transcribed by Soniox through Kizuna AI, paid from your balance.';
  const SERVICE_OWN_KEY = 'Transcribed by Soniox, with your own key.';
  const ACCOUNTS = 'Open Accounts and keys';
  const TOO_LONG = 'This recording is longer than Kizuna AI transcribes at once (4 hours). Contact us and we will help:';
  const CHARGED = 'Soniox is already transcribing: cancelling now is still charged.';
  const known = (balanceMicroUsd: number, over: Partial<Extract<AccountState, { status: 'known' }>> = {}): AccountState =>
    ({ status: 'known', balanceMicroUsd, frozen: false, ...over });
  /** A member of the organization Acme, which pays (the own-balance switch is off). */
  const member = (o: { frozen?: boolean; role?: 'owner' | 'member' } = {}): AccountState => known(10_000_000, {
    organization: { name: 'Acme', availableMicroUsd: 10_000_000, frozen: o.frozen ?? false, role: o.role ?? 'member' },
    personal: { balanceMicroUsd: 10_000_000, frozen: false },
  });
  /** The record keeps one recording this long (6 bytes a millisecond, as kept at 48 kbit/s). */
  const keeping = (durationMs: number) => { record = { ...record, tracks: [{ ...record.tracks[0], durationMs, bytes: durationMs * 6 }] }; };
  const pageWith = (jobs: FileJobs) => {
    store = createHistoryPageStore(fakePort().port, createVirtualClock(0), () => 'x', null, jobs);
    store.getState().follow();
  };
  const hosted = (o: Parameters<typeof fakeJobs>[0] = {}) => {
    const f = fakeJobs({ hosted: true, ...o });
    pageWith(f.jobs);
    return f;
  };
  const translateInto = (code: string) => fireEvent.change(screen.getByLabelText('Translate into'), { target: { value: code } });
  /** The estimate as shown: the price set apart from the words around it (U+2068 … U+2069), as right-to-left text needs. */
  const about = (price: string) => `About \u2068${price}\u2069.`;

  // The line names who pays: an organization that pays is not called the user's own balance.
  it('says the organization pays when it does, and the user when the organization does not', async () => {
    useAccountStore.setState({ account: member() });
    hosted();
    show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
    await settle();
    expect(screen.getByText("Transcribed by Soniox through Kizuna AI, paid from your organization's balance.")).toBeTruthy();
    expect(screen.queryByText(SERVICE_HOSTED)).toBeNull();
  });

  it('names Kizuna AI as the service in both panels, and what a transcription is estimated to cost as the options change', async () => {
    useAccountStore.setState({ account: known(10_000_000) });
    keeping(HOUR);
    hosted();
    show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
    await settle();
    expect(screen.getByText(SERVICE_HOSTED)).toBeTruthy();
    expect(screen.queryByText(SERVICE_OWN_KEY)).toBeNull();
    // An import's length is not known before the file is read: no estimate.
    expect(screen.queryByText(/^About /)).toBeNull();
    cleanup();

    // Transcribed before in Chinese and translated into Chinese, as an import starts: nothing to translate, so the
    // translation is not asked for, nor paid for (owner, 2026-11-19).
    const asked = { languages: ['zh'], translateTo: 'zh' };
    record = { ...record, transcripts: [...record.transcripts, { id: 2, origin: { service: 'kizunaai_soniox', kind: 'file', options: asked }, textKind: 'original', createdAt: START + 1, sentences: 3 }] };
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText(SERVICE_HOSTED)).toBeTruthy();
    expect(screen.queryByText(SERVICE_OWN_KEY)).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>('Main language').value).toBe('zh');
    expect(screen.getByLabelText<HTMLSelectElement>('Translate into').value).toBe('zh');
    expect(screen.getByText(about('$0.20'))).toBeTruthy();
    translateInto('ja');
    await settle();
    expect(screen.getByText(about('$0.32'))).toBeTruthy();
    expect(screen.queryByText(about('$0.20'))).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  // A price asked for other choices is never shown beside these.
  it('drops the price shown as soon as the options change, until the new one is known; none when there is none', async () => {
    useAccountStore.setState({ account: known(10_000_000) });
    keeping(HOUR);
    hosted();
    await act(() => store.getState().openRecord(A));
    const answers: Array<(amount: number | null) => void> = [];
    store.setState({ fileEstimate: vi.fn(() => new Promise<number | null>((resolve) => { answers.push(resolve); })) });
    /** Answers the estimate asked for last, as the options are now. */
    const answer = (amount: number | null) => act(async () => { answers[answers.length - 1](amount); });
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    await answer(0.2);
    expect(screen.getByText(about('$0.20'))).toBeTruthy();
    translateInto('ja');
    await settle();
    expect(screen.queryByText(/^About /)).toBeNull();
    await answer(0.32);
    expect(screen.getByText(about('$0.32'))).toBeTruthy();
    translateInto('fr');
    await settle();
    await answer(null);
    expect(screen.queryByText(/^About /)).toBeNull();
  });

  // In a right-to-left language the dollar sign stays with its digits.
  it('sets the price apart from the words around it in a right-to-left language', async () => {
    useAccountStore.setState({ account: known(10_000_000) });
    keeping(HOUR);
    hosted();
    await act(() => store.getState().openRecord(A));
    i18n.addResourceBundle('he', 'translation', he, true, true);
    await act(async () => { await i18n.changeLanguage('he'); });
    try {
      show(<TranscribePanel onClose={() => {}} />);
      await settle();
      expect(screen.getByText(he.history.file.estimate.replace('{{price}}', '\u2068$0.32\u2069'))).toBeTruthy();
    } finally {
      cleanup();
      await act(async () => { await i18n.changeLanguage('en'); });
    }
  });

  it('shows no estimate with the user’s own key', async () => {
    keeping(HOUR);
    pageWith(fakeJobs().jobs);
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText(SERVICE_OWN_KEY)).toBeTruthy();
    expect(screen.queryByText(/^About /)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  // Each reason Kizuna AI's service gives before Start, with what to do about it (B-35): the Kizuna AI account's row for
  // what the account can change.
  for (const [name, setup, text] of [
    ['no balance', { account: known(0) }, 'Your Kizuna AI balance does not cover this transcription.'],
    ['a frozen wallet', { account: known(10_000_000, { frozen: true }) }, 'Your Kizuna AI wallet is frozen.'],
    // The organization pays: its own notice, as a refused session start says it.
    ['a frozen organization’s wallet', { account: member({ frozen: true }) }, 'Acme\'s account is paused. Contact its owner, or use your own balance.'],
  ] as const) {
    it(`says ${name}, links to the Kizuna AI account and cannot be started`, async () => {
      useSettingsStore.setState({ settingsNavigationTarget: null });
      useAccountStore.setState({ account: setup.account });
      keeping(HOUR);
      hosted();
      await act(() => store.getState().openRecord(A));
      const onClose = vi.fn();
      show(<TranscribePanel onClose={onClose} />);
      await settle();
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
      expect(screen.queryByText(SERVICE_HOSTED)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: ACCOUNTS }));
      expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
      expect(onClose).toHaveBeenCalled();
    });
  }

  it('says an import cannot start from an empty balance, with the same link', async () => {
    useSettingsStore.setState({ settingsNavigationTarget: null });
    useAccountStore.setState({ account: known(0) });
    hosted();
    const onClose = vi.fn();
    show(<ImportPanel file={file} myLanguage="zh" onClose={onClose} />);
    await settle();
    expect(screen.getByText('Your Kizuna AI balance does not cover this transcription.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: ACCOUNTS }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
    expect(onClose).toHaveBeenCalled();
  });

  // Over the hosted limit we help: our address, never the user's own Soniox key (owner, 2026-11-18).
  it('says a recording is longer than Kizuna AI transcribes at once, and offers our address', async () => {
    useAccountStore.setState({ account: known(10_000_000) });
    keeping(5 * HOUR);
    const { jobs } = hosted();
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText(TOO_LONG)).toBeTruthy();
    // The limit said comes with the reason, from the one check: no second read, no default shown first.
    expect(jobs.hostedTerms).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.queryByText(/own key/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'support@kizuna.ai' }));
    expect(openExternalUrl).toHaveBeenCalledWith('mailto:support@kizuna.ai');
  });

  it('says the limit the service publishes', async () => {
    keeping(3 * HOUR);
    hosted({ terms: { ...TERMS, maxAudioMs: 2 * HOUR } });
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('This recording is longer than Kizuna AI transcribes at once (2 hours). Contact us and we will help:')).toBeTruthy();
  });

  // The panel never waits for ever with Start disabled and no reason.
  it('says the service could not be checked when the check itself fails', async () => {
    hosted();
    store.setState({ fileJobCheck: vi.fn(async () => { throw new Error('unexpected'); }) });
    show(<ImportPanel file={file} myLanguage="zh" onClose={() => {}} />);
    await settle();
    expect(screen.getByText('The transcription service could not be checked. Close this and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByText(SERVICE_HOSTED)).toBeNull();
  });

  it('says file transcription is not available yet from a service without it, with nothing to open', async () => {
    keeping(HOUR);
    hosted({ terms: null });
    await act(() => store.getState().openRecord(A));
    show(<TranscribePanel onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Transcribing files with Kizuna AI is not available yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'support@kizuna.ai' })).toBeNull();
  });

  /** A hosted import followed on the line, then ended by an error with `code`. */
  const failWith = async (code: string, o: Parameters<typeof fakeJobs>[0] = {}) => {
    const { pending } = hosted(o);
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
    await settle();
    await act(async () => { pending.reject!(Object.assign(new Error(code), { code })); await started; });
  };
  const leadsToAccount = () => {
    fireEvent.click(screen.getByRole('button', { name: ACCOUNTS }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
  };

  // Each reason the service gives once the job is running; the organization's in the words a refused session start uses.
  for (const [code, text, account] of [
    ['SIGN_IN', 'Sign in to Kizuna AI to transcribe files with it.', null],
    ['NO_BALANCE', 'Your Kizuna AI balance does not cover this transcription.', null],
    ['WALLET_FROZEN', 'Your Kizuna AI wallet is frozen.', null],
    ['ORG_BALANCE_HELD', 'Your organization\'s balance is held by sessions in progress. Try again when one ends, or use your own balance.', member()],
    ['ORG_NO_BALANCE', 'Ask the organization\'s owner to top up, or use your own balance.', member()],
    ['ORG_NO_BALANCE', 'Top up Acme, or use your own balance.', member({ role: 'owner' })],
    ['ORG_WALLET_FROZEN', 'Acme\'s account is paused. Contact its owner, or use your own balance.', member()],
    ['NOT_ORG_MEMBER', 'You\'re no longer in Acme.', member()],
  ] as const) {
    it(`says ${code} as “${text}”, with a link to the Kizuna AI account`, async () => {
      useSettingsStore.setState({ settingsNavigationTarget: null });
      useAccountStore.setState({ account });
      await failWith(code);
      expect(screen.getByText(text)).toBeTruthy();
      leadsToAccount();
    });
  }

  it('says HOSTED_TOO_LONG with the limit the service publishes and our address', async () => {
    await failWith('HOSTED_TOO_LONG');
    expect(screen.getByText(TOO_LONG)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'support@kizuna.ai' }));
    expect(openExternalUrl).toHaveBeenCalledWith('mailto:support@kizuna.ai');
    cleanup();
    await failWith('HOSTED_TOO_LONG', { terms: { ...TERMS, maxAudioMs: 2.5 * HOUR } });
    expect(screen.getByText('This recording is longer than Kizuna AI transcribes at once (2.5 hours). Contact us and we will help:')).toBeTruthy();
  });

  it('says HOSTED_TOO_LONG with the published four hours when the terms cannot be read', async () => {
    await failWith('HOSTED_TOO_LONG', { terms: new Error('offline') });
    expect(screen.getByText(TOO_LONG)).toBeTruthy();
  });

  for (const [code, text] of [
    ['HOSTED_UNAVAILABLE', 'Transcribing files with Kizuna AI is not available yet.'],
    ['JOB_RUNNING', 'Another file is being transcribed on this account. Try again when it has finished.'],
    // An import whose terms could not be had as it started: the block's words, through the codes' fallback to them.
    ['unchecked', 'The transcription service could not be checked. Close this and try again.'],
  ] as const) {
    it(`says ${code} as “${text}”, with nothing to open`, async () => {
      await failWith(code);
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
      expect(screen.queryByRole('button', { name: 'support@kizuna.ai' })).toBeNull();
    });
  }

  // A job cancelled once Soniox is transcribing it is still charged (owner, 2026-11-18).
  it('says a cancel is still charged while Soniox transcribes a hosted job, and only then', async () => {
    for (const viaKizuna of [true, false]) {
      const { jobs, pending } = viaKizuna ? hosted() : fakeJobs();
      if (!viaKizuna) pageWith(jobs);
      await act(() => store.getState().openRecord(A));
      show(<FileJobLine />);
      let started!: Promise<void>;
      act(() => { started = store.getState().transcribeOpen({ languages: ['en'], translateTo: 'zh' }); });
      await settle();
      const at = (phase: 'uploading' | 'queued' | 'processing') => act(() => { vi.mocked(jobs.transcribe).mock.calls[0][0].onProgress({ phase }); });
      for (const phase of ['uploading', 'queued'] as const) {
        at(phase);
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
        expect(screen.queryByText(CHARGED), phase).toBeNull();
      }
      at('processing');
      expect(screen.getByText('Transcribing: Soniox is transcribing')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(screen.queryByText(CHARGED) !== null, `through Kizuna AI: ${viaKizuna}`).toBe(viaKizuna);
      await act(async () => { pending.resolve!({ transcriptId: 1, sentences: 3 }); await started; });
      cleanup();
    }
  });

  it('says so for a hosted import too, only once Soniox is transcribing it', async () => {
    const { jobs, pending } = hosted();
    show(<FileJobLine />);
    let started!: Promise<void>;
    act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
    await settle();
    const at = (phase: 'reading' | 'decoding' | 'saving' | 'uploading' | 'queued' | 'processing') =>
      act(() => { vi.mocked(jobs.importFile).mock.calls[0][0].onProgress({ phase }); });
    for (const phase of ['reading', 'decoding', 'saving', 'uploading', 'queued'] as const) {
      at(phase);
      expect(screen.queryByText(CHARGED), phase).toBeNull();
    }
    at('processing');
    expect(screen.getByText('Importing “Team sync.mp4”: Soniox is transcribing')).toBeTruthy();
    expect(screen.getByText(CHARGED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await act(async () => { pending.resolve!({ recordId: A, transcribed: true }); await started; });
  });

  // The balance in the title bar follows what a hosted job spent, however it ended.
  describe('reads the balance again once a hosted job ends', () => {
    const refreshed = () => {
      const refreshAccount = vi.fn(async () => {});
      useAccountStore.setState({ refreshAccount });
      return refreshAccount;
    };

    it('after an import that was transcribed', async () => {
      const refreshAccount = refreshed();
      const { pending } = hosted();
      let started!: Promise<void>;
      act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
      await settle();
      expect(refreshAccount).not.toHaveBeenCalled();
      await act(async () => { pending.resolve!({ recordId: A, transcribed: true }); await started; });
      expect(refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('after a transcription that failed', async () => {
      const refreshAccount = refreshed();
      const { pending } = hosted();
      await act(() => store.getState().openRecord(A));
      let started!: Promise<void>;
      act(() => { started = store.getState().transcribeOpen({ languages: ['en'], translateTo: 'zh' }); });
      await settle();
      await act(async () => { pending.reject!(Object.assign(new Error('no balance'), { code: 'NO_BALANCE' })); await started; });
      expect(store.getState().jobFailure).toBe('NO_BALANCE');
      expect(refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('after a transcription that was cancelled', async () => {
      const refreshAccount = refreshed();
      const { pending } = hosted();
      await act(() => store.getState().openRecord(A));
      let started!: Promise<void>;
      act(() => { started = store.getState().transcribeOpen({ languages: ['en'], translateTo: 'zh' }); });
      await settle();
      store.getState().cancelJob();
      await act(async () => { pending.reject!(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); await started; });
      expect(store.getState().jobFailure).toBe('CANCELLED');
      expect(refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('never after a job with the user’s own key', async () => {
      const refreshAccount = refreshed();
      const { jobs, pending } = fakeJobs();
      pageWith(jobs);
      let started!: Promise<void>;
      act(() => { started = store.getState().importFile(file, { options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'zh' }); });
      await settle();
      await act(async () => { pending.resolve!({ recordId: A, transcribed: true }); await started; });
      await act(() => store.getState().openRecord(A));
      act(() => { started = store.getState().transcribeOpen({ languages: ['en'], translateTo: 'zh' }); });
      await settle();
      await act(async () => { pending.reject!(Object.assign(new Error('no key'), { code: 'NO_KEY' })); await started; });
      expect(refreshAccount).not.toHaveBeenCalled();
    });
  });
});
