# Granite Speech WebGPU Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate IBM Granite Speech as a WebGPU ASR engine with conditional AST (speech translation) via prompt switching.

**Architecture:** Register as `type: 'asr'` model. New worker uses Transformers.js v4 `GraniteSpeechForConditionalGeneration` with Silero VAD. When user selects Granite for both ASR and translation, `LocalInferenceClient` sends a translate prompt and skips the translation engine.

**Tech Stack:** Transformers.js v4, ONNX Runtime Web (WebGPU), Silero VAD v5, @ricky0123/vad-web FrameProcessor

**Spec:** `docs/superpowers/specs/2026-04-01-granite-speech-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/local-inference/types.ts` | Modify | Add `GraniteSpeechInitMessage` type |
| `src/lib/local-inference/modelManifest.ts` | Modify | Add `astLanguages` to interface, `'granite-speech'` to engine types, `'granite-speech-webgpu'` to worker types, manifest entry |
| `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts` | Create | WebGPU worker: VAD + Granite inference |
| `src/lib/local-inference/engine/AsrEngine.ts` | Modify | Add worker routing + taskConfig to init() |
| `src/services/clients/LocalInferenceClient.ts` | Modify | AST detection, skip translation engine |
| `src/stores/modelStore.ts` | Modify | AST short-circuit in isProviderReady() |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Modify | Inject AST model into translation picker |

---

### Task 1: Add types and manifest entry

**Files:**
- Modify: `src/lib/local-inference/types.ts:68` (add to union type)
- Modify: `src/lib/local-inference/modelManifest.ts:30-38` (engine types), `53-107` (interface), `88-90` (worker type union)

- [ ] **Step 1: Add `GraniteSpeechInitMessage` to `types.ts`**

Add after `CohereTranscribeAsrInitMessage` (line 158), before the streaming ASR output section:

```typescript
export interface GraniteSpeechInitMessage {
  type: 'init';
  /** Map of filename -> blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js from_pretrained */
  hfModelId: string;
  /** Source language hint (e.g. 'ja', 'en') */
  language?: string;
  /** Task: 'transcribe' for ASR, 'translate' for AST (speech translation) */
  task: 'transcribe' | 'translate';
  /** Target language for AST (only when task === 'translate') */
  targetLanguage?: string;
  /** ONNX dtype config — per-component mapping (audio_encoder, embed_tokens, decoder_model_merged) */
  dtype: string | Record<string, string>;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl?: string;
}
```

Update the `AsrWorkerInMessage` union on line 68 to include `GraniteSpeechInitMessage`:

```typescript
export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | CohereTranscribeAsrInitMessage | GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage;
```

- [ ] **Step 2: Add `'granite-speech'` to `AsrEngineType` in `modelManifest.ts`**

On line 30-34, add `'granite-speech'` to the union:

```typescript
export type AsrEngineType =
  | 'sensevoice' | 'whisper' | 'transducer' | 'nemo-transducer'
  | 'paraformer' | 'telespeech' | 'moonshine' | 'moonshine-v2'
  | 'dolphin' | 'zipformer-ctc' | 'nemo-ctc' | 'canary'
  | 'wenet-ctc' | 'omnilingual' | 'granite-speech';
```

- [ ] **Step 3: Add `'granite-speech-webgpu'` to `asrWorkerType` union in `ModelManifestEntry`**

On line 90:

```typescript
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu' | 'voxtral-webgpu' | 'cohere-transcribe-webgpu' | 'granite-speech-webgpu';
```

- [ ] **Step 4: Add `astLanguages` field to `ModelManifestEntry`**

Add after `asrWorkerType` (line 90), in the ASR configuration section:

```typescript
  /** AST (speech translation) language support. When present, model appears as a translation option when selected as ASR. */
  astLanguages?: {
    /** Languages the model can transcribe */
    transcribe: string[];
    /** Languages the model can translate to/from */
    translate: string[];
  };
```

- [ ] **Step 5: Add Granite Speech manifest entry**

Add at the end of the ASR models section in `MODEL_MANIFEST` (after the last Whisper/Cohere model entry, before the TTS section):

