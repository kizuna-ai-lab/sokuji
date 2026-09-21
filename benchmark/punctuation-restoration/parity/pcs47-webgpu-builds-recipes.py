"""Which weight-only 8-bit recipe keeps PCS-47's decisions? A native proxy for the WASM parity.

model.q8w.onnx (symmetric, block 32, every constant MatMul) changed 14 of 248 rows against fp32 on WASM
(parity/pcs47-webgpu-builds.mjs), where FireRedPunc's identical recipe changed none. This script builds a few
recipes into scratch, runs all 248 parity rows through each on Python onnxruntime (CPU EP) with the JS
windowing (models/pcs47-core.mjs: 254-id windows, overlap 16, keep ranges), and against fp32 counts label
flips per head at the positions the decoder actually reads (every token for pre/post/seg; for cap only slots
holding a cased character), plus fp32's own decision margin at each flip:
  pre/post: top-1 minus top-2 logit;  seg: |softmax class-1 prob - threshold|;  cap: |sigmoid - threshold|.
Native fp32 and WASM fp32 give identical outputs on all 248 rows (models/pcs47.md), and MatMulNBits bits=8 is
dequantize-then-float-MatMul on both CPU kernels, so this tracks WASM. The row sets of sym32-noheads, the recipe
of the shipped model.q8w.onnx, are cross-checked against results/parity-pcs47-q8w.json; the first run (when
model.q8w.onnx was sym32) matched results/parity-pcs47-q8w-allmatmul.json row for row.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/pcs47-webgpu-builds-recipes.py
writes results/parity-pcs47-q8w-recipes.json (models go to the job scratch)
"""
import json
import os
import time

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from tokenizers import Tokenizer

D = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47"
FP32 = os.path.join(D, "model.onnx")
SCRATCH = "/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/webgpu-builds/pcs47-recipes"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LEN, OVERLAP, SLOTS = 256, 16, 16
THREADS = 6
LOGITS = {
    "pre": "/_decoder/_punct_head_pre/_linears.1/Add_output_0",
    "post": "/_decoder/_punct_head_post/_linears.1/Add_output_0",
    "seg": "/_decoder/_seg_head/_linears.1/Add_output_0",
    "cap": "/_decoder/_cap_head/_linears.1/Add_output_0",
}
LABELS = {"pre": "pre_preds", "post": "post_preds", "seg": "seg_preds", "cap": "cap_preds"}
# name: (symmetric, block_size, keep the 8 decoder-head MatMuls fp32)
RECIPES = {
    "sym32": (True, 32, False),
    "sym32-noheads": (True, 32, True),
    "asym32": (False, 32, False),
    "asym32-noheads": (False, 32, True),
    "sym16-noheads": (True, 16, True),
}


def build(name, sym, block, keep_heads):
    path = os.path.join(SCRATCH, f"model.{name}.onnx")
    if os.path.exists(path):
        return path
    m = onnx.load(FP32)
    heads = [n.name for n in m.graph.node if n.op_type == "MatMul" and n.name.startswith("/_decoder/")]
    q = MatMulNBitsQuantizer(m, bits=8, block_size=block, is_symmetric=sym, nodes_to_exclude=heads if keep_heads else None)
    q.process()
    qm = q.model
    if hasattr(qm, "save_model_to_file"):
        qm.save_model_to_file(path, use_external_data_format=False)
    else:
        onnx.save(getattr(qm, "model", qm), path)
    return path


def const_value(graph, name):
    for t in graph.initializer:
        if t.name == name:
            return onnx.numpy_helper.to_array(t)
    for n in graph.node:
        if n.op_type == "Constant" and n.output[0] == name:
            return onnx.numpy_helper.to_array(n.attribute[0].t)
    return None


def open_session(path):
    m = onnx.load(path)
    thr = {}
    for n in m.graph.node:
        if n.op_type == "Greater" and n.output[0] in ("cap_preds", "seg_preds"):
            v = const_value(m.graph, n.input[1])
            thr[n.output[0]] = None if v is None else float(np.asarray(v).reshape(-1)[0])
    for name in LOGITS.values():
        m.graph.output.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, None))
    so = ort.SessionOptions()
    so.intra_op_num_threads = THREADS
    return ort.InferenceSession(m.SerializeToString(), so, providers=["CPUExecutionProvider"]), thr


