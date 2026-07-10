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
    python scripts/build-sidecar-bundle.py --sku linux-nvidia --archive --out out/bundles
Version defaults to package.json `sidecarVersion`. Archives over PART_LIMIT are
byte-split into `.001/.002/...` parts. `--merge-fragments a.json b.json` merges
per-SKU fragments into the release manifest.json.
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

# GitHub release assets max out at 2 GiB; keep ~100 MiB headroom (spec S5).
PART_LIMIT = int(1.9 * 1024 ** 3)


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


def default_version(repo_root: str) -> str:
    """The sidecar's canonical version = package.json `sidecarVersion` (spec S1).
    One field, one bump; the sidecar-vX.Y.Z tag must match it (CI-asserted)."""
    pkg = json.loads((Path(repo_root) / "package.json").read_text())
    v = pkg.get("sidecarVersion")
    if not v:
        raise SystemExit("package.json has no sidecarVersion field")
    return v


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


def _pbs_release_request(env=os.environ) -> urllib.request.Request:
    """Request for the PBS latest-release lookup. GitHub-hosted runners share
    egress IPs whose ANONYMOUS api.github.com quota is permanently exhausted
    (403 rate limit) — send the workflow token when one is in the env."""
    req = urllib.request.Request(_PBS_LATEST)
    token = env.get("GITHUB_TOKEN") or env.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    return req


def _fetch_python_prefix(triple: str, dest: Path) -> Path:
    with urllib.request.urlopen(_pbs_release_request(), timeout=60) as r:
        release = json.load(r)
    url = select_python_asset(release["assets"], triple)
    tgz = dest / "python.tar.gz"
    print(f"[bundle] fetching {url}", flush=True)
    urllib.request.urlretrieve(url, tgz)
    with tarfile.open(tgz) as t:
        # filter='data' sanitizes the upstream tarball (CVE-2007-4559 posture);
        # available since py3.12 (this module targets 3.12) but some interpreters
        # running this script (e.g. an older system python invoking the builder)
        # predate PEP 706 and raise TypeError on the unknown kwarg.
        try:
            t.extractall(dest, filter="data")  # -> dest/python/
        except TypeError:
            t.extractall(dest)                 # older interpreter without PEP 706 filter
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
        # dereference=True: follow symlinks/hardlinks so the archive contains
        # only regular files. The JS extractor (extractTarZst) writes regular
        # files only, so symlink members would land as empty files — a symlink-
        # free archive keeps bin/python3 etc. as real, spawnable launchers.
        with tarfile.open(mode="w|", fileobj=z, dereference=True) as tar:
            for name in sorted(os.listdir(src)):
                tar.add(str(src / name), arcname=name)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dir_size(path: str) -> int:
    """Unpacked byte size of a bundle dir (`installedSize`, for disk preflight)."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def split_parts(archive_path: str, limit: int = PART_LIMIT) -> list:
    """Byte-split an archive into `.001/.002/...` chunks of at most `limit`
    bytes when it exceeds `limit`; otherwise return a single-entry parts list
    for the file itself. Multi-part: the original archive is deleted (the
    parts replace it). The manifest always carries `parts`, so the installer
    has exactly one code path (spec S5)."""
    size = os.path.getsize(archive_path)
    base = os.path.basename(archive_path)
    if size <= limit:
        return [{"name": base, "size": size, "sha256": sha256_file(archive_path)}]
    parts = []
    with open(archive_path, "rb") as src:
        idx = 1
        while True:
            h = hashlib.sha256()
            written = 0
            chunk_path = f"{archive_path}.{idx:03d}"
            with open(chunk_path, "wb") as out:
                while written < limit:
                    buf = src.read(min(1 << 20, limit - written))
                    if not buf:
                        break
                    out.write(buf)
                    h.update(buf)
                    written += len(buf)
            if written == 0:
                os.unlink(chunk_path)
                break
            parts.append({"name": os.path.basename(chunk_path), "size": written,
                          "sha256": h.hexdigest()})
            idx += 1
    os.unlink(archive_path)
    return parts


def build_manifest(sku: str, version: str, *, sha256: str, size: int,
                   installed_size: int, parts: list) -> dict:
    """Per-SKU manifest fragment (spec S4/S5). Part names are RELATIVE — the
    installer resolves them against its base URL (mirror-friendly)."""
    return {"sku": sku, "version": version, "sha256": sha256, "size": size,
            "installedSize": installed_size, "parts": parts}


def merge_manifests(fragments) -> dict:
    """Merge same-version per-SKU fragments into the release's manifest.json.
    All fragments MUST carry one version (per-version manifest, spec S4)."""
    versions = sorted({f["version"] for f in fragments})
    if len(versions) != 1:
        raise SystemExit(f"manifest fragments span multiple versions: {versions}")
    return {"version": versions[0],
            "bundles": sorted(fragments, key=lambda f: f["sku"])}


def _archive_and_manifest(sku, version, bundle_dir, out_root):
    arc = str(Path(out_root) / archive_name(sku, version))
    installed = dir_size(bundle_dir)
    pack_zst(bundle_dir, arc)
    whole_sha = sha256_file(arc)
    whole_size = os.path.getsize(arc)
    parts = split_parts(arc)
    frag = build_manifest(sku, version, sha256=whole_sha, size=whole_size,
                          installed_size=installed, parts=parts)
    frag_path = Path(out_root) / f"{bundle_dirname(sku, version)}.json"
    frag_path.write_text(json.dumps(frag, indent=2))
    print(f"[bundle] archived {archive_name(sku, version)} ({whole_size} bytes, "
          f"{len(parts)} part(s), sha256 {whole_sha[:12]})", flush=True)


def _main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", required=False, choices=sorted(SKU_TRIPLE))
    ap.add_argument("--version", default="",
                    help="override; defaults to package.json sidecarVersion")
    ap.add_argument("--out", default="out/bundles")
    ap.add_argument("--archive", action="store_true",
                    help="also pack .tar.zst (split if >PART_LIMIT) + manifest fragment")
    ap.add_argument("--merge-fragments", nargs="+", default=None,
                    help="merge per-SKU fragment JSONs into one manifest.json and exit")
    ap.add_argument("--merged-out", default="manifest.json")
    args = ap.parse_args(argv)
    repo_root = str(Path(__file__).resolve().parent.parent)
    if args.merge_fragments:
        frags = [json.loads(Path(p).read_text()) for p in args.merge_fragments]
        Path(args.merged_out).write_text(json.dumps(merge_manifests(frags), indent=2))
        print(f"[bundle] merged {len(frags)} fragment(s) -> {args.merged_out}", flush=True)
        return 0
    if not args.sku:
        ap.error("--sku is required unless --merge-fragments is given")
    version = args.version or default_version(repo_root)
    bundle_dir = build_bundle_dir(args.sku, version, args.out, repo_root)
    if args.archive:
        _archive_and_manifest(args.sku, version, bundle_dir, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
