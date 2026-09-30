/**
 * A continuous interpreter's two sides as segments — OpenAI Translate's and
 * Gemini Live Translate's, whose streams have no turns, so the adapter cuts
 * both (Stage 2 translation cuts, rulings 1, 3). The source is cut by its own
 * silence timer, as before: in sentence mode deferred mid-sentence while its
 * text grows (`SilenceDeferral`). The translation is cut where the source
 * was: each source segment that closes owes the translation one cut, and the
 * translation segment states the source it is cut for as its origin (ruling
 * 2) — the adapter's own rule, as OpenAI Realtime's "newest unanswered" is,
 * so L2 infers nothing for either side.
 *
 * - A closing source owes `{ origin, n, lastAt }`: `n` its sentence ends, at
 *   least one; `lastAt` when its last delta arrived, on the request's clock.
 * - The cut: once the open translation holds `n` sentence ends, the latest
 *   arriving strictly after `lastAt`, the next translation delta closes it
 *   and opens the next with itself (choice 4). Audio that arrives before that
 *   delta stays with the segment that closes.
 * - The translation's own quiet settles it: at a sentence end it closes for
 *   the cut owed first and drops any other still owed; mid-sentence it waits
 *   once more, to `MID_SENTENCE_HOLD_MS` after its last activity — once its
 *   stream has shown a sentence end at all, and never for a target whose
 *   script writes none (choices 6, 8). With nothing owed
 *   it waits for a source still open (choice 7), else closes as the rest of
 *   the source that closed last (choice 9).
 * - A source that closes while no translation is open gives the translation
 *   its pause to begin; if none begins, every owed cut is dropped, and one that
 *   begins while a newer source is already open follows that source (choice
 *   8).
 * - An adapter with source rules of its own — OpenAI Live's timeline pause,
 *   sentence count and caps — cuts the source itself (`cutSource`), and ends
 *   the open translation's text with a delta's leading marks before a due cut
 *   (`translationContinues`); a lost connection closes both sides as they
 *   stand (`closeAll`). The cuts owed, and the translation that follows
 *   them, are the same (Stage 2 OpenAI Live, choice 5).
 *
 * Pure: every timer on the clock it is handed, every time from its `now()`.
 */
import type { AdapterEvents, Ref } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import { SENTENCE_CLOSERS } from './sentenceEnd';
import { SilenceDeferral } from './silenceDeferral';

/** A translation that stops mid-sentence closes this long after its last activity, not at its pause (translation cuts, ruling 1; choice 6). */
export const MID_SENTENCE_HOLD_MS = 5_000;

/**
 * Marks that end a sentence wherever they stand: CJK `。？！` (ruling 1 (iii)),
 * and those of the scripts the ruling does not name — Devanagari and Bengali
 * `।॥`, Urdu `۔`, Arabic `؟`, Burmese `။`, Armenian `։`, Ethiopic `።`, Khmer
 * `។៕`, the fullwidth `．` and the halfwidth `｡` (translation cuts, choice 3).
 */
const ANYWHERE_ENDS = '。？！।॥۔؟။։።។៕．｡';
/** Marks that end a sentence only before whitespace or at the end: not "1.5", not "U.S" (ruling 1 (iii)). */
const LATIN_ENDS = '.?!';
const SPACE = /\s/;

/**
 * The one sentence-end rule (ruling 1 (iii); choice 3): whether `mark`, with
 * `next` the character after it, ends a sentence — `true`, `false`, or
 * `undefined` for a Latin mark with nothing after it yet, which what follows
 * settles, and which ends the text if nothing does.
 */
export function endsSentence(mark: string, next: string | undefined): boolean | undefined {
  if (ANYWHERE_ENDS.includes(mark)) return true;
  if (!LATIN_ENDS.includes(mark)) return false;
  return next === undefined ? undefined : SPACE.test(next);
}

