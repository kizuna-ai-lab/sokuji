# P2 — NVML Removal + Probe Unification + Rider Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove NVML (`nvidia-ml-py`) entirely: NVIDIA presence, VRAM totals and free VRAM all come from the transcribe.cpp probe already stored in `Machine.gpus` / read by `device_free_bytes()`, fixing the empty `hardware_info.gpus[]` on mac/AMD along the way; ride along with two D11 cleanups (sherpa TTS cards lose their false `gpu-cuda` tier; `_metal_config` degrades unknown Apple chips instead of raising).

**Architecture:** A new `accel.has_nvidia(machine)` helper (case-insensitive "nvidia" match on the tc-probe device descriptions in `Machine.gpus`) becomes the single NVIDIA-presence seam. Consumers migrate one seam per task while `Machine.nvidia` still exists, keeping the suite green at every task boundary: tier gates + `hardware_info` + `llama_runtime.default_flavor` first, then quant-budget/variant selection (which also deletes the production-dead CUDA `capability`/`min_capability` gating), then free-VRAM reads (`_cuda_free_bytes` → `device_free_bytes`, None-degrading). Only then are `Machine.nvidia`, the `Gpu` dataclass, `_nvidia_gpus` and the `nvidia-ml-py` pin deleted. The two riders are independent tail tasks.

**Tech Stack:** Python 3 stdlib only for the new code (dataclasses, platform); transcribe-cpp 0.1.1 wheel is the device-truth source (already pinned); pytest with the existing monkeypatch/stub house style in `sidecar/tests/`.

## Global Constraints

- Sidecar runtime stays torch-free (`tests/test_torch_free_gate.py` must keep passing).
- After this plan: zero `pynvml` imports, zero `nvidia-ml-py` in `sidecar/requirements.txt` (spec D7: "NVML (`nvidia-ml-py`) is removed").
- NVIDIA detection = "device description contains `nvidia`, case-insensitive" from the transcribe.cpp probe (spec D7); llama.cpp SM/featcode probing via the bucket probe binaries (`llama_runtime._run_probe`) is untouched.
- CUDA `min_capability` / `Gpu.capability` are production-dead — delete, do not port (spec D7).
- Wire protocol shape unchanged: `hardware_info_result` keeps keys `os/arch/cpuCores/gpus[{vendor,name,vramMb}]/backendsInstalled/accelAvailable`; `list_variants` reason strings are free-form (spec D9 note).
- Quant/download recommendation basis stays STABLE (device `mem_total`), never volatile free VRAM.
- Do NOT add a `vulkan` llama flavor here — that is P4. `default_flavor()` here is: NVIDIA(tc)→`cuda`, Apple→`metal`, else `cpu`.
- sherpa TTS is CPU-only in reality (sherpa-onnx 1.13.3 bundled ORT has only CPUExecutionProvider, runtime-verified — spec D11); `moss_onnx`/`supertonic`/`qwen3tts_onnx` cards KEEP their `gpu-cuda` rows (they run on onnxruntime-gpu).
- Dev machine is Linux+NVIDIA; the macOS-only behavior (`_metal_config`, `default_flavor` metal) is stub-tested here and listed in the deferred-hardware checklist at the end.
- English only. TDD. Conventional commits. Tests: `cd sidecar && .venv/bin/python -m pytest tests/<file> -q` (repo root = the worktree root; `sidecar/` is relative to it).
- Line numbers reference commit 344af988 (pre-P1). If P1 (Opus→CT2) lands first, only backend NAMES in untouched test lines differ (`opus_onnx_translate` → `ct2_opus_translate`); no edit in this plan targets those lines — locate edits by the quoted code, not the offset.

### Consumer→replacement map (spec-required trace of every `machine.nvidia` / NVML reader)

| Former consumer | Old source | Replacement |
|---|---|---|
| `accel.probe()` (:182, :192, :196) | `_nvidia_gpus()` NVML enumeration into `Machine.nvidia` + fingerprint component | deleted; fingerprint keeps its existing `tc_gpus` component (Task 5) |
| `accel._tier_available` "gpu-cuda" (:225) | `bool(machine.nvidia)` | `has_nvidia(machine)` (Task 2) |
| `accel._tier_available` "gpu-vulkan" fallback (:233) | `machine.nvidia or machine.dml_adapters` | `has_nvidia(machine) or bool(machine.dml_adapters)` (Task 2) |
| `accel._quant_budget_bytes` fallback (:289-290) | `machine.nvidia[0].vram_mb << 20` | deleted — tc `mem_total` (`Machine.gpus`) is already the primary basis (Task 3) |
| `accel.select_variant` non-llamacpp path (:935, :943, :945) | `gpu.vram_mb` / `gpu.capability` / `d.min_capability` | `_quant_budget_bytes(machine)` total + `_tier_available(d.tier, machine)`; capability gate deleted (Task 3) |
| `accel._h_list_variants` non-llamacpp branch (:1010-1011, :1019-1022) | same trio | same replacement; "needs compute capability" reason removed (Task 3) |
| `accel._h_hardware_info` (:1040-1042) | `m.nvidia` → gpus[] + accelAvailable | `m.gpus` + `_gpu_vendor(description)`; `accelAvailable = bool(m.gpus or m.apple_silicon or m.dml_adapters)` (Task 2) |
| `accel.device_free_bytes` fallback (:121) | `_cuda_free_bytes()` NVML | `return None` — every caller (`load_measured` :568/:573, `load_with_fallback` post-Task-4) already treats None as "skip gating/measurement" (Task 4) |
| `accel.load_with_fallback` (:661) | `_cuda_free_bytes()` direct | `device_free_bytes()` (Task 4) |
| `llama_runtime.default_flavor` (:92) | `m.nvidia` | `accel.has_nvidia(m)` (Task 2) |

---

### Task 1: `accel.has_nvidia()` — the NVIDIA-presence seam

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:102-105` (insert new function after `_tc_gpus`)
- Test: `sidecar/tests/test_accel.py` (append after `_machine` helper, currently at :129-132)

**Interfaces:**
- Consumes: `Machine.gpus: tuple[tuple[str, str, int], ...]` — existing `(kind, description, mem_total_bytes)` tuples from the tc probe.
- Produces: `accel.has_nvidia(machine: Machine) -> bool` — Tasks 2/3 and `llama_runtime.default_flavor` consume this exact name.

- [ ] **Step 1: Write the failing tests** (append to `sidecar/tests/test_accel.py`, right after the `_machine` helper at :132)

```python
def test_has_nvidia_from_tc_description():
    m = _machine(gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),))
    assert accel.has_nvidia(m) is True


def test_has_nvidia_case_insensitive():
    m = _machine(gpus=(("cuda", "nVidia geforce rtx 5080", 16 << 30),))
    assert accel.has_nvidia(m) is True


def test_has_nvidia_false_for_amd():
    m = _machine(gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),))
    assert accel.has_nvidia(m) is False


