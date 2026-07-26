#!/usr/bin/env python3
# Apache License 2.0
"""Generate golden mel outputs from the spike's librosa-based reference.

Run ONCE from the worktree root with the spike venv:
    .spike/venv/bin/python scripts/cosyvoice3/gen_mel_goldens.py
Commits sidecar/tests/data/cosyvoice3_mel_goldens.npz. The sidecar's numpy
ports (sokuji_sidecar/cosyvoice3/mel.py) must match these within 1e-4.
"""
import sys
import numpy as np

sys.path.insert(0, ".spike")
from cosyvoice3_spike import whisper_log_mel_128, kaldi_fbank_80_cmn, matcha_mel_80

rng = np.random.default_rng(20260717)
# 0.5 s of band-limited noise + a 440 Hz tone, deterministic
t16 = np.arange(8000) / 16000.0
t24 = np.arange(12000) / 24000.0
sig16 = (0.3 * np.sin(2 * np.pi * 440 * t16)
         + 0.05 * rng.standard_normal(8000)).astype(np.float32)
sig24 = (0.3 * np.sin(2 * np.pi * 440 * t24)
         + 0.05 * rng.standard_normal(12000)).astype(np.float32)

np.savez_compressed(
    "sidecar/tests/data/cosyvoice3_mel_goldens.npz",
    sig16=sig16, sig24=sig24,
    whisper=whisper_log_mel_128(sig16),
    kaldi=kaldi_fbank_80_cmn(sig16),
    matcha=matcha_mel_80(sig24),
)
print("goldens written")
