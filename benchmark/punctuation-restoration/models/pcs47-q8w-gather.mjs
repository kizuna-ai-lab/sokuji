// PCS-47, weight-only 8-bit with a quantized embedding table: model.q8w.onnx plus the
// 250,002 x 768 word-embedding Gather replaced by GatherBlockQuantized (bits=8, block_size=32,
// uint8 with the implicit zero point 128). Both the WASM (CPU) and the WebGPU kernels accept
// that form. Built by parity/pcs47-webgpu-builds.py; see models/pcs47.md "WebGPU builds".
import { definePcs47 } from './pcs47-core.mjs';

const m = definePcs47({ id: 'pcs47-q8w-gather', name: 'PCS-47 xlm-roberta punct+truecase (q8 weight-only + q8 embedding)', modelFile: 'model.q8w-gather.onnx', output: 'punct' });
export const info = m.info;
export const create = m.create;
