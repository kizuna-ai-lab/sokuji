#!/usr/bin/env python3
"""Boot-smoke one packed sidecar bundle (slice 6 Task 4, workflow half).

Run by the HOST python that built/packed the archive (needs the `zstandard`
package — every bundle-build CI job already does `pip install zstandard`
before calling build-sidecar-bundle.py) — NOT the bundle's own embedded
interpreter, since unpacking has to happen before that interpreter exists on
disk. This script:

  1. Finds the archive scripts/build-sidecar-bundle.py just produced for one
     SKU (joining split `.tar.zst.001/.002/...` parts when present, exactly
     like the packer's PART_LIMIT splitting), and unpacks it into a scratch
     dir (children at root: `python/`, `app/`, `bundle.json` — see that
     script's `pack_zst`).
  2. Re-execs the BUNDLE'S OWN embedded interpreter (the thing a real
     install actually runs — `python/python.exe` on Windows, otherwise
     `python/bin/python3`) to prove:
       (a) `import sokuji_sidecar` succeeds and report its on-disk entry
           point.
       (b) sokuji_native is importable and reports version()/
           engine_versions(). This is a WARN, not a failure, by default:
           until Task 2/3 land the requirements.txt wheel URLs, every
           bundle is "hollow" (native.py imports sokuji_native lazily on
           first use — see its module docstring — precisely so the sidecar
           still boots without it). Pass --require-native, or set
           SIDECAR_SMOKE_REQUIRE_NATIVE=1, to turn a missing sokuji_native
           into a hard failure once the wheel is wired in.
       (c) `python -m sokuji_sidecar` boots to its `{"port": n}` handshake
           line. There is no --version/--help entrypoint (see __main__.py)
           to probe instead, so this full boot is the floor — and it is
           strictly stronger evidence than an import-only check. This is
           exactly what the linux-arm64 CI job already did before Task 4;
           this script generalizes that one job's inline step to all five
           SKUs so every bundle-build job can call it identically.

Usage:
    python scripts/sidecar-bundle-smoke.py --sku linux-arm64 --bundles-dir out/bundles
    python scripts/sidecar-bundle-smoke.py --sku linux-x64 --bundles-dir out/bundles --require-native

Exit 0 on success (a missing sokuji_native is a warning, not a failure,
unless --require-native / SIDECAR_SMOKE_REQUIRE_NATIVE is set). Exit 1 with
a clear message on any real failure. No model downloads; both checks are
bounded well under a minute combined.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading

IMPORT_TIMEOUT_S = 30
BOOT_TIMEOUT_S = 30


class SmokeFailure(RuntimeError):
    pass


def find_archive_parts(bundles_dir: str, sku: str) -> list[str]:
    """Matches build-sidecar-bundle.py's archive_name()/split_parts() naming:
    either the lone `sidecar-<sku>-v<version>.tar.zst`, or its `.001/.002/...`
    split siblings (never both — split_parts() deletes the whole archive).
    A sorted glob orders parts correctly either way (no suffix < ".001")."""
    pattern = str(pathlib.Path(bundles_dir) / f"sidecar-{sku}-v*.tar.zst*")
    parts = sorted(glob.glob(pattern))
    if not parts:
        raise SmokeFailure(f"no archive found for sku={sku} matching {pattern}")
    return parts


def extract_bundle(parts: list[str], dest: pathlib.Path) -> None:
    import zstandard

    joined = dest / "joined.tar.zst"
    with open(joined, "wb") as out:
        for part in parts:
            with open(part, "rb") as f:
                shutil.copyfileobj(f, out)
    with open(joined, "rb") as f, zstandard.ZstdDecompressor().stream_reader(f) as z:
        with tarfile.open(fileobj=z, mode="r|") as t:
            try:
                t.extractall(dest, filter="data")
            except TypeError:
                t.extractall(dest)  # host python predates PEP 706's filter kwarg
    joined.unlink()


def embedded_python(root: pathlib.Path) -> pathlib.Path:
    win = root / "python" / "python.exe"
    return win if win.exists() else root / "python" / "bin" / "python3"


def _readline_with_timeout(stream, timeout: float) -> str | None:
    box: dict = {}

    def _read() -> None:
        box["line"] = stream.readline()

    t = threading.Thread(target=_read, daemon=True)
    t.start()
    t.join(timeout)
    return None if t.is_alive() else box.get("line")


_IMPORT_PROBE = """
import json, pathlib
out = {}
import sokuji_sidecar
out["sokuji_sidecar_entry"] = str(pathlib.Path(sokuji_sidecar.__file__).resolve())
try:
    import sokuji_native
    out["native_version"] = sokuji_native.version()
    out["native_engines"] = sokuji_native.engine_versions()
