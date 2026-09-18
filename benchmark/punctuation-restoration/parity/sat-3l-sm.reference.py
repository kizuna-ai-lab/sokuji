"""Reference outputs of wtpsplit's own SaT pipeline for sat-3l-sm, one ONNX variant at a time.

usage: <venv-sat>/bin/python parity/sat-3l-sm.reference.py [fp16 fp32 int8 mc-int8]
reads results/parity-sat-3l-sm.rows.json, writes results/parity-sat-3l-sm.ref-<variant>.json

`fp16` is the unmodified `SaT("sat-3l-sm", ort_providers=["CPUExecutionProvider"])`. The other
variants keep everything wtpsplit does (tokenizer, windowing, fp16 averaging, threshold) and only
swap the onnxruntime session, feeding the attention mask in whatever dtype that graph declares.
Every row is split on its own (a list call would size the window by the longest text in the list
and pad the rest, which the JS port never does).
"""
import json
import os
import sys
import time

# wtpsplit before transformers: skops walks transformers' lazy modules at import time.
from wtpsplit import SaT  # noqa: E402

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOK = "/home/jiangzhuo/.cache/huggingface/hub/models--FacebookAI--xlm-roberta-base/snapshots/e73636d4f797dec63c3081bb6ed5c7b0bb3f2089"
SAT_DIR = "/home/jiangzhuo/.cache/sokuji-punct-bench/sat"
VARIANT_FILES = {
    "fp32": f"{SAT_DIR}/sat-3l-sm/model_fp32.onnx",
    "int8": f"{SAT_DIR}/sat-3l-sm/model_int8.onnx",
    "mc-int8": f"{SAT_DIR}/modelcloud-int8/model.onnx",
}


class SessionWrapper:
    def __init__(self, config, session):
        self.config = config
        self.session = session
        mask = next(i for i in session.get_inputs() if i.name == "attention_mask")
        self.mask_dtype = np.float16 if mask.type == "tensor(float16)" else np.float32

    def __call__(self, input_ids, attention_mask):
        logits = self.session.run(
            ["logits"],
            {"attention_mask": attention_mask.astype(self.mask_dtype), "input_ids": input_ids.astype(np.int64)},
        )[0]
        return {"logits": logits}


def f32_list(arr):
    # Shortest decimal that round-trips the float32 value; JS recovers it with Math.fround.
    return [float(str(np.float32(v))) for v in np.asarray(arr, dtype=np.float32)]


def main():
    variants = sys.argv[1:] or ["fp16", "fp32", "int8", "mc-int8"]
    rows = json.load(open(os.path.join(ROOT, "results", "parity-sat-3l-sm.rows.json")))
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sat = SaT("sat-3l-sm", tokenizer_name_or_path=TOK, ort_providers=["CPUExecutionProvider"], ort_kwargs={"sess_options": so})
    base_model = sat.model
    for variant in variants:
        if variant == "fp16":
            sat.model = base_model
        else:
            sat.model = SessionWrapper(base_model.config, ort.InferenceSession(VARIANT_FILES[variant], so, providers=["CPUExecutionProvider"]))
        out = []
        t0 = time.time()
        for r in rows:
            text = r["input"]
            enc = sat.tokenizer(text, add_special_tokens=False, return_offsets_mapping=True, verbose=False)
            sentences = sat.split(text)
            probs = sat.predict_proba(text, stride=64)
            out.append(
                {
                    "id": r["id"],
                    "variant": r["variant"],
                    "ids": enc["input_ids"],
                    "offsets": [list(o) for o in enc["offset_mapping"]],
                    "sentences": sentences,
                    "probs": f32_list(probs),
                }
            )
        print(f"{variant}: {len(out)} rows in {time.time() - t0:.1f}s")
        meta = {"wtpsplit": __import__("wtpsplit").__version__, "onnxruntime": ort.__version__, "threshold": 0.25}
        with open(os.path.join(ROOT, "results", f"parity-sat-3l-sm.ref-{variant}.json"), "w") as f:
            json.dump({"variant": variant, "meta": meta, "rows": out}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
