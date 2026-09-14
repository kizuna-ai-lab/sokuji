// FireRedPunc, weight-only 8-bit: parity/fireredpunc-quant.py ran onnxruntime's
// MatMulNBitsQuantizer (bits=8, block_size=32, symmetric) over our fp32 export, so weights
// are int8 per 32-value block and activations stay fp32. Unlike dynamic int8 (42ailab's file
// and a per-channel re-quantization), it keeps upstream's decisions. 163 MB.
import { createFireRedPunc, info as int8Info } from './fireredpunc.mjs';

export const info = {
  ...int8Info,
  id: 'fireredpunc-q8w',
  name: 'FireRedPunc q8 weight-only (MatMulNBits)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx',
  files: ['punc.q8w.onnx', 'tokenizer.json', 'out_dict'],
};

export const create = (deps) => createFireRedPunc(deps, 'punc.q8w.onnx');
