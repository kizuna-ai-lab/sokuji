// src/lib/history/historyPageStore.ts
//
// The History page's state and actions over a `HistoryPort`, one store per page. Every call can fail: a failure is
// shown as a line in the interface's words (`errorText`) and leaves what was shown; nothing is retried by itself.
import { addWord, useWordList, type WordEntry } from '../words/list';
import { findWord, replaceInNotes, replaceWord, swapIn } from './wordFix';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Clock } from '../contract/clock';
import type { Leg } from '../conversation/types';
import type { NotesLanguage, NotesRunner } from '../notes/runner';
import { payerBalance } from '../session/orgNotice';
import { accountPayer } from '../session/payerChoice';
import type { AccountState } from '../run/types';
import { fitsHosted, hostedEstimateMicroUsd, hostedEstimateUsd, type HostedFileTerms, type TrackSize } from './file/hostedFile';
import type { ImportPhase, ImportResult } from './file/importFile';
import type { FileRecognitionMissing, FileRecognitionService } from './file/service';
import { trackTranslation, transcribedTracks, type TranscribePhase } from './file/transcribe';
import type { HistoryPort } from './port';
import { applyNotesEdit, undoNotesEdit, type NotesEdit, type NotesUndo } from '../notes/editNotes';
import type {
  FileTranscriptionOptions, HistoryCorrection,
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
  /** The shown transcript's fixes of misheard words, newest first (design P0 §3.1). */
  corrections: readonly HistoryCorrection[];
}

/** What the page says after an edit, with Undo beside it, for 6 s (design P0 §3.6). */
export type EditToast = { id: number } & (
  | { kind: 'fixed'; from: string; to: string; count: number; words: boolean }
  | { kind: 'reverted'; from: string; to: string; count: number; kept: number }
  | { kind: 'edited' } | { kind: 'restored' } | { kind: 'speaker' } | { kind: 'undone' }
  /** Design P1: a notes field changed, a point removed, an undo that found its field changed since (left as it is). */
  | { kind: 'notesEdited' } | { kind: 'notesRemoved' } | { kind: 'undoKept' }
  /** Design P1 §2: `from` merged into `into` (their labels as shown), `count` sentences moved. */
  | { kind: 'merged'; from: string; into: string; count: number }
);

/** A word handed to the edit panel's "Fix words" (option C): from a name to check or a selection. It changes nothing. */
export interface FixDraft {
  seq: number;
  heard: string;
  suggestion: string | null;
  /** The sentence it was selected in, when only that one may be fixed. */
  only: number | null;
  source: 'notes' | 'selection';
}

/** The toast's time on screen. */
export const TOAST_MS = 6000;
/** Steps kept for undo on one record page. */
export const UNDO_STEPS = 20;

/** An import or a transcription running from this page: one at a time. */
export interface FileJob {
  kind: 'import' | 'transcribe';
  /** The record transcribed; null for an import until it has made one. */
  recordId: string | null;
  /** The imported file's name. */
  name: string | null;
  phase: ImportPhase;
  /**
   * Through Kizuna AI's service, which charges the account: set once the job knows its service (false until then).
   * Cancelled once Soniox is transcribing, such a job is still charged.
   */
  hosted: boolean;
}

/**
 * Why a file job cannot start now. `unchecked`: the line-up's recognition service, or Kizuna AI's terms for a file job,
 * could not be looked up. Through Kizuna AI: `hosted-unavailable`, its service has no file jobs (yet); `wallet-frozen`,
 * the paying wallet is frozen; `hosted-too-long`, a kept track is longer or larger than the service takes;
 * `no-balance`, the paying wallet (not an organization's: the service judges that one) holds less than the estimate,
 * or nothing at all for an import.
 */
export type FileJobBlock = FileRecognitionMissing['missing'] | 'session' | 'busy' | 'unchecked'
  | 'hosted-unavailable' | 'wallet-frozen' | 'hosted-too-long' | 'no-balance';

/**
 * What a panel shows before Start, read once: why the job cannot start (null when it can), whether Kizuna AI's service
 * would run it, and the longest track that service takes, in ms (null unless its terms were read).
 */
