"""Writes WhisperFeatureExtractor(feature_size=80).mel_filters, as [mel, bin, value] for every nonzero entry."""
import json
import sys

import numpy as np
from transformers import WhisperFeatureExtractor

filters = np.asarray(WhisperFeatureExtractor(feature_size=80).mel_filters).T  # (80, 201)
with open(sys.argv[1], "w") as out:
    json.dump({
        "_generator": "benchmark/smart-turn/make_mel_filters_fixture.py",
        "n_mels": int(filters.shape[0]),
        "n_freqs": int(filters.shape[1]),
        "nonzero": [[int(m), int(k), float(filters[m, k])] for m, k in zip(*np.nonzero(filters))],
    }, out)
