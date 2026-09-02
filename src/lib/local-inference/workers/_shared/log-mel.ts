/**
 * Whisper-style log-mel front end, matching the Qwen3-ASR export pipeline's `src/mel.py`:
 * torch.stft(n_fft=400, hop=160, periodic Hann, center=True with reflect padding), power
 * spectrum, Slaney mel filterbank, log10 with a 1e-10 floor, dynamic-range clamp to
 * (max − 8), then (x + 4) / 4, and the last STFT frame dropped.
 *
 * The filterbank is passed in (the model repo ships it as `mel_filters.json`), so this file
 * has no dependency on librosa-style mel math. The 400-point transform is a direct DFT with
 * cached tables: ~100–250 ms for a 10 s utterance, which is small next to the model itself.
 */

export interface MelFilterbank {
  n_mels: number;
  n_freqs: number;
  /** [n_mels][n_freqs] */
  data: number[][];
}

export interface LogMel {
  /** Laid out [nMels][T]. */
  data: Float32Array;
  nMels: number;
  T: number;
}

const N_FFT = 400;
const HOP = 160;
const N_FREQS = N_FFT / 2 + 1; // 201

let tables: { cos: Float32Array; sin: Float32Array; window: Float32Array } | null = null;

function dftTables() {
  if (tables) return tables;
  const cos = new Float32Array(N_FREQS * N_FFT);
  const sin = new Float32Array(N_FREQS * N_FFT);
  for (let k = 0; k < N_FREQS; k++) {
    for (let n = 0; n < N_FFT; n++) {
      const a = (2 * Math.PI * k * n) / N_FFT;
      cos[k * N_FFT + n] = Math.cos(a);
      sin[k * N_FFT + n] = Math.sin(a);
    }
  }
  const window = new Float32Array(N_FFT);
  for (let n = 0; n < N_FFT; n++) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT); // periodic Hann
  tables = { cos, sin, window };
  return tables;
}

export function logMel(audio: Float32Array, filters: MelFilterbank): LogMel {
  if (filters.n_freqs !== N_FREQS) {
    throw new Error(`mel filterbank has ${filters.n_freqs} bins, expected ${N_FREQS}`);
  }
  const { cos, sin, window } = dftTables();
  const nMels = filters.n_mels;
  const fb = new Float32Array(nMels * N_FREQS);
  for (let m = 0; m < nMels; m++) {
    for (let k = 0; k < N_FREQS; k++) fb[m * N_FREQS + k] = filters.data[m][k];
  }

  const pad = N_FFT / 2;
  const L = audio.length;
  const padded = new Float32Array(L + 2 * pad);
  for (let i = 0; i < pad; i++) padded[i] = audio[pad - i]; // reflect: edge sample excluded
  padded.set(audio, pad);
  for (let i = 0; i < pad; i++) padded[pad + L + i] = audio[L - 2 - i];

  const nFrames = 1 + Math.floor((padded.length - N_FFT) / HOP);
  const T = nFrames - 1; // WhisperFeatureExtractor drops the last frame
  const out = new Float32Array(nMels * T);
  const frame = new Float32Array(N_FFT);
  const power = new Float32Array(N_FREQS);
  let gmax = -Infinity;
  for (let t = 0; t < T; t++) {
    const off = t * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[off + n] * window[n];
    for (let k = 0; k < N_FREQS; k++) {
      let re = 0;
      let im = 0;
      const base = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        re += frame[n] * cos[base + n];
        im -= frame[n] * sin[base + n];
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      const fbase = m * N_FREQS;
      for (let k = 0; k < N_FREQS; k++) acc += fb[fbase + k] * power[k];
      const v = Math.log10(Math.max(acc, 1e-10));
      out[m * T + t] = v;
      if (v > gmax) gmax = v;
    }
  }
  const floor = gmax - 8.0;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], floor) + 4.0) / 4.0;
  return { data: out, nMels, T };
}
