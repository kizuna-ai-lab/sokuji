#!/usr/bin/env python3
"""
Extract Emscripten loadPackage metadata from each TTS model's glue JS
and save as package-metadata.json alongside the .data file.

This metadata tells the Emscripten runtime how to unpack the .data file
into the virtual filesystem (filenames, byte offsets, sizes).

Usage:
  python3 scripts/extract-tts-metadata.py [model-packs/tts/wasm-*]

If no arguments given, processes all wasm-* dirs under model-packs/tts/.
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

    # Match both unpatched and patched formats:
    #   Unpatched:  loadPackage({"files":[...],"remote_package_size":N})
    #   Patched:    loadPackage(Module._dataPackageMetadata||{"files":[...],"remote_package_size":N})
    match = re.search(
        r'loadPackage\((?:Module\._dataPackageMetadata\|\|)?(\{"files":\[.*?\],\s*"remote_package_size":\s*\d+\})\)',
        content,
    )
    if not match:
        return None

    return json.loads(match.group(1))


def main():
    if len(sys.argv) > 1:
        dirs = sys.argv[1:]
    else:
        dirs = sorted(
            glob.glob("model-packs/tts/wasm-*/")
            + glob.glob("public/wasm/sherpa-onnx-tts-*/")
        )

    processed = 0
    skipped = 0
    errors = 0

    for d in dirs:
        d = d.rstrip("/")
        glue_js = os.path.join(d, "sherpa-onnx-wasm-main-tts.js")
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
        print(f"  OK {d}: {len(metadata['files'])} files, {size_kb:.1f} KB")
        processed += 1

    print(f"\nDone: {processed} extracted, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()
