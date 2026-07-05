import sys

from sokuji_sidecar import _cudnn_preload as cp


def test_preload_returns_status_and_never_raises():
    # On this (linux) host torch's cuDNN is present, so it should report a load;
    # the contract is only that it returns a string and never raises.
    status = cp.preload_cudnn()
    assert isinstance(status, str)
    assert status.startswith("cudnn-preload:")


def test_non_linux_is_skipped(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    assert cp.preload_cudnn() == "cudnn-preload: skipped (non-linux)"


def test_missing_cudnn_dir_is_skipped(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(sys, "path", [])  # no nvidia/cudnn/lib anywhere
    assert cp.preload_cudnn() == "cudnn-preload: skipped (no cuDNN wheel found)"


def test_lib_dir_found_when_present(monkeypatch, tmp_path):
    libdir = tmp_path / "nvidia" / "cudnn" / "lib"
    libdir.mkdir(parents=True)
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    assert cp._cudnn_lib_dir() == str(libdir)


def test_lib_dir_none_when_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    assert cp._cudnn_lib_dir() is None
