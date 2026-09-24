/**
 * The clip queue (spec: "Playback" → "The clip queue"). A clip is one speech
 * entry — one `audio` event's pcm — so it is whole when it is enqueued: L0
 * has no "this segment's audio is complete" event (`segmentClosed` marks the
 * text final, and a local engine's speech for a closed segment arrives after
 * it), so a clip spanning a segment could never be sealed. Clips play back to
 * back in the order they were enqueued. The queue keeps no pcm: the timeline
 * holds a clip until it ends, and L1's `speech[].pcm` is the durable copy.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { describeCause, reportError } from '../diagnostics/report';

/** The clock a queue schedules on: the graph's `AudioContext` in the app, a fake in tests. Seconds. */
export interface AudioTimeline {
  now(): number;
  /**
   * Plays 24 kHz mono pcm from `at`. `onEnded` fires once, when it has played
   * out or been stopped; the returned function stops it.
   */
  play(pcm: Int16Array, at: number, onEnded: () => void): () => void;
}

/** What a queue is playing: which clip, and how far into it. */
export interface Playing<K extends string = string> {
  key: K;
  /** Milliseconds into the clip, on the audio clock. */
  t: number;
}

/** A read-only view of a queue, for karaoke and the playing indicator. */
export interface QueueView<K extends string = string> {
  /** Exact, against the audio clock; null in a gap and when idle. */
  position(): Playing<K> | null;
  /** How many clips are scheduled or playing. */
  readonly pending: number;
  /** Called when a clip is enqueued, a clip ends, or the queue is cleared: time to read `position()` again. */
  subscribe(listener: () => void): () => void;
}

/** How far ahead of the clock a clip is scheduled when the queue is idle: absorbs main-thread jitter. */
export const LEAD_S = 0.05;

interface Scheduled<K> {
  key: K;
  at: number;
  end: number;
  stop: () => void;
  done: boolean;
}

export class ClipQueue<K extends string = string> implements QueueView<K> {
  private clips: Scheduled<K>[] = [];
  /** When the last scheduled clip ends: the next one starts there, or one lead ahead of the clock if that has passed. */
  private tail = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly timeline: AudioTimeline, private readonly leadS = LEAD_S) {}

  enqueue(key: K, pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const at = Math.max(this.timeline.now() + this.leadS, this.tail);
    const clip: Scheduled<K> = { key, at, end: at + pcm.length / SAMPLE_RATE, stop: () => {}, done: false };
    this.tail = clip.end;
    this.clips.push(clip);
    clip.stop = this.timeline.play(pcm, at, () => this.finish(clip));
    this.notify();
  }

  /** Stops what plays and drops what is queued. */
  clear(): void {
    const clips = this.clips;
    this.clips = [];
    this.tail = 0;
    for (const clip of clips) {
      clip.done = true;
      clip.stop();
    }
    if (clips.length > 0) this.notify();
  }

  position(): Playing<K> | null {
    const now = this.timeline.now();
    const clip = this.clips.find((c) => c.at <= now && now < c.end);
    return clip ? { key: clip.key, t: (now - clip.at) * 1000 } : null;
  }

  get pending(): number {
    return this.clips.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private finish(clip: Scheduled<K>): void {
    if (clip.done) return;
    clip.done = true;
    this.clips = this.clips.filter((c) => c !== clip);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        reportError('ClipQueue', `A queue subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'clipQueue:subscriber' });
      }
    }
  }
}
