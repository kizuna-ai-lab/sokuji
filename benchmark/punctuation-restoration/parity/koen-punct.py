"""Reference outputs of the upstream koen_punctuation pipeline over results/inputs.json.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-ko/bin/python parity/koen-punct.py [--backend torch|model.onnx|model.int8.onnx|model.int8-matmul.onnx]

The text output is produced by `spokentxt_punctuation_restoration.PunctuationModel.predict` (the
inference code the model card points to, spokentxt-punctuation-restoration 0.1.1 from PyPI), called
verbatim. Only its constructor is bypassed, because it cannot pin revisions: the tokenizer and model
are loaded here from the pinned snapshot with the pinned custom-code revision, then handed to it.

  --backend torch       the PyTorch model (default attention implementation, sdpa), as upstream runs it
  --backend <file>.onnx the same predict() over an onnxruntime CPU session of that graph, to separate
                        quantization effects from JS-runtime effects

Writes results/parity-koen-punct-ref-<torch|fp32|int8|int8-matmul>.json with, per row: the input, the
tokenizer ids (with <s>/</s>) and tokens, the argmax label of every position, and predict()'s output.

Rows: every ko and en row of results/inputs.json, plus one `long` row per language that joins every
`stripped` input of that language, so the JS module's 510-token windowing is exercised (upstream runs
the whole text in one pass; no corpus row comes near 510 tokens).
"""
import argparse
import hashlib
import json
import os
import sys
import time
from types import SimpleNamespace

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

sys.path.insert(0, "/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/spokentxt/spokentxt_punctuation_restoration-0.1.1")
from spokentxt_punctuation_restoration import PunctuationModel  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/ko/koen_punctuation"
SRC = os.path.join(DIR, "src")
CODE_REV = "40ced75c3017eb27626c9d4ea981bde21a2662f4"
MODELING_SHA256 = "374670b416fcc82f081c9cd28b5fd61c2bd91bbe18eb4798fcc48a81f9c250a0"
LANGS = ["ko", "en"]


class OnnxModel:
    """Stands in for the torch model inside predict(): same call shape, logits from onnxruntime."""

    def __init__(self, path, config):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.config = config

    def to(self, device):
        return self

    def __call__(self, input_ids, attention_mask, **_):
        logits = self.sess.run(["logits"], {"input_ids": input_ids.numpy(), "attention_mask": attention_mask.numpy()})[0]
        return SimpleNamespace(logits=torch.from_numpy(logits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="torch")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(SRC)
    torch_model = AutoModelForTokenClassification.from_pretrained(SRC, trust_remote_code=True, code_revision=CODE_REV).eval()
    path = sys.modules[type(torch_model).__module__].__file__
    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    if digest != MODELING_SHA256:
        raise SystemExit(f"{path} is not the pinned modeling.py")
    if args.backend == "torch":
        model, stem = torch_model, "torch"
    else:
        model = OnnxModel(os.path.join(DIR, args.backend), torch_model.config)
        stem = os.path.splitext(args.backend)[0].replace("model", "", 1).lstrip(".-") or "fp32"

    pm = PunctuationModel.__new__(PunctuationModel)
    pm.tokenizer, pm.model, pm.device = tok, model, "cpu"
    normalizer = tok.backend_tokenizer.normalizer

    with open(os.path.join(ROOT, "results", "inputs.json"), encoding="utf-8") as fh:
        rows = json.load(fh)
    rows = [r for r in rows if r["lang"] in LANGS]
    for lang in LANGS:
        parts = [r["input"] for r in rows if r["lang"] == lang and r["variant"] == "stripped"]
        rows.append({"id": f"{lang}-long", "lang": lang, "variant": "long", "input": " ".join(parts)})

    out = []
    t0 = time.time()
    for r in rows:
        text = r["input"]
        enc = tok(text, return_tensors="pt")
        with torch.no_grad():
            logits = model(**enc).logits
            labels = torch.argmax(logits, dim=2).squeeze(0).tolist()
            punct = pm.predict(text)
        ids = enc["input_ids"][0].tolist()
        out.append({
            "id": r["id"], "lang": r["lang"], "variant": r["variant"], "input": text,
            "ids": ids, "tokens": tok.convert_ids_to_tokens(ids), "labels": labels, "n_tokens": len(ids),
            "normalizes_to_itself": normalizer.normalize_str(text) == text, "has_unk": tok.unk_token_id in ids,
            "punct": punct,
        })
    dst = os.path.join(ROOT, "results", f"parity-koen-punct-ref-{stem}.json")
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump({"backend": args.backend, "rows": out}, fh, ensure_ascii=False, indent=1)
    print(f"wrote {dst}: {len(out)} rows in {time.time() - t0:.1f}s; max tokens {max(r['n_tokens'] for r in out)}; "
          f"rows not normalization-invariant {sum(not r['normalizes_to_itself'] for r in out)}; rows with <unk> {sum(r['has_unk'] for r in out)}")


if __name__ == "__main__":
    main()
