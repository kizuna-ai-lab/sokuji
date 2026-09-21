"""Where do onnxruntime-web and native onnxruntime part ways on PCS-47?

Expose every LayerNormalization output (fp32 and int8 graphs) and both DynamicQuantizeLinear
outputs that carry data (quantized tensor, scale; int8 graph) as graph outputs, run two real
128-token windows natively, and save every array for parity/pcs47-probe-layers.mjs (onnxruntime-web).
"""
import json
import os

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper

D = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47"
OUT = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47-probe"
REF = "/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/research-asr-punctuation/benchmark/punctuation-restoration/results/parity-pcs47-ref-fp32.json"
os.makedirs(OUT, exist_ok=True)

with open(REF, encoding="utf-8") as fh:
    rows = {r["id"]: r for r in json.load(fh)["rows"]}
inputs = {k: np.array([[0] + rows[f"{k}-long"]["sp_ids_pre"][:128] + [2]], dtype=np.int64) for k in ["en", "zh"]}


def augment(src, tag):
    m = onnx.load(src)
    have = {o.name for o in m.graph.output}
    extra = []
    for n in m.graph.node:
        if n.op_type == "LayerNormalization":
            extra.append((n.output[0], TensorProto.FLOAT, "ln"))
        elif n.op_type == "DynamicQuantizeLinear":
            extra.append((n.output[0], TensorProto.UINT8, "xq"))
            extra.append((n.output[1], TensorProto.FLOAT, "scale"))
    extra = [e for e in extra if e[0] not in have]
    for name, elem, _ in extra:
        m.graph.output.append(helper.make_tensor_value_info(name, elem, None))
    path = f"{OUT}/{tag}.onnx"
    onnx.save(m, path)
    return path, extra


models = {}
for tag, src in [("int8", f"{D}/model.int8.onnx"), ("fp32", f"{D}/model.onnx")]:
    path, extra = augment(src, tag)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    s = ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])
    names = [e[0] for e in extra]
    entries = []
    for k, x in inputs.items():
        vals = s.run(names, {"input_ids": x})
        for i, ((name, _, kind), v) in enumerate(zip(extra, vals)):
            f = f"{tag}-{k}-{i}.bin"
            np.ascontiguousarray(v).tofile(f"{OUT}/{f}")
            entries.append({"input": k, "name": name, "kind": kind, "dtype": str(v.dtype), "shape": list(v.shape), "file": f})
    models[tag] = {"model": os.path.basename(path), "entries": entries}
    print(tag, "exposed", len(extra), "tensors ->", path, os.path.getsize(path), "bytes", flush=True)

with open(f"{OUT}/manifest.json", "w") as fh:
    json.dump(
        {"inputs": {k: x.tolist() for k, x in inputs.items()}, "models": models, "ort": ort.__version__},
        fh,
    )
print("wrote", f"{OUT}/manifest.json")
