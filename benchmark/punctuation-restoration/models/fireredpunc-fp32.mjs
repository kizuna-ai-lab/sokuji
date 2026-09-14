// FireRedPunc fp32: upstream model.pth.tar exported to ONNX by parity/fireredpunc-export.py
// (same interface as the 42ailab int8 file). Matches upstream PyTorch on every token of the
// parity set; the 42ailab int8 file does not (see models/fireredpunc.md). 407 MB.
import { createFireRedPunc, info as int8Info } from './fireredpunc.mjs';

export const info = {
  ...int8Info,
  id: 'fireredpunc-fp32',
  name: 'FireRedPunc fp32 (own ONNX export)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx',
  files: ['punc.fp32.onnx', 'tokenizer.json', 'out_dict'],
};

export const create = (deps) => createFireRedPunc(deps, 'punc.fp32.onnx');
