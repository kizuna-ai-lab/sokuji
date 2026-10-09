import type { MelFilterbank } from './log-mel';

export interface MelFilterbankSpec {
  nMels: number;
  nFft: number;
  sampleRate: number;
  fMin: number;
  fMax: number;
}

const hzToMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) * (27 / Math.log(6.4)));
const melToHz = (mel: number) => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15)));

/** Slaney mel scale with Slaney area normalisation, as transformers' mel_filter_bank builds Whisper's. */
export function slaneyMelFilterbank({ nMels, nFft, sampleRate, fMin, fMax }: MelFilterbankSpec): MelFilterbank {
  const nFreqs = Math.floor(nFft / 2) + 1;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const edges: number[] = [];
  for (let i = 0; i < nMels + 2; i++) edges.push(melToHz(melMin + ((melMax - melMin) * i) / (nMels + 1)));
  const data: number[][] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m];
    const centre = edges[m + 1];
    const hi = edges[m + 2];
    const norm = 2 / (hi - lo);
    const row = new Array<number>(nFreqs);
    for (let k = 0; k < nFreqs; k++) {
      const hz = ((sampleRate / 2) * k) / (nFreqs - 1);
      row[k] = Math.max(0, Math.min((hz - lo) / (centre - lo), (hi - hz) / (hi - centre))) * norm;
    }
    data.push(row);
  }
  return { n_mels: nMels, n_freqs: nFreqs, data };
}
