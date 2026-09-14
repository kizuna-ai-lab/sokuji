"""Reference outputs for the Mojicast port: Mojicast's own punct.py under Python onnxruntime.

Imports punct.py straight from a clone of github.com/ishiki-emo/mojicast (@d06ddb9f) —
no re-implementation — and runs add_punctuation over the ja rows of results/inputs.json
at both precisions. The per-character sigmoid probabilities come from the same session
(punct._sess) with the same ids, so threshold flips between runtimes can be located.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/.venv/bin/python parity/mojicast.py
writes results/parity-mojicast-python.json
"""
import json
import os
import sys
import time

MOJICAST_SRC = "/home/jiangzhuo/.cache/sokuji-punct-bench/src/mojicast"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, MOJICAST_SRC)

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import punct  # noqa: E402


def probs_for(text):
    """Per-character [、, 。] sigmoid for the already-stripped text, chunked like _punctuate_raw."""
    res = []
    for i in range(0, len(text), 256):
        chunk = text[i:i + 256]
        ids = [punct._cls_id] + [punct._vocab.get(ch, punct._unk_id) for ch in chunk] + [punct._sep_id]
        a = np.array([ids], dtype=np.int64)
        logits = punct._sess.run(None, {"input_ids": a, "attention_mask": np.ones_like(a)})[0][0]
        p = 1.0 / (1.0 + np.exp(-logits))
        res.extend([[float(x) for x in p[j + 1]] for j in range(len(chunk))])
    return res


def main():
    rows = [r for r in json.load(open(os.path.join(ROOT, "results", "inputs.json"), encoding="utf-8"))
            if r["lang"] == "ja"]
    out = {"versions": {"onnxruntime": ort.__version__, "numpy": np.__version__}, "precisions": {}}
    for prec in ("int8", "fp32"):
        punct.unload()
        t0 = time.time()
        punct.load_punctuator(num_threads=4, precision=prec)   # includes the self-test
        load_s = time.time() - t0
        res = []
        for r in rows:
            text = r["input"].replace("、", "").replace("。", "")
            res.append({
                "id": r["id"], "variant": r["variant"], "input": r["input"],
                "out": punct.add_punctuation(r["input"]),
                "raw": punct._punctuate_raw(text) if text else text,
                "probs": probs_for(text),
            })
        out["precisions"][prec] = {"load_s": load_s, "probe": punct._punctuate_raw(punct._PROBE), "rows": res}
        print(prec, "load", round(load_s, 2), "probe", out["precisions"][prec]["probe"])
    a = out["precisions"]["int8"]["rows"]
    b = out["precisions"]["fp32"]["rows"]
    agree = sum(x["out"] == y["out"] for x, y in zip(a, b))
    out["int8_vs_fp32_exact"] = agree / len(a)
    print("python int8 vs fp32 exact:", agree, "/", len(a))
    for x, y in zip(a, b):
        if x["out"] != y["out"]:
            print("  int8:", x["out"])
            print("  fp32:", y["out"])
    path = os.path.join(ROOT, "results", "parity-mojicast-python.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
