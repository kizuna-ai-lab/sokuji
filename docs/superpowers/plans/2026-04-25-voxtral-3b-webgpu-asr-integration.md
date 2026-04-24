# Voxtral Mini 3B 2507 WebGPU ASR Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Voxtral Mini 3B 2507 as a batch/offline WebGPU ASR engine (`type: 'asr'`) with explicit language-hint support (`lang:XX [TRANSCRIBE]` in the chat template), routed through `AsrEngine` (not `StreamingAsrEngine`, correcting Task #3 of issue #169).

**Architecture:** A new module worker `voxtral-3b-webgpu.worker.ts` follows Cohere Transcribe's batch pattern (VAD → complete utterance → `model.generate`) but uses `VoxtralForConditionalGeneration` + `VoxtralProcessor` + `apply_chat_template` instead of the `pipeline()` API. `TextStreamer` provides token-level partial results during batch decoding. `AsrEngine` already routes `type: 'asr'` models; we add one `switch` case and extend one existing init-message condition. Spec: `docs/superpowers/specs/2026-04-25-voxtral-3b-webgpu-asr-design.md`.

**Tech Stack:** `@huggingface/transformers` (`VoxtralForConditionalGeneration`, `VoxtralProcessor`, `TextStreamer`, `env`), `onnxruntime-web` (Silero VAD), `@ricky0123/vad-web` (`FrameProcessor`)

**Important discovery from HF file listing:** The 3B repo does **not** ship an `embed_tokens_q4f16.onnx` (unlike 4B). The q4f16 variant must mix precisions: `{ audio_encoder: 'q4f16', embed_tokens: 'q4', decoder_model_merged: 'q4f16' }`. This plan already reflects that; the design spec's "all q4f16" note is superseded here.

---

### Task 1: Add type definitions and type-union entries

**Files:**
- Modify: `src/lib/local-inference/types.ts:87` (`AsrWorkerInMessage` union)
- Modify: `src/lib/local-inference/types.ts:165-181` (add new interface after `CohereTranscribeAsrInitMessage`)
- Modify: `src/lib/local-inference/modelManifest.ts:30-34` (`AsrEngineType`)
- Modify: `src/lib/local-inference/modelManifest.ts:90` (`asrWorkerType` union)

- [ ] **Step 1: Add `Voxtral3BAsrInitMessage` interface to `types.ts`**

In `src/lib/local-inference/types.ts`, insert the following **between** the existing `CohereTranscribeAsrInitMessage` block (ends at line 181) and the `GraniteSpeechInitMessage` block (starts at line 183):

```typescript
export interface Voxtral3BAsrInitMessage {
  type: 'init';
  /** Map of filename → blob URL for model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** HuggingFace model ID for Transformers.js from_pretrained */
  hfModelId: string;
  /** Source language hint (e.g. 'ja', 'en-US'). Normalized to ISO 639-1 inside the worker. */
  language?: string;
  /** ONNX dtype config — per-component mapping (audio_encoder, embed_tokens, decoder_model_merged) */
  dtype: string | Record<string, string>;
  /** VAD configuration overrides from user settings */
  vadConfig?: VadWebConfig;
  /** Resolved absolute URL for bundled VAD model */
  vadModelUrl: string;
  /** Resolved absolute URL for bundled ORT WASM files */
  ortWasmBaseUrl?: string;
}
```

- [ ] **Step 2: Extend the `AsrWorkerInMessage` union in `types.ts`**

At line 87, change:

```typescript
export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | CohereTranscribeAsrInitMessage | GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage;
```

to:

```typescript
export type AsrWorkerInMessage = AsrInitMessage | WhisperAsrInitMessage | VoxtralAsrInitMessage | Voxtral3BAsrInitMessage | CohereTranscribeAsrInitMessage | GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage;
```

- [ ] **Step 3: Add `'voxtral-3b'` to `AsrEngineType` and move `'cohere-transcribe'` there too**

