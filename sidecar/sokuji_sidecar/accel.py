"""Hardware-acceleration resolver: probes the machine, decides the ordered list
of Plans for a model (best first, CPU floor last), and loads with fallback.
The single owner of "which backend on which device"."""
import dataclasses
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


def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


_PLATFORM_MAP = {"Linux": "linux", "Windows": "windows", "Darwin": "macos"}


def current_platform() -> str:
    """This host's platform tag ('linux' | 'windows' | 'macos'), mapped from
    platform.system(). The single source of truth for the catalog's per-deployment
    `platforms` filter (D9); monkeypatched in tests to exercise the filter without
    the host OS. An unmapped platform.system() falls through to its lowercased
    name — harmless: no deployment lists it, so such a host resolves nothing."""
    sysname = platform.system()
    return _PLATFORM_MAP.get(sysname, sysname.lower())


def _dml_adapters() -> tuple[str, ...]:
    import onnxruntime
    return ("dml",) if "DmlExecutionProvider" in onnxruntime.get_available_providers() else ()


def _tc_devices():
    """transcribe.cpp's device list — the vendor-agnostic ground truth (sees
    AMD/Intel/Apple where NVML can't). Raises when the wheel is absent
    (probe() degrades via _safe)."""
    import transcribe_cpp
    return list(transcribe_cpp.backends())


def _tc_kinds() -> tuple[str, ...]:
    """Accelerator kinds transcribe.cpp can actually use here. Sorted for a
    stable fingerprint; () when the wheel is absent (probe degrades)."""
    return tuple(sorted({b.kind for b in _tc_devices()}))


def _tc_gpus() -> tuple[tuple[str, str, int], ...]:
    """Stable identity of the non-cpu devices: (kind, name, mem_total)."""
    # Coerce description to str at the source (like memory_total): a None from
    # the native lib would otherwise crash every has_nvidia/_gpu_vendor consumer.
    return tuple((b.kind, b.description or "", int(b.memory_total or 0))
                 for b in _tc_devices() if getattr(b, "device_type", "gpu") != "cpu")


def has_nvidia(machine: Machine) -> bool:
    """NVIDIA presence, from the transcribe.cpp probe: any accelerator device
    whose description names NVIDIA (case-insensitive substring — the D7
    contract). Replaces the removed NVML enumeration; the tc probe is the
    single all-vendor device-truth source."""
    return any("nvidia" in name.lower() for _kind, name, _total in machine.gpus)


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


def ram_free_bytes():
    """FRESH available system RAM (bytes), or None when psutil is missing."""
    try:
        import psutil
        return int(psutil.virtual_memory().available)
    except Exception:
        return None


