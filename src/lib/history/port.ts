// src/lib/history/port.ts
//
// The page's way to History. On the desktop the port calls the main process's history:* channels
// (electron/history-ipc.js); elsewhere it is the null port, which holds nothing and never throws.
import type { Leg, LegName, Notice } from '../conversation/types';
import { isElectron } from '../../utils/environment';
import type {
  HistoryLegInput, HistoryNotes, HistoryNotesInput, HistoryNotesRow, HistoryRecord, HistoryRecordInput, HistoryRecordRow,
  HistorySearchResult, HistorySegment, HistorySentence, HistorySentenceInput, HistorySentenceSide, HistorySpeaker,
  HistoryRecognizePhase, HistoryRecognizeRequest, HistoryStatus, HistoryTrackPiece, HistoryTranscriptOrigin, HistoryUsage,
  FileToken,
} from './types';

export interface HistoryPort {
  openRecord(record: HistoryRecordInput): Promise<void>;
  closeRecord(args: { id: string; endedAt: number }): Promise<{ kept: boolean }>;
  getRecord(id: string): Promise<HistoryRecord | null>;
  listRecords(args: { binned?: boolean; limit?: number; before?: number | null }): Promise<HistoryRecordRow[]>;
  renameRecord(args: { id: string; title: string }): Promise<void>;
  putLeg(args: HistoryLegInput): Promise<void>;
  putSegments(args: { recordId: string; leg: LegName; segments: HistorySegment[] }): Promise<void>;
  putNotices(args: { recordId: string; leg: LegName; notices: Notice[] }): Promise<void>;
  getLegs(id: string): Promise<Leg[]>;
  createTranscript(args: { recordId: string; origin: HistoryTranscriptOrigin; textKind?: 'original' | 'translation' }): Promise<number>;
  /** A transcript that could not be written whole, by its id: the record and its other transcripts stay. */
  deleteTranscript(args: { transcriptId: number }): Promise<void>;
  appendSentences(args: { transcriptId: number; sentences: HistorySentenceInput[] }): Promise<{ added: number }>;
  reviseSentences(args: { transcriptId: number; revisions: Array<{ n: number; text: string }> }): Promise<void>;
  getSentences(args: { transcriptId: number }): Promise<HistorySentence[]>;
  renameSpeaker(args: { transcriptId: number; side: HistorySentenceSide; speaker: string; name: string }): Promise<void>;
  reassignSentence(args: { transcriptId: number; n: number; speaker: string | null }): Promise<void>;
  getSpeakers(args: { transcriptId: number }): Promise<HistorySpeaker[]>;
  saveNotes(args: HistoryNotesInput): Promise<number>;
  listNotes(args: { recordId: string }): Promise<HistoryNotesRow[]>;
  getNotes(args: { id: number }): Promise<HistoryNotes | null>;
  /** A complete version's names to check, replaced as a whole. */
  updateNotesNames(args: { notesId: number; names: Array<Record<string, unknown>> }): Promise<void>;
  search(args: { query: string; limit?: number }): Promise<HistorySearchResult[]>;
  binRecords(args: { ids: string[] }): Promise<{ changed: number }>;
  restoreRecords(args: { ids: string[] }): Promise<{ changed: number }>;
  /** `failed`: records whose folder could not be removed; they stay in the bin and are tried again. */
  purgeRecords(args: { ids: string[] }): Promise<{ purged: string[]; failed: string[] }>;
  dropTrack(args: { recordId: string; source: string }): Promise<void>;
  usage(): Promise<HistoryUsage>;
  /** One piece of a track being recorded (complete Ogg pages) and the length written so far. */
  appendTrack(args: HistoryTrackPiece): Promise<{ bytes: number }>;
  /** Saves a kept track where the user chooses: main asks with the system's Save dialog and copies the file. */
  saveTrack(args: { recordId: string; source: string; title: string; defaultName: string }): Promise<{ saved: boolean }>;
  status(): Promise<HistoryStatus>;
  /** A kept track through Soniox's file recognition: its words, and the audio's length Soniox heard. */
  recognize(args: HistoryRecognizeRequest): Promise<{ tokens: FileToken[]; audioMs: number }>;
  /** Stops a running recognition; false when none runs by that id. */
  cancelRecognition(args: { jobId: string }): Promise<boolean>;
  /** The phase of a running recognition, or null. */
  recognitionStatus(args: { jobId: string }): Promise<{ phase: HistoryRecognizePhase } | null>;
}

/** Main refused a call, or History is not there: `code` is the store's (RECORD_CLOSED, UNAVAILABLE, …) when it gave one. */
export class HistoryUnavailable extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'HistoryUnavailable';
    if (code !== undefined) this.code = code;
  }
}

/** Each port method and the channel it calls. */
export const HISTORY_PORT_CHANNELS = [
  ['openRecord', 'history:open-record'],
  ['closeRecord', 'history:close-record'],
  ['getRecord', 'history:get-record'],
  ['listRecords', 'history:list-records'],
  ['renameRecord', 'history:rename-record'],
  ['putLeg', 'history:put-leg'],
  ['putSegments', 'history:put-segments'],
  ['putNotices', 'history:put-notices'],
  ['getLegs', 'history:get-legs'],
  ['createTranscript', 'history:create-transcript'],
  ['deleteTranscript', 'history:delete-transcript'],
  ['appendSentences', 'history:append-sentences'],
  ['reviseSentences', 'history:revise-sentences'],
  ['getSentences', 'history:get-sentences'],
  ['renameSpeaker', 'history:rename-speaker'],
  ['reassignSentence', 'history:reassign-sentence'],
  ['getSpeakers', 'history:get-speakers'],
  ['saveNotes', 'history:save-notes'],
  ['listNotes', 'history:list-notes'],
  ['getNotes', 'history:get-notes'],
  ['updateNotesNames', 'history:update-notes-names'],
  ['search', 'history:search'],
  ['binRecords', 'history:bin-records'],
  ['restoreRecords', 'history:restore-records'],
  ['purgeRecords', 'history:purge-records'],
  ['dropTrack', 'history:drop-track'],
  ['usage', 'history:usage'],
  ['appendTrack', 'history:append-track'],
  ['saveTrack', 'history:save-track'],
  ['status', 'history:status'],
  ['recognize', 'history:recognize'],
  ['cancelRecognition', 'history:recognize-cancel'],
  ['recognitionStatus', 'history:recognize-status'],
] as const satisfies ReadonlyArray<readonly [keyof HistoryPort, `history:${string}`]>;

