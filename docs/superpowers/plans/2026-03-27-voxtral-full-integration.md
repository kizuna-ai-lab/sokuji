# Voxtral Mini 4B Full Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Voxtral Mini 4B Realtime as a production streaming ASR engine in the LocalInference provider, with hybrid VAD+punctuation endpoint detection.

**Architecture:** A new module Web Worker (`voxtral-webgpu.worker.ts`) runs the full Voxtral model via WebGPU with VAD from `@ricky0123/vad-web`. The worker emits `StreamingAsrWorkerOutMessage` types, consumed by `StreamingAsrEngine` which routes to it via a new `asrWorkerType: 'voxtral-webgpu'`. A manifest entry with `requiredDevice: 'webgpu'` and shader-f16 variant gating handles hardware detection. Punctuation-based sentence splitting is controlled by a constant in the worker (default: enabled).

**Tech Stack:** React 18, TypeScript, `@huggingface/transformers` 4.0.0-next.7, WebGPU, `@ricky0123/vad-web`, `onnxruntime-web`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/local-inference/types.ts` | Modify | Add `VoxtralAsrInitMessage` type |
| `src/lib/local-inference/modelManifest.ts` | Modify | Add Voxtral manifest entry, extend type unions |
| `src/lib/local-inference/workers/voxtral-webgpu.worker.ts` | Create | Module worker: VAD + Voxtral streaming inference + hybrid endpoint detection (punctuation toggle as constant) |
| `src/lib/local-inference/engine/StreamingAsrEngine.ts` | Modify | Add `voxtral-webgpu` worker routing, update header |
| `src/lib/local-inference/engine/AsrEngine.ts` | Modify | Update header comment only |
| `src/App.tsx` | Modify | Remove prototype shortcut |
| `src/lib/local-inference/VoxtralAsrProto.tsx` | Delete | Prototype no longer needed |

---

### Task 1: Add Type Definitions

**Files:**
- Modify: `src/lib/local-inference/types.ts`
- Modify: `src/lib/local-inference/modelManifest.ts`

- [ ] **Step 1: Add `VoxtralAsrInitMessage` to types.ts**

In `src/lib/local-inference/types.ts`, add after the `StreamingAsrInitMessage` interface (after line 126), before the `// ─── Streaming ASR Worker Messages (Worker → Main)` comment:

```typescript
export interface VoxtralAsrInitMessage {
  type: 'init';
  /** HuggingFace model ID for Transformers.js from_pretrained */
  hfModelId: string;
  /** Source language hint (optional, for future use) */
  language?: string;
  /** ONNX dtype config — 'q4f16' or 'q4', or per-component mapping */
  dtype: string | Record<string, string>;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl: string;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
}
```

Also update the `AsrWorkerInMessage` union (line 68) to include the new type:

```typescript
export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | AsrAudioMessage | AsrDisposeMessage;
```

- [ ] **Step 2: Extend type unions in modelManifest.ts**

In `src/lib/local-inference/modelManifest.ts`, add `'voxtral'` to `StreamAsrEngineType`:

```typescript
export type StreamAsrEngineType =
  | 'stream-transducer' | 'stream-nemo-ctc' | 'voxtral';
```

Add `'voxtral-webgpu'` to the `asrWorkerType` field in `ModelManifestEntry`:

```typescript
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu' | 'voxtral-webgpu';
```

- [ ] **Step 3: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/modelManifest.ts
git commit -m "feat: add VoxtralAsrInitMessage type and extend engine type unions

Adds worker init message interface for Voxtral WebGPU ASR.
Extends StreamAsrEngineType with 'voxtral' and asrWorkerType
with 'voxtral-webgpu'.

Refs #125"
```

---

### Task 2: Add Model Manifest Entry

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts`

- [ ] **Step 1: Add Voxtral manifest entry**

In `src/lib/local-inference/modelManifest.ts`, add the Voxtral entry to the `MODEL_MANIFEST` array, after the existing `asr-stream` entries (after the last streaming ASR model):

