// Mojicast punctuation BERT, weight-only 8-bit, without the IsNaN guards: punct_bert.q8w.onnx with
// each attention layer's Where(IsNaN(softmax), 0, softmax) replaced by the softmax itself.
// onnxruntime's native WebGPU EP has no IsNaN kernel, so the guarded graph drops to the CPU inside
// all 12 layers. The guard only fires on a fully masked row; this module always passes an all-ones
// mask, so outputs are bit-identical to mojicast-q8w (parity/mojicast-q8w.mjs checks it).
// See models/mojicast.md "WebGPU builds".
import { createMojicast, info as int8Info } from './mojicast.mjs';

export const info = {
  ...int8Info,
  id: 'mojicast-q8w-nonan',
  name: 'Mojicast punct BERT q8 weight-only, no IsNaN guard (WebGPU)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/mojicast',
  files: ['punct_bert.q8w-nonan.onnx', 'vocab.txt'],
};

export const create = (deps) => createMojicast(deps, 'punct_bert.q8w-nonan.onnx');