This step both adds the new identifier **and** fixes an existing misclassification that PR #168 (commit `f3297e46`) left behind: when Cohere was moved from `type: 'asr-stream'` → `type: 'asr'`, its `asrEngine` identifier `'cohere-transcribe'` was not moved from `StreamAsrEngineType` → `AsrEngineType`. That's an oversight (confirmed by the PR's scope and commit message, which state Cohere is "not a streaming model"). Fixing it now prevents the Voxtral 3B addition from perpetuating the same mismatch.

In `src/lib/local-inference/modelManifest.ts`, at lines 30-34 change:

```typescript
export type AsrEngineType =
  | 'sensevoice' | 'whisper' | 'transducer' | 'nemo-transducer'
  | 'paraformer' | 'telespeech' | 'moonshine' | 'moonshine-v2'
  | 'dolphin' | 'zipformer-ctc' | 'nemo-ctc' | 'canary'
  | 'wenet-ctc' | 'omnilingual' | 'granite-speech';
```

to:

```typescript
export type AsrEngineType =
  | 'sensevoice' | 'whisper' | 'transducer' | 'nemo-transducer'
  | 'paraformer' | 'telespeech' | 'moonshine' | 'moonshine-v2'
  | 'dolphin' | 'zipformer-ctc' | 'nemo-ctc' | 'canary'
  | 'wenet-ctc' | 'omnilingual' | 'granite-speech'
  | 'cohere-transcribe' | 'voxtral-3b';
```

- [ ] **Step 4: Remove `'cohere-transcribe'` from `StreamAsrEngineType` (completes the move)**

At lines 37-38, change:

```typescript
export type StreamAsrEngineType =
  | 'stream-transducer' | 'stream-nemo-ctc' | 'voxtral' | 'cohere-transcribe';
```

to:

```typescript
export type StreamAsrEngineType =
  | 'stream-transducer' | 'stream-nemo-ctc' | 'voxtral';
```

This is a pure type-level move. The `asrEngine` field on `ModelManifestEntry` is declared as `AsrEngineType | StreamAsrEngineType`, so an identifier works the same whether it's in either union — no runtime effect, no manifest-entry change.

- [ ] **Step 5: Add `'voxtral-3b-webgpu'` to the `asrWorkerType` union in `modelManifest.ts`**

At line 90, change:

```typescript
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu' | 'voxtral-webgpu' | 'cohere-transcribe-webgpu' | 'granite-speech-webgpu';
```

to:

```typescript
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu' | 'voxtral-webgpu' | 'voxtral-3b-webgpu' | 'cohere-transcribe-webgpu' | 'granite-speech-webgpu';
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. (There are no references to the new types yet, so only the union additions exist. Moving `'cohere-transcribe'` between the unions should not surface any errors — the existing Cohere manifest entry still type-checks because `asrEngine` accepts the combined union.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/modelManifest.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): add Voxtral 3B type identifiers; reclassify Cohere

Prepares type plumbing for the Voxtral Mini 3B 2507 WebGPU ASR worker
(issue #169): adds Voxtral3BAsrInitMessage, extends AsrWorkerInMessage,
adds 'voxtral-3b' to AsrEngineType, and adds 'voxtral-3b-webgpu' to the
asrWorkerType union.

Also moves 'cohere-transcribe' from StreamAsrEngineType to AsrEngineType.
This completes the reclassification started in f3297e46 (PR #168), which
changed Cohere's manifest `type` from 'asr-stream' to 'asr' but left the
matching `asrEngine` identifier in the streaming union by oversight. Pure
type-level move — no runtime behavior change.
EOF
)"
```

---

### Task 2: Add the model manifest entry

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (insert new entry after the Voxtral 4B block ending at line 830)

- [ ] **Step 1: Insert the Voxtral 3B manifest entry**

In `src/lib/local-inference/modelManifest.ts`, insert the following **between** the closing `},` of the Voxtral 4B entry (line 830) and the `// ── Cohere Transcribe WebGPU ASR ────...` comment (line 832):

