// Mojicast punctuation BERT, weight-only 8-bit for the WebGPU EP: MatMulNBits (bits=8,
// block_size=32, symmetric) over the fp32 punct_bert.onnx, activations fp32 — the FireRedPunc
// q8w recipe (parity/mojicast-q8w.py). Same pipeline as mojicast.mjs. The graph keeps the export's
// 12 IsNaN guards, which have no WebGPU kernel; mojicast-q8w-nonan drops them.
// See models/mojicast.md "WebGPU builds".
import { createMojicast, info as int8Info } from './mojicast.mjs';

export const info = {
  ...int8Info,
  id: 'mojicast-q8w',
  name: 'Mojicast punct BERT q8 weight-only (MatMulNBits)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/mojicast',
  files: ['punct_bert.q8w.onnx', 'vocab.txt'],
};

export const create = (deps) => createMojicast(deps, 'punct_bert.q8w.onnx');
