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
import queue
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

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


def _decode(x) -> str:
    """subprocess.TimeoutExpired's .stdout/.stderr are str when the call used
    text=True, like ours — but stay defensive: decode if bytes, empty if None."""
    if x is None:
        return ""
    return x.decode(errors="replace") if isinstance(x, bytes) else x


def _iter_lines_with_deadline(stream, deadline: float):
    """Yields lines from `stream` until EOF or `deadline` (a time.monotonic()
    cutoff) passes. The blocking readline() runs in a background daemon
    thread so a hung child can't block the main thread past the deadline;
    the thread exits on its own once the stream closes (EOF) or a caller
    stops pulling from this generator, so nothing needs joining."""
    q: queue.Queue = queue.Queue()

    def _pump() -> None:
        try:
            for line in iter(stream.readline, ""):
                q.put(line)
        finally:
            q.put(None)  # EOF sentinel

    threading.Thread(target=_pump, daemon=True).start()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        try:
            line = q.get(timeout=remaining)
        except queue.Empty:
            return
        if line is None:
            return
        yield line


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
    try:
        proc = subprocess.run([str(py), "-c", _IMPORT_PROBE], cwd=str(app_dir),
                              capture_output=True, text=True, timeout=IMPORT_TIMEOUT_S)
    except subprocess.TimeoutExpired as e:
        raise SmokeFailure(
            f"import probe did not finish within {IMPORT_TIMEOUT_S}s:\n"
            f"stdout: {_decode(e.stdout)}\nstderr: {_decode(e.stderr)}") from e
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
    same probe the linux-arm64 job already ran inline, now shared by all five.

    Tolerant of stray non-JSON output before the handshake (a stray
    DeprecationWarning etc. must never masquerade as a bad handshake): reads
    lines until one parses as {"port": <int>, ...}, bounded by `timeout`
    overall. Non-handshake lines are kept either way — printed as a WARNING
    after a successful handshake, or folded into the failure message
    (tail, after draining whatever the child had buffered post-kill) when
    the handshake never arrives. stdout/stderr stay merged (simplest); a
    genuine boot hang is the failure most in need of a log."""
    proc = subprocess.Popen([str(py), "-m", "sokuji_sidecar"], cwd=str(app_dir),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    seen: list[str] = []
    port = None
    try:
        deadline = time.monotonic() + timeout
        for line in _iter_lines_with_deadline(proc.stdout, deadline):
            stripped = line.rstrip("\n")
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                data = None
            if isinstance(data, dict) and isinstance(data.get("port"), int):
                port = data["port"]
                break
            seen.append(stripped)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
        if port is None:
            # The child is dead now, so draining the rest of its buffered
            # output can't block — pick up anything written just before (or
            # during) the kill that the deadline loop didn't get to yet.
            try:
                seen.extend(l.rstrip("\n") for l in proc.stdout.readlines())
            except Exception:
                pass

    if port is None:
        tail = "\n".join(seen[-40:]) if seen else "(no output captured)"
        raise SmokeFailure(
            f'sidecar entrypoint printed no {{"port": n}} handshake within {timeout}s; '
            f"output tail:\n{tail}")
    if seen:
        print(f"WARNING: sidecar entrypoint printed {len(seen)} non-handshake line(s) "
             "before the handshake:\n" + "\n".join(seen))
    print(f"sokuji_sidecar boot smoke OK, port {port}")


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
