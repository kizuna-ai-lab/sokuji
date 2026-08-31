"""Structural invariants for the per-SKU bundle requirements files (spec D10).
These files are parsed (not installed) here, so the checks run on any host.

Slice 4 (TTS on the native library): onnxruntime/onnxruntime-gpu/
onnxruntime-directml, sherpa-onnx, and mlx-audio all died with the ONNX/
sherpa/MLX TTS backends (their last consumers) — every per-SKU file is now
equivalent to the shared base plus a comment explaining why; full
consolidation to one requirements file is slice 5's job."""
import pathlib
import re

import pytest

SIDE = pathlib.Path(__file__).resolve().parents[1]
FILES = {
    "nvidia": SIDE / "requirements-nvidia.txt",
    "directml": SIDE / "requirements-directml.txt",
    "mac": SIDE / "requirements-mac.txt",
    "arm64": SIDE / "requirements-arm64.txt",
}
ORT_LINE = re.compile(r"^onnxruntime(-gpu|-directml)?\b")
TORCH_LINE = re.compile(r"^(torch|torchaudio|torchvision)\b")


def _reqs(path):
    return [ln.strip() for ln in path.read_text().splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_sku_file_includes_shared_base(sku):
    assert "-r requirements.txt" in _reqs(FILES[sku])


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_no_ort_flavor_left_in_any_sku(sku):
    # onnxruntime/onnxruntime-gpu/onnxruntime-directml died with the ONNX TTS
    # backends (slice 4) — every remaining backend (ASR, translate, TTS) runs
    # through the ggml/Vulkan or ggml/Metal lane via sokuji-native.
    assert not [ln for ln in _reqs(FILES[sku]) if ORT_LINE.match(ln)]


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_no_sherpa_or_mlx_left_in_any_sku(sku):
    reqs = _reqs(FILES[sku])
    assert not any("sherpa" in ln for ln in reqs)
    assert not any("mlx" in ln for ln in reqs)


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_every_sku_is_now_just_the_shared_base(sku):
    # With onnxruntime/sherpa/mlx gone, every per-SKU file has nothing left to
    # add beyond `-r requirements.txt` (comments aside) — full consolidation
    # to one requirements file is slice 5's job.
    assert _reqs(FILES[sku]) == ["-r requirements.txt"]


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_no_torch_in_sku_files(sku):
    assert not [ln for ln in _reqs(FILES[sku]) if TORCH_LINE.match(ln)]


def test_nvml_not_reintroduced():
    for sku in FILES:
        assert not any("nvidia-ml-py" in ln for ln in _reqs(FILES[sku]))


def test_hf_hub_pin_is_a_single_universal_line():
    # The mlx-audio-forced platform split (>=1.0,<2 on darwin/arm64 vs 0.26.2
    # elsewhere) died with mlx-audio itself (slice 4) — one pin, no markers.
    base = SIDE / "requirements.txt"
    lines = [ln for ln in _reqs(base) if ln.startswith("huggingface_hub")]
    assert lines == ["huggingface_hub==0.26.2"]


def test_base_requirements_has_no_tts_only_deps():
    # sentencepiece/tokenizers/jieba/pypinyin/g2pM/nltk/pyopenjtalk-plus/
    # mlx-audio all died with their only consumers (the ONNX TTS backends'
    # tokenizers and GPT-SoVITS's G2P stacks, slice 4).
    base = SIDE / "requirements.txt"
    reqs = _reqs(base)
    dead = ("sentencepiece", "tokenizers", "jieba", "pypinyin", "g2pM",
            "nltk", "pyopenjtalk", "mlx-audio")
    for name in dead:
        assert not any(ln.lower().startswith(name.lower()) for ln in reqs), name


def test_base_requirements_is_the_eight_package_end_state():
    # numpy, websockets, huggingface_hub, psutil, zstandard, soundfile, soxr
    # (7 PyPI packages) + sokuji-native (installed separately by setup.sh,
    # not a requirements.txt line — see the file's own trailing comment).
    base = SIDE / "requirements.txt"
    names = {ln.split("==")[0].split(">=")[0].strip() for ln in _reqs(base)}
    assert names == {"numpy", "websockets", "huggingface_hub", "psutil",
                     "zstandard", "soundfile", "soxr"}
