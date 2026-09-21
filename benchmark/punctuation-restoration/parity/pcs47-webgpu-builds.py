"""WebGPU-friendly PCS-47 builds (onnxruntime-web 1.26, native WebGPU EP). See models/pcs47.md "WebGPU builds".

  model.q8w.onnx         the 72 encoder MatMuls with a constant weight -> com.microsoft MatMulNBits, bits=8,
                         block_size=32, symmetric, activations fp32 (MatMulNBitsQuantizer: the recipe of
                         parity/fireredpunc-quant.py). The 8 decoder-head MatMuls stay fp32 (quantizing them
                         changed 14 rows instead of 9, parity/pcs47-webgpu-builds-recipes.py), and so does the
                         250,002 x 768 word-embedding Gather.
  model.q8w-gather.onnx  model.q8w.onnx with that Gather replaced by com.microsoft GatherBlockQuantized,
                         bits=8, block_size=32 along the hidden axis, uint8 data with the implicit zero point
                         128 and one fp32 scale per block (max|w| / 127). ORT's MatMulNBitsQuantizer only
                         emits 4-bit GatherBlockQuantized ("Gather only supports 4 bits quantization"), but the
                         CPU/WASM and WebGPU kernels both accept uint8 data with bits=8, so it is built by hand.
  model.fp16.onnx        (--fp16) onnxruntime.transformers.float16.convert_float_to_float16(keep_io_types=True),
                         compared tensor by tensor with Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16.

Then a native sanity check (Python onnxruntime CPU EP): the four label heads on the first 254-token window
of each *-long row, every build against fp32. The real parity is parity/pcs47-webgpu-builds.mjs (WASM).

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/pcs47-webgpu-builds.py [--fp16] [--force]
writes results/parity-pcs47-q8w-build.json (and results/parity-pcs47-fp16-build.json with --fp16)
"""
import argparse
import collections
import json
import os
import time

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

D = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47"
FP32 = os.path.join(D, "model.onnx")
Q8W = os.path.join(D, "model.q8w.onnx")
Q8WG = os.path.join(D, "model.q8w-gather.onnx")
FP16 = os.path.join(D, "model.fp16.onnx")
TIGGANG = ("/home/jiangzhuo/.cache/huggingface/hub/models--Tiggang--xlm-roberta-punct-fullstop-truecase-onnx-fp16/"
           "snapshots/75191c1439a44a7fab57c2f657d6e8f4d6b98e77/model.onnx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMB = "bert_model.embeddings.word_embeddings.weight"
BLOCK = 32
HEADS = ["pre_preds", "post_preds", "cap_preds", "seg_preds"]


def op_counts(path):
    g = onnx.load(path, load_external_data=False).graph
    return dict(sorted(collections.Counter(f"{n.domain}:{n.op_type}" if n.domain else n.op_type for n in g.node).items()))


def build_q8w():
    m = onnx.load(FP32)
    # The 8 decoder-head MatMuls (768x256 ... 128x2, 1.7 MB fp32) stay fp32: quantizing them too changed 14
    # rows on WASM instead of 9 (parity/pcs47-webgpu-builds-recipes.py).
    heads = [n.name for n in m.graph.node if n.op_type == "MatMul" and n.name.startswith("/_decoder/")]
    assert len(heads) == 8, heads
    q = MatMulNBitsQuantizer(m, bits=8, block_size=BLOCK, is_symmetric=True, nodes_to_exclude=heads)
    q.process()
    m = q.model
    if hasattr(m, "save_model_to_file"):
        m.save_model_to_file(Q8W, use_external_data_format=False)
    else:
        onnx.save(getattr(m, "model", m), Q8W)


def build_q8w_gather():
    m = onnx.load(Q8W)
    g = m.graph
    init = next(t for t in g.initializer if t.name == EMB)
    users = [n for n in g.node if EMB in n.input]
    assert len(users) == 1 and users[0].op_type == "Gather" and users[0].input[0] == EMB, [n.op_type for n in users]
    node = users[0]
    assert next((a.i for a in node.attribute if a.name == "axis"), 0) == 0

    w = numpy_helper.to_array(init).astype(np.float32)
    v, d = w.shape
    assert d % BLOCK == 0
    blocks = w.reshape(v, d // BLOCK, BLOCK)
    scale = (np.abs(blocks).max(axis=-1) / np.float32(127)).astype(np.float32)
    safe = np.where(scale == 0, np.float32(1), scale)
    q = (np.clip(np.rint(blocks / safe[..., None]), -127, 127).astype(np.int16) + 128).astype(np.uint8)
    # What both kernels compute: float(q - 128) * scale.
    deq = (q.astype(np.float32) - np.float32(128)) * scale[..., None]
    err = np.abs(deq - blocks)
    stats = {"table": [v, d], "scales": list(scale.shape), "max_abs_err": float(err.max()),
             "mean_abs_err": float(err.mean()), "max_abs_weight": float(np.abs(w).max())}
    del blocks, deq, err

    qname, sname = EMB + "_Q8", EMB + "_scales"
    new = helper.make_node("GatherBlockQuantized", [qname, node.input[1], sname], list(node.output),
                           name=(node.name or "word_embeddings") + "_Q8", domain="com.microsoft",
                           gather_axis=0, quantize_axis=1, block_size=BLOCK, bits=8)
    nodes = [new if n is node else n for n in g.node]
    g.ClearField("node")
    g.node.extend(nodes)
    g.initializer.remove(init)
    g.initializer.extend([numpy_helper.from_array(q.reshape(v, d), qname), numpy_helper.from_array(scale, sname)])
    for i in list(g.input):
        if i.name == EMB:
            g.input.remove(i)
    if not any(o.domain == "com.microsoft" for o in m.opset_import):
        m.opset_import.append(helper.make_opsetid("com.microsoft", 1))
    onnx.save(m, Q8WG)
    return stats


def build_fp16():
    from onnxruntime.transformers.float16 import convert_float_to_float16  # noqa: PLC0415

    onnx.save(convert_float_to_float16(onnx.load(FP32), keep_io_types=True), FP16)


def compare_initializers(a_path, b_path):
    a = {t.name: t for t in onnx.load(a_path).graph.initializer}
    b = {t.name: t for t in onnx.load(b_path).graph.initializer}
    same = [n for n in a if n in b and a[n].data_type == b[n].data_type
            and np.array_equal(numpy_helper.to_array(a[n]), numpy_helper.to_array(b[n]))]
    return {"initializers": [len(a), len(b)], "identical": len(same),
            "only_first": sorted(set(a) - set(b))[:5], "only_second": sorted(set(b) - set(a))[:5]}


def sanity(paths):
    with open(os.path.join(ROOT, "results", "parity-pcs47-ref-fp32.json"), encoding="utf-8") as fh:
        ref = json.load(fh)["rows"]
    longs = {r["id"][:-5]: r for r in ref if r["id"].endswith("-long")}
    feeds = {k: np.array([[0] + longs[k]["sp_ids_pre"][:254] + [2]], dtype=np.int64) for k in ["en", "ja", "zh", "ko"]}
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    outs = {}
    for tag, p in paths.items():
        s = ort.InferenceSession(p, so, providers=["CPUExecutionProvider"])
        outs[tag] = {k: dict(zip(HEADS, s.run(HEADS, {"input_ids": x}))) for k, x in feeds.items()}
        del s
    report = {}
    for tag in paths:
        if tag == "fp32":
            continue
        report[tag] = {}
        for k in feeds:
            report[tag][k] = {h: f"{int((outs[tag][k][h] == outs['fp32'][k][h]).sum())}/{outs['fp32'][k][h].size}" for h in HEADS}
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    report = {"onnxruntime": ort.__version__, "onnx": onnx.__version__, "builds": {}}
    t = time.time()
    if args.force or not os.path.exists(Q8W):
        build_q8w()
    print(f"q8w {os.path.getsize(Q8W)} B ({time.time() - t:.0f} s)", flush=True)
    t = time.time()
    gather_stats = None
    if args.force or not os.path.exists(Q8WG):
        gather_stats = build_q8w_gather()
    print(f"q8w-gather {os.path.getsize(Q8WG)} B ({time.time() - t:.0f} s) {gather_stats}", flush=True)
    paths = {"fp32": FP32, "q8w": Q8W, "q8w-gather": Q8WG}
    report["builds"]["q8w"] = {"file": Q8W, "bytes": os.path.getsize(Q8W), "ops": op_counts(Q8W)}
    report["builds"]["q8w-gather"] = {"file": Q8WG, "bytes": os.path.getsize(Q8WG), "ops": op_counts(Q8WG), "embedding_quantization": gather_stats}
    out = os.path.join(ROOT, "results", "parity-pcs47-q8w-build.json")
    if args.fp16:
        if args.force or not os.path.exists(FP16):
            build_fp16()
        paths = {"fp32": FP32, "fp16": FP16}
        fp16 = {"file": FP16, "bytes": os.path.getsize(FP16), "ops": op_counts(FP16),
                "tiggang_bytes": os.path.getsize(TIGGANG), "tiggang_ops_equal": op_counts(TIGGANG) == op_counts(FP16),
                "vs_tiggang": compare_initializers(FP16, TIGGANG)}
        report = {"onnxruntime": ort.__version__, "builds": {"fp16": fp16}}
        out = os.path.join(ROOT, "results", "parity-pcs47-fp16-build.json")
        print(json.dumps({k: v for k, v in fp16.items() if k != "ops"}), flush=True)
    report["native_cpu_sanity_first_254_tokens_vs_fp32"] = sanity(paths)
    print(json.dumps(report["native_cpu_sanity_first_254_tokens_vs_fp32"], indent=1))
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
