#!/usr/bin/env python3
"""Reference side of parity/edge-punct-en: the official sherpa-onnx package.

Reads results/parity-edge-punct-en-rows.json (from `node parity/edge-punct-en.mjs prep`),
runs sherpa_onnx.OnlinePunctuation.add_punctuation_with_case on every row's `input` and
`pre`, and compares the JS logits (ORT-web default / optimizations disabled) with native
onnxruntime (ORT_ENABLE_ALL, what sherpa-onnx uses, / ORT_DISABLE_ALL) for the same
batched ids, listing every word whose class differs. Writes results/parity-edge-punct-en-ref.json.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-sherpa/bin/python parity/edge-punct-en.py
(venv: `uv pip install sherpa-onnx onnxruntime numpy`)
"""

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import sherpa_onnx

ROOT = Path(__file__).resolve().parent.parent
DIR = Path("/home/jiangzhuo/.cache/sokuji-punct-bench/sherpa/sherpa-onnx-online-punct-en-2024-08-06")
CASES = ["LOWER", "UPPER", "CAP", "MIX_CASE"]
PUNCTS = ["NO_PUNCT", "COMMA", "PERIOD", "QUESTION"]


def native_session(level):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.log_severity_level = 3
    opts.graph_optimization_level = level
    return ort.InferenceSession(str(DIR / "model.int8.onnx"), opts, providers=["CPUExecutionProvider"])


def main():
    data = json.loads((ROOT / "results/parity-edge-punct-en-rows.json").read_text(encoding="utf-8"))
    punct = sherpa_onnx.OnlinePunctuation(
        sherpa_onnx.OnlinePunctuationConfig(
            model_config=sherpa_onnx.OnlinePunctuationModelConfig(
                cnn_bilstm=str(DIR / "model.int8.onnx"), bpe_vocab=str(DIR / "bpe.vocab"), num_threads=1
            )
        )
    )

    def run(text):
        try:
            return punct.add_punctuation_with_case(text)
        except Exception as e:  # noqa: BLE001 - recorded, compared with the JS failure
            return "EXC: " + str(e).splitlines()[0][:200]

    rows = []
    for r in data["rows"]:
        if r.get("refSkip"):
            rows.append({"key": r["key"], "refInput": None, "refPre": None})
            continue
        ref_input = run(r["input"])
        ref_pre = ref_input if r["pre"] == r["input"] else run(r["pre"])
        rows.append({"key": r["key"], "refInput": ref_input, "refPre": ref_pre})

    native = {
        "native-all": native_session(ort.GraphOptimizationLevel.ORT_ENABLE_ALL),
        "native-none": native_session(ort.GraphOptimizationLevel.ORT_DISABLE_ALL),
    }
    logits = []
    for r in data["logits"]:
        n = r["n"]
        feeds = {
            "token_ids": np.array(r["tokenIds"], dtype=np.int32).reshape(n, 200),
            "valid_ids": np.array(r["validIds"], dtype=np.int32).reshape(n, 200),
            "label_lens": np.array(r["labelLens"], dtype=np.int32),
        }
        outs = {k: s.run(["active_case_logits", "active_punct_logits"], feeds) for k, s in native.items()}
        shape = outs["native-all"][0].shape
        outs["web-default"] = [np.array(r["jsCase"], dtype=np.float32).reshape(shape), np.array(r["jsPunct"], dtype=np.float32).reshape(shape)]
        outs["web-disabled"] = [np.array(r["jsCaseNoOpt"], dtype=np.float32).reshape(shape), np.array(r["jsPunctNoOpt"], dtype=np.float32).reshape(shape)]
        pairs = [("native-all", "web-default"), ("native-none", "web-disabled"), ("native-all", "native-none"), ("web-default", "web-disabled")]
        entry = {
            "key": r["key"],
            "batchRows": n,
            "words": int(shape[0]),
            "maxAbsDiff": {f"{a}~{b}": float(max(np.abs(outs[a][0] - outs[b][0]).max(), np.abs(outs[a][1] - outs[b][1]).max())) for a, b in pairs},
            "nativeCase": np.round(outs["native-all"][0], 4).tolist(),
            "nativePunct": np.round(outs["native-all"][1], 4).tolist(),
            "disagreements": [],
        }
        for kind, idx, names in (("case", 0, CASES), ("punct", 1, PUNCTS)):
            y, js = outs["native-all"][idx], outs["web-default"][idx]
            for p in np.nonzero(y.argmax(-1) != js.argmax(-1))[0]:
                p = int(p)
                jc, nc = int(js[p].argmax()), int(y[p].argmax())
                entry["disagreements"].append({
                    "kind": kind,
                    "wordIndex": p,
                    "word": r["words"][p],
                    "webClass": names[jc],
                    "nativeClass": names[nc],
                    "webLogits": [round(float(v), 4) for v in js[p]],
                    "nativeLogits": [round(float(v), 4) for v in y[p]],
                    "webMargin": round(float(js[p, jc] - js[p, nc]), 4),
                    "nativeMargin": round(float(y[p, nc] - y[p, jc]), 4),
                })
        logits.append(entry)

    out = {
        "sherpaOnnx": getattr(sherpa_onnx, "__version__", None),
        "onnxruntime": ort.__version__,
        "rows": rows,
        "logits": logits,
    }
    (ROOT / "results/parity-edge-punct-en-ref.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(rows)} reference rows, {len(logits)} logits rows")


if __name__ == "__main__":
    main()
