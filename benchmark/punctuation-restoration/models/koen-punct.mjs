// whooray/koen_punctuation (Korean + English punctuation, gte-multilingual base) on the int8 build
// (dynamic per-channel QInt8 over MatMul + Gather). See models/koen-punct.md.
import { defineKoen } from './koen-punct-core.mjs';

const m = defineKoen({ id: 'koen-punct', name: 'koen_punctuation gte-multilingual ko+en (int8)', modelFile: 'model.int8.onnx' });
export const info = m.info;
export const create = m.create;
