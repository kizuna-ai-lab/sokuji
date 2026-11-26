/**
 * Cohere Transcribe WebGPU ASR Worker
 *
 * The turn detector's segments (16 kHz Float32 speech) → Cohere Transcribe (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Unlike Voxtral (continuous streaming inference), Cohere Transcribe runs batch
 * inference on complete speech segments. Token-level streaming is provided
 * by TextStreamer during each batch inference.
 *
 * This worker runs no VAD and takes no audio. Turn detection lives in turn-detector.worker.ts, which
 * cuts the turns and sends each segment here on `segmentPort`; SegmentInbox decodes them one at a
 * time, in arrival order, and answers the detector's drain marks.
 *
 * Input messages:  CohereTranscribeAsrInitMessage | AsrStopMessage | AsrDisposeMessage
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, partial, result, drained, error, disposed)
 */

import {
  pipeline,
  TextStreamer,
  env,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { VAD_SAMPLE_RATE } from './_shared/max-speech-frames';
import { SegmentInbox, type DecodeTag } from './_shared/segment-inbox';

import type {
  CohereTranscribeAsrInitMessage,
  AsrStopMessage,
  AsrDisposeMessage,
  StreamingAsrWorkerOutMessage,
} from '../types';
import { bindCheckedWebGpuAdapter } from './shaderF16Gate';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

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

type WorkerMessage = CohereTranscribeAsrInitMessage | AsrStopMessage | AsrDisposeMessage;

function post(msg: StreamingAsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Cohere Transcribe ASR ──────────────────────────────────────────────────

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentLanguage: string | undefined;
/** The detector's segments, decoded one at a time in arrival order; exists once the model is ready. */
let inbox: SegmentInbox | null = null;

// No engine limit: transformers.js splits a segment longer than 35 s at its
// quietest point and loses nothing — 30.8 s and 60.8 s segments transcribed
// completely in English and Chinese. The one rough edge is a cap of exactly
// 35 s, where the split leaves a stub as short as 0.1 s that is decoded
// without context and appended to the final; a stub that short produced one
// wrong word. Not worth a limit, since capping lower would cut more often.
// So the detector has none for this model either (modelManifest.ts).

// ─── Speech Segment Processing ──────────────────────────────────────────────

/**
 * Run Cohere Transcribe on one speech segment the detector cut. Called by the inbox, one segment at a
 * time, so decodes never overlap on the pipeline. TextStreamer emits partial results token-by-token
 * during inference, each tagged with the segment's press and epoch. Reports its own errors.
 */
async function transcribeSegment(audio: Float32Array, startSample: number, tag: DecodeTag): Promise<void> {
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
        post({ type: 'partial', text: accumulatedText, press: tag.press, epoch: tag.epoch });
      },
    });

    const options: Record<string, any> = {
      // 1024 plus the 10-token prompt overruns the decoder's 1024
      // positions: a decode that never emits EOS throws in
      // GatherBlockQuantized at sequence length 1025, and this worker's
      // catch posts only `error`, so the text of every chunk in the
      // segment is lost. Real speech needs at most ~280 per 35 s chunk
      // (4.5-6.2 tokens/s measured), and a lower cap also bounds the queue
      // stall a runaway costs.
      max_new_tokens: 448,
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
        startSample,
        durationMs,
        recognitionTimeMs,
        ...tag,
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Cohere Transcribe inference failed: ${err.message || err}` });
  }
}

/** A decode threw outside its own reporting (the inbox calls this; the segment was already acknowledged). */
function reportDecodeError(err: unknown): void {
  post({type: 'error', error: `Cohere Transcribe inference failed: ${(err as Error)?.message || err}`});
}

// ─── Init Handler ───────────────────────────────────────────────────────────

async function handleInit(msg: CohereTranscribeAsrInitMessage): Promise<void> {
  try {
    if (!msg.language) {
      throw new Error('Cohere Transcribe requires an explicit source language');
    }

    const startTime = performance.now();

    // 1. Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

    // 2. Load Cohere Transcribe pipeline
    post({ type: 'status', message: 'Loading Cohere Transcribe model (WebGPU)...' });

    await bindCheckedWebGpuAdapter(env.backends.onnx, msg.dtype, 'Cohere Transcribe');

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

    // 3. WebGPU warmup: compile shaders with a tiny inference
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

    // 4. Listen to the detector only now the model is ready: nothing it sends is lost, and
    // nothing is decoded before there is a pipeline to decode on.
    inbox = new SegmentInbox(msg.segmentPort, transcribeSegment, post, reportDecodeError);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err.message || String(err) });
  }
}

// ─── Dispose ────────────────────────────────────────────────────────────────

async function handleDispose(): Promise<void> {
  // Only reachable when the host waits for `disposed`. In the app, WorkerSession.dispose()
  // posts `dispose` and terminates this worker on the next line, so the wait below runs in the
  // worker harness only; Stop is meant to be immediate.

  // Stop listening and wait for the decode in flight; what still waits is dropped. Nothing can
  // then run against the pipeline released below.
  await inbox?.close();
  inbox = null;

  const cohereTranscriber = transcriber;
  transcriber = null;

  // Dispose transcriber
  if (cohereTranscriber) {
    await (cohereTranscriber as any).dispose?.();
    currentLanguage = undefined;
  }

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
