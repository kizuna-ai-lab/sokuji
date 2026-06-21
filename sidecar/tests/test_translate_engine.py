import asyncio, json, os
import pytest
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
