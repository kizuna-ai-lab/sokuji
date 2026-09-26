/**
 * A continuous stream played as it arrives — the microphone under the
 * translation (passthrough): chunks back to back, one lead ahead of the clock
 * once it has run dry, as the clip queue schedules. A capture clock that runs
 * faster than the output clock would grow the delay forever, so a chunk that
 * arrives with more than `MAX_BUFFERED_S` already queued is dropped.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { LEAD_S, STARVED_S, type AudioTimeline } from './clipQueue';

export const MAX_BUFFERED_S = 0.3;

export class LiveStream {
  /** When the last scheduled chunk ends. */
  private tail = 0;
  private readonly playing = new Set<{ stop: () => void }>();

  constructor(private readonly timeline: AudioTimeline, private readonly leadS = LEAD_S) {}

  push(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const now = this.timeline.now();
    if (this.tail - now > MAX_BUFFERED_S) return;
    const at = this.tail > now + STARVED_S ? this.tail : now + this.leadS;
    let ended = false;
    const entry = { stop: () => {} };
    entry.stop = this.timeline.play(pcm, at, () => {
      ended = true;
      this.playing.delete(entry);
    });
    if (!ended) this.playing.add(entry);
    this.tail = at + pcm.length / SAMPLE_RATE;
  }

  /** Stops what plays and drops what is queued. */
  clear(): void {
    const playing = [...this.playing];
    this.playing.clear();
    this.tail = 0;
    for (const entry of playing) entry.stop();
  }
}
