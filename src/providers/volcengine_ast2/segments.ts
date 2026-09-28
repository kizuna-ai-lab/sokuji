/**
 * Doubao's subtitles as segments (survey §2.10): each side's
 * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
 * first has text, closed at `End`. A `Response` carries one piece of the
 * text and an `End` the whole of it (Gemini/AST2 follow-up, choice 1), so
 * the text shown is the pieces joined until the `End` replaces it. No
 * origin and no timing (choice 3): L2 pairs the two sides by proximity
 * (F16). Pure: the adapter hands it each subtitle and forwards what it
 * emits.
 *
 * It also says which translation a spoken sentence voices, and when that
 * sentence's clip may carry a range (Gemini/AST2 follow-up, ruling 1): a
 * TTS sentence carries the server times of the translation subtitle it
 * speaks, so its clip gets that whole subtitle's range, stated once the
 * subtitle's text is final. The times are matched as the clip goes to L1,
 * after its decode, so a subtitle that started meanwhile is still named.
 */
import type { AdapterEvents, Ref, Side, TextRange } from '../../lib/contract/adapter';

export type SubtitlePhase = 'start' | 'response' | 'end';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'speechRanges'>;

/** A frame's server times, in ms; 0 when the frame carries none (a `Response`'s). */
export interface ServerTimes {
  startTime: number;
  endTime: number;
}

/** A spoken sentence as it started (Gemini/AST2 follow-up, choice 2): the lock's translation, read then, and the server times it carries, matched when its clip is emitted. */
export interface Sentence {
  lock: Ref | undefined;
  times: ServerTimes;
}

/** Where a sentence's clip goes (Gemini/AST2 follow-up, choices 2, 4): the translation its times name, else the lock's; whether the times named it; its range, when it may carry one now. */
export interface Clip {
  ref: Ref;
  matched: boolean;
  range?: TextRange;
}

/**
 * How many recent translation subtitles a spoken sentence's times are
 * matched against. A clip follows its subtitle within about a second (the
 * owner's probe): eight subtitles back is far past any such lag, and the
 * list stays small (Gemini/AST2 follow-up, choice 3).
 */
export const MATCH_WINDOW = 8;

interface SideState {
  /** Allocated at `Start` (or the first text), released at `End`. */
  ref: Ref | null;
  opened: boolean;
  /** What was last sent for `ref`. */
  text: string;
  /** Every `Response` piece since the side's last `Start` or `End`, joined as it came. */
  pieces: string;
}

/** A recent translation subtitle, for the spoken sentences that may voice it (Gemini/AST2 follow-up, choices 3, 4). */
interface Voiced {
  times: ServerTimes;
  /** A clip carried these times: the first one takes the range, any later one plays rangeless. */
  claimed: boolean;
  /** The length of the text it closed with; null while open. */
  length: number | null;
  /** Audio entries emitted for this ref so far: `speechRanges` names an entry by its place among them. */
  clips: number;
  /** The matched clip's entry, emitted before the text was final: ranged when the subtitle closes. */
  waiting: number[];
}

const NO_TIMES: ServerTimes = { startTime: 0, endTime: 0 };

const idle = (): SideState => ({ ref: null, opened: false, text: '', pieces: '' });

export class Ast2Segments {
  private next: Ref = 1;
  private readonly sides: Record<Side, SideState> = { source: idle(), translation: idle() };
  private lastTranslation: Ref | undefined;
  /** The last `MATCH_WINDOW` translation subtitles, oldest first. */
  private readonly voiced = new Map<Ref, Voiced>();

  constructor(private readonly sink: SegmentSink) {}

  /**
   * One subtitle message; answers the ref the message belongs to — null
   * when it has none — for the adapter's frame.
   * - `start`: the previous segment of the side closes as it stands (its
   *   `End` never came) or, never shown, is dropped; a ref is allocated,
   *   and nothing is emitted until text arrives.
   * - `response`: one piece, added to the pieces before it; their join is
   *   the text shown (Gemini/AST2 follow-up, choice 1). Pieces with no
   *   `Start` allocate once, not once per frame (survey §1.18.3); while the
   *   join is empty or blank, nothing is shown.
   * - `end`: the whole text, then the close. An empty or blank `End` of a
   *   segment never shown is the server VAD's false start: nothing; of one
   *   shown, it closes with the text it had (survey §1.18.4).
   * A translation keeps the server times of whichever of its frames
   * carries them (the probe: its `Start` and its `End`).
   */
  subtitle(side: Side, phase: SubtitlePhase, text: string, times: ServerTimes = NO_TIMES): Ref | null {
    const state = this.sides[side];
    if (phase === 'start') {
      this.finish(side);
      state.ref = this.next++;
      this.time(side, state.ref, times);
      return state.ref;
    }
    if (phase === 'response') state.pieces += text;
    const whole = phase === 'end' ? text : state.pieces;
    // Blank counts as empty, as the old client's false-start test did
    // (`!text.trim()`, `VolcengineAST2Client.ts:738-743, 814-819`); the text
    // shown is still the one sent, untrimmed.
    if (whole.trim()) this.show(side, whole);
    const ref = state.ref;
    if (ref !== null) this.time(side, ref, times);
    if (phase === 'end') this.finish(side);
    return ref;
  }

