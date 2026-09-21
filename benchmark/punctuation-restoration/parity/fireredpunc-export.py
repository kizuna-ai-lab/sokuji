"""Attribute the 42ailab int8 divergence: export upstream FireRedPunc to ONNX ourselves.

1. Loads the upstream PyTorch model exactly as punc.load_punc_bert_model does, but with
   BERT attention forced to "eager" so the traced graph keeps the attention mask.
2. Exports fp32 ONNX with the 42ailab interface: input_ids / attention_mask int64
   [1, 1+n] ([CLS] first, no [SEP]) -> logits [1, n, 5] (the [CLS] row sliced off).
3. Re-quantizes it the way Mojicast does its BERT: onnxruntime quantize_dynamic,
   QInt8 weights, MatMul only, per_channel=True, MatMulConstBOnly (embeddings stay fp32).
4. Scores every ONNX file against the upstream torch predictions stored in
   results/parity-fireredpunc-upstream.json (same ids, same upstream decode).

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-firered/bin/python parity/fireredpunc-export.py
writes /home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx/{punc.fp32.onnx,punc.int8pc.onnx,tokenizer.json,out_dict}
       results/parity-fireredpunc-export.json
"""
import argparse
import json
import os
import shutil
import sys

UPSTREAM = "/home/jiangzhuo/.cache/sokuji-punct-bench/src/FireRedASR2S/fireredasr2s"
MODEL_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/FireRedPunc"
OUT_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/fireredpunc-onnx"
AILAB_INT8 = ("/home/jiangzhuo/.cache/huggingface/hub/models--42ailab--FireRedPunc-ONNX/snapshots/"
              "d1d9992eeeac08eafbbc892a280ac911a8055c9c/punc.int8.onnx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, UPSTREAM)

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402
import transformers  # noqa: E402
from fireredpunc.models.fireredpunc_bert import FireRedPuncBert  # noqa: E402
from fireredpunc.punc import ModelIO, RuleBaedTxtFix  # noqa: E402


class Exportable(torch.nn.Module):
    """FireRedPuncBert._forward for a batch that already starts with [CLS]."""

    def __init__(self, punc):
        super().__init__()
        self.bert = punc.bert
        self.classifier = punc.classifier

    def forward(self, input_ids, attention_mask):
        h = self.bert(input_ids=input_ids, attention_mask=attention_mask)[0][:, 1:]
        return self.classifier(h)


def load_eager():
    # The checkpoint pickles an argparse.Namespace next to the tensors; allow exactly that
    # instead of upstream's weights_only=False.
    torch.serialization.add_safe_globals([argparse.Namespace])
    package = torch.load(os.path.join(MODEL_DIR, "model.pth.tar"), map_location="cpu", weights_only=True)
    args = package["args"]
    args.pretrained_bert = os.path.join(MODEL_DIR, "chinese-lert-base")
    args.bert = transformers.BertModel.from_pretrained(args.pretrained_bert, attn_implementation="eager")
    args.bert.pooler = None
    args.hidden_size = args.bert.config.hidden_size
    model = FireRedPuncBert(args)
    missing, unexpected = model.load_state_dict(package["model_state_dict"], strict=False)
    model.eval()
    return model, args.cls_id, missing, unexpected


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    fp32_path = os.path.join(OUT_DIR, "punc.fp32.onnx")
    int8pc_path = os.path.join(OUT_DIR, "punc.int8pc.onnx")
    for f in ("out_dict", "chinese-lert-base/tokenizer.json"):
        shutil.copyfile(os.path.join(MODEL_DIR, f), os.path.join(OUT_DIR, os.path.basename(f)))

    model, cls_id, missing, unexpected = load_eager()
    print("state_dict missing:", missing, "unexpected:", unexpected)
    wrap = Exportable(model).eval()
    if not os.path.exists(fp32_path):
        dummy = torch.tensor([[cls_id] + [872] * 15], dtype=torch.long)
        torch.onnx.export(
            wrap, (dummy, torch.ones_like(dummy)), fp32_path,
            input_names=["input_ids", "attention_mask"], output_names=["logits"],
            dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                          "logits": {0: "batch", 1: "seq_minus_1"}},
            opset_version=17, dynamo=False)
    if not os.path.exists(int8pc_path):
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(fp32_path, int8pc_path, weight_type=QuantType.QInt8,
                         op_types_to_quantize=["MatMul"], per_channel=True,
                         extra_options={"MatMulConstBOnly": True})

    io = ModelIO(MODEL_DIR)
    with open(os.path.join(ROOT, "results", "parity-fireredpunc-upstream.json"), encoding="utf-8") as fh:
        ref = json.load(fh)
    rows = ref["rows"]
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    variants = {
        "42ailab_int8": AILAB_INT8,
        "export_fp32": fp32_path,
        "export_int8_perchannel_matmul": int8pc_path,
    }
    report = {"sizes_bytes": {k: os.path.getsize(v) for k, v in variants.items()}, "models": {}}

    # eager torch vs the stored (sdpa) torch predictions, to show the reference is stable.
    eager_agree = 0
    n_tok = 0
    for r in rows:
        ids = torch.tensor([[cls_id] + r["ids"]])
        with torch.no_grad():
            p = wrap(ids, torch.ones_like(ids)).argmax(-1)[0].tolist()
        eager_agree += sum(a == b for a, b in zip(p, r["preds_torch"]))
        n_tok += len(p)
    report["torch_eager_vs_torch_sdpa_token_agree"] = eager_agree / n_tok

    for name, path in variants.items():
        sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        tok_agree = 0
        text_exact = 0
        period_torch = period_model = 0
        maxabs = 0.0
        diffs = []
        for r in rows:
            a = np.array([[cls_id] + r["ids"]], dtype=np.int64)
            logits = sess.run(None, {"input_ids": a, "attention_mask": np.ones_like(a)})[0]
            preds = logits.argmax(-1)[0].tolist()
            tok_agree += sum(x == y for x, y in zip(preds, r["preds_torch"]))
            text = RuleBaedTxtFix.fix(io.add_punc_to_txt([r["tokens"]], [preds])[0])
            text_exact += text == r["torch_text"]
            period_torch += sum(x in (2, 3, 4) for x in r["preds_torch"])
            period_model += sum(x in (2, 3, 4) for x in preds)
            if text != r["torch_text"] and len(diffs) < 5:
                diffs.append({"id": r["id"], "variant": r["variant"], "torch": r["torch_text"], "model": text})
        report["models"][name] = {
            "token_class_agree_vs_torch": tok_agree / n_tok,
            "text_exact_vs_torch": text_exact / len(rows),
            "terminal_marks_torch": period_torch,
            "terminal_marks_model": period_model,
            "diffs": diffs,
        }
        print(name, json.dumps({k: v for k, v in report["models"][name].items() if k != "diffs"}))

    path = os.path.join(ROOT, "results", "parity-fireredpunc-export.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "models"}, indent=1))
    print("wrote", path)


if __name__ == "__main__":
    main()
