"""Writes sampled WhisperFeatureExtractor features for three synthetic clips, built as Smart Turn's inference.py builds them."""
import json
import sys

import numpy as np
from transformers import WhisperFeatureExtractor

SR = 16000
N = 8 * SR
MELS = [0, 7, 23, 40, 61, 79]
FRAMES = [0, 300, 599, 600, 650, 720, 799]


def synth(n):
    t = np.arange(n, dtype=np.float64) / SR
    env = 0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t)
    voiced = 0.4 * np.sin(2 * np.pi * (180 * t + 20 * t * t)) * env
    burst = np.where(np.mod(t, 1.0) < 0.5, 0.2, 0.04)
    return (voiced + burst * np.sin(2 * np.pi * 1250 * t + 0.3) + 0.05 * np.sin(2 * np.pi * 3100 * t)).astype(np.float32)


def last_8s(audio):
    return audio[-N:] if len(audio) >= N else np.pad(audio, (N - len(audio), 0))


extractor = WhisperFeatureExtractor(chunk_length=8)
windows = []
for seconds in (2, 8, 12):
    features = extractor(last_8s(synth(seconds * SR)), sampling_rate=SR, return_tensors="np", padding="max_length",
                         max_length=N, truncation=True, do_normalize=True).input_features[0]
    windows.append({"seconds": seconds, "points": [[m, t, round(float(features[m, t]), 6)] for m in MELS for t in FRAMES]})

json.dump({"_generator": "benchmark/smart-turn/make_turn_features_fixture.py", "windows": windows}, open(sys.argv[1], "w"))
