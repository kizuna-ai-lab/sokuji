// src/lib/history/historyPageStore.ts
//
// The History page's state and actions over a `HistoryPort`, one store per page. Every call can fail: a failure is
// shown as a line in the interface's words (`errorText`) and leaves what was shown; nothing is retried by itself.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Clock } from '../contract/clock';
import type { Leg } from '../conversation/types';
import type { NotesLanguage, NotesRunner } from '../notes/runner';
import type { HistoryPort } from './port';
import type {
  HistoryNotes, HistoryRecord, HistoryRecordRow, HistorySearchResult, HistorySentence, HistorySpeaker, HistoryStatus, HistoryUsage,
} from './types';

/** Where to land in an opened record: a search hit. */
export type HitTarget =
  | { kind: 'sentence'; transcriptId: number; n: number }
  | { kind: 'translation'; segmentId: string }
  | { kind: 'notes'; notesId: number }
  | { kind: 'title' };

export interface OpenRecord {
  record: HistoryRecord;
  sentences: readonly HistorySentence[];
  speakers: readonly HistorySpeaker[];
  legs: readonly Leg[];
  at: HitTarget | null;
  /** The version of the notes shown: the newest complete one when the record opens, else the newest; null without notes. */
  notes: HistoryNotes | null;
  /** The newest attempt when it is newer than the version shown (it failed or was stopped). */
  latest?: HistoryNotes | null;
}

export interface HistoryPageState {
  status: HistoryStatus | null;
  tab: 'records' | 'bin';
  rows: readonly HistoryRecordRow[];
  query: string;
  /** The search's results while the box is not empty; null otherwise. */
  results: readonly HistorySearchResult[] | null;
  selected: ReadonlySet<string>;
  /** There are older records than the ones listed. */
  more: boolean;
  usage: HistoryUsage | null;
  open: OpenRecord | null;
  /** The records whose notes are being written. */
  notesRunning: readonly string[];
  busy: boolean;
  error: string | null;
}

export interface HistoryPageActions {
  load(): Promise<void>;
  setTab(tab: 'records' | 'bin'): Promise<void>;
  /** Lists the next page of older records under the ones shown. */
  showOlder(): Promise<void>;
  setQuery(query: string): void;
  toggle(id: string): void;
  clearSelection(): void;
  binSelected(): Promise<void>;
  /** Bins one record (the open one, from its page) and goes back to the list; a record still being written stays. */
  binRecord(id: string): Promise<void>;
  restore(ids: readonly string[]): Promise<void>;
  purge(ids: readonly string[]): Promise<void>;
  emptyBin(): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  openRecord(id: string, at?: HitTarget | null): Promise<void>;
  refreshRecord(): Promise<void>;
  /** Deletes the open record's recording, track by track; its transcript and notes stay. */
  dropRecording(): Promise<void>;
  closeRecord(): void;
  /** Shows another version of the open record's notes. */
  showNotes(id: number): Promise<void>;
  /** Starts a version of the open record's notes, in `language` or the record's own. */
  generateNotes(language?: NotesLanguage): void;
  cancelNotes(): void;
  /** Dismisses name `index` of the shown version's names to check. */
  dismissName(index: number): Promise<void>;
  /** Stops following the notes runner (the page is gone). */
  dispose(): void;
  renameSpeaker(side: 'mine' | 'other', speaker: string, name: string): Promise<void>;
  reassign(n: number, speaker: string | null): Promise<void>;
}

/** Search runs this long after the last keystroke. */
export const SEARCH_DELAY_MS = 250;
/** The list is read this many records at a time; "Show older records" reads the next page. */
export const LIST_PAGE = 200;
/** The bin is emptied by its records' ids, read in one page of at most this many. */
const BIN_PAGE = 10_000;

