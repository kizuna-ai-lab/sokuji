/**
 * The speech contract: what a unit that occupies only `speech` receives and
 * what it emits. Types only.
 *
 * A speech session reads text it is handed, one stretch of a row's
 * translation at a time, and emits audio with the characters it speaks.
 * Which text is spoken, by which leg's voice, and where the audio goes are
 * the caller's business.
 */
import type { LegName } from '../conversation/types';
import type { ClientDiagnosticCode } from '../diagnostics/clientDiagnostics';
import type { AdapterFrame, Ref, SessionContext, TextRange } from './adapter';
import type { Clock } from './clock';

export interface SpeechStartRequest<C, K> {
  leg: LegName;
  /** The leg's direction; `speech` is true. */
  context: SessionContext;
  config: C;
  credentials: K;
  clock: Clock;
  signal: AbortSignal;
  /** One counter of audio entries per row, shared by every voice that reads the row (spec §7.2). */
  counts: Map<Ref, number>;
}

export interface SpeechEvents {
  /** `home`: the leg whose row this audio belongs to, when it is not this voice's leg. */
  audio(e: { pcm: Int16Array; ref: Ref; range?: TextRange; home?: LegName }): void;
  speechRanges(e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }>; home?: LegName }): void;
  /** Speech is degraded or gone; the session goes on. */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string; params?: Record<string, string | number> }): void;
  frame(e: AdapterFrame): void;
}

export interface SpeechSession {
  /** Never rejects: a voice that cannot open reports `degraded`. */
  open(): Promise<void>;
  /** `span`: where `text` sits in the row's whole translation. `language`: an app language code. `home`: see `SpeechEvents.audio`. */
  speak(ref: Ref, text: string, span: TextRange, language: string, home?: LegName): void;
  endUtterance(ref: Ref): void;
  setOn(on: boolean): void;
  /** The transcription connection came back: let a half-open connection go. */
  recycle?(): void;
  close(): void;
}
