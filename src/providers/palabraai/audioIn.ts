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
 * Four capture cadences feed this rule, its worklet buffer over its
 * AudioContext's own rate (fix round 1, I1 — 500 ms held only for the
 * microphone, and spliced silence into a participant leg's speech on its
 * fallback):
 *   - microphone worklet: 4 096 samples at 48 kHz, 85.3 ms, downsampled to
 *     2 048 at 24 kHz (`audio-recorder-worklet-processor.js:22`,
 *     `ModernAudioRecorder.ts:353`, `:97` for the 48 kHz context);
 *   - microphone fallback: 16 384 samples at 48 kHz, 341 ms
 *     (`BaseAudioRecorder.ts:206-207`, `performance.js:23`); inherited
 *     unchanged from the base class, so — pre-existing, outside this task —
 *     this path never downsamples, unlike the worklet path above;
 *   - participant worklet: 4 096 samples at 24 kHz, 170.7 ms
 *     (`audio-recorder-worklet-processor.js:22`, `ParticipantRecorder.ts:62`);
 *   - participant fallback: 16 384 samples at 24 kHz, **682.7 ms**
 *     (`BaseAudioRecorder.ts:206-207`, `performance.js:23`,
 *     `ParticipantRecorder.ts:62`) — the slowest of the four.
 * 800 ms clears the participant fallback with a jank margin, so a gap
 * between two chunks of speech on any capture path is never taken for an
 * idle and filled with silence — the gap Doubao AST 2.0's 250 ms left open
 * on the microphone fallback.
 */
export const IDLE_MS = 800;
/**
 * One chunk of silence: what an idle beat sends. Shared and never written —
 * a typed array with elements cannot be frozen, and a writer here would
 * corrupt every later idle beat (fix round 1, N3). Kept an `Int16Array`
 * constant, not a function returning a fresh one: Task 13's adapter imports
 * this same instance to encode once and cache the frame.
 */
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
