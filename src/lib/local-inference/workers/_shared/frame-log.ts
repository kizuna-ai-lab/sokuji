/**
 * The leg's recent 16 kHz audio by timeline position, from 0, so a segment can
 * be cut out of it by its interval. It keeps the arrays it is given (nobody
 * writes to a frame once traced) and forgets what lies before `trimBefore`.
 */
export class FrameLog {
  private chunks: Float32Array[] = [];
  /** Where each chunk starts on the timeline. */
  private starts: number[] = [];
  /** Positions before this are forgotten. */
  private floor = 0;
  private total = 0;

  /** One past the last sample appended. */
  get end(): number {
    return this.total;
  }

  append(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.starts.push(this.total);
    this.total += samples.length;
  }

  /** `[from, to)` as a fresh array, transferable. */
  slice(from: number, to: number): Float32Array {
    if (from < this.floor || to > this.total || from > to) {
      throw new RangeError(`FrameLog: [${from}, ${to}) is not held (holds [${this.floor}, ${this.total}))`);
    }
    const out = new Float32Array(to - from);
    for (let i = 0; i < this.chunks.length && this.starts[i] < to; i++) {
      const start = this.starts[i];
      const chunk = this.chunks[i];
      if (start + chunk.length <= from) continue;
      const lo = Math.max(from, start);
      const hi = Math.min(to, start + chunk.length);
      out.set(chunk.subarray(lo - start, hi - start), lo - from);
    }
    return out;
  }

  /** Forget the audio before `position`: no later slice starts there. */
  trimBefore(position: number): void {
    if (position <= this.floor) return;
    this.floor = Math.min(position, this.total);
    let drop = 0;
    while (drop < this.chunks.length && this.starts[drop] + this.chunks[drop].length <= this.floor) drop++;
    if (drop > 0) {
      this.chunks.splice(0, drop);
      this.starts.splice(0, drop);
    }
  }
}