type Invoke = (channel: string, data?: unknown) => Promise<unknown>;
interface Answer { ok?: boolean; value?: unknown; error?: unknown; code?: unknown }

/** The desktop port: each method calls its channel and resolves with the value, or rejects with `HistoryUnavailable`. */
export function electronHistoryPort(invoke: Invoke): HistoryPort {
  async function call<T>(channel: string, data: object): Promise<T> {
    let answer: Answer | null | undefined;
    try {
      answer = (await invoke(channel, data)) as Answer | null | undefined;
    } catch (error) {
      // The bridge itself refused the call (a blocked channel, an argument that cannot be copied).
      throw new HistoryUnavailable(error instanceof Error ? error.message : String(error));
    }
    if (answer && answer.ok === true) return answer.value as T;
    const message = typeof answer?.error === 'string' ? answer.error : 'History did not answer';
    throw new HistoryUnavailable(message, typeof answer?.code === 'string' ? answer.code : undefined);
  }
  return {
    openRecord: (a) => call('history:open-record', a),
    closeRecord: (a) => call('history:close-record', a),
    getRecord: (id) => call('history:get-record', { id }),
    listRecords: (a) => call('history:list-records', a),
    renameRecord: (a) => call('history:rename-record', a),
    putLeg: (a) => call('history:put-leg', a),
    putSegments: (a) => call('history:put-segments', a),
    putNotices: (a) => call('history:put-notices', a),
    getLegs: (id) => call('history:get-legs', { id }),
    createTranscript: (a) => call('history:create-transcript', a),
    deleteTranscript: (a) => call('history:delete-transcript', a),
    appendSentences: (a) => call('history:append-sentences', a),
    reviseSentences: (a) => call('history:revise-sentences', a),
    getSentences: (a) => call('history:get-sentences', a),
    renameSpeaker: (a) => call('history:rename-speaker', a),
    reassignSentence: (a) => call('history:reassign-sentence', a),
    getSpeakers: (a) => call('history:get-speakers', a),
    saveNotes: (a) => call('history:save-notes', a),
    listNotes: (a) => call('history:list-notes', a),
    getNotes: (a) => call('history:get-notes', a),
    updateNotesNames: (a) => call('history:update-notes-names', a),
    search: (a) => call('history:search', a),
    binRecords: (a) => call('history:bin-records', a),
    restoreRecords: (a) => call('history:restore-records', a),
    purgeRecords: (a) => call('history:purge-records', a),
    dropTrack: (a) => call('history:drop-track', a),
    usage: () => call('history:usage', {}),
    appendTrack: (a) => call('history:append-track', a),
    saveTrack: (a) => call('history:save-track', a),
    status: () => call('history:status', {}),
    recognize: (a) => call('history:recognize', a),
    cancelRecognition: (a) => call('history:recognize-cancel', a),
    recognitionStatus: (a) => call('history:recognize-status', a),
  };
}

const nothing = async (): Promise<void> => undefined;

/** Where there is no History (the extension, the web build): reads find nothing, writes do nothing. */
export const nullHistoryPort: HistoryPort = {
  openRecord: nothing,
  closeRecord: async () => ({ kept: false }),
  getRecord: async () => null,
  listRecords: async () => [],
  renameRecord: nothing,
  putLeg: nothing,
  putSegments: nothing,
  putNotices: nothing,
  getLegs: async () => [],
  createTranscript: async () => 0,
  deleteTranscript: async () => {},
  appendSentences: async () => ({ added: 0 }),
  reviseSentences: nothing,
  getSentences: async () => [],
  renameSpeaker: nothing,
  reassignSentence: nothing,
  getSpeakers: async () => [],
  saveNotes: async () => 0,
  listNotes: async () => [],
  getNotes: async () => null,
  updateNotesNames: nothing,
  search: async () => [],
  binRecords: async () => ({ changed: 0 }),
  restoreRecords: async () => ({ changed: 0 }),
  purgeRecords: async () => ({ purged: [], failed: [] }),
  dropTrack: nothing,
  usage: async () => ({ dbBytes: 0, audioBytes: 0, records: 0, binned: 0 }),
  appendTrack: async () => ({ bytes: 0 }),
  saveTrack: async () => ({ saved: false }),
  status: async () => ({ available: false, dir: '' }),
  recognize: async () => ({ tokens: [], audioMs: 0 }),
  cancelRecognition: async () => false,
  recognitionStatus: async () => null,
};

/** The desktop's port in the desktop app, the null port anywhere else. */
export function historyPort(): HistoryPort {
  const bridge = typeof window !== 'undefined' ? window.electron : undefined;
  if (isElectron() && bridge?.invoke) return electronHistoryPort((channel, data) => bridge.invoke(channel, data));
  return nullHistoryPort;
}
