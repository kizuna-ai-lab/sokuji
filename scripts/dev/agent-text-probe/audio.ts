/**
 * The agent-text probe's signal side: a growable float track, levels, and the
 * echo model — what the microphone hears when no echo cancellation runs.
 *
 * The echo of a played clip is the clip itself, resampled to the STT input
 * rate, delayed by `delayMs` (output latency plus the speaker-to-mic path),
 * scaled by `gain`, optionally convolved with a sparse room impulse response
 * (`src/lib/modern-audio/echoSim.ts`), and *added* to the human voices. The
 * microphone then clips at full scale, as an ADC does.
 */
import type { SparseRir } from '../../../src/lib/modern-audio/echoSim';

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** A mono float timeline (int16 scale) that grows as clips are added past its end. */
export class Track {
  private data: Float32Array;
  /** One past the last sample anything was added at. */
  length = 0;

  constructor(initialSamples = 0) {
    this.data = new Float32Array(Math.max(1024, initialSamples));
  }

  /** Adds `pcm × gain` from sample `at` (negative positions are cut off). */
  add(pcm: ArrayLike<number>, at: number, gain = 1): void {
    const from = Math.max(0, -at);
    if (from >= pcm.length) return;
    this.ensure(at + pcm.length);
    for (let i = from; i < pcm.length; i++) this.data[at + i] += pcm[i] * gain;
    this.length = Math.max(this.length, at + pcm.length);
  }

  /** `n` samples from `from`; zeros past the end. */
  read(from: number, n: number): Float32Array {
    const out = new Float32Array(n);
    const end = Math.min(this.data.length, from + n);
    if (end > from) out.set(this.data.subarray(Math.max(0, from), end), Math.max(0, -from));
    return out;
  }

  toInt16(): { pcm: Int16Array; clipped: number } {
    return clampInt16(this.data.subarray(0, this.length));
  }

  private ensure(n: number): void {
    if (n <= this.data.length) return;
    const grown = new Float32Array(Math.max(n, this.data.length * 2));
    grown.set(this.data);
    this.data = grown;
  }
}

/** Rounds to int16, clamping at full scale; counts the samples clamped. */
export function clampInt16(x: ArrayLike<number>): { pcm: Int16Array; clipped: number } {
  const pcm = new Int16Array(x.length);
  let clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.round(x[i]);
    if (v > 32767) { pcm[i] = 32767; clipped++; } else if (v < -32768) { pcm[i] = -32768; clipped++; } else pcm[i] = v;
  }
  return { pcm, clipped };
}

/** Linear resampling (identity at equal rates). */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const out = new Int16Array(Math.round((pcm.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = Math.round((pcm[i0] ?? 0) * (1 - f) + (pcm[i0 + 1] ?? pcm[i0] ?? 0) * f);
  }
  return out;
}

/**
 * The active-speech level in dBFS: the power of the 20-ms frames within
 * 30 dB of the loudest one (the pauses left out). -Infinity for silence.
 */
export function activeDbfs(pcm: ArrayLike<number>, rate: number): number {
  const frame = Math.max(1, Math.round(rate * 0.02));
  const powers: number[] = [];
  for (let off = 0; off + frame <= pcm.length; off += frame) {
    let s = 0;
    for (let i = off; i < off + frame; i++) s += pcm[i] * pcm[i];
    powers.push(s / frame);
  }
  const loudest = Math.max(0, ...powers);
  if (loudest === 0) return -Infinity;
  const active = powers.filter((p) => p >= loudest / 1000);
  const mean = active.reduce((a, b) => a + b, 0) / active.length;
  return 10 * Math.log10(mean / (32768 * 32768));
}

/** `pcm` scaled so its active level is `dbfs` (silence unchanged). */
export function normalizeActive(pcm: Int16Array, rate: number, dbfs: number): Int16Array {
  const level = activeDbfs(pcm, rate);
  if (!Number.isFinite(level)) return pcm;
  return clampInt16(Array.from(pcm, (v) => v * dbToGain(dbfs - level))).pcm;
}

export interface EchoParams {
  /** The STT input rate the echo is placed at. */
  rate: number;
  /** Play time to microphone: output latency plus the acoustic path. */
  delayMs: number;
  /** Linear gain on the played audio. */
  gain: number;
  /** A sparse room response at `rate`, its direct path first; null: none. */
  rir: SparseRir | null;
}

/** The echo the microphone hears, on the microphone's own timeline (ms from its first sample). */
export class EchoTrack {
  readonly track: Track;

  constructor(readonly p: EchoParams, initialSamples = 0) {
    this.track = new Track(initialSamples);
  }

  /**
   * A clip that starts playing at `micMs` on the microphone's timeline:
   * where its echo lands there, in ms (the room tail not included).
   */
  place(pcm: Int16Array, pcmRate: number, micMs: number): { fromMs: number; toMs: number } {
    const x = resample(pcm, pcmRate, this.p.rate);
    const at = Math.round(((micMs + this.p.delayMs) * this.p.rate) / 1000);
    if (this.p.rir) {
      const { delays, gains } = this.p.rir;
      for (let k = 0; k < delays.length; k++) if (gains[k] !== 0) this.track.add(x, at + delays[k], this.p.gain * gains[k]);
    } else {
      this.track.add(x, at, this.p.gain);
    }
    return { fromMs: (at * 1000) / this.p.rate, toMs: ((at + x.length) * 1000) / this.p.rate };
  }
}

/**
 * One microphone frame: the human voices plus the echo over the same
 * samples, clipped at full scale.
 */
export function micFrame(human: Int16Array, echo: Float32Array | null): { frame: Int16Array; clipped: number } {
  if (!echo) return { frame: human.slice(), clipped: 0 };
  const sum = new Float32Array(human.length);
  for (let i = 0; i < human.length; i++) sum[i] = human[i] + (echo[i] ?? 0);
  const { pcm, clipped } = clampInt16(sum);
  return { frame: pcm, clipped };
}
