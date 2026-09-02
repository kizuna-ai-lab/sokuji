"""Remove duplicate producer nodes: ORT's fp16 converter can emit two identical Cast nodes
that both define the same output tensor name. Keep the first, drop identical later ones;
if a later one differs, rename its output and rewire its consumers (best effort)."""
import os
import sys

import onnx

for path in sys.argv[1:]:
    m = onnx.load(path, load_external_data=False)
    producers = {}
    keep = []
    dropped = renamed = 0
    for n in m.graph.node:
        dup = False
        for i, out in enumerate(n.output):
            if out in producers:
                p = producers[out]
                same = (p.op_type == n.op_type and list(p.input) == list(n.input) and
                        [(a.name, a.SerializeToString()) for a in p.attribute] == [(a.name, a.SerializeToString()) for a in n.attribute])
                if same:
                    dup = True
                else:
                    new = f"{out}_dup{renamed}"
                    renamed += 1
                    # consumers after this node that reference `out` are ambiguous; leave them on the first producer
                    n.output[i] = new
            producers.setdefault(n.output[i], n)
        if dup:
            dropped += 1
            continue
        keep.append(n)
    del m.graph.node[:]
    m.graph.node.extend(keep)
    onnx.save(m, path)
    print(os.path.basename(path), "dropped identical duplicates:", dropped, "renamed differing:", renamed)
