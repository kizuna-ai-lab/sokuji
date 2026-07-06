# P7 — Self-Contained Sidecar Bundles + Electron SKU Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing native sidecar as self-contained, versioned per-SKU bundles (embedded CPython 3.12 + all wheels) that Electron detects, downloads, unpacks, and launches — with `setup.sh`/the dev venv reduced to a developer/CI tool (spec D10).

**Architecture:** A build script (`scripts/build-sidecar-bundle.py`) fills a per-SKU embedded-Python tree from a per-SKU requirements file, copies the `sokuji_sidecar` package in, and packs it into `sidecar-<sku>-v<version>.tar.zst` + a `manifest.json` fragment. Only the `linux-nvidia` SKU is buildable/testable on the dev machine; `win-nvidia`, `win-directml` and `mac` run as GitHub Actions matrix jobs on their native runners. Electron gains SKU detection (nvidia / directml / mac) plus a bundle-aware launch order in `native-host-manager.js` (`SOKUJI_SIDECAR_PYTHON` → installed bundle → dev venv) and a download/unpack IPC path whose progress mirrors the existing model-download UX in `nativeModelStore`.

**Tech Stack:** python-build-standalone (astral-sh prebuilt CPython 3.12, `install_only` tarballs), `zstandard` (already pinned, `.tar.zst` packing), Python stdlib `tarfile`/`urllib`/`hashlib`; Electron main process (Node) with `fzstd` + `tar-stream` (new deps) for streaming `.tar.zst` extraction; Vitest for the JS/TS side, pytest for the Python side.

## Global Constraints

- **Python 3.12 everywhere** (spec D12): dev venv + all SKU bundles unify on CPython 3.12. `setup.sh` prefers `python3.12`. cp312 wheels are verified for the full runtime set (onnxruntime-gpu 1.23.2, onnxruntime-directml 1.24.4, sherpa-onnx 1.13.3, ctranslate2, sentencepiece 0.2.0; transcribe-cpp is py3-none-any; mlx on arm64 macOS).
- **One ORT flavor per bundle** (spec D1): `onnxruntime-gpu`, `onnxruntime-directml`, and plain `onnxruntime` all export the same `onnxruntime` module — mutually exclusive, exactly one per SKU.
- **SKU matrix** (spec D10): `linux-nvidia` (onnxruntime-gpu), `win-nvidia` (onnxruntime-gpu), `win-directml` (onnxruntime-directml, needs Python ≥3.11), `mac` (Apple Silicon, onnxruntime CPU + MLX). `win-nvidia` and `linux-nvidia` share `requirements-nvidia.txt`.
- **Bundles carry runtimes only** — models and llama-server binaries stay download-on-demand (never packed into a bundle).
- **Sidecar runtime stays torch-free** — `sidecar/tests/test_torch_free_gate.py` must keep passing; no SKU requirements file may name `torch`/`torchaudio`/`torchvision`.
- **NVML stays removed** (spec D7, landed in P2): no SKU file re-pins `nvidia-ml-py`.
- **Only `linux-nvidia` is buildable/testable locally.** Windows/mac bundle builds are CI jobs; their boot/behavior is a **deferred hardware-verification** checklist at the end of this plan (not inside any task).
- **Hosting is NOT chosen here.** The `manifest.json` `url` field and the installer's base URL are operator-supplied (`SOKUJI_SIDECAR_BUNDLE_BASE_URL`); HF releases vs GitHub releases is an operator decision — do not hardcode either.
- **Signing/notarization is OUT of scope** — an operator follow-up (macOS `codesign`/notarytool, Windows Authenticode/SmartScreen). This plan produces unsigned bundles.
- English only in code/comments/docs. Conventional commit messages. Any `git push`, `gh` action, HF upload, or hosting publish is operator-gated (explicit per-action consent).

---

### Task 1: SPIKE — build the linux-nvidia bundle two ways and pick a method

This task is an **investigation with an acceptance gate**, not a TDD unit. Its deliverable is a committed findings doc that records measured sizes + boot results and locks the packaging method that Tasks 3–4 productionize.

**Files:**
- Create: `docs/superpowers/notes/2026-07-06-p7-bundle-spike.md`

**Interfaces:**
- Produces: a documented decision — **method (a) python-build-standalone** unless it fails the acceptance gate — consumed by Task 3 (`build-sidecar-bundle.py` implements the chosen method).

- [ ] **Step 1: Method (a) — python-build-standalone embedded CPython 3.12**

Spec D12 mandates 3.12 for the shipped bundle (this deliberately differs from any "3.10" phrasing in the workstream brief; the brief predates D12, and DML needs ≥3.11). Fetch the prebuilt interpreter, install the nvidia dep set, boot it. Run from the worktree root:

```bash
REPO="$(git rev-parse --show-toplevel)"
mkdir -p /tmp/sidecar-spike/pbs && cd /tmp/sidecar-spike/pbs
REL=$(curl -fsSL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest)
URL=$(printf '%s' "$REL" | python3 -c "import sys,json; r=json.load(sys.stdin); print(next(a['browser_download_url'] for a in r['assets'] if a['name'].startswith('cpython-3.12.') and a['name'].endswith('x86_64-unknown-linux-gnu-install_only.tar.gz')))")
echo "python asset: $URL"
curl -fsSL "$URL" -o python.tar.gz
tar xf python.tar.gz                       # -> ./python/
./python/bin/python3 --version             # expect: Python 3.12.x
./python/bin/python3 -m pip install -q -r "$REPO/sidecar/requirements.txt"
./python/bin/python3 -m pip install -q "onnxruntime-gpu[cuda,cudnn]==1.23.2" "sherpa-onnx==1.13.3"
mkdir -p app && cp -r "$REPO/sidecar/sokuji_sidecar" app/ && find app -name __pycache__ -type d -prune -exec rm -rf {} +
du -sh python app                          # record the two sizes
```

- [ ] **Step 2: Method (a) acceptance — boot + handshake + ping**

```bash
cd /tmp/sidecar-spike/pbs/app
HF_HOME=/tmp/sidecar-spike/hf /tmp/sidecar-spike/pbs/python/bin/python3 - <<'EOF'
import os, sys, json, subprocess, asyncio, websockets
proc = subprocess.Popen([sys.executable, "-m", "sokuji_sidecar"],
                        stdout=subprocess.PIPE, text=True, env={**os.environ})
port = json.loads(proc.stdout.readline())["port"]      # handshake line
print("HANDSHAKE_OK port", port)
async def ping():
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"type": "ping", "id": 1}))
        print("PING_REPLY", await ws.recv())            # expect {"type":"pong","id":1}
asyncio.run(ping())
proc.terminate()
EOF
```

Expected: `HANDSHAKE_OK port <n>` then `PING_REPLY {"type": "pong", "id": 1}`. Record pass/fail and the total `du -sh` of `python/` + `app/` from Step 1.

- [ ] **Step 3: Method (b) — PyInstaller onedir of `sokuji_sidecar.__main__`**

