import { InferenceSession, Tensor } from '../workers/_shared/onnxruntime-all';
import {
  POCKET_SAMPLE_RATE, POCKET_LATENT_DIM, POCKET_EOS_LOGIT_THRESHOLD,
  POCKET_DECODER_CHUNK_FRAMES, POCKET_DEFAULT_MAX_FRAMES, POCKET_DEFAULT_LSD_STEPS,
} from './pocketBundle';
import { type StateMap } from './pocketState';

export interface PocketSessions {
  mimiEncoder: InferenceSession;
  textConditioner: InferenceSession;
  flowLmMain: InferenceSession;
  flowLmFlow: InferenceSession;
  mimiDecoder: InferenceSession;
}

/**
 * One stateful-session manifest entry, mirroring the real bundle.json fields
 * from KevinAHM/pocket-tts-web (`flow_lm_state_manifest` / `mimi_state_manifest`).
 *
 * Differs from pocketState.ts's StateManifestEntry: the bundle uses snake_case
 * field names and adds `fill` (NaN/ones init) plus a `'bool'` dtype, which the
 * source's initStateFromManifest/makeFilledArray honor. We port those helpers
 * here rather than reuse pocketState's zero-only initState so the state init
 * matches the source exactly. `module`/`key` are only used by the source's
 * predefined-voice path (stateFromVoiceRecord), which this PoC does not use.
 */
export interface PocketStateEntry {
  input_name: string;
  output_name: string;
  dtype: 'float32' | 'int64' | 'bool';
  shape: number[];
  fill?: 'nan' | 'ones';
  module?: string;
  key?: string;
}

/**
 * Parsed from the bundle's metadata file. Field names mirror the real
 * bundle.json schema (snake_case) so the worker can `JSON.parse(...) as
 * PocketMetadata` directly.
 *
 * UNVERIFIED against an actual bundle.json in this environment (the ~200MB
 * bundle was not downloaded). Schema taken verbatim from inference-worker.js:
 *   bundleMetadata.flow_lm_state_manifest / mimi_state_manifest  (arrays)
 *   bundleMetadata.conditioning_dim                              (number)
 *   bundleMetadata.model_recommended_frames_after_eos            (number?)
 *   bundleMetadata.latent_dim / sample_rate / samples_per_frame  (numbers)
 */
export interface PocketMetadata {
  flow_lm_state_manifest: PocketStateEntry[];
  mimi_state_manifest: PocketStateEntry[];
  conditioning_dim?: number;
  latent_dim?: number;
  sample_rate?: number;
  samples_per_frame?: number;
  model_recommended_frames_after_eos?: number;
}

type OrtTensor = Tensor;
type TensorMap = Record<string, OrtTensor>;

const makeTensor = (
  dtype: 'float32' | 'int64' | 'bool',
  data: Float32Array | BigInt64Array | Uint8Array,
  dims: number[],
): OrtTensor => new Tensor(dtype, data as never, dims);

/** Port of the source's makeFilledArray — honors `fill` ("nan"|"ones") and bool. */
function makeFilledArray(
  shape: number[], dtype: 'float32' | 'int64' | 'bool', fill?: 'nan' | 'ones',
): Float32Array | BigInt64Array | Uint8Array {
  const size = shape.reduce((a, b) => a * b, 1);
  if (dtype === 'int64') return new BigInt64Array(size);
  if (dtype === 'bool') return new Uint8Array(size);
  const data = new Float32Array(size);
  if (fill === 'nan') data.fill(NaN);
  else if (fill === 'ones') data.fill(1);
  return data;
}

/** Port of the source's initStateFromManifest. */
function initStateFromManifest(manifest: PocketStateEntry[]): StateMap {
  const state: StateMap = {};
  for (const e of manifest) {
    state[e.input_name] = makeTensor(e.dtype, makeFilledArray(e.shape, e.dtype, e.fill), e.shape) as never;
  }
  return state;
}

/** Port of the source's updateStateFromManifestOutputs (mutates `state`). */
function updateStateFromManifestOutputs(
  state: StateMap, result: TensorMap, manifest: PocketStateEntry[],
): void {
  for (const e of manifest) {
    const out = result[e.output_name];
    if (out) state[e.input_name] = out as never;
  }
}

/** Shallow clone — matches the source's cloneState (state is replaced, not mutated, per key). */
function cloneState(state: StateMap): StateMap {
  return { ...state };
}

const makeF32Tensor = (data: Float32Array, dims: number[]) =>
  makeTensor('float32', data, dims) as never as OrtTensor;

