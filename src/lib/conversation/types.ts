import type { Side, SegmentTiming, TextRange } from '../contract/adapter';

export type LegName = 'speaker' | 'participant';
/** `${session}:${leg}:${n}` */
export type SegmentId = string;

export interface Mark { at: number; len: number }

export interface Speech {
  /** Which characters this pcm speaks. Absent: replay only, no karaoke. */
  range?: TextRange;
  /** 24 kHz mono. Empty when retention dropped it. */
  pcm: Int16Array;
}

export interface Segment {
  id: SegmentId;
  ref: number;
  side: Side;
  /** Display text, replaced wholesale. */
  text: string;
  /** The adapter closed it. */
  final: boolean;
  /** L1 wall clock at open. */
  openedAt: number;
  /** Growth trace, compacted. */
  marks: readonly Mark[];
  timing?: SegmentTiming;
  language?: string;
  /** Stated by the adapter only; inference lives in L2. */
  origin?: string;
  speech: readonly Speech[];
}

export interface Notice {
  id: string;
  at: number;
  severity: 'error' | 'warning';
  /** Diagnostic English. Surfaces localize by `code` and `params`. */
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

/** What a caller supplies to record a notice; the leg adds its id and time. */
export type NoticeInput = Pick<Notice, 'severity' | 'message' | 'code' | 'params'>;

export interface Languages { source: string; target: string }

export interface Leg {
  leg: LegName;
  session: string;
  /** Frozen at start. The participant leg's is already the reversed pair. */
  languages: Languages;
  segments: readonly Segment[];
  notices: readonly Notice[];
}

export const EMPTY_PCM: Int16Array = new Int16Array(0);
