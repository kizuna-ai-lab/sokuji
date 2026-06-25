import contextlib
import os
import sys
import time
import types

import numpy as np
import pytest
from sokuji_sidecar import backends


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads bezzam/Qwen3-ASR-1.7B; needs CUDA + the branch transformers)")
def test_qwen3asr_real_gpu_smoke():
    # Mirrors the real flow: manager downloads first, backend loads from cache.
    # snapshot_download without local_files_only=True here because this is the
    # download step (equivalent to native_models.download); the backend load below
    # will then use local_files_only=True from the cache.
    from huggingface_hub import snapshot_download
    snapshot_download("bezzam/Qwen3-ASR-1.7B")  # populate the HF cache
    b = backends.make_backend("qwen3asr")
    b.load("bezzam/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert b.is_loaded
    clip = np.zeros(16000 * 3, np.float32)   # 3 s silence — exercises the full path
    t0 = time.perf_counter()
    r = b.transcribe(clip, "en")
    rtf = (time.perf_counter() - t0) / 3.0
    assert isinstance(r.text, str)           # may be empty for silence; must not raise
    print(f"qwen3-asr-1.7b RTF={rtf:.4f}")
    b.unload()


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
    hub.snapshot_download = lambda repo_id, local_files_only=False: (
        captured.update({"local_files_only": local_files_only}) or f"/fake/{repo_id}"
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    return captured


def test_sherpa_load_and_transcribe(monkeypatch):
    cap = _install_fake_sherpa(monkeypatch)
    b = backends.make_backend("sherpa")
    b.load("csukuangfj/sherpa-onnx-sense-voice", "cpu", "int8")
    assert b.is_loaded
    assert cap["from_sense_voice"]["model"].endswith("/model.int8.onnx")
    assert cap["local_files_only"] is True
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
        def from_pretrained(repo, local_files_only=False):
            if fail:
                raise RuntimeError("model not found")
            cap["proc_repo"] = repo
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeAutoModel:
        @staticmethod
        def from_pretrained(repo, dtype, local_files_only=False):
            cap["model_repo"] = repo
            cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
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
    assert cap["proc_local_files_only"] is True
    assert cap["model_local_files_only"] is True
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
        def to(self, device):
            cap["model_device"] = device
            return self
        def eval(self):
            return self
        def generate(self, **kw):
            cap["gen_kw"] = kw
            return FakeGen()

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo, local_files_only=False):
            cap["proc_repo"] = repo
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeQwen3:
        @staticmethod
        def from_pretrained(repo, dtype, local_files_only=False):
            cap["repo"] = repo; cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
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
    assert cap["dtype"] == "BF16" and cap["model_device"] == "cuda"
    assert cap["proc_local_files_only"] is True
    assert cap["model_local_files_only"] is True
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "hello world"                 # prefix stripped
    assert cap["feat_dtype"] == "BF16"             # input_features cast to model dtype
    assert cap["sr"] == 16000                       # TARGET_RATE
    assert cap["slice"] == (slice(None), slice(4, None))   # decode only new tokens after the 4-token prompt
    assert cap["gen_kw"]["do_sample"] is False


def test_cohereasr_is_gpu_only():
    b = backends.make_backend("cohere_transformers")
    with pytest.raises(backends.BackendLoadError):
        b.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cpu", "bfloat16")


def _install_fake_cohere(monkeypatch, *, decoded="hello world"):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        # Cohere processor: positional audio + sampling_rate + language (no chat template)
        def __call__(self, samples, sampling_rate, return_tensors, language):
            cap["sr"] = sampling_rate
            cap["language"] = language
            b = FakeBatch()
            b["input_features"] = FakeFeat()
            return b
        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_seq"] = seq
            return [decoded]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self
        def eval(self):
            return self
        def generate(self, **kw):
            cap["gen_kw"] = kw
            return "OUT"

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo, local_files_only=False):
            cap["proc_repo"] = repo
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeCohere:
        @staticmethod
        def from_pretrained(repo, dtype, local_files_only=False):
            cap["repo"] = repo
            cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.CohereAsrForConditionalGeneration = FakeCohere
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_cohereasr_load_and_transcribe(monkeypatch):
    cap = _install_fake_cohere(monkeypatch)
    b = backends.make_backend("cohere_transformers")
    b.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["repo"] == "AEmotionStudio/cohere-transcribe-03-2026-models"
    assert cap["dtype"] == "BF16" and cap["model_device"] == "cuda"
    assert cap["proc_local_files_only"] is True
    assert cap["model_local_files_only"] is True
    r = b.transcribe(np.zeros(16000, np.float32), "ja")
    assert r.text == "hello world"            # decoded + stripped, no prefix logic
    assert cap["feat_dtype"] == "BF16"          # input_features cast to model dtype
    assert cap["sr"] == 16000                   # TARGET_RATE
    assert cap["language"] == "ja"              # explicit language passed through
    assert cap["gen_kw"]["do_sample"] is False
    b.unload()
    assert not b.is_loaded


