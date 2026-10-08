/** Smart Turn worker, CPU entry: the no-GPU path and the fallback after a GPU failure. */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { installTurnWorker } from './_shared/turn-core';

installTurnWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  device: 'wasm',
  async prepare() {},
});
