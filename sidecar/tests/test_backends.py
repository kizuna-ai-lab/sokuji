import contextlib
import sys
import types

import numpy as np
import pytest
from sokuji_sidecar import backends


def test_make_backend_unknown_raises():
    with pytest.raises(backends.BackendLoadError):
        backends.make_backend("nope")


def test_register_and_make_returns_instance():
    @backends.register_backend
    class _Dummy:
        NAME = "dummy_test"
        def __init__(self): self.loaded = False
        def load(self, model_ref, device, compute_type): self.loaded = True
        def transcribe(self, samples, language): return backends.AsrResult("x")
        def unload(self): self.loaded = False
        @property
        def is_loaded(self): return self.loaded

    b = backends.make_backend("dummy_test")
    assert b.NAME == "dummy_test"
    b.load("m", "cpu", "int8")
    assert b.is_loaded
    assert b.transcribe(np.zeros(4, np.float32), None).text == "x"


def test_asr_result_defaults():
    r = backends.AsrResult("hello")
    assert r.text == "hello" and r.language is None


def _install_fake_faster_whisper(monkeypatch, *, fail=False):
    seg = types.SimpleNamespace(text=" hello")
    captured = {}

    class FakeWhisperModel:
        def __init__(self, model_ref, device, compute_type):
            if fail:
                raise RuntimeError("CUDA driver missing")
            captured["args"] = (model_ref, device, compute_type)
        def transcribe(self, samples, language, beam_size, vad_filter):
            captured["transcribe"] = (len(samples), language, beam_size, vad_filter)
            return [seg], types.SimpleNamespace(language="en")

    mod = types.ModuleType("faster_whisper")
    mod.WhisperModel = FakeWhisperModel
    monkeypatch.setitem(sys.modules, "faster_whisper", mod)
    return captured


def test_ctranslate2_load_and_transcribe(monkeypatch):
    cap = _install_fake_faster_whisper(monkeypatch)
    b = backends.make_backend("ctranslate2")
    assert not b.is_loaded
    b.load("large-v3", "cpu", "int8")
    assert b.is_loaded and cap["args"] == ("large-v3", "cpu", "int8")
    out = b.transcribe(np.zeros(160, np.float32), "en")
    assert out.text == "hello"
    assert cap["transcribe"][1] == "en" and cap["transcribe"][2] == 1 and cap["transcribe"][3] is False
    b.unload()
    assert not b.is_loaded


def test_ctranslate2_load_failure_raises_backendloaderror(monkeypatch):
    _install_fake_faster_whisper(monkeypatch, fail=True)
    b = backends.make_backend("ctranslate2")
    with pytest.raises(backends.BackendLoadError):
        b.load("large-v3", "cuda", "float16")


def _install_fake_sherpa(monkeypatch, *, fail=False):
    captured = {}

    class FakeStream:
        def __init__(self): self.result = types.SimpleNamespace(text="  konnichiwa ")
        def accept_waveform(self, rate, samples): captured["fed"] = (rate, len(samples))

    class FakeRecognizer:
        def create_stream(self): return FakeStream()
        def decode_stream(self, s): captured["decoded"] = True

    class FakeOfflineRecognizer:
        @staticmethod
        def from_sense_voice(model, tokens, use_itn, provider="cpu"):
            if fail:
                raise RuntimeError("model file missing")
            captured["from_sense_voice"] = dict(model=model, tokens=tokens,
                                                use_itn=use_itn, provider=provider)
            return FakeRecognizer()

    sherpa = types.ModuleType("sherpa_onnx")
    sherpa.OfflineRecognizer = FakeOfflineRecognizer
    monkeypatch.setitem(sys.modules, "sherpa_onnx", sherpa)

    hub = types.ModuleType("huggingface_hub")
    hub.snapshot_download = lambda repo_id: f"/fake/{repo_id}"
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    return captured


def test_sherpa_load_and_transcribe(monkeypatch):
    cap = _install_fake_sherpa(monkeypatch)
    b = backends.make_backend("sherpa")
    b.load("csukuangfj/sherpa-onnx-sense-voice", "cpu", "int8")
    assert b.is_loaded
    assert cap["from_sense_voice"]["model"].endswith("/model.int8.onnx")
    out = b.transcribe(np.zeros(16000, np.float32), None)
    assert out.text == "konnichiwa" and cap["decoded"] is True
    assert cap["fed"][0] == 16000 and cap["fed"][1] == 16000
    b.unload()
    assert not b.is_loaded


def test_sherpa_load_failure_raises(monkeypatch):
    _install_fake_sherpa(monkeypatch, fail=True)
    b = backends.make_backend("sherpa")
    with pytest.raises(backends.BackendLoadError):
        b.load("bad/repo", "cpu", "int8")