/** The sentence ends a text holds: a Latin mark at its end counts (choice 3). */
export function countSentenceEnds(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (endsSentence(text[i], text[i + 1]) !== false) n += 1;
  return n;
}

/** The text ends at a sentence end, trailing whitespace and closing quotes and brackets aside (choice 6). */
export function atSentenceEnd(text: string): boolean {
  let i = text.trimEnd().length - 1;
  while (i >= 0 && SENTENCE_CLOSERS.includes(text[i])) i--;
  return i >= 0 && endsSentence(text[i], undefined) !== false;
}

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;

/**
 * Why a translation closed (choice 14): `sentences`, the cut owed first was
 * due; `quiet`, its own pause; `done`, the endpoint's `.done`; `turn`, a turn
 * end on a stream with none; `lost`, the connection (Stage 2 OpenAI Live,
 * choice 5). `idle`: owed cuts dropped with no translation to close — none
 * began within its pause, or one began for a newer source.
 */
export type CutReason = 'sentences' | 'quiet' | 'done' | 'turn' | 'lost' | 'idle';

/** One cut, for the Logs (`translation.cut`; choice 14): never text. */
export interface CutSummary {
  reason: CutReason;
  /** The source the translation closed for; null for `idle`, or a translation that followed none. */
  origin: string | null;
  /** The translation's sentence ends; 0 for `idle`. */
  sentences: number;
  /** Cuts still owed after this one. */
  owed: number;
  /** Owed cuts dropped here, unanswered (choice 8). */
  dropped: number;
}

export interface ContinuousSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Each side's pause, and the source's mid-sentence deferral in sentence mode. */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  sink: SegmentSink;
  /** The source's text as shown, and as its pauses and sentences are read: Gemini 3.x's CJK spaces removed. The identity when absent. */
  showSource?: (text: string) => string;
  /**
   * A translation that stops mid-sentence is held (choice 6) — `false` for a
   * target whose script writes no sentence-final mark (Thai, Lao), where a
   * stray Latin mark would otherwise turn the hold on for good. True when absent.
   */
  holdMidSentence?: boolean;
  /** Each cut, for the Logs (choice 14). */
  cut?: (summary: CutSummary) => void;
  /** How many sentences a closing source owes its translation, as the adapter cut it; the module's own count otherwise (Stage 2 OpenAI Live, choice 7). */
  countSource?: (text: string) => number;
}

interface OpenSource {
  ref: Ref;
  /** Stated when it opens: `s<ref>` (choice 2). */
  origin: string;
  text: string;
  lastAt: number;
}

interface OpenTranslation {
  ref: Ref;
  /** Stated when it opened, when known then; else stated when it closes (choice 5). */
  origin: string | undefined;
  text: string;
  /** Where the last played frame's range ended: ranges by arrival. */
  spoken: number;
  /** Its sentence ends so far, and when the latest arrived (choice 3). */
  ends: number;
  lastEndAt: number;
  /** A Latin mark that ends the text so far, and when it arrived: what follows settles it (choice 3). */
  trailing: { mark: string; at: number } | null;
}

/** A closed source's claim on the translation (ruling 2). */
interface Owed {
  origin: string;
  n: number;
  lastAt: number;
}

export class ContinuousSegments {
  private refs = 0;
  private source: OpenSource | null = null;
  private translation: OpenTranslation | null = null;
  /** One per closed source, oldest first. */
  private readonly owed: Owed[] = [];
  /** The spoken source that closed last: a translation that follows no cut is its rest; typed text clears it (choice 9). */
  private lastClosed: string | undefined;
  private sourceTimer: (() => void) | null = null;
  /** The translation's pause, its mid-sentence hold, or — none open — its pause to begin after a source closed. */
  private translationTimer: (() => void) | null = null;
  private readonly deferral = new SilenceDeferral();
  /** The pause to begin runs: a source closed with no translation open, and none has begun (choice 8). */
  private beginning = false;
  /** The translation's stream has shown a sentence-end mark, one a Latin mark closing a delta may be: only then is a quiet mid-sentence held (choice 6). */
  private shownEnd = false;
  /** The mid-sentence hold is spent, until the translation's next activity (choice 6). */
  private held = false;
  /** Quiet with nothing owed while a source is open: it closes for that source's cut (choice 7). */
  private waiting = false;
  private stopped = false;

