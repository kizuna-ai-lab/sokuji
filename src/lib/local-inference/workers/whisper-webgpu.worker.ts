/**
 * Whisper WebGPU ASR Worker — Production integration
 *
 * Streaming audio input (Int16@24kHz) → Silero VAD v5 (via vad-web FrameProcessor) → Whisper ASR (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * VAD logic delegates to @ricky0123/vad-web's FrameProcessor, which handles
 * dual-threshold hysteresis, pre-speech padding, redemption grace period,
 * and minimum speech duration checks.
 *
 * Input messages:  WhisperAsrInitMessage | AsrAudioMessage | AsrDisposeMessage
 * Output messages: AsrWorkerOutMessage (ready, status, result, error, disposed)
 */

import {
  pipeline,
  env,
  AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import {InferenceSession, Tensor, env as ortEnv} from 'onnxruntime-web';
import {FrameProcessor, Message} from '@ricky0123/vad-web';
import type {FrameProcessorEvent} from '@ricky0123/vad-web/dist/frame-processor';

import type {
  WhisperAsrInitMessage,
  AsrAudioMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// Workaround: HF CDN redirects /resolve/main/ → /api/resolve-cache/...
// Range: bytes=0-0 metadata requests get cached as 206 partial responses,
// then pollute subsequent full downloads. Fix: no-store for Range requests.
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
    return _origFetch(input, {...init, cache: 'no-store'});
  }
  return _origFetch(input, init);
};

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerMessage = WhisperAsrInitMessage | AsrAudioMessage | AsrDisposeMessage;

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Silero VAD v5 — ORT Session ────────────────────────────────────────────
// We keep the raw ORT InferenceSession for Silero VAD v5 inference,
// but delegate all state machine logic to vad-web's FrameProcessor.

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000; // 32ms

interface VadSession {
  session: InferenceSession;
  /** Combined LSTM state: [2, 1, 128] */
  state: Tensor;
}

let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;

// Max speech duration cap (not built into FrameProcessor)
let maxSpeechFrames = 625; // ~20s at 32ms/frame
let speechFramesSinceStart = 0;

// For startSample tracking in result messages
let totalSamplesFed = 0;
let speechStartSample = 0;

// ─── VAD Diagnostic Logging ─────────────────────────────────────────────────
const VAD_DEBUG = false;

function vadLog(...args: unknown[]) {
  if (VAD_DEBUG) console.debug('[whisper-vad]', ...args);
}

/**
 * Run VAD on a single 512-sample frame.
 * Returns { isSpeech, notSpeech } as expected by vad-web's FrameProcessor.
 */
async function vadInfer(frame: Float32Array): Promise<{isSpeech: number; notSpeech: number}> {
  if (!vadSession) return {isSpeech: 0, notSpeech: 1};

  const input = new Tensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);

  const result = await vadSession.session.run({
    input,
    sr,
    state: vadSession.state,
  });

  vadSession.state = result.stateN as Tensor;
  const prob = (result.output as Tensor).data[0] as number;
  return {isSpeech: prob, notSpeech: 1 - prob};
}

/**
 * Reset LSTM states (called by FrameProcessor on reset/endSegment).
 */
function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(config?: WhisperAsrInitMessage['vadConfig'], vadModelUrl?: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });

  vadSession = {
    session,
    state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
  };

  // Map config values (seconds) to FrameProcessor options (ms).
  // Defaults match @ricky0123/vad-web for proven reliability.
  const positiveSpeechThreshold = config?.threshold ?? 0.3;
  const negativeSpeechThreshold = config?.negativeThreshold ?? 0.25;
  const redemptionMs = (config?.minSilenceDuration ?? 1.4) * 1000;
  const minSpeechMs = (config?.minSpeechDuration ?? 0.4) * 1000;
  const preSpeechPadMs = (config?.preSpeechPadDuration ?? 0.8) * 1000;
  const maxSpeechDurationMs = (config?.maxSpeechDuration ?? 20) * 1000;

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

  // Reset tracking state
  totalSamplesFed = 0;
  speechStartSample = 0;
  speechFramesSinceStart = 0;

  vadLog('INIT posThreshold=', positiveSpeechThreshold,
    'negThreshold=', negativeSpeechThreshold,
    'redemptionMs=', redemptionMs, 'minSpeechMs=', minSpeechMs,
    'preSpeechPadMs=', preSpeechPadMs, 'maxSpeechFrames=', maxSpeechFrames);
}

