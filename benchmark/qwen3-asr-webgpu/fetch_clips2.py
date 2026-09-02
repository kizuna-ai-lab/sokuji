"""Fetch ja/zh natural-speech clips.

Attempt 1: datasets-server rows API on fixie-ai/common_voice_17_0 (ungated parquet mirror).
Attempt 2: google/fleurs parquet shards via HTTP range reads (first row group only).
Writes clips/<lang>-<i>.wav (16 kHz mono float->PCM16) and clips/manifest.json.
Run with the spike venv (needs pyarrow, fsspec, soundfile, librosa).
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "clips")
os.makedirs(OUT, exist_ok=True)
manifest_path = os.path.join(OUT, "manifest.json")
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
N = 4


def save_wav(name, data, sr, lang, text):
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:
        import librosa
        data = librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=16000)
        sr = 16000
    path = os.path.join(OUT, name)
    sf.write(path, data.astype(np.float32), sr, subtype="PCM_16")
    manifest[name] = {"lang": lang, "text": text, "seconds": round(len(data) / sr, 2)}
    print(name, manifest[name]["seconds"], "s |", (text or "")[:60])


def rows_api(dataset, config, split, n):
    q = urllib.parse.urlencode({"dataset": dataset, "config": config, "split": split, "offset": 0, "length": n})
    with urllib.request.urlopen("https://datasets-server.huggingface.co/rows?" + q, timeout=60) as r:
        return json.load(r)["rows"]


def attempt_common_voice():
    for short, cfg in {"ja": "ja", "zh": "zh-CN"}.items():
        rows = rows_api("fixie-ai/common_voice_17_0", cfg, "test", N)
        for row in rows:
            rr = row["row"]
            audio = rr["audio"]
            a = audio[0] if isinstance(audio, list) else audio
            with urllib.request.urlopen(a["src"], timeout=120) as r:
                buf = r.read()
            data, sr = sf.read(io.BytesIO(buf), dtype="float32")
            save_wav(f"{short}-cv{row['row_idx']}.wav", data, sr, short, rr.get("sentence"))


def attempt_fleurs():
    import fsspec
    import pyarrow.parquet as pq
    fs = fsspec.filesystem("https")
    for short, cfg in {"ja": "ja_jp", "zh": "cmn_hans_cn"}.items():
        with urllib.request.urlopen(f"https://huggingface.co/api/datasets/google/fleurs/parquet/{cfg}/test", timeout=60) as r:
            urls = json.load(r)
        url = urls[0]
        with fs.open(url, "rb", block_size=8 << 20) as f:
            pf = pq.ParquetFile(f)
            t = pf.read_row_group(0, columns=["id", "audio", "transcription"]).slice(0, N).to_pylist()
        for rr in t:
            data, sr = sf.read(io.BytesIO(rr["audio"]["bytes"]), dtype="float32")
            save_wav(f"{short}-fleurs{rr['id']}.wav", data, sr, short, rr["transcription"])


ok = False
for fn in (attempt_common_voice, attempt_fleurs):
    try:
        fn()
        ok = True
        break
    except Exception as e:  # noqa: BLE001
        print(f"{fn.__name__} failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
with open(manifest_path, "w") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print("ok" if ok else "FAILED", len(manifest))
