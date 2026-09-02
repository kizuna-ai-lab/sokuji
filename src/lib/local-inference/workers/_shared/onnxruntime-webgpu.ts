/**
 * WebGPU-capable onnxruntime-web barrel.
 *
 * The default `onnxruntime-web` entry (used by `onnxruntime-all.ts`) resolves to the
 * wasm-only bundle: opening an `InferenceSession` with `executionProviders: ['webgpu']`
 * there does NOT run on the GPU and returns garbage. Workers that drive a model on the
 * WebGPU EP directly (rather than through Transformers.js, which carries its own ORT) must
 * import from the package's `./webgpu` entry (`ort.webgpu.bundle.min.mjs`). It also bundles
 * the wasm EP, so a VAD session created with `executionProviders: ['wasm']` still works.
 *
 * The side-effect pin keeps per-worker tree-shaking producing an identical chunk, as in
 * `onnxruntime-all.ts`.
 */
import * as ORT from 'onnxruntime-web/webgpu';
(self as { __ortWebgpuPin?: unknown }).__ortWebgpuPin = [
  ORT.InferenceSession,
  ORT.Tensor,
  ORT.env,
];
export { InferenceSession, Tensor, env } from 'onnxruntime-web/webgpu';
