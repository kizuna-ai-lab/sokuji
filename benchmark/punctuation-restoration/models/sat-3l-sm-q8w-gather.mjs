// sat-3l-sm, weight-only 8-bit with a quantized embedding table: sat-3l-sm-q8w plus the
// 250,002 x 768 word-embedding Gather replaced by GatherBlockQuantized (bits=8, block_size=32,
// uint8 with the implicit zero point 128), which both the WASM (CPU) and WebGPU kernels accept.
// Built by parity/sat-3l-sm-q8w.py; pipeline is models/sat-3l-sm.mjs unchanged.
// See models/sat-3l-sm.md "q8w build".
import { create as createSat, info as fp16Info } from './sat-3l-sm.mjs';

export { DEFAULTS, tokenizeWithEnds, sentencesFrom, joinSegments } from './sat-3l-sm.mjs';

export const info = {
  ...fp16Info,
  id: 'sat-3l-sm-q8w-gather',
  name: 'SaT sat-3l-sm q8 weight-only + q8 embedding (boundaries only)',
  localDir: '/home/jiangzhuo/.cache/sokuji-punct-bench/sat/sat-3l-sm-q8w-gather',
  files: ['model.onnx', 'tokenizer.json'],
};

export const create = createSat;
