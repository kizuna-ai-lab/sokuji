/**
 * When the probe sends which agent text — the four conditions:
 *
 * - `none`: nothing (agent text off in the config too).
 * - `speak`: at `LegSpeech.speak()`, the text handed to synthesis; the
 *   segment ends at that voice's `endUtterance()`.
 * - `enqueue`: as each audio chunk is queued for playback, the text of its
 *   provisional range (the karaoke's), not yet sent; the segment ends when
 *   that voice's queue goes idle.
 * - `lead`: the same per-chunk text, sent at the chunk's play time minus
 *   `leadMs` on the session clock (at once when that is already past); the
 *   segment ends when the queue goes idle, as in `enqueue`.
 *
 * A provisional range can stop short of its phrase's end (the pace estimate
 * ran slow). When the phrase's real ranges are filled in (`speechRanges`),
 * what they cover beyond what was sent goes too, attributed to the chunk that
 * speaks it (`fillIn`): otherwise the last words of a sentence would never be
 * sent. Text is tracked per voice and row, so nothing is sent twice.
 *
 * Soniox's agent text has no voice: both voices' text lands in one stream.
 * The planner keeps each voice's own segment and counts the sends that
 * interleave with the other voice's open segment, and the segment ends that
 * close while the other voice's is open — what the experiment must observe,
 * not hide.
 */
import type { Clock } from '../../../src/lib/contract/clock';
import type { TextRange } from '../../../src/lib/contract/adapter';
import type { LegName } from '../../../src/lib/conversation/types';

export const CONDITIONS = ['none', 'speak', 'enqueue', 'lead'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface AgentSend {
  voice: LegName;
  text: string;
  end: boolean;
  /** The row the text is from, and where in its translation (absent on a segment end). */
  ref?: number;
  span?: TextRange;
  /** `lead` only: the chunk's play time (session ms) the send was timed against. */
  playAt?: number;
}

export interface PlannerOptions {
  condition: Condition;
  leadMs: number;
  /** Send `end_of_segment`; off: segments are never closed. */
  closeSegments: boolean;
  clock: Pick<Clock, 'now' | 'setTimeout'>;
  /** The session clock's origin: play times are ms since it. */
  t0: number;
  send(s: AgentSend): void;
}

export interface PlannerStats {
  texts: number;
  ends: number;
  /** Text sent by one voice while the other voice's segment was open. */
  interleaved: number;
  /** A segment end sent by one voice while the other voice's segment was open. */
  endsWhileOtherOpen: number;
  /** Sends from fill-ins (text the provisional ranges had not reached). */
  fillInTexts: number;
}

const other = (v: LegName): LegName => (v === 'speaker' ? 'participant' : 'speaker');

export class AgentTextPlanner {
  private readonly open: Record<LegName, boolean> = { speaker: false, participant: false };
  /** Per `voice:ref`, how far into the row's translation text has been sent. */
  private readonly sentUpTo = new Map<string, number>();
  /** `lead`: timed sends not yet made, per voice. */
  private readonly timed: Record<LegName, Map<symbol, { send: AgentSend; cancel: () => void }>> = { speaker: new Map(), participant: new Map() };
  readonly stats: PlannerStats = { texts: 0, ends: 0, interleaved: 0, endsWhileOtherOpen: 0, fillInTexts: 0 };
  private stopped = false;

  constructor(private readonly o: PlannerOptions) {}

  speak(voice: LegName, ref: number, text: string, span: TextRange): void {
    if (this.o.condition !== 'speak' || text === '') return;
    this.emit({ voice, ref, span, text, end: false });
  }

  endUtterance(voice: LegName): void {
    if (this.o.condition === 'speak') this.close(voice);
  }

  /** A chunk queued on `voice`, playing from `atMs` (session ms); `range` its provisional range in `rowText`, absent when it has none yet. */
  enqueue(voice: LegName, ref: number, rowText: string, range: TextRange | undefined, atMs: number): void {
    if (range) this.chunk(voice, ref, rowText, range, atMs, false);
  }

  /** A chunk's real range, filled in after its phrase's speech ended: what it covers beyond what was sent. */
  fillIn(voice: LegName, ref: number, rowText: string, range: TextRange, atMs: number): void {
    this.chunk(voice, ref, rowText, range, atMs, true);
  }

  /** `voice`'s queue has played out: its timed sends go now (there should be none), then its segment ends. */
  idle(voice: LegName): void {
    if (this.o.condition !== 'enqueue' && this.o.condition !== 'lead') return;
    for (const [id, t] of this.timed[voice]) {
      t.cancel();
      this.timed[voice].delete(id);
      this.emit(t.send);
    }
    this.close(voice);
  }

  /** Cancels what is still timed; nothing is sent after. */
  stop(): void {
    this.stopped = true;
    for (const voice of ['speaker', 'participant'] as const) {
      for (const t of this.timed[voice].values()) t.cancel();
      this.timed[voice].clear();
    }
  }

  private chunk(voice: LegName, ref: number, rowText: string, [a, b]: TextRange, atMs: number, fillIn: boolean): void {
    const c = this.o.condition;
    if (c !== 'enqueue' && c !== 'lead') return;
    const key = `${voice}:${ref}`;
    const from = Math.max(a, this.sentUpTo.get(key) ?? 0);
    const to = Math.min(b, rowText.length);
    if (to <= from) return;
    this.sentUpTo.set(key, to);
    const send: AgentSend = { voice, ref, span: [from, to], text: rowText.slice(from, to), end: false, ...(c === 'lead' ? { playAt: atMs } : {}) };
    if (fillIn) this.stats.fillInTexts++;
    const delay = c === 'lead' ? atMs - this.o.leadMs - (this.o.clock.now() - this.o.t0) : 0;
    if (delay <= 0) {
      this.emit(send);
      return;
    }
    const id = Symbol('send');
    const cancel = this.o.clock.setTimeout(() => {
      this.timed[voice].delete(id);
      this.emit(send);
    }, delay);
    this.timed[voice].set(id, { send, cancel });
  }

  private close(voice: LegName): void {
    if (!this.open[voice]) return;
    this.open[voice] = false;
    if (!this.o.closeSegments || this.stopped) return;
    if (this.open[other(voice)]) this.stats.endsWhileOtherOpen++;
    this.stats.ends++;
    this.o.send({ voice, text: '', end: true });
  }

  private emit(send: AgentSend): void {
    if (this.stopped) return;
    if (this.open[other(send.voice)]) this.stats.interleaved++;
    this.open[send.voice] = true;
    this.stats.texts++;
    this.o.send(send);
  }
}