```typescript
  // ── Voxtral WebGPU Streaming ASR ────────────────────────────────────────────
  {
    id: 'voxtral-mini-4b-webgpu',
    type: 'asr-stream',
    name: 'Voxtral Mini 4B Realtime (WebGPU)',
    languages: ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'nl', 'pt', 'zh', 'ja', 'ko', 'ru'],
    multilingual: true,
    hfModelId: 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
    requiredDevice: 'webgpu',
    asrEngine: 'voxtral',
    asrWorkerType: 'voxtral-webgpu',
    variants: {
      'q4f16': {
        dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
        files: [],
        requiredFeatures: ['shader-f16'],
      },
      'q4': {
        dtype: { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' },
        files: [],
      },
    },
  },
```

- [ ] **Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat: add Voxtral Mini 4B manifest entry

Multilingual streaming ASR model with 13 languages via WebGPU.
Includes q4f16 (shader-f16 required) and q4 (fallback) variants.
HF Hub managed via from_pretrained caching.

Refs #125"
```

---

### Task 3: Create Voxtral WebGPU Worker

**Files:**
- Create: `src/lib/local-inference/workers/voxtral-webgpu.worker.ts`

This is the core worker. It follows the same structure as `whisper-webgpu.worker.ts` but replaces the batch Whisper inference with Voxtral's streaming generate pattern and adds punctuation endpoint detection.

- [ ] **Step 1: Create the worker file**

Create `src/lib/local-inference/workers/voxtral-webgpu.worker.ts` with the following content:

```typescript
/**
 * Voxtral WebGPU Streaming ASR Worker
 *
 * Streaming audio input (Int16@24kHz) → Silero VAD v5 → Voxtral Mini 4B (WebGPU)
 * Model loaded via HuggingFace Hub (from_pretrained with browser Cache API).
 *
 * Unlike Whisper (batch: VAD → complete utterance → decode), Voxtral runs
 * continuous streaming inference with an async inputFeaturesGenerator.
 * Hybrid endpoint detection: VAD for speech boundaries + optional punctuation
 * splitting for lower translation latency.
 *
 * Input messages:  VoxtralAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' }
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, speech_start, partial, result, error, disposed)
 */

import {
  BaseStreamer,
  VoxtralRealtimeForConditionalGeneration,
  VoxtralRealtimeProcessor,
  env,
  type ProgressInfo,
} from '@huggingface/transformers';
import { InferenceSession, Tensor, env as ortEnv } from 'onnxruntime-web';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

import type {
  VoxtralAsrInitMessage,
  AsrAudioMessage,
  AsrDisposeMessage,
  StreamingAsrWorkerOutMessage,
} from '../types';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// Workaround: HF CDN Range request cache pollution
const _origFetch = env.fetch;
env.fetch = (input: any, init?: any) => {
  const headers = init?.headers;
  const hasRange =
    headers instanceof Headers
      ? headers.has('Range')
      : Array.isArray(headers)
        ? headers.some(([k]: [string]) => k.toLowerCase() === 'range')
        : headers && typeof headers === 'object' && 'Range' in headers;
  if (hasRange) {
    return _origFetch(input, { ...init, cache: 'no-store' });
  }
  return _origFetch(input, init);
};

// ─── Types & Helpers ─────────────────────────────────────────────────────────

type WorkerMessage = VoxtralAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' };

