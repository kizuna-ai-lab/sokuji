#!/usr/bin/env python3
# Apache License 2.0
"""Upcast every float16 tensor in an ONNX model to float32.

The cosy-voice3-onnx flow estimator (DiT) stores fp16 weights and casts
activations to fp16 internally. On backends with real fp16 arithmetic
(aarch64 NEON, CUDA) the graph overflows and returns NaN for any input;
x86 CPU only survives because ORT emulates fp16 in fp32 there. Rewriting
the whole graph to fp32 (initializers, Cast targets, value_info dtypes,
Constant values) removes the overflow without needing the original
PyTorch checkpoint.
"""

import sys

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper

FP16 = TensorProto.FLOAT16
FP32 = TensorProto.FLOAT


def convert_tensor(t: onnx.TensorProto) -> None:
    if t.data_type != FP16:
        return
    arr = numpy_helper.to_array(t).astype(np.float32)
    t.CopyFrom(numpy_helper.from_array(arr, t.name))


def convert_type(tt: onnx.TypeProto) -> None:
    if tt.HasField("tensor_type") and tt.tensor_type.elem_type == FP16:
        tt.tensor_type.elem_type = FP32


def main(src: str, dst: str) -> None:
    model = onnx.load(src)
    graph = model.graph

    for init in graph.initializer:
        convert_tensor(init)
    for vi in list(graph.value_info) + list(graph.input) + list(graph.output):
        convert_type(vi.type)
    for node in graph.node:
        for attr in node.attribute:
            if attr.name == "to" and attr.i == FP16:
                attr.i = FP32
            if attr.HasField("t"):
                convert_tensor(attr.t)
            for t in attr.tensors:
                convert_tensor(t)
        # Cast nodes to fp16 become fp32 no-ops, which is valid.

    # NOTE: the source export is not topologically sorted (checker rejects it
    # as-is, ORT accepts it), so no checker pass here.
    onnx.save(model, dst)
    print(f"saved {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