```typescript
  // ── Voxtral Mini 3B 2507 WebGPU ASR ────────────────────────────────────────
  // Downloaded from onnx-community repo on HuggingFace Hub. Uses hfModelId.
  // Voxtral Mini 3B (2507) — offline/batch model with explicit language hint
  // via chat template ("lang:XX [TRANSCRIBE]"). 8 supported languages.
  // Note: 3B repo has no embed_tokens_q4f16; q4f16 variant mixes q4 embeddings
  // with q4f16 audio encoder + decoder.
  {
    id: 'voxtral-mini-3b-webgpu',
    type: 'asr',
    name: 'Voxtral Mini 3B 2507 (WebGPU)',
    languages: ['en', 'es', 'fr', 'pt', 'hi', 'de', 'nl', 'it'],
    multilingual: true,
    hfModelId: 'onnx-community/Voxtral-Mini-3B-2507-ONNX',
    requiredDevice: 'webgpu',
    asrEngine: 'voxtral-3b',
    asrWorkerType: 'voxtral-3b-webgpu',
    variants: {
      'q4f16': {
        // 3B has no embed_tokens_q4f16 → use q4 for embeddings
        dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4', decoder_model_merged: 'q4f16' },
        files: [
          // Config & tokenizer (shared across variants)
          { filename: 'config.json', sizeBytes: 2_161 },
          { filename: 'generation_config.json', sizeBytes: 107 },
          { filename: 'preprocessor_config.json', sizeBytes: 357 },
          { filename: 'special_tokens_map.json', sizeBytes: 414 },
          { filename: 'chat_template.jinja', sizeBytes: 989 },
          { filename: 'tokenizer.json', sizeBytes: 12_603_078 },
          { filename: 'tokenizer_config.json', sizeBytes: 178_296 },
          { filename: 'tekken.json', sizeBytes: 14_894_206 },
          // ONNX model files (q4f16 audio+decoder, q4 embed)
          { filename: 'onnx/audio_encoder_q4f16.onnx', sizeBytes: 403_958 },
          { filename: 'onnx/audio_encoder_q4f16.onnx_data', sizeBytes: 383_696_896 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx', sizeBytes: 308_330 },
          { filename: 'onnx/decoder_model_merged_q4f16.onnx_data', sizeBytes: 2_065_283_072 },
          { filename: 'onnx/embed_tokens_q4.onnx', sizeBytes: 542 },
          { filename: 'onnx/embed_tokens_q4.onnx_data', sizeBytes: 251_658_240 },
        ],
        requiredFeatures: ['shader-f16'],
      },
      'q4': {
        dtype: { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' },
        files: [
          // Config & tokenizer (shared across variants)
          { filename: 'config.json', sizeBytes: 2_161 },
          { filename: 'generation_config.json', sizeBytes: 107 },
          { filename: 'preprocessor_config.json', sizeBytes: 357 },
          { filename: 'special_tokens_map.json', sizeBytes: 414 },
          { filename: 'chat_template.jinja', sizeBytes: 989 },
          { filename: 'tokenizer.json', sizeBytes: 12_603_078 },
          { filename: 'tokenizer_config.json', sizeBytes: 178_296 },
          { filename: 'tekken.json', sizeBytes: 14_894_206 },
          // ONNX model files (q4)
          { filename: 'onnx/audio_encoder_q4.onnx', sizeBytes: 401_545 },
          { filename: 'onnx/audio_encoder_q4.onnx_data', sizeBytes: 440_238_080 },
          { filename: 'onnx/decoder_model_merged_q4.onnx', sizeBytes: 306_657 },
          { filename: 'onnx/decoder_model_merged_q4.onnx_data', sizeBytes: 2_073_260_032 },
          { filename: 'onnx/decoder_model_merged_q4.onnx_data_1', sizeBytes: 251_658_240 },
          { filename: 'onnx/embed_tokens_q4.onnx', sizeBytes: 542 },
          { filename: 'onnx/embed_tokens_q4.onnx_data', sizeBytes: 251_658_240 },
        ],
      },
    },
    recommended: true,
    sortOrder: 3,
  },

```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): add Voxtral Mini 3B 2507 WebGPU manifest entry

Registers onnx-community/Voxtral-Mini-3B-2507-ONNX with q4f16 and q4
variants. 8 languages (en, es, fr, pt, hi, de, nl, it). sortOrder: 3
places it after Cohere (1) and 4B Realtime (2). Worker file and engine
wiring arrive in subsequent commits.

