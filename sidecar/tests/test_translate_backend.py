import asyncio
import threading
import time
import types

import pytest

from sokuji_sidecar import translate_backend as tb
from sokuji_sidecar import backends
from sokuji_sidecar.planner import PlanConfig


def test_default_prompt_mentions_langs():
    p = tb._default_prompt("Japanese", "English")
    assert "Japanese" in p and "English" in p and "only" in p.lower()


def test_clean_output_removes_think_block():
    assert tb._clean_output("<think>reasoning</think>  hello") == "hello"
    assert tb._clean_output("plain") == "plain"


def test_clean_output_strips_transcript_tags():
    # Small Qwen models echo the input's <transcript> framing into the output.
    assert tb._clean_output("The weather today is nice.</transcript>") == "The weather today is nice."
    assert tb._clean_output("<transcript>hi</transcript>") == "hi"
    assert tb._clean_output("<think>x</think> Hello</transcript>") == "Hello"


class _FakeTranslator:
    def __init__(self, log):
        self.log = log

    def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
        self.log.append(("chat", messages, max_tokens, assistant_prefill))
        for p in ("Bon", "jour", "."):
            if on_token is not None:
                on_token(p)
        return "Bonjour."

    def complete(self, prompt, max_tokens=512, on_token=None):
        self.log.append(("complete", prompt, max_tokens))
        if on_token is not None:
            on_token("Oui.")
        return "Oui."

    def unload(self):
        self.log.append(("unload",))


class NativeError(RuntimeError):
    """Local stand-in for sokuji_native.NativeError -- mirrors
    test_tts_backend.py's own NativeError stand-in. The real Translator.chat()/
    complete() raise this (via _raise()) when on_token returns False (SK_ERR_
    CANCELLED) -- see native/python/sokuji_native/__init__.py's Translator.
    _make_cb docstring."""


class _SlowFakeTranslator:
    """chat()/complete() block until released, then call on_token exactly once
    -- same shape as test_tts_backend.py's _GatedTtsModel/slow-oneshot fakes.
    Lets a test deterministically land unload()/cancel()'s cancel Event BEFORE
    the native call would otherwise produce its next (here: only) token, mirroring
    the real binding's per-token on_token(piece) is not False contract."""

    def __init__(self, log):
        self.log = log
        self.started = threading.Event()
        self.release = threading.Event()
        self.unloaded = False

    def _run(self, kind, payload, on_token):
        self.log.append((kind, payload))
        self.started.set()
        self.release.wait(timeout=5)
        if on_token is not None and on_token("piece") is False:
            raise NativeError("sk_translate_chat: cancelled")
        return "full text"

    def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
        return self._run("chat", messages, on_token)

    def complete(self, prompt, max_tokens=512, on_token=None):
        return self._run("complete", prompt, on_token)

    def unload(self):
        self.unloaded = True


class _WedgedFakeTranslator:
    """chat()/complete() blocks FOREVER and never observes on_token's cancel
    signal -- models a native call that is truly wedged (or one whose per-token
    cancel check the binding never reaches for some pathological input). Exists
    ONLY to prove unload()'s _UNLOAD_DEADLINE_S backstop actually bounds the
    wait regardless -- see
    test_unload_waits_out_the_deadline_when_the_native_call_never_finishes.
    The worker thread that calls into this is always started as a daemon (see
    that test) so the wedged call never prevents the test process from
    exiting."""

    def __init__(self, log):
        self.log = log
        self.started = threading.Event()
        self.unloaded = False

    def _run(self, kind, payload, on_token):
        self.log.append((kind, payload))
        self.started.set()
        threading.Event().wait()   # never released
        return "unreachable"       # pragma: no cover

    def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
        return self._run("chat", messages, on_token)

    def complete(self, prompt, max_tokens=512, on_token=None):
        return self._run("complete", prompt, on_token)

    def unload(self):
        self.unloaded = True


@pytest.fixture
def native_env(monkeypatch, tmp_path):
    from sokuji_sidecar import native
    log = []
    gguf = tmp_path / "w.gguf"
    gguf.write_bytes(b"GGUF")
    # A distinct, non-None sentinel per kind — including "cpu" — so a test can
    # tell a real (if fake) device object apart from a NULL that was never
    # resolved at all (see test_load_cpu_passes_explicit_cpu_device_not_null).
    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path, device)) or _FakeTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}" if kind in ("cpu", "vulkan", "metal")
                        else (_ for _ in ()).throw(backends.BackendLoadError(f"no {kind} device")))
    return str(gguf), log