```bash
REPO="$(git rev-parse --show-toplevel)"
"$REPO/sidecar/.venv/bin/pip" install -q pyinstaller
cd /tmp/sidecar-spike
"$REPO/sidecar/.venv/bin/pyinstaller" --onedir --noconfirm --name sokuji_sidecar \
  --collect-all onnxruntime --collect-all sherpa_onnx --collect-all ctranslate2 \
  --collect-all transcribe_cpp --collect-submodules sokuji_sidecar \
  --paths "$REPO/sidecar" "$REPO/sidecar/sokuji_sidecar/__main__.py"
du -sh dist/sokuji_sidecar
HF_HOME=/tmp/sidecar-spike/hf-pi ./dist/sokuji_sidecar/sokuji_sidecar   # expect the {"port": n} handshake line, Ctrl-C after
```

Expected: either a `{"port": n}` handshake (success) or a runtime `ImportError`/missing-`.so` (the historically common PyInstaller failure with these native wheels). Record the outcome and `du -sh dist/sokuji_sidecar`.

- [ ] **Step 4: Write the findings doc + decision gate**

Create `docs/superpowers/notes/2026-07-06-p7-bundle-spike.md` recording: the measured `du -sh` for (a) `python/`+`app/` and (b) `dist/sokuji_sidecar`, the boot/ping result for each, and this decision rule verbatim:

```markdown
# P7 sidecar-bundle packaging spike (2026-07-06)

Compared two ways to build the linux-nvidia bundle on the dev box (RTX 4070, Linux).

| Method | Boots + pings | Bundle size (du -sh) |
|--------|---------------|----------------------|
| (a) python-build-standalone CPython 3.12 + pip | <fill> | <fill> |
| (b) PyInstaller onedir | <fill> | <fill> |

## Decision

**Pick (a) python-build-standalone** unless it fails the Step 2 acceptance
(no handshake or no pong) OR its bundle is more than ~1.5x method (b)'s size.
Rationale: the native-heavy wheels (onnxruntime, ctranslate2, transcribe_cpp's
.so farm, sherpa-onnx) are historically fragile under PyInstaller hooks
(hidden-import / collect gaps -> runtime ImportError), whereas method (a) runs a
real, unmodified CPython that `pip install` populates exactly as the dev venv is.
Method (a) is what Tasks 3-4 productionize.
```

Fill the `<fill>` cells from Steps 1–3. If method (a) fails its acceptance gate, stop and escalate — Tasks 3–4 assume method (a).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/2026-07-06-p7-bundle-spike.md
git commit -m "docs(sidecar): record P7 bundle packaging spike + method decision"
```

---

### Task 2: Per-SKU requirements files + `setup.sh` Python 3.12 preference

**Files:**
- Create: `sidecar/requirements-nvidia.txt`
- Create: `sidecar/requirements-directml.txt`
- Create: `sidecar/requirements-mac.txt`
- Modify: `sidecar/setup.sh:12-15` (interpreter preference)
- Test: `sidecar/tests/test_sku_requirements.py`

**Interfaces:**
- Produces: three requirements files, each `-r requirements.txt` (shared base) + exactly one ORT flavor + `sherpa-onnx==1.13.3`; consumed by Task 3's `sku_requirements(sku)` and the CI matrix.

- [ ] **Step 1: Write the failing test**

Create `sidecar/tests/test_sku_requirements.py`:

```python
"""Structural invariants for the per-SKU bundle requirements files (spec D1/D7/D10/D12).
These files are parsed (not installed) here, so the checks run on any host."""
import pathlib
import re

import pytest

SIDE = pathlib.Path(__file__).resolve().parents[1]
FILES = {
    "nvidia": SIDE / "requirements-nvidia.txt",
    "directml": SIDE / "requirements-directml.txt",
    "mac": SIDE / "requirements-mac.txt",
}
# The three ORT variant wheels all provide the `onnxruntime` module; a bundle
# must install exactly one (spec D1).
ORT_LINE = re.compile(r"^onnxruntime(-gpu|-directml)?\b")
TORCH_LINE = re.compile(r"^(torch|torchaudio|torchvision)\b")


