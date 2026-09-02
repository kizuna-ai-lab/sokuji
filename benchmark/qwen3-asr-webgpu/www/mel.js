// Log-mel front end matching src/mel.py of the export pipeline (Whisper-style):
// torch.stft(n_fft=400, hop=160, hann periodic, center=True reflect pad),
// power spectrum, Slaney mel filterbank (128 x 201), log10 with 1e-10 floor,
// dynamic range clamp to (max - 8), then (x + 4) / 4, and the last frame dropped.
// Returns { data: Float32Array laid out [n_mels][T], nMels, T }.

const N_FFT = 400;
const HOP = 160;
const N_FREQS = N_FFT / 2 + 1; // 201

let tables = null;
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
  for (let n = 0; n < N_FFT; n++) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT); // periodic hann
  tables = { cos, sin, window };
  return tables;
}

export function logMel(audio, filters /* {n_mels, n_freqs, data: number[][]} */) {
  const { cos, sin, window } = dftTables();
  const nMels = filters.n_mels;
  const fb = new Float32Array(nMels * N_FREQS);
  for (let m = 0; m < nMels; m++) for (let k = 0; k < N_FREQS; k++) fb[m * N_FREQS + k] = filters.data[m][k];

  const pad = N_FFT / 2;
  const L = audio.length;
  const padded = new Float32Array(L + 2 * pad);
  for (let i = 0; i < pad; i++) padded[i] = audio[pad - i]; // reflect (edge excluded)
  padded.set(audio, pad);
  for (let i = 0; i < pad; i++) padded[pad + L + i] = audio[L - 2 - i];

  const nFrames = 1 + Math.floor((padded.length - N_FFT) / HOP);
  const T = nFrames - 1; // drop last frame like WhisperFeatureExtractor
  const out = new Float32Array(nMels * T);
  const frame = new Float32Array(N_FFT);
  const power = new Float32Array(N_FREQS);
  let gmax = -Infinity;
  for (let t = 0; t < T; t++) {
    const off = t * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[off + n] * window[n];
    for (let k = 0; k < N_FREQS; k++) {
      let re = 0, im = 0;
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

// 16-bit PCM mono WAV parser (the clips are pre-converted to 16 kHz mono PCM16).
export function parseWav(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x52494646) throw new Error('not RIFF');
  let off = 12;
  let fmt = null, data = null;
  while (off + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    } else if (id === 'data') {
      data = { start: off + 8, size };
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad wav');
  if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1 || fmt.rate !== 16000) {
    throw new Error(`unsupported wav: fmt=${fmt.format} bits=${fmt.bits} ch=${fmt.channels} rate=${fmt.rate}`);
  }
  const n = data.size / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(data.start + 2 * i, true) / 32768;
  return out;
}
