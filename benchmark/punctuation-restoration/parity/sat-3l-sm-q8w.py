"""Weight-only 8-bit sat-3l-sm builds for the WebGPU EP. See models/sat-3l-sm.md "q8w build".

  sat/sat-3l-sm-q8w/model.onnx         every MatMul with a constant weight -> com.microsoft MatMulNBits, bits=8,
                                       block_size=32, symmetric (MatMulNBitsQuantizer, parity/fireredpunc-quant.py's
                                       recipe) over model_fp32.onnx, the fp16 -> fp32 rewrite of the published
                                       export. Activations, attention_mask and logits are float32; the
                                       250,002 x 768 word-embedding Gather stays float32.
  sat/sat-3l-sm-q8w-gather/model.onnx  the same plus that Gather -> com.microsoft GatherBlockQuantized, bits=8,
                                       block_size=32 along the hidden axis, uint8 data with the implicit zero
                                       point 128, one float32 scale per block (max|w| / 127), built by hand as in
                                       parity/pcs47-webgpu-builds.py (ORT's quantizer only emits 4-bit Gather).
  tokenizer.json                       copied into both directories (the module reads model.onnx + tokenizer.json).

Native sanity check (Python onnxruntime CPU EP): logits of both builds against model_fp32.onnx on one 510-subword
window per language built from results/inputs.json. The real parity is parity/sat-3l-sm-q8w.mjs (WASM).

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/sat-3l-sm-q8w.py [--force]
writes results/parity-sat-3l-sm-q8w-build.json
"""
import argparse
import collections
import json
import os
import shutil

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from tokenizers import Tokenizer

