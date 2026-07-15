import pytest
from sokuji_sidecar import translate_backends as tb
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


from sokuji_sidecar import llama_runtime as rt
from tests.test_llama_server_proc import make_fake  # fake llama-server argv


@pytest.fixture
def llama_env(monkeypatch, tmp_path):
    """Point the backend at the fake server + a fake single-gguf model dir."""
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "w.gguf").write_bytes(b"GGUF")
    fake_argv = make_fake(tmp_path)
    monkeypatch.setattr(rt, "binary_path", lambda flavor: fake_argv)
    rt.set_reserved_bytes(0)
    return str(model_dir)


class TestLlamaCppQwen:
    def test_qwen25_payload_and_output(self, llama_env):
        b = backends.make_backend("llamacpp_qwen")
        b.load(llama_env, "cpu", "q8_0")
        # the fake echoes the request back under "echo"
        text, n = b.translate("hello", "", "English", "Chinese", True)
        assert text.startswith("TRANSLATED:")
        assert n == 7
        echo = b._last_reply["echo"]
        assert echo["temperature"] == 0 and echo["max_tokens"] == 512
        assert echo["messages"][0]["role"] == "system"
        assert "/no_think" not in echo["messages"][0]["content"]
        assert echo["messages"][1]["content"] == "<transcript>hello</transcript>"
        # Qwen2.5 gets neither the thinking-mode kill-switch nor /no_think —
        # thinking mode doesn't exist for this family.
        assert "chat_template_kwargs" not in echo
        b.unload()
        assert not b.is_loaded

    def test_qwen3_config_gets_no_think_and_enable_thinking_false(self, llama_env):
        # qwen3-0.6b's catalog card carries disable_thinking=True,
        # append_no_think=True (planner._plan_config reads these off the
        # card) — the backend must derive both the kill-switch and the
        # soft-switch from the injected PlanConfig, not from the model path.
        b = backends.make_backend("llamacpp_qwen")
        b.load(llama_env, "cpu", "q8_0",
               config=PlanConfig(disable_thinking=True, append_no_think=True))
        b.translate("hi", "", "en", "zh", False)
        echo = b._last_reply["echo"]
        assert "/no_think" in echo["messages"][0]["content"]
        assert echo["chat_template_kwargs"] == {"enable_thinking": False}
        b.unload()

    def test_qwen35_config_enable_thinking_false_no_no_think(self, llama_env):
        # Qwen3.5 ignores the /no_think soft switch (verified live: it still
        # burns all max_tokens reasoning and returns empty content), so it
        # must NOT be appended; chat_template_kwargs is the only mechanism
        # that actually disables thinking mode for this model. Its catalog
        # card carries disable_thinking=True, append_no_think=False (the
        # default) — mirrored here via PlanConfig instead of a magic path.
        b = backends.make_backend("llamacpp_qwen")
        b.load(llama_env, "cpu", "q4_k_m",
               config=PlanConfig(disable_thinking=True, append_no_think=False))
        b.translate("hi", "", "en", "zh", False)
        echo = b._last_reply["echo"]
        assert "/no_think" not in echo["messages"][0]["content"]
        assert echo["chat_template_kwargs"] == {"enable_thinking": False}
        b.unload()

    def test_qwen_plain_config_neither_flag(self, llama_env):
        # A plain model (e.g. qwen2.5-0.5b) has no thinking flags on its
        # catalog card, so its PlanConfig is all-inert defaults — pinned
        # explicitly here (in addition to test_qwen25_payload_and_output,
        # which exercises the same case via the load() default `config=None`)
        # so the config-driven "neither" path has a direct assertion.
        b = backends.make_backend("llamacpp_qwen")
        b.load(llama_env, "cpu", "q8_0", config=PlanConfig())
        b.translate("hi", "", "en", "zh", False)
        echo = b._last_reply["echo"]
        assert "/no_think" not in echo["messages"][0]["content"]
        assert "chat_template_kwargs" not in echo
        b.unload()

    def test_missing_binary_is_load_error(self, monkeypatch, tmp_path):
        monkeypatch.setattr(rt, "binary_path", lambda flavor: None)
        b = backends.make_backend("llamacpp_qwen")
        with pytest.raises(backends.BackendLoadError):
            b.load(str(tmp_path), "cuda", "q4_k_m")


