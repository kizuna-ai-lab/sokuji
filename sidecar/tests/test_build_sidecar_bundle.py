"""Pure-helper tests for the bundle build script. The full linux build is a
manual acceptance step in the plan (needs network + wheels), not a unit test."""
import importlib.util
import json
import pathlib
import platform
import re

import pytest

# scripts/build-sidecar-bundle.py has a hyphen in its filename (it doubles as
# a CLI entry point invoked as `python scripts/build-sidecar-bundle.py ...`
# from CI), so it is not a valid `import` target — a plain `import
# build_sidecar_bundle` can never resolve a hyphenated file. Load it directly
# from its path instead, bound to the same `b` name the tests below use.
_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "build-sidecar-bundle.py"
_spec = importlib.util.spec_from_file_location("build_sidecar_bundle", _SCRIPT)
b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b)


def test_sku_triple_mapping():
    assert b.SKU_TRIPLE["linux-nvidia"] == "x86_64-unknown-linux-gnu"
    assert b.SKU_TRIPLE["win-nvidia"] == "x86_64-pc-windows-msvc"
    assert b.SKU_TRIPLE["win-directml"] == "x86_64-pc-windows-msvc"
    assert b.SKU_TRIPLE["mac"] == "aarch64-apple-darwin"


def test_sku_requirements_mapping():
    assert b.sku_requirements("linux-nvidia") == "requirements-nvidia.txt"
    assert b.sku_requirements("win-nvidia") == "requirements-nvidia.txt"
    assert b.sku_requirements("win-directml") == "requirements-directml.txt"
    assert b.sku_requirements("mac") == "requirements-mac.txt"
    with pytest.raises(KeyError):
        b.sku_requirements("bogus")


def test_select_python_asset_picks_install_only_not_stripped():
    assets = [
        {"name": "cpython-3.12.8+20241219-x86_64-unknown-linux-gnu-install_only.tar.gz",
         "browser_download_url": "URL-A"},
        {"name": "cpython-3.12.8+20241219-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
         "browser_download_url": "URL-STRIPPED"},
        {"name": "cpython-3.12.8+20241219-x86_64-pc-windows-msvc-install_only.tar.gz",
         "browser_download_url": "URL-WIN"},
        {"name": "cpython-3.11.9+20240101-x86_64-unknown-linux-gnu-install_only.tar.gz",
         "browser_download_url": "URL-OLD-SERIES"},
    ]
    assert b.select_python_asset(assets, "x86_64-unknown-linux-gnu") == "URL-A"
    assert b.select_python_asset(assets, "x86_64-pc-windows-msvc") == "URL-WIN"
    with pytest.raises(SystemExit):
        b.select_python_asset(assets, "aarch64-apple-darwin")


def test_bundle_dirname():
    assert b.bundle_dirname("linux-nvidia", "0.30.6") == "sidecar-linux-nvidia-v0.30.6"


def test_host_supports_sku_matches_platform():
    assert b.host_supports_sku("linux-nvidia") == (platform.system() == "Linux")
    assert b.host_supports_sku("win-nvidia") == (platform.system() == "Windows")
    assert b.host_supports_sku("mac") == (
        platform.system() == "Darwin" and platform.machine() == "arm64")


import hashlib
import io as _io
import tarfile as _tarfile


def test_archive_name_matches_js_contract():
    assert b.archive_name("linux-nvidia", "0.30.6") == "sidecar-linux-nvidia-v0.30.6.tar.zst"


def test_pack_zst_round_trips_with_children_at_root(tmp_path):
    src = tmp_path / "sidecar-x-v1"
    (src / "app").mkdir(parents=True)
    (src / "app" / "hi.txt").write_text("hi")
    (src / "bundle.json").write_text('{"sku":"x"}')
    out = tmp_path / "b.tar.zst"
    b.pack_zst(str(src), str(out))
    assert out.exists() and out.stat().st_size > 0
    import zstandard
    with open(out, "rb") as f, zstandard.ZstdDecompressor().stream_reader(f) as z:
        data = z.read()
    with _tarfile.open(fileobj=_io.BytesIO(data)) as t:
        names = sorted(t.getnames())
    assert "app/hi.txt" in names and "bundle.json" in names
    # Children live at the archive root - no "sidecar-x-v1/" wrapper dir.
    assert not any(n.startswith("sidecar-x-v1/") for n in names)


def test_build_manifest_fields(tmp_path):
    m = b.build_manifest(
        "mac", "0.1.0", sha256="ab" * 32, size=7, installed_size=20,
        parts=[{"name": "sidecar-mac-v0.1.0.tar.zst", "size": 7, "sha256": "cd" * 32}])
    assert m == {
        "sku": "mac", "version": "0.1.0", "sha256": "ab" * 32, "size": 7,
        "installedSize": 20,
        "parts": [{"name": "sidecar-mac-v0.1.0.tar.zst", "size": 7, "sha256": "cd" * 32}],
    }


def test_pack_zst_dereferences_symlinks(tmp_path):
    """A source tree with a symlink must produce a symlink-FREE archive:
    the JS extractor writes regular files only, so bin/python3-style symlinks
    would otherwise land as empty files and break boot."""
    src = tmp_path / "tree"
    src.mkdir()
    (src / "real.txt").write_text("payload")
    (src / "link.txt").symlink_to("real.txt")  # relative symlink, like pbs bin/python3
    out = tmp_path / "out.tar.zst"
    b.pack_zst(str(src), str(out))
    import zstandard
    with open(out, "rb") as f, zstandard.ZstdDecompressor().stream_reader(f) as z:
        data = z.read()
    with _tarfile.open(fileobj=_io.BytesIO(data)) as t:
        members = t.getmembers()
    assert not any(m.issym() or m.islnk() for m in members), "archive must be symlink-free"
    names = {m.name for m in members}
    assert "real.txt" in names and "link.txt" in names
    # the dereferenced link carries the target's content
    link_member = next(m for m in members if m.name == "link.txt")
    assert link_member.isfile() and link_member.size == len("payload")


