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
    capability: tuple[int, int] | None = None


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


def _cuda_count() -> int:
    from ctranslate2 import get_cuda_device_count
    return get_cuda_device_count()


def _nvidia_gpus() -> tuple[Gpu, ...]:
    n = _cuda_count()
    gpus = []
    for i in range(n):
        vram_mb, cap = 0, None
        try:
            import torch
            vram_mb = int(torch.cuda.get_device_properties(i).total_memory // (1024 * 1024))
            cap = tuple(torch.cuda.get_device_capability(i))  # (major, minor)
        except Exception:
            pass
        gpus.append(Gpu("nvidia", "", vram_mb, cap))
    return tuple(gpus)


def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


def _dml_adapters() -> tuple[str, ...]:
    import onnxruntime
    return ("dml",) if "DmlExecutionProvider" in onnxruntime.get_available_providers() else ()


def _has_mod(mod: str) -> bool:
    """Return True iff `mod` is importable. Never raises — guards against
    ModuleNotFoundError from find_spec() when a parent package is absent."""
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "funasr_sensevoice": "funasr",
            "funasr_nano": "funasr",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm",
            "transformers": "transformers",
            # qwen3asr needs the native qwen3_asr model (transformers 5.13.x+); until
            # then it is "not installed" so resolve()/models_catalog exclude it.
            "qwen3asr": "transformers.models.qwen3_asr",
            # cohere_transformers needs the native cohere_asr model (mainline since
            # transformers 5.4); present in our 5.13 venv. Same self-gate as qwen3asr.
            "cohere_transformers": "transformers.models.cohere_asr",
            # voxtral_realtime needs BOTH the native voxtral_realtime model (transformers >=5.2;
            # present in our 5.13 fork) AND mistral_common (its processor/tokenizer) — gate on
            # both so a half-installed env doesn't advertise it in the catalog then fail at load().
            "voxtral_realtime": ("transformers.models.voxtral_realtime", "mistral_common"),
            # translation: 2.5/3 are CausalLM (always present with transformers); 3.5 is the
            # qwen3_5 VLM class (self-gates off until transformers ships it), used text-only.
            "qwen_translate": "transformers",
            "qwen35_translate": "transformers.models.qwen3_5",
            # TranslateGemma uses the Gemma-3 multimodal class (text-only here); HY-MT2 is the
            # native hunyuan_v1_dense CausalLM. Both ship in transformers 5.13; self-gate off on
            # an older transformers that lacks the module.
            "gemma_translate": "transformers.models.gemma3",
            "hunyuan_translate": "transformers.models.hunyuan_v1_dense"}

    def _ready(spec):
        return all(_has_mod(m) for m in ((spec,) if isinstance(spec, str) else spec))
    return frozenset(b for b, spec in mods.items() if _ready(spec))


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
    # Cache-based demotion is an AUTO-mode refinement; an explicit override is the
    # user's will and is never second-guessed by the benchmark.
    if bench and override == "auto":
        plans = _apply_bench(plans, bench)
    return plans


def _resolve_model(model, model_id: str, override: str, machine: Machine) -> list[Plan]:
    cache = bench_load()
    bench = {}
    for d in model.deployments:
        device = TIER_DEVICE[d.tier]
        key = _bench_key(machine.fingerprint, model_id, d.backend, device, d.compute_type)
        if key in cache:
            bench[(d.backend, device, d.compute_type)] = cache[key]
    plans = resolve_deployments(model, machine, override, bench=bench or None)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans


def resolve(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())