def test_cohereasr_defaults_missing_language_to_english(monkeypatch):
    cap = _install_fake_cohere(monkeypatch)
    b = backends.make_backend("cohere_transformers")
    b.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cuda", "bfloat16")
    b.transcribe(np.zeros(16000, np.float32), "")        # empty → en
    assert cap["language"] == "en"
    b.transcribe(np.zeros(16000, np.float32), "auto")    # stale 'auto' value → en
    assert cap["language"] == "en"


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads AEmotionStudio/cohere-transcribe-03-2026-models ~4GB; needs CUDA)")
def test_cohereasr_real_gpu_smoke():
    # Real flow: manager downloads first, backend loads from cache.
    from huggingface_hub import snapshot_download
    snapshot_download("AEmotionStudio/cohere-transcribe-03-2026-models")
    b = backends.make_backend("cohere_transformers")
    b.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cuda", "bfloat16")
    assert b.is_loaded
    clip = np.zeros(16000 * 3, np.float32)   # 3 s silence — exercises the full path
    t0 = time.perf_counter()
    r = b.transcribe(clip, "en")
    rtf = (time.perf_counter() - t0) / 3.0
    assert isinstance(r.text, str)           # may be empty for silence; must not raise
    print(f"cohere-transcribe-03-2026 RTF={rtf:.4f}")
    b.unload()
    # coexistence regression: Granite + Qwen3 still load after Cohere unload + empty_cache
    import torch
    torch.cuda.empty_cache()
    g = backends.make_backend("transformers")
    g.load("ibm-granite/granite-speech-4.1-2b", "cuda", "bfloat16")
    assert g.is_loaded
    g.unload()
    q = backends.make_backend("qwen3asr")
    q.load("bezzam/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert q.is_loaded
    q.unload()


def test_voxtral_realtime_is_gpu_only():
    b = backends.make_backend("voxtral_realtime")
    with pytest.raises(backends.BackendLoadError):
        b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cpu", "bfloat16")


def _install_fake_voxtral(monkeypatch, *, decoded="  hello world  ", fail=False):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        # Voxtral realtime processor: positional audio + sampling_rate + return_tensors.
        # No language (multilingual auto-detect), no chat template. If the backend ever
        # passed language=, this signature would TypeError — guarding that contract.
        def __call__(self, samples, sampling_rate, return_tensors):
            cap["sr"] = sampling_rate
            cap["n_samples"] = len(samples)
            b = FakeBatch()
            b["input_features"] = FakeFeat()
            b["input_ids"] = "IDS"
            return b

        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_seq"] = seq
            cap["skip_special"] = skip_special_tokens
            return [decoded]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self

        def eval(self):
            return self

        def generate(self, **kw):
            cap["gen_kw"] = kw
            return "OUT"

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(path, local_files_only=False):
            cap["proc_path"] = path
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeVoxtral:
        @staticmethod
        def from_pretrained(path, dtype, local_files_only=False):
            if fail:
                raise RuntimeError("voxtral_realtime missing")
            cap["model_path"] = path
            cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.VoxtralRealtimeForConditionalGeneration = FakeVoxtral
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    hub = types.ModuleType("huggingface_hub")

    def fake_snapshot(repo, local_files_only=False):
        cap["snap_repo"] = repo
        cap["snap_local_files_only"] = local_files_only
        return f"/fake/snapshot/{repo}"

    hub.snapshot_download = fake_snapshot
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_voxtral_realtime_load_and_transcribe(monkeypatch):
    cap = _install_fake_voxtral(monkeypatch)
    b = backends.make_backend("voxtral_realtime")
    assert not b.is_loaded
    b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
    assert b.is_loaded
    # Offline load resolves the snapshot DIR (local_files_only) and loads the processor
    # + model FROM that dir — mistral_common ignores local_files_only on a repo id.
    assert cap["snap_repo"] == "mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["snap_local_files_only"] is True
    assert cap["proc_path"] == "/fake/snapshot/mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["model_path"] == "/fake/snapshot/mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["dtype"] == "BF16"            # bfloat16 → torch.bfloat16
    assert cap["model_device"] == "cuda"
    assert cap["model_local_files_only"] is True
    assert cap["proc_local_files_only"] is False  # processor loaded WITHOUT local_files_only (mistral_common ignores it)
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "hello world"           # decoded + stripped, audio-only → no prefix/slice
    assert cap["feat_dtype"] == "BF16"        # input_features cast to model dtype
    assert cap["sr"] == 16000                 # TARGET_RATE
    assert cap["skip_special"] is True
    assert cap["gen_kw"]["do_sample"] is False
    assert "max_new_tokens" not in cap["gen_kw"]   # audio-derived auto-length, no cap
    b.unload()
    assert not b.is_loaded


def test_voxtral_realtime_load_failure_raises(monkeypatch):
    _install_fake_voxtral(monkeypatch, fail=True)
    b = backends.make_backend("voxtral_realtime")
    with pytest.raises(backends.BackendLoadError):
        b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")


def test_strip_sensevoice_tags():
    raw = "<|en|><|NEUTRAL|><|Speech|><|withitn|>hello world"
    assert backends._strip_sensevoice_tags(raw) == ("hello world", "en")
    assert backends._strip_sensevoice_tags("<|yue|><|HAPPY|><|Speech|>呢几个字") == ("呢几个字", "yue")
    # no tags → no language
    assert backends._strip_sensevoice_tags("  plain text  ") == ("plain text", None)
    # leading tag that is not a language code (not lowercase) → language None
    assert backends._strip_sensevoice_tags("<|NEUTRAL|>x") == ("x", None)


def _install_fake_funasr(monkeypatch, *, text="<|en|><|NEUTRAL|><|Speech|><|withitn|>hello world", fail=False):
    cap = {}

    class FakeAutoModel:
        def __init__(self, model, hub, device, disable_update):
            if fail:
                raise RuntimeError("funasr load failed")
            cap["init"] = dict(model=model, hub=hub, device=device, disable_update=disable_update)

        def generate(self, input, fs, cache, language, use_itn, batch_size_s):
            cap["gen"] = dict(n=len(input), fs=fs, language=language,
                              use_itn=use_itn, batch_size_s=batch_size_s)
            return [{"text": text}]

    fmod = types.ModuleType("funasr")
    fmod.AutoModel = FakeAutoModel
    monkeypatch.setitem(sys.modules, "funasr", fmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_funasr_sensevoice_load_and_transcribe_gpu(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    assert not b.is_loaded
    b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")
    assert b.is_loaded
    assert cap["init"]["model"] == "FunAudioLLM/SenseVoiceSmall"
    assert cap["init"]["hub"] == "hf"
    assert cap["init"]["device"] == "cuda:0"        # "cuda" tier → cuda:0
    assert cap["init"]["disable_update"] is True
    out = b.transcribe(np.zeros(16000, np.float32), None)
    assert out.text == "hello world" and out.language == "en"   # tags stripped, lang parsed
    assert cap["gen"]["fs"] == 16000                # TARGET_RATE
    assert cap["gen"]["use_itn"] is True
    assert cap["gen"]["language"] == "auto"         # None → "auto"
    b.unload()
    assert not b.is_loaded


def test_funasr_sensevoice_honors_cpu_device(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    b.load("FunAudioLLM/SenseVoiceSmall", "cpu", "float32")  # must NOT raise (honors cpu)
    assert b.is_loaded
    assert cap["init"]["device"] == "cpu"


def test_funasr_sensevoice_passes_language_through(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")
    b.transcribe(np.zeros(16000, np.float32), "zh")
    assert cap["gen"]["language"] == "zh"           # explicit language passed through


def test_funasr_sensevoice_load_failure_raises(monkeypatch):
    _install_fake_funasr(monkeypatch, fail=True)
    b = backends.make_backend("funasr_sensevoice")
    with pytest.raises(backends.BackendLoadError):
        b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads mistralai/Voxtral-Mini-4B-Realtime-2602 ~8.9GB; needs CUDA + mistral-common[audio])")
def test_voxtral_realtime_real_gpu_smoke():
    # Real flow: manager downloads first (HF-format only, skipping the consolidated dup),
    # backend loads from cache via the snapshot-dir offline path.
    import wave
    from huggingface_hub import snapshot_download
    snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                      ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    b = backends.make_backend("voxtral_realtime")
    b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
    assert b.is_loaded
    # real English speech (sense-voice test clip) → a non-empty transcript
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    t0 = time.perf_counter()
    r = b.transcribe(audio, "en")
    rtf = (time.perf_counter() - t0) / (len(audio) / 16000.0)
    assert isinstance(r.text, str) and r.text.strip(), f"empty transcript on real speech: {r.text!r}"
    print(f"voxtral-mini-4b-realtime RTF={rtf:.4f}")
    b.unload()
    # coexistence regression: Cohere still loads after Voxtral unload + empty_cache
    import torch
    torch.cuda.empty_cache()
    c = backends.make_backend("cohere_transformers")
    c.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cuda", "bfloat16")
    assert c.is_loaded
    c.unload()


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads FunAudioLLM/SenseVoiceSmall ~900MB; needs CUDA torch + funasr)")
def test_funasr_sensevoice_real_gpu_and_cpu_smoke():
    # Real flow: manager downloads first, backend loads from cache. Use a known
    # English clip (sense-voice test wav) → a non-empty transcript on cuda AND cpu.
    import wave
    from huggingface_hub import snapshot_download
    snapshot_download("FunAudioLLM/SenseVoiceSmall")  # populate HF cache
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    with wave.open(f"{d}/test_wavs/en.wav", "rb") as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    dur = len(audio) / 16000.0

    for device in ("cuda", "cpu"):
        b = backends.make_backend("funasr_sensevoice")
        b.load("FunAudioLLM/SenseVoiceSmall", device, "float16" if device == "cuda" else "float32")
        assert b.is_loaded
        b.transcribe(audio, "en")          # warmup (excluded from RTF)
        t0 = time.perf_counter()
        r = b.transcribe(audio, "en")
        rtf = (time.perf_counter() - t0) / dur
        assert isinstance(r.text, str) and r.text.strip(), f"empty transcript on {device}: {r.text!r}"
        assert "<|" not in r.text, f"tags not stripped on {device}: {r.text!r}"
        assert r.language == "en"
        print(f"funasr sensevoice {device} RTF={rtf:.4f} text={r.text!r}")
        b.unload()
