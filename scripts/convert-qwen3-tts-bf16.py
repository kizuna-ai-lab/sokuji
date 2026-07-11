#!/usr/bin/env python
"""fp32 -> bf16 converter for code_predictor.onnx (Qwen3-TTS code predictor).

Logic adapted from onnxruntime.transformers.float16.convert_float_to_float16 but
targeting BFLOAT16, simplified for a flat graph (no subgraphs/control flow):

- float32 initializers -> BFLOAT16 raw uint16 (round-to-nearest-even via the
  (u32 + 0x7FFF + lsb) >> 16 trick), unless consumed exclusively by blocked nodes.
- keep_io_types style: graph inputs/outputs stay float32; Cast nodes are inserted
  at the boundaries, so the runtime needs no dtype changes.
- Cast(to=FLOAT) nodes on non-blocked paths are rewritten to Cast(to=BFLOAT16).
- op_block_list / node_block_prefixes: blocked nodes keep fp32 compute; boundary
  Casts are inserted on their float edges (with a peephole so blocked->blocked
  edges stay fp32 without a bf16 round-trip).
- --pre-optimize: run the ORT graph optimizer (CUDA EP, ORT_ENABLE_ALL) on the
  fp32 model FIRST, so RMSNorm -> SimplifiedLayerNormalization / QuickGelu /
  FusedMatMul / Split fusions fire in fp32, then convert the fused graph.
  Without this, blocking ReduceMean breaks LayerNormFusion and the bf16 graph
  ends up with ~170 extra dispatches per call (this workload is host-dispatch
  bound, so that matters more than FLOPs).

Empirically determined block set for ORT 1.24 CUDA EP on this graph:
  - Cos/Sin: bfloat16 is not a legal input type per the ONNX schema at all.
    The whole rotary angle path is kept fp32 (name prefixes /model/rotary_emb/
    and the lone post-fusion "Transpose" feeding Cos/Sin): tiny tensors, and
    angle precision does not survive bf16 for large positions.
  - ReduceMean: no CUDA bf16 kernel in ORT 1.24 (fails placement). Only present
    when converting the unoptimized graph; the pre-optimized graph fuses it away
    into SimplifiedLayerNormalization (which stashes variance in fp32 anyway).
Everything else used by these graphs (MatMul/FusedMatMul/Add/Mul/Div/Pow/Sqrt/
Neg/Sigmoid/QuickGelu/Softmax/SimplifiedLayerNormalization/IsNaN/Where/Gather/
Concat/Slice/Split/Reshape/Transpose/Expand/Squeeze/Unsqueeze/Shape/Cast) has
bf16 CUDA kernels (probed with single-op models and
session.disable_cpu_ep_fallback=1).
"""
import argparse
import glob
import os
import tempfile
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

FLOAT = TensorProto.FLOAT
BF16 = TensorProto.BFLOAT16
BOOL = TensorProto.BOOL
INT64 = TensorProto.INT64

DEFAULT_OP_BLOCK_LIST = ["ReduceMean", "Cos", "Sin"]
DEFAULT_NODE_BLOCK_PREFIXES = ["/model/rotary_emb/", "Transpose"]


def f32_to_bf16_u16(a: np.ndarray) -> np.ndarray:
    """Round-to-nearest-even fp32 -> bf16, returned as uint16."""
    a = np.ascontiguousarray(a, dtype=np.float32)
    u = a.view(np.uint32)
    rounded = u + np.uint32(0x7FFF) + ((u >> np.uint32(16)) & np.uint32(1))
    bf = (rounded >> np.uint32(16)).astype(np.uint16)
    # keep NaNs NaN (the rounding trick can carry an sNaN mantissa into inf)
    return np.where(np.isnan(a), np.uint16(0x7FC0), bf)


def tensor_to_bf16(t: TensorProto) -> TensorProto:
    arr = numpy_helper.to_array(t)
    new = TensorProto()
    new.name = t.name
    new.dims.extend(t.dims)
    new.data_type = BF16
    new.raw_data = f32_to_bf16_u16(arr).tobytes()
    return new


BOOL_OPS = {"Equal", "Greater", "Less", "LessOrEqual", "GreaterOrEqual",
            "IsNaN", "IsInf", "Not", "And", "Or", "Xor"}
INT64_OPS = {"Shape", "Size", "NonZero", "ArgMax", "ArgMin"}


