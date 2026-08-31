import asyncio, json, os
import pytest
from unittest.mock import MagicMock, patch
from sokuji_sidecar import server, translate_engine


class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang="", device="auto",
             reserved_bytes=0, pin=None, **kw):
        self.langs = (source_lang, target_lang)
        self.device = device
        self.resolved = {"backend": "native_translate", "device": "cuda", "computeType": "q8_0"}
        return 21

    def translate(self, text, system_prompt="", wrap_transcript=False, on_partial=None):
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


def test_translate_returns_translate_result():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate", "id": 2, "text": "hola"})))
    assert binary is None
    assert reply == {"type": "translate_result", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}


def test_h_translate_final_reply_with_conn_none():
    """`_h_translate` moves generation into the executor and (per the brief for
    this task) only builds an `on_partial` callback when `conn` is given —
    wire_schema.json doesn't carry `translate_partial` yet (Task 4 adds it with
    the TS side atomically), so `conn=None` must still produce the correct
    final reply without ever touching the partial-push path."""
    state = {"translate_engine": FakeTranslate()}
    msg = {"type": "translate", "id": 3, "text": "hola", "systemPrompt": "",
           "wrapTranscript": False}
    reply, binary = asyncio.run(translate_engine._h_translate(state, msg, None, conn=None))
    assert binary is None
    assert reply == {"type": "translate_result", "id": 3,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}


def test_h_translate_reports_partial_send_failure_once(capsys):
    """An exception raised inside conn.send while pushing a partial (e.g. a
    strict-mode wire-schema violation before Task 4 lands translate_partial)
    must not vanish silently: run_coroutine_threadsafe's Future is otherwise
    never awaited or inspected. It must also not stop the final reply from
    arriving, and must be reported at most once per request even though two
    partials fail here."""
    class FakeTranslateStreaming:
        def translate(self, text, system_prompt="", wrap_transcript=False, on_partial=None):
            if on_partial is not None:
                on_partial("Bon")
                on_partial("Bonjour.")
            return "Bonjour.", 3

    class FakeConn:
        async def send(self, obj):
            raise RuntimeError("boom")

    state = {"translate_engine": FakeTranslateStreaming()}
    msg = {"type": "translate", "id": 4, "text": "hello", "systemPrompt": "",
           "wrapTranscript": False}
    reply, binary = asyncio.run(translate_engine._h_translate(state, msg, None, conn=FakeConn()))
    assert binary is None
    assert reply == {"type": "translate_result", "id": 4,
                     "sourceText": "hello", "translatedText": "Bonjour.", "inferenceTimeMs": 3}
    err = capsys.readouterr().err
    assert err.count("translate_partial send failed") == 1


def test_h_translate_sends_partial_push_before_reply():
    """The wire is live now (Task 4 landed translate_partial in wire_schema.json
    + ServerMsg): a Fake conn captures every send, the fake engine fires one
    partial mid-generation, and the push must reach the connection strictly
    before the final translate_result reply."""
    class FakeTranslateStreaming:
        def translate(self, text, system_prompt="", wrap_transcript=False, on_partial=None):
            if on_partial is not None:
                on_partial("Bon")
            return "Bonjour.", 3

    class FakeConn:
        def __init__(self):
            self.sent = []

        async def send(self, obj):
            self.sent.append(obj)

    state = {"translate_engine": FakeTranslateStreaming()}
    msg = {"type": "translate", "id": 5, "text": "hello", "systemPrompt": "",
           "wrapTranscript": False}
    conn = FakeConn()
    reply, binary = asyncio.run(translate_engine._h_translate(state, msg, None, conn=conn))
    assert binary is None
    assert reply == {"type": "translate_result", "id": 5,
                     "sourceText": "hello", "translatedText": "Bonjour.", "inferenceTimeMs": 3}
    assert conn.sent == [{"type": "translate_partial", "text": "Bon"}]


def test_translate_init_echoes_device_and_resolved():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate_init", "id": 1, "sourceLang": "ja",
                        "targetLang": "en", "device": "cuda"})))
    assert reply["type"] == "ready" and reply["id"] == 1 and reply["loadTimeMs"] == 21
    assert reply["backend"] == "native_translate"
    assert reply["device"] == "cuda"
    assert reply["computeType"] == "q8_0"
    assert st["translate_engine"].device == "cuda"


