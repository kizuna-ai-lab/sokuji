import os
import pytest

from sokuji_sidecar import llama_runtime as rt


def test_flavor_for_device():
    assert rt.flavor_for_device("cuda") == "cuda"
    assert rt.flavor_for_device("metal") == "metal"
    assert rt.flavor_for_device("cpu") == "cpu"
    with pytest.raises(KeyError):
        rt.flavor_for_device("dml")


def test_bin_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    assert rt.bin_root() == os.path.join(str(tmp_path), rt.BUCKET_VERSION)


def test_bin_root_default(monkeypatch):
    monkeypatch.delenv("SOKUJI_LLAMA_BIN_DIR", raising=False)
    assert rt.bin_root().endswith(os.path.join("Sokuji", "llama-bin", rt.BUCKET_VERSION))


def test_binary_path_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    assert rt.binary_path("cuda") is None


def test_binary_path_present(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    exe_dir = tmp_path / rt.BUCKET_VERSION / "cuda"
    exe_dir.mkdir(parents=True)
    exe = exe_dir / rt._exe_name()
    exe.write_bytes(b"#!fake")
    assert rt.binary_path("cuda") == str(exe)


def test_urls():
    assert rt.bucket_url("x86_64/linux/cuda/89/llama-app.zst") == (
        "https://huggingface.co/buckets/ggml-org/install.sh/resolve/"
        f"{rt.BUCKET_VERSION}/x86_64/linux/cuda/89/llama-app.zst")
    assert rt.gh_url(f"llama-{rt.BUCKET_VERSION}-bin-win-cuda-12.4-x64.zip").startswith(
        "https://github.com/ggml-org/llama.cpp/releases/download/")
