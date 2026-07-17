"""Characterisation safety net for sokuji_sidecar.accel's planner surface.

Task 1 of the accel.py split (planner.py + Loader, catalog-card declarative
fields). This suite does not test "correctness" — it PINS the current, actual
output of resolve() / resolve_translate() / resolve_tts() and the three quant
pickers (_tc_pick_quant / select_variant / _llamacpp_variant_row) across a
representative Machine x model x override matrix. Every value below was
captured by RUNNING the current code, not derived from the docstrings — this
file IS the behaviour-preservation contract for every later refactor task.
If a later task changes one of these assertions, that is a real behaviour
change and must be justified, not "fixed" to make the test pass.

Determinism notes:
  * Every Machine fixture is constructed directly (mirrors what accel.probe()
    would assemble on that hardware) and passed via the `machine=` kwarg that
    resolve()/resolve_translate()/resolve_tts() all accept — no probe()
    monkeypatching needed anywhere in this file.
  * `accel._downloaded_quants` hits the REAL local HuggingFace cache
    (huggingface_hub.hf_hub_download(..., local_files_only=True)). This dev
    box already has some of the target repos partially cached (see git log /
    ambient ~/.cache/huggingface), which would make "auto" quant selection
    depend on this machine's incidental download history rather than the
    catalog's stable memory-basis logic. An autouse fixture below pins it to
    "nothing downloaded" for every test (the same pattern tests/test_accel.py
    already uses per-test); the couple of tests that care about the
    downloaded-quant-wins behaviour override it explicitly.
  * `accel.current_platform()` reads the REAL host OS (platform.system()),
    independently of the Machine object — it is the D9 catalog platform
    filter's source of truth (see accel.py:52-59 and tests/test_platform_
    filter.py). It is pinned per-test to the OS the Machine fixture
    represents, so the macOS-only mlx_audio_tts deployment rows resolve
    correctly even though this suite runs on a Linux CI/dev box.
  * `accel.bench_load` is pinned to {} by the autouse fixture below so the
    RTF/tps bench cache (which can demote a plan in AUTO mode) never leaks in
    from a real run — deterministic regardless of any ambient SOKUJI_BENCH_DIR.
"""
import pytest

from sokuji_sidecar import accel, catalog


# ── Machine fixtures ─────────────────────────────────────────────────────
# Backend "installed" status models which Python packages are importable on
# that machine (see accel._installed) — independent of hardware, except
# mlx/mlx_audio_tts which only ever run on Apple Silicon in practice.
_ALL_BACKENDS = frozenset({
    "transcribe_cpp", "transcribe_cpp_stream", "sherpa_tts", "moss_onnx",
    "supertonic", "qwen3tts_onnx", "pocket_onnx", "onnx", "llamacpp_qwen",
    "llamacpp_hunyuan", "llamacpp_gemma", "ct2_opus_translate",
})
_APPLE_BACKENDS = _ALL_BACKENDS | {"mlx_audio_tts", "mlx"}

CPU_ONLY = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="char-cpu",
    tc_kinds=("cpu",), gpus=(), ort_cuda=False,
)

CUDA_12GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=16, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="char-cuda12",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 * (1 << 30)),),
    ort_cuda=False,
)

CUDA_24GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=32, apple_silicon=False,
    dml_adapters=(), installed=_ALL_BACKENDS, fingerprint="char-cuda24",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4090", 24 * (1 << 30)),),
    ort_cuda=False,
)

APPLE_SILICON = accel.Machine(
    os="Darwin", arch="arm64", cpu_cores=10, apple_silicon=True,
    dml_adapters=(), installed=_APPLE_BACKENDS, fingerprint="char-apple",
    tc_kinds=("metal", "cpu"), gpus=(("metal", "Apple M2", 16 << 30),), ort_cuda=False,
)

_ALL_MACHINES = (CPU_ONLY, CUDA_12GB, CUDA_24GB, APPLE_SILICON)


def _platform_for(machine) -> str:
    """The OS accel.current_platform() must report for `machine`'s catalog
    platform filter (D9) to behave as it would on real hardware of that kind."""
    return "macos" if machine is APPLE_SILICON else "linux"


@pytest.fixture(autouse=True)
def _nothing_downloaded(monkeypatch):
    """Default: no quant/variant is in the local HF cache, and the RTF/tps
    bench cache is empty. Isolates every test in this file from this dev box's
    ambient ~/.cache/huggingface and SOKUJI_BENCH_DIR state (see module
    docstring)."""
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    monkeypatch.setattr(accel, "bench_load", lambda: {})


