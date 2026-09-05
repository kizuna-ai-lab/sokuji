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
} from './_shared/transformers-all';
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import { resolveVadThresholds } from './_shared/vad-thresholds';

import type {
  GraniteSpeechInitMessage,
  AsrAudioMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

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

  const { positive: positiveSpeechThreshold, negative: negativeSpeechThreshold } = resolveVadThresholds(vadConfig);
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
let pendingGraniteDecode: Promise<void> | null = null;

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

/**
 * Queue one speech segment for decoding, serialized behind whatever decode is already running.
 *
 * Callers on the VAD path fire-and-forget this (`void scheduleGraniteInference(...)`): a decode
 * takes 0.5–2.5 s, and awaiting it inside `feedAudio` would keep `processingVad` true for that
 * long, so every audio message arriving meanwhile would hit the guard and be dropped — on
 * gapless audio that loses the start of the next utterance, and at the 20 s cap it loses words
 * at every boundary (#470). Same pattern as the voxtral-3b and qwen3-asr workers
 * (`currentDecodePromise`). Chaining on the previous promise keeps decodes strictly ordered and
 * never overlapping on the model. The returned promise never rejects:
 * `runGraniteInferenceSegment` reports its own errors.
 *
 * Overlapping VAD frames with an in-flight decode is safe only because the VAD runs on its own
 * ORT instance (`_shared/onnxruntime-all`) while the model runs on Transformers.js's — never
 * put a second session on the model's instance while a decode can be in flight (#469).
 */
function scheduleGraniteInference(audio: Float32Array, startSample: number): Promise<void> {
  const previousGraniteDecode = pendingGraniteDecode;
  const promise = (async () => {
    if (previousGraniteDecode) {
      try { await previousGraniteDecode; } catch { /* already reported */ }
    }
    await runGraniteInferenceSegment(audio, startSample);
  })();
  pendingGraniteDecode = promise;
  return promise;
}

async function runGraniteInferenceSegment(audio: Float32Array, startSample: number): Promise<void> {
  // Capture both references before the first await: handleDispose nulls the module globals
  // and only then drains the decode chain, so a decode already past this guard must not read
  // `model` / `processor` again after `await p(...)` — it would throw and post a spurious error.
  const p = processor;
  const m = model;
  if (!p || !m) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
  const startTime = performance.now();

  try {
    const content = buildPrompt();
    const messages = [{ role: 'user', content }];

    const text = p.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });

    const inputs = await p(text, audio, { sampling_rate: VAD_SAMPLE_RATE });

    // Collect output via streamer
    let accumulated = '';
    const streamer = new TextStreamer(p.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        accumulated += chunk;
      },
    });

    await m.generate({
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
            // Fire-and-forget: awaiting here would hold `processingVad` for the whole decode
            // and the guard at the top of this function would drop the audio arriving
            // meanwhile (#470). `scheduleGraniteInference` serializes decodes via
            // `pendingGraniteDecode`.
            void scheduleGraniteInference(ev.audio, speechStartSample);
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
          // See the SpeechEnd case above: fire-and-forget so no audio is dropped at the cap.
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) {
              void scheduleGraniteInference(ev.audio, speechStartSample);
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

    // ortEnv wasmPaths must be set before initVad's InferenceSession; the
    // transformers env is configured later via initTransformersEnv.
    if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
      ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const webgpuAvailable = await hasWebGPU();
    if (!webgpuAvailable) {
      post({ type: 'error', error: 'WebGPU is not available. Granite Speech requires WebGPU.' });
      return;
    }

    post({ type: 'status', message: 'Loading VAD model...' });
    await initVad(msg.vadConfig, msg.vadModelUrl);

    // Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

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
        void scheduleGraniteInference(ev.audio, speechStartSample);
      }
    }
  }
  // Drain the chain: `scheduleGraniteInference` assigns `pendingGraniteDecode` before
  // returning, so this picks up the decode just kicked off (behind anything already queued)
  // and the flush resolves once the utterance's text has been posted. Runs even when nothing
  // was speaking, so a flush issued mid-decode still waits for that decode.
  if (pendingGraniteDecode) {
    try { await pendingGraniteDecode; } catch { /* already reported */ }
  }
}

async function handleDispose(): Promise<void> {
  // Flush remaining speech; handleFlush waits for that decode to finish.
  await handleFlush();

  // Stop accepting new segments before touching the model: with `model` null, feedAudio
  // returns early and a queued runGraniteInferenceSegment exits at its guard.
  const activeModel = model;
  model = null;

  // A decode may have been queued between the flush's await and the line above; wait for it
  // so nothing runs against a disposed model. Not redundant with the drain in handleFlush.
  if (pendingGraniteDecode) {
    try { await pendingGraniteDecode; } catch { /* already reported */ }
    pendingGraniteDecode = null;
  }

  frameProcessor = null;
  speechFramesSinceStart = 0;

  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  if (activeModel) {
    await activeModel.dispose?.();
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
