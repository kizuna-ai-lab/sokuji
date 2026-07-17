import os

import numpy as np

from sokuji_sidecar import hf_symlinks


def _hf_layout(tmp_path, name, payload=b"\x01\x02\x03\x04"):
    """Mimic the HF cache: model/<name> symlinks OUT into a sibling ../blobs/."""
    blobs = tmp_path / "blobs"; blobs.mkdir(exist_ok=True)
    model = tmp_path / "onnx"; model.mkdir(exist_ok=True)
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
    model = tmp_path / "onnx"; model.mkdir()
    dangling = model / "gone.onnx.data"
    dangling.symlink_to(os.path.join("..", "blobs", "missing.blob"))
    assert hf_symlinks.materialize_symlinks(str(model)) == []
    assert dangling.is_symlink()  # caller must fail loudly, not silently drop it