def _plan_tuples(plans):
    return [(p.backend, p.tier, p.device, p.compute_type, p.artifact, p.rank)
            for p in plans]


# ── Step 2: resolve() / resolve_translate() / resolve_tts() snapshots ─────
# Each row: (model_id, machine, override, expected [(backend, tier, device,
# compute_type, artifact, rank), ...]). Captured by running accel.resolve*
# against the fixtures above with override in {"auto", "cpu"}.

ASR_MATRIX = [
    ('sense-voice', CPU_ONLY, 'auto', [('transcribe_cpp', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q4_K_M.gguf', 1.0)]),
    ('sense-voice', CPU_ONLY, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q4_K_M.gguf', 1.0)]),
    ('sense-voice', CUDA_12GB, 'auto', [('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_12GB, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_24GB, 'auto', [('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_24GB, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', APPLE_SILICON, 'auto', [('transcribe_cpp', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', APPLE_SILICON, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('transcribe_cpp', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CPU_ONLY, 'auto', [('transcribe_cpp', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CPU_ONLY, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CUDA_12GB, 'auto', [('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_12GB, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_24GB, 'auto', [('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_24GB, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', APPLE_SILICON, 'auto', [('transcribe_cpp', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', APPLE_SILICON, 'cpu', [('transcribe_cpp', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('transcribe_cpp', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CPU_ONLY, 'auto', [('transcribe_cpp_stream', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CPU_ONLY, 'cpu', [('transcribe_cpp_stream', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_12GB, 'auto', [('transcribe_cpp_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_12GB, 'cpu', [('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_24GB, 'auto', [('transcribe_cpp_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_24GB, 'cpu', [('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', APPLE_SILICON, 'auto', [('transcribe_cpp_stream', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', APPLE_SILICON, 'cpu', [('transcribe_cpp_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('transcribe_cpp_stream', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
]


@pytest.mark.parametrize("model_id, machine, override, expected", ASR_MATRIX)
def test_resolve_asr_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected


TRANSLATE_MATRIX = [
    ('qwen3-0.6b', CPU_ONLY, 'auto', [('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CPU_ONLY, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', CUDA_12GB, 'auto', [('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CUDA_12GB, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', CUDA_24GB, 'auto', [('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CUDA_24GB, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', APPLE_SILICON, 'auto', [('llamacpp_qwen', 'gpu-metal', 'metal', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', APPLE_SILICON, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('llamacpp_qwen', 'gpu-metal', 'metal', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('llamacpp_qwen', 'gpu-metal', 'metal', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3.5-0.8b', CPU_ONLY, 'auto', [('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)]),
    ('qwen3.5-0.8b', CPU_ONLY, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_12GB, 'auto', [('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_12GB, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_24GB, 'auto', [('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_24GB, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'gpu-cuda', 'cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', APPLE_SILICON, 'auto', [('llamacpp_qwen', 'gpu-metal', 'metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', APPLE_SILICON, 'cpu', [('llamacpp_qwen', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('llamacpp_qwen', 'gpu-metal', 'metal', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('llamacpp_qwen', 'gpu-metal', 'metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('opus-mt-en-zh', CPU_ONLY, 'auto', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', CPU_ONLY, 'cpu', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', CUDA_12GB, 'auto', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', CUDA_12GB, 'cpu', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', CUDA_24GB, 'auto', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', CUDA_24GB, 'cpu', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', APPLE_SILICON, 'auto', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
    ('opus-mt-en-zh', APPLE_SILICON, 'cpu', [('ct2_opus_translate', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/opus-mt-en-zh-ct2', 1.0)]),
]


@pytest.mark.parametrize("model_id, machine, override, expected", TRANSLATE_MATRIX)
def test_resolve_translate_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve_translate(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected


TTS_MATRIX = [
    ('moss-tts-nano', CPU_ONLY, 'auto', [('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', CPU_ONLY, 'cpu', [('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', CUDA_12GB, 'auto', [('moss_onnx', 'gpu-cuda', 'cuda', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0), ('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', CUDA_12GB, 'cpu', [('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0), ('moss_onnx', 'gpu-cuda', 'cuda', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', CUDA_24GB, 'auto', [('moss_onnx', 'gpu-cuda', 'cuda', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0), ('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', CUDA_24GB, 'cpu', [('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0), ('moss_onnx', 'gpu-cuda', 'cuda', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', APPLE_SILICON, 'auto', [('mlx_audio_tts', 'gpu-metal', 'metal', 'fp32', 'mlx-community/MOSS-TTS-Nano-100M', 1.0), ('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0)]),
    ('moss-tts-nano', APPLE_SILICON, 'cpu', [('moss_onnx', 'cpu', 'cpu', 'fp32', 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX', 1.0), ('mlx_audio_tts', 'gpu-metal', 'metal', 'fp32', 'mlx-community/MOSS-TTS-Nano-100M', 1.0)]),
    # P7 (Task 6): qwen3-tts-0.6b became a multi-variant card (per-variant
    # self-contained fp32/bf16 ONNX repos, no shared-repo subdir) -- a real
    # behaviour change, re-captured here by RUNNING the new planner code
    # (not hand-derived). On a CUDA-capable machine the multi-variant
    # narrowing (planner._tts_pick_quant) now picks bf16 UNCONDITIONALLY --
    # before the override is applied -- and bf16 ships no cpu row, so
    # override='cpu' still resolves to the single gpu-cuda bf16 plan (no cpu
    # fallback plan exists for it to fall back to).
    ('qwen3-tts-0.6b', CPU_ONLY, 'auto', [('qwen3tts_onnx', 'cpu', 'cpu', 'fp32', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32', 1.0)]),
    ('qwen3-tts-0.6b', CPU_ONLY, 'cpu', [('qwen3tts_onnx', 'cpu', 'cpu', 'fp32', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32', 1.0)]),
    ('qwen3-tts-0.6b', CUDA_12GB, 'auto', [('qwen3tts_onnx', 'gpu-cuda', 'cuda', 'bf16', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-bf16', 1.2)]),
    ('qwen3-tts-0.6b', CUDA_12GB, 'cpu', [('qwen3tts_onnx', 'gpu-cuda', 'cuda', 'bf16', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-bf16', 1.2)]),
    ('qwen3-tts-0.6b', CUDA_24GB, 'auto', [('qwen3tts_onnx', 'gpu-cuda', 'cuda', 'bf16', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-bf16', 1.2)]),
    ('qwen3-tts-0.6b', CUDA_24GB, 'cpu', [('qwen3tts_onnx', 'gpu-cuda', 'cuda', 'bf16', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-bf16', 1.2)]),
    ('qwen3-tts-0.6b', APPLE_SILICON, 'auto', [('mlx_audio_tts', 'gpu-metal', 'metal', 'fp32', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit', 1.0), ('qwen3tts_onnx', 'cpu', 'cpu', 'fp32', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32', 1.0)]),
    ('qwen3-tts-0.6b', APPLE_SILICON, 'cpu', [('qwen3tts_onnx', 'cpu', 'cpu', 'fp32', 'jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32', 1.0), ('mlx_audio_tts', 'gpu-metal', 'metal', 'fp32', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit', 1.0)]),
    # Carded sherpa voice (one repo = one model = one voice) — CPU-only by
    # reality across every machine: the stock sherpa-onnx wheel bundles a
    # CPU-only ORT (D11), so no GPU tier row exists for it at all.
    ('csukuangfj/vits-piper-en_US-amy-low', CPU_ONLY, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', CPU_ONLY, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', CUDA_12GB, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', CUDA_12GB, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', CUDA_24GB, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', CUDA_24GB, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', APPLE_SILICON, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    ('csukuangfj/vits-piper-en_US-amy-low', APPLE_SILICON, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-amy-low', 1.0)]),
    # UNcatalogued sherpa voice id (not a row in catalog.TTS_MODELS at all) —
    # resolve_tts() must still synthesize an ad-hoc single-cpu-deployment
    # model for it because it matches a _SHERPA_TTS_HINTS token ("piper").
    ('csukuangfj/vits-piper-en_US-ryan-medium', CPU_ONLY, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', CPU_ONLY, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', CUDA_12GB, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', CUDA_12GB, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', CUDA_24GB, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', CUDA_24GB, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', APPLE_SILICON, 'auto', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    ('csukuangfj/vits-piper-en_US-ryan-medium', APPLE_SILICON, 'cpu', [('sherpa_tts', 'cpu', 'cpu', 'fp32', 'csukuangfj/vits-piper-en_US-ryan-medium', 1.0)]),
    # Pocket TTS: cpu-only single-deployment card — every machine resolves the
    # same one-plan ladder regardless of GPUs present (like the piper rows).
    ('pocket-tts-en', CPU_ONLY, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', CPU_ONLY, 'cpu', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', CUDA_12GB, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', APPLE_SILICON, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
]


@pytest.mark.parametrize("model_id, machine, override, expected", TTS_MATRIX)
def test_resolve_tts_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve_tts(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected


# ── Downloaded-quant override: the top-level resolve()/resolve_translate()
# ── must run the file the user actually has cached, not the fresh-machine
# ── recommendation, even when they diverge. (See accel._downloaded_quants /
# ── _tc_pick_quant / select_variant docstrings.)


def test_resolve_asr_prefers_downloaded_quant_over_fresh_recommendation(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    plans = accel.resolve("cohere-transcribe-03-2026", "auto", machine=CUDA_12GB)
    assert _plan_tuples(plans) == [
        ('transcribe_cpp', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0),
        ('transcribe_cpp', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0),
    ]


def test_resolve_translate_prefers_downloaded_quant_over_fresh_recommendation(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=CUDA_12GB)
    assert _plan_tuples(plans) == [
        ('llamacpp_gemma', 'gpu-cuda', 'cuda', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0),
        ('llamacpp_gemma', 'cpu', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0),
    ]


# ── Step 2 (pickers): _tc_pick_quant / select_variant / _llamacpp_variant_row
# ── direct snapshots, across machine fixtures x downloaded sets, including a
# ── "nothing fits / tiny budget" case.

_COHERE = catalog.asr_model("cohere-transcribe-03-2026")
_COHERE_ALL_QUANTS = {"f16", "q8_0", "q6_k", "q5_k_m", "q4_k_m"}

# (machine, downloaded, expected quant). budget is always
# accel._quant_budget_bytes(machine) (the stable per-machine basis), except
# the last row of each machine which passes an explicitly tiny budget.
TC_PICK_QUANT_MATRIX = [
    (CPU_ONLY, frozenset(), 'q4_k_m'),          # no GPU: smallest quant wins, budget ignored
    (CPU_ONLY, _COHERE_ALL_QUANTS, 'q4_k_m'),   # still no GPU: downloaded set can't unlock GPU logic
    (CUDA_12GB, frozenset(), 'q8_0'),           # 12GB fits the curated q8_0 upgrade
    (CUDA_12GB, _COHERE_ALL_QUANTS, 'f16'),     # all rungs cached -> the (listed-only) f16 rung unlocks
    (CUDA_24GB, frozenset(), 'q8_0'),           # 24GB still only curated q8_0 (f16 not auto-recommended)
    (CUDA_24GB, _COHERE_ALL_QUANTS, 'f16'),     # ... but f16 wins once it's actually downloaded
    (APPLE_SILICON, frozenset(), 'q8_0'),       # 16GiB unified memory fits the curated q8_0 upgrade
    (APPLE_SILICON, _COHERE_ALL_QUANTS, 'f16'), # ... but f16 wins once it's actually downloaded
]


@pytest.mark.parametrize("machine, downloaded, expected", TC_PICK_QUANT_MATRIX)
def test_tc_pick_quant_matrix(machine, downloaded, expected):
    budget = accel._quant_budget_bytes(machine)
    assert accel._tc_pick_quant(_COHERE, machine, None, budget, downloaded=downloaded) == expected


@pytest.mark.parametrize("machine", _ALL_MACHINES)
def test_tc_pick_quant_tiny_budget_falls_back_to_curated_default(machine):
    # Even on a GPU-capable machine, an absurdly small explicit budget means
    # nothing curated fits -> falls back to the rank-default quant (q4_k_m),
    # never silently to an even-smaller uncurated rung.
    assert accel._tc_pick_quant(_COHERE, machine, None, 1_000_000, downloaded=set()) == 'q4_k_m'


_GEMMA = catalog.translate_model("translategemma-4b")
_GEMMA_ALL_QUANTS = {"q4_k_m", "q8_0"}

SELECT_VARIANT_MATRIX = [
    (CPU_ONLY, frozenset(), ('llamacpp_gemma', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CPU_ONLY, _GEMMA_ALL_QUANTS, ('llamacpp_gemma', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, frozenset(), ('llamacpp_gemma', 'gpu-cuda', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_12GB, _GEMMA_ALL_QUANTS, ('llamacpp_gemma', 'gpu-cuda', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_24GB, frozenset(), ('llamacpp_gemma', 'gpu-cuda', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_24GB, _GEMMA_ALL_QUANTS, ('llamacpp_gemma', 'gpu-cuda', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (APPLE_SILICON, frozenset(), ('llamacpp_gemma', 'gpu-metal', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (APPLE_SILICON, _GEMMA_ALL_QUANTS, ('llamacpp_gemma', 'gpu-metal', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, downloaded, expected", SELECT_VARIANT_MATRIX)
def test_select_variant_matrix(machine, downloaded, expected):
    budget = accel._quant_budget_bytes(machine)
    d = accel.select_variant(_GEMMA, machine, 0, None, budget_bytes=budget, downloaded=downloaded)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


# select_variant's non-llamacpp (generic ONNX candidate()) branch is currently
# UNREACHABLE via the real catalog: every TranslateModel is either llamacpp_*
# (multi-tier) or ct2_opus_translate (a single cpu-only deployment, which
# candidate() always excludes via `d.tier == "cpu"`). Not exercised here —
# there is no real model id that would take that branch.


SELECT_VARIANT_TINY_BUDGET_MATRIX = [
    (CPU_ONLY, ('llamacpp_gemma', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, ('llamacpp_gemma', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_24GB, ('llamacpp_gemma', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    # Apple Silicon is UNIFIED memory: moving to cpu frees nothing and loses
    # Metal throughput, so a tiny budget still keeps the gpu-metal tier
    # (--fit is left to manage the pressure) instead of falling to CPU.
    (APPLE_SILICON, ('llamacpp_gemma', 'gpu-metal', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
]


@pytest.mark.parametrize("machine, expected", SELECT_VARIANT_TINY_BUDGET_MATRIX)
def test_select_variant_tiny_budget(machine, expected):
    d = accel.select_variant(_GEMMA, machine, 0, None, budget_bytes=1_000_000, downloaded=set())
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


_QWEN35 = catalog.translate_model("qwen3.5-0.8b")
_QWEN35_ALL_QUANTS = {"q4_k_m", "q8_0"}

LLAMACPP_VARIANT_ROW_MATRIX = [
    (CPU_ONLY, frozenset(), ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CPU_ONLY, _QWEN35_ALL_QUANTS, ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, frozenset(), ('llamacpp_qwen', 'gpu-cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_12GB, _QWEN35_ALL_QUANTS, ('llamacpp_qwen', 'gpu-cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_24GB, frozenset(), ('llamacpp_qwen', 'gpu-cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_24GB, _QWEN35_ALL_QUANTS, ('llamacpp_qwen', 'gpu-cuda', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (APPLE_SILICON, frozenset(), ('llamacpp_qwen', 'gpu-metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (APPLE_SILICON, _QWEN35_ALL_QUANTS, ('llamacpp_qwen', 'gpu-metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, downloaded, expected", LLAMACPP_VARIANT_ROW_MATRIX)
def test_llamacpp_variant_row_matrix(machine, downloaded, expected):
    budget = accel._quant_budget_bytes(machine)
    d = accel._llamacpp_variant_row(_QWEN35, machine, None, 0, budget, downloaded=downloaded)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


LLAMACPP_VARIANT_ROW_TINY_BUDGET_MATRIX = [
    # Discrete GPUs: budget below _LLAMA_MIN_FIT_FRACTION (50%) of the
    # smallest quant -> --fit offload would be slower than pure CPU, so the
    # row drops fully to the cpu tier at the rank-default quant.
    (CPU_ONLY, ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_24GB, ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    # Apple Silicon: unified memory -> stays on gpu-metal regardless of budget.
    (APPLE_SILICON, ('llamacpp_qwen', 'gpu-metal', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
]


@pytest.mark.parametrize("machine, expected", LLAMACPP_VARIANT_ROW_TINY_BUDGET_MATRIX)
def test_llamacpp_variant_row_tiny_budget(machine, expected):
    d = accel._llamacpp_variant_row(_QWEN35, machine, None, 0, 1_000_000, downloaded=set())
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


_QWEN06 = catalog.translate_model("qwen3-0.6b")

LLAMACPP_VARIANT_ROW_PIN_MATRIX = [
    (CPU_ONLY, ('llamacpp_qwen', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (CUDA_12GB, ('llamacpp_qwen', 'gpu-cuda', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (CUDA_24GB, ('llamacpp_qwen', 'gpu-cuda', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (APPLE_SILICON, ('llamacpp_qwen', 'gpu-metal', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, expected", LLAMACPP_VARIANT_ROW_PIN_MATRIX)
def test_llamacpp_variant_row_pin_wins_over_budget(machine, expected):
    # A pin to the (rank 1.0, non-default) q4_k_m quant is honored
    # unconditionally -- the user's will, --fit copes with memory -- even
    # though q8_0 is the rank-default for qwen3-0.6b.
    budget = accel._quant_budget_bytes(machine)
    d = accel._llamacpp_variant_row(_QWEN06, machine, "q4_k_m", 0, budget)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected
