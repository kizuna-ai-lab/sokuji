"""Rename an ONNX model + its external data file, rewriting the external_data location.

usage: rename_ext.py <dir> <old_stem> <new_stem>   e.g. decoder_init.q4f16b decoder_init.q4f16
"""
import os
import sys

import onnx
from onnx.external_data_helper import uses_external_data

d, old, new = sys.argv[1:4]
src = os.path.join(d, old + ".onnx")
dst = os.path.join(d, new + ".onnx")
m = onnx.load(src, load_external_data=False)
n = 0
for t in m.graph.initializer:
    if uses_external_data(t):
        for kv in t.external_data:
            if kv.key == "location":
                assert kv.value == old + ".onnx.data", kv.value
                kv.value = new + ".onnx.data"
                n += 1
onnx.save(m, dst)
os.replace(os.path.join(d, old + ".onnx.data"), os.path.join(d, new + ".onnx.data"))
os.remove(src)
print(f"{old} -> {new}: {n} external tensors relocated; {os.path.getsize(dst + '.data') / 1e6:.0f} MB data")
