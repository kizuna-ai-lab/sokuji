/**
 * The app's playback, simulated: one `ClipQueue` per voice (the app's own
 * scheduling rules, `src/lib/audio/clipQueue.ts`) on the session's clock in
 * place of an AudioContext. Each clip gets its play time as the app would
 * give it; a clip's end is a timer on that clock, so a voice's queue goes
 * idle when its last clip has played out.
 */
import { SAMPLE_RATE } from '../../../src/lib/contract/adapter';
import type { Clock } from '../../../src/lib/contract/clock';
import type { LegName } from '../../../src/lib/conversation/types';
import { ClipQueue, type AudioTimeline } from '../../../src/lib/audio/clipQueue';

export interface PlayerOptions {
  clock: Pick<Clock, 'now' | 'setTimeout'>;
  /** The session clock's origin: play times are ms since it. */
  t0: number;
  /** A clip scheduled: its voice, pcm and play window (session ms). */
  onPlay?(voice: LegName, pcm: Int16Array, atMs: number, endMs: number): void;
  /** A voice's queue has played out (busy → idle). */
  onIdle?(voice: LegName, atMs: number): void;
}

export class SimPlayer {
  private readonly queues: Record<LegName, ClipQueue<string>>;
  private readonly cancels = new Set<() => void>();
  private last: { atMs: number; endMs: number } | null = null;

  constructor(o: PlayerOptions) {
    const now = () => (o.clock.now() - o.t0) / 1000;
    const timeline = (voice: LegName): AudioTimeline => ({
      now,
      play: (pcm, at, onEnded) => {
        const atMs = at * 1000;
        const endMs = (at + pcm.length / SAMPLE_RATE) * 1000;
        this.last = { atMs, endMs };
        o.onPlay?.(voice, pcm, atMs, endMs);
        const cancel = o.clock.setTimeout(() => { this.cancels.delete(cancel); onEnded(); }, Math.max(0, endMs - now() * 1000));
        this.cancels.add(cancel);
        return () => { cancel(); this.cancels.delete(cancel); };
      },
    });
    this.queues = { speaker: new ClipQueue(timeline('speaker')), participant: new ClipQueue(timeline('participant')) };
    for (const voice of ['speaker', 'participant'] as const) {
      let busy = false;
      this.queues[voice].subscribe(() => {
        const pending = this.queues[voice].pending > 0;
        if (busy && !pending) o.onIdle?.(voice, o.clock.now() - o.t0);
        busy = pending;
      });
    }
  }

  /** Queues a clip on its voice; its play window (session ms), or null when it was not scheduled (empty pcm). */
  enqueue(voice: LegName, key: string, pcm: Int16Array): { atMs: number; endMs: number } | null {
    this.last = null;
    this.queues[voice].enqueue(key, pcm);
    return this.last;
  }

  pending(voice: LegName): number {
    return this.queues[voice].pending;
  }

  stop(): void {
    for (const cancel of this.cancels) cancel();
    this.cancels.clear();
  }
}