/** Linear resample mono Float32 to 24 kHz. */
export function resampleTo24k(samples: Float32Array, srcRate: number): Float32Array {
  if (srcRate === POCKET_SAMPLE_RATE) return samples;
  const ratio = POCKET_SAMPLE_RATE / srcRate;
  const out = new Float32Array(Math.round(samples.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Reference samples (already 24 kHz mono) → voice embedding tensor [1,T,32]. */
export async function encodeReference(
  sessions: PocketSessions, samples24k: Float32Array,
): Promise<Tensor> {
  const audio = makeF32Tensor(samples24k, [1, 1, samples24k.length]);
  const out = await sessions.mimiEncoder.run({ audio });
  return out[sessions.mimiEncoder.outputNames[0]] as Tensor;
}

/**
 * Prefill flowLmMain with the voice embedding to initialize the flow state,
 * mirroring the source's buildVoiceConditionedState:
 *   const flowLmState = initStateFromManifest(flow_lm_state_manifest);
 *   const emptySeq    = [1, 0, latentDim] f32;
 *   result = flowLmMain.run({ sequence: emptySeq, text_embeddings: voiceTensor, ...flowLmState });
 *   updateStateFromManifestOutputs(flowLmState, result, flow_lm_state_manifest);
 *
 * NOTE: the source optionally prepends a BOS embedding via prepareVoiceEmbeddingData
 * (gated on metadata.insert_bos_before_voice + a bos_before_voice file). This PoC
 * does not load that optional file, so the voice embedding is used as-is. If the
 * real bundle sets insert_bos_before_voice=true this prefill will differ from the
 * reference — flagged for the manual browser check.
 */
export async function buildVoiceConditionedState(
  sessions: PocketSessions, meta: PocketMetadata, voiceEmb: Tensor,
): Promise<StateMap> {
  const latentDim = meta.latent_dim ?? POCKET_LATENT_DIM;
  const flowLmState = initStateFromManifest(meta.flow_lm_state_manifest);
  const emptySeq = makeF32Tensor(new Float32Array(0), [1, 0, latentDim]);

  const result = await sessions.flowLmMain.run({
    sequence: emptySeq,
    text_embeddings: voiceEmb,
    ...(flowLmState as unknown as InferenceSession.OnnxValueMapType),
  });
  updateStateFromManifestOutputs(flowLmState, result as TensorMap, meta.flow_lm_state_manifest);
  return flowLmState;
}

export interface PocketGenOptions {
  lsdSteps?: number;
  maxFrames?: number;
  speed?: number;
}

/** Precompute the per-LSD-step (s, t) scalar tensors — source's precomputeFlowBuffers. */
function precomputeFlowBuffers(lsdSteps: number): { s: OrtTensor; t: OrtTensor }[] {
  const dt = 1.0 / lsdSteps;
  const out: { s: OrtTensor; t: OrtTensor }[] = [];
  for (let step = 0; step < lsdSteps; step++) {
    const s = step / lsdSteps;
    const t = s + dt;
    out.push({
      s: makeF32Tensor(new Float32Array([s]), [1, 1]),
      t: makeF32Tensor(new Float32Array([t]), [1, 1]),
    });
  }
  return out;
}

/**
 * Autoregressive generate — port of the source's runGenerationPipeline for a
 * single text chunk. The worker has already produced `textEmbeddings` (the
 * text_conditioner output) and the voice-conditioned `flowLmState`, so this
 * function:
 *   1. prefills flowLmMain with the text embeddings (sequence [1,0,latent]),
 *      threading flowLmState (source's condResult step);
 *   2. loops up to maxFrames running flowLmMain per frame with the running
 *      latent as `sequence` [1,1,latent] and empty text_embeddings [1,0,cond];
 *   3. detects EOS (eos_logit > POCKET_EOS_LOGIT_THRESHOLD), stops `framesAfterEos`
 *      frames later;
 *   4. samples a Gaussian latent (temperature 0.7) and refines it through the
 *      LSD flow (`x += flow_dir * dt`) using flowLmFlow with precomputed (s, t);
 *   5. batches decoded latents (3 frames for the very first chunk, else 12, or
 *      the remainder on stop) through mimiDecoder, threading mimiState;
 *   6. concatenates the decoder PCM into one Float32Array @ 24 kHz.
 *
 * Differences from the source, by design:
 *   - The source streams audio_chunk messages; here we accumulate and return one
 *     Float32Array (the worker posts a single `result`).
 *   - The source iterates multiple sentence chunks with inter-chunk silence; the
 *     worker calls generate() per request with already-tokenized text, so we run
 *     a single chunk and emit no gap silence.
 *   - The source yields to the event loop every 4 steps (setTimeout 0); preserved.
 *   - `opts.speed` is accepted but NOT applied: the source's pipeline has no
 *     speed/duration control — frame count is governed by EOS. Documented; the
 *     worker passes msg.speed through but it is a no-op here (same as the source).
 */
export async function generate(
  sessions: PocketSessions,
  meta: PocketMetadata,
  textEmbeddings: Tensor,
  flowLmStateIn: StateMap,
  opts: PocketGenOptions,
): Promise<Float32Array> {
  const lsdSteps = Math.max(1, opts.lsdSteps ?? POCKET_DEFAULT_LSD_STEPS);
  const maxFrames = opts.maxFrames ?? POCKET_DEFAULT_MAX_FRAMES;
  const latentDim = meta.latent_dim ?? POCKET_LATENT_DIM;
  const condDim = meta.conditioning_dim ?? textEmbeddings.dims[2] ?? 1024;
  const framesAfterEos = meta.model_recommended_frames_after_eos ?? 1;
  const firstChunkFrames = 3;
  const normalChunkFrames = POCKET_DECODER_CHUNK_FRAMES; // 12
  const temperature = 0.7;
  const std = Math.sqrt(temperature);
  const dt = 1.0 / lsdSteps;
  const stTensors = precomputeFlowBuffers(lsdSteps);

  // Fresh mimi (decoder) state + a working copy of the voice-conditioned flow state.
  // Both are mutated in place by updateStateFromManifestOutputs across steps.
  const mimiState = initStateFromManifest(meta.mimi_state_manifest);
  const flowLmState = cloneState(flowLmStateIn);

  const emptySeq = makeF32Tensor(new Float32Array(0), [1, 0, latentDim]);
  const emptyTextEmb = makeF32Tensor(new Float32Array(0), [1, 0, condDim]);

  // Prefill with the text embeddings (source's condResult), threading flow state.
  const condResult = await sessions.flowLmMain.run({
    sequence: emptySeq,
    text_embeddings: textEmbeddings,
    ...(flowLmState as unknown as InferenceSession.OnnxValueMapType),
  });
  updateStateFromManifestOutputs(flowLmState, condResult as TensorMap, meta.flow_lm_state_manifest);

  const pcmChunks: Float32Array[] = [];
  const chunkLatents: Float32Array[] = [];
  let chunkDecodedFrames = 0;
  let isFirstAudioChunk = true;
  let currentLatent = makeF32Tensor(new Float32Array(latentDim).fill(NaN), [1, 1, latentDim]);
  let eosStep: number | null = null;

  for (let step = 0; step < maxFrames; step++) {
    // Yield to the event loop periodically (mirrors the source's step % 4 throttle).
    if (step > 0 && step % 4 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const arResult = await sessions.flowLmMain.run({
      sequence: currentLatent,
      text_embeddings: emptyTextEmb,
      ...(flowLmState as unknown as InferenceSession.OnnxValueMapType),
    }) as TensorMap;

    const conditioning = arResult.conditioning;
    const eosLogit = (arResult.eos_logit.data as Float32Array)[0];
    const isEos = eosLogit > POCKET_EOS_LOGIT_THRESHOLD;
    if (isEos && eosStep == null) eosStep = step;
    const shouldStop = eosStep != null && step >= eosStep + framesAfterEos;

    // Gaussian (Box–Muller) latent at temperature 0.7, then LSD flow refinement.
    const latentData = new Float32Array(latentDim);
    for (let i = 0; i < latentDim; i++) {
      let u = 0;
      let v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      latentData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std;
    }

    for (let lsdIndex = 0; lsdIndex < lsdSteps; lsdIndex++) {
      const flowResult = await sessions.flowLmFlow.run({
        c: conditioning,
        s: stTensors[lsdIndex].s,
        t: stTensors[lsdIndex].t,
        x: makeF32Tensor(latentData, [1, latentDim]),
      }) as TensorMap;
      const flowDir = flowResult.flow_dir.data as Float32Array;
      for (let i = 0; i < latentDim; i++) latentData[i] += flowDir[i] * dt;
    }

    chunkLatents.push(new Float32Array(latentData));
    currentLatent = makeF32Tensor(latentData, [1, 1, latentDim]);
    updateStateFromManifestOutputs(flowLmState, arResult, meta.flow_lm_state_manifest);

    // Decoder batching: 3 frames for the very first audio chunk, else 12, or the
    // remainder when stopping.
    const pending = chunkLatents.length - chunkDecodedFrames;
    let decodeSize = 0;
    if (shouldStop) decodeSize = pending;
    else if (isFirstAudioChunk && pending >= firstChunkFrames) decodeSize = firstChunkFrames;
    else if (pending >= normalChunkFrames) decodeSize = normalChunkFrames;

    if (decodeSize > 0) {
      const decodeLatents = new Float32Array(decodeSize * latentDim);
      for (let frame = 0; frame < decodeSize; frame++) {
        decodeLatents.set(chunkLatents[chunkDecodedFrames + frame], frame * latentDim);
      }
      const decodeResult = await sessions.mimiDecoder.run({
        latent: makeF32Tensor(decodeLatents, [1, decodeSize, latentDim]),
        ...(mimiState as unknown as InferenceSession.OnnxValueMapType),
      }) as TensorMap;
      updateStateFromManifestOutputs(mimiState, decodeResult, meta.mimi_state_manifest);

      const pcm = decodeResult[sessions.mimiDecoder.outputNames[0]].data as Float32Array;
      pcmChunks.push(new Float32Array(pcm));
      chunkDecodedFrames += decodeSize;
      isFirstAudioChunk = false;
    }

    if (shouldStop) break;
  }

  // Concatenate decoder PCM chunks into one Float32Array @ 24 kHz.
  const total = pcmChunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of pcmChunks) { out.set(c, offset); offset += c.length; }
  return out;
}
