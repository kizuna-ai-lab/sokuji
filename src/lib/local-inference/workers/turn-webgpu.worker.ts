/** Smart Turn worker, WebGPU entry: the only onnxruntime-web bundle whose sessions really run on the GPU. */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';
import { installTurnWorker } from './_shared/turn-core';

installTurnWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  device: 'webgpu',
  async prepare() {
    if (!(await acquireWebGpuAdapter(ortEnv))) throw new Error('Smart Turn: no WebGPU adapter in this worker');
    await bindCheckedWebGpuAdapter(ortEnv, 'fp32', 'Smart Turn');
  },
});