def test_qwen_plain_no_wrap_flags(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    text, n = b.translate("hello", "", "English", "Chinese", False)
    assert text == "Bonjour." and n == 3
    kind, messages, max_tokens, prefill = log[-1]
    assert kind == "chat"
    assert messages[0]["role"] == "system"
    assert "You are a translator" in messages[0]["content"]
    assert "/no_think" not in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "hello"
    assert prefill is None
    b.unload()
    assert not b.is_loaded


def test_qwen3_disable_thinking_and_append_no_think(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0",
           config=PlanConfig(prompt_family="qwen", disable_thinking=True, append_no_think=True))
    b.translate("hi", "", "en", "zh", False)
    _kind, messages, _max_tokens, prefill = log[-1]
    assert "/no_think" in messages[0]["content"]
    assert prefill == "<think>\n\n</think>\n\n"


def test_qwen35_disable_thinking_only_no_no_think(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q4_k_m",
           config=PlanConfig(prompt_family="qwen", disable_thinking=True, append_no_think=False))
    b.translate("hi", "", "en", "zh", False)
    _kind, messages, _max_tokens, prefill = log[-1]
    assert "/no_think" not in messages[0]["content"]
    assert prefill == "<think>\n\n</think>\n\n"


def test_hunyuan_single_user_message(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q4_k_m", config=PlanConfig(prompt_family="hunyuan"))
    b.translate("bonjour", "", "French", "English", True)
    kind, messages, _max_tokens, prefill = log[-1]
    assert kind == "chat"
    assert len(messages) == 1 and messages[0]["role"] == "user"
    assert "into English" in messages[0]["content"]
    assert "<transcript>bonjour</transcript>" in messages[0]["content"]
    assert prefill is None


def test_gemma_uses_complete_with_rendered_prompt(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q4_k_m", config=PlanConfig(prompt_family="gemma"))
    b.translate("hello", "ignored-system-prompt", "English", "Japanese", False)
    kind, prompt, max_tokens = log[-1]
    assert kind == "complete"
    assert "<start_of_turn>user" in prompt
    assert "(en)" in prompt and "(ja)" in prompt
    assert max_tokens == 256


def test_gemma_prompt_omits_empty_code_for_falsy_src():
    # Regression kept verbatim against the strategy's own prompt renderer.
    prompt = tb.GemmaStrategy()._render_prompt("hello", "", "Japanese", False)
    assert "()" not in prompt
    assert "the source language to Japanese (ja)" in prompt
    assert "(ja)" in prompt


def test_streaming_on_partial_gets_cumulative_cleaned_text(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    seen = []
    text, n = b.translate("hello", "", "en", "fr", False, on_partial=seen.append)
    assert seen == ["Bon", "Bonjour", "Bonjour."]
    assert text == "Bonjour." and n == 3


def test_device_fallback_raises_backend_load_error(native_env):
    gguf, _log = native_env
    b = backends.make_backend("native_translate")
    with pytest.raises(backends.BackendLoadError):
        b.load(gguf, "nope", "q4_k_m", config=PlanConfig(prompt_family="qwen"))


def test_load_cpu_passes_explicit_cpu_device_not_null(native_env):
    """Regression (final-review F1): passing NULL to sk_translate_load for a
    cpu-resolved plan leaves llama's defaults (n_gpu_layers=-1, all devices),
    which fully offloads to the GPU on the Vulkan/Metal wheels — breaking the
    resolver's GPU->CPU fallback and corrupting the VRAM ledger (a cpu plan is
    supposed to claim 0 device bytes). device="cpu" must resolve and pass an
    explicit CPU device, exactly like vulkan/metal do, never skip straight to
    None."""
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    load_entry = next(entry for entry in log if entry[0] == "load")
    assert load_entry[2] is not None
    assert load_entry[2] == "dev:cpu"


def test_empty_or_unknown_prompt_family_dispatches_to_qwen(native_env):
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    # An unrecognized family name falls back to the qwen shape.
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="some-future-family"))
    b.translate("hello", "", "English", "French", False)
    kind, messages, _max_tokens, _prefill = log[-1]
    assert kind == "chat"
    assert messages[0]["role"] == "system"
    assert "You are a translator" in messages[0]["content"]
    assert messages[1]["content"] == "hello"

    # A bare PlanConfig() (empty prompt_family) takes the same default path.
    b.load(gguf, "cpu", "q8_0", config=PlanConfig())
    b.translate("hi", "", "English", "French", False)
    kind2, messages2, _mt2, _pf2 = log[-1]
    assert kind2 == "chat"
    assert "You are a translator" in messages2[0]["content"]


def test_on_partial_exception_costs_one_partial_not_the_translation(native_env):
    """A raise inside on_partial must not propagate into the native token
    callback (which would be swallowed by ctypes into False and cancel the
    whole generation) — it costs exactly the one partial, not the translation."""
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    seen = []
    calls = [0]

    def flaky(text):
        calls[0] += 1
        if calls[0] == 2:
            raise RuntimeError("consumer broke")
        seen.append(text)

    text, n = b.translate("hello", "", "en", "fr", False, on_partial=flaky)
    assert text == "Bonjour." and n == 3          # full translation unaffected
    assert seen == ["Bon", "Bonjour."]             # only the 2nd partial was lost


def test_chatml_fallback_carries_prefill_through(native_env, monkeypatch):
    gguf, log = native_env
    from sokuji_sidecar import native

    class _RejectingTranslator(_FakeTranslator):
        def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
            self.log.append(("chat-attempt", messages, max_tokens, assistant_prefill))
            raise RuntimeError("chat template not supported by the legacy formatter")

    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path)) or _RejectingTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0",
           config=PlanConfig(prompt_family="qwen", disable_thinking=True, append_no_think=True))
    b.translate("hi", "", "en", "zh", False)
    complete_call = next(entry for entry in log if entry[0] == "complete")
    prompt = complete_call[1]
    assert prompt.endswith("<think>\n\n</think>\n\n")


