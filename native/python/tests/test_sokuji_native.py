"""Runs against a built tree: set SOKUJI_NATIVE_DIR to the install/stage dir from Task 6
(or install the wheel). Without either, the load tests skip and only the pure-Python
contract logic is exercised."""
import json
import os
import pathlib

import numpy as np
import pytest

import sokuji_native

_ffi = sokuji_native._ffi

HAVE_TREE = bool(os.environ.get("SOKUJI_NATIVE_DIR")) or (pathlib.Path(sokuji_native.__file__).parent / "_native" / "contract.json").exists()
needs_tree = pytest.mark.skipif(not HAVE_TREE, reason="no built native tree")


def test_contract_abi_must_match(tmp_path, monkeypatch):
    bad = tmp_path / "contract.json"
    bad.write_text(json.dumps({"abi": _ffi.SK_ABI_VERSION + 1, "version": "9.9.9"}))
    with pytest.raises(sokuji_native.NativeError) as e:
        sokuji_native._check_contract(bad)
    assert "ABI" in str(e.value)


def test_contract_ok(tmp_path):
    good = tmp_path / "contract.json"
    good.write_text(json.dumps({"abi": _ffi.SK_ABI_VERSION, "version": "0.1.0", "lane": "cpu"}))
    assert sokuji_native._check_contract(good)["lane"] == "cpu"


@needs_tree
def test_version_and_engines():
    assert sokuji_native.version().startswith("0.")
    ev = sokuji_native.engine_versions()
    assert ev["ggml"] == "0.22.0"
    assert ev["transcribe"] == "0.2.2"
    assert ev["audiocpp"] == "0.7.0"
    assert ev["llama"] == "0.3.0"       # normalised: the upstream tag is v0.3.0


@needs_tree
def test_init_and_devices():
    lines = []
    sokuji_native.init(n_threads=2, log=lambda level, msg: lines.append((level, msg)))
    sokuji_native.init()                       # idempotent
    devs = sokuji_native.devices()
    assert devs and any(d.kind == "cpu" for d in devs)
    for d in devs:
        assert d.name and d.mem_total > 0
        assert sokuji_native.device_free_mem(d.index) > 0
    # A Metal build always has a Metal device (every Apple-Silicon Mac, the macos-14 runner
    # included) and it must be reported as such, not as "other". Vulkan cannot be asserted
    # the same way: the Linux/Windows CI runners have no Vulkan device at all.
    if sokuji_native.engine_versions()["lane"] == "metal":
        assert any(d.kind == "metal" for d in devs), devs
    assert lines, "sk_init logs at least one line"


@needs_tree
def test_audio_families():
    families = sokuji_native.audio_families()
    # This build compiles in every audio.cpp family, including companions that ride
    # along with a selected one (controller Ruling 8), so the exact list is longer than
    # our six targets — assert the six required names are present and the list is sorted.
    required = {"moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic"}
    assert required <= set(families)
    assert families == sorted(families)


@needs_tree
def test_bad_device_index_raises():
    sokuji_native.init()
    with pytest.raises(sokuji_native.NativeError):
        sokuji_native.device_free_mem(999)


@needs_tree
def test_second_init_log_keeps_first_trampoline_alive():
    # sk_init stores the callback pointer from its first successful call only, so that
    # trampoline must stay referenced for the life of the process, and a later
    # init(log=...) must neither replace it nor pile up trampolines native never saw.
    def trampolines():
        return [o for o in sokuji_native._state.keepalive if isinstance(o, _ffi.LOG_CB)]

    sokuji_native.init(log=lambda level, msg: None)      # already initialised by an earlier test, or now
    assert len(trampolines()) == 1
    first = trampolines()[0]

    sokuji_native.init(log=lambda level, msg: None)      # a different sink: ignored, nothing retained
    sokuji_native.init()                                  # and a third call without one

    assert trampolines() == [first]


