/**
 * One leg's input level for the footer's waveform (plan 1e-3b-1 ruling 3):
 * one bar per delivered chunk, its RMS scaled so speech fills the strip,
 * flat once nothing has arrived for a moment — a muted or ended source
 * delivers nothing.
 */
import { realClock, type Clock } from '../contract/clock';

/** Bars the strip keeps, oldest first. */
export const LEVEL_BARS = 32;
/** No chunk for this long: the meter reads flat. */
export const LEVEL_STALE_MS = 300;
/** Scales a chunk's RMS so ordinary speech fills the strip. */
export const LEVEL_GAIN = 4;

export interface LevelMeter {
  /** A delivered chunk: pushes one new bar, the chunk's RMS scaled and clamped to 1. */
  push(pcm: Int16Array): void;
  /** The bars, oldest first; a new array each call, so a caller may keep it. */
  read(): Float32Array;
  reset(): void;
}

export function createLevelMeter(clock: Pick<Clock, 'now'> = realClock, bars = LEVEL_BARS): LevelMeter {
  let levels = new Float32Array(bars);
  let lastAt = -Infinity;
  return {
    push(pcm) {
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
      const rms = pcm.length > 0 ? Math.sqrt(sum / pcm.length) : 0;
      if (clock.now() - lastAt > LEVEL_STALE_MS) levels = new Float32Array(bars);
      levels.copyWithin(0, 1);
      levels[bars - 1] = Math.min(1, rms * LEVEL_GAIN);
      lastAt = clock.now();
    },
    read: () => (clock.now() - lastAt > LEVEL_STALE_MS ? new Float32Array(bars) : levels.slice()),
    reset() { levels = new Float32Array(bars); lastAt = -Infinity; },
  };
}
