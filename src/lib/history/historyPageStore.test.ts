// The History page's state and actions over a HistoryPort.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../contract/clock';
import type { HistoryPort } from './port';
import type { HistoryNotes, HistoryRecord, HistoryRecordRow } from './types';
import { createFileJobState, createHistoryPageStore, LIST_PAGE, SEARCH_DELAY_MS } from './historyPageStore';
import type { HostedFileTerms } from './file/hostedFile';
import { EACH_SIDE } from './file/options';
import type { AccountState } from '../session/types';
import { setUseOwnBalance } from '../session/payerChoice';
import { useWordList } from '../words/list';

const { settingsStored } = vi.hoisted(() => ({ settingsStored: new Map<string, unknown>() }));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (settingsStored.has(key) ? settingsStored.get(key) : def),
      setSetting: async (key: string, value: unknown) => { settingsStored.set(key, value); return { success: true }; },
    }),
  },
}));

const A = 'run-000a-aaaa';
const B = 'run-000b-bbbb';
const rowOf = (id: string, over: Partial<HistoryRecordRow> = {}): HistoryRecordRow => ({
  id, startedAt: 1000, endedAt: 2000, state: 'closed', mode: 'both', myLanguage: 'zh', targetLanguage: 'en', title: null, titleByUser: false,
  binnedAt: null, sentences: 1, hasRecording: false, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 0, ...over,
});
const recordOf = (id: string, transcripts: number[]): HistoryRecord => ({
  ...rowOf(id), services: { provider: 'soniox', models: {} }, appVersion: '1', textBytes: 0, legs: [], tracks: [], notes: [],
  transcripts: transcripts.map((t) => ({ id: t, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: 0, sentences: 1 })),
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const notesOf = (id: number): HistoryNotes => ({
  id, recordId: A, transcriptId: 2, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', createdAt: id * 1000,
  state: 'complete', failure: null, requestIds: [],
  body: { title: `Notes ${id}`, overview: { text: 'o', format: 'plain' }, topics: [], points: [], names: [] },
});
/** A notes runner the tests drive: start and cancel are recorded, and `finish` ends a run. */
function fakeRunner() {
  const running = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  return {
    start: vi.fn((id: string) => { running.add(id); notify(); }),
    cancel: vi.fn(),
    running: () => [...running],
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    finish: (id: string) => { running.delete(id); notify(); },
  };
}

type Fake = HistoryPort & { calls: [string, unknown][] };
function fakePort(): Fake {
  const calls: [string, unknown][] = [];
  const answer = <T>(name: string, value: T) => async (arg?: unknown) => { calls.push([name, arg]); return value; };
  return {
    calls,
    status: answer('status', { available: true, dir: '/h' }),
    listRecords: answer('listRecords', [rowOf(A)]),
    usage: answer('usage', { dbBytes: 10, audioBytes: 0, records: 1, binned: 0 }),
    search: answer('search', []),
    binRecords: answer('binRecords', { changed: 1 }),
    restoreRecords: answer('restoreRecords', { changed: 1 }),
    purgeRecords: answer('purgeRecords', { purged: [], failed: [] }),
    renameRecord: answer('renameRecord', undefined),
    dropTrack: answer('dropTrack', undefined),
    getRecord: answer('getRecord', recordOf(A, [1, 2])),
    getLegs: answer('getLegs', []),
    getSentences: answer('getSentences', []),
    getSpeakers: answer('getSpeakers', []),
    renameSpeaker: answer('renameSpeaker', undefined),
    reassignSentence: answer('reassignSentence', undefined),
    getNotes: async (arg: { id: number }) => { calls.push(['getNotes', arg]); return notesOf(arg.id); },
  } as unknown as Fake;
}

let port: Fake;
let clock: VirtualClock;
let store: ReturnType<typeof createHistoryPageStore>;
const calls = (name: string) => port.calls.filter((c) => c[0] === name).map((c) => c[1]);
const lastCall = (name: string) => { const all = calls(name); return all[all.length - 1]; };

beforeEach(() => {
  port = fakePort();
  clock = createVirtualClock(0);
  store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`);
});

describe('the History page state', () => {
  it('loads the status, the records and the space used', async () => {
    await store.getState().load();
    expect(store.getState()).toMatchObject({ status: { available: true }, rows: [expect.objectContaining({ id: A })], usage: { records: 1 } });
  });

  it('does not list anything when History is not available', async () => {
    port.status = async () => { port.calls.push(['status', undefined]); return { available: false, reason: 'newer', dir: '' }; };
    await store.getState().load();
    expect(port.calls.map((c) => c[0])).toEqual(['status']);
    expect(store.getState().status).toEqual({ available: false, reason: 'newer', dir: '' });
  });

  it('searches 250 ms after the last keystroke and drops an older answer', async () => {
    expect(SEARCH_DELAY_MS).toBe(250);
    store.getState().setQuery('视');
    clock.advance(100);
    store.getState().setQuery('视频');
    clock.advance(249);
    expect(calls('search')).toEqual([]);
    clock.advance(1);
    await flush();
    expect(calls('search')).toEqual([{ query: '视频' }]);
    expect(store.getState().results).toEqual([]);
  });

  it('clears the results at once when the box is emptied', () => {
    store.setState({ results: [] });
    store.getState().setQuery('  ');
    expect(store.getState().results).toBeNull();
  });

  it('bins the selected records except one still being written', async () => {
    store.setState({ rows: [rowOf(A), rowOf(B, { state: 'open', endedAt: null })] });
    store.getState().toggle(A);
    store.getState().toggle(B);
    await store.getState().binSelected();
    expect(calls('binRecords')).toEqual([{ ids: [A] }]);
    expect(store.getState().selected.size).toBe(0);
  });

  it('opens a record only when everything it shows has arrived', async () => {
    port.getSentences = async () => { throw new Error('gone'); };
    await store.getState().openRecord(A);
    expect(store.getState().open).toBeNull();
    expect(store.getState().error).toBe('failed: gone');
    expect(store.getState().busy).toBe(false);
  });

  it('renames a speaker on the newest transcript and refreshes the record', async () => {
    await store.getState().openRecord(A, { kind: 'title' });
    port.calls.length = 0;
    await store.getState().renameSpeaker('other', '1.2', 'Mina');
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 2, side: 'other', speaker: '1.2', name: 'Mina' }]);
    expect(calls('getSentences')).toEqual([{ transcriptId: 2 }]);
    expect(store.getState().open?.at).toEqual({ kind: 'title' });
  });

  it('keeps what was shown when an action fails', async () => {
    await store.getState().load();
    port.binRecords = async () => { throw new Error('locked'); };
    store.getState().toggle(A);
    await store.getState().binSelected();
    expect(store.getState().rows.map((r) => r.id)).toEqual([A]);
    expect(store.getState()).toMatchObject({ error: 'failed: locked', busy: false });
  });

  it('bins the open record from its page and goes back to the list, but not one still being written', async () => {
    await store.getState().openRecord(A);
    await store.getState().binRecord(A);
    expect(calls('binRecords')).toEqual([{ ids: [A] }]);
    expect(store.getState().open).toBeNull();
    expect(calls('listRecords')).toHaveLength(1);

    port.getRecord = async () => ({ ...recordOf(B, [1]), state: 'open', endedAt: null });
    await store.getState().openRecord(B);
    await store.getState().binRecord(B);
    expect(calls('binRecords')).toEqual([{ ids: [A] }]);
    expect(store.getState().open?.record.id).toBe(B);
  });

  it('lists a page of records and fetches the older ones on request, keeping them on a reload', async () => {
    const page = Array.from({ length: LIST_PAGE }, (_, i) => rowOf(`run-${String(i).padStart(4, '0')}-aaaa`, { startedAt: 10_000 - i }));
    const older = [rowOf('run-9999-zzzz', { startedAt: 1 })];
    port.listRecords = async (arg?: { before?: number | null; limit?: number }) => {
      port.calls.push(['listRecords', arg]);
      return arg?.before ? older : [...page, ...older].slice(0, arg?.limit ?? 200);
    };
    await store.getState().load();
    expect(store.getState()).toMatchObject({ more: true });
    expect(store.getState().rows).toHaveLength(LIST_PAGE);
    await store.getState().showOlder();
    expect(lastCall('listRecords')).toEqual({ binned: false, limit: LIST_PAGE, before: 10_000 - (LIST_PAGE - 1) });
    expect(store.getState().rows).toHaveLength(LIST_PAGE + 1);
    expect(store.getState().more).toBe(false);
    await store.getState().load();
    expect(lastCall('listRecords')).toEqual({ binned: false, limit: LIST_PAGE + 1 });
    expect(store.getState().rows).toHaveLength(LIST_PAGE + 1);
  });

  it('searches again after a change while the box has text', async () => {
    store.getState().setQuery('sync');
    clock.advance(SEARCH_DELAY_MS);
    await flush();
    await store.getState().openRecord(A);
    await store.getState().binRecord(A);
    expect(calls('search')).toEqual([{ query: 'sync' }, { query: 'sync' }]);
  });

  it('deletes only the recording of the open record, track by track, and shows the record again', async () => {
    const withTracks = { ...recordOf(A, [1]), tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 10, bytes: 1, offsetMs: 0, goneAt: null },
      { source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 10, bytes: 1, offsetMs: 0, goneAt: null },
      { source: 'old', file: 'old.opus', format: 'ogg-opus', durationMs: 10, bytes: 1, offsetMs: 0, goneAt: 5 },
    ] };
    port.getRecord = async (id: string) => { port.calls.push(['getRecord', id]); return withTracks; };
    await store.getState().openRecord(A);
    port.calls.length = 0;
    await store.getState().dropRecording();
    expect(calls('dropTrack')).toEqual([{ recordId: A, source: 'speaker' }, { recordId: A, source: 'participant' }]);
    expect(calls('getRecord')).toEqual([A]);
  });

  it('reads the list and the space again once the recording is deleted, so the list no longer shows it', async () => {
    await store.getState().openRecord(A);
    port.calls.length = 0;
    await store.getState().dropRecording();
    expect(calls('listRecords')).toHaveLength(1);
    expect(calls('usage')).toHaveLength(1);
  });

  it('reads the list again after deleting the recording even when the record cannot be read again, and says why', async () => {
    await store.getState().openRecord(A);
    port.getRecord = (async () => { throw new Error('gone'); }) as never;
    port.calls.length = 0;
    await store.getState().dropRecording();
    expect(calls('listRecords')).toHaveLength(1);
    expect(store.getState().error).toBe('failed: gone');
  });

  it('shows why the record could not be read again, even when the list cannot be read either', async () => {
    await store.getState().openRecord(A);
    port.getRecord = (async () => { throw new Error('record gone'); }) as never;
    port.listRecords = (async () => { throw new Error('list gone'); }) as never;
    await store.getState().dropRecording();
    expect(store.getState().error).toBe('failed: record gone');
  });

  it('keeps the newer list when an older read of it answers last', async () => {
    let answerOld!: () => void;
    const held = new Promise<void>((resolve) => { answerOld = resolve; });
    let reads = 0;
    port.listRecords = (async (arg: unknown) => {
      port.calls.push(['listRecords', arg]);
      reads += 1;
      if (reads === 1) { await held; return [rowOf(A, { hasRecording: true, audioBytes: 500 })]; }
      return [rowOf(A)];
    }) as never;
    const older = store.getState().load();
    await flush();
    await store.getState().openRecord(A);
    await store.getState().dropRecording();
    answerOld();
    await older;
    expect(store.getState().rows).toEqual([rowOf(A)]);
  });

  it('renames a record with its text trimmed', async () => {
    await store.getState().rename(A, '  Weekly  ');
    expect(calls('renameRecord')).toEqual([{ id: A, title: 'Weekly' }]);
  });
});

describe("a record's notes", () => {
  const withNotes = (ids: number[]) => {
    port.getRecord = (async (arg: unknown) => {
      port.calls.push(['getRecord', arg]);
      return { ...recordOf(A, [1, 2]), notes: ids.map((id) => ({ id, transcriptId: 2, language: 'zh', createdAt: id * 1000, state: 'complete' })) };
    }) as never;
  };

  it('opens a record with its newest version of the notes, and shows another on request', async () => {
    withNotes([3, 7, 5]);
    await store.getState().openRecord(A);
    expect(calls('getNotes')).toEqual([{ id: 7 }]);
    expect(store.getState().open?.notes?.body?.title).toBe('Notes 7');
    await store.getState().showNotes(3);
    expect(store.getState().open?.notes?.id).toBe(3);
  });

  it('opens a record without notes with none', async () => {
    await store.getState().openRecord(A);
    expect(store.getState().open?.notes).toBeNull();
    expect(calls('getNotes')).toEqual([]);
  });

  it('writes notes through the runner, says they are being written, and shows them when they are done', async () => {
    const runner = fakeRunner();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, runner);
    store.getState().follow();
    await store.getState().load();
    await store.getState().openRecord(A);
    store.getState().generateNotes({ code: 'en', name: 'English' });
    expect(runner.start).toHaveBeenCalledWith(A, { code: 'en', name: 'English' }, 2);
    expect(store.getState().notesRunning).toEqual([A]);
    withNotes([9]);
    runner.finish(A);
    await vi.waitFor(() => expect(store.getState().open?.notes?.id).toBe(9));
    expect(store.getState().notesRunning).toEqual([]);
    expect(calls('listRecords').length).toBeGreaterThan(1);
    store.getState().cancelNotes();
    expect(runner.cancel).toHaveBeenCalledWith(A);
  });

  it('dismisses a name to check in the shown version and shows it again', async () => {
    withNotes([7]);
    const names = [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }, { written: 'Ozaka', likely: 'Osaka', sentences: [9] }];
    const getNotes = port.getNotes;
    port.getNotes = (async (arg: { id: number }) => {
      const n = await (getNotes as (a: { id: number }) => Promise<HistoryNotes>)(arg);
      return { ...n, body: { ...n.body!, names } };
    }) as never;
    port.updateNotesNames = (async (arg: unknown) => { port.calls.push(['updateNotesNames', arg]); }) as never;
    await store.getState().openRecord(A);
    await store.getState().dismissName(1);
    expect(calls('updateNotesNames')).toEqual([{ notesId: 7, names: [names[0], { ...names[1], dismissed: true }] }]);
    expect(calls('getNotes')).toEqual([{ id: 7 }, { id: 7 }]);
  });

  // Review: answers that arrive after the user moved on must not undo it.
  it('does not open the record again when a refresh answers after it was closed', async () => {
    await store.getState().openRecord(A);
    let answer!: () => void;
    const getRecord = port.getRecord;
    port.getRecord = (async (arg: unknown) => { await new Promise<void>((r) => { answer = r; }); return (getRecord as (a: unknown) => Promise<unknown>)(arg); }) as never;
    const refreshing = store.getState().refreshRecord();
    await flush();
    store.getState().closeRecord();
    answer();
    await refreshing;
    expect(store.getState().open).toBeNull();
  });

  it('does not open the record again when a refresh answers after it was moved to the bin', async () => {
    await store.getState().openRecord(A);
    let answer!: () => void;
    const getRecord = port.getRecord;
    port.getRecord = (async (arg: unknown) => { await new Promise<void>((r) => { answer = r; }); return (getRecord as (a: unknown) => Promise<unknown>)(arg); }) as never;
    const refreshing = store.getState().refreshRecord();
    await flush();
    port.getRecord = getRecord;
    await store.getState().binRecord(A);
    answer();
    await refreshing;
    expect(store.getState().open).toBeNull();
  });

  it('shows the version chosen last, whichever answers first', async () => {
    withNotes([3, 7, 5]);
    await store.getState().openRecord(A);
    const waiting = new Map<number, () => void>();
    const getNotes = port.getNotes;
    port.getNotes = (async (arg: { id: number }) => {
      await new Promise<void>((r) => { waiting.set(arg.id, r); });
      return (getNotes as (a: { id: number }) => Promise<HistoryNotes>)(arg);
    }) as never;
    const first = store.getState().showNotes(3);
    const second = store.getState().showNotes(5);
    await flush();
    waiting.get(5)!();
    await second;
    waiting.get(3)!();
    await first;
    expect(store.getState().open?.notes?.id).toBe(5);
  });

  it('takes one dismissal at a time, so a second click does not undo the first', async () => {
    withNotes([7]);
    let names = [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }, { written: 'Ozaka', likely: 'Osaka', sentences: [9] }];
    const getNotes = port.getNotes;
    port.getNotes = (async (arg: { id: number }) => {
      const n = await (getNotes as (a: { id: number }) => Promise<HistoryNotes>)(arg);
      return { ...n, body: { ...n.body!, names } };
    }) as never;
    let release!: () => void;
    port.updateNotesNames = (async (arg: { names: typeof names }) => {
      port.calls.push(['updateNotesNames', arg]);
      await new Promise<void>((r) => { release = r; });
      names = arg.names;
    }) as never;
    await store.getState().openRecord(A);
    const first = store.getState().dismissName(0);
    await flush();
    const second = store.getState().dismissName(1);
    release();
    await first;
    await second;
    expect(calls('updateNotesNames')).toHaveLength(1);
    expect(names[0]).toMatchObject({ dismissed: true });
  });

  it('adds a name to the word list as it is often heard, says when it was already there, and dismisses it', async () => {
    withNotes([7]);
    const names = [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }, { written: 'Ozaka', likely: 'Osaka', sentences: [9] }];
    const getNotes = port.getNotes;
    port.getNotes = (async (arg: { id: number }) => {
      const n = await (getNotes as (a: { id: number }) => Promise<HistoryNotes>)(arg);
      return { ...n, body: { ...n.body!, names } };
    }) as never;
    port.updateNotesNames = (async (arg: unknown) => { port.calls.push(['updateNotesNames', arg]); }) as never;
    useWordList.setState({ entries: [{ written: 'Osaka' }], background: '', loaded: true });
    await store.getState().openRecord(A);
    expect(await store.getState().addName(0, 'Sokuji')).toBe('added');
    expect(await store.getState().addName(1, ' Osaka ')).toBe('known');
    expect(useWordList.getState().entries).toEqual([{ written: 'Osaka', heardAs: 'Ozaka' }, { written: 'Sokuji', heardAs: 'Soku G' }]);
    expect(calls('updateNotesNames')).toHaveLength(2);
  });

  it('keeps a name to check when the word list could not be saved', async () => {
    withNotes([7]);
    const names = [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }];
    const getNotes = port.getNotes;
    port.getNotes = (async (arg: { id: number }) => {
      const n = await (getNotes as (a: { id: number }) => Promise<HistoryNotes>)(arg);
      return { ...n, body: { ...n.body!, names } };
    }) as never;
    port.updateNotesNames = (async (arg: unknown) => { port.calls.push(['updateNotesNames', arg]); }) as never;
    useWordList.setState({ entries: [], background: '', loaded: true });
    await store.getState().openRecord(A);
    const save = useWordList.getState().setEntries;
    useWordList.setState({ setEntries: async () => false });
    try {
      expect(await store.getState().addName(0, 'Sokuji')).toBeNull();
    } finally {
      useWordList.setState({ setEntries: save });
    }
    expect(calls('updateNotesNames')).toEqual([]);
  });

  it('opens on the newest complete version when a newer attempt failed or was stopped', async () => {
    port.getRecord = (async (arg: unknown) => {
      port.calls.push(['getRecord', arg]);
      return { ...recordOf(A, [1, 2]), notes: [
        { id: 3, transcriptId: 2, language: 'zh', createdAt: 3000, state: 'complete' },
        { id: 5, transcriptId: 2, language: 'en', createdAt: 5000, state: 'failed' },
        { id: 6, transcriptId: 2, language: 'en', createdAt: 6000, state: 'cancelled' },
      ] };
    }) as never;
    await store.getState().openRecord(A);
    // The newest complete version is shown; the newest attempt is read too, for what became of it.
    expect(calls('getNotes')).toEqual([{ id: 3 }, { id: 6 }]);
    expect(store.getState().open).toMatchObject({ notes: { id: 3 }, latest: { id: 6 } });
  });

  it('stops following the runner once disposed', async () => {
    const runner = fakeRunner();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, runner);
    store.getState().follow();
    await store.getState().openRecord(A);
    runner.start(A);
    store.getState().dispose();
    runner.finish(A);
    await flush();
    expect(calls('getRecord')).toEqual([A]);
  });

  // Review: React's StrictMode runs the page's effect, its cleanup, and the effect again; following has to survive it.
  it('follows the runner from follow() on, and again after a dispose', async () => {
    const runner = fakeRunner();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, runner);
    await store.getState().openRecord(A);
    runner.start(A);
    expect(store.getState().notesRunning).toEqual([]);
    store.getState().follow();
    expect(store.getState().notesRunning).toEqual([A]);
    store.getState().dispose();
    store.getState().follow();
    runner.finish(A);
    await flush();
    expect(store.getState().notesRunning).toEqual([]);
    expect(calls('getRecord')).toEqual([A, A]);
  });
});

describe('transcripts and file jobs', () => {
  const twoTranscripts = (): HistoryRecord => ({
    ...recordOf(A, [1, 2]),
    notes: [
      { id: 10, transcriptId: 1, language: 'zh', createdAt: 1, state: 'complete' },
      { id: 11, transcriptId: 2, language: 'zh', createdAt: 2, state: 'complete' },
    ],
  });

  it('shows the newest transcript with its own notes, and another one when chosen', async () => {
    port.getRecord = async () => twoTranscripts();
    await store.getState().openRecord(A);
    expect(store.getState().open).toMatchObject({ transcriptId: 2, notes: { id: 11 } });
    expect(lastCall('getSentences')).toEqual({ transcriptId: 2 });
    await store.getState().showTranscript(1);
    expect(store.getState().open).toMatchObject({ transcriptId: 1, notes: { id: 10 } });
    expect(lastCall('getSentences')).toEqual({ transcriptId: 1 });
    expect(lastCall('getSpeakers')).toEqual({ transcriptId: 1 });
  });

  // Review: a version's sentence numbers are its own transcript's; shown beside another, its jumps went astray.
  it('shows a version chosen from another transcript with that transcript', async () => {
    port.getRecord = async () => twoTranscripts();
    port.getNotes = (async (arg: { id: number }) => {
      port.calls.push(['getNotes', arg]);
      return { ...notesOf(arg.id), transcriptId: arg.id === 10 ? 1 : 2 };
    }) as never;
    await store.getState().openRecord(A);
    expect(store.getState().open).toMatchObject({ transcriptId: 2, notes: { id: 11 } });
    await store.getState().showNotes(10);
    expect(store.getState().open).toMatchObject({ transcriptId: 1, notes: { id: 10, transcriptId: 1 } });
    expect(lastCall('getSentences')).toEqual({ transcriptId: 1 });
  });

  it('opens a search hit in the transcript it was found in, and names speakers in the one shown', async () => {
    port.getRecord = async () => twoTranscripts();
    await store.getState().openRecord(A, { kind: 'sentence', transcriptId: 1, n: 3 });
    expect(store.getState().open).toMatchObject({ transcriptId: 1 });
    await store.getState().renameSpeaker('other', '1', 'Kim');
    expect(lastCall('renameSpeaker')).toEqual({ transcriptId: 1, side: 'other', speaker: '1', name: 'Kim' });
  });

  it('writes notes for the transcript shown', async () => {
    const runner = fakeRunner();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, runner);
    port.getRecord = async () => twoTranscripts();
    await store.getState().openRecord(A);
    await store.getState().showTranscript(1);
    store.getState().generateNotes();
    expect(runner.start).toHaveBeenCalledWith(A, undefined, 1);
  });

  /** Kizuna AI's published terms: 4 hours at most, $0.20 an hour, $0.32 translated. */
  const TERMS: HostedFileTerms = { usdPerHour: 0.2, translatedUsdPerHour: 0.32, maxAudioMs: 14_400_000, maxBytes: 100_663_296, maxBytesPerMs: 8, bytesSlack: 65_536 };
  const HOSTED = {
    service: 'kizunaai_soniox', hosted: true, region: 'jp', languages: ['en', 'ja', 'zh'],
    access: { apiUrl: 'https://service.example/api', token: async () => 'tok' },
  };
  function fakeJobs(o: {
    missing?: 'no-file-service' | 'no-key' | 'sign-in'; session?: boolean;
    /** Kizuna AI's Soniox, with these terms (an Error: they cannot be read) and this account. */
    hosted?: boolean; terms?: HostedFileTerms | null | Error; account?: AccountState | null;
    /** The account once read again (unchanged when not given); or a reading again that fails, or never answers. */
    refreshed?: AccountState | null; refresh?: 'fails' | 'hangs';
  } = {}) {
    let finishImport!: (r: unknown) => void;
    let finishTranscribe!: (r: unknown) => void;
    const progress: { cb?: (p: { phase: string }) => void; signal?: AbortSignal } = {};
    let account = o.account ?? null;
    const jobs = {
      service: vi.fn(async () => (o.missing ? { missing: o.missing } : o.hosted ? HOSTED : { service: 'soniox', apiKey: 'k', region: 'us', languages: ['en', 'ja', 'zh'] })),
      hostedTerms: vi.fn(async () => {
        if (o.terms instanceof Error) throw o.terms;
        return o.terms === undefined ? TERMS : o.terms;
      }),
      account: vi.fn(() => account),
      refreshAccount: vi.fn(async () => {
        if (o.refresh === 'fails') throw new Error('offline');
        if (o.refresh === 'hangs') await new Promise<never>(() => {});
        if (o.refreshed !== undefined) account = o.refreshed;
      }),
      sessionRunning: vi.fn(() => o.session ?? false),
      importFile: vi.fn((a: { onProgress(p: { phase: string }): void; signal: AbortSignal }) => {
        progress.cb = a.onProgress;
        progress.signal = a.signal;
        return new Promise((resolve) => { finishImport = resolve; });
      }),
      transcribe: vi.fn((a: { onProgress(p: { phase: string }): void; signal: AbortSignal }) => {
        progress.cb = a.onProgress;
        progress.signal = a.signal;
        return new Promise((resolve, reject) => { finishTranscribe = (r) => (r instanceof Error ? reject(r) : resolve(r)); });
      }),
      notesAfterImport: vi.fn(),
    };
    return { jobs, progress, finishImport: (r: unknown) => finishImport(r), finishTranscribe: (r: unknown) => finishTranscribe(r) };
  }
  const file = { name: 'Team sync.mp4', size: 10 } as unknown as File;
  const OPTS = { languages: ['en', 'ja'], translateTo: 'zh' };

  it('passes the options chosen to the import and to a transcription again', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    void store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalledWith(expect.objectContaining({ file, options: OPTS, myLanguage: 'zh' })));
    f.finishImport({ recordId: B, transcribed: true });
    await vi.waitFor(() => expect(store.getState().job).toBeNull());
    port.getRecord = async () => recordOf(A, [1]);
    await store.getState().openRecord(A);
    void store.getState().transcribeOpen(OPTS);
    await vi.waitFor(() => expect(f.jobs.transcribe).toHaveBeenCalledWith(expect.objectContaining({ recordId: A, options: OPTS })));
  });

  it('offers the file service\u2019s languages, and none when there is no service', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    expect(await store.getState().fileLanguages()).toEqual(['en', 'ja', 'zh']);
    const missing = fakeJobs({ missing: 'no-key' });
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, missing.jobs as never);
    expect(await store.getState().fileLanguages()).toEqual([]);
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, null);
    expect(await store.getState().fileLanguages()).toEqual([]);
    // Asked and not answered: said apart from "none", so the panel can tell the service was not checked.
    const failing = fakeJobs();
    failing.jobs.service.mockRejectedValueOnce(new Error('The key store could not be read'));
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, failing.jobs as never);
    expect(await store.getState().fileLanguages()).toBeNull();
  });

  it('imports one file at a time, shows its phase, then lists it and writes its notes', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    await store.getState().load();
    const started = store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
    expect(store.getState().job).toMatchObject({ kind: 'import', name: 'Team sync.mp4', phase: 'reading' });
    f.progress.cb!({ phase: 'processing' });
    expect(store.getState().job).toMatchObject({ phase: 'processing' });
    await store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    expect(f.jobs.importFile).toHaveBeenCalledTimes(1);
    const listed = calls('listRecords').length;
    f.finishImport({ recordId: B, transcribed: true });
    await started;
    expect(store.getState().job).toBeNull();
    expect(calls('listRecords').length).toBeGreaterThan(listed);
    expect(f.jobs.notesAfterImport).toHaveBeenCalledWith(B);
  });

  it('says why a file job cannot start: no Soniox for recognition, no key, a session running', async () => {
    for (const [o, reason] of [[{ missing: 'no-file-service' }, 'no-file-service'], [{ missing: 'no-key' }, 'no-key'], [{ session: true }, 'session']] as const) {
      const f = fakeJobs(o);
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
      store.getState().follow();
      expect(await store.getState().fileJobBlocked('import')).toBe(reason);
    }
    const f = fakeJobs({ session: true });
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    expect(await store.getState().fileJobBlocked('transcribe')).toBeNull();
  });

  // Review: with a job running, a line-up that cannot transcribe files says so, not "busy" (the panel would then
  // name a service that cannot do the job).
  it('says a job is running only when the line-up could transcribe the file', async () => {
    const shared = createFileJobState();
    const ok = fakeJobs();
    const first = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, { ...ok.jobs, state: shared } as never);
    first.getState().follow();
    void first.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(ok.jobs.importFile).toHaveBeenCalled());
    expect(await first.getState().fileJobBlocked('import')).toBe('busy');
    const signedOut = fakeJobs({ missing: 'sign-in' });
    const second = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, { ...signedOut.jobs, state: shared } as never);
    second.getState().follow();
    expect(await second.getState().fileJobBlocked('import')).toBe('sign-in');
    first.getState().dispose();
    second.getState().dispose();
  });

  it('a file job outlives the page: the next page shows it, can cancel it, and cannot start a second', async () => {
    const f = fakeJobs();
    const jobs = { ...f.jobs, state: createFileJobState() };
    const first = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    first.getState().follow();
    const started = first.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
    first.getState().dispose();
    const second = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    second.getState().follow();
    expect(second.getState().job).toMatchObject({ kind: 'import', name: 'Team sync.mp4' });
    await second.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    expect(f.jobs.importFile).toHaveBeenCalledTimes(1);
    second.getState().cancelJob();
    expect(f.progress.signal!.aborted).toBe(true);
    f.finishImport({ recordId: B, transcribed: false, failure: 'CANCELLED' });
    await started;
    expect(second.getState()).toMatchObject({ job: null, jobFailure: 'CANCELLED' });
  });

  // History closed and opened again while a file is imported: the page shown when the import ends lists its record.
  it('an import that ends under the next page shows its record there', async () => {
    const f = fakeJobs();
    const jobs = { ...f.jobs, state: createFileJobState() };
    const first = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    first.getState().follow();
    await first.getState().load();
    const started = first.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
    first.getState().dispose();
    const second = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    second.getState().follow();
    await second.getState().load();
    expect(second.getState().rows.map((r) => r.id)).toEqual([A]);
    port.listRecords = async () => [rowOf(B), rowOf(A)];
    f.finishImport({ recordId: B, transcribed: true });
    await started;
    await vi.waitFor(() => expect(second.getState().rows.map((r) => r.id)).toEqual([B, A]));
    second.getState().dispose();
  });

  // The same for a record transcribed again: the next page, showing that record, shows the new transcript.
  it('a transcription that ends under the next page shows its transcript there', async () => {
    const f = fakeJobs();
    const jobs = { ...f.jobs, state: createFileJobState() };
    port.getRecord = async () => recordOf(A, [1]);
    const first = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    first.getState().follow();
    await first.getState().openRecord(A);
    const started = first.getState().transcribeOpen(OPTS);
    await vi.waitFor(() => expect(f.jobs.transcribe).toHaveBeenCalled());
    first.getState().dispose();
    const second = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, jobs as never);
    second.getState().follow();
    await second.getState().openRecord(A);
    expect(second.getState().open).toMatchObject({ transcriptId: 1 });
    port.getRecord = async () => recordOf(A, [1, 2]);
    f.finishTranscribe({ transcriptId: 2, sentences: 1 });
    await started;
    await vi.waitFor(() => expect(second.getState().open).toMatchObject({ transcriptId: 2 }));
    second.getState().dispose();
  });

  it('two quick starts make one job', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    void store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    void store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
    await flush();
    expect(f.jobs.importFile).toHaveBeenCalledTimes(1);
  });

  it('a failed import keeps what it stored, says why, and writes no notes', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    const started = store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
    await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
    f.finishImport({ recordId: B, transcribed: false, failure: 'NO_KEY' });
    await started;
    expect(store.getState().jobFailure).toBe('NO_KEY');
    expect(f.jobs.notesAfterImport).not.toHaveBeenCalled();
    expect(store.getState().jobKept).toBe(true);
    store.getState().clearJobFailure();
    expect(store.getState()).toMatchObject({ jobFailure: null, jobKept: false });
  });

  it('transcribes the open record again, shows the new transcript, and can be cancelled', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    port.getRecord = async () => recordOf(A, [1]);
    await store.getState().openRecord(A);
    const started = store.getState().transcribeOpen(OPTS);
    await vi.waitFor(() => expect(f.jobs.transcribe).toHaveBeenCalledWith(expect.objectContaining({ recordId: A })));
    expect(store.getState().job).toMatchObject({ kind: 'transcribe', recordId: A });
    port.getRecord = async () => recordOf(A, [1, 5]);
    f.finishTranscribe({ transcriptId: 5, sentences: 4 });
    await started;
    expect(store.getState().open).toMatchObject({ transcriptId: 5 });

    const again = store.getState().transcribeOpen(OPTS);
    await vi.waitFor(() => expect(f.jobs.transcribe).toHaveBeenCalledTimes(2));
    store.getState().cancelJob();
    expect(f.progress.signal!.aborted).toBe(true);
    f.finishTranscribe(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
    await again;
    expect(store.getState()).toMatchObject({ job: null, jobFailure: 'CANCELLED', open: { transcriptId: 5 } });
  });

  // A recording deleted before its upload has read it quits the app: while a record is transcribed, its recording is
  // not deleted, nor the record moved to the bin (from where it could be deleted for good); the others still go.
  it('neither deletes the recording of a record being transcribed nor bins it, until the transcription ends', async () => {
    const f = fakeJobs();
    store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
    store.getState().follow();
    const track = { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 10, bytes: 1, offsetMs: 0, goneAt: null };
    port.getRecord = async () => ({ ...recordOf(A, [1]), tracks: [track] });
    await store.getState().openRecord(A);
    const started = store.getState().transcribeOpen(OPTS);
    await vi.waitFor(() => expect(f.jobs.transcribe).toHaveBeenCalled());

    await store.getState().dropRecording();
    await store.getState().binRecord(A);
    store.setState({ rows: [rowOf(A), rowOf(B)] });
    store.getState().toggle(A);
    store.getState().toggle(B);
    await store.getState().binSelected();
    expect(calls('dropTrack')).toEqual([]);
    expect(calls('binRecords')).toEqual([{ ids: [B] }]);

    f.finishTranscribe({ transcriptId: 2, sentences: 1 });
    await started;
    await store.getState().dropRecording();
    expect(calls('dropTrack')).toEqual([{ recordId: A, source: 'speaker' }]);
  });

  // Kizuna AI's Soniox: its limits and its price are known before Start, and so is whether the payer can pay.
  describe('through Kizuna AI', () => {
    const HOUR = 3_600_000;
    /** A kept recording at 48 kbit/s (6 bytes a millisecond); `goneAt` set, deleted. */
    const track = (source: string, durationMs: number, goneAt: number | null = null) =>
      ({ source, file: `${source}.opus`, format: 'ogg-opus', durationMs, bytes: durationMs * 6, offsetMs: 0, goneAt });
    /** Opens a record keeping these tracks (an hour of each side unless said otherwise), with these legs. */
    const openWith = async (tracks = [track('speaker', HOUR), track('participant', HOUR)], legs: HistoryRecord['legs'] = []) => {
      port.getRecord = async () => ({ ...recordOf(A, [1]), tracks, legs });
      await store.getState().openRecord(A);
    };
    const known = (balanceMicroUsd: number, over: Partial<Extract<AccountState, { status: 'known' }>> = {}): AccountState =>
      ({ status: 'known', balanceMicroUsd, frozen: false, ...over });
    /** A member of an organization: its balance, and the member's own. */
    const member = (orgMicroUsd: number, ownMicroUsd: number, orgFrozen = false) => known(ownMicroUsd, {
      organization: { name: 'Org', availableMicroUsd: orgMicroUsd, frozen: orgFrozen }, personal: { balanceMicroUsd: ownMicroUsd, frozen: false },
    });
    const hostedStore = (o: Parameters<typeof fakeJobs>[0] = {}) => {
      const f = fakeJobs({ hosted: true, ...o });
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
      return f;
    };
    const blocked = (kind: 'import' | 'transcribe') => store.getState().fileJobBlocked(kind);

    it('says a job is running, or a session, before asking anything of Kizuna AI', async () => {
      const f = fakeJobs({ hosted: true, session: true, terms: new Error('offline'), account: known(0, { frozen: true }) });
      const state = createFileJobState();
      state.setState({ job: { kind: 'transcribe', recordId: B, name: null, phase: 'processing', hosted: true } });
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, { ...f.jobs, state } as never);
      expect(await blocked('transcribe')).toBe('busy');
      expect(await blocked('import')).toBe('busy');
      state.setState({ job: null });
      expect(await blocked('import')).toBe('session');
      // The service could do the job: the panel names Kizuna AI beside the reason.
      expect(await store.getState().fileJobCheck('import')).toEqual({ blocked: 'session', hosted: true, maxAudioMs: null });
      expect(f.jobs.hostedTerms).not.toHaveBeenCalled();
      expect(f.jobs.account).not.toHaveBeenCalled();
    });

    // What a panel shows before Start, from one read of the service and of the terms.
    it('answers the block, the service and its limit in one check', async () => {
      const f = hostedStore({ account: known(10_000_000) });
      await openWith([track('speaker', TERMS.maxAudioMs + 1)]);
      expect(await store.getState().fileJobCheck('transcribe')).toEqual({ blocked: 'hosted-too-long', hosted: true, maxAudioMs: TERMS.maxAudioMs });
      expect(f.jobs.service).toHaveBeenCalledTimes(1);
      expect(f.jobs.hostedTerms).toHaveBeenCalledTimes(1);
      expect(await store.getState().fileJobCheck('import')).toEqual({ blocked: null, hosted: true, maxAudioMs: TERMS.maxAudioMs });
      hostedStore({ terms: null });
      expect(await store.getState().fileJobCheck('import')).toEqual({ blocked: 'hosted-unavailable', hosted: true, maxAudioMs: null });
      const own = fakeJobs();
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, own.jobs as never);
      expect(await store.getState().fileJobCheck('import')).toEqual({ blocked: null, hosted: false, maxAudioMs: null });
    });

    it('answers "unchecked" when the service cannot be read, or its terms', async () => {
      const unchecked = { blocked: 'unchecked', hosted: false, maxAudioMs: null };
      const f = hostedStore({ account: known(10_000_000) });
      f.jobs.service.mockRejectedValueOnce(new Error('The key store could not be read'));
      expect(await store.getState().fileJobCheck('import')).toEqual(unchecked);
      expect(f.jobs.hostedTerms).not.toHaveBeenCalled();
      hostedStore({ terms: new Error('offline'), account: known(10_000_000) });
      await openWith();
      expect(await store.getState().fileJobCheck('transcribe')).toEqual(unchecked);
      expect(await store.getState().fileJobCheck('import')).toEqual(unchecked);
    });

    // Offline as the panel opens: it says the service could not be checked, and nothing starts without the limits.
    it('cannot start while the terms cannot be read', async () => {
      hostedStore({ terms: new Error('offline'), account: known(0, { frozen: true }) });
      await openWith([track('speaker', 5 * HOUR)]);
      expect(await blocked('transcribe')).toBe('unchecked');
      expect(await blocked('import')).toBe('unchecked');
    });

    it('is not available yet from a service without the terms', async () => {
      hostedStore({ terms: null, account: known(0, { frozen: true }) });
      await openWith([track('speaker', 5 * HOUR)]);
      expect(await blocked('transcribe')).toBe('hosted-unavailable');
      expect(await blocked('import')).toBe('hosted-unavailable');
    });

    it('says the wallet is frozen', async () => {
      hostedStore({ account: known(0, { frozen: true }) });
      await openWith([track('speaker', 5 * HOUR)]);
      expect(await blocked('transcribe')).toBe('wallet-frozen');
      expect(await blocked('import')).toBe('wallet-frozen');
    });

    // Its balance is not weighed (below), but a frozen organization is refused, as the main panel's gate refuses it.
    it('says the organization’s wallet is frozen when it pays', async () => {
      hostedStore({ account: member(0, 10_000_000, true) });
      await openWith();
      expect(await blocked('transcribe')).toBe('wallet-frozen');
      expect(await blocked('import')).toBe('wallet-frozen');
    });

    it('says a recording is longer than Kizuna AI takes, counting only the tracks kept; at the limit it starts', async () => {
      hostedStore({ account: known(10_000_000) });
      await openWith([track('speaker', TERMS.maxAudioMs + 1), track('participant', HOUR)]);
      expect(await blocked('transcribe')).toBe('hosted-too-long');
      // An import's length is not known until the file is read: it is checked then.
      expect(await blocked('import')).toBeNull();
      await openWith([track('speaker', TERMS.maxAudioMs)]);
      expect(await blocked('transcribe')).toBeNull();
      // A deleted recording is not sent.
      await openWith([track('speaker', TERMS.maxAudioMs + 1, 5), track('participant', HOUR)]);
      expect(await blocked('transcribe')).toBeNull();
      // Too long is said before the balance.
      hostedStore({ account: known(0) });
      await openWith([track('speaker', TERMS.maxAudioMs + 1)]);
      expect(await blocked('transcribe')).toBe('hosted-too-long');
    });

    it('says the balance does not cover the recording at the untranslated price, from the wallet that pays', async () => {
      // Two hours at $0.20 an hour: $0.40.
      hostedStore({ account: known(399_999) });
      await openWith();
      expect(await blocked('transcribe')).toBe('no-balance');
      hostedStore({ account: known(400_000) });
      await openWith();
      expect(await blocked('transcribe')).toBeNull();
      // A member who chose to pay from their own balance: theirs is weighed.
      hostedStore({ account: member(10_000_000, 100_000) });
      await openWith();
      setUseOwnBalance(true);
      try {
        expect(await blocked('transcribe')).toBe('no-balance');
      } finally {
        setUseOwnBalance(false);
      }
    });

    // As the main panel's gate: an organization's balance in the page can be minutes old, and the service answers precisely.
    it('does not refuse an organization that pays for its balance', async () => {
      hostedStore({ account: member(100_000, 10_000_000) });
      await openWith();
      expect(await blocked('transcribe')).toBeNull();
      hostedStore({ account: member(0, 0) });
      expect(await blocked('import')).toBeNull();
    });

    // In floating dollars 1.5 h × $0.20 comes to a hair over $0.30, and exactly $0.30 would fall short.
    it('weighs the wallet against the estimate in whole micro-USD: exactly enough starts', async () => {
      const ninetyMinutes = [track('speaker', HOUR), track('participant', HOUR / 2)];
      hostedStore({ account: known(300_000) });
      await openWith(ninetyMinutes);
      expect(await blocked('transcribe')).toBeNull();
      hostedStore({ account: known(299_999) });
      await openWith(ninetyMinutes);
      expect(await blocked('transcribe')).toBe('no-balance');
      hostedStore({ account: known(600_000) });
      await openWith([track('speaker', 3 * HOUR)]);
      expect(await blocked('transcribe')).toBeNull();
    });

    // Its length is not known before the file is read, but any import costs more than nothing.
    it('refuses an import from a wallet that holds nothing', async () => {
      for (const [account, reason] of [
        [known(0), 'no-balance'], [known(-5), 'no-balance'], [known(1), null], [member(0, 0), null], [{ status: 'unknown' }, null],
      ] as const) {
        hostedStore({ account });
        expect(await blocked('import'), JSON.stringify(account)).toBe(reason);
      }
    });

    // The account as last polled can be minutes old: a block for money is decided on the account read again.
    it('reads the account again before saying the balance does not cover the job or the wallet is frozen', async () => {
      for (const stale of [known(0), known(10_000_000, { frozen: true }), member(10_000_000, 10_000_000, true)]) {
        const f = hostedStore({ account: stale, refreshed: known(10_000_000) });
        await openWith();
        expect(await blocked('transcribe'), JSON.stringify(stale)).toBeNull();
        expect(f.jobs.refreshAccount, JSON.stringify(stale)).toHaveBeenCalledTimes(1);
      }
      hostedStore({ account: known(0), refreshed: known(1) });
      expect(await blocked('import')).toBeNull();
      // Read again and still short: it blocks.
      hostedStore({ account: known(0), refreshed: known(399_999) });
      await openWith();
      expect(await blocked('transcribe')).toBe('no-balance');
    });

    it('reads the account again only when it would block for money', async () => {
      const f = hostedStore({ account: known(10_000_000) });
      await openWith();
      expect(await blocked('transcribe')).toBeNull();
      await openWith([track('speaker', TERMS.maxAudioMs + 1)]);
      expect(await blocked('transcribe')).toBe('hosted-too-long');
      expect(f.jobs.refreshAccount).not.toHaveBeenCalled();
    });

    it('decides on the account at hand when it cannot be read again', async () => {
      const f = hostedStore({ account: known(0), refresh: 'fails' });
      await openWith();
      expect(await blocked('transcribe')).toBe('no-balance');
      expect(f.jobs.refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('decides on the account at hand when it is not read again within 3 seconds', async () => {
      const f = hostedStore({ account: known(0, { frozen: true }), refresh: 'hangs' });
      await openWith();
      let answer: string | null | undefined;
      void blocked('transcribe').then((b) => { answer = b; });
      await vi.waitFor(() => expect(f.jobs.refreshAccount).toHaveBeenCalled());
      clock.advance(2999);
      await flush();
      expect(answer).toBeUndefined();
      clock.advance(1);
      await vi.waitFor(() => expect(answer).toBe('wallet-frozen'));
    });

    // Through the file jobs (the app's account), never past them.
    it('reads the account again once a hosted job ends, and never after a job with the user’s own key', async () => {
      const f = hostedStore();
      store.getState().follow();
      const started = store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
      await vi.waitFor(() => expect(f.jobs.importFile).toHaveBeenCalled());
      expect(f.jobs.refreshAccount).not.toHaveBeenCalled();
      f.finishImport({ recordId: B, transcribed: true });
      await started;
      expect(f.jobs.refreshAccount).toHaveBeenCalledTimes(1);
      const own = fakeJobs();
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, own.jobs as never);
      store.getState().follow();
      const ownStarted = store.getState().importFile(file, { options: OPTS, myLanguage: 'zh' });
      await vi.waitFor(() => expect(own.jobs.importFile).toHaveBeenCalled());
      own.finishImport({ recordId: B, transcribed: true });
      await ownStarted;
      expect(own.jobs.refreshAccount).not.toHaveBeenCalled();
    });

    it('an account not known, or still loading, does not block: the service decides', async () => {
      for (const account of [null, { status: 'unknown' }, { status: 'loading' }] as const) {
        hostedStore({ account });
        await openWith();
        expect(await blocked('transcribe'), String(account?.status)).toBeNull();
      }
    });

    it('never asks for the terms or the account for the user’s own key', async () => {
      const f = fakeJobs({ account: known(0, { frozen: true }) });
      store = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, f.jobs as never);
      await openWith([track('speaker', 5 * HOUR)]);
      expect(await blocked('transcribe')).toBeNull();
      expect(await blocked('import')).toBeNull();
      expect(await store.getState().fileEstimate('transcribe', OPTS)).toBeNull();
      expect(f.jobs.hostedTerms).not.toHaveBeenCalled();
      expect(f.jobs.account).not.toHaveBeenCalled();
    });

    it('estimates what transcribing the open record costs, translated or not; none for an import', async () => {
      hostedStore();
      // An hour and a half kept: $0.30, or $0.48 translated; the deleted hour is not sent.
      await openWith([track('speaker', HOUR), track('participant', HOUR / 2), track('participant', HOUR, 5)]);
      expect(await store.getState().fileEstimate('transcribe', { languages: ['en'], translateTo: '' })).toBe(0.3);
      expect(await store.getState().fileEstimate('transcribe', { languages: ['en'], translateTo: 'zh' })).toBe(0.48);
      expect(await store.getState().fileEstimate('import', OPTS)).toBeNull();
    });

    // The job asks for no translation into the only language spoken (owner, 2026-11-19), so none is priced.
    it('prices one language translated into itself as not translated', async () => {
      hostedStore();
      await openWith([track('speaker', HOUR)]);
      expect(await store.getState().fileEstimate('transcribe', { languages: ['zh'], translateTo: 'zh' })).toBe(0.2);
      expect(await store.getState().fileEstimate('transcribe', { languages: ['zh'], translateTo: 'en' })).toBe(0.32);
    });

    // Priced as the job sends it: a side the session translated into nothing is sent, and priced, without a translation.
    it('prices each side as it will be sent when each side goes into the other’s language', async () => {
      hostedStore();
      const leg = (name: 'speaker' | 'participant', source: string, target: string) =>
        ({ leg: name, languages: { source, target }, input: null, inputName: null, inputId: null, translated: target !== '', spoken: false });
      await openWith([track('speaker', HOUR), track('participant', HOUR)], [leg('speaker', 'zh', 'en'), leg('participant', 'en', '')]);
      // An hour translated ($0.32) and an hour not ($0.20).
      expect(await store.getState().fileEstimate('transcribe', { languages: ['en', 'zh'], translateTo: EACH_SIDE })).toBe(0.52);
    });

    it('has no estimate when the terms cannot be read', async () => {
      for (const terms of [new Error('offline'), null]) {
        hostedStore({ terms });
        await openWith();
        expect(await store.getState().fileEstimate('transcribe', OPTS)).toBeNull();
      }
    });

    // Signed out between the panel saying it could start and Start: the sign-in is the reason, and nothing is sent.
    it('a sign-out before Start ends the job asking to sign in, and sends nothing', async () => {
      const f = hostedStore({ account: known(10_000_000) });
      store.getState().follow();
      await openWith();
      expect(await blocked('transcribe')).toBeNull();
      f.jobs.service.mockResolvedValue({ missing: 'sign-in' });
      await store.getState().transcribeOpen(OPTS);
      expect(store.getState()).toMatchObject({ job: null, jobFailure: 'sign-in' });
      expect(f.jobs.transcribe).not.toHaveBeenCalled();
    });
  });
});
