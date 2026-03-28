# Cohere Transcribe WebGPU ASR Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cohere Transcribe as a WebGPU-based local ASR engine registered as `asr-stream`, using transformers.js `pipeline()` API with VAD-chunked input and TextStreamer token-level streaming output.

**Architecture:** New worker (`cohere-transcribe-webgpu.worker.ts`) follows the Whisper WebGPU pattern for VAD-chunked batch inference but outputs `StreamingAsrWorkerOutMessage` (partial + result) like the Voxtral worker. The `pipeline()` API with `TextStreamer` provides token-level streaming during batch inference of each speech segment. Registration in the model manifest + a 3-line switch case in `StreamingAsrEngine.ts` wires everything up.

**Tech Stack:** `@huggingface/transformers` (pipeline API, TextStreamer), `onnxruntime-web` (Silero VAD), `@ricky0123/vad-web` (FrameProcessor)

---

### Task 1: Add type definitions

**Files:**
- Modify: `src/lib/local-inference/types.ts:68` (AsrWorkerInMessage union)
- Modify: `src/lib/local-inference/types.ts:128-142` (near VoxtralAsrInitMessage)
- Modify: `src/lib/local-inference/modelManifest.ts:37-38` (StreamAsrEngineType)
- Modify: `src/lib/local-inference/modelManifest.ts:86` (asrWorkerType union)

- [ ] **Step 1: Add `CohereTranscribeAsrInitMessage` to `types.ts`**

Add after the `VoxtralAsrInitMessage` interface (after line 142):

```typescript
export interface CohereTranscribeAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js pipeline identification */
  hfModelId: string;
  /** Source language code (e.g. 'ja', 'en') — required, no auto-detect */
  language?: string;
  /** ONNX dtype config — 'q4f16' or 'q4', or per-component mapping */
  dtype: string | Record<string, string>;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl: string;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
}
```

- [ ] **Step 2: Add `CohereTranscribeAsrInitMessage` to `AsrWorkerInMessage` union**

In `types.ts`, update the `AsrWorkerInMessage` union (line 68) to include the new type:

```typescript
export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | CohereTranscribeAsrInitMessage | AsrAudioMessage | AsrDisposeMessage;
```

- [ ] **Step 3: Add `'cohere-transcribe'` to `StreamAsrEngineType` in `modelManifest.ts`**

Update line 37-38:

```typescript
export type StreamAsrEngineType =
  | 'stream-transducer' | 'stream-nemo-ctc' | 'voxtral' | 'cohere-transcribe';
```

- [ ] **Step 4: Add `'cohere-transcribe-webgpu'` to `asrWorkerType` union in `modelManifest.ts`**

Update line 86:

```typescript
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu' | 'voxtral-webgpu' | 'cohere-transcribe-webgpu';
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to the new types.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/modelManifest.ts
git commit -m "feat: add CohereTranscribeAsrInitMessage type and engine/worker type unions"
```

---

