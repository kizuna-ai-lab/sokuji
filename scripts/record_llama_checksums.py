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

VERSION = "b9940"
BUCKET = f"https://huggingface.co/buckets/ggml-org/install.sh/resolve/{VERSION}"
GH = f"https://github.com/ggml-org/llama.cpp/releases/download/{VERSION}"

# 121 (GB10 / DGX Spark) exists since the llama-install.sh #60 fix — the
# b9940+ buckets ship it for both arches.
CUDA_SMS = ["61", "70", "75", "80", "86", "89", "90", "100", "110", "120", "121"]
METAL = ["m1", "m2", "m3", "m4", "m5"]

# aarch64 linux cpu configs are featcode-keyed; 'ql' is the one recorded on a
# DGX Spark (GB10). Extend as more target machines report their featcode.
ARM_CPU_CONFIGS = ["ql"]
# aarch64 cuda configs we realistically serve: GB10 (121) and Orin-class (86).
ARM_CUDA_SMS = ["86", "121"]

CANDIDATES = (
    [f"x86_64/linux/cuda/probe/probe.zst"]
    + [f"x86_64/linux/cuda/{sm}/llama-app.zst" for sm in CUDA_SMS]
    + [f"x86_64/linux/featcode"]
    + [f"aarch64/linux/cuda/probe/probe.zst"]
    + [f"aarch64/linux/cuda/{sm}/llama-app.zst" for sm in ARM_CUDA_SMS]
    + [f"aarch64/linux/featcode"]
    + [f"aarch64/linux/cpu/{c}/llama-app.zst" for c in ARM_CPU_CONFIGS]
    + [f"aarch64/macos/metal/{m}/llama-app.zst" for m in METAL]
)
GH_ASSETS = [f"llama-{VERSION}-bin-win-cuda-12.4-x64.zip",
             f"cudart-llama-bin-win-cuda-12.4-x64.zip",
             f"llama-{VERSION}-bin-win-cpu-x64.zip",
             f"llama-{VERSION}-bin-ubuntu-vulkan-x64.tar.gz",
             f"llama-{VERSION}-bin-ubuntu-vulkan-arm64.tar.gz"]


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
