"""ORT session plumbing for the vendored GPT-SoVITS runtime.

Distribution scheme (spike-verified 2026-07-17, .spike/out/README.md): the HF
repo ships fp16 weight bins; the graphs' external-data entries already reference
the fp32 names with fp32-layout offsets, so a one-time numpy expansion at load
time lets stock ORT resolve the weights natively — no `onnx` package needed.
"""
from __future__ import annotations

import os
import shutil
import sys

import numpy as np
import onnxruntime as ort

# fp16 bin -> fp32 name referenced by the shipped graphs (byte-exact 2x sizes;
# note hubert's target has no _fp32 suffix — that is what its graph references).
FP16_TO_FP32 = {
    "t2s_shared_fp16.bin": "t2s_shared_fp32.bin",
    "vits_fp16.bin": "vits_fp32.bin",
    "prompt_encoder_fp16.bin": "prompt_encoder_fp32.bin",
    "chinese-hubert-base_weights_fp16.bin": "chinese-hubert-base_weights.bin",
}

MODEL_GRAPHS = (
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp32.onnx",
    "prompt_encoder_fp32.onnx",  # v2ProPlus only — optional
)


def ensure_fp32_bins(dir_path: str) -> list[str]:
    """Expand known fp16 bins in dir_path to their fp32 twins. Idempotent."""
    written: list[str] = []
    for name16, name32 in FP16_TO_FP32.items():
        src = os.path.join(dir_path, name16)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(dir_path, name32)
        want = os.path.getsize(src) * 2
        if os.path.isfile(dst) and os.path.getsize(dst) == want:
            continue
        print(f"[gpt_sovits] expanding {name16} -> {name32} ({want} bytes)", file=sys.stderr, flush=True)
        # Chunked convert into a temp file, then atomic os.replace: an
        # interrupted or concurrent expansion can never leave a wrong-sized
        # (or half-written but right-sized) fp32 file behind, and peak RAM
        # stays at one chunk instead of fp16+fp32 whole-file copies.
        tmp = dst + ".tmp"
        try:
            with open(src, "rb") as fin, open(tmp, "wb") as fout:
                while True:
                    chunk = np.fromfile(fin, dtype=np.float16, count=8_388_608)
                    if chunk.size == 0:
                        break
                    chunk.astype(np.float32).tofile(fout)
            os.replace(tmp, dst)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                # Best-effort cleanup of the temp file; the original
                # exception below is what matters.
                pass
            raise
        written.append(dst)
    return written


def ensure_real_bins(dir_path: str) -> list[str]:
    """Materialize every *.bin symlink in dir_path as a real file. Idempotent.

    ORT's ValidateExternalDataPath canonicalizes a graph's external-data path
    and rejects it when the resolved file escapes the model directory. The HF
    cache stores weights as symlinks into a sibling ../blobs/ tree, so a
    directly-shipped weight bin (e.g. t2s_encoder_fp32.bin — which, unlike the
    fp16->fp32 twins ensure_fp32_bins writes, arrives pre-expanded and is never
    rewritten) stays an escaping symlink and fails to load on stricter ORT
    builds (seen on the sbsa onnxruntime-gpu 1.24 wheel). Dereferencing it into
    a real dir entry keeps the file inside the model dir where validation
    passes; a hardlink shares the blob's inode (no data copy, HF cache intact),
    with a copy fallback across filesystems.
    """
    written: list[str] = []
    if not os.path.isdir(dir_path):
        return written  # tolerate a missing dir (e.g. plain-v2 has no hubert dir)
    for name in sorted(os.listdir(dir_path)):
        if not name.endswith(".bin"):
            continue
        p = os.path.join(dir_path, name)
        if not os.path.islink(p):
            continue
        real = os.path.realpath(p)
        if not os.path.isfile(real):
            continue  # dangling link — leave it so the caller fails loudly
        # Atomic swap (mirrors ensure_fp32_bins): build the real entry at a temp
        # name, then os.replace over the symlink so an interrupted run never
        # leaves the weight missing.
        tmp = p + ".tmp"
        try:
            if os.path.lexists(tmp):
                os.remove(tmp)
            try:
                os.link(real, tmp)          # hardlink: real entry, same blob data
            except OSError:
                shutil.copy2(real, tmp)     # cross-filesystem fallback
            os.replace(tmp, p)              # atomic: symlink -> real file
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
        written.append(p)
    return written


def providers_for(device: str) -> list[str]:
    if device == "cpu":
        return ["CPUExecutionProvider"]
    if device == "cuda":
        preload = getattr(ort, "preload_dlls", None)
        if callable(preload):  # CUDA-only: resolves cudnn/cublas pip wheels (spec D8)
            preload()
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError(
                "CUDAExecutionProvider not available in this onnxruntime build")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    raise RuntimeError(f"gpt_sovits_onnx: unsupported device {device!r}")


def make_session(path: str, device: str) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.log_severity_level = 3
    session = ort.InferenceSession(path, sess_options=opts,
                                   providers=providers_for(device))
    if device == "cuda" and "CUDAExecutionProvider" not in session.get_providers():
        # ORT can silently drop an EP at session creation (missing cuDNN etc.).
        # Fail loudly so load_measured falls back to the honest cpu plan.
        raise RuntimeError(
            f"CUDA EP silently dropped for {os.path.basename(path)}: "
            f"{session.get_providers()}")
    return session


def build_model_sessions(model_dir: str, device: str) -> dict[str, ort.InferenceSession]:
    sessions: dict[str, ort.InferenceSession] = {}
    for graph in MODEL_GRAPHS:
        path = os.path.join(model_dir, graph)
        if not os.path.isfile(path):
            if graph == "prompt_encoder_fp32.onnx":
                continue  # plain-v2 model
            raise FileNotFoundError(path)
        sessions[graph] = make_session(path, device)
    return sessions
