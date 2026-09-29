/**
 * Gemini's server content → segments (survey §2.9): the old client's turn
 * handling (`GeminiClient.ts:1148-1389`) without its items — a pure state
 * machine on the request's clock. A dialogue model ends a turn with
 * `turnComplete`, so its source and translation share the turn's origin,
 * stated (`t<n>`). Live Translate has no turns (`GeminiClient.ts:74-94`):
 * each side is its own segment, closed by its own silence timer, and its
 * origin is L2's to infer (F16). The audio a translation plays carries the
 * stretch of its text that had arrived with it — karaoke by arrival
 * (Gemini/AST2 follow-up, ruling 2; choice 7).
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { SilenceDeferral } from '../../lib/segmentation/silenceDeferral';
import type { GeminiConfig } from './config';

export type TurnSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;

export interface GeminiTurnsOptions {
  kind: GeminiConfig['kind'];
  /** The leg speaks: the model's audio is emitted; otherwise dropped (the conformance rule `no-audio-when-silent`). */
  speech: boolean;
  clock: Pick<Clock, 'setTimeout'>;
  /** Live Translate's silence timers (`C.silence`); absent for a dialogue model. */
  silence?: GeminiConfig['silence'];
  sink: TurnSink;
}

const CJK = '\\u3000-\\u303f\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
const CJK_SPACE = new RegExp(`([${CJK}])\\s+([${CJK}])`, 'g');

/** Gemini 3.x spaces CJK characters apart in its input transcription ("今 天" → "今天"; `GeminiClient.ts:1671-1688`). */
export function normalizeCjkSpaces(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    // Repeated: each match consumes both characters, so overlapping pairs need another pass.
    result = result.replace(CJK_SPACE, '$1$2');
  } while (result !== previous);
  return result;
}

type SideName = 'source' | 'translation';

interface OpenSide {
  ref: Ref;
  /** What the server sent, accumulated; the source's is shown normalized. */
  text: string;
  /** Translation only: where the last played chunk's range ended (Gemini/AST2 follow-up, ruling 2). */
  spoken: number;
}

export class GeminiTurns {
  private refs = 0;
  private turn = 1;
  private readonly sides: Record<SideName, OpenSide | null> = { source: null, translation: null };
  private readonly timers: Record<SideName, (() => void) | null> = { source: null, translation: null };
  private readonly deferral: Record<SideName, SilenceDeferral> = { source: new SilenceDeferral(), translation: new SilenceDeferral() };
  /** A dialogue turn's text parts: its translation when no transcript came. */
  private fallbackText = '';
  /** A dialogue model's answer is streaming: its output transcript, audio or text arrived since the last `turnComplete` / `interrupted` (choice 16). */
  private answering = false;
  /**
   * A dialogue answer is owed: a press with voice was released, or text was typed, and that answer has not ended
   * (ruling 8, choice 16); one released while an earlier answer streamed is owed from that answer's end (`owedNext`).
   * A flag, not a count: two voiced releases (or typed texts) waiting at once for their answers to start — both made
   * before any answer streams, both while the same earlier answer streams, or one while it streams and one after it
   * ends — are one claim, so a voiceless press before either answer streams drops the second's answer, not its own.
   */
  private owed = false;
  /**
   * A press with voice was released, or text was typed, while an earlier answer streamed: its answer is owed from that
   * answer's end — its `turnComplete` under `NO_INTERRUPTION`, or, on a model that barges in, its `interrupted`
   * (Gemini/AST2 follow-up, ruling 5) — which moves this flag into `owed` instead of clearing it. It assumes such a
   * press gets an answer of its own after the streaming one, as both overlap probes did (each answered the second
   * utterance whole, as its own turn, under automatic detection). Set only while `answering`, and moved on or cleared
   * wherever `answering` clears, so it implies `answering`: a cancel that meets it always waits for the streaming end.
   */
  private owedNext = false;
  /** The cancelled press's own answer is being dropped, until it ends (ruling 8). */
  private suppressing = false;
  /** A cancel came while the previous press's answer was owed or streaming: the drop starts when that answer ends (choice 16). */
  private suppressAfterAnswer = false;
  /**
   * `interrupted` ended an answer and no content has come since: the next `turnComplete` is that same end, which a
   * model that barges in sends a few milliseconds after it, so it ends nothing more (Gemini/AST2 follow-up, ruling 5).
   */
  private interruptedEnd = false;
  private stopped = false;

