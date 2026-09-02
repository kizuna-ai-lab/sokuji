/**
 * Greedy decode loop for the Qwen3-ASR layout-v2 graphs, written against a tiny session
 * interface so it can be unit-tested with fakes and reused by any onnxruntime-web worker.
 *
 * Prefill: `decoder_init(input_embeds [1,S,H], position_ids [1,S])` → last-position logits +
 * stacked KV. Steps: `decoder_step(input_embeds [1,1,H], position_ids [1,1], past_keys,
 * past_values)`. The KV tensors are passed back untouched (on WebGPU they stay GPU buffers when
 * the session was created with `preferredOutputLocation: 'gpu-buffer'`) and disposed as soon
 * as the next step has replaced them.
 */

export interface RunnableTensor {
  data: ArrayLike<number> | BigInt64Array;
  dims: readonly number[];
  type: string;
  dispose?(): void;
}

export interface RunnableSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, RunnableTensor>>;
  /** input name → ORT type string ('float32' | 'float16' | 'int64'), from `inputMetadata`. */
  inputTypes: Record<string, string>;
}

export interface DecodeDeps {
  init: RunnableSession;
  step: RunnableSession;
  makeTensor(type: string, data: Float32Array | Uint16Array | BigInt64Array, dims: number[]): unknown;
  /** Row `id` of the embedding table as float32 (dequantised when the table is int8). */
  embedRow(id: number): Float32Array;
}

export interface DecodeResult {
  ids: number[];
  prefillMs: number;
  decodeMs: number;
  steps: number;
}

const hasFloat16Array = typeof (globalThis as { Float16Array?: unknown }).Float16Array !== 'undefined';

/**
 * Portable float32 → IEEE 754 binary16 with round-to-nearest-even, half subnormals and NaN
 * preserved — bit-identical to `Float16Array` so the two paths yield the same tensors.
 * Used where `Float16Array` is missing (Chromium < 135; the extension supports 116+).
 */
export function f32ToF16Fallback(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i];
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    const mant = x & 0x7fffff;
    if (exp === 0xff) {
      // Inf stays Inf; NaN keeps a quiet payload instead of collapsing to Inf.
      out[i] = sign | 0x7c00 | (mant ? 0x200 : 0);
      continue;
    }
    const e = exp - 112; // rebias 127 → 15
    if (e >= 0x1f) {
      out[i] = sign | 0x7c00; // overflow → Inf
      continue;
    }
    if (e <= 0) {
      if (e < -10) {
        out[i] = sign; // below the smallest half subnormal → signed zero
        continue;
      }
      // Half subnormal: shift the 24-bit significand into the 10-bit field with RNE.
      const m = mant | 0x800000;
      const shift = 14 - e;
      let half = m >>> shift;
      const rem = m & ((1 << shift) - 1);
      const halfway = 1 << (shift - 1);
      if (rem > halfway || (rem === halfway && (half & 1))) half++;
      out[i] = sign | half;
      continue;
    }
    let half = (e << 10) | (mant >>> 13);
    const rem = mant & 0x1fff;
    if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++; // carry may bump the exponent; that is correct
    out[i] = sign | half;
  }
  return out;
}

/** float32 → IEEE half, as the Uint16 bit pattern onnxruntime-web expects for 'float16' tensors. */
export function f32ToF16(src: Float32Array): Uint16Array {
  if (hasFloat16Array) {
    const F16 = (globalThis as unknown as { Float16Array: new (a: ArrayLike<number>) => { buffer: ArrayBuffer } }).Float16Array;
    return new Uint16Array(new F16(src).buffer);
  }
  return f32ToF16Fallback(src);
}

/** IEEE half bit patterns → float32. */
export function f16ToF32(src: Uint16Array): Float32Array {
  if (hasFloat16Array) {
    const F16 = (globalThis as unknown as { Float16Array: new (b: ArrayBufferLike, o: number, l: number) => ArrayLike<number> }).Float16Array;
    return new Float32Array(new F16(src.buffer, src.byteOffset, src.length));
  }
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const h = src[i];
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    out[i] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return out;
}

/** Logits of any float type as float32. */
export function logitsAsF32(t: RunnableTensor): Float32Array {
  if (t.type === 'float16') return f16ToF32(t.data as Uint16Array);
  return t.data instanceof Float32Array ? t.data : Float32Array.from(t.data as ArrayLike<number>);
}

export function argmax(a: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

export async function greedyDecode(
  deps: DecodeDeps,
  promptEmbeds: Float32Array,
  promptLen: number,
  hidden: number,
  eos: Set<number>,
  maxTokens: number,
): Promise<DecodeResult> {
  const embType = deps.init.inputTypes.input_embeds ?? 'float32';
  const stepEmbType = deps.step.inputTypes.input_embeds ?? embType;
  const embFeed = (x: Float32Array, type: string, dims: number[]) =>
    deps.makeTensor(type, type === 'float16' ? f32ToF16(x) : x, dims);
  const posFeed = (from: number, n: number) =>
    deps.makeTensor('int64', BigInt64Array.from({ length: n }, (_, i) => BigInt(from + i)), [1, n]);

  const t0 = performance.now();
  const out = await deps.init.run({
    input_embeds: embFeed(promptEmbeds, embType, [1, promptLen, hidden]),
    position_ids: posFeed(0, promptLen),
  });
  let next = argmax(logitsAsF32(out.logits));
  const prefillMs = performance.now() - t0;
  const ids = [next];
  let pastK = out.present_keys;
  let pastV = out.present_values;
  let pos = promptLen;
  let steps = 0;
  const t1 = performance.now();
  try {
    while (!eos.has(next) && ids.length < maxTokens) {
      const o = await deps.step.run({
        input_embeds: embFeed(deps.embedRow(next), stepEmbType, [1, 1, hidden]),
        position_ids: posFeed(pos, 1),
        past_keys: pastK,
        past_values: pastV,
      });
      pastK.dispose?.();
      pastV.dispose?.();
      pastK = o.present_keys;
      pastV = o.present_values;
      next = argmax(logitsAsF32(o.logits));
      ids.push(next);
      pos++;
      steps++;
    }
  } finally {
    pastK.dispose?.();
    pastV.dispose?.();
  }
  return { ids, prefillMs, decodeMs: performance.now() - t1, steps };
}
