"""Unit tests for planner.py — the pure deployment planner split out of
accel.py (the Loader). Every test in this file calls a planner.* function
directly with a hand-built Machine fixture and plain values/injected lambdas
(est_bytes/format_ready) — nothing here ever patches a module global, because
planner.py takes every environment fact (current platform, bench cache,
downloaded quants, VRAM estimates, runtime-importability) as an explicit
parameter rather than reading one. That is the whole point of the
accel/planner split (see planner.py's module docstring): the Loader wrappers
in accel.py fetch those facts and hand them to the same pure functions tested
here; this file is the table-driven proof that the planner's decision logic
needs no test-time patching to exercise. The two resolve_tts tests that
monkeypatch `planner.catalog.resolve_tts_card` are a narrow, justified
exception: resolve_tts takes a model_id (not a model), so injecting a
hand-built fixture card requires patching the catalog lookup it calls
internally — that's a test-fixture seam, not an environment fact.

_fit_walk (below) is the size-descending fit-walk nucleus shared by
_tc_pick_quant and _llamacpp_variant_row (see planner.py docstrings): given a
{compute_type: size} map that already has the caller's resident factor baked
in, optionally restrict it to a `downloaded` set (only when that restriction
leaves at least one candidate), then walk it size-descending and return the
key of the largest entry that fits within `budget`. Returns None when nothing
fits (or the map is empty) -- callers apply their own fallback.

Everything below _fit_walk covers the rest of the pure planner surface:
_platform_ok, _tier_available, resolve_deployments, _apply_bench,
_tc_pick_quant, select_variant / _llamacpp_variant_row, resolve,
resolve_translate, resolve_tts. Machine fixtures mirror
tests/test_characterization.py's CPU_ONLY/CUDA_12GB/CUDA_24GB/APPLE_SILICON
(that file is the frozen characterisation net and is not touched here), plus
a few extra shapes (aarch64 NVIDIA, Windows-on-ARM, Windows DML, AMD/Intel
Vulkan-only) needed for the platform/tier-filter branches.
"""
import pytest

from sokuji_sidecar import accel, catalog, planner


FIT_WALK_MATRIX = [
    # (sized, budget, downloaded, expected, case-id)
    pytest.param({"q4": 10, "q8": 20}, 25, None, "q8",
                 id="largest_fitting_wins"),
    pytest.param({"q4": 10, "q8": 20}, 15, None, "q4",
                 id="skips_too_big_falls_to_next"),
    pytest.param({"q4": 10, "q8": 20}, 5, None, None,
                 id="nothing_fits_returns_none"),
    pytest.param({}, 100, None, None,
                 id="empty_sized_returns_none"),
    pytest.param({"q4": 10, "q8": 20}, 20, None, "q8",
                 id="exact_boundary_fits"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, {"q4"}, "q4",
                 id="downloaded_restricts_candidate_set"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, set(),
                 "q16", id="empty_downloaded_set_is_no_restriction"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, {"nonexistent"},
                 "q16", id="downloaded_with_no_overlap_falls_back_to_full_set"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, None,
                 "q16", id="none_downloaded_is_no_restriction"),
]


@pytest.mark.parametrize("sized, budget, downloaded, expected", FIT_WALK_MATRIX)
def test_fit_walk(sized, budget, downloaded, expected):
    assert planner._fit_walk(sized, budget=budget, downloaded=downloaded) == expected


# ── Machine fixtures ─────────────────────────────────────────────────────
# Mirrors tests/test_characterization.py's four-machine matrix (not imported
# from there — that file is frozen and must stay standalone).
_ALL_BACKENDS = frozenset({
    "transcribe_cpp", "transcribe_cpp_stream", "sherpa_tts", "moss_onnx",
    "supertonic", "qwen3tts_onnx", "onnx", "llamacpp_qwen", "llamacpp_hunyuan",
    "llamacpp_gemma", "ct2_opus_translate",
})
_APPLE_BACKENDS = _ALL_BACKENDS | {"mlx_audio_tts", "mlx"}

CPU_ONLY = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="p-cpu",
    tc_kinds=("cpu",), gpus=(), ort_cuda=False,
)
CUDA_12GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=16, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="p-cuda12",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 * (1 << 30)),),
    ort_cuda=False,
)
CUDA_24GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=32, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="p-cuda24",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4090", 24 * (1 << 30)),),
    ort_cuda=False,
)
APPLE_SILICON = accel.Machine(
    os="Darwin", arch="arm64", cpu_cores=10, apple_silicon=True,
    dml_adapters=(), installed=_APPLE_BACKENDS, fingerprint="p-apple",
    tc_kinds=("metal", "cpu"), gpus=(("metal", "Apple M2", 16 << 30),), ort_cuda=False,
)

ARM_NV = accel.Machine(
    # Linux/aarch64 NVIDIA box (DGX Spark shape): Vulkan-capable, no sbsa
    # onnxruntime-gpu wheel installed (ort_cuda=False).
    os="Linux", arch="aarch64", cpu_cores=20, apple_silicon=False,
    dml_adapters=(), installed=frozenset({"transcribe_cpp", "transcribe_cpp_stream", "llamacpp_qwen"}),
    fingerprint="p-arm-nv", tc_kinds=("cpu", "vulkan"),
    gpus=(("vulkan", "NVIDIA GB10", 97 << 30),), ort_cuda=False,
)

WOA = accel.Machine(
    # Windows-on-ARM: reports vulkan in tc_kinds but has no vulkan asset lane
    # (arch-gated to x86_64 / Linux-aarch64 only).
    os="Windows", arch="ARM64", cpu_cores=8, apple_silicon=False,
    dml_adapters=(), installed=frozenset(), fingerprint="p-woa",
    tc_kinds=("cpu", "vulkan"), gpus=(),
)

_INTEL_MAC = accel.Machine(
    os="Darwin", arch="x86_64", cpu_cores=8, apple_silicon=False,
    dml_adapters=(), installed=frozenset(), fingerprint="p-intel-mac",
    tc_kinds=("cpu", "metal"), gpus=(),
)


def _arm_nv_ort_cuda(installed=None):
    return accel.Machine(
        os="Linux", arch="aarch64", cpu_cores=20, apple_silicon=False,
        dml_adapters=(), installed=installed if installed is not None else ARM_NV.installed,
        fingerprint="p-arm-nv-ort", tc_kinds=("cpu", "vulkan"),
        gpus=(("vulkan", "NVIDIA GB10", 97 << 30),), ort_cuda=True,
    )


def _machine(*, os_name="Linux", arch="x86_64", apple=False, dml=(),
            installed=_ALL_BACKENDS, tc=(), gpus=(), ort_cuda=False,
            fingerprint="p-generic"):
    """Generic one-off Machine builder for tests that don't fit the named
    fixtures above."""
    return accel.Machine(os=os_name, arch=arch, cpu_cores=8, apple_silicon=apple,
                         dml_adapters=dml, installed=installed, fingerprint=fingerprint,
                         tc_kinds=tc, gpus=gpus, ort_cuda=ort_cuda)


def _nv_machine(vram_mb, installed=_ALL_BACKENDS):
    """x86_64 box whose tc probe sees one NVIDIA device via Vulkan, with the
    given total VRAM (vram_mb=0 models a probe that saw the device but no
    memory figure — has_nvidia is still True, but _quant_budget_bytes is
    None)."""
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                         dml_adapters=(), installed=installed, fingerprint=f"p-nv-{vram_mb}",
                         tc_kinds=("vulkan", "cpu"),
                         gpus=(("vulkan", "NVIDIA GeForce RTX 4070", vram_mb << 20),))