export interface FileJobCheck {
  blocked: FileJobBlock | null;
  hosted: boolean;
  maxAudioMs: number | null;
}

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
  /** Kizuna AI's terms for a file job (`fetchHostedFileTerms`): asked for a hosted service only. */
  hostedTerms(): Promise<HostedFileTerms | null>;
  /** The Kizuna AI account as the app last read it: which wallet pays a hosted job, what it holds, whether it is frozen. */
  account(): AccountState | null;
  /**
   * Reads the Kizuna AI account again: resolves once `account()` answers what was read, rejects when it could not be
   * read. Asked before a hosted job is refused for money, and after one ends.
   */
  refreshAccount(): Promise<void>;
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
  toast: EditToast | null;
  /** There is a step to undo on the record shown. */
  canUndo: boolean;
  fixDraft: FixDraft | null;
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
  /** Stops following the notes runner (the page is gone). */
  dispose(): void;
  renameSpeaker(side: 'mine' | 'other', speaker: string, name: string): Promise<void>;
  reassign(n: number, speaker: string | null): Promise<void>;
  /** Shows another transcript of the open record, with its own notes. */
  showTranscript(id: number): Promise<void>;
  /**
   * Why an import or a transcription cannot start now, through which service, and the longest track it takes: from one
   * read of the service (and, through Kizuna AI, of its terms). A read that fails answers `unchecked`.
   */
  fileJobCheck(kind: 'import' | 'transcribe'): Promise<FileJobCheck>;
  /** The open record can be edited: it has ended and is not being transcribed again. */
  canEdit(): boolean;
  /** The shown notes can be edited: the record can be, they are complete, and no version is being written for it. */
  canEditNotes(): boolean;
  /**
   * One field of the shown notes changed by hand (design P1 §1): marked edited, undoable. True once saved, or when there
   * was nothing to save; false when the write failed (the page says why).
   */
  editNotes(edit: NotesEdit): Promise<boolean>;
  /**
   * Every sentence of `side` whose speaker is `from` moved to `into` in one write (design P1 §2), undoable sentence by
   * sentence; `labels` name them as the page shows them. Returns how many moved (0: nothing to do, or not editable).
   */
  mergeSpeaker(side: 'mine' | 'other', from: string, into: string, labels: { from: string; into: string }): Promise<number>;
  /**
   * `from` written as `to` in the shown transcript (only sentence `only` when given), the shown notes too with `notes`,
   * and into the word list with `words` (a whole-transcript fix only). The sentences changed; 0 when refused or failed.
   */
  fixWords(from: string, to: string, o: { notes: boolean; words: boolean; only?: number | null }): Promise<number>;
  /** Sentence `n` rewritten; with `everywhere` and a one-word swap, the swap is made in every sentence. */
  editSentence(n: number, text: string, o: { everywhere: boolean; words: boolean }): Promise<void>;
  /** Sentence `n` back to what was heard. */
  restoreSentence(n: number): Promise<void>;
  /** A fix taken back: what it wrote goes back to what it found. */
  revertCorrection(id: number): Promise<void>;
  /** The last edit on this record page taken back without a trace. */
  undo(): Promise<void>;
  dismissToast(): void;
  /** Hands a word to the edit panel's "Fix words"; changes nothing. */
  openFix(o: { heard: string; suggestion?: string | null; only?: number | null; source: 'notes' | 'selection' }): void;
  clearFixDraft(): void;
  /** Why an import or a transcription cannot start now, or null: `fileJobCheck`'s block. */
  fileJobBlocked(kind: 'import' | 'transcribe'): Promise<FileJobBlock | null>;
  /**
   * What transcribing the open record as `options` say is estimated to cost through Kizuna AI, in USD; null with the
   * user's own key (no price is shown), for an import (its length is not known before it is read), or without the terms.
   */
  fileEstimate(kind: 'import' | 'transcribe', options: FileTranscriptionOptions): Promise<number | null>;
  /** Kizuna AI's terms for a file job (what it takes at most); null without file jobs, or when it has none or they cannot be read. */
  hostedTerms(): Promise<HostedFileTerms | null>;
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

/**
 * Why a job through Kizuna AI cannot start for this account (its wallet read as the main panel's balance gate reads it)
 * or for these tracks: the paying wallet frozen, a track longer or larger than the service takes, or a balance short of
 * the job; null when none of these. An account not known, or still loading, blocks nothing: the service decides.
 */
function hostedBlock(
  kind: 'import' | 'transcribe', account: AccountState | null, tracks: readonly TrackSize[], terms: HostedFileTerms,
): FileJobBlock | null {
  const known = account?.status === 'known' ? account : null;
  const payer = known ? accountPayer(known) : undefined;
  const wallet = known ? payerBalance(known, payer) : null;
  if (wallet?.frozen) return 'wallet-frozen';
  if (!fitsHosted(tracks, terms)) return 'hosted-too-long';
  // An organization that pays is not refused for its balance, as the main panel's gate does not refuse it: what the
  // page holds can be minutes old and cannot tell money held by colleagues' running jobs from an empty wallet, so the
  // service answers precisely. Its frozen wallet is refused above.
  const organizationPays = payer === 'organization' && known?.organization !== undefined;
  if (!wallet || wallet.microUsd === undefined || organizationPays) return null;
  // An import costs more than nothing, whatever its length. A transcription costs at least its untranslated price (the
  // translation is not chosen yet when the panel asks), in whole micro-USD as the service counts.
  const short = kind === 'import' ? wallet.microUsd <= 0 : wallet.microUsd < hostedEstimateMicroUsd(tracks, false, terms);
  return short ? 'no-balance' : null;
}

