"""Upload the validated Qwen3-ASR-0.6B ONNX artifacts to the Hugging Face Hub.

usage: python upload_hf.py --repo jiangzhuo9357/Qwen3-ASR-0.6B-ONNX --dir qwen3-asr-onnx/output/qwen3-asr-0.6b [--private]

Requires a token that can write to the target namespace. Uploads only the browser-relevant
files plus hf_README.md as the model card. The q4f16 files must be the working (norm-in-fp32,
deduplicated) build — see to_q4f16_ort.py, dedupe_values.py and rename_ext.py.
"""
import argparse
import os

from huggingface_hub import HfApi

FILES = [
    "config.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "added_tokens.json",
    "encoder.onnx", "encoder.fp16.onnx",
    "decoder_init.int4.onnx", "decoder_init.int4.onnx.data",
    "decoder_step.int4.onnx", "decoder_step.int4.onnx.data",
    "decoder_init.q4f16.onnx", "decoder_init.q4f16.onnx.data",
    "decoder_step.q4f16.onnx", "decoder_step.q4f16.onnx.data",
    "embed_tokens.fp16.bin", "mel_filters.json",
]

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True)
ap.add_argument("--dir", required=True)
ap.add_argument("--private", action="store_true")
ap.add_argument("--readme", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf_README.md"))
a = ap.parse_args()

api = HfApi()
api.create_repo(a.repo, repo_type="model", private=a.private, exist_ok=True)
for f in FILES:
    p = os.path.join(a.dir, f)
    if not os.path.exists(p):
        print("skip (missing)", f)
        continue
    print("upload", f, f"{os.path.getsize(p) / 1e6:.0f} MB", flush=True)
    api.upload_file(path_or_fileobj=p, path_in_repo=f, repo_id=a.repo, repo_type="model")
if os.path.exists(a.readme):
    api.upload_file(path_or_fileobj=a.readme, path_in_repo="README.md", repo_id=a.repo, repo_type="model")
print("done", f"https://huggingface.co/{a.repo}")
