# scripts/reexport-omnivoice/reexport.py
"""Orchestrates the full OmniVoice ONNX re-export and assembles the THREE
self-contained per-variant repos Sokuji ships (see catalog.py's omnivoice card):

  <out>/bf16/  - bf16 llm_decoder + bf16 audio_embeddings (DEFAULT variant)
  <out>/fp32/  - un-quantized reference (fp32 everything)
  <out>/int4/  - 4-bit llm_decoder weights + bf16 audio_embeddings

Each variant dir is a complete repo layout: backbone graphs + tokenizer at the
ROOT, plus the shared Higgs `audio_tokenizer/` graphs (fp32). The curated
`voices/` presets are added at publish time (they live outside this toolchain).

There is deliberately NO fp16 variant: a naive fp16 conversion emits an
all-zero llm output on the onnxruntime CUDA EP (deep-layer RMSNorm x^2
overflows fp16's 65504 range). bf16 has fp32's exponent range and no such
overflow; it is converted with `scripts/convert-qwen3-tts-bf16.py` after the
ORT fp32 optimizer fuses RMSNorm -> SimplifiedLayerNormalization, blocking the
primitives that stay decomposed (per-head q_norm/k_norm) or lack a bf16 CUDA
kernel in ORT 1.24 (Reciprocal/Cos/Sin/ReduceMean).

Run directly (`python reexport.py ...`) — Python auto-adds this file's own
directory (scripts/reexport-omnivoice/) to sys.path, so `exporters` (and, via
exporters.py, `codes.model_wrappers`) resolve from the committed vendored
sources here. No dependency on the gitignored .spike/ scratch tree.
"""
import argparse
import glob
import importlib.util
import json
import os
import shutil

from exporters import load_model, export_llm, export_audio_embeddings, export_audio_heads, export_higgs, quantize_llm

_TOK_FILES = ("tokenizer.json", "tokenizer_config.json", "config.json", "chat_template.jinja")
# Ops kept fp32 in the bf16 llm: RMSNorm primitives that stay decomposed after
# the ORT optimizer (Qwen3's per-head q_norm/k_norm) or have no bf16 CUDA
# kernel in ORT 1.24.
_BF16_OP_BLOCK = ["ReduceMean", "Cos", "Sin", "Reciprocal"]


def _load_bf16_converter():
    """Import scripts/convert-qwen3-tts-bf16.py (hyphenated filename) — the
    proven Qwen3-family fp32->bf16 converter this repo already ships."""
    path = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "convert-qwen3-tts-bf16.py"))
    spec = importlib.util.spec_from_file_location("bf16conv", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _bf16_llm(fp32_llm_path, dst_path, bf16conv):
    """Pre-optimize the fp32 llm (fusions fire in fp32; the optimized model is
    written next to the source so its external-data refs resolve), then
    bf16-convert and save single-file (<2GB — sidesteps external-data bloat
    and the sbsa symlinked-.data rejection)."""
    import onnx
    import onnxruntime as ort
    try:
        ort.preload_dlls()
    except Exception:
        pass  # CPU-only install: optimizer still runs on the CPU EP
    src_dir = os.path.dirname(fp32_llm_path)
    optp = os.path.join(src_dir, "_opt_fp32.onnx")
    so = ort.SessionOptions()
    so.log_severity_level = 3
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.optimized_model_filepath = optp
    so.add_session_config_entry(
        "session.optimized_model_external_initializers_file_name", "_opt_fp32.onnx.data")
    so.add_session_config_entry(
        "session.optimized_model_external_initializers_min_size_in_bytes", "1024")
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                 if p in ort.get_available_providers()]
    ort.InferenceSession(fp32_llm_path, so, providers=providers)
    try:
        model = onnx.load(optp)
        model, _stats = bf16conv.convert(model, op_block_list=_BF16_OP_BLOCK)
        onnx.save(model, dst_path)   # single-file, no external data
    finally:
        for p in [optp] + glob.glob(optp + ".data"):
            try:
                os.remove(p)
            except OSError:
                pass  # best-effort scratch cleanup