def _has_mod(mod: str) -> bool:
    """Return True iff `mod` is importable. Never raises — guards against
    ModuleNotFoundError from find_spec() when a parent package is absent."""
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _installed() -> frozenset:
    mods = {"transcribe_cpp": "transcribe_cpp",
            "transcribe_cpp_stream": "transcribe_cpp",
            "sherpa_tts": "sherpa_onnx",
            "moss_onnx": "onnxruntime",
            "supertonic": "onnxruntime",
            "qwen3tts_onnx": "onnxruntime",
            "mlx_audio_tts": ("mlx_audio",),
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm",
            # llamacpp_* backends run an external llama-server binary — a
            # downloadable artifact, not a Python runtime. Always "installed";
            # a missing binary fails at load() with a clear error instead of
            # being silently filtered out of the plans.
            "llamacpp_qwen": None,
            "llamacpp_hunyuan": None,
            "llamacpp_gemma": None,
            "ct2_opus_translate": ("ctranslate2", "sentencepiece")}

    def _ready(spec):
        if spec is None:
            return True
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
        # x86_64-only lane: onnxruntime-gpu ships no aarch64 wheels, and the
        # llama bucket's aarch64 cuda builds lack current-SM kernel images
        # (GB10/SM121 field-crashed with "no kernel image is available") —
        # without the arch gate an ARM NVIDIA box (DGX Spark, Jetson) leads
        # every resolve with a doomed cuda plan before falling back.
        return has_nvidia(machine) and machine.arch in ("x86_64", "AMD64")
    if tier == "gpu-metal":
        return machine.apple_silicon or "metal" in machine.tc_kinds
    if tier == "gpu-dml":
        return bool(machine.dml_adapters)
    if tier == "gpu-vulkan":
        # transcribe.cpp's own probe is authoritative (sees AMD/Intel Vulkan
        # devices); NVIDIA-by-description is the fallback. DML is deliberately
        # NOT a signal here: a DirectX12 adapter doesn't imply a usable Vulkan
        # runtime, llama.cpp has no DML flavor, and the vulkan binary is fetched
        # only when the tc probe reports "vulkan" — so lighting this tier off
        # dml_adapters alone made resolve_translate lead with a missing-binary
        # vulkan plan on DML-only boxes (P5). A genuinely Vulkan-capable box
        # already reports "vulkan" in tc_kinds. Arch-gated to hosts whose vulkan
        # binaries actually exist: x86_64 everywhere, plus Linux/aarch64 (the
        # transcribe-cpp aarch64 wheel bundles the ggml Vulkan backend and
        # llama.cpp ships ubuntu-vulkan-arm64 — the DGX Spark / Jetson lane).
        # Other arches (Windows-on-ARM) are never offered an unrunnable plan.
        return (("vulkan" in machine.tc_kinds or has_nvidia(machine))
                and (machine.arch in ("x86_64", "AMD64")
                     or (machine.os == "Linux" and machine.arch == "aarch64")))
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
    """Ordered Plans for `model` on `machine`: filter to runnable, rank by tier
    (GPU/NPU >> CPU), then a non-'auto' override pins its tier to the front, then
    the bench cache demotes a proven-slow GPU plan. CPU floor always survives."""
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)
              and _platform_ok(d, machine)]
    usable.sort(key=lambda d: (TIER_RANK.get(d.tier, 0.0), d.rank), reverse=True)
    if override != "auto":
        # The renderer's device control is auto/cpu/GPU and sends 'cuda' for
        # GPU — treat it as "any accelerator tier" so it also pins
        # vulkan/metal deployments (transcribe.cpp cards have no cuda rows).
        def _pinned(d):
            return TIER_DEVICE.get(d.tier) == override or (override == "cuda" and d.tier != "cpu")
        pinned = [d for d in usable if _pinned(d)]
        rest = [d for d in usable if not _pinned(d)]
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


_TC_RESIDENT_FACTOR = 1.15


def _quant_budget_bytes(machine: Machine):
    """The STABLE per-machine basis for quant selection: the primary device's
    TOTAL memory, from the transcribe.cpp probe (all vendors). Quant choice
    only decides WHICH FILE we recommend the user download — and we always run
    exactly the file the user downloaded — so the basis must never flap with
    transient VRAM pressure (that would recommend re-downloads). Runtime
    pressure is placement's job (--fit / cpu fallback), never a silent switch
    to a different model file."""
    # Largest-device basis: correct for the ~universal single-GPU case. On a rare
    # dual-DISCRETE-vendor box (AMD + NVIDIA) this can budget a gpu-cuda download
    # against the non-CUDA card's VRAM — accepted as a documented limitation
    # (per-tier/vendor budgeting is out of P2's NVML-removal scope).
    total = max((t for _k, _n, t in machine.gpus), default=0)
    return total or None


def _downloaded_quants(model) -> set:
    """compute_types of `model` whose artifact file is already in the local HF
    cache. LOAD-time quant selection restricts itself to these (an absent
    upgrade rung must never be chosen over a cached default — it would fail
    to load); an empty set means nothing is cached yet, so selection falls
    back to pure budget logic and the readiness gate drives the download."""
    from . import catalog as _cat
    from huggingface_hub import hf_hub_download
    out = set()
    seen = set()
    for d in model.deployments:
        if d.compute_type in seen:
            continue
        seen.add(d.compute_type)
        repo, fname = _cat.split_artifact(d.artifact)
        if not fname:
            continue
        try:
            hf_hub_download(repo, fname, local_files_only=True)
            out.add(d.compute_type)
        except Exception:
            pass
    return out


