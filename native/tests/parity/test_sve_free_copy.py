"""Regression coverage for the 2026-09-02 SVE-free cache contamination incident (see
test_tts_parity.py's `_sve_free_copy` docstring for the full incident writeup): a scratch
build under a different source path, with a newer key-file mtime than the real staged
build's cached copy, silently overwrote the ONE shared cache dir that both builds used —
and left a foreign extra file (libggml-vulkan.so) behind that a later refresh never cleaned
up. These tests exercise `_sve_free_copy` directly against tmp source dirs so no built
native tree is required to run them.
"""
from __future__ import annotations

import os
import pathlib

import test_tts_parity as parity


def _make_source(tmp_path: pathlib.Path, name: str, key_content: bytes,
                  extra_files: dict[str, bytes] | None = None) -> pathlib.Path:
    src = tmp_path / name
    src.mkdir()
    (src / "libsokuji_native.so").write_bytes(key_content)
    for fname, content in (extra_files or {}).items():
        (src / fname).write_bytes(content)
    return src


def test_different_sources_never_share_a_cache_even_with_newer_wrong_mtime(tmp_path, monkeypatch):
    """Two distinct source dirs must get two distinct cache dirs, even when the 'wrong' one
    (a scratch build under a different path) has a strictly NEWER key-file mtime than the
    'right' one's already-cached copy. Under the old `mtime >= cached_mtime` shared-path
    scheme, calling _sve_free_copy for `wrong_src` after priming the cache from `right_src`
    would have refreshed the SAME cache dir from wrong_src's content — exactly the 2026-09-02
    contamination. Keying by the source dir's own resolved path makes that impossible: the two
    sources physically cannot land in the same slot."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")

    right_src = _make_source(tmp_path, "right", b"RIGHT-CONTENT")
    wrong_src = _make_source(tmp_path, "wrong", b"WRONG-CONTENT")

    right_dst = parity._sve_free_copy(right_src, "libsokuji_native.so")
    assert (right_dst / "libsokuji_native.so").read_bytes() == b"RIGHT-CONTENT"

    # Give wrong_src's key file a mtime far newer than right_dst's cached copy.
    newer = (right_dst / "libsokuji_native.so").stat().st_mtime + 1000
    os.utime(wrong_src / "libsokuji_native.so", (newer, newer))

    wrong_dst = parity._sve_free_copy(wrong_src, "libsokuji_native.so")

    assert wrong_dst != right_dst
    assert (right_dst / "libsokuji_native.so").read_bytes() == b"RIGHT-CONTENT", (
        "right_src's cache copy must survive untouched by a call for a different source dir"
    )
    assert (wrong_dst / "libsokuji_native.so").read_bytes() == b"WRONG-CONTENT"


def test_refresh_removes_stale_extra_files(tmp_path, monkeypatch):
    """A refresh (triggered by the key file's mtime or size changing) must wipe the cache
    dir's previous contents before recopying, so a foreign file left behind by an earlier
    source layout (the incident's stray libggml-vulkan.so) cannot survive a refresh."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")

    src = _make_source(tmp_path, "src", b"v1", extra_files={"libggml-cpu-armv8.2_2.so": b"module-v1"})
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    assert (dst / "libggml-cpu-armv8.2_2.so").exists()

    # Simulate a foreign file already sitting in the cache dir from an earlier, unrelated copy.
    (dst / "libggml-vulkan.so").write_bytes(b"foreign-leftover")

    # Force a refresh via a size change (also drop the extra module, as a rebuild might).
    (src / "libsokuji_native.so").write_bytes(b"v2-longer-content")
    (src / "libggml-cpu-armv8.2_2.so").unlink()

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    assert (dst / "libsokuji_native.so").read_bytes() == b"v2-longer-content"
    assert not (dst / "libggml-vulkan.so").exists(), "stale foreign file must not survive a refresh"
    assert not (dst / "libggml-cpu-armv8.2_2.so").exists(), "extra file dropped from source must not survive a refresh"


def test_no_refresh_when_key_mtime_and_size_unchanged(tmp_path, monkeypatch):
    """When the key file's mtime AND size both match the cached copy, _sve_free_copy must be
    a no-op — it must not touch the cache dir at all."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = _make_source(tmp_path, "src", b"stable")
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    sentinel = dst / "sentinel.txt"
    sentinel.write_text("must survive an unnecessary refresh")

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    assert sentinel.exists()


def test_size_change_with_same_mtime_still_triggers_refresh(tmp_path, monkeypatch):
    """Even if the key file's mtime is somehow preserved, a size difference alone must be
    enough to trigger a refresh (the brief's 'mtime OR size' requirement)."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = _make_source(tmp_path, "src", b"short")
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    cached_mtime = (dst / "libsokuji_native.so").stat().st_mtime

    key = src / "libsokuji_native.so"
    key.write_bytes(b"a much longer replacement payload")
    os.utime(key, (cached_mtime, cached_mtime))

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    assert (dst / "libsokuji_native.so").read_bytes() == b"a much longer replacement payload"
