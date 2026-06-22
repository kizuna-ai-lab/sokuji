"""Hardware-acceleration resolver: probes the machine, decides the ordered list
of Plans for a model (best first, CPU floor last), and loads with fallback.
The single owner of "which backend on which device"."""
import hashlib
import importlib.util
import json
import os
import platform
import time
from dataclasses import dataclass

import numpy as np

from .backends import make_backend, BackendLoadError


@dataclass(frozen=True)
class Gpu:
    vendor: str
    name: str
    vram_mb: int


@dataclass(frozen=True)
class Machine:
    os: str
    arch: str
    cpu_cores: int
    nvidia: tuple[Gpu, ...]
    apple_silicon: bool
    dml_adapters: tuple[str, ...]
    installed: frozenset
    fingerprint: str


def _nvidia_gpus() -> tuple[Gpu, ...]:
    from ctranslate2 import get_cuda_device_count
    n = get_cuda_device_count()
    return tuple(Gpu("nvidia", "", 0) for _ in range(n))


def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


def _dml_adapters() -> tuple[str, ...]:
    import onnxruntime
    return ("dml",) if "DmlExecutionProvider" in onnxruntime.get_available_providers() else ()


def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm"}
    return frozenset(b for b, mod in mods.items() if importlib.util.find_spec(mod) is not None)


def _safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


_MACHINE: Machine | None = None


def probe(force: bool = False) -> Machine:
    """Detect hardware once and cache. Any detector that throws degrades to
    'absent' so the CPU floor is always reachable."""
    global _MACHINE
    if _MACHINE is not None and not force:
        return _MACHINE
    nvidia = _safe(_nvidia_gpus, ())
    apple = _safe(_apple_silicon, False)
    dml = _safe(_dml_adapters, ())
    installed = _safe(_installed, frozenset())
    fp_src = (f"{platform.system()}|{platform.machine()}|{int(apple)}|"
              f"{','.join(sorted(dml))}|{','.join(sorted(installed))}|"
              f"{len(nvidia)}:{','.join(g.name for g in nvidia)}")
    fp = hashlib.sha1(fp_src.encode()).hexdigest()[:12]
    _MACHINE = Machine(
        os=platform.system(), arch=platform.machine(), cpu_cores=os.cpu_count() or 1,
        nvidia=nvidia, apple_silicon=apple, dml_adapters=dml, installed=installed,
        fingerprint=fp)
    return _MACHINE


TIER_RANK = {"gpu-cuda": 3.0, "gpu-metal": 3.0, "gpu-vulkan": 2.5, "gpu-dml": 2.5, "cpu": 1.0}
TIER_DEVICE = {"cpu": "cpu", "gpu-cuda": "cuda", "gpu-metal": "metal",
               "gpu-vulkan": "vulkan", "gpu-dml": "dml"}


class NoUsablePlan(Exception):
    """A known model has no deployment runnable on this machine (e.g. a GPU-only
    model on a CPU-only box)."""


@dataclass(frozen=True)
class Plan:
    backend: str
    tier: str
    device: str
    compute_type: str
    artifact: str
    rank: float


def _tier_available(tier: str, machine: Machine) -> bool:
    if tier == "cpu":
        return True
    if tier == "gpu-cuda":
        return bool(machine.nvidia)
    if tier == "gpu-metal":
        return machine.apple_silicon
    if tier == "gpu-dml":
        return bool(machine.dml_adapters)
    if tier == "gpu-vulkan":
        return bool(machine.nvidia or machine.dml_adapters)
    return False


def resolve_deployments(model, machine: Machine, override: str = "auto", bench: dict | None = None) -> list[Plan]:
    """Ordered Plans for `model` on `machine`: filter to runnable, rank by tier
    (GPU/NPU >> CPU), then a non-'auto' override pins its tier to the front, then
    the bench cache demotes a proven-slow GPU plan. CPU floor always survives."""
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)]
    usable.sort(key=lambda d: (TIER_RANK.get(d.tier, 0.0), d.rank), reverse=True)
    if override != "auto":
        pinned = [d for d in usable if TIER_DEVICE.get(d.tier) == override]
        rest = [d for d in usable if TIER_DEVICE.get(d.tier) != override]
        usable = pinned + rest
    plans = [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank)
             for d in usable]
    return _apply_bench(plans, bench) if bench else plans


