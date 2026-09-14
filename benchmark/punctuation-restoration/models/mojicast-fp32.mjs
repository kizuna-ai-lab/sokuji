// Mojicast punctuation BERT, fp32 — the app's 高精度モード ("high precision mode") and
// its automatic fallback when the int8 self-test fails. Same pipeline as mojicast.mjs.
import { createMojicast, info as int8Info } from './mojicast.mjs';

export const info = {
  ...int8Info,
  id: 'mojicast-fp32',
  name: 'Mojicast punct BERT fp32',
  files: ['punct_bert.onnx', 'vocab.txt'],
};

export const create = (deps) => createMojicast(deps, 'punct_bert.onnx');
