// The History page's state and actions over a HistoryPort.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../contract/clock';
import type { HistoryPort } from './port';
import type { HistoryNotes, HistoryRecord, HistoryRecordRow } from './types';
import { createHistoryPageStore, LIST_PAGE, SEARCH_DELAY_MS } from './historyPageStore';

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
    await store.getState().load();
    await store.getState().openRecord(A);
    store.getState().generateNotes({ code: 'en', name: 'English' });
    expect(runner.start).toHaveBeenCalledWith(A, { code: 'en', name: 'English' });
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
    await store.getState().openRecord(A);
    runner.start(A);
    store.getState().dispose();
    runner.finish(A);
    await flush();
    expect(calls('getRecord')).toEqual([A]);
  });
});
