# P4 — llama.cpp Vulkan Flavor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `llamacpp_*` translation backends a `vulkan` binary flavor so AMD/Intel (and any non-NVIDIA discrete) GPUs accelerate the translation LLMs (spec D6). Flavor choice becomes NVIDIA→cuda, Apple→metal, other-dGPU→vulkan, none→cpu; Windows acquires the prebuilt `win-vulkan-x64.zip`, Linux the official `ubuntu-vulkan-x64.tar.gz`; every LLM translate card gains a `gpu-vulkan` tier ranked between GPU-native and CPU.

**Architecture:** `llama_runtime.py` owns binary acquisition + flavor selection. Today `_FLAVORS`/`default_flavor` know only cuda/metal/cpu, Windows fetches GitHub release zips (`_install_from_github`), Linux/macOS fetch the single-file `llama` app from the HF bucket (`_install_from_bucket`), and `catalog._llm_translate_row` emits three tiers per quant. This plan adds a `vulkan` flavor across all four surfaces:
1. **Selection** — `_FLAVORS` and `default_flavor` learn `vulkan` (via the P2 transcribe.cpp probe's `Machine.tc_kinds`); `required_flavors`' dedup is unchanged and just inherits it.
2. **Windows acquisition** — `_install_from_github`'s assets table gains a single `vulkan` zip (no cudart companion).
3. **Linux acquisition** — a new `_install_from_github_tar` extracts the official ubuntu-vulkan tarball (`llama-server` + shared libs). Because that binary is named `llama-server` (not the bucket's `llama`), `_exe_name` becomes flavor-aware so `binary_path`/`ensure_binary` locate it and `_build_args`' existing `startswith("llama-server")` serve-subcommand suppression fires correctly.
4. **Catalog** — `_llm_translate_row` emits a fourth `gpu-vulkan` tier row per quant; plan ordering is governed by `accel.TIER_RANK` (gpu-cuda/gpu-metal 3.0 > gpu-vulkan 2.5 > cpu 1.0), not tuple order.

**Tech Stack:** stdlib only (`tarfile`, `zipfile`, `io`, `platform`, `os`, `shutil`) plus the already-pinned `zstandard`. No new runtime dependency. Vulkan release assets are downloaded on demand (like the existing cuda/cpu/metal binaries), sha256-verified when pinned and accepted-with-warning when not (existing `_verify` behavior).

## Global Constraints

- Sidecar runtime stays torch-free (`tests/test_torch_free_gate.py` must keep passing). This plan touches no ML dependency.
- Dev/CI runs on the **Linux + NVIDIA** dev box on the current **Python 3.10** venv (per spec D12, the 3.12 rebuild is deferred). Do **not** use `tarfile.extractall(..., filter=...)` — the `filter` kwarg is 3.12-only and would `TypeError` on 3.10; extract without it (matches the existing `zipfile.extractall` in `_install_from_github`, and the assets are ggml-org official over HTTPS).
- Windows binaries and the ubuntu-vulkan tarball's glibc compatibility cannot be exercised on this box. All code is testable on Linux via stubbed `_fetch`/`platform.system` + synthetic archives; real-hardware checks live in the **Deferred hardware verification** section at the end (NOT inside tasks).
- The two Vulkan release assets are **intentionally left unpinned** in `ASSET_SHA256`; `_verify` accepts an unrecorded asset with a stderr warning. Pinning is a follow-up once a hash is recorded on a target machine (tracked in Deferred verification).
- `BUCKET_VERSION` is `"b9835"`; spec D6 verified the Vulkan assets exist upstream at `b9876`. Asset f-strings use `BUCKET_VERSION` (DRY) so they track any bump. Confirming the assets resolve at the pinned version is a Deferred-verification item.
- Tests live in `sidecar/tests/`, run via `cd sidecar && .venv/bin/python -m pytest tests/<file> -q`. Follow the existing stub style in `test_llama_runtime.py` (monkeypatch `rt._fetch`, `rt.platform.system`, `rt.platform.machine`; build archives in-memory).
- All comments/docs in English. TDD, DRY, YAGNI. Conventional commit messages. No `git push` without explicit user consent (not requested by this plan).

---

### Task 1: Add the `vulkan` flavor to flavor selection

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:56` (`_FLAVORS`)
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:88-96` (`default_flavor`)
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Produces: `flavor_for_device("vulkan") -> "vulkan"`; `default_flavor()` returns `"vulkan"` when the probe reports a non-cpu `"vulkan"` kind and there is no NVIDIA/Apple GPU, else the existing cuda/metal/cpu result. `required_flavors()` is unchanged (its dedup already yields `["vulkan", "cpu"]` for a vulkan default) — consumed by Task 3's `ensure_binary` and by `native_models` downloads.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_llama_runtime.py`:

```python
import types


def test_flavor_for_device_includes_vulkan():
    assert rt.flavor_for_device("vulkan") == "vulkan"
    # dml is still unsupported (P5's DML lane is not a llama.cpp flavor)
    with pytest.raises(KeyError):
        rt.flavor_for_device("dml")


def _fake_machine(*, gpus=(), apple=False, tc_kinds=()):
    """default_flavor reads accel.has_nvidia(m) (-> m.gpus), .apple_silicon and
    .tc_kinds. Post-P2 there is no Machine.nvidia field / accel.Gpu class:
    NVIDIA presence is derived from the gpus device descriptions. `gpus` items
    are (kind, description, mem_total) tuples."""
    return types.SimpleNamespace(gpus=gpus, apple_silicon=apple,
                                 tc_kinds=tc_kinds)


# An NVIDIA GPU as the tc probe reports it -> accel.has_nvidia() True.
_NV = (("cuda", "NVIDIA GeForce RTX 4070", 12 << 30),)


def test_default_flavor_matrix(monkeypatch):
    from sokuji_sidecar import accel
    cases = [
        (_fake_machine(gpus=_NV), "cuda"),
        (_fake_machine(gpus=_NV, tc_kinds=("cpu", "vulkan")), "cuda"),        # nvidia wins
        (_fake_machine(apple=True), "metal"),
        (_fake_machine(apple=True, tc_kinds=("cpu", "vulkan")), "metal"),     # apple wins
        (_fake_machine(tc_kinds=("cpu", "vulkan")), "vulkan"),               # AMD/Intel GPU
        (_fake_machine(tc_kinds=("cpu",)), "cpu"),                            # cpu-only probe
        (_fake_machine(), "cpu"),                                             # nothing detected
    ]
    for machine, expected in cases:
        monkeypatch.setattr(accel, "probe", lambda force=False, m=machine: m)
        assert rt.default_flavor() == expected, expected


def test_required_flavors_vulkan_adds_cpu_floor(monkeypatch):
    monkeypatch.setattr(rt, "default_flavor", lambda: "vulkan")
    assert rt.required_flavors() == ["vulkan", "cpu"]


def test_required_flavors_cpu_only_is_single(monkeypatch):
    monkeypatch.setattr(rt, "default_flavor", lambda: "cpu")
    assert rt.required_flavors() == ["cpu"]
```

Then update the pre-existing stale test that P4's behavior change makes wrong.
`test_default_flavor_cpu_for_non_nvidia_gpu` (currently ~line 217) builds an
AMD GPU and asserts `"cpu"` with the comment "the vulkan flavor arrives in P4";
that premise is exactly what this task changes. Extend the `_probe_machine`
helper (currently `def _probe_machine(gpus=(), apple=False):`) to forward a
`tc_kinds`:

```python
def _probe_machine(gpus=(), apple=False, tc=()):
    from sokuji_sidecar import accel
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, dml_adapters=(),
                         installed=frozenset(), fingerprint="t",
                         tc_kinds=tc, gpus=gpus)
```

(preserve whatever field values the current helper already passes; only add
the `tc=()` parameter and the `tc_kinds=tc` argument). Then replace the stale
test body:

```python
def test_default_flavor_cpu_for_non_nvidia_gpu(monkeypatch):
    # AMD/Intel GPUs get no cuda flavor; the vulkan flavor arrives in P4.
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "probe", lambda force=False: _probe_machine(
        gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),)))
    assert rt.default_flavor() == "cpu"
```

with the P4 behavior (a tc-Vulkan-capable AMD GPU now selects the vulkan flavor):

```python
def test_default_flavor_vulkan_for_amd_gpu(monkeypatch):
    # P4: an AMD/Intel GPU the tc probe drives via Vulkan selects the vulkan flavor.
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "probe", lambda force=False: _probe_machine(
        gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),), tc=("cpu", "vulkan")))
    assert rt.default_flavor() == "vulkan"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q`
Expected: FAIL — `test_flavor_for_device_includes_vulkan` raises `KeyError: 'vulkan'`; `test_default_flavor_matrix` fails the `("cpu","vulkan") -> "vulkan"` case (gets `"cpu"`); `test_default_flavor_vulkan_for_amd_gpu` fails (gets `"cpu"`).

- [ ] **Step 3: Implement**

In `sidecar/sokuji_sidecar/llama_runtime.py`, replace line 56:

```python
_FLAVORS = {"cuda": "cuda", "metal": "metal", "cpu": "cpu"}
```

with:

```python
_FLAVORS = {"cuda": "cuda", "metal": "metal", "vulkan": "vulkan", "cpu": "cpu"}
```

Replace `default_flavor` (post-P2 it uses `accel.has_nvidia(m)`, NOT the removed `m.nvidia`):

```python
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
```

with:

```python
def default_flavor() -> str:
    """The best flavor for this machine (drives the model-download dependency):
    NVIDIA (tc probe) -> cuda, Apple Silicon -> metal, AMD/Intel via the tc
    Vulkan probe -> vulkan, else cpu."""
    from . import accel
    m = accel.probe()
    if accel.has_nvidia(m):
        return "cuda"
    if m.apple_silicon:
        return "metal"
    # Non-NVIDIA / non-Apple GPU that transcribe.cpp's probe can drive via
    # Vulkan (AMD/Intel discrete or integrated) — the D6 target for the
    # vulkan llama-server flavor. NVIDIA and Apple are handled above.
    if "vulkan" in m.tc_kinds:
        return "vulkan"
    return "cpu"
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q`
Expected: PASS (all tests, including the pre-existing `test_flavor_for_device` which still sees `dml` raise `KeyError`).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py
git commit -m "feat(sidecar): add vulkan llama.cpp flavor selection"
```

---

### Task 2: Windows Vulkan acquisition (single release zip)

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:201-203` (`_install_from_github` assets table)
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:35-54` (`ASSET_SHA256` — add the unpinned-note comment)
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Produces: `_install_from_github("vulkan", dest_dir)` fetches exactly `[gh_url(f"llama-{BUCKET_VERSION}-bin-win-vulkan-x64.zip")]` (one asset — no cudart), extracts `llama-server.exe`, returns its path. The win-vulkan asset is absent from `ASSET_SHA256`, so `_verify` accepts it with a warning.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_llama_runtime.py`:

```python
import zipfile


def _win_zip(names):
    """A minimal Windows release zip: `names` at the archive top level."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n in names:
            z.writestr(n, b"MZfake")
    return buf.getvalue()


def test_install_from_github_vulkan_single_asset(monkeypatch, tmp_path):
    monkeypatch.setattr(rt.platform, "system", lambda: "Windows")
    fetched = []

    def fake_fetch(url):
        fetched.append(url)
        return _win_zip(["llama-server.exe", "ggml.dll"])
    monkeypatch.setattr(rt, "_fetch", fake_fetch)

    dest = tmp_path / "vulkan"
    dest.mkdir()
    exe = rt._install_from_github("vulkan", str(dest))
    assert os.path.basename(exe) == "llama-server.exe"
    assert os.path.isfile(exe)
    # exactly one asset: unlike cuda, win-vulkan has no cudart companion zip
    assert fetched == [rt.gh_url(f"llama-{rt.BUCKET_VERSION}-bin-win-vulkan-x64.zip")]


def test_win_vulkan_asset_is_unpinned():
    asset = f"llama-{rt.BUCKET_VERSION}-bin-win-vulkan-x64.zip"
    assert asset not in rt.ASSET_SHA256          # intentionally unpinned (P4 follow-up)
    rt._verify(asset, b"anything")               # unknown asset -> stderr warning, no raise
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -k vulkan -q`
Expected: FAIL — `test_install_from_github_vulkan_single_asset` raises `KeyError: 'vulkan'` from the assets dict lookup.

- [ ] **Step 3: Implement**

In `sidecar/sokuji_sidecar/llama_runtime.py`, replace the assets table (lines 201-203):

```python
    assets = {"cuda": [f"llama-{BUCKET_VERSION}-bin-win-cuda-12.4-x64.zip",
                       f"cudart-llama-bin-win-cuda-12.4-x64.zip"],
              "cpu": [f"llama-{BUCKET_VERSION}-bin-win-cpu-x64.zip"]}[flavor]
```

with:

```python
    assets = {"cuda": [f"llama-{BUCKET_VERSION}-bin-win-cuda-12.4-x64.zip",
                       f"cudart-llama-bin-win-cuda-12.4-x64.zip"],
              "vulkan": [f"llama-{BUCKET_VERSION}-bin-win-vulkan-x64.zip"],
              "cpu": [f"llama-{BUCKET_VERSION}-bin-win-cpu-x64.zip"]}[flavor]
```

In the same file, document the unpinned Vulkan assets in the `ASSET_SHA256` table. Immediately below the existing `# NOTE: linux cpu configs ...` line (line 54), add:

```python
# The Vulkan-flavor release assets (llama-<ver>-bin-win-vulkan-x64.zip and
# llama-<ver>-bin-ubuntu-vulkan-x64.tar.gz) are intentionally UNPINNED here:
# _verify() accepts an unrecorded asset with a stderr warning rather than
# bricking the first Vulkan users. Record their sha256 on a target machine and
# add them above (P4 follow-up).
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q`
Expected: PASS (the new vulkan tests plus every pre-existing test — the cuda/cpu asset lists are untouched).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py
git commit -m "feat(sidecar): fetch win-vulkan llama-server release zip"
```

---

### Task 3: Linux Vulkan acquisition (ubuntu tarball) + flavor-aware exe name

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:70-71` (`_exe_name`)
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:74-77` (`binary_path`)
- Add: `sidecar/sokuji_sidecar/llama_runtime.py` — new `_install_from_github_tar` (place directly after `_install_from_github`, before `_ENSURE_BINARY_LOCK` at line 222)
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:253-256` (`ensure_binary` install routing) and `:265` (its return line)
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Consumes: `_fetch`, `gh_url`, `_verify`, `BinaryFetchError`.
- Produces: `_exe_name("vulkan")` → `"llama-server"` on non-Windows (Windows still `"llama-server.exe"`; every other flavor still `"llama"`); `binary_path("vulkan")` → `<bin_root>/vulkan/llama-server`; `ensure_binary("vulkan")` on Linux downloads `llama-{BUCKET_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`, extracts the server binary + shared libs flat into the flavor dir, chmods the binary, and returns its path. The binary keeps its `llama-server` name so `_build_args`' existing `startswith("llama-server")` check skips the `serve` subcommand.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_llama_runtime.py`:

```python
import tarfile


def _tar_gz(files):
    """A minimal gzip tarball: {member_path: bytes}."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_exe_name_vulkan_is_server_on_linux(monkeypatch):
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    assert rt._exe_name("vulkan") == "llama-server"
    assert rt._exe_name("cuda") == "llama"
    assert rt._exe_name() == "llama"


def test_exe_name_windows_ignores_flavor(monkeypatch):
    monkeypatch.setattr(rt.platform, "system", lambda: "Windows")
    assert rt._exe_name("vulkan") == "llama-server.exe"
    assert rt._exe_name("cuda") == "llama-server.exe"


def test_binary_path_vulkan_uses_server_name(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    d = tmp_path / rt.BUCKET_VERSION / "vulkan"
    d.mkdir(parents=True)
    (d / "llama-server").write_bytes(b"ELF")
    assert rt.binary_path("vulkan") == str(d / "llama-server")


def test_ensure_binary_vulkan_extracts_ubuntu_tarball(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_LLAMA_BIN_DIR", str(tmp_path))
    monkeypatch.setattr(rt.platform, "system", lambda: "Linux")
    monkeypatch.setattr(rt.platform, "machine", lambda: "x86_64")
    blob = _tar_gz({"build/bin/llama-server": b"ELF-vulkan-server",
                    "build/bin/libggml-vulkan.so": b"SO"})
    fetched = []

    def fake_fetch(url):
        fetched.append(url)
        return blob
    monkeypatch.setattr(rt, "_fetch", fake_fetch)

    path = rt.ensure_binary("vulkan")
    assert path == rt.binary_path("vulkan")
    assert os.path.basename(path) == "llama-server"
    assert open(path, "rb").read() == b"ELF-vulkan-server"
    assert os.access(path, os.X_OK)
    # the shared lib was flattened out of build/bin/ to sit beside the exe
    assert os.path.isfile(os.path.join(os.path.dirname(path), "libggml-vulkan.so"))
    assert fetched == [rt.gh_url(f"llama-{rt.BUCKET_VERSION}-bin-ubuntu-vulkan-x64.tar.gz")]


def test_ubuntu_vulkan_tar_is_unpinned():
    asset = f"llama-{rt.BUCKET_VERSION}-bin-ubuntu-vulkan-x64.tar.gz"
    assert asset not in rt.ASSET_SHA256
    rt._verify(asset, b"anything")   # unknown asset -> stderr warning, no raise
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -k "vulkan or exe_name" -q`
Expected: FAIL — `test_exe_name_vulkan_is_server_on_linux` fails (`_exe_name("vulkan")` returns `"llama"`), and `test_ensure_binary_vulkan_extracts_ubuntu_tarball` errors (Linux `ensure_binary("vulkan")` currently routes to `_install_from_bucket` → `_probe_config("vulkan")`, an unhandled path).

- [ ] **Step 3: Implement**

In `sidecar/sokuji_sidecar/llama_runtime.py`, replace `_exe_name` (lines 70-71):

```python
def _exe_name() -> str:
    return "llama-server.exe" if platform.system() == "Windows" else "llama"
```

with:

```python
def _exe_name(flavor: str | None = None) -> str:
    if platform.system() == "Windows":
        return "llama-server.exe"
    # The official ubuntu-vulkan RELEASE tarball ships a `llama-server` binary
    # (not the bucket's single-file `llama` app). Keep that name verbatim: it is
    # what _build_args keys the `serve`-subcommand suppression on.
    if flavor == "vulkan":
        return "llama-server"
    return "llama"
```

Replace `binary_path` (lines 74-77):

```python
def binary_path(flavor: str) -> str | None:
    """Installed binary path for `flavor`, or None when not yet downloaded."""
    exe = os.path.join(bin_root(), flavor, _exe_name())
    return exe if os.path.isfile(exe) else None
```

with:

```python
def binary_path(flavor: str) -> str | None:
    """Installed binary path for `flavor`, or None when not yet downloaded."""
    exe = os.path.join(bin_root(), flavor, _exe_name(flavor))
    return exe if os.path.isfile(exe) else None
```

Add `_install_from_github_tar` immediately after `_install_from_github` (after line 219, before `_ENSURE_BINARY_LOCK = threading.Lock()` on line 222):

```python
def _install_from_github_tar(flavor: str, dest_dir: str) -> str:
    """Linux: official release tar.gz (currently only the ubuntu-vulkan build).
    Mirrors the Windows zip path (_install_from_github): extract the archive,
    then, if the server binary isn't already at the top level, flatten the
    directory that holds it so its shared libraries (libggml*.so, libllama.so)
    land next to the exe. Unlike the bucket's single-file `llama`, this ships a
    `llama-server` binary + .so's under build/bin/.

    glibc note: these are built against Ubuntu's glibc. The first REAL spawn is
    the compatibility check — a too-old host glibc surfaces as a
    BackendLoadError from LlamaServerProc.start(). Falling back to a
    bucket-built vulkan binary is out of scope here."""
    import io
    import tarfile
    asset = {"vulkan": f"llama-{BUCKET_VERSION}-bin-ubuntu-vulkan-x64.tar.gz"}[flavor]
    blob = _fetch(gh_url(asset))
    _verify(asset, blob)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        tf.extractall(dest_dir)
    exe = os.path.join(dest_dir, _exe_name(flavor))
    if not os.path.isfile(exe):
        # tarball nests binaries + shared libs under build/bin/ — flatten the
        # dir that holds the server so the .so's sit beside it.
        for root, _dirs, files in os.walk(dest_dir):
            if _exe_name(flavor) in files and root != dest_dir:
                for fn in files:
                    os.replace(os.path.join(root, fn), os.path.join(dest_dir, fn))
                break
    if not os.path.isfile(exe):
        raise BinaryFetchError(f"{_exe_name(flavor)} not found in {asset}")
    os.chmod(exe, 0o755)
    return exe
```

In `ensure_binary`, replace the install routing (lines 253-256):

```python
            if platform.system() == "Windows":
                _install_from_github(flavor, tmp_dir)
            else:
                _install_from_bucket(flavor, tmp_dir)
```

with:

```python
            if platform.system() == "Windows":
                _install_from_github(flavor, tmp_dir)
            elif platform.system() == "Linux" and flavor == "vulkan":
                _install_from_github_tar(flavor, tmp_dir)
            else:
                _install_from_bucket(flavor, tmp_dir)
```

And replace `ensure_binary`'s return line (line 265):

```python
        return os.path.join(final_dir, _exe_name())
```

with:

```python
        return os.path.join(final_dir, _exe_name(flavor))
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q`
Expected: PASS — the new vulkan/exe-name tests, plus the pre-existing bucket tests (`test_ensure_binary_downloads_and_extracts`, `test_ensure_binary_is_idempotent`, `test_binary_path_present`, …): those use `cuda`/`cpu`, for which `_exe_name(flavor)` still returns `"llama"`, so their paths are unchanged.

- [ ] **Step 5: Guard the llama server-proc suite** (serve-subcommand detection is unchanged — confirm nothing regressed)

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_server_proc.py -q`
Expected: PASS — `_build_args` and `LlamaServerProc` are untouched; a `llama-server`-named binary already suppresses the `serve` subcommand via the existing basename check.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py
git commit -m "feat(sidecar): install linux llama-server via ubuntu-vulkan tarball"
```

---

### Task 4: Catalog `gpu-vulkan` tier for every LLM translate card

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:253-266` (`_llm_translate_row`)
- Test: `sidecar/tests/test_catalog.py:156-171` (`test_llm_translate_rows_shape`) + one new test
- Test: `sidecar/tests/test_accel.py:625-626` (`test_resolve_translate_override_cpu_pins_front`) and `:781` (`test_resolve_translate_override_honors_quant_pin`)

**Interfaces:**
- Consumes: `accel.TIER_RANK` (`gpu-vulkan` = 2.5) and `accel._tier_available`'s existing `gpu-vulkan` branch (both already present from P2/P3).
- Produces: every `_llm_translate_row` card carries `gpu-cuda`, `gpu-metal`, `gpu-vulkan`, `cpu` rows per quant. Auto-path `resolve_translate` (chosen + cpu floor) is unaffected; the override path enumerates the new vulkan rung on any machine where `_tier_available("gpu-vulkan")` is true (has an NVIDIA/DML/Vulkan device).

**Why only two accel tests change:** `resolve_translate`'s `override == "auto"` path returns only `select_variant`'s chosen deployment plus a same-quant CPU floor — it never enumerates the vulkan tier, so all auto-path tests (`test_resolve_translate_prefers_gpu`, `test_resolve_translate_same_quant_cpu_floor`, `test_select_variant_*`, the `list_variants` dedupe, and the ASR `resolve()` `["vulkan","cpu"]` tests) are unchanged. Only the **override** path (`_resolve_model` → `resolve_deployments`) enumerates all available tiers, and only two override tests assert an exact device list on an NVIDIA machine (where `_tier_available("gpu-vulkan")` is true via the `bool(machine.nvidia)` fallback).

- [ ] **Step 1: Update the tests to the post-change expectations**

In `sidecar/tests/test_catalog.py`, in `test_llm_translate_rows_shape`, replace line 163:

```python
        assert {(q, "gpu-cuda"), (q, "gpu-metal"), (q, "cpu")} <= tiers
```

with:

```python
        assert {(q, "gpu-cuda"), (q, "gpu-metal"),
                (q, "gpu-vulkan"), (q, "cpu")} <= tiers
```

Append a new test to `sidecar/tests/test_catalog.py` proving `TIER_RANK` (not tuple order) governs ordering:

```python
def test_llm_vulkan_tier_ranks_between_cuda_and_cpu():
    # gpu-vulkan (TIER_RANK 2.5) resolves below gpu-cuda/gpu-metal (3.0) and
    # above cpu (1.0). Ordering comes from accel.TIER_RANK, not the order of
    # the tiers tuple in _llm_translate_row.
    from sokuji_sidecar import accel
    # Post-P2 Machine shape: NVIDIA presence comes from `gpus` descriptions via
    # accel.has_nvidia (no `nvidia` field / accel.Gpu class). gpu-cuda is
    # available (has_nvidia), gpu-vulkan via "vulkan" in tc_kinds, gpu-metal not.
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"llamacpp_gemma"}),
                      fingerprint="t", tc_kinds=("cpu", "vulkan"),
                      gpus=(("cuda", "NVIDIA x", 12288),))
    plans = accel.resolve_deployments(catalog.translate_model("translategemma-4b"), m)
    seen = []
    for p in plans:
        if p.tier not in seen:
            seen.append(p.tier)
    assert seen == ["gpu-cuda", "gpu-vulkan", "cpu"]   # gpu-metal filtered (no Apple/Metal)
