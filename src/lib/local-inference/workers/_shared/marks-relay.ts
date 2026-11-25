/**
 * The audio-and-marks output (spec C1, C2): the turn detector's trace as the input audio, relayed once and in
 * order, with `start`, `end` and `cancel` marks between its samples. The consumer (Voxtral 4B, Local Native)
 * runs on the relay's order alone: it never waits on a clock.
 *
 * Where the marks sit:
 * - `end` and `cancel` are exact: after the last sample before the boundary, before the first one after it. A
 *   boundary inside a frame splits that frame's raw input at round(x · 1.5) on the grid (768 samples per 512-sample
 *   frame at 24 kHz).
 * - `start` is placed at the frame that detected the turn, not at the pre-padded `open.at`: right before that
 *   frame's audio. The pre-pad span was relayed before it, as the consumer's own pre-roll; the relay never holds
 *   audio back for it.
 * - A continuation after a cap (an open at the preceding close's end) is `end` then `start` at the cut.
 *
 * A frame is traced before what it decided, in the same synchronous call. So the relay holds only the latest
 * frame's raw until the next event, and also flushes it in a microtask: a frame's audio never waits for later audio.
 */
import type { TurnTrace } from './turn-detector-protocol';

export type RelayOutput = { type: 'audio'; pcm: Int16Array } | { type: 'mark'; event: 'start' | 'end' | 'cancel' };

type Frame = Extract<TurnTrace, { kind: 'frame' }>;

export class MarksRelay {
  private held: Frame | null = null;
  /** The `to` of the close traced just before this event, if the previous event was a close. */
  private lastCloseTo: number | null = null;
  /** The press open in this view: a cancel names it, or is stale. */
  private openPress: number | null = null;

  constructor(private readonly post: (o: RelayOutput) => void) {}

  trace(e: TurnTrace): void {
    const prevCloseTo = this.lastCloseTo;
    this.lastCloseTo = null;
    switch (e.kind) {
      case 'frame':
        this.flush();
        this.held = e;
        queueMicrotask(() => this.flush());
        return;
      case 'open': {
        const continuation = prevCloseTo === e.at;
        const detecting = !continuation && this.held !== null && e.at < this.held.to;
        if (!continuation && !detecting) this.flush();
        this.mark('start');
        if (detecting) this.flush();
        this.openPress = e.press ?? null;
        return;
      }
      case 'close':
        this.boundary(e.to, 'end');
        this.openPress = null;
        this.lastCloseTo = e.to;
        return;
      case 'drop':
        this.boundary(e.to, 'cancel');
        this.openPress = null;
        return;
      case 'cancel':
        this.flush();
        if (this.openPress === e.press) {
          this.mark('cancel');
          this.openPress = null;
        }
        return;
      case 'drained':
        this.flush();
        return;
    }
  }

  /** A mark at 16 kHz position `x`, after every sample before it and before every sample after it. */
  private boundary(x: number, event: 'end' | 'cancel'): void {
    const h = this.held;
    if (h && x > h.from && x < h.to) {
      const at = Math.min(h.raw.length, Math.max(0, Math.round(((x - h.from) * h.raw.length) / (h.to - h.from))));
      if (at > 0) this.post({ type: 'audio', pcm: h.raw.subarray(0, at) });
      this.held = { ...h, from: x, raw: h.raw.subarray(at) };
    } else if (h && x >= h.to) {
      this.flush();
    }
    this.mark(event);
  }

  private mark(event: 'start' | 'end' | 'cancel'): void {
    this.post({ type: 'mark', event });
  }

  private flush(): void {
    const h = this.held;
    this.held = null;
    if (h && h.raw.length > 0) this.post({ type: 'audio', pcm: h.raw });
  }
}
