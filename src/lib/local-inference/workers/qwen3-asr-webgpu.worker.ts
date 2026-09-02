/**
 * Qwen3-ASR WebGPU ASR Worker (raw onnxruntime-web, no Transformers.js model class)
 *
 * Streaming audio input (Int16@24kHz) -> Silero VAD v5 -> Qwen3-ASR-0.6B ONNX (WebGPU)
 * Model files (layout v2, see prompt_config.json in jiangzhuo9357/Qwen3-ASR-0.6B-ONNX) are
 * read from IndexedDB blob URLs. Per utterance: log-mel -> encoder -> prompt embedding built
 * on the host from the int8 table with the encoder output spliced over the audio pads ->
 * decoder_init -> decoder_step loop with the KV cache kept as GPU buffers.
 *
 * When a source language is set, the model's own answer prefix `language <Name><asr_text>`
 * is appended to the prompt (teacher forcing): it removes a first-token knife edge of the
 * quantized decoder and any language-ID mistake on short utterances.
 *
 * Input messages:  Qwen3AsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' }
 * Output messages: AsrWorkerOutMessage (ready, status, speech_start, result, error, disposed)
 */

import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
// The VAD deliberately runs on a SEPARATE onnxruntime-web instance (the wasm-only bundle the
// other workers use for their VAD). The webgpu bundle runs `session.run()` under Emscripten
// Asyncify, and re-entering that wasm instance while a decode is suspended (which is exactly
// what a VAD frame arriving mid-decode does) is undefined behaviour — observed as a permanent
// hang of every later decode. Two instances cannot re-enter each other, so VAD frames and the
// GPU decode may overlap freely, the same layout voxtral-3b relies on.
import { InferenceSession as VadInferenceSession, Tensor as VadTensor, env as vadOrtEnv } from './_shared/onnxruntime-all';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import { resolveVadThresholds } from './_shared/vad-thresholds';
import { logMel, type MelFilterbank } from './_shared/log-mel';
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
  AsrAudioMessage,
  AsrDisposeMessage,
  AsrWorkerOutMessage,
} from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerMessage = Qwen3AsrInitMessage | AsrAudioMessage | AsrDisposeMessage | { type: 'flush' };

function post(msg: AsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Silero VAD v5 (same scaffold as the other WebGPU ASR workers) ──────────

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

interface VadSession {
  session: VadInferenceSession;
  state: VadTensor;
}

let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;

let maxSpeechFrames = 625; // ~20s at 32ms/frame
let speechFramesSinceStart = 0;
let totalSamplesFed = 0;
let speechStartSample = 0;

async function vadInfer(frame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
  if (!vadSession) return { isSpeech: 0, notSpeech: 1 };

  const input = new VadTensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new VadTensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);

  const result = await vadSession.session.run({
    input,
    sr,
    state: vadSession.state,
  });

  vadSession.state = result.stateN as VadTensor;
  const prob = (result.output as VadTensor).data[0] as number;
  return { isSpeech: prob, notSpeech: 1 - prob };
}

function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new VadTensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(vadConfig?: Qwen3AsrInitMessage['vadConfig'], vadModelUrl?: string): Promise<void> {
  const session = await VadInferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });

  vadSession = {
    session,
    state: new VadTensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
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
let processingVad = false;
/** The decode currently running or queued; decodes are serialized through it (see transcribe). */
let currentDecodePromise: Promise<void> | null = null;

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (self as unknown as { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } }).navigator?.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
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
 * Decode one speech segment, serialized behind whatever decode is already running.
 *
 * Callers on the VAD path fire-and-forget this (`void transcribe(...)`): a decode takes
 * 0.5–2.5 s, and awaiting it inside `feedAudio` would keep `processingVad` true for that
 * long, so every audio message arriving meanwhile would hit the guard and be dropped — on
 * gapless audio that loses the start of the next utterance. Same pattern as the Voxtral 3B
 * worker (`runVoxtral3B` / `currentDecodePromise`). Chaining on the previous promise keeps
 * decodes strictly ordered and never overlapping on the shared sessions and KV buffers.
 * The returned promise never rejects: `transcribeSegment` reports its own errors.
 */
