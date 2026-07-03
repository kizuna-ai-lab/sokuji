"""llama.cpp runtime for the llamacpp_* translate backends.

Two responsibilities:
  1. Binary acquisition — the official single-file `llama-app` from the
     llama.app HF bucket (Linux CUDA/Vulkan/CPU, macOS Metal), or the official
     GitHub release zips on Windows. Pinned to BUCKET_VERSION; sha256-verified
     when the asset's hash is known (unknown new bucket configs proceed with a
     logged warning rather than bricking).
  2. Process management — LlamaServerProc spawns `llama serve` on a free
     localhost port, polls /health until ready, and exposes the
     OpenAI-compatible /v1/chat/completions endpoint.
"""
import os
import platform

from .backends import BackendLoadError

BUCKET_VERSION = "b9835"
_BUCKET_BASE = "https://huggingface.co/buckets/ggml-org/install.sh/resolve"
_GH_BASE = "https://github.com/ggml-org/llama.cpp/releases/download"

# sha256 per asset path/name, recorded by scripts/record_llama_checksums.py.
# A missing entry logs a warning instead of failing: the bucket grows new
# SM/chip configs without notice and we must not brick those machines.
ASSET_SHA256: dict[str, str] = {}

_FLAVORS = {"cuda": "cuda", "metal": "metal", "cpu": "cpu"}


def flavor_for_device(device: str) -> str:
    """Map a Plan.device to a binary flavor. KeyError on unsupported devices."""
    return _FLAVORS[device]


def bin_root() -> str:
    base = os.environ.get("SOKUJI_LLAMA_BIN_DIR") or os.path.join(
        os.path.expanduser("~/.config/Sokuji"), "llama-bin")
    return os.path.join(base, BUCKET_VERSION)


def _exe_name() -> str:
    return "llama-server.exe" if platform.system() == "Windows" else "llama"


def binary_path(flavor: str) -> str | None:
    """Installed binary path for `flavor`, or None when not yet downloaded."""
    exe = os.path.join(bin_root(), flavor, _exe_name())
    return exe if os.path.isfile(exe) else None


def bucket_url(rel: str) -> str:
    return f"{_BUCKET_BASE}/{BUCKET_VERSION}/{rel}"


def gh_url(asset: str) -> str:
    return f"{_GH_BASE}/{BUCKET_VERSION}/{asset}"


def default_flavor() -> str:
    """The best flavor for this machine (drives the model-download dependency)."""
    from . import accel
    m = accel.probe()
    if m.nvidia:
        return "cuda"
    if m.apple_silicon:
        return "metal"
    return "cpu"
