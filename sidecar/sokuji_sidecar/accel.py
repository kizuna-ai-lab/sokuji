"""Hardware-acceleration Loader: probes the machine, downloads/loads a model per
the Planner's ordered Plans, and measures it. The single owner of hardware
detection, downloads, model loading, and RPC handlers; deployment PLANNING
("which backend on which device") lives in planner.py — see that module's
docstring for the accel/planner ownership boundary."""
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
    # Whether the RUNNING onnxruntime build exposes the CUDA execution
    # provider (build capability, not device presence — the x64 nvidia bundle
    # lists it even on a GPU-less box). On Linux/aarch64 this is the signal
    # that NVIDIA's sbsa onnxruntime-gpu wheel was hand-installed (DGX Spark,
    # Jetson), unlocking the ORT cuda lane there.
    ort_cuda: bool = False


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


def _ort_cuda() -> bool:
    """Whether the running onnxruntime BUILD exposes the CUDA EP. Session
    creation can still fail (missing libs / no device); pair with has_nvidia."""
    import onnxruntime
    return "CUDAExecutionProvider" in onnxruntime.get_available_providers()


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
    ort_cuda = _safe(_ort_cuda, False)
    fp_src = (f"{platform.system()}|{platform.machine()}|{int(apple)}|"
              f"{','.join(sorted(dml))}|{','.join(sorted(installed))}|"
              f"{','.join(tc_kinds)}|"
              f"{','.join(f'{k}:{n}:{t}' for k, n, t in tc_gpus)}|"
              f"{int(ort_cuda)}")
    fp = hashlib.blake2s(fp_src.encode(), digest_size=6).hexdigest()   # 12 hex chars
    _MACHINE = Machine(
        os=platform.system(), arch=platform.machine(), cpu_cores=os.cpu_count() or 1,
        apple_silicon=apple, dml_adapters=dml, installed=installed,
        fingerprint=fp, tc_kinds=tc_kinds, gpus=tc_gpus, ort_cuda=ort_cuda)
    return _MACHINE


# Deployment PLANNING ("which backend on which device", quant/variant picking,
# platform filtering) lives in planner.py, which is pure (no I/O, no runtime
# import of this module). Imported back here (a) so this module's own Loader
# code (load_measured, the _h_* RPC handlers below) can keep calling the
# genuinely pure names unqualified, and (b) so `accel.<name>` keeps resolving
# for every external caller of the pre-split surface (engines, llama_runtime,
# and the test suite — including the frozen characterisation suite, which
# calls accel.resolve/accel.resolve_translate/accel.resolve_tts/
# accel._tc_pick_quant/accel.select_variant/accel._llamacpp_variant_row
# directly). This is an intentional re-export, not a smell.
#
# `resolve`, `resolve_translate`, `resolve_tts`, `select_variant`,
# `_llamacpp_variant_row`, and `resolve_deployments` are NOT re-exported here:
# their pure planner.* counterparts now take the environment facts below as
# parameters, so this module instead defines same-named Loader-wrapper
# functions (right below) that fetch those facts and delegate.
from . import planner  # noqa: E402
from .planner import (  # noqa: E402,F401
    Plan, NoUsablePlan, has_nvidia, TIER_RANK, TIER_DEVICE,
    _tier_available, _platform_ok, _bench_key,
    _TC_RESIDENT_FACTOR, _quant_budget_bytes, _tc_pick_quant,
    _VRAM_CONTEXT_BYTES, _weight_factor, _is_llamacpp,
    _LLAMA_RESIDENT_FACTOR,
)


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


# ── Loader wrappers for planner.py's pure resolve/pick functions ────────────
# Same public names + call signatures as before the purification split.
# Each fetches its I/O by calling the env-fact functions below AS BARE
# MODULE-GLOBAL NAMES (current_platform(), bench_load(), probe(),
# _downloaded_quants(), _est_bytes, _format_ready) so that
# `monkeypatch.setattr(accel, "<name>", ...)` — used throughout the test
# suite, including the frozen characterisation suite — is observed exactly
# as it was before this split.


