import { SAMPLE_RATE } from '../../lib/contract/adapter';

/** A 440 Hz tone, `ms` long, at the contract's sample rate. */
export function synthPcm(ms: number, hz = 440, amplitude = 8000): Int16Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude);
  }
  return out;
}

/** How long the fake "speaks" a text: 60 ms per character, at least 200 ms. */
export function msForText(text: string, msPerChar = 60): number {
  return Math.max(200, text.length * msPerChar);
}
