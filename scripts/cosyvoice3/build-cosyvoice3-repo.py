#!/usr/bin/env python3
# Apache License 2.0
"""Assemble the Sokuji CosyVoice3 HF model repo from the ayousanz export.

Precision set (phase-1 spike verdicts, .spike/out/README.md):
  - LLM backbones: int4 MatMulNBits (RTN, block 32) — 6.4x smaller than
    fp32, same-seed token-identical CPU vs CUDA, verbatim whisper ASR.
  - Everything else fp32 (fp16 graphs NaN on CUDA and on ORT>=1.24 CPU;
    upcast via convert_fp16_to_fp32.py).

Usage (one-off venv needs: onnx onnxruntime onnx-ir huggingface_hub soundfile):
    python scripts/cosyvoice3/build-cosyvoice3-repo.py \
        --src <dir with the ayousanz snapshot> --out out/cosyvoice3-0.5b-onnx

Then upload manually (requires user approval / their HF account):
    hf upload jiangzhuo9357/cosyvoice3-0.5b-onnx out/cosyvoice3-0.5b-onnx . --repo-type model
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

CONVERT = [  # (src fp16 name, dst repo name) run through the fp32 upcaster
    ("llm_decoder_fp16.onnx", "onnx/llm_decoder.onnx"),
    ("llm_speech_embedding_fp16.onnx", "onnx/llm_speech_embedding.onnx"),
    ("flow_token_embedding_fp16.onnx", "onnx/flow_token_embedding.onnx"),
    ("flow_pre_lookahead_fp16.onnx", "onnx/flow_pre_lookahead.onnx"),
    ("flow_speaker_projection_fp16.onnx", "onnx/flow_speaker_projection.onnx"),
    ("flow.decoder.estimator.fp16.onnx", "onnx/flow_estimator.onnx"),
]
COPY = [
    ("text_embedding_fp32.onnx", "onnx/text_embedding.onnx"),
    ("speech_tokenizer_v3.onnx", "onnx/speech_tokenizer_v3.onnx"),
    ("campplus.onnx", "onnx/campplus.onnx"),
    ("hift_f0_predictor_fp32.onnx", "onnx/hift_f0_predictor.onnx"),
    ("hift_source_generator_fp32.onnx", "onnx/hift_source_generator.onnx"),
    ("hift_decoder_fp32.onnx", "onnx/hift_decoder.onnx"),
    ("vocab.json", "vocab.json"),
    ("merges.txt", "merges.txt"),
    ("tokenizer_config.json", "tokenizer_config.json"),
]
INT4 = [  # fp32-upcast first, then MatMulNBits int4
    ("llm_backbone_initial_fp16.onnx", "onnx/llm_backbone_initial_int4.onnx"),
    ("llm_backbone_decode_fp16.onnx", "onnx/llm_backbone_decode_int4.onnx"),
]
OFFICIAL_ZH_PROMPT = ("https://raw.githubusercontent.com/FunAudioLLM/"
                      "CosyVoice/main/asset/zero_shot_prompt.wav")
VOICES = [  # (name, wav source, default)
    ("classic-zh", "download:official", True),
    ("classic-ja", "asset:gpt-sovits-voices/classic-ja", False),
    ("sarah", "src:prompts/en_female_nova_greeting.wav", False),
]


def upcast(src, dst):
    subprocess.run([sys.executable, os.path.join(HERE, "convert_fp16_to_fp32.py"),
                    src, dst], check=True)


def quantize_int4(src_fp16, dst):
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    tmp = dst + ".fp32.tmp"
    upcast(src_fp16, tmp)
    m = onnx.load(tmp)
    q = MatMulNBitsQuantizer(m, block_size=32, is_symmetric=True)
    q.process()
    q.model.save_model_to_file(dst, use_external_data_format=False)
    os.remove(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="out/cosyvoice3-0.5b-onnx")
    args = ap.parse_args()
    os.makedirs(f"{args.out}/onnx", exist_ok=True)
    os.makedirs(f"{args.out}/voices", exist_ok=True)

    for s, d in COPY:
        shutil.copy2(f"{args.src}/{s}", f"{args.out}/{d}")
    for s, d in CONVERT:
        upcast(f"{args.src}/{s}", f"{args.out}/{d}")
    for s, d in INT4:
        quantize_int4(f"{args.src}/{s}", f"{args.out}/{d}")

    assets = os.path.join(HERE, "..", "assets")
    manifest = []
    for name, source, default in VOICES:
        dst_wav = f"{args.out}/voices/{name}.wav"
        if source == "download:official":
            with urllib.request.urlopen(OFFICIAL_ZH_PROMPT, timeout=30) as resp, \
                    open(dst_wav, "wb") as out_file:
                out_file.write(resp.read())
        elif source.startswith("asset:"):
            base = os.path.join(assets, source.split(":", 1)[1])
            shutil.copy2(base + ".wav", dst_wav)
            shutil.copy2(base + ".txt", f"{args.out}/voices/{name}.txt")
        elif source.startswith("src:"):
            shutil.copy2(f"{args.src}/{source.split(':', 1)[1]}", dst_wav)
        txt_src = os.path.join(HERE, "..", "assets", "cosyvoice3-voices", f"{name}.txt")
        if os.path.exists(txt_src):
            shutil.copy2(txt_src, f"{args.out}/voices/{name}.txt")
        entry = {"name": name}
        if default:
            entry["default"] = True
        manifest.append(entry)
    with open(f"{args.out}/voices/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Every voice must land with BOTH files, non-empty — fail loudly rather
    # than ship a repo where a preset voice silently 404s at runtime.
    for name, _source, _default in VOICES:
        wav_path = f"{args.out}/voices/{name}.wav"
        txt_path = f"{args.out}/voices/{name}.txt"
        for p in (wav_path, txt_path):
            if not os.path.exists(p):
                raise SystemExit(f"voice asset missing: {p}")
            if os.path.getsize(p) == 0:
                raise SystemExit(f"voice asset is empty: {p}")
    assert {e["name"] for e in manifest} == {n for n, _, _ in VOICES}
    assert sum(1 for e in manifest if e.get("default")) == 1, \
        "exactly one voice must be marked default"

    with open(f"{args.out}/README.md", "w", encoding="utf-8") as f:
        f.write(
            "---\nlicense: apache-2.0\n---\n\n"
            "# CosyVoice 3 0.5B — ONNX for Sokuji Local Native\n\n"
            "Converted from [ayousanz/cosy-voice3-onnx]"
            "(https://huggingface.co/ayousanz/cosy-voice3-onnx) (Apache-2.0),\n"
            "itself exported from [FunAudioLLM/Fun-CosyVoice3-0.5B-2512]"
            "(https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) (Apache-2.0).\n\n"
            "Conversions: LLM backbones int4 (MatMulNBits, RTN block 32);\n"
            "all other fp16 graphs upcast to fp32 (the fp16 graphs produce NaN\n"
            "on CUDA and on onnxruntime >= 1.24 CPU).\n"
            "Voice `classic-zh` is the official CosyVoice zero-shot prompt clip;\n"
            "`classic-ja` is a fully synthetic clip generated with our own TTS;\n"
            "`sarah` ships with the upstream export.\n")

    total = sum(os.path.getsize(os.path.join(r, x))
                for r, _, files in os.walk(args.out) for x in files)
    print(f"size_bytes = {total}")


if __name__ == "__main__":
    main()
