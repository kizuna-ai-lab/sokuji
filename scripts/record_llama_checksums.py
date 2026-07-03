#!/usr/bin/env python3
# scripts/record_llama_checksums.py
"""Record sha256 for every llama.app bucket / GitHub release asset we may
download, printed as the ASSET_SHA256 dict body for llama_runtime.py.

Run on a dev box with network access; paste the output into
sidecar/sokuji_sidecar/llama_runtime.py. Unknown configs 404 and are skipped.
"""
import hashlib
import sys
import urllib.request

VERSION = "b9835"
BUCKET = f"https://huggingface.co/buckets/ggml-org/install.sh/resolve/{VERSION}"
GH = f"https://github.com/ggml-org/llama.cpp/releases/download/{VERSION}"

CUDA_SMS = ["61", "70", "75", "80", "86", "89", "90", "100", "110", "120"]
METAL = ["m1", "m2", "m3", "m4", "m5"]

CANDIDATES = (
    [f"x86_64/linux/cuda/probe/probe.zst"]
    + [f"x86_64/linux/cuda/{sm}/llama-app.zst" for sm in CUDA_SMS]
    + [f"x86_64/linux/featcode"]
    + [f"aarch64/macos/metal/{m}/llama-app.zst" for m in METAL]
)
GH_ASSETS = [f"llama-{VERSION}-bin-win-cuda-12.4-x64.zip",
             f"cudart-llama-bin-win-cuda-12.4-x64.zip",
             f"llama-{VERSION}-bin-win-cpu-x64.zip"]


def sha(url):
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=600) as r:
        while chunk := r.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def main():
    print("ASSET_SHA256 = {")
    for rel in CANDIDATES:
        try:
            print(f'    "{rel}": "{sha(f"{BUCKET}/{rel}")}",')
        except Exception as e:
            print(f"  skip {rel}: {e}", file=sys.stderr)
    for asset in GH_ASSETS:
        try:
            print(f'    "{asset}": "{sha(f"{GH}/{asset}")}",')
        except Exception as e:
            print(f"  skip {asset}: {e}", file=sys.stderr)
    print("}")
    print("# NOTE: linux cpu configs are featcode-keyed; run ensure_binary('cpu')",
          "on target machines or extend CANDIDATES when configs are known.")


if __name__ == "__main__":
    main()