File sizes sourced from the HF API
(huggingface.co/api/models/onnx-community/Voxtral-Mini-3B-2507-ONNX/tree/main).
EOF
)"
```

---

### Task 3: Create the worker file

**Files:**
- Create: `src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts`

- [ ] **Step 1: Create the worker file**

Create `src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts` with the following complete contents:

```typescript
/**
 * Voxtral Mini 3B 2507 WebGPU ASR Worker
 *
 * Streaming audio input (Int16@24kHz) → Silero VAD v5 → Voxtral Mini 3B (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Unlike Voxtral 4B Realtime (continuous streaming inference), 3B is an
 * offline/batch model decoded on complete VAD-gated utterances. Token-level
 * streaming is provided by TextStreamer during each batch inference.
 *
 * Key feature over 4B: explicit language hint injected into the processor
 * chat template as `lang:XX [TRANSCRIBE]` for the 8 supported languages
 * (en, es, fr, pt, hi, de, nl, it). Falls back to bare `[TRANSCRIBE]` for
 * unsupported codes (auto-detect).
 *
 * Input messages:  Voxtral3BAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' }
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, speech_start, partial, result, error, disposed)
 */

import {
  VoxtralForConditionalGeneration,
  VoxtralProcessor,
  TextStreamer,
  env,
  type ProgressInfo,
} from '@huggingface/transformers';
import { InferenceSession, Tensor, env as ortEnv } from 'onnxruntime-web';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

import type {
  Voxtral3BAsrInitMessage,
  AsrAudioMessage,
  AsrDisposeMessage,
  StreamingAsrWorkerOutMessage,
} from '../types';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// Workaround: HF CDN Range request cache pollution (same as Voxtral 4B / Cohere workers)
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

type WorkerMessage = Voxtral3BAsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' };

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

