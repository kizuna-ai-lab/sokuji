/**
 * Refuses an f16 model variant in the worker that is about to load it, against
 * the adapter ORT will actually use.
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
 * Throws when an f16 variant was requested and this worker's adapter does not
 * offer `shader-f16`. A non-f16 dtype is never blocked, and neither is a
 * context with no WebGPU at all — a model that needs a GPU fails on its own
 * terms, and this gate must not become a second, worse way to say that.
 */
export async function assertShaderF16Supported(
  dtype: unknown,
  modelLabel: string,
  gpu: GpuLike | undefined = (globalThis as any).navigator?.gpu,
): Promise<void> {
  if (!needsShaderF16(dtype)) return;
  if (!gpu) return;

  let adapter: AdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    // An adapter request that throws is not evidence about f16; let the real
    // load report whatever is actually wrong with the GPU.
    return;
  }
  if (!adapter) return;

  if (!adapter.features.has(SHADER_F16)) {
    throw new Error(
      `${modelLabel} was selected in its f16 variant, but the GPU adapter this worker got does not `
      + `support the WebGPU "${SHADER_F16}" feature. The adapter checked when the variant was chosen `
      + `did support it, so this device is handing different adapters to different contexts `
      + `(hybrid graphics, or a software fallback). Re-download this model to get its non-f16 variant, `
      + `or switch to a model that does not need f16.`,
    );
  }
}