def propagate_dtypes(graph):
    """Forward element-type propagation. Unlike onnx.shape_inference this also
    covers com.microsoft contrib ops (they are all type-preserving here)."""
    dtype = {}
    for t in graph.initializer:
        dtype[t.name] = t.data_type
    for gi in graph.input:
        dtype[gi.name] = gi.type.tensor_type.elem_type
    for n in graph.node:
        if n.op_type == "Constant":
            for a in n.attribute:
                if a.type == onnx.AttributeProto.TENSOR:
                    dtype[n.output[0]] = a.t.data_type
                elif a.name in ("value_float", "value_floats"):
                    dtype[n.output[0]] = FLOAT
                elif a.name in ("value_int", "value_ints"):
                    dtype[n.output[0]] = INT64
            continue
        if n.op_type == "Cast":
            dtype[n.output[0]] = next(a.i for a in n.attribute if a.name == "to")
        elif n.op_type == "ConstantOfShape":
            val = [a for a in n.attribute if a.name == "value"]
            dtype[n.output[0]] = val[0].t.data_type if val else FLOAT
        elif n.op_type in BOOL_OPS:
            dtype[n.output[0]] = BOOL
        elif n.op_type in INT64_OPS:
            dtype[n.output[0]] = INT64
        elif n.op_type == "Where":
            dtype[n.output[0]] = dtype.get(n.input[1], 0)
        else:
            dt = dtype.get(n.input[0], 0) if n.input else 0
            for o in n.output:
                dtype[o] = dt
            if n.op_type in ("SimplifiedLayerNormalization", "LayerNormalization"):
                for o in n.output[1:]:  # stash outputs are fp32 (stash_type=1)
                    dtype[o] = FLOAT
    return dtype


def convert(model, op_block_list=None, node_block_prefixes=None):
    op_block_list = set(DEFAULT_OP_BLOCK_LIST if op_block_list is None else op_block_list)
    node_block_prefixes = list(DEFAULT_NODE_BLOCK_PREFIXES if node_block_prefixes is None else node_block_prefixes)
    graph = model.graph
    assert not any(a.type in (onnx.AttributeProto.GRAPH, onnx.AttributeProto.GRAPHS)
                   for n in graph.node for a in n.attribute), "subgraphs not supported"

    dtype = propagate_dtypes(graph)
    is_float = lambda name: name and dtype.get(name) == FLOAT

    def blocked(n):
        return n.op_type in op_block_list or any(n.name.startswith(p) for p in node_block_prefixes)

    consumers = {}
    for n in graph.node:
        for i in n.input:
            consumers.setdefault(i, []).append(n)

    # --- initializers ---------------------------------------------------
    # domain[name] for float tensors: BF16 or FLOAT (dtype it carries post-conversion)
    domain = {}
    stats = {"init_bf16": 0, "init_fp32_kept": 0, "const_bf16": 0, "const_fp32_kept": 0,
             "cast_retargeted": 0, "boundary_casts": 0, "blocked_nodes": 0}
    new_inits = []
    for t in graph.initializer:
        if t.data_type == FLOAT:
            cons = consumers.get(t.name, [])
            if cons and all(blocked(c) for c in cons):
                new_inits.append(t)  # only blocked consumers: keep fp32
                domain[t.name] = FLOAT
                stats["init_fp32_kept"] += 1
            else:
                new_inits.append(tensor_to_bf16(t))
                domain[t.name] = BF16
                stats["init_bf16"] += 1
        else:
            new_inits.append(t)
    del graph.initializer[:]
    graph.initializer.extend(new_inits)

    # graph inputs stay fp32 (keep_io_types)
    for gi in graph.input:
        if gi.type.tensor_type.elem_type == FLOAT:
            domain[gi.name] = FLOAT

    # --- stream nodes, rewrite dtypes, insert boundary casts ------------
    new_nodes = []
    cast_cache = {}  # (tensor_name, target_dtype) -> casted name

    def get_cast(name, target):
        key = (name, target)
        if key not in cast_cache:
            suffix = "_bf16" if target == BF16 else "_fp32"
            out = name + suffix
            new_nodes.append(helper.make_node("Cast", [name], [out], name=f"bf16conv_Cast{len(cast_cache)}", to=target))
            cast_cache[key] = out
            stats["boundary_casts"] += 1
        return cast_cache[key]

    for n in graph.node:
        nb = blocked(n)
        want = FLOAT if nb else BF16
        if nb:
            stats["blocked_nodes"] += 1
        # Constant nodes producing float tensors
        if n.op_type == "Constant":
            for a in n.attribute:
                if a.type == onnx.AttributeProto.TENSOR and a.t.data_type == FLOAT:
                    cons = consumers.get(n.output[0], [])
                    if cons and all(blocked(c) for c in cons):
                        domain[n.output[0]] = FLOAT
                        stats["const_fp32_kept"] += 1
                    else:
                        a.t.CopyFrom(tensor_to_bf16(a.t))
                        domain[n.output[0]] = BF16
                        stats["const_bf16"] += 1
            new_nodes.append(n)
            continue
        # retarget non-blocked Cast(to=FLOAT) -> Cast(to=BFLOAT16)
        if n.op_type == "Cast" and not nb:
            for a in n.attribute:
                if a.name == "to" and a.i == FLOAT:
                    a.i = BF16
                    dtype[n.output[0]] = FLOAT  # logical dtype stays "float"
                    stats["cast_retargeted"] += 1
        # rewire float inputs whose current domain mismatches
        for idx, i in enumerate(n.input):
            if is_float(i) and domain.get(i, BF16) != want:
                n.input[idx] = get_cast(i, want)
        # record output domains
        for o in n.output:
            if is_float(o):
                domain[o] = want
        new_nodes.append(n)

    # --- graph outputs stay fp32 ----------------------------------------
    for go in graph.output:
        if go.type.tensor_type.elem_type == FLOAT and domain.get(go.name) == BF16:
            hidden = go.name + "_pre_out_bf16"
            for n in new_nodes:  # rename producer + any internal consumers
                for idx, o in enumerate(n.output):
                    if o == go.name:
                        n.output[idx] = hidden
                for idx, i in enumerate(n.input):
                    if i == go.name:
                        n.input[idx] = hidden
            new_nodes.append(helper.make_node("Cast", [hidden], [go.name], name=f"bf16conv_CastOut_{go.name}", to=FLOAT))
            stats["boundary_casts"] += 1

    del graph.node[:]
    graph.node.extend(new_nodes)
    del graph.value_info[:]  # let ORT re-infer; original infos are fp32-typed
    return model, stats


