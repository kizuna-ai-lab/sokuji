"""Idempotent exact-string patch for a fetched upstream file.

usage: patch_upstream.py <file> <old-string> <new-string>
Replaces the single occurrence of <old-string> with <new-string>. Exits 0
without touching the file when <new-string> is already present, so FetchContent
can re-run it on every populate. Fails loudly if <old-string> is not found
exactly once — that means the upstream pin moved and the patch must be revisited.

A literal backslash-n (two characters: "\\n") in <old-string>/<new-string> is
unescaped to a real newline before matching/writing, so a patch can span lines.
PATCH_COMMAND arguments must stay on one physical line in the CMakeLists.txt
that declares them: CMake's Unix Makefiles generator embeds each COMMAND
argument verbatim into the generated recipe, and a raw newline byte there
breaks `make` ("missing separator") before the patch ever runs.

To get the two literal characters this script expects, write FOUR backslashes
before the n in the calling CMakeLists.txt (e.g. "foo\\\\nbar"): CMake's own
parser decodes that once into two backslashes plus 'n' ("\\n", 3 raw bytes)
in the generated recipe, and the shell that `make` invokes to run the recipe
decodes the doubled backslash again (POSIX double-quote rule) down to one
backslash plus 'n' — the 2-character placeholder that finally reaches this
script's argv. Two backslashes (one CMake decode only) still leaves a raw
newline in the recipe and breaks `make`; four is the number that survives
both decodes. A literal dollar sign that must survive the same two decodes
(e.g. to defer a "${VAR}" reference into the *patched* file instead of having
CMake's own parser expand it immediately) needs three backslashes before it
("\\\\\\$..." two backslashes-as-escaped-backslash, then \\$ as escaped-dollar);
this script does nothing special for '$' — it is not one of its interpreted
placeholders, so whatever survives CMake's and the shell's decoding is passed
through byte-for-byte.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
old = sys.argv[2].replace("\\n", "\n")
new = sys.argv[3].replace("\\n", "\n")
text = path.read_text(encoding="utf-8")
if new in text:
    print(f"patch_upstream: {path.name}: already patched")
    sys.exit(0)
if text.count(old) != 1:
    print(f"patch_upstream: {path.name}: expected exactly one occurrence of {old!r}, found {text.count(old)}")
    sys.exit(1)
path.write_text(text.replace(old, new), encoding="utf-8")
print(f"patch_upstream: {path.name}: patched")
