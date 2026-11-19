// src/lib/history/types.ts
//
// The shapes that cross the History bridge (electron/history-store.js and electron/history-ipc.js). Times inside
// a record are milliseconds on the record's clock; wall-clock times are epoch milliseconds.
import type { Languages, LegName, Notice, Segment } from '../conversation/types';

/** The services a record ran on: what a run reports today, and the line-up's stages when there is one. */
export interface HistoryServices {
  provider: string;
  models: Record<string, string>;
  stages?: Record<string, { provider: string; ability: string }>;
  /** An imported file's: what its transcription was asked for, kept even when that transcription failed. */
  options?: FileTranscriptionOptions;
}

export interface HistoryRecordInput {
  /** The run's id. */
  id: string;
  startedAt: number;
  /**
   * Whose speech the session heard: 'speaker', 'participant', 'both', 'face-to-face', or 'import' for a file. History
   * shows which way the languages went by it (languageDirection.ts); any other value reads as 'speaker'.
   */
  mode: string;
  myLanguage: string;
  targetLanguage: string;
  services: HistoryServices;
  appVersion: string;
}

export interface HistoryRecordRow {
  id: string;
  startedAt: number;
  endedAt: number | null;
  state: 'open' | 'closed';
  mode: string;
  myLanguage: string;
  targetLanguage: string;
  title: string | null;
  titleByUser: boolean;
  binnedAt: number | null;
  /** The sentences of the record's newest transcript. */
  sentences: number;
  hasRecording: boolean;
  notesVersions: number;
  /** How the newest version of the notes ended; null without notes. */
  notesState: HistoryNotesState | null;
  /** Some version of the notes is complete. */
  notesComplete: boolean;
  audioBytes: number;
}

export interface HistoryTrack {
  source: string;
  /** A file name inside the record's folder. */
  file: string;
  format: string;
  durationMs: number;
  bytes: number;
  /** Where the track's first sample lies on the record's clock. */
  offsetMs: number;
  goneAt: number | null;
}

/** A track of a recording: one per leg. */
export type HistoryTrackSource = 'speaker' | 'participant';

/** One piece of a track being recorded. */
export interface HistoryTrackPiece {
  recordId: string;
  source: HistoryTrackSource;
  /** Where the track's first sample lies on the record's clock; the first piece's is kept. */
  offsetMs: number;
  /** The track's length so far, including this piece. */
  durationMs: number;
  data: Uint8Array;
}

export type HistoryInput = 'microphone' | 'system' | 'app' | 'tab';

/** How a leg was put together. */
export interface HistoryLegComposition {
  leg: LegName;
  languages: Languages;
  input: HistoryInput | null;
  /** The name the interface showed for the input. */
  inputName: string | null;
  /** The system's id for it at the time; only tells apart two inputs of one record. */
  inputId: string | null;
  translated: boolean;
  spoken: boolean;
}

export interface HistoryLegInput {
  recordId: string;
  leg: LegName;
  languages: Languages;
  input?: HistoryInput | null;
  inputName?: string | null;
  inputId?: string | null;
  translated?: boolean;
  spoken?: boolean;
}

/** What a file transcription is asked for: the languages spoken (the main one first), and the one to translate into. */
export interface FileTranscriptionOptions {
  languages: string[];
  translateTo: string;
}

export interface HistoryTranscriptOrigin {
  service: string;
  kind: 'live' | 'file';
  /** A file transcript's: what it was asked for. */
  options?: FileTranscriptionOptions;
}

export interface HistoryTranscriptRow {
  id: number;
  origin: HistoryTranscriptOrigin;
  /** 'translation' when the service gave no original text and the sentences were cut from the translation. */
  textKind: 'original' | 'translation';
  createdAt: number;
  sentences: number;
}

/**
 * A word of a file transcript: every file recognition service answers in this shape (Soniox's own). A translated word
 * says so (`translation_status: 'translation'`) and has no time: it follows the words it translates.
 */
export interface FileToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string;
  language?: string;
  confidence?: number;
  translation_status?: 'original' | 'translation' | 'none';
  source_language?: string;
}

/** The app's word list in the file recognition service's own context shape: sent as it is. */
export type FileRecognitionContext = object;

/**
 * A kept track sent to file recognition: the service, its key and region, the languages to expect, the job's id.
 * Through Kizuna AI's service (`kizunaai_soniox`) no key: the service's address, the sign-in's token, who pays, and the
 * length of the record's tracks still to come after this one.
 */
