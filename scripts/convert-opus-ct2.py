#!/usr/bin/env python3
"""Convert the 13 Helsinki-NLP opus-mt pairs used by the native sidecar to
CTranslate2 int8. Run inside a venv that has ctranslate2 + transformers +
torch (CPU build is fine). The sidecar runtime never imports these.

Output layout mirrors gaudi/opus-mt-*-ctranslate2 (config.json, model.bin,
shared_vocabulary.json, source.spm, target.spm) so the runtime treats our
repos and gaudi's identically.

Usage:
  python scripts/convert-opus-ct2.py [pair ...]      # default: all 13
"""
import shutil
import subprocess
import sys
from pathlib import Path

PAIRS = ["ru-en", "zh-en", "en-zh", "hu-en", "en-es", "en-ar", "en-ru",
         "es-en", "en-vi", "ar-en", "ja-en", "en-jap", "ko-en"]
OUT_ROOT = Path(__file__).resolve().parent.parent / "model-packs" / "opus-ct2"

def convert(pair: str) -> None:
    src_repo = f"Helsinki-NLP/opus-mt-{pair}"
    out_dir = OUT_ROOT / f"opus-mt-{pair}-ct2"
    if (out_dir / "model.bin").exists():
        print(f"[skip] {pair} already converted")
        return
    shutil.rmtree(out_dir, ignore_errors=True)
    subprocess.run(
        ["ct2-transformers-converter", "--model", src_repo,
         "--output_dir", str(out_dir), "--quantization", "int8",
         "--copy_files", "source.spm", "target.spm"],
        check=True)
    have = {p.name for p in out_dir.iterdir()}
    need = {"config.json", "model.bin", "shared_vocabulary.json",
            "source.spm", "target.spm"}
    missing = need - have
    if missing:
        raise SystemExit(f"{pair}: converter output missing {missing}")
    print(f"[ok] {pair} -> {out_dir}")

if __name__ == "__main__":
    for pair in (sys.argv[1:] or PAIRS):
        convert(pair)
