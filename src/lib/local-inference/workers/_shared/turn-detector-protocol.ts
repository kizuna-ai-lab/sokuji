/**
 * The turn detector's vocabulary: the trace its core writes, what it delivers
 * to the recognizer on one ordered port, and its bounds (spec §3, §3.1).
 *
 * Positions are 16 kHz sample indices on the leg's timeline, counted from the
 * leg's first audio chunk; intervals are half-open, `[from, to)`.
 */
import type { SegmentEnd, VadWebConfig } from '../../types';
import type { SegmentLimit } from './max-speech-frames';

export type SegmentEndedBy = SegmentEnd['endedBy'];

/** What the core decided, in the order it decided it. Both outputs (segments, audio and marks) are built from it. */
export type TurnTrace =
  /** Real 16 kHz samples processed; a drained partial frame is shorter than 512. */
  | { kind: 'frame'; from: number; to: number; samples: Float32Array }
  /** A segment will start at `at` (automatic turns: pre-pad included, never before the last close). */
  | { kind: 'open'; at: number; press?: number }
  | { kind: 'close'; from: number; to: number; endedBy: SegmentEndedBy; press?: number; smartTurnProbability?: number }
  /** An open segment that ends as no segment (a misfire nobody keeps). */
  | { kind: 'drop'; from: number; to: number }
  | { kind: 'cancel'; press: number }
  | { kind: 'drained' };

export interface DetectorSegment {
  type: 'segment';
  epoch: number;
  seq: number;
  press?: number;
  audio: Float32Array;
  start: number;
  end: number;
  endedBy: SegmentEndedBy;
  smartTurnProbability?: number;
}
export interface DetectorCancel { type: 'cancel'; epoch: number; seq: number; press: number }
export interface DetectorDrained { type: 'drained'; epoch: number; seq: number }
/** Detector → recognizer, one ordered port. */
export type DetectorOutput = DetectorSegment | DetectorCancel | DetectorDrained;
/** Recognizer → detector, the same port: the recognizer started decoding `seq`. */
export interface RecognizerTaken { type: 'taken'; epoch: number; seq: number }

export type TurnFailureCode = 'turn_detection_overloaded' | 'turn_detection_unavailable';
export type DetectorNotice = { type: 'speech_start' } | { type: 'failed'; code: TurnFailureCode; message: string };

/** Unprocessed input beyond this fails the leg (C3). */
export const INPUT_BACKLOG_SECONDS = 2;
/** Segments waiting for the recognizer beyond this fail the leg (C3). */
export const DECODE_QUEUE_SEGMENTS = 5;
/** Audio waiting ahead of the newest segment beyond this fails the leg (C3). */
export const DECODE_QUEUE_SECONDS = 30;

/** The notice for both overloads (input and decode queue), verbatim. */
export function overloadedNotice(): DetectorNotice {
  return { type: 'failed', code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' };
}

/** Main thread → detector worker. The worker transfers `output` and `turnPort` ownership on arrival. */
export interface DetectorInitMessage {
  type: 'init';
  turns: 'auto' | 'manual';
  vad: VadWebConfig;
  limit: SegmentLimit;
  output: MessagePort;
  turnPort?: MessagePort;
  ortWasmBaseUrl: string;
  vadModelUrl: string;
}
export type DetectorInbound =
  | DetectorInitMessage
  | { type: 'audio'; pcm: Int16Array; sampleRate: number }
  | { type: 'begin'; press: number }
  | { type: 'drain'; press?: number }
  | { type: 'cancel'; press: number }
  | { type: 'stop'; epoch: number }
  | { type: 'dispose' };
/** Detector worker → main thread. `error` before `ready` fails the init; after it, a notice stands in for it. */
export type DetectorOutbound =
  | { type: 'ready'; loadTimeMs: number }
  | DetectorNotice
  | { type: 'error'; error: string; code?: TurnFailureCode };
