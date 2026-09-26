/**
 * One leg's input spectrum for the footer's waveform: the same frequency bars
 * the output strip draws, moving as smoothly. It emulates the output's
 * `AnalyserNode` (the Web Audio spec's frequency-domain algorithm) over the
 * PCM the capture delivers, and each read takes its window where a playhead
 * running at the sample rate has reached in the latest chunk — so the bars
 * move at the frame rate, not only when a chunk lands. Flat once nothing has
 * arrived for a moment: a muted or ended source delivers nothing.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { realClock, type Clock } from '../contract/clock';

// `graph.ts`'s bus analyser (`wireAnalyser`, `readMeter`): change them together.
/** Its `fftSize`: the window, in samples. */
const FFT_SIZE = 64;
/** Its `smoothingTimeConstant`. */
const SMOOTHING = 0.8;
/** Its default `minDecibels` and `maxDecibels`: the range `getByteFrequencyData` spreads over 0..255. */
const MIN_DB = -100;
const MAX_DB = -30;
/** The spec's Blackman window, α = 0.16. */
const BLACKMAN_ALPHA = 0.16;

/** Bars the strip draws: the analyser's `frequencyBinCount`. */
export const LEVEL_BARS = FFT_SIZE / 2;
/** No chunk for this long: the meter reads flat. */
export const LEVEL_STALE_MS = 300;

const WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, n) => {
  const a0 = (1 - BLACKMAN_ALPHA) / 2;
  const a2 = BLACKMAN_ALPHA / 2;
  return a0 - 0.5 * Math.cos((2 * Math.PI * n) / FFT_SIZE) + a2 * Math.cos((4 * Math.PI * n) / FFT_SIZE);
});
/** Where each input sample goes before the in-place radix-2 passes. */
const BIT_REVERSED = Uint8Array.from({ length: FFT_SIZE }, (_, i) => {
  let reversed = 0;
  for (let bit = 1, mirror = FFT_SIZE >> 1; bit < FFT_SIZE; bit <<= 1, mirror >>= 1) {
    if (i & bit) reversed |= mirror;
  }
  return reversed;
});
const COS = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / FFT_SIZE));
const SIN = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / FFT_SIZE));

/** In place, `re`/`im` already in bit-reversed order: X[k] = Σ x[n]·e^(−2πikn/N). */
function fft(re: Float64Array, im: Float64Array): void {
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let j = 0; j < half; j++) {
        const cos = COS[j * step];
        const sin = SIN[j * step];
        const a = start + j;
        const b = a + half;
        const tr = re[b] * cos + im[b] * sin;
        const ti = im[b] * cos - re[b] * sin;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

export interface LevelMeter {
  /** A delivered chunk: its samples join the window, its arrival starts the playhead. */
  push(pcm: Int16Array): void;
  /** The bars, 0..1, lowest frequency first; a new array each call, so a caller may keep it. */
  read(): Float32Array;
  reset(): void;
}

export function createLevelMeter(clock: Pick<Clock, 'now'> = realClock): LevelMeter {
  /** The latest chunk, and the `FFT_SIZE` samples before it: a window may reach back past its start. */
  let latest = new Int16Array(0);
  const before = new Int16Array(FFT_SIZE);
  let lastAt = -Infinity;
  /** The analyser's previous smoothed magnitudes. */
  const smoothed = new Float64Array(LEVEL_BARS);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  const clear = () => {
    latest = new Int16Array(0);
    before.fill(0);
    smoothed.fill(0);
  };

  return {
    push(pcm) {
      const now = clock.now();
      // After a flat spell the bars start from nothing, as a fresh analyser
      // would: no stale samples in the window, no stale spectrum to decay from.
      if (now - lastAt > LEVEL_STALE_MS) {
        clear();
      } else {
        const kept = Math.min(latest.length, FFT_SIZE);
        before.copyWithin(0, kept);
        before.set(latest.subarray(latest.length - kept), FFT_SIZE - kept);
      }
      latest = pcm.slice();
      lastAt = now;
    },

    read() {
      const elapsed = clock.now() - lastAt;
      if (elapsed > LEVEL_STALE_MS) return new Float32Array(LEVEL_BARS);
      const playhead = Math.min(Math.max(0, Math.floor((elapsed * SAMPLE_RATE) / 1000)), latest.length);
      for (let n = 0; n < FFT_SIZE; n++) {
        const at = playhead - FFT_SIZE + n;
        const sample = at >= 0 ? latest[at] : before[FFT_SIZE + at];
        re[BIT_REVERSED[n]] = (sample / 32768) * WINDOW[n];
        im[n] = 0;
      }
      fft(re, im);
      const levels = new Float32Array(LEVEL_BARS);
      for (let k = 0; k < LEVEL_BARS; k++) {
        const magnitude = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_SIZE;
        smoothed[k] = SMOOTHING * smoothed[k] + (1 - SMOOTHING) * magnitude;
        // log10(0) is -Infinity, which the clamp turns into 0.
        const db = 20 * Math.log10(smoothed[k]);
        levels[k] = Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
      }
      return levels;
    },

    reset() {
      clear();
      lastAt = -Infinity;
    },
  };
}