def test_init_uses_resolver_and_sets_resolved(monkeypatch):
    from sokuji_sidecar import accel
    fake_backend = MagicMock()
    fake_plan = MagicMock(backend="native_translate", device="cuda", compute_type="q8_0")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: (fake_backend, fake_plan, None, None))
    # Isolate from the real tps benchmark/cache so resolved is deterministic here.
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en", device="cuda")
    assert eng.resolved == {"backend": "native_translate", "device": "cuda", "computeType": "q8_0"}
    assert eng._backend is fake_backend

    fake_backend.translate.return_value = ("hola->hi", 5)   # (text, generated-token count)
    out, ms = eng.translate("hola", wrap_transcript=True)
    fake_backend.translate.assert_called_once_with("hola", "", "ja", "en", True, on_partial=None)
    assert out == "hola->hi" and ms >= 0


def test_close_unloads_prior_backend_before_reinit(monkeypatch):
    from sokuji_sidecar import accel
    first, second = MagicMock(), MagicMock()
    plan = MagicMock(backend="native_translate", device="cpu", compute_type="float32")
    backends_iter = iter([(first, plan, None, None), (second, plan, None, None)])
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: next(backends_iter))

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
    eng._backend.translate.assert_called_once_with("hello", "", "Japanese", "English", True, on_partial=None)
    assert out == "translated"


def test_translate_passes_on_partial_through_to_backend():
    """The engine is a thin passthrough for streaming: on_partial reaches the
    backend unchanged, and every piece the backend reports during generation
    reaches the caller's collector in order."""
    eng = translate_engine.TranslateEngine()
    eng._backend = MagicMock()

    def fake_translate(text, system_prompt, src, tgt, wrap, on_partial=None):
        on_partial("Bon")
        on_partial("Bonjour.")
        return "Bonjour.", 3
    eng._backend.translate.side_effect = fake_translate
    eng._src, eng._tgt = "English", "French"

    seen = []
    out, _ = eng.translate("hello", on_partial=seen.append)
    assert seen == ["Bon", "Bonjour."]
    assert out == "Bonjour."


def test_init_stores_memory_and_fallback_reason(monkeypatch):
    from sokuji_sidecar import accel
    from unittest.mock import MagicMock
    fake_plan = MagicMock(backend="native_translate", device="cpu", compute_type="float32")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans, **kw: (MagicMock(), fake_plan, "cuda skipped (needs ~6.1 GiB, 2.1 GiB free); using CPU", 4_200_000_000))
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
                    reason="set SOKUJI_RUN_TRANSLATE_MODEL=1 (downloads GGUFs: "
                           "qwen3-0.6b ~0.6GB, hy-mt2-1.8b ~1.1GB, translategemma-4b ~2.5GB)")
@pytest.mark.parametrize("model_id", ["qwen3-0.6b", "hy-mt2-1.8b", "translategemma-4b"])
def test_real_llm_translates(model_id):
    """Live gate (spec rollout row 3): one real sentence per prompt family, through
    the actual sokuji_native llama.cpp runtime — not a fake. Asserts the output is
    non-empty and never leaks a <think> block (R5(s3): if the legacy chat-template
    formatter rejects a family's template, _chatml_fallback fires or the model
    output degrades to garbage; either is a STOP-and-report condition, not
    something this test papers over)."""
    eng = translate_engine.TranslateEngine()
    eng.init(model_id=model_id, source_lang="Spanish", target_lang="English")
    out, ms = eng.translate("Hola, ¿cómo estás?")
    print(f"[live-gate] {model_id}: {out!r} ({ms}ms)")
    assert isinstance(out, str) and len(out) > 0 and ms >= 0
    assert "<think>" not in out


def test_translate_init_reserve_is_ledger_aware(monkeypatch):
    """A loaded-on-cpu ASR must contribute 0 (not its download size) to the
    translate reserve; an unloaded TTS still contributes its estimate."""
    import asyncio
    from sokuji_sidecar import accel, translate_engine, native_models

    accel.ledger_reset()
    accel.ledger_claim("asr", 0)                  # asr loaded, on cpu
    monkeypatch.setattr(native_models, "model_size",
                        lambda mid: {"a": 3 << 30, "t": 4 << 30}[mid])
    seen = {}

    class _Eng:
        resolved = None
        def init(self, model, src, tgt, device, reserved_bytes=0, pin=None, **kw):
            seen["reserve"] = reserved_bytes
            return 1
    state = {"translate_engine": _Eng()}
    asyncio.run(translate_engine._h_translate_init(
        state, {"model": "qwen2.5-0.5b", "asrModel": "a", "ttsModel": "t"}, None, None))
    assert seen["reserve"] == 4 << 30             # tts est only; cpu-loaded asr = 0
    accel.ledger_reset()
