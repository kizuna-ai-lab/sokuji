"""Reference outputs for the FireRedPunc port.

Runs the zh/en rows of results/inputs.json through
  (1) upstream FireRedPunc.process (FireRedASR2S @4e7d9aaf, PyTorch fp32, model.pth.tar
      + chinese-lert-base, transformers 4.51.3 as pinned upstream), and
  (2) the same upstream tokenizer / add_punc_to_txt / RuleBaedTxtFix with the model
      forward swapped for the 42ailab int8 ONNX under Python onnxruntime,
and records tokens, ids, per-token classes, logits distance and final text.
Also probes which input layout ([CLS]? [SEP]?) the ONNX graph expects.

The input is first passed through strip_marks, identical to models/fireredpunc.mjs.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/fireredpunc.py
writes results/parity-fireredpunc-upstream.json
"""
import json
import os
import sys
import time
import unicodedata

UPSTREAM = "/home/jiangzhuo/.cache/sokuji-punct-bench/src/FireRedASR2S/fireredasr2s"
MODEL_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/FireRedPunc"
ONNX_PATH = ("/home/jiangzhuo/.cache/huggingface/hub/models--42ailab--FireRedPunc-ONNX/snapshots/"
             "d1d9992eeeac08eafbbc892a280ac911a8055c9c/punc.int8.onnx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, UPSTREAM)

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402
from fireredpunc.punc import FireRedPunc, FireRedPuncConfig, RuleBaedTxtFix  # noqa: E402

STRIP_MARKS = set("，。？！、,.?!．｡､")
DIGIT_JOINERS = set(",.．")


def is_digit(ch):
    return bool(ch) and unicodedata.category(ch) == "Nd"


def strip_marks(text):
    out = []
    for i, ch in enumerate(text):
        prev = text[i - 1] if i > 0 else ""
        nxt = text[i + 1] if i + 1 < len(text) else ""
        joins = ch in DIGIT_JOINERS and is_digit(prev) and is_digit(nxt)
        out.append(" " if ch in STRIP_MARKS and not joins else ch)
    return "".join(out)


def main():
    torch.set_num_threads(4)
    rows = [r for r in json.load(open(os.path.join(ROOT, "results", "inputs.json"), encoding="utf-8"))
            if r["lang"] in ("zh", "en")]

    t0 = time.time()
    model = FireRedPunc.from_pretrained(MODEL_DIR, FireRedPuncConfig(use_gpu=False))
    load_s = time.time() - t0
    io = model.model_io
    cls_id = model.model.cls_id

    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(ONNX_PATH, so, providers=["CPUExecutionProvider"])

    def onnx_logits(ids):
        a = np.array([ids], dtype=np.int64)
        return sess.run(None, {"input_ids": a, "attention_mask": np.ones_like(a)})[0]

    sep_id = io.in_dict["[SEP]"]
    layout_probe = []
    out_rows = []
    for n, r in enumerate(rows):
        s = strip_marks(r["input"])
        raw_tokens = io.tokenizer.tokenizer.tokenize(s)
        padded, lengths, batch_tokens = io.text2tensor([s])
        tokens = batch_tokens[0]
        ids = padded[0].tolist()
        with torch.no_grad():
            logits_t = model.model.forward_model(padded, lengths)  # (1, n, 5)
        preds_t = logits_t.argmax(-1)[0].tolist()
        torch_text = model.process([s])[0]["punc_text"]

        logits_o = onnx_logits([cls_id] + ids)
        preds_o = logits_o.argmax(-1)[0].tolist()
        ort_text = RuleBaedTxtFix.fix(io.add_punc_to_txt([tokens], [preds_o])[0])
        lt = logits_t[0].numpy()
        lo = logits_o[0]

        if n < 6:
            with_sep = onnx_logits([cls_id] + ids + [sep_id])[0][:-1]
            no_cls = onnx_logits(ids)[0]
            layout_probe.append({
                "id": r["id"], "variant": r["variant"], "n_tokens": len(ids),
                "onnx_out_len_cls": int(lo.shape[0]),
                "maxabs_cls": float(np.abs(lo - lt).max()),
                "maxabs_cls_sep": float(np.abs(with_sep - lt).max()),
                "argmax_agree_cls_sep": float((with_sep.argmax(-1) == lt.argmax(-1)).mean()),
                "onnx_out_len_no_cls": int(no_cls.shape[0]),
                "maxabs_no_cls_shifted": float(np.abs(no_cls - lt[1:]).max()) if len(ids) > 1 else None,
            })

        row = {
            "id": r["id"], "lang": r["lang"], "variant": r["variant"], "input": r["input"], "stripped": s,
            "raw_tokens": raw_tokens, "tokens": tokens, "ids": ids,
            "preds_torch": preds_t, "preds_ort_int8": preds_o,
            "logits_maxabs": float(np.abs(lo - lt).max()),
            "torch_text": torch_text, "ort_int8_text": ort_text,
        }
        if r["variant"] == "commas":
            # What upstream does when the ASR commas are left in (not used by the port).
            row["torch_text_unstripped"] = model.process([r["input"]])[0]["punc_text"]
        out_rows.append(row)

    agree_tok = sum(sum(a == b for a, b in zip(x["preds_torch"], x["preds_ort_int8"])) for x in out_rows)
    n_tok = sum(len(x["preds_torch"]) for x in out_rows)
    summary = {
        "rows": len(out_rows),
        "load_s": load_s,
        "cls_id": cls_id,
        "torch_vs_ort_int8_text_exact": sum(x["torch_text"] == x["ort_int8_text"] for x in out_rows) / len(out_rows),
        "torch_vs_ort_int8_token_class_agree": agree_tok / n_tok,
        "tokens": n_tok,
        "versions": {"torch": torch.__version__, "onnxruntime": ort.__version__,
                     "transformers": __import__("transformers").__version__, "numpy": np.__version__},
    }
    out = {"summary": summary, "layout_probe": layout_probe, "rows": out_rows}
    path = os.path.join(ROOT, "results", "parity-fireredpunc-upstream.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps(layout_probe, ensure_ascii=False, indent=1))
    for x in out_rows:
        if x["torch_text"] != x["ort_int8_text"]:
            print("DIFF", x["id"], x["variant"])
            print("  torch:", x["torch_text"])
            print("  int8 :", x["ort_int8_text"])
    print("wrote", path)


if __name__ == "__main__":
    main()
