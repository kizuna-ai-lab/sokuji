import pytest
from sokuji_sidecar import translate_backends as tb
from sokuji_sidecar import backends


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
        b.unload()
        assert not b.is_loaded

    def test_qwen3_gets_no_think(self, llama_env, monkeypatch, tmp_path):
        d = tmp_path / "sokuji-translate-qwen3-0.6b-q8_0"
        d.mkdir()
        (d / "w.gguf").write_bytes(b"GGUF")
        b = backends.make_backend("llamacpp_qwen")
        b.load(str(d), "cpu", "q8_0")
        b.translate("hi", "", "en", "zh", False)
        assert "/no_think" in b._last_reply["echo"]["messages"][0]["content"]
        b.unload()

    def test_qwen35_no_think_absent(self, llama_env, tmp_path):
        d = tmp_path / "sokuji-translate-qwen3.5-0.8b-q4_k_m"
        d.mkdir()
        (d / "w.gguf").write_bytes(b"GGUF")
        b = backends.make_backend("llamacpp_qwen")
        b.load(str(d), "cpu", "q4_k_m")
        b.translate("hi", "", "en", "zh", False)
        assert "/no_think" not in b._last_reply["echo"]["messages"][0]["content"]
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


class TestOpusOnnx:
    def test_load_and_translate(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        class StubSession:
            def __init__(self, model_dir):
                self.model_dir = model_dir
            def translate(self, text, max_new_tokens=512):
                return f"UEBERSETZT:{text}", 4
        monkeypatch.setattr(tb, "MarianOnnxSession", StubSession)
        b = backends.make_backend("opus_onnx_translate")
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
        monkeypatch.setattr(tb, "MarianOnnxSession", boom)
        b = backends.make_backend("opus_onnx_translate")
        with pytest.raises(backends.BackendLoadError):
            b.load(str(tmp_path), "cpu", "int8")