def _reqs(path):
    return [ln.strip() for ln in path.read_text().splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac"])
def test_sku_file_includes_shared_base(sku):
    assert "-r requirements.txt" in _reqs(FILES[sku])


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac"])
def test_exactly_one_ort_flavor(sku):
    ort = [ln for ln in _reqs(FILES[sku]) if ORT_LINE.match(ln)]
    assert len(ort) == 1, ort


def test_ort_flavor_matches_sku():
    assert any(ln.startswith("onnxruntime-gpu[cuda,cudnn]==1.23.2")
               for ln in _reqs(FILES["nvidia"]))
    assert any(ln.startswith("onnxruntime-directml==1.24.4")
               for ln in _reqs(FILES["directml"]))
    mac_ort = [ln for ln in _reqs(FILES["mac"]) if ORT_LINE.match(ln)][0]
    assert (mac_ort.startswith("onnxruntime==")
            and "-gpu" not in mac_ort and "-directml" not in mac_ort)


@pytest.mark.parametrize("sku", ["nvidia", "directml", "mac"])
def test_no_torch_in_sku_files(sku):
    assert not [ln for ln in _reqs(FILES[sku]) if TORCH_LINE.match(ln)]


def test_nvml_not_reintroduced():
    for sku in FILES:
        assert not any("nvidia-ml-py" in ln for ln in _reqs(FILES[sku]))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sku_requirements.py -q`
Expected: FAIL — `FileNotFoundError` (the three `requirements-*.txt` files do not exist yet).

- [ ] **Step 3: Create the three per-SKU requirements files**

`sidecar/requirements-nvidia.txt`:

```
# Sidecar bundle SKU: NVIDIA (CUDA) - Windows + Linux (spec D1/D10).
# Base pins (torch-free, platform-agnostic) come from requirements.txt.
-r requirements.txt
# ORT CUDA build. onnxruntime-gpu / onnxruntime-directml / plain onnxruntime all
# expose the SAME `onnxruntime` module - exactly ONE per bundle (spec D1). The
# [cuda,cudnn] extras pull the matching NVIDIA CUDA/cuDNN wheels so
# onnxruntime.preload_dlls() finds them (spec D8, official since ORT 1.21).
onnxruntime-gpu[cuda,cudnn]==1.23.2
# VAD + VITS TTS runtime - stays CPU (out of scope for acceleration); the stock
# sherpa-onnx wheel bundles a CPU-only ORT.
sherpa-onnx==1.13.3
```

`sidecar/requirements-directml.txt`:

```
# Sidecar bundle SKU: DirectML - non-NVIDIA Windows (spec D1/D2/D10).
# Requires Python >= 3.11; the bundle ships CPython 3.12 (spec D12).
-r requirements.txt
# ORT DirectML build - mutually exclusive with onnxruntime-gpu / onnxruntime (D1).
# All graphs (incl. autoregressive) run on DML; no pre-emptive AR->CPU routing (D2).
onnxruntime-directml==1.24.4
sherpa-onnx==1.13.3
```

`sidecar/requirements-mac.txt`:

```
# Sidecar bundle SKU: macOS (Apple Silicon) - MLX lane (spec D5/D10).
# CoreML EP rejected (no Attention/GQA/MatMulNBits kernels); ORT stays CPU.
-r requirements.txt
onnxruntime==1.23.2
sherpa-onnx==1.13.3
# Apple MLX audio TTS (Qwen3-TTS + MOSS nano). The exact pin is owned by the P6
# macOS MLX lane; left unpinned here so P6 controls the version in one place.
mlx-audio
```

- [ ] **Step 4: Update `setup.sh` interpreter preference (spec D12)**

In `sidecar/setup.sh`, replace lines 12–15:

```bash
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if command -v python3.11 >/dev/null 2>&1; then PYTHON=python3.11; else PYTHON=python3; fi
fi
```

with:

```bash
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  # Spec D12: dev venv + all SKU bundles unify on CPython 3.12 (DML needs >=3.11;
  # cp312 wheels verified for the full runtime set). Fall back progressively.
  if command -v python3.12 >/dev/null 2>&1; then PYTHON=python3.12
  elif command -v python3.11 >/dev/null 2>&1; then PYTHON=python3.11
  else PYTHON=python3; fi
fi
```

- [ ] **Step 5: Run test + verify the setup.sh change**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sku_requirements.py -q && grep -q 'python3.12' setup.sh && echo SETUP_OK`
Expected: pytest passes (7 tests) and prints `SETUP_OK`.

- [ ] **Step 6: Commit**

```bash
git add sidecar/requirements-nvidia.txt sidecar/requirements-directml.txt sidecar/requirements-mac.txt sidecar/setup.sh sidecar/tests/test_sku_requirements.py
git commit -m "feat(sidecar): add per-SKU bundle requirements + prefer python3.12"
```

---

### Task 3: Bundle build script core (embedded Python → unpacked bundle dir)

**Files:**
- Create: `scripts/build-sidecar-bundle.py`
- Test: `sidecar/tests/test_build_sidecar_bundle.py`

**Interfaces:**
- Consumes: the per-SKU requirements files (Task 2).
- Produces (module `build_sidecar_bundle`, imported by tests as a top-level module from `scripts/`):
  - `SKU_TRIPLE: dict[str, str]` and `SKU_REQUIREMENTS: dict[str, str]`
  - `sku_requirements(sku: str) -> str`
  - `select_python_asset(assets: list[dict], triple: str, py_series: str = "3.12") -> str`
  - `bundle_dirname(sku: str, version: str) -> str`
  - `host_supports_sku(sku: str) -> bool`
  - `build_bundle_dir(sku: str, version: str, out_root: str, repo_root: str) -> str` — returns the unpacked bundle dir path. Task 4 adds archiving on top.

- [ ] **Step 1: Write the failing test**

Create `sidecar/tests/test_build_sidecar_bundle.py`:

```python
"""Pure-helper tests for the bundle build script. The full linux build is a
manual acceptance step in the plan (needs network + wheels), not a unit test."""
import pathlib
import platform
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))
import build_sidecar_bundle as b   # noqa: E402


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'build_sidecar_bundle'`.

- [ ] **Step 3: Write the build script**

Create `scripts/build-sidecar-bundle.py`:

```python
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
```

Note: `_archive_and_manifest`, `pack_zst`, `archive_name`, `sha256_file`, `build_manifest`, and `merge_manifests` are added in Task 4. The `--archive` flag exists in the parser now but its helper lands next; do not run `--archive` until Task 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: 6 passed.

- [ ] **Step 5: Acceptance — build + boot the real linux-nvidia bundle**

```bash
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO" && python3 scripts/build-sidecar-bundle.py --sku linux-nvidia --version 0.0.0-dev --out /tmp/p7-out
BUNDLE=/tmp/p7-out/sidecar-linux-nvidia-v0.0.0-dev
# Boot with cwd = the bundle app dir (matches how native-host-manager launches it):
cd "$BUNDLE/app" && HF_HOME=/tmp/p7-hf "$BUNDLE/python/bin/python3" - <<'EOF'
import os, sys, json, subprocess, asyncio, websockets
proc = subprocess.Popen([sys.executable, "-m", "sokuji_sidecar"],
                        stdout=subprocess.PIPE, text=True, env={**os.environ})
port = json.loads(proc.stdout.readline())["port"]
print("HANDSHAKE_OK", port)
async def ping():
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"type": "ping", "id": 1}))
        print("PING_REPLY", await ws.recv())
asyncio.run(ping()); proc.terminate()
EOF
```

Expected: `HANDSHAKE_OK <port>` then `PING_REPLY {"type": "pong", "id": 1}`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-sidecar-bundle.py sidecar/tests/test_build_sidecar_bundle.py
git commit -m "feat(sidecar): add per-SKU bundle build script (embedded python)"
```

---

### Task 4: Versioned `.tar.zst` archive + `manifest.json`

**Files:**
- Modify: `scripts/build-sidecar-bundle.py` (add archive/manifest helpers + `_archive_and_manifest`)
- Test: `sidecar/tests/test_build_sidecar_bundle.py` (append archive/manifest tests)

**Interfaces:**
- Consumes: `bundle_dirname` / `build_bundle_dir` (Task 3).
- Produces:
  - `archive_name(sku, version) -> str` == `f"sidecar-{sku}-v{version}.tar.zst"` (must match the JS `archiveName` in Task 7).
  - `pack_zst(src_dir: str, out_path: str) -> None` — streams the children of `src_dir` (no top-level nesting) into a zstd-compressed tar.
  - `sha256_file(path: str) -> str`
  - `build_manifest(sku, version, archive_path, url) -> dict` — `{sku, version, sha256, size, url}`.
  - `merge_manifests(fragments: list[dict]) -> dict` — `{"bundles": [latest-per-sku]}`.

- [ ] **Step 1: Write the failing tests (append)**

Append to `sidecar/tests/test_build_sidecar_bundle.py`:

```python
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
    arc = tmp_path / "sidecar-mac-v2.tar.zst"
    arc.write_bytes(b"payload")
    m = b.build_manifest("mac", "2", str(arc), "https://host/sidecar-mac-v2.tar.zst")
    assert m["sha256"] == hashlib.sha256(b"payload").hexdigest()
    assert m["sku"] == "mac" and m["version"] == "2" and m["size"] == 7
    assert m["url"].endswith("sidecar-mac-v2.tar.zst")


def test_merge_manifests_keeps_latest_per_sku():
    agg = b.merge_manifests([
        {"sku": "nvidia", "version": "0.30.5", "sha256": "a", "size": 1, "url": "u1"},
        {"sku": "nvidia", "version": "0.30.6", "sha256": "b", "size": 2, "url": "u2"},
        {"sku": "mac", "version": "0.30.6", "sha256": "c", "size": 3, "url": "u3"},
    ])
    got = {e["sku"]: e["version"] for e in agg["bundles"]}
    assert got == {"nvidia": "0.30.6", "mac": "0.30.6"}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: FAIL — `AttributeError: module 'build_sidecar_bundle' has no attribute 'archive_name'`.

- [ ] **Step 3: Add the archive/manifest helpers**

In `scripts/build-sidecar-bundle.py`, add `import hashlib` and `import re` to the import block, then add these functions above `_main`:

```python
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: 10 passed.

- [ ] **Step 5: Acceptance — archive the linux bundle end to end**

```bash
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO" && python3 scripts/build-sidecar-bundle.py --sku linux-nvidia --version 0.0.0-dev --out /tmp/p7-out --archive --base-url https://EXAMPLE-HOST/bundles
ls -la /tmp/p7-out/sidecar-linux-nvidia-v0.0.0-dev.tar.zst /tmp/p7-out/sidecar-linux-nvidia-v0.0.0-dev.json
cat /tmp/p7-out/sidecar-linux-nvidia-v0.0.0-dev.json
```

Expected: a `.tar.zst` and a `.json` fragment with `sku`, `version`, `sha256` (64 hex), `size`, and a `url` ending in the archive name.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-sidecar-bundle.py sidecar/tests/test_build_sidecar_bundle.py
git commit -m "feat(sidecar): pack versioned .tar.zst bundle + manifest fragment"
```

---

### Task 5: GitHub Actions bundle matrix (`sidecar-bundles.yml`)

**Files:**
- Create: `.github/workflows/sidecar-bundles.yml`
- Test: `sidecar/tests/test_sidecar_bundles_workflow.py`

**Interfaces:**
- Consumes: `scripts/build-sidecar-bundle.py --sku … --version … --archive` (Tasks 3–4).
- Produces: three jobs `build-linux` / `build-windows` (matrix: win-nvidia, win-directml) / `build-mac`, each uploading `sidecar-<sku>-v<version>.*` as an artifact. Only `build-linux` runs on the dev machine's runner class; windows/mac are the deferred-hardware jobs.

- [ ] **Step 1: Write the failing test**

Create `sidecar/tests/test_sidecar_bundles_workflow.py`:

```python
"""Structure check for the SKU-bundle CI workflow. Text asserts run everywhere;
a full YAML parse runs only when PyYAML is present (importorskip)."""
import pathlib

import pytest

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sidecar-bundles.yml"


def test_workflow_names_all_skus_and_runners():
    text = WF.read_text()
    for sku in ("linux-nvidia", "win-nvidia", "win-directml", "mac"):
        assert sku in text, sku
    for runner in ("ubuntu-latest", "windows-latest", "macos-14"):
        assert runner in text, runner
    assert "build-sidecar-bundle.py" in text
    assert "--archive" in text
    assert "actions/upload-artifact@v4" in text


def test_workflow_is_valid_yaml_with_three_jobs():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    assert {"build-linux", "build-windows", "build-mac"} <= set(doc["jobs"])
    assert doc["jobs"]["build-windows"]["strategy"]["matrix"]["sku"] == ["win-nvidia", "win-directml"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sidecar_bundles_workflow.py -q`
Expected: FAIL — `FileNotFoundError` (workflow file missing).

- [ ] **Step 3: Create the workflow**

Create `.github/workflows/sidecar-bundles.yml`:

```yaml
# .github/workflows/sidecar-bundles.yml
# Build the self-contained sidecar bundles per SKU (spec D10). Only build-linux
# is exercised on the dev machine; build-windows / build-mac are the deferred
# hardware path (see the plan's deferred-verification section). Signing and
# hosting are operator follow-ups - this workflow only uploads unsigned artifacts.
name: sidecar-bundles
on:
  workflow_dispatch:
    inputs:
      version:
        description: Bundle version (e.g. 0.30.6)
        required: true

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build linux-nvidia bundle
        run: python scripts/build-sidecar-bundle.py --sku linux-nvidia --version "${{ inputs.version }}" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-linux-nvidia
          path: out/bundles/sidecar-linux-nvidia-v${{ inputs.version }}.*

  build-windows:
    runs-on: windows-latest
    strategy:
      matrix:
        sku: [win-nvidia, win-directml]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build ${{ matrix.sku }} bundle
        run: python scripts/build-sidecar-bundle.py --sku ${{ matrix.sku }} --version "${{ inputs.version }}" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-${{ matrix.sku }}
          path: out/bundles/sidecar-${{ matrix.sku }}-v${{ inputs.version }}.*

  build-mac:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build mac bundle
        run: python scripts/build-sidecar-bundle.py --sku mac --version "${{ inputs.version }}" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-mac
          path: out/bundles/sidecar-mac-v${{ inputs.version }}.*
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sidecar_bundles_workflow.py -q`
Expected: 2 passed (the YAML test is skipped only if PyYAML is absent; the text test always runs).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/sidecar-bundles.yml sidecar/tests/test_sidecar_bundles_workflow.py
git commit -m "ci(sidecar): add per-SKU bundle build matrix workflow"
```

---

### Task 6: Electron SKU detection + bundle-aware launch order

**Files:**
- Create: `electron/sidecar-sku.js`
- Create: `electron/sidecar-sku.test.js`
- Modify: `electron/native-host-manager.js` (add `resolveSidecarLaunch` after `resolvePython`; wire it into `start()` at :69–74; extend `module.exports` at :118)
- Test: `electron/native-host-manager.test.js` (append `resolveSidecarLaunch` suite)

**Interfaces:**
- Produces:
  - `detectSku(platform: string, { hasNvidia: boolean }) -> 'nvidia'|'directml'|'mac'`
  - `probeNvidia() -> boolean` (spawns `nvidia-smi -L`)
  - `bundleRootFor(userDataDir: string, sku: string) -> string`
  - `resolveSidecarLaunch({ platform, envOverride, bundleRoot, devVenvPython, devCwd, existsSync }) -> { python, cwd, source }` where `source` is one of `'env'`, `'bundle'`, `'venv'`.
- Consumed by: Task 7's main-process IPC (`detectSku`, `probeNvidia`) and `native-host-manager.start()`.

- [ ] **Step 1: Write the failing tests**

Create `electron/sidecar-sku.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import path from 'path';
import { detectSku, bundleRootFor } from './sidecar-sku.js';

describe('detectSku (spec D10)', () => {
  it('darwin -> mac regardless of nvidia', () => {
    expect(detectSku('darwin', { hasNvidia: false })).toBe('mac');
    expect(detectSku('darwin', { hasNvidia: true })).toBe('mac');
  });
  it('nvidia present -> nvidia on win and linux', () => {
    expect(detectSku('win32', { hasNvidia: true })).toBe('nvidia');
    expect(detectSku('linux', { hasNvidia: true })).toBe('nvidia');
  });
  it('non-nvidia windows -> directml', () => {
    expect(detectSku('win32', { hasNvidia: false })).toBe('directml');
  });
  it('non-nvidia linux -> nvidia bundle (CPU fallback, D10 open item)', () => {
    expect(detectSku('linux', { hasNvidia: false })).toBe('nvidia');
  });
});

describe('bundleRootFor', () => {
  it('joins userData/sidecar/<sku>', () => {
    expect(bundleRootFor('/u', 'directml')).toBe(path.join('/u', 'sidecar', 'directml'));
  });
});
```

Append to `electron/native-host-manager.test.js`:

```javascript
import { resolveSidecarLaunch } from './native-host-manager.js';

describe('resolveSidecarLaunch launch order', () => {
  const devCwd = '/repo/sidecar';
  const devVenv = '/repo/sidecar/.venv/bin/python';

  it('env override wins and keeps the dev cwd', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: '/x/py', bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd, existsSync: () => true,
    });
    expect(l).toEqual({ python: '/x/py', cwd: devCwd, source: 'env' });
  });

  it('uses the installed bundle python when present (linux)', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd,
      existsSync: (p) => p === '/u/sidecar/nvidia/python/bin/python3',
    });
    expect(l.python).toBe('/u/sidecar/nvidia/python/bin/python3');
    expect(l.cwd).toBe('/u/sidecar/nvidia/app');
    expect(l.source).toBe('bundle');
  });

  it('windows bundle python is python/python.exe', () => {
    const l = resolveSidecarLaunch({
      platform: 'win32', envOverride: undefined, bundleRoot: 'C:\\u\\sidecar\\directml',
      devVenvPython: devVenv, devCwd, existsSync: () => true,
    });
    expect(l.python.endsWith(path.join('python', 'python.exe'))).toBe(true);
    expect(l.source).toBe('bundle');
  });

  it('falls back to the dev venv when no bundle is installed', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd, existsSync: () => false,
    });
    expect(l).toEqual({ python: devVenv, cwd: devCwd, source: 'venv' });
  });
});
```

(`path` is already imported at the top of `native-host-manager.test.js`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/sidecar-sku.test.js electron/native-host-manager.test.js`
Expected: FAIL — cannot resolve `./sidecar-sku.js`, and `resolveSidecarLaunch` is not exported.