/** How long the account is waited for when it is read again before a refusal for money: past this, it is not. */
export const ACCOUNT_REFRESH_MS = 3000;

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
  /** What a fix added to the word list: the entry written so, as it was before (null when the fix made it). */
  type WordsAdded = { written: string; was: WordEntry | null; made: WordEntry };
  /** What undo takes back on the record shown, last first; cleared when the record or transcript shown changes. */
  type UndoStep =
    /** `notesEditedAt`: the notes version's mark before the fix, put back by its undo. */
    | { kind: 'fix'; id: number; words: WordsAdded | null; notesEditedAt: number | null }
    /** A fix reverted from the list: undoing it writes the fix again where its sentences read as heard. */
    | {
      kind: 'revert'; id: number; from: string; to: string;
      /** What the revert changed: each place as it is now, and as the fix had it. */
      sentences: Array<{ n: number; now: string; was: string }>;
      notes: { id: number; now: string; was: string } | null;
      /** The notes version's mark before the revert, put back when the fix is written again. */
      notesEditedAt: number | null;
    }
    | { kind: 'sentence'; n: number; text: string }
    | { kind: 'name'; side: 'mine' | 'other'; speaker: string; name: string }
    | { kind: 'move'; n: number; speaker: string | null }
    /** A notes field edited (design P1): taken back on the version as it is then; `editedAt` the mark before. */
    | { kind: 'notes'; id: number; undo: NotesUndo; editedAt: number | null }
    /** A merge (design P1): each moved sentence and the speaker it had set by hand (null: the recognizer's). */
    | { kind: 'merge'; moves: Array<{ n: number; speaker: string | null }> };
  let undoSteps: UndoStep[] = [];
  /** An undo being written: a second press waits for it rather than taking the same step twice. */
  let undoing = false;
  let toastSeq = 0;
  let dropToast: (() => void) | null = null;
  let draftSeq = 0;
  /** The file job, shared with every page over the same jobs. */
  const jobs = files?.state ?? createFileJobState();
  /** Unsubscribes from the file job. */
  let offJobs: (() => void) | null = null;
  /** The page's reading again after the last file job ended: the action that began the job waits for it. */
  let afterJob: Promise<void> | null = null;
  const changeJob = (change: Partial<FileJob>) => {
    const job = jobs.getState().job;
    if (job) jobs.setState({ job: { ...job, ...change } });
  };
  const setJobPhase = (phase: ImportPhase) => changeJob({ phase });
  /**
   * The record a transcription is reading now. Its recording is not deleted under it, nor is the record moved to the
   * bin (from where it could be deleted for good): a recording gone before its upload began quits the app (the upload's
   * read of the file fails where nothing can catch it).
   */
  const beingTranscribed = (): string | null => {
    const job = jobs.getState().job;
    return job?.kind === 'transcribe' ? job.recordId : null;
  };
  /**
   * A job through Kizuna AI has ended here, however it ended: the account is read again through the file jobs, as after
   * a refused session start. After a cancel this can run before the service has ended the job, so the balance read may
   * still count what the job held.
   */
  const refreshBalance = () => { void files?.refreshAccount().catch(() => {}); };
  /**
   * The account read again through `from`, waited for at most ACCOUNT_REFRESH_MS: a reading that fails, or has not
   * settled by then, is not waited for (the account at hand is then decided on).
   */
  const readAccountAgain = (from: FileJobs): Promise<void> => new Promise((resolve) => {
    const cancel = clock.setTimeout(resolve, ACCOUNT_REFRESH_MS);
    void from.refreshAccount().catch(() => {}).finally(() => { cancel(); resolve(); });
  });

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

    /** The undo steps and the toast go: another record, another transcript, or the page gone. */
    const forgetEdits = () => {
      undoSteps = [];
      dropToast?.();
      dropToast = null;
      set({ toast: null, canUndo: false, fixDraft: null });
    };

    /** Says what an edit did, for TOAST_MS. */
    const say = (toast: EditToast extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never) => {
      dropToast?.();
      const id = ++toastSeq;
      set({ toast: { ...toast, id } as EditToast });
      dropToast = clock.setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, TOAST_MS);
    };

    const remember = (step: UndoStep) => {
      undoSteps = [...undoSteps, step].slice(-UNDO_STEPS);
      set({ canUndo: true });
    };

    /**
     * Where an edit began. Once it is written, what follows (its undo step, the line, the re-read) is dropped when
     * another record or transcript is shown by then: those belong to the page as it was (PR review).
     */
    const scopeNow = () => ({ seq: openSeq, record: get().open?.record.id ?? null, transcript: get().open?.transcriptId ?? null });
    const stillIn = (at: ReturnType<typeof scopeNow>) => at.seq === openSeq
      && (get().open?.record.id ?? null) === at.record && (get().open?.transcriptId ?? null) === at.transcript;

    /**
     * `written` into the word list, often heard as `heard`, the list read first so one not yet loaded is not written
     * over: the entry as it was and as it became, for undo, or null when it was not saved (a fix stands without it).
     */
    const learnWord = async (written: string, heard: string): Promise<WordsAdded | null> => {
      try {
        if (!useWordList.getState().loaded) await useWordList.getState().load();
        const was = useWordList.getState().entries.find((e) => e.written === written) ?? null;
        if (!(await addWord({ written, heardAs: heard }))) return null;
        const made = useWordList.getState().entries.find((e) => e.written === written);
        return made ? { written, was: was && { ...was }, made: { ...made } } : null;
      } catch {
        return null;
      }
    };
    const sameEntry = (a: WordEntry, b: WordEntry) => a.written === b.written
      && (a.translation ?? '') === (b.translation ?? '') && (a.heardAs ?? '') === (b.heardAs ?? '');

    /**
     * One undo step written back: what it took back, and nothing else. `done` is called once its own write is made, so
     * a later part that fails (the word list) does not leave the step to be taken back twice.
     */
    /** Takes `step` back; 'kept' when it found its field changed since and left it. */
    const undoStep = async (open: OpenRecord, transcriptId: number, step: UndoStep, done: () => void): Promise<'kept' | void> => {
      if (step.kind === 'notes') {
        const shown = await port.getNotes({ id: step.id });
        const back = shown?.body ? undoNotesEdit(shown.body, step.undo) : null;
        if (!shown?.body || !back) {
          done();
          return 'kept';
        }
        await port.editNotes({ id: step.id, before: JSON.stringify(shown.body), after: JSON.stringify(back), editedAt: step.editedAt });
        done();
        return;
      }
      if (step.kind === 'fix') {
        await port.revertCorrection({ id: step.id, forget: true, notesEditedAt: step.notesEditedAt });
        done();
        // Only the entry the fix changed, and only as the fix left it: another entry written the same way, or a
        // change made to this one since, stays (PR review).
        if (step.words) {
          const { was, made } = step.words;
          const now = useWordList.getState().entries;
          const at = now.findIndex((e) => sameEntry(e, made));
          if (at >= 0) await useWordList.getState().setEntries(was ? now.map((e, i) => (i === at ? was : e)) : now.filter((_, i) => i !== at));
        }
      } else if (step.kind === 'revert') {
        // What the revert changed goes back where it still reads as the revert left it, notes version included.
        const sentences = step.sentences
          .filter((x) => open.sentences.find((y) => y.n === x.n)?.text === x.now)
          .map((x) => ({ n: x.n, before: x.now, after: x.was }));
        let notes: { id: number; before: string; after: string; editedAt: number | null } | null = null;
        if (step.notes) {
          const shown = await port.getNotes({ id: step.notes.id });
          if (shown?.body && JSON.stringify(shown.body) === step.notes.now) {
            notes = { id: step.notes.id, before: step.notes.now, after: step.notes.was, editedAt: step.notesEditedAt };
          }
        }
        if (sentences.length > 0 || notes) {
          const again = await port.applyCorrection({ transcriptId, from: step.from, to: step.to, sentences, notes });
          // The fix written again is the one its own undo step now takes back.
          undoSteps = undoSteps.map((x) => (x.kind === 'fix' && x.id === step.id ? { ...x, id: again } : x));
        }
        done();
      } else if (step.kind === 'sentence') {
        await port.editSentences({ transcriptId, edits: [{ n: step.n, text: step.text }] });
        done();
      } else if (step.kind === 'merge') {
        await port.reassignSentences({ transcriptId, moves: step.moves });
        done();
      } else if (step.kind === 'name') {
        await port.renameSpeaker({ transcriptId, side: step.side, speaker: step.speaker, name: step.name });
        done();
      } else {
        await port.reassignSentence({ transcriptId, n: step.n, speaker: step.speaker });
        done();
      }
    };

    /** The change a fix makes to a notes version (as the store takes it), or null when the notes do not hold the word. */
    const notesFix = (notes: OpenRecord['notes'], from: string, to: string) => {
      if (!notes?.body) return null;
      const fixed = replaceInNotes(notes.body, from, to);
      return fixed.count > 0 ? { id: notes.id, before: JSON.stringify(notes.body), after: JSON.stringify(fixed.body) } : null;
    };

    /** The open record read again after an edit, its notes version kept. */
    const reread = async () => {
      const open = get().open;
      if (open) await fetchRecord(open.record.id, open.at, open.transcriptId, openSeq, open.notes?.id);
    };

    const editable = (): boolean => {
      const open = get().open;
      if (!open || open.transcriptId === null || open.record.state !== 'closed') return false;
      const job = get().job;
      return !(job && job.kind === 'transcribe' && job.recordId === open.record.id);
    };

    /**
     * The record and everything its page shows; set only once all of it has arrived. The transcript shown is the one
     * asked for, else the one a search hit was found in, else the newest; the notes shown are that transcript's.
     */
    const fetchRecord = async (id: string, at: HitTarget | null, transcriptId?: number | null, seq = openSeq, notesId?: number): Promise<void> => {
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
      // An edit reads the record again with the notes version that was shown, not the newest.
      const chosen = byAge.find((n) => n.id === notesId) ?? [...byAge].reverse().find((n) => n.state === 'complete') ?? lastTry;
      const shown = chosen ? await port.getNotes({ id: chosen.id }) : null;
      // When the newest attempt failed or was stopped after the version shown, what became of it is said too.
      const latest = lastTry && chosen && lastTry.id !== chosen.id ? await port.getNotes({ id: lastTry.id }) : null;
      const corrections = shownTranscript ? await port.listCorrections({ transcriptId: shownTranscript.id }) : [];
      // The user closed this record, or opened another, while it was read.
      if (seq !== openSeq) return;
      // Another record or transcript shown: the undo steps were the other one's.
      const before = get().open;
      if (before?.record.id !== record.id || before.transcriptId !== (shownTranscript?.id ?? null)) forgetEdits();
      set({ open: { record, transcriptId: shownTranscript?.id ?? null, sentences, speakers, legs, at, notes: shown, latest, corrections } });
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
      toast: null,
      canUndo: false,
      fixDraft: null,
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
        // A record still being written stays out of the bin until its session ends, one being transcribed until its
        // transcription ends.
        const open = new Set(get().rows.filter((r) => r.state === 'open').map((r) => r.id));
        const reading = beingTranscribed();
        const ids = [...get().selected].filter((id) => !open.has(id) && id !== reading);
        if (ids.length > 0) await port.binRecords({ ids });
        set({ selected: new Set() });
        await reload();
      }),

      binRecord: (id) => act(async () => {
        const open = get().open;
        const record = open?.record.id === id ? open.record : get().rows.find((r) => r.id === id);
        if (!record || record.state === 'open' || id === beingTranscribed()) return;
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
        if (!open || open.record.id === beingTranscribed()) return;
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
        forgetEdits();
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
        // The file job as this page shows it. A job that ends shows itself on the page shown then, which is not the
        // page that began it when History was closed and opened again meanwhile: after an import, ended either way
        // (a failed one may keep its record), the list is read again; after a transcription that made a transcript,
        // the record, when it is the one open, shows it (the newest), and the list is read again.
        if (!offJobs) {
          const shown = (j: FileJobState, before?: FileJobState) => {
            set({ job: j.job, jobFailure: j.jobFailure, jobKept: j.jobKept });
            const ended = before?.job && !j.job ? before.job : null;
            if (!ended) return;
            if (ended.kind === 'transcribe' && j.jobFailure !== null) { afterJob = null; return; }
            afterJob = act(async () => {
              const { recordId } = ended;
              if (ended.kind === 'transcribe' && recordId && get().open?.record.id === recordId) await fetchRecord(recordId, null, null);
              await reload();
            });
          };
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
        const was = open.speakers.find((x) => x.side === side && x.speaker === speaker)?.name ?? '';
        const scope = scopeNow();
        await port.renameSpeaker({ transcriptId: open.transcriptId, side, speaker, name });
        if (!stillIn(scope)) return;
        // A record still running (or being transcribed again) offers no undo.
        if (editable()) {
          remember({ kind: 'name', side, speaker, name: was });
          say({ kind: 'speaker' });
        }
        await reread();
      }),

      reassign: (n, speaker) => act(async () => {
        const open = get().open;
        if (!open || open.transcriptId === null) return;
        const was = open.sentences.find((x) => x.n === n)?.speakerByUser ?? null;
        const scope = scopeNow();
        await port.reassignSentence({ transcriptId: open.transcriptId, n, speaker });
        if (!stillIn(scope)) return;
        if (editable()) {
          remember({ kind: 'move', n, speaker: was });
          say({ kind: 'speaker' });
        }
        await reread();
      }),

      canEdit: editable,

      canEditNotes() {
        const open = get().open;
        return editable() && open?.notes?.state === 'complete' && open.notes.body !== null && !get().notesRunning.includes(open.record.id);
      },

      async mergeSpeaker(side, from, into, labels) {
        const open = get().open;
        if (!open || open.transcriptId === null || !editable() || from === into) return 0;
        const moving = open.sentences.filter((x) => x.side === side && (x.speakerByUser ?? x.speaker) === from);
        if (moving.length === 0) return 0;
        const scope = scopeNow();
        let moved = 0;
        await act(async () => {
          await port.reassignSentences({ transcriptId: open.transcriptId!, moves: moving.map((x) => ({ n: x.n, speaker: into })) });
          moved = moving.length;
          if (!stillIn(scope)) return;
          remember({ kind: 'merge', moves: moving.map((x) => ({ n: x.n, speaker: x.speakerByUser })) });
          say({ kind: 'merged', from: labels.from, into: labels.into, count: moving.length });
          await reread();
        });
        return moved;
      },

      async editNotes(edit) {
        const open = get().open;
        if (!open?.notes?.body || !get().canEditNotes()) return false;
        const shown = open.notes;
        const made = applyNotesEdit(shown.body!, edit);
        if (!made) return true;
        const titleChanged = made.body.title !== shown.body!.title;
        const scope = scopeNow();
        let saved = false;
        await act(async () => {
          await port.editNotes({ id: shown.id, before: JSON.stringify(shown.body), after: JSON.stringify(made.body), editedAt: clock.now() });
          saved = true;
          if (!stillIn(scope)) return;
          remember({ kind: 'notes', id: shown.id, undo: made.undo, editedAt: shown.editedAt ?? null });
          say({ kind: made.undo.kind === 'removed' ? 'notesRemoved' : 'notesEdited' });
          // The record's title follows its notes' title: the list shows it.
          if (titleChanged) await reload();
          await reread();
        });
        return saved;
      },

      async fixWords(from, to, o) {
        const open = get().open;
        const word = from.trim();
        const written = to.trim();
        if (!open || open.transcriptId === null || !editable() || !word || !written || word === written) return 0;
        // A place already written right is not one to fix (final review I-2).
        const sentences = open.sentences
          .filter((x) => (o.only == null || x.n === o.only) && findWord(x.text, word, written).length > 0)
          .map((x) => ({ n: x.n, before: x.text, after: replaceWord(x.text, word, written).text }))
          .filter((x) => x.after !== x.before);
        if (sentences.length === 0) return 0;
        const notesChange = o.notes && o.only == null ? notesFix(open.notes, word, written) : null;
        const learn = o.words && o.only == null;
        let changed = 0;
        const scope = scopeNow();
        await act(async () => {
          // A fix is made by hand: the notes it changes are marked (design P1), and its undo puts the mark back.
          const notes = notesChange ? { ...notesChange, editedAt: clock.now() } : null;
          const id = await port.applyCorrection({ transcriptId: open.transcriptId!, from: word, to: written, sentences, notes });
          changed = sentences.length;
          const words = learn ? await learnWord(written, word) : null;
          if (!stillIn(scope)) return;
          remember({ kind: 'fix', id, words, notesEditedAt: open.notes?.editedAt ?? null });
          say({ kind: 'fixed', from: word, to: written, count: sentences.length, words: words !== null });
          // The record's title follows its notes' title: the list shows it (final review I-7).
          if (notesChange) await reload();
          await reread();
        });
        return changed;
      },

      async editSentence(n, text, o) {
        const open = get().open;
        if (!open || open.transcriptId === null || !editable()) return;
        const was = open.sentences.find((x) => x.n === n);
        if (!was || was.text === text) return;
        const swap = o.everywhere ? swapIn(was.text, text) : null;
        if (swap && open.sentences.some((x) => x.n !== n && findWord(x.text, swap.from, swap.to).length > 0)) {
          await get().fixWords(swap.from, swap.to, { notes: false, words: o.words });
          return;
        }
        const scope = scopeNow();
        await act(async () => {
          await port.editSentences({ transcriptId: open.transcriptId!, edits: [{ n, text }] });
          if (!stillIn(scope)) return;
          remember({ kind: 'sentence', n, text: was.text });
          say({ kind: 'edited' });
          await reread();
        });
      },

      restoreSentence: (n) => act(async () => {
        const open = get().open;
        if (!open || open.transcriptId === null || !editable()) return;
        const was = open.sentences.find((x) => x.n === n);
        if (!was || was.heard === null) return;
        const scope = scopeNow();
        await port.restoreSentence({ transcriptId: open.transcriptId, n });
        if (!stillIn(scope)) return;
        remember({ kind: 'sentence', n, text: was.text });
        say({ kind: 'restored' });
        await reread();
      }),

      revertCorrection: (id) => act(async () => {
        const open = get().open;
        const c = open?.corrections.find((x) => x.id === id);
        if (!open || !c || !editable()) return;
        const scope = scopeNow();
        // What the revert changes, read on each side of it, so its undo puts back exactly that (PR review): a place
        // changed since the fix is kept by the revert and left alone by the undo; the notes version is the fix's,
        // shown or not.
        const textBefore = new Map(open.sentences.map((x) => [x.n, x.text]));
        const notesBefore = c.notesId !== null ? await port.getNotes({ id: c.notesId }) : null;
        const { restored, kept } = await port.revertCorrection({ id, notesEditedAt: clock.now() });
        const notesAfter = c.notesId !== null ? await port.getNotes({ id: c.notesId }) : null;
        if (!stillIn(scope)) return;
        if (c.notesId !== null) await reload();
        await reread();
        // Read again after the re-read too: the page may show another record by now (PR review).
        if (!stillIn(scope)) return;
        const sentences = (get().open?.sentences ?? [])
          .filter((x) => c.sentences.includes(x.n) && textBefore.has(x.n) && textBefore.get(x.n) !== x.text)
          .map((x) => ({ n: x.n, now: x.text, was: textBefore.get(x.n)! }));
        const was = notesBefore?.body ? JSON.stringify(notesBefore.body) : null;
        const now = notesAfter?.body ? JSON.stringify(notesAfter.body) : null;
        const notes = c.notesId !== null && was !== null && now !== null && was !== now ? { id: c.notesId, now, was } : null;
        remember({ kind: 'revert', id, from: c.from, to: c.to, sentences, notes, notesEditedAt: notesBefore?.editedAt ?? null });
        say({ kind: 'reverted', from: c.from, to: c.to, count: restored, kept });
      }),

      undo: () => act(async () => {
        const open = get().open;
        const step = undoSteps[undoSteps.length - 1];
        if (undoing || !open || open.transcriptId === null || !step || !editable()) return;
        const scope = scopeNow();
        // Taken off only once its own write is made, so an undo that failed before can be tried again (PR review).
        let done = false;
        let kept = false;
        let failure: unknown = null;
        undoing = true;
        try {
          kept = (await undoStep(open, open.transcriptId, step, () => {
            done = true;
            undoSteps = undoSteps.filter((x) => x !== step);
            set({ canUndo: undoSteps.length > 0 });
          })) === 'kept';
        } catch (error) {
          failure = error;
        } finally {
          undoing = false;
        }
        if (done && stillIn(scope)) {
          say({ kind: kept ? 'undoKept' : 'undone' });
          if (step.kind === 'fix' || step.kind === 'revert' || step.kind === 'notes') await reload();
          await reread();
        }
        if (failure !== null) throw failure;
      }),

      dismissToast() {
        dropToast?.();
        dropToast = null;
        set({ toast: null });
      },

      openFix(o) {
        set({ fixDraft: { seq: ++draftSeq, heard: o.heard, suggestion: o.suggestion ?? null, only: o.only ?? null, source: o.source } });
      },

      clearFixDraft() {
        set({ fixDraft: null });
      },

      showTranscript: (id) => act(async () => {
        const open = get().open;
        if (open) await fetchRecord(open.record.id, null, id);
      }),

      async fileJobCheck(kind) {
        const check = (blocked: FileJobBlock | null, hosted = false, maxAudioMs: number | null = null): FileJobCheck => ({ blocked, hosted, maxAudioMs });
        if (!files) return check('no-file-service');
        let service: Awaited<ReturnType<FileJobs['service']>>;
        try {
          service = await files.service();
        } catch {
          return check('unchecked');
        }
        // What the line-up cannot do comes first: "busy" would let the panel name a service that cannot do the job.
        if ('missing' in service) return check(service.missing);
        const hosted = 'hosted' in service;
        // The service could do the job: the panel names it beside these.
        if (jobs.getState().job) return check('busy', hosted);
        if (kind === 'import' && files.sessionRunning()) return check('session', hosted);
        if (!hosted) return check(null);
        // Through Kizuna AI, nothing starts without its terms: they say how long a recording may be.
        let terms: HostedFileTerms | null;
        try {
          terms = await files.hostedTerms();
        } catch {
          return check('unchecked');
        }
        if (!terms) return check('hosted-unavailable', true);
        // A transcription sends the open record's kept tracks. An import's length is not known until the file is read
        // (it is checked then).
        const open = get().open;
        const tracks = kind === 'transcribe' && open ? transcribedTracks(open.record) : [];
        let reason = hostedBlock(kind, files.account(), tracks, terms);
        // The account as last read can be minutes old (topped up, unfrozen since): a refusal for money is decided on the
        // account read again, or on the one at hand when it cannot be read again in time.
        if (reason === 'wallet-frozen' || reason === 'no-balance') {
          await readAccountAgain(files);
          reason = hostedBlock(kind, files.account(), tracks, terms);
        }
        return check(reason, true, terms.maxAudioMs);
      },

      async fileJobBlocked(kind) {
        return (await get().fileJobCheck(kind)).blocked;
      },

      async fileEstimate(kind, options) {
        const open = get().open;
        if (!files || kind !== 'transcribe' || !open) return null;
        const tracks = transcribedTracks(open.record);
        if (tracks.length === 0) return null;
        try {
          const service = await files.service();
          // With the user's own key no price is shown (owner, 2026-11-16).
          if ('missing' in service || !('hosted' in service)) return null;
          const terms = await files.hostedTerms();
          if (!terms) return null;
          // Each track priced as the job will send it: translated exactly when a translation is asked for it.
          const translated = tracks.map((t) => trackTranslation(open.record, t.source, options, service) !== null);
          return hostedEstimateUsd(tracks, translated, terms);
        } catch {
          return null;
        }
      },

      async hostedTerms() {
        if (!files) return null;
        try {
          return await files.hostedTerms();
        } catch {
          return null;
        }
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
        jobs.setState({ job: { kind: 'import', recordId: null, name: file.name, phase: 'reading', hosted: false }, jobFailure: null, jobKept: false, controller });
        let hosted = false;
        try {
          const service = await files.service();
          if ('missing' in service) { jobs.setState({ jobFailure: service.missing }); return; }
          hosted = 'hosted' in service;
          changeJob({ hosted });
          const result = await files.importFile({
            file, options: o.options, myLanguage: o.myLanguage, service, signal: controller.signal, onProgress: (p) => setJobPhase(p.phase),
          });
          if (result.transcribed) files.notesAfterImport(result.recordId);
          else jobs.setState({ jobFailure: result.failure, jobKept: true });
        } catch (error) {
          jobs.setState({ jobFailure: codeOf(error) });
        } finally {
          // The page shown now (this one, or the next if History was closed meanwhile) reads the list again.
          jobs.setState({ job: null, controller: null });
          if (hosted) refreshBalance();
        }
        await afterJob;
      },

      async transcribeOpen(options) {
        const open = get().open;
        if (!files || jobs.getState().job || !open) return;
        const recordId = open.record.id;
        const controller = new AbortController();
        jobs.setState({ job: { kind: 'transcribe', recordId, name: null, phase: 'uploading', hosted: false }, jobFailure: null, jobKept: false, controller });
        let hosted = false;
        try {
          const service = await files.service();
          if ('missing' in service) { jobs.setState({ jobFailure: service.missing }); return; }
          hosted = 'hosted' in service;
          changeJob({ hosted });
          await files.transcribe({
            recordId, options, service, signal: controller.signal, onProgress: (p) => setJobPhase(p.phase),
          });
        } catch (error) {
          // Too long for the service: the record's recording, not a file, is what is too long.
          const code = codeOf(error);
          jobs.setState({ jobFailure: code === 'TOO_LONG' ? 'RECORD_TOO_LONG' : code });
        } finally {
          // The page shown now shows the new transcript (see follow()).
          jobs.setState({ job: null, controller: null });
          if (hosted) refreshBalance();
        }
        await afterJob;
      },

      cancelJob() {
        jobs.getState().controller?.abort();
      },

      clearJobFailure: () => jobs.setState({ jobFailure: null, jobKept: false }),
    };
  });

  return store;
}
