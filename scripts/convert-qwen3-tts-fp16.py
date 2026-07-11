#!/usr/bin/env python3
"""Convert the Qwen3-TTS ONNX HOT graphs to fp16 for the CUDA lane.

Reads a cached fp32 snapshot (jiangzhuo9357/qwen3-tts-{size}-onnx), converts
the per-frame HOT graphs with onnxruntime's maintained float16 converter
(onnxruntime.transformers.float16 — the fixed fork of onnxconverter-common),
and stages a complete model dir (fp16 HOT graphs + fp32 COLD graphs + configs
+ voices) suitable for local testing or HF upload.

fp16 halves the weight-read bandwidth that dominates the AR loop
(talker_decode 1.78GB and code_predictor 0.44GB are re-read every frame) and
halves the device-resident KV cache. COLD graphs (text_project,
speaker_encoder, tokenizer12hz_encode) run once per utterance/voice on CPU
where fp32 is faster — they stay fp32.

Graphs >2GB after conversion (the 1.7B talker) are saved in external-data
format; reading >2GB protos needs the pure-python protobuf impl, so run with
PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python if the default C impl balks.

Usage:
  .venv/bin/python scripts/convert-qwen3-tts-fp16.py --size 0.6b --out /tmp/qwen3-fp16
  (--keep-codec-fp32 leaves tokenizer12hz_decode at fp32 for quality A/B)
"""
import argparse
import os
import shutil

HOT_FP16 = ["talker_decode.onnx", "code_predictor.onnx", "code_predictor_embed.onnx",
            "codec_embed.onnx"]
CODEC_DECODE = "tokenizer12hz_decode.onnx"
COPY_FP32 = ["text_project.onnx", "speaker_encoder.onnx", "tokenizer12hz_encode.onnx"]
ROOT_FILES = ["config.json", "vocab.json", "merges.txt", "tokenizer_config.json"]

REPOS = {"0.6b": "jiangzhuo9357/qwen3-tts-0.6b-onnx",
         "1.7b": "jiangzhuo9357/qwen3-tts-1.7b-onnx"}

# protobuf hard limit is 2GB; leave headroom for the graph proto itself.
EXTERNAL_DATA_THRESHOLD = 1_900_000_000


def trig_ancestor_block_list(src_path: str) -> list[str]:
    """Node names that must stay fp32: every Sin/Cos node plus its ancestor
    closure. Qwen3 uses rope_theta=1e6, so the RoPE inverse frequencies
    (~1e-6) underflow fp16's 6e-5 normal range — converting the angle
    computation garbles every position and the model degenerates to babble
    with no EOS (observed on the first full-fp16 export). The closure is
    shape/position math that runs once per step on tiny tensors; keeping it
    fp32 costs nothing. Sin/Cos outputs are bounded [-1, 1] and are cast to
    fp16 at the boundary by the converter."""
    import onnx

    model = onnx.load(src_path, load_external_data=False)
    producers = {o: n for n in model.graph.node for o in n.output}
    trig = [n for n in model.graph.node if n.op_type in ("Sin", "Cos")]
    block = {n.name for n in trig}
    seen: set[str] = set()
    frontier = [i for n in trig for i in n.input]
    while frontier:
        tensor = frontier.pop()
        if tensor in seen:
            continue
        seen.add(tensor)
        node = producers.get(tensor)
        if node is not None and node.name not in block:
            block.add(node.name)
            frontier.extend(node.input)
    return sorted(block)


def convert_one(src_path: str, dst_path: str) -> bool:
    """Convert one graph to fp16; returns False (caller copies fp32) when the
    trig-protection closure covers most of the graph — e.g. the codec vocoder,
    whose harmonic-synthesis math IS a giant Sin/Cos chain: 'converting' it
    would keep everything fp32 behind casts and only add overhead."""
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16

    model_probe = onnx.load(src_path, load_external_data=False)
    node_count = len(model_probe.graph.node)
    block_list = trig_ancestor_block_list(src_path)
    if node_count and len(block_list) > node_count // 3:
        print(f"  {len(block_list)}/{node_count} nodes in Sin/Cos chains — keeping fp32", flush=True)
        return False
    if block_list:
        print(f"  keeping {len(block_list)} Sin/Cos-chain nodes fp32", flush=True)
    # Path input → converter uses infer_shapes_path (safe for >2GB models).
    model = convert_float_to_float16(src_path, keep_io_types=False,
                                     node_block_list=block_list or None)
    fp16_bytes = sum(len(t.raw_data) for t in model.graph.initializer)
    if fp16_bytes > EXTERNAL_DATA_THRESHOLD:
        data_name = os.path.basename(dst_path) + ".data"
        onnx.save(model, dst_path, save_as_external_data=True,
                  all_tensors_to_one_file=True, location=data_name)
    else:
        onnx.save(model, dst_path)
    print(f"  {os.path.basename(src_path)}: {os.path.getsize(src_path):,} → "
          f"{os.path.getsize(dst_path):,} bytes", flush=True)
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", choices=("0.6b", "1.7b"), required=True)
    ap.add_argument("--src", help="fp32 snapshot dir (default: cached HF snapshot)")
    ap.add_argument("--out", required=True, help="staging root; model goes to <out>/<size>")
    ap.add_argument("--keep-codec-fp32", action="store_true",
                    help="leave tokenizer12hz_decode at fp32 (codec quality A/B)")
    args = ap.parse_args()

    src = args.src
    if not src:
        from huggingface_hub import snapshot_download
        src = snapshot_download(REPOS[args.size], local_files_only=True)

    root = os.path.join(args.out, args.size)
    onnx_dir = os.path.join(root, "onnx")
    os.makedirs(onnx_dir, exist_ok=True)

    for name in HOT_FP16 + ([] if args.keep_codec_fp32 else [CODEC_DECODE]):
        print(f"converting {name} → fp16", flush=True)
        src_graph = os.path.join(src, "onnx", name)
        dst_graph = os.path.join(onnx_dir, name)
        if not convert_one(src_graph, dst_graph):
            shutil.copyfile(os.path.realpath(src_graph), dst_graph)

    for name in COPY_FP32 + ([CODEC_DECODE] if args.keep_codec_fp32 else []):
        dst = os.path.join(onnx_dir, name)
        if not os.path.exists(dst):
            shutil.copyfile(os.path.realpath(os.path.join(src, "onnx", name)), dst)

    for name in ROOT_FILES:
        shutil.copyfile(os.path.realpath(os.path.join(src, name)),
                        os.path.join(root, name))
    voices_src = os.path.join(src, "voices")
    voices_dst = os.path.join(root, "voices")
    if os.path.isdir(voices_src) and not os.path.isdir(voices_dst):
        shutil.copytree(voices_src, voices_dst)

    total = sum(os.path.getsize(os.path.join(dp, f))
                for dp, _, fs in os.walk(root) for f in fs)
    print(f"{args.size}: staged {total:,} bytes → {root}", flush=True)


if __name__ == "__main__":
    main()