async function initVad(vadConfig?: Voxtral3BAsrInitMessage['vadConfig'], vadModelUrl?: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });
  vadSession = {
    session,
    state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
  };

  const positiveSpeechThreshold = vadConfig?.threshold ?? 0.3;
  const negativeSpeechThreshold = vadConfig?.negativeThreshold ?? 0.25;
  const redemptionMs = (vadConfig?.minSilenceDuration ?? 1.4) * 1000;
  const minSpeechMs = (vadConfig?.minSpeechDuration ?? 0.4) * 1000;
  const preSpeechPadMs = (vadConfig?.preSpeechPadDuration ?? 0.8) * 1000;
  const maxSpeechDurationMs = (vadConfig?.maxSpeechDuration ?? 20) * 1000;

  maxSpeechFrames = Math.ceil(maxSpeechDurationMs / VAD_FRAME_MS);

  frameProcessor = new FrameProcessor(
    vadInfer,
    vadResetStates,
    {
      positiveSpeechThreshold,
      negativeSpeechThreshold,
      redemptionMs,
      minSpeechMs,
      preSpeechPadMs,
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

// ─── Voxtral 3B Model State ─────────────────────────────────────────────────

let model: any = null;            // VoxtralForConditionalGeneration instance
let processor: any = null;        // VoxtralProcessor instance
let currentLanguage: string | undefined;
let processingVad = false;
let currentDecodePromise: Promise<void> | null = null;

// 8 languages natively supported by Voxtral 3B 2507
const SUPPORTED_LANGS = new Set(['en', 'es', 'fr', 'pt', 'hi', 'de', 'nl', 'it']);

function normalizeToIso639_1(lang: string | undefined): string {
  if (!lang) return '';
  // Strip region suffix: 'en-US' → 'en', 'zh_Hans' → 'zh'
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Create customCache bridge for IndexedDB blob URLs → Transformers.js.
 * Maps HF Hub resolve URLs to local blob URLs from IndexedDB.
 * Same pattern as whisper-webgpu, voxtral-webgpu, and cohere-transcribe-webgpu workers.
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

// ─── Batch Speech Segment Processing ────────────────────────────────────────

/**
 * Run Voxtral 3B inference on a completed speech segment.
 * Builds a chat-template prompt with optional `lang:XX [TRANSCRIBE]` hint,
 * uses TextStreamer for token-level partial results, and emits a final
 * `result` message when decoding completes.
 *
 * Serializes decode calls via currentDecodePromise to prevent overlapping
 * generate() invocations if VAD end-events arrive back-to-back.
 */
function runVoxtral3B(audio: Float32Array): Promise<void> {
  const promise = (async () => {
    if (currentDecodePromise) {
      try { await currentDecodePromise; } catch { /* already reported */ }
    }
    if (!model || !processor) return;

    const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
    const startTime = performance.now();
    let accumulatedText = '';

    try {
      // 1. Build chat-template prompt with optional language hint
      const langCode = normalizeToIso639_1(currentLanguage);
      const hintedText = SUPPORTED_LANGS.has(langCode)
        ? `lang:${langCode} [TRANSCRIBE]`
        : '[TRANSCRIBE]';

      const conversation = [
        {
          role: 'user',
          content: [
            { type: 'audio' },
            { type: 'text', text: hintedText },
          ],
        },
      ];
      const promptText = processor.apply_chat_template(conversation, { tokenize: false });

      // 2. Processor builds mel features + input_ids from prompt + audio
      const inputs = await processor(promptText, audio);

      // 3. TextStreamer streams decoded tokens as partials
      const streamer = new TextStreamer(processor.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (token: string) => {
          accumulatedText += token;
          post({ type: 'partial', text: accumulatedText });
        },
      });

      // 4. Generate (batch decode, not streaming input like 4B)
      const outputs = await model.generate({
        ...inputs,
        max_new_tokens: 500,
        streamer,
      });

      // 5. Canonical final decode: slice prompt tokens, then batch_decode.
      //    Falls back to `accumulatedText` if slice/decode is unavailable in this
      //    transformers.js version (defensive; should not happen on ≥3.7).
      let finalText = accumulatedText.trim();
      try {
        const promptLen = inputs.input_ids.dims.at(-1)!;
        const generated = outputs.slice(null, [promptLen, null]);
        const decoded = processor.batch_decode(generated, { skip_special_tokens: true });
        const candidate = Array.isArray(decoded) ? decoded[0] : decoded;
        if (candidate && typeof candidate === 'string' && candidate.trim()) {
          finalText = candidate.trim();
        }
      } catch {
        // Keep accumulatedText as finalText
      }

      if (finalText) {
        post({
          type: 'result',
          text: finalText,
          durationMs,
          recognitionTimeMs: Math.round(performance.now() - startTime),
        });
      }
    } catch (err: any) {
      post({ type: 'error', error: `Voxtral 3B inference failed: ${err?.message || err}` });
    }
  })();

  currentDecodePromise = promise;
  return promise;
}

// ─── VAD + Audio Feed Pipeline ──────────────────────────────────────────────

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || !model || processingVad) return;
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
            await runVoxtral3B(ev.audio);
            break;

          case Message.VADMisfire:
            speechFramesSinceStart = 0;
            break;
        }
      }

      // Max speech duration cap — force-finalize if speech runs too long
      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) {
              await runVoxtral3B(ev.audio);
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

async function handleInit(msg: Voxtral3BAsrInitMessage): Promise<void> {
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
    await initVad(msg.vadConfig, msg.vadModelUrl);

    // 2. Configure Transformers.js for IndexedDB blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    // 3. Load processor
    post({ type: 'status', message: 'Loading Voxtral 3B processor...' });
    processor = await VoxtralProcessor.from_pretrained(msg.hfModelId);

    // 4. Load model (WebGPU)
    post({ type: 'status', message: 'Loading Voxtral 3B model (WebGPU)...' });
    model = await VoxtralForConditionalGeneration.from_pretrained(msg.hfModelId, {
      dtype: msg.dtype as any,
      device: 'webgpu',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress' && info.file?.endsWith('.onnx_data') && (info as any).total > 0) {
          const pct = Math.round(((info as any).loaded / (info as any).total) * 100);
          post({ type: 'status', message: `Loading model... ${pct}%` });
        }
      },
    });

    currentLanguage = msg.language;

    // 5. Log chosen language hint for operator visibility
    const langCode = normalizeToIso639_1(currentLanguage);
    if (SUPPORTED_LANGS.has(langCode)) {
      post({ type: 'status', message: `Voxtral 3B language hint: lang:${langCode} [TRANSCRIBE]` });
    } else if (currentLanguage) {
      post({ type: 'status', message: `Voxtral 3B: source language '${currentLanguage}' not in supported set; using auto-detect` });
    }

    // Reset buffers
    vadAudioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err?.message || String(err) });
  }
}

