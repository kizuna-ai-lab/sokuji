# scripts/reexport-omnivoice/reexport.py
"""Orchestrates the full OmniVoice ONNX re-export: fp32 LLM export -> fp16/int4
quantization + per-variant backbone (audio embeddings/heads) export + tokenizer
copy, plus the shared Higgs Audio V2 Tokenizer (audio_tokenizer/) at the repo
root. Assembles the exact `out/` layout Plan 2's backend expects.

Run directly (`python reexport.py ...`) — Python auto-adds this file's own
directory (scripts/reexport-omnivoice/) to sys.path, so `exporters` (and, via
exporters.py, `codes.model_wrappers`) resolve from the committed vendored
sources here. No dependency on the gitignored .spike/ scratch tree.
"""
import argparse, json, os, shutil
from exporters import load_model, export_llm, export_audio_embeddings, export_audio_heads, export_higgs, quantize_llm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".spike/models/omnivoice_pt")
    ap.add_argument("--out", default="./out")
    args = ap.parse_args()

    m = load_model(args.src)
    fp32 = os.path.join(args.out, "_fp32"); os.makedirs(fp32, exist_ok=True)
    export_llm(m, fp32, "fp32")
    for mode in ("fp16", "int4"):
        d = os.path.join(args.out, mode); os.makedirs(d, exist_ok=True)
        quantize_llm(os.path.join(fp32, "llm_decoder.onnx"), d, mode)
        export_audio_embeddings(m, d)
        export_audio_heads(m, d)
        for f in ("tokenizer.json", "tokenizer_config.json", "config.json", "chat_template.jinja"):
            if os.path.exists(os.path.join(args.src, f)):
                shutil.copy(os.path.join(args.src, f), os.path.join(d, f))
    export_higgs(args.src, args.out)  # shared audio_tokenizer/ at repo root
    manifest = {"source": "k2-fsa/OmniVoice", "license": "CC-BY-NC-4.0",
                "variants": ["fp16", "int4"], "higgs": "audio_tokenizer", "sample_rate": 24000,
                "note": "bidirectional llm_decoder re-export; run with plain onnxruntime"}
    json.dump(manifest, open(os.path.join(args.out, "omnivoice_onnx_manifest.json"), "w"), indent=2)
    shutil.rmtree(fp32, ignore_errors=True)
    print("assembled", args.out)


if __name__ == "__main__":
    main()
