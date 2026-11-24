/**
 * One 16 kHz timeline per leg. Resamples Int16 PCM at `inputRate` to Float32
 * at 16 kHz exactly once, carrying the fractional remainder across chunks so
 * positions never drift with irregular chunk sizes. The grid is the leg's and
 * never restarts.
 *
 * Output sample i is the linear interpolation at input index i*inputRate/16000,
 * computed as the workers do: a/32768 + (b/32768 - a/32768) * frac. It is
 * emitted once input index ceil(i*inputRate/16000) has arrived, so nothing
 * lying at or before the last input sample is ever left waiting. flush() emits
 * a pending sample only if its position still falls within the input, holding
 * the last input sample as its upper neighbour; at 24 kHz there is none.
 */
import { VAD_SAMPLE_RATE } from './max-speech-frames';

const OUT_RATE = VAD_SAMPLE_RATE;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export class TimelineResampler {
  private readonly num: number; // input samples per `den` output samples
  private readonly den: number;
  private tail = new Int16Array(0); // input samples from absolute index `base`
  private base = 0;
  private emitted = 0;

  constructor(inputRate = 24000) {
    const g = gcd(inputRate, OUT_RATE);
    this.num = inputRate / g;
    this.den = OUT_RATE / g;
  }

  /** 16 kHz samples emitted since the leg's first chunk. */
  get position(): number {
    return this.emitted;
  }

  push(pcm: Int16Array): Float32Array {
    if (pcm.length === 0) return new Float32Array(0);
    const joined = new Int16Array(this.tail.length + pcm.length);
    joined.set(this.tail, 0);
    joined.set(pcm, this.tail.length);
    this.tail = joined;
    return this.drain(false);
  }

  flush(): Float32Array {
    return this.drain(true);
  }

  private drain(final: boolean): Float32Array {
    const end = this.base + this.tail.length; // one past the last arrived input index
    const out: number[] = [];
    for (;;) {
      const scaled = this.emitted * this.num;
      const lo = Math.floor(scaled / this.den);
      const rem = scaled - lo * this.den;
      const need = rem === 0 ? lo : lo + 1; // ceil(i * ratio)
      if (final ? scaled > (end - 1) * this.den : need >= end) break;
      const vLo = this.tail[lo - this.base] / 32768;
      const hiIdx = Math.min(lo + 1, end - 1);
      const vHi = this.tail[hiIdx - this.base] / 32768;
      out.push(vLo + (vHi - vLo) * (rem / this.den));
      this.emitted++;
    }
    // Drop input no future output can reference.
    const nextLo = Math.floor((this.emitted * this.num) / this.den);
    const drop = Math.min(Math.max(nextLo - this.base, 0), this.tail.length);
    if (drop > 0) {
      this.tail = this.tail.slice(drop);
      this.base += drop;
    }
    return Float32Array.from(out);
  }
}
