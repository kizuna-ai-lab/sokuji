// src/lib/history/file/resample.ts
//
// An imported file's audio resampled to the record's rate, a piece at a time: a Blackman-windowed sinc low-pass,
// cut off at 0.45 of the lower rate, read at each output sample's place in the input. The output depends only on
// where a sample falls, never on how the input was cut into pieces. The kernels are worked out once per phase.

/** Zero crossings of the sinc on each side of a sample. */
const ZERO_CROSSINGS = 16;
/** The low-pass cut-off, as a share of the lower of the two rates. */
const CUT_OFF = 0.45;

export interface Resampler {
  /** The output that `input` completes (the last few input samples wait for what follows them). */
  push(input: Float32Array): Float32Array;
  /** What is left, the input ending in silence. */
  flush(): Float32Array;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function createResampler(fromRate: number, toRate: number): Resampler {
  if (fromRate === toRate) return { push: (input) => input, flush: () => new Float32Array(0) };

  // Positions are counted in output samples × `phases`: output j lies at input j × step / phases, exactly.
  const g = gcd(fromRate, toRate);
  const phases = toRate / g;
  const step = fromRate / g;
  /** The cut-off in cycles per input sample. */
  const fc = (CUT_OFF * Math.min(fromRate, toRate)) / fromRate;
  const half = Math.ceil(ZERO_CROSSINGS / (2 * fc));
  const taps = 2 * half;
  // kernels[p] weighs inputs at (base - half + 1 + k), k < taps, for an output at base + p / phases; each sums to 1.
  const kernels: Float32Array[] = [];
  for (let p = 0; p < phases; p++) {
    const kernel = new Float32Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const t = k - half + 1 - p / phases;
      const x = 2 * fc * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = Math.abs(t) >= half ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
      kernel[k] = sinc * w;
      sum += kernel[k];
    }
    for (let k = 0; k < taps; k++) kernel[k] /= sum;
    kernels.push(kernel);
  }

  /** Input samples kept, the first of them at absolute index `bufStart`. */
  let buf = new Float32Array(0);
  let bufStart = 0;
  /** Input samples seen. */
  let total = 0;
  /** The next output sample's number. */
  let next = 0;

  const at = (i: number) => (i < bufStart || i >= bufStart + buf.length ? 0 : buf[i - bufStart]);

  /** Outputs while the input they reach is in: up to `limit` (exclusive) of input. */
  function emit(limit: number, ending: boolean): Float32Array {
    const out: number[] = [];
    for (;;) {
      const pos = next * step;
      const base = Math.floor(pos / phases);
      if (ending ? pos >= total * phases : base + half >= limit) break;
      const kernel = kernels[pos - base * phases];
      const from = base - half + 1;
      let acc = 0;
      if (from >= bufStart && from + taps <= bufStart + buf.length) {
        const off = from - bufStart;
        for (let k = 0; k < taps; k++) acc += kernel[k] * buf[off + k];
      } else {
        for (let k = 0; k < taps; k++) acc += kernel[k] * at(from + k);
      }
      out.push(acc);
      next += 1;
    }
    // Keep what the next output still reaches.
    const keepFrom = Math.max(bufStart, Math.floor((next * step) / phases) - half + 1);
    if (keepFrom > bufStart) {
      buf = buf.slice(keepFrom - bufStart);
      bufStart = keepFrom;
    }
    return Float32Array.from(out);
  }

  return {
    push(input) {
      if (input.length === 0) return new Float32Array(0);
      const joined = new Float32Array(buf.length + input.length);
      joined.set(buf, 0);
      joined.set(input, buf.length);
      buf = joined;
      total += input.length;
      return emit(total, false);
    },
    flush() {
      return emit(total, true);
    },
  };
}