function post(msg: StreamingAsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Silero VAD v5 ──────────────────────────────────────────────────────────

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

interface VadSession {
  session: InferenceSession;
  state: Tensor;
}

let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;
let maxSpeechFrames = 625; // ~20s at 32ms/frame
let speechFramesSinceStart = 0;

async function vadInfer(frame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
  if (!vadSession) return { isSpeech: 0, notSpeech: 1 };
  const input = new Tensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  const result = await vadSession.session.run({ input, sr, state: vadSession.state });
  vadSession.state = result.stateN as Tensor;
  const prob = (result.output as Tensor).data[0] as number;
  return { isSpeech: prob, notSpeech: 1 - prob };
}

function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(vadModelUrl: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl, {
    executionProviders: ['wasm'],
  });
  vadSession = {
    session,
    state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
  };
  frameProcessor = new FrameProcessor(
    vadInfer,
    vadResetStates,
    {
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      redemptionMs: 1400,
      minSpeechMs: 400,
      preSpeechPadMs: 800,
      submitUserSpeechOnPause: false,
    },
    VAD_FRAME_MS,
  );
  frameProcessor.resume();
  speechFramesSinceStart = 0;
}

// ─── Audio Buffer & Resampling ──────────────────────────────────────────────

let vadAudioBuffer = new Float32Array(0);

function resampleInt16ToFloat32_16k(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / VAD_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = samples[lo] / 32768 + ((samples[hi] / 32768) - (samples[lo] / 32768)) * frac;
  }
  return out;
}

// ─── Voxtral Model State ────────────────────────────────────────────────────

let voxtralModel: any = null;
let voxtralProcessor: any = null;
/**
 * Toggle punctuation-based sentence splitting.
 * When enabled, sentences ending with . 。 ! ? ！ ？ trigger immediate
 * result finalization (and translation) without waiting for VAD silence.
 * Set to false to use VAD-only endpoint detection.
 */
const PUNCTUATION_ENDPOINT_ENABLED = true;

let isGenerating = false;
let stopRequested = false;

// Voxtral audio buffer (Float32 @ 16kHz, accumulating for generate)
let voxtralAudioBuffer = new Float32Array(0);

const SENTENCE_END_PATTERN = /[.。!?！？]\s*$/;

function appendVoxtralAudio(samples: Float32Array) {
  if (samples.length === 0) return;
  const merged = new Float32Array(voxtralAudioBuffer.length + samples.length);
  merged.set(voxtralAudioBuffer);
  merged.set(samples, voxtralAudioBuffer.length);
  voxtralAudioBuffer = merged;
}

function waitUntil(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (condition()) return resolve();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

// ─── Voxtral Streaming Inference ────────────────────────────────────────────

async function runVoxtralGenerate(): Promise<void> {
  if (!voxtralModel || !voxtralProcessor || isGenerating) return;
  isGenerating = true;
  stopRequested = false;

  const startTime = performance.now();
  const audio = () => voxtralAudioBuffer;

  try {
    const numSamplesFirst = voxtralProcessor.num_samples_first_audio_chunk;

    await waitUntil(() => audio().length >= numSamplesFirst || stopRequested);
    if (stopRequested) { isGenerating = false; return; }

    const firstChunkInputs = await voxtralProcessor(
      audio().subarray(0, numSamplesFirst),
      { is_streaming: true, is_first_audio_chunk: true },
    );

    const featureExtractor = voxtralProcessor.feature_extractor;
    const { hop_length, n_fft } = featureExtractor.config;
    const winHalf = Math.floor(n_fft / 2);
    const samplesPerTok = voxtralProcessor.audio_length_per_tok * hop_length;

    async function* inputFeaturesGenerator() {
      yield firstChunkInputs.input_features;

      let melFrameIdx = voxtralProcessor.num_mel_frames_first_audio_chunk;
      let startIdx = melFrameIdx * hop_length - winHalf;

      while (!stopRequested) {
        const endNeeded = startIdx + voxtralProcessor.num_samples_per_audio_chunk;

        await waitUntil(() => audio().length >= endNeeded || stopRequested);
        if (stopRequested) break;

        const availableSamples = audio().length;
        let batchEndSample = endNeeded;
        while (batchEndSample + samplesPerTok <= availableSamples) {
          batchEndSample += samplesPerTok;
        }

        const chunkInputs = await voxtralProcessor(
          audio().slice(startIdx, batchEndSample),
          { is_streaming: true, is_first_audio_chunk: false },
        );

        yield chunkInputs.input_features;

        melFrameIdx += chunkInputs.input_features.dims[2];
        startIdx = melFrameIdx * hop_length - winHalf;
      }
    }

    const tokenizer = voxtralProcessor.tokenizer;
    const specialIds = new Set(tokenizer.all_special_ids.map(BigInt));
    let tokenCache: bigint[] = [];
    let printLen = 0;
    let isPrompt = true;
    let accumulatedText = '';
    let segmentStartTime = startTime;

    const emitResult = (text: string) => {
      const now = performance.now();
      post({
        type: 'result',
        text,
        durationMs: Math.round(now - segmentStartTime),
        recognitionTimeMs: Math.round(now - startTime),
      });
      segmentStartTime = now;
    };

    const flushDecodedText = () => {
      if (tokenCache.length === 0) return;
      const text = tokenizer.decode(tokenCache, { skip_special_tokens: true });
      const newText = text.slice(printLen);
      if (newText.length === 0) return;

      // Hold back partial multi-byte characters (U+FFFD)
      const replacementIdx = newText.indexOf('\uFFFD');
      const safeToPrint = replacementIdx === -1 ? newText : newText.slice(0, replacementIdx);

      if (safeToPrint.length > 0) {
        printLen += safeToPrint.length;
        accumulatedText += safeToPrint;
        post({ type: 'partial', text: accumulatedText });

        // Punctuation endpoint detection
        if (PUNCTUATION_ENDPOINT_ENABLED && SENTENCE_END_PATTERN.test(accumulatedText)) {
          emitResult(accumulatedText.trim());
          accumulatedText = '';
        }
      }
    };

    const streamer = new (class extends BaseStreamer {
      put(value: bigint[][]) {
        if (stopRequested) return;
        if (isPrompt) { isPrompt = false; return; }
        const tokens = value[0];
        if (tokens.length === 1 && specialIds.has(tokens[0])) return;
        tokenCache = tokenCache.concat(tokens);
        flushDecodedText();
      }
      end() {
        if (stopRequested) {
          tokenCache = [];
          printLen = 0;
          isPrompt = true;
          return;
        }
        flushDecodedText();
        tokenCache = [];
        printLen = 0;
        isPrompt = true;
      }
    })();

    await (voxtralModel as any).generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: inputFeaturesGenerator(),
      max_new_tokens: 4096,
      streamer: streamer as any,
    });

    // Emit any remaining accumulated text as final result
    if (accumulatedText.trim()) {
      emitResult(accumulatedText.trim());
    }
  } catch (err: any) {
    if (!stopRequested) {
      post({ type: 'error', error: `Voxtral inference failed: ${err.message || err}` });
    }
  } finally {
    isGenerating = false;
  }
}

function stopGenerate() {
  stopRequested = true;
}

// ─── VAD + Voxtral Audio Feed Pipeline ──────────────────────────────────────

let processingVad = false;

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || !voxtralModel || processingVad) return;
  processingVad = true;

  try {
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);

    // Feed resampled audio to Voxtral buffer (always, for generate to consume)
    appendVoxtralAudio(resampled);

    // Feed to VAD
    const newBuf = new Float32Array(vadAudioBuffer.length + resampled.length);
    newBuf.set(vadAudioBuffer);
    newBuf.set(resampled, vadAudioBuffer.length);
    vadAudioBuffer = newBuf;

    while (vadAudioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = vadAudioBuffer.slice(0, VAD_FRAME_SAMPLES);
      vadAudioBuffer = vadAudioBuffer.slice(VAD_FRAME_SAMPLES);

      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));

      for (const ev of events) {
        switch (ev.msg) {
          case Message.SpeechStart:
            speechFramesSinceStart = 0;
            voxtralAudioBuffer = new Float32Array(0);
            post({ type: 'speech_start' });
            // Start Voxtral generate loop (non-blocking)
            runVoxtralGenerate();
            break;

          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            stopGenerate();
            break;

          case Message.VADMisfire:
            speechFramesSinceStart = 0;
            stopGenerate();
            break;
        }
      }

      // Max speech duration cap
      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) {
              stopGenerate();
            }
          }
          speechFramesSinceStart = 0;
        }
      } else {
        speechFramesSinceStart = 0;
      }
    }
  } finally {
    processingVad = false;
  }
}