def _install_fake_transformers(monkeypatch, *, fail=False):
    cap = {}

    class FakeIds:
        shape = (1, 4)  # prompt length 4

    class FakeInputs(dict):
        def to(self, device):
            cap["to_device"] = device
            return self

    class FakeTok:
        def apply_chat_template(self, chat, tokenize, add_generation_prompt):
            cap["chat"] = chat
            return "PROMPT_TEXT"
        def decode(self, tokens, skip_special_tokens=True):
            return "  the tribal chieftain  "

    class FakeProc:
        tokenizer = FakeTok()
        def __call__(self, ptext, samples, device, return_tensors):
            cap["proc_call"] = (ptext, len(samples), device, return_tensors)
            return FakeInputs({"input_ids": FakeIds()})

    class FakeOut:
        def __getitem__(self, idx):  # out[0, 4:]
            cap["slice"] = idx
            return ["a", "b"]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self
        def eval(self):
            return self
        def generate(self, **kw):
            cap["generate_kw"] = kw
            return FakeOut()

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo):
            if fail:
                raise RuntimeError("model not found")
            cap["proc_repo"] = repo
            return FakeProc()

    class FakeAutoModel:
        @staticmethod
        def from_pretrained(repo, dtype):
            cap["model_repo"] = repo
            cap["dtype"] = dtype
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.AutoModelForSpeechSeq2Seq = FakeAutoModel
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_transformers_load_and_transcribe(monkeypatch):
    cap = _install_fake_transformers(monkeypatch)
    b = backends.make_backend("transformers")
    assert not b.is_loaded
    b.load("ibm-granite/granite-speech-4.1-2b", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["model_repo"] == "ibm-granite/granite-speech-4.1-2b"
    assert cap["dtype"] == "BF16"          # bfloat16 → torch.bfloat16
    assert cap["model_device"] == "cuda"
    out = b.transcribe(np.zeros(16000, np.float32), "en")
    assert out.text == "the tribal chieftain"   # decoded + stripped
    assert "<|audio|>" in cap["chat"][-1]["content"]   # audio placeholder in the user prompt
    assert cap["generate_kw"]["do_sample"] is False
    assert cap["generate_kw"]["num_beams"] == 1
    assert cap["slice"] == (0, slice(4, None))   # decodes only the new tokens after the 4-token prompt
    b.unload()
    assert not b.is_loaded


def test_transformers_load_failure_raises(monkeypatch):
    _install_fake_transformers(monkeypatch, fail=True)
    b = backends.make_backend("transformers")
    with pytest.raises(backends.BackendLoadError):
        b.load("bad/repo", "cuda", "bfloat16")


def test_strip_qwen_prefix():
    assert backends._strip_qwen_prefix("language Chinese<asr_text>foo bar") == "foo bar"
    assert backends._strip_qwen_prefix("  plain text  ") == "plain text"


def test_qwen3asr_is_gpu_only():
    b = backends.make_backend("qwen3asr")
    with pytest.raises(backends.BackendLoadError):
        b.load("bezzam/Qwen3-ASR-1.7B", "cpu", "bfloat16")


def _install_fake_qwen3(monkeypatch, *, decoded="language Chinese<asr_text>hello world"):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeIds:
        shape = (1, 4)

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        def apply_chat_template(self, conv, tokenize=False, add_generation_prompt=False):
            cap["conv"] = conv
            return "PROMPT"
        def __call__(self, text, audio, sampling_rate, return_tensors):
            cap["sr"] = sampling_rate
            b = FakeBatch(); b["input_features"] = FakeFeat(); b["input_ids"] = FakeIds()
            return b
        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_slice"] = seq
            return [decoded]

    class FakeGen:
        def __getitem__(self, idx):
            cap["slice"] = idx
            return "NEW"

    class FakeModel:
        def eval(self):
            return self
        def generate(self, **kw):
            cap["gen_kw"] = kw
            return FakeGen()

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo):
            cap["proc_repo"] = repo
            return FakeProc()

    class FakeQwen3:
        @staticmethod
        def from_pretrained(repo, dtype, device_map):
            cap["repo"] = repo; cap["dtype"] = dtype; cap["device_map"] = device_map
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.Qwen3ASRForConditionalGeneration = FakeQwen3
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"; torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_qwen3asr_load_and_transcribe(monkeypatch):
    cap = _install_fake_qwen3(monkeypatch)
    b = backends.make_backend("qwen3asr")
    b.load("bezzam/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["repo"] == "bezzam/Qwen3-ASR-1.7B"
    assert cap["dtype"] == "BF16" and cap["device_map"] == "cuda"
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "hello world"                 # prefix stripped
    assert cap["feat_dtype"] == "BF16"             # input_features cast to model dtype
    assert cap["sr"] == 16000                       # TARGET_RATE
    assert cap["slice"] == (slice(None), slice(4, None))   # decode only new tokens after the 4-token prompt
    assert cap["gen_kw"]["do_sample"] is False
