"""Compare two encoder graphs (e.g. v1 unfused vs v2 fused) on a real clip: max / mean abs diff.

usage: check_encoder.py <encoder_a.onnx> <encoder_b.onnx> [clip.wav]
"""
import os
import sys

import numpy as np
import onnxruntime as ort
import soundfile as sf

sys.path.insert(0, "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx")
from src.mel import log_mel_spectrogram  # noqa: E402

a, b = sys.argv[1], sys.argv[2]
clip = sys.argv[3] if len(sys.argv) > 3 else "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/clips/jfk.wav"
audio, _ = sf.read(clip, dtype="float32")
mel = log_mel_spectrogram(audio).numpy()
so = ort.SessionOptions()
so.intra_op_num_threads = 8
out = []
for p in (a, b):
    s = ort.InferenceSession(p, so, providers=["CPUExecutionProvider"])
    dt = np.float16 if "16" in s.get_inputs()[0].type else np.float32
    out.append(s.run(["audio_features"], {"mel": mel.astype(dt)})[0].astype(np.float32))
d = np.abs(out[0] - out[1])
print(f"{os.path.basename(a)} vs {os.path.basename(b)}: shape {out[0].shape} max abs diff {d.max():.3e} mean {d.mean():.3e} |ref| max {np.abs(out[0]).max():.3f}")
