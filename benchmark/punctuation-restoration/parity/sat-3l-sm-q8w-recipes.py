"""Which weight-only 8-bit recipe keeps sat-3l-sm's decisions? A native proxy for the WASM parity.

sat-3l-sm-q8w (symmetric, block 32, every constant MatMul incl. the 768 -> 1 classifier) split 9 of 270 rows
differently from the fp16 module on WASM (parity/sat-3l-sm-q8w.mjs), every flip within 0.011 of the 0.25
threshold. This script builds a few recipes into scratch and, on Python onnxruntime (CPU EP), runs each parity
row's first window ([CLS] + at most 510 subwords + [SEP], float32 mask of ones, as models/sat-3l-sm.mjs feeds a
single window) through fp32 and each recipe. It applies the module's decision (logit rounded to float16,
sigmoid, p > 0.25) and counts token-level flips, max |dp| and fp32's margin |p - 0.25| at each flip.
Long rows beyond their first window are not covered here; the WASM run covers them.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/sat-3l-sm-q8w-recipes.py
writes results/parity-sat-3l-sm-q8w-recipes.json (models go to the job scratch)
"""
import json
import os
import time

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from tokenizers import Tokenizer

SAT = "/home/jiangzhuo/.cache/sokuji-punct-bench/sat"
FP32 = os.path.join(SAT, "sat-3l-sm", "model_fp32.onnx")
TOKENIZER = os.path.join(SAT, "sat-3l-sm", "tokenizer.json")
SCRATCH = "/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/webgpu-builds/sat-recipes"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLD = 0.25
THREADS = 6
# name: (symmetric, block_size, keep /classifier/MatMul fp32)
RECIPES = {
    "sym32": (True, 32, False),
    "sym32-nocls": (True, 32, True),
    "asym32": (False, 32, False),
    "asym32-nocls": (False, 32, True),
    "sym16-nocls": (True, 16, True),
}


def build(name, sym, block, keep_cls):
    if name == "sym32":
        return os.path.join(SAT, "sat-3l-sm-q8w", "model.onnx")
    path = os.path.join(SCRATCH, f"model.{name}.onnx")
    if os.path.exists(path):
        return path
    q = MatMulNBitsQuantizer(onnx.load(FP32), bits=8, block_size=block, is_symmetric=sym,
                             nodes_to_exclude=["/classifier/MatMul"] if keep_cls else None)
    q.process()
    qm = q.model
    if hasattr(qm, "save_model_to_file"):
        qm.save_model_to_file(path, use_external_data_format=False)
    else:
        onnx.save(getattr(qm, "model", qm), path)
    return path


def probs(path, feeds):
    so = ort.SessionOptions()
    so.intra_op_num_threads = THREADS
    s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    out = []
    for f in feeds:
        logit = s.run(["logits"], f)[0][0, 1:-1, 0]
        l16 = logit.astype(np.float16).astype(np.float64)
        out.append((1 / (1 + np.exp(-l16))).astype(np.float32))
    return out


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    tok = Tokenizer.from_file(TOKENIZER)
    with open(os.path.join(ROOT, "results", "parity-sat-3l-sm.rows.json"), encoding="utf-8") as fh:
        rows = json.load(fh)
    keys, feeds = [], []
    for r in rows:
        ids = tok.encode(r["input"], add_special_tokens=False).ids[:510]
        if not ids:
            continue
        x = np.array([[0] + ids + [2]], dtype=np.int64)
        keys.append(f"{r['id']}|{r['variant']}")
        feeds.append({"input_ids": x, "attention_mask": np.ones(x.shape, dtype=np.float32)})
    t = time.time()
    base = probs(FP32, feeds)
    print(f"fp32: {len(feeds)} windows, {sum(p.size for p in base)} tokens, {time.time() - t:.0f} s", flush=True)
    all_margin = np.concatenate([np.abs(p - THRESHOLD) for p in base])
    with open(os.path.join(ROOT, "results", "parity-sat-3l-sm-q8w.json"), encoding="utf-8") as fh:
        wasm = json.load(fh)
    wasm_rows = sorted({f"{d['id']}|{d['variant']}" for d in wasm["comparisons"]["q8w vs fp16"]["diffs"]})
    report = {"onnxruntime": ort.__version__, "windows": len(feeds), "tokens": int(all_margin.size), "threshold": THRESHOLD,
              "fp32_margin_quantiles": {q: float(np.quantile(all_margin, q)) for q in (0.001, 0.01, 0.05, 0.5)},
              "wasm_sym32_split_diff_rows": wasm_rows, "recipes": {}}
    for name, (sym, block, keep_cls) in RECIPES.items():
        t = time.time()
        path = build(name, sym, block, keep_cls)
        ps = probs(path, feeds)
        flips, rows_flip, max_dp, flip_margins = 0, [], 0.0, []
        for k, p, b in zip(keys, ps, base):
            d = (p > THRESHOLD) != (b > THRESHOLD)
            max_dp = max(max_dp, float(np.abs(p.astype(np.float64) - b).max()))
            if d.any():
                flips += int(d.sum())
                rows_flip.append(k)
                flip_margins += np.abs(b[d] - THRESHOLD).tolist()
        entry = {"symmetric": sym, "block_size": block, "classifier_fp32": keep_cls, "file": path, "bytes": os.path.getsize(path),
                 "token_flips": flips, "rows_with_flip": len(rows_flip), "max_abs_dp": max_dp,
                 "max_fp32_margin_at_flip": max(flip_margins) if flip_margins else None,
                 "fp32_tokens_at_or_below_that_margin": int((all_margin <= max(flip_margins)).sum()) if flip_margins else 0,
                 "flip_margins": sorted(round(x, 5) for x in flip_margins), "rows": rows_flip}
        report["recipes"][name] = entry
        print(name, f"{time.time() - t:.0f} s", json.dumps({k: entry[k] for k in ("bytes", "token_flips", "rows_with_flip", "max_abs_dp", "max_fp32_margin_at_flip", "fp32_tokens_at_or_below_that_margin")}), flush=True)
    out = os.path.join(ROOT, "results", "parity-sat-3l-sm-q8w-recipes.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print("fp32 margin quantiles", json.dumps(report["fp32_margin_quantiles"]))
    print("wrote", out)


if __name__ == "__main__":
    main()
