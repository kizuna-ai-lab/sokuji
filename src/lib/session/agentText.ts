/**
 * Soniox agent text (spec 2026-11-05 §4.1, §4.2): the text of each speech
 * chunk queued on one of the user's outlets goes to the STT socket that hears
 * the microphone, so the app's own read-aloud translation is kept out of
 * recognition. No I/O: the run feeds it the rows' text, each `audio` event with
 * the outlets playback put it on, the filled-in ranges, a voice's queue going
 * idle and a leg's reconnect; it calls the target session's `agentText`.
 * "Played" is approximated by "the voice went idle": a chunk that already
 * played while later chunks of its voice are queued is still live for a fill-in.
 */
import type { OutletName } from '../audio/outlets';
import type { AdapterSession, Ref, TextRange } from '../contract/adapter';
import type { LegName } from '../conversation/types';

/** §4.1: the leg whose session hears the microphone (the speaker's; in shared Both and face-to-face the one socket's own) when a clip plays on one of the user's outlets; null otherwise. A voice matters only through its outlets: split Both's participant voice crosses to the speaker core. */
export function agentTextTarget(legs: readonly LegName[], outlets: readonly OutletName[]): LegName | null {
  // Only the speaker leg takes the microphone; shared Both's and face-to-face's speaker session is the one socket's view.
  return outlets.length > 0 && legs.includes('speaker') ? 'speaker' : null;
}

export interface AgentTextFeedOptions {
  legs: readonly LegName[];
  /** The microphone's audio reaches its socket now: not muted, and automatic turns or a manual turn's key held (§4.2). */
  micOpen(): boolean;
  /** The session a leg's text goes to. Its `agentText` answering false is a refusal (a socket not opened for it, or down), silent. */
  session(leg: LegName): Pick<AdapterSession, 'agentText'> | undefined;
  /** A session's `agentText` threw: called once per feed (a run), the first time. The throw counts as a refusal. */
  report?(error: unknown): void;
}

/** A chunk queued on one of the user's outlets: whose voice reads it, and the leg whose socket its text goes to. */
interface LiveChunk {
  voice: LegName;
  target: LegName;
}

const rowKey = (leg: LegName, ref: Ref): string => `${leg}:${ref}`;

export class AgentTextFeed {
  /** Per row (`leg:ref`): its text as the adapter last sent it. Kept for the run, as L1's rows are. */
  private readonly texts = new Map<string, string>();
  /** Per row: the index its next `audio` event takes (the adapter's numbering, the one `speechRanges` names). */
  private readonly counts = new Map<string, number>();
  /** Per voice and row (`voice:leg:ref`): how far into the row's text is placed, sent or not. Never lowered: skipped and dropped text never goes later. */
  private readonly sentTo = new Map<string, number>();
  /** Per chunk (`leg:ref:index`) still queued on one of the user's outlets whose every placement went through: queued with the gate open, never gated or refused since. Only these take a fill-in, so text never starts partway through a chunk. */
  private readonly live = new Map<string, LiveChunk>();
  /** Per voice whose segment is open: the leg whose socket holds it. */
  private readonly open = new Map<LegName, LegName>();
  /** A throw from a session has been reported. */
  private reported = false;

  constructor(private readonly o: AgentTextFeedOptions) {}

  /** `segmentText`: a row's text as its adapter last sent it, which its ranges index. */
  rowText(leg: LegName, ref: Ref, text: string): void {
    this.texts.set(rowKey(leg, ref), text);
  }

  /** One `audio` event of `leg`'s row, with the outlets playback returned for it. */
  audio(leg: LegName, e: { ref?: Ref; range?: TextRange; voice?: LegName }, outlets: readonly OutletName[]): void {
    if (e.ref === undefined) return;
    const row = rowKey(leg, e.ref);
    const index = this.counts.get(row) ?? 0;
    this.counts.set(row, index + 1);
    const target = agentTextTarget(this.o.legs, outlets);
    if (target === null) return;
    const chunk: LiveChunk = { voice: e.voice ?? leg, target };
    const key = `${row}:${index}`;
    // Queued with the microphone gated (muted, or the key up): its text is placed unsent below, and its fill-in sends nothing either.
    if (this.o.micOpen()) this.live.set(key, chunk);
    if (e.range) this.place(leg, e.ref, key, chunk, e.range);
  }

  /** `speechRanges`: the filled-in ranges of `leg`'s row. Only chunks still queued place text: what has played is not sent. */
  ranges(leg: LegName, e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void {
    const row = rowKey(leg, e.ref);
    for (const { index, range } of e.ranges) {
      const key = `${row}:${index}`;
      const chunk = this.live.get(key);
      if (chunk) this.place(leg, e.ref, key, chunk, range);
    }
  }

  /** Playback's `onVoiceIdle`: the voice's open segment ends, whatever the microphone gate says; its queued chunks are gone. */
  voiceIdle(voice: LegName): void {
    const holder = this.open.get(voice);
    if (holder !== undefined) {
      this.open.delete(voice);
      this.send(holder, '', true);
    }
    for (const [key, chunk] of this.live) if (chunk.voice === voice) this.live.delete(key);
  }

  /** A leg said `reconnecting`: its segments end without a frame (the next socket never saw them), and nothing is replayed there. */
  reconnecting(leg: LegName): void {
    for (const [voice, holder] of this.open) if (holder === leg) this.open.delete(voice);
    for (const [key, chunk] of this.live) if (chunk.target === leg) this.live.delete(key);
  }

  /**
   * Rule 3: the part of `[a, b]` not yet placed for this voice and row is placed, and sent while the microphone
   * reaches its socket. A placement gated or refused ends the chunk's live state; one with nothing to place leaves
   * it as it is.
   */
  private place(leg: LegName, ref: Ref, key: string, { voice, target }: LiveChunk, [a, b]: TextRange): void {
    const text = this.texts.get(rowKey(leg, ref)) ?? '';
    const mark = `${voice}:${leg}:${ref}`;
    const from = Math.max(a, this.sentTo.get(mark) ?? 0);
    const to = Math.min(b, text.length);
    if (to <= from) return;
    this.sentTo.set(mark, to);
    const sent = this.o.micOpen() && this.send(target, text.slice(from, to), false);
    if (sent) this.open.set(voice, target);
    else this.live.delete(key);
  }

  /**
   * The target session's `agentText`, contained: a throw counts as a refusal and is reported once, so it never
   * reaches the caller — a zustand listener (Translation I hear) or the emitting adapter's socket handler.
   */
  private send(leg: LegName, text: string, endOfSegment: boolean): boolean {
    try {
      return this.o.session(leg)?.agentText?.(text, endOfSegment) === true;
    } catch (error) {
      if (!this.reported) {
        this.reported = true;
        this.o.report?.(error);
      }
      return false;
    }
  }
}
