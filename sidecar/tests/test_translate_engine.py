import asyncio, json, os
import pytest
from unittest.mock import MagicMock, patch
from sokuji_sidecar import server, translate_engine


class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang="", device="auto"):
        self.langs = (source_lang, target_lang)
        self.device = device
        self.resolved = {"backend": "qwen_translate", "device": "cuda", "computeType": "bfloat16"}
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
    assert reply["type"] == "ready" and reply["id"] == 1 and reply["loadTimeMs"] == 21
    assert st["translate_engine"].langs == ("ja", "en")


def test_translate_returns_translation():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate", "id": 2, "text": "hola"})))
    assert binary is None
    assert reply == {"type": "translation", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}


def test_translate_init_echoes_device_and_resolved():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate_init", "id": 1, "sourceLang": "ja",
                        "targetLang": "en", "device": "cuda"})))
    assert reply["type"] == "ready" and reply["id"] == 1 and reply["loadTimeMs"] == 21
    assert reply["backend"] == "qwen_translate"
    assert reply["device"] == "cuda"
    assert reply["computeType"] == "bfloat16"
    assert st["translate_engine"].device == "cuda"


def test_init_uses_resolver_and_sets_resolved(monkeypatch):
    from sokuji_sidecar import accel
    fake_backend = MagicMock()
    fake_plan = MagicMock(backend="qwen_translate", device="cuda", compute_type="bfloat16")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (fake_backend, fake_plan, None))
    # Isolate from the real tps benchmark/cache so resolved is deterministic here.
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en", device="cuda")
    assert eng.resolved == {"backend": "qwen_translate", "device": "cuda", "computeType": "bfloat16"}
    assert eng._backend is fake_backend

    fake_backend.translate.return_value = ("hola->hi", 5)   # (text, generated-token count)
    out, ms = eng.translate("hola", wrap_transcript=True)
    fake_backend.translate.assert_called_once_with("hola", "", "ja", "en", True)
    assert out == "hola->hi" and ms >= 0


def test_close_unloads_prior_backend_before_reinit(monkeypatch):
    from sokuji_sidecar import accel
    first, second = MagicMock(), MagicMock()
    plan = MagicMock(backend="qwen_translate", device="cpu", compute_type="float32")
    backends_iter = iter([(first, plan, None), (second, plan, None)])
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: next(backends_iter))

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en")
    eng.init(model_id="qwen3-0.6b", source_lang="ja", target_lang="en")
    first.unload.assert_called_once()   # prior backend freed before loading the next
    assert eng._backend is second


def test_translate_delegates_to_backend_when_loaded():
    eng = translate_engine.TranslateEngine()
    eng._opus = None
    eng._backend = MagicMock()
    eng._backend.translate.return_value = ("translated", 5)   # (text, generated-token count)
    eng._src, eng._tgt = "Japanese", "English"
    out, _ = eng.translate("hello", wrap_transcript=True)
    eng._backend.translate.assert_called_once_with("hello", "", "Japanese", "English", True)
    assert out == "translated"


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


def test_opus_to_qwen_switch_clears_opus(monkeypatch):
    """After switching from an Opus model back to the default Qwen model,
    _opus must be None so translate() uses the Qwen path.

    Step 1 patches sys.modules for opus_mt; Step 2 patches accel functions
    since the Qwen branch now goes through the resolver/backend path.
    """
    import sys
    from sokuji_sidecar import accel

    # --- Fake opus_mt sub-module ---
    fake_opus_instance = MagicMock()
    fake_opus_class = MagicMock(return_value=fake_opus_instance)
    fake_opus_mt_mod = MagicMock()
    fake_opus_mt_mod.OpusMtTranslator = fake_opus_class

    # --- Fake backend for Qwen path ---
    fake_backend = MagicMock()
    fake_plan = MagicMock(backend="qwen_translate", device="cpu", compute_type="float32")

    monkeypatch.setitem(sys.modules, "sokuji_sidecar.opus_mt", fake_opus_mt_mod)
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (fake_backend, fake_plan, None))

    eng = translate_engine.TranslateEngine()

    # Step 1: init with opus-mt model → _opus must be set.
    eng.init(model_id="Xenova/opus-mt-ja-en", source_lang="ja", target_lang="en")
    assert eng._opus is not None, "_opus should be set after opus-mt init"

    # Step 2: switch to the default Qwen model → _opus must be cleared.
    eng.init(model_id=None, source_lang="ja", target_lang="en")
    assert eng._opus is None, "_opus must be cleared after switching to Qwen model"


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
