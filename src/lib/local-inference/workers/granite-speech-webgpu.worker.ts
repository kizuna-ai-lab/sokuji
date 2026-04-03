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

type WorkerMessage = GraniteSpeechInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' };

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

async function initVad(vadConfig?: GraniteSpeechInitMessage['vadConfig'], vadModelUrl?: string): Promise<void> {
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
    await initVad(msg.vadConfig, msg.vadModelUrl);

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
