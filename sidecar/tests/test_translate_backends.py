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
    gen_tokens = MagicMock()
    gen_tokens.shape = [7]                                       # 7 "generated" tokens → int-able count
    gen_out = MagicMock()
    gen_out.__getitem__ = MagicMock(return_value=gen_tokens)     # out[0][slice] → gen_tokens
    model.generate.return_value = [gen_out]
    return model


def test_backends_are_registered():
    assert backends._BACKENDS.get("qwen_translate") is tb.QwenTranslateBackend
    assert backends._BACKENDS.get("qwen35_translate") is tb.Qwen35TranslateBackend


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


def test_qwen35_text_only_uses_tokenizer_string_content():
    # Qwen3.5 is a VLM, but we translate text only. The backend must drive a plain
    # tokenizer with string ChatML content — NOT AutoProcessor, whose video processor
    # hard-requires torchvision (unavailable for the sidecar's torch build).
    captured = []
    b = tb.Qwen35TranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    out, n_tokens = b.translate("hi", "", "Japanese", "English", wrap=True)
    assert out == "translated"
    assert n_tokens == 7                                   # generated-token count for the tps benchmark
    sys_msg = next(m for m in captured if m["role"] == "system")
    user_msg = next(m for m in captured if m["role"] == "user")
    # string content, not the multimodal [{"type": "text", ...}] list form
    assert isinstance(sys_msg["content"], str)
    assert user_msg["content"] == "<transcript>hi</transcript>"


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


def test_hunyuan_registered():
    assert backends._BACKENDS.get("hunyuan_translate") is tb.HunyuanTranslateBackend


def test_hunyuan_prompt_mentions_target_only():
    p = tb._hunyuan_prompt("English")
    assert "into English" in p and "only output" in p.lower()


def test_hunyuan_single_user_message_with_target_and_wrap():
    captured = []
    b = tb.HunyuanTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    out, n = b.translate("hi", "", "Japanese", "English", wrap=True)
    assert out == "translated" and n == 7
    # HY-MT2 format: a single user turn, instruction + (wrapped) text concatenated.
    assert len(captured) == 1 and captured[0]["role"] == "user"
    content = captured[0]["content"]
    assert isinstance(content, str)
    assert content.startswith("Translate the following text into English.")
    assert content.endswith("<transcript>hi</transcript>")


def test_hunyuan_load_raises_on_failure(monkeypatch):
    import sys
    fake = MagicMock()
    fake.AutoModelForCausalLM.from_pretrained.side_effect = RuntimeError("no weights")
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.HunyuanTranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("tencent/Hy-MT2-1.8B", "cuda", "bfloat16")


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


def test_hunyuan_fp8_loads_without_forced_dtype(monkeypatch):
    import sys
    captured = {}
    fake = MagicMock()
    def from_pretrained(ref, **kw):
        captured.update(kw)
        return MagicMock(to=lambda d: MagicMock(eval=lambda: MagicMock()))
    fake.AutoModelForCausalLM.from_pretrained.side_effect = from_pretrained
    fake.AutoTokenizer.from_pretrained.return_value = MagicMock()
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.HunyuanTranslateBackend()
    b.load("tencent/Hy-MT2-7B-FP8", "cuda", "fp8")
    # fp8 → dtype="auto", NOT a forced torch dtype; no trust_remote_code
    assert captured.get("dtype") == "auto"
    assert "trust_remote_code" not in captured


def test_hunyuan_bf16_still_forces_dtype(monkeypatch):
    import sys, types
    captured = {}
    fake = MagicMock()
    def from_pretrained(ref, **kw):
        captured.update(kw)
        return MagicMock(to=lambda d: MagicMock(eval=lambda: MagicMock()))
    fake.AutoModelForCausalLM.from_pretrained.side_effect = from_pretrained
    fake.AutoTokenizer.from_pretrained.return_value = MagicMock()
    monkeypatch.setitem(sys.modules, "transformers", fake)
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(bfloat16="BF16", float32="F32"))
    b = tb.HunyuanTranslateBackend()
    b.load("tencent/Hy-MT2-7B", "cuda", "bfloat16")
    assert captured.get("dtype") == "BF16"


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads Hy-MT2-1.8B + needs CUDA)")
def test_hunyuan_translate_real_gpu():
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="hy-mt2-1.8b", source_lang="Chinese", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("你好，最近怎么样？")
    assert isinstance(out, str) and out.strip() and ms >= 0
    eng.close()


def test_gemma_registered():
    assert backends._BACKENDS.get("gemma_translate") is tb.GemmaTranslateBackend


def test_gemma_code_maps_names_and_passes_through():
    assert tb._gemma_code("Japanese") == "ja"
    assert tb._gemma_code("English") == "en"
    assert tb._gemma_code("Klingon") == "Klingon"   # unknown → pass through
    assert tb._gemma_code("zh") == "zh"             # already a code → pass through


def test_gemma_text_only_message_with_bcp47_codes():
    captured = []
    b = tb.GemmaTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    out, n = b.translate("hi", "", "Japanese", "English", wrap=False)
    assert out == "translated" and n == 7
    assert len(captured) == 1 and captured[0]["role"] == "user"
    content = captured[0]["content"]
    # TranslateGemma's multimodal-style content list with per-message lang codes.
    assert isinstance(content, list) and len(content) == 1
    entry = content[0]
    assert entry["type"] == "text"
    assert entry["source_lang_code"] == "ja"
    assert entry["target_lang_code"] == "en"
    assert entry["text"] == "hi"


def test_gemma_load_raises_when_class_missing(monkeypatch):
    import sys
    fake = MagicMock()
    del fake.Gemma3ForConditionalGeneration   # attribute access raises AttributeError
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.GemmaTranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("google/translategemma-4b-it", "cuda", "bfloat16")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads TranslateGemma-4B + needs CUDA + Gemma license)")
def test_gemma_translate_real_gpu():
    # Also the validation gate for the AutoTokenizer chat-template path: if the
    # tokenizer lacks the template, this fails and the backend needs the manual-prompt
    # fallback noted in the spec.
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="translategemma-4b", source_lang="Japanese", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("こんにちは、お元気ですか？")
    assert isinstance(out, str) and out.strip() and ms >= 0
    eng.close()


def test_opus_backend_registered():
    assert backends._BACKENDS.get("opus_translate") is tb.OpusTranslateBackend


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


def test_opus_translate_runs_seq2seq_and_ignores_prompt():
    import torch  # noqa: F401  (translate imports torch internally)
    b = tb.OpusTranslateBackend()
    # Seq2seq generate returns the translation tokens directly (no input slice).
    seq = MagicMock()
    seq.shape = [4]                     # 4 output tokens → int-able count
    model = MagicMock()
    model.generate.return_value = [seq]
    tok = MagicMock()
    tok.side_effect = lambda text, **kw: FakeInputs(input_ids=MagicMock(shape=[1, 3]))
    tok.decode.return_value = "  translated  "
    b._model = model
    b._tok = tok
    b._device = "cpu"
    out, n = b.translate("hello", "ignored-prompt", "ja", "en", True)
    assert out == "translated"          # stripped
    assert n == 4
    assert model.generate.called
    # Marian is pair-baked: no chat template is ever applied.
    assert not tok.apply_chat_template.called