SAT = "/home/jiangzhuo/.cache/sokuji-punct-bench/sat"
FP32 = os.path.join(SAT, "sat-3l-sm", "model_fp32.onnx")
TOKENIZER = os.path.join(SAT, "sat-3l-sm", "tokenizer.json")
Q8W = os.path.join(SAT, "sat-3l-sm-q8w", "model.onnx")
Q8WG = os.path.join(SAT, "sat-3l-sm-q8w-gather", "model.onnx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMB = "roberta.embeddings.word_embeddings.weight"
BLOCK = 32


def op_counts(path):
    g = onnx.load(path, load_external_data=False).graph
    return dict(sorted(collections.Counter(f"{n.domain}:{n.op_type}" if n.domain else n.op_type for n in g.node).items()))


def io(path):
    g = onnx.load(path, load_external_data=False).graph
    name = {1: "float32", 7: "int64", 10: "float16"}
    return {"inputs": {i.name: name.get(i.type.tensor_type.elem_type) for i in g.input},
            "outputs": {o.name: name.get(o.type.tensor_type.elem_type) for o in g.output}}


def build_q8w():
    q = MatMulNBitsQuantizer(onnx.load(FP32), bits=8, block_size=BLOCK, is_symmetric=True)
    q.process()
    m = q.model
    if hasattr(m, "save_model_to_file"):
        m.save_model_to_file(Q8W, use_external_data_format=False)
    else:
        onnx.save(getattr(m, "model", m), Q8W)


def build_gather8(src, dst, emb):
    m = onnx.load(src)
    g = m.graph
    init = next(t for t in g.initializer if t.name == emb)
    users = [n for n in g.node if emb in n.input]
    assert len(users) == 1 and users[0].op_type == "Gather" and users[0].input[0] == emb, [n.op_type for n in users]
    node = users[0]
    assert next((a.i for a in node.attribute if a.name == "axis"), 0) == 0
    w = numpy_helper.to_array(init).astype(np.float32)
    v, d = w.shape
    assert d % BLOCK == 0
    blocks = w.reshape(v, d // BLOCK, BLOCK)
    scale = (np.abs(blocks).max(axis=-1) / np.float32(127)).astype(np.float32)
    safe = np.where(scale == 0, np.float32(1), scale)
    q = (np.clip(np.rint(blocks / safe[..., None]), -127, 127).astype(np.int16) + 128).astype(np.uint8)
    err = np.abs((q.astype(np.float32) - np.float32(128)) * scale[..., None] - blocks)
    stats = {"table": [v, d], "max_abs_err": float(err.max()), "mean_abs_err": float(err.mean()),
             "max_abs_weight": float(np.abs(w).max())}
    del blocks, err
    qname, sname = emb + "_Q8", emb + "_scales"
    new = helper.make_node("GatherBlockQuantized", [qname, node.input[1], sname], list(node.output),
                           name=(node.name or "word_embeddings") + "_Q8", domain="com.microsoft",
                           gather_axis=0, quantize_axis=1, block_size=BLOCK, bits=8)
    nodes = [new if n is node else n for n in g.node]
    g.ClearField("node")
    g.node.extend(nodes)
    g.initializer.remove(init)
    g.initializer.extend([numpy_helper.from_array(q.reshape(v, d), qname), numpy_helper.from_array(scale, sname)])
    for i in list(g.input):
        if i.name == emb:
            g.input.remove(i)
    if not any(o.domain == "com.microsoft" for o in m.opset_import):
        m.opset_import.append(helper.make_opsetid("com.microsoft", 1))
    onnx.save(m, dst)
    return stats


def sanity():
    tok = Tokenizer.from_file(TOKENIZER)
    inputs = json.load(open(os.path.join(ROOT, "results", "inputs.json"), encoding="utf-8"))
    sep = {"ja": "", "zh": "", "en": " ", "ko": " "}
    feeds = {}
    for lang in ["ja", "zh", "en", "ko"]:
        text = sep[lang].join(r["input"] for r in inputs if r["lang"] == lang and r["variant"] == "stripped")
        ids = tok.encode(text, add_special_tokens=False).ids[:510]
        x = np.array([[0] + ids + [2]], dtype=np.int64)
        feeds[lang] = {"input_ids": x, "attention_mask": np.ones(x.shape, dtype=np.float32)}
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    logits = {}
    for tag, p in {"fp32": FP32, "q8w": Q8W, "q8w-gather": Q8WG}.items():
        s = ort.InferenceSession(p, so, providers=["CPUExecutionProvider"])
        logits[tag] = {k: s.run(["logits"], f)[0].astype(np.float64) for k, f in feeds.items()}
        del s
    sig = lambda a: 1 / (1 + np.exp(-a))  # noqa: E731
    out = {}
    for tag in ("q8w", "q8w-gather"):
        out[tag] = {}
        for k in feeds:
            a, b = logits[tag][k], logits["fp32"][k]
            out[tag][k] = {"tokens": int(a.shape[1]), "max_abs_logit": float(np.abs(a - b).max()),
                           "max_abs_p": float(np.abs(sig(a) - sig(b)).max()),
                           "decisions_p_gt_0.25_differ": int(((sig(a) > 0.25) != (sig(b) > 0.25)).sum())}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    for d in (os.path.dirname(Q8W), os.path.dirname(Q8WG)):
        os.makedirs(d, exist_ok=True)
        shutil.copyfile(TOKENIZER, os.path.join(d, "tokenizer.json"))
    if args.force or not os.path.exists(Q8W):
        build_q8w()
    stats = None
    if args.force or not os.path.exists(Q8WG):
        stats = build_gather8(Q8W, Q8WG, EMB)
    report = {"onnxruntime": ort.__version__, "onnx": onnx.__version__, "builds": {}}
    for tag, p in {"fp32": FP32, "q8w": Q8W, "q8w-gather": Q8WG}.items():
        report["builds"][tag] = {"file": p, "bytes": os.path.getsize(p), "ops": op_counts(p), **io(p)}
        print(tag, os.path.getsize(p), "B", report["builds"][tag]["ops"], io(p), flush=True)
    report["builds"]["q8w-gather"]["embedding_quantization"] = stats
    print("embedding quantization", stats, flush=True)
    report["native_cpu_sanity_vs_fp32"] = sanity()
    print(json.dumps(report["native_cpu_sanity_vs_fp32"], indent=1))
    out = os.path.join(ROOT, "results", "parity-sat-3l-sm-q8w-build.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