// ─── Flush & Dispose ────────────────────────────────────────────────────────

async function handleFlush(): Promise<void> {
  // Force-finalize any pending speech via FrameProcessor (PTT release path)
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runVoxtral3B(ev.audio);
      }
    }
  }
  // Wait for any in-flight decode to complete
  if (currentDecodePromise) {
    try { await currentDecodePromise; } catch { /* already reported */ }
  }
}

async function handleDispose(): Promise<void> {
  // Flush remaining speech
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runVoxtral3B(ev.audio);
      }
    }
  }

  // Wait for any in-flight decode to complete before disposing
  if (currentDecodePromise) {
    try { await currentDecodePromise; } catch { /* already reported */ }
    currentDecodePromise = null;
  }

  // Dispose FrameProcessor
  frameProcessor = null;
  speechFramesSinceStart = 0;

  // Dispose VAD
  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  // Dispose model and processor
  if (model) {
    try { await (model as any).dispose?.(); } catch { /* ignore */ }
    model = null;
  }
  processor = null;
  currentLanguage = undefined;

  vadAudioBuffer = new Float32Array(0);
  processingVad = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as Voxtral3BAsrInitMessage);
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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors. If `VoxtralForConditionalGeneration` or `VoxtralProcessor` are not found, verify that `@huggingface/transformers` is ≥ 3.7 (the project is on 4.2.0, so this should not happen): `node -e "console.log(require('@huggingface/transformers/package.json').version)"`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): add Voxtral 3B WebGPU worker (batch ASR)

Module worker wrapping VoxtralForConditionalGeneration + VoxtralProcessor.
Uses Cohere-style VAD-gated batch decode: SpeechEnd → apply_chat_template
with optional lang:XX hint → generate with TextStreamer for token-level
partial results.

Language hint covers 8 Voxtral 3B 2507 languages (en/es/fr/pt/hi/de/nl/it);
unsupported codes fall back to bare [TRANSCRIBE] auto-detect.

Not yet wired into AsrEngine — that arrives in the next commit.
EOF
)"
```

---

### Task 4: Wire the worker into AsrEngine

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:84-106` (worker switch)
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:165` (init message condition)
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:5-9` (header comment — optional hygiene)

- [ ] **Step 1: Add the `voxtral-3b-webgpu` case to the worker switch**

In `src/lib/local-inference/engine/AsrEngine.ts`, the switch at lines 84-106 currently reads:

```typescript
      switch (workerType) {
        case 'whisper-webgpu':
          this.worker = new Worker(
            new URL('../workers/whisper-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'cohere-transcribe-webgpu':
          this.worker = new Worker(
            new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'granite-speech-webgpu':
          this.worker = new Worker(
            new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        default: // sherpa-onnx
          this.worker = new Worker('./workers/sherpa-onnx-asr.worker.js');
          break;
      }
```

Insert a new `case 'voxtral-3b-webgpu'` **between** the `cohere-transcribe-webgpu` case and the `granite-speech-webgpu` case, so the switch reads:

```typescript
      switch (workerType) {
        case 'whisper-webgpu':
          this.worker = new Worker(
            new URL('../workers/whisper-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'cohere-transcribe-webgpu':
          this.worker = new Worker(
            new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'voxtral-3b-webgpu':
          this.worker = new Worker(
            new URL('../workers/voxtral-3b-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'granite-speech-webgpu':
          this.worker = new Worker(
            new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        default: // sherpa-onnx
          this.worker = new Worker('./workers/sherpa-onnx-asr.worker.js');
          break;
      }
```

