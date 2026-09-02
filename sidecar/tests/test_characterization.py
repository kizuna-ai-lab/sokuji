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
# that machine (see accel._installed) — every in-process backend (ASR,
# translate, and — since slice 4 — TTS) runs through the one sokuji_native
# wheel, so there is no longer a hardware-specific backend set (the nine
# ONNX/sherpa/MLX TTS backends and their mlx/mlx_audio-only Apple Silicon
# split are gone).
_ALL_BACKENDS = frozenset({
    "native_asr", "native_asr_stream", "native_translate", "native_tts",
})
_APPLE_BACKENDS = _ALL_BACKENDS

CPU_ONLY = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
    installed=_ALL_BACKENDS, fingerprint="char-cpu",
    tc_kinds=("cpu",), gpus=(),
)

CUDA_12GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=16, apple_silicon=False,
    installed=_ALL_BACKENDS, fingerprint="char-cuda12",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 * (1 << 30)),),
)

CUDA_24GB = accel.Machine(
    os="Linux", arch="x86_64", cpu_cores=32, apple_silicon=False,
    installed=_ALL_BACKENDS, fingerprint="char-cuda24",
    tc_kinds=("vulkan", "cpu"),
    gpus=(("vulkan", "NVIDIA GeForce RTX 4090", 24 * (1 << 30)),),
)

