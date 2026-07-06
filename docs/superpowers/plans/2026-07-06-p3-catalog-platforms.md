# P3 — Catalog `platforms` Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every catalog `Deployment` a `platforms` tag (default all three OSes) and an Apple-Silicon-required marker, and make the accel resolvers + the `models_catalog` handler drop deployments the running host can't use — so that the Windows-only `gpu-dml` tier (P5) and the macOS/Apple-Silicon-only MLX tier (P6) can be added later as pure catalog data. This plan (D9) adds the filtering machinery only; it introduces **no** platform-restricted cards, so on Linux nothing about the shipped catalog changes.

**Architecture:** `Deployment` gains two defaulted fields (`platforms`, `requires_apple_silicon`). A single `current_platform()` helper in `accel.py` maps `platform.system()` → `"linux" | "windows" | "macos"` and is monkeypatchable in tests. A single `_platform_ok(d, machine)` predicate encodes the drop rule. It is applied at the resolver choke point (`resolve_deployments`, through which ASR `resolve`, TTS `resolve_tts`, and the translate override path all flow) plus a one-line up-front filter in `resolve_translate` (its bespoke `auto` branch builds Plans via `select_variant` and never flows through `resolve_deployments`), and at the `models_catalog` tier builder so tier lists reflect only the current platform's deployments.

**Tech Stack:** Python 3.10 dev venv (`sidecar/.venv`), pytest with `monkeypatch` stubs (no hardware, no network). Standard-library `platform` and `dataclasses` only — no new dependency.

## Global Constraints

- Sidecar runtime stays torch-free (`tests/test_torch_free_gate.py` must keep passing). This plan touches only pure-Python catalog/resolver code and adds no imports.
- **No behavior change on Linux for existing cards.** Every catalog `Deployment` defaults to `platforms=("linux","windows","macos")` and `requires_apple_silicon=False`, so `_platform_ok` is a no-op for every shipped card until P5/P6 add restricted tiers. Existing `tests/test_accel.py` / `tests/test_catalog.py` must stay green unchanged.
- The wire protocol shape is unchanged: `models_catalog` still returns `tiers` as a list of `{"tier","backend","available"}`; only which rows appear changes.
- The filter LOGIC lives in exactly one helper (`_platform_ok`). It is referenced at the resolver choke point (`resolve_deployments`), once up front in `resolve_translate` (whose `auto` path bypasses that choke point), and in the `models_catalog` tier builder — never re-implemented.
- P3 adds no platform-restricted deployments. All platform-specific behavior is exercised via a monkeypatched `current_platform` on the Linux dev box; the real Windows/macOS card visibility is verified by P5/P6 (see the deferred checklist at the end).
- All comments/docs in English. Conventional commit messages. TDD (failing test first). DRY. YAGNI.

---

### Task 1: `Deployment` gains `platforms` + `requires_apple_silicon`

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (`Deployment` dataclass fields, currently ending at `:24` with `est_bytes`)
- Test: `sidecar/tests/test_catalog.py` (append two functions; file currently ends at `:296`)

**Interfaces:**
- Produces: `catalog.Deployment` with two new keyword-defaulted fields — `platforms: tuple[str, ...] = ("linux", "windows", "macos")` and `requires_apple_silicon: bool = False`. Task 2/3 consume these attributes. Every existing positional construction (`Deployment(backend, tier, compute_type, artifact, rank, ...)`) is unaffected because the new fields sit after `est_bytes` and all callers pass `min_capability`/`est_bytes` by keyword.

- [ ] **Step 1: Write the failing tests** — append to the end of `sidecar/tests/test_catalog.py`:

```python
def test_deployment_platform_defaults():
    # D9: every deployment is all-platforms + no Apple-Silicon requirement unless
    # a card opts in. Positional construction (backend, tier, compute_type,
    # artifact, rank) still works with the two new trailing fields.
    d = catalog.Deployment("be", "cpu", "int8", "repo", 1.0)
    assert d.platforms == ("linux", "windows", "macos")
    assert d.requires_apple_silicon is False


def test_deployment_platform_fields_are_settable():
    d = catalog.Deployment("be", "gpu-dml", "fp32", "repo", 1.0,
                           platforms=("windows",), requires_apple_silicon=False)
    assert d.platforms == ("windows",)
    mlx = catalog.Deployment("be", "gpu-metal", "fp16", "repo", 1.0,
                             platforms=("macos",), requires_apple_silicon=True)
    assert mlx.requires_apple_silicon is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: FAIL — `AttributeError: 'Deployment' object has no attribute 'platforms'`.

- [ ] **Step 3: Add the fields.** In `sidecar/sokuji_sidecar/catalog.py`, replace the last field of the `Deployment` dataclass:

```python
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)
```

with:

```python
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)
    platforms: tuple[str, ...] = ("linux", "windows", "macos")  # OSes this deployment runs on (D9)
    requires_apple_silicon: bool = False             # gate: needs Apple Silicon (mlx / metal-only rows)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: PASS (33 tests: the prior 31 plus the two new).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): add platforms + requires_apple_silicon to Deployment"
