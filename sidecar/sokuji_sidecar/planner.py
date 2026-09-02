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
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from . import catalog

if TYPE_CHECKING:
    from .accel import Machine


@dataclass(frozen=True)
class PlanConfig:
    """Declarative per-load hints, read from the resolved catalog card and
    consumed by backends at load time: native_translate reads the two thinking
    flags and prompt_family (which of its three prompt strategies to use);
    native_tts reads tts_family (sk_tts_load's required family_hint),
    tts_language (pocket_tts's load-time language package, e.g. "english";
    ignored by every other family), and tts_extra_files (ruling R18(s4):
    same-directory sidecar assets, e.g. pocket-tts-en's
    embeddings/alba.safetensors, that must be hard-link-staged alongside the
    gguf — see tts_backend.py's module docstring). All-inert defaults so a
    bare `PlanConfig()` changes no behavior."""
    disable_thinking: bool = False
    append_no_think: bool = False
    prompt_family: str = ""
    tts_family: str = ""
    tts_language: str = ""
    tts_extra_files: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True)
class Plan:
    backend: str
    tier: str
    device: str
    compute_type: str
    artifact: str
    rank: float
    config: PlanConfig = field(default_factory=PlanConfig)


class NoUsablePlan(Exception):
    """A known model has no deployment runnable on this machine (e.g. a GPU-only
    model on a CPU-only box)."""


def _plan_config(model) -> PlanConfig:
    """Build a Plan's PlanConfig from its resolved catalog card. Card types
    differ (an AsrModel and a TtsModel have no thinking flags), so every
    field is read defensively via getattr with an inert default — this stays
    correct for any current or future card shape. `family`/`load_language`
    land on TtsModel in slice 4's catalog task; reading them defensively now
    means native_tts's backend already gets tts_family/tts_language the
    moment those catalog fields exist, with no further planner change."""
    return PlanConfig(
        disable_thinking=getattr(model, "disable_thinking", False),
        append_no_think=getattr(model, "append_no_think", False),
        prompt_family=getattr(model, "prompt_family", ""),
        tts_family=getattr(model, "family", ""),
        tts_language=getattr(model, "load_language", ""),
        tts_extra_files=getattr(model, "extra_files", ()),
    )


TIER_RANK = {"gpu-metal": 3.0, "gpu-vulkan": 2.5, "cpu": 1.0}
TIER_DEVICE = {"cpu": "cpu", "gpu-metal": "metal", "gpu-vulkan": "vulkan"}


# A hosted-macOS VM (GitHub Actions' macos-14 runner, and every other
# virtualized Mac) exposes its GPU as "Apple Paravirtual device" — a
# virtualization shim, not a downlevel real GPU. It lacks
# has_simdgroup_reduction (ggml-metal-device.m requires MTLGPUFamilyApple7 or
# Metal3), so ggml refuses GGML_OP_NORM/RMS_NORM/ARGMAX there and every TTS
# family that normalizes ABORTS the process (ruling R36). Matching by
# description is the only signal available: the device still reports kind
# "metal", and the host still reports as Apple Silicon.
_PARAVIRTUAL_GPU_RE = re.compile(r"paravirtual", re.IGNORECASE)


def _paravirtual_metal_only(machine: Machine) -> bool:
    """True when every Metal device this machine reports is a paravirtual shim.

    Reads `machine.gpus` — (kind, description, mem_total) straight from the
    native probe (accel._native_gpus). An empty/absent Metal entry means the
    probe told us nothing about descriptions (wheel absent, or a synthetic
    fixture built from tc_kinds alone), which is NOT evidence of a shim, so
    the tier stays available: this exclusion only fires on a positive match.
    `all` rather than `any` so a hypothetical box with a real Metal GPU
    alongside a paravirtual one keeps the tier.
    """
    metal = [desc for kind, desc, _mem in machine.gpus if kind == "metal"]
    return bool(metal) and all(_PARAVIRTUAL_GPU_RE.search(desc or "") for desc in metal)


