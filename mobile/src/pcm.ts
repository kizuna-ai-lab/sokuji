// Copied from the desktop's float32ToInt16 (src/lib/modern-audio/gtcrn/audio-utils.ts):
// importing that module would drag its FFT dependency into the app.
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
