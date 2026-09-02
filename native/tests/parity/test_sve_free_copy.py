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


def test_no_refresh_when_nothing_in_the_source_changed(tmp_path, monkeypatch):
    """An unchanged source must be a no-op — the cached files are reused, not recopied.

    Proven by inode identity rather than by a sentinel file dropped into the cache dir: the
    freshness signature now covers the WHOLE copied set (M-2), so a foreign sentinel inside
    the cache dir is itself a difference and would legitimately force a refresh. A refresh
    rmtree()s the dir and copies fresh files in, so a surviving inode is exactly the
    'did not recopy' evidence."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = _make_source(tmp_path, "src", b"stable",
                       extra_files={"libggml-cpu-armv8.2_2.so": b"module"})
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    before = {p.name: p.stat().st_ino for p in dst.iterdir()}

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    assert {p.name: p.stat().st_ino for p in dst.iterdir()} == before


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


# ── M-2: freshness must cover every copied file, not just the key file ────────────────
# ggml dlopen's the CPU/GPU backend modules by directory search at runtime, so the parity
# run's actual behaviour can change with libsokuji_native.so byte-identical. A key-file-only
# freshness check reused the stale copy in exactly that case.

def test_changed_backend_module_refreshes_even_with_an_untouched_key_file(tmp_path, monkeypatch):
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = _make_source(tmp_path, "src", b"key-stays-identical",
                       extra_files={"libggml-cpu-armv8.2_2.so": b"module-v1"})
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    key_stat_before = (src / "libsokuji_native.so").stat()

    (src / "libggml-cpu-armv8.2_2.so").write_bytes(b"module-v2-rebuilt-differently")

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    # The key file really was untouched — the refresh came from the module alone.
    assert (src / "libsokuji_native.so").stat().st_mtime == key_stat_before.st_mtime
    assert (dst / "libggml-cpu-armv8.2_2.so").read_bytes() == b"module-v2-rebuilt-differently"


def test_added_backend_module_refreshes_the_cache(tmp_path, monkeypatch):
    """A build that gains a module (e.g. a Vulkan lane's libggml-vulkan.so appearing next to
    an otherwise identical libsokuji_native.so) must not keep serving the older copy."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = _make_source(tmp_path, "src", b"key")
    dst = parity._sve_free_copy(src, "libsokuji_native.so")
    assert not (dst / "libggml-vulkan.so").exists()

    (src / "libggml-vulkan.so").write_bytes(b"new-backend-module")

    dst2 = parity._sve_free_copy(src, "libsokuji_native.so")

    assert dst2 == dst
    assert (dst / "libggml-vulkan.so").read_bytes() == b"new-backend-module"


# ── T2 leftover (a): the exclusion itself was never covered ───────────────────────────

def test_sve_modules_are_excluded_from_the_copy(tmp_path, monkeypatch):
    """The whole point of this copy: the three SVE-capable CPU modules must NOT reach the
    cache dir, so ggml cannot pick one and compare a broken tier against a correct one. Every
    other file must."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    assert parity.SVE_CPU_MODULES, "the exclusion list must not be empty"
    extras = {name: b"sve-module" for name in parity.SVE_CPU_MODULES}
    extras["libggml-cpu-armv8.2_2.so"] = b"kept-module"
    src = _make_source(tmp_path, "src", b"key", extra_files=extras)

    dst = parity._sve_free_copy(src, "libsokuji_native.so")

    for name in parity.SVE_CPU_MODULES:
        assert not (dst / name).exists(), f"{name} must be excluded from the SVE-free copy"
    assert (dst / "libggml-cpu-armv8.2_2.so").read_bytes() == b"kept-module"
    assert (dst / "libsokuji_native.so").read_bytes() == b"key"
    # ...and their presence/absence in the SOURCE must not itself churn the cache: removing
    # one changes nothing about what was copied.
    before = {p.name: p.stat().st_ino for p in dst.iterdir()}
    (src / next(iter(sorted(parity.SVE_CPU_MODULES)))).unlink()
    parity._sve_free_copy(src, "libsokuji_native.so")
    assert {p.name: p.stat().st_ino for p in dst.iterdir()} == before


def test_wrong_directory_fails_loudly(tmp_path, monkeypatch):
    """key_file no longer keys the cache; it is the caller's assertion about which directory
    this is. A directory that lacks it is a caller bug, not a silent empty copy."""
    monkeypatch.setattr(parity, "CACHE_DIR", tmp_path / "cache")
    src = tmp_path / "empty"
    src.mkdir()
    (src / "something-else.so").write_bytes(b"x")
    try:
        parity._sve_free_copy(src, "libsokuji_native.so")
    except AssertionError as e:
        assert "libsokuji_native.so" in str(e) and str(src) in str(e)
    else:
        raise AssertionError("expected an AssertionError naming the missing key file")
