"""Per-row symmetric int8 quantization of the embedding table (dequant = q * scale).

usage: embed_int8.py <model_dir>   reads embed_tokens.bin (fp32 [vocab, 1024]),
writes embed_tokens.int8.bin (int8 row-major) and embed_scales.f32.bin (one fp32 per row).
"""
import os
import sys

import numpy as np

d = sys.argv[1]
w = np.fromfile(os.path.join(d, "embed_tokens.bin"), dtype=np.float32).reshape(-1, 1024)
scales = (np.abs(w).max(axis=1) / 127.0).astype(np.float32)
scales[scales == 0] = 1.0
q = np.clip(np.rint(w / scales[:, None]), -127, 127).astype(np.int8)
q.tofile(os.path.join(d, "embed_tokens.int8.bin"))
scales.tofile(os.path.join(d, "embed_scales.f32.bin"))
err = np.abs(q.astype(np.float32) * scales[:, None] - w)
print(f"rows {w.shape[0]}  max |w| {np.abs(w).max():.4f}  max abs err {err.max():.6f}  mean abs err {err.mean():.7f}")
print(f"sizes: int8 {os.path.getsize(os.path.join(d, 'embed_tokens.int8.bin')) / 1e6:.1f} MB, scales {os.path.getsize(os.path.join(d, 'embed_scales.f32.bin')) / 1e6:.2f} MB")
