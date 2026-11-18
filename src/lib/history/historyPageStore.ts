// src/lib/history/historyPageStore.ts
//
// The History page's state and actions over a `HistoryPort`, one store per page. Every call can fail: a failure is
// shown as a line in the interface's words (`errorText`) and leaves what was shown; nothing is retried by itself.
import { addWord, useWordList } from '../words/list';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Clock } from '../contract/clock';
import type { Leg } from '../conversation/types';
import type { NotesLanguage, NotesRunner } from '../notes/runner';
import type { ImportPhase, ImportResult } from './file/importFile';
import type { FileRecognitionMissing, FileRecognitionService } from './file/service';
import type { TranscribePhase } from './file/transcribe';
import type { HistoryPort } from './port';
import type {
  FileTranscriptionOptions,
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
  /** The transcript shown (the newest unless another was chosen); null when the record has none. */
  transcriptId: number | null;
  sentences: readonly HistorySentence[];
  speakers: readonly HistorySpeaker[];
  legs: readonly Leg[];
  at: HitTarget | null;
  /** The version of the shown transcript's notes shown: the newest complete one, else the newest; null without notes. */
  notes: HistoryNotes | null;
  /** The newest attempt when it is newer than the version shown (it failed or was stopped). */
  latest?: HistoryNotes | null;
}

/** An import or a transcription running from this page: one at a time. */
export interface FileJob {
  kind: 'import' | 'transcribe';
  /** The record transcribed; null for an import until it has made one. */
  recordId: string | null;
  /** The imported file's name. */
  name: string | null;
  phase: ImportPhase;
}

/** Why a file job cannot start now. */
/** `unchecked`: the line-up's recognition service could not be looked up. */
export type FileJobBlock = FileRecognitionMissing['missing'] | 'session' | 'busy' | 'unchecked';

/** The running file job and how the last one ended: kept outside any page, so a job outlives the page that began it. */
export interface FileJobState {
  job: FileJob | null;
  jobFailure: string | null;
  jobKept: boolean;
  controller: AbortController | null;
}

export const createFileJobState = (): StoreApi<FileJobState> =>
  createStore<FileJobState>(() => ({ job: null, jobFailure: null, jobKept: false, controller: null }));

/** What the page needs to import and transcribe files (desktop); absent, it cannot. */
export interface FileJobs {
  /** Shared by every page (the app keeps one); a page makes its own when none is given. */
  state?: StoreApi<FileJobState>;
  service(): Promise<FileRecognitionService | FileRecognitionMissing>;
  /** A session is running: importing waits (decoding is heavy). */
  sessionRunning(): boolean;
  importFile(o: {
    file: File; options: FileTranscriptionOptions; myLanguage: string; service: FileRecognitionService;
    onProgress(p: { phase: ImportPhase }): void; signal: AbortSignal;
  }): Promise<ImportResult>;
  transcribe(o: {
    recordId: string; options: FileTranscriptionOptions; service: FileRecognitionService; onProgress(p: { phase: TranscribePhase }): void; signal: AbortSignal;
  }): Promise<{ transcriptId: number; sentences: number }>;
  /** An imported record is transcribed: its notes, as after a session. */
  notesAfterImport(recordId: string): void;
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
  job: FileJob | null;
  /** How the last file job ended when it did not: its code (NO_KEY, TOO_LONG, CANCELLED, …). */
  jobFailure: string | null;
  /** The failed import kept its record (recording stored, no transcript). */
  jobKept: boolean;
  /** Files can be imported and records transcribed from this page. */
  filesOffered: boolean;
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
  /** Follows the notes runner and the file job while the page is shown: what they do, and each version that ends. */
  follow(): void;
  /**
   * Adds name `index` to the word list, spelled `spelling` and often heard as the notes found it written, then
   * dismisses it (stage 5). 'known' when the word list already had that spelling; null when there is no such name.
   */
  addName(index: number, spelling: string): Promise<'added' | 'known' | null>;
  /** Stops following the notes runner (the page is gone). */
  dispose(): void;
  renameSpeaker(side: 'mine' | 'other', speaker: string, name: string): Promise<void>;
  reassign(n: number, speaker: string | null): Promise<void>;
  /** Shows another transcript of the open record, with its own notes. */
  showTranscript(id: number): Promise<void>;
  /** Why an import or a transcription cannot start now, or null. */
  fileJobBlocked(kind: 'import' | 'transcribe'): Promise<FileJobBlock | null>;
  /** The languages a file can be transcribed in and translated into: the file service's; none without one; null when the service could not be asked. */
  fileLanguages(): Promise<readonly string[] | null>;
  /** Imports a file as a new record, transcribed as `options` say: one job at a time. */
  importFile(file: File, o: { options: FileTranscriptionOptions; myLanguage: string }): Promise<void>;
  /** Transcribes the open record (again) as `options` say: a new transcript, shown once made. */
  transcribeOpen(options: FileTranscriptionOptions): Promise<void>;
  cancelJob(): void;
  /** The failure line goes. */
  clearJobFailure(): void;
}

