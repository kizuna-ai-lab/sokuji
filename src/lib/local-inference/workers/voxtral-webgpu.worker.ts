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