```

---

### Task 2: `current_platform()` + `_platform_ok()` and the resolver choke point

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
  - add `current_platform()` after `_apple_silicon` (`:79-80`)
  - add `_platform_ok()` after `_tier_available` (`:221-234`)
  - extend the `usable` filter in `resolve_deployments` (`:241-242`)
  - add an up-front deployment filter in `resolve_translate` (after `:393`)
- Test: create `sidecar/tests/test_platform_filter.py`

**Interfaces:**
- Consumes: `Deployment.platforms` / `Deployment.requires_apple_silicon` (Task 1); `Machine.apple_silicon`.
- Produces:
  - `accel.current_platform() -> str` — `platform.system()` mapped to `"linux" | "windows" | "macos"`; monkeypatchable.
  - `accel._platform_ok(d, machine: Machine) -> bool` — `False` when `current_platform()` not in `d.platforms`, or when `d.requires_apple_silicon` and not `machine.apple_silicon`; else `True`. Applied so that `resolve` (ASR), `resolve_tts`, and both branches of `resolve_translate` drop off-platform deployments.

- [ ] **Step 1: Write the failing tests** — create `sidecar/tests/test_platform_filter.py`:

```python
import asyncio

from sokuji_sidecar import accel, catalog


def _machine(*, apple=False, nvidia=(), installed=frozenset({"be"})):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=nvidia,
                         apple_silicon=apple, dml_adapters=(), installed=installed,
                         fingerprint="pf-test")


def _asr(*deps):
    return catalog.AsrModel("m", "M", ("multi",), deps)


def test_current_platform_maps_system(monkeypatch):
    for sysname, tag in (("Linux", "linux"), ("Windows", "windows"), ("Darwin", "macos")):
        monkeypatch.setattr(accel.platform, "system", lambda s=sysname: s)
        assert accel.current_platform() == tag


def test_resolve_deployments_drops_off_platform_on_linux(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    plans = accel.resolve_deployments(model, _machine())
    assert [p.artifact for p in plans] == ["r-all"]  # windows-only cpu row dropped on linux


def test_resolve_deployments_keeps_row_on_its_own_platform(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "windows")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    plans = accel.resolve_deployments(model, _machine())
    assert {p.artifact for p in plans} == {"r-win", "r-all"}


def test_resolve_deployments_apple_silicon_gate(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "macos")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-mlx", 1.0, requires_apple_silicon=True),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    # Intel mac (no Apple Silicon): the AS-only row is dropped.
    assert [p.artifact for p in accel.resolve_deployments(model, _machine(apple=False))] == ["r-all"]
    # Apple Silicon: the AS-only row survives.
    assert {p.artifact for p in accel.resolve_deployments(model, _machine(apple=True))} == {"r-mlx", "r-all"}


def test_resolve_translate_auto_drops_off_platform(monkeypatch):
    # The translate `auto` branch builds Plans via select_variant and never flows
    # through resolve_deployments, so it needs the up-front filter. Without it the
    # first cpu deployment (r-win) would be picked as the floor and the whole
    # resolve would raise NoUsablePlan instead of falling back to r-all.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = catalog.TranslateModel("syn", "Syn", ("multi",), (
        catalog.Deployment("opus_onnx_translate", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("opus_onnx_translate", "cpu", "int8", "r-all", 1.0),
    ))
    monkeypatch.setattr(catalog, "translate_model", lambda mid: model if mid == "syn" else None)
    m = _machine(installed=frozenset({"opus_onnx_translate"}))
    plans = accel.resolve_translate("syn", "auto", m)
    assert [p.artifact for p in plans] == ["r-all"]


