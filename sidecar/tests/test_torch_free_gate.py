"""Verification gate (torch-free plan): no heavyweight torch-era import may
reappear anywhere under sokuji_sidecar/. AST-based so comments/docstrings
mentioning the names stay allowed."""
import ast
import pathlib

BANNED = {"torch", "torchaudio", "transformers", "funasr", "librosa",
          "faster_whisper", "ctranslate2", "modelscope", "mistral_common"}
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