```

In `sidecar/tests/test_accel.py`, in `test_resolve_translate_override_cpu_pins_front`, replace lines 625-626:

```python
    assert [p.device for p in plans] == ["cpu", "cpu", "cuda", "cuda"]
    assert plans[0].device == "cpu" and plans[-1].device == "cuda"
```

with:

```python
    assert [p.device for p in plans] == [
        "cpu", "cpu", "cuda", "cuda", "vulkan", "vulkan"]
    assert plans[0].device == "cpu" and plans[-1].device == "vulkan"
```

In `sidecar/tests/test_accel.py`, in `test_resolve_translate_override_honors_quant_pin`, replace line 781:

```python
    assert [p.device for p in plans] == ["cpu", "cuda"]
```

with:

```python
    assert [p.device for p in plans] == ["cpu", "cuda", "vulkan"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_llm_translate_rows_shape tests/test_catalog.py::test_llm_vulkan_tier_ranks_between_cuda_and_cpu tests/test_accel.py::test_resolve_translate_override_cpu_pins_front tests/test_accel.py::test_resolve_translate_override_honors_quant_pin -q`
Expected: FAIL — the catalog has no `gpu-vulkan` rows yet, so the subset assertion fails, the new ordering test's `seen` is `["gpu-cuda", "cpu"]`, and the two override device lists lack `"vulkan"`.

- [ ] **Step 3: Implement**

In `sidecar/sokuji_sidecar/catalog.py`, replace `_llm_translate_row` (lines 253-266):

```python
def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False):
    """An LLM card: one llamacpp backend, two GGUF quant variants, three tiers
    each. The same GGUF serves every tier; rank 2.0 marks the default quant."""
    backend = f"llamacpp_{family}"
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        artifact = _gguf_artifact(mid, quant)
        deps += [Deployment(backend, tier, quant, artifact, rank, est_bytes=nbytes)
                 for tier in ("gpu-cuda", "gpu-metal", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes)
```

with:

```python
def _llm_translate_row(mid, name, family, sort_order, default_quant, default_bytes,
                       alt_quant, alt_bytes, recommended=False):
    """An LLM card: one llamacpp backend, two GGUF quant variants, four tiers
    each (gpu-cuda / gpu-metal / gpu-vulkan / cpu). The same GGUF serves every
    tier; rank 2.0 marks the default quant. Plan ORDER across tiers is decided
    by accel.TIER_RANK (gpu-cuda/gpu-metal 3.0 > gpu-vulkan 2.5 > cpu 1.0), not
    by the order of this tuple."""
    backend = f"llamacpp_{family}"
    deps = []
    for quant, nbytes, rank in ((default_quant, default_bytes, 2.0),
                                (alt_quant, alt_bytes, 1.0)):
        artifact = _gguf_artifact(mid, quant)
        deps += [Deployment(backend, tier, quant, artifact, rank, est_bytes=nbytes)
                 for tier in ("gpu-cuda", "gpu-metal", "gpu-vulkan", "cpu")]
    return TranslateModel(mid, name, ("multi",), tuple(deps),
                          recommended=recommended, sort_order=sort_order,
                          size_bytes=default_bytes)
```

- [ ] **Step 4: Run the targeted tests to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_llm_translate_rows_shape tests/test_catalog.py::test_llm_vulkan_tier_ranks_between_cuda_and_cpu tests/test_accel.py::test_resolve_translate_override_cpu_pins_front tests/test_accel.py::test_resolve_translate_override_honors_quant_pin -q`
Expected: 4 passed.

- [ ] **Step 5: Run the full catalog + accel suites** (catch any exact-list assertion this row change disturbs)

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q`
Expected: PASS. If any other test fails on an exact translate device/tier list, it is an override-path enumeration test on a GPU machine — update its expected list to include the `vulkan` rung (rank 2.5, after the GPU-native rung, before cpu). No auto-path or ASR test should change.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): add gpu-vulkan tier to LLM translate cards"
```

---

### Task 5: Full-suite green + torch-free gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire sidecar suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS across all files, including `tests/test_torch_free_gate.py` (this plan adds no ML dependency) and `tests/test_native_models.py` (its `default_flavor`/`required_flavors` tests stub those functions, so the vulkan branch does not affect them).

- [ ] **Step 2: Static sanity — no stray `_exe_name()` callers broke**

Run: `cd sidecar && grep -rn "_exe_name(" sokuji_sidecar/ | grep -v "def _exe_name"`
Expected: every call site is either `_exe_name()` (bucket / Windows-github paths, still `"llama"` / `"llama-server.exe"`) or `_exe_name(flavor)` (`binary_path`, `ensure_binary` return, `_install_from_github_tar`). No positional misuse.

- [ ] **Step 3: (no commit — verification task)** If Steps 1-2 are clean, the workstream is complete pending the hardware checks below.

---

## Deferred hardware verification (NOT executable on the Linux + NVIDIA dev box)

These require physical non-NVIDIA GPU hardware and/or Windows and are out of scope for the automated tasks above. Each maps to code already exercised by stubs on Linux.

1. **Vulkan asset existence at the pinned version.** `BUCKET_VERSION` is `b9835`; spec D6 verified `win-vulkan-x64.zip` and `ubuntu-vulkan-x64.tar.gz` upstream at `b9876`. On any box, confirm the two URLs resolve HTTP 200:
   - `https://github.com/ggml-org/llama.cpp/releases/download/b9835/llama-b9835-bin-win-vulkan-x64.zip`
   - `https://github.com/ggml-org/llama.cpp/releases/download/b9835/llama-b9835-bin-ubuntu-vulkan-x64.tar.gz`
   If either 404s, bump `BUCKET_VERSION` (or add a per-flavor version override) to a release that ships both — the f-strings track it automatically.
2. **Windows non-NVIDIA GPU:** `ensure_binary("vulkan")` on Windows downloads the zip, `LlamaServerProc.start()` spins up `llama-server.exe`, and a translation round-trips against `/v1/chat/completions`. Confirms the single-asset (no-cudart) assumption and that the Vulkan driver loads.
3. **Linux non-NVIDIA GPU (AMD/Intel):** transcribe.cpp's probe reports `"vulkan"` in `Machine.tc_kinds` so `default_flavor()` returns `"vulkan"` and `required_flavors()` fetches `["vulkan", "cpu"]`; `ensure_binary("vulkan")` extracts the ubuntu tarball; the extracted `llama-server` **runs** (the glibc-compat check) and a translation round-trips. On a glibc-too-old failure, the surface is a `BackendLoadError` from `start()` — the fallback (a bucket-built vulkan binary) is a separate follow-up.
4. **Record + pin sha256** for both Vulkan assets on a trusted machine and add them to `ASSET_SHA256`, replacing the unpinned-note comment (then remove the two `*_is_unpinned` tests, or invert them to assert presence).
5. **End-to-end tier selection** on the AMD/Intel box: a `llamacpp_*` translate card auto-resolves to `gpu-vulkan` first with a `cpu` floor, and an explicit `translationDevice: cuda` (GPU) override pins the vulkan tier ahead of cpu.