def _llm_machine(gpu=False, apple=False, vram_mb=12282,
                 installed=frozenset({"llamacpp_qwen", "llamacpp_hunyuan", "llamacpp_gemma"})):
    if apple:
        return accel.Machine(os="Darwin", arch="arm64", cpu_cores=10, apple_silicon=True,
                             dml_adapters=(), installed=installed, fingerprint="p-llm-apple",
                             tc_kinds=("cpu", "metal"), gpus=(("metal", "Apple M2", 16 << 30),))
    gpus = (("vulkan", "NVIDIA GeForce RTX 4070", vram_mb << 20),) if gpu else ()
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                         dml_adapters=(), installed=installed,
                         fingerprint=f"p-llm-{gpu}-{vram_mb}",
                         tc_kinds=("vulkan", "cpu") if gpu else ("cpu",), gpus=gpus)


def _win_dml_machine(installed):
    return accel.Machine(os="Windows", arch="AMD64", cpu_cores=8, apple_silicon=False,
                         dml_adapters=("dml",), installed=installed, fingerprint="p-win-dml")


# ── _platform_ok ─────────────────────────────────────────────────────────


def test_platform_ok_default_platforms_allow_every_os():
    d = catalog.Deployment("x", "cpu", "q4", "repo", 1.0)   # default platforms=(linux,windows,macos)
    for plat in ("linux", "windows", "macos"):
        assert planner._platform_ok(d, CPU_ONLY, plat) is True


def test_platform_ok_filters_to_declared_platforms():
    d = catalog.Deployment("x", "gpu-dml", "q4", "repo", 1.0, platforms=("windows",))
    assert planner._platform_ok(d, _win_dml_machine(frozenset()), "windows") is True
    assert planner._platform_ok(d, _win_dml_machine(frozenset()), "linux") is False


def test_platform_ok_requires_apple_silicon_when_declared():
    d = catalog.Deployment("x", "gpu-metal", "q4", "repo", 1.0,
                           platforms=("macos",), requires_apple_silicon=True)
    assert planner._platform_ok(d, _INTEL_MAC, "macos") is False   # Darwin, but not Apple Silicon
    assert planner._platform_ok(d, APPLE_SILICON, "macos") is True


# ── _tier_available ──────────────────────────────────────────────────────
# replaces test_accel.py::test_gpu_vulkan_tier_covers_linux_aarch64,
# test_gpu_cuda_tier_backend_split_on_aarch64,
# test_gpu_cuda_tier_capability_unlock_on_aarch64,
# test_gpu_vulkan_tier_not_lit_by_dml_alone,
# test_gpu_metal_tier_available_on_apple_silicon,
# test_gpu_metal_tier_available_via_tc_metal_kind


def test_tier_available_gpu_vulkan_covers_linux_aarch64():
    x64_vulkan = _machine(tc=("cpu", "vulkan"))
    assert planner._tier_available("gpu-vulkan", x64_vulkan) is True
    assert planner._tier_available("gpu-vulkan", ARM_NV) is True
    # ...but other non-x64 hosts (Windows-on-ARM) still have no vulkan asset lane.
    assert planner._tier_available("gpu-vulkan", WOA) is False


def test_tier_available_gpu_cuda_backend_split_on_aarch64():
    # x86: NVIDIA presence is the whole gate. Linux/aarch64 splits by backend:
    # llamacpp_* is allowed (bucket ships sm_121 builds), a call with no
    # backend info stays conservative, and bare ORT backends need the
    # capability unlock covered separately below.
    assert planner._tier_available("gpu-cuda", _nv_machine(12288)) is True
    assert planner._tier_available("gpu-cuda", ARM_NV, backend="llamacpp_qwen") is True
    assert planner._tier_available("gpu-cuda", ARM_NV) is False


def test_tier_available_gpu_cuda_capability_unlock_on_aarch64():
    # Installing NVIDIA's sbsa onnxruntime-gpu wheel (ort_cuda=True) unlocks
    # the cuda tier for ORT backends on Linux/aarch64; llamacpp doesn't need
    # it (its cuda lane is the bucket binary, not onnxruntime).
    m = _arm_nv_ort_cuda(installed=frozenset({"qwen3tts_onnx", "moss_onnx", "llamacpp_qwen"}))
    assert planner._tier_available("gpu-cuda", m, backend="qwen3tts_onnx") is True
    assert planner._tier_available("gpu-cuda", m, backend="moss_onnx") is True
    assert planner._tier_available("gpu-cuda", m) is False               # no backend info
    assert planner._tier_available("gpu-cuda", ARM_NV, backend="qwen3tts_onnx") is False  # CPU wheel


