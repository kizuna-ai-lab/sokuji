// PCS-47, weight-only 8-bit for the WebGPU EP: the 72 encoder MatMuls with constant weights are
// MatMulNBits (bits=8, block_size=32, symmetric) and activations stay fp32 — the FireRedPunc q8w
// recipe, except that the 8 small decoder-head MatMuls stay fp32 (parity/pcs47-webgpu-builds.py;
// why: parity/pcs47-webgpu-builds-recipes.py). The 250,002 x 768 word-embedding Gather stays fp32.
// Dynamic int8 (MatMulInteger/DynamicQuantizeLinear) has no WebGPU kernel; this build does.
// See models/pcs47.md "WebGPU builds".
import { definePcs47 } from './pcs47-core.mjs';

const m = definePcs47({ id: 'pcs47-q8w', name: 'PCS-47 xlm-roberta punct+truecase (q8 weight-only, MatMulNBits)', modelFile: 'model.q8w.onnx', output: 'punct' });
export const info = m.info;
export const create = m.create;