def test_has_nvidia_false_without_devices():
    assert accel.has_nvidia(_machine()) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q -k has_nvidia`
Expected: 4 FAIL — `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'has_nvidia'`

- [ ] **Step 3: Implement** — in `sidecar/sokuji_sidecar/accel.py`, directly after `_tc_gpus` (:105), add:

```python
def has_nvidia(machine: Machine) -> bool:
    """NVIDIA presence, from the transcribe.cpp probe: any accelerator device
    whose description names NVIDIA (case-insensitive substring — the D7
    contract). Replaces the removed NVML enumeration; the tc probe is the
    single all-vendor device-truth source."""
    return any("nvidia" in name.lower() for _kind, name, _total in machine.gpus)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): detect NVIDIA via the transcribe.cpp probe description"
```

---

### Task 2: Presence consumers → tc probe (tier gates, hardware_info, default_flavor)

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:221-234` (`_tier_available`), `:1036-1042` (`_h_hardware_info` + new `_gpu_vendor` helper above it)
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:88-96` (`default_flavor`)
- Test: `sidecar/tests/test_accel.py` (helper + ~45 machine-construction swaps), `sidecar/tests/test_llama_runtime.py` (new default_flavor tests)

**Interfaces:**
- Consumes: `accel.has_nvidia(machine)` (Task 1).
- Produces: `hardware_info_result.gpus` entries `{"vendor": str, "name": str, "vramMb": int}` built from `Machine.gpus` (fixes the empty list on mac/AMD); `accel._gpu_vendor(description: str) -> str` (returns `"nvidia"|"amd"|"intel"|"apple"|"unknown"`); test helper `_nv_gpus(vram_mb: int = 0) -> tuple` in `test_accel.py` that Tasks 3/6 reuse.

- [ ] **Step 1: Write the failing tests**

(a) In `sidecar/tests/test_llama_runtime.py`, append:

```python
def _probe_machine(gpus=(), apple=False):
    from sokuji_sidecar import accel
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=(),
                         apple_silicon=apple, dml_adapters=(),
                         installed=frozenset(), fingerprint="t", gpus=gpus)


def test_default_flavor_cuda_from_tc_probe(monkeypatch):
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "probe", lambda force=False: _probe_machine(
        gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),)))
    assert rt.default_flavor() == "cuda"


def test_default_flavor_metal_on_apple(monkeypatch):
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "probe", lambda force=False: _probe_machine(apple=True))
    assert rt.default_flavor() == "metal"


def test_default_flavor_cpu_for_non_nvidia_gpu(monkeypatch):
    # AMD/Intel GPUs get no cuda flavor; the vulkan flavor arrives in P4.
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "probe", lambda force=False: _probe_machine(
        gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),)))
    assert rt.default_flavor() == "cpu"
```

(b) In `sidecar/tests/test_accel.py`, REPLACE the whole `test_hardware_info_handler` (:317-330) with:

```python
def test_hardware_info_handler(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("cuda", "NVIDIA GeForce RTX 4070", 12288 << 20),))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "cuda"))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "hardware_info", "id": 7}), None, None))
    assert reply["type"] == "hardware_info_result" and reply["id"] == 7
    assert reply["accelAvailable"] is True
    assert reply["gpus"] == [{"vendor": "nvidia",
                              "name": "NVIDIA GeForce RTX 4070", "vramMb": 12288}]
    assert "sherpa" in reply["backendsInstalled"]


