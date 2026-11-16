// src/lib/history/file/toPcm24k.ts
//
// An imported file's decoded blocks made into the record's samples: each block is placed by its own timestamp, not
// by counting what came before (a gap becomes silence, an overlap is cut), its channels are averaged into one, and
// it is resampled to 24 kHz — all a block at a time, so memory never grows with the file.
import { SAMPLE_RATE } from '../../contract/adapter';
import { createResampler, type Resampler } from './resample';

/** One decoded block, its channels apart, as WebCodecs gives it. */
export interface DecodedPiece {
  timestampS: number;
  sampleRate: number;
  planes: Float32Array[];
}

/** Ten seconds at a time by default. */
const CHUNK_SAMPLES = 10 * SAMPLE_RATE;

/** The channels' average. */
function mix(planes: readonly Float32Array[]): Float32Array {
  if (planes.length === 1) return planes[0];
  const n = Math.min(...planes.map((p) => p.length));
  const out = new Float32Array(n);
  for (const p of planes) for (let i = 0; i < n; i++) out[i] += p[i];
  for (let i = 0; i < n; i++) out[i] /= planes.length;
  return out;
}

/** 16-bit samples, clipped at full scale, rounded as the recording's own mixer does. */
function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767.5 - 0.25);
  }
  return out;
}

export async function* toPcm24k(
  pieces: AsyncIterable<DecodedPiece>,
  o: { chunkSamples?: number; signal?: AbortSignal; maxSamples?: number } = {},
): AsyncIterable<Int16Array> {
  const chunkSamples = o.chunkSamples ?? CHUNK_SAMPLES;
  // At most this many: a timestamp far ahead must not make hours of silence.
  const maxSamples = o.maxSamples ?? Number.POSITIVE_INFINITY;
  const full = () => written >= maxSamples;
  let chunk = new Int16Array(chunkSamples);
  let filled = 0;
  /** Output samples so far. */
  let written = 0;
  // One resampler per stretch of one input rate; the stretch began at output `stretchStart`, and has taken `fed`
  // input samples, so its next input sample lies at stretchStart / 24000 + fed / rate seconds.
  let resampler: Resampler | null = null;
  let rate = 0;
  let stretchStart = 0;
  let fed = 0;

  const ready: Int16Array[] = [];
  const put = (x: Float32Array) => {
    if (x.length === 0 || full()) return;
    const s = toInt16(x.length > maxSamples - written ? x.subarray(0, maxSamples - written) : x);
    written += s.length;
    let at = 0;
    while (at < s.length) {
      const n = Math.min(chunkSamples - filled, s.length - at);
      chunk.set(s.subarray(at, at + n), filled);
      filled += n;
      at += n;
      if (filled === chunkSamples) {
        ready.push(chunk);
        chunk = new Int16Array(chunkSamples);
        filled = 0;
      }
    }
  };

  for await (const piece of pieces) {
    if (o.signal?.aborted) return;
    // A container may state its rate as a fraction (Matroska floats, MOV fixed point).
    const pieceRate = Math.round(piece.sampleRate);
    if (!(pieceRate > 0)) throw new Error(`A sample rate of ${piece.sampleRate} Hz cannot be read`);
    if (!resampler || pieceRate !== rate) {
      if (resampler) put(resampler.flush());
      rate = pieceRate;
      resampler = createResampler(rate, SAMPLE_RATE);
      stretchStart = written;
      fed = 0;
    }
    let mono = mix(piece.planes);
    // Where this block belongs in its stretch, in input samples: silence before it, or its overlap cut.
    const target = Math.round((piece.timestampS - stretchStart / SAMPLE_RATE) * rate);
    if (target > fed) {
      // Silence ten seconds at a time: a long gap must not take memory at once.
      const slice = new Float32Array(10 * rate);
      while (fed < target) {
        const n = Math.min(slice.length, target - fed);
        put(resampler.push(n === slice.length ? slice : slice.subarray(0, n)));
        fed += n;
        if (full()) break;
        while (ready.length > 0) {
          yield ready.shift()!;
          if (o.signal?.aborted) return;
        }
      }
    } else if (target < fed) {
      mono = mono.subarray(Math.min(mono.length, fed - target));
    }
    put(resampler.push(mono));
    fed += mono.length;
    while (ready.length > 0) {
      yield ready.shift()!;
      if (o.signal?.aborted) return;
    }
    if (full()) break;
  }
  if (resampler) put(resampler.flush());
  while (ready.length > 0) yield ready.shift()!;
  if (filled > 0) yield chunk.slice(0, filled);
}
