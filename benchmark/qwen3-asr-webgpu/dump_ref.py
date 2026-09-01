"""Dump reference mel (float32 [128,T]) and tokenizer round-trips for the JS cross-check."""
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "qwen3-asr-onnx"))
from src.mel import log_mel_spectrogram  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

audio, sr = sf.read(os.path.join(HERE, "clips", "jfk.wav"), dtype="float32")
mel = log_mel_spectrogram(audio).numpy()[0]
mel.astype(np.float32).tofile(os.path.join(HERE, "www", "jfk_mel_ref.bin"))
tok = AutoTokenizer.from_pretrained(os.path.join(HERE, "qwen3-asr-onnx", "output", "qwen3-asr-0.6b"))
samples = ["こんにちは、世界。Hello world! 1234", "这并不是告别，这是一个篇章的结束。", "language Japanese", "🙂 émigré naïve"]
ids = [tok.encode(s, add_special_tokens=False) for s in samples]
json.dump({"melShape": list(mel.shape), "samples": samples, "ids": ids, "decoded": [tok.decode(i) for i in ids]},
          open(os.path.join(HERE, "www", "jfk_ref.json"), "w"), ensure_ascii=False)
print("mel", mel.shape, "min/max", float(mel.min()), float(mel.max()), "ids", [len(i) for i in ids])