def _tc_pick_quant(model, machine: Machine, pin: str | None, budget: int | None,
                   downloaded: set | None = None) -> str:
    """Quant for a multi-quant transcribe.cpp card. pin wins; on a GPU-capable
    machine walk quality-descending (largest first) and take the first that
    fits FULLY resident within the budget, else the rank-default; without a
    GPU the smallest quant wins (CPU is bandwidth-bound: smaller = faster)."""
    from .catalog import _TC_CURATED_MIN_RANK
    sizes_all = {}   # EVERY listed rung — pin and the downloaded restriction see these
    sizes = {}       # curated rungs only — the auto-recommend walk
    default = None   # highest-ranked rung of ANY kind (a hypothetical card with
    best_rank = -1.0  # zero curated rungs falls back to its top listed-only one)
    for d in model.deployments:
        if d.est_bytes and (d.compute_type not in sizes_all or d.est_bytes > sizes_all[d.compute_type]):
            sizes_all[d.compute_type] = d.est_bytes
        if (d.rank >= _TC_CURATED_MIN_RANK and d.est_bytes
                and (d.compute_type not in sizes or d.est_bytes > sizes[d.compute_type])):
            sizes[d.compute_type] = d.est_bytes   # listed-only (f16/q5) never auto-recommended
        if d.rank > best_rank:
            best_rank, default = d.rank, d.compute_type
    if pin in sizes_all:
        return pin
    # LOAD-time reality: only cached quants are loadable — restrict when any
    # exist. A downloaded listed-only rung counts: we always RUN the file the
    # user downloaded; the curated filter only shapes fresh recommendations.
    if downloaded:
        cached = {q: sz for q, sz in sizes_all.items() if q in downloaded}
        if cached:
            sizes = cached
            if default not in sizes:
                default = max(sizes, key=lambda q: sizes[q])
    gpu_possible = any(_tier_available(d.tier, machine) and d.tier != "cpu"
                       for d in model.deployments)
    if not gpu_possible:
        return min(sizes, key=sizes.get) if sizes else default
    if budget is None or not sizes:
        return default
    for quant, size in sorted(sizes.items(), key=lambda kv: -kv[1]):
        if size * _TC_RESIDENT_FACTOR <= budget:
            return quant
    return default