def test_tier_available_gpu_vulkan_not_lit_by_dml_alone():
    # A DirectX12/DML adapter is NOT a Vulkan signal: llama.cpp has no DML
    # flavor and the vulkan binary is fetched only when the tc probe itself
    # reports "vulkan". A genuinely Vulkan-capable box still reports it.
    dml_only = _machine(dml=("Intel Arc",), installed=frozenset({"llamacpp_qwen"}))
    assert planner._tier_available("gpu-vulkan", dml_only) is False
    assert planner._tier_available("gpu-vulkan", _machine(tc=("cpu", "vulkan"))) is True
    plans = planner.resolve_translate("qwen3-0.6b", "auto", machine=dml_only, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert [p.device for p in plans] == ["cpu"]   # no gpu-dml row on LLM translate cards


def test_tier_available_gpu_metal_on_apple_silicon():
    m = _machine(os_name="Darwin", arch="arm64", apple=True, installed=frozenset())
    assert planner._tier_available("gpu-metal", m) is True


def test_tier_available_gpu_metal_via_tc_metal_kind():
    # Intel Mac: the metal ACCELERATOR is present (tc reports it) — the
    # Apple-Silicon requirement is enforced separately by _platform_ok, not here.
    m = _machine(os_name="Darwin", arch="arm64", apple=False, tc=("cpu", "metal"), installed=frozenset())
    assert planner._tier_available("gpu-metal", m) is True


# ── resolve_deployments: tier gating + override pinning ─────────────────
# replaces test_accel.py::test_resolve_prefers_gpu_when_nvidia_present,
# test_resolve_cpu_only_machine_drops_gpu_plan, test_resolve_override_pins_cpu,
# test_resolve_gpu_only_model_on_cpu_machine_is_empty


def _model_cpu_and_cuda():
    # synthetic rows exercising the generic resolver mechanics (tier ranking,
    # override pinning) — backend name only needs to be in `installed`.
    return catalog.AsrModel("m", "M", ("multi",), (
        catalog.Deployment("transcribe_cpp", "gpu-cuda", "float16", "large-v3", 1.0),
        catalog.Deployment("transcribe_cpp", "cpu", "int8", "large-v3", 1.0),
    ))


def test_resolve_deployments_prefers_gpu_when_nvidia_present():
    plans = planner.resolve_deployments(_model_cpu_and_cuda(), _nv_machine(12288), platform="linux")
    assert [p.device for p in plans] == ["cuda", "cpu"]   # GPU first, CPU floor last


def test_resolve_deployments_cpu_only_machine_drops_gpu_plan():
    plans = planner.resolve_deployments(_model_cpu_and_cuda(), CPU_ONLY, platform="linux")
    assert [p.device for p in plans] == ["cpu"]            # no NVIDIA -> only the floor


def test_resolve_deployments_override_pins_cpu():
    plans = planner.resolve_deployments(_model_cpu_and_cuda(), _nv_machine(12288),
                                        override="cpu", platform="linux")
    assert [p.device for p in plans] == ["cpu", "cuda"]    # CPU pinned to front, GPU still present


def test_resolve_deployments_gpu_only_model_on_cpu_machine_is_empty():
    gpu_only = catalog.AsrModel("v", "Voxtral", ("multi",),
                                (catalog.Deployment("llamacpp", "gpu-cuda", "q4", "v", 1.0),))
    assert planner.resolve_deployments(gpu_only, CPU_ONLY, platform="linux") == []


# ── _apply_bench ─────────────────────────────────────────────────────────
# replaces test_accel.py::test_apply_bench_demotes_slow_gpu


def test_apply_bench_demotes_gpu_measured_slower_than_cpu():
    cpu = planner.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    gpu = planner.Plan("ctranslate2", "gpu-cuda", "cuda", "float16", "tiny", 1.0)
    bench_slow = {("ctranslate2", "cuda", "float16"): 0.9, ("ctranslate2", "cpu", "int8"): 0.4}
    assert [p.device for p in planner._apply_bench([gpu, cpu], bench_slow)] == ["cpu", "cuda"]
    bench_fast = {("ctranslate2", "cuda", "float16"): 0.1, ("ctranslate2", "cpu", "int8"): 0.4}
    assert [p.device for p in planner._apply_bench([gpu, cpu], bench_fast)] == ["cuda", "cpu"]


# ── resolve() (ASR): unknown id, tier + override, bench demotion ────────
# replaces test_accel.py::test_resolve_unknown_model_raises,
# test_whisper_resolves_vulkan_first_on_nvidia,
# test_whisper_cpu_only_machine_drops_gpu, test_whisper_cpu_override_pins_cpu_on_nvidia,
# test_sense_voice_resolves_vulkan_then_cpu_on_nvidia, test_vulkan_tier_from_tc_probe_alone,
# test_resolve_demotes_gpu_when_cache_says_slower, test_resolve_override_beats_demotion,
# test_speech_llms_resolve_vulkan_then_cpu_on_nvidia, test_arm_nvidia_resolves_asr_vulkan_translate_cuda


def test_resolve_unknown_model_raises():
    with pytest.raises(ValueError):
        planner.resolve("nope", machine=CPU_ONLY, platform="linux", cache={}, downloaded=set())


WHISPER_RESOLVE_MATRIX = [
    pytest.param(CUDA_12GB, "auto", ["vulkan", "cpu"], "q8_0", id="gpu_present_vulkan_first"),
    pytest.param(CUDA_24GB, "auto", ["vulkan", "cpu"], "q8_0", id="gpu_present_24gb_vulkan_first"),
    pytest.param(CPU_ONLY, "auto", ["cpu"], None, id="cpu_only_drops_gpu_plan"),
    pytest.param(CUDA_12GB, "cpu", ["cpu", "vulkan"], "q8_0", id="override_pins_cpu_on_nvidia"),
]


@pytest.mark.parametrize("machine, override, expected_devices, expected_quant", WHISPER_RESOLVE_MATRIX)
def test_resolve_whisper_base_tier_and_override(machine, override, expected_devices, expected_quant):
    plans = planner.resolve("whisper-base", override, machine=machine, platform="linux",
                            cache={}, downloaded=set())
    assert [p.device for p in plans] == expected_devices
    assert all(p.backend == "transcribe_cpp" for p in plans)
    if expected_quant is not None:
        assert all(p.compute_type == expected_quant for p in plans)


def test_resolve_sense_voice_vulkan_then_cpu_on_nvidia():
    plans = planner.resolve("sense-voice", machine=CUDA_12GB, platform="linux",
                            cache={}, downloaded=set())
    assert [p.device for p in plans] == ["vulkan", "cpu"]


def test_resolve_leads_with_vulkan_from_tc_probe_alone_no_nvidia():
    # An AMD/Intel box: no NVIDIA device, no DML — transcribe.cpp's own
    # Vulkan probe alone is enough to light the gpu-vulkan tier.
    m = _machine(tc=("cpu", "vulkan"))
    plans = planner.resolve("whisper-base", machine=m, platform="linux", cache={}, downloaded=set())
    assert plans[0].device == "vulkan"


def test_resolve_demotes_gpu_when_bench_cache_says_slower():
    m = CUDA_12GB
    cache = {
        planner._bench_key(m.fingerprint, "whisper-base", "transcribe_cpp", "vulkan", "q8_0"): 0.8,
        planner._bench_key(m.fingerprint, "whisper-base", "transcribe_cpp", "cpu", "q8_0"): 0.3,
    }
    plans = planner.resolve("whisper-base", machine=m, platform="linux", cache=cache, downloaded=set())
    assert plans[0].device == "cpu"    # demoted: measured slower on GPU than CPU


def test_resolve_override_beats_bench_demotion():
    m = CUDA_12GB
    cache = {
        planner._bench_key(m.fingerprint, "whisper-base", "transcribe_cpp", "vulkan", "q8_0"): 0.8,
        planner._bench_key(m.fingerprint, "whisper-base", "transcribe_cpp", "cpu", "q8_0"): 0.3,
    }
    # UI sends 'cuda' for GPU — it pins ANY accelerator tier (vulkan here);
    # the benchmark never overrides the user's forced device.
    plans = planner.resolve("whisper-base", "cuda", machine=m, platform="linux",
                            cache=cache, downloaded=set())
    assert plans[0].device == "vulkan"


@pytest.mark.parametrize("model_id", [
    "granite-speech-4.1-2b", "qwen3-asr-1.7b", "voxtral-mini-4b-realtime",
    "cohere-transcribe-03-2026", "fun-asr-mlt-nano",
])
def test_resolve_speech_llm_family_vulkan_then_cpu_on_nvidia(model_id):
    # granite/qwen3-asr/voxtral/cohere/fun-asr all share the transcribe_cpp
    # rows — on an NVIDIA box they resolve vulkan first with a cpu floor.
    m = _machine(gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12288 << 20),))
    plans = planner.resolve(model_id, machine=m, platform="linux", cache={}, downloaded=set())
    assert [p.device for p in plans] == ["vulkan", "cpu"]
    assert all(p.backend.startswith("transcribe_cpp") for p in plans)


def test_resolve_arm_nvidia_leads_with_vulkan():
    plans = planner.resolve("sense-voice", machine=ARM_NV, platform="linux", cache={}, downloaded=set())
    assert plans[0].device == "vulkan"


# ── _tc_pick_quant: direct-call table (gpu/cpu, curated vs downloaded, pin) ─
# replaces test_accel.py::test_asr_roomy_budget_upgrades_to_q8,
# test_asr_tight_budget_keeps_default, test_asr_cpu_only_prefers_smallest_quant,
# test_asr_unknown_memory_keeps_default_on_gpu, test_asr_pin_narrows_ladder,
# test_asr_pin_listed_only_quant_honored, test_asr_downloaded_listed_only_quant_loads,
# test_asr_fresh_recommendation_never_listed_only, test_asr_single_quant_cards_unaffected,
# test_asr_quant_pick_prefers_downloaded, test_quant_pick_ignores_download_state_when_nothing_cached,
# test_asr_bench_demotion_uses_quant_keyed_entries

_COHERE_MODEL = catalog.asr_model("cohere-transcribe-03-2026")


TC_PICK_QUANT_DIRECT_MATRIX = [
    pytest.param(_nv_machine(12282), None, None, "q8_0", id="gpu_roomy_budget_curated_upgrade"),
    pytest.param(_nv_machine(2048), None, None, "q4_k_m", id="gpu_tight_budget_keeps_default"),
    pytest.param(CPU_ONLY, None, None, "q4_k_m", id="cpu_only_smallest_wins_ignores_budget"),
    pytest.param(_nv_machine(0), None, None, "q4_k_m", id="unknown_memory_keeps_default_on_gpu"),
    pytest.param(_nv_machine(2048), "q8_0", None, "q8_0", id="pin_overrides_ladder_even_if_it_would_not_fit"),
    pytest.param(_nv_machine(12282), "f16", None, "f16", id="pin_listed_only_quant_honored"),
    pytest.param(_nv_machine(12282), None, {"f16"}, "f16", id="downloaded_listed_only_quant_wins"),
    pytest.param(_nv_machine(24564), None, None, "q8_0", id="fresh_recommendation_never_listed_only"),
    pytest.param(_nv_machine(12282), None, {"q4_k_m"}, "q4_k_m", id="downloaded_restricts_to_cached_quant"),
    pytest.param(_nv_machine(12282), None, set(), "q8_0", id="ignores_download_state_when_nothing_cached"),
]


