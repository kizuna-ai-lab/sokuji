"""Idempotent exact-string patch for a fetched upstream file.

usage: patch_upstream.py <file> <old-string> <new-string>
Replaces the single occurrence of <old-string> with <new-string>. Exits 0
without touching the file when <new-string> is already present, so FetchContent
can re-run it on every populate. Fails loudly if <old-string> is not found
exactly once — that means the upstream pin moved and the patch must be revisited.
"""
import sys
from pathlib import Path

path, old, new = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text(encoding="utf-8")
if new in text:
    print(f"patch_upstream: {path.name}: already patched")
    sys.exit(0)
if text.count(old) != 1:
    print(f"patch_upstream: {path.name}: expected exactly one occurrence of {old!r}, found {text.count(old)}")
    sys.exit(1)
path.write_text(text.replace(old, new), encoding="utf-8")
print(f"patch_upstream: {path.name}: patched")