function transcribe(audio: Float32Array, startSample: number, warmup = false): Promise<void> {
  const previous = currentDecodePromise;
  const promise = (async () => {
    if (previous) {
      try { await previous; } catch { /* already reported by its own catch */ }
    }
    await transcribeSegment(audio, startSample, warmup);
  })();
  currentDecodePromise = promise;
  return promise;
}

async function transcribeSegment(audio: Float32Array, startSample: number, warmup = false): Promise<void> {
  const m = model;
  if (!m) return;

  const durationMs = Math.round((audio.length / VAD_SAMPLE_RATE) * 1000);
  const startTime = performance.now();

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
      post({ type: 'result', text, startSample, durationMs, recognitionTimeMs });
    }
    void forced;
  } catch (err) {
    if (!warmup) post({ type: 'error', error: `Qwen3-ASR inference failed: ${(err as Error)?.message || String(err)}` });
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
            // meanwhile. `transcribe` serializes decodes via `currentDecodePromise`.
            void transcribe(ev.audio, speechStartSample);
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
              // See the SpeechEnd comment above: fire-and-forget so no audio is dropped.
              void transcribe(ev.audio, speechStartSample);
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

async function handleInit(msg: Qwen3AsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    // wasmPaths must be set on BOTH runtime instances before their first session: the VAD's
    // wasm-only instance and the model's webgpu instance each load their own binary from there.
    if (msg.ortWasmBaseUrl) {
      if (vadOrtEnv?.wasm) vadOrtEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      if (ortEnv?.wasm) ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const webgpuAvailable = await hasWebGPU();
    if (!webgpuAvailable) {
      post({ type: 'error', error: 'WebGPU is not available. Qwen3-ASR requires WebGPU.' });
      return;
    }

    post({ type: 'status', message: 'Loading VAD model...' });
    await initVad(msg.vadConfig, msg.vadModelUrl);

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
    await transcribe(new Float32Array(VAD_SAMPLE_RATE), 0, true);

    audioBuffer = new Float32Array(0);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err) {
    post({ type: 'error', error: (err as Error)?.message || String(err) });
  }
}

async function handleFlush(): Promise<void> {
  // Force-finalize any pending speech (PTT release path). Fire-and-forget: `transcribe`
  // assigns `currentDecodePromise` before returning, so the await below picks up the decode
  // we just kicked off, and the flush resolves once the utterance's text has been posted.
  if (frameProcessor?.speaking) {
    const endEvents: FrameProcessorEvent[] = [];
    frameProcessor.endSegment((ev) => endEvents.push(ev));
    for (const ev of endEvents) {
      if (ev.msg === Message.SpeechEnd) {
        void transcribe(ev.audio, speechStartSample);
      }
    }
  }
  if (currentDecodePromise) {
    try { await currentDecodePromise; } catch { /* already reported */ }
  }
}

async function handleDispose(): Promise<void> {
  // Flush remaining speech; handleFlush waits for that decode to finish.
  await handleFlush();

  // Stop accepting new segments before touching the sessions: with `model` null, feedAudio
  // returns early and a queued transcribeSegment exits at its first line.
  const m = model;
  model = null;

  // A decode may have been queued between the flush's await and the line above; wait for it
  // so nothing runs against released sessions or disposes their GPU buffers afterwards.
  if (currentDecodePromise) {
    try { await currentDecodePromise; } catch { /* already reported */ }
    currentDecodePromise = null;
  }

  frameProcessor = null;
  speechFramesSinceStart = 0;

  if (vadSession?.session) {
    await vadSession.session.release();
    vadSession = null;
  }

  if (m) {
    await Promise.all([m.encoder.release(), m.decoderInit.release(), m.decoderStep.release()]).catch(() => undefined);
  }

  audioBuffer = new Float32Array(0);
  processingVad = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as Qwen3AsrInitMessage);
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
