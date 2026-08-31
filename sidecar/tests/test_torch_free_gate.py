"""Verification gate (torch-free plan): no heavyweight torch-era import may
reappear anywhere under sokuji_sidecar/. AST-based so comments/docstrings
mentioning the names stay allowed."""
import ast
import pathlib

# gone in slice 2: ASR runs through sokuji_native (onnxruntime follows in
# slice 5). gone in slice 3: translation runs through sokuji_native too — the
# D3 CTranslate2/Opus-MT adoption is over, its dependency and the
# ct2_opus_translate/llamacpp_* backends are deleted. gone in slice 4: TTS
# runs through sokuji_native too — sherpa_onnx (the sherpa_tts backend),
# mlx_audio (the mlx_audio_tts backend), sentencepiece/tokenizers (MOSS's ORT
# runtime / the deleted qwen_tokenizer.py), and the GPT-SoVITS G2P stack's
# dependencies (jieba/pypinyin/g2pM/nltk/pyopenjtalk) are all freed along
# with the nine ONNX/sherpa/MLX TTS backends (fix round 1: mlx_audio/
# sentencepiece/tokenizers were a review-flagged gap in the original list).
BANNED = {"torch", "torchaudio", "transformers", "funasr", "librosa",
          "faster_whisper", "modelscope", "mistral_common", "transcribe_cpp",
          "ctranslate2", "sherpa_onnx", "jieba", "pypinyin", "g2pM", "nltk",
          "pyopenjtalk", "mlx_audio", "sentencepiece", "tokenizers"}
PKG = pathlib.Path(__file__).resolve().parents[1] / "sokuji_sidecar"


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
