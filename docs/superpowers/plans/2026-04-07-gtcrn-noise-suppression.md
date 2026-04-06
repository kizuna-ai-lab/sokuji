# GTCRN Noise Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GTCRN as a user-selectable "Enhanced" noise suppression option alongside the existing RNNoise "Standard" option.

**Architecture:** GTCRN runs frame-by-frame in a Web Worker using ONNX Runtime Web (already bundled). Audio chunks from the AudioWorklet are forwarded to the worker, which performs STFT → GTCRN inference → ISTFT and returns denoised audio. RNNoise path is untouched.

**Tech Stack:** ONNX Runtime Web (bundled at `public/wasm/ort/`), Web Workers (ES module), TypeScript, React, Zustand, i18next

---

### Task 1: Download and bundle the GTCRN ONNX model

**Files:**
- Create: `public/models/gtcrn/gtcrn_simple.onnx`

- [ ] **Step 1: Download the model from the upstream repository**

```bash
mkdir -p public/models/gtcrn
curl -L -o public/models/gtcrn/gtcrn_simple.onnx \
  "https://github.com/Xiaobin-Rong/gtcrn/raw/main/stream/onnx_models/gtcrn_simple.onnx"
```

- [ ] **Step 2: Verify the model file exists and is reasonable size**

```bash
ls -la public/models/gtcrn/gtcrn_simple.onnx
# Expected: ~200KB-2MB file (48.2K parameter model)
```

- [ ] **Step 3: Commit**

```bash
git add public/models/gtcrn/gtcrn_simple.onnx
git commit -m "feat(audio): add bundled GTCRN ONNX model for enhanced noise suppression"
```

---

### Task 2: Implement FFT utilities

**Files:**
- Create: `src/lib/modern-audio/gtcrn/fft.ts`

- [ ] **Step 1: Create the FFT module**

Create `src/lib/modern-audio/gtcrn/fft.ts` with a radix-2 FFT/IFFT implementation. The GTCRN model uses `n_fft=512`, so we need FFT of size 512.

```typescript
/**
 * Radix-2 Cooley-Tukey FFT implementation for GTCRN noise suppression.
 * Operates on n_fft=512 (power of 2) complex spectra.
 */

/**
 * Compute in-place radix-2 FFT.
 * @param re - Real parts array (length must be power of 2)
 * @param im - Imaginary parts array (same length as re)
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + halfLen] * curRe - im[i + j + halfLen] * curIm;
        const vIm = re[i + j + halfLen] * curIm + im[i + j + halfLen] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + halfLen] = uRe - vRe;
        im[i + j + halfLen] = uIm - vIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }
}

/**
 * Compute in-place inverse FFT.
 * @param re - Real parts array
 * @param im - Imaginary parts array
 */
export function ifft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Conjugate
  for (let i = 0; i < n; i++) im[i] = -im[i];
  // Forward FFT
  fft(re, im);
  // Conjugate and scale
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/lib/modern-audio/gtcrn/fft.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/gtcrn/fft.ts
git commit -m "feat(audio): add radix-2 FFT/IFFT for GTCRN noise suppression"
```

---

### Task 3: Implement audio DSP utilities

**Files:**
- Create: `src/lib/modern-audio/gtcrn/audio-utils.ts`

- [ ] **Step 1: Create the audio utilities module**

Create `src/lib/modern-audio/gtcrn/audio-utils.ts` with resampling, windowing, and STFT/ISTFT helpers. GTCRN uses: `n_fft=512`, `hop_length=256`, `window=sqrt(hann)`, `sample_rate=16000`.

```typescript
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
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = Math.sqrt(0.5 * (1 - Math.cos(2 * Math.PI * i / length)));
  }
  return window;
}

/**
 * Apply window function to a frame in-place.
 */
export function applyWindow(frame: Float32Array, window: Float32Array): void {
  for (let i = 0; i < frame.length; i++) {
    frame[i] *= window[i];
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
 * Downsample from sourceSampleRate to targetSampleRate using linear interpolation.
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/lib/modern-audio/gtcrn/audio-utils.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/gtcrn/audio-utils.ts
git commit -m "feat(audio): add DSP utilities for GTCRN (resample, STFT, windowing)"
```

