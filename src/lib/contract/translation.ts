/**
 * The translation contract: what a unit that occupies only `translation`
 * receives and what it emits. Types, and the one rule of what a source must
 * hold to be translated at all (`hasSpeech`).
 *
 * A translation session is handed the source text of one leg, one snapshot
 * of a source segment at a time, and emits translation segments that name
 * the source they translate by its `origin`. Whose source it is, where the
 * translations are shown and who reads them aloud are the caller's business.
 *
 * Two families of unit fit it. A streaming unit grows a translation as its
 * source grows, and says how much of it will stay (`stableLen`). A unit that
 * asks and is answered sends one job per stretch of source (`jobTranslator`),
 * and each answer is one segment, whole and final.
 *
 * Typed text is not part of this contract. It stays a capability of the unit
 * that transcribes: that unit shows the typed text as a source segment, which
 * reaches a translation session as any source does. A `text()` of its own
 * here would give typed text a second way in, and a line-up whose
 * transcription takes no typed text would still have to refuse it.
 */
import type { LegName } from '../conversation/types';
import type { ClientDiagnosticCode } from '../diagnostics/clientDiagnostics';
import type { AdapterFrame, Ref, SessionContext } from './adapter';
import type { Clock } from './clock';

export interface TranslationStartRequest<C, K> {
  leg: LegName;
  /** The leg's direction: from `source` into `target`. `speech` is false: a translation unit never speaks. */
  context: SessionContext;
  config: C;
  credentials: K;
  /** Every timer the session runs reads this clock. */
  clock: Clock;
  /** Aborted when the run is cancelled; a session still opening rejects and opens nothing. */
  signal: AbortSignal;
}

/**
 * One source segment as it stands. `text` is always the whole text, never a delta. The first `stableLen`
 * characters will not change in a later snapshot of the same origin. `closed`: the segment has ended, the whole
 * text is stable, and no snapshot of this origin follows. `language`: the language heard, when the caller knows it.
 *
 * A source that closes without a letter or a digit in it (`hasSpeech`: a pause's dots, a lone mark) holds nothing
 * to translate: the session owes it no translation and no notice.
 */
export interface SourceSnapshot { origin: string; text: string; stableLen: number; closed: boolean; language?: string }

/**
 * Whether a text holds anything to translate: a letter or a digit, in any script. The one rule of it, read by
 * whoever cuts a source into jobs and by the rule suite alike.
 */
export function hasSpeech(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export interface TranslationEvents {
  /**
   * A translation segment of the source named `origin`, an origin the session was handed. Several segments may
   * name one origin: a long source is translated a sentence at a time. `ref` is the session's own counter, never
   * reused within the session.
   */
  translationOpened(e: { ref: Ref; origin: string }): void;
  /** Always the whole text of the segment. The first `stableLen` characters will not change. */
  translationText(e: { ref: Ref; text: string; stableLen: number; language?: string }): void;
  /** The segment is final as it was last said; no text follows for it. */
  translationClosed(e: { ref: Ref }): void;
  /** The unit is broken and translates nothing more. Nothing follows. */
  failed(e: { message: string; code?: string; cause?: unknown }): void;
  /**
   * Running, degraded: one stretch of source could not be translated (`translation_failed`), and the session goes
   * on with the next. `reason` and `params` as on the adapter contract's `degraded`.
   */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string; params?: Record<string, string | number> }): void;
  /** Progress of what the session loads before it can translate. */
  loading(e: { stage: string; done: number; total: number }): void;
  /** Wire traffic for the Logs panel. Never a credential. */
  frame(e: AdapterFrame): void;
}

export interface TranslationSession {
  /** Resolves when the session can translate. Rejects when it cannot start: the leg does not start. */
  open(): Promise<void>;
  /** A source segment's text so far. Snapshots of one origin come in order; origins may interleave. */
  source(e: SourceSnapshot): void;
  /**
   * Ends the session before its first `await`. What is pending is abandoned: no event follows, but a `frame` the
   * ending says of itself before the promise settles.
   */
  stop(): Promise<void>;
}
