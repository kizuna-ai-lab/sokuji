/**
 * The half of the Smart Turn worker that does not know which onnxruntime-web
 * bundle it runs in (turn-webgpu.worker.ts, turn-wasm.worker.ts).
 */
import { logMel, type MelFilterbank } from './log-mel';
import { slaneyMelFilterbank } from './mel-filters';
import { TURN_SAMPLE_RATE, TURN_WINDOW_SAMPLES } from './turn-protocol';

const MEL_BINS = 80;
const NORMALIZE_EPS = 1e-7;

let filters: MelFilterbank | null = null;

/** WhisperFeatureExtractor(chunk_length=8) with do_normalize over the last 8 s, zero-padded at the front: [80][800]. */
export function featurize(window: Float32Array): Float32Array {
  const w = new Float32Array(TURN_WINDOW_SAMPLES);
  const tail = window.length > TURN_WINDOW_SAMPLES ? window.subarray(window.length - TURN_WINDOW_SAMPLES) : window;
  w.set(tail, TURN_WINDOW_SAMPLES - tail.length);
  let mean = 0;
  for (let i = 0; i < w.length; i++) mean += w[i];
  mean /= w.length;
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - mean;
    variance += d * d;
  }
  const scale = 1 / Math.sqrt(variance / w.length + NORMALIZE_EPS);
  for (let i = 0; i < w.length; i++) w[i] = (w[i] - mean) * scale;
  if (!filters) {
    filters = slaneyMelFilterbank({ nMels: MEL_BINS, nFft: 400, sampleRate: TURN_SAMPLE_RATE, fMin: 0, fMax: 8000 });
  }
  return logMel(w, filters).data;
}