---

### Task 4: Implement the GTCRN Worker

**Files:**
- Create: `src/lib/modern-audio/gtcrn/gtcrn-worker.ts`

- [ ] **Step 1: Create the GTCRN worker**

Create `src/lib/modern-audio/gtcrn/gtcrn-worker.ts`. This ES module worker loads the GTCRN ONNX model via ONNX Runtime Web and processes audio frame-by-frame.

GTCRN model I/O:
- **Inputs:** `mix` (1,257,1,2), `conv_cache` (2,1,16,16,33), `tra_cache` (2,3,1,1,16), `inter_cache` (2,1,33,16)
- **Outputs:** `enh` (1,257,1,2), `conv_cache_out`, `tra_cache_out`, `inter_cache_out` (same shapes)

```typescript
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

// Configure ORT WASM paths
ort.env.wasm.wasmPaths = './wasm/ort/';

const INPUT_SAMPLE_RATE = 48000;

let session: ort.InferenceSession | null = null;
let window: Float32Array;

// RNN state tensors (persist across frames)
let convCache: ort.Tensor;
let traCache: ort.Tensor;
let interCache: ort.Tensor;

// Ring buffer for accumulating input samples at 16kHz
let inputBuffer: Float32Array = new Float32Array(0);

// Overlap-add output buffer and tracking
let outputBuffer: Float32Array = new Float32Array(0);
let outputReadPos = 0;
let outputWritePos = 0;

// Previous frame for overlap-add
let prevFrame: Float32Array = new Float32Array(GTCRN_N_FFT);

function initStates(): void {
  convCache = new ort.Tensor('float32', new Float32Array(2 * 1 * 16 * 16 * 33), [2, 1, 16, 16, 33]);
  traCache = new ort.Tensor('float32', new Float32Array(2 * 3 * 1 * 1 * 16), [2, 3, 1, 1, 16]);
  interCache = new ort.Tensor('float32', new Float32Array(2 * 1 * 33 * 16), [2, 1, 33, 16]);
  prevFrame = new Float32Array(GTCRN_N_FFT);
}

async function init(): Promise<void> {
  try {
    session = await ort.InferenceSession.create('./models/gtcrn/gtcrn_simple.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    window = createSqrtHannWindow(GTCRN_N_FFT);
    initStates();

    // Pre-allocate output buffer (1 second at 16kHz)
    outputBuffer = new Float32Array(GTCRN_SAMPLE_RATE);
    outputReadPos = 0;
    outputWritePos = 0;

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
    applyWindow(frame, window);
    const [re, im] = rfft(frame);

    // Run GTCRN inference
    const [enhRe, enhIm] = await processFrame(re, im);

    // ISTFT: inverse FFT
    const timeDomain = irfft(enhRe, enhIm, GTCRN_N_FFT);

    // Apply synthesis window
    applyWindow(timeDomain, window);

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
      await init();
      break;
    case 'process':
      await processAudio(event.data.audio);
      break;
    case 'reset':
      initStates();
      inputBuffer = new Float32Array(0);
      outputBuffer = new Float32Array(GTCRN_SAMPLE_RATE);
      outputReadPos = 0;
      outputWritePos = 0;
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/lib/modern-audio/gtcrn/gtcrn-worker.ts
```

