import { InferenceSession, Tensor } from '../workers/_shared/onnxruntime-all';
import {
  POCKET_SAMPLE_RATE, POCKET_LATENT_DIM, POCKET_EOS_LOGIT_THRESHOLD,
  POCKET_DECODER_CHUNK_FRAMES, POCKET_DEFAULT_MAX_FRAMES, POCKET_DEFAULT_LSD_STEPS,
} from './pocketBundle';
import {
  initState, applyStateUpdates, type StateManifestEntry, type StateMap,
} from './pocketState';

export interface PocketSessions {
  mimiEncoder: InferenceSession;
  textConditioner: InferenceSession;
  flowLmMain: InferenceSession;
  flowLmFlow: InferenceSession;
  mimiDecoder: InferenceSession;
}

/** Parsed from metadata.json: per-session state manifests. */
export interface PocketMetadata {
  flowLmState: StateManifestEntry[];
  mimiState: StateManifestEntry[];
}

const makeTensor = (dtype: string, data: Float32Array | BigInt64Array, dims: number[]) =>
  new Tensor(dtype as 'float32' | 'int64', data as never, dims);

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
  const audio = makeTensor('float32', samples24k, [1, 1, samples24k.length]) as Tensor;
  const out = await sessions.mimiEncoder.run({ audio });
  return out[sessions.mimiEncoder.outputNames[0]] as Tensor;
}

/**
 * Prefill flowLmMain with the voice embedding + (optionally) text embeddings to
 * initialize the flow state. Adapt from the source's buildVoiceConditionedState.
 * Returns the initialized flowLmState.
 */
export async function buildVoiceConditionedState(
  sessions: PocketSessions, meta: PocketMetadata, voiceEmb: Tensor,
): Promise<StateMap> {
  void sessions; void voiceEmb;
  // 1) init zeroed state from manifest
  // 2) run flowLmMain with sequence [1,0,32] + the voice/text conditioning per the
  //    source, threading state via applyStateUpdates(state, meta.flowLmState, out)
  // See inference-worker.js buildVoiceConditionedState for the exact inputs.
  return initState(meta.flowLmState, makeTensor as never);
}

export interface PocketGenOptions {
  lsdSteps?: number;
  maxFrames?: number;
  speed?: number;
}

/**
 * Autoregressive generate. Adapt verbatim from inference-worker.js:
 *  - tokenize text → text_conditioner → text_embeddings [1,L,1024]
 *  - prefill flowLmMain; then loop up to maxFrames:
 *      flowLmMain.run({ sequence:[1,1,32], text_embeddings:[1,0,1024], ...flowLmState })
 *      eos_logit > -4.0 → mark eosStep; stop after framesAfterEos
 *      LSD refine: for lsd in 0..lsdSteps: flowLmFlow.run({c,s,t,x}) → x += flow_dir*dt
 *      thread flowLmState via applyStateUpdates
 *      buffer latent; when >= 12 frames (or final) → mimiDecoder.run({latent:[1,B,32], ...mimiState})
 *  - concatenate decoder PCM chunks → Float32Array @ 24 kHz
 */
export async function generate(
  sessions: PocketSessions,
  meta: PocketMetadata,
  textEmbeddings: Tensor,
  flowLmState: StateMap,
  opts: PocketGenOptions,
): Promise<Float32Array> {
  void sessions; void meta;
  const lsdSteps = opts.lsdSteps ?? POCKET_DEFAULT_LSD_STEPS;
  const maxFrames = opts.maxFrames ?? POCKET_DEFAULT_MAX_FRAMES;
  void POCKET_LATENT_DIM; void POCKET_EOS_LOGIT_THRESHOLD; void POCKET_DECODER_CHUNK_FRAMES;
  void lsdSteps; void maxFrames; void applyStateUpdates; void textEmbeddings; void flowLmState;
  throw new Error('pocketInferenceCore.generate: port the AR loop from inference-worker.js');
}