- [ ] **Step 3: Create `electron/sidecar-sku.js`**

```javascript
const path = require('path');

// Map the current machine to a bundle SKU (spec D10). NVML is gone (D7); NVIDIA
// presence is probed with nvidia-smi in the main process and passed in as a bool
// so detectSku stays pure/testable.
function detectSku(platform, { hasNvidia }) {
  if (platform === 'darwin') return 'mac';            // Apple Silicon MLX lane (D5)
  if (hasNvidia) return 'nvidia';                     // CUDA on Windows or Linux
  if (platform === 'win32') return 'directml';        // non-NVIDIA Windows (D1/D2)
  return 'nvidia';                                    // non-NVIDIA Linux: nvidia bundle w/ CPU fallback (D10 open item)
}

function probeNvidia() {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('nvidia-smi', ['-L'], { timeout: 4000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function bundleRootFor(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

module.exports = { detectSku, probeNvidia, bundleRootFor };
```

- [ ] **Step 4: Add `resolveSidecarLaunch` to `native-host-manager.js`**

In `electron/native-host-manager.js`, add this function directly after `resolvePython()` (after line 10):

```javascript
// Launch order for the sidecar interpreter (spec D10):
//   1. SOKUJI_SIDECAR_PYTHON env override (developer / manual testing)
//   2. installed self-contained bundle under userData/sidecar/<sku>
//   3. dev venv fallback (repo checkout - current behavior)
// Pure + injectable (platform / existsSync) so it is unit-testable off-Electron.
function resolveSidecarLaunch({ platform, envOverride, bundleRoot, devVenvPython, devCwd, existsSync }) {
  if (envOverride) return { python: envOverride, cwd: devCwd, source: 'env' };
  if (bundleRoot) {
    const bundlePython = platform === 'win32'
      ? path.join(bundleRoot, 'python', 'python.exe')
      : path.join(bundleRoot, 'python', 'bin', 'python3');
    if (existsSync(bundlePython)) {
      return { python: bundlePython, cwd: path.join(bundleRoot, 'app'), source: 'bundle' };
    }
  }
  return { python: devVenvPython, cwd: devCwd, source: 'venv' };
}
```