class TestLlamaCppHunyuanGemma:
    def test_hunyuan_single_user_message(self, llama_env):
        b = backends.make_backend("llamacpp_hunyuan")
        b.load(llama_env, "cpu", "q4_k_m")
        b.translate("bonjour", "", "French", "English", True)
        echo = b._last_reply["echo"]
        msgs = echo["messages"]
        assert len(msgs) == 1 and msgs[0]["role"] == "user"
        assert "into English" in msgs[0]["content"]
        assert "<transcript>bonjour</transcript>" in msgs[0]["content"]
        assert "chat_template_kwargs" not in echo
        b.unload()

    def test_gemma_uses_completion_with_no_jinja(self, llama_env):
        b = backends.make_backend("llamacpp_gemma")
        b.load(llama_env, "cpu", "q4_k_m")
        assert "--no-jinja" in b._proc._build_args()
        b.translate("hello", "ignored-system-prompt", "English", "Japanese", False)
        echo = b._last_reply["echo"]
        assert "<start_of_turn>user" in echo["prompt"]
        assert "(en)" in echo["prompt"] and "(ja)" in echo["prompt"]
        assert echo["n_predict"] == 256
        b.unload()

    def test_gemma_prompt_omits_empty_code_for_falsy_src(self, llama_env):
        # Regression: a falsy src/tgt (auto-detect / unset) used to render as
        # "the source language ()" — an empty, leaked parenthetical — because
        # _gemma_code("") passes the falsy value straight through unchanged.
        b = backends.make_backend("llamacpp_gemma")
        b.load(llama_env, "cpu", "q4_k_m")
        prompt = b._render_prompt("hello", "", "Japanese", False)
        assert "()" not in prompt
        assert "the source language to Japanese (ja)" in prompt
        assert "(ja)" in prompt
        b.unload()


class TestCt2Opus:
    def test_load_and_translate(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        class StubSession:
            def __init__(self, model_dir):
                self.model_dir = model_dir
            def translate(self, text, max_new_tokens=512):
                return f"UEBERSETZT:{text}", 4
        monkeypatch.setattr(tb, "Ct2OpusSession", StubSession)
        b = backends.make_backend("ct2_opus_translate")
        b.load(str(tmp_path), "cpu", "int8")
        assert b.is_loaded
        # direction is pair-baked: prompt/src/tgt/wrap are ignored
        text, n = b.translate("guten tag", "sys", "de", "en", True)
        assert text == "UEBERSETZT:guten tag" and n == 4
        b.unload()
        assert not b.is_loaded

    def test_load_error_wrapped(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        def boom(model_dir):
            raise RuntimeError("no such file")
        monkeypatch.setattr(tb, "Ct2OpusSession", boom)
        b = backends.make_backend("ct2_opus_translate")
        with pytest.raises(backends.BackendLoadError):
            b.load(str(tmp_path), "cpu", "int8")


class _DeadProc:
    """A llama-server proxy that is dead and stays dead across restarts —
    models the VRAM-exhaustion crash loop (cublasCreate fails on every
    fresh start's first request)."""
    def __init__(self):
        self.restarts = 0
        self.stopped = False

    def chat(self, payload):
        raise ConnectionError("Remote end closed connection without response")

    completion = chat

    def alive(self):
        return False

    def restart(self):
        self.restarts += 1

    def stop(self):
        self.stopped = True

    def stderr_tail(self):
        return "CUDA error: the resource allocation failed"


class TestDeadServerLatch:
    def test_send_latches_dead_after_double_crash(self):
        """REGRESSION (voxtral session, 2026-07-05): a server that dies again
        right after its one in-place restart (VRAM exhaustion) must NOT be
        restarted on every subsequent utterance — that thrashed one full model
        reload per ASR result. Latch dead, surface the crash reason once,
        fail fast afterwards."""
        b = backends.make_backend("llamacpp_qwen")
        b._proc = proc = _DeadProc()
        with pytest.raises(backends.BackendLoadError) as ei:
            b.translate("hi", "", "en", "zh", False)
        assert "resource allocation" in str(ei.value)   # stderr tail surfaced
        assert proc.restarts == 1 and proc.stopped
        assert not b.is_loaded
        # subsequent utterances fail fast: no further restart churn
        with pytest.raises(backends.BackendLoadError):
            b.translate("hi again", "", "en", "zh", False)
        assert proc.restarts == 1