  constructor(private readonly o: GeminiTurnsOptions) {}

  private get dialogue(): boolean {
    return this.o.kind === 'dialogue';
  }

  /** A dialogue turn's origin; Live Translate states none. */
  private origin(): string | undefined {
    return this.dialogue ? `t${this.turn}` : undefined;
  }

  input(text: string): void {
    if (this.stopped || !text) return;
    // Content, even content a drop swallows: a `turnComplete` after it ends an answer of its own.
    this.interruptedEnd = false;
    if (this.suppressing) return;
    const side = this.ensure('source');
    side.text += text;
    this.o.sink.segmentText({ ref: side.ref, text: normalizeCjkSpaces(side.text) });
    this.arm('source');
  }

  output(text: string): void {
    if (this.stopped || !text) return;
    this.interruptedEnd = false;
    if (this.suppressing) return;
    if (this.dialogue) this.answering = true;
    const side = this.ensure('translation');
    side.text += text;
    this.o.sink.segmentText({ ref: side.ref, text: side.text });
    this.arm('translation');
  }

  /**
   * The model's audio. Played, it carries its translation's text as it
   * stood when the chunk arrived — `[the previous played chunk's end, the
   * text's length]`, `[0, 0]` before any text — an alignment by arrival,
   * not a known correspondence: the honesty rule's third stated exception
   * (Gemini/AST2 follow-up, ruling 2; choice 7). The text only grows, so no
   * range ever needs stating again.
   */
  audio(pcm: Int16Array): void {
    if (this.stopped || pcm.length === 0) return;
    this.interruptedEnd = false;
    if (this.suppressing) return;
    // Streaming, whether or not this leg plays it.
    if (this.dialogue) this.answering = true;
    if (!this.o.speech) return;
    // Live Translate: audio outside an open translation plays and is no row's (choice 8). Audio never re-arms a timer: it streams straight through pauses (`GeminiClient.ts:1319-1324`).
    if (!this.dialogue && !this.sides.translation) {
      this.o.sink.audio({ pcm });
      return;
    }
    const side = this.ensure('translation');
    const end = side.text.length;
    this.o.sink.audio({ pcm, ref: side.ref, range: [side.spoken, end] });
    side.spoken = end;
  }

  modelText(text: string): void {
    if (this.stopped || !text) return;
    this.interruptedEnd = false;
    if (this.suppressing || !this.dialogue) return;
    this.answering = true;
    this.fallbackText += text;
  }

  turnComplete(): void {
    if (this.stopped) return;
    if (this.interruptedEnd) {
      // The rest of the end `interrupted` made: nothing more ends here, and a drop that end started goes on to the
      // cancelled press's own answer (ruling 8).
      this.interruptedEnd = false;
      return;
    }
    if (this.suppressing) {
      // The cancelled press's own answer ended.
      this.suppressing = false;
      return;
    }
    if (this.dialogue && this.fallbackText) {
      const translation = this.ensure('translation');
      if (!translation.text) this.o.sink.segmentText({ ref: translation.ref, text: this.fallbackText });
    }
    this.endAnswer();
  }

  interrupted(): void {
    if (this.stopped) return;
    this.interruptedEnd = true;
    if (this.suppressing) {
      this.suppressing = false;
      return;
    }
    this.endAnswer();
  }

  typed(text: string): void {
    if (this.stopped) return;
    // Typed text starts an answer of its own: a cancel's drop, active or pending, ends here, as at the next press,
    // and a `turnComplete` after it is no longer the rest of an `interrupted`.
    this.suppressing = false;
    this.suppressAfterAnswer = false;
    this.interruptedEnd = false;
    if (this.dialogue) this.owe();
    const ref = ++this.refs;
    const origin = this.origin();
    this.o.sink.segmentOpened({ ref, side: 'source', ...(origin ? { origin } : {}) });
    this.o.sink.segmentText({ ref, text });
    this.o.sink.segmentClosed({ ref, ...(origin ? { origin } : {}) });
  }

  beginTurn(): void {
    // A new press: whatever a cancel dropped, or was waiting to drop, ends here.
    this.suppressing = false;
    this.suppressAfterAnswer = false;
  }

  /**
   * A press with voice was released (`activityEnd`, not a cancel): its answer is owed from here — from the end of an
   * answer still streaming, if one is — before its first output streams, so a voiceless press made in that gap drops
   * only its own answer (choice 16).
   */
  endTurn(): void {
    if (this.stopped || !this.dialogue) return;
    this.owe();
  }

