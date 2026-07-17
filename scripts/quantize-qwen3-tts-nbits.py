#!/usr/bin/env python3
"""Weight-only int4/int8 (MatMulNBits) quantization for Qwen3-TTS ONNX graphs.

The AR loop is weight-bandwidth-bound (code_predictor's 440MB fp32 is re-read
15x per generated frame; the talker's 1.78GB once per frame). fp16 halves the
traffic but Qwen3's activation-outlier channels overflow fp16's range inside
the residual stream (observed: code_predictor layer-2 down_proj output row
>65504 on real inputs), so we quantize WEIGHTS only: MatMulNBits keeps all
activations fp32 — no range hazard — while cutting weight reads 4-8x. The
CUDA EP ships MatMulNBits kernels (the onnxruntime-genai LLM path).

Usage:
  .venv/bin/python scripts/quantize-qwen3-tts-nbits.py --size 0.6b \
      --graphs code_predictor,talker_decode --bits 4 --out /tmp/stage
Stages a complete model dir: quantized graphs + originals for the rest.
"""
import argparse
import os
import shutil
import tempfile

GRAPHS_ALL = ["talker_decode.onnx", "code_predictor.onnx", "code_predictor_embed.onnx",
              "codec_embed.onnx", "text_project.onnx", "speaker_encoder.onnx",
              "tokenizer12hz_encode.onnx", "tokenizer12hz_decode.onnx"]
ROOT_FILES = ["config.json", "vocab.json", "merges.txt", "tokenizer_config.json"]
REPOS = {"0.6b": "jiangzhuo9357/qwen3-tts-0.6b-onnx",
         "1.7b": "jiangzhuo9357/qwen3-tts-1.7b-onnx"}
EXTERNAL_DATA_THRESHOLD = 1_900_000_000


def quantize_one(src_path: str, dst_path: str, bits: int, block_size: int) -> None:
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import (
        DefaultWeightOnlyQuantConfig,
        MatMulNBitsQuantizer,
    )

    # onnx's external-data loader refuses tensors backed by a symlink ("... but
    # it is a symbolic link") or by a file with >1 hard link ("... indicating a
    # potential hardlink attack") — and a HF-cache snapshot path is exactly
    # that (snapshots/<sha>/onnx/*.onnx is a symlink into blobs/, and blobs/
    # entries are shared across every ref that pins that content hash). Only
    # graphs with a .data companion (talker_decode on 1.7b) hit this; stage a
    # real, independent copy first and load from there.
    stage_dir = None
    load_path = src_path
    data_src = src_path + ".data"
    if os.path.exists(data_src):
        stage_dir = tempfile.mkdtemp(prefix="q3nbits-stage-")
        load_path = os.path.join(stage_dir, os.path.basename(src_path))
        shutil.copyfile(os.path.realpath(src_path), load_path)
        shutil.copyfile(os.path.realpath(data_src), load_path + ".data")
    try:
        model = onnx.load(load_path)
    finally:
        if stage_dir:
            shutil.rmtree(stage_dir, ignore_errors=True)
    cfg = DefaultWeightOnlyQuantConfig(block_size=block_size, is_symmetric=True, bits=bits)
    quantizer = MatMulNBitsQuantizer(model, algo_config=cfg)
    quantizer.process()
    qmodel = quantizer.model.model if hasattr(quantizer.model, "model") else quantizer.model
    total = sum(len(t.raw_data) for t in qmodel.graph.initializer)
    if total > EXTERNAL_DATA_THRESHOLD:
        onnx.save(qmodel, dst_path, save_as_external_data=True,
                  all_tensors_to_one_file=True,
                  location=os.path.basename(dst_path) + ".data")
    else:
        onnx.save(qmodel, dst_path)
    print(f"  {os.path.basename(src_path)}: {os.path.getsize(src_path):,} → "
          f"{os.path.getsize(dst_path):,} bytes (int{bits}, block {block_size})", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", choices=("0.6b", "1.7b"), required=True)
    ap.add_argument("--graphs", default="code_predictor",
                    help="comma list without .onnx, e.g. code_predictor,talker_decode")
    ap.add_argument("--bits", type=int, choices=(4, 8), default=4)
    ap.add_argument("--block-size", type=int, default=32)
    ap.add_argument("--src", help="source snapshot dir (default: cached HF snapshot)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = args.src
    if not src:
        from huggingface_hub import snapshot_download
        src = snapshot_download(REPOS[args.size], local_files_only=True)

    targets = {g.strip() + ".onnx" for g in args.graphs.split(",")}
    root = os.path.join(args.out, args.size)
    onnx_dir = os.path.join(root, "onnx")
    os.makedirs(onnx_dir, exist_ok=True)

    for name in GRAPHS_ALL:
        # Keep the snapshot (symlink) path around: the external-data companion
        # (e.g. talker_decode.onnx.data) only sits next to the .onnx file under
        # its friendly name in snapshots/, not in blobs/ (hash-named files
        # only), so companion detection (src_link + ".data") needs the symlink
        # path. Hardlinking, however, needs the *real* target: os.link() on a
        # symlink links the symlink inode itself, so the copy in --out would
        # carry over the same "../../../blobs/<hash>" relative target string —
        # which resolves to nothing outside the HF cache tree.
        src_link = os.path.join(src, "onnx", name)
        src_real = os.path.realpath(src_link)
        dst_graph = os.path.join(onnx_dir, name)
        if os.path.exists(dst_graph):
            continue
        if name in targets:
            print(f"quantizing {name} → int{args.bits}", flush=True)
            quantize_one(src_link, dst_graph, args.bits, args.block_size)
            # external-data companions of the source must not be needed anymore
        else:
            try:
                os.link(src_real, dst_graph)
            except OSError:
                shutil.copyfile(src_real, dst_graph)
            data_link = src_link + ".data"
            if os.path.exists(data_link):
                data_real = os.path.realpath(data_link)
                try:
                    os.link(data_real, dst_graph + ".data")
                except OSError:
                    shutil.copyfile(data_real, dst_graph + ".data")

    for name in ROOT_FILES:
        dst = os.path.join(root, name)
        if not os.path.exists(dst):
            shutil.copyfile(os.path.realpath(os.path.join(src, name)), dst)
    voices_dst = os.path.join(root, "voices")
    if not os.path.isdir(voices_dst):
        shutil.copytree(os.path.join(src, "voices"), voices_dst)

    total = sum(os.path.getsize(os.path.join(dp, f))
                for dp, _, fs in os.walk(root) for f in fs)
    print(f"{args.size}: staged {total:,} bytes → {root}", flush=True)


if __name__ == "__main__":
    main()
