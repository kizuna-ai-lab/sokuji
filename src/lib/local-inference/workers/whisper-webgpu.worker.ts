/**
 * Whisper WebGPU ASR Worker — Production integration
 *
 * The turn detector's segments (16 kHz Float32 speech) → Whisper ASR (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * This worker runs no VAD and takes no audio. Turn detection lives in turn-detector.worker.ts, which
 * cuts the turns and sends each segment here on `segmentPort`; SegmentInbox decodes them one at a
 * time, in arrival order, and answers the detector's drain marks.
 *
 * Input messages:  WhisperAsrInitMessage | AsrStopMessage | AsrDisposeMessage
 * Output messages: AsrWorkerOutMessage (ready, status, result, drained, error, disposed)
 */

import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from './_shared/transformers-all';
import {initTransformersEnv} from './_shared/transformers-env';
import {VAD_SAMPLE_RATE} from './_shared/max-speech-frames';
import {SegmentInbox, type DecodeTag} from './_shared/segment-inbox';

import type {
  WhisperAsrInitMessage,
  AsrStopMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';
import { whisperLanguage } from './whisperLanguage';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

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

type WorkerMessage = WhisperAsrInitMessage | AsrStopMessage | AsrDisposeMessage;

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// The longest segment this engine is handed, pre-speech pad included, is the detector's limit for
// Whisper (29 s, declared in modelManifest.ts): WhisperFeatureExtractor reads the first 480000
// samples (30 s) and drops the rest, and a window with no zero padding left can cut the
// no-timestamp decode short. The detector cuts there, so this worker never sees a longer segment.

// ─── Diagnostic Logging ─────────────────────────────────────────────────────
const VAD_DEBUG = false;

function vadLog(...args: unknown[]) {
  if (VAD_DEBUG) console.debug('[whisper-vad]', ...args);
}

// ─── Whisper ASR ─────────────────────────────────────────────────────────────

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentLanguage: string | undefined;
/** The detector's segments, decoded one at a time in arrival order; exists once the model is ready. */
let inbox: SegmentInbox | null = null;

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
/**
 * Whether this worker can run on the GPU — and, in the same step, WHICH adapter
 * it will run on. `acquireWebGpuAdapter` remembers it on the runtime env, so the
 * f16 gate checks the adapter the model actually loads on instead of requesting
 * a second one that could answer differently (#513).
 */
async function hasWebGPU(): Promise<boolean> {
  return !!(await acquireWebGpuAdapter(env.backends.onnx));
}

// ─── Speech Segment Processing ──────────────────────────────────────────────

/**
 * Run Whisper on one speech segment the detector cut and post its result. Called by the inbox, one segment at a
 * time, so decodes never overlap on the pipeline. Reports its own errors.
 */
async function runWhisperSegment(audio: Float32Array, startSample: number, tag: DecodeTag): Promise<void> {
  if (!transcriber) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);

  // Compute RMS energy for diagnostic purposes
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) sumSq += audio[i] * audio[i];
  const rms = Math.sqrt(sumSq / audio.length);
  vadLog('WHISPER_INPUT samples=', audio.length, 'dur=', durationMs, 'ms rms=', rms.toFixed(5));

  const startTime = performance.now();
  try {
    const options: Record<string, any> = {
      // Prevent decoder from looping on the same n-gram — mitigates Whisper
      // hallucination/repetition, especially with fp16 quantized models.
      no_repeat_ngram_size: 3,
    };
    const language = whisperLanguage(currentLanguage);
    if (language) {
      options.language = language;
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
        ...tag,
      });
    }
  } catch (err: any) {
    post({type: 'error', error: `Whisper inference failed: ${err.message || err}`});
  }
}

// ─── Message Handlers ───────────────────────────────────────────────────────

/** A decode threw outside its own reporting (the inbox calls this; the segment was already acknowledged). */
function reportDecodeError(err: unknown): void {
  post({type: 'error', error: `Whisper inference failed: ${(err as Error)?.message || err}`});
}

async function handleInit(msg: WhisperAsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // 1. Check WebGPU
    const webgpuAvailable = await hasWebGPU();
    const device = webgpuAvailable ? 'webgpu' : 'wasm';

    post({type: 'status', message: `Loading Whisper model (${device})...`});

    // 2. Fix incompatible configs before Transformers.js loads them.
    // Some ONNX conversions (e.g., lite-whisper-*-ONNX) have custom model_type
    // and architectures that Transformers.js doesn't recognize, plus incomplete
    // generation_config missing multilingual fields. Since the ONNX graph already
    // has the custom architecture baked in, we can safely present it as standard
    // Whisper to Transformers.js.
    await patchWhisperConfigs(msg.fileUrls, msg.language);

    // 3. Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

    // 4. Create ASR pipeline
    post({type: 'status', message: `Loading Whisper model on ${device}...`});

    const dtype = msg.dtype ?? {
      encoder_model: webgpuAvailable ? 'fp32' : 'q8',
      decoder_model_merged: webgpuAvailable ? 'q4' : 'q8',
    };

    await bindCheckedWebGpuAdapter(env.backends.onnx, dtype, 'Whisper');

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
        const warmupLanguage = whisperLanguage(currentLanguage);
        if (warmupLanguage) {
          warmupOpts.language = warmupLanguage;
          warmupOpts.task = 'transcribe';
        }
        // Run through the full pipeline to warm up both encoder and decoder
        await transcriber(new Float32Array(16000), warmupOpts);
      } catch {
        // Warmup failure is non-fatal
        console.warn('[whisper-worker] Warmup failed, first inference may be slower');
      }
    }

    // 6. Listen to the detector only now the model is ready: nothing it sends is lost, and
    // nothing is decoded before there is a pipeline to decode on.
    inbox = new SegmentInbox(msg.segmentPort, runWhisperSegment, post, reportDecodeError);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({type: 'ready', loadTimeMs});
  } catch (err: any) {
    post({type: 'error', error: err.message || String(err)});
  }
}

async function handleDispose(): Promise<void> {
  // Only reachable when the host waits for `disposed`. In the app, WorkerSession.dispose()
  // posts `dispose` and terminates this worker on the next line, so the wait below runs in the
  // worker harness only; Stop is meant to be immediate.

  // Stop listening and wait for the decode in flight; what still waits is dropped. Nothing can
  // then run against the pipeline released below.
  await inbox?.close();
  inbox = null;

  const activeTranscriber = transcriber;
  transcriber = null;

  // Dispose Whisper
  if (activeTranscriber) {
    await (activeTranscriber as any).dispose?.();
    currentLanguage = undefined;
  }

  post({type: 'disposed'});
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;
    case 'stop':
      inbox?.stop(msg.epoch);
      break;
    case 'dispose':
      await handleDispose();
      break;
    default:
      // Surface any unhandled message type instead of ignoring it, so a message the router
      // forgot to handle is loud, not silent.
      console.warn('[whisper-worker] Unhandled message type:', (msg as { type?: string }).type);
  }
};