def test_hardware_info_reports_amd_gpu_from_tc_probe(monkeypatch):
    # THE D7 bugfix: gpus[] used to come from NVML, so mac/AMD boxes reported
    # an empty list. The tc probe sees every vendor.
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "vulkan"))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    accel.probe(force=True)
    reply, _ = asyncio.run(accel._h_hardware_info({}, {"id": 1}, None))
    assert reply["gpus"] == [{"vendor": "amd", "name": "AMD Radeon RX 7800 XT",
                              "vramMb": 16384}]
    assert reply["accelAvailable"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py tests/test_accel.py -q -k "default_flavor or hardware_info"`
Expected: `test_default_flavor_cuda_from_tc_probe` FAILS (`assert 'cpu' == 'cuda'` — `m.nvidia` is empty); both hardware_info tests FAIL (`gpus` list empty — still built from `m.nvidia`).

- [ ] **Step 3: Implement the production changes**

(a) `sidecar/sokuji_sidecar/accel.py` `_tier_available` (:221-234) — replace the two nvidia reads:

```python
def _tier_available(tier: str, machine: Machine) -> bool:
    if tier == "cpu":
        return True
    if tier == "gpu-cuda":
        return has_nvidia(machine)
    if tier == "gpu-metal":
        return machine.apple_silicon or "metal" in machine.tc_kinds
    if tier == "gpu-dml":
        return bool(machine.dml_adapters)
    if tier == "gpu-vulkan":
        # transcribe.cpp's own probe is authoritative (sees AMD/Intel Vulkan
        # devices); NVIDIA-by-description and DML remain as fallbacks.
        return ("vulkan" in machine.tc_kinds or has_nvidia(machine)
                or bool(machine.dml_adapters))
    return False
```

(b) `sidecar/sokuji_sidecar/accel.py` — directly above `_h_hardware_info` (:1036), add:

```python
_GPU_VENDORS = ("nvidia", "amd", "intel", "apple")


def _gpu_vendor(description: str) -> str:
    """Vendor slug parsed from a tc-probe device description (best-effort)."""
    d = description.lower()
    for v in _GPU_VENDORS:
        if v in d:
            return v
    return "unknown"
```

then replace `_h_hardware_info` (:1036-1042) with:

```python
async def _h_hardware_info(state, msg, _b, conn=None):
    m = probe()
    return {"type": "hardware_info_result", "id": msg.get("id"),
            "os": m.os, "arch": m.arch, "cpuCores": m.cpu_cores,
            # All-vendor gpus[] from the tc probe (Machine.gpus) — NVML only
            # ever saw NVIDIA, leaving this empty on mac/AMD boxes.
            "gpus": [{"vendor": _gpu_vendor(name), "name": name,
                      "vramMb": total >> 20} for _kind, name, total in m.gpus],
            "backendsInstalled": sorted(m.installed),
            "accelAvailable": bool(m.gpus or m.apple_silicon or m.dml_adapters)}, None
```

(c) `sidecar/sokuji_sidecar/llama_runtime.py` `default_flavor` (:88-96) — replace the nvidia check:

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

- [ ] **Step 4: Migrate the test machines** — in `sidecar/tests/test_accel.py`:

(a) Add this helper directly after `_machine` (:132):

```python
def _nv_gpus(vram_mb=0):
    """tc-probe-shaped NVIDIA device identity: (kind, description, mem_total).
    vram_mb=0 models a probe that saw the device but no memory figure."""
    return (("vulkan", "NVIDIA GeForce RTX 4070", vram_mb << 20),)
```

(b) Apply these exact machine-construction replacements (old → new; each `old` is unique within its named test):

| Test (current line) | Old | New |
|---|---|---|
| `test_resolve_prefers_gpu_when_nvidia_present` :145 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_resolve_override_pins_cpu` :156 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_resolve_real_catalog_sense_voice_cpu` :168 | `monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())` | `monkeypatch.setattr(accel, "_tc_gpus", lambda: ())` |
| `test_models_catalog_handler_cpu_machine` :334 | `monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())` | `monkeypatch.setattr(accel, "_tc_gpus", lambda: ())` |
| `test_models_catalog_filter_narrows_results` :361 | `monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())` | `monkeypatch.setattr(accel, "_tc_gpus", lambda: ())` |
| `test_whisper_resolves_vulkan_first_on_nvidia` :375 | `m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288),))` | `m = _machine(gpus=_nv_gpus(12288))` |
| `test_whisper_cpu_override_pins_cpu_on_nvidia` :387 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_sense_voice_resolves_vulkan_then_cpu_on_nvidia` :393 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_resolve_demotes_gpu_when_cache_says_slower` :484 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_resolve_override_beats_demotion` :498 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_granite_gated_off_without_transformers_installed` :552-553 | `machine=_machine(nvidia=(accel.Gpu("nvidia", "x", 0),),`<br>`                 installed=frozenset({"ctranslate2"}))` | `machine=_machine(gpus=_nv_gpus(),`<br>`                 installed=frozenset({"ctranslate2"}))` |
| `test_qwen3asr_model_unavailable_without_runtime` :559-563 | the whole `m = accel.Machine(...)` construction | `m = _machine(gpus=_nv_gpus(12000),`<br>`             installed=frozenset({"ctranslate2", "sherpa", "transformers"}))` |
| `test_voxtral_model_unavailable_without_runtime` :589-593 | the whole `m = accel.Machine(...)` construction | `m = _machine(gpus=_nv_gpus(12000),`<br>`             installed=frozenset({"ctranslate2", "sherpa", "transformers"}))` |
| `test_resolve_translate_prefers_gpu` :603-604 | `m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288, (8, 9)),),`<br>`             installed=frozenset({"llamacpp_qwen"}))` | `m = _machine(gpus=_nv_gpus(12288),`<br>`             installed=frozenset({"llamacpp_qwen"}))` |
| `test_resolve_translate_override_cpu_pins_front` :622-623 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),`<br>`             installed=frozenset({"llamacpp_qwen"}))` | `m = _machine(gpus=_nv_gpus(),`<br>`             installed=frozenset({"llamacpp_qwen"}))` |
| `test_resolve_translate_qwen35_no_longer_self_gates` :635 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),), installed=accel._installed())` | `m = _machine(gpus=_nv_gpus(), installed=accel._installed())` |
| `test_models_catalog_kind_translate_returns_qwen_rows` :647-648 | `monkeypatch.setattr(accel, "probe", lambda force=False: _machine(`<br>`    nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"llamacpp_qwen"})))` | `monkeypatch.setattr(accel, "probe", lambda force=False: _machine(`<br>`    gpus=_nv_gpus(), installed=frozenset({"llamacpp_qwen"})))` |
| `test_resolve_translate_override_honors_quant_pin` :778-779 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),`<br>`             installed=frozenset({"llamacpp_qwen"}))` | `m = _machine(gpus=_nv_gpus(),`<br>`             installed=frozenset({"llamacpp_qwen"}))` |
| `test_resolve_translate_override_without_pin_unchanged` :788-789 | same shape as above | same replacement |
| `test_resolve_translate_override_cuda_sets_reserved` :800-801 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12288, (8, 9)),),`<br>`             installed=frozenset({"llamacpp_qwen"}))` | `m = _machine(gpus=_nv_gpus(12288),`<br>`             installed=frozenset({"llamacpp_qwen"}))` |
| `test_resolve_translate_opus_is_cpu_only` :882-883 | `m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288, (8, 9)),),`<br>`             installed=frozenset({"opus_onnx_translate"}))` | `m = _machine(gpus=_nv_gpus(12288),`<br>`             installed=frozenset({"opus_onnx_translate"}))` |
| `test_resolve_translate_hymt15_prefers_gpu` :894-895 | `m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288, (8, 9)),),`<br>`             installed=frozenset({"llamacpp_hunyuan"}))` | `m = _machine(gpus=_nv_gpus(12288),`<br>`             installed=frozenset({"llamacpp_hunyuan"}))` |
| `test_resolve_tts_orders_gpu_over_cpu` :906-911 | the `gpu = accel.Gpu(...)` line and the whole `machine = accel.Machine(...)` construction | `machine = _machine(gpus=_nv_gpus(12000),`<br>`                   installed=frozenset({"sherpa_tts", "moss_onnx"}))` |
| `test_resolve_tts_cpu_only_machine` :919-922 | the whole `machine = accel.Machine(...)` construction | `machine = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))` |
| `test_resolve_tts_arbitrary_sherpa_repo_synthesizes_model` :941-945 | the whole `machine = accel.Machine(...)` construction | `machine = _machine(gpus=_nv_gpus(12000),`<br>`                   installed=frozenset({"sherpa_tts", "moss_onnx"}))` |
| `test_resolve_tts_unknown_non_sherpa_id_still_raises` :957-960 | the whole `machine = accel.Machine(...)` construction | `machine = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))` |
| `_llm_machine` helper :1033-1038 | the whole function body | `def _llm_machine(nvidia=False, apple=False):`<br>`    return _machine(gpus=_nv_gpus(12282) if nvidia else (),`<br>`                    apple=apple, installed=accel._installed())` |
| `test_speech_llms_resolve_vulkan_then_cpu_on_nvidia` :1112 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12288),))` | `m = _machine(gpus=_nv_gpus(12288))` |
| `_gpu_m` helper :1212-1214 | the whole function body | `def _gpu_m():`<br>`    return _machine(gpus=_nv_gpus(12282),`<br>`                    installed=frozenset({"llamacpp_gemma", "transcribe_cpp"}))` |
| `test_resolve_translate_auto_matches_recommendation_basis` :1272-1273 | `m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12282),),`<br>`             installed=frozenset({"llamacpp_gemma"}))` | `m = _machine(gpus=_nv_gpus(12282),`<br>`             installed=frozenset({"llamacpp_gemma"}))` |
| `test_resolve_translate_auto_loads_the_downloaded_file` :1281-1282 | same shape as above | same replacement |
| `test_list_variants_recommends_on_stable_total` :1290-1294 | the whole `m = accel.Machine(...)` construction | `m = _machine(gpus=_nv_gpus(12288), installed=frozenset({"llamacpp_gemma"}))` |
| `test_asr_roomy_budget_upgrades_to_q8` :1313 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |
| `test_asr_tight_budget_keeps_default` :1323 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 2048),))` | `m = _machine(gpus=_nv_gpus(2048))` |
| `test_asr_unknown_memory_keeps_default_on_gpu` :1341 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))` | `m = _machine(gpus=_nv_gpus())` |
| `test_asr_pin_narrows_ladder` :1348 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 2048),))  # q8 wouldn't fit` | `m = _machine(gpus=_nv_gpus(2048))  # q8 wouldn't fit` |
| `test_asr_pin_listed_only_quant_honored` :1358 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |
| `test_asr_downloaded_listed_only_quant_loads` :1368 | same shape | `m = _machine(gpus=_nv_gpus(12282))` |
| `test_asr_fresh_recommendation_never_listed_only` :1378 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 24564),))` | `m = _machine(gpus=_nv_gpus(24564))` |
| `test_asr_single_quant_cards_unaffected` :1385 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |
| `test_models_catalog_exposes_asr_variant_ids_and_deduped_tiers` :1391 | `monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())` | delete the line (`_tc_gpus`/`_tc_kinds` are already patched there) |
| `test_asr_quant_pick_prefers_downloaded` :1417 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |
| `test_translate_quant_pick_prefers_downloaded` :1424-1425 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),),`<br>`             installed=frozenset({"llamacpp_gemma"}))` | `m = _machine(gpus=_nv_gpus(12282),`<br>`             installed=frozenset({"llamacpp_gemma"}))` |
| `test_quant_pick_ignores_download_state_when_nothing_cached` :1434 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |
| `_catalog_reply` helper :1514-1521 | `def _catalog_reply(monkeypatch, gpus=(), nvidia=(), kind="asr", models=None):`<br>`    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: nvidia)` | `def _catalog_reply(monkeypatch, gpus=(), kind="asr", models=None):` (drop the `_nvidia_gpus` patch line entirely) |
| `test_catalog_variants_translate_kind_included` :1561-1563 | `by_id = _catalog_reply(monkeypatch, gpus=(("vulkan", "RTX 4070", 12 << 30),),`<br>`                       nvidia=(accel.Gpu("nvidia", "RTX 4070", 12282),),`<br>`                       kind="translate", models=["translategemma-4b"])` | `by_id = _catalog_reply(monkeypatch, gpus=_nv_gpus(12288),`<br>`                       kind="translate", models=["translategemma-4b"])` |
| `test_translate_auto_demotes_gpu_when_bench_says_cpu_faster` :1598-1599 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),),`<br>`             installed=frozenset({"llamacpp_gemma"}))` | `m = _machine(gpus=_nv_gpus(12282),`<br>`             installed=frozenset({"llamacpp_gemma"}))` |
| `test_translate_auto_keeps_gpu_without_bench` :1612-1613 | same shape | same replacement |
| `test_asr_bench_demotion_uses_quant_keyed_entries` :1622 | `m = _machine(nvidia=(accel.Gpu("nvidia", "x", 12282),))` | `m = _machine(gpus=_nv_gpus(12282))` |

NOT migrated here (their production seams change in Tasks 3/5, and they still read `machine.nvidia` until then): the `_gpu_machine`/`_hymt2_7b` select_variant block (:685-845), `_mac_machine` (:1573-1577), the probe/NVML tests at the top of the file (:16-126), and the E1 tests' `_nvidia_gpus` patch lines (:1148-1174).

- [ ] **Step 5: Run the full suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass (the vram_mb→`<< 20` values are bit-identical to the old NVML fallback basis, so every budget assertion is unchanged).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_accel.py sidecar/tests/test_llama_runtime.py
git commit -m "refactor(sidecar): source GPU presence from the tc probe (tier gates, hardware_info, llama flavor)"
```

