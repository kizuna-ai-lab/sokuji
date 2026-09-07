/**
 * Refuses an f16 model variant in the worker that is about to load it.
 *
 * Variant selection runs on the MAIN thread: `checkWebGPU()` probes
 * `requestAdapter()` once, caches the answer, and `selectVariant()` /
 * `isModelReady()` gate on that cache. The worker then asks for an adapter of
 * its own and transformers.js/ORT build a device from it. Nothing guarantees
 * the two adapters agree — a hybrid-graphics laptop can answer the two calls
 * with different GPUs, and a blocklisted GPU falls back to a software adapter
 * that reports no optional features at all.
 *
 * When they disagree, the load reaches shader compilation and dies with
 * `Program Transpose requires f16 but the device does not support it`, which
 * names no model, no variant and no adapter (issue #504). Checking here turns
 * that into a message that says which of the two possible causes it was:
 * reaching this error at all proves the main thread believed `shader-f16` was
 * available, because otherwise the variant could not have been selected.
 *
 * The check alone could still be unsound: asking one adapter and letting the
 * runtime request its own leaves room for a false PASS — check adapter A, run
 * on adapter B. So the adapter is requested once and handed to the runtime
 * (`env.webgpu.adapter`, honoured only before the first session is created),
 * which makes the verdict binding: if this passes, the device the runtime
 * builds has the feature, because it is built from this adapter (#513).
 *
 * SCOPE, precisely. This binds the CHECK to the RUNTIME. It does not bind
 * either to variant SELECTION, which happens on the main thread and cannot:
 * a `GPUAdapter` is not structured-cloneable, so it cannot cross into a
 * worker. A machine whose main thread sees f16 and whose workers do not will
 * therefore still select an f16 variant — and this will now refuse it with a
 * message naming the model, every time, instead of refusing it only when two
 * unrelated adapter requests happened to agree. Making selection itself
 * correct is the remaining half, and is not this.
 */

const SHADER_F16 = 'shader-f16';

/**
 * Both half-precision spellings transformers.js accepts. `fp16` is the plain
 * one and `q4f16` the quantised-weights-with-f16-activations one; a bare
 * `includes('f16')` matches only the second, which is how this predicate was
 * wrong on its first draft.
 */
const F16_DTYPE = /f(?:p)?16/;

/**
 * Whether a requested dtype needs `shader-f16`. Accepts both shapes the
 * workers use: a single string ('q4f16'), or a per-module record whose values
 * are dtypes ({ audio_encoder: 'fp16', decoder_model_merged: 'q4' }).
 *
 * Any f16 module is enough — the device feature is all-or-nothing, so one f16
 * graph in an otherwise q4 model still needs it.
 */
export function needsShaderF16(dtype: unknown): boolean {
  if (typeof dtype === 'string') return F16_DTYPE.test(dtype);
  if (dtype && typeof dtype === 'object') {
    return Object.values(dtype as Record<string, unknown>).some(
      v => typeof v === 'string' && F16_DTYPE.test(v),
    );
  }
  return false;
}

/** The subset of GPUAdapter this gate reads, so tests need no WebGPU. */
interface AdapterLike { features: { has(name: string): boolean } }
interface GpuLike { requestAdapter(): Promise<AdapterLike | null> }

/**
 * The slice of an ONNX Runtime `env` this needs. Optional throughout because
 * transformers.js types its `backends.onnx` as `Partial<Env>`, so `webgpu` can
 * legitimately be absent.
 */
export interface RuntimeEnvLike {
  webgpu?: { adapter?: unknown };
}

/**
 * The one adapter this worker will use, remembered on the runtime env.
 *
 * Call this wherever a worker needs to know whether WebGPU is available at
 * all — it answers that question (null means no) AND makes the answer the
 * runtime's, in one request. A worker that asks `navigator.gpu` for an adapter
 * itself and then lets the gate ask again has two answers to one question, and
 * they can differ: the second request coming back empty made the gate return
 * silently while the worker, having decided on WebGPU from the first, loaded
 * the model anyway with nothing checked. Acquiring once removes that state.
 */
export async function acquireWebGpuAdapter(
  runtimeEnv: RuntimeEnvLike | undefined,
  gpu: GpuLike | undefined = (globalThis as any).navigator?.gpu,
): Promise<AdapterLike | null> {
  const alreadyBound = runtimeEnv?.webgpu?.adapter as AdapterLike | undefined;
  if (alreadyBound) return alreadyBound;
  if (!gpu) return null;

  let adapter: AdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    // An adapter request that throws is not evidence about f16; let the real
    // load report whatever is actually wrong with the GPU.
    return null;
  }
  if (!adapter) return null;

  if (runtimeEnv?.webgpu) runtimeEnv.webgpu.adapter = adapter;
  return adapter;
}

/**
 * Gives the runtime an adapter this function has checked, and refuses an f16
 * variant that adapter cannot run.
 *
 * `runtimeEnv` must be the env of the runtime that will LOAD THE MODEL:
 * `env.backends.onnx` for a transformers.js worker, the `env` exported by
 * `_shared/onnxruntime-webgpu` for a worker driving ORT directly. Passing the
 * `_shared/onnxruntime-all` env of a worker's Silero VAD would look right and
 * bind nothing that matters — see the consistency test, which enforces this.
 *
 * Never throws for a missing GPU: no `navigator.gpu`, no adapter, or a
 * `requestAdapter()` that rejects all return quietly. A model that needs a GPU
 * fails on its own terms, and this must not become a second, worse way to say
 * so.
 */
export async function bindCheckedWebGpuAdapter(
  runtimeEnv: RuntimeEnvLike | undefined,
  dtype: unknown,
  modelLabel: string,
  gpu: GpuLike | undefined = (globalThis as any).navigator?.gpu,
): Promise<void> {
  const adapter = await acquireWebGpuAdapter(runtimeEnv, gpu);
  if (!adapter) return;

  if (needsShaderF16(dtype) && !adapter.features.has(SHADER_F16)) {
    // Deliberately does NOT suggest re-downloading. `downloadModel()` re-runs
    // `selectVariant(entry, getDeviceFeatures())` against the MAIN THREAD's
    // cache, which in this very scenario still reports shader-f16 — so it would
    // pick the same f16 variant again and charge the user another multi-gigabyte
    // download for no change.
    throw new Error(
      `${modelLabel} was selected in its f16 variant, but the GPU adapter this worker got does not `
      + `support the WebGPU "${SHADER_F16}" feature. The adapter checked when the variant was chosen `
      + `did support it, so this device is handing different adapters to different contexts `
      + `(hybrid graphics, or a software fallback). Choose a model that does not need f16.`,
    );
  }
}

