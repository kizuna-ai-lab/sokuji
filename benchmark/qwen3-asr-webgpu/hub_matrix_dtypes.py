"""Print the matrix-tensor dtypes of one rung's GGUFs in a Hub repo, read from their headers at
one revision without downloading the files: a TTS card's `rung_dtypes[q]`, the union over the
rung's main GGUF and its companion GGUFs (sidecar/sokuji_sidecar/catalog.py; owner's ruling
2026-10-06, op-coverage precision).

Usage: python hub_matrix_dtypes.py <org/repo> <path> [<path> ...] [--revision R]

Pass the rung's main GGUF and every companion GGUF, as repo paths. Prints the weight-capable
dtypes of their tensors of two or more dimensions, as one union, space-separated and sorted.
Without --revision, a third-party repo pinned in catalog.PINNED_REVISIONS (ruling 4) is read at
its pinned commit, any other repo at its head."""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sidecar"))

from huggingface_hub import HfFileSystem  # noqa: E402

from sokuji_sidecar import catalog, gguf_header  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo", help="org/repo")
    parser.add_argument("paths", nargs="+", help="the rung's main GGUF and its companion GGUFs")
    parser.add_argument("--revision", default=None, help="default: the catalog's pin, else the head")
    args = parser.parse_args(argv)
    revision = args.revision or catalog.hub_revision(args.repo)
    fs = HfFileSystem()
    union = set()
    for path in args.paths:
        with fs.open(f"{args.repo}/{path}", "rb", revision=revision) as fh:
            union |= gguf_header.read_header(fh).matrix_types
    print(" ".join(sorted(union & catalog.WEIGHT_CAPABLE_DTYPES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
