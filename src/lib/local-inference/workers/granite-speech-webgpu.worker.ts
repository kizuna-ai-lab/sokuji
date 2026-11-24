/**
 * Granite Speech WebGPU ASR/AST Worker
 *
 * The turn detector's segments (16 kHz Float32 speech) -> Granite Speech (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Supports two tasks via prompt switching:
 * - 'transcribe': ASR (speech-to-text)
 * - 'translate':  AST (speech-to-translated-text)
 *
 * This worker runs no VAD and takes no audio. Turn detection lives in turn-detector.worker.ts, which
 * cuts the turns and sends each segment here on `segmentPort`; SegmentInbox decodes them one at a
 * time, in arrival order, and answers the detector's drain marks.
 *
 * Input messages:  GraniteSpeechInitMessage | AsrStopMessage | AsrDisposeMessage
 * Output messages: AsrWorkerOutMessage (ready, status, result, drained, error, disposed)
 */

import {
  AutoProcessor,
  GraniteSpeechForConditionalGeneration,
  TextStreamer,
  env,
} from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { VAD_SAMPLE_RATE } from './_shared/max-speech-frames';
import { SegmentInbox, type DecodeTag } from './_shared/segment-inbox';

import type {
  GraniteSpeechInitMessage,
  AsrStopMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';

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

type WorkerMessage = GraniteSpeechInitMessage | AsrStopMessage | AsrDisposeMessage;

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Language Name Map ──────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish',
  pt: 'Portuguese', ja: 'Japanese', it: 'Italian', zh: 'Mandarin Chinese',
};

// The longest speech this engine is handed is the detector's limit for Granite (30 s, 20 s when
// translating; declared in modelManifest.ts): there is no audio-side limit, and the decode budget
// below removes the other one, so what is left is the model itself, which ends the transcript early
// at a sentence or speaker boundary. This worker never sees a longer segment.

// Output tokens budgeted per second of audio. The budget used to be a fixed
// 256, which real Japanese speakers (8.0-10.2 tokens/s) exhaust at about
// 29.5 s: the transcript stopped mid-sentence, sometimes mid-character, and
// was posted as an ordinary result. Decoding ends at EOS, so a larger budget
// costs nothing on a normal segment — token counts were identical at 256 and
// 1024 in every paired run.
const GRANITE_TOKENS_PER_SECOND = 14;
const GRANITE_MIN_NEW_TOKENS = 256;

// ─── Granite Speech Model ───────────────────────────────────────────────────

let processor: any = null;
let model: any = null;
let currentTask: 'transcribe' | 'translate' = 'transcribe';
let currentTargetLanguage: string | undefined;
/** The detector's segments, decoded one at a time in arrival order; exists once the model is ready. */
let inbox: SegmentInbox | null = null;

function buildPrompt(): string {
  if (currentTask === 'translate' && currentTargetLanguage) {
    const langName = LANGUAGE_NAMES[currentTargetLanguage] || currentTargetLanguage;
    return `<|audio|>Translate the speech to ${langName}`;
  }
  return '<|audio|>Transcribe the speech to text';
}

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
 * Run Granite on one speech segment the detector cut. Called by the inbox, one segment at a time, so
 * decodes never overlap on the model. Reports its own errors.
 */
async function runGraniteInferenceSegment(audio: Float32Array, startSample: number, tag: DecodeTag): Promise<void> {
  // Capture both references before the first await, so the body never reads the module globals
  // once it has suspended, whatever order dispose releases them in. The guard in
  // harness-consolidation.test.ts pins the captures above the first await.
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

    // Avoid the Granite ONNX export's block-pad reshape crash. The conformer runs
    // block attention with context_size = 200, and the export dropped the upstream
    // `if remainder > 0` guard on the block right-pad, so when the encoder frame
    // count (the input_features time dim) is an exact multiple of 200 the graph pads
    // a whole extra block and the reshape {1, T+200, 1024} -> {1, T/200, 200, 8, -1}
    // aborts in OrtRun. The 20 s max-speech cap hits it every time (T = 1000 = 5x200);
    // other lengths rarely. Append ~1 encoder frame of trailing silence (320 samples =
    // 20 ms @ 16 kHz = hop 160 x 2-frame stacking) and re-featurise until the count
    // clears the multiple. The pad falls in the segment's trailing silence, so the
    // transcript is unaffected; one append usually suffices (T and T+1 can't both be
    // multiples), and the 4-iteration bound guards against frame-boundary jitter.
    const BLOCK_SIZE = 200;
    const BLOCK_PAD_SAMPLES = 320;
    let paddedAudio = audio;
    let inputs = await p(text, paddedAudio, { sampling_rate: VAD_SAMPLE_RATE });
    for (
      let guard = 0;
      guard < 4 && inputs.input_features.dims[1] > 0 && inputs.input_features.dims[1] % BLOCK_SIZE === 0;
      guard++
    ) {
      const grown = new Float32Array(paddedAudio.length + BLOCK_PAD_SAMPLES);
      grown.set(paddedAudio);
      paddedAudio = grown;
      inputs = await p(text, paddedAudio, { sampling_rate: VAD_SAMPLE_RATE });
    }

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
      max_new_tokens: Math.max(
        GRANITE_MIN_NEW_TOKENS,
        Math.ceil((paddedAudio.length / VAD_SAMPLE_RATE) * GRANITE_TOKENS_PER_SECOND),
      ),
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
        ...tag,
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Granite inference failed: ${err.message || err}` });
  }
}

// ─── Message Handlers ───────────────────────────────────────────────────────

/** A decode threw outside its own reporting (the inbox calls this; the segment was already acknowledged). */
function reportDecodeError(err: unknown): void {
  post({type: 'error', error: `Granite inference failed: ${(err as Error)?.message || err}`});
}

async function handleInit(msg: GraniteSpeechInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    const webgpuAvailable = await hasWebGPU();
    if (!webgpuAvailable) {
      post({ type: 'error', error: 'WebGPU is not available. Granite Speech requires WebGPU.' });
      return;
    }

    // Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

    // Load processor and model
    post({ type: 'status', message: 'Loading Granite Speech model (WebGPU)...' });

    processor = await AutoProcessor.from_pretrained(msg.hfModelId);
    await bindCheckedWebGpuAdapter(env.backends.onnx, msg.dtype, 'Granite Speech');
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

    // Listen to the detector only now the model is ready: nothing it sends is lost, and
    // nothing is decoded before there is a model to decode on.
    inbox = new SegmentInbox(msg.segmentPort, runGraniteInferenceSegment, post, reportDecodeError);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err.message || String(err) });
  }
}

async function handleDispose(): Promise<void> {
  // Only reachable when the host waits for `disposed`. In the app, WorkerSession.dispose()
  // posts `dispose` and terminates this worker on the next line, so the wait below runs in the
  // worker harness only; Stop is meant to be immediate.

  // Stop listening and wait for the decode in flight; what still waits is dropped. Nothing can
  // then run against the model released below.
  await inbox?.close();
  inbox = null;

  const activeModel = model;
  model = null;

  if (activeModel) {
    await activeModel.dispose?.();
  }
  processor = null;
  currentTask = 'transcribe';
  currentTargetLanguage = undefined;

  post({ type: 'disposed' });
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
  }
};