@pytest.mark.parametrize("machine, pin, downloaded, expected", TC_PICK_QUANT_DIRECT_MATRIX)
def test_tc_pick_quant_direct(machine, pin, downloaded, expected):
    budget = planner._quant_budget_bytes(machine)
    assert planner._tc_pick_quant(_COHERE_MODEL, machine, pin, budget, downloaded=downloaded) == expected


def test_tc_pick_quant_single_quant_model_unaffected():
    # sense-voice has a full ladder too, but with a roomy GPU it narrows to
    # ONE quant end-to-end via resolve() — both surviving plans share it.
    plans = planner.resolve("sense-voice", machine=_nv_machine(12282), platform="linux",
                            cache={}, downloaded=set())
    assert [p.compute_type for p in plans] == ["q8_0", "q8_0"]


COHERE_RESOLVE_QUANT_MATRIX = [
    pytest.param(_nv_machine(12282), None, set(), "q8_0", ["vulkan", "cpu"],
                 id="roomy_budget_upgrades_to_q8"),
    pytest.param(_nv_machine(2048), None, set(), "q4_k_m", ["vulkan", "cpu"],
                 id="tight_budget_keeps_default"),
    pytest.param(CPU_ONLY, None, set(), "q4_k_m", ["cpu"],
                 id="cpu_only_prefers_smallest_quant"),
    pytest.param(_nv_machine(0), None, set(), "q4_k_m", ["vulkan", "cpu"],
                 id="unknown_memory_keeps_default_on_gpu"),
    pytest.param(_nv_machine(2048), "q8_0", set(), "q8_0", ["vulkan", "cpu"],
                 id="pin_narrows_ladder"),
    pytest.param(_nv_machine(12282), "f16", set(), "f16", ["vulkan", "cpu"],
                 id="pin_listed_only_quant_honored"),
    pytest.param(_nv_machine(12282), None, {"f16"}, "f16", ["vulkan", "cpu"],
                 id="downloaded_listed_only_quant_loads"),
    pytest.param(_nv_machine(24564), None, set(), "q8_0", ["vulkan", "cpu"],
                 id="fresh_recommendation_never_listed_only"),
    pytest.param(_nv_machine(12282), None, {"q4_k_m"}, "q4_k_m", ["vulkan", "cpu"],
                 id="quant_pick_prefers_downloaded"),
    pytest.param(_nv_machine(12282), None, set(), "q8_0", ["vulkan", "cpu"],
                 id="quant_pick_ignores_download_state_when_nothing_cached"),
]


@pytest.mark.parametrize("machine, pin, downloaded, expected_quant, expected_devices",
                         COHERE_RESOLVE_QUANT_MATRIX)
def test_resolve_cohere_quant_ladder_end_to_end(machine, pin, downloaded, expected_quant, expected_devices):
    plans = planner.resolve("cohere-transcribe-03-2026", machine=machine, platform="linux",
                            cache={}, downloaded=downloaded, pin=pin)
    assert plans[0].compute_type == expected_quant
    assert [p.device for p in plans] == expected_devices


def test_resolve_asr_bench_demotion_uses_quant_keyed_entries():
    # post-narrowing: plans carry ONE quant (downloaded restricts it to
    # q4_k_m here); bench keys must match that narrowed quant.
    m = _nv_machine(12282)
    cache = {
        planner._bench_key(m.fingerprint, "cohere-transcribe-03-2026",
                           "transcribe_cpp", "vulkan", "q4_k_m"): 0.9,
        planner._bench_key(m.fingerprint, "cohere-transcribe-03-2026",
                           "transcribe_cpp", "cpu", "q4_k_m"): 0.2,
    }
    plans = planner.resolve("cohere-transcribe-03-2026", machine=m, platform="linux",
                            cache=cache, downloaded={"q4_k_m"})
    assert plans[0].device == "cpu"    # measured slower on GPU -> demoted


# ── select_variant: non-llamacpp (generic VRAM/format-aware) path ───────
# replaces test_accel.py::test_select_variant_budget_from_tc_probe_totals,
# test_select_variant_fp8_dropped_when_compressed_tensors_absent,
# test_select_variant_prefers_bf16_when_it_fits, test_select_variant_pin_honored_when_valid,
# test_select_variant_conservative_when_no_vram, test_select_variant_requires_available_gpu_tier,
# test_fp8_weight_factor_larger_than_bf16_in_select_variant


def _hymt2_7b_synthetic():
    """Synthetic (non-catalog) TranslateModel replicating the pre-llamacpp
    shape of hy-mt2-7b: a gpu-cuda bf16 variant, a cpu float32 floor, and a
    gpu-cuda fp8 variant. The real hy-mt2-7b catalog row now uses
    llamacpp/GGUF quants (bypasses this VRAM/format-aware logic entirely —
    see planner._is_llamacpp), so this fixture is what keeps select_variant's
    still-live generic (non-llamacpp) path under test."""
    return catalog.TranslateModel("hy-mt2-7b-synthetic", "Hunyuan-MT2 7B (synthetic)", ("multi",), (
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "bfloat16", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "cpu", "float32", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "fp8", "tencent/Hy-MT2-7B-FP8", 1.0),
    ))


def _est_map(mapping):
    return lambda d: mapping[d.compute_type] * 1024**3


def test_select_variant_budget_from_tc_probe_totals():
    # bf16 ~15GB, fp8 ~8GB. 16GB device total (tc probe), 2GB reserve ->
    # budget 13GB; bf16 needs 15x1.2=18GB, fp8 needs 8x1.5=12GB.
    m = _nv_machine(16 * 1024, installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=2 * 1024**3,
                               est_bytes=_est_map({"bfloat16": 15, "fp8": 8, "float32": 15}),
                               format_ready=lambda ct: True)
    assert d.compute_type == "fp8"


def test_select_variant_fp8_dropped_when_format_unavailable():
    m = _nv_machine(12 * 1024, installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0,
                               est_bytes=_est_map({"bfloat16": 15, "fp8": 8, "float32": 15}),
                               format_ready=lambda ct: ct != "fp8")
    assert d.tier == "cpu"    # fp8 ungated off, bf16 too big -> cpu


def test_select_variant_prefers_bf16_when_it_fits():
    m = _nv_machine(24 * 1024, installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0,
                               est_bytes=_est_map({"bfloat16": 4, "fp8": 2, "float32": 4}),
                               format_ready=lambda ct: True)
    assert d.compute_type == "bfloat16"    # both fit -> highest quality


def test_select_variant_pin_honored_when_valid():
    m = _nv_machine(24 * 1024, installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0, pin="fp8",
                               est_bytes=_est_map({"bfloat16": 4, "fp8": 2, "float32": 4}),
                               format_ready=lambda ct: True)
    assert d.compute_type == "fp8"    # pinned despite bf16 fitting


def test_select_variant_conservative_when_no_vram_reading():
    m = _nv_machine(0, installed=frozenset({"hunyuan_translate"}))   # probe couldn't read VRAM
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0,
                               est_bytes=lambda d: 4 * 1024**3, format_ready=lambda ct: True)
    assert d.tier == "cpu"    # never gamble -> cpu floor


def test_select_variant_requires_available_gpu_tier():
    # A machine with device memory but NO NVIDIA device (AMD, seen by the tc
    # probe) must not pick a gpu-cuda variant just because a total exists.
    m = _machine(gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),),
                installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0,
                               est_bytes=lambda d: 1 << 30, format_ready=lambda ct: True)
    assert d.tier == "cpu"