/** A failure's code, as the file jobs give them; LOCAL for an error with none (the service's errors always have one). */
const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'LOCAL';
};

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
  /** Import and transcription (desktop); absent: neither is offered. */
  files?: FileJobs | null,
): StoreApi<HistoryPageState & HistoryPageActions> {
  let cancelSearch: (() => void) | null = null;
  /** Unsubscribes from the notes runner. */
  let offNotes: (() => void) | null | undefined = null;
  let searchSeq = 0;
  /** Each reload of the list: one a newer reload overtakes keeps nothing it read. */
  let reloadSeq = 0;
  /** Each opening or closing of a record: a read that answers after the user moved on is not shown. */
  let openSeq = 0;
  /** Each choice of a version of the notes: only the last chosen is shown. */
  let notesSeq = 0;
  /** A dismissal being written: the next waits for it rather than writing the names it read before. */
  let dismissing = false;
  /** The file job, shared with every page over the same jobs. */
  const jobs = files?.state ?? createFileJobState();
  /** Unsubscribes from the file job. */
  let offJobs: (() => void) | null = null;
  const setJobPhase = (phase: ImportPhase) => {
    const job = jobs.getState().job;
    if (job) jobs.setState({ job: { ...job, phase } });
  };

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

    /**
     * The status, the list (as many records as are shown, at least a page), the space used, and the search again.
     * A reload that a newer one overtakes keeps nothing it read: the newer one's answers are at least as new.
     */
    const reload = async (): Promise<void> => {
      const seq = ++reloadSeq;
      const status = await port.status();
      if (seq !== reloadSeq) return;
      set({ status });
      if (!status.available) return;
      const limit = Math.max(LIST_PAGE, get().rows.length);
      const rows = await port.listRecords({ binned: get().tab === 'bin', limit });
      const usage = await port.usage();
      if (seq !== reloadSeq) return;
      set({ rows, usage, more: rows.length === limit });
      const text = get().query.trim();
      if (text && get().results !== null) await search(text, searchSeq);
    };

    const newestTranscript = (record: HistoryRecord) => record.transcripts[record.transcripts.length - 1];

    /**
     * The record and everything its page shows; set only once all of it has arrived. The transcript shown is the one
     * asked for, else the one a search hit was found in, else the newest; the notes shown are that transcript's.
     */
    const fetchRecord = async (id: string, at: HitTarget | null, transcriptId?: number | null, seq = openSeq): Promise<void> => {
      const record = await port.getRecord(id);
      if (!record) throw new Error(`Record ${id} is gone`);
      const legs = await port.getLegs(id);
      const newest = newestTranscript(record);
      const hitIn = at?.kind === 'sentence' ? at.transcriptId : undefined;
      const shownTranscript = record.transcripts.find((t) => t.id === transcriptId)
        ?? record.transcripts.find((t) => t.id === hitIn) ?? newest;
      const sentences = shownTranscript ? await port.getSentences({ transcriptId: shownTranscript.id }) : [];
      const speakers = shownTranscript ? await port.getSpeakers({ transcriptId: shownTranscript.id }) : [];
      // A version whose transcript was deleted goes with the newest transcript.
      const own = (n: HistoryRecord['notes'][number]) => !shownTranscript || n.transcriptId === shownTranscript.id
        || (n.transcriptId === null && shownTranscript === newest);
      const byAge = record.notes.filter(own).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      const lastTry = byAge[byAge.length - 1];
      const chosen = [...byAge].reverse().find((n) => n.state === 'complete') ?? lastTry;
      const shown = chosen ? await port.getNotes({ id: chosen.id }) : null;
      // When the newest attempt failed or was stopped after the version shown, what became of it is said too.
      const latest = lastTry && chosen && lastTry.id !== chosen.id ? await port.getNotes({ id: lastTry.id }) : null;
      // The user closed this record, or opened another, while it was read.
      if (seq !== openSeq) return;
      set({ open: { record, transcriptId: shownTranscript?.id ?? null, sentences, speakers, legs, at, notes: shown, latest } });
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
      job: jobs.getState().job,
      jobFailure: jobs.getState().jobFailure,
      jobKept: jobs.getState().jobKept,
      filesOffered: !!files,
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
        // Closed like any closing: a read of it still on its way is not shown.
        if (get().open?.record.id === id) get().closeRecord();
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
        if (open && open.record.id === id) await fetchRecord(id, open.at, open.transcriptId);
      }),

      openRecord: (id, at = null) => act(() => fetchRecord(id, at, undefined, ++openSeq)),

      refreshRecord: () => act(async () => {
        const open = get().open;
        if (open) await fetchRecord(open.record.id, open.at, open.transcriptId);
      }),

      dropRecording: () => act(async () => {
        const open = get().open;
        if (!open) return;
        for (const t of open.record.tracks) {
          if (t.goneAt === null) await port.dropTrack({ recordId: open.record.id, source: t.source });
        }
        // The list's recording tag and the space used change too: back on the list, both are as they are now, even
        // when the record itself could not be read again. That error is the one shown, also when the list fails too.
        let failure: unknown = null;
        try {
          await fetchRecord(open.record.id, open.at, open.transcriptId);
        } catch (error) {
          failure = error;
        }
        try {
          await reload();
        } catch (error) {
          failure ??= error;
        }
        if (failure !== null) throw failure;
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
        if (seq !== notesSeq || get().open?.record.id !== open.record.id) return;
        // A version's sentence numbers are its own transcript's: written from another, it is shown with that one.
        const from = shown?.transcriptId ?? null;
        if (from !== null && from !== get().open!.transcriptId && open.record.transcripts.some((t) => t.id === from)) {
          await fetchRecord(open.record.id, null, from);
          if (seq !== notesSeq || get().open?.record.id !== open.record.id) return;
        }
        set({ open: { ...get().open!, notes: shown } });
      }),

      generateNotes(language) {
        const open = get().open;
        if (open && notes) notes.start(open.record.id, language, open.transcriptId ?? undefined);
      },

      async addName(index, spelling) {
        const name = get().open?.notes?.body?.names?.[index];
        const written = spelling.trim();
        if (!name || typeof name.written !== 'string' || !written) return null;
        const known = useWordList.getState().entries.some((e) => e.written === written);
        // Not saved (the warning says why): the name stays to check.
        if (!(await addWord({ written, heardAs: name.written }))) return null;
        await get().dismissName(index);
        return known ? 'known' : 'added';
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

      follow() {
        // The file job as this page shows it.
        if (!offJobs) {
          const shown = (j: ReturnType<typeof jobs.getState>) => set({ job: j.job, jobFailure: j.jobFailure, jobKept: j.jobKept });
          offJobs = jobs.subscribe(shown);
          shown(jobs.getState());
        }
        if (!notes || offNotes) return;
        // A version that ends shows itself: the open record and the list are read again (the list's tags follow).
        const update = () => {
          const before = get().notesRunning;
          const now = notes.running();
          set({ notesRunning: now });
          const ended = before.filter((id) => !now.includes(id));
          if (ended.length === 0) return;
          const open = get().open;
          if (open && ended.includes(open.record.id)) void get().refreshRecord();
          if (get().status?.available) void get().load();
        };
        offNotes = notes.subscribe(update);
        set({ notesRunning: notes.running() });
      },

      dispose() {
        offNotes?.();
        offNotes = null;
        // The job goes on: the next page shows it.
        offJobs?.();
        offJobs = null;
      },

      cancelNotes() {
        const open = get().open;
        if (open && notes) notes.cancel(open.record.id);
      },

      renameSpeaker: (side, speaker, name) => act(async () => {
        const open = get().open;
        if (!open || open.transcriptId === null) return;
        await port.renameSpeaker({ transcriptId: open.transcriptId, side, speaker, name });
        await fetchRecord(open.record.id, open.at, open.transcriptId);
      }),

      reassign: (n, speaker) => act(async () => {
        const open = get().open;
        if (!open || open.transcriptId === null) return;
        await port.reassignSentence({ transcriptId: open.transcriptId, n, speaker });
        await fetchRecord(open.record.id, open.at, open.transcriptId);
      }),

      showTranscript: (id) => act(async () => {
        const open = get().open;
        if (open) await fetchRecord(open.record.id, null, id);
      }),

      async fileJobBlocked(kind) {
        if (!files) return 'no-file-service';
        let service: Awaited<ReturnType<FileJobs['service']>>;
        try {
          service = await files.service();
        } catch {
          return 'unchecked';
        }
        // What the line-up cannot do comes first: "busy" would let the panel name a service that cannot do the job.
        if ('missing' in service) return service.missing;
        if (jobs.getState().job) return 'busy';
        if (kind === 'import' && files.sessionRunning()) return 'session';
        return null;
      },

      async fileLanguages() {
        if (!files) return [];
        try {
          const service = await files.service();
          return 'missing' in service ? [] : service.languages ?? [];
        } catch {
          return null;
        }
      },

      async importFile(file, o) {
        // The job is taken before anything is awaited: a second start finds it.
        if (!files || jobs.getState().job) return;
        const controller = new AbortController();
        jobs.setState({ job: { kind: 'import', recordId: null, name: file.name, phase: 'reading' }, jobFailure: null, jobKept: false, controller });
        try {
          const service = await files.service();
          if ('missing' in service) { jobs.setState({ jobFailure: service.missing }); return; }
          const result = await files.importFile({
            file, options: o.options, myLanguage: o.myLanguage, service, signal: controller.signal, onProgress: (p) => setJobPhase(p.phase),
          });
          if (result.transcribed) files.notesAfterImport(result.recordId);
          else jobs.setState({ jobFailure: result.failure, jobKept: true });
        } catch (error) {
          jobs.setState({ jobFailure: codeOf(error) });
        } finally {
          jobs.setState({ job: null, controller: null });
        }
        await act(reload);
      },

      async transcribeOpen(options) {
        const open = get().open;
        if (!files || jobs.getState().job || !open) return;
        const recordId = open.record.id;
        const controller = new AbortController();
        jobs.setState({ job: { kind: 'transcribe', recordId, name: null, phase: 'uploading' }, jobFailure: null, jobKept: false, controller });
        let made: number | null = null;
        try {
          const service = await files.service();
          if ('missing' in service) { jobs.setState({ jobFailure: service.missing }); return; }
          ({ transcriptId: made } = await files.transcribe({
            recordId, options, service, signal: controller.signal, onProgress: (p) => setJobPhase(p.phase),
          }));
        } catch (error) {
          // Too long for the service: the record's recording, not a file, is what is too long.
          const code = codeOf(error);
          jobs.setState({ jobFailure: code === 'TOO_LONG' ? 'RECORD_TOO_LONG' : code });
        } finally {
          jobs.setState({ job: null, controller: null });
        }
        if (made === null) return;
        await act(async () => {
          if (get().open?.record.id === recordId) await fetchRecord(recordId, null, made);
          await reload();
        });
      },

      cancelJob() {
        jobs.getState().controller?.abort();
      },

      clearJobFailure: () => jobs.setState({ jobFailure: null, jobKept: false }),
    };
  });

  return store;
}
