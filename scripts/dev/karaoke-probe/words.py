"""Word timestamps for the karaoke simulation's ground truth: faster-whisper's
words, in seconds into a session's output audio (every chunk the provider sent,
concatenated in arrival order, as the probes save it).

    python3 -m venv ~/.cache/sokuji-whisper && ~/.cache/sokuji-whisper/bin/pip install faster-whisper
    ~/.cache/sokuji-whisper/bin/python scripts/dev/karaoke-probe/words.py <out.wav> <words.json> [<out.wav> <words.json> ...]

The model is `medium`, int8 on the CPU (CUDA is not assumed). The wav is
decoded here, not by faster-whisper: its PyAV call fails on the PyAV versions
pip resolves next to it (`open() got an unexpected keyword argument
'metadata_errors'`).
"""
import json
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel


def load(path):
    """16 kHz mono float32, linearly resampled from the wav's own rate."""
    with wave.open(path) as w:
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    n = int(len(x) * 16000 / rate)
    return np.interp(np.arange(n) * rate / 16000, np.arange(len(x)), x).astype(np.float32)


pairs = sys.argv[1:]
if not pairs or len(pairs) % 2:
    sys.exit('usage: words.py <out.wav> <words.json> [<out.wav> <words.json> ...]')
model = WhisperModel('medium', device='cpu', compute_type='int8', cpu_threads=16)
for wav, out in zip(pairs[0::2], pairs[1::2]):
    segments, info = model.transcribe(load(wav), word_timestamps=True, vad_filter=False, beam_size=5)
    words = [{'w': w.word, 's': round(w.start, 3), 'e': round(w.end, 3), 'p': round(w.probability, 3)} for seg in segments for w in seg.words]
    with open(out, 'w') as f:
        json.dump({'language': info.language, 'words': words}, f, ensure_ascii=False, indent=0)
    print(out, info.language, len(words), ''.join(w['w'] for w in words)[:120], flush=True)
