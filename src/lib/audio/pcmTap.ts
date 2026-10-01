/**
 * A tap's buffer on the main thread (spec: "The echo monitor keeps its three
 * probes" — the sink exposes a pcm tap). The worklet pushes chunks; the
 * reader drains whatever arrived since its last read.
 */
import { SAMPLE_RATE } from '../contract/adapter';

/** 100 ms: the tap worklet's chunk, and one tabs message. */
export const TAP_CHUNK_SAMPLES = SAMPLE_RATE / 10;

/** Thirty seconds, today's `createPlayedAudioTap` read cap. */
export const TAP_CAP_SAMPLES = 30 * SAMPLE_RATE;

/** What a tap heard since the last read. */
export interface PcmTap {
  /** Mono float samples at 24 kHz, oldest first; at most the tap's cap (older samples are dropped). */
  read(): Float32Array;
}

export interface PcmTapBuffer extends PcmTap {
  push(chunk: Float32Array): void;
}

export function createPcmTap(cap = TAP_CAP_SAMPLES): PcmTapBuffer {
  let chunks: Float32Array[] = [];
  let length = 0;
  return {
    push(chunk) {
      chunks.push(chunk);
      length += chunk.length;
      // Drop whole chunks while what is left still fills the cap.
      while (chunks.length > 1 && length - chunks[0].length >= cap) length -= chunks.shift()!.length;
    },
    read() {
      const out = new Float32Array(Math.min(length, cap));
      // Newest first, so the oldest chunk is the one cut when it straddles the cap.
      let offset = out.length;
      for (let i = chunks.length - 1; i >= 0 && offset > 0; i--) {
        const chunk = chunks[i];
        const take = Math.min(chunk.length, offset);
        out.set(chunk.subarray(chunk.length - take), offset - take);
        offset -= take;
      }
      chunks = [];
      length = 0;
      return out;
    },
  };
}