// ─── Audio Buffer & Resampling ──────────────────────────────────────────────

/** Circular buffer for accumulating 16kHz audio for VAD frame extraction */
let audioBuffer = new Float32Array(0);

/**
 * Convert Int16@inputRate to Float32@16kHz via linear interpolation.
 */
function resampleInt16ToFloat32_16k(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / VAD_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    // Convert Int16 to Float32 [-1, 1] during interpolation
    const vLo = samples[lo] / 32768;
    const vHi = samples[hi] / 32768;
    out[i] = vLo + (vHi - vLo) * frac;
  }

  return out;
}

// ─── Whisper ASR ─────────────────────────────────────────────────────────────

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentLanguage: string | undefined;
let processingVad = false;

/**
 * Create customCache bridge for IndexedDB blob URLs → Transformers.js.
 * Same pattern as translation.worker.ts.
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

/**
 * Patch config.json and generation_config.json blobs for non-standard Whisper
 * models (e.g., lite-whisper) so Transformers.js loads them as standard Whisper.
 *
 * - config.json: fix model_type and architectures
 * - generation_config.json: add is_multilingual, lang_to_id, task_to_id
 */
async function patchWhisperConfigs(
  fileUrls: Record<string, string>,
  language?: string,
): Promise<void> {
  // --- Patch config.json: model_type & architectures ---
  if (fileUrls['config.json']) {
    try {
      const resp = await fetch(fileUrls['config.json']);
      const cfg = await resp.json();
      if (cfg.model_type && cfg.model_type !== 'whisper') {
        cfg.model_type = 'whisper';
        cfg.architectures = ['WhisperForConditionalGeneration'];
        const blob = new Blob([JSON.stringify(cfg)], {type: 'application/json'});
        URL.revokeObjectURL(fileUrls['config.json']);
        fileUrls['config.json'] = URL.createObjectURL(blob);
      }
    } catch { /* best-effort */ }
  }

  // --- Patch generation_config.json: multilingual fields ---
  if (language && fileUrls['generation_config.json']) {
    try {
      const resp = await fetch(fileUrls['generation_config.json']);
      const gc = await resp.json();
      if (!gc.is_multilingual) {
        gc.is_multilingual = true;
        // Token IDs from whisper-large-v3-turbo (shared by all turbo-based models)
        if (!gc.lang_to_id) {
          gc.lang_to_id = {"<|af|>":50327,"<|am|>":50334,"<|ar|>":50272,"<|as|>":50350,"<|az|>":50304,"<|ba|>":50355,"<|be|>":50330,"<|bg|>":50292,"<|bn|>":50302,"<|bo|>":50347,"<|br|>":50309,"<|bs|>":50315,"<|ca|>":50270,"<|cs|>":50283,"<|cy|>":50297,"<|da|>":50285,"<|de|>":50261,"<|el|>":50281,"<|en|>":50259,"<|es|>":50262,"<|et|>":50307,"<|eu|>":50310,"<|fa|>":50300,"<|fi|>":50277,"<|fo|>":50338,"<|fr|>":50265,"<|gl|>":50319,"<|gu|>":50333,"<|haw|>":50352,"<|ha|>":50354,"<|he|>":50279,"<|hi|>":50276,"<|hr|>":50291,"<|ht|>":50339,"<|hu|>":50286,"<|hy|>":50312,"<|id|>":50275,"<|is|>":50311,"<|it|>":50274,"<|ja|>":50266,"<|jw|>":50356,"<|ka|>":50329,"<|kk|>":50316,"<|km|>":50323,"<|kn|>":50306,"<|ko|>":50264,"<|la|>":50294,"<|lb|>":50345,"<|ln|>":50353,"<|lo|>":50336,"<|lt|>":50293,"<|lv|>":50301,"<|mg|>":50349,"<|mi|>":50295,"<|mk|>":50308,"<|ml|>":50296,"<|mn|>":50314,"<|mr|>":50320,"<|ms|>":50282,"<|mt|>":50343,"<|my|>":50346,"<|ne|>":50313,"<|nl|>":50271,"<|nn|>":50342,"<|no|>":50288,"<|oc|>":50328,"<|pa|>":50321,"<|pl|>":50269,"<|ps|>":50340,"<|pt|>":50267,"<|ro|>":50284,"<|ru|>":50263,"<|sa|>":50344,"<|sd|>":50332,"<|si|>":50322,"<|sk|>":50298,"<|sl|>":50305,"<|sn|>":50324,"<|so|>":50326,"<|sq|>":50317,"<|sr|>":50303,"<|su|>":50357,"<|sv|>":50273,"<|sw|>":50318,"<|ta|>":50287,"<|te|>":50299,"<|tg|>":50331,"<|th|>":50289,"<|tk|>":50341,"<|tl|>":50348,"<|tr|>":50268,"<|tt|>":50351,"<|uk|>":50280,"<|ur|>":50290,"<|uz|>":50337,"<|vi|>":50278,"<|yi|>":50335,"<|yo|>":50325,"<|yue|>":50358,"<|zh|>":50260};
        }
        if (!gc.task_to_id) {
          gc.task_to_id = {transcribe: 50360, translate: 50359};
        }
        const blob = new Blob([JSON.stringify(gc)], {type: 'application/json'});
        URL.revokeObjectURL(fileUrls['generation_config.json']);
        fileUrls['generation_config.json'] = URL.createObjectURL(blob);
      }
    } catch { /* best-effort */ }
  }
}

