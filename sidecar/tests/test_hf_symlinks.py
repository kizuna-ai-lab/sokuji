import os

import numpy as np
import pytest

from sokuji_sidecar import hf_symlinks


def _hf_layout(tmp_path, name, payload=b"\x01\x02\x03\x04"):
    """Mimic the HF cache: model/<name> symlinks OUT into a sibling ../blobs/."""
    blobs = tmp_path / "blobs"
    blobs.mkdir(exist_ok=True)
    model = tmp_path / "onnx"
    model.mkdir(exist_ok=True)
    (blobs / (name + ".blob")).write_bytes(payload)
    link = model / name
    link.symlink_to(os.path.join("..", "blobs", name + ".blob"))
    assert link.is_symlink()
    return model, link


def test_materializes_onnx_data_external_file(tmp_path):
    # The Qwen3-TTS talker's >2GB weights live in talker_decode.onnx.data —
    # an HF blob symlink that ORT rejects as escaping the model dir.
    payload = np.arange(8, dtype=np.float32).tobytes()
    model, link = _hf_layout(tmp_path, "talker_decode.onnx.data", payload)
    written = hf_symlinks.materialize_symlinks(str(model))
    assert str(link) in written
    assert link.exists() and not link.is_symlink()
    assert link.read_bytes() == payload


def test_suffix_filter_only_touches_matching_names(tmp_path):
    model, bin_link = _hf_layout(tmp_path, "weights.bin")
    _, data_link = _hf_layout(tmp_path, "graph.onnx.data")
    written = hf_symlinks.materialize_symlinks(str(model), suffixes=(".bin",))
    assert written == [str(bin_link)]
    assert not bin_link.is_symlink()      # matched -> real
    assert data_link.is_symlink()          # unmatched -> untouched


def test_none_suffix_derefs_every_symlink(tmp_path):
    model, a = _hf_layout(tmp_path, "talker_decode.onnx")
    _, b = _hf_layout(tmp_path, "talker_decode.onnx.data")
    written = hf_symlinks.materialize_symlinks(str(model))
    assert set(written) == {str(a), str(b)}
    assert not a.is_symlink() and not b.is_symlink()


def test_ignores_real_files_and_is_idempotent(tmp_path):
    model, link = _hf_layout(tmp_path, "graph.onnx.data")
    (model / "already_real.onnx.data").write_bytes(b"\x00" * 8)
    assert hf_symlinks.materialize_symlinks(str(model))        # first derefs the link
    assert hf_symlinks.materialize_symlinks(str(model)) == []  # nothing left to do


def test_tolerates_missing_dir(tmp_path):
    assert hf_symlinks.materialize_symlinks(str(tmp_path / "nope")) == []


def test_leaves_dangling_symlink_untouched(tmp_path):
    model = tmp_path / "onnx"
    model.mkdir()
    dangling = model / "gone.onnx.data"
    dangling.symlink_to(os.path.join("..", "blobs", "missing.blob"))
    assert hf_symlinks.materialize_symlinks(str(model)) == []
    assert dangling.is_symlink()  # caller must fail loudly, not silently drop it


# ── Concurrency: unique per-pid tmp names (two processes materializing the
# ── same dir must never collide on/remove each other's in-progress tmp) ────


def test_replace_failure_cleans_unique_tmp_and_leaves_symlink(tmp_path, monkeypatch):
    """os.replace failing mid-materialize (a Windows sharing violation, or any
    other transient error) must not leave the unique per-pid tmp behind, and
    the original symlink must survive untouched for the caller (or a retry)
    to see — the swap is meant to be atomic-or-nothing."""
    model, link = _hf_layout(tmp_path, "graph.onnx.data")

    def _boom(src, dst):
        raise OSError("simulated os.replace failure")
    monkeypatch.setattr(os, "replace", _boom)
    with pytest.raises(OSError):
        hf_symlinks.materialize_symlinks(str(model))
    assert link.is_symlink()  # untouched — the atomic replace never committed
    assert list(model.glob("graph.onnx.data.tmp*")) == []  # this run's tmp was cleaned up


def test_stale_tmp_from_a_crashed_run_is_swept(tmp_path):
    """A leftover `<file>.tmp<pid>` from a run that crashed before reaching
    os.replace must not accumulate forever — the next materialize() sweeps it
    on sight, even though its pid never matches the current process's."""
    model, _link = _hf_layout(tmp_path, "graph.onnx.data")
    stale = model / "graph.onnx.data.tmp999999999"
    stale.write_bytes(b"leftover from a crashed run")
    hf_symlinks.materialize_symlinks(str(model))
    assert not stale.exists()
