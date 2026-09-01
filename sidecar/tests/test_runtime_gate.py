"""Verification gate (spec §9.3/§11): no heavyweight legacy-runtime import may
reappear anywhere under sokuji_sidecar/, and requirements.txt stays pinned to
its eight-package end state. AST-based so comments/docstrings mentioning the
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
BANNED = {"torch", "torchaudio", "transformers", "funasr", "librosa",
          "faster_whisper", "modelscope", "mistral_common", "transcribe_cpp",
          "ctranslate2", "sherpa_onnx", "jieba", "pypinyin", "g2pM", "nltk",
          "pyopenjtalk", "mlx_audio", "sentencepiece", "tokenizers",
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


def test_base_requirements_is_the_eight_package_end_state():
    # numpy, websockets, huggingface_hub, psutil, zstandard, soundfile, soxr
    # (7 PyPI packages) + sokuji-native (installed separately by setup.sh,
    # not a requirements.txt line — see the file's own trailing comment).
    base = SIDE / "requirements.txt"
    names = {ln.split("==")[0].split(">=")[0].strip() for ln in _reqs(base)}
    assert names == {"numpy", "websockets", "huggingface_hub", "psutil",
                     "zstandard", "soundfile", "soxr"}
