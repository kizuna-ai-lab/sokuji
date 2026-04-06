import * as ort from 'onnxruntime-web';
import {
  GTCRN_SAMPLE_RATE,
  GTCRN_N_FFT,
  GTCRN_HOP_LENGTH,
  GTCRN_FREQ_BINS,
  createSqrtHannWindow,
  applyWindow,
  rfft,
  irfft,
  int16ToFloat32,
  float32ToInt16,
  resample
} from './audio-utils';

// ORT WASM paths — set from main thread during init (relative paths don't work in workers)
const INPUT_SAMPLE_RATE = 48000;

let session: ort.InferenceSession | null = null;
let win: Float32Array;

// RNN state tensors (persist across frames)
let convCache: ort.Tensor;
let traCache: ort.Tensor;
let interCache: ort.Tensor;

// Ring buffer for accumulating input samples at 16kHz
let inputBuffer: Float32Array = new Float32Array(0);

// Previous frame for overlap-add
let prevFrame: Float32Array = new Float32Array(GTCRN_N_FFT);

function initStates(): void {
  convCache = new ort.Tensor('float32', new Float32Array(2 * 1 * 16 * 16 * 33), [2, 1, 16, 16, 33]);
  traCache = new ort.Tensor('float32', new Float32Array(2 * 3 * 1 * 1 * 16), [2, 3, 1, 1, 16]);
  interCache = new ort.Tensor('float32', new Float32Array(2 * 1 * 33 * 16), [2, 1, 33, 16]);
  prevFrame = new Float32Array(GTCRN_N_FFT);
}

async function init(ortWasmBaseUrl: string, modelUrl: string): Promise<void> {
  try {
    // Set ORT WASM paths from main thread's resolved URL
    ort.env.wasm.wasmPaths = ortWasmBaseUrl;
    ort.env.wasm.proxy = false; // Already in a worker

    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    win = createSqrtHannWindow(GTCRN_N_FFT);
    initStates();

    self.postMessage({ type: 'ready' });
  } catch (error: any) {
    self.postMessage({ type: 'error', message: `Failed to initialize GTCRN: ${error.message}` });
  }
}

async function processFrame(frameRe: Float32Array, frameIm: Float32Array): Promise<[Float32Array, Float32Array]> {
  if (!session) throw new Error('Session not initialized');

  // Build input tensor: (1, 257, 1, 2) — [real, imag] stacked on last dim
  const mixData = new Float32Array(GTCRN_FREQ_BINS * 2);
  for (let i = 0; i < GTCRN_FREQ_BINS; i++) {
    mixData[i * 2] = frameRe[i];
    mixData[i * 2 + 1] = frameIm[i];
  }
  const mixTensor = new ort.Tensor('float32', mixData, [1, GTCRN_FREQ_BINS, 1, 2]);

  const feeds: Record<string, ort.Tensor> = {
    mix: mixTensor,
    conv_cache: convCache,
    tra_cache: traCache,
    inter_cache: interCache,
  };

  const results = await session.run(feeds);

  // Update states
  convCache = results['conv_cache_out'];
  traCache = results['tra_cache_out'];
  interCache = results['inter_cache_out'];

  // Extract enhanced spectrum
  const enhData = results['enh'].data as Float32Array;
  const enhRe = new Float32Array(GTCRN_FREQ_BINS);
  const enhIm = new Float32Array(GTCRN_FREQ_BINS);
  for (let i = 0; i < GTCRN_FREQ_BINS; i++) {
    enhRe[i] = enhData[i * 2];
    enhIm[i] = enhData[i * 2 + 1];
  }

  return [enhRe, enhIm];
}

async function processAudio(audio: Int16Array): Promise<void> {
  if (!session) return;

  // Convert Int16 48kHz → Float32 16kHz
  const float32 = int16ToFloat32(audio);
  const resampled = resample(float32, INPUT_SAMPLE_RATE, GTCRN_SAMPLE_RATE);

  // Append to input ring buffer
  const newBuffer = new Float32Array(inputBuffer.length + resampled.length);
  newBuffer.set(inputBuffer);
  newBuffer.set(resampled, inputBuffer.length);
  inputBuffer = newBuffer;

  // Collect output samples for this chunk
  const outputSamples: Float32Array[] = [];

  // Process frames while we have enough samples
  while (inputBuffer.length >= GTCRN_N_FFT) {
    // Extract frame
    const frame = new Float32Array(GTCRN_N_FFT);
    frame.set(inputBuffer.subarray(0, GTCRN_N_FFT));

    // Advance by hop_length
    inputBuffer = inputBuffer.subarray(GTCRN_HOP_LENGTH);

    // Apply window and FFT
    applyWindow(frame, win);
    const [re, im] = rfft(frame);

    // Run GTCRN inference
    const [enhRe, enhIm] = await processFrame(re, im);

    // ISTFT: inverse FFT
    const timeDomain = irfft(enhRe, enhIm, GTCRN_N_FFT);

    // Apply synthesis window
    applyWindow(timeDomain, win);

    // Overlap-add with previous frame
    const hopOutput = new Float32Array(GTCRN_HOP_LENGTH);
    for (let i = 0; i < GTCRN_HOP_LENGTH; i++) {
      hopOutput[i] = prevFrame[i + GTCRN_HOP_LENGTH] + timeDomain[i];
    }
    prevFrame.set(timeDomain);

    outputSamples.push(hopOutput);
  }

  if (outputSamples.length === 0) return;

  // Concatenate output samples
  const totalLength = outputSamples.reduce((acc, s) => acc + s.length, 0);
  const concatenated = new Float32Array(totalLength);
  let offset = 0;
  for (const samples of outputSamples) {
    concatenated.set(samples, offset);
    offset += samples.length;
  }

  // Resample back 16kHz → 48kHz
  const upsampled = resample(concatenated, GTCRN_SAMPLE_RATE, INPUT_SAMPLE_RATE);

  // Convert to Int16 and send back
  const outputInt16 = float32ToInt16(upsampled);
  self.postMessage(
    { type: 'audio', audio: outputInt16 },
    { transfer: [outputInt16.buffer] }
  );
}

self.onmessage = async (event: MessageEvent) => {
  const { type } = event.data;

  switch (type) {
    case 'init':
      await init(event.data.ortWasmBaseUrl, event.data.modelUrl);
      break;
    case 'process':
      await processAudio(event.data.audio);
      break;
    case 'reset':
      initStates();
      inputBuffer = new Float32Array(0);
      prevFrame = new Float32Array(GTCRN_N_FFT);
      break;
    case 'dispose':
      if (session) {
        session.release();
        session = null;
      }
      break;
  }
};
