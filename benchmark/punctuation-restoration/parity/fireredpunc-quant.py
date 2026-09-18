"""Which quantization of FireRedPunc keeps upstream's decisions?

Dynamic int8 (42ailab's per-tensor file and a per-channel MatMul-only re-quantization) both
lose half the sentence-final marks (parity/fireredpunc-export.py). This script tries:
  - int8pc_nocls: per-channel dynamic int8 with the 768x5 classifier MatMul left fp32
  - q8w: weight-only MatMulNBits, 8 bits, block 32, symmetric; activations stay fp32
  - q4w: weight-only MatMulNBits, 4 bits, block 32, symmetric; activations stay fp32
and scores each against the upstream torch predictions in results/parity-fireredpunc-upstream.json.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/fireredpunc-quant.py
writes /home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx/punc.{int8pc-nocls,q8w,q4w}.onnx
       results/parity-fireredpunc-quant.json
"""
import json
import os
import sys

UPSTREAM = "/home/jiangzhuo/.cache/sokuji-punct-bench/src/FireRedASR2S/fireredasr2s"
MODEL_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/FireRedPunc"
ONNX_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx"
FP32 = os.path.join(ONNX_DIR, "punc.fp32.onnx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, UPSTREAM)

import numpy as np  # noqa: E402
import onnx  # noqa: E402
import onnxruntime as ort  # noqa: E402
from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer  # noqa: E402
from fireredpunc.punc import ModelIO, RuleBaedTxtFix  # noqa: E402

CLS_ID = 101


def nbits(path, bits):
    q = MatMulNBitsQuantizer(onnx.load(FP32), bits=bits, block_size=32, is_symmetric=True)
    q.process()
    m = q.model
    if hasattr(m, "save_model_to_file"):
        m.save_model_to_file(path, use_external_data_format=False)
    else:
        onnx.save(getattr(m, "model", m), path)


def build():
    out = {}
    p = os.path.join(ONNX_DIR, "punc.int8pc-nocls.onnx")
    if not os.path.exists(p):
        quantize_dynamic(FP32, p, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"],
                         per_channel=True, nodes_to_exclude=["/classifier/MatMul"],
                         extra_options={"MatMulConstBOnly": True})
    out["int8pc_nocls"] = p
    for bits, name in ((8, "q8w"), (4, "q4w")):
        p = os.path.join(ONNX_DIR, f"punc.{name}.onnx")
        if not os.path.exists(p):
            nbits(p, bits)
        out[name] = p
    return out


def main():
    variants = build()
    io = ModelIO(MODEL_DIR)
    rows = json.load(open(os.path.join(ROOT, "results", "parity-fireredpunc-upstream.json"), encoding="utf-8"))["rows"]
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    report = {}
    for name, path in variants.items():
        sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        ops = sorted({n.op_type for n in onnx.load(path, load_external_data=False).graph.node})
        tok_agree = n_tok = text_exact = term_torch = term_model = 0
        diffs = []
        for r in rows:
            a = np.array([[CLS_ID] + r["ids"]], dtype=np.int64)
            preds = sess.run(None, {"input_ids": a, "attention_mask": np.ones_like(a)})[0].argmax(-1)[0].tolist()
            tok_agree += sum(x == y for x, y in zip(preds, r["preds_torch"]))
            n_tok += len(preds)
            text = RuleBaedTxtFix.fix(io.add_punc_to_txt([r["tokens"]], [preds])[0])
            text_exact += text == r["torch_text"]
            term_torch += sum(x in (2, 3, 4) for x in r["preds_torch"])
            term_model += sum(x in (2, 3, 4) for x in preds)
            if text != r["torch_text"] and len(diffs) < 5:
                diffs.append({"id": r["id"], "variant": r["variant"], "torch": r["torch_text"], "model": text})
        report[name] = {
            "bytes": os.path.getsize(path),
            "ops": ops,
            "token_class_agree_vs_torch": tok_agree / n_tok,
            "text_exact_vs_torch": text_exact / len(rows),
            "terminal_marks_torch": term_torch,
            "terminal_marks_model": term_model,
            "diffs": diffs,
        }
        print(name, json.dumps({k: v for k, v in report[name].items() if k not in ("diffs", "ops")}), report[name]["ops"])
    path = os.path.join(ROOT, "results", "parity-fireredpunc-quant.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