Expected: No errors. If there are import resolution issues with `onnxruntime-web` in a worker context, the implementation may need to adjust the import to use the WASM-only entry point.

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/gtcrn/gtcrn-worker.ts
git commit -m "feat(audio): implement GTCRN worker with ORT inference and streaming STFT"
```

---

### Task 5: Update audioStore with noise suppression mode

**Files:**
- Modify: `src/stores/audioStore.ts`

- [ ] **Step 1: Add the NoiseSuppressionMode type and update the store**

In `src/stores/audioStore.ts`:

1. Add the type at the top of the file (after imports):

```typescript
export type NoiseSuppressionMode = 'off' | 'standard' | 'enhanced';
```

2. In `STORAGE_KEYS`, add:

```typescript
NOISE_SUPPRESSION_MODE: 'audio.noiseSuppressionMode',
```

3. In the `AudioStore` interface, replace `isNoiseSuppressEnabled: boolean` with:

```typescript
noiseSuppressionMode: NoiseSuppressionMode;
```

4. Replace the `toggleNoiseSuppression` action with:

```typescript
setNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
```

5. In the store implementation, replace `isNoiseSuppressEnabled: true` initial state with:

```typescript
noiseSuppressionMode: 'off' as NoiseSuppressionMode,
```

6. Replace the `toggleNoiseSuppression` implementation with:

```typescript
setNoiseSuppressionMode: (mode) => {
  console.info('[Sokuji] [AudioStore] Setting noise suppression mode:', mode);
  set({ noiseSuppressionMode: mode });
  const settingsService = ServiceFactory.getSettingsService();
  settingsService.setSetting(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, mode)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to save noise suppression mode:', error));
},
```

7. In `refreshDevices`, replace the `savedNoiseSuppressEnabled` restoration block. Read the new key first, falling back to migrating the old boolean:

```typescript
// Restore noise suppression mode (with migration from old boolean)
const savedMode = await settingsService.getSetting<string | null>(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, null);
if (savedMode !== null && (savedMode === 'off' || savedMode === 'standard' || savedMode === 'enhanced')) {
  console.info('[Sokuji] [AudioStore] Restored noise suppression mode:', savedMode);
  set({ noiseSuppressionMode: savedMode as NoiseSuppressionMode });
} else {
  // Migrate from old boolean setting
  const oldEnabled = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_NOISE_SUPPRESS_ENABLED, null);
  if (oldEnabled !== null) {
    const migratedMode: NoiseSuppressionMode = oldEnabled ? 'standard' : 'off';
    console.info('[Sokuji] [AudioStore] Migrated noise suppression:', oldEnabled, '→', migratedMode);
    set({ noiseSuppressionMode: migratedMode });
    // Persist migrated value
    settingsService.setSetting(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, migratedMode).catch(() => {});
  }
}
```

8. Update the selector exports. Replace `useIsNoiseSuppressEnabled` and `useToggleNoiseSuppression` with:

```typescript
export const useNoiseSuppressionMode = () => useAudioStore((state) => state.noiseSuppressionMode);
export const useSetNoiseSuppressionMode = () => useAudioStore((state) => state.setNoiseSuppressionMode);
```

Keep the old exports as backward-compatible wrappers:

```typescript
export const useIsNoiseSuppressEnabled = () => useAudioStore((state) => state.noiseSuppressionMode !== 'off');
export const useToggleNoiseSuppression = () => {
  const mode = useAudioStore((state) => state.noiseSuppressionMode);
  const setMode = useAudioStore((state) => state.setNoiseSuppressionMode);
  return () => setMode(mode === 'off' ? 'standard' : 'off');
};
```

9. Update `useAudioActions` and `useAudioContext` to replace `toggleNoiseSuppression` references with `setNoiseSuppressionMode`, and add `noiseSuppressionMode` to `useAudioContext`.

- [ ] **Step 2: Verify the app compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: Build succeeds or only shows unrelated warnings.

- [ ] **Step 3: Commit**

```bash
git add src/stores/audioStore.ts
git commit -m "feat(audio): add noiseSuppressionMode to audioStore with migration from boolean"
```

---

### Task 6: Integrate GTCRN into ModernAudioRecorder

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioRecorder.ts`

- [ ] **Step 1: Add GTCRN worker management properties and imports**

Add new instance properties to the class (in the "Noise suppression" section):

```typescript
// GTCRN worker-based noise suppression
private gtcrnWorker: Worker | null = null;
private gtcrnReady: boolean = false;
private _noiseSuppressionMode: 'off' | 'standard' | 'enhanced' = 'off';
private _originalOnMessage: ((event: MessageEvent) => void) | null = null;
```

- [ ] **Step 2: Add setNoiseSuppressionMode method**

Add a new public method after `setNoiseSuppressionEnabled`:

```typescript
/**
 * Set noise suppression mode: 'off', 'standard' (RNNoise), or 'enhanced' (GTCRN).
 */
async setNoiseSuppressionMode(mode: 'off' | 'standard' | 'enhanced'): Promise<void> {
  const prevMode = this._noiseSuppressionMode;
  this._noiseSuppressionMode = mode;
  // Also keep boolean in sync for backward compat
  this._noiseSuppressEnabled = mode === 'standard';
  const opId = ++this._noiseSuppressOpId;

  if (!this.audioContext || !this.mediaStreamSource || !this.audioWorkletNode) {
    return; // Stored for next session start
  }

  // Tear down previous mode
  if (prevMode === 'standard' && mode !== 'standard') {
    this._removeRnnoiseNode();
  }
  if (prevMode === 'enhanced' && mode !== 'enhanced') {
    this._disconnectGtcrnWorker();
  }

  // Set up new mode
  if (mode === 'standard') {
    await this._insertRnnoiseNode(opId);
  } else if (mode === 'enhanced') {
    await this._connectGtcrnWorker(opId);
  }
}
```

- [ ] **Step 3: Add GTCRN worker lifecycle methods**

Add private methods for GTCRN worker management:

```typescript
/**
 * Initialize and connect GTCRN worker for audio processing.
 */
private async _connectGtcrnWorker(opId?: number): Promise<void> {
  if (!this.audioWorkletNode) return;

  try {
    // Lazy-create worker
    if (!this.gtcrnWorker) {
      this.gtcrnWorker = new Worker(
        new URL('./gtcrn/gtcrn-worker.ts', import.meta.url),
        { type: 'module' }
      );

      // Wait for ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('GTCRN worker init timeout')), 10000);
        this.gtcrnWorker!.onmessage = (event) => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            this.gtcrnReady = true;
            resolve();
          } else if (event.data.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(event.data.message));
          }
        };
        this.gtcrnWorker!.postMessage({ type: 'init' });
      });
    }

    // Abort if stale
    if (opId !== undefined && opId !== this._noiseSuppressOpId) return;

    // Intercept AudioWorklet messages to route through GTCRN
    const originalHandler = this.audioWorkletNode.port.onmessage;
    this._originalOnMessage = originalHandler as ((event: MessageEvent) => void) | null;

    // Set up worker response handler — feeds denoised audio back into the pipeline
    this.gtcrnWorker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'audio') {
        const denoisedPcm: Int16Array = event.data.audio;
        // Continue the normal pipeline: downsample → onAudioData
        const outputPcm = this.downsample48to24(denoisedPcm);
        this._processAudioData(outputPcm);
      } else if (event.data.type === 'error') {
        console.error(`${this.getLogPrefix()} GTCRN worker error:`, event.data.message);
        // Fallback to standard
        this.setNoiseSuppressionMode('standard');
      }
    };

    // Replace AudioWorklet message handler to forward to GTCRN worker
    this.audioWorkletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'audioData' && this.gtcrnReady && this.gtcrnWorker) {
        const { pcmData } = event.data;
        // Send raw 48kHz Int16 to worker; worker handles resample+process+resample
        this.gtcrnWorker.postMessage(
          { type: 'process', audio: pcmData },
          [pcmData.buffer]
        );
      }
    };

    console.info(`${this.getLogPrefix()} GTCRN worker connected`);
  } catch (error) {
    console.error(`${this.getLogPrefix()} Failed to connect GTCRN worker:`, error);
    this.gtcrnReady = false;
    // Fallback to standard (RNNoise)
    this._noiseSuppressionMode = 'standard';
    this._noiseSuppressEnabled = true;
    await this._insertRnnoiseNode();
  }
}

/**
 * Disconnect GTCRN worker from the audio pipeline (keep worker alive).
 */
private _disconnectGtcrnWorker(): void {
  if (!this.audioWorkletNode) return;

  // Restore original AudioWorklet message handler
  if (this._originalOnMessage) {
    this.audioWorkletNode.port.onmessage = this._originalOnMessage;
    this._originalOnMessage = null;
  }

  // Reset worker state for next use
  if (this.gtcrnWorker) {
    this.gtcrnWorker.postMessage({ type: 'reset' });
  }

  console.info(`${this.getLogPrefix()} GTCRN worker disconnected`);
}

/**
 * Fully dispose the GTCRN worker.
 */
private _disposeGtcrnWorker(): void {
  this._disconnectGtcrnWorker();
  if (this.gtcrnWorker) {
    this.gtcrnWorker.postMessage({ type: 'dispose' });
    this.gtcrnWorker.terminate();
    this.gtcrnWorker = null;
    this.gtcrnReady = false;
  }
}
```

