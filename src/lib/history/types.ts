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
}

export interface HistoryRecordInput {
  /** The run's id. */
  id: string;
  startedAt: number;
  /** A label of the preset the user picked; nothing decides anything by it. */
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

export interface HistoryTranscriptOrigin {
  service: string;
  kind: 'live' | 'file';
}

export interface HistoryTranscriptRow {
  id: number;
  origin: HistoryTranscriptOrigin;
  /** 'translation' when the service gave no original text and the sentences were cut from the translation. */
  textKind: 'original' | 'translation';
  createdAt: number;
  sentences: number;
}

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