except ImportError as e:
    out["native_missing"] = str(e)
print(json.dumps(out))
"""


def check_imports(py: pathlib.Path, app_dir: pathlib.Path, require_native: bool) -> None:
    """(a) import sokuji_sidecar, and (b) probe sokuji_native — both pure
    accessors (no sk_init needed for version()/engine_versions()), so this
    stays a single fast subprocess."""
    proc = subprocess.run([str(py), "-c", _IMPORT_PROBE], cwd=str(app_dir),
                          capture_output=True, text=True, timeout=IMPORT_TIMEOUT_S)
    if proc.returncode != 0:
        raise SmokeFailure(
            f"import probe failed (exit {proc.returncode}):\nstdout: {proc.stdout}\nstderr: {proc.stderr}")
    stdout = proc.stdout.strip()
    line = stdout.splitlines()[-1] if stdout else ""
    try:
        data = json.loads(line)
    except json.JSONDecodeError as e:
        raise SmokeFailure(f"import probe printed unparseable output: {proc.stdout!r} ({e})")

    print(f"sokuji_sidecar: OK ({data['sokuji_sidecar_entry']})")
    if "native_version" in data:
        print(f"sokuji_native: {data['native_version']} {data['native_engines']}")
    else:
        msg = f"sokuji_native: MISSING (hollow bundle) - {data.get('native_missing', 'unknown')}"
        if require_native:
            raise SmokeFailure(f"{msg} [required by --require-native/SIDECAR_SMOKE_REQUIRE_NATIVE]")
        print(f"WARNING: {msg}")


def check_boot_handshake(py: pathlib.Path, app_dir: pathlib.Path,
                         timeout: float = BOOT_TIMEOUT_S) -> None:
    """(c) `python -m sokuji_sidecar` to the {"port": n} handshake line —
    same probe the linux-arm64 job already ran inline, now shared by all five."""
    proc = subprocess.Popen([str(py), "-m", "sokuji_sidecar"], cwd=str(app_dir),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        line = _readline_with_timeout(proc.stdout, timeout)
        if line is None:
            raise SmokeFailure(f"sidecar entrypoint printed no handshake line within {timeout}s")
        try:
            port = json.loads(line)["port"]
            if not isinstance(port, int):
                raise TypeError(f"port is {type(port).__name__}, not int")
        except Exception as e:
            raise SmokeFailure(f"unexpected handshake line {line!r}: {e}")
        print(f"sokuji_sidecar boot smoke OK, port {port}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


def smoke_one(sku: str, bundles_dir: str, require_native: bool) -> None:
    tmp = tempfile.mkdtemp(prefix=f"sidecar-smoke-{sku}-")
    try:
        dest = pathlib.Path(tmp)
        parts = find_archive_parts(bundles_dir, sku)
        print(f"[smoke] {sku}: unpacking {len(parts)} part(s)", flush=True)
        extract_bundle(parts, dest)
        py = embedded_python(dest)
        if not py.exists():
            raise SmokeFailure(f"no embedded interpreter at {py}")
        app_dir = dest / "app"
        check_imports(py, app_dir, require_native)
        check_boot_handshake(py, app_dir)
        print(f"[smoke] {sku}: OK", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sku", required=True, help="e.g. linux-x64, mac-arm64, win-x64")
    ap.add_argument("--bundles-dir", default="out/bundles",
                    help="directory containing the packed .tar.zst[.NNN] archive")
    ap.add_argument("--require-native", action="store_true",
                    help="fail (not warn) if sokuji_native is missing from the bundle")
    args = ap.parse_args(argv)
    require_native = args.require_native or bool(os.environ.get("SIDECAR_SMOKE_REQUIRE_NATIVE"))
    try:
        smoke_one(args.sku, args.bundles_dir, require_native)
    except SmokeFailure as e:
        print(f"[smoke] {args.sku}: FAILED - {e}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
