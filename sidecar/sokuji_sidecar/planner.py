"""Deployment planner: given a Machine and a catalog model, decide the ordered
list of Plans (best first, CPU floor last) — tier gating, quant/variant
picking, platform filtering. No hardware probing, no downloads, no model
loading, and NO runtime import of accel.py at all: every environment/I-O fact
this module needs — the current OS platform tag, the RTF/tps bench cache,
which quants are already downloaded locally, how to estimate a deployment's
VRAM footprint, and whether a compute-type's runtime is importable — arrives
as a plain parameter or an injected callable, supplied by whichever caller
already did that I/O. That makes every function here table-testable with
plain values; no monkeypatching required.

accel.py (the Loader) owns hardware probing, downloads, and model loading. It
imports this module at its own module scope and re-exposes `resolve`,
`resolve_translate`, `resolve_tts`, `select_variant`, `_llamacpp_variant_row`,
and `resolve_deployments` as thin Loader-wrapper functions of the same name
and public call signature the frozen characterisation suite and the engines
already depend on: each wrapper fetches its own I/O — calling
`current_platform()`/`bench_load()`/`probe()`/`_downloaded_quants()`/
`_est_bytes()`/`_format_ready()` as bare module-global names in accel.py, so
tests that do `monkeypatch.setattr(accel, "<name>", ...)` keep observing
them — and hands the results to the pure function here as parameters.
Dependency direction is strictly one-way: accel imports planner, planner
never imports accel."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import TYPE_CHECKING

from . import catalog

if TYPE_CHECKING:
    from .accel import Machine


@dataclass(frozen=True)
class Plan:
    backend: str
    tier: str
    device: str
    compute_type: str
    artifact: str
    rank: float


class NoUsablePlan(Exception):
    """A known model has no deployment runnable on this machine (e.g. a GPU-only
    model on a CPU-only box)."""


def has_nvidia(machine: Machine) -> bool:
    """NVIDIA presence, from the transcribe.cpp probe: any accelerator device
    whose description names NVIDIA (case-insensitive substring — the D7
    contract). Replaces the removed NVML enumeration; the tc probe is the
    single all-vendor device-truth source."""
    return any("nvidia" in name.lower() for _kind, name, _total in machine.gpus)


TIER_RANK = {"gpu-cuda": 3.0, "gpu-metal": 3.0, "gpu-vulkan": 2.5, "gpu-dml": 2.5, "cpu": 1.0}
TIER_DEVICE = {"cpu": "cpu", "gpu-cuda": "cuda", "gpu-metal": "metal",
               "gpu-vulkan": "vulkan", "gpu-dml": "dml"}


def _tier_available(tier: str, machine: Machine, backend: str | None = None) -> bool:
    if tier == "cpu":
        return True
    if tier == "gpu-cuda":
        if not has_nvidia(machine):
            return False
        # x86_64: the nvidia bundle ships onnxruntime-gpu and the llama
        # bucket's cuda builds work — device presence is the whole gate.
        if machine.arch in ("x86_64", "AMD64"):
            return True
        # Linux/aarch64 (DGX Spark, Jetson) splits by backend family:
        #   llamacpp_* -> allowed. Its cuda lane is the llama bucket binary,
        #     and the b9940+ buckets ship sm_121 builds with a correct probe
        #     (llama-install.sh #60; the pre-fix bucket handed GB10 an
        #     sm_120-only binary that crashed with "no kernel image").
        #   ORT backends -> need the CUDA EP in the RUNNING onnxruntime:
        #     PyPI has no aarch64 onnxruntime-gpu, so this means NVIDIA's
        #     hand-installed sbsa wheel. Field-tested on a GB10: Qwen3-TTS
        #     0.6B runs 0.38x realtime on CPU (unusable) vs 1.15x on CUDA.
        #   `backend is None` (capability summaries without a deployment in
        #     hand) stays conservative.
        if machine.os == "Linux" and machine.arch == "aarch64":
            if backend is None:
                return False
            if backend.startswith("llamacpp"):
                return True
            return machine.ort_cuda
        return False
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


def _platform_ok(d, machine: Machine, platform: str) -> bool:
    """Whether deployment `d` is runnable on THIS host's OS (D9). A row is dropped
    when this platform is not in its `platforms` set, or when it demands Apple
    Silicon and the machine lacks it. Every shipped card defaults to all three
    OSes + no AS requirement, so this is a no-op until platform-specific tiers
    (windows-only gpu-dml, macOS/AS-only mlx) land in P5/P6. `platform` is the
    caller's current-OS tag (accel.current_platform() on the real host) —
    injected so this function stays a pure lookup."""
    if platform not in d.platforms:
        return False
    if d.requires_apple_silicon and not machine.apple_silicon:
        return False
    return True


def resolve_deployments(model, machine: Machine, override: str = "auto",
                        bench: dict | None = None, *, platform: str) -> list[Plan]:
    """Ordered Plans for `model` on `machine`: filter to runnable, rank by tier
    (GPU/NPU >> CPU), then a non-'auto' override pins its tier to the front, then
    the bench cache demotes a proven-slow GPU plan. CPU floor always survives."""
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine, d.backend)
              and _platform_ok(d, machine, platform)]
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


def _bench_key(fingerprint: str, model_id: str, backend: str, device: str, compute_type: str) -> str:
    return f"{fingerprint}|{model_id}|{backend}|{device}|{compute_type}"


def _resolve_model(model, model_id: str, override: str, machine: Machine, *,
                   cache: dict, platform: str) -> list[Plan]:
    bench = {}
    for d in model.deployments:
        device = TIER_DEVICE[d.tier]
        key = _bench_key(machine.fingerprint, model_id, d.backend, device, d.compute_type)
        if key in cache:
            bench[(d.backend, device, d.compute_type)] = cache[key]
    plans = resolve_deployments(model, machine, override, bench=bench or None, platform=platform)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans


def _fit_walk(sized: dict[str, int], *, budget: int, downloaded: set | None) -> str | None:
    """The size-descending fit-walk nucleus shared by _tc_pick_quant and
    _llamacpp_variant_row: `sized` maps compute_type -> a size that already
    has the caller's own resident factor baked in (so this function only ever
    compares `size <= budget`). When `downloaded` is non-empty, restrict to
    the entries whose key is in it -- but ONLY when that restriction leaves at
    least one candidate; an empty overlap falls back to the full `sized` map,
    matching each caller's own "only narrow when a cached rung actually
    exists" rule. Walk the (possibly-restricted) candidates size-descending
    and return the key of the largest one that fits within `budget`. Returns
    None when nothing fits (including an empty `sized`) -- the caller applies
    its own fallback (tc: smallest quant / rank-default; llama: Apple-Silicon
    stay-on-GPU / _LLAMA_MIN_FIT_FRACTION tail)."""
    if downloaded:
        restricted = {q: sz for q, sz in sized.items() if q in downloaded}
        if restricted:
            sized = restricted
    for quant, size in sorted(sized.items(), key=lambda kv: -kv[1]):
        if size <= budget:
            return quant
    return None


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
    gpu_possible = any(_tier_available(d.tier, machine, d.backend) and d.tier != "cpu"
                       for d in model.deployments)
    if not gpu_possible:
        return min(sizes, key=sizes.get) if sizes else default
    if budget is None or not sizes:
        return default
    # `sizes` is already the final (downloaded-restricted, if applicable)
    # candidate set, so no further downloaded restriction is needed here.
    picked = _fit_walk({q: sz * _TC_RESIDENT_FACTOR for q, sz in sizes.items()},
                       budget=budget, downloaded=None)
    return picked if picked is not None else default


def resolve(model_id: str, override: str = "auto", *, machine: Machine, platform: str,
           cache: dict, downloaded: set, pin: str | None = None) -> list[Plan]:
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    # Multi-quant ladder (big transcribe.cpp cards): narrow to ONE quant before
    # the generic tier resolution, so plans stay one-per-tier.
    if len({d.compute_type for d in model.deployments}) > 1:
        # Quant = the DOWNLOAD recommendation (stable, total-memory basis),
        # restricted to what's actually cached — we always load the file the
        # user downloaded; recommendation and load thus always agree.
        quant = _tc_pick_quant(model, machine, pin, _quant_budget_bytes(machine),
                               downloaded=downloaded)
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
    return _resolve_model(model, model_id, override, machine, cache=cache, platform=platform)


def resolve_translate(model_id: str, override: str = "auto", *, machine: Machine, platform: str,
                      cache: dict, downloaded: set, reserved_bytes: int = 0,
                      pin: str | None = None, est_bytes, format_ready) -> list[Plan]:
    model = catalog.translate_model(model_id)
    if model is None:
        raise ValueError(f"unknown translate model: {model_id}")
    # The `auto` branch below builds Plans via select_variant + a hand-picked cpu
    # floor and never flows through resolve_deployments' choke point, so drop
    # off-platform deployments up front here (all current translate cards are
    # cross-platform → a no-op today). The override branch re-filters idempotently
    # via resolve_deployments.
    model = dataclasses.replace(
        model, deployments=tuple(d for d in model.deployments if _platform_ok(d, machine, platform)))
    if override == "auto":
        # Same STABLE basis as the download recommendation (_h_list_variants):
        # we always run exactly the file the user downloaded, so choose it the
        # same way we recommended it. Runtime VRAM pressure is handled by
        # llama-server's --fit at placement, never by switching files.
        chosen = select_variant(model, machine, reserved_bytes, pin,
                                budget_bytes=_quant_budget_bytes(machine),
                                downloaded=downloaded, est_bytes=est_bytes,
                                format_ready=format_ready)
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
    return _resolve_model(model, model_id, override, machine, cache=cache, platform=platform)


# Sherpa-onnx TTS covers a large family of community repos (piper VITS, icefall
# VITS, matcha, kokoro) that the renderer exposes as per-voice cards keyed by
# their full HF repo path. SherpaTtsBackend downloads/loads any such repo, so we
# synthesize an ad-hoc model for repo ids that the short catalog doesn't list
# rather than forcing every voice into the catalog.
_SHERPA_TTS_HINTS = ("piper", "vits", "matcha", "kokoro", "icefall")


def resolve_tts(model_id: str, override: str = "auto", *, machine: Machine, platform: str,
                cache: dict) -> list[Plan]:
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
    return _resolve_model(model, model_id, override, machine, cache=cache, platform=platform)


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


# Higher = better quality. Future formats slot in (int4, nvfp4) without touching callers.
_VARIANT_QUALITY = {"bfloat16": 3.0, "float16": 3.0, "fp8": 2.0, "int4": 1.5, "nvfp4": 1.8}


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
                          downloaded: set | None = None, *, est_bytes):
    """Pick (quant, tier) for a llamacpp card.

    pin → that quant unconditionally (user's will; --fit copes with memory).
    budget known → the LARGEST quant that fits FULLY resident
        (est_bytes × 1.1 ≤ budget − reserved): a fully-resident smaller quant
        beats a partially-offloaded bigger one. Nothing fits → keep the GPU
        tier with the rank-default quant via --fit only while the budget still
        covers ≥50% of the smallest quant; below that, fully-CPU is faster.
    budget unknown (no GPU memory reading) → the rank-default quant, best tier
        (previous behavior; --fit is the safety net).

    `est_bytes` is an injected callable (Deployment -> int | None): the
    caller's estimate of a deployment's on-disk/VRAM weight size.
    """

    def _row(quant, want_gpu=True):
        rows = [d for d in model.deployments if d.compute_type == quant]
        rows.sort(key=lambda d: TIER_RANK.get(d.tier, 0.0), reverse=want_gpu)
        for d in rows:
            if _tier_available(d.tier, machine, d.backend) and (want_gpu or d.tier == "cpu"):
                return d
        return next((d for d in rows if d.tier == "cpu"), None)

    if pin is not None and _llamacpp_quant(model, pin) == pin:
        return _row(pin)

    default_quant = _llamacpp_quant(model, None)
    gpu_possible = any(_tier_available(d.tier, machine, d.backend) and d.tier != "cpu"
                       for d in model.deployments)
    if budget_bytes is None or not gpu_possible:
        return _row(default_quant)

    budget = budget_bytes - reserved_bytes
    quants = {}
    for d in model.deployments:
        size = est_bytes(d)
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
    # largest fully-resident quant wins. `quants` is already the final
    # (downloaded-restricted, if applicable) candidate set, so no further
    # downloaded restriction is needed here.
    picked = _fit_walk({q: sz * _LLAMA_RESIDENT_FACTOR for q, sz in quants.items()},
                       budget=budget, downloaded=None)
    if picked is not None:
        return _row(picked)
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
                   budget_bytes: int | None = None, downloaded: set | None = None, *,
                   est_bytes, format_ready):
    """Pick the best downloadable variant of `model` for this machine. Deterministic:
    same (model, machine, reserved_bytes, pin) → same Deployment. Falls back to the
    CPU floor when no GPU variant fits, the device memory total is unknown, or a
    format's runtime is missing. `pin` (a compute_type) forces that variant when
    it's valid.

    llamacpp-backed models (all current LLM translate cards) take a separate,
    VRAM-math-free path: llama-server's --fit handles memory via partial offload,
    so quant/tier selection is purely rank + tier-availability, never a byte budget.

    `est_bytes` (Deployment -> int | None) and `format_ready` (compute_type ->
    bool) are injected callables — the caller's VRAM-footprint estimate and
    runtime-importability check, respectively."""
    if _is_llamacpp(model):
        return _llamacpp_variant_row(model, machine, pin, reserved_bytes, budget_bytes,
                                     downloaded=downloaded, est_bytes=est_bytes)
    total = _quant_budget_bytes(machine)
    cpu_floor = next((d for d in model.deployments if d.tier == "cpu"), None)

    def candidate(d) -> bool:
        if d.tier == "cpu":
            return False
        if d.backend not in machine.installed or not format_ready(d.compute_type):
            return False
        if total is None or not _tier_available(d.tier, machine, d.backend):
            return False
        need = est_bytes(d)
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