export interface HistoryRecognizeRequest {
  recordId: string;
  service: string;
  source: HistoryTrackSource;
  /** The user's own key; absent through Kizuna AI's service. */
  apiKey?: string;
  region?: string;
  /** Kizuna AI's service address (`getApiUrl()`), its file jobs under `/soniox/file-jobs`. */
  apiUrl?: string;
  /** The sign-in's token, for this job's calls only. */
  token?: string;
  /** Who pays, for an organization member; absent otherwise. */
  payer?: 'organization' | 'personal';
  /** The summed length of the record's tracks sent after this one, in milliseconds. */
  laterAudioMs?: number;
  languageHints: string[];
  /** The service's code of the language to translate into; absent, nothing is translated. */
  translateTo?: string;
  /** The word list, in the service's own shape; absent, none is sent. */
  context?: FileRecognitionContext;
  jobId: string;
}

export type HistoryRecognizePhase = 'uploading' | 'queued' | 'processing' | 'fetching';

export type HistoryNotesState = 'complete' | 'failed' | 'cancelled';

export interface HistoryNotesRef {
  id: number;
  /** Null when its transcript was deleted. */
  transcriptId: number | null;
  language: string;
  createdAt: number;
  state: HistoryNotesState;
}

export interface HistoryRecord extends HistoryRecordRow {
  services: HistoryServices;
  appVersion: string;
  /** The UTF-8 size of the record's segments, sentences and notes. */
  textBytes: number;
  legs: HistoryLegComposition[];
  tracks: HistoryTrack[];
  transcripts: HistoryTranscriptRow[];
  notes: HistoryNotesRef[];
}

/** A segment as History keeps it: the app's segment without its speech. */
export type HistorySegment = Omit<Segment, 'speech'>;

export type HistorySentenceSide = 'mine' | 'other';
export type HistorySentenceTrack = 'microphone' | 'other';
export type HistoryTimeKind = 'given' | 'spread' | 'estimated';

export interface HistorySentenceInput {
  n: number;
  segmentId?: string;
  side: HistorySentenceSide;
  sideCertain: boolean;
  track: HistorySentenceTrack;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
  language?: string;
  timeKind: HistoryTimeKind;
  /** A file transcript's translation of what the service translated starting in this sentence; absent where none began. */
  translation?: string;
}

export interface HistorySentence {
  n: number;
  segmentId: string | null;
  side: HistorySentenceSide;
  sideCertain: boolean;
  track: HistorySentenceTrack;
  /** The recognizer's label. */
  speaker: string;
  /** The speaker the user gave the sentence to, or null. */
  speakerByUser: string | null;
  /** The name of the effective speaker, or null. */
  speakerName: string | null;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
  timeKind: HistoryTimeKind;
  /** A file transcript's translation of what the service translated starting in this sentence; null where none began, and in a session's. */
  translation: string | null;
}

export interface HistorySpeaker {
  side: HistorySentenceSide;
  speaker: string;
  name: string | null;
  sentences: number;
}

export type HistoryNotesWriter =
  | { kind: 'sokuji'; promptVersion: number | string; model: string }
  | { kind: 'service'; name: string; version: string };

export interface HistoryNotesBody {
  title: string;
  overview: { text: string; format: 'plain' | 'markdown' };
  topics: Array<{ title: string; summary: string } & Record<string, unknown>>;
  points: Array<{ text: string } & Record<string, unknown>>;
  names: Array<Record<string, unknown>>;
}

export interface HistoryNotesInput {
  recordId: string;
  transcriptId: number | null;
  writtenBy: HistoryNotesWriter;
  language: string;
  state: HistoryNotesState;
  failure?: string | null;
  requestIds?: string[];
  body?: HistoryNotesBody | null;
}

export interface HistoryNotesRow {
  id: number;
  transcriptId: number | null;
  writtenBy: HistoryNotesWriter;
  language: string;
  createdAt: number;
  state: HistoryNotesState;
  failure: string | null;
}

export interface HistoryNotes extends HistoryNotesRow {
  recordId: string;
  requestIds: string[];
  body: HistoryNotesBody | null;
}

export type HistorySearchHit =
  | { kind: 'sentence'; transcriptId: number; n: number; text: string }
  | { kind: 'translation'; segmentId: string; text: string }
  | { kind: 'notes'; notesId: number }
  | { kind: 'title' };

export interface HistorySearchResult {
  recordId: string;
  title: string | null;
  startedAt: number;
  hits: number;
  first: HistorySearchHit;
}

export interface HistoryUsage {
  dbBytes: number;
  audioBytes: number;
  records: number;
  binned: number;
}

export interface HistoryStatus {
  available: boolean;
  /** Why it is not: 'newer' when its file was written by a newer version of the app. */
  reason?: 'newer' | 'error';
  dir: string;
}

export type { Notice };
