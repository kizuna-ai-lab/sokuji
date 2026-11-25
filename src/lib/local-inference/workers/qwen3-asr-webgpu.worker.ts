/**
 * Qwen3-ASR WebGPU ASR Worker (raw onnxruntime-web, no Transformers.js model class)
 *
 * The turn detector's segments (16 kHz Float32 speech) -> Qwen3-ASR-0.6B ONNX (WebGPU)
 * Model files (layout v2, see prompt_config.json in jiangzhuo9357/Qwen3-ASR-0.6B-ONNX) are
 * read from IndexedDB blob URLs. Per utterance: log-mel -> encoder -> prompt embedding built
 * on the host from the int8 table with the encoder output spliced over the audio pads ->
 * decoder_init -> decoder_step loop with the KV cache kept as GPU buffers.
 *
 * When a source language is set, the model's own answer prefix `language <Name><asr_text>`
 * is appended to the prompt (teacher forcing): it removes a first-token knife edge of the
 * quantized decoder and any language-ID mistake on short utterances.
 *
 * This worker runs no VAD and takes no audio. Turn detection lives in turn-detector.worker.ts, which
 * cuts the turns and sends each segment here on `segmentPort`; SegmentInbox decodes them one at a
 * time, in arrival order, and answers the detector's drain marks.
 *
 * Input messages:  Qwen3AsrInitMessage | AsrStopMessage | AsrDisposeMessage
 * Output messages: AsrWorkerOutMessage (ready, status, result, drained, error, disposed)
 */