  constructor(private readonly o: ContinuousSegmentsOptions) {}

  /** A translation segment is open. */
  get translating(): boolean {
    return this.translation !== null;
  }

  /** A source transcript delta. */
  sourceText(delta: string): void {
    if (this.stopped || !delta) return;
    let s = this.source;
    if (!s) {
      const ref = ++this.refs;
      s = { ref, origin: `s${ref}`, text: '', lastAt: 0 };
      this.source = s;
      this.o.sink.segmentOpened({ ref, side: 'source', origin: s.origin });
    }
    s.text += delta;
    s.lastAt = this.o.clock.now();
    this.o.sink.segmentText({ ref: s.ref, text: this.show(s.text) });
    this.armSource();
  }

  /** A translation transcript delta: a cut that is due is taken first, and this delta opens the next segment (choice 4). */
  translationText(delta: string): void {
    if (this.stopped || !delta) return;
    const open = this.translation;
    if (open && this.cutDue(open, delta)) this.closeTranslation('sentences');
    const tr = this.translation ?? this.openTranslation();
    this.readEnds(tr, delta);
    tr.text += delta;
    this.o.sink.segmentText({ ref: tr.ref, text: tr.text });
    this.active();
  }

  /**
   * Text that continues the open translation whatever cut is due: OpenAI
   * Live's leading marks, which end the text before them (Stage 2 OpenAI
   * Live, choice 8). Counted, shown and its activity as a delta is; with no
   * translation open, nothing.
   */
  translationContinues(text: string): void {
    const tr = this.translation;
    if (this.stopped || !text || !tr) return;
    this.readEnds(tr, text);
    tr.text += text;
    this.o.sink.segmentText({ ref: tr.ref, text: tr.text });
    this.active();
  }

  /**
   * The translation's audio. `active`: it opens a translation when none is
   * open and is the translation's activity, as a delta is (OpenAI Translate's
   * frames above its noise floor); otherwise it does neither (Gemini's, and
   * OpenAI Translate's quiet frames). Played only when `play`: inside the open
   * translation with the stretch of its text that had arrived with it — a
   * range by arrival — and outside one with no ref.
   */
  audio(pcm: Int16Array, o: { play: boolean; active: boolean }): void {
    if (this.stopped || pcm.length === 0) return;
    if (o.active) {
      if (!this.translation) this.openTranslation();
      this.active();
    }
    if (!o.play) return;
    const tr = this.translation;
    if (!tr) {
      this.o.sink.audio({ pcm });
      return;
    }
    const end = tr.text.length;
    this.o.sink.audio({ pcm, ref: tr.ref, range: [tr.spoken, end] });
    tr.spoken = end;
  }

  /**
   * Typed text: a source row of its own, opened, written and closed at once;
   * it states no origin and owes no cut, and an answer to it, if any, follows
   * no spoken source, so L2 can pair the two (choices 9, 12).
   */
  typed(text: string): void {
    if (this.stopped) return;
    const ref = ++this.refs;
    this.lastClosed = undefined;
    this.o.sink.segmentOpened({ ref, side: 'source' });
    this.o.sink.segmentText({ ref, text });
    this.o.sink.segmentClosed({ ref });
  }

  /** A side's `.done`, should the endpoint send one: the source closes now; the translation settles as its quiet would (choice 13). */
  done(side: 'source' | 'translation'): void {
    if (this.stopped) return;
    if (side === 'source') this.closeSource();
    else if (this.translation) this.settle('done');
  }

  /** A turn's end on a stream with no turns: the source closes, then the translation settles (choice 12). */
  endTurn(): void {
    if (this.stopped) return;
    this.closeSource();
    if (this.translation) this.settle('turn');
  }