- [ ] **Step 2: Extend the init-message condition to cover voxtral-3b-webgpu**

In `src/lib/local-inference/engine/AsrEngine.ts`, line 165 currently reads:

```typescript
      if (workerType === 'whisper-webgpu' || workerType === 'cohere-transcribe-webgpu') {
```

Change it to:

```typescript
      if (workerType === 'whisper-webgpu' || workerType === 'cohere-transcribe-webgpu' || workerType === 'voxtral-3b-webgpu') {
```

The init message payload inside this branch (fileUrls / hfModelId / language / vadConfig / dtype / ortWasmBaseUrl / vadModelUrl) already matches the `Voxtral3BAsrInitMessage` shape — no other change is needed in this block.

Note: **Do NOT** add a `workerType === 'voxtral-3b-webgpu' && !language` guard (the pattern used for Cohere at lines 78-80). The 3B worker handles missing/unsupported language by falling back to bare `[TRANSCRIBE]`.

- [ ] **Step 3: Update the header comment (hygiene)**

In `src/lib/local-inference/engine/AsrEngine.ts`, the header comment at lines 5-9 currently reads:

```typescript
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): VAD + OfflineRecognizer via Emscripten/WASM
 * - whisper-webgpu (module Worker): VAD + Whisper via Transformers.js/WebGPU
 * - cohere-transcribe-webgpu (module Worker): VAD + Cohere Transcribe via Transformers.js/WebGPU
 */
```

Add a line for the new worker so the list reads:

```typescript
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): VAD + OfflineRecognizer via Emscripten/WASM
 * - whisper-webgpu (module Worker): VAD + Whisper via Transformers.js/WebGPU
 * - cohere-transcribe-webgpu (module Worker): VAD + Cohere Transcribe via Transformers.js/WebGPU
 * - voxtral-3b-webgpu (module Worker): VAD + Voxtral 3B (with lang hint) via Transformers.js/WebGPU
 * - granite-speech-webgpu (module Worker): VAD + Granite Speech via Transformers.js/WebGPU
 */
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Verify the app builds**

Run: `npm run build 2>&1 | tail -30`
Expected: Build succeeds. Look for a new bundled chunk corresponding to `voxtral-3b-webgpu.worker.ts` in the output (e.g. `voxtral-3b-webgpu.worker-<hash>.js`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): wire Voxtral 3B WebGPU worker into AsrEngine

Adds the switch case and extends the WebGPU init-message condition so
AsrEngine routes `asrWorkerType: 'voxtral-3b-webgpu'` to the new worker.
Same init shape as whisper-webgpu / cohere-transcribe-webgpu — no
LocalInferenceClient change needed (already dispatches by manifest type).

Closes the integration loop for issue #169.
EOF
)"
```

---

### Task 5: Manual integration test

**Files:** None (testing only)

WebGPU workers cannot be meaningfully exercised in unit tests — this task validates end-to-end in a real browser.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Dev server starts on port 5173.

- [ ] **Step 2: Verify the model appears in the ASR selector**

1. Open `http://localhost:5173` in Chrome or Edge (WebGPU required; Firefox/Safari will not see WebGPU models).
2. Switch the provider to **Local Inference**.
3. Set source language to **English** (or any of es/fr/pt/hi/de/nl/it).
4. Open Model Management.
5. Confirm **"Voxtral Mini 3B 2507 (WebGPU)"** appears in the ASR model list.
6. Confirm its listed size is reasonable (~2.7 GB for q4f16 on shader-f16 GPUs, ~3.0 GB for q4 elsewhere).
7. Set source language to **Japanese** and re-open the selector. Confirm Voxtral 3B is **hidden** (manifest `languages` filter excludes ja).

- [ ] **Step 3: Download the model**

1. With source language set back to a supported code (e.g. English), click **Download** on Voxtral Mini 3B 2507.
2. Watch progress indication — IndexedDB download should populate all files listed in the manifest.
3. Confirm status turns to "downloaded" when complete.

