# Translate llama.cpp + ONNX Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the native sidecar translation domain off torch/transformers — 9 LLM cards onto llama.cpp (llama-server subprocess, GGUF), 13 Opus-MT cards onto onnxruntime (Xenova int8 exports, CPU-only).

**Architecture:** A new `llama_runtime.py` owns llama-app binary acquisition (llama.app HF bucket / GitHub releases, pinned `b9835`) and `LlamaServerProc` subprocess management (spawn → `/health` poll → OpenAI-compatible HTTP). Three thin `llamacpp_*` backends + one `opus_onnx_translate` backend replace the five transformers backends behind the unchanged `TranslateEngine` contract. GGUF/ONNX artifacts are mirrored into per-card-variant HF model repos so the existing repo-based download/variant machinery works unchanged.

**Tech Stack:** Python 3.10 sidecar (stdlib urllib/subprocess, `zstandard`, `tokenizers`, `onnxruntime`, `numpy`, `huggingface_hub`), llama.cpp b9835, TypeScript/React renderer.

**Spec:** `docs/superpowers/specs/2026-07-03-translate-llamacpp-migration-design.md`

## Global Constraints

- llama.cpp pinned version: **`b9835`** (bucket + GitHub release tag; ≥ b8xxx required for Qwen3.5 correctness).
- Mirror namespace: `SOKUJI_TRANSLATE_NS` env var, default **`jiangzhuo9357`**. GGUF repos: `{NS}/sokuji-translate-{card_id}-{quant}` (exactly one `.gguf` file each). Opus repos: `{NS}/sokuji-translate-{opus_card_id}` (the 6-file Xenova set). *(Refines the spec's "one owned dataset": per-artifact **model** repos ride the existing `hf_hub_download`/variant-repo-override machinery with zero changes and give per-variant delete for free.)*
- Binary storage: `~/.config/Sokuji/llama-bin/<version>/<flavor>/` (override: `SOKUJI_LLAMA_BIN_DIR`). Flavors: `cuda`, `metal`, `cpu` (`vulkan` reserved). Entry point: `llama` (bucket single-file, Linux/macOS) / `llama-server.exe` (GitHub zip, Windows).
- New backend NAMEs: `llamacpp_qwen`, `llamacpp_hunyuan`, `llamacpp_gemma`, `opus_onnx_translate`. Old NAMEs (`qwen_translate`, `qwen35_translate`, `hunyuan_translate`, `gemma_translate`, `opus_translate`) are deleted in Task 12.
- Quant defaults: `q8_0` for qwen2.5-0.5b and qwen3-0.6b; `q4_k_m` for everything else. Every LLM card exposes exactly the two variants `q4_k_m` and `q8_0`. Default quant Deployment rank = 2.0, alternate = 1.0 (rank encodes the default).
- llama-server requests: `temperature 0`, `max_tokens 512` (gemma: 256), per-request timeout 120 s. No `-ngl` flag ever (rely on `auto` + `--fit on`); `--fit-target = 1024 + reserved_MiB` on GPU tiers.
- The proactive VRAM gate in `load_with_fallback` and the weight-based math in `select_variant` MUST NOT apply to `llamacpp_*` plans.
- No torch/transformers imports in any new/rewritten translate module.
- English-only comments. Conventional commits. Tests: `cd sidecar && python -m pytest tests/<file> -v` (sidecar venv). Renderer tests: `npm run test -- <path>`.
- Working dir: repo worktree `.claude/worktrees/native-sidecar-phase1`, branch `native-sidecar`.

---

### Task 1: llama_runtime — flavors, paths, asset URLs

**Files:**
- Create: `sidecar/sokuji_sidecar/llama_runtime.py`
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Produces: `BUCKET_VERSION: str`, `flavor_for_device(device: str) -> str`, `bin_root() -> str`, `binary_path(flavor: str) -> str | None`, `bucket_url(rel: str) -> str`, `gh_url(asset: str) -> str`, `default_flavor() -> str`, `ASSET_SHA256: dict[str, str]`.

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_llama_runtime.py
import os
import pytest

from sokuji_sidecar import llama_runtime as rt


def test_flavor_for_device():
    assert rt.flavor_for_device("cuda") == "cuda"
    assert rt.flavor_for_device("metal") == "metal"
    assert rt.flavor_for_device("cpu") == "cpu"
    with pytest.raises(KeyError):
        rt.flavor_for_device("dml")


def test_bin_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    assert rt.bin_root() == os.path.join(str(tmp_path), rt.BUCKET_VERSION)


def test_bin_root_default(monkeypatch):
    monkeypatch.delenv("SOKUJI_LLAMA_BIN_DIR", raising=False)
    assert rt.bin_root().endswith(os.path.join("Sokuji", "llama-bin", rt.BUCKET_VERSION))


def test_binary_path_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    assert rt.binary_path("cuda") is None


def test_binary_path_present(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    exe_dir = tmp_path / rt.BUCKET_VERSION / "cuda"
    exe_dir.mkdir(parents=True)
    exe = exe_dir / rt._exe_name()
    exe.write_bytes(b"#!fake")
    assert rt.binary_path("cuda") == str(exe)


def test_urls():
    assert rt.bucket_url("x86_64/linux/cuda/89/llama-app.zst") == (
        "https://huggingface.co/buckets/ggml-org/install.sh/resolve/"
        f"{rt.BUCKET_VERSION}/x86_64/linux/cuda/89/llama-app.zst")
    assert rt.gh_url(f"llama-{rt.BUCKET_VERSION}-bin-win-cuda-12.4-x64.zip").startswith(
        "https://github.com/ggml-org/llama.cpp/releases/download/")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_llama_runtime.py -v`
Expected: FAIL / error — `No module named 'sokuji_sidecar.llama_runtime'`

- [ ] **Step 3: Write the implementation**

```python
# sidecar/sokuji_sidecar/llama_runtime.py
"""llama.cpp runtime for the llamacpp_* translate backends.

Two responsibilities:
  1. Binary acquisition — the official single-file `llama-app` from the
     llama.app HF bucket (Linux CUDA/Vulkan/CPU, macOS Metal), or the official
     GitHub release zips on Windows. Pinned to BUCKET_VERSION; sha256-verified
     when the asset's hash is known (unknown new bucket configs proceed with a
     logged warning rather than bricking).
  2. Process management — LlamaServerProc spawns `llama serve` on a free
     localhost port, polls /health until ready, and exposes the
     OpenAI-compatible /v1/chat/completions endpoint.
"""
import os
import platform

from .backends import BackendLoadError

BUCKET_VERSION = "b9835"
_BUCKET_BASE = "https://huggingface.co/buckets/ggml-org/install.sh/resolve"
_GH_BASE = "https://github.com/ggml-org/llama.cpp/releases/download"

# sha256 per asset path/name, recorded by scripts/record_llama_checksums.py.
# A missing entry logs a warning instead of failing: the bucket grows new
# SM/chip configs without notice and we must not brick those machines.
ASSET_SHA256: dict[str, str] = {}

_FLAVORS = {"cuda": "cuda", "metal": "metal", "cpu": "cpu"}


def flavor_for_device(device: str) -> str:
    """Map a Plan.device to a binary flavor. KeyError on unsupported devices."""
    return _FLAVORS[device]


def bin_root() -> str:
    base = os.environ.get("SOKUJI_LLAMA_BIN_DIR") or os.path.join(
        os.path.expanduser("~/.config/Sokuji"), "llama-bin")
    return os.path.join(base, BUCKET_VERSION)


def _exe_name() -> str:
    return "llama-server.exe" if platform.system() == "Windows" else "llama"


def binary_path(flavor: str) -> str | None:
    """Installed binary path for `flavor`, or None when not yet downloaded."""
    exe = os.path.join(bin_root(), flavor, _exe_name())
    return exe if os.path.isfile(exe) else None


def bucket_url(rel: str) -> str:
    return f"{_BUCKET_BASE}/{BUCKET_VERSION}/{rel}"


def gh_url(asset: str) -> str:
    return f"{_GH_BASE}/{BUCKET_VERSION}/{asset}"


def default_flavor() -> str:
    """The best flavor for this machine (drives the model-download dependency)."""
    from . import accel
    m = accel.probe()
    if m.nvidia:
        return "cuda"
    if m.apple_silicon:
        return "metal"
    return "cpu"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_llama_runtime.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py
git commit -m "feat(sidecar): llama runtime skeleton — flavors, paths, asset URLs"
```

---

### Task 2: llama_runtime — ensure_binary (download / verify / extract)

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py`
- Modify: `sidecar/requirements.txt` (add `zstandard`, `tokenizers`)
- Create: `scripts/record_llama_checksums.py`
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Produces: `ensure_binary(flavor: str, progress=None) -> str` (returns exe path; `progress` is an optional `Callable[[], None]` invoked once when the download starts), `_probe_config(flavor: str) -> str` (internal, monkeypatchable).

- [ ] **Step 1: Add `zstandard` + `tokenizers` to requirements**

```
# sidecar/requirements.txt — append:
zstandard==0.23.0
tokenizers>=0.20
```

Run: `cd sidecar && ./.venv/bin/pip install zstandard==0.23.0 "tokenizers>=0.20"` (adjust to however the sidecar venv is managed — `setup.sh` installs requirements.txt).

- [ ] **Step 2: Write the failing tests**

Append to `sidecar/tests/test_llama_runtime.py`:

```python
import io
import zstandard


def _zst(data: bytes) -> bytes:
    return zstandard.ZstdCompressor().compress(data)


def test_ensure_binary_downloads_and_extracts(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt, "_probe_config", lambda flavor: "89")
    fetched = []

    def fake_fetch(url):
        fetched.append(url)
        return _zst(b"ELF-fake-llama")
    monkeypatch.setattr(rt, "_fetch", fake_fetch)
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    monkeypatch.setattr(rt.platform, "machine", lambda: "x86_64")

    path = rt.ensure_binary("cuda")
    assert path == rt.binary_path("cuda")
    assert open(path, "rb").read() == b"ELF-fake-llama"
    assert os.access(path, os.X_OK)
    assert fetched == [rt.bucket_url("x86_64/linux/cuda/89/llama-app.zst")]


def test_ensure_binary_is_idempotent(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    exe_dir = tmp_path / rt.BUCKET_VERSION / "cpu"
    exe_dir.mkdir(parents=True)
    (exe_dir / rt._exe_name()).write_bytes(b"already")
    monkeypatch.setattr(rt, "_fetch",
                        lambda url: (_ for _ in ()).throw(AssertionError("no fetch")))
    assert rt.ensure_binary("cpu") == rt.binary_path("cpu")


def test_ensure_binary_checksum_mismatch(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt, "_probe_config", lambda flavor: "89")
    monkeypatch.setattr(rt, "_fetch", lambda url: _zst(b"tampered"))
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    monkeypatch.setattr(rt.platform, "machine", lambda: "x86_64")
    monkeypatch.setitem(rt.ASSET_SHA256, "x86_64/linux/cuda/89/llama-app.zst", "0" * 64)
    with pytest.raises(rt.BinaryFetchError):
        rt.ensure_binary("cuda")
    assert rt.binary_path("cuda") is None  # nothing half-installed
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_llama_runtime.py -v -k ensure_binary`
Expected: FAIL — `AttributeError: module ... has no attribute '_probe_config'`

- [ ] **Step 4: Write the implementation**

Append to `llama_runtime.py`:

```python
import hashlib
import shutil
import subprocess
import sys
import tempfile


class BinaryFetchError(Exception):
    """Binary download/verification failed (network, 404, checksum)."""


def _fetch(url: str) -> bytes:
    """GET a URL fully into memory (assets are ≤ ~370 MB). Separate function so
    tests monkeypatch it."""
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "sokuji-sidecar"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def _verify(rel: str, blob: bytes) -> None:
    want = ASSET_SHA256.get(rel)
    if want is None:
        print(f"[llama_runtime] no recorded sha256 for {rel}; skipping verification",
              file=sys.stderr)
        return
    got = hashlib.sha256(blob).hexdigest()
    if got != want:
        raise BinaryFetchError(f"sha256 mismatch for {rel}: got {got}, want {want}")


def _run_probe(rel: str, workdir: str) -> str:
    """Download one of the bucket's official probe binaries, run it, return its
    stdout config string (e.g. '89' for a CUDA SM 8.9 GPU)."""
    blob = _fetch(bucket_url(rel))
    _verify(rel, blob)
    if rel.endswith(".zst"):
        import zstandard
        blob = zstandard.ZstdDecompressor().decompress(blob, max_output_size=1 << 30)
    path = os.path.join(workdir, os.path.basename(rel).removesuffix(".zst"))
    with open(path, "wb") as f:
        f.write(blob)
    os.chmod(path, 0o755)
    out = subprocess.run([path], capture_output=True, text=True, timeout=60)
    if out.returncode != 0 or not out.stdout.strip():
        raise BinaryFetchError(f"probe {rel} failed: rc={out.returncode} {out.stderr[-200:]}")
    return out.stdout.strip().splitlines()[0]


def _metal_config() -> str:
    """Apple chip family from the CPU brand string ('Apple M4 Pro' -> 'm4')."""
    brand = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                           capture_output=True, text=True, timeout=10).stdout
    parts = brand.split()
    if len(parts) >= 2 and parts[0] == "Apple" and parts[1][:2] in (
            "M1", "M2", "M3", "M4", "M5"):
        return parts[1][:2].lower()
    raise BinaryFetchError(f"unsupported Apple chip: {brand.strip()!r}")


def _probe_config(flavor: str) -> str:
    """Resolve the bucket config segment for `flavor` on this machine."""
    arch = "aarch64" if platform.machine() in ("arm64", "aarch64") else "x86_64"
    osname = {"Linux": "linux", "Darwin": "macos"}[platform.system()]
    with tempfile.TemporaryDirectory() as wd:
        if flavor == "cuda":
            return _run_probe(f"{arch}/{osname}/cuda/probe/probe.zst", wd)
        if flavor == "metal":
            return _metal_config()
        # cpu: the bucket keys CPU builds by the featcode output
        return _run_probe(f"{arch}/{osname}/featcode", wd)


def _install_from_bucket(flavor: str, dest_dir: str) -> str:
    import zstandard
    arch = "aarch64" if platform.machine() in ("arm64", "aarch64") else "x86_64"
    osname = {"Linux": "linux", "Darwin": "macos"}[platform.system()]
    config = _probe_config(flavor)
    rel = f"{arch}/{osname}/{flavor}/{config}/llama-app.zst"
    blob = _fetch(bucket_url(rel))
    _verify(rel, blob)
    raw = zstandard.ZstdDecompressor().decompress(blob, max_output_size=4 << 30)
    tmp = os.path.join(dest_dir, _exe_name() + ".tmp")
    with open(tmp, "wb") as f:
        f.write(raw)
    os.chmod(tmp, 0o755)
    final = os.path.join(dest_dir, _exe_name())
    os.replace(tmp, final)
    return final


def _install_from_github(flavor: str, dest_dir: str) -> str:
    """Windows: official release zips. CUDA needs the separate cudart zip
    unpacked next to the exe (that's how upstream distributes it)."""
    import io
    import zipfile
    assets = {"cuda": [f"llama-{BUCKET_VERSION}-bin-win-cuda-12.4-x64.zip",
                       f"cudart-llama-bin-win-cuda-12.4-x64.zip"],
              "cpu": [f"llama-{BUCKET_VERSION}-bin-win-cpu-x64.zip"]}[flavor]
    for asset in assets:
        blob = _fetch(gh_url(asset))
        _verify(asset, blob)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(dest_dir)
    exe = os.path.join(dest_dir, _exe_name())
    if not os.path.isfile(exe):
        # release zips may nest binaries under a top-level dir — flatten
        for root, _dirs, files in os.walk(dest_dir):
            if _exe_name() in files and root != dest_dir:
                for fn in files:
                    os.replace(os.path.join(root, fn), os.path.join(dest_dir, fn))
                break
    if not os.path.isfile(exe):
        raise BinaryFetchError(f"{_exe_name()} not found in {assets}")
    return exe


def ensure_binary(flavor: str, progress=None) -> str:
    """Return the installed binary for `flavor`, downloading it first if needed.
    Raises BinaryFetchError on any failure; never leaves a half-installed exe
    (writes land in a temp dir that is only renamed into place on success)."""
    existing = binary_path(flavor)
    if existing is not None:
        return existing
    if progress is not None:
        progress()
    final_dir = os.path.join(bin_root(), flavor)
    tmp_dir = final_dir + ".tmp"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.makedirs(tmp_dir, exist_ok=True)
    try:
        if platform.system() == "Windows":
            _install_from_github(flavor, tmp_dir)
        else:
            _install_from_bucket(flavor, tmp_dir)
        shutil.rmtree(final_dir, ignore_errors=True)
        os.replace(tmp_dir, final_dir)
    except BinaryFetchError:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise BinaryFetchError(str(e))
    return os.path.join(final_dir, _exe_name())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_llama_runtime.py -v`
Expected: all PASS

- [ ] **Step 6: Write the checksum recorder script**

```python
#!/usr/bin/env python3
# scripts/record_llama_checksums.py
"""Record sha256 for every llama.app bucket / GitHub release asset we may
download, printed as the ASSET_SHA256 dict body for llama_runtime.py.

Run on a dev box with network access; paste the output into
sidecar/sokuji_sidecar/llama_runtime.py. Unknown configs 404 and are skipped.
"""
import hashlib
import sys
import urllib.request

VERSION = "b9835"
BUCKET = f"https://huggingface.co/buckets/ggml-org/install.sh/resolve/{VERSION}"
GH = f"https://github.com/ggml-org/llama.cpp/releases/download/{VERSION}"

CUDA_SMS = ["61", "70", "75", "80", "86", "89", "90", "100", "110", "120"]
METAL = ["m1", "m2", "m3", "m4", "m5"]

CANDIDATES = (
    [f"x86_64/linux/cuda/probe/probe.zst"]
    + [f"x86_64/linux/cuda/{sm}/llama-app.zst" for sm in CUDA_SMS]
    + [f"x86_64/linux/featcode"]
    + [f"aarch64/macos/metal/{m}/llama-app.zst" for m in METAL]
)
GH_ASSETS = [f"llama-{VERSION}-bin-win-cuda-12.4-x64.zip",
             f"cudart-llama-bin-win-cuda-12.4-x64.zip",
             f"llama-{VERSION}-bin-win-cpu-x64.zip"]


def sha(url):
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=600) as r:
        while chunk := r.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def main():
    print("ASSET_SHA256 = {")
    for rel in CANDIDATES:
        try:
            print(f'    "{rel}": "{sha(f"{BUCKET}/{rel}")}",')
        except Exception as e:
            print(f"  skip {rel}: {e}", file=sys.stderr)
    for asset in GH_ASSETS:
        try:
            print(f'    "{asset}": "{sha(f"{GH}/{asset}")}",')
        except Exception as e:
            print(f"  skip {asset}: {e}", file=sys.stderr)
    print("}")
    print("# NOTE: linux cpu configs are featcode-keyed; run ensure_binary('cpu')",
          "on target machines or extend CANDIDATES when configs are known.")


if __name__ == "__main__":
    main()
```

Run: `python3 scripts/record_llama_checksums.py > /tmp/llama-sha.txt` (takes a while — several GB of downloads), then replace the empty `ASSET_SHA256 = {...}` in `llama_runtime.py` with the output.

- [ ] **Step 7: Re-run full runtime tests, commit**

Run: `cd sidecar && python -m pytest tests/test_llama_runtime.py -v`
Expected: all PASS

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py \
        sidecar/requirements.txt scripts/record_llama_checksums.py
git commit -m "feat(sidecar): llama binary acquisition with sha256 verification"
```

---

### Task 3: llama_runtime — LlamaServerProc lifecycle

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py`
- Test: `sidecar/tests/test_llama_server_proc.py`

**Interfaces:**
- Produces: `class LlamaServerProc(binary: str, gguf: str, ctx: int = 4096, fit_target_mib: int | None = None)` with `.start(timeout: float = 120.0) -> None` (raises `BackendLoadError`), `.alive() -> bool`, `.stop() -> None`, `.restart() -> None`, `.port: int`, `.stderr_tail() -> str`; module helper `_free_port() -> int`.

- [ ] **Step 1: Write the fake llama-server used by tests**

The fake is a Python script the tests write to disk; it accepts the real CLI shape (`serve -m ... --port N ...`) and serves `/health` (503 × N then 200). Put the generator in the test file:

```python
# sidecar/tests/test_llama_server_proc.py
import json
import os
import sys
import time
import urllib.request

import pytest

from sokuji_sidecar import llama_runtime as rt
from sokuji_sidecar.backends import BackendLoadError

FAKE = r'''
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

args = sys.argv[1:]
port = int(args[args.index("--port") + 1])
mode = "@MODE@"
if mode == "crash":
    sys.stderr.write("boom: failed to load model\n")
    sys.exit(1)
loading_until = time.time() + 0.3

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/health":
            if time.time() < loading_until:
                self.send_response(503); self.end_headers()
            else:
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n))
        if mode == "die-on-post":
            import os; os._exit(1)
        out = {"choices": [{"message": {"content": "TRANSLATED:" + body["messages"][-1]["content"]}}],
               "usage": {"completion_tokens": 7},
               "echo": body}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

HTTPServer(("127.0.0.1", port), H).serve_forever()
'''


def make_fake(tmp_path, mode="ok"):
    exe = tmp_path / "fake_llama.py"
    exe.write_text(FAKE.replace("@MODE@", mode))
    return [sys.executable, str(exe)]


@pytest.fixture
def gguf(tmp_path):
    p = tmp_path / "model.gguf"
    p.write_bytes(b"GGUF")
    return str(p)


def test_start_waits_for_health(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path), gguf)
    proc.start(timeout=15)
    try:
        assert proc.alive()
        with urllib.request.urlopen(f"http://127.0.0.1:{proc.port}/health") as r:
            assert r.status == 200
    finally:
        proc.stop()
    assert not proc.alive()


def test_start_crash_surfaces_stderr(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path, mode="crash"), gguf)
    with pytest.raises(BackendLoadError) as ei:
        proc.start(timeout=15)
    assert "boom" in str(ei.value)


def test_start_builds_expected_args(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path), gguf, ctx=4096, fit_target_mib=1536)
    args = proc._build_args()
    assert "-m" in args and gguf in args
    assert "--no-webui" in args and "-c" in args and "4096" in args
    assert "--fit-target" in args and "1536" in args
    assert "-ngl" not in args
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_llama_server_proc.py -v`
Expected: FAIL — `AttributeError: ... no attribute 'LlamaServerProc'`

- [ ] **Step 3: Write the implementation**

Append to `llama_runtime.py`:

```python
import collections
import socket
import threading
import time


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LlamaServerProc:
    """One llama-server child serving one GGUF on a free localhost port.

    `binary` is either a path string (real runtime) or an argv prefix list
    (tests inject `[sys.executable, fake.py]`)."""

    def __init__(self, binary, gguf: str, ctx: int = 4096,
                 fit_target_mib: int | None = None):
        self._binary = [binary] if isinstance(binary, str) else list(binary)
        self._gguf = gguf
        self._ctx = ctx
        self._fit_target = fit_target_mib
        self._proc = None
        self._stderr = collections.deque(maxlen=200)
        self.port = 0

    def _build_args(self) -> list[str]:
        # The bucket single-file `llama` app needs the `serve` subcommand; the
        # Windows GitHub-release `llama-server.exe` IS the server already.
        serve = [] if os.path.basename(
            str(self._binary[-1])).startswith("llama-server") else ["serve"]
        args = self._binary + serve + ["-m", self._gguf,
                               "--host", "127.0.0.1", "--port", str(self.port),
                               "--no-webui", "-c", str(self._ctx),
                               "--log-colors", "off"]
        if self._fit_target is not None:
            args += ["--fit-target", str(self._fit_target)]
        return args

    def _pump_stderr(self, pipe):
        for line in iter(pipe.readline, b""):
            text = line.decode("utf-8", "replace").rstrip()
            self._stderr.append(text)
            print(f"[llama-server] {text}", file=sys.stderr)
        pipe.close()

    def stderr_tail(self) -> str:
        return "\n".join(list(self._stderr)[-20:])

    def start(self, timeout: float = 120.0) -> None:
        self.port = _free_port()
        kwargs = {}
        if platform.system() == "Linux":
            import ctypes
            libc = ctypes.CDLL("libc.so.6", use_errno=True)
            kwargs["preexec_fn"] = lambda: libc.prctl(1, 15)  # PR_SET_PDEATHSIG, SIGTERM
        elif platform.system() == "Windows":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        self._proc = subprocess.Popen(
            self._build_args(), stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, **kwargs)
        threading.Thread(target=self._pump_stderr, args=(self._proc.stderr,),
                         daemon=True).start()
        import atexit
        atexit.register(self.stop)
        deadline = time.time() + timeout
        import urllib.error
        import urllib.request
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise BackendLoadError(
                    f"llama-server exited rc={self._proc.returncode}: {self.stderr_tail()}")
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/health", timeout=2) as r:
                    if r.status == 200:
                        return
            except urllib.error.HTTPError as e:
                if e.code != 503:
                    raise BackendLoadError(f"health returned {e.code}")
            except OSError:
                pass
            time.sleep(0.2)
        self.stop()
        raise BackendLoadError(f"llama-server not ready in {timeout:.0f}s: {self.stderr_tail()}")

    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def stop(self) -> None:
        if self._proc is None:
            return
        if self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=5)
        self._proc = None

    def restart(self) -> None:
        self.stop()
        self.start()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_llama_server_proc.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_server_proc.py
git commit -m "feat(sidecar): LlamaServerProc — spawn, health poll, orphan guard"
```

---

### Task 4: llama_runtime — HTTP client, gguf_path, reserved-bytes plumbing

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py`
- Test: `sidecar/tests/test_llama_server_proc.py`, `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Produces: `LlamaServerProc.chat(payload: dict, timeout: float = 120.0) -> dict`, `LlamaServerProc.completion(payload: dict, timeout: float = 120.0) -> dict`, `gguf_path(repo: str) -> str` (raises `BackendLoadError` unless exactly one `.gguf`), `set_reserved_bytes(n: int) -> None`, `get_reserved_bytes() -> int`.

- [ ] **Step 1: Write the failing tests**

Append to `test_llama_server_proc.py`:

```python
def test_chat_roundtrip(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path), gguf)
    proc.start(timeout=15)
    try:
        reply = proc.chat({"messages": [{"role": "user", "content": "hola"}],
                           "temperature": 0, "max_tokens": 512})
        assert reply["choices"][0]["message"]["content"] == "TRANSLATED:hola"
        assert reply["usage"]["completion_tokens"] == 7
    finally:
        proc.stop()


def test_chat_on_dead_process_raises(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path, mode="die-on-post"), gguf)
    proc.start(timeout=15)
    try:
        with pytest.raises(Exception):
            proc.chat({"messages": [{"role": "user", "content": "x"}]})
        assert not proc.alive()
    finally:
        proc.stop()
```

Append to `test_llama_runtime.py`:

```python
def test_gguf_path_single_file(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "w.gguf").write_bytes(b"GGUF")
    assert rt.gguf_path(str(tmp_path)).endswith("w.gguf")


def test_gguf_path_requires_exactly_one(tmp_path):
    from sokuji_sidecar.backends import BackendLoadError
    (tmp_path / "a.gguf").write_bytes(b"GGUF")
    (tmp_path / "b.gguf").write_bytes(b"GGUF")
    with pytest.raises(BackendLoadError):
        rt.gguf_path(str(tmp_path))


def test_reserved_bytes_roundtrip():
    rt.set_reserved_bytes(3 << 30)
    assert rt.get_reserved_bytes() == 3 << 30
    rt.set_reserved_bytes(0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_llama_server_proc.py tests/test_llama_runtime.py -v -k "chat or gguf_path or reserved"`
Expected: FAIL — missing attributes

- [ ] **Step 3: Write the implementation**

Append to `llama_runtime.py`:

```python
import json

_RESERVED_BYTES = 0


def set_reserved_bytes(n: int) -> None:
    """VRAM to leave free for the other pipeline stages (ASR/TTS). Set by
    accel.resolve_translate; read by the llamacpp backends to build
    --fit-target. Module-level because the backend load() signature is fixed."""
    global _RESERVED_BYTES
    _RESERVED_BYTES = max(0, int(n))


def get_reserved_bytes() -> int:
    return _RESERVED_BYTES


def gguf_path(repo: str) -> str:
    """Locate the single .gguf inside a local dir or a cached HF snapshot."""
    path = repo
    if not os.path.isdir(path):
        from huggingface_hub import snapshot_download
        try:
            path = snapshot_download(repo, local_files_only=True)
        except Exception as e:
            raise BackendLoadError(f"model {repo} not downloaded: {e}")
    ggufs = [os.path.join(r, f) for r, _d, fs in os.walk(path)
             for f in fs if f.endswith(".gguf")]
    if len(ggufs) != 1:
        raise BackendLoadError(f"expected exactly one .gguf under {repo}, found {len(ggufs)}")
    return ggufs[0]
```

And two methods on `LlamaServerProc`:

```python
    def _post(self, endpoint: str, payload: dict, timeout: float) -> dict:
        import urllib.request
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{endpoint}", data=data,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def chat(self, payload: dict, timeout: float = 120.0) -> dict:
        return self._post("/v1/chat/completions", payload, timeout)

    def completion(self, payload: dict, timeout: float = 120.0) -> dict:
        return self._post("/completion", payload, timeout)
```

- [ ] **Step 4: Run all runtime tests, commit**

Run: `cd sidecar && python -m pytest tests/test_llama_server_proc.py tests/test_llama_runtime.py -v`
Expected: all PASS

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/
git commit -m "feat(sidecar): llama-server HTTP client, gguf locator, VRAM reserve plumbing"
```

---

### Task 5: LlamaCppQwenBackend (+ shared base)

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (ADD new classes; old classes stay until Task 12)
- Test: `sidecar/tests/test_translate_backends.py` (append a new test class; existing tests untouched)

**Interfaces:**
- Consumes: `llama_runtime.flavor_for_device/binary_path/gguf_path/get_reserved_bytes/LlamaServerProc` (Tasks 1–4).
- Produces: `_LlamaCppBase` with hooks `_payload(text, system_prompt, src, tgt, wrap) -> dict`; registered backend `llamacpp_qwen`. All new backends keep the contract `load(model_ref, device, compute_type)`, `translate(...) -> tuple[str, int]`, `unload()`, `is_loaded`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_translate_backends.py` (reuse the fake server from `test_llama_server_proc` by importing its helpers):

```python
import pytest

from sokuji_sidecar import llama_runtime as rt
from sokuji_sidecar.backends import make_backend, BackendLoadError
from tests.test_llama_server_proc import make_fake  # fake llama-server argv


@pytest.fixture
def llama_env(monkeypatch, tmp_path):
    """Point the backend at the fake server + a fake single-gguf model dir."""
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "w.gguf").write_bytes(b"GGUF")
    fake_argv = make_fake(tmp_path)
    monkeypatch.setattr(rt, "binary_path", lambda flavor: fake_argv)
    rt.set_reserved_bytes(0)
    return str(model_dir)


class TestLlamaCppQwen:
    def test_qwen25_payload_and_output(self, llama_env):
        b = make_backend("llamacpp_qwen")
        b.load(llama_env, "cpu", "q8_0")
        # the fake echoes the request back under "echo"
        text, n = b.translate("hello", "", "English", "Chinese", True)
        assert text.startswith("TRANSLATED:")
        assert n == 7
        echo = b._last_reply["echo"]
        assert echo["temperature"] == 0 and echo["max_tokens"] == 512
        assert echo["messages"][0]["role"] == "system"
        assert "/no_think" not in echo["messages"][0]["content"]
        assert echo["messages"][1]["content"] == "<transcript>hello</transcript>"
        b.unload()
        assert not b.is_loaded

    def test_qwen3_gets_no_think(self, llama_env, monkeypatch, tmp_path):
        d = tmp_path / "sokuji-translate-qwen3-0.6b-q8_0"
        d.mkdir()
        (d / "w.gguf").write_bytes(b"GGUF")
        b = make_backend("llamacpp_qwen")
        b.load(str(d), "cpu", "q8_0")
        b.translate("hi", "", "en", "zh", False)
        assert "/no_think" in b._last_reply["echo"]["messages"][0]["content"]
        b.unload()

    def test_qwen35_no_think_absent(self, llama_env, tmp_path):
        d = tmp_path / "sokuji-translate-qwen3.5-0.8b-q4_k_m"
        d.mkdir()
        (d / "w.gguf").write_bytes(b"GGUF")
        b = make_backend("llamacpp_qwen")
        b.load(str(d), "cpu", "q4_k_m")
        b.translate("hi", "", "en", "zh", False)
        assert "/no_think" not in b._last_reply["echo"]["messages"][0]["content"]
        b.unload()

    def test_missing_binary_is_load_error(self, monkeypatch, tmp_path):
        monkeypatch.setattr(rt, "binary_path", lambda flavor: None)
        b = make_backend("llamacpp_qwen")
        with pytest.raises(BackendLoadError):
            b.load(str(tmp_path), "cuda", "q4_k_m")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v -k LlamaCppQwen`
Expected: FAIL — `unknown backend: llamacpp_qwen`

- [ ] **Step 3: Write the implementation**

Add to `translate_backends.py` (below `_clean_output`, above the old classes):

```python
class _LlamaCppBase:
    """Shared llama-server plumbing; subclasses provide NAME + _payload()."""
    MAX_TOKENS = 512

    def __init__(self):
        self._proc = None
        self._ref = ""
        self._last_reply = None   # kept for tests/diagnostics

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        from . import llama_runtime as rt
        self.unload()
        try:
            flavor = rt.flavor_for_device(device)
            binary = rt.binary_path(flavor)
            if binary is None:
                raise BackendLoadError(
                    f"llama runtime ({flavor}) is not installed — download the model again")
            gguf = rt.gguf_path(model_ref)
            fit = None
            if device != "cpu":
                fit = 1024 + rt.get_reserved_bytes() // (1 << 20)
            proc = rt.LlamaServerProc(binary, gguf, fit_target_mib=fit)
            proc.start()
            self._proc = proc
            self._ref = model_ref
        except BackendLoadError:
            raise
        except Exception as e:
            raise BackendLoadError(str(e))

    def _payload(self, text, system_prompt, src, tgt, wrap) -> dict:
        raise NotImplementedError

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        payload = self._payload(text, system_prompt, src, tgt, wrap)
        try:
            reply = self._proc.chat(payload)
        except Exception:
            # One in-place restart when the child died (GGUF already on disk,
            # restart is seconds); a second failure propagates.
            if self._proc is not None and not self._proc.alive():
                self._proc.restart()
                reply = self._proc.chat(payload)
            else:
                raise
        self._last_reply = reply
        content = reply["choices"][0]["message"]["content"]
        n = int((reply.get("usage") or {}).get("completion_tokens") or 0)
        return _clean_output(content), n

    def unload(self) -> None:
        if self._proc is not None:
            self._proc.stop()
            self._proc = None

    @property
    def is_loaded(self) -> bool:
        return self._proc is not None


@register_backend
class LlamaCppQwenBackend(_LlamaCppBase):
    NAME = "llamacpp_qwen"

    def _payload(self, text, system_prompt, src, tgt, wrap):
        sys_p = system_prompt or _default_prompt(src, tgt)
        # Qwen3 (not 3.5) needs thinking mode off; card repos are named
        # sokuji-translate-qwen3-0.6b-* vs ...-qwen3.5-*, so match "qwen3-".
        if "qwen3-" in self._ref.lower():
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "system", "content": sys_p},
                             {"role": "user", "content": user}],
                "temperature": 0, "max_tokens": self.MAX_TOKENS}
```

Also update the module docstring's backend list to mention the new names.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v`
Expected: new tests PASS, all pre-existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(sidecar): llamacpp_qwen backend over llama-server"
```

---

### Task 6: LlamaCppHunyuanBackend + LlamaCppGemmaBackend

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py`
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `_LlamaCppBase` (Task 5), existing `_hunyuan_prompt(tgt)`, `_gemma_code(name)`.
- Produces: registered backends `llamacpp_hunyuan`, `llamacpp_gemma`.

- [ ] **Step 1: Write the failing tests**

Append to `test_translate_backends.py`:

```python
class TestLlamaCppHunyuanGemma:
    def test_hunyuan_single_user_message(self, llama_env):
        b = make_backend("llamacpp_hunyuan")
        b.load(llama_env, "cpu", "q4_k_m")
        b.translate("bonjour", "", "French", "English", True)
        echo = b._last_reply["echo"]
        msgs = echo["messages"]
        assert len(msgs) == 1 and msgs[0]["role"] == "user"
        assert "into English" in msgs[0]["content"]
        assert "<transcript>bonjour</transcript>" in msgs[0]["content"]
        assert "chat_template_kwargs" not in echo
        b.unload()

    def test_gemma_template_kwargs(self, llama_env):
        b = make_backend("llamacpp_gemma")
        b.load(llama_env, "cpu", "q4_k_m")
        b.translate("hello", "ignored-system-prompt", "English", "Japanese", False)
        echo = b._last_reply["echo"]
        assert echo["chat_template_kwargs"] == {
            "source_lang_code": "en", "target_lang_code": "ja"}
        assert echo["messages"] == [{"role": "user", "content": "hello"}]
        assert echo["max_tokens"] == 256
        b.unload()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v -k HunyuanGemma`
Expected: FAIL — `unknown backend: llamacpp_hunyuan`

- [ ] **Step 3: Write the implementation**

Add to `translate_backends.py`:

```python
@register_backend
class LlamaCppHunyuanBackend(_LlamaCppBase):
    NAME = "llamacpp_hunyuan"

    def _payload(self, text, system_prompt, src, tgt, wrap):
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "user", "content": f"{instr}{body}"}],
                "temperature": 0, "max_tokens": self.MAX_TOKENS}


@register_backend
class LlamaCppGemmaBackend(_LlamaCppBase):
    NAME = "llamacpp_gemma"
    MAX_TOKENS = 256

    def _payload(self, text, system_prompt, src, tgt, wrap):
        # TranslateGemma is steered by per-request language codes, not free-text
        # instructions — system_prompt is not applicable to its template.
        # llama-server injects the codes via chat_template_kwargs (PR #19052).
        body = f"<transcript>{text}</transcript>" if wrap else text
        return {"messages": [{"role": "user", "content": body}],
                "chat_template_kwargs": {"source_lang_code": _gemma_code(src),
                                         "target_lang_code": _gemma_code(tgt)},
                "temperature": 0, "max_tokens": self.MAX_TOKENS}
```

Note: the spec's `/completion` self-rendered-prompt fallback is deliberately NOT
wired — `chat_template_kwargs` merged in llama.cpp b7823 and we pin b9835, so
the fallback can never trigger. `LlamaServerProc.completion()` (Task 4) stays
available should a future unpinned build need it.

- [ ] **Step 4: Run tests, commit**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v`
Expected: all PASS

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(sidecar): llamacpp hunyuan + gemma backends"
```

---

### Task 7: Marian ONNX greedy decoder

**Files:**
- Create: `sidecar/sokuji_sidecar/marian_onnx.py`
- Test: `sidecar/tests/test_marian_onnx.py`

**Interfaces:**
- Produces: `class MarianOnnxSession(model_dir: str)` with `.translate(text: str, max_new_tokens: int = 512) -> tuple[str, int]`. Internals monkeypatchable: `_load_sessions(model_dir) -> (encoder, decoder)`, `_load_tokenizer(model_dir)`.

- [ ] **Step 1: Write the failing tests**

Stub ORT sessions simulate a merged decoder: with `use_cache_branch=False` it accepts empty past tensors; the "model" emits token ids 7, 8, then EOS.

```python
# sidecar/tests/test_marian_onnx.py
import json

import numpy as np
import pytest

from sokuji_sidecar import marian_onnx as mx


class StubTok:
    def encode(self, text):
        class E:
            ids = [11, 12, 0]   # source ids incl. eos
        return E()

    def decode(self, ids, skip_special_tokens=True):
        return " ".join(f"t{i}" for i in ids)


class StubEncoder:
    def run(self, _out, feeds):
        assert feeds["input_ids"].dtype == np.int64
        b, s = feeds["input_ids"].shape
        return [np.zeros((b, s, 16), dtype=np.float32)]


class StubDecoder:
    """Emits 7, 8, then eos (0). Asserts the cache branch protocol."""
    def __init__(self):
        self.step = 0

    def get_inputs(self):
        names = ["input_ids", "encoder_attention_mask", "encoder_hidden_states",
                 "use_cache_branch"]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                for kv in ("key", "value"):
                    names.append(f"past_key_values.{i}.{kind}.{kv}")
        return [type("I", (), {"name": n})() for n in names]

    def get_outputs(self):
        names = ["logits"]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                for kv in ("key", "value"):
                    names.append(f"present.{i}.{kind}.{kv}")
        return [type("O", (), {"name": n})() for n in names]

    def run(self, _out, feeds):
        first = not bool(feeds["use_cache_branch"][0])
        if first:
            assert feeds["past_key_values.0.decoder.key"].shape[2] == 0
        else:
            assert feeds["past_key_values.0.decoder.key"].shape[2] == self.step
            assert feeds["past_key_values.0.encoder.key"].shape[2] == 3  # src len, kept
        self.step += 1
        logits = np.zeros((1, feeds["input_ids"].shape[1], 100), dtype=np.float32)
        nxt = {1: 7, 2: 8}.get(self.step, 0)   # step1->7, step2->8, then eos(0)
        logits[0, -1, nxt] = 9.0
        outs = [logits]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                seq = self.step if kind == "decoder" else (3 if first else 0)
                for _kv in ("key", "value"):
                    outs.append(np.zeros((1, 4, seq, 4), dtype=np.float32))
        return outs


@pytest.fixture
def model_dir(tmp_path, monkeypatch):
    (tmp_path / "config.json").write_text(json.dumps(
        {"decoder_layers": 2, "decoder_attention_heads": 4, "d_model": 16,
         "eos_token_id": 0}))
    (tmp_path / "generation_config.json").write_text(json.dumps(
        {"decoder_start_token_id": 99, "eos_token_id": 0, "pad_token_id": 99}))
    monkeypatch.setattr(mx, "_load_sessions",
                        lambda d: (StubEncoder(), StubDecoder()))
    monkeypatch.setattr(mx, "_load_tokenizer", lambda d: StubTok())
    return str(tmp_path)


def test_greedy_decode_until_eos(model_dir):
    m = mx.MarianOnnxSession(model_dir)
    text, n = m.translate("whatever")
    assert text == "t7 t8"      # eos excluded, specials skipped by tokenizer
    assert n == 3               # 7, 8, eos — three generated tokens


def test_max_new_tokens_cap(model_dir):
    m = mx.MarianOnnxSession(model_dir)
    _text, n = m.translate("whatever", max_new_tokens=1)
    assert n == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_marian_onnx.py -v`
Expected: FAIL — `No module named 'sokuji_sidecar.marian_onnx'`

- [ ] **Step 3: Write the implementation**

```python
# sidecar/sokuji_sidecar/marian_onnx.py
"""Greedy decode loop for MarianMT ONNX exports (Xenova opus-mt-* layout):
encoder_model_quantized.onnx + decoder_model_merged_quantized.onnx driven with
numpy tensors — no torch, no transformers. The merged decoder takes a
use_cache_branch flag: the first step runs without past (zero-length past
tensors), later steps feed the presents back. Encoder cross-attention presents
are computed once on the first step and reused (the cache branch returns
zero-length dummies for them)."""
import json
import os

import numpy as np


def _load_sessions(model_dir: str):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    enc = ort.InferenceSession(
        os.path.join(model_dir, "onnx", "encoder_model_quantized.onnx"),
        opts, providers=["CPUExecutionProvider"])
    dec = ort.InferenceSession(
        os.path.join(model_dir, "onnx", "decoder_model_merged_quantized.onnx"),
        opts, providers=["CPUExecutionProvider"])
    return enc, dec


def _load_tokenizer(model_dir: str):
    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
    tok.enable_truncation(max_length=512)   # Marian positional embeddings cap
    return tok


class MarianOnnxSession:
    def __init__(self, model_dir: str):
        with open(os.path.join(model_dir, "config.json")) as f:
            cfg = json.load(f)
        gen_path = os.path.join(model_dir, "generation_config.json")
        gen = {}
        if os.path.exists(gen_path):
            with open(gen_path) as f:
                gen = json.load(f)
        self._layers = cfg["decoder_layers"]
        self._heads = cfg["decoder_attention_heads"]
        self._head_dim = cfg["d_model"] // self._heads
        self._start = gen.get("decoder_start_token_id",
                              cfg.get("decoder_start_token_id", cfg.get("pad_token_id")))
        self._eos = gen.get("eos_token_id", cfg.get("eos_token_id"))
        self._encoder, self._decoder = _load_sessions(model_dir)
        self._tok = _load_tokenizer(model_dir)
        self._past_names = [f"past_key_values.{i}.{kind}.{kv}"
                            for i in range(self._layers)
                            for kind in ("decoder", "encoder")
                            for kv in ("key", "value")]
        self._present_names = [n.replace("past_key_values", "present")
                               for n in self._past_names]

    def _empty_past(self):
        shape = (1, self._heads, 0, self._head_dim)
        return {n: np.zeros(shape, dtype=np.float32) for n in self._past_names}

    def translate(self, text: str, max_new_tokens: int = 512) -> tuple[str, int]:
        src_ids = np.array([self._tok.encode(text).ids], dtype=np.int64)
        attn = np.ones_like(src_ids)
        enc_out = self._encoder.run(None, {"input_ids": src_ids,
                                           "attention_mask": attn})[0]
        past = self._empty_past()
        ids = [self._start]
        generated = []
        for step in range(max_new_tokens):
            feeds = {"input_ids": np.array([[ids[-1]]], dtype=np.int64),
                     "encoder_attention_mask": attn,
                     "encoder_hidden_states": enc_out,
                     "use_cache_branch": np.array([step > 0])}
            feeds.update(past)
            outs = self._decoder.run(None, feeds)
            logits = outs[0]
            nxt = int(np.argmax(logits[0, -1]))
            generated.append(nxt)
            # Presents: decoder entries always refresh; encoder entries only on
            # the first (no-cache) step — the cache branch returns empty dummies.
            for name, arr in zip(self._present_names, outs[1:]):
                past_name = name.replace("present", "past_key_values")
                if ".decoder." in name or arr.shape[2] > 0:
                    past[past_name] = arr
            if nxt == self._eos:
                break
            ids.append(nxt)
        out_ids = [t for t in generated if t != self._eos]
        return self._tok.decode(out_ids, skip_special_tokens=True).strip(), len(generated)
```

- [ ] **Step 4: Run tests, commit**

Run: `cd sidecar && python -m pytest tests/test_marian_onnx.py -v`
Expected: 2 PASS

```bash
git add sidecar/sokuji_sidecar/marian_onnx.py sidecar/tests/test_marian_onnx.py
git commit -m "feat(sidecar): Marian ONNX greedy decoder (numpy, no torch)"
```

---

### Task 8: OpusOnnxTranslateBackend

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py`
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `MarianOnnxSession` (Task 7).
- Produces: registered backend `opus_onnx_translate`.

- [ ] **Step 1: Write the failing tests**

Append to `test_translate_backends.py`:

```python
class TestOpusOnnx:
    def test_load_and_translate(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        class StubSession:
            def __init__(self, model_dir):
                self.model_dir = model_dir
            def translate(self, text, max_new_tokens=512):
                return f"UEBERSETZT:{text}", 4
        monkeypatch.setattr(tb, "MarianOnnxSession", StubSession)
        b = make_backend("opus_onnx_translate")
        b.load(str(tmp_path), "cpu", "int8")
        assert b.is_loaded
        # direction is pair-baked: prompt/src/tgt/wrap are ignored
        text, n = b.translate("guten tag", "sys", "de", "en", True)
        assert text == "UEBERSETZT:guten tag" and n == 4
        b.unload()
        assert not b.is_loaded

    def test_load_error_wrapped(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        def boom(model_dir):
            raise RuntimeError("no such file")
        monkeypatch.setattr(tb, "MarianOnnxSession", boom)
        b = make_backend("opus_onnx_translate")
        with pytest.raises(BackendLoadError):
            b.load(str(tmp_path), "cpu", "int8")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v -k OpusOnnx`
Expected: FAIL — `unknown backend: opus_onnx_translate`

- [ ] **Step 3: Write the implementation**

Add to `translate_backends.py`:

```python
from .marian_onnx import MarianOnnxSession


@register_backend
class OpusOnnxTranslateBackend:
    NAME = "opus_onnx_translate"

    def __init__(self):
        self._session = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._session = None
        try:
            path = model_ref
            if not os.path.isdir(path):
                from huggingface_hub import snapshot_download
                path = snapshot_download(model_ref, local_files_only=True)
            self._session = MarianOnnxSession(path)
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        # The translation direction is baked into the model — system_prompt,
        # src, tgt and wrap are intentionally ignored.
        return self._session.translate(text)

    def unload(self) -> None:
        self._session = None

    @property
    def is_loaded(self) -> bool:
        return self._session is not None
```

Add `import os` at the top of `translate_backends.py` if not already present.

- [ ] **Step 4: Run tests, commit**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v`
Expected: all PASS

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(sidecar): opus_onnx_translate backend"
```

---

### Task 9: Catalog — new translate rows + variant helpers

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (replace `_llm_translate_row`, `_with_fp8`, `_opus_row`, `TRANSLATE_MODELS`)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed` only — the rest is Task 10)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `catalog.TRANSLATE_NS`, `catalog._gguf_repo(mid, quant)`, `catalog._opus_repo(mid)`; every LLM TranslateModel has 6 deployments (2 quants × gpu-cuda/gpu-metal/cpu, same artifact per quant, default rank 2.0/alt 1.0, `est_bytes` = that quant's download size); every Opus TranslateModel has 1 cpu/int8 deployment. `accel._installed()` knows the 4 new names (`llamacpp_*` spec `None` = always installed) and drops the 5 old ones.

- [ ] **Step 1: Write the failing tests**

Replace the translate-related tests in `sidecar/tests/test_catalog.py` (keep ASR/TTS tests) with:

```python
from sokuji_sidecar import catalog


def test_llm_translate_rows_shape():
    m = catalog.translate_model("translategemma-4b")
    assert m is not None
    quants = {d.compute_type for d in m.deployments}
    assert quants == {"q4_k_m", "q8_0"}
    tiers = {(d.compute_type, d.tier) for d in m.deployments}
    for q in quants:
        assert {(q, "gpu-cuda"), (q, "gpu-metal"), (q, "cpu")} <= tiers
    # default quant (rank 2.0) is q4_k_m for the 4B card
    default = max(m.deployments, key=lambda d: d.rank)
    assert default.compute_type == "q4_k_m"
    assert all(d.backend == "llamacpp_gemma" for d in m.deployments)
    # same artifact across tiers of one quant (a GGUF is tier-agnostic)
    per_quant = {q: {d.artifact for d in m.deployments if d.compute_type == q}
                 for q in quants}
    assert all(len(a) == 1 for a in per_quant.values())


def test_small_qwen_defaults_to_q8():
    for mid in ("qwen2.5-0.5b", "qwen3-0.6b"):
        m = catalog.translate_model(mid)
        default = max(m.deployments, key=lambda d: d.rank)
        assert default.compute_type == "q8_0", mid
        assert all(d.backend == "llamacpp_qwen" for d in m.deployments)


def test_hunyuan_backend_and_no_fp8():
    for mid in ("hy-mt2-1.8b", "hy-mt2-7b", "hy-mt15-1.8b", "hy-mt15-7b"):
        m = catalog.translate_model(mid)
        assert all(d.backend == "llamacpp_hunyuan" for d in m.deployments)
        assert all(d.compute_type in ("q4_k_m", "q8_0") for d in m.deployments)


def test_opus_rows_cpu_only():
    m = catalog.translate_model("opus-mt-ja-en")
    assert len(m.deployments) == 1
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type) == ("opus_onnx_translate", "cpu", "int8")
    assert d.artifact.endswith("/sokuji-translate-opus-mt-ja-en")


def test_gguf_repo_naming(monkeypatch):
    assert catalog._gguf_repo("qwen3.5-2b", "q4_k_m").endswith(
        "/sokuji-translate-qwen3.5-2b-q4_k_m")


def test_all_translate_backends_installed_names():
    from sokuji_sidecar import accel
    installed = accel._installed()
    for name in ("llamacpp_qwen", "llamacpp_hunyuan", "llamacpp_gemma"):
        assert name in installed
    for old in ("qwen_translate", "qwen35_translate", "hunyuan_translate",
                "gemma_translate", "opus_translate"):
        assert old not in installed
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_catalog.py -v`
Expected: new tests FAIL (old rows still present)

- [ ] **Step 3: Rewrite the catalog translate section**

In `catalog.py`, delete `_with_fp8` and replace `_llm_translate_row`/`_opus_row`/`TRANSLATE_MODELS`:

```python
# Owned HF namespace hosting the mirrored translate artifacts (GGUF single-file
# repos per card-variant; 6-file Xenova ONNX sets per Opus pair). Mirroring
# rather than linking upstream: unsloth/mradermacher/bartowski are mutable
# third-party repos; the mirror gives a uniform URL scheme + deletion-proofing.
TRANSLATE_NS = os.environ.get("SOKUJI_TRANSLATE_NS", "jiangzhuo9357")


def _gguf_repo(mid: str, quant: str) -> str:
    return f"{TRANSLATE_NS}/sokuji-translate-{mid}-{quant}"


def _opus_repo(mid: str) -> str:
    return f"{TRANSLATE_NS}/sokuji-translate-{mid}"


def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False):
    """An LLM card: one llamacpp backend, two GGUF quant variants, three tiers
    each. The same GGUF serves every tier; rank 2.0 marks the default quant."""
    backend = f"llamacpp_{family}"
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        repo = _gguf_repo(mid, quant)
        deps += [Deployment(backend, tier, quant, repo, rank, est_bytes=nbytes)
                 for tier in ("gpu-cuda", "gpu-metal", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes)


def _opus_row(src, tgt, sort_order, size_bytes=115_000_000):
    mid = f"opus-mt-{src}-{tgt}"
    name = f"Opus-MT ({_opus_disp(src)} → {_opus_disp(tgt)})"
    return TranslateModel(mid, name, (src, tgt), (
        Deployment("opus_onnx_translate", "cpu", "int8", _opus_repo(mid), 1.0),
    ), sort_order=sort_order, size_bytes=size_bytes)


# Sizes are the GGUF file sizes from the source repos (refresh with the exact
# byte counts scripts/mirror_translate_models.py prints after mirroring).
TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B", "qwen", 1,
                       "q8_0", 676_000_000, "q4_k_m", 491_000_000, recommended=True),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B", "qwen", 2,
                       "q8_0", 639_000_000, "q4_k_m", 397_000_000, recommended=True),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B", "qwen", 3,
                       "q4_k_m", 533_000_000, "q8_0", 812_000_000),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B", "qwen", 4,
                       "q4_k_m", 1_280_000_000, "q8_0", 2_010_000_000),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B", "gemma", 5,
                       "q4_k_m", 2_490_000_000, "q8_0", 4_130_000_000),
    _llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B", "hunyuan", 6,
                       "q4_k_m", 1_130_000_000, "q8_0", 1_910_000_000),
    _llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B", "hunyuan", 7,
                       "q4_k_m", 4_620_000_000, "q8_0", 7_980_000_000),
    _llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B", "hunyuan", 8,
                       "q4_k_m", 1_130_000_000, "q8_0", 1_910_000_000),
    _llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B", "hunyuan", 9,
                       "q4_k_m", 4_620_000_000, "q8_0", 7_980_000_000),
    _opus_row("ru", "en", 20), _opus_row("zh", "en", 21), _opus_row("en", "zh", 22),
    _opus_row("hu", "en", 23), _opus_row("en", "es", 24), _opus_row("en", "ar", 25),
    _opus_row("en", "ru", 26), _opus_row("es", "en", 27), _opus_row("en", "vi", 28),
    _opus_row("ar", "en", 29), _opus_row("ja", "en", 30), _opus_row("en", "jap", 31),
    _opus_row("ko", "en", 32),
]
```

Also delete the now-unused `QWEN25_REPO` constant (and its comment) — the `SOKUJI_TRANSLATE_MODEL` env override targeted transformers repos and is obsolete. Update `Deployment.backend`'s doc comment to list the new names.

- [ ] **Step 4: Update `_installed()` in accel.py**

Remove the five old translate entries; add (and extend `_ready` for `None`):

```python
            # llamacpp_* backends run an external llama-server binary — a
            # downloadable artifact, not a Python runtime. Always "installed";
            # a missing binary fails at load() with a clear error instead of
            # being silently filtered out of the plans.
            "llamacpp_qwen": None,
            "llamacpp_hunyuan": None,
            "llamacpp_gemma": None,
            "opus_onnx_translate": ("onnxruntime", "tokenizers"),
```

```python
    def _ready(spec):
        if spec is None:
            return True
        return all(_has_mod(m) for m in ((spec,) if isinstance(spec, str) else spec))
```

- [ ] **Step 5: Run tests**

Run: `cd sidecar && python -m pytest tests/test_catalog.py tests/test_accel.py -v`
Expected: test_catalog PASS. Some `test_accel.py` tests may fail on translate resolution — if the failures are about variant selection/list_variants, they belong to Task 10; fix only `_installed`-related ones here and note the rest.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): translate catalog on llamacpp/opus-onnx backends with GGUF quant variants"
```

---

### Task 10: accel — resolution, variant selection, list_variants, models_catalog

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: catalog rows (Task 9), `llama_runtime.set_reserved_bytes` (Task 4).
- Produces: `_is_llamacpp(model) -> bool`; `select_variant` llamacpp branch (pin else rank-default, tier-aware row); `resolve_translate` same-quant cpu floor + reserved-bytes plumbing; `load_with_fallback` VRAM-gate bypass for llamacpp plans; `_h_list_variants` compute_type-deduped variants for llamacpp cards; `_h_models_catalog` translate entries carry `variantIds: list[str]`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_accel.py` (follow its existing Machine-fixture style; construct machines via `accel.Machine` with/without `nvidia`/`apple_silicon`):

```python
import pytest

from sokuji_sidecar import accel, catalog


def _machine(nvidia=False, apple=False):
    gpus = (accel.Gpu(vendor="nvidia", name="RTX 4070", vram_mb=12282,
                      capability=(8, 9)),) if nvidia else ()
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=gpus,
                         apple_silicon=apple, dml_adapters=(),
                         installed=accel._installed(), fingerprint="test")


def test_select_variant_llamacpp_default_and_pin():
    m = catalog.translate_model("translategemma-4b")
    mach = _machine(nvidia=True)
    chosen = accel.select_variant(m, mach, reserved_bytes=0, pin=None)
    assert (chosen.compute_type, chosen.tier) == ("q4_k_m", "gpu-cuda")
    pinned = accel.select_variant(m, mach, reserved_bytes=0, pin="q8_0")
    assert (pinned.compute_type, pinned.tier) == ("q8_0", "gpu-cuda")


def test_select_variant_llamacpp_metal_and_cpu():
    m = catalog.translate_model("qwen3.5-2b")
    metal = accel.select_variant(m, _machine(apple=True), 0, None)
    assert metal.tier == "gpu-metal"
    cpu = accel.select_variant(m, _machine(), 0, None)
    assert cpu.tier == "cpu"


def test_resolve_translate_same_quant_cpu_floor(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(nvidia=True))
    plans = accel.resolve_translate("hy-mt2-1.8b", pin="q8_0")
    assert [(p.tier, p.compute_type) for p in plans] == [
        ("gpu-cuda", "q8_0"), ("cpu", "q8_0")]


def test_resolve_translate_sets_reserved(monkeypatch):
    from sokuji_sidecar import llama_runtime as rt
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(nvidia=True))
    accel.resolve_translate("qwen2.5-0.5b", reserved_bytes=123456)
    assert rt.get_reserved_bytes() == 123456
    rt.set_reserved_bytes(0)


def test_vram_gate_skipped_for_llamacpp(monkeypatch):
    """The proactive free-VRAM check must not pre-skip llamacpp cuda plans —
    llama-server's --fit handles memory by partial offload."""
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 1 << 30)  # 1 GiB free
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 8 << 30)
    loaded = []

    class FakeBackend:
        def load(self, ref, device, ct):
            loaded.append(device)
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    plans = [accel.Plan("llamacpp_gemma", "gpu-cuda", "cuda", "q4_k_m", "repo", 2.0),
             accel.Plan("llamacpp_gemma", "cpu", "cpu", "q4_k_m", "repo", 2.0)]
    _b, plan, notice = accel.load_with_fallback(plans)
    assert plan.device == "cuda" and notice is None
    assert loaded == ["cuda"]


@pytest.mark.asyncio
async def test_list_variants_dedupes_llamacpp(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(nvidia=True))
    reply, _ = await accel._h_list_variants({}, {"model": "translategemma-4b"}, None)
    ids = [v["id"] for v in reply["variants"]]
    assert sorted(ids) == ["q4_k_m", "q8_0"]        # deduped across tiers
    assert all(v["supported"] for v in reply["variants"])
    assert reply["recommended"] == "q4_k_m"


@pytest.mark.asyncio
async def test_models_catalog_variant_ids(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine())
    reply, _ = await accel._h_models_catalog({}, {"kind": "translate"}, None)
    by_id = {m["id"]: m for m in reply["models"]}
    assert by_id["translategemma-4b"]["variantIds"] == ["q4_k_m", "q8_0"]
    assert by_id["opus-mt-ja-en"]["variantIds"] == ["int8"]
```

(If `pytest-asyncio` is not already a sidecar test dep, mirror how existing handler tests in `test_accel.py`/`test_server_envelope.py` invoke async handlers — e.g. `asyncio.get_event_loop().run_until_complete(...)` — and match that style instead of the decorator.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_accel.py -v -k "llamacpp or variant_ids or same_quant or reserved"`
Expected: FAIL

- [ ] **Step 3: Implement the accel changes**

In `accel.py`:

**(a)** helper near `select_variant`:

```python
def _is_llamacpp(model) -> bool:
    return model.deployments[0].backend.startswith("llamacpp_")


def _llamacpp_variant_row(model, machine: Machine, pin: str | None):
    """Quant = pin when valid else the rank-default; tier = best available.
    No VRAM math: llama-server's --fit guarantees any quant runs (worst case
    partially offloaded)."""
    quants = {}
    for d in model.deployments:
        cur = quants.get(d.compute_type)
        if cur is None or d.rank > cur.rank:
            quants[d.compute_type] = d
    if pin in quants:
        quant = pin
    else:
        quant = max(quants.values(), key=lambda d: d.rank).compute_type
    rows = [d for d in model.deployments if d.compute_type == quant]
    rows.sort(key=lambda d: TIER_RANK.get(d.tier, 0.0), reverse=True)
    for d in rows:
        if _tier_available(d.tier, machine):
            return d
    return next((d for d in rows if d.tier == "cpu"), None)
```

**(b)** at the top of `select_variant`:

```python
    if _is_llamacpp(model):
        return _llamacpp_variant_row(model, machine, pin)
```

**(c)** in `resolve_translate`, auto branch — set the reserve and pick the same-quant cpu floor:

```python
    if override == "auto":
        from . import llama_runtime
        llama_runtime.set_reserved_bytes(reserved_bytes)
        chosen = select_variant(model, machine, reserved_bytes, pin)
        cpu = next((d for d in model.deployments
                    if d.tier == "cpu" and d.compute_type == chosen.compute_type), None) \
            if chosen is not None else None
        if cpu is None:
            cpu = next((d for d in model.deployments if d.tier == "cpu"), None)
        ...  # rest unchanged
```

**(d)** in `load_with_fallback`, bypass the proactive gate for llamacpp (both `free`/`need` reads and the skip):

```python
        is_llamacpp = plan.backend.startswith("llamacpp_")
        free = _cuda_free_bytes() if (plan.device == "cuda" and not is_llamacpp) else None
        need = _model_weight_bytes(plan.artifact) if (plan.device == "cuda" and not is_llamacpp) else None
```

(the existing `if plan.device == "cuda" and has_cpu_fallback and free is not None ...` then naturally never fires for llamacpp).

**(e)** in `_h_list_variants`, before the generic loop:

```python
    if _is_llamacpp(model):
        chosen = select_variant(model, m, reserve, pin=msg.get("pin"))
        seen = {}
        for d in model.deployments:
            if d.compute_type not in seen:
                seen[d.compute_type] = d
        variants = [{"id": ct, "computeType": ct, "repo": d.artifact,
                     "sizeBytes": _est_bytes(d) or 0, "supported": True,
                     "reason": "ok"}
                    for ct, d in seen.items()]
        return {"type": "list_variants_result", "id": msg.get("id"),
                "variants": variants, "recommended": chosen.compute_type}, None
```

**(f)** in `_h_models_catalog`, inside the per-model loop:

```python
        if kind == "translate":
            seen_cts = []
            for d in mdl.deployments:
                if d.compute_type not in seen_cts:
                    seen_cts.append(d.compute_type)
            entry["variantIds"] = seen_cts
```

- [ ] **Step 4: Run the full sidecar suite**

Run: `cd sidecar && python -m pytest tests/ -v`
Expected: all PASS except possibly `test_native_models.py` (Task 11), `test_translate_engine.py`/`test_server_conn.py` old backend-name literals (Task 12). Fix any other regression before committing.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): llamacpp-aware resolution, variant dedupe, variantIds in catalog"
```

---

### Task 11: native_models — catalog-driven specs + binary dependency

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py`
- Test: `sidecar/tests/test_native_models.py`

**Interfaces:**
- Consumes: catalog rows (Task 9), `llama_runtime.ensure_binary/binary_path/default_flavor` (Tasks 1–2).
- Produces: `_base_specs` resolves any translate card via the catalog (default-variant repo, first deployment); `download()` fetches the llama binary as one extra progress unit for `llamacpp_*` cards; `model_status()` reports `absent` when the required binary is missing; `_needs_llama_binary(model_id) -> bool`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_native_models.py`:

```python
import pytest

from sokuji_sidecar import native_models as nm
from sokuji_sidecar import catalog


def test_translate_specs_come_from_catalog():
    spec = nm.download_specs("translategemma-4b")
    assert spec["repos"] == [catalog._gguf_repo("translategemma-4b", "q4_k_m")]
    spec = nm.download_specs("qwen2.5-0.5b")
    assert spec["repos"] == [catalog._gguf_repo("qwen2.5-0.5b", "q8_0")]
    spec = nm.download_specs("opus-mt-ja-en")
    assert spec["repos"] == [catalog._opus_repo("opus-mt-ja-en")]
    assert "ignore" not in spec  # mirrors contain only needed files


def test_variant_repo_override_still_wins():
    repo = catalog._gguf_repo("hy-mt2-7b", "q8_0")
    assert nm.download_specs("hy-mt2-7b", repo=repo)["repos"] == [repo]


def test_needs_llama_binary():
    assert nm._needs_llama_binary("translategemma-4b")
    assert not nm._needs_llama_binary("opus-mt-ja-en")
    assert not nm._needs_llama_binary("sense-voice")


def test_status_absent_without_binary(monkeypatch):
    from sokuji_sidecar import llama_runtime as rt
    # files present...
    monkeypatch.setattr(nm, "_repos_cached", lambda specs: True)
    # ...but no binary
    monkeypatch.setattr(rt, "binary_path", lambda flavor: None)
    monkeypatch.setattr(rt, "default_flavor", lambda: "cuda")
    assert nm.model_status("qwen2.5-0.5b") == "absent"
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama")
    assert nm.model_status("qwen2.5-0.5b") == "ready"
```

(`_repos_cached` is a new small extraction from `model_status` so the file-side check is patchable — see Step 3.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && python -m pytest tests/test_native_models.py -v -k "translate_specs or needs_llama or without_binary or override"`
Expected: FAIL

- [ ] **Step 3: Implement**

In `native_models.py`:

**(a)** Replace ALL translate-card branches of `_base_specs` (the `qwen2.5-0.5b` / `qwen3-0.6b` / `qwen3.5-*` / `translategemma-4b` / `hy-mt*` / `opus-mt-*` blocks AND the `if not model_id` default) with one catalog-driven branch placed right after the TTS branch:

```python
    from .catalog import translate_model as _translate_model
    _trm = _translate_model(model_id) if model_id else _translate_model("qwen2.5-0.5b")
    if _trm is not None:
        # Default-variant repo = first deployment (rank ordering puts the
        # default quant first). A pinned variant arrives via the `repo`
        # override in download_specs, exactly like the old FP8 flow.
        return {"repos": [_trm.deployments[0].artifact], "urls": []}
```

Delete the now-unused `QWEN_REPO` constant. Update the module docstring's mention of `opus_translate`.

**(b)** Binary dependency helpers:

```python
def _needs_llama_binary(model_id) -> bool:
    from .catalog import translate_model as _translate_model
    tm = _translate_model(model_id) if model_id else None
    return tm is not None and tm.deployments[0].backend.startswith("llamacpp_")
```

**(c)** Extract the repo-cache check from `model_status` into `_repos_cached(specs) -> bool` (move the existing `snapshot_download(local_files_only=True)` + `.incomplete` loop there verbatim), then extend `model_status`:

```python
def model_status(model_id, repo=None):
    specs = download_specs(model_id, repo)
    try:
        if not _repos_cached(specs):
            return "absent"
        for _url in specs["urls"]:
            if not os.path.exists(_vad_cache_path()):
                return "absent"
        if _needs_llama_binary(model_id):
            from . import llama_runtime
            if llama_runtime.binary_path(llama_runtime.default_flavor()) is None:
                return "absent"
        return "ready"
    except Exception:
        return "absent"
```

**(d)** In `download()`, count and fetch the binary as a final unit (after the files/urls loops, before `return "ready"`):

```python
    # llamacpp cards additionally need the llama runtime binary — treat it as
    # one more download unit so the renderer's progress bar covers it. Shared
    # across models and versions-scoped, so it downloads at most once.
    needs_bin = _needs_llama_binary(model_id)
    from . import llama_runtime
    if needs_bin and llama_runtime.binary_path(llama_runtime.default_flavor()) is None:
        if cancelled():
            return "cancelled"
        await asyncio.to_thread(llama_runtime.ensure_binary, llama_runtime.default_flavor())
        done += 1
        await send({"type": "model_progress", "model": model_id,
                    "downloaded": done, "total": total})
```

and include it in `total` up front:

```python
    total = len(files) + len(specs["urls"])
    if _needs_llama_binary(model_id):
        from . import llama_runtime
        if llama_runtime.binary_path(llama_runtime.default_flavor()) is None:
            total += 1
```

**(e)** `delete_model`: add a docstring note that the llama binary is deliberately NOT removed (shared by all llamacpp cards, like the VAD singleton).

- [ ] **Step 4: Run the full sidecar suite**

Run: `cd sidecar && python -m pytest tests/ -v`
Expected: everything PASS except the Task-12 name-literal tests (if failing, confirm they fail ONLY on old backend names).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): catalog-driven translate download specs + llama binary as download dependency"
```

---

### Task 12: Delete the transformers translate backends + sweep references

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (delete `QwenTranslateBackend`, `Qwen35TranslateBackend`, `HunyuanTranslateBackend`, `GemmaTranslateBackend`, `OpusTranslateBackend`; keep `_default_prompt`, `_clean_output`, `_hunyuan_prompt`, `_GEMMA_LANG_CODE`, `_gemma_code`, `_TRANSCRIPT_TAG`)
- Modify: `sidecar/sokuji_sidecar/translate_engine.py:2` (comment says "registers qwen_translate/qwen35_translate" → "registers the llamacpp_*/opus_onnx_translate backends")
- Modify: `sidecar/tests/test_translate_engine.py`, `sidecar/tests/test_server_conn.py` (replace `"qwen_translate"` literals with `"llamacpp_qwen"`, `"bfloat16"` compute types in those fakes with `"q8_0"`)
- Modify: `sidecar/prefetch_models.py` (`TRANSLATE` constant → `catalog._gguf_repo("qwen2.5-0.5b", "q8_0")`)
- Test: whole sidecar suite

- [ ] **Step 1: Delete the five old classes and their torch-specific imports; sweep the module docstring**

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "qwen_translate\|qwen35_translate\|hunyuan_translate\|gemma_translate\|opus_translate" sidecar/ src/`
Expected: no hits (or only in this plan/spec docs).

- [ ] **Step 3: Update the two test files' name literals and prefetch constant as listed above**

- [ ] **Step 4: Run the FULL sidecar suite**

Run: `cd sidecar && python -m pytest tests/ -v`
Expected: ALL PASS — the suite must be fully green at the end of this task.

- [ ] **Step 5: Commit**

```bash
git add -A sidecar/
git commit -m "refactor(sidecar): drop transformers translate backends — translate domain is torch-free"
```

---

### Task 13: Renderer — data-driven variant gate

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts` (`NativeModelInfo`)
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NativeModelCardSpec`, `infoToCard`)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx:424-430`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (+ any component test that exercises the hy-mt gate — find with `grep -rn "hy-mt" src/components src/lib/local-inference/native --include="*.test.*"`)

**Interfaces:**
- Consumes: `variantIds` field emitted by `_h_models_catalog` (Task 10).
- Produces: `NativeModelInfo.variantIds?: string[]`, `NativeModelCardSpec.variantIds?: string[]`.

- [ ] **Step 1: Write the failing test**

Append to `nativeCatalog.test.ts` (match its existing fixture style):

```typescript
it('passes variantIds through infoToCard', () => {
  const info = {
    id: 'translategemma-4b', name: 'TranslateGemma 4B', languages: ['multi'],
    recommended: false, tiers: [], order: 5, repo: 'x', kind: 'translate' as const,
    variantIds: ['q4_k_m', 'q8_0'],
  };
  expect(infoToCard(info).variantIds).toEqual(['q4_k_m', 'q8_0']);
});
```

Run: `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (property dropped)

- [ ] **Step 2: Implement**

`nativeProtocol.ts` — add to `NativeModelInfo`:

```typescript
  variantIds?: string[];   // translate only: quant variants, >1 → show the picker
```

`nativeCatalog.ts` — add `variantIds?: string[];` to `NativeModelCardSpec` and in `infoToCard` add `variantIds: m.variantIds,` to the returned object.

`NativeModelManagementSection.tsx` — replace the prefix gate (lines ~424-430):

```typescript
  // Translation cards with multiple quant variants get the picker. Data-driven
  // from the sidecar catalog's variantIds — the sidecar owns which cards have
  // a quant ladder (all llama.cpp GGUF cards today).
  const variantCardIds = useMemo(
    () => translationCards.filter((c) => (c.variantIds?.length ?? 0) > 1).map((c) => c.selectId),
    [translationCards],
  );
```

- [ ] **Step 3: Run renderer tests**

Run: `npm run test -- src/lib/local-inference/native/ src/components/Settings/sections/`
Expected: PASS after updating any test fixture that relied on the `hy-mt` prefix gate (extend those fixtures' catalog entries with `variantIds`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/native/ src/components/Settings/sections/
git commit -m "feat(native): data-driven quant-variant picker gate via catalog variantIds"
```

---

### Task 14: Mirror script + populated mirrors + real sizes

**Files:**
- Create: `scripts/mirror_translate_models.py`
- Modify: `sidecar/sokuji_sidecar/catalog.py` (paste exact byte sizes the script prints)

**Interfaces:**
- Consumes: naming scheme `_gguf_repo`/`_opus_repo` (Task 9).
- Produces: populated HF repos under `TRANSLATE_NS`; exact `est_bytes`/`size_bytes` values in the catalog.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
# scripts/mirror_translate_models.py
"""Mirror the chosen translate artifacts into the owned HF namespace.

GGUF: one repo per card-variant holding exactly one .gguf.
Opus: one repo per pair holding the 6-file Xenova export set.

Requires: `huggingface-cli login` with write access to NS.
Usage: python3 scripts/mirror_translate_models.py [--dry-run] [--only CARD_ID]
Prints the exact byte sizes to paste into sidecar catalog rows.
"""
import argparse
import fnmatch
import os
import sys

from huggingface_hub import HfApi, hf_hub_download

NS = os.environ.get("SOKUJI_TRANSLATE_NS", "jiangzhuo9357")

# card_id -> {quant: (source_repo, filename_glob)}
GGUF_SOURCES = {
    "qwen2.5-0.5b": {
        "q8_0":   ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "*q8_0*.gguf"),
        "q4_k_m": ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "*q4_k_m*.gguf")},
    "qwen3-0.6b": {
        "q8_0":   ("Qwen/Qwen3-0.6B-GGUF", "*Q8_0*.gguf"),
        "q4_k_m": ("unsloth/Qwen3-0.6B-GGUF", "*Q4_K_M*.gguf")},
    "qwen3.5-0.8b": {
        "q4_k_m": ("unsloth/Qwen3.5-0.8B-GGUF", "*Q4_K_M*.gguf"),
        "q8_0":   ("unsloth/Qwen3.5-0.8B-GGUF", "*Q8_0*.gguf")},
    "qwen3.5-2b": {
        "q4_k_m": ("unsloth/Qwen3.5-2B-GGUF", "*Q4_K_M*.gguf"),
        "q8_0":   ("unsloth/Qwen3.5-2B-GGUF", "*Q8_0*.gguf")},
    "translategemma-4b": {
        "q4_k_m": ("mradermacher/translategemma-4b-it-GGUF", "*Q4_K_M*.gguf"),
        "q8_0":   ("mradermacher/translategemma-4b-it-GGUF", "*Q8_0*.gguf")},
    "hy-mt2-1.8b": {
        "q4_k_m": ("tencent/Hy-MT2-1.8B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/Hy-MT2-1.8B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt2-7b": {
        "q4_k_m": ("tencent/Hy-MT2-7B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/Hy-MT2-7B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt15-1.8b": {
        "q4_k_m": ("tencent/HY-MT1.5-1.8B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/HY-MT1.5-1.8B-GGUF", "*[Qq]8_0*.gguf")},
    "hy-mt15-7b": {
        "q4_k_m": ("tencent/HY-MT1.5-7B-GGUF", "*[Qq]4_[Kk]_[Mm]*.gguf"),
        "q8_0":   ("tencent/HY-MT1.5-7B-GGUF", "*[Qq]8_0*.gguf")},
}

OPUS_PAIRS = ["ru-en", "zh-en", "en-zh", "hu-en", "en-es", "en-ar", "en-ru",
              "es-en", "en-vi", "ar-en", "ja-en", "en-jap", "ko-en"]
OPUS_FILES = ["config.json", "generation_config.json", "tokenizer.json",
              "tokenizer_config.json", "onnx/encoder_model_quantized.onnx",
              "onnx/decoder_model_merged_quantized.onnx"]


def pick_gguf(api, repo, glob):
    hits = [f for f in api.list_repo_files(repo)
            if f.endswith(".gguf") and fnmatch.fnmatch(f.lower(), glob.lower())]
    if len(hits) != 1:
        sys.exit(f"ERROR: {repo} glob {glob} matched {hits}")
    return hits[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only")
    args = ap.parse_args()
    api = HfApi()
    sizes = {}
    for card, quants in GGUF_SOURCES.items():
        if args.only and card != args.only:
            continue
        for quant, (src, glob) in quants.items():
            fname = pick_gguf(api, src, glob)
            dst = f"{NS}/sokuji-translate-{card}-{quant}"
            print(f"{dst}  <-  {src}/{fname}")
            if not args.dry_run:
                local = hf_hub_download(src, fname)
                api.create_repo(dst, exist_ok=True, private=False)
                api.upload_file(path_or_fileobj=local, path_in_repo=fname, repo_id=dst)
                sizes[(card, quant)] = os.path.getsize(local)
    for pair in OPUS_PAIRS:
        card = f"opus-mt-{pair}"
        if args.only and card != args.only:
            continue
        src = f"Xenova/opus-mt-{pair}"
        dst = f"{NS}/sokuji-translate-{card}"
        print(f"{dst}  <-  {src} ({len(OPUS_FILES)} files)")
        if not args.dry_run:
            api.create_repo(dst, exist_ok=True, private=False)
            total = 0
            for f in OPUS_FILES:
                local = hf_hub_download(src, f)
                api.upload_file(path_or_fileobj=local, path_in_repo=f, repo_id=dst)
                total += os.path.getsize(local)
            sizes[(card, "int8")] = total
    print("\n# exact sizes for catalog.py:")
    for (card, quant), n in sorted(sizes.items()):
        print(f"#   {card} {quant}: {n}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Dry-run to validate source repos/globs resolve**

Run: `python3 scripts/mirror_translate_models.py --dry-run`
Expected: one line per artifact, no `ERROR:` exits. Fix any glob that matches ≠1 file.

- [ ] **Step 3: Real run (operator step — needs HF write token, ~35 GB transfer)**

Run: `python3 scripts/mirror_translate_models.py`
Then paste the printed exact byte sizes into `catalog.py`'s `_llm_translate_row(...)`/`_opus_row(...)` calls, replacing the approximate values from Task 9.

- [ ] **Step 4: Re-run catalog tests, commit**

Run: `cd sidecar && python -m pytest tests/test_catalog.py -v`
Expected: PASS

```bash
git add scripts/mirror_translate_models.py sidecar/sokuji_sidecar/catalog.py
git commit -m "feat(sidecar): translate artifact mirror script + exact catalog sizes"
```

---

### Task 15: Metal CI smoke workflow

**Files:**
- Create: `.github/workflows/sidecar-metal-smoke.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/sidecar-metal-smoke.yml
# Manual smoke test of the llama.cpp Metal path on a real M-series runner:
# unit suite + binary download + one real translation through llama-server.
name: sidecar-metal-smoke
on: workflow_dispatch

jobs:
  metal-smoke:
    runs-on: macos-14   # M-series, Metal-capable
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Install sidecar deps (CPU onnxruntime)
        run: |
          python -m pip install -r sidecar/requirements.txt onnxruntime pytest
      - name: Unit suite
        run: cd sidecar && python -m pytest tests/ -v
      - name: Cache GGUF + llama binary
        uses: actions/cache@v4
        with:
          path: |
            ~/.cache/huggingface
            ~/.config/Sokuji/llama-bin
          key: metal-smoke-${{ hashFiles('sidecar/sokuji_sidecar/llama_runtime.py') }}
      - name: Real Metal translation smoke
        run: |
          cd sidecar && python - <<'EOF'
          from huggingface_hub import snapshot_download
          from sokuji_sidecar import llama_runtime as rt, catalog
          from sokuji_sidecar.backends import make_backend
          repo = catalog._gguf_repo("qwen2.5-0.5b", "q8_0")
          snapshot_download(repo)
          rt.ensure_binary("metal")
          b = make_backend("llamacpp_qwen")
          b.load(repo, "metal", "q8_0")
          text, n = b.translate("Hello, how are you today?", "", "English", "Chinese", False)
          print("translated:", text, "| tokens:", n)
          assert text.strip() and n > 0
          b.unload()
          EOF
```

- [ ] **Step 2: Commit, push (with user's per-action approval), trigger once**

```bash
git add .github/workflows/sidecar-metal-smoke.yml
git commit -m "ci: manual Metal smoke test for the llama.cpp translate path"
# after approval: git push, then: gh workflow run sidecar-metal-smoke --ref native-sidecar
```

Expected: green run; the smoke step's log shows a non-empty Chinese translation.

---

### Task 16: Local integration verification (manual, RTX 4070 dev box)

**Files:** none (verification checklist; record results in the PR description / plan notes)

Prereqs: Tasks 1–14 done, mirrors populated, checksums recorded.

- [ ] **Step 1: One real E2E per backend family (CUDA)**

```bash
cd sidecar && python - <<'EOF'
from huggingface_hub import snapshot_download
from sokuji_sidecar import llama_runtime as rt, catalog, accel
from sokuji_sidecar.backends import make_backend

rt.ensure_binary("cuda")
CASES = [("qwen2.5-0.5b", "q8_0", "llamacpp_qwen"),
         ("hy-mt2-1.8b", "q4_k_m", "llamacpp_hunyuan"),
         ("translategemma-4b", "q4_k_m", "llamacpp_gemma")]
for card, quant, backend in CASES:
    repo = catalog._gguf_repo(card, quant)
    snapshot_download(repo)
    b = make_backend(backend)
    b.load(repo, "cuda", quant)
    text, n = b.translate("The quick brown fox jumps over the lazy dog.",
                          "", "English", "Chinese", False)
    plan = accel.Plan(backend, "gpu-cuda", "cuda", quant, repo, 2.0)
    tps = accel.measure_tps(b, plan, card, accel.probe(), force=True)
    print(f"{card:20s} {quant:7s} tok/s={tps and round(tps,1)}  ->  {text[:60]}")
    assert text.strip(), card
    b.unload()
EOF
```

Expected: three sane Chinese translations; record the tok/s numbers next to the old transformers numbers from the bench cache (`~/.config` bench json) in the PR.

- [ ] **Step 2: Opus real run**

```bash
cd sidecar && python - <<'EOF'
from huggingface_hub import snapshot_download
from sokuji_sidecar import catalog
from sokuji_sidecar.backends import make_backend
repo = catalog._opus_repo("opus-mt-ru-en")
snapshot_download(repo)
b = make_backend("opus_onnx_translate")
b.load(repo, "cpu", "int8")
import time; t0 = time.time()
text, n = b.translate("Привет, как дела?", "", "ru", "en", False)
print(f"{text!r}  tokens={n}  {int((time.time()-t0)*1000)}ms")
assert "how" in text.lower() or "hello" in text.lower() or "hi" in text.lower()
EOF
```

Expected: an English greeting, well under 1 s.

- [ ] **Step 3: End-to-end through the app**

Run `npm run electron:dev`; in native local-inference settings download `qwen2.5-0.5b` (watch the extra "binary" progress unit on first download), pick a quant on a multi-variant card, run a live session zh→en, verify LogsPanel shows `[llama-server]` lines and `translate_init`'s reply carries `backend: llamacpp_qwen` + `tokensPerSec`.

- [ ] **Step 4: Fallback sanity**

With `translategemma-4b` loaded on GPU, also load a large ASR model, re-init translate, and confirm it still loads on `cuda` (partial offload — check `[llama-server]` fit logs) instead of silently landing on CPU.

- [ ] **Step 5: Record results, then update project memory + close out**

Record tok/s table + VRAM observations in the PR body. Done.
