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
import collections
import hashlib
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

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
        self._stderr_lock = threading.Lock()
        self._pump_thread = None
        self.port = 0
        # Register exactly once per instance, regardless of how many times
        # start()/restart() run over this object's lifetime. stop() is a
        # no-op when _proc is None, so this is safe even before start().
        import atexit
        atexit.register(self.stop)

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
            with self._stderr_lock:
                self._stderr.append(text)
            print(f"[llama-server] {text}", file=sys.stderr)
        pipe.close()

    def stderr_tail(self) -> str:
        with self._stderr_lock:
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
        self._pump_thread = threading.Thread(
            target=self._pump_stderr, args=(self._proc.stderr,), daemon=True)
        self._pump_thread.start()
        deadline = time.time() + timeout
        import urllib.error
        import urllib.request
        while time.time() < deadline:
            if self._proc.poll() is not None:
                # Give the pump thread a moment to drain the crash line
                # before we snapshot stderr for the error message.
                self._pump_thread.join(timeout=1.0)
                rc = self._proc.returncode
                self.stop()
                raise BackendLoadError(
                    f"llama-server exited rc={rc}: {self.stderr_tail()}")
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
        self._pump_thread.join(timeout=1.0)
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