/** Detect WebGPU availability in this worker context */
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
 * Run Whisper on a completed speech audio segment.
 */
async function runWhisper(audio: Float32Array, startSample: number): Promise<void> {
  if (!transcriber) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);

  // Compute RMS energy for diagnostic purposes
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) sumSq += audio[i] * audio[i];
  const rms = Math.sqrt(sumSq / audio.length);
  vadLog('WHISPER_INPUT samples=', audio.length, 'dur=', durationMs, 'ms rms=', rms.toFixed(5));

  const startTime = performance.now();
  try {
    const options: Record<string, any> = {};
    if (currentLanguage) {
      options.language = currentLanguage;
      options.task = 'transcribe';
    }

    const result = await transcriber(audio, options);
    const recognitionTimeMs = Math.round(performance.now() - startTime);
    const text = (Array.isArray(result) ? result[0].text : result.text).trim();

    vadLog('WHISPER_OUTPUT text=', JSON.stringify(text), 'dur=', durationMs,
      'ms recog=', recognitionTimeMs, 'ms rms=', rms.toFixed(5));

    if (text) {
      post({
        type: 'result',
        text,
        startSample,
        durationMs,
        recognitionTimeMs,
      });
    }
  } catch (err: any) {
    post({type: 'error', error: `Whisper inference failed: ${err.message || err}`});
  }
}

// ─── Audio Feed Pipeline ────────────────────────────────────────────────────

/**
 * Process incoming audio chunk: resample → FrameProcessor (VAD) → Whisper
 */