APPLE_SILICON = accel.Machine(
    os="Darwin", arch="arm64", cpu_cores=10, apple_silicon=True,
    installed=_APPLE_BACKENDS, fingerprint="char-apple",
    tc_kinds=("metal", "cpu"), gpus=(("metal", "Apple M2", 16 << 30),),
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
    ('sense-voice', CPU_ONLY, 'auto', [('native_asr', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q4_K_M.gguf', 1.0)]),
    ('sense-voice', CPU_ONLY, 'cpu', [('native_asr', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q4_K_M.gguf', 1.0)]),
    ('sense-voice', CUDA_12GB, 'auto', [('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_12GB, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_24GB, 'auto', [('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', CUDA_24GB, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', APPLE_SILICON, 'auto', [('native_asr', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('sense-voice', APPLE_SILICON, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0), ('native_asr', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CPU_ONLY, 'auto', [('native_asr', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CPU_ONLY, 'cpu', [('native_asr', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0)]),
    ('cohere-transcribe-03-2026', CUDA_12GB, 'auto', [('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_12GB, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_24GB, 'auto', [('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', CUDA_24GB, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', APPLE_SILICON, 'auto', [('native_asr', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('cohere-transcribe-03-2026', APPLE_SILICON, 'cpu', [('native_asr', 'cpu', 'cpu', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0), ('native_asr', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q8_0.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CPU_ONLY, 'auto', [('native_asr_stream', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CPU_ONLY, 'cpu', [('native_asr_stream', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf', 1.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_12GB, 'auto', [('native_asr_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_12GB, 'cpu', [('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_24GB, 'auto', [('native_asr_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', CUDA_24GB, 'cpu', [('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'gpu-vulkan', 'vulkan', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', APPLE_SILICON, 'auto', [('native_asr_stream', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
    ('nemotron-3.5-asr-streaming', APPLE_SILICON, 'cpu', [('native_asr_stream', 'cpu', 'cpu', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0), ('native_asr_stream', 'gpu-metal', 'metal', 'q8_0', 'handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', 2.0)]),
]


@pytest.mark.parametrize("model_id, machine, override, expected", ASR_MATRIX)
def test_resolve_asr_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected


TRANSLATE_MATRIX = [
    ('qwen3-0.6b', CPU_ONLY, 'auto', [('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CPU_ONLY, 'cpu', [('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', CUDA_12GB, 'auto', [('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CUDA_12GB, 'cpu', [('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', CUDA_24GB, 'auto', [('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', CUDA_24GB, 'cpu', [('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3-0.6b', APPLE_SILICON, 'auto', [('native_translate', 'gpu-metal', 'metal', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0)]),
    ('qwen3-0.6b', APPLE_SILICON, 'cpu', [('native_translate', 'cpu', 'cpu', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0), ('native_translate', 'gpu-metal', 'metal', 'q8_0', 'Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf', 2.0), ('native_translate', 'gpu-metal', 'metal', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)]),
    ('qwen3.5-0.8b', CPU_ONLY, 'auto', [('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)]),
    ('qwen3.5-0.8b', CPU_ONLY, 'cpu', [('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_12GB, 'auto', [('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_12GB, 'cpu', [('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_24GB, 'auto', [('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', CUDA_24GB, 'cpu', [('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'gpu-vulkan', 'vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', APPLE_SILICON, 'auto', [('native_translate', 'gpu-metal', 'metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    ('qwen3.5-0.8b', APPLE_SILICON, 'cpu', [('native_translate', 'cpu', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'cpu', 'cpu', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0), ('native_translate', 'gpu-metal', 'metal', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0), ('native_translate', 'gpu-metal', 'metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)]),
    # Opus-MT rows are gone (slice 3): the 13 ct2_opus_translate cards and the
    # backend that served them were deleted along with ctranslate2.
]


@pytest.mark.parametrize("model_id, machine, override, expected", TRANSLATE_MATRIX)
def test_resolve_translate_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve_translate(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected


# Re-recorded 2026-09-01/02, FOUR times: first for slice 4 landing TTS on the
# native library (every card a single-file audio.cpp GGUF), then for R19
# (the slice-4 CI dry run's mac-arm64 metal lane: supertonic's first
# real-GPU contact aborted hard inside upstream ggml's Metal backend --
# "unsupported op", ggml-metal-ops.cpp:204 -- and Vulkan TTS was never
# validated either, since headless CI runners have no GPU to exercise it),
# then for the R19 follow-up / R25 (task 8): a GB10 dev box gave the first
# real Vulkan TTS contact, and all five families passed the crash/
# correctness bar AND gained a gpu-vulkan tier (see
# catalog._TTS_TIER_OVERRIDES' own comment for the per-family evidence) --
# moss_tts_nano/supertonic/qwen3_tts/pocket_tts (the four families this
# matrix covers; omnivoice-0.6b isn't in it). pocket_tts's path there was not
# straight: ruling R28 (a task-8 fix-round addition) briefly pinned it
# cpu-only on a single, not-apples-to-apples, cross-session comparison that
# read its Vulkan run as slower; ruling R29 (the very next fix round)
# superseded R28 after a controlled re-measurement found the OPPOSITE -- a
# 5-9x GPU speedup, no measurement in either round favoring cpu -- so
# pocket_tts's rows below carry gpu-vulkan exactly like the other three.
# Then a fourth time for ruling R36 (slice-5b task 10): every family also
# regained gpu-metal, on M4 real-hardware evidence (catalog.py's R36 comment
# has the full reasoning, including why CI's own mac-arm64 lane cannot
# confirm or deny it) -- so APPLE_SILICON's rows below stopped being the
# once-permanent cpu-only holdout and now change exactly like CUDA_12GB/
# CUDA_24GB's did at task 8, just on gpu-metal/metal instead of
# gpu-vulkan/vulkan.
#
# A GPU-capable machine's 'auto' pick runs the REAL _llamacpp_variant_row
# budget fit-walk (previously always short-circuited by `gpu_possible=False`
# before a family had ANY GPU tier): CUDA_12GB/CUDA_24GB's 12GiB/24GiB
# budgets and APPLE_SILICON's 16GiB unified-memory budget all fit even the
# LARGER bf16 (or single-quant f16 for supertonic) rung fully resident, so
# 'auto' picks that larger quant on the machine's GPU tier, paired with a
# same-quant cpu floor -- a real behaviour change from the once-universal
# "rank-default quant, cpu-only" pick. A 'cpu' override still pins the cpu
# rows to the front (both quants, in rank order) but, matching
# resolve_deployments' pre-existing generic reordering (see ASR_MATRIX /
# TRANSLATE_MATRIX above for the identical shape), no longer FILTERS OUT the
# GPU rows -- they land as trailing fallback entries instead. Only CPU_ONLY
# (no "vulkan" or "metal" in tc_kinds) is unaffected by either restoration,
# so its rows alone are UNCHANGED from the original cpu-only era. Every row
# below was captured by RUNNING accel.resolve_tts against these exact
# fixtures post-task-10 (accel._downloaded_quants pinned to "nothing
# downloaded" by the autouse fixture below, same as ASR/translate), not
# hand-derived. The old sherpa ad-hoc-synthesis rows have no equivalent:
# sherpa_tts is gone and resolve_tts_card no longer synthesizes ad-hoc cards
# for unknown ids.
TTS_MATRIX = [
    ('moss-tts-nano', CPU_ONLY, 'auto', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0)]),
    ('moss-tts-nano', CPU_ONLY, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', CUDA_12GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', CUDA_12GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', CUDA_24GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', CUDA_24GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', APPLE_SILICON, 'auto', [('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    ('moss-tts-nano', APPLE_SILICON, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0), ('native_tts', 'gpu-metal', 'metal', 'q8_0', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf', 2.0), ('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf', 1.0)]),
    # supertonic-3: single quant (Q8 is upstream-broken — catalog.py's comment
    # on the row) — the auto path still runs cleanly through the same
    # _llamacpp_variant_row-shaped code with only one candidate. This is also
    # the card whose real-GPU (Metal) contact triggered R19; task 8 confirmed
    # the Metal abort does NOT reproduce on Vulkan.
    ('supertonic-3', CPU_ONLY, 'auto', [('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', CPU_ONLY, 'cpu', [('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', CUDA_12GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', CUDA_12GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', CUDA_24GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', CUDA_24GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', APPLE_SILICON, 'auto', [('native_tts', 'gpu-metal', 'metal', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('supertonic-3', APPLE_SILICON, 'cpu', [('native_tts', 'cpu', 'cpu', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0), ('native_tts', 'gpu-metal', 'metal', 'f16', 'audio-cpp/audio.cpp-gguf/Supertonic-3-GGUF/supertonic-3-f16.gguf', 2.0)]),
    ('qwen3-tts-0.6b', CPU_ONLY, 'auto', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0)]),
    ('qwen3-tts-0.6b', CPU_ONLY, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', CUDA_12GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', CUDA_12GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', CUDA_24GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', CUDA_24GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', APPLE_SILICON, 'auto', [('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    ('qwen3-tts-0.6b', APPLE_SILICON, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0), ('native_tts', 'gpu-metal', 'metal', 'q8_0', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', 2.0), ('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf', 1.0)]),
    # pocket-tts-en: load_language="english" rides in PlanConfig (asserted
    # separately below, _plan_tuples doesn't carry config) — the deployment
    # ladder itself is the same fp32-less two-quant shape as every other
    # card, and (ruling R29, superseding R28's brief cpu-only pin) its
    # CUDA_12GB/CUDA_24GB rows now change exactly like moss/supertonic/
    # qwen3_tts above.
    ('pocket-tts-en', CPU_ONLY, 'auto', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0)]),
    ('pocket-tts-en', CPU_ONLY, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', CUDA_12GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', CUDA_12GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', CUDA_24GB, 'auto', [('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', CUDA_24GB, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'gpu-vulkan', 'vulkan', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', APPLE_SILICON, 'auto', [('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
    ('pocket-tts-en', APPLE_SILICON, 'cpu', [('native_tts', 'cpu', 'cpu', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'cpu', 'cpu', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0), ('native_tts', 'gpu-metal', 'metal', 'q8_0', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', 2.0), ('native_tts', 'gpu-metal', 'metal', 'bf16', 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', 1.0)]),
]


@pytest.mark.parametrize("model_id, machine, override, expected", TTS_MATRIX)
def test_resolve_tts_matrix(model_id, machine, override, expected, monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: _platform_for(machine))
    plans = accel.resolve_tts(model_id, override, machine=machine)
    assert _plan_tuples(plans) == expected
    if model_id == "pocket-tts-en":
        assert all(p.config.tts_family == "pocket_tts" for p in plans)
        assert all(p.config.tts_language == "english" for p in plans)


# ── Downloaded-quant override: the top-level resolve()/resolve_translate()
# ── must run the file the user actually has cached, not the fresh-machine
# ── recommendation, even when they diverge. (See accel._downloaded_quants /
# ── _tc_pick_quant / select_variant docstrings.)


def test_resolve_asr_prefers_downloaded_quant_over_fresh_recommendation(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    plans = accel.resolve("cohere-transcribe-03-2026", "auto", machine=CUDA_12GB)
    assert _plan_tuples(plans) == [
        ('native_asr', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0),
        ('native_asr', 'cpu', 'cpu', 'q4_k_m', 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf', 2.0),
    ]


def test_resolve_translate_prefers_downloaded_quant_over_fresh_recommendation(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=CUDA_12GB)
    assert _plan_tuples(plans) == [
        ('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0),
        ('native_translate', 'cpu', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0),
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
    (CPU_ONLY, frozenset(), ('native_translate', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CPU_ONLY, _GEMMA_ALL_QUANTS, ('native_translate', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, frozenset(), ('native_translate', 'gpu-vulkan', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_12GB, _GEMMA_ALL_QUANTS, ('native_translate', 'gpu-vulkan', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_24GB, frozenset(), ('native_translate', 'gpu-vulkan', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (CUDA_24GB, _GEMMA_ALL_QUANTS, ('native_translate', 'gpu-vulkan', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (APPLE_SILICON, frozenset(), ('native_translate', 'gpu-metal', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
    (APPLE_SILICON, _GEMMA_ALL_QUANTS, ('native_translate', 'gpu-metal', 'q8_0', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q8_0.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, downloaded, expected", SELECT_VARIANT_MATRIX)
def test_select_variant_matrix(machine, downloaded, expected):
    budget = accel._quant_budget_bytes(machine)
    d = accel.select_variant(_GEMMA, machine, 0, None, budget_bytes=budget, downloaded=downloaded)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


# select_variant's non-GGUF-LLM (generic ONNX candidate()) branch is currently
# UNREACHABLE via the real catalog: every TranslateModel is native_translate
# (multi-tier, since slice 3 removed the ct2_opus_translate single-cpu-tier
# alternative). Not exercised here — there is no real model id that would
# take that branch.


SELECT_VARIANT_TINY_BUDGET_MATRIX = [
    (CPU_ONLY, ('native_translate', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, ('native_translate', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    (CUDA_24GB, ('native_translate', 'cpu', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
    # Apple Silicon is UNIFIED memory: moving to cpu frees nothing and loses
    # Metal throughput, so a tiny budget still keeps the gpu-metal tier
    # instead of falling to CPU.
    (APPLE_SILICON, ('native_translate', 'gpu-metal', 'q4_k_m', 'mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf', 2.0)),
]


@pytest.mark.parametrize("machine, expected", SELECT_VARIANT_TINY_BUDGET_MATRIX)
def test_select_variant_tiny_budget(machine, expected):
    d = accel.select_variant(_GEMMA, machine, 0, None, budget_bytes=1_000_000, downloaded=set())
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


_QWEN35 = catalog.translate_model("qwen3.5-0.8b")
_QWEN35_ALL_QUANTS = {"q4_k_m", "q8_0"}

LLAMACPP_VARIANT_ROW_MATRIX = [
    (CPU_ONLY, frozenset(), ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CPU_ONLY, _QWEN35_ALL_QUANTS, ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, frozenset(), ('native_translate', 'gpu-vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_12GB, _QWEN35_ALL_QUANTS, ('native_translate', 'gpu-vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_24GB, frozenset(), ('native_translate', 'gpu-vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (CUDA_24GB, _QWEN35_ALL_QUANTS, ('native_translate', 'gpu-vulkan', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (APPLE_SILICON, frozenset(), ('native_translate', 'gpu-metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
    (APPLE_SILICON, _QWEN35_ALL_QUANTS, ('native_translate', 'gpu-metal', 'q8_0', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, downloaded, expected", LLAMACPP_VARIANT_ROW_MATRIX)
def test_llamacpp_variant_row_matrix(machine, downloaded, expected):
    budget = accel._quant_budget_bytes(machine)
    d = accel._llamacpp_variant_row(_QWEN35, machine, None, 0, budget, downloaded=downloaded)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


LLAMACPP_VARIANT_ROW_TINY_BUDGET_MATRIX = [
    # Discrete GPUs: budget below _LLAMA_MIN_FIT_FRACTION (50%) of the
    # smallest quant -> the row drops fully to the cpu tier at the
    # rank-default quant.
    (CPU_ONLY, ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_12GB, ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    (CUDA_24GB, ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
    # Apple Silicon: unified memory -> stays on gpu-metal regardless of budget.
    (APPLE_SILICON, ('native_translate', 'gpu-metal', 'q4_k_m', 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf', 2.0)),
]


@pytest.mark.parametrize("machine, expected", LLAMACPP_VARIANT_ROW_TINY_BUDGET_MATRIX)
def test_llamacpp_variant_row_tiny_budget(machine, expected):
    d = accel._llamacpp_variant_row(_QWEN35, machine, None, 0, 1_000_000, downloaded=set())
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected


_QWEN06 = catalog.translate_model("qwen3-0.6b")

LLAMACPP_VARIANT_ROW_PIN_MATRIX = [
    (CPU_ONLY, ('native_translate', 'cpu', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (CUDA_12GB, ('native_translate', 'gpu-vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (CUDA_24GB, ('native_translate', 'gpu-vulkan', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
    (APPLE_SILICON, ('native_translate', 'gpu-metal', 'q4_k_m', 'unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf', 1.0)),
]


@pytest.mark.parametrize("machine, expected", LLAMACPP_VARIANT_ROW_PIN_MATRIX)
def test_llamacpp_variant_row_pin_wins_over_budget(machine, expected):
    # A pin to the (rank 1.0, non-default) q4_k_m quant is honored
    # unconditionally -- the user's will -- even though q8_0 is the
    # rank-default for qwen3-0.6b. If the pinned quant doesn't actually fit,
    # that's a load-time question, not a quant-picking one: the GPU load
    # fails cleanly and load_with_fallback demotes to the cpu floor.
    budget = accel._quant_budget_bytes(machine)
    d = accel._llamacpp_variant_row(_QWEN06, machine, "q4_k_m", 0, budget)
    assert (d.backend, d.tier, d.compute_type, d.artifact, d.rank) == expected
