// The History page's state and actions over a HistoryPort.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../contract/clock';
import type { HistoryPort } from './port';
import type { HistoryNotes, HistoryRecord, HistoryRecordRow } from './types';
import { createFileJobState, createHistoryPageStore, LIST_PAGE, SEARCH_DELAY_MS } from './historyPageStore';
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

  function fakeJobs(o: { missing?: 'no-file-service' | 'hosted-soniox' | 'no-key'; session?: boolean } = {}) {
    let finishImport!: (r: unknown) => void;
    let finishTranscribe!: (r: unknown) => void;
    const progress: { cb?: (p: { phase: string }) => void; signal?: AbortSignal } = {};
    const jobs = {
      service: vi.fn(async () => (o.missing ? { missing: o.missing } : { service: 'soniox', apiKey: 'k', region: 'us', languages: ['en', 'ja', 'zh'] })),
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
    const hosted = fakeJobs({ missing: 'hosted-soniox' });
    const second = createHistoryPageStore(port, clock, (e) => `failed: ${(e as Error).message}`, null, { ...hosted.jobs, state: shared } as never);
    second.getState().follow();
    expect(await second.getState().fileJobBlocked('import')).toBe('hosted-soniox');
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
});
