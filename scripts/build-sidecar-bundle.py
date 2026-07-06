#!/usr/bin/env python3
"""Build a self-contained native-sidecar bundle for one SKU (spec D10).

A bundle = an embedded python-build-standalone CPython 3.12 (spec D12) with the
SKU's requirements pip-installed into it, plus a copy of the sokuji_sidecar
package. Models and llama-server binaries stay download-on-demand and are NOT
packed here.

Layout produced (unpacked):
    <out_root>/sidecar-<sku>-v<version>/
        python/            # python-build-standalone prefix (bin/python3 | python.exe)
        app/sokuji_sidecar # package source (run as `-m sokuji_sidecar`, cwd=app)
        bundle.json        # {"sku","version"} marker

Only the SKU whose triple matches the current OS is buildable on this host
(wheels are per-platform); win/mac SKUs run on their native CI runners.

Usage:
    python scripts/build-sidecar-bundle.py --sku linux-nvidia --version 0.30.6 --out out/bundles
Add --archive to also produce sidecar-<sku>-v<version>.tar.zst + a manifest
fragment (see Task 4).
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

SKU_TRIPLE = {
    "linux-nvidia": "x86_64-unknown-linux-gnu",
    "win-nvidia": "x86_64-pc-windows-msvc",
    "win-directml": "x86_64-pc-windows-msvc",
    "mac": "aarch64-apple-darwin",
}
SKU_REQUIREMENTS = {
    "linux-nvidia": "requirements-nvidia.txt",
    "win-nvidia": "requirements-nvidia.txt",
    "win-directml": "requirements-directml.txt",
    "mac": "requirements-mac.txt",
}
_PBS_LATEST = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"


def sku_requirements(sku: str) -> str:
    return SKU_REQUIREMENTS[sku]


def bundle_dirname(sku: str, version: str) -> str:
    return f"sidecar-{sku}-v{version}"


def host_supports_sku(sku: str) -> bool:
    triple = SKU_TRIPLE[sku]
    sysname = platform.system()
    if "linux" in triple:
        return sysname == "Linux"
    if "windows" in triple:
        return sysname == "Windows"
    if "darwin" in triple:
        # mac bundle is Apple-Silicon-only (arm64); an Intel Mac must not pass.
        return sysname == "Darwin" and platform.machine() == "arm64"
    return False


def select_python_asset(assets, triple: str, py_series: str = "3.12") -> str:
    """Pick the python-build-standalone `install_only` tarball for `triple`.
    Excludes `install_only_stripped` (name suffix differs) and other series."""
    suffix = f"-{triple}-install_only.tar.gz"
    cands = [a for a in assets
             if a["name"].startswith(f"cpython-{py_series}.")
             and a["name"].endswith(suffix)]
    if not cands:
        raise SystemExit(f"no python-build-standalone {py_series} asset for {triple}")
    # Sort by (patch, build-date) parsed numerically — a lexicographic name
    # sort misorders 3.12.10 before 3.12.9. Asset names look like
    # cpython-3.12.7+20241016-<triple>-install_only.tar.gz.
    ver = re.escape(py_series)
    def _key(a):
        m = re.search(rf"cpython-{ver}\.(\d+)\+(\d+)", a["name"])
        return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)
    return max(cands, key=_key)["browser_download_url"]


def _fetch_python_prefix(triple: str, dest: Path) -> Path:
    with urllib.request.urlopen(_PBS_LATEST, timeout=60) as r:
        release = json.load(r)
    url = select_python_asset(release["assets"], triple)
    tgz = dest / "python.tar.gz"
    print(f"[bundle] fetching {url}", flush=True)
    urllib.request.urlretrieve(url, tgz)
    with tarfile.open(tgz) as t:
        t.extractall(dest)                 # -> dest/python/
    tgz.unlink()
    return dest / "python"


def _bundle_python_exe(prefix: Path) -> Path:
    win = prefix / "python.exe"
    return win if win.exists() else prefix / "bin" / "python3"


def build_bundle_dir(sku: str, version: str, out_root: str, repo_root: str) -> str:
    if not host_supports_sku(sku):
        raise SystemExit(
            f"SKU {sku} ({SKU_TRIPLE[sku]}) cannot be built on {platform.system()}; "
            f"run it on the matching CI runner")
    repo = Path(repo_root)
    out = Path(out_root) / bundle_dirname(sku, version)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    prefix = _fetch_python_prefix(SKU_TRIPLE[sku], out)
    py = str(_bundle_python_exe(prefix))
    req = repo / "sidecar" / sku_requirements(sku)
    subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([py, "-m", "pip", "install", "-r", str(req)],
                   check=True, cwd=str(repo / "sidecar"))

    app = out / "app"
    app.mkdir()
    shutil.copytree(repo / "sidecar" / "sokuji_sidecar", app / "sokuji_sidecar",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (out / "bundle.json").write_text(json.dumps({"sku": sku, "version": version}))
    print(f"[bundle] built {out}", flush=True)
    return str(out)


def archive_name(sku: str, version: str) -> str:
    return f"{bundle_dirname(sku, version)}.tar.zst"


def pack_zst(src_dir: str, out_path: str) -> None:
    """Stream src_dir's CHILDREN into a zstd-compressed tar (no wrapper dir),
    so extracting to <userData>/sidecar/<sku> yields python/ and app/ directly."""
    import zstandard
    src = Path(src_dir)
    cctx = zstandard.ZstdCompressor(level=19)
    with open(out_path, "wb") as raw, cctx.stream_writer(raw) as z:
        with tarfile.open(mode="w|", fileobj=z) as tar:
            for name in sorted(os.listdir(src)):
                tar.add(str(src / name), arcname=name)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(sku: str, version: str, archive_path: str, url: str) -> dict:
    return {"sku": sku, "version": version, "sha256": sha256_file(archive_path),
            "size": os.path.getsize(archive_path), "url": url}


def _vkey(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def merge_manifests(fragments) -> dict:
    best = {}
    for f in fragments:
        cur = best.get(f["sku"])
        if cur is None or _vkey(f["version"]) > _vkey(cur["version"]):
            best[f["sku"]] = f
    return {"bundles": [best[k] for k in sorted(best)]}


def _archive_and_manifest(sku, version, bundle_dir, out_root, base_url):
    arc = str(Path(out_root) / archive_name(sku, version))
    pack_zst(bundle_dir, arc)
    url = f"{base_url.rstrip('/')}/{archive_name(sku, version)}" if base_url else ""
    frag = build_manifest(sku, version, arc, url)
    frag_path = Path(out_root) / f"{bundle_dirname(sku, version)}.json"
    frag_path.write_text(json.dumps(frag, indent=2))
    print(f"[bundle] archived {arc} ({frag['size']} bytes, sha256 {frag['sha256'][:12]})",
          flush=True)


def _main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", required=True, choices=sorted(SKU_TRIPLE))
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", default="out/bundles")
    ap.add_argument("--archive", action="store_true",
                    help="also pack .tar.zst + manifest fragment (Task 4)")
    ap.add_argument("--base-url", default="",
                    help="hosting base URL for the manifest `url` field (operator-set)")
    args = ap.parse_args(argv)
    repo_root = str(Path(__file__).resolve().parent.parent)
    bundle_dir = build_bundle_dir(args.sku, args.version, args.out, repo_root)
    if args.archive:
        _archive_and_manifest(args.sku, args.version, bundle_dir, args.out, args.base_url)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
