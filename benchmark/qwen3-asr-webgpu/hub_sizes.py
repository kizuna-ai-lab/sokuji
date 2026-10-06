"""Record the exact byte sizes of every file in a Hub repo, at one revision.

Usage: python hub_sizes.py <org/repo> <out.json> [revision]

A third-party repo pinned in sidecar/sokuji_sidecar/catalog.py PINNED_REVISIONS (ruling 4)
is read at its pinned commit; without a revision the repo's current head is read."""
import json
import sys

from huggingface_hub import HfApi


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    repo, out = argv[0], argv[1]
    revision = argv[2] if len(argv) > 2 else None
    info = HfApi().model_info(repo, revision=revision, files_metadata=True)
    sizes = {s.rfilename: s.size for s in sorted(info.siblings, key=lambda s: s.rfilename)}
    with open(out, "w") as fh:
        json.dump({"repo": repo, "revision": revision, "sha": info.sha, "private": info.private,
                   "files": sizes}, fh, indent=1)
    total = sum(v or 0 for v in sizes.values())
    for k, v in sizes.items():
        print(f"{(v or 0) / 1e6:9.1f} MB  {k}")
    print(f"{len(sizes)} files, {total / 1e9:.2f} GB, private={info.private}, sha={info.sha[:8]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
