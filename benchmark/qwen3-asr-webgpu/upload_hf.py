"""Upload the Qwen3-ASR-0.6B ONNX layout-v2 artifacts to the Hugging Face Hub.

usage: python upload_hf.py --repo jiangzhuo9357/Qwen3-ASR-0.6B-ONNX --dir <v2 dir> [--private] [--delete-others]

Requires a token that can write to the target namespace. Uploads the browser-relevant files
plus hf_README.md as the model card; --delete-others removes every other file in the repo
(used once to retire the spike's v1 layout).
"""
import argparse
import os

from huggingface_hub import HfApi

FILES = [
    "prompt_config.json", "config.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "added_tokens.json",
    "mel_filters.json",
    "encoder.onnx", "encoder.fp16.onnx",
    "decoder_init.int4.onnx", "decoder_step.int4.onnx", "decoder_weights.int4.data",
    "decoder_init.q4f16.onnx", "decoder_step.q4f16.onnx", "decoder_weights.q4f16.data",
    "embed_tokens.int8.bin", "embed_scales.f32.bin",
]

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True)
ap.add_argument("--dir", required=True)
ap.add_argument("--private", action="store_true")
ap.add_argument("--delete-others", action="store_true")
ap.add_argument("--readme", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf_README.md"))
a = ap.parse_args()

api = HfApi()
api.create_repo(a.repo, repo_type="model", private=a.private, exist_ok=True)
missing = [f for f in FILES if not os.path.exists(os.path.join(a.dir, f))]
if missing:
    raise SystemExit(f"missing in {a.dir}: {missing}")
for f in FILES:
    p = os.path.join(a.dir, f)
    print("upload", f, f"{os.path.getsize(p) / 1e6:.1f} MB", flush=True)
    api.upload_file(path_or_fileobj=p, path_in_repo=f, repo_id=a.repo, repo_type="model")
if os.path.exists(a.readme):
    api.upload_file(path_or_fileobj=a.readme, path_in_repo="README.md", repo_id=a.repo, repo_type="model")
if a.delete_others:
    keep = set(FILES) | {"README.md", ".gitattributes"}
    for s in api.list_repo_files(a.repo, repo_type="model"):
        if s not in keep:
            print("delete", s, flush=True)
            api.delete_file(s, repo_id=a.repo, repo_type="model")
info = api.model_info(a.repo, files_metadata=True)
print("done", f"https://huggingface.co/{a.repo}", "files:", len(info.siblings), "private:", info.private)
