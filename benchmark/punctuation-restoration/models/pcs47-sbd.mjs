// PCS-47's sentence-boundary head alone: the same int8 graph as models/pcs47.mjs, returning the
// punctuated text split where seg_preds fires, joined with '\n' (punctuators' apply_sbd=True).
import { definePcs47 } from './pcs47-core.mjs';

const m = definePcs47({ id: 'pcs47-sbd', name: 'PCS-47 xlm-roberta sentence-boundary head (int8)', modelFile: 'model.int8.onnx', output: 'boundary' });
export const info = m.info;
export const create = m.create;