def _bf16_simple(fp32_path, dst_path, bf16conv):
    """bf16-convert a small flat graph (audio_embeddings: Gather lookups —
    verified lossless, embeds cosine 1.000) with no blocking, single-file."""
    import onnx
    model = onnx.load(fp32_path)
    model, _stats = bf16conv.convert(model, op_block_list=[], node_block_prefixes=[])
    onnx.save(model, dst_path)


def _copy_backbone_extras(fp32_dir, dst, src_model_dir):
    """fp32 audio_heads (+ external data) and the tokenizer/config files —
    identical across all variants."""
    for f in ("audio_heads_decoder.onnx", "audio_heads_decoder.onnx.data"):
        shutil.copy(os.path.join(fp32_dir, f), os.path.join(dst, f))
    for f in _TOK_FILES:
        p = os.path.join(src_model_dir, f)
        if os.path.exists(p):
            shutil.copy(p, os.path.join(dst, f))


def _write_manifest(variant_dir, variant):
    manifest = {"source": "k2-fsa/OmniVoice", "license": "CC-BY-NC-4.0",
                "variant": variant, "higgs": "audio_tokenizer", "sample_rate": 24000,
                "note": "self-contained bidirectional re-export; run with plain onnxruntime. "
                        "No fp16 variant: naive fp16 is CUDA-broken (RMSNorm x^2 overflow)."}
    with open(os.path.join(variant_dir, "omnivoice_onnx_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".spike/models/omnivoice_pt")
    ap.add_argument("--out", default="./out")
    args = ap.parse_args()

    bf16conv = _load_bf16_converter()
    m = load_model(args.src)

    # 1) fp32 base export (llm + embeddings + heads) -> IS the fp32/ variant
    fp32_dir = os.path.join(args.out, "fp32")
    os.makedirs(fp32_dir, exist_ok=True)
    export_llm(m, fp32_dir, "fp32")
    export_audio_embeddings(m, fp32_dir)
    export_audio_heads(m, fp32_dir)
    for f in _TOK_FILES:
        p = os.path.join(args.src, f)
        if os.path.exists(p):
            shutil.copy(p, os.path.join(fp32_dir, f))

    fp32_llm = os.path.join(fp32_dir, "llm_decoder.onnx")
    fp32_emb = os.path.join(fp32_dir, "audio_embeddings_encoder.onnx")

    # 2) bf16/ — DEFAULT variant: bf16 llm + bf16 embeddings + fp32 heads
    bf16_dir = os.path.join(args.out, "bf16")
    os.makedirs(bf16_dir, exist_ok=True)
    _bf16_llm(fp32_llm, os.path.join(bf16_dir, "llm_decoder.onnx"), bf16conv)
    _bf16_simple(fp32_emb, os.path.join(bf16_dir, "audio_embeddings_encoder.onnx"), bf16conv)
    _copy_backbone_extras(fp32_dir, bf16_dir, args.src)

    # 3) int4/ — smallest: 4-bit llm weights + bf16 embeddings + fp32 heads
    int4_dir = os.path.join(args.out, "int4")
    os.makedirs(int4_dir, exist_ok=True)
    quantize_llm(fp32_llm, int4_dir, "int4")
    shutil.copy(os.path.join(bf16_dir, "audio_embeddings_encoder.onnx"),
                os.path.join(int4_dir, "audio_embeddings_encoder.onnx"))
    _copy_backbone_extras(fp32_dir, int4_dir, args.src)

    # 4) shared Higgs codec graphs (fp32) into EVERY variant (self-contained
    # repos: each downloads alone), plus a per-variant manifest.
    higgs_scratch = os.path.join(args.out, "_higgs")
    export_higgs(args.src, higgs_scratch)
    for d in (bf16_dir, fp32_dir, int4_dir):
        dst = os.path.join(d, "audio_tokenizer")
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(os.path.join(higgs_scratch, "audio_tokenizer"), dst)
        _write_manifest(d, os.path.basename(d))
    shutil.rmtree(higgs_scratch, ignore_errors=True)
    print("assembled per-variant repos under", args.out)


if __name__ == "__main__":
    main()