ASR_GGUF = os.environ.get("SK_TEST_ASR_GGUF")
STREAM_GGUF = os.environ.get("SK_TEST_ASR_STREAM_GGUF")
needs_asr = pytest.mark.skipif(not (HAVE_TREE and ASR_GGUF), reason="needs a built tree and SK_TEST_ASR_GGUF")
needs_stream = pytest.mark.skipif(not (HAVE_TREE and STREAM_GGUF), reason="needs a built tree and SK_TEST_ASR_STREAM_GGUF")


def _jfk() -> np.ndarray:
    import wave
    path = os.environ.get("SK_TEST_SAMPLE_WAV") or str(
        pathlib.Path(__file__).resolve().parents[2] / "build" / "cpu" / "_deps" / "transcribe-src" / "samples" / "jfk.wav")
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


@needs_tree
def test_vad_events_on_speech():
    sokuji_native.init()
    v = sokuji_native.vad_open(min_silence_ms=500, min_speech_ms=250)
    pcm = _jfk()
    kinds = []
    for off in range(0, len(pcm) - 512 + 1, 512):
        ev = v.feed(pcm[off:off + 512])
        if ev is not None:
            kinds.append(ev.kind)
            if ev.kind == "end":
                assert ev.seg_end > ev.seg_start
    tail = v.finalize()
    if tail is not None:
        kinds.append(tail.kind)
    assert kinds and kinds[0] == "start" and "end" in kinds
    with pytest.raises(ValueError):
        v.feed(pcm[:100])                       # not 512 samples
    v.close()
    v.close()                                   # idempotent


@needs_tree
def test_vad_default_weights_live_next_to_the_library():
    sokuji_native.init()
    v = sokuji_native.vad_open()                # no path: <native_dir>/silero_vad_16k.safetensors
    v.close()


@needs_asr
def test_asr_load_run_cancel():
    sokuji_native.init()
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    m = sokuji_native.asr_load(ASR_GGUF, cpu)
    assert m.capabilities.native_sample_rate == 16000 and "en" in m.capabilities.languages
    assert m.capabilities.supports_streaming is False
    pcm = _jfk()
    text = m.run(pcm, "en")
    assert "ask not" in text.lower()
    assert m.run(pcm[:0], "en") == ""
    polls = []
    with pytest.raises(sokuji_native.NativeError) as e:
        m.run(pcm, None, on_poll=lambda: (polls.append(1), False)[1])
    assert e.value.status == sokuji_native._ffi.SK_ERR_CANCELLED and polls
    with pytest.raises(sokuji_native.NativeError):
        m.open_stream("en")                     # whisper cannot stream
    m.unload()
    m.unload()
    with pytest.raises(sokuji_native.NativeError):
        sokuji_native.asr_load("/nonexistent.gguf")


@needs_stream
def test_asr_stream_prefix_and_finalize():
    sokuji_native.init()
    m = sokuji_native.asr_load(STREAM_GGUF)
    assert m.capabilities.supports_streaming
    pcm = _jfk()
    st = m.open_stream("en")
    with pytest.raises(sokuji_native.NativeError):
        m.open_stream("en")                     # one stream per model
    last = ""
    for off in range(0, len(pcm), 8000):
        t = st.feed(pcm[off:off + 8000])
        assert t.committed.startswith(last)
        last = t.committed
    final = st.finalize()
    assert "country" in final.lower()
    with pytest.raises(sokuji_native.NativeError):
        st.feed(pcm[:8000])                     # closed after finalize
    st.close()
    st2 = m.open_stream()
    st2.feed(pcm[:8000])
    st2.close()                                 # abandon
    assert "ask not" in m.run(pcm, "en").lower()
    m.unload()


@needs_stream
def test_stream_keeps_model_alive():
    import gc
    sokuji_native.init()
    m = sokuji_native.asr_load(STREAM_GGUF)
    st = m.open_stream("en")
    pcm = _jfk()
    del m
    gc.collect()                                # the only remaining Python reference to the model is
    st.feed(pcm[:8000])                         # st._model; a dangling C handle here would crash
    st.close()
    del st
    gc.collect()                                # closing releases st._model too; this must not crash either