// ─── Init Handler ───────────────────────────────────────────────────────────

async function handleInit(msg: VoxtralAsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // Set ORT WASM paths
    if (msg.ortWasmBaseUrl) {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
      if (ortEnv?.wasm) {
        ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
    }

    // 1. Init VAD
    post({ type: 'status', message: 'Loading VAD model...' });
    await initVad(msg.vadModelUrl);

    // 2. Load Voxtral model
    post({ type: 'status', message: 'Loading Voxtral model (WebGPU)...' });

    const dtype = typeof msg.dtype === 'string'
      ? { audio_encoder: msg.dtype, embed_tokens: msg.dtype, decoder_model_merged: msg.dtype }
      : msg.dtype;

    voxtralModel = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      msg.hfModelId,
      {
        dtype,
        device: 'webgpu',
        progress_callback: (info: ProgressInfo) => {
          if (info.status === 'progress' && info.file.endsWith('.onnx_data') && info.total > 0) {
            const pct = Math.round((info.loaded / info.total) * 100);
            post({ type: 'status', message: `Downloading model... ${pct}%` });
          }
        },
      },
    );

    // 3. Load processor
    post({ type: 'status', message: 'Loading processor...' });
    voxtralProcessor = await VoxtralRealtimeProcessor.from_pretrained(msg.hfModelId);

    // Reset buffers
    vadAudioBuffer = new Float32Array(0);
    voxtralAudioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err.message || String(err) });
  }
}

// ─── Flush & Dispose ────────────────────────────────────────────────────────

function handleFlush(): void {
  // Force-finalize: stop generate loop, which will emit remaining text
  stopGenerate();
}

async function handleDispose(): Promise<void> {
  stopGenerate();

  // Wait briefly for generate to stop
  await new Promise((r) => setTimeout(r, 100));

  // Dispose FrameProcessor
  frameProcessor = null;
  speechFramesSinceStart = 0;

  // Dispose VAD
  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  // Dispose Voxtral
  if (voxtralModel) {
    await (voxtralModel as any).dispose?.();
    voxtralModel = null;
  }
  voxtralProcessor = null;

  vadAudioBuffer = new Float32Array(0);
  voxtralAudioBuffer = new Float32Array(0);
  processingVad = false;
  isGenerating = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as VoxtralAsrInitMessage);
      break;
    case 'audio':
      await feedAudio((msg as AsrAudioMessage).samples, (msg as AsrAudioMessage).sampleRate);
      break;
    case 'flush':
      handleFlush();
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
```

- [ ] **Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/voxtral-webgpu.worker.ts
git commit -m "feat: add Voxtral WebGPU streaming ASR worker

Module worker with VAD (Silero v5) + Voxtral Mini 4B inference.
Hybrid endpoint detection: VAD for speech boundaries, optional
punctuation-based sentence splitting for lower translation latency.
Handles partial multi-byte character decoding (U+FFFD holdback).

Refs #125"
```

---

### Task 4: Modify StreamingAsrEngine for Voxtral Routing

**Files:**
- Modify: `src/lib/local-inference/engine/StreamingAsrEngine.ts`
- Modify: `src/lib/local-inference/engine/AsrEngine.ts`

- [ ] **Step 1: Update StreamingAsrEngine header comment**

Replace lines 1-12 of `src/lib/local-inference/engine/StreamingAsrEngine.ts`:

