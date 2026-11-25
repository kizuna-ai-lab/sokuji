/**
 * Voxtral Mini 3B 2507 WebGPU ASR Worker
 *
 * The turn detector's segments (16 kHz Float32 speech) → Voxtral Mini 3B (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge.
 *
 * Unlike Voxtral 4B Realtime (continuous streaming inference), 3B is an
 * offline/batch model decoded on complete utterances. Token-level
 * streaming is provided by TextStreamer during each batch inference.
 *
 * Key feature over 4B: explicit language hint injected into the processor
 * chat template as `lang:XX [TRANSCRIBE]` for the 8 supported languages
 * (en, es, fr, pt, hi, de, nl, it). Falls back to bare `[TRANSCRIBE]` for
 * unsupported codes (auto-detect).
 *
 * This worker runs no VAD and takes no audio. Turn detection lives in turn-detector.worker.ts, which
 * cuts the turns and sends each segment here on `segmentPort`; SegmentInbox decodes them one at a
 * time, in arrival order, and answers the detector's drain marks.
 *
 * Input messages:  Voxtral3BAsrInitMessage | AsrStopMessage | AsrDisposeMessage
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, partial, result, drained, error, disposed)
 */

import {
  VoxtralForConditionalGeneration,
  VoxtralProcessor,
  TextStreamer,
  env,
  type ProgressInfo,
} from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { VAD_SAMPLE_RATE } from './_shared/max-speech-frames';
import { SegmentInbox, type DecodeTag } from './_shared/segment-inbox';

import type {
  Voxtral3BAsrInitMessage,
  AsrStopMessage,
  AsrDisposeMessage,
  StreamingAsrWorkerOutMessage,
} from '../types';
import { bindCheckedWebGpuAdapter } from './shaderF16Gate';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

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

type WorkerMessage = Voxtral3BAsrInitMessage | AsrStopMessage | AsrDisposeMessage;

function post(msg: StreamingAsrWorkerOutMessage) {
  self.postMessage(msg);
}

// The longest segment this engine is handed, pre-speech pad included, is the detector's limit for
// Voxtral 3B (30 s, declared in modelManifest.ts): one 30 s encoder chunk. Nothing is lost past it —
// transformers.js splits a longer segment into 30 s chunks — but a segment just over 30 s would pay a
// second encoder pass and 375 more prefill tokens for the few hundred ms that overflow. The detector
// cuts there, so this worker never sees a longer segment.

// ─── Voxtral 3B Model State ─────────────────────────────────────────────────

let model: any = null;            // VoxtralForConditionalGeneration instance
let processor: any = null;        // VoxtralProcessor instance
let currentLanguage: string | undefined;
/** The detector's segments, decoded one at a time in arrival order; exists once the model is ready. */
let inbox: SegmentInbox | null = null;

// 8 languages natively supported by Voxtral 3B 2507
const SUPPORTED_LANGS = new Set(['en', 'es', 'fr', 'pt', 'hi', 'de', 'nl', 'it']);

function normalizeToIso639_1(lang: string | undefined): string {
  if (!lang) return '';
  // Strip region suffix: 'en-US' → 'en', 'zh_Hans' → 'zh'
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

// ─── Batch Speech Segment Processing ────────────────────────────────────────

/**
 * Run Voxtral 3B inference on a speech segment the detector cut.
 * Builds a chat-template prompt with optional `lang:XX [TRANSCRIBE]` hint,
 * uses TextStreamer for token-level partial results (tagged with the segment's press and epoch),
 * and emits a final `result` message when decoding completes.
 *
 * Called by the inbox, one segment at a time, so generate() calls never overlap.
 */
async function runVoxtral3B(audio: Float32Array, startSample: number, tag: DecodeTag): Promise<void> {
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
        post({ type: 'partial', text: accumulatedText, press: tag.press, epoch: tag.epoch });
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
        startSample,
        durationMs,
        recognitionTimeMs: Math.round(performance.now() - startTime),
        ...tag,
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Voxtral 3B inference failed: ${err?.message || err}` });
  }
}

/** A decode threw outside its own reporting (the inbox calls this; the segment was already acknowledged). */
function reportDecodeError(err: unknown): void {
  post({type: 'error', error: `Voxtral 3B inference failed: ${(err as Error)?.message || err}`});
}

// ─── Init Handler ───────────────────────────────────────────────────────────

async function handleInit(msg: Voxtral3BAsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // 1. Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

    // 2. Load processor
    post({ type: 'status', message: 'Loading Voxtral 3B processor...' });
    processor = await VoxtralProcessor.from_pretrained(msg.hfModelId);

    // 3. Load model (WebGPU)
    post({ type: 'status', message: 'Loading Voxtral 3B model (WebGPU)...' });
    await bindCheckedWebGpuAdapter(env.backends.onnx, msg.dtype, 'Voxtral 3B');
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

    // 4. Log chosen language hint for operator visibility
    const langCode = normalizeToIso639_1(currentLanguage);
    if (SUPPORTED_LANGS.has(langCode)) {
      post({ type: 'status', message: `Voxtral 3B language hint: lang:${langCode} [TRANSCRIBE]` });
    } else if (currentLanguage) {
      post({ type: 'status', message: `Voxtral 3B: source language '${currentLanguage}' not in supported set; using auto-detect` });
    }

    // 5. WebGPU warmup — compile shaders with a tiny dummy inference so the
    //    first real utterance doesn't pay the compilation cost. Matches the
    //    Cohere worker's pattern (cohere-transcribe-webgpu.worker.ts).
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

    // 6. Listen to the detector only now the model is ready: nothing it sends is lost, and
    // nothing is decoded before there is a model to decode on.
    inbox = new SegmentInbox(msg.segmentPort, runVoxtral3B, post, reportDecodeError);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    post({ type: 'error', error: err?.message || String(err) });
  }
}

// ─── Dispose ────────────────────────────────────────────────────────────────

async function handleDispose(): Promise<void> {
  // Only reachable when the host waits for `disposed`. In the app, WorkerSession.dispose()
  // posts `dispose` and terminates this worker on the next line, so the wait below runs in the
  // worker harness only; Stop is meant to be immediate.

  // Stop listening and wait for the decode in flight; what still waits is dropped. Nothing can
  // then run against the model released below.
  await inbox?.close();
  inbox = null;

  // Dispose model and processor
  if (model) {
    try { await (model as any).dispose?.(); } catch { /* ignore */ }
    model = null;
  }
  processor = null;
  currentLanguage = undefined;

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
