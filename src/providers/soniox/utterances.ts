/**
 * Soniox's tokens as segments (survey §1.5, §2.9): a pure state machine
 * over the STT socket's messages, one per session core. An utterance is
 * the tokens between two boundaries — `<end>` (the endpoint), or `<fin>`
 * (the answer to `finalize`, the boundary under manual turns: ruling 5).
 * Its originals are one source segment and its translation one translation
 * segment, both stating origin `u<n>`. Refs come from one counter and are
 * never reused, a resume included. Each message's final translation text
 * is handed to speech as one chunk with its span (ruling 2). A translation
 * token after a boundary and before the next original token belongs to the
 * utterance that just ended (choice 3). The one timer is the `<fin>`
 * grace, on the request's clock.
 *
 * Invariant: `current` and `previous` are never both set. An utterance
 * begins only once the ended one is let go (`endPrevious()` before
 * `begin()`, or neither set), and a boundary clears `current` before it
 * makes that utterance `previous`.
 */
import type { AdapterEvents, AdapterFrame, Ref, TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import type { SonioxToken } from './sttStream';

/** How long a translation stays open after `<fin>` for the last words' tokens (ruling 5). A judgement: the owner checks it live. */
export const FIN_TRANSLATION_GRACE_MS = 2_000;

type PayloadOf<K extends keyof AdapterEvents> = Parameters<AdapterEvents[K]>[0];
export type SegmentEvent =
  | { kind: 'segmentOpened'; payload: PayloadOf<'segmentOpened'> }
  | { kind: 'segmentText'; payload: PayloadOf<'segmentText'> }
  | { kind: 'segmentClosed'; payload: PayloadOf<'segmentClosed'> };

export interface UtteranceSink {
  segment(leg: LegName, event: SegmentEvent): void;
  /** A final translation chunk for `ref`; `span` is where it sits in the translation's text. */
  speak(leg: LegName, ref: Ref, text: string, span: TextRange, language: string): void;
  /** The translation `ref` will say nothing more for now: its speech's utterance ends. */
  endSpeech(leg: LegName, ref: Ref): void;
}

export interface UtteranceOptions {
  sink: UtteranceSink;
  clock: Pick<Clock, 'setTimeout'>;
  /** The leg an utterance belongs to, decided at its first token. */
  legFor(token: SonioxToken): LegName;
  /** The speech language when no final translation token names one: the leg's target. */
  targetFor(leg: LegName): string;
}

interface Utterance {
  leg: LegName;
  origin: string;
  sourceRef?: Ref;
  sourceClosed: boolean;
  sourceFinal: string;
  sourceLanguage?: string;
  startMs?: number;
  endMs?: number;
  /** The last source snapshot emitted, as a key: nothing is sent twice. */
  sourceShown?: string;
  translationRef?: Ref;
  translation: 'none' | 'open' | 'closed';
  translationFinal: string;
  translationLanguage?: string;
  translationShown?: string;
  /** The first final translation token's language: what speech speaks this utterance in. */
  speechLanguage?: string;
  /** How much of `translationFinal` speech has been handed. */
  spokenUpTo: number;
  cancelGrace?: () => void;
}

export class Utterances {
  private nextRef = 1;
  private count = 0;
  private current: Utterance | null = null;
  /** The last utterance to end: its translation still takes late tokens, until the next original token (choice 3). */
  private previous: Utterance | null = null;
  private stopped = false;

  constructor(private readonly o: UtteranceOptions) {}

  message(tokens: readonly SonioxToken[]): void {
    if (this.stopped) return;
    let sourcePartial = '';
    let translationPartial = '';
    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<end>' || text === '<fin>') {
        this.boundary(text === '<fin>' ? 'fin' : 'end');
        sourcePartial = '';
        translationPartial = '';
        continue;
      }
      if (token.translation_status === 'translation') {
        const u = this.current ?? this.previous ?? this.begin(token);
        // A late partial opens nothing: partials are shown only on the current
        // utterance, so it would open an empty row the grace then closes with
        // nothing spoken. The late final that follows opens it.
        if (u === this.previous && !token.is_final && u.translation === 'none') continue;
        if (token.language) u.translationLanguage = token.language;
        this.openTranslation(u);
        if (token.is_final) {
          u.translationFinal += text;
          if (token.language) u.speechLanguage ??= token.language;
        } else if (u === this.current) {
          translationPartial += text;
        }
      } else {
        // An original ('original' or 'none'): the next utterance has begun.
        this.endPrevious();
        const u = this.current ?? this.begin(token);
        if (token.language) u.sourceLanguage = token.language;
        if (token.start_ms !== undefined && u.startMs === undefined) u.startMs = token.start_ms;
        if (token.end_ms !== undefined) u.endMs = token.end_ms;
        this.openSource(u);
        if (token.is_final) u.sourceFinal += text;
        else sourcePartial += text;
      }
    }
    // At most one of the two is set (the invariant): the ended utterance, whose
    // late translation this message may have added to, or the current one.
    if (this.previous) {
      this.speakFinals(this.previous);
      this.showTranslation(this.previous, '');
    }
    if (this.current) {
      this.speakFinals(this.current);
      this.show(this.current, sourcePartial, translationPartial);
    }
  }

  /** A 503 swaps the socket (ruling 3): what is open closes as it stands — L1 keeps the last snapshot — and refs go on. */
  abandon(): void {
    if (this.stopped) return;
    const u = this.current;
    this.current = null;
    if (u) {
      if (u.sourceRef !== undefined && !u.sourceClosed) {
        u.sourceClosed = true;
        this.emit(u, { kind: 'segmentClosed', payload: { ref: u.sourceRef, origin: u.origin } });
      }
      this.closeTranslation(u);
    }
    this.endPrevious();
  }

  stop(): void {
    this.stopped = true;
    this.current?.cancelGrace?.();
    this.previous?.cancelGrace?.();
  }

  private begin(token: SonioxToken): Utterance {
    this.count += 1;
    const u: Utterance = {
      leg: this.o.legFor(token), origin: `u${this.count}`,
      sourceClosed: false, sourceFinal: '', translation: 'none', translationFinal: '', spokenUpTo: 0,
    };
    this.current = u;
    return u;
  }

  private openSource(u: Utterance): void {
    if (u.sourceRef !== undefined) return;
    u.sourceRef = this.nextRef++;
    this.emit(u, { kind: 'segmentOpened', payload: { ref: u.sourceRef, side: 'source', origin: u.origin } });
  }

  private openTranslation(u: Utterance): void {
    if (u.translation !== 'none') return;
    u.translationRef = this.nextRef++;
    u.translation = 'open';
    this.emit(u, { kind: 'segmentOpened', payload: { ref: u.translationRef, side: 'translation', origin: u.origin } });
    // Opened after its utterance ended: held for the grace, as after `<fin>`.
    if (u === this.previous) this.armGrace(u);
  }

  private boundary(kind: 'end' | 'fin'): void {
    const u = this.current;
    if (!u) return;
    this.speakFinals(u);
    this.show(u, '', '');
    if (u.sourceRef !== undefined && !u.sourceClosed) {
      u.sourceClosed = true;
      this.emit(u, { kind: 'segmentClosed', payload: { ref: u.sourceRef, origin: u.origin } });
    }
    this.current = null;
    this.previous = u;
    if (kind === 'end') this.closeTranslation(u);
    else if (u.translation === 'open') this.armGrace(u);
  }

  private armGrace(u: Utterance): void {
    u.cancelGrace?.();
    u.cancelGrace = this.o.clock.setTimeout(() => {
      u.cancelGrace = undefined;
      if (!this.stopped) this.closeTranslation(u);
    }, FIN_TRANSLATION_GRACE_MS);
  }

  private closeTranslation(u: Utterance): void {
    u.cancelGrace?.();
    u.cancelGrace = undefined;
    if (u.translation !== 'open' || u.translationRef === undefined) return;
    u.translation = 'closed';
    this.emit(u, { kind: 'segmentClosed', payload: { ref: u.translationRef, origin: u.origin } });
    this.o.sink.endSpeech(u.leg, u.translationRef);
  }

  /**
   * The next original token: the ended utterance takes no more late tokens.
   * What it took in this very message is shown and spoken first — the flush
   * at the end of `message()` can no longer reach it once `previous` is
   * cleared (cases 19–20). `speakFinals` ends the speech of
   * a translation already closed; `closeTranslation` that of an open one.
   */
  private endPrevious(): void {
    const p = this.previous;
    this.previous = null;
    if (!p) return;
    this.speakFinals(p);
    this.showTranslation(p, '');
    this.closeTranslation(p);
  }

  private speakFinals(u: Utterance): void {
    if (u.translationRef === undefined) return;
    const from = u.spokenUpTo;
    const to = u.translationFinal.length;
    if (to <= from) return;
    u.spokenUpTo = to;
    this.o.sink.speak(u.leg, u.translationRef, u.translationFinal.slice(from, to), [from, to], u.speechLanguage ?? this.o.targetFor(u.leg));
    // A late chunk on a closed translation: nothing more follows it.
    if (u.translation === 'closed') this.o.sink.endSpeech(u.leg, u.translationRef);
  }

  private show(u: Utterance, sourcePartial: string, translationPartial: string): void {
    if (u.sourceRef !== undefined && !u.sourceClosed) {
      const text = u.sourceFinal + sourcePartial;
      const timing = u.startMs !== undefined && u.endMs !== undefined ? { startMs: u.startMs, endMs: u.endMs } : undefined;
      const key = JSON.stringify([text, timing, u.sourceLanguage]);
      if (key !== u.sourceShown) {
        u.sourceShown = key;
        this.emit(u, { kind: 'segmentText', payload: { ref: u.sourceRef, text, ...(timing ? { timing } : {}), ...(u.sourceLanguage ? { language: u.sourceLanguage } : {}) } });
      }
    }
    this.showTranslation(u, translationPartial);
  }

  private showTranslation(u: Utterance, partial: string): void {
    if (u.translationRef === undefined) return;
    const text = u.translationFinal + partial;
    const key = JSON.stringify([text, u.translationLanguage]);
    if (key === u.translationShown) return;
    u.translationShown = key;
    this.emit(u, { kind: 'segmentText', payload: { ref: u.translationRef, text, ...(u.translationLanguage ? { language: u.translationLanguage } : {}) } });
  }

  private emit(u: Utterance, event: SegmentEvent): void {
    if (!this.stopped) this.o.sink.segment(u.leg, event);
  }
}

/** One message for the Logs, in the old timeline's words (survey §1.17): nothing for a keepalive's empty message. */
export function tokenFrames(tokens: readonly SonioxToken[]): AdapterFrame[] {
  if (tokens.length === 0) return [];
  let transcript = '';
  let translation = '';
  let endpoint = false;
  let finalized = false;
  let allFinal = true;
  let content = false;
  for (const token of tokens) {
    const text = token.text ?? '';
    if (text === '<end>') { endpoint = true; continue; }
    if (text === '<fin>') { finalized = true; continue; }
    content = true;
    if (!token.is_final) allFinal = false;
    if (token.translation_status === 'translation') translation += text;
    else transcript += text;
  }
  const out: AdapterFrame[] = [];
  if (content && allFinal) {
    if (transcript) out.push({ direction: 'in', type: 'stt.transcript', payload: { text: transcript } });
    if (translation) out.push({ direction: 'in', type: 'stt.translation', payload: { text: translation } });
  } else if (content) {
    out.push({ direction: 'in', type: 'stt.delta', payload: { transcript, translation } });
  }
  if (endpoint) out.push({ direction: 'in', type: 'stt.endpoint' });
  if (finalized) out.push({ direction: 'in', type: 'stt.finalized' });
  return out;
}