def resolve_deployments(model, machine, override="auto", bench=None, *, platform=None):
    return planner.resolve_deployments(
        model, machine, override, bench,
        platform=platform if platform is not None else current_platform())


def resolve(model_id, override="auto", machine=None, pin=None):
    from . import catalog as _cat
    m = machine or probe()
    model = _cat.asr_model(model_id)
    multi_quant = model is not None and len({d.compute_type for d in model.deployments}) > 1
    downloaded = _downloaded_quants(model) if multi_quant else set()
    return planner.resolve(model_id, override, machine=m, platform=current_platform(),
                           cache=bench_load(), downloaded=downloaded, pin=pin)


def resolve_translate(model_id, override="auto", machine=None, reserved_bytes=0, pin=None):
    from . import catalog as _cat, llama_runtime
    m = machine or probe()
    model = _cat.translate_model(model_id)
    if model is not None:
        # Set regardless of override branch: the explicit device path loads a
        # llamacpp backend exactly like the auto path, so --fit-target must be
        # sized off the same reserved-VRAM figure. Kept in this Loader wrapper
        # (not the pure planner) so planner.resolve_translate stays side-effect-free.
        llama_runtime.set_reserved_bytes(reserved_bytes)
    downloaded = (_downloaded_quants(model)
                 if override == "auto" and model is not None else set())
    return planner.resolve_translate(
        model_id, override, machine=m, platform=current_platform(), cache=bench_load(),
        downloaded=downloaded, reserved_bytes=reserved_bytes, pin=pin,
        est_bytes=_est_bytes, format_ready=_format_ready)


def resolve_tts(model_id, override="auto", machine=None):
    m = machine or probe()
    return planner.resolve_tts(model_id, override, machine=m, platform=current_platform(),
                               cache=bench_load())


def select_variant(model, machine, reserved_bytes, pin=None, budget_bytes=None, downloaded=None):
    return planner.select_variant(model, machine, reserved_bytes, pin, budget_bytes, downloaded,
                                  est_bytes=_est_bytes, format_ready=_format_ready)


def _llamacpp_variant_row(model, machine, pin, reserved_bytes=0, budget_bytes=None, downloaded=None):
    return planner._llamacpp_variant_row(model, machine, pin, reserved_bytes, budget_bytes,
                                         downloaded=downloaded, est_bytes=_est_bytes)


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
            est = _model_weight_bytes(plan.artifact, variant_subdir=plan.config.variant_subdir)
            ledger_claim(stage, memory or est or 0)
    return backend, plan, notice, memory


# Weight files dominate a model's GPU footprint; the rest (config/tokenizer) is
# negligible. .gguf/.pt cover llama.cpp / raw-torch artifacts alongside HF
# safetensors; .onnx.data is the external-data payload of >2GB ONNX graphs
# (e.g. the qwen3-tts 1.7B talker) — its .onnx proto alone is tiny.
_WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf", ".onnx", ".onnx.data")


def _model_weight_bytes(artifact: str, variant_subdir: str | None = None):
    """Best-effort on-disk size of a model's weight files, read from the local
    HF cache (the model is already downloaded by the time we load it). Returns
    None when it can't be determined — a local dir without weight files, an
    artifact not present in the cache, or no huggingface_hub — so the VRAM gate
    stays inert rather than guessing.

    `variant_subdir`, when given (both callers pass plan.config.variant_subdir —
    "onnx-bf16" for the qwen3-tts cards, None for every other card), names a
    snapshot subdir whose CUDA-only graph rebuilds are loaded INSTEAD of the
    same-named fp32 graphs under onnx/ (see Qwen3TtsOnnxBackend.load) —
    counting both copies would roughly double the estimate and wrongly demote
    GPUs that comfortably fit the actual load."""
    try:
        path = artifact if os.path.isdir(artifact) else None
        if path is None:
            from huggingface_hub import snapshot_download
            path = snapshot_download(artifact, local_files_only=True)
        total = 0
        variant_root = os.path.join(path, variant_subdir) if variant_subdir else None
        has_variant = variant_root is not None and os.path.isdir(variant_root)
        for root, _dirs, files in os.walk(path):
            for fn in files:
                if not fn.endswith(_WEIGHT_EXTS):
                    continue
                if (has_variant and os.path.basename(root) == "onnx"
                        and os.path.exists(os.path.join(variant_root, fn))):
                    continue
                total += os.path.getsize(os.path.realpath(os.path.join(root, fn)))
        return total or None
    except Exception:
        return None


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
        need = (_model_weight_bytes(plan.artifact, variant_subdir=plan.config.variant_subdir)
                if (plan.device == "cuda" and not is_llamacpp) else None)
        budget = (need * _weight_factor(plan.compute_type) + _VRAM_CONTEXT_BYTES) if need is not None else None
        if plan.device == "cuda" and has_cpu_fallback and free is not None and budget is not None:
            if free < budget:
                notice = (f"cuda skipped (needs ~{_gib(budget)} GiB, "
                          f"{_gib(free)} GiB free); using CPU")
                continue
        try:
            backend = make_backend(plan.backend)
            backend.load(plan.artifact, plan.device, plan.compute_type, plan.config)
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


