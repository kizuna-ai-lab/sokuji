#!/usr/bin/env python3
"""
Extract Emscripten loadPackage metadata from each ASR model's glue JS
and save as package-metadata.json alongside the .data file.

This metadata tells the Emscripten runtime how to unpack the .data file
into the virtual filesystem (filenames, byte offsets, sizes).

Handles both offline ASR (sherpa-onnx-wasm-main-vad-asr.js) and
streaming ASR (sherpa-onnx-wasm-main-asr.js) models.

Usage:
  python3 scripts/extract-asr-metadata.py [model-packs/asr/wasm-*]

If no arguments given, processes all wasm-* dirs under model-packs/asr/.
"""

import json
import re
import sys
import glob
import os


def extract_metadata(glue_js_path: str) -> dict | None:
    """Extract the loadPackage({...}) JSON from an Emscripten glue JS file."""
    with open(glue_js_path) as f:
        content = f.read()

    match = re.search(
        r'loadPackage\((\{"files":\[.*?\],\s*"remote_package_size":\s*\d+\})\)',
        content,
    )
    if not match:
        return None

    return json.loads(match.group(1))


def main():
    if len(sys.argv) > 1:
        dirs = sys.argv[1:]
    else:
        dirs = sorted(glob.glob("model-packs/asr/wasm-*/"))

    processed = 0
    skipped = 0
    errors = 0

    for d in dirs:
        d = d.rstrip("/")

        # Try offline glue JS first, then streaming
        glue_js = os.path.join(d, "sherpa-onnx-wasm-main-vad-asr.js")
        model_type = "offline"
        if not os.path.exists(glue_js):
            glue_js = os.path.join(d, "sherpa-onnx-wasm-main-asr.js")
            model_type = "streaming"

        out_json = os.path.join(d, "package-metadata.json")

        if not os.path.exists(glue_js):
            print(f"  SKIP {d}: no glue JS found")
            skipped += 1
            continue

        metadata = extract_metadata(glue_js)
        if metadata is None:
            print(f"  ERROR {d}: could not extract metadata")
            errors += 1
            continue

        with open(out_json, "w") as f:
            json.dump(metadata, f, separators=(",", ":"))

        size_kb = os.path.getsize(out_json) / 1024
        print(f"  OK {d} ({model_type}): {len(metadata['files'])} files, {size_kb:.1f} KB")
        processed += 1

    print(f"\nDone: {processed} extracted, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()