- [ ] **Step 5: Wire it into `start()`**

In `electron/native-host-manager.js`, replace lines 69–74:

```javascript
      const pythonPath = resolvePython();
      const venvRoot = path.dirname(path.dirname(pythonPath));   // <venv>/bin/python → <venv>
      const env = withTorchCudaLibs({ ...process.env, HF_HOME: hfHome }, venvRoot, process.platform);
      const child = spawn(pythonPath, ['-m', 'sokuji_sidecar'], {
        cwd: path.join(__dirname, '..', 'sidecar'), env,
      });
```

with:

```javascript
      const { detectSku, probeNvidia, bundleRootFor } = require('./sidecar-sku');
      const sku = detectSku(process.platform, { hasNvidia: probeNvidia() });
      const userData = process.env.SOKUJI_USERDATA || app.getPath('userData');
      const launch = resolveSidecarLaunch({
        platform: process.platform,
        envOverride: process.env.SOKUJI_SIDECAR_PYTHON,
        bundleRoot: bundleRootFor(userData, sku),
        devVenvPython: resolvePython(),
        devCwd: path.join(__dirname, '..', 'sidecar'),
        existsSync: fs.existsSync,
      });
      const pythonPath = launch.python;
      const venvRoot = path.dirname(path.dirname(pythonPath));   // python prefix (bundle or venv)
      const env = withTorchCudaLibs({ ...process.env, HF_HOME: hfHome }, venvRoot, process.platform);
      const child = spawn(pythonPath, ['-m', 'sokuji_sidecar'], {
        cwd: launch.cwd, env,
      });
```

