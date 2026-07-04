"""Preload the venv's cuDNN 9 (the standalone nvidia-cudnn-cu12 wheel) so
onnxruntime-gpu reuses that one consistent set instead of mixing it with a
different system cuDNN.

onnxruntime-gpu (MOSS/Supertonic TTS) lacks an RPATH to the pip wheel's copy
and, with no LD_LIBRARY_PATH set, otherwise resolves cuDNN from the system. When the two cuDNN 9 patch versions differ
(e.g. wheel 9.19 vs system 9.23), the shared soname makes the loader bind a
newer system sub-library against the older resident graph:

    libcudnn_cnn.so.9: undefined symbol: ..., version libcudnn_graph.so.9

so CUDAExecutionProvider fails to create and the model silently runs on CPU.

Preloading the wheel's full cuDNN set with RTLD_GLOBAL before any CUDA provider
loads pins that single version for the whole process. Best-effort and silent on
CPU-only hosts (the libraries simply fail to load and GPU is unavailable
anyway)."""
import ctypes
import os
import sys

# Load order: graph has no cuDNN deps; the engines/ops/heuristic/cnn/adv sublibs
# depend on it; libcudnn.so.9 (the frontend) resolves them at run time.
_CUDNN_LOAD_ORDER = (
    "libcudnn_graph.so.9",
    "libcudnn_engines_precompiled.so.9",
    "libcudnn_engines_runtime_compiled.so.9",
    "libcudnn_ops.so.9",
    "libcudnn_heuristic.so.9",
    "libcudnn_cnn.so.9",
    "libcudnn_adv.so.9",
    "libcudnn.so.9",
)


def _cudnn_lib_dir():
    """The venv's cuDNN lib dir (``nvidia/cudnn/lib``, the nvidia-cudnn-cu12
    wheel layout — torch's bundled copy used the same path) on sys.path, or None.

    The ``nvidia.cudnn`` module is not reliably importable in every venv, so we
    look for the directory on sys.path rather than importing the package."""
    for base in sys.path:
        d = os.path.join(base or ".", "nvidia", "cudnn", "lib")
        if os.path.isdir(d):
            return d
    return None


def preload_torch_cudnn():
    """Best-effort preload of torch's cuDNN. Returns a short status string.

    Never raises: a failure here only means GPU stays unavailable (CPU fallback),
    which is exactly the state a CPU-only host is in anyway."""
    if sys.platform != "linux":
        return "cudnn-preload: skipped (non-linux)"
    libdir = _cudnn_lib_dir()
    if not libdir:
        return "cudnn-preload: skipped (no cuDNN wheel found)"
    loaded = 0
    for name in _CUDNN_LOAD_ORDER:
        path = os.path.join(libdir, name)
        if not os.path.exists(path):
            continue
        try:
            ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
            loaded += 1
        except OSError:
            # No CUDA driver / incompatible lib → leave GPU unavailable.
            pass
    return f"cudnn-preload: loaded {loaded} cuDNN libs from {libdir}"
