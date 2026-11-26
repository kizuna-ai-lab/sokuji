/**
 * The TTS output conversion (tts_engine._to_int16_24k_mono): any family's audio → 24 kHz mono int16 little-endian.
 * Channels are averaged in float32 as numpy's mean does, the rate is converted by the addon's resampler (speexdsp,
 * standing in for soxr), then the samples are clipped to [-1, 1] and scaled by 32767, truncating toward zero as
 * numpy's astype(int16) does.
 */
import * as native from '../native';

export const TARGET_RATE = 24000;

/** The resampler, replaceable in tests (the addon's own is speexdsp). */
const DEFAULTS = {
  resample: (pcm: Float32Array, channels: number, fromRate: number, toRate: number): Float32Array => native.module().resample(pcm, channels, fromRate, toRate),
};
export const dspSeams = { ...DEFAULTS };
export function restoreDspSeams(): void {
  Object.assign(dspSeams, DEFAULTS);
}

/** Averages interleaved frames to one channel, each step in float32. */
export function downmix(pcm: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return pcm;
  const frames = Math.floor(pcm.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = pcm[f * channels];
    for (let c = 1; c < channels; c++) sum = Math.fround(sum + pcm[f * channels + c]);
    out[f] = Math.fround(sum / channels);
  }
  return out;
}

export function toInt16_24kMono(pcm: Float32Array, channels: number, srcRate: number): Uint8Array {
  let x = downmix(pcm, channels);
  if (srcRate !== TARGET_RATE && x.length > 0) x = dspSeams.resample(x, 1, srcRate, TARGET_RATE);
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.min(1, Math.max(-1, x[i]));
    out[i] = Math.trunc(Math.fround(v * 32767));
  }
  return new Uint8Array(out.buffer);
}