(`app` is already destructured from `require('electron')` at line 65; `fs` is required at line 2. `withTorchCudaLibs` is retained as-is; it is a linux-only no-op elsewhere and, per spec D8/P5, the nvidia bundle's cuDNN is loaded in-process via `onnxruntime.preload_dlls()` — do not re-derive CUDA lib logic here.)

- [ ] **Step 6: Extend the exports**

In `electron/native-host-manager.js`, replace line 118:

```javascript
module.exports = { resolvePython, parseHandshake, nvidiaLibDirs, withTorchCudaLibs, NativeHostManager };
```

with:

```javascript
module.exports = { resolvePython, resolveSidecarLaunch, parseHandshake, nvidiaLibDirs, withTorchCudaLibs, NativeHostManager };
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run electron/sidecar-sku.test.js electron/native-host-manager.test.js`
Expected: PASS (existing `parseHandshake` / `resolvePython` / `withTorchCudaLibs` / timeout suites still green + the new `resolveSidecarLaunch` and `detectSku` suites).

- [ ] **Step 8: Commit**

```bash
git add electron/sidecar-sku.js electron/sidecar-sku.test.js electron/native-host-manager.js electron/native-host-manager.test.js
git commit -m "feat(electron): detect sidecar SKU and prefer installed bundle over dev venv"
```

---

### Task 7: Main-process bundle installer + IPC + preload whitelist

**Files:**
- Create: `electron/sidecar-bundle.js`
- Create: `electron/sidecar-bundle.test.js`
- Create: `electron/__fixtures__/bundle-sample.tar.zst` (generated in Step 4)
- Modify: `electron/main.js:476` (register bundle IPC after `nativeHost.registerIpc(ipcMain);`)
- Modify: `electron/preload.js:63-66` (add receive channel) and `:131-134` (add invoke channels)
- Modify: `electron/preload.native.test.js` (assert new channels)
- Modify: `package.json` dependencies (`fzstd`, `tar-stream`)

**Interfaces:**
- Consumes: `archive_name` / `manifest.json` layout from Task 4; `detectSku` / `probeNvidia` from Task 6.
- Produces (module `sidecar-bundle`):
  - `archiveName(sku, version) -> string` (mirror of the Python `archive_name`)
  - `bundleInstallDir(userDataDir, sku) -> string`
  - `bundleStatus(userDataDir, sku) -> { installed: boolean, version: string|null }`
  - `pickBundle(manifest, sku) -> entry|undefined`
  - `verifySha256(path, wantHex) -> Promise<void>`
  - `extractTarZst(archivePath, destDir) -> Promise<void>`
  - `installBundle({ sku, baseUrl, userDataDir, onProgress, fetchImpl? }) -> Promise<{ version }>`
- IPC channels: `sidecar-bundle:status` (invoke), `sidecar-bundle:install` (invoke), `sidecar-bundle-progress` (main→renderer push, consumed by Task 8).

- [ ] **Step 1: Add the extraction dependencies**

Run:

```bash
npm install --save fzstd@^0.1.1 tar-stream@^3.1.7
```

(These are Node-side, pure-JS: `fzstd` streams zstd decompression, `tar-stream` streams tar extraction — Windows-safe, no system `tar`/`zstd` needed.)

- [ ] **Step 2: Write the failing tests**

Create `electron/sidecar-bundle.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  archiveName, bundleInstallDir, pickBundle, verifySha256, extractTarZst,
} from './sidecar-bundle.js';

describe('archiveName / bundleInstallDir', () => {
  it('archiveName matches the python packer contract', () => {
    expect(archiveName('linux-nvidia', '0.30.6')).toBe('sidecar-linux-nvidia-v0.30.6.tar.zst');
  });
  it('bundleInstallDir installs under userData/sidecar/<sku>', () => {
    expect(bundleInstallDir('/u', 'mac')).toBe(path.join('/u', 'sidecar', 'mac'));
  });
});

describe('pickBundle', () => {
  it('selects the entry matching the sku', () => {
    const m = { bundles: [{ sku: 'nvidia', version: '1', url: 'u' }, { sku: 'mac', version: '1', url: 'v' }] };
    expect(pickBundle(m, 'mac').url).toBe('v');
    expect(pickBundle(m, 'directml')).toBeUndefined();
  });
});

describe('verifySha256', () => {
  it('resolves on match and throws on mismatch', async () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'sb-')), 'a');
    writeFileSync(f, 'payload');
    const good = crypto.createHash('sha256').update('payload').digest('hex');
    await expect(verifySha256(f, good)).resolves.toBeUndefined();
    await expect(verifySha256(f, 'deadbeef')).rejects.toThrow(/sha256/);
  });
});

describe('extractTarZst', () => {
  it('extracts a .tar.zst (children at root, no traversal)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'sb-x-'));
    const fixture = path.join(__dirname, '__fixtures__', 'bundle-sample.tar.zst');
    await extractTarZst(fixture, out);
    expect(readFileSync(path.join(out, 'app', 'hi.txt'), 'utf8')).toBe('hi');
    expect(existsSync(path.join(out, 'bundle.json'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: FAIL — cannot resolve `./sidecar-bundle.js`.

- [ ] **Step 4: Generate the extraction fixture (uses Task 4's packer)**

```bash
REPO="$(git rev-parse --show-toplevel)"
mkdir -p "$REPO/electron/__fixtures__"
cd "$REPO/sidecar" && .venv/bin/python - <<'EOF'
import os, sys, tempfile, pathlib
sys.path.insert(0, os.path.join(os.path.dirname(os.getcwd()), "scripts"))
import build_sidecar_bundle as b
d = pathlib.Path(tempfile.mkdtemp()) / "sidecar-sample-v0"
(d / "app").mkdir(parents=True)
(d / "app" / "hi.txt").write_text("hi")
(d / "bundle.json").write_text('{"sku":"sample"}')
b.pack_zst(str(d), "../electron/__fixtures__/bundle-sample.tar.zst")
print("wrote electron/__fixtures__/bundle-sample.tar.zst")
EOF
```

- [ ] **Step 5: Create `electron/sidecar-bundle.js`**

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function archiveName(sku, version) {
  return `sidecar-${sku}-v${version}.tar.zst`;
}

function bundleInstallDir(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

function bundleStatus(userDataDir, sku) {
  const marker = path.join(bundleInstallDir(userDataDir, sku), 'bundle.json');
  try {
    const j = JSON.parse(fs.readFileSync(marker, 'utf8'));
    return { installed: true, version: j.version || null };
  } catch {
    return { installed: false, version: null };
  }
}

function pickBundle(manifest, sku) {
  return (manifest.bundles || []).find((e) => e.sku === sku);
}

function verifySha256(filePath, wantHex) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (d) => h.update(d));
    rs.on('error', reject);
    rs.on('end', () => {
      const got = h.digest('hex');
      if (got === wantHex) resolve();
      else reject(new Error(`sha256 mismatch: got ${got}, want ${wantHex}`));
    });
  });
}

// Stream a .tar.zst into destDir. fzstd decompresses, tar-stream untars; both
// are pure-JS so Windows needs no system tar/zstd. Backpressure: pause the file
// read when the tar Writable is full, resume on drain.
function extractTarZst(archivePath, destDir) {
  const fzstd = require('fzstd');
  const tarStream = require('tar-stream');
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const root = path.resolve(destDir);
    const extract = tarStream.extract();

    extract.on('entry', (header, stream, next) => {
      const target = path.resolve(destDir, header.name);
      if (target !== root && !target.startsWith(root + path.sep)) {
        stream.resume();
        return next(new Error(`unsafe path in archive: ${header.name}`));
      }
      if (header.type === 'directory') {
        fs.mkdirSync(target, { recursive: true });
        stream.resume();
        return next();
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const ws = fs.createWriteStream(target, { mode: header.mode || 0o644 });
      stream.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', next);
      stream.pipe(ws);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);

    let draining = false;
    const dctx = new fzstd.Decompress((chunk) => {
      if (!extract.write(Buffer.from(chunk))) draining = true;
    });
    const rs = fs.createReadStream(archivePath);
    rs.on('error', reject);
    rs.on('data', (d) => {
      dctx.push(new Uint8Array(d));
      if (draining) {
        rs.pause();
        extract.once('drain', () => { draining = false; rs.resume(); });
      }
    });
    rs.on('end', () => { dctx.push(new Uint8Array(0), true); extract.end(); });
  });
}

async function _fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`);
  return r.json();
}