  /** The adapter's own source cut (Stage 2 OpenAI Live, choice 5): the open source closes now, owing its cut, as its pause would close it. */
  cutSource(): void {
    if (this.stopped) return;
    this.closeSource();
  }

  /**
   * The connection is gone (Stage 2 OpenAI Live, choice 5): the source and
   * the translation close as they stand, every cut still owed is dropped,
   * and no timer is left. The refs keep counting — a ref is never reused in
   * one session — and the next translation follows no source of the old
   * connection.
   */
  closeAll(): void {
    if (this.stopped) return;
    this.closeSource();
    if (this.translation) this.closeTranslation('lost');
    else this.dropOwed();
    this.cancelSource();
    this.cancelTranslation();
    this.deferral.reset();
    this.beginning = false;
    this.held = false;
    this.waiting = false;
    this.lastClosed = undefined;
  }

  /** No timer is left, and nothing is said after it: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
    this.cancelSource();
    this.cancelTranslation();
  }

  private show(text: string): string {
    return this.o.showSource ? this.o.showSource(text) : text;
  }

  private armSource(): void {
    this.cancelSource();
    this.sourceTimer = this.o.clock.setTimeout(() => {
      this.sourceTimer = null;
      const s = this.source;
      if (this.stopped || !s) return;
      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (Gemini choice 7).
      if (this.o.silence.deferMidSentence && this.deferral.deferAtExpiry(this.show(s.text))) {
        this.armSource();
        return;
      }
      this.closeSource();
    }, this.o.silence.sourceMs);
  }

  private closeSource(): void {
    this.cancelSource();
    this.deferral.reset();
    const s = this.source;
    if (!s) return;
    this.source = null;
    this.lastClosed = s.origin;
    this.o.sink.segmentClosed({ ref: s.ref });
    this.owed.push({ origin: s.origin, n: Math.max(1, (this.o.countSource ?? countSentenceEnds)(this.show(s.text))), lastAt: s.lastAt });
    // No translation open: it has its pause to begin (choice 8). One waiting for this source: its pause starts now (choice 7).
    if (!this.translation) {
      this.beginning = true;
      this.armQuiet(this.o.silence.translationMs);
    } else if (this.waiting) {
      this.waiting = false;
      this.armQuiet(this.o.silence.translationMs);
    }
  }

  private openTranslation(): OpenTranslation {
    // Beginning within its pause, but with a newer source already open: it follows that source, and what the older ones were owed will not be answered (choice 8).
    if (this.beginning && this.source && this.owed.length > 0) this.dropOwed();
    this.beginning = false;
    const ref = ++this.refs;
    // Known now (choice 5): the cut owed first, else the source still open, whose cut is owed next.
    const origin = this.owed[0]?.origin ?? this.source?.origin;
    this.o.sink.segmentOpened(origin !== undefined ? { ref, side: 'translation', origin } : { ref, side: 'translation' });
    const tr: OpenTranslation = { ref, origin, text: '', spoken: 0, ends: 0, lastEndAt: -Infinity, trailing: null };
    this.translation = tr;
    return tr;
  }

  /** The cut owed first is due before `next`: the translation holds its sentence ends, the latest after the source's last delta (ruling 1; choice 4). */
  private cutDue(tr: OpenTranslation, next: string): boolean {
    const head = this.owed[0];
    if (!head) return false;
    let ends = tr.ends;
    let lastEndAt = tr.lastEndAt;
    if (tr.trailing && endsSentence(tr.trailing.mark, next[0])) {
      ends += 1;
      lastEndAt = tr.trailing.at;
    }
    return ends >= head.n && lastEndAt > head.lastAt;
  }

