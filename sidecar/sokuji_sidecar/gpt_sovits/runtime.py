"""ORT session plumbing for the vendored GPT-SoVITS runtime.

Distribution scheme (spike-verified 2026-07-17, .spike/out/README.md): the HF
repo ships fp16 weight bins; the graphs' external-data entries already reference
the fp32 names with fp32-layout offsets, so a one-time numpy expansion at load
time lets stock ORT resolve the weights natively — no `onnx` package needed.
"""
from __future__ import annotations

import logging
import os

import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)

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
        logger.info("expanding %s -> %s (%d bytes)", name16, name32, want)
        np.fromfile(src, dtype=np.float16).astype(np.float32).tofile(dst)
        written.append(dst)
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
