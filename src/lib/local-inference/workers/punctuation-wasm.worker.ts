/**
 * Punctuation worker, CPU entry.
 *
 * Imports the default onnxruntime-web bundle. It is the only one whose WASM
 * EP registers GatherBlockQuantized, which SaT's 8-bit embedding needs, so
 * this entry is both the no-GPU path and the fallback after a GPU failure.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { installPunctuationWorker } from './_shared/punctuation-core';
import { createFireRedPuncAdapter } from './_shared/punctuation-fireredpunc';
import { createEdgePunctEnAdapter } from './_shared/punctuation-edge-punct-en';
import { createSatAdapter } from './_shared/punctuation-sat';

installPunctuationWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  // This bundle has no GPU execution provider at all; every model runs on CPU.
  async canUseWebGpu() { return false; },
  adapters: {
    'fireredpunc': createFireRedPuncAdapter,
    'edge-punct-en': createEdgePunctEnAdapter,
    'sat-3l-sm': createSatAdapter,
  },
});