```typescript
/**
 * StreamingAsrEngine — Main thread wrapper for streaming ASR Web Workers.
 * Provides a simple API for feeding audio and receiving real-time transcription.
 *
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): OnlineRecognizer with built-in endpoint detection
 * - voxtral-webgpu (module Worker): Voxtral Mini 4B with VAD + punctuation endpoints
 *
 * Unlike AsrEngine (offline VAD + batch recognition), streaming engines emit
 * partial (interim) results as speech is being recognized and final results
 * when an endpoint is detected.
 */
```

- [ ] **Step 2: Add modelStore import**

After the existing imports in `StreamingAsrEngine.ts`, add:

```typescript
import { useModelStore } from '../../../stores/modelStore';
```

- [ ] **Step 3: Extend `init()` signature and add worker routing**

Replace the `init` method (lines 52-158) in `StreamingAsrEngine.ts` with:

```typescript
  async init(modelId: string, options?: { language?: string }): Promise<{ loadTimeMs: number }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'asr-stream') {
      const available = getManifestByType('asr-stream').map(m => m.id).join(', ');
      throw new Error(`Unknown streaming ASR model: ${modelId}. Available: ${available}`);
    }

    // If already loaded with same model, skip
    if (this.isReady && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    const manager = ModelManager.getInstance();
    const workerType = model.asrWorkerType || 'sherpa-onnx';

    return new Promise(async (resolve, reject) => {
      try {
        // Create worker based on type
        switch (workerType) {
          case 'voxtral-webgpu':
            this.worker = new Worker(
              new URL('../workers/voxtral-webgpu.worker.ts', import.meta.url),
              { type: 'module' },
            );
            break;
          default: // sherpa-onnx streaming
            this.worker = new Worker('./workers/sherpa-onnx-streaming-asr.worker.js');
            break;
        }

        this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
          const msg = event.data;
          switch (msg.type) {
            case 'ready':
              this.isReady = true;
              this.currentModel = model;
              resolve({ loadTimeMs: msg.loadTimeMs });
              break;

            case 'status':
              this.onStatus?.(msg.message);
              break;

            case 'speech_start':
              this.onSpeechStart?.();
              break;

            case 'partial':
              this.onPartialResult?.(msg.text);
              break;

            case 'result':
              this.onResult?.({
                text: msg.text,
                durationMs: msg.durationMs,
                recognitionTimeMs: msg.recognitionTimeMs,
              });
              break;

            case 'error':
              this.onError?.(msg.error);
              if (!this.isReady) {
                reject(new Error(msg.error));
              }
              break;

            case 'disposed':
              break;
          }
        };

        this.worker.onerror = (error) => {
          const message = error.message || 'Streaming ASR Worker error';
          this.onError?.(message);
          if (!this.isReady) {
            reject(new Error(message));
          }
        };

        // Send init message based on worker type
        if (workerType === 'voxtral-webgpu') {
          const { deviceFeatures } = useModelStore.getState();
          const hasF16 = deviceFeatures?.includes('shader-f16') ?? false;
          const dtype = hasF16
            ? (model.variants['q4f16']?.dtype || 'q4f16')
            : (model.variants['q4']?.dtype || 'q4');

          this.worker.postMessage({
            type: 'init',
            hfModelId: model.hfModelId,
            language: options?.language,
            dtype,
            vadModelUrl: new URL('/vad/silero_vad_v5.onnx', window.location.href).href,
            ortWasmBaseUrl: new URL('/wasm/ort/', window.location.href).href,
          });
        } else {
          // sherpa-onnx streaming path (unchanged logic)
          if (!await manager.isModelReady(modelId)) {
            throw new Error(`Streaming ASR model "${modelId}" is not downloaded.`);
          }
          const fileUrls = await manager.getModelBlobUrls(modelId);

          const metadataBlobUrl = fileUrls['package-metadata.json'];
          if (!metadataBlobUrl) {
            throw new Error(`Missing package-metadata.json for streaming ASR model "${modelId}"`);
          }
          const metadataResponse = await fetch(metadataBlobUrl);
          const dataPackageMetadata = await metadataResponse.json();

          const dataFileUrls: Record<string, string> = {};
          for (const [name, url] of Object.entries(fileUrls)) {
            if (name !== 'package-metadata.json') {
              dataFileUrls[name] = url;
            }
          }

          // Store fileUrls reference for cleanup on ready/error
          const cleanup = () => manager.revokeBlobUrls(fileUrls);
          const origOnMessage = this.worker.onmessage;
          this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
            const msg = event.data;
            if (msg.type === 'ready' || (msg.type === 'error' && !this.isReady)) {
              cleanup();
            }
            origOnMessage?.call(this.worker, event);
          };

          this.worker.postMessage({
            type: 'init',
            fileUrls: dataFileUrls,
            asrEngine: model.asrEngine,
            runtimeBaseUrl: new URL(ASR_STREAM_BUNDLED_RUNTIME_PATH, window.location.href).href,
            dataPackageMetadata,
          });
        }
      } catch (err) {
        reject(err);
      }
    });
  }
```