def _measure(backend, plan, model_id: str, machine: Machine, *, ns: str, run, force: bool = False):
    """Cache-by-bench-key benchmark skeleton. `ns` namespaces the key
    (""/"tps:"/"tts:"); `run(backend)` performs the driver + metric and
    returns a float, or None to skip caching. Never raises (returns None)."""
    try:
        key = ns + _bench_key(machine.fingerprint, model_id, plan.backend, plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        val = run(backend)
        if val is None:
            return None
        cache[key] = val
        bench_save(cache)
        return val
    except Exception:
        return None


BENCH_SECONDS = 3.0


def measure_rtf(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: run a fixed synthetic clip through backend.transcribe, return
    RTF (elapsed / audio_seconds), cache by (fingerprint, model, backend, device,
    compute_type). One-time per key unless force. Never raises (returns None)."""
    def run(backend):
        sr = 16000
        n = int(BENCH_SECONDS * sr)
        t = np.arange(n, dtype=np.float32) / sr
        clip = (0.05 * np.sin(2.0 * np.pi * 220.0 * t)).astype(np.float32)
        t0 = time.time()
        backend.transcribe(clip, None)
        return (time.time() - t0) / BENCH_SECONDS
    return _measure(backend, plan, model_id, machine, ns="", run=run, force=force)


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
    def run(backend):
        backend.translate(BENCH_TRANSLATE_TEXT, "", BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, False)  # warmup
        t0 = time.time()
        _text, n_new = backend.translate(BENCH_TRANSLATE_TEXT, "", BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, False)
        dt = time.time() - t0
        if dt <= 0 or n_new <= 0:
            return None
        return n_new / dt
    return _measure(backend, plan, model_id, machine, ns="tps:", run=run, force=force)


BENCH_TTS_TEXT = "The weather is lovely today, so I will go for a walk in the park."


def measure_rtf_tts(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: synth a fixed sentence, return RTF (gen_seconds / audio_seconds),
    cached under a 'tts:'-namespaced key. Never raises (returns None)."""
    def run(backend):
        samples, gen_ms = backend.generate(BENCH_TTS_TEXT, 1.0)
        audio_s = len(samples) / float(getattr(backend, "sample_rate", 24000))
        if audio_s <= 0:
            return None
        return (gen_ms / 1000.0) / audio_s
    return _measure(backend, plan, model_id, machine, ns="tts:", run=run, force=force)


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
        elif total is None or not _tier_available(d.tier, m, d.backend):
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
    platform_tag = current_platform()
    for mdl in models:
        tiers = []
        seen_tiers = set()
        for d in mdl.deployments:
            if not _platform_ok(d, m, platform_tag):
                continue                      # off-platform tier (e.g. windows-only gpu-dml on linux)
            if d.tier in seen_tiers:
                continue                      # multi-quant ladders repeat tiers
            seen_tiers.add(d.tier)
            tiers.append({"tier": d.tier, "backend": d.backend,
                          "available": d.backend in m.installed and _tier_available(d.tier, m, d.backend)})
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
