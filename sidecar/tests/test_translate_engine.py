import asyncio, json, os
import pytest
from unittest.mock import MagicMock, patch
from sokuji_sidecar import server, translate_engine


class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang=""):
        self.langs = (source_lang, target_lang)
        return 21

    def translate(self, text, system_prompt="", wrap_transcript=False):
        return f"<{text}>", 8


def make_state():
    st = {"translate_engine": FakeTranslate(), "handlers": {}}
    translate_engine.register(st)
    return st


def test_translate_init():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate_init", "id": 1, "sourceLang": "ja", "targetLang": "en"})))
    assert reply == {"type": "ready", "id": 1, "loadTimeMs": 21}
    assert st["translate_engine"].langs == ("ja", "en")


def test_translate_returns_translation():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate", "id": 2, "text": "hola"})))
    assert binary is None
    assert reply == {"type": "translation", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}


def _make_fake_tok(captured_messages):
    """Build a fake tokenizer that records the messages list passed to
    apply_chat_template so tests can assert on user content."""
    tok = MagicMock()
    def apply_chat_template(messages, **kw):
        captured_messages.clear()
        captured_messages.extend(messages)
        return "PROMPT"
    tok.apply_chat_template.side_effect = apply_chat_template
    tok.return_value = {"input_ids": MagicMock(shape=[1, 5])}
    tok.side_effect = lambda prompt, **kw: {"input_ids": MagicMock(shape=[1, 5])}
    return tok


def _make_fake_model():
    """Build a fake causal LM whose generate() returns a tensor-like object."""
    model = MagicMock()
    gen_ids = MagicMock()
    gen_ids.__getitem__ = lambda self, key: MagicMock()  # out[0][...]
    model.generate.return_value = [gen_ids]
    return model


def _patch_transformers(captured_messages, tok=None, model=None):
    """Return a context manager patching AutoTokenizer and AutoModelForCausalLM
    inside translate_engine so no real model files are needed.  Both fakes
    accept **kwargs (incl. local_files_only) without complaint."""
    fake_tok = tok or _make_fake_tok(captured_messages)
    fake_model = model or _make_fake_model()

    class FakeTokClass:
        @staticmethod
        def from_pretrained(mid, **kwargs):
            return fake_tok

    class FakeModelClass:
        @staticmethod
        def from_pretrained(mid, **kwargs):
            return fake_model

    return patch.multiple(
        "sokuji_sidecar.translate_engine",
        **{
            "__import__": None,  # not used; we patch names directly below
        }
    )


def test_opus_to_qwen_switch_clears_opus(monkeypatch):
    """After switching from an Opus model back to the default Qwen model,
    _opus must be None so translate() uses the Qwen path.

    init() imports both opus_mt and transformers lazily via `from … import …`
    so we patch via sys.modules — the approach that works regardless of whether
    the symbols are already cached at module level.
    """
    import sys
    captured = []
    fake_tok = _make_fake_tok(captured)
    fake_model = _make_fake_model()

    # --- Fake opus_mt sub-module ---
    fake_opus_instance = MagicMock()
    fake_opus_class = MagicMock(return_value=fake_opus_instance)
    fake_opus_mt_mod = MagicMock()
    fake_opus_mt_mod.OpusMtTranslator = fake_opus_class

    # --- Fake transformers module ---
    fake_transformers_mod = MagicMock()
    fake_transformers_mod.AutoTokenizer.from_pretrained = lambda mid, **kw: fake_tok
    fake_transformers_mod.AutoModelForCausalLM.from_pretrained = lambda mid, **kw: fake_model

    monkeypatch.setitem(sys.modules, "sokuji_sidecar.opus_mt", fake_opus_mt_mod)
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers_mod)

    eng = translate_engine.TranslateEngine()

    # Step 1: init with opus-mt model → _opus must be set.
    eng.init(model_id="Xenova/opus-mt-ja-en", source_lang="ja", target_lang="en")
    assert eng._opus is not None, "_opus should be set after opus-mt init"

    # Step 2: switch to the default Qwen model → _opus must be cleared.
    eng.init(model_id=None, source_lang="ja", target_lang="en")
    assert eng._opus is None, "_opus must be cleared after switching to Qwen model"


def test_wrap_transcript_wraps_user_content(monkeypatch):
    """In the Qwen branch, user message must be <transcript>…</transcript>
    when wrap_transcript=True, and bare text when False."""
    captured = []
    fake_tok = _make_fake_tok(captured)
    fake_model = _make_fake_model()
    # Make tok(prompt) return something with input_ids
    input_ids_mock = MagicMock()
    input_ids_mock.shape = [1, 5]
    fake_tok.return_value = {"input_ids": input_ids_mock}
    # Make model.generate return something indexable
    gen_out = MagicMock()
    gen_slice = MagicMock()
    gen_out.__getitem__ = MagicMock(return_value=gen_slice)
    gen_slice.__getitem__ = MagicMock(return_value=MagicMock())
    fake_model.generate.return_value = [gen_out]
    # Make decode return a string
    fake_tok.decode.return_value = "translated"

    eng = translate_engine.TranslateEngine()
    eng._opus = None
    eng._tok = fake_tok
    eng._model = fake_model
    eng._src = "Japanese"
    eng._tgt = "English"

    # wrap_transcript=True → user content should be wrapped
    eng.translate("hello", wrap_transcript=True)
    user_msgs_wrapped = [m for m in captured if m["role"] == "user"]
    assert user_msgs_wrapped[0]["content"] == "<transcript>hello</transcript>", \
        f"expected wrapped content, got: {user_msgs_wrapped[0]['content']!r}"

    # wrap_transcript=False → user content should be bare text
    eng.translate("hello", wrap_transcript=False)
    user_msgs_bare = [m for m in captured if m["role"] == "user"]
    assert user_msgs_bare[0]["content"] == "hello", \
        f"expected bare content, got: {user_msgs_bare[0]['content']!r}"


def test_wrap_transcript_not_applied_to_opus(monkeypatch):
    """Opus-MT branch must receive raw text regardless of wrap_transcript."""
    fake_opus = MagicMock()
    fake_opus.translate.return_value = "translated"
    eng = translate_engine.TranslateEngine()
    eng._opus = fake_opus
    eng._src = "ja"
    eng._tgt = "en"
    result, _ = eng.translate("hello", wrap_transcript=True)
    fake_opus.translate.assert_called_once_with("hello")  # raw, not wrapped
    assert result == "translated"


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TRANSLATE_MODEL"),
                    reason="set SOKUJI_RUN_TRANSLATE_MODEL=1 (downloads ~1GB + needs torch)")
def test_real_llm_translates():
    eng = translate_engine.TranslateEngine()
    eng.init(source_lang="Spanish", target_lang="English")
    out, ms = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and len(out) > 0 and ms >= 0


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_OPUS_MODEL"),
                    reason="set SOKUJI_RUN_OPUS_MODEL=1 (downloads opus-mt ONNX + tokenizer)")
def test_real_opus_mt_translates():
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="Xenova/opus-mt-zh-en", source_lang="Chinese", target_lang="English")
    out, ms = eng.translate("你好，你今天好吗？")
    assert isinstance(out, str) and out.strip() and ms >= 0
    assert any(c.isascii() and c.isalpha() for c in out), f"expected English: {out!r}"