```typescript
  // ─── Granite Speech (WebGPU) ─────────────────────────────────────────────
  {
    id: 'granite-speech',
    type: 'asr',
    name: 'Granite Speech (WebGPU)',
    languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'],
    multilingual: true,
    hfModelId: 'onnx-community/granite-4.0-1b-speech-ONNX',
    requiredDevice: 'webgpu',
    asrEngine: 'granite-speech',
    asrWorkerType: 'granite-speech-webgpu',
    recommended: true,
    astLanguages: {
      transcribe: ['en', 'fr', 'de', 'es', 'pt', 'ja'],
      translate: ['en', 'fr', 'de', 'es', 'pt', 'ja', 'it', 'zh'],
    },
    variants: {
      'q4': {
        dtype: { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' },
        files: [
          { filename: 'config.json', sizeBytes: 2_620 },
          { filename: 'generation_config.json', sizeBytes: 235 },
          { filename: 'preprocessor_config.json', sizeBytes: 336 },
          { filename: 'processor_config.json', sizeBytes: 415 },
          { filename: 'tokenizer.json', sizeBytes: 4_130_000 },
          { filename: 'tokenizer_config.json', sizeBytes: 646 },
          { filename: 'chat_template.jinja', sizeBytes: 193 },
          { filename: 'onnx/audio_encoder_q4.onnx', sizeBytes: 348_000 },
          { filename: 'onnx/audio_encoder_q4.onnx_data', sizeBytes: 658_000_000 },
          { filename: 'onnx/embed_tokens_q4.onnx', sizeBytes: 857 },
          { filename: 'onnx/embed_tokens_q4.onnx_data', sizeBytes: 132_000_000 },
          { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: 434_000 },
          { filename: 'onnx/decoder_model_merged_q4.onnx_data', sizeBytes: 1_050_000_000 },
        ],
        requiredFeatures: [],
      },
      'q4f16': {
        dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
        files: [
          { filename: 'config.json', sizeBytes: 2_620 },
          { filename: 'generation_config.json', sizeBytes: 235 },
          { filename: 'preprocessor_config.json', sizeBytes: 336 },
          { filename: 'processor_config.json', sizeBytes: 415 },
          { filename: 'tokenizer.json', sizeBytes: 4_130_000 },
          { filename: 'tokenizer_config.json', sizeBytes: 646 },
          { filename: 'chat_template.jinja', sizeBytes: 193 },
          { filename: 'onnx/audio_encoder_q4f16.onnx', sizeBytes: 352_000 },
          { filename: 'onnx/audio_encoder_q4f16.onnx_data', sizeBytes: 425_000_000 },
          { filename: 'onnx/embed_tokens_q4f16.onnx', sizeBytes: 1_060 },
          { filename: 'onnx/embed_tokens_q4f16.onnx_data', sizeBytes: 119_000_000 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx', sizeBytes: 437_000 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx_data', sizeBytes: 945_000_000 },
        ],
        requiredFeatures: ['shader-f16'],
      },
    },
  },
```

- [ ] **Step 6: Build and verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to the new types.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/modelManifest.ts
git commit -m "feat(local-inference): add Granite Speech types and manifest entry"
```

---

### Task 2: Create Granite Speech WebGPU worker

**Files:**
- Create: `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts`

This worker follows the same architecture as `whisper-webgpu.worker.ts`: Silero VAD → batch segment → model inference. The key difference is using `GraniteSpeechForConditionalGeneration` with prompt-based task selection instead of the `pipeline()` API.

- [ ] **Step 1: Create the worker file**

Create `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts`:

```typescript
/**
 * Granite Speech WebGPU ASR/AST Worker
 *
 * Streaming audio input (Int16@24kHz) -> Silero VAD v5 -> Granite Speech (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Supports two tasks via prompt switching:
 * - 'transcribe': ASR (speech-to-text)
 * - 'translate':  AST (speech-to-translated-text)
 *
 * Input messages:  GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage
 * Output messages: AsrWorkerOutMessage (ready, status, speech_start, result, error, disposed)
 */

import {
  AutoProcessor,
  GraniteSpeechForConditionalGeneration,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import { InferenceSession, Tensor, env as ortEnv } from 'onnxruntime-web';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

import type {
  GraniteSpeechInitMessage,
  AsrAudioMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// HF CDN Range request cache workaround (same as whisper worker)
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

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerMessage = GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage;

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Language Name Map ──────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish',
  pt: 'Portuguese', ja: 'Japanese', it: 'Italian', zh: 'Mandarin Chinese',
};

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
let totalSamplesFed = 0;
let speechStartSample = 0;

async function vadInfer(frame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
  if (!vadSession) return { isSpeech: 0, notSpeech: 1 };

  const input = new Tensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);

  const result = await vadSession.session.run({
    input,
    sr,
    state: vadSession.state,
  });

  vadSession.state = result.stateN as Tensor;
  const prob = (result.output as Tensor).data[0] as number;
  return { isSpeech: prob, notSpeech: 1 - prob };
}