- [ ] **Step 4: Update existing methods for mode awareness**

1. In `setupRealtimeAudioProcessingWithWarmup`, replace the check at line ~313:

```typescript
// Insert noise suppression based on current mode
if (this._noiseSuppressionMode === 'standard') {
  await this._insertRnnoiseNode();
} else if (this._noiseSuppressionMode === 'enhanced') {
  await this._connectGtcrnWorker();
}
```

2. Update `setNoiseSuppressionEnabled` to delegate to the new mode method:

```typescript
async setNoiseSuppressionEnabled(enabled: boolean): Promise<void> {
  await this.setNoiseSuppressionMode(enabled ? 'standard' : 'off');
}
```

3. In `end()`, add GTCRN cleanup alongside RNNoise cleanup (after the existing RNNoise cleanup block):

```typescript
// Cleanup GTCRN worker connection (keep worker alive for reuse)
this._disconnectGtcrnWorker();
```

4. In `quit()`, add full GTCRN disposal:

```typescript
async quit(): Promise<boolean> {
  this.listenForDeviceChange(null);
  this._disposeGtcrnWorker();
  if (this.mediaRecorder) {
    await this.end();
  }
  return true;
}
```

5. In `getFrequencies`, update the analyser connection to handle GTCRN mode. When GTCRN is active, there's no AudioNode to tap — connect analyser to `mediaStreamSource` (pre-suppression) as a reasonable fallback:

The existing code at the analyser creation already handles this: it connects to `rnnoiseNode` if present, otherwise `mediaStreamSource`. No change needed since GTCRN doesn't add an AudioNode.

- [ ] **Step 5: Verify the app compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/modern-audio/ModernAudioRecorder.ts
git commit -m "feat(audio): integrate GTCRN worker into ModernAudioRecorder with mode switching"
```

---

### Task 7: Update MainPanel to use noise suppression mode

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Update the noise suppression wiring in MainPanel**

1. Update the import:

```typescript
import { useAudioContext, useNoiseSuppressionMode } from '../../stores/audioStore';
```

(Remove `useIsNoiseSuppressEnabled` from the import.)

2. Replace the `isNoiseSuppressEnabled` usage:

```typescript
const noiseSuppressionMode = useNoiseSuppressionMode();
```

3. Update the `useEffect` that syncs noise suppression to the recorder (around line 414-423):

```typescript
useEffect(() => {
  if (!isSessionActive || !audioServiceRef.current) return;
  void audioServiceRef.current
    .getRecorder()
    .setNoiseSuppressionMode(noiseSuppressionMode)
    .catch((error: unknown) => {
      console.error('[Sokuji] [MainPanel] Failed to set noise suppression mode:', error);
    });
}, [noiseSuppressionMode, isSessionActive]);
```

4. Update the session start sync (around line 1198):

```typescript
await audioServiceRef.current.getRecorder().setNoiseSuppressionMode(noiseSuppressionMode);
```

5. Update analytics tracking. Replace `noise_suppression_enabled: isNoiseSuppressEnabled` with:

```typescript
noise_suppression_enabled: noiseSuppressionMode !== 'off',
```

- [ ] **Step 2: Verify the app compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(audio): wire noise suppression mode from store to recorder in MainPanel"
```

---

### Task 8: Update AudioDeviceSection UI

**Files:**
- Modify: `src/components/Settings/sections/AudioDeviceSection.tsx`