---

### Task 3: Quant budgets / variant selection on tc totals; delete dead capability gating

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:279-291` (`_quant_budget_bytes`), `:922-960` (`select_variant`), `:1010-1031` (`_h_list_variants` non-llamacpp branch)
- Modify: `sidecar/sokuji_sidecar/catalog.py:23` (delete `min_capability` field)
- Test: `sidecar/tests/test_accel.py` (`_gpu_machine`/`_hymt2_7b` block :685-845)

**Interfaces:**
- Consumes: `has_nvidia` via `_tier_available` (Task 2); `_nv_gpus` test helper (Task 2).
- Produces: `catalog.Deployment` WITHOUT `min_capability` (fields end at `est_bytes`); `select_variant(model, machine, reserved_bytes, pin=None, budget_bytes=None, downloaded=None)` signature unchanged but non-llamacpp candidates are gated by `_tier_available(d.tier, machine)` + `_quant_budget_bytes(machine)` total instead of `Gpu.vram_mb`/`Gpu.capability`.

- [ ] **Step 1: Rewrite the two anchor tests to the tc-probe expectation** (they must FAIL before the implementation)

In `sidecar/tests/test_accel.py`, REPLACE `test_select_variant_picks_fp8_on_ada_when_bf16_too_big` (:708-715) with:

```python
def test_select_variant_budget_from_tc_probe_totals(monkeypatch):
    # est_bytes: bf16 ~15GB, fp8 ~8GB. 16GB device total (tc probe), 2GB
    # reserve -> budget 13GB; bf16 needs 15x1.2=18GB, fp8 needs 8x1.5=12GB.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _gpu_machine(16 * 1024)
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=2 * 1024**3)
    assert d.compute_type == "fp8"
```

and REPLACE `test_list_variants_marks_supported_and_recommended`'s machine line (:820)

```python
    monkeypatch.setattr(accel, "probe", lambda force=False: _gpu_machine(16 * 1024, (8, 9)))
```

with

```python
    monkeypatch.setattr(accel, "probe", lambda force=False: _gpu_machine(16 * 1024))
```

then REPLACE the `_gpu_machine` helper (:685-689) with:

```python
def _gpu_machine(vram_mb, installed=("hunyuan_translate",)):
    return _machine(gpus=_nv_gpus(vram_mb), installed=frozenset(installed))
```

and update its other call sites (all in :718-845): `_gpu_machine(12 * 1024, (8, 6))` → delete that whole test (`test_select_variant_excludes_fp8_on_ampere` — capability gating is the deleted dead code); `_gpu_machine(12 * 1024, (8, 9))` → `_gpu_machine(12 * 1024)` (in `test_select_variant_fp8_dropped_when_compressed_tensors_absent`, `test_fp8_weight_factor_larger_than_bf16_in_select_variant`); `_gpu_machine(24 * 1024, (8, 9))` → `_gpu_machine(24 * 1024)` (in `test_select_variant_prefers_bf16_when_it_fits`, `test_select_variant_pin_honored_when_valid`); `_gpu_machine(0, None)` → `_gpu_machine(0)` (in `test_select_variant_conservative_when_no_vram`); `_gpu_machine(16 * 1024, (8, 9))` → `_gpu_machine(16 * 1024)` (second one in `test_fp8_weight_factor_...`); `_gpu_machine(12 * 1024, (8, 9), installed=("llamacpp_hunyuan",))` → `_gpu_machine(12 * 1024, installed=("llamacpp_hunyuan",))` (in `test_resolve_translate_explicit_device_override_unchanged`).

In `_hymt2_7b` (:692-705), replace the fp8 deployment line

```python
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "fp8", "tencent/Hy-MT2-7B-FP8", 1.0,
                           min_capability=(8, 9)),
