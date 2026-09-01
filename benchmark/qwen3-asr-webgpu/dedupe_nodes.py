"""Give every node a unique name (ORT's fp16 converter can emit duplicate Cast node names)."""
import os
import sys

import onnx

for path in sys.argv[1:]:
    m = onnx.load(path, load_external_data=False)
    seen, fixed = set(), 0
    for i, n in enumerate(m.graph.node):
        name = n.name or f"{n.op_type}_{i}"
        if name in seen:
            k = 1
            while f"{name}_{k}" in seen:
                k += 1
            name = f"{name}_{k}"
            fixed += 1
        seen.add(name)
        n.name = name
    onnx.save(m, path)
    print(os.path.basename(path), "renamed", fixed)
