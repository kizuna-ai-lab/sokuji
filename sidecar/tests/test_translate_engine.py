import asyncio, json, os, threading, time
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


def test_m5_twin_generation_bumps_on_every_init(monkeypatch):
    """M5 twin (tts_engine.py's _tts_teardown carries the full race trace; see
    .superpowers/slice5-surface-inventory.md §10(a) for the confirmation that
    TranslateEngine.init()/_translate_teardown share the identical shape):
    TranslateEngine.generation must increment on every init(), BEFORE close()
    runs, so a teardown captured at generation N can tell it's been superseded
    once a later init has bumped past it."""
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans, **kw: (MagicMock(),
                                             MagicMock(backend="native_translate", device="cpu",
                                                       compute_type="float32"), None, None))
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)

    eng = translate_engine.TranslateEngine()
    assert eng.generation == 0
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en")
    assert eng.generation == 1
    eng.init(model_id="qwen3-0.6b", source_lang="ja", target_lang="en")
    assert eng.generation == 2


def test_m5_twin_stale_teardown_after_reinit_does_not_close_the_newer_engine(monkeypatch):
    """A teardown closure registered by an EARLIER translate_init, firing (e.g.
    on disconnect) AFTER a fresher translate_init has since re-loaded the
    engine, must no-op instead of tearing down the model the fresher init
    loaded -- the exact translate-side twin of tts_engine.py's M5 fix."""
    from sokuji_sidecar import accel
    first, second = MagicMock(), MagicMock()
    plan = MagicMock(backend="native_translate", device="cpu", compute_type="float32")
    backends_iter = iter([(first, plan, None, None), (second, plan, None, None)])
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None, **_: ["plan"])
    monkeypatch.setattr(accel, "load_measured", lambda plans, **kw: next(backends_iter))
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)

    state = {"translate_engine": translate_engine.TranslateEngine(), "handlers": {}}
    translate_engine.register(state)

    class _FakeConn:
        def on_close(self, cb):
            pass   # _translate_teardown is invoked directly below, not via this callback

    conn = _FakeConn()

    async def run():
        await state["handlers"]["translate_init"](
            state, {"type": "translate_init", "id": 1, "sourceLang": "ja", "targetLang": "en"},
            None, conn)
        # Simulate capturing the FIRST init's teardown closure directly (mirrors
        # what conn.on_close(lambda: _translate_teardown(state, generation)) would
        # have registered, without needing a real on_close-tracking fake conn).
        stale_generation = state["translate_engine"].generation
        assert stale_generation == 1

        await state["handlers"]["translate_init"](
            state, {"type": "translate_init", "id": 2, "sourceLang": "ja", "targetLang": "en"},
            None, conn)
        assert state["translate_engine"].generation == 2
        assert state["translate_engine"]._backend is second

        translate_engine._translate_teardown(state, stale_generation)   # fires the STALE one

        assert state["translate_engine"]._backend is second   # still current
        second.unload.assert_not_called()                     # untouched by the stale teardown

    asyncio.run(run())


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


# ── Task 5: translate teardown UAF fix + disconnect-triggered cancel ─────────
# (ground truth .superpowers/slice5-surface-inventory.md §10(b); ruling R20 --
# no new wire message). Mirrors tts_engine.py's own CQ-4/I3 test shapes.

def test_cancel_active_reaches_backend_cancel():
    eng = translate_engine.TranslateEngine()
    eng._backend = MagicMock()
    eng.cancel_active()
    eng._backend.cancel.assert_called_once()


def test_cancel_active_is_noop_when_nothing_loaded():
    eng = translate_engine.TranslateEngine()
    eng.cancel_active()   # must not raise -- self._backend is None


def test_teardown_cancels_active_generation_before_closing():
    """The translate-side twin of tts_engine.py's own CQ-4 test
    (test_teardown_cancels_active_generation_before_closing): _translate_teardown
    must call eng.cancel_active() BEFORE eng.close(), so an in-flight generation
    is signalled to stop as early as possible rather than relying solely on
    close()->backend.unload()'s own (also correct, but later) cancel+join."""
    order = []

    class FakeEng:
        def cancel_active(self):
            order.append("cancel_active")

        def close(self):
            order.append("close")

    state = {"translate_engine": FakeEng()}
    translate_engine._translate_teardown(state)
    assert order == ["cancel_active", "close"]