def _tier_available(tier: str, machine: Machine, backend: str | None = None) -> bool:
    if tier == "cpu":
        return True
    if tier == "gpu-metal":
        if _paravirtual_metal_only(machine):
            return False
        return machine.apple_silicon or "metal" in machine.tc_kinds
    if tier == "gpu-vulkan":
        # the native library's own probe is authoritative (sees AMD/Intel/NVIDIA
        # Vulkan devices) — a genuinely Vulkan-capable box reports "vulkan" in
        # tc_kinds. Arch-gated to hosts whose vulkan binaries actually exist:
        # x86_64 everywhere, plus Linux/aarch64 (the sokuji-native aarch64 wheel
        # bundles the ggml Vulkan backend and llama.cpp ships
        # ubuntu-vulkan-arm64 — the DGX Spark / Jetson lane). Other arches
        # (Windows-on-ARM) are never offered an unrunnable plan.
        return ("vulkan" in machine.tc_kinds
                and (machine.arch in ("x86_64", "AMD64")
                     or (machine.os == "Linux" and machine.arch == "aarch64")))
    # gpu-cuda/gpu-dml died with the ONNX TTS backends (their last catalog
    # consumers) — spec §5.2: has_nvidia/dml_adapters/ort_cuda/the aarch64
    # ORT-CUDA special case are deleted along with the tier strings.
    return False


def _platform_ok(d, machine: Machine, platform: str) -> bool:
    """Whether deployment `d` is runnable on THIS host's OS (D9). A row is
    dropped when this platform is not in its `platforms` set. Every shipped
    card defaults to all three OSes, so this is currently a no-op — kept for
    the next platform-specific tier (a future windows-only or macOS-only row).
    `platform` is the caller's current-OS tag (accel.current_platform() on the
    real host) — injected so this function stays a pure lookup."""
    return platform in d.platforms


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
        # vulkan/metal deployments (native ASR cards have no cuda rows).
        def _pinned(d):
            return TIER_DEVICE.get(d.tier) == override or (override == "cuda" and d.tier != "cpu")
        pinned = [d for d in usable if _pinned(d)]
        rest = [d for d in usable if not _pinned(d)]
        usable = pinned + rest
    config = _plan_config(model)
    plans = [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank, config)
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
    TOTAL memory, from the native library's device probe (all vendors). Quant choice
    only decides WHICH FILE we recommend the user download — and we always run
    exactly the file the user downloaded — so the basis must never flap with
    transient VRAM pressure (that would recommend re-downloads). Runtime
    pressure is placement's job (load_with_fallback's GPU->cpu tier
    fallback), never a silent switch to a different model file."""
    # Largest-device basis: correct for the ~universal single-GPU case. On a rare
    # dual-DISCRETE-vendor box (AMD + NVIDIA) this can budget a gpu-cuda download
    # against the non-CUDA card's VRAM — accepted as a documented limitation
    # (per-tier/vendor budgeting is out of P2's NVML-removal scope).
    total = max((t for _k, _n, t in machine.gpus), default=0)
    return total or None


def _tc_pick_quant(model, machine: Machine, pin: str | None, budget: int | None,
                   downloaded: set | None = None) -> str:
    """Quant for a multi-quant native ASR card. pin wins; on a GPU-capable
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
    # Multi-quant ladder (big native ASR cards): narrow to ONE quant before
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
        # same way we recommended it. reserved_bytes only sizes THIS quant
        # selection; an over-budget GPU load fails cleanly at load time and
        # the resolver falls to the cpu plan below — never a silent switch to
        # a different downloaded file.
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
        config = _plan_config(model)
        plans = [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank, config)
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
    # `pin` (GGUF LLM cards only) must still be honored — otherwise a pinned
    # q8_0 silently resolves through whatever quant _resolve_model's plain
    # tier-pin ranking picks by default (the highest-rank row across ALL
    # quants), ignoring the user's pin entirely. Filter the model down to just
    # the pinned (or rank-default, if the pin is invalid) quant's rows first,
    # then run the existing tier-pinned resolution over that narrowed model.
    if pin is not None and _is_gguf_llm(model):
        quant = _llamacpp_quant(model, pin)
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
    return _resolve_model(model, model_id, override, machine, cache=cache, platform=platform)