def windows(n):
    width = MAX_LEN - 2
    out, start, idx = [], 0, 0
    while start < n:
        frm = start - (0 if idx == 0 else OVERLAP)
        stop = frm + width
        out.append((frm, min(stop, n)))
        start = stop
        idx += 1
    return out


def run_rows(sess, rows):
    names = list(LABELS.values()) + list(LOGITS.values())
    half = OVERLAP // 2
    res = []
    for r in rows:
        ids = r["sp_ids_pre"]
        ws = windows(len(ids))
        acc = {k: [] for k in names}
        for w, (frm, stop) in enumerate(ws):
            x = np.array([[0] + ids[frm:stop] + [2]], dtype=np.int64)
            outs = dict(zip(names, sess.run(names, {"input_ids": x})))
            ln = stop - frm
            a = half if w > 0 else 0
            b = ln - half if w < len(ws) - 1 else ln
            for k in names:
                acc[k].append(outs[k][0, a + 1:b + 1])
        res.append({k: np.concatenate(v, axis=0) for k, v in acc.items()} if ws else None)
    return res


def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def margins(f, thr):
    """fp32 decision margins per head, same shapes as the labels."""
    top2 = np.sort(f[LOGITS["pre"]], axis=-1)[:, -2:]
    pre = top2[:, 1] - top2[:, 0]
    top2 = np.sort(f[LOGITS["post"]], axis=-1)[:, -2:]
    post = top2[:, 1] - top2[:, 0]
    seg = np.abs(softmax(f[LOGITS["seg"]].astype(np.float64))[:, 1] - thr["seg_preds"])
    cap = np.abs(1 / (1 + np.exp(-f[LOGITS["cap"]].astype(np.float64))) - thr["cap_preds"])
    return {"pre": pre, "post": post, "seg": seg, "cap": cap}


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    with open(os.path.join(ROOT, "results", "parity-pcs47-ref-fp32.json"), encoding="utf-8") as fh:
        ref = json.load(fh)["rows"]
    tok = Tokenizer.from_file(os.path.join(D, "tokenizer.json"))

    def cased_slots(ids):
        m = np.zeros((len(ids), SLOTS), dtype=bool)
        for t, i in enumerate(ids):
            chars = list(tok.id_to_token(i) or "")
            lead = 1 if chars and chars[0] == "▁" else 0
            for j in range(lead, min(len(chars), SLOTS)):
                if chars[j].upper() != chars[j].lower():
                    m[t, j] = True
        return m

    masks = [cased_slots(r["sp_ids_pre"]) for r in ref]
    t = time.time()
    sess, thr = open_session(FP32)
    base = run_rows(sess, ref)
    del sess
    print(f"fp32: {time.time() - t:.0f} s, thresholds {thr}", flush=True)

    # Sanity: fp32 labels recomputed from the exposed logits.
    recompute = {"pre": 0, "post": 0, "seg": 0, "cap": 0}
    base_margins = []
    for f, mask in zip(base, masks):
        if f is None:
            base_margins.append(None)
            continue
        recompute["pre"] += int((f[LOGITS["pre"]].argmax(-1) != f["pre_preds"]).sum())
        recompute["post"] += int((f[LOGITS["post"]].argmax(-1) != f["post_preds"]).sum())
        recompute["seg"] += int(((softmax(f[LOGITS["seg"]].astype(np.float64))[:, 1] > thr["seg_preds"]) != f["seg_preds"]).sum())
        recompute["cap"] += int((((1 / (1 + np.exp(-f[LOGITS["cap"]].astype(np.float64)))) > thr["cap_preds"]) != f["cap_preds"]).sum())
        base_margins.append(margins(f, thr))
    print("fp32 labels not reproduced from logits:", recompute, flush=True)

    # Every fp32 decision the decoder reads: all tokens for pre/post/seg, cased character slots for cap.
    all_m = {h: np.concatenate([m[h][mask] if h == "cap" else m[h] for m, mask in zip(base_margins, masks) if m is not None])
             for h in LABELS}

    js_rows = {}
    for name in ("parity-pcs47-q8w.json", "parity-pcs47-js-fp32.json"):
        with open(os.path.join(ROOT, "results", name), encoding="utf-8") as fh:
            js_rows[name] = {f"{r['id']}/{r['variant']}": r for r in json.load(fh)["rows"]}
    js_punct = sorted(k for k, r in js_rows["parity-pcs47-q8w.json"].items() if r["punct"] != js_rows["parity-pcs47-js-fp32.json"][k]["punct"])
    js_sbd = sorted(k for k, r in js_rows["parity-pcs47-q8w.json"].items() if r["sbd"] != js_rows["parity-pcs47-js-fp32.json"][k]["sbd"])

    report = {"onnxruntime": ort.__version__, "rows": len(ref), "thresholds": thr, "fp32_label_recompute_mismatches": recompute,
              "fp32_margin_quantiles": {h: {q: float(np.quantile(v, q)) for q in (0.001, 0.01, 0.05, 0.5)} for h, v in all_m.items()},
              "wasm_sym32_rows": {"punct": js_punct, "sbd": js_sbd}, "recipes": {}}
    for name, (sym, block, keep_heads) in RECIPES.items():
        t = time.time()
        path = build(name, sym, block, keep_heads)
        sess, _ = open_session(path)
        res = run_rows(sess, ref)
        del sess
        flips = {h: 0 for h in LABELS}
        flip_margins = {h: [] for h in LABELS}
        rows_punct, rows_sbd = [], []
        for r, v, f, fm, mask in zip(ref, res, base, base_margins, masks):
            if f is None:
                continue
            key = f"{r['id']}/{r['variant']}"
            d = {h: v[LABELS[h]] != f[LABELS[h]] for h in LABELS}
            d["cap"] = d["cap"] & mask
            for h in LABELS:
                flips[h] += int(d[h].sum())
                flip_margins[h] += fm[h][d[h]].tolist()
            if d["pre"].any() or d["post"].any() or d["cap"].any():
                rows_punct.append(key)
            if d["pre"].any() or d["post"].any() or d["cap"].any() or d["seg"].any():
                rows_sbd.append(key)
        entry = {
            "symmetric": sym, "block_size": block, "decoder_heads_fp32": keep_heads, "file": path, "bytes": os.path.getsize(path),
            "label_flips": flips, "rows_with_punct_label_flip": len(rows_punct), "rows_with_any_label_flip": len(rows_sbd),
            "max_fp32_margin_at_flip": {h: (max(v) if v else None) for h, v in flip_margins.items()},
            "fp32_positions_at_or_below_that_margin": {h: (int((all_m[h] <= max(v)).sum()) if v else 0) for h, v in flip_margins.items()},
            "fp32_positions": {h: int(all_m[h].size) for h in LABELS},
            "flip_margins": {h: sorted(round(x, 5) for x in v) for h, v in flip_margins.items()},
            "rows_punct": rows_punct,
        }
        if name == "sym32-noheads":  # the recipe of the shipped model.q8w.onnx
            entry["matches_wasm_rows"] = {"punct_native_minus_wasm": sorted(set(rows_punct) - set(js_punct)),
                                          "punct_wasm_minus_native": sorted(set(js_punct) - set(rows_punct)),
                                          "sbd_native_minus_wasm": sorted(set(rows_sbd) - set(js_sbd)),
                                          "sbd_wasm_minus_native": sorted(set(js_sbd) - set(rows_sbd))}
        report["recipes"][name] = entry
        print(name, f"{time.time() - t:.0f} s", json.dumps({k: entry[k] for k in ("bytes", "label_flips", "rows_with_punct_label_flip", "rows_with_any_label_flip", "max_fp32_margin_at_flip")}), flush=True)
        if name == "sym32-noheads":  # the recipe of the shipped model.q8w.onnx
            print("  vs WASM rows:", json.dumps(entry["matches_wasm_rows"]), flush=True)
    out = os.path.join(ROOT, "results", "parity-pcs47-q8w-recipes.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print("fp32 margin quantiles", json.dumps(report["fp32_margin_quantiles"]))
    print("wrote", out)


if __name__ == "__main__":
    main()