import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
import { VAD_SAMPLE_RATE } from './_shared/max-speech-frames';
import { SegmentInbox, type DecodeTag } from './_shared/segment-inbox';
import { logMel, MIN_MEL_INPUT_SAMPLES, type MelFilterbank } from './_shared/log-mel';
import { createBpeDecoder, type BpeDecoder } from './_shared/bpe-decoder';
import {
  audioTokenCount,
  buildPromptIds,
  normalizeLangForPrefix,
  splitGenerated,
  type Qwen3AsrPromptConfig,
} from './_shared/qwen3-asr-prompt';
import { f16ToF32, f32ToF16, greedyDecode, type DecodeDeps, type RunnableSession } from './_shared/qwen3-asr-decode';
import type {
  Qwen3AsrInitMessage,
  AsrStopMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerMessage = Qwen3AsrInitMessage | AsrStopMessage | AsrDisposeMessage;

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// The longest speech this engine is handed is the detector's limit for Qwen3-ASR, by source
// language (40 s; 15 s Hindi, 20 s Thai; declared in modelManifest.ts). The limit is the decode
// budget, prompt_config.json's max_new_tokens = 256: a transcript that needs more is cut at the
// tail and posted as an ordinary result, and how many seconds that is depends on how the
// tokenizer treats the language. This worker never sees a longer segment.

// ─── Qwen3-ASR model state ──────────────────────────────────────────────────

interface LoadedModel {
  cfg: Qwen3AsrPromptConfig;
  variant: string;
  filters: MelFilterbank;
  decoder: BpeDecoder;
  hidden: number;
  eos: Set<number>;
  /** Embedding table rows (int8 with per-row fp32 scales, or fp16 / fp32 as declared). */
  embI8: Int8Array | null;
  embScales: Float32Array | null;
  embF16: Uint16Array | null;
  embF32: Float32Array | null;
  encoder: InferenceSession;
  decoderInit: InferenceSession;
  decoderStep: InferenceSession;
  encoderMelType: string;
  forceLang: string | undefined;
}

let model: LoadedModel | null = null;
/** The detector's segments, decoded one at a time in arrival order; exists once the model is ready. */
let inbox: SegmentInbox | null = null;

/**
 * Whether this worker can run on the GPU — and, in the same step, WHICH adapter
 * it will run on. `acquireWebGpuAdapter` remembers it on the runtime env, so the
 * f16 gate checks the adapter the model actually loads on instead of requesting
 * a second one that could answer differently (#513).
 */
async function hasWebGPU(): Promise<boolean> {
  return !!(await acquireWebGpuAdapter(ortEnv));
}

function inputTypesOf(session: InferenceSession): Record<string, string> {
  const meta = (session as unknown as { inputMetadata?: { name?: string; type?: string }[] }).inputMetadata;
  const out: Record<string, string> = {};
  session.inputNames.forEach((name, i) => {
    out[name] = meta?.[i]?.type ?? 'float32';
  });
  return out;
}

function embedRowInto(m: LoadedModel, id: number, out: Float32Array, offset: number): void {
  const h = m.hidden;
  const o = id * h;
  if (m.embI8 && m.embScales) {
    const s = m.embScales[id];
    for (let i = 0; i < h; i++) out[offset + i] = m.embI8[o + i] * s;
  } else if (m.embF16) {
    out.set(f16ToF32(m.embF16.subarray(o, o + h)), offset);
  } else if (m.embF32) {
    out.set(m.embF32.subarray(o, o + h), offset);
  }
}

function asRunnable(session: InferenceSession): RunnableSession {
  return {
    run: (feeds) => session.run(feeds as Record<string, Tensor>) as unknown as ReturnType<RunnableSession['run']>,
    inputTypes: inputTypesOf(session),
  };
}

// ─── Speech Segment Processing ──────────────────────────────────────────────

/**
 * Decode one speech segment the detector cut. Called by the inbox, one segment at a time, so decodes
 * never overlap on the shared sessions and KV buffers. `tag` is null for the warm-up, which posts
 * nothing. Reports its own errors.
 */
async function transcribeSegment(audio: Float32Array, startSample: number, tag: DecodeTag | null, warmup = false): Promise<void> {
  const m = model;
  if (!m) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
  const startTime = performance.now();

  // A tail of up to half an FFT window (200 samples, 12.5 ms) has no real feature frame: the mel's reflect padding
  // reads past such an input and its one frame would hold NaN. Nothing to recognize, and the encoder must not be
  // handed it.
  if (audio.length <= MIN_MEL_INPUT_SAMPLES) return;

  try {
    const mel = logMel(audio, m.filters);
    const melData = m.encoderMelType === 'float16' ? f32ToF16(mel.data) : mel.data;
    const enc = await m.encoder.run({ mel: new Tensor(m.encoderMelType as 'float32', melData as Float32Array, [1, mel.nMels, mel.T]) });
    const af = enc.audio_features as Tensor;
    const nAudio = af.dims[1];
    const expected = audioTokenCount(mel.T, m.cfg.audio_tokens);
    if (expected !== nAudio) {
      post({ type: 'error', error: `Qwen3-ASR: encoder produced ${nAudio} audio tokens, prompt formula expected ${expected}` });
      return;
    }
    const afF32 = af.type === 'float16' ? f16ToF32(af.data as Uint16Array) : (af.data as Float32Array);

    const { ids, audioStart, forced } = buildPromptIds(nAudio, m.cfg, m.forceLang);
    const promptEmbeds = new Float32Array(ids.length * m.hidden);
    for (let i = 0; i < ids.length; i++) embedRowInto(m, ids[i], promptEmbeds, i * m.hidden);
    promptEmbeds.set(afF32.subarray(0, nAudio * m.hidden), audioStart * m.hidden);

    const deps: DecodeDeps = {
      init: asRunnable(m.decoderInit),
      step: asRunnable(m.decoderStep),
      makeTensor: (type, data, dims) => new Tensor(type as 'float32', data as Float32Array, dims),
      embedRow: (id) => {
        const row = new Float32Array(m.hidden);
        embedRowInto(m, id, row, 0);
        return row;
      },
    };
    const gen = await greedyDecode(deps, promptEmbeds, ids.length, m.hidden, m.eos, m.cfg.prompt.max_new_tokens);

    const { textIds } = splitGenerated(gen.ids, m.cfg);
    const text = m.decoder.decode(textIds).trim();
    const recognitionTimeMs = Math.round(performance.now() - startTime);

    if (!warmup && text) {
      post({ type: 'result', text, startSample, durationMs, recognitionTimeMs, ...tag });
    }
    void forced;
  } catch (err) {
    if (!warmup) post({ type: 'error', error: `Qwen3-ASR inference failed: ${(err as Error)?.message || String(err)}` });
  }
}

/** A decode threw outside its own reporting (the inbox calls this; the segment was already acknowledged). */
function reportDecodeError(err: unknown): void {
  post({type: 'error', error: `Qwen3-ASR inference failed: ${(err as Error)?.message || String(err)}`});
}

// ─── Message Handlers ───────────────────────────────────────────────────────

async function handleInit(msg: Qwen3AsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // wasmPaths must be set before the model's first session.
    if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
      ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const webgpuAvailable = await hasWebGPU();
    if (!webgpuAvailable) {
      post({ type: 'error', error: 'WebGPU is not available. Qwen3-ASR requires WebGPU.' });
      return;
    }

    const file = (name: string) => {
      const url = msg.fileUrls[name];
      if (!url) throw new Error(`Qwen3-ASR: model file "${name}" is missing from the download`);
      return url;
    };
    const text = async (name: string) => (await fetch(file(name))).text();
    const bytes = async (name: string) => new Uint8Array(await (await fetch(file(name))).arrayBuffer());

    post({ type: 'status', message: 'Reading Qwen3-ASR configuration...' });
    const cfg = JSON.parse(await text('prompt_config.json')) as Qwen3AsrPromptConfig;
    const variant = typeof msg.dtype === 'string' && msg.dtype in cfg.variants ? msg.dtype : 'q4';
    const v = cfg.variants[variant];
    if (!v) throw new Error(`Qwen3-ASR: prompt_config.json has no variant "${variant}"`);
    // The resolved variant, not msg.dtype: an unknown dtype falls back to q4
    // above, and gating on the request rather than the fallback would refuse a
    // load that is about to run in q4 anyway.
    await bindCheckedWebGpuAdapter(ortEnv, variant, 'Qwen3-ASR');
    const filters = JSON.parse(await text(cfg.mel?.filters_file ?? 'mel_filters.json')) as MelFilterbank;
    const decoder = createBpeDecoder(JSON.parse(await text('tokenizer.json')));

    post({ type: 'status', message: 'Loading Qwen3-ASR embedding table...' });
    const emb = cfg.embedding;
    const embBytes = await bytes(emb.file);
    const embI8 = emb.dtype === 'int8' ? new Int8Array(embBytes.buffer, embBytes.byteOffset, embBytes.byteLength) : null;
    const embScales = emb.dtype === 'int8' && emb.scales_file
      ? new Float32Array((await bytes(emb.scales_file)).buffer.slice(0))
      : null;
    const embF16 = emb.dtype === 'float16' ? new Uint16Array(embBytes.buffer, embBytes.byteOffset, embBytes.byteLength / 2) : null;
    const embF32 = emb.dtype === 'float32' ? new Float32Array(embBytes.buffer, embBytes.byteOffset, embBytes.byteLength / 4) : null;
    // prompt_config.json is parsed JSON, not validated: an unknown dtype would leave every
    // table null, embedRowInto would write zeros, and the worker would decode garbage while
    // reporting ready. Fail loudly instead.
    if (!embI8 && !embF16 && !embF32) {
      throw new Error(`Qwen3-ASR: unsupported embedding dtype "${String(emb.dtype)}" in prompt_config.json`);
    }
    if (embI8 && !embScales) {
      throw new Error('Qwen3-ASR: int8 embedding table requires embedding.scales_file in prompt_config.json');
    }

    post({ type: 'status', message: `Loading Qwen3-ASR model (WebGPU, ${variant})...` });
    const weights = await bytes(v.weights);
    const gpuOpts = (extra: Record<string, unknown>) => ({
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all' as const,
      ...extra,
    });
    const kvOnGpu = { preferredOutputLocation: { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } };
    const encoder = await InferenceSession.create(await bytes(v.encoder), gpuOpts({}));
    const decoderInit = await InferenceSession.create(await bytes(v.decoder_init), gpuOpts({ externalData: [{ path: v.weights, data: weights }], ...kvOnGpu }));
    const decoderStep = await InferenceSession.create(await bytes(v.decoder_step), gpuOpts({ externalData: [{ path: v.weights, data: weights }], ...kvOnGpu }));

    model = {
      cfg,
      variant,
      filters,
      decoder,
      hidden: cfg.decoder.hidden_size,
      eos: new Set(cfg.prompt.eos_ids),
      embI8,
      embScales,
      embF16,
      embF32,
      encoder,
      decoderInit,
      decoderStep,
      encoderMelType: inputTypesOf(encoder).mel ?? 'float32',
      forceLang: normalizeLangForPrefix(msg.language, cfg),
    };

    // WebGPU warmup: compile the shaders on 1 s of silence so the first utterance is not slow.
    post({ type: 'status', message: 'Warming up WebGPU shaders...' });
    await transcribeSegment(new Float32Array(VAD_SAMPLE_RATE), 0, null, true);

    // Listen to the detector only now the model is ready (the warm-up above ran before the inbox
    // existed): nothing it sends is lost, and nothing is decoded before there is a model to decode on.
    inbox = new SegmentInbox(msg.segmentPort, transcribeSegment, post, reportDecodeError);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err) {
    post({ type: 'error', error: (err as Error)?.message || String(err) });
  }
}

async function handleDispose(): Promise<void> {
  // Only reachable when the host waits for `disposed`. In the app, WorkerSession.dispose()
  // posts `dispose` and terminates this worker on the next line, so the wait below runs in the
  // worker harness only; Stop is meant to be immediate.

  // Stop listening and wait for the decode in flight; what still waits is dropped. Nothing can
  // then run against the sessions released below or dispose their GPU buffers afterwards.
  await inbox?.close();
  inbox = null;

  const m = model;
  model = null;

  if (m) {
    await Promise.all([m.encoder.release(), m.decoderInit.release(), m.decoderStep.release()]).catch(() => undefined);
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
