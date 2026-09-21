// PCS-47 (1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase) on the int8 build
// (dynamic per-channel QInt8 over MatMul + Gather, 279 MB). See models/pcs47.md.
import { definePcs47 } from './pcs47-core.mjs';

const m = definePcs47({ id: 'pcs47', name: 'PCS-47 xlm-roberta punct+truecase (int8)', modelFile: 'model.int8.onnx', output: 'punct' });
export const info = m.info;
export const create = m.create;
