#!/usr/bin/env python3
"""Stage the five Pocket TTS language bundles as uploadable flat HF model repos.

The upstream bundles live in SUBFOLDERS of the KevinAHM/pocket-tts-web SPACE
(repo_type="space") — a shape the sidecar's download path deliberately does not
speak (native_models.py assumes model repos with files at the root). This
script downloads each Space subfolder, hardlinks the nine bundle files into
pocket-mirrors/pocket-tts-<lang>-onnx/, writes the voices/manifest.json that
tts_voices.list_builtin_voices reads, and verifies each staged total against
the catalog card's size_bytes so a drifted upstream is caught before upload.

Upload each staged dir to its (pre-created) model repo, e.g.:

    hf upload jiangzhuo9357/pocket-tts-en-onnx pocket-mirrors/pocket-tts-en-onnx . --repo-type model
"""
import json
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

SPACE = "KevinAHM/pocket-tts-web"
BUNDLES = {"en": "english_2026-04", "de": "german", "es": "spanish",
           "it": "italian", "pt": "portuguese"}
VOICES = ["alba", "azelma", "cosette", "eponine", "fantine", "javert", "jean", "marius"]
# Must equal the catalog cards' size_bytes (nine bundle files + the manifest below).
EXPECTED = {"en": 198645821, "de": 198646300, "es": 198647361,
            "it": 198646544, "pt": 198647467}


def manifest_bytes() -> bytes:
    entries = [{"name": VOICES[0], "default": True}] + [{"name": n} for n in VOICES[1:]]
    return (json.dumps(entries, indent=2) + "\n").encode()


def main() -> int:
    out_root = Path("pocket-mirrors")
    failures = 0
    for lang, sub in BUNDLES.items():
        root = snapshot_download(repo_id=SPACE, repo_type="space",
                                 allow_patterns=[f"onnx/{sub}/*"])
        src = Path(root) / "onnx" / sub
        dst = out_root / f"pocket-tts-{lang}-onnx"
        # Stage fresh every run: a skip-if-exists guard would keep stale files
        # after an upstream drift (the old bytes still sum to EXPECTED, so the
        # check would report OK while pinning the old version), and a file
        # REMOVED upstream would linger uncounted yet still get uploaded.
        # Staging is hardlinks from the snapshot — rebuilding costs nothing.
        shutil.rmtree(dst, ignore_errors=True)
        (dst / "voices").mkdir(parents=True)
        total = 0
        for f in sorted(src.iterdir()):
            real = f.resolve()          # deref the HF blob symlink
            target = dst / f.name
            try:
                os.link(real, target)
            except OSError:             # cross-filesystem fallback
                shutil.copy2(real, target)
            total += target.stat().st_size
        mf = manifest_bytes()
        (dst / "voices" / "manifest.json").write_bytes(mf)
        total += len(mf)
        ok = total == EXPECTED[lang]
        failures += 0 if ok else 1
        status = "OK" if ok else f"MISMATCH (catalog says {EXPECTED[lang]:,})"
        print(f"  {lang}: {dst}  {total:,} bytes  {status}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
