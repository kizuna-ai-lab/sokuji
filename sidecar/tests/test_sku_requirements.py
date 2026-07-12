"""Structural invariants for the per-SKU bundle requirements files (spec D1/D7/D10/D12).
These files are parsed (not installed) here, so the checks run on any host."""
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
# The three ORT variant wheels all provide the `onnxruntime` module; a bundle
# must install exactly one (spec D1).
ORT_LINE = re.compile(r"^onnxruntime(-gpu|-directml)?\b")
TORCH_LINE = re.compile(r"^(torch|torchaudio|torchvision)\b")


def _reqs(path):
    return [ln.strip() for ln in path.read_text().splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_sku_file_includes_shared_base(sku):
    assert "-r requirements.txt" in _reqs(FILES[sku])


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_exactly_one_ort_flavor(sku):
    ort = [ln for ln in _reqs(FILES[sku]) if ORT_LINE.match(ln)]
    assert len(ort) == 1, ort


def test_ort_flavor_matches_sku():
    assert any(ln.startswith("onnxruntime-gpu[cuda,cudnn]==1.23.2")
               for ln in _reqs(FILES["nvidia"]))
    assert any(ln.startswith("onnxruntime-directml==1.24.4")
               for ln in _reqs(FILES["directml"]))
    mac_ort = [ln for ln in _reqs(FILES["mac"]) if ORT_LINE.match(ln)][0]
    assert (mac_ort.startswith("onnxruntime==")
            and "-gpu" not in mac_ort and "-directml" not in mac_ort)
    # linux-arm64: onnxruntime-gpu ships no aarch64 wheels (verified 1.23.2) —
    # ORT stays CPU; GPU acceleration comes from the ggml/Vulkan family (D6).
    arm_ort = [ln for ln in _reqs(FILES["arm64"]) if ORT_LINE.match(ln)][0]
    assert (arm_ort.startswith("onnxruntime==")
            and "-gpu" not in arm_ort and "-directml" not in arm_ort)


def test_arm64_is_mac_minus_mlx():
    """The arm64 SKU mirrors the mac recipe (CPU ORT + pinned sherpa-onnx);
    mlx stays darwin-only via the platform marker in the shared base."""
    arm = _reqs(FILES["arm64"])
    assert any(ln.startswith("onnxruntime==1.23.2") for ln in arm)
    assert any(ln.startswith("sherpa-onnx==1.13.3") for ln in arm)
    assert not any("mlx" in ln for ln in arm)


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac", "arm64"])
def test_no_torch_in_sku_files(sku):
    assert not [ln for ln in _reqs(FILES[sku]) if TORCH_LINE.match(ln)]


def test_nvml_not_reintroduced():
    for sku in FILES:
        assert not any("nvidia-ml-py" in ln for ln in _reqs(FILES[sku]))


def test_hf_hub_pin_is_platform_split():
    """mlx-audio (darwin/arm64 only) requires huggingface_hub>=1.0; every other
    platform keeps the field-tested 0.26.2. Exactly one pin per environment."""
    base = SIDE / "requirements.txt"
    lines = [ln for ln in _reqs(base) if ln.startswith("huggingface_hub")]
    assert len(lines) == 2, lines
    assert any("==0.26.2" in ln and 'sys_platform != "darwin"' in ln for ln in lines)
    assert any(">=1.0" in ln and 'sys_platform == "darwin"' in ln for ln in lines)
