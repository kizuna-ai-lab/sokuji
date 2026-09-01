"""Apply a JSON-specified list of exact-text patches to files under a source tree.

usage: patch_upstream.py <source_dir> <spec.json> [<spec.json> ...]

Several specs may be given; their entries are concatenated in order, so one
upstream can carry both an always-on portability patch and a lane-specific one.

<spec.json> is a list of {"file": <path relative to source_dir>, "old": <exact
text>, "new": <exact text>} objects. JSON strings carry real newlines, so a
patch can span multiple lines with no CMake/shell escaping needed.

For each entry: if <new> is present and <old> occurs nowhere outside <new>
(a patch may wrap the original line, e.g. in an if() guard), the file is left
alone (idempotent re-run, prints "already patched"). If <new> is present but
<old> also survives elsewhere the entry fails: <new> occurring by chance would
otherwise hide an unpatched site. Otherwise <old> must occur in the file
exactly once and is replaced with <new> — zero or multiple occurrences fails
loudly with the count, since that means the upstream pin moved and the patch
must be revisited. All entries are attempted; the script exits non-zero if any
entry failed.
"""
import json
import sys
from pathlib import Path


def main():
    source_dir = Path(sys.argv[1])
    entries = []
    for spec in sys.argv[2:]:
        entries += json.loads(Path(spec).read_text(encoding="utf-8"))

    ok = True
    for entry in entries:
        path = source_dir / entry["file"]
        old, new = entry["old"], entry["new"]
        text = path.read_text(encoding="utf-8")
        if new in text:
            residual = text.replace(new, "").count(old)   # <old> outside every <new> occurrence
            if residual == 0:
                print(f"patch_upstream: {entry['file']}: already patched")
            else:
                print(f"patch_upstream: {entry['file']}: new text present but {old!r} still occurs "
                      f"{residual}x outside it — ambiguous, revisit the patch")
                ok = False
            continue
        count = text.count(old)
        if count != 1:
            print(f"patch_upstream: {entry['file']}: expected exactly one occurrence of {old!r}, found {count}")
            ok = False
            continue
        path.write_text(text.replace(old, new), encoding="utf-8")
        print(f"patch_upstream: {entry['file']}: patched")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
