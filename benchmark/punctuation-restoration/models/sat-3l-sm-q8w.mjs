// sat-3l-sm, weight-only 8-bit for the WebGPU EP: MatMulNBits (bits=8, block_size=32, symmetric)
// over the fp32 rewrite of the published export, with float32 activations, attention_mask and
// logits (parity/sat-3l-sm-q8w.py). The published fp16 file needs shader-f16 on WebGPU; this one
// does not. The pipeline is models/sat-3l-sm.mjs unchanged: its create() reads model.onnx and
// tokenizer.json and picks the float32 mask from session.inputMetadata.
// See models/sat-3l-sm.md "q8w build".
import { create as createSat, info as fp16Info } from './sat-3l-sm.mjs';

export { DEFAULTS, tokenizeWithEnds, sentencesFrom, joinSegments } from './sat-3l-sm.mjs';

export const info = {
  ...fp16Info,
  id: 'sat-3l-sm-q8w',
  name: 'SaT sat-3l-sm q8 weight-only (MatMulNBits, fp32 activations, boundaries only)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/sat/sat-3l-sm-q8w',
  files: ['model.onnx', 'tokenizer.json'],
};

export const create = createSat;
