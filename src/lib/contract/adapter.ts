/**
 * L0 — what an adapter receives and what it emits. Types only.
 *
 * An adapter talks to one provider for one leg and emits content: text
 * between provider boundaries (segments), audio with the stretch of text it
 * speaks (range), and lifecycle. Identity, time, ordering, cutting and logging
 * vocabulary are not its business (spec: "L0 — the client contract").
 */
import type { ClientDiagnosticCode } from '../diagnostics/clientDiagnostics';
import type { Clock } from './clock';

/** Audio crosses the contract at this rate, mono, Int16, in both directions. */
export const SAMPLE_RATE = 24000;

export type Lang = string;
export type Side = 'source' | 'translation';
/** An adapter-local counter naming a segment; never reused within one session. */
export type Ref = number;
/** UTF-16 code-unit offsets into a segment's text: [start, end). */
export type TextRange = [number, number];
export interface SegmentTiming { startMs: number; endMs: number }

export interface SessionContext {
  direction: { source: Lang; target: Lang };
  /** Produce translated audio at all. */
  speech: boolean;
  /** Always 'auto' on the participant leg. */
  turns: 'auto' | 'manual';
}

/** Asks a punctuation model for `text` with marks. Null: no answer. */
export type Punctuator = (lang: string, text: string) => Promise<string | null>;

export interface StartRequest<C, K> {
  context: SessionContext;
  config: C;
  credentials: K;
  /** A track from the runner's capture graph, for adapters that send a native
   *  track (WebRTC). Absent in tests and ignored by adapters that take pcm. */
  input?: MediaStreamTrack;
  /** Every timer the adapter runs reads this clock; tests pass a virtual one. */
  clock: Clock;
  /** Aborted when the run is cancelled; an adapter still opening rejects and opens nothing. */
  signal: AbortSignal;
  /** The runner's punctuation model, for an adapter that cuts its own translation jobs (LocalInference). Absent: none is installed. */
  punctuate?: Punctuator;
}

export interface AdapterSession {
  appendAudio(pcm: Int16Array): void;
  appendText(text: string): void;
  /** Manual turns only: key pressed / released with speech / released without. */
  beginTurn(): void;
  endTurn(): void;
  cancelTurn(): void;
  /**
   * Closes its socket (or ends its pipeline) before its first `await`: on
   * `pagehide` the runner calls `stop()` without awaiting it, and only what
   * ran synchronously is sure to happen.
   */
  stop(): Promise<void>;
  /** What the started session actually used, for telemetry. */
  readonly info: { transport?: string };
}

/** One protocol frame an adapter reported (spec D8): what the Logs panel lists. Never audio, never a credential. */
export interface AdapterFrame {
  direction: 'in' | 'out';
  type: string;
  payload?: unknown;
}

export interface AdapterEvents {
  segmentOpened(e: { ref: Ref; side: Side; origin?: string }): void;
  /** Always the whole text; a snapshot, never a delta. */
  segmentText(e: { ref: Ref; text: string; timing?: SegmentTiming; language?: string }): void;
  segmentClosed(e: { ref: Ref; origin?: string }): void;
  /** `ref` absent: attributable to no segment (plays, pairs with nothing).
   *  `range` absent: this segment's audio, which characters unknown. */
  audio(e: { pcm: Int16Array; ref?: Ref; range?: TextRange }): void;
  closed(e: { reason: string }): void;
  reconnecting(): void;
  reconnected(): void;
  /** The session is broken. Nothing follows. */
  failed(e: { message: string; code?: string; cause?: unknown }): void;
  /** Running, degraded. */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown }): void;
  loading(e: { stage: string; done: number; total: number }): void;
  busy(e: boolean): void;
  /** Wire traffic for the Logs panel. Never audio, never a credential. */
  frame(e: AdapterFrame): void;
}

export interface Adapter<C, K> {
  start(request: StartRequest<C, K>, events: AdapterEvents): Promise<AdapterSession>;
}

/**
 * A start that failed for a reason the user can be told in words: `code` is a
 * notice code. `cause` is the underlying failure, for the console — set here,
 * not passed to `super`: this project's lib (ES2020) has no `Error` options.
 */
export class AdapterStartError extends Error {
  readonly cause?: unknown;

  constructor(message: string, readonly code: string, readonly params?: Record<string, string | number>, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
  }
}