export function createHistoryPageStore(
  port: HistoryPort,
  clock: Clock,
  errorText: (e: unknown) => string,
  /** Who writes notes (desktop); absent: notes cannot be written from this page. */
  notes?: Pick<NotesRunner, 'start' | 'cancel' | 'running' | 'subscribe'> | null,
): StoreApi<HistoryPageState & HistoryPageActions> {
  let cancelSearch: (() => void) | null = null;
  /** Unsubscribes from the notes runner. */
  let offNotes: (() => void) | null | undefined = null;
  let searchSeq = 0;
  /** Each opening or closing of a record: a read that answers after the user moved on is not shown. */
  let openSeq = 0;
  /** Each choice of a version of the notes: only the last chosen is shown. */
  let notesSeq = 0;
  /** A dismissal being written: the next waits for it rather than writing the names it read before. */
  let dismissing = false;

  const store = createStore<HistoryPageState & HistoryPageActions>()((set, get) => {
    /** One action: busy while it runs, a rejection shown and nothing else changed. */
    const act = async (fn: () => Promise<void>): Promise<void> => {
      set({ busy: true, error: null });
      try {
        await fn();
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ busy: false });
      }
    };

    /** The search's results for `text`; an answer for an older query is dropped. */
    const search = async (text: string, seq: number): Promise<void> => {
      const results = await port.search({ query: text });
      if (seq === searchSeq) set({ results });
    };

    /** The status, the list (as many records as are shown, at least a page), the space used, and the search again. */
    const reload = async (): Promise<void> => {
      const status = await port.status();
      set({ status });
      if (!status.available) return;
      const limit = Math.max(LIST_PAGE, get().rows.length);
      const rows = await port.listRecords({ binned: get().tab === 'bin', limit });
      const usage = await port.usage();
      set({ rows, usage, more: rows.length === limit });
      const text = get().query.trim();
      if (text && get().results !== null) await search(text, searchSeq);
    };

    const newestTranscript = (record: HistoryRecord) => record.transcripts[record.transcripts.length - 1];

    /** The record and everything its page shows; set only once all of it has arrived. */
    const fetchRecord = async (id: string, at: HitTarget | null, seq = openSeq): Promise<void> => {
      const record = await port.getRecord(id);
      if (!record) throw new Error(`Record ${id} is gone`);
      const legs = await port.getLegs(id);
      const newest = newestTranscript(record);
      const sentences = newest ? await port.getSentences({ transcriptId: newest.id }) : [];
      const speakers = newest ? await port.getSpeakers({ transcriptId: newest.id }) : [];
      const byAge = [...record.notes].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      const lastTry = byAge[byAge.length - 1];
      const chosen = [...byAge].reverse().find((n) => n.state === 'complete') ?? lastTry;
      const shown = chosen ? await port.getNotes({ id: chosen.id }) : null;
      // When the newest attempt failed or was stopped after the version shown, what became of it is said too.
      const latest = lastTry && chosen && lastTry.id !== chosen.id ? await port.getNotes({ id: lastTry.id }) : null;
      // The user closed this record, or opened another, while it was read.
      if (seq !== openSeq) return;
      set({ open: { record, sentences, speakers, legs, at, notes: shown, latest } });
    };

    return {
      status: null,
      tab: 'records',
      rows: [],
      query: '',
      results: null,
      selected: new Set(),
      more: false,
      usage: null,
      open: null,
      notesRunning: notes?.running() ?? [],
      busy: false,
      error: null,

      load: () => act(reload),

      setTab: (tab) => act(async () => {
        set({ tab, selected: new Set(), rows: [], more: false });
        await reload();
      }),

      showOlder: () => act(async () => {
        const rows = get().rows;
        const last = rows[rows.length - 1];
        if (!last) return;
        const older = await port.listRecords({ binned: get().tab === 'bin', limit: LIST_PAGE, before: last.startedAt });
        set({ rows: [...rows, ...older.filter((r) => !rows.some((x) => x.id === r.id))], more: older.length === LIST_PAGE });
      }),

      setQuery(query) {
        set({ query });
        cancelSearch?.();
        cancelSearch = null;
        const seq = ++searchSeq;
        const text = query.trim();
        if (!text) {
          set({ results: null });
          return;
        }
        cancelSearch = clock.setTimeout(() => {
          cancelSearch = null;
          void act(() => search(text, seq));
        }, SEARCH_DELAY_MS);
      },

      toggle(id) {
        const selected = new Set(get().selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        set({ selected });
      },

      clearSelection: () => set({ selected: new Set() }),

      binSelected: () => act(async () => {
        // A record still being written stays out of the bin until its session ends.
        const open = new Set(get().rows.filter((r) => r.state === 'open').map((r) => r.id));
        const ids = [...get().selected].filter((id) => !open.has(id));
        if (ids.length > 0) await port.binRecords({ ids });
        set({ selected: new Set() });
        await reload();
      }),

      binRecord: (id) => act(async () => {
        const open = get().open;
        const record = open?.record.id === id ? open.record : get().rows.find((r) => r.id === id);
        if (!record || record.state === 'open') return;
        await port.binRecords({ ids: [id] });
        if (get().open?.record.id === id) set({ open: null });
        await reload();
      }),

      restore: (ids) => act(async () => {
        await port.restoreRecords({ ids: [...ids] });
        await reload();
      }),

      purge: (ids) => act(async () => {
        await port.purgeRecords({ ids: [...ids] });
        await reload();
      }),

      emptyBin: () => act(async () => {
        const bin = await port.listRecords({ binned: true, limit: BIN_PAGE });
        if (bin.length > 0) await port.purgeRecords({ ids: bin.map((r) => r.id) });
        await reload();
      }),

      rename: (id, title) => act(async () => {
        // Blank goes back to the automatic title (the store's rule).
        await port.renameRecord({ id, title: title.trim() });
        await reload();
        const open = get().open;
        if (open && open.record.id === id) await fetchRecord(id, open.at);
      }),

      openRecord: (id, at = null) => act(() => fetchRecord(id, at, ++openSeq)),

      refreshRecord: () => act(async () => {
        const open = get().open;
        if (open) await fetchRecord(open.record.id, open.at);
      }),

      dropRecording: () => act(async () => {
        const open = get().open;
        if (!open) return;
        for (const t of open.record.tracks) {
          if (t.goneAt === null) await port.dropTrack({ recordId: open.record.id, source: t.source });
        }
        await fetchRecord(open.record.id, open.at);
      }),

      closeRecord: () => {
        openSeq += 1;
        set({ open: null });
      },

      showNotes: (id) => act(async () => {
        const open = get().open;
        if (!open) return;
        const seq = ++notesSeq;
        const shown = await port.getNotes({ id });
        if (seq === notesSeq && get().open?.record.id === open.record.id) set({ open: { ...get().open!, notes: shown } });
      }),

      generateNotes(language) {
        const open = get().open;
        if (open && notes) notes.start(open.record.id, language);
      },

      dismissName: (index) => act(async () => {
        const shown = get().open?.notes;
        const names = shown?.body?.names;
        if (!shown || !names?.[index] || dismissing) return;
        dismissing = true;
        try {
          await port.updateNotesNames({ notesId: shown.id, names: names.map((n, i) => (i === index ? { ...n, dismissed: true } : n)) });
          const again = await port.getNotes({ id: shown.id });
          if (get().open?.notes?.id === shown.id) set({ open: { ...get().open!, notes: again } });
        } finally {
          dismissing = false;
        }
      }),

      dispose() {
        offNotes?.();
        offNotes = null;
      },

      cancelNotes() {
        const open = get().open;
        if (open && notes) notes.cancel(open.record.id);
      },

      renameSpeaker: (side, speaker, name) => act(async () => {
        const open = get().open;
        const newest = open && newestTranscript(open.record);
        if (!open || !newest) return;
        await port.renameSpeaker({ transcriptId: newest.id, side, speaker, name });
        await fetchRecord(open.record.id, open.at);
      }),

      reassign: (n, speaker) => act(async () => {
        const open = get().open;
        const newest = open && newestTranscript(open.record);
        if (!open || !newest) return;
        await port.reassignSentence({ transcriptId: newest.id, n, speaker });
        await fetchRecord(open.record.id, open.at);
      }),
    };
  });

  // A version that ends shows itself: the open record and the list are read again (the list's tags follow).
  offNotes = notes?.subscribe(() => {
    const before = store.getState().notesRunning;
    const now = notes.running();
    store.setState({ notesRunning: now });
    const ended = before.filter((id) => !now.includes(id));
    if (ended.length === 0) return;
    const open = store.getState().open;
    if (open && ended.includes(open.record.id)) void store.getState().refreshRecord();
    if (store.getState().status?.available) void store.getState().load();
  });
  return store;
}
