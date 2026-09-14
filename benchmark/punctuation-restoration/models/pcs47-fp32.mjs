// PCS-47 on the upstream fp32 graph (1.1 GB): the quality reference for the int8 build.
import { definePcs47 } from './pcs47-core.mjs';

const m = definePcs47({ id: 'pcs47-fp32', name: 'PCS-47 xlm-roberta punct+truecase (fp32)', modelFile: 'model.onnx', output: 'punct' });
export const info = m.info;
export const create = m.create;