FP8_WEIGHT_FACTOR_MATRIX = [
    # 12GiB Ada, no reserve: budget=11GiB. fp8 (8GiB*1.5=12GiB) exceeds it -> cpu.
    pytest.param(12, "cpu", None, id="fp8_1_5x_factor_too_big_at_12gib"),
    # 16GiB Ada: budget=15GiB. fp8 (12GiB) fits -> fp8 chosen.
    pytest.param(16, "gpu-cuda", "fp8", id="fp8_1_5x_factor_fits_at_16gib"),
]


@pytest.mark.parametrize("vram_gb, expected_tier, expected_ct", FP8_WEIGHT_FACTOR_MATRIX)
def test_select_variant_fp8_weight_factor_larger_than_bf16(vram_gb, expected_tier, expected_ct):
    m = _nv_machine(vram_gb * 1024, installed=frozenset({"hunyuan_translate"}))
    d = planner.select_variant(_hymt2_7b_synthetic(), m, reserved_bytes=0,
                               est_bytes=_est_map({"bfloat16": 15, "fp8": 8, "float32": 15}),
                               format_ready=lambda ct: True)
    assert d.tier == expected_tier
    if expected_ct is not None:
        assert d.compute_type == expected_ct


# ── select_variant / _llamacpp_variant_row: llamacpp path ───────────────
# replaces test_accel.py::test_select_variant_llamacpp_default_and_pin,
# test_select_variant_llamacpp_metal_and_cpu, test_variant_plenty_of_budget_picks_largest_quant,
# test_variant_tight_budget_steps_down_to_default, test_variant_half_fits_keeps_gpu_via_fit,
# test_variant_starved_budget_goes_cpu, test_variant_pin_beats_budget,
# test_variant_no_budget_reading_keeps_rank_default, test_variant_reserved_subtracts_from_budget,
# test_llamacpp_unified_memory_never_degrades_to_cpu_for_memory

_GEMMA = catalog.translate_model("translategemma-4b")
_QWEN35_2B = catalog.translate_model("qwen3.5-2b")
_QWEN06 = catalog.translate_model("qwen3-0.6b")


