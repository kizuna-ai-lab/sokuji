/**
 * Soniox agent text (spec 2026-11-05 §4.1, §4.2): the text of each speech
 * chunk queued on one of the user's outlets goes to the STT socket that hears
 * the microphone, so the app's own read-aloud translation is kept out of
 * recognition. Pure: the run feeds it the rows' text, each `audio` event with
 * the outlets playback put it on, the filled-in ranges, a voice's queue going
 * idle and a leg's reconnect; it calls the target session's `agentText`.
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
  /** The switch, read at each chunk (§4.4). */
  enabled(): boolean;
  /** The microphone's audio reaches its socket now: automatic turns, or a manual turn's key held (§4.2). */
  micOpen(): boolean;
  session(leg: LegName): Pick<AdapterSession, 'agentText'> | undefined;
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
  /** Per chunk (`leg:ref:index`) still queued on one of the user's outlets. */
  private readonly live = new Map<string, LiveChunk>();
  /** Per voice whose segment is open: the leg whose socket holds it. */
  private readonly open = new Map<LegName, LegName>();

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
    this.live.set(`${row}:${index}`, chunk);
    if (e.range) this.place(leg, e.ref, chunk, e.range);
  }

  /** `speechRanges`: the filled-in ranges of `leg`'s row. Only chunks still queued place text: what has played is not sent. */
  ranges(leg: LegName, e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void {
    const row = rowKey(leg, e.ref);
    for (const { index, range } of e.ranges) {
      const chunk = this.live.get(`${row}:${index}`);
      if (chunk) this.place(leg, e.ref, chunk, range);
    }
  }

  /** Playback's `onVoiceIdle`: the voice's open segment ends, whatever the switch and the key say; its queued chunks are gone. */
  voiceIdle(voice: LegName): void {
    const holder = this.open.get(voice);
    if (holder !== undefined) {
      this.open.delete(voice);
      this.o.session(holder)?.agentText?.('', true);
    }
    for (const [key, chunk] of this.live) if (chunk.voice === voice) this.live.delete(key);
  }

  /** A leg said `reconnecting`: its segments end without a frame (the next socket never saw them), and nothing is replayed there. */
  reconnecting(leg: LegName): void {
    for (const [voice, holder] of this.open) if (holder === leg) this.open.delete(voice);
    for (const [key, chunk] of this.live) if (chunk.target === leg) this.live.delete(key);
  }

  /** Rule 3: the part of `[a, b]` not yet placed for this voice and row is placed, and sent while the switch is on and the microphone reaches its socket. */
  private place(leg: LegName, ref: Ref, { voice, target }: LiveChunk, [a, b]: TextRange): void {
    const text = this.texts.get(rowKey(leg, ref)) ?? '';
    const mark = `${voice}:${leg}:${ref}`;
    const from = Math.max(a, this.sentTo.get(mark) ?? 0);
    const to = Math.min(b, text.length);
    if (to <= from) return;
    this.sentTo.set(mark, to);
    if (!this.o.enabled() || !this.o.micOpen()) return;
    if (this.o.session(target)?.agentText?.(text.slice(from, to), false) === true) this.open.set(voice, target);
  }
}
