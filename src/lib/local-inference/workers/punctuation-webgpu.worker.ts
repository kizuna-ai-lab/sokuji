/**
 * Punctuation worker, WebGPU entry.
 *
 * Imports the onnxruntime-web/webgpu bundle, which is the only one whose
 * sessions really run on the GPU. Its WASM EP lacks GatherBlockQuantized, so
 * SaT cannot fall back to CPU inside this bundle — a WebGPU failure recreates
 * the worker with the wasm entry instead.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';
import { installPunctuationWorker } from './_shared/punctuation-core';
import { createFireRedPuncAdapter } from './_shared/punctuation-fireredpunc';
import { createEdgePunctEnAdapter } from './_shared/punctuation-edge-punct-en';
import { createSatAdapter } from './_shared/punctuation-sat';

installPunctuationWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  async canUseWebGpu() {
    const adapter = await acquireWebGpuAdapter(ortEnv);
    if (!adapter) return false;
    // No build here uses a float16 tensor, so this binds the checked adapter
    // without demanding shader-f16.
    await bindCheckedWebGpuAdapter(ortEnv, 'q8', 'Punctuation');
    return true;
  },
  adapters: {
    'fireredpunc': createFireRedPuncAdapter,
    'edge-punct-en': createEdgePunctEnAdapter,
    'sat-3l-sm': createSatAdapter,
  },
});
