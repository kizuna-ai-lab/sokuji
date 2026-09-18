"""Does one int8 layer of model.int8.onnx compute the same integers in native onnxruntime and in
exact integer math? Writes a tiny DynamicQuantizeLinear -> MatMulInteger graph built on a real
weight, a float input, and every output, for parity/pcs47-probe-matmulinteger.mjs (onnxruntime-web) to compare.
"""
import json
import platform

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper

SRC = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47/model.int8.onnx"
OUT = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47-probe/matmulinteger"

import os

os.makedirs(OUT, exist_ok=True)
m = onnx.load(SRC)
init = {i.name: i for i in m.graph.initializer}
consts = {n.output[0]: n for n in m.graph.node if n.op_type == "Constant"}


def value(name):
    if name in init:
        return numpy_helper.to_array(init[name])
    if name in consts:
        return numpy_helper.to_array(consts[name].attribute[0].t)
    return None


node = next(n for n in m.graph.node if n.op_type == "MatMulInteger" and value(n.input[1]) is not None)
W = value(node.input[1])
WZ = value(node.input[3]) if len(node.input) > 3 and node.input[3] else None
print("node", node.name, "inputs", list(node.input), "W", W.dtype, W.shape, "WZ", None if WZ is None else (WZ.dtype, WZ.shape, int(np.abs(WZ).max())))

T, D = 128, W.shape[0]
rng = np.random.default_rng(0)
X = (rng.standard_normal((1, T, D)) * 1.5).astype(np.float32)
X[0, :, rng.integers(0, D, 8)] *= 12.0  # a few outlier channels, as transformer hidden states have

nodes = [
    helper.make_node("DynamicQuantizeLinear", ["X"], ["xq", "xs", "xz"]),
    helper.make_node("MatMulInteger", ["xq", "W", "xz"] + (["WZ"] if WZ is not None else []), ["Y"]),
]
inits = [numpy_helper.from_array(W, "W")] + ([numpy_helper.from_array(WZ, "WZ")] if WZ is not None else [])
g = helper.make_graph(
    nodes,
    "probe",
    [helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, T, D])],
    [
        helper.make_tensor_value_info("xq", TensorProto.UINT8, [1, T, D]),
        helper.make_tensor_value_info("xs", TensorProto.FLOAT, []),
        helper.make_tensor_value_info("xz", TensorProto.UINT8, []),
        helper.make_tensor_value_info("Y", TensorProto.INT32, [1, T, W.shape[1]]),
    ],
    inits,
)
pm = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
pm.ir_version = m.ir_version
onnx.save(pm, f"{OUT}/probe.onnx")

res = {}
for label, level in [("opt", ort.GraphOptimizationLevel.ORT_ENABLE_ALL), ("noopt", ort.GraphOptimizationLevel.ORT_DISABLE_ALL)]:
    so = ort.SessionOptions()
    so.graph_optimization_level = level
    s = ort.InferenceSession(f"{OUT}/probe.onnx", sess_options=so, providers=["CPUExecutionProvider"])
    xq, xs, xz, Y = s.run(None, {"X": X})
    res[label] = (xq, xs, xz, Y)
    Y.astype(np.int32).tofile(f"{OUT}/Y-native-{label}.bin")

xq, xs, xz, _ = res["opt"]
wz = np.zeros(W.shape[1], np.int64) if WZ is None else WZ.astype(np.int64)
exact = (xq.astype(np.int64) - int(xz)) @ (W.astype(np.int64) - wz)
assert np.abs(exact).max() < 2**31
exact.astype(np.int32).tofile(f"{OUT}/Y-exact.bin")
X.tofile(f"{OUT}/X.bin")
xq.tofile(f"{OUT}/xq-native.bin")
for label, (_, _, _, Y) in res.items():
    d = Y.astype(np.int64) - exact
    print(f"native {label}: Y != exact in {int((d != 0).sum())} of {d.size}, max |diff| {int(np.abs(d).max())}")
json.dump(
    {"T": T, "D": D, "C": int(W.shape[1]), "xs": float(xs), "xz": int(xz), "machine": platform.machine(), "ort": ort.__version__},
    open(f"{OUT}/meta.json", "w"),
)
print("meta", json.load(open(f"{OUT}/meta.json")))