def test_linux_real_card_resolution_unchanged(monkeypatch):
    # Regression: a real all-platforms card resolves exactly as before on linux.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"transcribe_cpp"}))
    plans = accel.resolve("whisper-base", machine=m)
    assert [p.device for p in plans] == ["vulkan", "cpu"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_platform_filter.py -q`
Expected: FAIL — `AttributeError: <module 'sokuji_sidecar.accel'> has no attribute 'current_platform'` (raised by `monkeypatch.setattr`), plus the resolver-drop assertions failing (both rows still returned).

- [ ] **Step 3a: Add `current_platform()`.** In `sidecar/sokuji_sidecar/accel.py`, replace:

```python
def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


def _dml_adapters() -> tuple[str, ...]:
```

with:

```python
def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


_PLATFORM_MAP = {"Linux": "linux", "Windows": "windows", "Darwin": "macos"}


def current_platform() -> str:
    """This host's platform tag ('linux' | 'windows' | 'macos'), mapped from
    platform.system(). The single source of truth for the catalog's per-deployment
    `platforms` filter (D9); monkeypatched in tests to exercise the filter without
    the host OS. An unmapped platform.system() falls through to its lowercased
    name — harmless: no deployment lists it, so such a host resolves nothing."""
    return _PLATFORM_MAP.get(platform.system(), platform.system().lower())


def _dml_adapters() -> tuple[str, ...]:
```

- [ ] **Step 3b: Add `_platform_ok()`.** In `sidecar/sokuji_sidecar/accel.py`, replace the tail of `_tier_available` and the `resolve_deployments` header:

```python
    if tier == "gpu-vulkan":
        # transcribe.cpp's own probe is authoritative (sees AMD/Intel Vulkan
        # devices the NVML/DML heuristics can't); NVML/DML remain as fallbacks.
        return "vulkan" in machine.tc_kinds or bool(machine.nvidia or machine.dml_adapters)
    return False


def resolve_deployments(model, machine: Machine, override: str = "auto", bench: dict | None = None) -> list[Plan]:
```

with:

```python
    if tier == "gpu-vulkan":
        # transcribe.cpp's own probe is authoritative (sees AMD/Intel Vulkan
        # devices the NVML/DML heuristics can't); NVML/DML remain as fallbacks.
        return "vulkan" in machine.tc_kinds or bool(machine.nvidia or machine.dml_adapters)
    return False


def _platform_ok(d, machine: Machine) -> bool:
    """Whether deployment `d` is runnable on THIS host's OS (D9). A row is dropped
    when this platform is not in its `platforms` set, or when it demands Apple
    Silicon and the machine lacks it. Every shipped card defaults to all three
    OSes + no AS requirement, so this is a no-op until platform-specific tiers
    (windows-only gpu-dml, macOS/AS-only mlx) land in P5/P6."""
    if current_platform() not in d.platforms:
        return False
    if d.requires_apple_silicon and not machine.apple_silicon:
        return False
    return True


def resolve_deployments(model, machine: Machine, override: str = "auto", bench: dict | None = None) -> list[Plan]:
```

- [ ] **Step 3c: Filter at the choke point.** In `resolve_deployments`, replace:

```python
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)]
```

with:

```python
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)
              and _platform_ok(d, machine)]
```

- [ ] **Step 3d: Filter the translate `auto` bypass.** In `resolve_translate`, replace:

```python
    llama_runtime.set_reserved_bytes(reserved_bytes)
    if override == "auto":
```

with:

```python
    llama_runtime.set_reserved_bytes(reserved_bytes)
    # The `auto` branch below builds Plans via select_variant + a hand-picked cpu
    # floor and never flows through resolve_deployments' choke point, so drop
    # off-platform deployments up front here (all current translate cards are
    # cross-platform → a no-op today). The override branch re-filters idempotently
    # via resolve_deployments.
    model = dataclasses.replace(
        model, deployments=tuple(d for d in model.deployments if _platform_ok(d, machine)))
    if override == "auto":
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_platform_filter.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the accel + catalog suites to prove no Linux regression**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py tests/test_catalog.py -q`
Expected: PASS (all existing tests green — default all-platforms means `_platform_ok` never drops a shipped card on the Linux dev box).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_platform_filter.py
git commit -m "feat(sidecar): filter deployments by host platform in resolvers"
```

---