def resolve(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    m = machine or probe()
    fp = probe().fingerprint
    cache = bench_load()
    bench = {}
    for d in model.deployments:
        device = TIER_DEVICE[d.tier]
        key = _bench_key(fp, model_id, d.backend, device, d.compute_type)
        if key in cache:
            bench[(d.backend, device, d.compute_type)] = cache[key]
    plans = resolve_deployments(model, m, override, bench=bench or None)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans


class AllPlansFailed(Exception):
    """Every plan failed to load, including the CPU floor."""


def load_with_fallback(plans: list):
    """Try plans in order; return (backend, plan, notice). `notice` is set when a
    higher-ranked plan was skipped. Raises AllPlansFailed if none load."""
    notice = None
    for plan in plans:
        try:
            backend = make_backend(plan.backend)
            backend.load(plan.artifact, plan.device, plan.compute_type)
            return backend, plan, notice
        except BackendLoadError as e:
            notice = f"{plan.device} unavailable ({e.reason}); falling back"
            continue
    raise AllPlansFailed(notice or "no plans to load")


def _bench_cache_path() -> str:
    base = os.environ.get("SOKUJI_BENCH_DIR", os.path.expanduser("~/.cache/sokuji-sidecar"))
    return os.path.join(base, "accel-bench.json")


def bench_load() -> dict:
    """Best-effort read of the RTF cache. Missing/corrupt file → {}."""
    try:
        with open(_bench_cache_path()) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def bench_save(cache: dict) -> None:
    """Best-effort write of the RTF cache. Never raises."""
    try:
        path = _bench_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass


def _bench_key(fingerprint: str, model_id: str, backend: str, device: str, compute_type: str) -> str:
    return f"{fingerprint}|{model_id}|{backend}|{device}|{compute_type}"


BENCH_SECONDS = 3.0


def measure_rtf(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: run a fixed synthetic clip through backend.transcribe, return
    RTF (elapsed / audio_seconds), cache by (fingerprint, model, backend, device,
    compute_type). One-time per key unless force. Never raises (returns None)."""
    try:
        key = _bench_key(machine.fingerprint, model_id, plan.backend, plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        sr = 16000
        n = int(BENCH_SECONDS * sr)
        t = np.arange(n, dtype=np.float32) / sr
        clip = (0.05 * np.sin(2.0 * np.pi * 220.0 * t)).astype(np.float32)
        t0 = time.time()
        backend.transcribe(clip, None)
        rtf = (time.time() - t0) / BENCH_SECONDS
        cache[key] = rtf
        bench_save(cache)
        return rtf
    except Exception:
        return None


def _apply_bench(plans: list, bench: dict) -> list:
    """Demote any non-cpu plan whose cached RTF is >= the cpu floor's cached RTF
    (proven not faster than CPU). `bench` maps (backend, device, compute_type) -> rtf."""
    if not bench:
        return plans
    cpu = next((p for p in plans if p.tier == "cpu"), None)
    cpu_rtf = bench.get((cpu.backend, cpu.device, cpu.compute_type)) if cpu else None
    if cpu_rtf is None:
        return plans
    fast, slow = [], []
    for p in plans:
        rtf = bench.get((p.backend, p.device, p.compute_type))
        (slow if (p.tier != "cpu" and rtf is not None and rtf >= cpu_rtf) else fast).append(p)
    return fast + slow


async def _h_hardware_info(state, msg, _b, conn=None):
    m = probe()
    return {"type": "hardware_info_result", "id": msg.get("id"),
            "os": m.os, "arch": m.arch, "cpuCores": m.cpu_cores,
            "gpus": [{"vendor": g.vendor, "name": g.name, "vramMb": g.vram_mb} for g in m.nvidia],
            "backendsInstalled": sorted(m.installed),
            "accelAvailable": bool(m.nvidia or m.apple_silicon or m.dml_adapters)}, None


async def _h_models_catalog(state, msg, _b, conn=None):
    from . import catalog
    m = probe()
    wanted = msg.get("models")
    if wanted and not isinstance(wanted, list):
        wanted = [wanted]
    models = catalog.asr_models()
    if wanted:
        models = [x for x in models if x.id in wanted]
    out = []
    for mdl in models:
        tiers = [{"tier": d.tier, "backend": d.backend,
                  "available": d.backend in m.installed and _tier_available(d.tier, m)}
                 for d in mdl.deployments]
        out.append({"id": mdl.id, "name": mdl.name, "languages": list(mdl.languages),
                    "recommended": mdl.recommended, "tiers": tiers})
    return {"type": "models_catalog_result", "id": msg.get("id"), "models": out}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"hardware_info": _h_hardware_info, "models_catalog": _h_models_catalog})
