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

    // 6. WebGPU warmup — compile shaders with a tiny dummy inference so the
    //    first real utterance doesn't pay the compilation cost. Matches the
    //    Cohere worker's pattern (cohere-transcribe-webgpu.worker.ts:344-354).
    post({ type: 'status', message: 'Warming up WebGPU shaders...' });
    try {
      const warmupAudio = new Float32Array(VAD_SAMPLE_RATE); // 1s of silence
      const warmupConversation = [
        {
          role: 'user',
          content: [
            { type: 'audio' },
            { type: 'text', text: '[TRANSCRIBE]' },
          ],
        },
      ];
      const warmupPrompt = processor.apply_chat_template(warmupConversation, { tokenize: false });
      const warmupInputs = await processor(warmupPrompt, warmupAudio);
      await model.generate({ ...warmupInputs, max_new_tokens: 1 });
    } catch {
      // Warmup failures are non-fatal — first real utterance may be slightly slower
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
