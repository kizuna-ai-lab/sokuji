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


import io
import zstandard


def _zst(data: bytes) -> bytes:
    return zstandard.ZstdCompressor().compress(data)


def test_ensure_binary_downloads_and_extracts(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt, "_probe_config", lambda flavor: "89")
    fetched = []

    def fake_fetch(url):
        fetched.append(url)
        return _zst(b"ELF-fake-llama")
    monkeypatch.setattr(rt, "_fetch", fake_fetch)
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    monkeypatch.setattr(rt.platform, "machine", lambda: "x86_64")
    # Monkeypatch the checksum for test data (fake data doesn't match real checksums)
    monkeypatch.setitem(rt.ASSET_SHA256, "x86_64/linux/cuda/89/llama-app.zst",
                        "bbf6b8bb591530f1e81b2eabb6b752b7e8c0d4e134d7392de6e89368bfabb49d")

    path = rt.ensure_binary("cuda")
    assert path == rt.binary_path("cuda")
    assert open(path, "rb").read() == b"ELF-fake-llama"
    assert os.access(path, os.X_OK)
    assert fetched == [rt.bucket_url("x86_64/linux/cuda/89/llama-app.zst")]


def test_ensure_binary_is_idempotent(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    exe_dir = tmp_path / rt.BUCKET_VERSION / "cpu"
    exe_dir.mkdir(parents=True)
    (exe_dir / rt._exe_name()).write_bytes(b"already")
    monkeypatch.setattr(rt, "_fetch",
                        lambda url: (_ for _ in ()).throw(AssertionError("no fetch")))
    assert rt.ensure_binary("cpu") == rt.binary_path("cpu")


def test_ensure_binary_checksum_mismatch(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt, "_probe_config", lambda flavor: "89")
    monkeypatch.setattr(rt, "_fetch", lambda url: _zst(b"tampered"))
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    monkeypatch.setattr(rt.platform, "machine", lambda: "x86_64")
    monkeypatch.setitem(rt.ASSET_SHA256, "x86_64/linux/cuda/89/llama-app.zst", "0" * 64)
    with pytest.raises(rt.BinaryFetchError):
        rt.ensure_binary("cuda")
    assert rt.binary_path("cuda") is None  # nothing half-installed


def test_gguf_path_single_file(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "w.gguf").write_bytes(b"GGUF")
    assert rt.gguf_path(str(tmp_path)).endswith("w.gguf")


def test_gguf_path_requires_exactly_one(tmp_path):
    from sokuji_sidecar.backends import BackendLoadError
    (tmp_path / "a.gguf").write_bytes(b"GGUF")
    (tmp_path / "b.gguf").write_bytes(b"GGUF")
    with pytest.raises(BackendLoadError):
        rt.gguf_path(str(tmp_path))


def test_gguf_path_file_artifact(monkeypatch, tmp_path):
    # Upstream file artifact ("org/repo/file.gguf", the catalog's normal shape
    # post-Task-14b) resolves directly via one hf_hub_download — no walk needed.
    gguf = tmp_path / "qwen2.5-0.5b-instruct-q8_0.gguf"
    gguf.write_bytes(b"GGUF")

    def fake_hf_hub_download(repo, fname, local_files_only=True):
        assert repo == "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
        assert fname == "qwen2.5-0.5b-instruct-q8_0.gguf"
        assert local_files_only is True
        return str(gguf)
    monkeypatch.setattr("huggingface_hub.hf_hub_download", fake_hf_hub_download)
    assert rt.gguf_path("Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf") == str(gguf)


def test_gguf_path_file_artifact_not_downloaded(monkeypatch):
    from sokuji_sidecar.backends import BackendLoadError

    def boom(repo, fname, local_files_only=True):
        raise RuntimeError("not cached")
    monkeypatch.setattr("huggingface_hub.hf_hub_download", boom)
    with pytest.raises(BackendLoadError):
        rt.gguf_path("Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf")


def test_reserved_bytes_roundtrip():
    rt.set_reserved_bytes(3 << 30)
    assert rt.get_reserved_bytes() == 3 << 30
    rt.set_reserved_bytes(0)
