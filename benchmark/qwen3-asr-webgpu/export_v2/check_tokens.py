"""Token-exact check: v2 layout (prefill on host-built embeddings) vs the v1 FP32 graphs.

usage: check_tokens.py <v1_dir> <v2_dir> [suffix e.g. .int4] [--force <iso>]
The encoder is always the v1 FP32 encoder so only the decoder path is compared.
"""
import os
import sys

import json
import numpy as np
import onnxruntime as ort
import soundfile as sf

PIPE = os.environ.get("QWEN3_ASR_ONNX_DIR", "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx")
CLIPS = os.environ.get("QWEN3_ASR_CLIPS", "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/clips")
sys.path.insert(0, PIPE)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.inference import greedy_decode_onnx  # noqa: E402
from src.mel import log_mel_spectrogram  # noqa: E402
from src.prompt import build_prompt_ids, get_feat_extract_output_lengths  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

from decode_v2 import greedy_decode, load_embed, load_prompt_config  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
v1, v2 = args[0], args[1]
suffix = args[2] if len(args) > 2 else ""
force = sys.argv[sys.argv.index("--force") + 1] if "--force" in sys.argv else None

so = ort.SessionOptions()
so.intra_op_num_threads = 8


def S(d, n):
    return ort.InferenceSession(os.path.join(d, n), so, providers=["CPUExecutionProvider"])


enc = S(v1, "encoder.onnx")
s1 = {"decoder_init": S(v1, "decoder_init.onnx"), "decoder_step": S(v1, "decoder_step.onnx")}
s2 = {"decoder_init": S(v2, f"decoder_init{suffix}.onnx"), "decoder_step": S(v2, f"decoder_step{suffix}.onnx")}
with open(os.path.join(v1, "config.json")) as f:
    hidden = json.load(f)["decoder"]["hidden_size"]
e1 = np.fromfile(os.path.join(v1, "embed_tokens.bin"), dtype=np.float32).reshape(-1, hidden)
e2 = load_embed(v2)
pc = load_prompt_config(v2)
tok = AutoTokenizer.from_pretrained(v1)
print(f"v2 decoders: *{suffix}.onnx  embedding: {pc.get('embedding', {}).get('dtype', 'float32 (no prompt_config)')}  force={force}")

ok = True
for clip in ("jfk.wav", "ja-fleurs1828.wav", "zh-fleurs1883.wav"):
    audio, _ = sf.read(os.path.join(CLIPS, clip), dtype="float32")
    mel = log_mel_spectrogram(audio).numpy()
    af = enc.run(["audio_features"], {"mel": mel})[0]
    prompt = build_prompt_ids(get_feat_extract_output_lengths(mel.shape[-1]))
    t1 = greedy_decode_onnx(s1, e1, af, prompt)
    p2 = prompt + (pc["language_prefix_ids"][force] if force else [])
    t2 = greedy_decode(s2, e2, af, p2)
    same = t1 == t2
    ok &= same
    if same:
        verdict = "IDENTICAL"
    else:
        diff = next((i for i, (a, b) in enumerate(zip(t1, t2)) if a != b), min(len(t1), len(t2)))
        verdict = f"DIFF at token {diff}"
    print(f"{clip:22s} v1 {len(t1):3d} tok | v2 {len(t2):3d} tok | {verdict}")
    print(f"    v1: {tok.decode(t1, skip_special_tokens=True)[:90]}")
    print(f"    v2: {tok.decode(t2, skip_special_tokens=True)[:90]}")
print("PASS" if ok else "FAIL (see per-clip verdicts; not fatal for quantized variants)")
sys.exit(0 if ok else 1)