async function _downloadToFile(url, dest, onProgress, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok || !r.body) throw new Error(`bundle fetch failed: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length') || 0);
  let downloaded = 0;
  const ws = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.length;
    if (!ws.write(Buffer.from(value))) {
      await new Promise((res) => ws.once('drain', res));
    }
    onProgress?.({ downloaded, total });
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
}

// Download → verify → extract → atomic swap into userData/sidecar/<sku>.
async function installBundle({ sku, baseUrl, userDataDir, onProgress, fetchImpl = fetch }) {
  if (!baseUrl) {
    throw new Error('sidecar bundle hosting is not configured (set SOKUJI_SIDECAR_BUNDLE_BASE_URL)');
  }
  const manifest = await _fetchJson(`${baseUrl.replace(/\/$/, '')}/manifest.json`, fetchImpl);
  const entry = pickBundle(manifest, sku);
  if (!entry) throw new Error(`no bundle for sku ${sku} in manifest`);

  const dest = bundleInstallDir(userDataDir, sku);
  const tmpArchive = path.join(os.tmpdir(), archiveName(sku, entry.version));
  await _downloadToFile(entry.url, tmpArchive, onProgress, fetchImpl);
  await verifySha256(tmpArchive, entry.sha256);

  const tmpDir = `${dest}.tmp`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await extractTarZst(tmpArchive, tmpDir);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmpDir, dest);
  fs.rmSync(tmpArchive, { force: true });
  fs.writeFileSync(path.join(dest, 'bundle.json'), JSON.stringify({ sku, version: entry.version }));
  return { version: entry.version };
}

module.exports = {
  archiveName, bundleInstallDir, bundleStatus, pickBundle,
  verifySha256, extractTarZst, installBundle,
};
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: PASS (4 suites). If `extractTarZst` fails, the fixture (Step 4) was not generated — re-run Step 4.

- [ ] **Step 7: Register the IPC in `main.js`**

In `electron/main.js`, immediately after line 476 (`nativeHost.registerIpc(ipcMain);`) insert:

```javascript
// ---- Self-contained sidecar bundle install/status (spec D10) ----
// SKU detection + bundle download live in the main process because the sidecar
// (which the bundle provides) is not yet running. Progress is pushed to the
// renderer on 'sidecar-bundle-progress', mirroring the model-download UX.
const { detectSku: _detectSku, probeNvidia: _probeNvidia } = require('./sidecar-sku');
const sidecarBundle = require('./sidecar-bundle');
ipcMain.handle('sidecar-bundle:status', () => {
  const sku = _detectSku(process.platform, { hasNvidia: _probeNvidia() });
  return { ok: true, sku, ...sidecarBundle.bundleStatus(app.getPath('userData'), sku) };
});
ipcMain.handle('sidecar-bundle:install', async (event) => {
  const sku = _detectSku(process.platform, { hasNvidia: _probeNvidia() });
  try {
    const r = await sidecarBundle.installBundle({
      sku,
      baseUrl: process.env.SOKUJI_SIDECAR_BUNDLE_BASE_URL || null,
      userDataDir: app.getPath('userData'),
      onProgress: (p) => event.sender.send('sidecar-bundle-progress', { sku, ...p }),
    });
    return { ok: true, sku, ...r };
  } catch (e) {
    return { ok: false, sku, error: e.message };
  }
});
```

- [ ] **Step 8: Whitelist the preload channels**

In `electron/preload.js`, add the receive channel — replace lines 63–66:

```javascript
  // Subtitle window bounds change events
  'subtitle:window-bounds-changed',
  'subtitle:fullscreen-changed',
];
```

with:

```javascript
  // Subtitle window bounds change events
  'subtitle:window-bounds-changed',
  'subtitle:fullscreen-changed',
  // Native sidecar bundle install progress (main → renderer)
  'sidecar-bundle-progress',
];
```

And add the invoke channels — replace lines 131–134:

```javascript
        // Native local-inference sidecar lifecycle (renderer → main)
        'native-host:start',
        'native-host:stop',
        'native-host:status',
```

with:

```javascript
        // Native local-inference sidecar lifecycle (renderer → main)
        'native-host:start',
        'native-host:stop',
        'native-host:status',
        // Self-contained sidecar bundle install/status (renderer → main)
        'sidecar-bundle:status',
        'sidecar-bundle:install',
```

- [ ] **Step 9: Extend the preload channel test**

Append to `electron/preload.native.test.js` inside the existing `describe` block (before its closing `});`):

```javascript
  it('includes the sidecar-bundle channels', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    for (const ch of ['sidecar-bundle:status', 'sidecar-bundle:install', 'sidecar-bundle-progress']) {
      expect(src).toContain(`'${ch}'`);
    }
  });
```

- [ ] **Step 10: Run to verify pass**

Run: `npx vitest run electron/sidecar-bundle.test.js electron/preload.native.test.js`
Expected: PASS (extraction round-trip + both preload channel assertions).

- [ ] **Step 11: Commit**

```bash
git add electron/sidecar-bundle.js electron/sidecar-bundle.test.js electron/__fixtures__/bundle-sample.tar.zst electron/main.js electron/preload.js electron/preload.native.test.js package.json package-lock.json
git commit -m "feat(electron): download, verify and unpack sidecar bundles via IPC"
```

---

### Task 8: Renderer `nativeModelStore` bundle state + progress wiring

**Files:**
- Modify: `src/stores/nativeModelStore.ts` (state fields + `refreshBundle`/`installBundle` actions + selectors + helpers)
- Test: `src/stores/nativeModelStore.test.ts` (append a bundle suite)

**Interfaces:**
- Consumes: IPC channels `sidecar-bundle:status`, `sidecar-bundle:install`, and the `sidecar-bundle-progress` push (Task 7).
- Produces (store additions):
  - state: `bundleSku: string|null`, `bundleStatus: 'unknown'|'absent'|'installing'|'ready'|'error'`, `bundleVersion: string|null`, `bundleProgress: { downloaded: number; total: number }`, `bundleError: string`
  - actions: `refreshBundle(): Promise<void>`, `installBundle(): Promise<void>`
  - selectors: `useNativeBundleStatus`, `useNativeBundleProgress`

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/nativeModelStore.test.ts`:

```typescript
describe('nativeModelStore bundle install (spec D10)', () => {
  it('refreshBundle reflects the installed status', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, sku: 'nvidia', installed: true, version: '0.30.6' }),
    };
    await useNativeModelStore.getState().refreshBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleSku).toBe('nvidia');
    expect(s.bundleStatus).toBe('ready');
    expect(s.bundleVersion).toBe('0.30.6');
  });

  it('installBundle streams progress then flips to ready', async () => {
    let progressCb: ((p: any) => void) | null = null;
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, sku: 'directml', version: '0.30.6' }),
      receive: (ch: string, f: any) => { if (ch === 'sidecar-bundle-progress') progressCb = f; },
      removeListener: () => {},
    };
    const p = useNativeModelStore.getState().installBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('installing');
    progressCb?.({ downloaded: 5, total: 10 });
    expect(useNativeModelStore.getState().bundleProgress).toEqual({ downloaded: 5, total: 10 });
    await p;
    expect(useNativeModelStore.getState().bundleStatus).toBe('ready');
    expect(useNativeModelStore.getState().bundleVersion).toBe('0.30.6');
  });

  it('installBundle surfaces an install error (e.g. hosting not configured)', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: false, error: 'hosting not configured' }),
      receive: () => {}, removeListener: () => {},
    };
    await useNativeModelStore.getState().installBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('error');
    expect(useNativeModelStore.getState().bundleError).toBe('hosting not configured');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — `refreshBundle`/`installBundle` are not functions; `bundleStatus` is undefined.

- [ ] **Step 3: Add the bundle interface fields**

In `src/stores/nativeModelStore.ts`, in the `NativeModelStore` interface, add these members right after the `sidecarStatus` field (currently line 18):

```typescript
  /** Detected bundle SKU for this machine (nvidia | directml | mac). */
  bundleSku: string | null;
  /** Self-contained sidecar bundle lifecycle (spec D10). */
  bundleStatus: 'unknown' | 'absent' | 'installing' | 'ready' | 'error';
  /** Installed bundle version (from its bundle.json marker), if any. */
  bundleVersion: string | null;
  /** Live download progress while `bundleStatus === 'installing'`. */
  bundleProgress: { downloaded: number; total: number };
  /** Last bundle install error (empty when none). */
  bundleError: string;
  /** Query the main process for the detected SKU + installed bundle status. */
  refreshBundle: () => Promise<void>;
  /** Download + unpack the machine's bundle via IPC, streaming progress. */
  installBundle: () => Promise<void>;