  /**
   * The translation a spoken sentence belongs to (ruling 10): the one
   * started now — shown or not, as the old client locked it to the item it
   * minted at `Start` (`VolcengineAST2Client.ts:646-652, 810-812`) — else the
   * last one shown; none before any. A ref not yet opened is fine: L1 holds
   * its audio until the segment opens (`Conversation.ts`, `pending`). Now
   * `clipFor`'s fallback (Gemini/AST2 follow-up, choice 2).
   */
  speechRef(): Ref | undefined {
    return this.sides.translation.ref ?? this.lastTranslation;
  }

  /** `TTSSentenceStart` (Gemini/AST2 follow-up, choice 2): the lock is read now, as it always was; the times wait for the clip. */
  sentence(times: ServerTimes): Sentence {
    return { lock: this.speechRef(), times };
  }

  /**
   * A sentence's clip goes to L1 now, after its decode (Gemini/AST2
   * follow-up, ruling 1; choices 2–4): to the recent translation subtitle
   * whose server times the sentence carries — `matched` for the first clip
   * to carry them — else to the lock's, unmatched; nowhere before any. Its
   * range, the whole text its subtitle closed with, only when matched and
   * the subtitle has closed; a matched clip whose subtitle is still open is
   * ranged by `speechRanges` when it closes. Every clip on a recent ref is
   * counted here, ranged or not, so an entry is named by its place among
   * that ref's audio.
   */
  clipFor(sentence: Sentence): Clip | undefined {
    const named = this.named(sentence.times);
    const ref = named?.ref ?? sentence.lock;
    if (ref === undefined) return undefined;
    const matched = named !== undefined && !named.voiced.claimed;
    if (matched) named.voiced.claimed = true;
    const v = this.voiced.get(ref);
    if (!v) return { ref, matched };
    const index = v.clips++;
    if (!matched) return { ref, matched };
    if (v.length === null) {
      v.waiting.push(index);
      return { ref, matched };
    }
    return v.length > 0 ? { ref, matched, range: [0, v.length] } : { ref, matched };
  }

  /** The recent translation subtitle these server times are, by equal start and end; none for a frame that carries none. */
  private named(times: ServerTimes): { ref: Ref; voiced: Voiced } | undefined {
    if (times.endTime <= 0) return undefined;
    for (const [ref, voiced] of this.voiced) {
      if (voiced.times.startTime === times.startTime && voiced.times.endTime === times.endTime) return { ref, voiced };
    }
    return undefined;
  }

  /** A translation's times, from whichever of its frames carries them; a new translation ref joins the recent list, the oldest leaving past `MATCH_WINDOW`. */
  private time(side: Side, ref: Ref, times: ServerTimes): void {
    if (side !== 'translation') return;
    let v = this.voiced.get(ref);
    if (!v) {
      v = { times: NO_TIMES, claimed: false, length: null, clips: 0, waiting: [] };
      this.voiced.set(ref, v);
      while (this.voiced.size > MATCH_WINDOW) this.voiced.delete(this.voiced.keys().next().value as Ref);
    }
    if (times.endTime > 0) v.times = { startTime: times.startTime, endTime: times.endTime };
  }

  private show(side: Side, text: string): void {
    const state = this.sides[side];
    if (state.ref === null) {
      state.ref = this.next++;
      this.time(side, state.ref, NO_TIMES);
    }
    if (!state.opened) {
      this.sink.segmentOpened({ ref: state.ref, side });
      state.opened = true;
      if (side === 'translation') this.lastTranslation = state.ref;
    }
    if (text !== state.text) {
      this.sink.segmentText({ ref: state.ref, text });
      state.text = text;
    }
  }

  private finish(side: Side): void {
    const state = this.sides[side];
    if (state.ref !== null && state.opened) this.sink.segmentClosed({ ref: state.ref });
    if (side === 'translation' && state.ref !== null) this.settle(state.ref, state.opened ? state.text : null);
    // In place: `subtitle` still holds this state object.
    Object.assign(state, idle());
  }

  /**
   * A translation closed with `text` (Gemini/AST2 follow-up, choice 4): its
   * length is final, and a matched clip already emitted gets its range now,
   * after the close. One never shown leaves the list: no sentence voices a
   * row that never opened.
   */
  private settle(ref: Ref, text: string | null): void {
    const v = this.voiced.get(ref);
    if (!v) return;
    if (text === null) {
      this.voiced.delete(ref);
      return;
    }
    v.length = text.length;
    const waiting = v.waiting;
    v.waiting = [];
    if (waiting.length > 0 && text.length > 0) {
      const range: TextRange = [0, text.length];
      this.sink.speechRanges({ ref, ranges: waiting.map((index) => ({ index, range })) });
    }
  }
}
