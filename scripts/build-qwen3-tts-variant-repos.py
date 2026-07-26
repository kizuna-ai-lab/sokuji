#!/usr/bin/env python3
"""Assemble self-contained per-variant Qwen3-TTS repos from the dual-dir originals.

Reads the cached snapshot of jiangzhuo9357/qwen3-tts-{size}-onnx and hardlinks
files into <out>/qwen3-tts-{size}-onnx-{variant}/ trees (copy on cross-device).
The int8 tree needs --int8-dir pointing at Task 2's quantized graphs; without
it only fp32+bf16 trees are built.

Usage:
  python scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos
  python scripts/build-qwen3-tts-variant-repos.py --size 1.7b --out /tmp/q3repos \
      --int8-dir /tmp/q3int8/1.7b
  # After user approval only:
  python scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos --upload
"""
import argparse
import os
import shutil
import sys

# The three heavy graphs int8 replaces (basename under onnx/).
INT8_REPLACED = ("talker_decode.onnx", "talker_decode.onnx.data",
                 "code_predictor.onnx", "text_project.onnx")


def _link(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src = os.path.realpath(src)                     # deref HF blob symlink
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _walk_files(root):
    for r, _d, files in os.walk(root):
        for f in files:
            p = os.path.join(r, f)
            yield os.path.relpath(p, root), p


def build_tree(snap, out_dir, variant, int8_dir=None):
    for rel, src in _walk_files(snap):
        top = rel.split(os.sep)[0]
        if top == "onnx-bf16":
            continue                                # never copied verbatim
        if variant == "int8" and top == "onnx" and os.path.basename(rel) in INT8_REPLACED:
            continue                                # replaced below
        if variant == "bf16" and top == "onnx":
            base = os.path.basename(rel)
            # a same-named bf16 rebuild exists -> the fp32 original is dropped;
            # also drop fp32 talker external data when bf16 talker is single-file
            if (os.path.exists(os.path.join(snap, "onnx-bf16", base))
                    or (base == "talker_decode.onnx.data"
                        and os.path.exists(os.path.join(snap, "onnx-bf16", "talker_decode.onnx"))
                        and not os.path.exists(os.path.join(snap, "onnx-bf16", "talker_decode.onnx.data")))):
                continue
        _link(src, os.path.join(out_dir, rel))
    if variant == "bf16":
        bdir = os.path.join(snap, "onnx-bf16")
        for f in os.listdir(bdir):
            _link(os.path.join(bdir, f), os.path.join(out_dir, "onnx", f))
    if variant == "int8":
        assert int8_dir, "int8 tree needs --int8-dir"
        for f in os.listdir(int8_dir):
            _link(os.path.join(int8_dir, f), os.path.join(out_dir, "onnx", f))


def tree_bytes(root):
    return sum(os.path.getsize(p) for _rel, p in _walk_files(root))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", required=True, choices=("0.6b", "1.7b"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--int8-dir")
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    from huggingface_hub import snapshot_download
    snap = snapshot_download(f"jiangzhuo9357/qwen3-tts-{args.size}-onnx")
    variants = ["fp32", "bf16"] + (["int8"] if args.int8_dir else [])
    for v in variants:
        name = f"qwen3-tts-{args.size}-onnx-{v}"
        out_dir = os.path.join(args.out, name)
        shutil.rmtree(out_dir, ignore_errors=True)
        build_tree(snap, out_dir, v, int8_dir=args.int8_dir)
        print(f"{name}: {tree_bytes(out_dir):,} bytes")
        if args.upload:
            from huggingface_hub import HfApi
            api = HfApi()
            repo = f"jiangzhuo9357/{name}"
            api.create_repo(repo, exist_ok=True)
            api.upload_folder(folder_path=out_dir, repo_id=repo)
            print(f"uploaded -> https://huggingface.co/{repo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