function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(vadModelUrl?: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
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

  totalSamplesFed = 0;
  speechStartSample = 0;
  speechFramesSinceStart = 0;
}

// ─── Audio Buffer & Resampling ──────────────────────────────────────────────

let audioBuffer = new Float32Array(0);

function resampleInt16ToFloat32_16k(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / VAD_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    const vLo = samples[lo] / 32768;
    const vHi = samples[hi] / 32768;
    out[i] = vLo + (vHi - vLo) * frac;
  }

  return out;
}

// ─── Granite Speech Model ───────────────────────────────────────────────────

let processor: any = null;
let model: any = null;
let currentTask: 'transcribe' | 'translate' = 'transcribe';
let currentTargetLanguage: string | undefined;
let processingVad = false;

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
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}

function buildPrompt(): string {
  if (currentTask === 'translate' && currentTargetLanguage) {
    const langName = LANGUAGE_NAMES[currentTargetLanguage] || currentTargetLanguage;
    return `<|audio|>Translate the speech to ${langName}`;
  }
  return '<|audio|>Transcribe the speech to text';
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

// ─── Speech Segment Processing ──────────────────────────────────────────────

async function runGraniteInference(audio: Float32Array, startSample: number): Promise<void> {
  if (!processor || !model) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
  const startTime = performance.now();

  try {
    const content = buildPrompt();
    const messages = [{ role: 'user', content }];

    const text = processor.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });

    const inputs = await processor(text, audio, { sampling_rate: VAD_SAMPLE_RATE });

    // Collect output via streamer
    let accumulated = '';
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        accumulated += chunk;
      },
    });

    await model.generate({
      ...inputs,
      max_new_tokens: 256,
      streamer,
    });

    const recognitionTimeMs = Math.round(performance.now() - startTime);
    const resultText = accumulated.trim();

    if (resultText) {
      post({
        type: 'result',
        text: resultText,
        startSample,
        durationMs,
        recognitionTimeMs,
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Granite inference failed: ${err.message || err}` });
  }
}

// ─── Audio Feed Pipeline ────────────────────────────────────────────────────

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || !model || processingVad) return;
  processingVad = true;

  try {
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);

    const newBuf = new Float32Array(audioBuffer.length + resampled.length);
    newBuf.set(audioBuffer);
    newBuf.set(resampled, audioBuffer.length);
    audioBuffer = newBuf;

    while (audioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = audioBuffer.slice(0, VAD_FRAME_SAMPLES);
      audioBuffer = audioBuffer.slice(VAD_FRAME_SAMPLES);
      totalSamplesFed += VAD_FRAME_SAMPLES;

      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));

      for (const ev of events) {
        switch (ev.msg) {
          case Message.SpeechStart:
            speechStartSample = totalSamplesFed - VAD_FRAME_SAMPLES;
            speechFramesSinceStart = 0;
            post({ type: 'speech_start' });
            break;
          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            await runGraniteInference(ev.audio, speechStartSample);
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
              await runGraniteInference(ev.audio, speechStartSample);
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

// ─── Message Handlers ───────────────────────────────────────────────────────

async function handleInit(msg: GraniteSpeechInitMessage): Promise<void> {
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

    const webgpuAvailable = await hasWebGPU();
    if (!webgpuAvailable) {
      post({ type: 'error', error: 'WebGPU is not available. Granite Speech requires WebGPU.' });
      return;
    }

    post({ type: 'status', message: 'Loading VAD model...' });
    await initVad(msg.vadModelUrl);

    // Configure Transformers.js for IndexedDB blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    // Load processor and model
    post({ type: 'status', message: 'Loading Granite Speech model (WebGPU)...' });

    processor = await AutoProcessor.from_pretrained(msg.hfModelId);
    model = await GraniteSpeechForConditionalGeneration.from_pretrained(msg.hfModelId, {
      dtype: msg.dtype as any,
      device: 'webgpu',
    });

    currentTask = msg.task;
    currentTargetLanguage = msg.targetLanguage;

    // WebGPU warmup: run a tiny inference to compile shaders
    post({ type: 'status', message: 'Warming up WebGPU shaders...' });
    try {
      const warmupContent = '<|audio|>Transcribe the speech to text';
      const warmupMessages = [{ role: 'user', content: warmupContent }];
      const warmupText = processor.tokenizer.apply_chat_template(warmupMessages, {
        add_generation_prompt: true,
        tokenize: false,
      });
      const warmupAudio = new Float32Array(16000); // 1s silence
      const warmupInputs = await processor(warmupText, warmupAudio, { sampling_rate: 16000 });
      await model.generate({ ...warmupInputs, max_new_tokens: 1 });
    } catch {
      console.warn('[granite-worker] Warmup failed, first inference may be slower');
    }

    audioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err.message || String(err) });
  }
}

async function handleFlush(): Promise<void> {
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runGraniteInference(ev.audio, speechStartSample);
      }
    }
  }
}

async function handleDispose(): Promise<void> {
  // Flush remaining speech
  await handleFlush();

  frameProcessor = null;
  speechFramesSinceStart = 0;

  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  if (model) {
    await model.dispose?.();
    model = null;
  }
  processor = null;
  currentTask = 'transcribe';
  currentTargetLanguage = undefined;

  audioBuffer = new Float32Array(0);
  processingVad = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as GraniteSpeechInitMessage);
      break;
    case 'audio':
      await feedAudio((msg as AsrAudioMessage).samples, (msg as AsrAudioMessage).sampleRate);
      break;
    case 'flush':
      await handleFlush();
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
```

- [ ] **Step 2: Build and verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/granite-speech-webgpu.worker.ts
git commit -m "feat(local-inference): add Granite Speech WebGPU worker"
```

---

### Task 3: Add worker routing in AsrEngine

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:47` (init signature), `76-86` (switch), `139-149` (init message)

- [ ] **Step 1: Extend `init()` signature with `taskConfig`**

In `AsrEngine.ts`, change line 47:

```typescript
  async init(modelId: string, vadConfig?: { threshold?: number; minSilenceDuration?: number; minSpeechDuration?: number }, language?: string, taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }): Promise<{ loadTimeMs: number }> {
```

- [ ] **Step 2: Add `granite-speech-webgpu` case to worker switch**

After the `case 'whisper-webgpu':` block (line 77-81), add:

```typescript
        case 'granite-speech-webgpu':
          this.worker = new Worker(
            new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
```

- [ ] **Step 3: Add init message branch for `granite-speech-webgpu`**

After the `if (workerType === 'whisper-webgpu')` block (line 139-149), add an `else if` before the `else` (sherpa-onnx):

```typescript
      } else if (workerType === 'granite-speech-webgpu') {
        this.worker.postMessage({
          type: 'init',
          fileUrls,
          hfModelId: model.hfModelId,
          language,
          task: taskConfig?.task ?? 'transcribe',
          targetLanguage: taskConfig?.targetLanguage,
          dtype,
          ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
          vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        });
      } else {
```

- [ ] **Step 4: Build and verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.ts
git commit -m "feat(local-inference): add Granite Speech routing to AsrEngine"
```

---

### Task 4: AST detection in LocalInferenceClient

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts:157-184` (connect), `395-406` (pipeline job)

- [ ] **Step 1: Replace translation engine creation with AST-aware logic**

In `LocalInferenceClient.ts`, replace lines 157-159 (the translation engine creation):

```typescript
      // Translation engine
      console.info('[LocalInference] Initializing Translation engine:', config.translationModelId, `(${config.sourceLanguage} → ${config.targetLanguage})`);
      this.translationEngine = new TranslationEngine();
```

with:

```typescript
      // Translation engine — skip when ASR model handles AST directly
      const isAstMode = asrModel?.asrEngine === 'granite-speech'
        && config.translationModelId === config.asrModelId;

      if (isAstMode) {
        console.info('[LocalInference] AST mode: Granite Speech handles translation, skipping translation engine');
        this.translationEngine = null;
      } else {
        console.info('[LocalInference] Initializing Translation engine:', config.translationModelId, `(${config.sourceLanguage} → ${config.targetLanguage})`);
        this.translationEngine = new TranslationEngine();
      }
```

- [ ] **Step 2: Update ASR init to pass taskConfig in AST mode**

Replace lines 171-181 (the ASR init promise):

```typescript
      const asrPromise = this.trackInit('asr', config.asrModelId, () => {
        if (asrModel?.type === 'asr-stream') {
          return (this.asrEngine as StreamingAsrEngine).init(config.asrModelId, { language: config.sourceLanguage });
        } else {
          return (this.asrEngine as AsrEngine).init(config.asrModelId, {
            threshold: config.vadThreshold,
            minSilenceDuration: config.vadMinSilenceDuration,
            minSpeechDuration: config.vadMinSpeechDuration,
          }, config.sourceLanguage);
        }
      });
```

with:

```typescript
      const asrPromise = this.trackInit('asr', config.asrModelId, () => {
        if (asrModel?.type === 'asr-stream') {
          return (this.asrEngine as StreamingAsrEngine).init(config.asrModelId, { language: config.sourceLanguage });
        } else {
          const taskConfig = isAstMode
            ? { task: 'translate' as const, targetLanguage: config.targetLanguage }
            : undefined;
          return (this.asrEngine as AsrEngine).init(config.asrModelId, {
            threshold: config.vadThreshold,
            minSilenceDuration: config.vadMinSilenceDuration,
            minSpeechDuration: config.vadMinSpeechDuration,
          }, config.sourceLanguage, taskConfig);
        }
      });
```

- [ ] **Step 3: Update translation init to skip in AST mode**

Replace lines 183-185:

```typescript
      const translationPromise = this.trackInit('translation', config.translationModelId, () =>
        this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
      );
```

with:

```typescript
      const translationPromise = this.translationEngine
        ? this.trackInit('translation', config.translationModelId, () =>
            this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
          )
        : Promise.resolve(null);
```

- [ ] **Step 4: Update engine list and result checks for optional translation**

On line 93, update the engines list:

```typescript
      const engines = ['asr'];
      if (!isAstMode) engines.push('translation');
      if (config.ttsModelId && !config.textOnly) engines.push('tts');
```

Note: the `isAstMode` variable is computed after `asrModel` is available (line 101), so move the engines list computation after that. Specifically, move lines 93-95 to after the `isAstMode` declaration.

For the translation result check (lines 207-209), wrap in a conditional:

```typescript
      // Check Translation result (only if translation engine was initialized)
      if (this.translationEngine) {
        if (results[1].status === 'rejected') {
          throw new Error(`Translation engine init failed: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
        }
        console.info('[LocalInference] Translation engine ready');
      }
```

- [ ] **Step 5: Update `processPipelineJob` for null translation engine**

Replace lines 399-419 (from `// Translate first` through the `this.emitEvent('local.translation.end'` block):

```typescript
      // Translate first — don't push item until we have content
      if (!this.translationEngine || this.disposed) return;
      this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
      const translationResult = await this.translationEngine.translate(job.text);
      if (this.disposed) return;

      const translatedText = translationResult.translatedText;
      console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

      // Skip empty translations (e.g. thinking-mode leakage stripped to nothing)
      if (!translatedText) {
        console.debug('[LocalInference] Translation empty — skipping:', job.text);
        return;
      }
      this.emitEvent('local.translation.end', 'server', {
        sourceText: job.text,
        translatedText,
        inferenceTimeMs: translationResult.inferenceTimeMs,
        systemPrompt: translationResult.systemPrompt,
        modelId: this.config?.translationModelId,
      });
```

with:

```typescript
      if (this.disposed) return;

      let translatedText: string;

      if (this.translationEngine) {
        this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
        const translationResult = await this.translationEngine.translate(job.text);
        if (this.disposed) return;
        translatedText = translationResult.translatedText;
        console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

        if (!translatedText) {
          console.debug('[LocalInference] Translation empty — skipping:', job.text);
          return;
        }

        this.emitEvent('local.translation.end', 'server', {
          sourceText: job.text,
          translatedText,
          inferenceTimeMs: translationResult.inferenceTimeMs,
          systemPrompt: translationResult.systemPrompt,
          modelId: this.config?.translationModelId,
        });
      } else {
        // AST mode: ASR already produced translated text
        translatedText = job.text;
        console.debug('[LocalInference] AST mode — text already translated:', translatedText);
        if (!translatedText) return;
      }
```

- [ ] **Step 6: Build and verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "feat(local-inference): add AST mode detection in LocalInferenceClient"
```

---

### Task 5: AST short-circuit in modelStore

**Files:**
- Modify: `src/stores/modelStore.ts:274-286` (translation check in isProviderReady)

- [ ] **Step 1: Add AST short-circuit to `isProviderReady`**

In `modelStore.ts`, replace lines 274-286 (the translation readiness check):

```typescript
      // 2. Translation: if a specific model is selected, check it directly;
      //    otherwise use getTranslationModel preference (pair-specific > multilingual)
      if (selectedTranslationModel) {
        if (modelStatuses[selectedTranslationModel] !== 'downloaded') return false;
        const entry = getManifestEntry(selectedTranslationModel);
        if (entry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
        if (entry && !isTranslationModelCompatible(entry, sourceLang, targetLang)) return false;
      } else {
        const translationEntry = getTranslationModel(sourceLang, targetLang);
        if (!translationEntry) return false;
        if (modelStatuses[translationEntry.id] !== 'downloaded') return false;
        if (translationEntry.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
      }
```

with:

```typescript
      // 2. Translation: AST short-circuit when translation model === ASR model
      if (selectedTranslationModel && selectedTranslationModel === selectedAsrModel) {
        // AST mode: translation handled by the ASR model — check AST language support
        const asrEntry = getManifestEntry(selectedAsrModel);
        if (!asrEntry?.astLanguages?.translate.includes(targetLang)) return false;
        if (!asrEntry?.astLanguages?.translate.includes(sourceLang)
          && !asrEntry?.astLanguages?.transcribe.includes(sourceLang)) return false;
        // ASR readiness already validated above — no further translation checks needed
      } else if (selectedTranslationModel) {
        if (modelStatuses[selectedTranslationModel] !== 'downloaded') return false;
        const entry = getManifestEntry(selectedTranslationModel);
        if (entry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
        if (entry && !isTranslationModelCompatible(entry, sourceLang, targetLang)) return false;
      } else {
        const translationEntry = getTranslationModel(sourceLang, targetLang);
        if (!translationEntry) return false;
        if (modelStatuses[translationEntry.id] !== 'downloaded') return false;
        if (translationEntry.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
      }
```

- [ ] **Step 2: Build and verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/modelStore.ts
git commit -m "feat(local-inference): add AST short-circuit in isProviderReady"
```

---

### Task 6: Conditional translation model in UI

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx:391-394` (translation model list)

- [ ] **Step 1: Inject AST-capable ASR model into translation model list**

In `ModelManagementSection.tsx`, replace lines 391-394:

```typescript
  const translationModels = useMemo(() => {
    const all = getManifestByType('translation');
    return sortTranslationModels(all);
  }, []);
```

with:

```typescript
  const translationModels = useMemo(() => {
    const all = [...getManifestByType('translation')];

    // If current ASR model supports AST, add it as a translation option
    const asrEntry = asrModel ? getManifestEntry(asrModel) : null;
    if (asrEntry?.astLanguages) {
      all.push({
        ...asrEntry,
        type: 'translation' as ModelType,
        multilingual: true,
        languages: asrEntry.astLanguages.translate,
      } as ModelManifestEntry);
    }

    return sortTranslationModels(all);
  }, [asrModel]);
```

Ensure `ModelType` is imported (it likely already is from `modelManifest.ts`). Also check that `getManifestEntry` is already imported — it should be since `asrModel` comes from the store.

- [ ] **Step 2: Build and verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Run the app and verify UI**

Run: `npm run dev`

Manually check:
1. Granite Speech appears in ASR model list (when WebGPU available)
2. When Granite is not selected as ASR, it does NOT appear in translation model list
3. When Granite IS selected as ASR, it appears in translation model list
4. Selecting a different ASR model removes Granite from translation list and auto-corrects translation selection

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx
git commit -m "feat(local-inference): show Granite AST in translation picker when active as ASR"
```

---

### Task 7: Integration test — end-to-end verification

- [ ] **Step 1: Verify full build succeeds**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 2: Manual integration test (requires WebGPU browser)**

1. Start dev server: `npm run dev`
2. Open in Chrome/Edge with WebGPU
3. Select LOCAL_INFERENCE provider
4. Download Granite Speech model (q4 variant)
5. **Test ASR mode**: Select Granite as ASR, any other model as translation
   - Speak → verify transcription appears as user message
   - Verify translation appears as assistant message (from separate engine)
6. **Test AST mode**: Select Granite as both ASR and translation
   - Speak → verify translated text appears directly as assistant message
   - Verify no "Translation engine" init logs in console
7. **Test auto-deselection**: Switch ASR to a different model
   - Verify Granite disappears from translation picker
   - Verify translation auto-corrects to a valid model

- [ ] **Step 3: Final commit with any fixes**

If any fixes were needed during testing, commit them.

```bash
git add -A
git commit -m "fix(local-inference): address integration test findings for Granite Speech"
```