```

with

```python
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "fp8", "tencent/Hy-MT2-7B-FP8", 1.0),
```

and add one new safety test after `test_select_variant_conservative_when_no_vram`:

```python
def test_select_variant_requires_available_gpu_tier(monkeypatch):
    # A machine with device memory but NO NVIDIA device (AMD seen by the tc
    # probe) must not pick a gpu-cuda variant just because a total exists.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 << 30)
    m = _machine(gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),),
                 installed=frozenset({"hunyuan_translate"}))
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q -k "select_variant or list_variants_marks or fp8_weight"`
Expected: `test_select_variant_budget_from_tc_probe_totals` FAILS (`assert 'float32' == 'fp8'` — `select_variant` still reads the now-empty `machine.nvidia`, so it returns the cpu floor); `test_list_variants_marks_supported_and_recommended` FAILS (`recommended == 'float32'`, all variants "no usable GPU"); `test_fp8_weight_factor_...` and `test_select_variant_prefers_bf16_...`/`_pin_honored_...`/`_fp8_dropped_...` FAIL the same way. `test_select_variant_requires_available_gpu_tier` PASSES already (cpu floor either way) — it exists to pin the new gate.

- [ ] **Step 3: Implement**

(a) `sidecar/sokuji_sidecar/accel.py` `_quant_budget_bytes` (:279-291) — delete the NVIDIA fallback:

```python
def _quant_budget_bytes(machine: Machine):
    """The STABLE per-machine basis for quant selection: the primary device's
    TOTAL memory, from the transcribe.cpp probe (all vendors). Quant choice
    only decides WHICH FILE we recommend the user download — and we always run
    exactly the file the user downloaded — so the basis must never flap with
    transient VRAM pressure (that would recommend re-downloads). Runtime
    pressure is placement's job (--fit / cpu fallback), never a silent switch
    to a different model file."""
    total = max((t for _k, _n, t in machine.gpus), default=0)
    return total or None
```

(b) `select_variant` (:922-960) — replace the whole function with:

```python
def select_variant(model, machine: Machine, reserved_bytes: int, pin: str | None = None,
                   budget_bytes: int | None = None, downloaded: set | None = None):
    """Pick the best downloadable variant of `model` for this machine. Deterministic:
    same (model, machine, reserved_bytes, pin) → same Deployment. Falls back to the
    CPU floor when no GPU variant fits, the device memory total is unknown, or a
    format's runtime is missing. `pin` (a compute_type) forces that variant when
    it's valid.

    llamacpp-backed models (all current LLM translate cards) take a separate,
    VRAM-math-free path: llama-server's --fit handles memory via partial offload,
    so quant/tier selection is purely rank + tier-availability, never a byte budget."""
    if _is_llamacpp(model):
        return _llamacpp_variant_row(model, machine, pin, reserved_bytes, budget_bytes,
                                     downloaded=downloaded)
    total = _quant_budget_bytes(machine)
    cpu_floor = next((d for d in model.deployments if d.tier == "cpu"), None)

    def candidate(d) -> bool:
        if d.tier == "cpu":
            return False
        if d.backend not in machine.installed or not _format_ready(d.compute_type):
            return False
        if total is None or not _tier_available(d.tier, machine):
            return False
        need = _est_bytes(d)
        if need is None:
            return False
        budget = total - reserved_bytes - _VRAM_CONTEXT_BYTES
        return need * _weight_factor(d.compute_type) <= budget

    cands = [d for d in model.deployments if candidate(d)]
    if pin is not None:
        pinned = next((d for d in cands if d.compute_type == pin), None)
        if pinned is not None:
            return pinned
    if cands:
        return max(cands, key=lambda d: (_VARIANT_QUALITY.get(d.compute_type, 0.0), d.rank))
    return cpu_floor
```

(c) `_h_list_variants` non-llamacpp branch — replace :1010-1031 (from `gpu = m.nvidia[0] if m.nvidia else None` through the end of the `for` loop) with:

```python
    total = _quant_budget_bytes(m)
    budget = (total - reserve - _VRAM_CONTEXT_BYTES) if total else 0
    variants = []
    for d in model.deployments:
        if d.tier == "cpu":
            continue
        need = _est_bytes(d)
        if d.backend not in m.installed or not _format_ready(d.compute_type):
            supported, reason = False, "runtime not installed"
        elif total is None or not _tier_available(d.tier, m):
            supported, reason = False, "no usable GPU"
        elif need is None:
            supported, reason = False, "size unknown"
        elif need * _weight_factor(d.compute_type) > budget:
            supported, reason = False, "too big for available VRAM"
        else:
            supported, reason = True, "fits"
        variants.append({"id": d.compute_type, "computeType": d.compute_type,
                         "repo": d.artifact, "sizeBytes": need or 0,
                         "supported": supported, "reason": reason})
```

(d) `sidecar/sokuji_sidecar/catalog.py:23` — delete the line:

```python
    min_capability: tuple[int, int] | None = None   # min CUDA compute cap for a GPU variant