def resolve_translate(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.translate_model(model_id)
    if model is None:
        raise ValueError(f"unknown translate model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())


class AllPlansFailed(Exception):
    """Every plan failed to load, including the CPU floor."""


def _cuda_free_bytes():
    """Free VRAM (bytes) on the default CUDA device, or None when torch/CUDA is
    absent. Best-effort: any failure degrades to None so callers skip gating."""
    try:
        import torch
        if not torch.cuda.is_available():
            return None
        return int(torch.cuda.mem_get_info()[0])
    except Exception:
        return None


def _rss_bytes():
    """Best-effort resident set size of this process, in bytes. Linux reads
    /proc/self/status (VmRSS, KiB); other platforms fall back to
    resource.getrusage (ru_maxrss: KiB on Linux, bytes on macOS). None on
    failure, so the memory readout degrades to 'unknown' rather than guessing."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass
    try:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return rss if platform.system() == "Darwin" else rss * 1024
    except Exception:
        return None


def load_measured(plans: list):
    """load_with_fallback + measure the loaded model's footprint on its RESOLVED
    device: reserved-VRAM delta for cuda, RSS delta for cpu. Best-effort — memory
    is None when unmeasurable or non-positive (e.g. no CUDA, allocator noise, a
    failed-then-freed GPU attempt during a degrade). Returns
    (backend, plan, notice, memory_bytes)."""
    vram_before = _cuda_free_bytes()
    rss_before = _rss_bytes()
    backend, plan, notice = load_with_fallback(plans)
    memory = None
    if plan.device == "cuda" and vram_before is not None:
        vram_after = _cuda_free_bytes()
        if vram_after is not None:
            delta = vram_before - vram_after
            memory = delta if delta > 0 else None
    elif plan.device == "cpu" and rss_before is not None:
        rss_after = _rss_bytes()
        if rss_after is not None:
            delta = rss_after - rss_before
            memory = delta if delta > 0 else None
    return backend, plan, notice, memory


# Weight files dominate a model's GPU footprint; the rest (config/tokenizer) is
# negligible. .gguf/.pt cover llama.cpp / raw-torch artifacts alongside HF safetensors.
_WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf")


def _model_weight_bytes(artifact: str):
    """Best-effort on-disk size of a model's weight files, read from the local
    HF cache (the model is already downloaded by the time we load it). Returns
    None when it can't be determined — a local dir without weight files, an
    artifact not present in the cache, or no huggingface_hub — so the VRAM gate
    stays inert rather than guessing."""
    try:
        path = artifact if os.path.isdir(artifact) else None
        if path is None:
            from huggingface_hub import snapshot_download
            path = snapshot_download(artifact, local_files_only=True)
        total = 0
        for root, _dirs, files in os.walk(path):
            for fn in files:
                if fn.endswith(_WEIGHT_EXTS):
                    total += os.path.getsize(os.path.realpath(os.path.join(root, fn)))
        return total or None
    except Exception:
        return None


# Free VRAM must clear weights x this factor (transient activation/workspace) plus
# a fixed slab for the CUDA context before we commit a GPU load proactively.
_VRAM_WEIGHT_FACTOR = 1.2
_VRAM_CONTEXT_BYTES = 1 << 30  # ~1 GiB


def _gib(n: float) -> str:
    return f"{n / (1 << 30):.1f}"


def load_with_fallback(plans: list):
    """Try plans in order; return (backend, plan, notice). `notice` is set when a
    higher-ranked plan was skipped. Raises AllPlansFailed if none load.

    Two VRAM-aware safeguards layer on top of plain try/next:
      • Proactive gate — before a CUDA plan that still has a CPU plan after it,
        skip the GPU attempt when free VRAM clearly can't hold the weights. A
        flexible model (e.g. translation) thus routes to CPU without provoking an
        OOM when a larger GPU-only model (e.g. Voxtral) already claimed the card.
      • Honest exhaustion — if every plan failed on a CUDA OOM and there was no
        CPU floor (a GPU-only model that lost the VRAM race), raise a message that
        names the shortfall instead of the misleading 'falling back'."""
    notice = None
    oom = False
    oom_need = oom_free = None  # weights estimate + free VRAM seen just before an OOM
    for i, plan in enumerate(plans):
        has_cpu_fallback = any(p.device == "cpu" for p in plans[i + 1:])
        # Read free VRAM and weights estimate ONCE per cuda plan; both the
        # proactive gate and the honest OOM message reuse them. Capturing free
        # BEFORE the load matters: torch's allocator reports ~0 free after an OOM.
        free = _cuda_free_bytes() if plan.device == "cuda" else None
        need = _model_weight_bytes(plan.artifact) if plan.device == "cuda" else None
        budget = (need * _VRAM_WEIGHT_FACTOR + _VRAM_CONTEXT_BYTES) if need is not None else None
        if plan.device == "cuda" and has_cpu_fallback and free is not None and budget is not None:
            if free < budget:
                notice = (f"cuda skipped (needs ~{_gib(budget)} GiB, "
                          f"{_gib(free)} GiB free); using CPU")
                continue
        try:
            backend = make_backend(plan.backend)
            backend.load(plan.artifact, plan.device, plan.compute_type)
            return backend, plan, notice
        except BackendLoadError as e:
            notice = f"{plan.device} unavailable ({e.reason}); falling back"
            if "out of memory" in e.reason.lower():
                oom, oom_need, oom_free = True, budget, free
            continue
    if oom:
        if oom_need is not None and oom_free is not None:
            short = f" It needs ~{_gib(oom_need)} GiB but only {_gib(oom_free)} GiB is free."
        elif oom_free is not None:
            short = f" Only {_gib(oom_free)} GiB GPU memory is free."
        else:
            short = ""
        raise AllPlansFailed(
            f"Not enough GPU memory to load this model.{short} Another model is using "
            f"the GPU — switch a stage (ASR or translation) to CPU, or pick a smaller model.")
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


# A fixed sentence for the translation throughput benchmark — long enough that decode
# dominates the first-token/prompt overhead, short enough to keep init snappy.
BENCH_TRANSLATE_TEXT = "The weather is lovely today, so I think I will go for a long walk in the park this afternoon."
BENCH_TRANSLATE_SRC = "English"
BENCH_TRANSLATE_TGT = "French"


def measure_tps(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: after one warmup pass, run a fixed sentence through
    backend.translate and return decode throughput (generated tokens / elapsed
    seconds). Cached by the same key shape as measure_rtf, namespaced with a
    'tps:' prefix so it never collides with the RTF entries. One-time per key
    unless force. Never raises (returns None).

    The warmup matters: the first generation pays one-time CUDA kernel/graph
    compilation, so timing it would badly understate steady-state throughput."""
    try:
        key = "tps:" + _bench_key(machine.fingerprint, model_id, plan.backend, plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        backend.translate(BENCH_TRANSLATE_TEXT, "", BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, False)  # warmup
        t0 = time.time()
        _text, n_new = backend.translate(BENCH_TRANSLATE_TEXT, "", BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, False)
        dt = time.time() - t0
        if dt <= 0 or n_new <= 0:
            return None
        tps = n_new / dt
        cache[key] = tps
        bench_save(cache)
        return tps
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
    kind = msg.get("kind", "asr")
    source = catalog.translate_models() if kind == "translate" else catalog.asr_models()
    wanted = msg.get("models")
    if wanted and not isinstance(wanted, list):
        wanted = [wanted]
    models = source
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
