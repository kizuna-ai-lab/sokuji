"""Weight-only 8-bit Mojicast punctuation BERT for the WebGPU EP. See models/mojicast.md "WebGPU builds".

  punct_bert.q8w.onnx        every MatMul with a constant weight -> com.microsoft MatMulNBits, bits=8,
                             block_size=32, symmetric; activations fp32 (parity/fireredpunc-quant.py's recipe),
                             from the fp32 punct_bert.onnx of ishiki-emo/mojicast-punct-onnx.
  punct_bert.q8w-nonan.onnx  the same graph without the 12 NaN guards the torch SDPA export put after each
                             attention Softmax: Where(IsNaN(p), 0, p) -> p. onnxruntime's native WebGPU EP has
                             no IsNaN kernel, so the guarded graph falls back to the CPU inside every layer. A
                             softmax row is NaN only when every position is masked; the module always passes an
                             all-ones mask, so the guard never fires and the outputs are bit-identical.
  vocab.txt                  copied next to them (the module contract reads every file from one directory).

Native sanity check (Python onnxruntime CPU EP) on the Mojicast self-test string and a ja corpus row:
max |delta logit| of each build against fp32, and nonan == q8w exactly.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/mojicast-q8w.py [--force]
"""
import argparse
import collections
import os
import shutil

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

SNAP = "/home/jiangzhuo/.cache/huggingface/hub/models--ishiki-emo--mojicast-punct-onnx/snapshots/6bef44545db904999043648af48ee17cd6177ee4"
FP32 = os.path.join(SNAP, "punct_bert.onnx")
OUT = "/home/jiangzhuo/.cache/sokuji-punct-bench/mojicast"
Q8W = os.path.join(OUT, "punct_bert.q8w.onnx")
NONAN = os.path.join(OUT, "punct_bert.q8w-nonan.onnx")


def op_counts(path):
    g = onnx.load(path, load_external_data=False).graph
    return dict(sorted(collections.Counter(f"{n.domain}:{n.op_type}" if n.domain else n.op_type for n in g.node).items()))


def build_q8w():
    q = MatMulNBitsQuantizer(onnx.load(FP32), bits=8, block_size=32, is_symmetric=True)
    q.process()
    m = q.model
    if hasattr(m, "save_model_to_file"):
        m.save_model_to_file(Q8W, use_external_data_format=False)
    else:
        onnx.save(getattr(m, "model", m), Q8W)


def build_nonan():
    m = onnx.load(Q8W)
    g = m.graph
    inits = {t.name: t for t in g.initializer}
    consts = {n.output[0]: n for n in g.node if n.op_type == "Constant"}
    users = collections.defaultdict(list)
    for n in g.node:
        for i in n.input:
            users[i].append(n)
    drop = set()
    rename = {}
    for n in g.node:
        if n.op_type != "IsNaN":
            continue
        (where,) = users[n.output[0]]
        assert where.op_type == "Where" and where.input[0] == n.output[0] and where.input[2] == n.input[0], where
        zero = where.input[1]
        if zero in inits:
            val = onnx.numpy_helper.to_array(inits[zero])
        else:
            val = onnx.numpy_helper.to_array(consts[zero].attribute[0].t)
        assert val.size == 1 and float(val.reshape(-1)[0]) == 0.0, val
        drop.update([id(n), id(where)])
        rename[where.output[0]] = n.input[0]
    assert rename, "no IsNaN guard found"
    nodes = []
    for n in g.node:
        if id(n) in drop:
            continue
        for k, i in enumerate(n.input):
            if i in rename:
                n.input[k] = rename[i]
        nodes.append(n)
    assert not any(o.name in rename for o in g.output)
    g.ClearField("node")
    g.node.extend(nodes)
    onnx.save(m, NONAN)
    return len(rename)


def logits(path, text, vocab):
    ids = [vocab["[CLS]"]] + [vocab.get(c, vocab.get("[UNK]", 1)) for c in text] + [vocab["[SEP]"]]
    x = np.array([ids], dtype=np.int64)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    return s.run(["logits"], {"input_ids": x, "attention_mask": np.ones_like(x)})[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    shutil.copyfile(os.path.join(SNAP, "vocab.txt"), os.path.join(OUT, "vocab.txt"))
    if args.force or not os.path.exists(Q8W):
        build_q8w()
    guards = None
    if args.force or not os.path.exists(NONAN):
        guards = build_nonan()
    for p in (FP32, Q8W, NONAN):
        print(os.path.basename(p), os.path.getsize(p), "B", op_counts(p))
    print("removed IsNaN guards:", guards)
    vocab = {}
    with open(os.path.join(OUT, "vocab.txt"), encoding="utf-8") as f:
        for i, line in enumerate(f):
            vocab[line.rstrip("\n")] = i
    for text in ["これはてすとです", "皆さんこんにちは今日は来期の製品計画について話しましょうまずモバイル版の字幕機能ですが10月にリリースする予定です"]:
        ref = logits(FP32, text, vocab)
        q = logits(Q8W, text, vocab)
        nn = logits(NONAN, text, vocab)
        sig = lambda a: 1 / (1 + np.exp(-a.astype(np.float64)))  # noqa: E731
        print(f"{len(text)} chars: q8w max|dlogit| {np.abs(q - ref).max():.2e} max|dp| {np.abs(sig(q) - sig(ref)).max():.2e}; "
              f"nonan == q8w: {np.array_equal(nn, q)}; decisions(p>0.1) equal: {np.array_equal(sig(q) > 0.1, sig(ref) > 0.1)}")


if __name__ == "__main__":
    main()
