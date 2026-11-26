/**
 * The ASR input conversion (asr_engine._downsample_int16_to_f32_16k), bit-for-bit: little-endian int16 PCM at the
 * client's rate → float32 at 16 kHz by linear interpolation. Every float32 step numpy rounds is rounded here
 * (Math.fround), and the length uses Python's round-half-to-even, so the output equals the Python engine's exactly.
 */
import { TARGET_RATE } from '../backends';

export const SRC_RATE = 24000;

/** Python's round(): the nearest integer, ties to even. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function downsampleInt16ToF32_16k(bytes: Uint8Array, srcRate = SRC_RATE): Float32Array {
  if (bytes.byteLength === 0) return new Float32Array(0);
  if (bytes.byteLength % 2 !== 0) throw new Error('buffer size must be a multiple of element size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength / 2;
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = view.getInt16(i * 2, true) / 32768;
  if (srcRate === TARGET_RATE) return x;
  const ratio = TARGET_RATE / srcRate;
  const n = roundHalfEven(len * ratio);
  const out = new Float32Array(n);
  const last = len - 1;
  for (let k = 0; k < n; k++) {
    const pos = k / ratio;
    const i0 = Math.floor(pos);
    const frac = Math.fround(pos - i0);
    const a = x[Math.min(Math.max(i0, 0), last)];
    const b = x[Math.min(Math.max(i0 + 1, 0), last)];
    out[k] = Math.fround(a + Math.fround(Math.fround(b - a) * frac));
  }
  return out;
}