```

- [ ] **Step 4: Add the IPC helpers**

In `src/stores/nativeModelStore.ts`, after the `revalidateNativeProvider` function (after line 80), add:

```typescript
// Direct main-process IPC for the self-contained bundle flow. The bundle is
// downloaded by the main process (the sidecar it provides is not yet running),
// so this bypasses the WS NativeModelClient and talks to window.electron.
function bundleInvoke(channel: string, data?: unknown): Promise<any> {
  const e = (window as unknown as { electron?: { invoke(c: string, d?: unknown): Promise<any> } }).electron;
  if (!e) throw new Error('window.electron unavailable (not running in Electron)');
  return e.invoke(channel, data);
}

function onBundleProgress(cb: (p: { downloaded: number; total: number }) => void): (() => void) | null {
  const e = (window as unknown as {
    electron?: {
      receive?: (c: string, f: (p: any) => void) => void;
      removeListener?: (c: string, f: (p: any) => void) => void;
    };
  }).electron;
  if (!e?.receive) return null;
  const handler = (p: any) => cb(p);
  e.receive('sidecar-bundle-progress', handler);
  return () => e.removeListener?.('sidecar-bundle-progress', handler);
}
```

- [ ] **Step 5: Add the initial state + actions**

In `src/stores/nativeModelStore.ts`, in the `create<NativeModelStore>` initial object, after the `ttsResolved: null,` line (line 95), add:

```typescript
  bundleSku: null,
  bundleStatus: 'unknown',
  bundleVersion: null,
  bundleProgress: { downloaded: 0, total: 0 },
  bundleError: '',

  refreshBundle: async () => {
    try {
      const r = await bundleInvoke('sidecar-bundle:status');
      if (r?.ok) {
        set({
          bundleSku: r.sku ?? null,
          bundleStatus: r.installed ? 'ready' : 'absent',
          bundleVersion: r.version ?? null,
        });
      }
    } catch {
      // best-effort; a dev checkout with no bundle simply stays 'unknown'
    }
  },

  installBundle: async () => {
    set({ bundleStatus: 'installing', bundleProgress: { downloaded: 0, total: 0 }, bundleError: '' });
    const off = onBundleProgress((p) =>
      set({ bundleProgress: { downloaded: p.downloaded, total: p.total } }));
    try {
      const r = await bundleInvoke('sidecar-bundle:install');
      off?.();
      if (r?.ok) {
        set({ bundleStatus: 'ready', bundleSku: r.sku ?? null, bundleVersion: r.version ?? null });
      } else {
        set({ bundleStatus: 'error', bundleError: r?.error || 'bundle install failed' });
      }
    } catch (err) {
      off?.();
      set({ bundleStatus: 'error', bundleError: err instanceof Error ? err.message : String(err) });
    }
  },
```

- [ ] **Step 6: Add the selectors**

In `src/stores/nativeModelStore.ts`, after the `useNativeTtsResolved` selector (line 271), add:

```typescript
export const useNativeBundleStatus = () => useNativeModelStore((s) => s.bundleStatus);
export const useNativeBundleProgress = () => useNativeModelStore((s) => s.bundleProgress);
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (the existing suites plus the three new bundle tests).

- [ ] **Step 8: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): track sidecar bundle install + progress in nativeModelStore"
```

---

## Full-suite verification (after Task 8)

- [ ] **Python sidecar suite** — Run: `cd sidecar && .venv/bin/python -m pytest -q`
  Expected: PASS (including `test_sku_requirements.py`, `test_build_sidecar_bundle.py`, `test_sidecar_bundles_workflow.py`, and the unchanged `test_torch_free_gate.py`).
- [ ] **JS/TS touched suites** — Run: `npx vitest run electron/ src/stores/nativeModelStore.test.ts`
  Expected: PASS.

---

## Deferred hardware verification (NOT tasks — needs Windows / macOS hardware)

The dev machine is Linux + NVIDIA. Everything above is testable there via the linux-nvidia bundle plus Linux-runnable stubs (SKU detection, launch resolution, requirements parsing, archive round-trip, extractor fixture, store progress). The following require physical Windows / Apple-Silicon machines and are gated behind the `sidecar-bundles.yml` CI jobs + manual QA:

1. **win-nvidia bundle boot** — CI `build-windows` (sku `win-nvidia`) produces the archive; on a real NVIDIA Windows box: unpack, launch `python\python.exe -m sokuji_sidecar` (cwd = `app`), confirm the `{"port": n}` handshake + a `ping`→`pong`, and confirm `onnxruntime.preload_dlls()` brings up the CUDA EP (spec D8) with no `LD_LIBRARY_PATH`-style shim.
2. **win-directml bundle boot + Python 3.12 wheel set** — confirm `onnxruntime-directml==1.24.4` imports on the bundle's CPython 3.12 (DML needs ≥3.11), all graphs (including autoregressive) run on DML with no AR→CPU routing (spec D2), and the ORT 1.24.4 opset ceiling loads our ONNX exports (spec D2 / the spec's Windows checklist items 1–3).
3. **mac (Apple Silicon) bundle boot + MLX** — confirm the `aarch64-apple-darwin` embedded CPython 3.12 boots, `mlx-audio` imports and the P6 MLX TTS lane runs, and plain `onnxruntime==1.23.2` CPU serves the non-MLX stages. (Intel macs are out of scope — the `mac` SKU targets Apple Silicon only; an Intel mac would wrongly resolve to this bundle. Track separately if Intel support is ever required.)
4. **AntiVirus / SmartScreen** — the bundles ship an unsigned embedded interpreter + native `.dll`/`.dylib`/`.so` wheels. On Windows, expect SmartScreen prompts and possible AV quarantine of `python.exe` / ONNX/CUDA DLLs; on macOS, Gatekeeper will block unsigned/un-notarized binaries. **Signing/notarization is an explicit operator follow-up (out of scope here):** macOS `codesign` + `notarytool` over the bundle, Windows Authenticode over `python.exe` and the app, plus an EV cert or reputation build-up for SmartScreen.
5. **Hosting wiring** — pick HF releases vs GitHub releases (operator decision), publish `manifest.json` + the four `sidecar-<sku>-v<version>.tar.zst` archives, set `SOKUJI_SIDECAR_BUNDLE_BASE_URL` in the packaged app, then run `installBundle` end-to-end on each OS (download → sha256 verify → extract → atomic swap → boot).
6. **Linux non-NVIDIA (D10 open item)** — decide whether the nvidia bundle's CPU fallback is acceptable on a non-NVIDIA Linux box or a dedicated CPU SKU is warranted; `detectSku` currently routes it to `nvidia`.