- [ ] **Step 1: Replace ToggleSwitch with segmented control**

1. Update imports:

```typescript
import { useNoiseSuppressionMode, useSetNoiseSuppressionMode, NoiseSuppressionMode } from '../../../stores/audioStore';
```

Remove the old `useIsNoiseSuppressEnabled, useToggleNoiseSuppression` imports.

2. Replace the old hook calls:

```typescript
const noiseSuppressionMode = useNoiseSuppressionMode();
const setNoiseSuppressionMode = useSetNoiseSuppressionMode();
```

3. Replace the `<ToggleSwitch>` for noise suppression (lines ~156-167) with an inline segmented control:

```tsx
{/* Noise Suppression Mode */}
<div className="noise-suppression-control">
  <div className="noise-suppression-header">
    <span className="noise-suppression-label">{t('settings.noiseSuppression')}</span>
    <Tooltip
      content={
        `${t('settings.noiseSuppressionTooltip.off')}\n\n` +
        `${t('settings.noiseSuppressionTooltip.standard')}\n\n` +
        `${t('settings.noiseSuppressionTooltip.enhanced')}`
      }
      position="top"
      icon="help"
      maxWidth={350}
    />
  </div>
  <div className="segmented-control noise-suppression-modes">
    {(['off', 'standard', 'enhanced'] as NoiseSuppressionMode[]).map((mode) => (
      <button
        key={mode}
        className={`segmented-option ${noiseSuppressionMode === mode ? 'active' : ''}`}
        onClick={() => {
          setNoiseSuppressionMode(mode);
          trackEvent('noise_suppression_toggled', {
            enabled: mode !== 'off',
            during_session: isSessionActive
          });
        }}
      >
        {t(`settings.noiseSuppressionMode.${mode}`)}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Add CSS for the segmented control**

Check if there's an existing SCSS file for AudioDeviceSection or SimpleConfigPanel. Add styles for the segmented control. Find the appropriate SCSS file and add:

```scss
.noise-suppression-control {
  margin-top: 8px;

  .noise-suppression-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--text-secondary, #aaa);
  }

  .noise-suppression-label {
    font-size: 13px;
  }

  .segmented-control {
    display: flex;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-color, #333);

    .segmented-option {
      flex: 1;
      padding: 6px 12px;
      font-size: 12px;
      border: none;
      background: var(--bg-secondary, #1a1a1a);
      color: var(--text-secondary, #aaa);
      cursor: pointer;
      transition: all 0.15s ease;

      &:not(:last-child) {
        border-right: 1px solid var(--border-color, #333);
      }

      &:hover:not(.active) {
        background: var(--bg-hover, #252525);
      }

      &.active {
        background: #10a37f;
        color: #fff;
        font-weight: 500;
      }
    }
  }
}
```

- [ ] **Step 3: Verify the app compiles and UI renders**

```bash
npm run build 2>&1 | head -30
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/AudioDeviceSection.tsx
# Also add the SCSS file if modified
git commit -m "feat(audio): replace noise suppression toggle with off/standard/enhanced segmented control"
```

---

### Task 9: Add i18n keys for all locales

**Files:**
- Modify: `src/locales/en/translation.json` and all 30 other locale files

- [ ] **Step 1: Update English locale with new keys**

In `src/locales/en/translation.json`, replace the existing noise suppression keys:

```json
"noiseSuppression": "Noise Suppression",
"noiseSuppressionTooltip": {
  "off": "Off — Browser's built-in noise handling only.",
  "standard": "Standard (RNNoise) — Lightweight AI noise suppression with low latency.",
  "enhanced": "Enhanced (GTCRN) — High-quality AI noise suppression, best for complex noise environments."
},
"noiseSuppressionMode": {
  "off": "Off",
  "standard": "Standard",
  "enhanced": "Enhanced"
},
```

Remove the old `"noiseSuppressionTooltip": "AI-powered noise reduction..."` single-string key.

- [ ] **Step 2: Update Japanese locale**

In `src/locales/ja/translation.json`:

```json
"noiseSuppression": "ノイズ抑制",
"noiseSuppressionTooltip": {
  "off": "オフ — ブラウザ内蔵のノイズ処理のみ使用します。",
  "standard": "スタンダード（RNNoise）— 低遅延の軽量AIノイズ抑制。",
  "enhanced": "エンハンスド（GTCRN）— 複雑なノイズ環境に最適な高品質AIノイズ抑制。"
},
"noiseSuppressionMode": {
  "off": "オフ",
  "standard": "スタンダード",
  "enhanced": "エンハンスド"
},
```

- [ ] **Step 3: Update Simplified Chinese locale**

In `src/locales/zh_CN/translation.json`:

```json
"noiseSuppression": "噪声抑制",
"noiseSuppressionTooltip": {
  "off": "关闭 — 仅使用浏览器内置噪声处理。",
  "standard": "标准（RNNoise）— 轻量级AI噪声抑制，低延迟。",
  "enhanced": "增强（GTCRN）— 高品质AI噪声抑制，适合复杂噪声环境。"
},
"noiseSuppressionMode": {
  "off": "关闭",
  "standard": "标准",
  "enhanced": "增强"
},
```

- [ ] **Step 4: Update all remaining locales**

For each of the remaining 28 locales (`ar`, `bn`, `de`, `es`, `fa`, `fi`, `fil`, `fr`, `he`, `hi`, `id`, `it`, `ko`, `ms`, `nl`, `pl`, `pt_BR`, `pt_PT`, `ru`, `sv`, `ta`, `te`, `th`, `tr`, `uk`, `vi`, `zh_TW`):

Replace the old `"noiseSuppressionTooltip"` single string with the new nested object structure. For mode labels, translate "Off", "Standard", "Enhanced" appropriately. Use the English tooltip descriptions as a base for translation.

The i18next fallback will use English if a translation is missing, so prioritize accuracy over coverage.

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build 2>&1 | head -30
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/locales/
git commit -m "feat(i18n): add noise suppression mode labels and tooltips for all locales"
```

---

### Task 10: Update analytics tracking

**Files:**
- Modify: `src/lib/analytics.ts`

- [ ] **Step 1: Update the analytics event type**

In `src/lib/analytics.ts`, update the `noise_suppression_toggled` event type:

```typescript
'noise_suppression_toggled': {
  enabled: boolean;
  mode?: 'off' | 'standard' | 'enhanced';
  during_session: boolean;
};
```

Also update `translation_session_start` to add the mode:

```typescript
'translation_session_start': {
  // ... existing fields ...
  noise_suppression_enabled?: boolean;
  noise_suppression_mode?: string;
  // ... rest of fields ...
};
```

- [ ] **Step 2: Update MainPanel analytics to include mode**

In `src/components/MainPanel/MainPanel.tsx`, update the `translation_session_start` tracking to include:

```typescript
noise_suppression_mode: noiseSuppressionMode,
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(analytics): track noise suppression mode in events"
```

---

### Task 11: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test the UI**

1. Open the app in Chrome/Edge
2. Navigate to microphone settings
3. Verify the segmented control shows: `[Off] [Standard] [Enhanced]`
4. Click each option — verify it highlights correctly
5. Hover over the tooltip — verify it shows descriptions for all three modes
6. Reload the page — verify the selected mode persists

- [ ] **Step 3: Test noise suppression modes during recording**

1. Start a translation session with any provider
2. Switch between Off, Standard, and Enhanced during the session
3. Verify:
   - **Off**: Audio passes through without processing
   - **Standard**: RNNoise reduces background noise (existing behavior)
   - **Enhanced**: GTCRN worker processes audio (check console for "GTCRN worker connected" log)
4. Verify no audio dropouts when switching modes

- [ ] **Step 4: Test error fallback**

1. Open DevTools → Console
2. Select "Enhanced" mode
3. If GTCRN fails to load (e.g., model not found), verify it falls back to "Standard" automatically
4. Check console for fallback log messages

- [ ] **Step 5: Run existing tests**

```bash
npm run test
```

Expected: All existing tests pass — no regressions.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(audio): address integration test findings for GTCRN noise suppression"
```