- [ ] **Step 4: Update AsrEngine.ts header comment**

Replace lines 1-7 of `src/lib/local-inference/engine/AsrEngine.ts`:

```typescript
/**
 * AsrEngine — Main thread wrapper for offline ASR Web Workers.
 * Provides a simple API for feeding audio and receiving transcription results.
 *
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): VAD + OfflineRecognizer via Emscripten/WASM
 * - whisper-webgpu (module Worker): VAD + Whisper via Transformers.js/WebGPU
 */
```

- [ ] **Step 5: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/engine/StreamingAsrEngine.ts src/lib/local-inference/engine/AsrEngine.ts
git commit -m "feat: add voxtral-webgpu routing to StreamingAsrEngine

Extends init() with options parameter for language and
Routes voxtral-webgpu to module worker,
auto-selects dtype based on shader-f16 device feature.
Updates header comments for both engine files.

Refs #125"
```

---

### Task 5: Cleanup Prototype Files

**Files:**
- Delete: `src/lib/local-inference/VoxtralAsrProto.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Delete the prototype component**

```bash
rm src/lib/local-inference/VoxtralAsrProto.tsx
```

- [ ] **Step 2: Restore App.tsx to pre-prototype state**

Replace `src/App.tsx` with:

```tsx
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';

// Create the memory router for Chrome extension
// Memory router is recommended for Chrome extensions as they don't have a URL bar
const router = createMemoryRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: 'sign-in/*',
        element: <SignIn />,
      },
      {
        path: 'sign-up/*',
        element: <SignUp />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPassword />,
      },
    ],
  },
]);

function App() {
  return (
    <div className="App">
      <RouterProvider router={router} />
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git rm src/lib/local-inference/VoxtralAsrProto.tsx
git add src/App.tsx
git commit -m "chore: remove Voxtral ASR prototype

Prototype validated feasibility; replaced by production integration.

Refs #125"
```

---

### Task 6: Integration Smoke Test

Manual validation of the full integration.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Voxtral appears in model selector**

Open Chrome with WebGPU at localhost:5173. Go to Settings → Local Inference → Model Management. Verify "Voxtral Mini 4B Realtime (WebGPU)" appears in the ASR model list.

Expected: Model is listed and downloadable.

- [ ] **Step 3: Download and select model**

Download the Voxtral model. After download, select it as the ASR model. Set source language to one of the 13 supported languages.

Expected: Model downloads with progress, becomes selectable.

- [ ] **Step 4: Test streaming transcription**

Start a session. Speak into the microphone.

Expected: Partial transcription appears in real-time. When sentence-ending punctuation is detected, translation triggers without waiting for silence. When you stop speaking, remaining text is finalized.

- [ ] **Step 5: Verify model hidden without WebGPU**

Open in a browser without WebGPU (e.g. Firefox).

Expected: Voxtral does not appear in the ASR model list.
