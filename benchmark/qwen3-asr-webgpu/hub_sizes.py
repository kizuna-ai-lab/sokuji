"""Record the exact byte sizes of every file in the Hub repo (PR 2's manifest copies them)."""
import json
import sys

from huggingface_hub import HfApi

repo, out = sys.argv[1], sys.argv[2]
info = HfApi().model_info(repo, files_metadata=True)
sizes = {s.rfilename: s.size for s in sorted(info.siblings, key=lambda s: s.rfilename)}
json.dump({"repo": repo, "sha": info.sha, "private": info.private, "files": sizes}, open(out, "w"), indent=1)
total = sum(v or 0 for v in sizes.values())
for k, v in sizes.items():
    print(f"{(v or 0) / 1e6:9.1f} MB  {k}")
print(f"{len(sizes)} files, {total / 1e9:.2f} GB, private={info.private}, sha={info.sha[:8]}")