### Task 3: `models_catalog` tiers reflect only the current platform

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_models_catalog` tier-building loop, `:1064-1070`)
- Test: append to `sidecar/tests/test_platform_filter.py`

**Interfaces:**
- Consumes: `_platform_ok` (Task 2).
- Produces: `models_catalog` protocol output unchanged in shape (`tiers` is still a list of `{"tier","backend","available"}`), but a deployment whose platform is not the current host's no longer contributes a tier row. Availability of an on-platform-but-otherwise-unusable tier (e.g. `gpu-dml` on Windows with no DML adapter) is still expressed via `available: false`, exactly as today. The per-quant `variants` block is unaffected: quant restrictions are per-tier, never per-compute_type, and the cross-platform cpu tier always carries every compute_type, so no `variantIds`/`variants` entry can be dropped by platform.

- [ ] **Step 1: Write the failing tests** — append to `sidecar/tests/test_platform_filter.py`:

```python
def _dml_model():
    # Synthetic card with a windows-only gpu-dml tier over a cross-platform cpu
    # floor (the P5 shape). Same compute_type on both tiers, so the multi-quant
    # variants block never triggers — the test isolates tier visibility.
    return catalog.AsrModel("syn", "Syn", ("multi",), (
        catalog.Deployment("moss_onnx", "gpu-dml", "q8_0", "r", 1.0, platforms=("windows",)),
        catalog.Deployment("moss_onnx", "cpu", "q8_0", "r", 1.0),
    ))


def test_models_catalog_hides_off_platform_tier_on_linux(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_dml_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"moss_onnx"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = reply["models"][0]["tiers"]
    assert [t["tier"] for t in tiers] == ["cpu"]  # windows-only gpu-dml tier hidden on linux


def test_models_catalog_shows_on_platform_tier_with_availability(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "windows")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_dml_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"moss_onnx"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = {t["tier"]: t for t in reply["models"][0]["tiers"]}
    assert set(tiers) == {"gpu-dml", "cpu"}          # both tiers listed on windows
    assert tiers["gpu-dml"]["available"] is False    # on-platform, but this machine has no DML adapter
    assert tiers["cpu"]["available"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_platform_filter.py -q`
Expected: FAIL — `test_models_catalog_hides_off_platform_tier_on_linux` gets `["gpu-dml", "cpu"]` (the off-platform tier still listed).

- [ ] **Step 3: Filter the tier builder.** In `sidecar/sokuji_sidecar/accel.py`, in `_h_models_catalog`, replace:

```python
        tiers = []
        seen_tiers = set()
        for d in mdl.deployments:
            if d.tier in seen_tiers:
                continue                      # multi-quant ladders repeat tiers
            seen_tiers.add(d.tier)
            tiers.append({"tier": d.tier, "backend": d.backend,
                          "available": d.backend in m.installed and _tier_available(d.tier, m)})
```

with:

```python
        tiers = []
        seen_tiers = set()
        for d in mdl.deployments:
            if not _platform_ok(d, m):
                continue                      # off-platform tier (e.g. windows-only gpu-dml on linux)
            if d.tier in seen_tiers:
                continue                      # multi-quant ladders repeat tiers
            seen_tiers.add(d.tier)
            tiers.append({"tier": d.tier, "backend": d.backend,
                          "available": d.backend in m.installed and _tier_available(d.tier, m)})
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_platform_filter.py -q`
Expected: PASS (8 tests).

- [ ] **Step 5: Full sidecar suite** (proves the whole change is green, incl. the torch-free gate and every `models_catalog` regression)

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS — no regressions. (`tests/test_marian_onnx.py` is a pre-existing P1 file; it is unrelated to this plan and stays as-is.)

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_platform_filter.py
git commit -m "feat(sidecar): hide off-platform tiers in models_catalog"
```

---

## Deferred hardware verification (Linux-only dev box)

P3 is fully testable on Linux with a monkeypatched `current_platform`, because it **adds the filtering machinery only — no platform-restricted card exists yet**. There is therefore nothing in P3 that requires a physical Windows or macOS machine; `current_platform()` is a pure static-map of `platform.system()` and is unit-tested for all three inputs.

The following confirmations belong to the plans that actually add restricted deployments and must be run on the corresponding hardware there, not in P3:

1. **Windows (gates P5, `gpu-dml`):** on a real Windows host, `current_platform()` returns `"windows"`, a `gpu-dml` deployment tagged `platforms=("windows",)` appears in `models_catalog` tiers and is selected by `resolve`/`resolve_tts`, and the same tier is absent from a Linux `models_catalog`.
2. **macOS + Apple Silicon (gates P6, MLX):** on a real Apple-Silicon Mac, `current_platform()` returns `"macos"`, an MLX deployment tagged `platforms=("macos",), requires_apple_silicon=True` resolves, and the same row is dropped on an Intel Mac (`machine.apple_silicon is False`) and on Linux/Windows.
3. **Cross-platform regression:** the existing NVIDIA-Linux resolves (whisper/sense-voice → `vulkan`/`cpu`, LLM translate cards → `cuda`/`cpu`) are byte-identical before and after P3 — already asserted on the dev box by `test_linux_real_card_resolution_unchanged` and the untouched `tests/test_accel.py` suite.
