"""G2P tests for the vendored GPT-SoVITS runtime.

Asset-dependent tests (zh/en need dict files from the model card) are gated on
SOKUJI_GPT_SOVITS_ASSETS pointing at a local GenieData dir; ja is self-contained.
"""
import os

import pytest

ASSETS = os.environ.get("SOKUJI_GPT_SOVITS_ASSETS", "")
needs_assets = pytest.mark.skipif(
    not (ASSETS and os.path.isdir(os.path.join(ASSETS, "G2P", "ChineseG2P"))),
    reason="SOKUJI_GPT_SOVITS_ASSETS not set to a GenieData dir")


def _configure():
    from sokuji_sidecar.gpt_sovits import assets
    assets.configure(
        chinese_g2p_dir=os.path.join(ASSETS, "G2P", "ChineseG2P"),
        english_g2p_dir=os.path.join(ASSETS, "G2P", "EnglishG2P"),
    )


def test_assets_unconfigured_raises():
    import importlib
    from sokuji_sidecar.gpt_sovits import assets
    importlib.reload(assets)  # reset module state
    with pytest.raises(RuntimeError, match="configure"):
        assets.chinese_g2p_dir()


@needs_assets
def test_chinese_basic_sentence_produces_phones():
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("今天天气不错。", "chinese")
    assert seq.size > 0
    assert bert.shape == (seq.size if seq.ndim == 1 else seq.shape[-1], 1024) or bert.shape[1] == 1024


@needs_assets
def test_chinese_syllabic_nasal_does_not_crash():
    # Upstream Genie-TTS 2.0.2 raises IndexError in ToneSandhi for 嗯 (spike
    # 2026-07-16, .spike/out/README.md). The vendored copy must not.
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    for text in ("嗯。", "嗯", "嗯嗯。"):
        seq, _ = get_phones_and_bert(text, "chinese")
        assert seq.size > 0


@needs_assets
def test_english_basic_sentence_produces_phones():
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("The meeting starts at three.", "english")
    assert seq.size > 0


def test_japanese_basic_sentence_produces_phones():
    # pyopenjtalk-plus is self-contained (bundled dict) — no assets needed.
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("会議は三時からです。", "japanese")
    assert seq.size > 0


def test_zero_bert_fallback_shape_matches_phones():
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("はい。", "japanese", roberta=None)
    assert bert.shape[-1] == 1024


def test_text_splitter_min_len_and_flush():
    from sokuji_sidecar.gpt_sovits.text_splitter import TextSplitter
    ts = TextSplitter(max_len=40, min_len=5)
    parts = ts.feed("短。这是一个足够长的句子，应当被切分出来。")
    parts += ts.flush()
    joined = "".join(parts)
    assert "足够长的句子" in joined
    assert all(p.strip() for p in parts)


def test_vendored_tree_is_torch_free():
    # AST gate: no vendored module may import torch/librosa/transformers.
    import ast, pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "sokuji_sidecar" / "gpt_sovits"
    banned = {"torch", "librosa", "transformers", "jieba_fast"}
    for py in root.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                assert n.split(".")[0] not in banned, f"{py}: banned import {n}"
