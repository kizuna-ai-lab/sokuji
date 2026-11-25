"""native/ci/make_app_archive.py: the per-SKU app archive, its .sha256 and the release manifest.

Run by native/ci/build.sh and build.ps1 with the other Python tests. Everything here builds a
fake stage in a temp directory; no native build is needed.

    python -m pytest native/tests/test_make_app_archive.py -q

The archive is what plan 3 downloads and unpacks into the app's native directory, so its layout
is a contract: one top-level directory `sokuji-native-<sku>-v<version>/` holding the flat stage
(libraries, backend modules, contract.json), `sokuji_native_node.node` and `NOTICES.txt`; and it
must be reproducible (same stage in, same bytes out).
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile

import pytest
import zstandard

NATIVE = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = NATIVE / "ci" / "make_app_archive.py"
NOTICES_IN = NATIVE / "ci" / "NOTICES.in"

SKU = "linux-x64"
VERSION = "9.9.9"
TOP = f"sokuji-native-{SKU}-v{VERSION}"
ARCHIVE = f"{TOP}.tar.zst"
STAGE_FILES = ("libsokuji_native.so", "contract.json", "sokuji_native_node.node")
UPSTREAMS = ("ggml", "llama.cpp", "transcribe.cpp", "audio.cpp", "node-addon-api",
             "node-api-headers", "SpeexDSP", "miniz", "cJSON", "libyaml", "sentencepiece")


def notices_entries():
    """(name, path template) for each line of the real NOTICES.in: `name | path`."""
    out = []
    for line in NOTICES_IN.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            name, _, path = line.partition("|")
            out.append((name.strip(), path.strip()))
    return out


def make_stage(tmp_path, version=VERSION, files=STAGE_FILES):
    """A fake `<build>/app-stage` plus the fake build tree the real NOTICES.in points into.

    The script finds the build tree as the parent of the stage (its default), so no flags are
    needed. @BUILD@ licenses are created with a recognisable body; @SRC@ ones are the real files.
    """
    build = tmp_path / "build"
    stage = build / "app-stage"
    stage.mkdir(parents=True)
    for name in files:
        if name == "contract.json":
            (stage / name).write_text(json.dumps({"abi": 2, "version": version, "lane": "cpu"}))
        else:
            (stage / name).write_bytes(b"\x7fELF fake " + name.encode())
    for name, path in notices_entries():
        if path.startswith("@BUILD@/"):
            lic = build / path[len("@BUILD@/"):]
            lic.parent.mkdir(parents=True, exist_ok=True)
            lic.write_text(f"LICENSE-BODY-OF-{name}\n", encoding="utf-8")
    return stage


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True, timeout=120)


def make_archive(tmp_path, out_name="out", **kw):
    stage = make_stage(tmp_path, **kw)
    out = tmp_path / out_name
    r = run(stage, SKU, VERSION, out)
    return stage, out, r


def read_archive(path):
    """[(TarInfo, bytes|None)] in archive order."""
    entries = []
    with open(path, "rb") as f:
        with zstandard.ZstdDecompressor().stream_reader(f) as reader:
            with tarfile.open(fileobj=reader, mode="r|") as tar:
                for info in tar:
                    data = tar.extractfile(info).read() if info.isreg() else None
                    entries.append((info, data))
    return entries


# --------------------------------------------------------------------------- layout

def test_archive_holds_exactly_the_flat_stage_plus_notices(tmp_path):
    _, out, r = make_archive(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert (out / ARCHIVE).is_file()
    names = [info.name for info, _ in read_archive(out / ARCHIVE)]
    assert sorted(names) == sorted(f"{TOP}/{n}" for n in (*STAGE_FILES, "NOTICES.txt"))
    # Exactly the archive and its checksum land in the output directory.
    assert sorted(p.name for p in out.iterdir()) == [ARCHIVE, ARCHIVE + ".sha256"]


def test_sha256_file_matches_the_archive(tmp_path):
    _, out, r = make_archive(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    digest = hashlib.sha256((out / ARCHIVE).read_bytes()).hexdigest()
    # `sha256sum -c` format: "<hex>  <file name>".
    assert (out / (ARCHIVE + ".sha256")).read_text() == f"{digest}  {ARCHIVE}\n"


def test_stage_files_are_stored_byte_for_byte(tmp_path):
    stage, out, r = make_archive(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    got = {info.name: data for info, data in read_archive(out / ARCHIVE)}
    for name in STAGE_FILES:
        assert got[f"{TOP}/{name}"] == (stage / name).read_bytes()


def test_entries_are_normalised_for_reproducibility(tmp_path):
    _, out, r = make_archive(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    entries = [info for info, _ in read_archive(out / ARCHIVE)]
    assert [i.name for i in entries] == sorted(i.name for i in entries)
    for i in entries:
        assert i.isreg()
        assert (i.mtime, i.uid, i.gid, i.uname, i.gname) == (0, 0, 0, "", ""), i.name
        want = 0o755 if i.name.endswith((".so", ".node")) else 0o644
        assert i.mode == want, (i.name, oct(i.mode))


def test_archive_is_reproducible(tmp_path):
    stage, out1, r1 = make_archive(tmp_path, "out1")
    assert r1.returncode == 0, r1.stdout + r1.stderr
    # Different mtimes and a different output directory must not change a single byte.
    for p in stage.iterdir():
        os.utime(p, (1_700_000_000, 1_700_000_000))
    r2 = run(stage, SKU, VERSION, tmp_path / "out2")
    assert r2.returncode == 0, r2.stdout + r2.stderr
    assert (out1 / ARCHIVE).read_bytes() == (tmp_path / "out2" / ARCHIVE).read_bytes()
    assert (out1 / (ARCHIVE + ".sha256")).read_text() == (tmp_path / "out2" / (ARCHIVE + ".sha256")).read_text()


# --------------------------------------------------------------------------- notices

def test_notices_input_names_every_upstream_and_its_sources_exist():
    entries = dict(notices_entries())
    for name in UPSTREAMS:
        assert name in entries, f"NOTICES.in lacks {name}"
    for name, path in entries.items():
        if path.startswith("@SRC@/"):
            assert (NATIVE / path[len("@SRC@/"):]).is_file(), f"{name}: {path} is not in the source tree"
        else:
            assert path.startswith("@BUILD@/_deps/"), f"{name}: unexpected path {path}"


def test_notices_txt_carries_each_license_text(tmp_path):
    _, out, r = make_archive(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    notices = {i.name: d for i, d in read_archive(out / ARCHIVE)}[f"{TOP}/NOTICES.txt"].decode("utf-8")
    for name, path in notices_entries():
        assert name in notices
        if path.startswith("@BUILD@/"):
            assert f"LICENSE-BODY-OF-{name}" in notices
        else:
            assert (NATIVE / path[len("@SRC@/"):]).read_text(encoding="utf-8").strip() in notices
    assert "\r" not in notices


def test_a_missing_license_file_fails(tmp_path):
    stage = make_stage(tmp_path)
    victim = next(p for n, p in notices_entries() if p.startswith("@BUILD@/"))
    (tmp_path / "build" / victim[len("@BUILD@/"):]).unlink()
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert r.returncode != 0
    assert "license" in (r.stdout + r.stderr).lower()
    assert not (tmp_path / "out" / ARCHIVE).exists()


# --------------------------------------------------------------------------- refusals

def assert_refused(tmp_path, r, needle):
    assert r.returncode != 0, r.stdout + r.stderr
    assert needle in r.stdout + r.stderr
    out = tmp_path / "out"
    leftovers = sorted(p.name for p in out.iterdir()) if out.exists() else []
    assert leftovers == [], f"a failed run left {leftovers}"


def test_stage_without_the_node_file_fails(tmp_path):
    stage = make_stage(tmp_path, files=("libsokuji_native.so", "contract.json"))
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "sokuji_native_node.node")


def test_stage_without_contract_json_fails(tmp_path):
    stage = make_stage(tmp_path, files=("libsokuji_native.so", "sokuji_native_node.node"))
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "contract.json")


def test_stage_without_the_native_library_fails(tmp_path):
    stage = make_stage(tmp_path, files=("contract.json", "sokuji_native_node.node"))
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "sokuji_native")


@pytest.mark.parametrize("lib", ["libsokuji_native.dylib", "sokuji_native.dll"])
def test_the_native_library_may_be_any_platform_name(tmp_path, lib):
    stage = make_stage(tmp_path, files=(lib, "contract.json", "sokuji_native_node.node"))
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert r.returncode == 0, r.stdout + r.stderr


def test_contract_version_must_match_the_archive_version(tmp_path):
    stage = make_stage(tmp_path, version="1.0.0")
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "1.0.0")


def test_a_nested_directory_in_the_stage_fails(tmp_path):
    stage = make_stage(tmp_path)
    (stage / "sub").mkdir()
    (stage / "sub" / "x.so").write_bytes(b"x")
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "flat")


def test_a_stage_that_already_has_notices_fails(tmp_path):
    stage = make_stage(tmp_path)
    (stage / "NOTICES.txt").write_text("stale")
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "NOTICES.txt")


def test_a_symlink_in_the_stage_fails(tmp_path):
    stage = make_stage(tmp_path)
    (stage / "link.so").symlink_to(stage / "libsokuji_native.so")
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "flat")


def test_an_unknown_placeholder_in_notices_in_fails(tmp_path):
    stage = make_stage(tmp_path)
    bad = tmp_path / "bad.in"
    bad.write_text("x | @NOPE@/LICENSE\n")
    r = run(stage, SKU, VERSION, tmp_path / "out", "--notices-in", bad)
    assert_refused(tmp_path, r, "placeholder")


def test_a_build_path_containing_an_at_sign_is_fine(tmp_path):
    stage = make_stage(tmp_path / "a@b")
    r = run(stage, SKU, VERSION, tmp_path / "out")
    assert r.returncode == 0, r.stdout + r.stderr


def test_a_missing_stage_fails(tmp_path):
    r = run(tmp_path / "no-such-stage", SKU, VERSION, tmp_path / "out")
    assert_refused(tmp_path, r, "no-such-stage")


@pytest.mark.parametrize("sku,version", [("Linux X64", VERSION), ("linux-x64", "v9.9.9"), ("linux-x64", "9.9")])
def test_malformed_sku_or_version_fails(tmp_path, sku, version):
    stage = make_stage(tmp_path)
    r = run(stage, sku, version, tmp_path / "out")
    assert r.returncode != 0
    assert not (tmp_path / "out").exists() or not any((tmp_path / "out").iterdir())


def test_wrong_argument_count_fails(tmp_path):
    r = run(tmp_path, SKU, VERSION)
    assert r.returncode != 0
    assert "usage" in (r.stdout + r.stderr).lower()


# --------------------------------------------------------------------------- manifest

def make_release_dir(tmp_path, skus=("linux-x64", "mac-arm64"), version=VERSION):
    """A directory like the release job's: archives + .sha256 files (+ a wheel that must be ignored)."""
    rel = tmp_path / "release"
    for n, sku in enumerate(skus):
        sub = tmp_path / f"stage{n}"
        sub.mkdir()
        stage = make_stage(sub, version=version)
        r = run(stage, sku, version, rel)
        assert r.returncode == 0, r.stdout + r.stderr
    (rel / "sokuji_native-1.2.0-py3-none-any.whl").write_bytes(b"not an archive")
    return rel


