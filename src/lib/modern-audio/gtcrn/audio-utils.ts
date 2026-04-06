import { fft, ifft } from './fft';

// GTCRN model constants
export const GTCRN_SAMPLE_RATE = 16000;
export const GTCRN_N_FFT = 512;
export const GTCRN_HOP_LENGTH = 256;
export const GTCRN_FREQ_BINS = GTCRN_N_FFT / 2 + 1; // 257

/**
 * Pre-compute sqrt-Hann window of given length.
 * GTCRN uses power=0.5 Hann window (square root of Hann).
 */
export function createSqrtHannWindow(length: number): Float32Array {
  const win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = Math.sqrt(0.5 * (1 - Math.cos(2 * Math.PI * i / length)));
  }
  return win;
}

/**
 * Apply window function to a frame in-place.
 */
export function applyWindow(frame: Float32Array, win: Float32Array): void {
  for (let i = 0; i < frame.length; i++) {
    frame[i] *= win[i];
  }
}

/**
 * Compute single-frame real FFT.
 * Input: windowed time-domain frame of length n_fft.
 * Output: [real, imag] arrays each of length n_fft/2+1 (257 for n_fft=512).
 */
export function rfft(frame: Float32Array): [Float32Array, Float32Array] {
  const n = frame.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(frame);

  fft(re, im);

  // Only first n/2+1 bins needed for real-valued signal
  const bins = n / 2 + 1;
  return [re.subarray(0, bins), im.subarray(0, bins)];
}

/**
 * Compute inverse real FFT from n/2+1 complex bins back to n time-domain samples.
 */
export function irfft(re: Float32Array, im: Float32Array, n: number): Float32Array {
  const fullRe = new Float32Array(n);
  const fullIm = new Float32Array(n);

  // Copy positive frequencies
  fullRe.set(re);
  fullIm.set(im);

  // Mirror negative frequencies (conjugate symmetry)
  for (let i = 1; i < n / 2; i++) {
    fullRe[n - i] = re[i];
    fullIm[n - i] = -im[i];
  }

  ifft(fullRe, fullIm);
  return fullRe;
}

/**
 * Convert Int16 PCM to Float32 [-1, 1].
 */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32768;
  }
  return output;
}

/**
 * Convert Float32 [-1, 1] to Int16 PCM.
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return output;
}

/**
 * Resample audio using linear interpolation.
 */
export function resample(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (sourceSampleRate === targetSampleRate) return input;

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = input[idx];
    const s1 = idx + 1 < input.length ? input[idx + 1] : s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}