- [ ] **Step 4: Run a transcription session and confirm the language hint is applied**

1. Select **Voxtral Mini 3B 2507 (WebGPU)** as the ASR model.
2. Open the browser DevTools **Console** — the worker posts `status` messages through `AsrEngine.onStatus`, which the app logs.
3. Start a session. Watch for a status line like:
   `Voxtral 3B language hint: lang:en [TRANSCRIBE]`
4. Speak a short English sentence into the mic. Confirm:
   - A `speech_start` event arrives (microphone indicator animates).
   - Partial results appear token-by-token during decode.
   - A final `result` is emitted when VAD detects silence.
5. Stop the session.

- [ ] **Step 5: Confirm language hint takes effect for a non-English language**

1. Change source language to **German** (`de`) — still a supported code.
2. Start a new session. Confirm a new status line:
   `Voxtral 3B language hint: lang:de [TRANSCRIBE]`
3. Speak a short German sentence. Confirm transcription output is in German script (not romanized English).
4. For a sanity-check comparison, repeat the same audio against Voxtral 4B Realtime (which has no language hint) — 3B's output should be noticeably more accurate when the speaker is clearly German.

- [ ] **Step 6: Confirm q4 fallback on non-shader-f16 GPUs (if available)**

If a second machine/browser without `shader-f16` support is available:
1. Open the app there; confirm Voxtral 3B still appears.
2. Download and run — the q4 variant is selected automatically by `selectVariant()` in `modelManifest.ts`.
3. Transcription works (slower than q4f16, but functional).

Skip this step if only one GPU configuration is available.

- [ ] **Step 7: Confirm clean teardown**

1. End an active session.
2. In the browser DevTools **Application → IndexedDB** and **Memory** tabs, confirm there is no growing WebGPU memory / worker leak after 3-4 consecutive session cycles.
3. The worker should emit a `disposed` message (visible in console logs) on session end.

- [ ] **Step 8: Commit any fixes discovered during testing**

If any issue required a code fix, commit it:

```bash
git add -A
git commit -m "fix(local-inference): address Voxtral 3B integration test findings"
```

If no fixes were needed, skip this step.

---

## Spec Coverage Check

| Spec section | Task |
|---|---|
| Placement & engine routing (`type: 'asr'`, `AsrEngine`) | Tasks 2, 4 |
| New identifiers (`voxtral-3b`, `voxtral-3b-webgpu`, `voxtral-mini-3b-webgpu`) | Tasks 1, 2 |
| Data flow (VAD → batch decode) | Task 3 |
| Dedicated new worker (not reusing 4B/Cohere) | Task 3 |
| IndexedDB blob URL cache bridge (`createBlobUrlCache`) | Task 3 |
| Chat-template `lang:XX [TRANSCRIBE]` injection + normalization | Task 3 |
| TextStreamer partial results | Task 3 |
| Recommended + `sortOrder: 3` | Task 2 |
| q4f16 + q4 variants with `requiredFeatures` | Task 2 |
| `LocalInferenceClient` **no change** | (verified by running the build in Task 4) |
| Model Management UI **no change** | (manifest auto-discovered; confirmed in Task 5 Step 2) |
| Unsupported-language fallback to bare `[TRANSCRIBE]` | Task 3 (`runVoxtral3B`) |
| Region-suffix normalization (`en-US` → `en`) | Task 3 (`normalizeToIso639_1`) |
| `shader-f16` fallback to q4 | Task 2 (`requiredFeatures`) + Task 5 Step 6 (verification) |
| WebGPU unavailable → hidden | Task 2 (`requiredDevice: 'webgpu'`) + Task 5 Step 2 (verification) |
| Long-utterance cap via VAD max-speech-duration | Task 3 (`maxSpeechFrames` loop) |
| `flush` (PTT) path | Task 3 (`handleFlush`) |
| Translate task (`task: 'translate'`) **ignored in v1** | Task 3 (not consumed in worker; `taskConfig` not forwarded for this workerType in Task 4 Step 2) |
| Serialized decode via `currentDecodePromise` | Task 3 |

All spec items are covered.
