"""Run the exported Qwen3-ASR ONNX files on onnxruntime CPU EP over the test clips.

Prints transcript, CER against the manifest reference, and per-stage timings; writes
a JSON summary. Uses the pipeline's own mel + prompt + greedy loop (src/*).

usage: python run_onnx_cpu.py --dir output/qwen3-asr-0.6b [--suffix .int4] [--encoder encoder.onnx]
       [--embed embed_tokens.bin] [--threads 8] [--clips 'jfk.wav,ja-*.wav'] [--out cpu.json]
"""
import argparse
import glob
import json
import os
import re
import sys
import time

import numpy as np
import onnxruntime as ort
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "qwen3-asr-onnx"))
from src.inference import greedy_decode_onnx  # noqa: E402
from src.mel import log_mel_spectrogram  # noqa: E402
from src.prompt import ASR_TEXT_TOKEN_ID, EOS_TOKEN_IDS, build_prompt_ids, get_feat_extract_output_lengths  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--suffix", default="")
ap.add_argument("--encoder", default="encoder.onnx")
ap.add_argument("--embed", default="embed_tokens.bin")
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--clips", default="*.wav")
ap.add_argument("--max-tokens", type=int, default=256)
ap.add_argument("--out", default=None)
ap.add_argument("--force-lang", default=None, help="force the assistant prefix 'language <Name><asr_text>' (e.g. Chinese)")
a = ap.parse_args()

from transformers import AutoTokenizer  # noqa: E402

tok = AutoTokenizer.from_pretrained(a.dir)
cfg = json.load(open(os.path.join(a.dir, "config.json")))
hidden = cfg["decoder"]["hidden_size"]
emb_path = os.path.join(a.dir, a.embed)
dtype = np.float16 if "fp16" in a.embed else np.float32
embed = np.fromfile(emb_path, dtype=dtype).reshape(-1, hidden).astype(np.float32)

so = ort.SessionOptions()
so.intra_op_num_threads = a.threads
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
t0 = time.perf_counter()
enc = ort.InferenceSession(os.path.join(a.dir, a.encoder), so, providers=["CPUExecutionProvider"])
sessions = {
    "decoder_init": ort.InferenceSession(os.path.join(a.dir, f"decoder_init{a.suffix}.onnx"), so, providers=["CPUExecutionProvider"]),
    "decoder_step": ort.InferenceSession(os.path.join(a.dir, f"decoder_step{a.suffix}.onnx"), so, providers=["CPUExecutionProvider"]),
}
load_s = time.perf_counter() - t0
enc_in = enc.get_inputs()[0]
enc_dtype = np.float16 if "16" in enc_in.type else np.float32
print(f"loaded in {load_s:.1f}s  encoder={a.encoder} ({enc_in.type})  decoders=*{a.suffix}.onnx  embed={a.embed} threads={a.threads}")

manifest = json.load(open(os.path.join(HERE, "clips", "manifest.json")))


def norm(s):
    return re.sub(r"[\s\W_]+", "", (s or "").lower())


def cer(hyp, ref):
    h, r = norm(hyp), norm(ref)
    if not r:
        return None
    d = list(range(len(h) + 1))
    for j, rc in enumerate(r, 1):
        prev, d[0] = d[0], j
        for i, hc in enumerate(h, 1):
            cur = min(d[i] + 1, d[i - 1] + 1, prev + (hc != rc))
            prev, d[i] = d[i], cur
    return round(d[len(h)] / len(r), 3)


results = []
files = []
for pat in a.clips.split(","):
    files += sorted(glob.glob(os.path.join(HERE, "clips", pat)))
for k, path in enumerate(files):
    name = os.path.basename(path)
    audio, sr = sf.read(path, dtype="float32")
    assert sr == 16000, sr
    for rep in range(2 if k == 0 else 1):  # first clip twice: warm-up
        t = time.perf_counter()
        mel = log_mel_spectrogram(audio).numpy()
        t_mel = time.perf_counter() - t
        t = time.perf_counter()
        af = enc.run(["audio_features"], {"mel": mel.astype(enc_dtype)})[0].astype(np.float32)
        t_enc = time.perf_counter() - t
        n_audio = af.shape[1]
        assert n_audio == get_feat_extract_output_lengths(mel.shape[-1]), (n_audio, mel.shape)
        prompt = build_prompt_ids(n_audio)
        if a.force_lang:  # teacher-force the model's own prefix: "language <Name><asr_text>"
            prompt = prompt + tok.encode(f"language {a.force_lang}", add_special_tokens=False) + [ASR_TEXT_TOKEN_ID]
        t = time.perf_counter()
        gen = greedy_decode_onnx(sessions, embed, af, prompt, max_tokens=a.max_tokens)
        t_dec = time.perf_counter() - t
        cut = gen.index(ASR_TEXT_TOKEN_ID) if ASR_TEXT_TOKEN_ID in gen else -1
        prefix = tok.decode(gen[:cut]) if cut >= 0 else None
        text = tok.decode(gen[cut + 1:] if cut >= 0 else gen, skip_special_tokens=True)
        total = t_mel + t_enc + t_dec
        r = {"clip": name + (" [cold]" if rep == 0 and k == 0 else ""), "lang": manifest.get(name, {}).get("lang"), "audioSec": round(len(audio) / sr, 2),
             "melFrames": int(mel.shape[-1]), "audioTokens": int(n_audio), "promptTokens": len(prompt), "genTokens": len(gen),
             "melMs": round(t_mel * 1e3), "encoderMs": round(t_enc * 1e3), "decodeMs": round(t_dec * 1e3), "totalMs": round(total * 1e3),
             "rtf": round(total / (len(audio) / sr), 3), "prefix": prefix, "text": text, "ref": manifest.get(name, {}).get("text"),
             "hitEos": gen[-1] in EOS_TOKEN_IDS}
        r["cer"] = cer(text, r["ref"])
        results.append(r)
        print(f"{r['clip']:26s} {r['audioSec']:5.1f}s rtf={r['rtf']:.3f} enc={r['encoderMs']}ms dec={r['decodeMs']}ms tok={r['genTokens']} cer={r['cer']} | {prefix} | {text[:70]}")

if a.out:
    json.dump({"dir": a.dir, "suffix": a.suffix, "encoder": a.encoder, "embed": a.embed, "threads": a.threads, "loadSec": round(load_s, 1), "ort": ort.__version__, "results": results},
              open(a.out, "w"), ensure_ascii=False, indent=1)
warm = [r for r in results if "[cold]" not in r["clip"]]
print(f"median rtf (warm) = {np.median([r['rtf'] for r in warm]):.3f}   mean cer = {np.mean([r['cer'] for r in warm if r['cer'] is not None]):.3f}")