  /** A voiced release or typed text: its answer is owed now, or from the streaming answer's end while one streams. */
  private owe(): void {
    if (this.answering) this.owedNext = true;
    else this.owed = true;
  }

  /** A press released without voice (ruling 8, choice 16): drop that press's own answer, never the one before it. */
  cancelTurn(): void {
    // Live Translate: its output belongs to no press, so the cancel is `activityEnd` alone.
    if (this.stopped || !this.dialogue) return;
    // An answer is owed from the release that asked for it, before its first output. Once streaming it keeps going
    // under `NO_INTERRUPTION` and ends at its `turnComplete`; on a model that barges in, this press's `activityStart`
    // ends it at the server's `interrupted`, and the `turnComplete` that trails it is that same end, not this press's
    // answer's (Gemini/AST2 follow-up, ruling 5). Either way it finishes in its own segments, and the drop — this
    // press's own answer, never the one before it (ruling 8) — starts at that one end, or, when a press released while
    // it streamed is still owed its answer, at the end of that answer (`endAnswer()`).
    if (this.answering || this.owed) {
      this.suppressAfterAnswer = true;
      return;
    }
    this.closeTurn();
    this.suppressing = true;
  }

  connectionLost(): void {
    if (this.stopped) return;
    this.suppressing = false;
    this.suppressAfterAnswer = false;
    // The trailing `turnComplete` was the old connection's to send: the next one ends an answer of its own.
    this.interruptedEnd = false;
    // Nothing the old connection owed is answered on the new one, a release made while its answer streamed included.
    this.owedNext = false;
    // A dialogue turn in flight cannot finish across a reconnect (choice 14); Live Translate's segments ride their timers.
    if (this.dialogue) this.closeTurn();
  }

  stop(): void {
    this.stopped = true;
    this.cancel('source');
    this.cancel('translation');
  }

  /**
   * The answer ended: the turn closes, and a cancel made while it streamed now drops the next answer — the cancelled
   * press's own — unless an answer is still owed: one released while the answer that ended streamed comes first, and
   * the drop starts at its end.
   */
  private endAnswer(): void {
    this.closeTurn();
    if (this.suppressAfterAnswer && !this.owed) {
      this.suppressAfterAnswer = false;
      this.suppressing = true;
    }
  }

  /** Both sides, as they stand, closed under the turn's origin; a dialogue model moves to its next turn. */
  private closeTurn(): void {
    const origin = this.origin();
    this.close('source', origin);
    this.close('translation', origin);
    this.fallbackText = '';
    this.answering = false;
    // The answer owed before this end has ended; one owed from this end on is now the next.
    this.owed = this.owedNext;
    this.owedNext = false;
    if (this.dialogue) this.turn += 1;
  }

  private ensure(side: SideName): OpenSide {
    const open = this.sides[side];
    if (open) return open;
    const ref = ++this.refs;
    const origin = this.origin();
    this.o.sink.segmentOpened({ ref, side, ...(origin ? { origin } : {}) });
    const fresh: OpenSide = { ref, text: '', spoken: 0 };
    this.sides[side] = fresh;
    return fresh;
  }

  private close(side: SideName, origin: string | undefined): void {
    this.cancel(side);
    this.deferral[side].reset();
    const open = this.sides[side];
    if (!open) return;
    this.sides[side] = null;
    this.o.sink.segmentClosed({ ref: open.ref, ...(origin ? { origin } : {}) });
  }

  /** Live Translate only: (re)starts a side's silence countdown (`GeminiClient.ts:790-835`). */
  private arm(side: SideName): void {
    const silence = this.o.silence;
    if (this.dialogue || !silence) return;
    this.cancel(side);
    this.timers[side] = this.o.clock.setTimeout(() => {
      this.timers[side] = null;
      const open = this.sides[side];
      if (this.stopped || !open) return;
      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (choice 7).
      const text = side === 'source' ? normalizeCjkSpaces(open.text) : open.text;
      if (silence.deferMidSentence && this.deferral[side].deferAtExpiry(text)) {
        this.arm(side);
        return;
      }
      this.close(side, undefined);
    }, side === 'source' ? silence.sourceMs : silence.translationMs);
  }

  private cancel(side: SideName): void {
    this.timers[side]?.();
    this.timers[side] = null;
  }
}
