"""q4f16 via onnxruntime's own float16 converter (handles Cast nodes and MatMulNBits scales).

usage: to_q4f16_ort.py <dir> [suffix] [blocked ops comma-separated]
Default keeps the RMSNorm / softmax arithmetic in fp32 (fp16 overflow in the variance
turned every logit into NaN in the first attempt).
"""
import os
import sys
import time

import onnx
from onnxruntime.transformers.onnx_model import OnnxModel

d = sys.argv[1]
suffix = sys.argv[2] if len(sys.argv) > 2 else "q4f16"
blocked = sys.argv[3].split(",") if len(sys.argv) > 3 else ["Pow", "ReduceMean", "Sqrt", "Reciprocal", "Softmax", "Range", "Cos", "Sin"]
for name in ("decoder_init", "decoder_step"):
    src = os.path.join(d, f"{name}.int4.onnx")
    dst = os.path.join(d, f"{name}.{suffix}.onnx")
    t = time.time()
    m = onnx.load(src)
    om = OnnxModel(m)
    om.convert_float_to_float16(keep_io_types=False, use_symbolic_shape_infer=False, op_block_list=blocked)
    om.save_model_to_file(dst, use_external_data_format=True, all_tensors_to_one_file=True)
    print(name, "->", dst, f"{time.time() - t:.0f}s blocked={blocked}", flush=True)
    m2 = onnx.load(dst, load_external_data=False)
    print("  inputs:", [(i.name, i.type.tensor_type.elem_type) for i in m2.graph.input])
    print("  outputs:", [(o.name, o.type.tensor_type.elem_type) for o in m2.graph.output])
for f in sorted(os.listdir(d)):
    if suffix in f:
        print(f"{os.path.getsize(os.path.join(d, f)) / 1e6:9.1f} MB  {f}")