  /** Counts the sentence ends `delta` brings, each at its own delta's arrival; a Latin one ending the text waits for what follows (choice 3). */
  private readEnds(tr: OpenTranslation, delta: string): void {
    const at = this.o.clock.now();
    if (tr.trailing) {
      if (endsSentence(tr.trailing.mark, delta[0])) this.countEnd(tr, tr.trailing.at);
      tr.trailing = null;
    }
    for (let i = 0; i < delta.length; i++) {
      const ends = endsSentence(delta[i], delta[i + 1]);
      if (ends === undefined) {
        tr.trailing = { mark: delta[i], at };
        this.shownEnd = true;
      } else if (ends) this.countEnd(tr, at);
    }
  }

  private countEnd(tr: OpenTranslation, at: number): void {
    tr.ends += 1;
    tr.lastEndAt = at;
    this.shownEnd = true;
  }

  /** A delta, or audio that counts: the translation's pause starts again, its hold and its wait end (choice 6). */
  private active(): void {
    this.held = false;
    this.waiting = false;
    this.armQuiet(this.o.silence.translationMs);
  }

  private armQuiet(ms: number): void {
    this.cancelTranslation();
    this.translationTimer = this.o.clock.setTimeout(() => this.quiet(), ms);
  }

  private quiet(): void {
    this.translationTimer = null;
    if (this.stopped) return;
    const tr = this.translation;
    if (!tr) {
      // No translation began within its pause after a source closed: what is owed will not be answered (choice 8).
      this.beginning = false;
      this.dropOwed();
      return;
    }
    // Mid-sentence, the interpreter is waiting for the source: once more, to the hold after its last activity, which was this pause ago (choice 6) —
    // unless its stream has shown no sentence end yet, or its target writes none (Thai, Lao): then a pause is all there is.
    if (!this.held && this.o.holdMidSentence !== false && this.shownEnd && !atSentenceEnd(tr.text)) {
      this.held = true;
      this.armQuiet(Math.max(0, MID_SENTENCE_HOLD_MS - this.o.silence.translationMs));
      return;
    }
    this.settle('quiet');
  }

  /** The translation has said what it will: it closes for the cut owed first, else waits for a source still open (choices 7, 8). */
  private settle(reason: 'quiet' | 'done' | 'turn'): void {
    if (this.owed.length === 0 && this.source) {
      this.cancelTranslation();
      this.waiting = true;
      // Already settled by a reason other than its own quiet: the quiet after the source's close settles it at once, at its pause, not the hold (choice 13).
      if (reason !== 'quiet') this.held = true;
      return;
    }
    this.closeTranslation(reason);
  }

  /** Every owed cut dropped with no translation to close (choice 8). */
  private dropOwed(): void {
    const dropped = this.owed.length;
    this.owed.length = 0;
    if (dropped > 0) this.o.cut?.({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped });
  }

  /**
   * Closes the open translation for the cut owed first: its origin is what it
   * stated when it opened, else that cut's, else the spoken source that
   * closed last (choices 5, 9). Any close but a cut at its sentences settles:
   * every other owed cut is dropped (choice 8).
   */
  private closeTranslation(reason: Exclude<CutReason, 'idle'>): void {
    const tr = this.translation;
    if (!tr) return;
    this.cancelTranslation();
    this.held = false;
    this.waiting = false;
    const head = this.owed.shift();
    const dropped = reason === 'sentences' ? 0 : this.owed.length;
    this.owed.length -= dropped;
    const origin = tr.origin ?? head?.origin ?? this.lastClosed;
    this.translation = null;
    this.o.sink.segmentClosed(tr.origin === undefined && origin !== undefined ? { ref: tr.ref, origin } : { ref: tr.ref });
    this.o.cut?.({ reason, origin: origin ?? null, sentences: tr.ends + (tr.trailing ? 1 : 0), owed: this.owed.length, dropped });
  }

  private cancelSource(): void {
    this.sourceTimer?.();
    this.sourceTimer = null;
  }

  private cancelTranslation(): void {
    this.translationTimer?.();
    this.translationTimer = null;
  }
}
