#!/usr/bin/env python3
"""Reference side of parity/ct-transformer: the official sherpa-onnx package.

Default: reads results/parity-ct-transformer-rows.json (from `node parity/ct-transformer.mjs prep`),
runs sherpa_onnx.OfflinePunctuation on every row's `input` and `pre`, and compares the JS
logits (ORT-web default / optimizations disabled) with native onnxruntime (ORT_ENABLE_ALL,
what sherpa-onnx uses, / ORT_DISABLE_ALL) for the same ids. Writes
results/parity-ct-transformer-ref.json.

--diffwin: reads results/parity-ct-transformer-diffwin.json (the JS windows of every row
whose output differs), runs each window through native onnxruntime and reports the first
position whose class differs, with both runtimes' logits. Writes
results/parity-ct-transformer-diffwin-ref.json.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-sherpa/bin/python parity/ct-transformer.py [--diffwin]
(venv: `uv pip install sherpa-onnx onnxruntime numpy`)
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL = Path(
    "/home/jiangzhuo/.cache/sokuji-punct-bench/sherpa/"
    "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx"
)
PUNCT = ["<unk>", "_", "，", "。", "？", "、"]


def native_session(level):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.log_severity_level = 3
    opts.graph_optimization_level = level
    return ort.InferenceSession(str(MODEL), opts, providers=["CPUExecutionProvider"])


def forward(sess, ids):
    x = np.array(ids, dtype=np.int32)[None, :]
    return sess.run(None, {"inputs": x, "text_lengths": np.array([x.shape[1]], dtype=np.int32)})[0][0]


def reference():
    import onnxruntime as ort
    import sherpa_onnx

    data = json.loads((ROOT / "results/parity-ct-transformer-rows.json").read_text(encoding="utf-8"))
    punct = sherpa_onnx.OfflinePunctuation(
        sherpa_onnx.OfflinePunctuationConfig(
            model=sherpa_onnx.OfflinePunctuationModelConfig(ct_transformer=str(MODEL), num_threads=1)
        )
    )

    def run(text):
        try:
            return punct.add_punctuation(text)
        except Exception as e:  # noqa: BLE001 - recorded, compared with the JS failure
            return "EXC: " + str(e).splitlines()[0][:200]

    rows = []
    for r in data["rows"]:
        ref_input = run(r["input"])
        ref_pre = ref_input if r["pre"] == r["input"] else run(r["pre"])
        rows.append({"key": r["key"], "refInput": ref_input, "refPre": ref_pre})

    native = {
        "native-all": native_session(ort.GraphOptimizationLevel.ORT_ENABLE_ALL),
        "native-none": native_session(ort.GraphOptimizationLevel.ORT_DISABLE_ALL),
    }
    logits = []
    for r in data["logits"]:
        outs = {k: forward(s, r["ids"]) for k, s in native.items()}
        shape = outs["native-all"].shape
        outs["web-default"] = np.array(r["jsLogits"], dtype=np.float32).reshape(shape)
        outs["web-disabled"] = np.array(r["jsLogitsNoOpt"], dtype=np.float32).reshape(shape)
        pairs = [
            ("native-all", "web-default"),
            ("native-none", "web-disabled"),
            ("native-all", "native-none"),
            ("web-default", "web-disabled"),
            ("native-none", "web-default"),
        ]
        logits.append({
            "key": r["key"],
            "T": int(shape[0]),
            "maxAbsDiff": {f"{a}~{b}": float(np.abs(outs[a] - outs[b]).max()) for a, b in pairs},
            "argmaxAgree": {f"{a}~{b}": float((outs[a].argmax(-1) == outs[b].argmax(-1)).mean()) for a, b in pairs},
        })

    out = {
        "sherpaOnnx": getattr(sherpa_onnx, "__version__", None),
        "onnxruntime": ort.__version__,
        "rows": rows,
        "logits": logits,
    }
    (ROOT / "results/parity-ct-transformer-ref.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(rows)} reference rows, {len(logits)} logits rows")


def diffwin():
    """Native onnxruntime (pip, ORT_ENABLE_ALL) logits at each diff's first differing token."""
    import onnxruntime as ort

    sess = native_session(ort.GraphOptimizationLevel.ORT_ENABLE_ALL)
    entries = json.loads((ROOT / "results/parity-ct-transformer-diffwin.json").read_text(encoding="utf-8"))
    out = []
    for e in entries:
        y = forward(sess, e["windowIds"])[e["pos"]]
        nc = int(y.argmax())
        out.append({
            "key": e["key"],
            "onnxruntime": ort.__version__,
            "nativeClass": PUNCT[nc],
            "nativeLogits": [round(float(v), 4) for v in y],
        })
    (ROOT / "results/parity-ct-transformer-diffwin-ref.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for o in out:
        print(o["key"], o["nativeClass"], o["nativeLogits"])


if __name__ == "__main__":
    diffwin() if "--diffwin" in sys.argv else reference()
