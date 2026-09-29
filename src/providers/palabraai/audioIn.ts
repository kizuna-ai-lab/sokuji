/**
 * What Palabra hears (rulings 3 and 5): the contract's 24 kHz pcm — the
 * rate the task declares, no resampling — cut into the 320 ms chunks its
 * docs ask for "at the real-time rate" and the owner's probe sent; a
 * release's remainder padded to a chunk with silence; the silence an idle
 * stream carries, one chunk a beat. Pure: no socket, no timer — the adapter
 * sends the chunks and runs the idle rule on the request's clock.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';

/** One chunk's length (ruling 5; the docs; the probe). */
export const CHUNK_MS = 320;
/** 320 ms at 24 kHz: 7 680 samples, 15 360 bytes — 20 480 base64 characters, inside the docs' 1 KB–512 KB. */
export const CHUNK_SAMPLES = (SAMPLE_RATE * CHUNK_MS) / 1000;
/**
 * How long no audio must have come before the silence starts (ruling 3).
 * The capture delivers a chunk every 85.3 ms, or every 341 ms on the
 * ScriptProcessor fallback: 500 ms is past both, so a gap between two
 * chunks of speech is never taken for an idle and filled with silence —
 * the gap Doubao AST 2.0's 250 ms left open on the fallback.
 */
export const IDLE_MS = 500;
/** One chunk of silence: what an idle beat sends. */
export const SILENCE: Int16Array = new Int16Array(CHUNK_SAMPLES);

/** The stream cut into 320 ms chunks; the rest waits for the next audio, or a flush. */
export class Rechunker {
  private pending = new Int16Array(CHUNK_SAMPLES);
  private filled = 0;

  /** The chunks this audio completes, in order. */
  push(pcm: Int16Array): Int16Array[] {
    const out: Int16Array[] = [];
    let i = 0;
    while (i < pcm.length) {
      const n = Math.min(CHUNK_SAMPLES - this.filled, pcm.length - i);
      this.pending.set(pcm.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === CHUNK_SAMPLES) {
        out.push(this.pending);
        this.pending = new Int16Array(CHUNK_SAMPLES);
        this.filled = 0;
      }
    }
    return out;
  }

  /**
   * What waits, padded with silence to a whole chunk — a chunk under the
   * docs' 1 KB floor would not go up — and how many of its samples are
   * audio; null when nothing waits. A release, and an idle's start, send it.
   */
  flush(): { chunk: Int16Array; samples: number } | null {
    if (this.filled === 0) return null;
    const flushed = { chunk: this.pending, samples: this.filled };
    this.pending = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    return flushed;
  }
}