def resolve(model_id: str, override: str = "auto", machine: Machine | None = None,
            pin: str | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    machine = machine or probe()
    # Multi-quant ladder (big transcribe.cpp cards): narrow to ONE quant before
    # the generic tier resolution, so plans stay one-per-tier.
    if len({d.compute_type for d in model.deployments}) > 1:
        # Quant = the DOWNLOAD recommendation (stable, total-memory basis),
        # restricted to what's actually cached — we always load the file the
        # user downloaded; recommendation and load thus always agree.
        quant = _tc_pick_quant(model, machine, pin, _quant_budget_bytes(machine),
                               downloaded=_downloaded_quants(model))
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
    return _resolve_model(model, model_id, override, machine)


def resolve_translate(model_id: str, override: str = "auto", machine: Machine | None = None,
                      reserved_bytes: int = 0, pin: str | None = None) -> list[Plan]:
    from . import catalog, llama_runtime
    model = catalog.translate_model(model_id)
    if model is None:
        raise ValueError(f"unknown translate model: {model_id}")
    machine = machine or probe()
    # Set regardless of override branch: the explicit device path (a
    # first-class 'translationDevice: cuda|cpu' UI control) loads a llamacpp
    # backend exactly like the auto path does, so it needs --fit-target sized
    # off the same reserved-VRAM figure — leaving this only in the auto branch
    # left the override path with a stale/zero reserved_bytes.
    llama_runtime.set_reserved_bytes(reserved_bytes)
    # The `auto` branch below builds Plans via select_variant + a hand-picked cpu
    # floor and never flows through resolve_deployments' choke point, so drop
    # off-platform deployments up front here (all current translate cards are
    # cross-platform → a no-op today). The override branch re-filters idempotently
    # via resolve_deployments.
    model = dataclasses.replace(
        model, deployments=tuple(d for d in model.deployments if _platform_ok(d, machine)))
    if override == "auto":
        # Same STABLE basis as the download recommendation (_h_list_variants):
        # we always run exactly the file the user downloaded, so choose it the
        # same way we recommended it. Runtime VRAM pressure is handled by
        # llama-server's --fit at placement, never by switching files.
        chosen = select_variant(model, machine, reserved_bytes, pin,
                                budget_bytes=_quant_budget_bytes(machine),
                                downloaded=_downloaded_quants(model))
        # Prefer a CPU floor at the SAME quant as the chosen GPU/Metal variant (a
        # coherent fallback the user actually picked/expects); fall back to any
        # CPU deployment when that exact quant has none.
        cpu = next((d for d in model.deployments
                    if d.tier == "cpu" and d.compute_type == chosen.compute_type), None) \
            if chosen is not None else None
        if cpu is None:
            cpu = next((d for d in model.deployments if d.tier == "cpu"), None)
        picks = [chosen] + ([cpu] if cpu is not None and cpu is not chosen else [])
        # Keep only deployments whose backend is actually installed on this machine.
        picks = [d for d in picks if d is not None and d.backend in machine.installed]
        if not picks:
            raise NoUsablePlan(model_id)
        plans = [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank)
                 for d in picks]
        # Bench correction (E6): when BOTH the GPU pick and its CPU floor have
        # measured decode throughput, and the GPU is not actually faster,
        # lead with CPU. tps is higher-is-better (unlike ASR's RTF).
        if len(plans) > 1 and plans[0].device != "cpu":
            cache = bench_load()
            def _tps(p):
                return cache.get("tps:" + _bench_key(
                    machine.fingerprint, model_id, p.backend, p.device, p.compute_type))
            gpu_tps, cpu_tps = _tps(plans[0]), _tps(plans[1])
            if gpu_tps is not None and cpu_tps is not None and gpu_tps <= cpu_tps:
                plans = [plans[1], plans[0]]
        return plans
    # Explicit device override: unchanged tier-pinning path, EXCEPT a quant
    # `pin` (llamacpp cards only) must still be honored — otherwise a pinned
    # q8_0 silently resolves through whatever quant _resolve_model's plain
    # tier-pin ranking picks by default (the highest-rank row across ALL
    # quants), ignoring the user's pin entirely. Filter the model down to just
    # the pinned (or rank-default, if the pin is invalid) quant's rows first,
    # then run the existing tier-pinned resolution over that narrowed model.
    if pin is not None and _is_llamacpp(model):
        quant = _llamacpp_quant(model, pin)
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
    return _resolve_model(model, model_id, override, machine)


# Sherpa-onnx TTS covers a large family of community repos (piper VITS, icefall
# VITS, matcha, kokoro) that the renderer exposes as per-voice cards keyed by
# their full HF repo path. SherpaTtsBackend downloads/loads any such repo, so we
# synthesize an ad-hoc model for repo ids that the short catalog doesn't list
# rather than forcing every voice into the catalog.
_SHERPA_TTS_HINTS = ("piper", "vits", "matcha", "kokoro", "icefall")


