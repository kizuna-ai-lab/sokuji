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
import json
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
ASSET_SHA256: dict[str, str] = {
    "x86_64/linux/cuda/probe/probe.zst": "355863c29bbabb9a89705d696d9aedbc94cbd8b3e4c79f0f0c78935da17ef3b3",
    "x86_64/linux/cuda/75/llama-app.zst": "53ca317f5736fc73c8fb56323a1228bc2d46bcae1f039564d8dcc6e1dd01d0fb",
    "x86_64/linux/cuda/80/llama-app.zst": "a946440f7dfe7b8ad0138fd06fc86432de827a37e30bc8484ce7d62e5b619086",
    "x86_64/linux/cuda/86/llama-app.zst": "d8b152097e88f8807f68955548207bfbd3a7d3f9727789bade455880ed60d158",
    "x86_64/linux/cuda/89/llama-app.zst": "4daafe12e7aeacabeb43d7c85b45137bbadd60be3aa8869074be78fcf21b64a4",
    "x86_64/linux/cuda/90/llama-app.zst": "a2e02e4410844c72d3e951773cd1163a097468d9695f8e15e1078a58ddaf6ebf",
    "x86_64/linux/cuda/100/llama-app.zst": "b2f7e64bf057d8f862224063f8fd503c09c852f0ebc9689b52ffa0d31d73c2f6",
    "x86_64/linux/cuda/120/llama-app.zst": "89917bc3fbc4640273a4054fe3dae0f1fa33b1859a42d9c7ba663b51b3569969",
    "x86_64/linux/featcode": "8bd4f1ce7147c27283ccb9558f4d80b2dcb1348df383be2f0750ac7cfb537af4",
    "aarch64/macos/metal/m1/llama-app.zst": "8b3339d445e617cbd1b96b3acaef9ab299fd08a6908582b8fa811468b9898fb0",
    "aarch64/macos/metal/m2/llama-app.zst": "7ff1253d0a8a5e3ffd1115bcad30fb6120811d79058c49c951fe9c973b0d0e99",
    "aarch64/macos/metal/m3/llama-app.zst": "f41d8be26a3b708dadb15c6450688654b453015e47c7070554137cdfa2076766",
    "aarch64/macos/metal/m4/llama-app.zst": "a55d2c82ab79ba99ab1e6bf6ac45fc4b4d5ac0654fefe19b6bb3f91e7605742f",
    "aarch64/macos/metal/m5/llama-app.zst": "c074eebf2fdd4b8767d7b8d1697ecdecd9833e12cbfed18c5acb6d4d126e0b4c",
    "llama-b9835-bin-win-cuda-12.4-x64.zip": "46a7e68e4012f41936e5d8dc096e91bf71f189fb2150a3b5198f4ad4aa15f4c5",
    "cudart-llama-bin-win-cuda-12.4-x64.zip": "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
    "llama-b9835-bin-win-cpu-x64.zip": "982860c8dfc36ee82e41aa0885e1f49faa8d7cf07c7481a83f36fb0154e1c64c",
}
# NOTE: linux cpu configs are featcode-keyed; run ensure_binary('cpu') on target machines or extend CANDIDATES when configs are known.

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
    """The best flavor for this machine (drives the model-download dependency):
    NVIDIA (tc probe) -> cuda, Apple Silicon -> metal, else cpu. AMD/Intel
    dGPUs stay on cpu until the vulkan flavor lands (P4)."""
    from . import accel
    m = accel.probe()
    if accel.has_nvidia(m):
        return "cuda"
    if m.apple_silicon:
        return "metal"
    return "cpu"


def required_flavors() -> list[str]:
    """Every llama-server flavor a llamacpp_* translate card needs installed:
    this machine's best flavor (drives a normal load) PLUS the tiny (~15-17MB)
    'cpu' flavor — the always-available fallback tier in resolve_translate's
    gpu-then-cpu plan AND the explicit device=cpu UI override. Without the cpu
    flavor also installed, picking device=cpu (or falling back to it) hits
    binary_path("cpu") is None and _LlamaCppBase.load() raises, even though
    every GGUF file is cached. De-duplicated: a CPU-only machine
    (default_flavor() == 'cpu') needs only the one flavor."""
    default = default_flavor()
    return [default] if default == "cpu" else [default, "cpu"]


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


_METAL_CONFIGS = ("m1", "m2", "m3", "m4", "m5")   # newest LAST (fallback pick)


def _metal_config() -> str:
    """Apple chip family from the CPU brand string ('Apple M4 Pro' -> 'm4').
    An unknown/newer chip degrades to the newest known bucket config with a
    stderr warning instead of raising — newer Apple GPUs run older Metal
    binaries fine, and refusing to install would brick every future chip
    until we ship an update (D11)."""
    brand = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                           capture_output=True, text=True, timeout=10).stdout
    parts = brand.split()
    # Match the WHOLE family token ("M4" -> "m4"), not a 2-char slice: an "M10"
    # must degrade, not truncate to "m1" and pick the wrong binary.
    fam = parts[1].lower() if len(parts) >= 2 and parts[0] == "Apple" else ""
    if fam in _METAL_CONFIGS:
        return fam
    fallback = _METAL_CONFIGS[-1]
    print(f"[llama_runtime] unknown Apple chip {brand.strip()!r}; "
          f"using the {fallback} binary", file=sys.stderr)
    return fallback


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