def test_manifest_lists_every_archive_with_its_hash_and_size(tmp_path):
    rel = make_release_dir(tmp_path)
    r = run("--manifest", rel, VERSION)
    assert r.returncode == 0, r.stdout + r.stderr
    manifest = json.loads((rel / "manifest.json").read_text())
    assert manifest == {
        "version": VERSION,
        "archives": {
            sku: {"file": f"sokuji-native-{sku}-v{VERSION}.tar.zst",
                  "sha256": hashlib.sha256((rel / f"sokuji-native-{sku}-v{VERSION}.tar.zst").read_bytes()).hexdigest(),
                  "size": (rel / f"sokuji-native-{sku}-v{VERSION}.tar.zst").stat().st_size}
            for sku in ("linux-x64", "mac-arm64")
        },
    }


def test_manifest_refuses_a_checksum_that_does_not_match_the_archive(tmp_path):
    rel = make_release_dir(tmp_path)
    sha = rel / f"sokuji-native-linux-x64-v{VERSION}.tar.zst.sha256"
    sha.write_text(f"{'0' * 64}  sokuji-native-linux-x64-v{VERSION}.tar.zst\n")
    r = run("--manifest", rel, VERSION)
    assert r.returncode != 0
    assert "sha256" in r.stdout + r.stderr
    assert not (rel / "manifest.json").exists()


