#!/usr/bin/env python3
"""Repack zukky/Qwen3-TTS-ONNX-DLL into two per-size Sokuji repos.
Downloads the needed subset, stages a flat layout, prints total bytes,
and (only with --upload) pushes via huggingface_hub. Apache-2.0 attribution
is written into the staged README.

Staging uses hardlinks (os.link) instead of copies: the HF hub cache and the
staging root live on the same filesystem, and with ~11-12 GB to stage per run
there isn't enough free disk to also hold duplicate copies. Same pattern as
MossOnnxTtsBackend._link_tree in sidecar/sokuji_sidecar/tts_backends.py.
os.path.realpath is required because HF cache snapshot paths are symlinks
into the blob store; linking the symlink itself would just fail or link the
symlink file rather than the blob.
"""
import argparse
import os
import shutil

from huggingface_hub import HfApi, hf_hub_download

SRC = "zukky/Qwen3-TTS-ONNX-DLL"
GRAPHS = ["talker_decode.onnx", "code_predictor.onnx", "code_predictor_embed.onnx",
          "codec_embed.onnx", "text_project.onnx", "speaker_encoder.onnx",
          "tokenizer12hz_encode.onnx", "tokenizer12hz_decode.onnx"]
TOK = ["config.json", "vocab.json", "merges.txt", "tokenizer_config.json"]
SIZES = {"0.6b": ("onnx_kv_06b", "Qwen3-TTS-12Hz-0.6B-Base", "jiangzhuo9357/qwen3-tts-0.6b-onnx"),
         "1.7b": ("onnx_kv",     "Qwen3-TTS-12Hz-1.7B-Base", "jiangzhuo9357/qwen3-tts-1.7b-onnx")}
README = """---\nlicense: apache-2.0\n---\n# Qwen3-TTS {size} Base — ONNX (fp32) for Sokuji\n
Repacked from [zukky/Qwen3-TTS-ONNX-DLL](https://huggingface.co/zukky/Qwen3-TTS-ONNX-DLL)
(itself exported from [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)). Apache-2.0.\n"""


def _link(src, dst):
    """Hardlink src (resolved through any symlink) to dst; copy across filesystems.
    Skips existing dst so re-runs are idempotent (re-copying onto a hardlink of the
    same blob would raise SameFileError)."""
    if os.path.exists(dst):
        return
    real_src = os.path.realpath(src)
    try:
        os.link(real_src, dst)
    except OSError:
        shutil.copyfile(real_src, dst)


def stage(size, keep_prefill, out_root):
    subdir, model_dir, dst_repo = SIZES[size]
    graphs = GRAPHS + (["talker_prefill.onnx"] if keep_prefill else [])
    root = os.path.join(out_root, size); os.makedirs(os.path.join(root, "onnx"), exist_ok=True)
    total = 0
    for g in graphs:
        p = hf_hub_download(SRC, f"{subdir}/{g}")
        q = os.path.join(root, "onnx", g); _link(p, q); total += os.path.getsize(q)
    for t in TOK:
        p = hf_hub_download(SRC, f"models/{model_dir}/{t}")
        q = os.path.join(root, t); _link(p, q); total += os.path.getsize(q)
    with open(os.path.join(root, "README.md"), "w") as fh: fh.write(README.format(size=size))
    print(f"{size}: staged {total:,} bytes → {root}  (dst {dst_repo})")
    return root, dst_repo, total


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", nargs="+", default=["0.6b", "1.7b"], choices=list(SIZES))
    ap.add_argument("--keep-prefill", action="store_true", help="spike said PREFILL_DROPPABLE: no")
    ap.add_argument("--out", default=os.path.expanduser("~/qwen3-tts-repack"))
    ap.add_argument("--upload", action="store_true", help="actually push to HF (requires consent)")
    a = ap.parse_args()
    api = HfApi()
    for s in a.sizes:
        root, dst, total = stage(s, a.keep_prefill, a.out)
        if a.upload:
            api.create_repo(dst, repo_type="model", exist_ok=True)
            api.upload_folder(folder_path=root, repo_id=dst, repo_type="model")
            print(f"uploaded {dst} ({total:,} bytes)")
