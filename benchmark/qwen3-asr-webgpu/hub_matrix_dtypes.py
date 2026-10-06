"""Print the matrix-tensor dtypes of one GGUF in a Hub repo, read from its header at one
revision without downloading the file: the set a TTS card's `rung_dtypes` carries for that rung
(sidecar/sokuji_sidecar/catalog.py; owner's ruling 2026-10-06, op-coverage precision).

Usage: python hub_matrix_dtypes.py <org/repo> <path in repo> [revision]

Prints the weight-capable dtypes of the file's tensors of two or more dimensions,
space-separated and sorted. Without a revision, a third-party repo pinned in
catalog.PINNED_REVISIONS (ruling 4) is read at its pinned commit, any other repo at its head."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sidecar"))

from huggingface_hub import HfFileSystem  # noqa: E402

from sokuji_sidecar import catalog, gguf_header  # noqa: E402


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    repo, path = argv[0], argv[1]
    revision = argv[2] if len(argv) > 2 else catalog.hub_revision(repo)
    with HfFileSystem().open(f"{repo}/{path}", "rb", revision=revision) as fh:
        header = gguf_header.read_header(fh)
    print(" ".join(sorted(header.matrix_types & catalog.WEIGHT_CAPABLE_DTYPES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
