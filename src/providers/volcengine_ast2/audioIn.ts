/**
 * What Doubao hears (survey §1.5, §0.6): the contract's 24 kHz pcm as the
 * 16 kHz its `StartSession` declares, in the 80 ms packets it recommends
 * ("建议80ms 一包"), a push-to-talk release's 500 ms of silence, and the
 * idle rule the keepalive follows. Pure: no socket, no timer — the adapter
 * sends the packets and runs the keepalive on the request's clock.
 */

/** The server takes 16 kHz, 16-bit mono pcm (`StartSession.sourceAudio`). */
export const INPUT_RATE = 16_000;
/** 80 ms at 16 kHz (ruling 12). */
export const PACKET_SAMPLES = 1_280;
/** The old push-to-talk release (`VolcengineAST2ProviderConfig.ts:174-176`): the server's VAD closes the segment without waiting that long in wall time (ruling 6). */
export const TAIL_MS = 500;
const TAIL_SAMPLES = (INPUT_RATE * TAIL_MS) / 1000;
/** The keepalive's beat: one silent packet's length. */
export const KEEPALIVE_MS = 80;
/**
 * How long no audio must have gone out before the keepalive speaks
 * (ruling 7). The capture delivers a chunk every 85.3 ms (2 048 samples at
 * 24 kHz): the old 60 ms threshold fell inside that gap, so about one tick
 * in three spliced 80 ms of zeros between two chunks of speech (survey
 * §0.6). Three chunk periods is a real idle.
 */
export const IDLE_MS = 250;

/**
 * 24 kHz → 16 kHz, streamed (ruling 12): every three input samples give
 * two — the first as it is, the second the mean of the next two, which is
 * linear interpolation at steps of 1.5. The old code did this arithmetic
 * per chunk, resetting the phase and flooring the count, so a 2 048-sample
 * chunk lost a sample every third chunk (survey §1.18.10); here what does
 * not fill a group of three waits for the next chunk.
 */
export class Resampler {
  private carry: number[] = [];

  push(pcm: Int16Array): Int16Array {
    const held = this.carry;
    const total = held.length + pcm.length;
    const at = (i: number) => (i < held.length ? held[i] : pcm[i - held.length]);
    const groups = Math.floor(total / 3);
    const out = new Int16Array(groups * 2);
    for (let g = 0; g < groups; g++) {
      out[2 * g] = at(3 * g);
      out[2 * g + 1] = Math.round((at(3 * g + 1) + at(3 * g + 2)) / 2);
    }
    const rest: number[] = [];
    for (let i = groups * 3; i < total; i++) rest.push(at(i));
    this.carry = rest;
    return out;
  }

  /** Drops what waits for a group (under three input samples, 125 µs): a turn's end. */
  reset(): void {
    this.carry = [];
  }
}

/** The 16 kHz stream cut into 80 ms packets. */
export class InputPacer {
  private readonly resampler = new Resampler();
  private pending = new Int16Array(PACKET_SAMPLES);
  private filled = 0;

  /** The packets this chunk completes, in order; the rest waits. */
  push(pcm24: Int16Array): Int16Array[] {
    const samples = this.resampler.push(pcm24);
    const out: Int16Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(PACKET_SAMPLES - this.filled, samples.length - i);
      this.pending.set(samples.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === PACKET_SAMPLES) {
        out.push(this.pending);
        this.pending = new Int16Array(PACKET_SAMPLES);
        this.filled = 0;
      }
    }
    return out;
  }

  /**
   * An idle's start (ruling 7): what waits, as one short packet, and the
   * resampler's carry dropped — so the speech before an idle never goes up
   * after its silence. No silence of its own.
   */
  drain(): Int16Array[] {
    const out: Int16Array[] = [];
    if (this.filled > 0) out.push(this.pending.slice(0, this.filled));
    this.pending = new Int16Array(PACKET_SAMPLES);
    this.filled = 0;
    this.resampler.reset();
    return out;
  }

  /**
   * A push-to-talk release (ruling 6): what waits, as one short packet, then
   * 500 ms of silence at once — six 80 ms packets and a 20 ms one.
   */
  tail(): Int16Array[] {
    const out = this.drain();
    for (let left = TAIL_SAMPLES; left > 0; left -= PACKET_SAMPLES) out.push(new Int16Array(Math.min(PACKET_SAMPLES, left)));
    return out;
  }
}