def test_merge_manifests_uniform_version_sorted_by_sku():
    agg = b.merge_manifests([
        {"sku": "win-directml", "version": "0.1.0"},
        {"sku": "linux-nvidia", "version": "0.1.0"},
    ])
    assert agg["version"] == "0.1.0"
    assert [e["sku"] for e in agg["bundles"]] == ["linux-nvidia", "win-directml"]


def test_merge_manifests_rejects_mixed_versions():
    with pytest.raises(SystemExit):
        b.merge_manifests([
            {"sku": "mac", "version": "0.1.0"},
            {"sku": "linux-nvidia", "version": "0.2.0"},
        ])


def test_default_version_reads_package_json(tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"version": "9.9.9", "sidecarVersion": "0.1.0"}))
    assert b.default_version(str(tmp_path)) == "0.1.0"


def test_default_version_missing_field_exits(tmp_path):
    (tmp_path / "package.json").write_text(json.dumps({"version": "9.9.9"}))
    with pytest.raises(SystemExit):
        b.default_version(str(tmp_path))


def test_repo_package_json_declares_sidecar_version():
    root = pathlib.Path(__file__).resolve().parents[2]
    pkg = json.loads((root / "package.json").read_text())
    assert re.fullmatch(r"\d+\.\d+\.\d+", pkg["sidecarVersion"])


def test_split_parts_single_when_under_limit(tmp_path):
    arc = tmp_path / "sidecar-mac-v1.tar.zst"
    arc.write_bytes(b"A" * 100)
    parts = b.split_parts(str(arc), limit=1000)
    assert parts == [{"name": "sidecar-mac-v1.tar.zst", "size": 100,
                      "sha256": hashlib.sha256(b"A" * 100).hexdigest()}]
    assert arc.exists()  # single part: the archive itself is the part


def test_split_parts_chunks_when_over_limit(tmp_path):
    arc = tmp_path / "sidecar-linux-nvidia-v1.tar.zst"
    payload = bytes(range(256)) * 40  # 10240 bytes
    arc.write_bytes(payload)
    parts = b.split_parts(str(arc), limit=4096)
    assert [p["name"] for p in parts] == [
        "sidecar-linux-nvidia-v1.tar.zst.001",
        "sidecar-linux-nvidia-v1.tar.zst.002",
        "sidecar-linux-nvidia-v1.tar.zst.003",
    ]
    assert [p["size"] for p in parts] == [4096, 4096, 2048]
    assert not arc.exists()  # multi-part: the whole archive is replaced by parts
    joined = b"".join((tmp_path / p["name"]).read_bytes() for p in parts)
    assert joined == payload
    for p in parts:
        assert p["sha256"] == hashlib.sha256(
            (tmp_path / p["name"]).read_bytes()).hexdigest()


def test_part_limit_leaves_headroom_under_github_2gib():
    assert b.PART_LIMIT == int(1.9 * 1024 ** 3)
    assert b.PART_LIMIT < 2 * 1024 ** 3


def test_dir_size_walks(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "a").write_bytes(b"12345")
    (tmp_path / "sub" / "b").write_bytes(b"123")
    assert b.dir_size(str(tmp_path)) == 8


def test_cli_merge_fragments(tmp_path):
    f1 = tmp_path / "a.json"
    f1.write_text(json.dumps({"sku": "mac", "version": "0.1.0"}))
    f2 = tmp_path / "b.json"
    f2.write_text(json.dumps({"sku": "linux-nvidia", "version": "0.1.0"}))
    out = tmp_path / "manifest.json"
    assert b._main(["--merge-fragments", str(f1), str(f2),
                    "--merged-out", str(out)]) == 0
    merged = json.loads(out.read_text())
    assert merged["version"] == "0.1.0" and len(merged["bundles"]) == 2


def test_pbs_release_request_carries_ci_token_when_present():
    req = b._pbs_release_request(env={"GITHUB_TOKEN": "tok-123"})
    assert req.get_header("Authorization") == "Bearer tok-123"
    req = b._pbs_release_request(env={"GH_TOKEN": "tok-456"})
    assert req.get_header("Authorization") == "Bearer tok-456"


def test_pbs_release_request_anonymous_without_token():
    req = b._pbs_release_request(env={})
    assert req.get_header("Authorization") is None
    assert req.full_url == b._PBS_LATEST


def test_bundle_python_exe_absolute_even_for_relative_prefix(tmp_path, monkeypatch):
    """The pip subprocesses run with cwd=sidecar/ — a relative interpreter path
    (CI passes --out out/bundles) would dangle after the chdir (POSIX resolves
    the exe in the child's NEW cwd). Locally this hid behind absolute --out."""
    monkeypatch.chdir(tmp_path)
    rel = pathlib.Path("python")
    (rel / "bin").mkdir(parents=True)
    (rel / "bin" / "python3").write_text("")
    got = b._bundle_python_exe(pathlib.Path("python"))
    assert got.is_absolute()
    assert got == tmp_path / "python" / "bin" / "python3"