### Task 2: Add model manifest entry

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts:811` (after Voxtral entry, before Whisper entries)

- [ ] **Step 1: Add Cohere Transcribe manifest entry**

Insert after the Voxtral entry (after line 811, before the Whisper WebGPU comment):

```typescript
  // ── Cohere Transcribe WebGPU ASR ───────────────────────────────────────────
  // Downloaded from onnx-community repo on HuggingFace Hub. Uses hfModelId.
  // Cohere Transcribe (2B Conformer) via @huggingface/transformers pipeline API.
  // Batch ASR with VAD chunking + TextStreamer for token-level partial results.
  {
    id: 'cohere-transcribe-webgpu',
    type: 'asr-stream',
    name: 'Cohere Transcribe (WebGPU)',
    languages: ['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko'],
    hfModelId: 'onnx-community/cohere-transcribe-03-2026-ONNX',
    requiredDevice: 'webgpu',
    asrEngine: 'cohere-transcribe',
    asrWorkerType: 'cohere-transcribe-webgpu',
    variants: {
      'q4f16': {
        dtype: 'q4f16',
        files: [
          // Config & tokenizer (shared across variants)
          { filename: 'config.json', sizeBytes: 5_100 },
          { filename: 'generation_config.json', sizeBytes: 233 },
          { filename: 'preprocessor_config.json', sizeBytes: 565 },
          { filename: 'processor_config.json', sizeBytes: 634 },
          { filename: 'tokenizer.json', sizeBytes: 1_150_000 },
          { filename: 'tokenizer_config.json', sizeBytes: 4_550 },
          // ONNX model files (q4f16)
          { filename: 'onnx/encoder_model_q4f16.onnx', sizeBytes: 1_410_000 },
          { filename: 'onnx/encoder_model_q4f16.onnx_data', sizeBytes: 1_440_000_000 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx', sizeBytes: 195_000 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx_data', sizeBytes: 98_000_000 },
        ],
        requiredFeatures: ['shader-f16'],
      },
      'q4': {
        dtype: 'q4',
        files: [
          // Config & tokenizer (shared across variants)
          { filename: 'config.json', sizeBytes: 5_100 },
          { filename: 'generation_config.json', sizeBytes: 233 },
          { filename: 'preprocessor_config.json', sizeBytes: 565 },
          { filename: 'processor_config.json', sizeBytes: 634 },
          { filename: 'tokenizer.json', sizeBytes: 1_150_000 },
          { filename: 'tokenizer_config.json', sizeBytes: 4_550 },
          // ONNX model files (q4)
          { filename: 'onnx/encoder_model_q4.onnx', sizeBytes: 1_400_000 },
          { filename: 'onnx/encoder_model_q4.onnx_data', sizeBytes: 2_020_000_000 },
          { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: 193_000 },
          { filename: 'onnx/decoder_model_merged_q4.onnx_data', sizeBytes: 109_000_000 },
        ],
      },
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat: add Cohere Transcribe WebGPU model manifest entry"
```

---

### Task 3: Create the worker

**Files:**
- Create: `src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts`

This is the main implementation task. The worker follows the Whisper WebGPU pattern (VAD-chunked batch inference) but outputs streaming messages (partial + result) using TextStreamer.

- [ ] **Step 1: Create the worker file**

Create `src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts`:

```typescript
/**
 * Cohere Transcribe WebGPU ASR Worker
 *
 * Streaming audio input (Int16@24kHz) → Silero VAD v5 → Cohere Transcribe (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Unlike Voxtral (continuous streaming inference), Cohere Transcribe runs batch
 * inference on complete speech segments from VAD. Token-level streaming is provided
 * by TextStreamer during each batch inference.
 *
 * Input messages:  CohereTranscribeAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' }
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, speech_start, partial, result, error, disposed)
 */

import {
  pipeline,
  TextStreamer,
  env,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { InferenceSession, Tensor, env as ortEnv } from 'onnxruntime-web';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

import type {
  CohereTranscribeAsrInitMessage,
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

type WorkerMessage = CohereTranscribeAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' };

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

// ─── Cohere Transcribe ASR ──────────────────────────────────────────────────

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentLanguage: string | undefined;
let processingVad = false;
let isTranscribing = false;

/**
 * Create customCache bridge for IndexedDB blob URLs → Transformers.js.
 * Maps HF Hub resolve URLs to local blob URLs from IndexedDB.
 */
function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;
      const marker = '/resolve/main/';
      const idx = url.indexOf(marker);
      if (idx === -1) return undefined;
      const filename = url.slice(idx + marker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;
      return fetch(blobUrl);
    },
    async put(_request: string | Request, _response: Response): Promise<void> {
    },
  };
}

// ─── Speech Segment Processing ──────────────────────────────────────────────

/**
 * Run Cohere Transcribe on a completed speech segment with token streaming.
 * TextStreamer emits partial results token-by-token during inference.
 */
async function runTranscribe(audio: Float32Array): Promise<void> {
  if (!transcriber || isTranscribing) return;
  isTranscribing = true;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
  const startTime = performance.now();
  let accumulatedText = '';

  try {
    const streamer = new TextStreamer(transcriber.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (token: string) => {
        accumulatedText += token;
        post({ type: 'partial', text: accumulatedText });
      },
    });

    const options: Record<string, any> = {
      max_new_tokens: 1024,
      streamer,
    };
    if (currentLanguage) {
      options.language = currentLanguage;
    }

    const result = await transcriber(audio, options);
    const recognitionTimeMs = Math.round(performance.now() - startTime);
    const text = (Array.isArray(result) ? result[0].text : result.text).trim();

    if (text) {
      post({
        type: 'result',
        text,
        durationMs,
        recognitionTimeMs,
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Cohere Transcribe inference failed: ${err.message || err}` });
  } finally {
    isTranscribing = false;
  }
}

// ─── VAD + Audio Feed Pipeline ──────────────────────────────────────────────

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || !transcriber || processingVad) return;
  processingVad = true;

  try {
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);

    // Append to VAD audio buffer
    const newBuf = new Float32Array(vadAudioBuffer.length + resampled.length);
    newBuf.set(vadAudioBuffer);
    newBuf.set(resampled, vadAudioBuffer.length);
    vadAudioBuffer = newBuf;

    // Process complete VAD frames
    while (vadAudioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = vadAudioBuffer.slice(0, VAD_FRAME_SAMPLES);
      vadAudioBuffer = vadAudioBuffer.slice(VAD_FRAME_SAMPLES);

      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));

      for (const ev of events) {
        switch (ev.msg) {
          case Message.SpeechStart:
            speechFramesSinceStart = 0;
            post({ type: 'speech_start' });
            break;

          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            await runTranscribe(ev.audio);
            break;

          case Message.VADMisfire:
            speechFramesSinceStart = 0;
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
              await runTranscribe(ev.audio);
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

async function handleInit(msg: CohereTranscribeAsrInitMessage): Promise<void> {
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

    // 2. Configure Transformers.js for IndexedDB blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    // 3. Load Cohere Transcribe pipeline
    post({ type: 'status', message: 'Loading Cohere Transcribe model (WebGPU)...' });

    transcriber = (await pipeline('automatic-speech-recognition', msg.hfModelId, {
      dtype: msg.dtype as any,
      device: 'webgpu',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress' && info.file.endsWith('.onnx_data') && info.total > 0) {
          const pct = Math.round((info.loaded / info.total) * 100);
          post({ type: 'status', message: `Loading model... ${pct}%` });
        }
      },
    })) as AutomaticSpeechRecognitionPipeline;

    currentLanguage = msg.language;

    // 4. WebGPU warmup: compile shaders with a tiny inference
    post({ type: 'status', message: 'Warming up WebGPU shaders...' });
    try {
      const warmupOpts: Record<string, any> = { max_new_tokens: 1 };
      if (currentLanguage) {
        warmupOpts.language = currentLanguage;
      }
      await transcriber(new Float32Array(16000), warmupOpts);
    } catch {
      console.warn('[cohere-transcribe-worker] Warmup failed, first inference may be slower');
    }

    // Reset buffers
    vadAudioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err.message || String(err) });
  }
}

// ─── Flush & Dispose ────────────────────────────────────────────────────────

function handleFlush(): void {
  // Force-finalize any pending speech via FrameProcessor
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        runTranscribe(ev.audio);
      }
    }
  }
}

async function handleDispose(): Promise<void> {
  // Flush remaining speech
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runTranscribe(ev.audio);
      }
    }
  }

  // Dispose FrameProcessor
  frameProcessor = null;
  speechFramesSinceStart = 0;

  // Dispose VAD
  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  // Dispose transcriber
  if (transcriber) {
    await (transcriber as any).dispose?.();
    transcriber = null;
    currentLanguage = undefined;
  }

  vadAudioBuffer = new Float32Array(0);
  processingVad = false;
  isTranscribing = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as CohereTranscribeAsrInitMessage);
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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts
git commit -m "feat: add Cohere Transcribe WebGPU ASR worker with VAD + TextStreamer"
```

---

### Task 4: Wire up StreamingAsrEngine

**Files:**
- Modify: `src/lib/local-inference/engine/StreamingAsrEngine.ts:69-79` (worker switch)
- Modify: `src/lib/local-inference/engine/StreamingAsrEngine.ts:131-157` (init message)

- [ ] **Step 1: Add worker creation case**

In `StreamingAsrEngine.ts`, update the switch statement at line 69 to add the new case before the `default`:

```typescript
        switch (workerType) {
          case 'voxtral-webgpu':
            this.worker = new Worker(
              new URL('../workers/voxtral-webgpu.worker.ts', import.meta.url),
              { type: 'module' },
            );
            break;
          case 'cohere-transcribe-webgpu':
            this.worker = new Worker(
              new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url),
              { type: 'module' },
            );
            break;
          default: // sherpa-onnx streaming
            this.worker = new Worker('./workers/sherpa-onnx-streaming-asr.worker.js');
            break;
        }
```

- [ ] **Step 2: Add init message path**

In `StreamingAsrEngine.ts`, update the init message section. The `if (workerType === 'voxtral-webgpu')` block (line 131) needs to also handle Cohere. Change the condition to handle both WebGPU pipeline workers:

```typescript
        if (workerType === 'voxtral-webgpu' || workerType === 'cohere-transcribe-webgpu') {
```

This works because both workers use the exact same init message shape: `fileUrls`, `hfModelId`, `language`, `dtype`, `vadModelUrl`, `ortWasmBaseUrl`. The only difference is in the error message — update it to be generic:

In the error message inside that block, change:

```typescript
            throw new Error(`Voxtral model "${modelId}" is not downloaded.`);
```

to:

```typescript
            throw new Error(`Model "${modelId}" is not downloaded.`);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Verify the app builds**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds. The new worker should be bundled as a separate chunk.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/StreamingAsrEngine.ts
git commit -m "feat: wire Cohere Transcribe WebGPU worker into StreamingAsrEngine"
```

---

### Task 5: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Dev server starts on port 5173.

- [ ] **Step 2: Verify model appears in UI**

1. Open `http://localhost:5173` in Chrome/Edge (WebGPU required)
2. Select "Local Inference" provider
3. Open ASR model selector in Model Management section
4. Verify "Cohere Transcribe (WebGPU)" appears in the list
5. Verify it shows correct size (~2.1GB for q4, ~1.54GB for q4f16)
6. Verify it only appears on WebGPU-capable browsers

- [ ] **Step 3: Test model download (if network available)**

1. Click download for Cohere Transcribe
2. Verify progress bar shows download progress
3. Verify all files download successfully to IndexedDB

- [ ] **Step 4: Test transcription (if model downloaded)**

1. Select Cohere Transcribe as ASR model
2. Set a source language (e.g., English)
3. Start a session
4. Speak into the microphone
5. Verify:
   - VAD detects speech (speech_start event)
   - Partial results appear token-by-token during inference
   - Final result emitted when VAD detects silence
   - Flush works when PTT key released

- [ ] **Step 5: Commit final state (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address integration test findings for Cohere Transcribe"
```