def ort_pre_optimize(src_path: str) -> str:
    """Run the ORT graph optimizer (CUDA EP if available) on the fp32 model and
    return the path of the optimized model (fusions fire in fp32)."""
    import onnxruntime as ort
    try:
        ort.preload_dlls()
    except Exception:
        pass
    out = os.path.join(tempfile.mkdtemp(prefix="bf16_opt_"), "opt_fp32.onnx")
    so = ort.SessionOptions()
    so.log_severity_level = 3
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.optimized_model_filepath = out
    # >2GB models (the 1.7B talker) need external-data output from the optimizer
    if os.path.getsize(src_path) + sum(
            os.path.getsize(src_path + ext) for ext in (".data",)
            if os.path.exists(src_path + ext)) > 1_900_000_000:
        so.add_session_config_entry(
            "session.optimized_model_external_initializers_file_name",
            os.path.basename(out) + ".data")
        so.add_session_config_entry(
            "session.optimized_model_external_initializers_min_size_in_bytes", "1024")
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                 if p in ort.get_available_providers()]
    ort.InferenceSession(src_path, so, providers=providers)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--pre-optimize", action="store_true",
                    help="run ORT fp32 graph optimizer (fusions) before bf16 conversion")
    ap.add_argument("--op-block-list", nargs="*", default=None)
    ap.add_argument("--node-block-prefixes", nargs="*", default=None)
    args = ap.parse_args()

    src = ort_pre_optimize(args.src) if args.pre_optimize else args.src
    model = onnx.load(src)
    model, stats = convert(model, args.op_block_list, args.node_block_prefixes)
    total = sum(len(t.raw_data) for t in model.graph.initializer)
    if total > 1_900_000_000:
        print("checker: skipped (>2GB proto cannot be serialized in memory)")
    else:
        try:
            onnx.checker.check_model(model)
        except onnx.checker.ValidationError as e:
            # ORT-fused ops (e.g. SimplifiedLayerNormalization) are ORT-internal
            # and unknown to the onnx checker; expected with --pre-optimize.
            if "No Op registered" not in str(e):
                raise
            print(f"checker: skipped ORT-internal op ({str(e).splitlines()[0]})")
    if total > 1_900_000_000:
        onnx.save(model, args.dst, save_as_external_data=True,
                  all_tensors_to_one_file=True,
                  location=os.path.basename(args.dst) + ".data")
    else:
        onnx.save(model, args.dst)
    print("saved", args.dst)
    print("stats", stats)


if __name__ == "__main__":
    main()
