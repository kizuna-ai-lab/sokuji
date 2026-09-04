"""Verification gate (spec §9.3/§11): no heavyweight legacy-runtime import may
reappear anywhere under sokuji_sidecar/, and requirements.txt stays pinned to
its end state: 7 PyPI packages + 5 sokuji-native release-wheel URL lines (one
per SKU, pinned to the native-v1.0.2 GitHub Release, gated by sys_platform/
platform_machine markers). AST-based so comments/docstrings mentioning the
names stay allowed."""
import ast
import pathlib

# gone in slice 2: ASR runs through sokuji_native. gone in slice 3: translation
# runs through sokuji_native too — the D3 CTranslate2/Opus-MT adoption is over,
# its dependency and the ct2_opus_translate/llamacpp_* backends are deleted.
# gone in slice 4: TTS runs through sokuji_native too — sherpa_onnx (the
# sherpa_tts backend), mlx_audio (the mlx_audio_tts backend),
# sentencepiece/tokenizers (MOSS's ORT runtime / the deleted
# qwen_tokenizer.py), and the GPT-SoVITS G2P stack's dependencies
# (jieba/pypinyin/g2pM/nltk/pyopenjtalk) are all freed along with the nine
# ONNX/sherpa/MLX TTS backends (fix round 1: mlx_audio/sentencepiece/
# tokenizers were a review-flagged gap in the original list). gone in slice 5:
# onnxruntime — every SKU's requirements file is now just the shared base
# (sidecar/requirements.txt); ASR, translation, and TTS all run through
# sokuji_native, so no backend needs an ONNX runtime anymore.
# M-2 (final fix wave): spec §9.3 bans the whole `mlx*` family, not just
# `mlx_audio` — bare `import mlx.core` (Apple's own MLX framework, distinct
# from the mlx_audio TTS wrapper) previously passed this gate uncaught.
BANNED = {"torch", "torchaudio", "transformers", "funasr", "librosa",
          "faster_whisper", "modelscope", "mistral_common", "transcribe_cpp",
          "ctranslate2", "sherpa_onnx", "jieba", "pypinyin", "g2pM", "nltk",
          "pyopenjtalk", "mlx", "mlx_audio", "sentencepiece", "tokenizers",
          "onnxruntime"}
SIDE = pathlib.Path(__file__).resolve().parents[1]
PKG = SIDE / "sokuji_sidecar"


def _reqs(path):
    return [ln.strip() for ln in path.read_text().splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


def test_no_torch_era_imports():
    offenders = []
    for py in PKG.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                if n.split(".")[0] in BANNED:
                    offenders.append(f"{py.name}:{node.lineno} imports {n}")
    assert not offenders, offenders


NATIVE_RELEASE_BASE = (
    "https://github.com/kizuna-ai-lab/sokuji/releases/download/native-v1.0.2/"
)

# filename -> expected PEP 508 marker (sys_platform/platform_machine values are
# the literal sys.platform / platform.machine() strings CPython reports —
# packaging.markers.default_environment() sources both from those same calls).
NATIVE_WHEELS = {
    "sokuji_native-1.0.2-py3-none-manylinux_2_35_x86_64.whl":
        'sys_platform == "linux" and platform_machine == "x86_64"',
    "sokuji_native-1.0.2-py3-none-manylinux_2_35_aarch64.whl":
        'sys_platform == "linux" and platform_machine == "aarch64"',
    "sokuji_native-1.0.2-py3-none-win_amd64.whl":
        'sys_platform == "win32" and platform_machine == "AMD64"',
    "sokuji_native-1.0.2-py3-none-macosx_11_0_arm64.whl":
        'sys_platform == "darwin" and platform_machine == "arm64"',
    "sokuji_native-1.0.2-py3-none-macosx_11_0_x86_64.whl":
        'sys_platform == "darwin" and platform_machine == "x86_64"',
}


def test_base_requirements_is_the_seven_pypi_plus_five_native_wheel_end_state():
    # numpy, websockets, huggingface_hub, psutil, zstandard, soundfile, soxr
    # (7 PyPI packages, version-pinned or floor-pinned) + sokuji-native, five
    # direct-URL lines (one per SKU) pinned to the native-v1.0.2 release and
    # gated by a sys_platform/platform_machine marker so pip installs exactly
    # one per target — this is what keeps sidecar bundles from shipping
    # hollow (no sokuji_native inside).
    base = SIDE / "requirements.txt"
    lines = _reqs(base)

    native_lines = [ln for ln in lines if " @ " in ln]
    pypi_lines = [ln for ln in lines if " @ " not in ln]

    names = {ln.split("==")[0].split(">=")[0].strip() for ln in pypi_lines}
    assert names == {"numpy", "websockets", "huggingface_hub", "psutil",
                     "zstandard", "soundfile", "soxr"}

    assert len(native_lines) == 5, native_lines

    seen_files = set()
    for ln in native_lines:
        name_part, rest = ln.split("@", 1)
        assert name_part.strip() == "sokuji-native", ln
        assert ";" in rest, f"missing marker: {ln}"
        url_part, marker_part = rest.split(";", 1)
        url = url_part.strip()
        marker = marker_part.strip()
        assert url.startswith(NATIVE_RELEASE_BASE), url
        filename = url[len(NATIVE_RELEASE_BASE):]
        assert filename in NATIVE_WHEELS, f"unexpected wheel filename: {filename}"
        assert marker == NATIVE_WHEELS[filename], (filename, marker)
        seen_files.add(filename)

    assert seen_files == set(NATIVE_WHEELS), seen_files - set(NATIVE_WHEELS)