def test_manifest_refuses_an_archive_of_another_version(tmp_path):
    rel = make_release_dir(tmp_path)
    r = run("--manifest", rel, "1.2.1")
    assert r.returncode != 0
    assert not (rel / "manifest.json").exists()


def test_manifest_refuses_an_archive_without_a_checksum(tmp_path):
    rel = make_release_dir(tmp_path)
    (rel / f"sokuji-native-mac-arm64-v{VERSION}.tar.zst.sha256").unlink()
    r = run("--manifest", rel, VERSION)
    assert r.returncode != 0
    assert not (rel / "manifest.json").exists()


def test_manifest_refuses_a_directory_without_archives(tmp_path):
    (tmp_path / "empty").mkdir()
    r = run("--manifest", tmp_path / "empty", VERSION)
    assert r.returncode != 0
    assert "no archives" in (r.stdout + r.stderr).lower()


# --------------------------------------------------------------------------- the Linux floor

CHECK_LINUX_DEPS = NATIVE / "ci" / "check_linux_deps.py"


@pytest.mark.skipif(not sys.platform.startswith("linux") or shutil.which("readelf") is None,
                    reason="the floor check reads ELF files with readelf")
def test_linux_floor_check_covers_the_node_addon(tmp_path):
    """sokuji_native_node.node has no `.so` in its name; the check must still read it.

    Stand-in ELF: this interpreter, which references a glibc newer than the 2.17 floor used
    here. As `x.so` the check must object (the control), and as the addon it must too.
    """
    def check(name):
        stage = tmp_path / name.replace(".", "_")
        stage.mkdir()
        shutil.copy(sys.executable, stage / name)
        return subprocess.run([sys.executable, str(CHECK_LINUX_DEPS), str(stage), "manylinux_2_17_x86_64"],
                              capture_output=True, text=True, timeout=120)

    control = check("x.so")
    if control.returncode == 0:
        pytest.skip("this interpreter references no glibc symbol newer than 2.17")
    r = check("sokuji_native_node.node")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "sokuji_native_node.node: references GLIBC_" in r.stdout


def test_manifest_refuses_a_malformed_checksum_line(tmp_path):
    rel = make_release_dir(tmp_path)
    (rel / f"sokuji-native-linux-x64-v{VERSION}.tar.zst.sha256").write_text("not a checksum line\n")
    r = run("--manifest", rel, VERSION)
    assert r.returncode != 0
    assert "sha256" in r.stdout + r.stderr
    assert not (rel / "manifest.json").exists()