def test_select_variant_llamacpp_default_and_pin():
    mach = _llm_machine(gpu=True)
    chosen = planner.select_variant(_GEMMA, mach, reserved_bytes=0,
                                    est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert (chosen.compute_type, chosen.tier) == ("q4_k_m", "gpu-cuda")
    pinned = planner.select_variant(_GEMMA, mach, reserved_bytes=0, pin="q8_0",
                                    est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert (pinned.compute_type, pinned.tier) == ("q8_0", "gpu-cuda")


def test_select_variant_llamacpp_metal_and_cpu():
    metal = planner.select_variant(_QWEN35_2B, _llm_machine(apple=True), 0, None,
                                   est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert metal.tier == "gpu-metal"
    cpu = planner.select_variant(_QWEN35_2B, _llm_machine(gpu=False), 0, None,
                                 est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert cpu.tier == "cpu"


def test_llamacpp_variant_row_direct_pin_wins_over_budget():
    # A pin to the (rank 1.0, non-default) q4_k_m quant is honored
    # unconditionally -- the user's will, --fit copes with memory -- even
    # though q8_0 is the rank-default for qwen3-0.6b.
    m = _llm_machine(gpu=True)
    d = planner._llamacpp_variant_row(_QWEN06, m, "q4_k_m", 0,
                                      planner._quant_budget_bytes(m), est_bytes=lambda d: d.est_bytes)
    assert (d.compute_type, d.tier) == ("q4_k_m", "gpu-cuda")


# translategemma-4b: q4_k_m (default, ~2.32GiB) / q8_0 (~3.85GiB) x 1.1 resident factor.
LLAMACPP_BUDGET_MATRIX = [
    pytest.param(10 << 30, 0, None, "q8_0", "gpu-cuda", id="plenty_of_budget_picks_largest_quant"),
    pytest.param(3 << 30, 0, None, "q4_k_m", "gpu-cuda", id="tight_budget_steps_down_to_default"),
    pytest.param(int(1.5 * (1 << 30)), 0, None, "q4_k_m", "gpu-cuda", id="half_fits_keeps_gpu_via_fit"),
    pytest.param(1 << 29, 0, None, "q4_k_m", "cpu", id="starved_budget_goes_cpu"),
    pytest.param(1 << 29, 0, "q8_0", "q8_0", "gpu-cuda", id="pin_beats_budget"),
    pytest.param(None, 0, None, "q4_k_m", "gpu-cuda", id="no_budget_reading_keeps_rank_default"),
    pytest.param(10 << 30, 7 << 30, None, "q4_k_m", "gpu-cuda", id="reserved_subtracts_from_budget"),
]


@pytest.mark.parametrize("budget_bytes, reserved_bytes, pin, expected_ct, expected_tier",
                         LLAMACPP_BUDGET_MATRIX)
def test_select_variant_llamacpp_budget_walk(budget_bytes, reserved_bytes, pin, expected_ct, expected_tier):
    d = planner.select_variant(_GEMMA, _llm_machine(gpu=True), reserved_bytes, pin,
                               budget_bytes=budget_bytes,
                               est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert d.compute_type == expected_ct and d.tier == expected_tier


def test_select_variant_llamacpp_apple_unified_memory_never_degrades_to_cpu():
    # Starved budget on Apple Silicon: CPU shares the SAME memory pool, so
    # moving there frees nothing -- stay on metal, --fit handles pressure.
    d = planner.select_variant(_GEMMA, _llm_machine(apple=True), reserved_bytes=0, budget_bytes=1 << 29,
                               est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert d.tier == "gpu-metal"
    # discrete-GPU machine with the same starved budget still bails to cpu.
    d2 = planner.select_variant(_GEMMA, _llm_machine(gpu=True), reserved_bytes=0, budget_bytes=1 << 29,
                                est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert d2.tier == "cpu"


# ── resolve_translate: cpu-floor pairing, override + quant pin, gating ──
# replaces test_accel.py::test_resolve_translate_prefers_gpu,
# test_resolve_translate_cpu_only_machine, test_resolve_translate_override_cpu_pins_front,
# test_resolve_translate_qwen35_no_longer_self_gates, test_resolve_translate_unknown_id_raises,
# test_resolve_translate_explicit_device_override_unchanged,
# test_resolve_translate_override_honors_quant_pin, test_resolve_translate_override_without_pin_unchanged,
# test_resolve_translate_opus_is_cpu_only, test_resolve_translate_hymt15_prefers_gpu,
# test_resolve_translate_same_quant_cpu_floor, test_resolve_translate_auto_matches_recommendation_basis,
# test_resolve_translate_auto_loads_the_downloaded_file, test_arm_nvidia_resolves_asr_vulkan_translate_cuda,
# test_translate_auto_demotes_gpu_when_bench_says_cpu_faster, test_translate_auto_keeps_gpu_without_bench,
# test_translate_quant_pick_prefers_downloaded


def test_resolve_translate_prefers_gpu():
    # select_variant needs a GPU with known VRAM (tc-probe total) to prefer a
    # GPU tier; the 12GB device below qualifies qwen2.5-0.5b for cuda.
    m = _nv_machine(12288, installed=frozenset({"llamacpp_qwen"}))
    plans = planner.resolve_translate("qwen2.5-0.5b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: 1 * 1024**3, format_ready=lambda ct: True)
    assert plans[0].device == "cuda"
    assert plans[-1].device == "cpu"
    # qwen2.5-0.5b defaults to q8_0 (small-Qwen default); artifact is the upstream GGUF file.
    assert plans[0].artifact == "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf"


def test_resolve_translate_cpu_only_machine():
    m = _machine(installed=frozenset({"llamacpp_qwen"}))
    plans = planner.resolve_translate("qwen3-0.6b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert [p.device for p in plans] == ["cpu"]


def test_resolve_translate_override_cpu_pins_front():
    # An explicit device override bypasses select_variant/quant-default
    # picking and returns every installed+tier-available deployment (both
    # quants), CPU pinned to the front.
    m = _nv_machine(0, installed=frozenset({"llamacpp_qwen"}))
    plans = planner.resolve_translate("qwen3-0.6b", "cpu", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert [p.device for p in plans] == ["cpu", "cpu", "cuda", "cuda", "vulkan", "vulkan"]
    assert plans[0].device == "cpu" and plans[-1].device == "vulkan"


def test_resolve_translate_qwen35_no_longer_self_gates():
    # qwen3.5 lives on a GGUF card behind llamacpp_qwen, an external binary
    # that is always "installed" (no Python-runtime dependency) — it
    # resolves like any other LLM translate card, no self-gating.
    m = _nv_machine(0, installed=_ALL_BACKENDS)
    plans = planner.resolve_translate("qwen3.5-0.8b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].device == "cuda"
    assert any(p.backend == "llamacpp_qwen" for p in plans)


def test_resolve_translate_unknown_id_raises():
    with pytest.raises(ValueError):
        planner.resolve_translate("nope", "auto", machine=CPU_ONLY, platform="linux",
                                  cache={}, downloaded=set(),
                                  est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)


def test_resolve_translate_explicit_device_override_unchanged():
    # device override ("cuda"/"cpu") keeps prior tier-pinning behavior, not
    # variant selection. hy-mt2-7b's real backend is llamacpp_hunyuan.
    m = _nv_machine(12 * 1024, installed=frozenset({"llamacpp_hunyuan"}))
    plans = planner.resolve_translate("hy-mt2-7b", "cpu", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].device == "cpu"


def test_resolve_translate_override_honors_quant_pin():
    # Regression: the explicit device-override path used to drop `pin`
    # entirely. override='cpu' + pin='q8_0' must yield ONLY q8_0 rows, cpu
    # pinned to the front.
    m = _nv_machine(0, installed=frozenset({"llamacpp_qwen"}))
    plans = planner.resolve_translate("qwen3-0.6b", "cpu", machine=m, platform="linux",
                                      cache={}, downloaded=set(), pin="q8_0",
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert [p.device for p in plans] == ["cpu", "cuda", "vulkan"]
    assert all(p.compute_type == "q8_0" for p in plans)


def test_resolve_translate_override_without_pin_unchanged():
    # No pin -> unchanged behavior: every installed+tier-available deployment
    # across BOTH quants.
    m = _nv_machine(0, installed=frozenset({"llamacpp_qwen"}))
    plans = planner.resolve_translate("qwen3-0.6b", "cpu", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert {p.compute_type for p in plans} == {"q8_0", "q4_k_m"}


def test_resolve_translate_opus_is_cpu_only():
    # Opus-MT is a single cpu/int8 CTranslate2 deployment (no GPU tier) —
    # a gpu-cuda deployment simply doesn't exist for this model.
    m = _nv_machine(12288, installed=frozenset({"ct2_opus_translate"}))
    plans = planner.resolve_translate("opus-mt-zh-en", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: 1 * 1024**3, format_ready=lambda ct: True)
    assert [p.device for p in plans] == ["cpu"]
    assert all(p.backend == "ct2_opus_translate" for p in plans)
    assert plans[0].artifact == "jiangzhuo9357/opus-mt-zh-en-ct2"


def test_resolve_translate_hymt15_prefers_gpu():
    m = _nv_machine(12288, installed=frozenset({"llamacpp_hunyuan"}))
    plans = planner.resolve_translate("hy-mt15-1.8b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].device == "cuda"
    assert plans[-1].device == "cpu"
    assert all(p.backend == "llamacpp_hunyuan" for p in plans)
    assert plans[0].artifact.startswith("tencent/HY-MT1.5-1.8B-GGUF/")


def test_resolve_translate_same_quant_cpu_floor():
    m = _llm_machine(gpu=True)
    plans = planner.resolve_translate("hy-mt2-1.8b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(), pin="q8_0",
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert [(p.tier, p.compute_type) for p in plans] == [("gpu-cuda", "q8_0"), ("cpu", "q8_0")]


def test_resolve_translate_auto_matches_recommendation_basis():
    # LOAD uses the SAME stable mem_total basis as the download recommendation
    # (we always run the downloaded file): a 12GB card recommends+loads q8_0.
    m = _nv_machine(12282, installed=frozenset({"llamacpp_gemma"}))
    plans = planner.resolve_translate("translategemma-4b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].compute_type == "q8_0" and plans[0].device != "cpu"


def test_resolve_translate_auto_loads_the_downloaded_file():
    # ... but when the user has (only) q4 downloaded, that IS the model we run.
    m = _nv_machine(12282, installed=frozenset({"llamacpp_gemma"}))
    plans = planner.resolve_translate("translategemma-4b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded={"q4_k_m"},
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].compute_type == "q4_k_m"


def test_resolve_translate_quant_pick_prefers_downloaded():
    m = _nv_machine(12282, installed=frozenset({"llamacpp_gemma"}))
    plans = planner.resolve_translate("translategemma-4b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded={"q4_k_m"},
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].compute_type == "q4_k_m"


def test_resolve_translate_bench_demotes_gpu_when_cpu_decodes_faster():
    m = _nv_machine(12282, installed=frozenset({"llamacpp_gemma"}))
    cache = {
        "tps:" + planner._bench_key(m.fingerprint, "translategemma-4b", "llamacpp_gemma", "cuda", "q8_0"): 5.0,
        "tps:" + planner._bench_key(m.fingerprint, "translategemma-4b", "llamacpp_gemma", "cpu", "q8_0"): 12.0,
    }
    plans = planner.resolve_translate("translategemma-4b", "auto", machine=m, platform="linux",
                                      cache=cache, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].device == "cpu"        # demoted: cpu decodes faster here


def test_resolve_translate_keeps_gpu_without_bench_measurement():
    m = _nv_machine(12282, installed=frozenset({"llamacpp_gemma"}))
    plans = planner.resolve_translate("translategemma-4b", "auto", machine=m, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].device == "cuda"       # no measurements -> estimate order


def test_resolve_arm_nvidia_translate_leads_with_cuda_and_keeps_cpu_floor():
    tr = planner.resolve_translate("qwen2.5-0.5b", "auto", machine=ARM_NV, platform="linux",
                                   cache={}, downloaded=set(),
                                   est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert tr[0].device == "cuda"
    assert any(p.device == "cpu" for p in tr)


# ── resolve_tts: sherpa synthesis, cpu-only ordering, unknown ids, D9 DML ──
# replaces test_accel.py::test_resolve_tts_orders_gpu_over_cpu, test_resolve_tts_cpu_only_machine,
# test_resolve_tts_unknown_model_raises, test_resolve_tts_arbitrary_sherpa_repo_synthesizes_model,
# test_resolve_tts_sherpa_cards_cpu_only_even_on_gpu_machine,
# test_resolve_tts_unknown_non_sherpa_id_still_raises, test_resolve_tts_surfaces_gpu_dml_on_windows,
# test_resolve_tts_override_cuda_pins_gpu_dml, test_resolve_tts_gpu_dml_absent_on_linux,
# test_arm_ort_cuda_resolves_tts_cuda


def test_resolve_tts_orders_gpu_over_cpu():
    m = _nv_machine(12000, installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = planner.resolve_tts("moss-tts-nano", machine=m, platform="linux", cache={})
    assert plans[0].tier == "gpu-cuda" and plans[0].device == "cuda"
    assert plans[-1].tier == "cpu"    # cpu floor survives


def test_resolve_tts_cpu_only_machine():
    m = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = planner.resolve_tts("moss-tts-nano", machine=m, platform="linux", cache={})
    assert [p.tier for p in plans] == ["cpu"]


def test_resolve_tts_unknown_model_raises():
    with pytest.raises(ValueError):
        planner.resolve_tts("nope", machine=CPU_ONLY, platform="linux", cache={})


def test_resolve_tts_arbitrary_sherpa_repo_synthesizes_model():
    # The renderer's piper voice cards carry full HF repo paths as ids; these
    # are not in the short sidecar catalog, but SherpaTtsBackend downloads/
    # loads any repo, so resolve_tts must synthesize an ad-hoc model.
    repo = "csukuangfj/vits-piper-en_US-libritts_r-medium"
    m = _nv_machine(12000, installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = planner.resolve_tts(repo, machine=m, platform="linux", cache={})
    assert plans, "expected at least one plan for an arbitrary sherpa repo"
    assert all(p.backend == "sherpa_tts" for p in plans)
    assert all(p.artifact == repo for p in plans)
    assert [p.tier for p in plans] == ["cpu"]    # sherpa is CPU-only (D11)


def test_resolve_tts_sherpa_cards_cpu_only_even_on_gpu_machine():
    m = _nv_machine(12288, installed=frozenset({"sherpa_tts"}))
    plans = planner.resolve_tts("csukuangfj/vits-piper-en_US-amy-low", machine=m,
                                platform="linux", cache={})
    assert [p.tier for p in plans] == ["cpu"]
    plans2 = planner.resolve_tts("csukuangfj/vits-piper-en_US-kristin-medium", machine=m,
                                 platform="linux", cache={})
    assert [p.tier for p in plans2] == ["cpu"]


def test_resolve_tts_unknown_non_sherpa_id_still_raises():
    # An id with no sherpa-family hint must still raise (no blind synthesis).
    m = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))
    with pytest.raises(ValueError):
        planner.resolve_tts("some-org/random-llm-model", machine=m, platform="linux", cache={})


def test_resolve_tts_surfaces_gpu_dml_on_windows():
    m = _win_dml_machine(frozenset({"moss_onnx"}))
    plans = planner.resolve_tts("moss-tts-nano", machine=m, platform="windows", cache={})
    # no NVIDIA -> gpu-cuda filtered; gpu-dml (2.5) leads, cpu floor survives
    assert [p.tier for p in plans] == ["gpu-dml", "cpu"]
    assert plans[0].device == "dml"


def test_resolve_tts_override_cuda_pins_gpu_dml():
    # The renderer's GPU control sends 'cuda'; the "cuda == any accelerator"
    # override rule must pin the gpu-dml plan to the front too.
    m = _win_dml_machine(frozenset({"supertonic"}))
    plans = planner.resolve_tts("supertonic-3", "cuda", machine=m, platform="windows", cache={})
    assert plans[0].tier == "gpu-dml" and plans[0].device == "dml"


def test_resolve_tts_gpu_dml_absent_on_linux():
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                      dml_adapters=(), installed=frozenset({"moss_onnx"}), fingerprint="p-linux-nodml",
                      gpus=(("cuda", "NVIDIA x", 12 << 30),))
    plans = planner.resolve_tts("moss-tts-nano", machine=m, platform="linux", cache={})
    # the windows-only gpu-dml row is dropped on Linux; only gpu-cuda + cpu remain.
    assert [p.tier for p in plans] == ["gpu-cuda", "cpu"]
    assert all(p.tier != "gpu-dml" for p in plans)


def test_resolve_arm_ort_cuda_resolves_tts_cuda():
    # With the sbsa wheel installed (ort_cuda=True), ORT TTS leads with cuda
    # on aarch64.
    m = _arm_nv_ort_cuda(installed=frozenset({
        "transcribe_cpp", "transcribe_cpp_stream", "llamacpp_qwen", "qwen3tts_onnx"}))
    tts = planner.resolve_tts("qwen3-tts-0.6b", machine=m, platform="linux", cache={})
    assert tts[0].device == "cuda"


# ── _tts_pick_quant / resolve_tts: multi-compute-type TTS card narrowing ──
# A "variant" TTS card lists the SAME logical model at several compute_types
# (bf16/fp32/int8 qwen3-tts ONNX repos, plus a macOS mlx row) rather than one
# compute_type per tier. _tts_pick_quant narrows to a single compute_type
# BEFORE the generic tier resolver runs, mirroring resolve()'s ASR
# _tc_pick_quant narrowing. Reuses the CUDA_12GB/CPU_ONLY/APPLE_SILICON
# fixtures above (their `installed` sets already cover qwen3tts_onnx and
# mlx_audio_tts) rather than adding new machine fixtures.


def _tts_variant_card():
    return catalog.TtsModel(
        "fake-tts", "Fake TTS", ("en",),
        (catalog.Deployment("mlx_audio_tts", "gpu-metal", "fp32", "org/fake-mlx", 1.0,
                            platforms=("macos",), requires_apple_silicon=True),
         catalog.Deployment("qwen3tts_onnx", "gpu-cuda", "bf16", "org/fake-bf16", 1.2, est_bytes=5_000),
         catalog.Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000),
         catalog.Deployment("qwen3tts_onnx", "cpu", "int8", "org/fake-int8", 1.1, est_bytes=2_000),
         catalog.Deployment("qwen3tts_onnx", "cpu", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000)),
        repos=("org/fake-fp32",), clones=True, streaming=False)


def test_tts_pick_quant_cuda_machine_prefers_bf16():
    assert planner._tts_pick_quant(_tts_variant_card(), CUDA_12GB) == "bf16"


def test_tts_pick_quant_cpu_machine_prefers_smallest():
    assert planner._tts_pick_quant(_tts_variant_card(), CPU_ONLY) == "int8"


def test_tts_pick_quant_apple_silicon_prefers_fp32():
    # the metal/mlx row is fp32 — narrowing must keep it alive on macOS
    assert planner._tts_pick_quant(_tts_variant_card(), APPLE_SILICON) == "fp32"


def test_tts_pick_quant_pin_wins():
    assert planner._tts_pick_quant(_tts_variant_card(), CUDA_12GB, pin="fp32") == "fp32"


def test_tts_pick_quant_restricts_to_downloaded():
    got = planner._tts_pick_quant(_tts_variant_card(), CUDA_12GB, downloaded=frozenset({"fp32"}))
    assert got == "fp32"    # bf16 not downloaded -> never chosen


def test_resolve_tts_narrows_multi_ct_card(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    plans = planner.resolve_tts("fake-tts", machine=CUDA_12GB, platform="linux", cache={})
    assert {p.compute_type for p in plans} == {"bf16"}
    assert plans[0].artifact == "org/fake-bf16"


def test_resolve_tts_downloaded_int8_lands_on_cpu(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    plans = planner.resolve_tts("fake-tts", machine=CUDA_12GB, platform="linux",
                                cache={}, downloaded=frozenset({"int8"}))
    assert [p.device for p in plans] == ["cpu"] and plans[0].compute_type == "int8"


# ── _tts_pick_quant: fp32/bf16-only ladder (post-int8-cut shipping ladder) ──
# The real catalog's TTS ladder changed to fp32 (cpu + gpu-cuda + gpu-dml
# rows) + bf16 (gpu-cuda row ONLY) — int8, which had the card's only other
# cpu row, was cut. This exposed two bugs in _tts_pick_quant: (1) the
# smallest-est_bytes fallback could pick bf16 on a CPU-only machine even
# though bf16 has no cpu row at all, narrowing the model to zero runnable
# deployments; (2) the GPU-preference walk trusted tuple declaration order
# instead of rank, so a card that happened to declare fp32-cuda before
# bf16-cuda would land on fp32 even though bf16 outranks it. fp32-cuda is
# declared BEFORE bf16-cuda below specifically so these tests can tell a
# rank-ordered walk apart from a declaration-order one.
def _tts_variant_card_v2():
    return catalog.TtsModel(
        "fake-tts-v2", "Fake TTS v2", ("en",),
        (catalog.Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000),
         catalog.Deployment("qwen3tts_onnx", "gpu-cuda", "bf16", "org/fake-bf16", 1.2, est_bytes=5_000),
         catalog.Deployment("qwen3tts_onnx", "cpu", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000)),
        repos=("org/fake-fp32",), clones=True, streaming=False)


def test_tts_pick_quant_cpu_only_avoids_unrunnable_bf16():
    # bf16 (5_000 bytes) is smaller than fp32 (8_000 bytes), but bf16 has no
    # cpu row -> unrunnable on a CPU-only machine. Narrowing to it would leave
    # zero runnable deployments (NoUsablePlan for every CPU-only user).
    assert planner._tts_pick_quant(_tts_variant_card_v2(), CPU_ONLY) == "fp32"


def test_tts_pick_quant_rank_beats_declaration_order():
    # fp32-cuda (rank 1.0) is declared before bf16-cuda (rank 1.2); the
    # preference walk must land on bf16 because it outranks fp32, not because
    # of tuple position.
    assert planner._tts_pick_quant(_tts_variant_card_v2(), CUDA_12GB) == "bf16"


def test_tts_pick_quant_runnable_beats_downloaded_but_unrunnable():
    got = planner._tts_pick_quant(_tts_variant_card_v2(), CPU_ONLY,
                                  downloaded=frozenset({"bf16"}))
    assert got == "fp32"    # bf16 downloaded but unrunnable here -> not chosen


def test_tts_pick_quant_pin_absent_from_ladder_falls_through():
    got = planner._tts_pick_quant(_tts_variant_card_v2(), CUDA_12GB, pin="int8")
    assert got == "bf16"    # int8 isn't a compute_type on this card -> pin ignored


# ── _tts_pick_quant / resolve_tts: override-aware narrowing ─────────────
# The multi-compute-type narrowing runs BEFORE _resolve_model applies the
# device override. On _tts_variant_card_v2 (fp32: cpu+cuda rows, bf16:
# cuda-only row) a CUDA machine's un-scoped narrowing always prefers bf16 —
# so an explicit override='cpu' arrived at _resolve_model already narrowed
# to a compute_type with no cpu row, and the override had nothing to pin:
# it was silently ignored and the plan landed on gpu-cuda bf16 anyway. The
# override must instead scope the narrowing itself to variants that have a
# row on the pinned device.


def test_tts_pick_quant_cuda_machine_override_cpu_picks_fp32():
    # bf16 has no cpu row -> override='cpu' must scope the narrowing away
    # from it, landing on fp32 (which does have a cpu row), NOT bf16.
    got = planner._tts_pick_quant(_tts_variant_card_v2(), CUDA_12GB, override="cpu")
    assert got == "fp32"


def test_resolve_tts_cuda_machine_override_cpu_lands_on_cpu_fp32(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card_v2())
    plans = planner.resolve_tts("fake-tts-v2", "cpu", machine=CUDA_12GB, platform="linux", cache={})
    assert plans[0].device == "cpu"
    assert plans[0].compute_type == "fp32"


def test_tts_pick_quant_cuda_machine_override_cuda_still_picks_bf16():
    # override='cuda' is already a superset of the un-scoped GPU-preferring
    # walk on this fixture -> unchanged behavior.
    got = planner._tts_pick_quant(_tts_variant_card_v2(), CUDA_12GB, override="cuda")
    assert got == "bf16"


def test_tts_pick_quant_override_with_no_matching_device_falls_back():
    # The fixture has no gpu-dml row at all -> the override-scoped runnable
    # set is empty, so this gracefully falls back to the machine-wide
    # (un-scoped) narrowing rather than raising or picking nothing.
    got = planner._tts_pick_quant(_tts_variant_card_v2(), CUDA_12GB, override="dml")
    assert got == "bf16"


# ── resolve_tts: downloaded-fp32 cpu tail for a cpu-less narrowed ct ─────
# _tts_variant_card_v2's bf16 row is gpu-cuda ONLY (no cpu row at all); a CUDA
# machine narrows to it because it outranks fp32 (see
# test_tts_pick_quant_rank_beats_declaration_order). A bf16-only download
# then has nothing to fall back to on a load failure -- an honest single
# plan. But when fp32 (which DOES have a cpu row) is ALSO already downloaded
# alongside bf16, that cpu-loadable file is already sitting on disk, so
# resolve_tts appends it as a last-resort tail: a CUDA machine with BOTH
# variants downloaded degrades to cpu fp32 on a bf16 load failure instead of
# hard-failing. The tail only ever uses an ALREADY-DOWNLOADED variant, so
# bf16-only downloads and fresh (nothing downloaded) recommendations are
# unaffected.


def test_resolve_tts_appends_cpu_fp32_tail_when_both_variants_downloaded(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card_v2())
    plans = planner.resolve_tts("fake-tts-v2", machine=CUDA_12GB, platform="linux", cache={},
                                downloaded=frozenset({"fp32", "bf16"}))
    assert [(p.device, p.compute_type) for p in plans] == [("cuda", "bf16"), ("cpu", "fp32")]


def test_resolve_tts_no_cpu_tail_when_only_bf16_downloaded(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card_v2())
    plans = planner.resolve_tts("fake-tts-v2", machine=CUDA_12GB, platform="linux", cache={},
                                downloaded=frozenset({"bf16"}))
    assert [(p.device, p.compute_type) for p in plans] == [("cuda", "bf16")]


def test_resolve_tts_no_cpu_tail_when_nothing_downloaded(monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card_v2())
    plans = planner.resolve_tts("fake-tts-v2", machine=CUDA_12GB, platform="linux", cache={})
    assert [(p.device, p.compute_type) for p in plans] == [("cuda", "bf16")]


# ── _plan_config: card → PlanConfig derivation (direct + resolve-level) ──
# Characterisation coverage hole: nothing previously asserted that RESOLVING
# a model actually produces the right PlanConfig (only that an explicit
# PlanConfig behaves correctly once inside a Plan). These pin both the direct
# card->PlanConfig derivation and its propagation through resolve_translate/
# resolve_tts, so a future change that forgets to thread it is caught.


def test_plan_config_qwen3_06b_disables_thinking_and_appends_no_think():
    # qwen3-0.6b is plain Qwen3: belt-and-braces both the chat-template kill
    # switch AND the /no_think soft switch (see catalog.TranslateModel docstring).
    card = catalog.translate_model("qwen3-0.6b")
    assert planner._plan_config(card) == planner.PlanConfig(disable_thinking=True, append_no_think=True)


def test_plan_config_qwen35_08b_disables_thinking_without_no_think():
    # qwen3.5 only needs the chat-template switch -- append_no_think stays False.
    card = catalog.translate_model("qwen3.5-0.8b")
    assert planner._plan_config(card) == planner.PlanConfig(disable_thinking=True, append_no_think=False)


def test_plan_config_qwen25_05b_is_fully_inert():
    # A plain (non-thinking-mode) translate card carries an all-default,
    # behaviour-inert PlanConfig.
    card = catalog.translate_model("qwen2.5-0.5b")
    assert planner._plan_config(card) == planner.PlanConfig()


def test_resolve_translate_propagates_qwen3_thinking_config():
    # Resolve-level propagation: a real resolve() call, not a hand-built Plan,
    # must carry the card's derived PlanConfig through to the Plan it returns.
    plans = planner.resolve_translate("qwen3-0.6b", "auto", machine=CUDA_12GB, platform="linux",
                                      cache={}, downloaded=set(),
                                      est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert plans[0].config == planner.PlanConfig(disable_thinking=True, append_no_think=True)
    # every plan for this model shares the same card-derived config.
    assert all(p.config == plans[0].config for p in plans)