async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || !transcriber || processingVad) return;
  processingVad = true;

  try {
    // Resample to Float32@16kHz
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);

    // Append to audio buffer
    const newBuf = new Float32Array(audioBuffer.length + resampled.length);
    newBuf.set(audioBuffer);
    newBuf.set(resampled, audioBuffer.length);
    audioBuffer = newBuf;

    // Process complete VAD frames
    while (audioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = audioBuffer.slice(0, VAD_FRAME_SAMPLES);
      audioBuffer = audioBuffer.slice(VAD_FRAME_SAMPLES);
      totalSamplesFed += VAD_FRAME_SAMPLES;

      // Collect events from FrameProcessor (callbacks are synchronous)
      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));

      // Handle events
      for (const ev of events) {
        switch (ev.msg) {
          case Message.SpeechStart:
            speechStartSample = totalSamplesFed - VAD_FRAME_SAMPLES;
            speechFramesSinceStart = 0;
            post({ type: 'speech_start' });
            vadLog('SPEECH_START');
            break;

          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            vadLog('SPEECH_END dur=',
              Math.round((ev.audio.length / VAD_SAMPLE_RATE) * 1000), 'ms');
            await runWhisper(ev.audio, speechStartSample);
            break;

          case Message.VADMisfire:
            speechFramesSinceStart = 0;
            vadLog('VAD_MISFIRE (too short, discarded)');
            break;
        }
      }

      // Max speech duration cap (not built into FrameProcessor)
      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          vadLog('MAX_DURATION flush frames=', speechFramesSinceStart);
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) {
              await runWhisper(ev.audio, speechStartSample);
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

async function handleInit(msg: WhisperAsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // Set ORT WASM paths from main thread's resolved URL.
    // Must set on BOTH env objects: transformers.js env (onnxruntime-web/webgpu)
    // and plain onnxruntime-web env (used by VAD InferenceSession).
    if (msg.ortWasmBaseUrl) {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
      if (ortEnv?.wasm) {
        ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
    }

    // 1. Check WebGPU
    const webgpuAvailable = await hasWebGPU();
    const device = webgpuAvailable ? 'webgpu' : 'wasm';

    post({type: 'status', message: `Loading Whisper model (${device})...`});

    // 2. Init Silero VAD + FrameProcessor
    post({type: 'status', message: 'Loading VAD model...'});
    await initVad(msg.vadConfig, msg.vadModelUrl);

    // 3. Fix incompatible configs before Transformers.js loads them.
    // Some ONNX conversions (e.g., lite-whisper-*-ONNX) have custom model_type
    // and architectures that Transformers.js doesn't recognize, plus incomplete
    // generation_config missing multilingual fields. Since the ONNX graph already
    // has the custom architecture baked in, we can safely present it as standard
    // Whisper to Transformers.js.
    await patchWhisperConfigs(msg.fileUrls, msg.language);

    // 4. Configure Transformers.js for IndexedDB blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    // 5. Create ASR pipeline
    post({type: 'status', message: `Loading Whisper model on ${device}...`});

    const dtype = msg.dtype ?? {
      encoder_model: webgpuAvailable ? 'fp32' : 'q8',
      decoder_model_merged: webgpuAvailable ? 'q4' : 'q8',
    };

    transcriber = (await pipeline('automatic-speech-recognition', msg.hfModelId, {
      device,
      dtype: dtype as any,
    })) as AutomaticSpeechRecognitionPipeline;

    currentLanguage = msg.language;

    // 5. WebGPU warmup: compile GPU shaders by running a tiny inference
    if (webgpuAvailable) {
      post({type: 'status', message: 'Warming up WebGPU shaders...'});
      try {
        const warmupOpts: Record<string, any> = {max_new_tokens: 1};
        if (currentLanguage) {
          warmupOpts.language = currentLanguage;
          warmupOpts.task = 'transcribe';
        }
        // Run through the full pipeline to warm up both encoder and decoder
        await transcriber(new Float32Array(16000), warmupOpts);
      } catch {
        // Warmup failure is non-fatal
        console.warn('[whisper-worker] Warmup failed, first inference may be slower');
      }
    }

    // Reset audio buffer
    audioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({type: 'ready', loadTimeMs});
  } catch (err: any) {
    post({type: 'error', error: err.message || String(err)});
  }
}

async function handleDispose(): Promise<void> {
  // Flush any remaining speech via FrameProcessor
  if (frameProcessor?.speaking) {
    vadLog('DISPOSE flushing remaining speech');
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        await runWhisper(ev.audio, speechStartSample);
      }
    }
  }

  // Dispose FrameProcessor
  frameProcessor = null;
  speechFramesSinceStart = 0;

  // Dispose VAD ORT session
  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  // Dispose Whisper
  if (transcriber) {
    await (transcriber as any).dispose?.();
    transcriber = null;
    currentLanguage = undefined;
  }

  audioBuffer = new Float32Array(0);
  processingVad = false;

  post({type: 'disposed'});
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as WhisperAsrInitMessage);
      break;
    case 'audio':
      await feedAudio((msg as AsrAudioMessage).samples, (msg as AsrAudioMessage).sampleRate);
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
