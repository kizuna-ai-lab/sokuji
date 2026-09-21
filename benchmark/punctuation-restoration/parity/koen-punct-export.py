"""Export whooray/koen_punctuation to ONNX (fp32) and build two int8 dynamic-quantized graphs.

usage: /home/jiangzhuo/.cache/sokuji-punct-bench/venv-ko/bin/python parity/koen-punct-export.py

Inputs (downloaded at pinned revisions, see models/koen-punct.md):
  <DIR>/src/                 whooray/koen_punctuation @ 5c132a5cefa058c38b9f40006effa2da6f0c1d4d
  modeling code              Alibaba-NLP/new-impl     @ 40ced75c3017eb27626c9d4ea981bde21a2662f4 (code_revision)
Outputs in <DIR>:
  model.onnx                 fp32, inputs input_ids/attention_mask int64 [B, T], output logits float32 [B, T, 5]
  model.int8-matmul.onnx     quantize_dynamic(per_channel=True, QInt8, op_types_to_quantize=["MatMul"])
  model.int8.onnx            quantize_dynamic(per_channel=True, QInt8, op_types_to_quantize=["MatMul", "Gather"])
  tokenizer.json             copy of src/tokenizer.json
"""
import collections
import hashlib
import json
import os
import shutil
import sys

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForTokenClassification, AutoTokenizer

DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/ko/koen_punctuation"
SRC = os.path.join(DIR, "src")
CODE_REV = "40ced75c3017eb27626c9d4ea981bde21a2662f4"
MODELING_SHA256 = "374670b416fcc82f081c9cd28b5fd61c2bd91bbe18eb4798fcc48a81f9c250a0"
OPSET = 17


class Wrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask):
        return self.m(input_ids=input_ids, attention_mask=attention_mask, return_dict=False)[0]


def load(attn):
    tok = AutoTokenizer.from_pretrained(SRC)
    model = AutoModelForTokenClassification.from_pretrained(
        SRC, trust_remote_code=True, code_revision=CODE_REV, attn_implementation=attn
    ).eval()
    path = sys.modules[type(model).__module__].__file__
    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    if digest != MODELING_SHA256:
        raise SystemExit(f"modeling.py at {path} is {digest}, expected the pinned {MODELING_SHA256}")
    return tok, model


def op_counts(path):
    m = onnx.load(path, load_external_data=False)
    return collections.Counter(n.op_type for n in m.graph.node)


def main():
    tok, model = load("eager")
    print("params", sum(p.numel() for p in model.parameters()))
    fp32 = os.path.join(DIR, "model.onnx")
    enc = tok("자 그럼 회의를 시작하겠습니다 먼저 지난주 진행 상황부터 확인해 볼까요", return_tensors="pt")
    with torch.no_grad():
        torch.onnx.export(
            Wrapper(model),
            (enc["input_ids"], enc["attention_mask"]),
            fp32,
            dynamo=False,
            opset_version=OPSET,
            input_names=["input_ids", "attention_mask"],
            output_names=["logits"],
            dynamic_axes={"input_ids": {0: "B", 1: "T"}, "attention_mask": {0: "B", 1: "T"}, "logits": {0: "B", 1: "T"}},
            do_constant_folding=True,
        )
    print("fp32 ops", dict(op_counts(fp32)))

    # fp32 graph vs PyTorch (default attention implementation, as upstream loads it) on a few lengths.
    _, ref_model = load(None)
    sess = ort.InferenceSession(fp32, providers=["CPUExecutionProvider"])
    texts = [
        "감사합니다",
        "이 기능은 언제 출시될 예정인가요 다음 달 초에는 가능할 것 같은데 테스트 결과에 따라 달라질 수 있습니다",
        "hello how are you today i am fine thank you " * 40,
    ]
    for t in texts:
        e = tok(t, return_tensors="pt")
        with torch.no_grad():
            want = ref_model(**e).logits.numpy()
        got = sess.run(None, {"input_ids": e["input_ids"].numpy(), "attention_mask": e["attention_mask"].numpy()})[0]
        print(f"T={want.shape[1]}: max|onnx-torch| {np.abs(got - want).max():.2e}, argmax equal {bool((got.argmax(-1) == want.argmax(-1)).all())}")

    for name, ops in [("model.int8-matmul.onnx", ["MatMul"]), ("model.int8.onnx", ["MatMul", "Gather"])]:
        dst = os.path.join(DIR, name)
        quantize_dynamic(fp32, dst, op_types_to_quantize=ops, per_channel=True, weight_type=QuantType.QInt8)
        print(name, "ops", dict(op_counts(dst)))
        m = onnx.load(dst)
        q = [(i.name, list(i.dims)) for i in m.graph.initializer if i.data_type == onnx.TensorProto.INT8 and len(i.dims) >= 2]
        print(name, "int8 initializers:", len(q), "gather-side:", [x for x in q if "embed" in x[0] or "cached" in x[0]])

    shutil.copyfile(os.path.join(SRC, "tokenizer.json"), os.path.join(DIR, "tokenizer.json"))
    sizes = {f: os.path.getsize(os.path.join(DIR, f)) for f in ["model.onnx", "model.int8-matmul.onnx", "model.int8.onnx", "tokenizer.json"]}
    sizes["src/model.safetensors"] = os.path.getsize(os.path.join(SRC, "model.safetensors"))
    print(json.dumps(sizes, indent=1))


if __name__ == "__main__":
    main()