def test_teardown_close_still_runs_if_cancel_active_raises():
    order = []

    class FakeEng:
        def cancel_active(self):
            raise RuntimeError("boom")

        def close(self):
            order.append("close")

    state = {"translate_engine": FakeEng()}
    translate_engine._translate_teardown(state)   # must not raise
    assert order == ["close"]


def test_translate_teardown_joins_worker_and_discards_cancelled_output(monkeypatch, tmp_path):
    """CORRECTED (fix round 1, ruling R26): this exercises _translate_teardown
    directly against a real TranslateEngine + NativeTranslateBackend, wired
    together WITHOUT server.py's `_conn`/dispatch loop in the picture at all
    -- it proves the backend/engine cancel+join plumbing (the I3 UAF fix), but
    it is NOT the disconnect-during-generation race the ground truth §10(b)
    defect actually lives in: a real `_translate_teardown` only ever runs from
    server._conn's on_close list, which cannot fire until the in-flight
    handler call has already returned (see _translate_teardown's own
    docstring's "CORRECTION" paragraph). That live race is instead covered by
    test_h_translate_cancels_inflight_generation_when_connection_closes below,
    which drives the real _h_translate/asyncio.wait(FIRST_COMPLETED) path this
    module's docstring documents. Calling _translate_teardown() directly here
    (as this test still does) must not free the native handle out from under
    a still-running self._t.chat() call (the exact use-after-free class
    Task-I3 fixed for TTS's one-shot generate()), and the cancelled call must
    come back as a harmless empty result rather than a raised exception."""
    import types
    from sokuji_sidecar import backends, native
    from sokuji_sidecar.planner import PlanConfig

    gguf = tmp_path / "w.gguf"
    gguf.write_bytes(b"GGUF")

    class _SlowTranslator:
        def __init__(self):
            self.started = threading.Event()
            self.release = threading.Event()
            self.unloaded = False

        def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
            self.started.set()
            self.release.wait(timeout=5)
            if on_token is not None and on_token("piece") is False:
                raise RuntimeError("sk_translate_chat: cancelled")
            return "full text"

        def complete(self, prompt, max_tokens=512, on_token=None):
            return self.chat([], on_token=on_token)

        def unload(self):
            self.unloaded = True

    translator = _SlowTranslator()
    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0: translator)
    monkeypatch.setattr(native, "module", lambda: mod)
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}")

    backend = backends.make_backend("native_translate")
    backend.load(str(gguf), "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))

    eng = translate_engine.TranslateEngine()
    eng._backend = backend
    eng._src, eng._tgt = "en", "fr"

    order = []
    orig_unload = translator.unload

    def tracked_unload():
        order.append("model.unload")
        orig_unload()

    translator.unload = tracked_unload

    result = {}

    def run_translate():
        result["out"] = eng.translate("hello")

    gen_thread = threading.Thread(target=run_translate)
    gen_thread.start()
    assert translator.started.wait(timeout=5)     # eng.translate() is now inside chat()

    state = {"translate_engine": eng}
    teardown_thread = threading.Thread(target=lambda: translate_engine._translate_teardown(state))
    teardown_thread.start()
    time.sleep(0.1)                                 # teardown should be blocked joining
    assert teardown_thread.is_alive()                # proves close()->unload() actually waits
    assert order == []                               # model.unload() not reached yet

    translator.release.set()                         # let chat() reach on_token -> cancelled -> False
    teardown_thread.join(timeout=5)
    gen_thread.join(timeout=5)

    assert not teardown_thread.is_alive()
    assert order == ["model.unload"]                 # joined BEFORE freeing the native handle
    assert backend.is_loaded is False
    text, _ms = result["out"]
    assert text == ""                                # cancelled: discarded, not a raised exception


def test_h_translate_cancels_inflight_generation_when_connection_closes(monkeypatch, tmp_path):
    """Fix round 1 (ruling R26): the REAL disconnect-during-generation race,
    exercised through the actual production _h_translate function (not a
    reimplementation of its logic) -- this is what
    test_translate_teardown_joins_worker_and_discards_cancelled_output above
    (fix round 1's corrected docstring) does NOT cover.

    Ships the "handler-level" floor named in ruling R26, not a full real-
    websockets-server harness: this codebase's existing server-layer tests
    (test_server_conn.py) drive `_conn`/`handle_message` with fake transports
    throughout and never open a real socket, so a FakeConn here matches
    established style. The one piece that has to be a REAL asyncio primitive
    -- not a plain flag -- is `wait_closed()`: server.Conn.wait_closed()
    documents that it resolves independent of _conn's own recv() loop, and an
    asyncio.Event completed by the test mid-flight is exactly that contract,
    not a sleep/poll standing in for it.

    Backend: the REAL NativeTranslateBackend (not a mock) against a slow fake
    translator, so the worker-registry/cancel wiring under test is the actual
    production code, exactly like the sibling test above."""
    import types
    from sokuji_sidecar import backends, native
    from sokuji_sidecar.planner import PlanConfig

    gguf = tmp_path / "w.gguf"
    gguf.write_bytes(b"GGUF")

    class _SlowTranslator:
        def __init__(self):
            self.started = threading.Event()
            self.release = threading.Event()

        def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
            self.started.set()
            self.release.wait(timeout=5)
            if on_token is not None and on_token("piece") is False:
                raise RuntimeError("sk_translate_chat: cancelled")
            return "full text"

        def complete(self, prompt, max_tokens=512, on_token=None):
            return self.chat([], on_token=on_token)

        def unload(self):
            pass

    translator = _SlowTranslator()
    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0: translator)
    monkeypatch.setattr(native, "module", lambda: mod)
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}")

    backend = backends.make_backend("native_translate")
    backend.load(str(gguf), "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))

    eng = translate_engine.TranslateEngine()
    eng._backend = backend
    eng._src, eng._tgt = "en", "fr"

    # Observability hook: calls the REAL cancel_active() (hence the REAL
    # backend.cancel(), hence the REAL worker Event) and additionally flips an
    # asyncio.Event the test can await deterministically -- not a substitute
    # for the real call, a signal layered on top of it.
    cancel_signal = asyncio.Event()
    orig_cancel_active = eng.cancel_active

    def _tracking_cancel_active():
        orig_cancel_active()
        cancel_signal.set()

    eng.cancel_active = _tracking_cancel_active

    class FakeConn:
        """wait_closed() is a real asyncio.Event this test completes
        explicitly, mid-flight -- the same contract server.Conn.wait_closed()
        gives _h_translate in production (see its docstring). send() asserts
        it is never called with a real reply -- belt-and-braces on top of the
        (None, None) return-value contract this test also checks directly."""

        def __init__(self):
            self._closed = asyncio.Event()

        async def send(self, obj=None, binary=None):
            raise AssertionError(f"must not reply to a closed connection: {obj!r}")

        async def wait_closed(self):
            await self._closed.wait()

        def close_now(self):
            self._closed.set()

    conn = FakeConn()
    state = {"translate_engine": eng}
    msg = {"type": "translate", "id": 9, "text": "hello", "systemPrompt": "",
           "wrapTranscript": False}

    async def run():
        h_task = asyncio.ensure_future(translate_engine._h_translate(state, msg, None, conn))
        # Deterministic: an Event, not a sleep -- off the loop so it doesn't
        # block it while the executor thread is genuinely running.
        await asyncio.get_running_loop().run_in_executor(None, translator.started.wait, 5)

        conn.close_now()          # the client disconnects mid-generation
        # Bounded wait on a real asyncio primitive -- proves cancel_active()
        # (hence the worker's cancel Event) fires promptly once asyncio.wait()
        # inside _h_translate notices the close-waiter is done. I-1: the
        # registry entry is now (cancel Event, done Event) -- index [0] is the
        # cancel Event this assertion cares about (was [1] before I-1 dropped
        # the thread reference from the tuple).
        await asyncio.wait_for(cancel_signal.wait(), timeout=5)
        assert backend._workers and backend._workers[-1][0].is_set()

        translator.release.set()   # let the worker observe the cancel and exit
        return await asyncio.wait_for(h_task, timeout=5)

    reply, binary = asyncio.run(run())
    assert reply is None and binary is None       # no reply -- FakeConn.send would have raised
    assert backend._workers == []                  # translate() returned; worker deregistered
    assert backend.is_loaded is True                # cancel != unload -- model stays loaded for reuse
