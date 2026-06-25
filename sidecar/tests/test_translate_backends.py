from unittest.mock import MagicMock
import os
import pytest
from sokuji_sidecar import translate_backends as tb
from sokuji_sidecar import backends


class FakeInputs(dict):
    def to(self, device):
        return self


def _fake_tok(captured):
    tok = MagicMock()

    def apply_chat_template(messages, **kw):
        captured.clear()
        captured.extend(messages)
        return "PROMPT"
    tok.apply_chat_template.side_effect = apply_chat_template
    tok.side_effect = lambda prompt, **kw: FakeInputs(input_ids=MagicMock(shape=[1, 5]))
    tok.decode.return_value = "translated"
    return tok


def _fake_model():
    model = MagicMock()
    gen_out = MagicMock()
    gen_out.__getitem__ = MagicMock(return_value=MagicMock())  # out[0]
    model.generate.return_value = [gen_out]
    return model


def test_backends_are_registered():
    assert backends._BACKENDS.get("qwen_translate") is tb.QwenTranslateBackend
    assert backends._BACKENDS.get("qwen35_translate") is tb.Qwen35TranslateBackend


def test_default_prompt_mentions_langs():
    p = tb._default_prompt("Japanese", "English")
    assert "Japanese" in p and "English" in p and "only" in p.lower()


def test_strip_think_removes_block():
    assert tb._strip_think("<think>reasoning</think>  hello") == "hello"
    assert tb._strip_think("plain") == "plain"


def test_qwen3_appends_no_think_and_wraps():
    captured = []
    b = tb.QwenTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    b._ref = "Qwen/Qwen3-0.6B"
    b.translate("hi", "", "Japanese", "English", wrap=True)
    sys_msg = next(m for m in captured if m["role"] == "system")
    user_msg = next(m for m in captured if m["role"] == "user")
    assert sys_msg["content"].endswith("/no_think")
    assert user_msg["content"] == "<transcript>hi</transcript>"


def test_qwen25_no_no_think_and_bare():
    captured = []
    b = tb.QwenTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    b._ref = "Qwen/Qwen2.5-0.5B-Instruct"
    b.translate("hi", "", "Japanese", "English", wrap=False)
    sys_msg = next(m for m in captured if m["role"] == "system")
    user_msg = next(m for m in captured if m["role"] == "user")
    assert "/no_think" not in sys_msg["content"]
    assert user_msg["content"] == "hi"


def test_qwen35_load_raises_when_class_missing(monkeypatch):
    # Simulate a transformers without Qwen3_5ForConditionalGeneration.
    import sys
    fake_transformers = MagicMock()
    del fake_transformers.Qwen3_5ForConditionalGeneration  # attribute access raises AttributeError
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    b = tb.Qwen35TranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("Qwen/Qwen3.5-0.8B", "cuda", "bfloat16")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads models + needs CUDA)")
@pytest.mark.parametrize("model_id", ["qwen2.5-0.5b", "qwen3-0.6b"])
def test_qwen_translate_real_gpu(model_id):
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id=model_id, source_lang="Spanish", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and out.strip() and ms >= 0


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads models + needs CUDA + qwen3_5)")
def test_qwen35_translate_real_gpu_if_available():
    import importlib.util
    if importlib.util.find_spec("transformers.models.qwen3_5") is None:
        pytest.skip("transformers lacks qwen3_5 — Qwen3.5 rows self-gate off")
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen3.5-0.8b", source_lang="Spanish", target_lang="English", device="cuda")
    out, _ = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and out.strip()
