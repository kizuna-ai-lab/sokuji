"""Reference outputs of the upstream `punctuators` pipeline for PCS-47, over results/inputs.json.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/.venv/bin/python parity/pcs47.py [--model model.onnx]

Writes results/parity-pcs47-ref-<model stem>.json with, per row: the raw input, the
preprocessed text actually fed to the model, SentencePiece ids for both (to verify the JS
tokenizer), and punctuators' output with apply_sbd=False (text) and apply_sbd=True (sentences
joined with '\n'). parity/pcs47.mjs replays the same rows through models/pcs47-core.mjs.

Preprocessing mirrors `preprocess()` in models/pcs47-core.mjs (the model card's test inputs are
lower-cased with punctuation removed); punctuators itself does no preprocessing.

Besides the corpus rows, one `long` row per language concatenates every `stripped` input of that
language, so the 254-token windowing and overlap stitching are exercised (no corpus row reaches
254 tokens on its own).
"""
import argparse
import json
import os
import re
import time
import unicodedata

from punctuators.models import PunctCapSegModelONNX
from punctuators.models.punc_cap_seg_model import PunctCapSegConfigONNX

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47"
LANGS = ["ja", "zh", "en", "ko"]

# Every pre/post label character in config.yaml: the marks the model itself decides.
MARKS = set("¿.,?？，。、・।؟،;።፣፧")


def preprocess(text: str) -> str:
    cps = list(text)
    out = []
    for i, ch in enumerate(cps):
        if ch in MARKS:
            # Keep decimal points and digit-group separators: "12.5", "3,000".
            if ch in ".," and 0 < i < len(cps) - 1 and unicodedata.category(cps[i - 1]) == "Nd" and unicodedata.category(cps[i + 1]) == "Nd":
                out.append(ch)
            continue
        out.append(ch)
    return re.sub(r"\s+", " ", "".join(out).lower()).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="model.onnx")
    ap.add_argument(
        "--no-opt",
        action="store_true",
        help="disable onnxruntime graph optimizations, which fuse the int8 MatMulInteger chains into "
        "different CPU kernels (checks whether that explains JS-vs-Python int8 diffs)",
    )
    args = ap.parse_args()

    with open(os.path.join(ROOT, "results", "inputs.json"), encoding="utf-8") as fh:
        rows = json.load(fh)
    rows = [r for r in rows if r["lang"] in LANGS]
    for lang in LANGS:
        parts = [r["input"] for r in rows if r["lang"] == lang and r["variant"] == "stripped"]
        rows.append({"id": f"{lang}-long", "lang": lang, "variant": "long", "input": " ".join(parts)})

    m = PunctCapSegModelONNX(
        cfg=PunctCapSegConfigONNX(directory=MODEL_DIR, model_filename=args.model),
        ort_providers=["CPUExecutionProvider"],
    )
    if args.no_opt:
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        m._ort_session = ort.InferenceSession(
            os.path.join(MODEL_DIR, args.model), sess_options=so, providers=["CPUExecutionProvider"]
        )
    sp = m._tokenizer
    out = []
    t0 = time.time()
    for r in rows:
        pre = preprocess(r["input"])
        # One text per infer() call: windows of a single text are still batched (and padded)
        # together upstream, exactly as punctuators does it.
        punct = m.infer([pre], apply_sbd=False)[0]
        sents = m.infer([pre], apply_sbd=True)[0]
        ids_pre = sp.EncodeAsIds(pre)
        out.append({
            "id": r["id"], "lang": r["lang"], "variant": r["variant"], "input": r["input"], "pre": pre,
            "sp_ids_input": sp.EncodeAsIds(r["input"]), "sp_ids_pre": ids_pre, "n_tokens": len(ids_pre),
            "punct": punct, "sbd": "\n".join(sents),
        })
    stem = (os.path.splitext(args.model)[0].replace("model", "", 1).lstrip(".-") or "fp32") + ("-noopt" if args.no_opt else "")
    dst = os.path.join(ROOT, "results", f"parity-pcs47-ref-{stem}.json")
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "rows": out}, fh, ensure_ascii=False, indent=1)
    print(f"wrote {dst}: {len(out)} rows in {time.time() - t0:.1f}s; max tokens {max(r['n_tokens'] for r in out)}")


if __name__ == "__main__":
    main()