```

- [ ] **Step 4: Run the full suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass. Sanity: `grep -rn "min_capability\|capability" sidecar/sokuji_sidecar/*.py` shows only `voice_capability` (unrelated TTS feature map) — no CUDA capability code left.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_accel.py
git commit -m "refactor(sidecar): quant budgets from tc probe totals; drop dead CUDA capability gating"
```

---

### Task 4: Free-VRAM reads unified on `device_free_bytes`; delete `_cuda_free_bytes`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:108-121` (`device_free_bytes`), `:516-537` (delete `_cuda_free_bytes`), `:661` (`load_with_fallback` free read)
- Test: `sidecar/tests/test_accel.py` (:79-95, :222-315, :851, :1076, :1184-1196)

**Interfaces:**
- Consumes: nothing new.
- Produces: `accel.device_free_bytes() -> int | None` — None whenever the tc probe wheel is absent or reports no accelerator; callers verified None-tolerant: `load_measured` (:568/:573 — skips the delta when None) and `load_with_fallback` (post-change — `free is not None` guard at :664 keeps the proactive gate inert).

- [ ] **Step 1: Write the failing tests**

(a) In `sidecar/tests/test_accel.py`, REPLACE `test_device_free_bytes_nvml_fallback` (:1184-1188) with:

```python
def test_device_free_bytes_none_without_tc(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "transcribe_cpp", None)   # import fails
    assert accel.device_free_bytes() is None   # no NVML fallback: degrade to None
```

(b) Add after `test_vram_gate_inert_without_estimates` (:259):

```python
def test_vram_gate_reads_vendor_agnostic_free(monkeypatch):
    # The proactive gate must read device_free_bytes (tc probe), never NVML.
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 2 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 5 * _GIB)
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    _b, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q -k "device_free_bytes_none_without_tc or vendor_agnostic_free"`
Expected: both FAIL on this NVIDIA dev box — `device_free_bytes` falls through to real NVML (returns a positive int, not None), and `load_with_fallback` reads real `_cuda_free_bytes()` (plenty free → cuda attempted, `attempted == ['cuda']`).

- [ ] **Step 3: Implement**

(a) `device_free_bytes` (:108-121) — drop the NVML fallback:

```python
def device_free_bytes():
    """FRESH free memory (bytes) of the primary accelerator device, or None
    when there is none (tc wheel absent, or no accelerator device). Volatile
    by design — call at plan/load time, never cache in Machine. Callers treat
    None as 'skip VRAM gating/measurement'."""
    try:
        for b in _tc_devices():
            if getattr(b, "device_type", "gpu") != "cpu":
                free = int(b.memory_free or 0)
                if free > 0:
                    return free
    except Exception:
        pass
    return None
```

(b) `load_with_fallback` :661 — replace

```python
        free = _cuda_free_bytes() if (plan.device == "cuda" and not is_llamacpp) else None
```

with

```python
        free = device_free_bytes() if (plan.device == "cuda" and not is_llamacpp) else None
```

(c) Delete the whole `_cuda_free_bytes` function (:516-537), including its docstring.

- [ ] **Step 4: Migrate the remaining `_cuda_free_bytes` test references** (they would raise `AttributeError` on `monkeypatch.setattr` now):

| Test (current line) | Old line | New line |
|---|---|---|
| `test_cuda_free_bytes_via_nvml` :79-83 | whole test | delete |
| `test_cuda_free_bytes_none_without_nvml` :86-89 | whole test | delete |
| `test_cuda_free_bytes_none_without_devices` :92-95 | whole test | delete |
| `test_vram_gate_skips_cuda_to_cpu_when_insufficient` :225 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 2 * _GIB)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: 2 * _GIB)` |
| `test_vram_gate_allows_cuda_when_sufficient` :237 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 10 * _GIB)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: 10 * _GIB)` |
| `test_vram_gate_inert_without_estimates` :249 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: None)` |
| `test_gpu_only_oom_raises_honest_vram_message` :265 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 1 * _GIB)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 * _GIB)` |
| `test_load_measured_reports_rss_delta_for_cpu` :290 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: None)` |
| `test_load_measured_omits_memory_when_unmeasurable` :300 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: None)` |
| `test_load_measured_omits_nonpositive_delta` :310 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: next(free))` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: next(free))` |
| `test_load_with_fallback_fp8_factor_gates_cuda` :851 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 12 * _GIB)` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: 12 * _GIB)` |
| `test_vram_gate_skipped_for_llamacpp` :1076 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 1 << 30)  # 1 GiB free` | `monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 << 30)  # 1 GiB free` |
| `test_device_free_bytes_none_without_gpu` :1195 | `monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)` | delete the line (no fallback exists to neutralize) |

- [ ] **Step 5: Run the full suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "refactor(sidecar): free-VRAM reads via device_free_bytes only; drop the NVML fallback"
```

---

### Task 5: Delete `_nvidia_gpus`, `Gpu`, `Machine.nvidia`, the NVML dependency

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:18-23` (delete `Gpu`), `:26-44` (`Machine` loses `nvidia`), `:47-76` (delete `_nvidia_gpus`), `:176-198` (`probe`)
- Modify: `sidecar/requirements.txt:10-16` (drop `nvidia-ml-py` + its comment block)
- Test: `sidecar/tests/test_accel.py` (:16-132 probe/NVML section, :1148-1174 E1 patches, :1573-1577 `_mac_machine`), `sidecar/tests/test_llama_runtime.py` (`_probe_machine`)

**Interfaces:**
- Consumes: Tasks 2-4 (no production reader of `Machine.nvidia`/`_cuda_free_bytes` remains).
- Produces: `Machine(os, arch, cpu_cores, apple_silicon, dml_adapters, installed, fingerprint, tc_kinds=(), gpus=())` — the final field set every later plan (P4/P5) builds on. Fingerprints change (the NVML component is gone), so cached `accel-bench.json` entries keyed by old fingerprints become inert misses — harmless by design.

- [ ] **Step 1: Write the failing regression gate** (append to `sidecar/tests/test_accel.py`)

```python
def test_no_nvml_left_in_package():
    # D7: NVML is fully removed — no module may import pynvml.
    import pathlib
    pkg = pathlib.Path(accel.__file__).parent
    hits = [p.name for p in pkg.glob("*.py") if "pynvml" in p.read_text()]
    assert hits == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_no_nvml_left_in_package -q`
Expected: FAIL — `accel.py` still contains `pynvml` (in `_nvidia_gpus`).

- [ ] **Step 3: Implement the production deletions**

(a) `sidecar/sokuji_sidecar/accel.py` — delete the `Gpu` dataclass (:18-23) and delete `_nvidia_gpus` (:47-76) entirely. Remove the `nvidia: tuple[Gpu, ...]` field from `Machine` (:31), leaving:

```python
@dataclass(frozen=True)
class Machine:
    os: str
    arch: str
    cpu_cores: int
    apple_silicon: bool
    dml_adapters: tuple[str, ...]
    installed: frozenset
    fingerprint: str
    # Accelerator kinds transcribe.cpp reports on this machine ("vulkan",
    # "metal", "cuda", "cpu") — the ground truth for the gpu-vulkan/gpu-metal
    # tiers (covers AMD/Intel via Vulkan).
    tc_kinds: tuple[str, ...] = ()
    # STABLE GPU identity from the same probe: (kind, description, mem_total)
    # per accelerator device. NVIDIA presence = has_nvidia() over these
    # descriptions. Volatile mem_free is intentionally NOT here (the Machine
    # is cached + fingerprinted) — planners read device_free_bytes() fresh at
    # plan time instead.
    gpus: tuple[tuple[str, str, int], ...] = ()
```

(b) Replace `probe` (:176-198) with:

```python
def probe(force: bool = False) -> Machine:
    """Detect hardware once and cache. Any detector that throws degrades to
    'absent' so the CPU floor is always reachable."""
    global _MACHINE
    if _MACHINE is not None and not force:
        return _MACHINE
    apple = _safe(_apple_silicon, False)
    dml = _safe(_dml_adapters, ())
    installed = _safe(_installed, frozenset())
    tc_kinds = _safe(_tc_kinds, ())
    tc_gpus = _safe(_tc_gpus, ())
    fp_src = (f"{platform.system()}|{platform.machine()}|{int(apple)}|"
              f"{','.join(sorted(dml))}|{','.join(sorted(installed))}|"
              f"{','.join(tc_kinds)}|"
              f"{','.join(f'{k}:{n}:{t}' for k, n, t in tc_gpus)}")
    fp = hashlib.blake2s(fp_src.encode(), digest_size=6).hexdigest()   # 12 hex chars
    _MACHINE = Machine(
        os=platform.system(), arch=platform.machine(), cpu_cores=os.cpu_count() or 1,
        apple_silicon=apple, dml_adapters=dml, installed=installed,
        fingerprint=fp, tc_kinds=tc_kinds, gpus=tc_gpus)
    return _MACHINE
```

(c) `sidecar/requirements.txt` — replace lines 10-16

```
# torch-free audio io / resample / NVIDIA probing (2026-07-04 torch-free spec).
# nvidia-ml-py talks to the driver's NVML and is a no-op import elsewhere, so it
# is safe to install on macOS/AMD boxes (probe degrades to "no NVIDIA GPUs").
# Capped below the next untested major (12.x and 13.x verified on the 4070 box).
soundfile>=0.13
soxr>=0.5
nvidia-ml-py>=12.535,<14
```

with

```
# torch-free audio io / resample (2026-07-04 torch-free spec). GPU probing is
# NVML-free since 2026-07-06 (D7): device truth = the transcribe.cpp probe.
soundfile>=0.13
soxr>=0.5
```

- [ ] **Step 4: Migrate the remaining test references**

In `sidecar/tests/test_accel.py`:

(a) Delete `_FakeNvml`, `_install_fake_nvml`, `test_nvidia_gpus_probe_via_nvml`, `test_nvidia_gpus_decodes_bytes_name`, `test_nvidia_gpus_empty_without_nvml` (:16-76) and the stale comment block at :678-679 ("NVML probe coverage lives at the top of this file …").

(b) Replace the three probe tests (:98-126) with:

```python
def test_probe_assembles_machine(monkeypatch):
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "vulkan"))
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    m = accel.probe(force=True)
    assert m.gpus == (("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),)
    assert accel.has_nvidia(m)
    assert "sherpa" in m.installed
    assert m.fingerprint  # non-empty, stable hash


def test_probe_degrades_when_detector_throws(monkeypatch):
    def boom(): raise RuntimeError("probe broken")
    monkeypatch.setattr(accel, "_tc_gpus", boom)
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    m = accel.probe(force=True)
    assert m.gpus == ()  # broken GPU detection → treated as absent, no crash


def test_probe_is_cached(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus", lambda: ())
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    first = accel.probe(force=True)
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("vulkan", "NVIDIA x", 1 << 30),))
    assert accel.probe() is first  # cached: no re-probe without force
```

(c) Replace the `_machine` helper (:129-132) with:

```python
def _machine(*, apple=False, dml=(), installed=frozenset({"transcribe_cpp", "transcribe_cpp_stream"}), tc=(), gpus=()):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, dml_adapters=dml, installed=installed,
                         fingerprint="test", tc_kinds=tc, gpus=gpus)
```

(d) Delete the now-invalid `_nvidia_gpus` patch lines in `test_machine_gpus_stable_identity` (:1154) and `test_fingerprint_ignores_volatile_free` (:1169) — both already patch `_tc_gpus` via the fake module. Update the comment in `test_vulkan_tier_from_tc_probe_alone` (:399) from "no NVML GPUs, no DML" to "no NVIDIA device, no DML".

(e) Replace `_mac_machine` (:1573-1577) with:

```python
def _mac_machine(installed=frozenset({"llamacpp_gemma", "transcribe_cpp"})):
    return accel.Machine(os="Darwin", arch="arm64", cpu_cores=10,
                         apple_silicon=True, dml_adapters=(), installed=installed,
                         fingerprint="mac", tc_kinds=("cpu", "metal"),
                         gpus=(("metal", "Apple M2", 16 << 30),))
```

In `sidecar/tests/test_llama_runtime.py`, drop the `nvidia=(),` argument from the `_probe_machine` helper added in Task 2:

```python
def _probe_machine(gpus=(), apple=False):
    from sokuji_sidecar import accel
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, dml_adapters=(),
                         installed=frozenset(), fingerprint="t", gpus=gpus)
```

- [ ] **Step 5: Verify — full suite, NVML grep, and an uninstall proof**

```bash
cd sidecar && .venv/bin/python -m pytest -q
grep -rn "pynvml\|nvidia-ml\|Machine.nvidia\|_nvidia_gpus\|_cuda_free_bytes\|accel.Gpu\|min_capability" sokuji_sidecar/ tests/ requirements.txt; echo "grep exit=$?"
.venv/bin/pip uninstall -y nvidia-ml-py && .venv/bin/python -m pytest -q
```

Expected: suite green; grep exit=1 (no matches — `_cudnn_preload.py`'s `nvidia/cudnn/lib` path strings do not match these patterns and are out of scope until P5/D8); suite still green with the wheel physically absent.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/requirements.txt sidecar/tests/test_accel.py sidecar/tests/test_llama_runtime.py
git commit -m "refactor(sidecar): remove NVML entirely (Machine.nvidia, Gpu, nvidia-ml-py)"
```

---

### Task 6: Rider — sherpa TTS cards are CPU-only (catalog rows + ad-hoc resolve_tts card)

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:339-346` (`_sherpa_tts_row`)
- Modify: `sidecar/sokuji_sidecar/accel.py:451-465` (`resolve_tts` ad-hoc card, cuda row at :459)
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `_machine`/`_nv_gpus` test helpers (Tasks 2/5 shape).
- Produces: every `sherpa_tts` Deployment has `tier == "cpu"` — no false GPU badge in `models_catalog` tiers, no phantom VRAM ledger claim from a sherpa "gpu" load.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_sherpa_tts_rows_are_cpu_only():
    # Stock sherpa-onnx wheel is CPU-only (its bundled ORT exposes just
    # CPUExecutionProvider, runtime-verified) — a gpu-cuda row shows a false
    # GPU badge and claims phantom VRAM in the cross-stage ledger (D11).
    for m in catalog.tts_models():
        for d in m.deployments:
            if d.backend == "sherpa_tts":
                assert d.tier == "cpu", m.id
```

Append to `sidecar/tests/test_accel.py`:

```python
def test_resolve_tts_sherpa_cards_cpu_only_even_on_gpu_machine():
    machine = _machine(gpus=_nv_gpus(12288), installed=frozenset({"sherpa_tts"}))
    # catalog piper card
    plans = accel.resolve_tts("csukuangfj/vits-piper-en_US-amy-low",
                              override="auto", machine=machine)
    assert [p.tier for p in plans] == ["cpu"]
    # ad-hoc (non-catalog) sherpa-family repo
    plans = accel.resolve_tts("csukuangfj/vits-piper-en_US-kristin-medium",
                              override="auto", machine=machine)
    assert [p.tier for p in plans] == ["cpu"]
```

And in `test_resolve_tts_arbitrary_sherpa_repo_synthesizes_model` replace the final line

```python
    assert plans[-1].tier == "cpu"  # cpu floor survives
```

with

```python
    assert [p.tier for p in plans] == ["cpu"]  # sherpa is CPU-only (D11)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q -k "sherpa"`
Expected: `test_sherpa_tts_rows_are_cpu_only` FAILS (piper rows carry `gpu-cuda`); the two resolve_tts tests FAIL with `['gpu-cuda', 'cpu'] != ['cpu']`.

- [ ] **Step 3: Implement**

(a) `sidecar/sokuji_sidecar/catalog.py` `_sherpa_tts_row` (:339-346):

```python
def _sherpa_tts_row(mid, name, langs, repo, sort_order, sr, urls=(), recommended=False,
                     num_speakers=1, size_bytes=0):
    # CPU-only by reality: the stock sherpa-onnx wheel bundles a CPU-only ORT
    # (runtime-verified, D11) — no GPU tier row.
    return TtsModel(mid, name, langs, (
        Deployment("sherpa_tts", "cpu", "fp32", repo, 1.0),
    ), repos=(repo,), urls=tuple(urls), sample_rate=sr,
       recommended=recommended, sort_order=sort_order, num_speakers=num_speakers,
       size_bytes=size_bytes)
```

(b) `sidecar/sokuji_sidecar/accel.py` `resolve_tts` ad-hoc card (:455-462) — drop the cuda row:

```python
        if any(h in model_id.lower() for h in _SHERPA_TTS_HINTS):
            model = catalog.TtsModel(
                id=model_id, name=model_id, languages=("multi",),
                deployments=(
                    catalog.Deployment("sherpa_tts", "cpu", "fp32", model_id, 1.0),
                ),
                repos=(model_id,), sample_rate=16000)
```

- [ ] **Step 4: Run the full suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass (`test_tts_system_has_cpu_floor_and_unique_ids`, `test_resolve_tts_orders_gpu_over_cpu` for MOSS, and `test_supertonic_row`'s `{"gpu-cuda", "cpu"}` set are unaffected — only sherpa rows changed).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "fix(sidecar): drop the false gpu-cuda tier from sherpa TTS cards"
```

---

### Task 7: Rider — `_metal_config` degrades unknown Apple chips instead of raising

**Files:**
- Modify: `sidecar/sokuji_sidecar/llama_runtime.py:154-162` (`_metal_config`)
- Test: `sidecar/tests/test_llama_runtime.py`

**Interfaces:**
- Consumes: nothing new (pure local change; `_probe_config` at :165-175 keeps calling `_metal_config()` for the metal flavor).
- Produces: `_metal_config() -> str` that always returns a bucket config (`"m1"…"m5"`), warning to stderr on unknown chips; module constant `_METAL_CONFIGS = ("m1", "m2", "m3", "m4", "m5")` (newest last — extend it when the bucket grows an m6 asset).

- [ ] **Step 1: Write the failing tests** (append to `sidecar/tests/test_llama_runtime.py`)

```python
def test_metal_config_known_chip(monkeypatch):
    class R:
        stdout = "Apple M4 Pro\n"
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: R())
    assert rt._metal_config() == "m4"


def test_metal_config_unknown_chip_degrades_with_warning(monkeypatch, capsys):
    # D11: a future chip (M6, M7, ...) must not brick binary install — newer
    # Apple GPUs run the newest known Metal build fine. Warn + degrade.
    class R:
        stdout = "Apple M7 Ultra\n"
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: R())
    assert rt._metal_config() == "m5"
    assert "unknown Apple chip" in capsys.readouterr().err


def test_metal_config_garbage_brand_degrades_with_warning(monkeypatch, capsys):
    class R:
        stdout = "\n"
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: R())
    assert rt._metal_config() == "m5"
    assert "unknown Apple chip" in capsys.readouterr().err
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q -k metal_config`
Expected: `test_metal_config_known_chip` PASSES (existing behavior); the two degrade tests FAIL with `BinaryFetchError: unsupported Apple chip ...`.

- [ ] **Step 3: Implement** — replace `_metal_config` (:154-162) with:

```python
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
    if len(parts) >= 2 and parts[0] == "Apple" and parts[1][:2].lower() in _METAL_CONFIGS:
        return parts[1][:2].lower()
    fallback = _METAL_CONFIGS[-1]
    print(f"[llama_runtime] unknown Apple chip {brand.strip()!r}; "
          f"using the {fallback} binary", file=sys.stderr)
    return fallback
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_llama_runtime.py -q`
Expected: all pass. Then the full suite: `cd sidecar && .venv/bin/python -m pytest -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/llama_runtime.py sidecar/tests/test_llama_runtime.py
git commit -m "fix(sidecar): degrade unknown Apple chips to the newest metal binary"
```

---

## Deferred hardware verification (not tasks — run when the physical machines are available)

All P2 logic is stub-tested on Linux; these confirm the real probes feed the new seams correctly.

- [ ] **Linux+NVIDIA (the dev 4070 box — can run immediately):** `cd sidecar && .venv/bin/python -c "from sokuji_sidecar import accel; m=accel.probe(); print(m.gpus, accel.has_nvidia(m), accel.device_free_bytes())"` → real device description containing "NVIDIA", `True`, positive free bytes; then `python -c "from sokuji_sidecar import llama_runtime as rt; print(rt.default_flavor())"` → `cuda`; then one real session load (`SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_accel.py -q -k real_gpu`) to confirm resolution + VRAM gating without NVML installed.
- [ ] **macOS Apple Silicon:** `default_flavor()` returns `metal`; `hardware_info` reports a non-empty `gpus[]` with `vendor == "apple"` from the tc probe; `_metal_config()` returns the right `mN` on a real brand string; a chip newer than M5 (when available) warns and installs the m5 binary successfully.
- [ ] **AMD or Intel dGPU box (Windows or Linux):** `hardware_info.gpus[]` non-empty with `vendor` `amd`/`intel` (this was the empty-array bug); `default_flavor()` returns `cpu` (vulkan flavor arrives in P4); ASR still resolves `gpu-vulkan` from `tc_kinds`.
- [ ] **NVIDIA on Windows:** tc probe description still matches "NVIDIA" (case-insensitive) so `default_flavor()` → `cuda` and the GitHub-release binary path installs.

## Post-plan notes (explicitly NOT tasks)

- Machine fingerprints change in Task 5 (the NVML component leaves `fp_src`), so existing `~/.cache/sokuji-sidecar/accel-bench.json` entries stop matching. That cache is best-effort by design — entries are re-measured lazily; no migration.
- `_cudnn_preload.py` and the `__main__.py` cuDNN comment mention "nvidia" only as the cuDNN wheel's directory name; they are D8 territory (P5), untouched here.
- The renderer already renders `hardware_info.gpus[]` entries generically (`vendor`/`name`/`vramMb` keys unchanged) and treats `list_variants.reason` as free-form; dropping the "needs compute capability X" reason string needs no renderer change.
- `select_variant`'s non-llamacpp GPU path currently has no live catalog rows (all LLM translate cards are llamacpp; Opus is cpu-only) — it is kept, total-budget-based, because P5's DML TTS variants will need exactly this generic path.