def test_chat_exception_without_template_marker_propagates(native_env, monkeypatch):
    gguf, log = native_env
    from sokuji_sidecar import native

    class _BoomTranslator(_FakeTranslator):
        def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
            self.log.append(("chat-attempt", messages, max_tokens, assistant_prefill))
            raise RuntimeError("some other native failure")

    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path)) or _BoomTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    with pytest.raises(RuntimeError, match="some other native failure"):
        b.translate("hi", "", "en", "zh", False)
    assert not any(entry[0] == "complete" for entry in log)   # no fallback attempted


def test_unknown_template_falls_back_to_chatml(native_env, monkeypatch):
    gguf, log = native_env
    from sokuji_sidecar import native

    class _RejectingTranslator(_FakeTranslator):
        def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
            self.log.append(("chat-attempt", messages, max_tokens, assistant_prefill))
            # Mirrors the message text sk_translate_chat/the Translator binding raise
            # when the GGUF's chat template isn't known to the legacy formatter —
            # the backend catches by substring, not by exception type (see
            # translate_backend._chatml_fallback).
            raise RuntimeError("chat template not supported by the legacy formatter")

    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path)) or _RejectingTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    text, n = b.translate("hi", "", "en", "zh", False)
    assert text == "Oui." and n == 1
    kinds = [entry[0] for entry in log]
    assert "chat-attempt" in kinds
    complete_call = next(entry for entry in log if entry[0] == "complete")
    assert "<|im_start|>user" in complete_call[1]


def test_registry_has_native_translate_and_drops_llamacpp():
    assert backends.make_backend("native_translate") is not None
    with pytest.raises(backends.BackendLoadError):
        backends.make_backend("llamacpp_qwen")


# ── Task 5: translate teardown UAF fix + disconnect-triggered cancel ─────────
# (ground truth .superpowers/slice5-surface-inventory.md §10(b); ruling R20 --
# no new wire message, cancel is reached only via cancel()/unload()).

def _load_slow(native_env, monkeypatch):
    """Swap the native_env fixture's translate_load() to hand back a
    _SlowFakeTranslator instead of the default _FakeTranslator, then load the
    real NativeTranslateBackend against it -- exercises the actual worker-
    registry/cancel wiring end to end, not a mock."""
    gguf, log = native_env
    from sokuji_sidecar import native
    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path)) or _SlowFakeTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    return b, log


def _load_wedged(native_env, monkeypatch):
    """Swap in a _WedgedFakeTranslator whose chat()/complete() never returns and
    never observes cancellation -- see that class's own docstring."""
    gguf, log = native_env
    from sokuji_sidecar import native
    box = {}

    def wedged_translate_load(path, device=None, n_ctx=0):
        log.append(("load", path))
        box["t"] = _WedgedFakeTranslator(log)
        return box["t"]

    mod = types.SimpleNamespace(translate_load=wedged_translate_load)
    monkeypatch.setattr(native, "module", lambda: mod)
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    return b, box["t"]


