// whooray/koen_punctuation on the fp32 ONNX export: the quality reference for the int8 build.
import { defineKoen } from './koen-punct-core.mjs';

const m = defineKoen({ id: 'koen-punct-fp32', name: 'koen_punctuation gte-multilingual ko+en (fp32)', modelFile: 'model.onnx' });
export const info = m.info;
export const create = m.create;
