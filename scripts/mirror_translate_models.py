#!/usr/bin/env python3
# scripts/mirror_translate_models.py
"""Mirror the chosen translate artifacts into the owned HF namespace.

GGUF: one repo per card-variant holding exactly one .gguf.
Opus: one repo per pair holding the 6-file Xenova export set.

Requires: `huggingface-cli login` with write access to NS.
Usage: python3 scripts/mirror_translate_models.py [--dry-run] [--only CARD_ID]

Disk-safety: each source file is downloaded into a throwaway temporary
directory (not the shared HF cache) and deleted as soon as the upload to
the destination repo completes, since the dev box does not have enough
free space to hold the full ~35 GB artifact set at once.

Resumability: before downloading an artifact, the script checks whether
the destination repo already contains a file of the same name and size
and skips re-downloading/re-uploading it if so. This lets a long real run
be safely restarted after an interruption.
"""
import argparse
import fnmatch
import os
import sys
import tempfile

from huggingface_hub import HfApi, hf_hub_download

NS = os.environ.get("SOKUJI_TRANSLATE_NS", "jiangzhuo9357")

# card_id -> {quant: (source_repo, filename_glob)}
GGUF_SOURCES = {
    "qwen2.5-0.5b": {
        "q8_0":   ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "*q8_0*.gguf"),
        "q4_k_m": ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "*q4_k_m*.gguf")},
    "qwen3-0.6b": {
        "q8_0":   ("Qwen/Qwen3-0.6B-GGUF", "*Q8_0*.gguf"),
        "q4_k_m": ("unsloth/Qwen3-0.6B-GGUF", "*Q4_K_M*.gguf")},
    "qwen3.5-0.8b": {
        "q4_k_m": ("unsloth/Qwen3.5-0.8B-GGUF", "*Q4_K_M*.gguf"),
        "q8_0":   ("unsloth/Qwen3.5-0.8B-GGUF", "*Q8_0*.gguf")},
    "qwen3.5-2b": {
        "q4_k_m": ("unsloth/Qwen3.5-2B-GGUF", "*Q4_K_M*.gguf"),
        "q8_0":   ("unsloth/Qwen3.5-2B-GGUF", "*Q8_0*.gguf")},
    "translategemma-4b": {
        # NOTE: this repo also ships `translategemma-4b-it.mmproj-Q8_0.gguf`
        # (a multimodal projector shard), which a bare `*Q8_0*.gguf` glob
        # also matches -> 2 hits -> ERROR. Anchor on the exact base filename
        # (no "mmproj-" infix) to select only the main-weights shard.
        "q4_k_m": ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q4_K_M.gguf"),
        "q8_0":   ("mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q8_0.gguf")},
    "hy-mt2-1.8b": {
        "q4_k_m": ("tencent/Hy-MT2-1.8B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/Hy-MT2-1.8B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt2-7b": {
        "q4_k_m": ("tencent/Hy-MT2-7B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/Hy-MT2-7B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt15-1.8b": {
        "q4_k_m": ("tencent/HY-MT1.5-1.8B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/HY-MT1.5-1.8B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt15-7b": {
        "q4_k_m": ("tencent/HY-MT1.5-7B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/HY-MT1.5-7B-GGUF", "*[Qq]8_0*.gguf")},
}

OPUS_PAIRS = ["ru-en", "zh-en", "en-zh", "hu-en", "en-es", "en-ar", "en-ru",
              "es-en", "en-vi", "ar-en", "ja-en", "en-jap", "ko-en"]
OPUS_FILES = ["config.json", "generation_config.json", "tokenizer.json",
              "tokenizer_config.json", "onnx/encoder_model_quantized.onnx",
              "onnx/decoder_model_merged_quantized.onnx"]


def pick_gguf(api, repo, glob):
    hits = [f for f in api.list_repo_files(repo)
            if f.endswith(".gguf") and fnmatch.fnmatch(f.lower(), glob.lower())]
    if len(hits) != 1:
        sys.exit(f"ERROR: {repo} glob {glob} matched {hits}")
    return hits[0]


def remote_size(api, repo, path):
    """Return the byte size of `path` in `repo`, or None if it doesn't exist
    (repo missing, path missing, or any other lookup failure)."""
    try:
        infos = api.get_paths_info(repo, [path])
    except Exception:
        return None
    if not infos:
        return None
    return getattr(infos[0], "size", None)


def already_mirrored(api, src, dst, fname):
    """True if `dst/fname` already exists with the same size as `src/fname`."""
    src_size = remote_size(api, src, fname)
    dst_size = remote_size(api, dst, fname)
    if src_size is None or dst_size is None:
        return False, None
    return src_size == dst_size, dst_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only")
    args = ap.parse_args()
    api = HfApi()
    sizes = {}
    for card, quants in GGUF_SOURCES.items():
        if args.only and card != args.only:
            continue
        for quant, (src, glob) in quants.items():
            fname = pick_gguf(api, src, glob)
            dst = f"{NS}/sokuji-translate-{card}-{quant}"
            print(f"{dst}  <-  {src}/{fname}")
            if not args.dry_run:
                skip, existing_size = already_mirrored(api, src, dst, fname)
                if skip:
                    print(f"  skip (already mirrored, {existing_size} bytes)")
                    sizes[(card, quant)] = existing_size
                    continue
                api.create_repo(dst, exist_ok=True, private=False)
                with tempfile.TemporaryDirectory() as td:
                    local = hf_hub_download(src, fname, local_dir=td)
                    api.upload_file(path_or_fileobj=local, path_in_repo=fname, repo_id=dst)
                    sizes[(card, quant)] = os.path.getsize(local)
    for pair in OPUS_PAIRS:
        card = f"opus-mt-{pair}"
        if args.only and card != args.only:
            continue
        src = f"Xenova/opus-mt-{pair}"
        dst = f"{NS}/sokuji-translate-{card}"
        print(f"{dst}  <-  {src} ({len(OPUS_FILES)} files)")
        if not args.dry_run:
            api.create_repo(dst, exist_ok=True, private=False)
            total = 0
            for f in OPUS_FILES:
                skip, existing_size = already_mirrored(api, src, dst, f)
                if skip:
                    print(f"  {f}: skip (already mirrored, {existing_size} bytes)")
                    total += existing_size
                    continue
                with tempfile.TemporaryDirectory() as td:
                    local = hf_hub_download(src, f, local_dir=td)
                    api.upload_file(path_or_fileobj=local, path_in_repo=f, repo_id=dst)
                    total += os.path.getsize(local)
            sizes[(card, "int8")] = total
    print("\n# exact sizes for catalog.py:")
    for (card, quant), n in sorted(sizes.items()):
        print(f"#   {card} {quant}: {n}")


if __name__ == "__main__":
    main()
