/**
 * Gaps in what the tts tap heard (G3): a run of silence inside speech
 * long enough not to be a waveform's own zero crossing. The preview's
 * playback probe feeds it every tap read, so a gap straddling two reads
 * counts once. Silence before the first sound and after the last is not
 * a gap. Development only.
 */
/** 0.5 ms at 24 kHz: a 440 Hz sine at the fake's amplitude is below `SILENT` for one sample at a crossing. */
export const GAP_MIN_SAMPLES = 12;
export const SILENT = 1e-4;

export interface GapCount {
  gaps: number;
  /** Their total length, in ms. */
  gapMs: number;
  /** Where each began, in seconds since the first sound. */
  at: number[];
}

export function createGapCounter(sampleRate = 24_000): { push(samples: Float32Array): void; read(): GapCount } {
  let heard = false;
  /** Samples since the first sound. */
  let position = 0;
  /** Silent samples since the last sound. */
  let run = 0;
  const count: GapCount = { gaps: 0, gapMs: 0, at: [] };
  return {
    push(samples) {
      for (let i = 0; i < samples.length; i++) {
        const silent = Math.abs(samples[i]) < SILENT;
        if (!heard) {
          if (silent) continue;
          heard = true;
        } else {
          position += 1;
        }
        if (silent) { run += 1; continue; }
        if (run >= GAP_MIN_SAMPLES) {
          count.gaps += 1;
          count.gapMs += (run * 1000) / sampleRate;
          count.at.push((position - run) / sampleRate);
        }
        run = 0;
      }
    },
    read: () => ({ gaps: count.gaps, gapMs: count.gapMs, at: [...count.at] }),
  };
}