def resolve_tts(model_id: str, override: str = "auto", *, machine: Machine, platform: str,
                cache: dict, downloaded: frozenset = frozenset(),
                pin: str | None = None, est_bytes=None) -> list[Plan]:
    """Resolve Plans for a TTS card.

    Every native_tts card is a single-file audio.cpp GGUF shipping the SAME
    three tiers per quant (unlike the deleted ONNX backends' bf16-CUDA-only /
    macOS-only-MLX rows), so quant/tier selection collapses to exactly
    resolve_translate's GGUF-LLM auto path: the largest fully-resident quant
    (`_llamacpp_variant_row`) plus a same- (or any-) quant cpu floor, with a
    plain tier-pinned resolve on an explicit device override. This works
    unchanged for a single-quant card too (supertonic-3 ships only "f16") —
    `_llamacpp_quant`/`_llamacpp_variant_row` don't require more than one
    rung."""
    model = catalog.resolve_tts_card(model_id)
    if model is None:
        raise ValueError(f"unknown tts model: {model_id}")
    model = dataclasses.replace(
        model, deployments=tuple(d for d in model.deployments if _platform_ok(d, machine, platform)))
    # Every TTS deployment carries est_bytes directly (catalog.py's
    # _tts_gguf_row sets it for every quant), so the caller may omit
    # est_bytes and get the obvious default; accel.py's wrapper still injects
    # its own (native_models.model_size-backed) callable for parity with
    # resolve_translate.
    est_bytes = est_bytes or (lambda d: d.est_bytes)
    if override == "auto":
        chosen = _llamacpp_variant_row(model, machine, pin, budget_bytes=_quant_budget_bytes(machine),
                                       downloaded=downloaded, est_bytes=est_bytes)
        cpu = next((d for d in model.deployments
                    if d.tier == "cpu" and d.compute_type == chosen.compute_type), None) \
            if chosen is not None else None
        if cpu is None:
            cpu = next((d for d in model.deployments if d.tier == "cpu"), None)
        picks = [chosen] + ([cpu] if cpu is not None and cpu is not chosen else [])
        picks = [d for d in picks if d is not None and d.backend in machine.installed]
        if not picks:
            raise NoUsablePlan(model_id)
        config = _plan_config(model)
        return [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank, config)
                for d in picks]
    # Explicit device override: unchanged tier-pinning path, except a pinned
    # quant must still be honored first (mirrors resolve_translate's override
    # branch) — otherwise a pinned bf16 silently resolves to whatever quant
    # _resolve_model's plain tier-pin ranking picks by default.
    if pin is not None:
        quant = _llamacpp_quant(model, pin)
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
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


def _is_gguf_llm(model) -> bool:
    """True for a single-file GGUF card whose quant/tier selection is the
    budget-fit-walk shape (`_llamacpp_variant_row`/`_llamacpp_quant`) rather
    than ASR's resident-factor walk (`_tc_pick_quant`): native_translate (the
    original GGUF LLM cards) and, since slice 4, native_tts (every TTS card
    is now the identical single-file-GGUF-with-uniform-tiers shape)."""
    return model.deployments[0].backend in ("native_translate", "native_tts")


def _llamacpp_quant(model, pin: str | None) -> str:
    """Which compute_type (quant) to use for a GGUF LLM card: `pin` when it
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
    """Pick (quant, tier) for a GGUF LLM card.

    This is a pre-load DOWNLOAD/PLACEMENT heuristic, not a runtime memory
    manager — the "--fit"/partial-offload language below is historical
    (llama-server's own memory placement, which no partial-offload
    replacement exists for in sokuji_native's sk_translate_load: a GPU tier
    either loads fully or fails, and load_with_fallback's tier fallback to
    cpu is the only runtime safety net today).

    pin → that quant unconditionally (the user's will).
    budget known → the LARGEST quant that fits FULLY resident
        (est_bytes x 1.1 <= budget - reserved): a fully-resident smaller quant
        beats a bigger one that wouldn't fit. Nothing fits → keep the GPU
        tier with the rank-default quant while the budget still covers ≥50%
        of the smallest quant (historically --fit's partial-offload territory);
        below that, fully-CPU is faster.
    budget unknown (no GPU memory reading) → the rank-default quant, best tier
        (previous behavior).

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

    GGUF LLM models (native_translate, all current LLM translate cards) take a
    separate, VRAM-math-free path: sokuji_native's llama.cpp runtime loads the
    whole GGUF (no partial-offload placement math today), so quant/tier
    selection is purely rank + tier-availability, never a byte budget.

    `est_bytes` (Deployment -> int | None) and `format_ready` (compute_type ->
    bool) are injected callables — the caller's VRAM-footprint estimate and
    runtime-importability check, respectively."""
    if _is_gguf_llm(model):
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