_ENSURE_BINARY_LOCK = threading.Lock()


def ensure_binary(flavor: str, progress=None) -> str:
    """Return the installed binary for `flavor`, downloading it first if needed.
    Raises BinaryFetchError on any failure; never leaves a half-installed exe
    (writes land in a temp dir that is only renamed into place on success).

    Guarded by a module-level lock: model downloads run as concurrent asyncio
    tasks, each shelling out to this function via asyncio.to_thread — two
    downloads needing the same flavor (or download() installing its own
    default + cpu flavors while another model's download races it) could
    otherwise both enter the extract path and stomp the shared `<flavor>.tmp`
    dir. The pre-lock check above is just an optimization to skip locking
    once installed; the check right after acquiring is the one that actually
    prevents the race — a thread that loses it just reuses the flavor the
    winner installed instead of redownloading."""
    existing = binary_path(flavor)
    if existing is not None:
        return existing
    with _ENSURE_BINARY_LOCK:
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


_RESERVED_BYTES = 0


def set_reserved_bytes(n: int) -> None:
    """VRAM to leave free for the other pipeline stages (ASR/TTS). Set by
    accel.resolve_translate; read by the llamacpp backends to build
    --fit-target. Module-level because the backend load() signature is fixed."""
    global _RESERVED_BYTES
    _RESERVED_BYTES = max(0, int(n))


def get_reserved_bytes() -> int:
    return _RESERVED_BYTES


def gguf_path(artifact: str) -> str:
    """Locate the .gguf for a translate card's artifact.

    Three shapes, in order:
      1. A local dir (dev override) — walked for exactly one .gguf.
      2. An upstream file artifact ("org/repo/file.gguf", the catalog's normal
         shape post-Task-14b) — resolved directly via a single hf_hub_download,
         no walk/uniqueness check needed since the exact file is already named.
      3. A bare repo id (legacy/back-compat) — the existing snapshot_download +
         walk-for-exactly-one-.gguf path.
    """
    path = artifact
    if not os.path.isdir(path):
        from . import catalog
        repo, fname = catalog.split_artifact(artifact)
        if fname:
            from huggingface_hub import hf_hub_download
            try:
                return hf_hub_download(repo, fname, local_files_only=True)
            except Exception as e:
                raise BackendLoadError(f"model {artifact} not downloaded: {e}")
        from huggingface_hub import snapshot_download
        try:
            path = snapshot_download(repo, local_files_only=True)
        except Exception as e:
            raise BackendLoadError(f"model {artifact} not downloaded: {e}")
    ggufs = [os.path.join(r, f) for r, _d, fs in os.walk(path)
             for f in fs if f.endswith(".gguf")]
    if len(ggufs) != 1:
        raise BackendLoadError(f"expected exactly one .gguf under {artifact}, found {len(ggufs)}")
    return ggufs[0]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _windows_job_object(proc):
    """Best-effort Windows Job Object (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
    assigned to `proc`, so the llama-server child dies even if THIS process
    is killed hard — Windows' TerminateProcess bypasses atexit outright
    (unlike POSIX, where Linux is saved by the PDEATHSIG set in start()'s
    preexec_fn and macOS/Windows fall back on __main__._install_exit_handlers'
    SIGTERM->sys.exit(0) translation, which itself doesn't apply to a hard
    TerminateProcess kill). Returns the job handle — which MUST be kept alive
    on the instance, since closing/GC'ing it is what triggers the kill — or
    None if anything about this failed; a Job Object is a nice-to-have here,
    never a reason to fail spawning the child.

    All win32 symbols (ctypes.WinDLL, wintypes.HANDLE, ...) are referenced
    only inside this function, which itself is only ever called from the
    platform.system() == 'Windows' branch of start() — so this module still
    imports and runs cleanly on Linux/macOS (see
    test_windows_job_object_import_is_safe_on_non_windows)."""
    import ctypes
    import ctypes.wintypes as wintypes
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None

        class _BasicLimit(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class _IoCounters(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class _ExtendedLimit(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", _BasicLimit),
                ("IoInfo", _IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        JobObjectExtendedLimitInformation = 9
        info = _ExtendedLimit()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel32.SetInformationJobObject(
                job, JobObjectExtendedLimitInformation,
                ctypes.byref(info), ctypes.sizeof(info)):
            return None
        if not kernel32.AssignProcessToJobObject(job, wintypes.HANDLE(proc._handle)):
            return None
        return job
    except Exception:
        return None


class LlamaServerProc:
    """One llama-server child serving one GGUF on a free localhost port.

    `binary` is either a path string (real runtime) or an argv prefix list
    (tests inject `[sys.executable, fake.py]`)."""

    def __init__(self, binary, gguf: str, ctx: int = 4096,
                 fit_target_mib: int | None = None,
                 extra_args: list[str] | None = None):
        self._binary = [binary] if isinstance(binary, str) else list(binary)
        self._gguf = gguf
        self._ctx = ctx
        self._fit_target = fit_target_mib
        self._extra_args = list(extra_args) if extra_args else []
        self._proc = None
        self._stderr = collections.deque(maxlen=200)
        self._stderr_lock = threading.Lock()
        self._pump_thread = None
        self._job = None  # Windows Job Object handle (kill-on-close), best-effort
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
        args += self._extra_args
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
        if platform.system() == "Windows":
            self._job = _windows_job_object(self._proc)
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

    def restart(self) -> None:
        self.stop()
        self.start()
