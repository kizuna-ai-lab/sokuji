/**
 * Sums two mono Int16 PCM channels into one stream for a single Soniox STT
 * session (Both-mode single-session). Fixed 0.5 gain per channel — proven
 * equivalent to a limiter/hardclip for Soniox recognition (level-invariant)
 * and can never clip. A starved channel is zero-filled so timing is preserved;
 * a channel exceeding the backlog cap drops its oldest samples.
 *
 * The mixed stream is STT-only (never played), so cross-AudioContext clock
 * drift between the two recorders is immaterial — occasional zero-fill or drop
 * does not affect recognition.
 */
export interface PcmMixerOptions {
  frameSamples: number;
  intervalMs: number;
  maxBacklogSamples: number;
  onFrame: (mixed: Int16Array) => void;
}

export class PcmMixer {
  private qA: number[] = [];
  private qB: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: PcmMixerOptions) {}

  pushA(pcm: Int16Array): void { this.enqueue(this.qA, pcm); }
  pushB(pcm: Int16Array): void { this.enqueue(this.qB, pcm); }

  private enqueue(q: number[], pcm: Int16Array): void {
    for (let i = 0; i < pcm.length; i++) q.push(pcm[i]);
    const over = q.length - this.options.maxBacklogSamples;
    if (over > 0) q.splice(0, over); // drop oldest
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.qA = []; this.qB = [];
  }

  private tick(): void {
    const n = this.options.frameSamples;
    const a = this.qA.splice(0, n);
    const b = this.qB.splice(0, n);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const va = i < a.length ? a[i] : 0;
      const vb = i < b.length ? b[i] : 0;
      const s = Math.round(0.5 * va + 0.5 * vb);
      out[i] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
    this.options.onFrame(out);
  }
}
