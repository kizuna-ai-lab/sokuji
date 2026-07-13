import { createBlobUrlCache } from './blob-url-cache';

/**
 * Configure the Transformers.js `env` for offline, IndexedDB-backed inference:
 * disable the WASM proxy and remote/browser caching, point ONNX at the
 * app-served WASM binaries, and install the blob-URL customCache bridge.
 *
 * `env` is passed in (not imported) so this helper stays decoupled from the
 * `transformers-all` chunk-dedup shim. It configures the transformers `env`
 * ONLY — ASR workers set their separate onnxruntime-web `ortEnv.wasm.wasmPaths`
 * themselves, before their VAD InferenceSession is created.
 *
 * Folds in the module-top `proxy=false` that every worker also duplicated.
 */
export interface TransformersEnvInit {
  fileUrls: Record<string, string>;
  ortWasmBaseUrl?: string;
}

export interface TransformersEnvLike {
  backends?: { onnx?: { wasm?: { proxy?: boolean; wasmPaths?: string } } };
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
  useBrowserCache?: boolean;
  useCustomCache?: boolean;
  // The blob-URL cache object; left untyped to avoid coupling to transformers.js.
  customCache?: unknown;
}

export function initTransformersEnv(env: TransformersEnvLike, msg: TransformersEnvInit): void {
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    if (msg.ortWasmBaseUrl) env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
  }
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = createBlobUrlCache(msg.fileUrls);
}
