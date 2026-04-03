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

async function initVad(vadConfig?: CohereTranscribeAsrInitMessage['vadConfig'], vadModelUrl?: string): Promise<void> {
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

// ─── Cohere Transcribe ASR ──────────────────────────────────────────────────

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentLanguage: string | undefined;
let processingVad = false;
let currentTranscriptionPromise: Promise<void> | null = null;

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
 * Awaits any in-flight transcription before starting to prevent races with flush/dispose.
 */
function runTranscribe(audio: Float32Array): Promise<void> {
  const promise = (async () => {
    // Wait for any in-flight transcription to complete first
    if (currentTranscriptionPromise) {
      try { await currentTranscriptionPromise; } catch { /* already reported */ }
    }
    if (!transcriber) return;

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
    }
  })();

  currentTranscriptionPromise = promise;
  return promise;
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
    if (!msg.language) {
      throw new Error('Cohere Transcribe requires an explicit source language');
    }

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

async function handleFlush(): Promise<void> {
  // Force-finalize any pending speech via FrameProcessor
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runTranscribe(ev.audio);
      }
    }
  }
  // Wait for any in-flight transcription to complete
  if (currentTranscriptionPromise) {
    await currentTranscriptionPromise;
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

  // Wait for any in-flight transcription to complete before disposing
  if (currentTranscriptionPromise) {
    try { await currentTranscriptionPromise; } catch { /* already reported */ }
    currentTranscriptionPromise = null;
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
      await handleFlush();
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
