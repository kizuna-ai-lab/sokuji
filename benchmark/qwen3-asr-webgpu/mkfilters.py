"""Emit the Slaney mel filterbank (128 x 201) the pipeline uses, as JSON for the browser page."""
import json
import os

import librosa
import numpy as np

fb = librosa.filters.mel(sr=16000, n_fft=400, n_mels=128, fmin=0, fmax=8000, norm="slaney")
assert fb.shape == (128, 201), fb.shape
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "www", "mel_filters.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump({"n_mels": 128, "n_freqs": 201, "data": np.round(fb.astype(np.float64), 10).tolist()}, f)
print(out, os.path.getsize(out), "nonzero", int((fb > 0).sum()))
