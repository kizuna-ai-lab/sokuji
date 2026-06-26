import asyncio, json, os
import pytest
from unittest.mock import MagicMock, patch
from sokuji_sidecar import server, translate_engine


class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang="", device="auto",
             reserved_bytes=0, pin=None):
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
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured", lambda plans: (fake_backend, fake_plan, None, None))
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
    backends_iter = iter([(first, plan, None, None), (second, plan, None, None)])
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured", lambda plans: next(backends_iter))

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en")
    eng.init(model_id="qwen3-0.6b", source_lang="ja", target_lang="en")
    first.unload.assert_called_once()   # prior backend freed before loading the next
    assert eng._backend is second


def test_translate_delegates_to_backend_when_loaded():
    eng = translate_engine.TranslateEngine()
    eng._backend = MagicMock()
    eng._backend.translate.return_value = ("translated", 5)   # (text, generated-token count)
    eng._src, eng._tgt = "Japanese", "English"
    out, _ = eng.translate("hello", wrap_transcript=True)
    eng._backend.translate.assert_called_once_with("hello", "", "Japanese", "English", True)
    assert out == "translated"


def test_init_stores_memory_and_fallback_reason(monkeypatch):
    from sokuji_sidecar import accel
    from unittest.mock import MagicMock
    fake_plan = MagicMock(backend="qwen_translate", device="cpu", compute_type="float32")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans: (MagicMock(), fake_plan, "cuda skipped (needs ~6.1 GiB, 2.1 GiB free); using CPU", 4_200_000_000))
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen3.5-2b", source_lang="ja", target_lang="en")
    assert eng.resolved["memoryBytes"] == 4_200_000_000
    assert "using CPU" in eng.resolved["fallbackReason"]


def test_translate_init_forwards_reserved_bytes(monkeypatch):
    import asyncio
    from sokuji_sidecar import translate_engine as te, native_models as nm
    seen = {}
    def fake_init(self, model_id=None, source_lang="", target_lang="", device="auto",
                  reserved_bytes=0, pin=None):
        seen["reserved_bytes"] = reserved_bytes
        self.resolved = {"backend": "x", "device": "cpu", "computeType": "fp8"}
        return 0
    monkeypatch.setattr(te.TranslateEngine, "init", fake_init)
    monkeypatch.setattr(nm, "model_size", lambda mid: {"voxtral-mini-4b-realtime": 8 * 1024**3,
                                                       "piper-en": 100 * 1024**2}.get(mid, 0))
    state = {"translate_engine": te.TranslateEngine()}
    msg = {"type": "translate_init", "id": 1, "model": "hy-mt2-7b",
           "asrModel": "voxtral-mini-4b-realtime", "ttsModel": "piper-en"}
    reply, _ = asyncio.run(te._h_translate_init(state, msg, None, None))
    assert reply["type"] == "ready"
    assert seen["reserved_bytes"] == 8 * 1024**3 + 100 * 1024**2


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TRANSLATE_MODEL"),
                    reason="set SOKUJI_RUN_TRANSLATE_MODEL=1 (downloads ~1GB + needs torch)")
def test_real_llm_translates():
    eng = translate_engine.TranslateEngine()
    eng.init(source_lang="Spanish", target_lang="English")
    out, ms = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and len(out) > 0 and ms >= 0