def resolve_tts(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.tts_model(model_id)
    if model is None:
        if any(h in model_id.lower() for h in _SHERPA_TTS_HINTS):
            model = catalog.TtsModel(
                id=model_id, name=model_id, languages=("multi",),
                deployments=(
                    catalog.Deployment("sherpa_tts", "cpu", "fp32", model_id, 1.0),
                ),
                repos=(model_id,), sample_rate=16000)
        else:
            raise ValueError(f"unknown tts model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())


# ── Cross-stage VRAM ledger ──────────────────────────────────────────────────
# The three session stages (asr/translate/tts) share one accelerator. Each
# engine claims its ACTUAL device footprint at load (0 when it landed on cpu)
# and releases on close; placement/reserve math for one stage then uses the
# real claims of loaded stages and falls back to estimates only for stages
# that have not loaded yet — fixing the "reserve the download size of a model
# that ended up on CPU anyway" over-reserve.
_LEDGER: dict = {}


def ledger_reset() -> None:
    _LEDGER.clear()


def ledger_claim(stage: str, nbytes: int) -> None:
    _LEDGER[stage] = max(0, int(nbytes or 0))


def ledger_release(stage: str) -> None:
    _LEDGER.pop(stage, None)


def ledger_other(stage: str) -> int:
    """Total device bytes held by every OTHER loaded stage."""
    return sum(v for k, v in _LEDGER.items() if k != stage)


def ledger_effective_reserve(stage: str, planned_est: dict) -> int:
    """Free-VRAM margin `stage` should leave for the OTHER stages (feeds
    llama's --fit-target, whose unit is "free MiB to keep"). A stage that
    already LOADED holds its memory NOW — it is already out of every free
    reading --fit takes, so re-reserving its claim double-counts (measured on
    the 4070: voxtral Q8's 6.2GB claim re-reserved pushed a 0.8B translate
    LLM fully off a GPU with 3.2GB free, then its CUDA remnants crashed
    llama-server). Loaded stages (any ledger entry, incl. 0 for cpu) reserve
    NOTHING; not-yet-loaded stages reserve their planned estimate."""
    total = 0
    for other, est in planned_est.items():
        if other == stage or other in _LEDGER:
            continue          # loaded: footprint already materialized in free
        total += int(est or 0)
    return total


class AllPlansFailed(Exception):
    """Every plan failed to load, including the CPU floor."""


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


def load_measured(plans: list, stage: str | None = None):
    """load_with_fallback + measure the loaded model's footprint on its RESOLVED
    device: device-free delta for any accelerator (vulkan/metal/cuda — read via
    the vendor-agnostic device_free_bytes), RSS delta for cpu. Best-effort —
    memory is None when unmeasurable or non-positive. When `stage` is given the
    result is recorded in the cross-stage ledger (actual bytes on an
    accelerator; an explicit 0 for a cpu landing, so reserve math knows the
    stage holds no device memory). Returns (backend, plan, notice, memory_bytes)."""
    vram_before = device_free_bytes()
    rss_before = _rss_bytes()
    backend, plan, notice = load_with_fallback(plans)
    memory = None
    if plan.device != "cpu" and vram_before is not None:
        vram_after = device_free_bytes()
        if vram_after is not None:
            delta = vram_before - vram_after
            memory = delta if delta > 0 else None
    elif plan.device == "cpu" and rss_before is not None:
        rss_after = _rss_bytes()
        if rss_after is not None:
            delta = rss_after - rss_before
            memory = delta if delta > 0 else None
    if stage is not None:
        if plan.device == "cpu":
            ledger_claim(stage, 0)
        else:
            est = _model_weight_bytes(plan.artifact)
            ledger_claim(stage, memory or est or 0)
    return backend, plan, notice, memory


# Weight files dominate a model's GPU footprint; the rest (config/tokenizer) is
# negligible. .gguf/.pt cover llama.cpp / raw-torch artifacts alongside HF safetensors.
_WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf", ".onnx")


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

# FP8 (compressed-tensors naive-quantized) has no FP8 matmul kernel in transformers,
# so weights are dequantized per-forward at inference — peak VRAM ~1.5x weights, not
# the 1.2x that applies to bf16/f16. Per-format override table; missing → _VRAM_WEIGHT_FACTOR.
_VARIANT_WEIGHT_FACTOR = {"fp8": 1.5}


def _weight_factor(compute_type: str) -> float:
    return _VARIANT_WEIGHT_FACTOR.get(compute_type, _VRAM_WEIGHT_FACTOR)


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
        # proactive gate and the honest OOM message reuse them. Capture free
        # BEFORE the load: a failed load can leave allocator caches/fragments
        # that make an after-the-fact reading meaningless.
        # llamacpp plans are exempt from the proactive gate: llama-server's --fit
        # handles memory itself via partial offload, so a rough weights-vs-free-VRAM
        # guess here would only wrongly route a fittable model to CPU.
        is_llamacpp = plan.backend.startswith("llamacpp_")
        free = device_free_bytes() if (plan.device == "cuda" and not is_llamacpp) else None
        need = _model_weight_bytes(plan.artifact) if (plan.device == "cuda" and not is_llamacpp) else None
        budget = (need * _weight_factor(plan.compute_type) + _VRAM_CONTEXT_BYTES) if need is not None else None
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


BENCH_TTS_TEXT = "The weather is lovely today, so I will go for a walk in the park."


def measure_rtf_tts(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: synth a fixed sentence, return RTF (gen_seconds / audio_seconds),
    cached under a 'tts:'-namespaced key. Never raises (returns None)."""
    try:
        key = "tts:" + _bench_key(machine.fingerprint, model_id, plan.backend,
                                  plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        samples, gen_ms = backend.generate(BENCH_TTS_TEXT, 1.0)
        audio_s = len(samples) / float(getattr(backend, "sample_rate", 24000))
        if audio_s <= 0:
            return None
        rtf = (gen_ms / 1000.0) / audio_s
        cache[key] = rtf
        bench_save(cache)
        return rtf
    except Exception:
        return None


# Higher = better quality. Future formats slot in (int4, nvfp4) without touching callers.
_VARIANT_QUALITY = {"bfloat16": 3.0, "float16": 3.0, "fp8": 2.0, "int4": 1.5, "nvfp4": 1.8}

# Extra runtime/library a compute_type needs beyond its backend NAME being installed.
_FORMAT_MODULE = {"fp8": "compressed_tensors"}


def _format_ready(compute_type: str) -> bool:
    """Return True when the runtime library required by `compute_type` is importable.
    Most compute types need nothing extra; fp8 requires compressed_tensors."""
    mod = _FORMAT_MODULE.get(compute_type)
    return True if mod is None else _has_mod(mod)


def _est_bytes(d) -> int | None:
    """Return the estimated VRAM footprint of deployment `d` in bytes.
    Uses d.est_bytes when set, otherwise falls back to native_models.model_size
    (reads the artifact's on-disk weight files). Returns None when unknown."""
    from . import native_models
    if d.est_bytes is not None:
        return d.est_bytes
    return native_models.model_size(d.artifact)


def _is_llamacpp(model) -> bool:
    return model.deployments[0].backend.startswith("llamacpp_")


def _llamacpp_quant(model, pin: str | None) -> str:
    """Which compute_type (quant) to use for a llamacpp model: `pin` when it
    names one of the model's available quants, else the rank-default quant
    (the compute_type of the highest-rank deployment row). Shared by
    _llamacpp_variant_row (the auto path's tier selection) and
    resolve_translate's explicit-override path (which must honor the same
    pin instead of silently dropping it)."""
    quants = {}
    for d in model.deployments:
        cur = quants.get(d.compute_type)
        if cur is None or d.rank > cur.rank:
            quants[d.compute_type] = d
    if pin in quants:
        return pin
    return max(quants.values(), key=lambda d: d.rank).compute_type


# A fully-resident model needs its weights plus KV/context headroom.
_LLAMA_RESIDENT_FACTOR = 1.1
# Below this fraction of the smallest quant's size, --fit partial offload is
# slower than running fully on CPU (most layers end up on CPU anyway, plus
# PCIe traffic) — go straight to the cpu tier.
_LLAMA_MIN_FIT_FRACTION = 0.5


def _llamacpp_variant_row(model, machine: Machine, pin: str | None,
                          reserved_bytes: int = 0, budget_bytes: int | None = None,
                          downloaded: set | None = None):
    """Pick (quant, tier) for a llamacpp card.

    pin → that quant unconditionally (user's will; --fit copes with memory).
    budget known → the LARGEST quant that fits FULLY resident
        (est_bytes × 1.1 ≤ budget − reserved): a fully-resident smaller quant
        beats a partially-offloaded bigger one. Nothing fits → keep the GPU
        tier with the rank-default quant via --fit only while the budget still
        covers ≥50% of the smallest quant; below that, fully-CPU is faster.
    budget unknown (no GPU memory reading) → the rank-default quant, best tier
        (previous behavior; --fit is the safety net).
    """
    def _row(quant, want_gpu=True):
        rows = [d for d in model.deployments if d.compute_type == quant]
        rows.sort(key=lambda d: TIER_RANK.get(d.tier, 0.0), reverse=want_gpu)
        for d in rows:
            if _tier_available(d.tier, machine) and (want_gpu or d.tier == "cpu"):
                return d
        return next((d for d in rows if d.tier == "cpu"), None)

    if pin is not None and _llamacpp_quant(model, pin) == pin:
        return _row(pin)

    default_quant = _llamacpp_quant(model, None)
    gpu_possible = any(_tier_available(d.tier, machine) and d.tier != "cpu"
                       for d in model.deployments)
    if budget_bytes is None or not gpu_possible:
        return _row(default_quant)

    budget = budget_bytes - reserved_bytes
    quants = {}
    for d in model.deployments:
        size = _est_bytes(d)
        if size and (d.compute_type not in quants or size > quants[d.compute_type]):
            quants[d.compute_type] = size
    if downloaded:
        cached = {q: sz for q, sz in quants.items() if q in downloaded}
        if cached:
            quants = cached
            if default_quant not in quants:
                default_quant = max(quants, key=lambda q: quants[q])
    if not quants:
        return _row(default_quant)
    # largest fully-resident quant wins
    for quant, size in sorted(quants.items(), key=lambda kv: -kv[1]):
        if size * _LLAMA_RESIDENT_FACTOR <= budget:
            return _row(quant)
    # Nothing fully fits. On UNIFIED memory (Apple Silicon) the CPU shares the
    # same pool — moving there frees nothing and loses Metal throughput, so
    # stay on the GPU tier and let --fit manage pressure. On discrete GPUs,
    # --fit at the default quant is only worth it while the budget still
    # covers a meaningful fraction; below that, fully-CPU beats heavy offload
    # over PCIe.
    if machine.apple_silicon:
        return _row(default_quant)
    smallest = min(quants.values())
    if budget >= smallest * _LLAMA_MIN_FIT_FRACTION:
        return _row(default_quant)
    return _row(default_quant, want_gpu=False)


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


async def _h_list_variants(state, msg, _b, conn=None):
    from . import catalog, native_models
    m = probe()
    model = catalog.translate_model(msg.get("model"))
    if model is None:
        return {"type": "error", "id": msg.get("id"), "message": "unknown model"}, None
    reserve = sum((native_models.model_size(msg.get(k)) or 0)
                  for k in ("asrId", "ttsId") if msg.get(k))
    # RECOMMENDATION basis must be STABLE across sessions (it drives which
    # quant the user downloads): device mem_total, not the volatile free.
    chosen = select_variant(model, m, reserve, pin=msg.get("pin"),
                            budget_bytes=_quant_budget_bytes(m))
    # select_variant can return None for a model with no cpu floor (none today, but
    # resolve_translate guards the same case) — never dereference chosen.compute_type then.
    if chosen is None:
        return {"type": "error", "id": msg.get("id"), "message": "no runnable variant"}, None
    if _is_llamacpp(model):
        # llamacpp quants are cross-tier (the same GGUF serves gpu-cuda/gpu-metal/cpu);
        # dedupe by compute_type instead of listing one row per (tier, compute_type)
        # pair, and skip the VRAM-based supported/reason math entirely (no VRAM math
        # for llamacpp — see select_variant/_llamacpp_variant_row).
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
    return {"type": "list_variants_result", "id": msg.get("id"),
            "variants": variants, "recommended": chosen.compute_type}, None


_GPU_VENDORS = ("nvidia", "amd", "intel", "apple")


def _gpu_vendor(description: str) -> str:
    """Vendor slug parsed from a tc-probe device description (best-effort)."""
    d = description.lower()
    for v in _GPU_VENDORS:
        if v in d:
            return v
    return "unknown"


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


async def _h_models_catalog(state, msg, _b, conn=None):
    from . import catalog
    m = probe()
    kind = msg.get("kind", "asr")
    if kind == "translate":
        source = catalog.translate_models()
    elif kind == "tts":
        source = catalog.tts_models()
    else:
        source = catalog.asr_models()
    wanted = msg.get("models")
    if wanted and not isinstance(wanted, list):
        wanted = [wanted]
    models = source
    if wanted:
        models = [x for x in models if x.id in wanted]
    out = []
    for mdl in models:
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
        repo = mdl.repos[0] if kind == "tts" else mdl.deployments[0].artifact
        entry = {"id": mdl.id, "name": mdl.name, "languages": list(mdl.languages),
                 "recommended": mdl.recommended, "tiers": tiers,
                 "order": mdl.sort_order, "repo": repo, "kind": kind,
                 "sizeBytes": mdl.size_bytes}
        if kind == "tts":
            entry["numSpeakers"] = mdl.num_speakers
            entry["clones"] = mdl.clones
            entry["streaming"] = mdl.streaming
            entry["voice"] = catalog.voice_capability(mdl)
        seen_cts = []
        sizes_by_ct = {}
        artifact_by_ct = {}
        for d in mdl.deployments:
            if d.compute_type not in seen_cts:
                seen_cts.append(d.compute_type)
                artifact_by_ct[d.compute_type] = d.artifact
            if d.est_bytes:
                sizes_by_ct[d.compute_type] = max(sizes_by_ct.get(d.compute_type, 0), d.est_bytes)
        if kind == "translate" or len(seen_cts) > 1:
            entry["variantIds"] = seen_cts
        if len(seen_cts) > 1 and sizes_by_ct:
            # Precomputed, machine-aware variant list: sorted quality-desc
            # (size is monotone with quality within one model), each rung
            # carrying supported (fits this machine at all) and recommended
            # (the stable default-download pick). Context-free by design —
            # cross-stage pressure is placement's job, and a recommendation
            # that flapped with the OTHER stages' selections would read as
            # noise. Renderer renders; it computes nothing.
            budget = _quant_budget_bytes(m)
            is_llama = _is_llamacpp(mdl)
            if is_llama:
                chosen = _llamacpp_variant_row(mdl, m, None, 0, budget)
                rec = chosen.compute_type if chosen is not None else None
            else:
                rec = _tc_pick_quant(mdl, m, None, budget)
            variants = []
            factor = _LLAMA_RESIDENT_FACTOR if is_llama else _TC_RESIDENT_FACTOR
            for ct, size in sorted(sizes_by_ct.items(), key=lambda kv: -kv[1]):
                need = int(size * factor)                  # fit-check figure, for UI reasons
                if is_llama:
                    supported = True                       # --fit always runs
                elif budget is None:
                    supported = True                       # no GPU → CPU runs anything
                else:
                    supported = need <= budget
                variants.append({"id": ct, "sizeBytes": size, "needBytes": need,
                                 "repo": artifact_by_ct.get(ct),
                                 "supported": supported, "recommended": ct == rec})
            entry["variants"] = variants
            # Machine context for the renderer's localized reason strings
            # ("needs ~X — this machine has Y"); null on cpu-only machines.
            entry["deviceMemBytes"] = budget
        out.append(entry)
    return {"type": "models_catalog_result", "id": msg.get("id"), "models": out}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"hardware_info": _h_hardware_info, "models_catalog": _h_models_catalog,
         "list_variants": _h_list_variants})