def test_unload_during_inflight_translate_joins_before_model_unload(native_env, monkeypatch):
    """I3 twin / I-1 (final fix wave): the ORIGINAL version of this test ran
    translate() on a dedicated threading.Thread, which terminates on its own
    once its target function returns -- that MASKED the I-1 defect, because
    unload()'s old thread.join(timeout=...) genuinely worked correctly against
    that kind of thread. In production translate() always runs via
    translate_engine._h_translate's real `loop.run_in_executor(None, ...)`,
    i.e. on a ThreadPoolExecutor worker that returns to the POOL, IDLE, once
    the callable returns -- it does NOT terminate, so joining THAT thread burns
    unload()'s full deadline every single time regardless of whether
    translate() had already finished (see translate_backend.py's module
    docstring, "Final fix wave" paragraph, for the full trace). Reproduce the
    real shape here: schedule translate() through asyncio's actual default
    executor, not a bare Thread, so this test would have caught the original
    regression."""
    b, _log = _load_slow(native_env, monkeypatch)
    translator = b._t

    order = []
    orig_unload = translator.unload

    def tracked_unload():
        order.append("model.unload")
        orig_unload()

    translator.unload = tracked_unload

    result = {}

    async def run_translate():
        loop = asyncio.get_running_loop()
        result["out"] = await loop.run_in_executor(
            None, lambda: b.translate("hello", "", "en", "fr", False))

    gen_thread = threading.Thread(target=lambda: asyncio.run(run_translate()))
    gen_thread.start()
    assert translator.started.wait(timeout=5)   # translate() is now inside chat()

    unload_thread = threading.Thread(target=b.unload)
    unload_thread.start()
    time.sleep(0.1)                              # unload() should be blocked waiting
    assert unload_thread.is_alive()               # proves unload() actually waits
    assert order == []                            # model.unload() not reached yet

    translator.release.set()                      # let chat() proceed; on_token sees cancel -> False
    unload_thread.join(timeout=5)
    gen_thread.join(timeout=5)

    assert not unload_thread.is_alive()            # I-1: returned promptly, not after the full deadline
    assert order == ["model.unload"]               # waited BEFORE calling model.unload
    assert b.is_loaded is False
    text, n = result["out"]
    assert text == "" and n == 0                   # cancelled before any token was collected


def test_unload_waits_out_the_deadline_when_the_native_call_never_finishes(native_env, monkeypatch):
    """I-1: unload()'s wait is bounded by _UNLOAD_DEADLINE_S regardless of
    whether the in-flight native call ever actually stops -- the deadline is
    the UAF backstop of last resort (module docstring), not merely an
    optimization for the common case. Shrink the deadline so this test doesn't
    need a real 10s wait; _WedgedFakeTranslator's chat() deliberately never
    observes on_token's cancellation, so `done` is never set. unload() must
    still return once ITS (shrunk) deadline elapses, and the handle must still
    be freed even though the worker never actually stopped."""
    monkeypatch.setattr(tb, "_UNLOAD_DEADLINE_S", 0.3)
    b, translator = _load_wedged(native_env, monkeypatch)

    gen_thread = threading.Thread(
        target=lambda: b.translate("hello", "", "en", "fr", False), daemon=True)
    gen_thread.start()
    assert translator.started.wait(timeout=5)   # translate() is now inside chat(), wedged

    t0 = time.monotonic()
    b.unload()
    elapsed = time.monotonic() - t0

    assert elapsed >= 0.25          # waited out (approximately) the shrunk deadline
    assert elapsed < 3.0            # ... but did not hang indefinitely either
    assert translator.unloaded is True   # backstop: freed regardless of the wedged worker
    assert b.is_loaded is False


def test_on_token_cancels_via_backend_cancel_and_returns_partial(native_env, monkeypatch):
    """cancel() (used by TranslateEngine.cancel_active()) sets the most
    recently registered worker's event -- on_token observes it and returns
    False, the fake raises exactly as the real binding would on SK_ERR_
    CANCELLED, and translate() returns the (here: empty) partial instead of
    propagating."""
    b, _log = _load_slow(native_env, monkeypatch)
    translator = b._t

    result = {}
    gen_thread = threading.Thread(
        target=lambda: result.update(out=b.translate("hello", "", "en", "fr", False)))
    gen_thread.start()
    assert translator.started.wait(timeout=5)

    b.cancel()                    # signal cancellation while still gated before the token
    translator.release.set()      # let chat() reach on_token, which now sees cancelled=True
    gen_thread.join(timeout=5)

    assert result["out"] == ("", 0)
    assert b._workers == []       # self-cleaned on the cancelled path too


def test_cancel_without_active_translate_is_a_noop(native_env):
    gguf, _log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    b.cancel()   # must not raise
    assert b._workers == []


def test_happy_path_translate_unaffected_and_self_cleans_registry(native_env):
    """Regression: the worker-registry plumbing must be invisible on the
    ordinary (non-cancelled) path -- same output as before, and the registry
    is empty again once the call returns."""
    gguf, log = native_env
    b = backends.make_backend("native_translate")
    b.load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))
    text, n = b.translate("hello", "", "en", "fr", False)
    assert text == "Bonjour." and n == 3
    assert b._workers == []
