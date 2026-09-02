"""Runs against a built tree: set SOKUJI_NATIVE_DIR to the install/stage dir from Task 6
(or install the wheel). Without either, the load tests skip and only the pure-Python
contract logic is exercised."""
import json
import os
import pathlib
import re
import subprocess
import sys

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
def test_contract_backends_match_lane():
    """CMake scoping bug (fixed in slice5b task 3): a vulkan/metal build's contract.json
    used to advertise backends=["cpu"] regardless of the lane, because GGML_VULKAN/
    GGML_METAL — the cache variables native/CMakeLists.txt read to build this field — get
    re-forced OFF by transcribe.cpp's own CMakeLists.txt (from its TRANSCRIBE_VULKAN/
    TRANSCRIBE_METAL, deliberately OFF) after ggml_options.cmake already set them
    correctly. The real ggml build is unaffected (transcribe's clobber lands after ggml's
    own CMakeLists.txt already read the correct value), so only this manifest field lied."""
    c = sokuji_native.contract()
    lane = c["lane"]                    # "cpu" | "cpu-vulkan" | "metal"
    backends = c["backends"]
    assert "cpu" in backends
    if lane == "cpu-vulkan":
        assert "vulkan" in backends, backends
    elif lane == "metal":
        assert "metal" in backends, backends
    else:
        assert backends == ["cpu"], backends


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
    # "silero_vad" stays in this set even though sokuji-native dropped sk_vad_*: audio.cpp
    # always compiles silero_vad in regardless of AUDIOCPP_MODELS (see upstreams.cmake), so
    # the family rides along unused, reported by sk_audio_families() but never called.
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
TRANSLATE_GGUF = os.environ.get("SK_TEST_TRANSLATE_GGUF")
needs_asr = pytest.mark.skipif(not (HAVE_TREE and ASR_GGUF), reason="needs a built tree and SK_TEST_ASR_GGUF")
needs_stream = pytest.mark.skipif(not (HAVE_TREE and STREAM_GGUF), reason="needs a built tree and SK_TEST_ASR_STREAM_GGUF")
needs_translate = pytest.mark.skipif(not (HAVE_TREE and TRANSLATE_GGUF), reason="needs a built tree and SK_TEST_TRANSLATE_GGUF")


def _jfk() -> np.ndarray:
    import wave
    path = os.environ.get("SK_TEST_SAMPLE_WAV") or str(
        pathlib.Path(__file__).resolve().parents[2] / "build" / "cpu" / "_deps" / "transcribe-src" / "samples" / "jfk.wav")
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


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


@needs_stream
def test_unload_with_open_stream_closes_it_first():
    """An explicit m.unload() while a stream is open must close the stream (header
    contract: a stream never outlives its model) — not leave a dangling C handle."""
    sokuji_native.init()
    m = sokuji_native.asr_load(STREAM_GGUF)
    st = m.open_stream("en")
    m.unload()
    with pytest.raises(sokuji_native.NativeError):
        st.feed(_jfk()[:8000])                  # closed, not use-after-free
    st.close()                                  # idempotent


def test_binding_lock_is_reentrant():
    """sk_init's log callback may call back into the binding (version(), say);
    _load() then re-acquires _lock on the same thread — RLock or deadlock."""
    with sokuji_native._lock:
        assert sokuji_native.version()


@needs_translate
def test_translate_chat_streams_and_suppresses_thinking():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF, n_ctx=2048)
    pieces = []
    out = t.chat([{"role": "system", "content": "Translate the user's text from English to French. Output only the translation."},
                  {"role": "user", "content": "Good morning."}],
                 max_tokens=64, assistant_prefill="<think>\n\n</think>\n\n",
                 on_token=lambda p: pieces.append(p))
    assert out and "".join(pieces) == out
    assert "<think>" not in out
    t.unload()


@needs_translate
def test_translate_cancel_via_on_token():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF, n_ctx=2048)
    seen = []
    def stop_after_two(p):
        seen.append(p)
        return len(seen) < 2
    with pytest.raises(sokuji_native.NativeError):
        t.chat([{"role": "user", "content": "Count from one to fifty in words."}],
               max_tokens=256, on_token=stop_after_two)
    assert len(seen) == 2
    # the handle survives a cancelled request
    out = t.complete("The capital of France is", max_tokens=8)
    assert out
    t.unload()


@needs_translate
def test_translate_unload_idempotent_and_del_safe():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF)
    t.unload()
    t.unload()


TTS_SUPERTONIC_DIR = os.environ.get("SK_TEST_TTS_SUPERTONIC_DIR")
TTS_MOSS_DIR = os.environ.get("SK_TEST_TTS_MOSS_DIR")
TTS_QWEN3_DIR = os.environ.get("SK_TEST_TTS_QWEN3_DIR")
TTS_POCKET_DIR = os.environ.get("SK_TEST_TTS_POCKET_DIR")
TTS_OMNIVOICE_DIR = os.environ.get("SK_TEST_TTS_OMNIVOICE_DIR")
needs_tts_supertonic = pytest.mark.skipif(not (HAVE_TREE and TTS_SUPERTONIC_DIR), reason="needs a built tree and SK_TEST_TTS_SUPERTONIC_DIR")
needs_tts_moss = pytest.mark.skipif(not (HAVE_TREE and TTS_MOSS_DIR), reason="needs a built tree and SK_TEST_TTS_MOSS_DIR")


@needs_tts_supertonic
def test_tts_supertonic_streams_presets_and_cancel():
    sokuji_native.init()
    # NULL device = engine auto (slice-3 ruling), which picks Metal on mac
    # lanes where supertonic aborts (R19 — ggml-metal-ops.cpp:204,
    # "unsupported op", inside synthesize_supertonic_chunk); this binding test
    # pins cpu explicitly, like the CTest (native/tests/test_tts.cpp) does.
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    t = sokuji_native.tts_load(TTS_SUPERTONIC_DIR, "supertonic", cpu)
    caps = t.capabilities
    assert caps.streaming and not caps.clones and caps.sample_rate == 44100
    names = t.presets()
    assert "M1" in names and len(names) >= 10
    t.set_preset("M1")
    chunks = []
    # Deviation from the brief's literal "Hello from the binding." (native/tests/test_tts.cpp
    # and task-1-report.md deviation 3): supertonic's default English text-chunk budget is
    # 300 codepoints (supertonic/session.cpp:build_chunk_requests), and streaming yields one
    # event per text chunk, so anything shorter than that is exactly 1 chunk regardless of
    # on_chunk — the len(chunks) >= 2 assertion below is unreachable with a short sentence.
    # Reusing the CTest's already-verified >300-char text here for parity between the two
    # test suites.
    samples, rate = t.synth(
        "Hello from the parity gate. This sentence is intentionally long enough to span more than "
        "one streaming chunk, so the cancel-and-resume test can exercise a genuine multi-chunk pull "
        "loop end to end, matching the exact chunk boundaries audio.cpp itself produces for an "
        "ordinary paragraph of prose sent through this interface.",
        language="en", on_chunk=lambda pcm, sr: chunks.append((len(pcm), sr)))
    assert rate == 44100 and len(samples) > 0 and len(chunks) >= 2
    assert samples.ndim == 1   # mono: numpy-natural 1-D, not a (frames, 1) column
    assert sum(n for n, _ in chunks) == len(samples)
    seen = []
    def stop_after_one(pcm, sr):
        seen.append(len(pcm))
        return False
    with pytest.raises(sokuji_native.NativeError):
        t.synth(
            "A longer sentence, long enough that a second streaming chunk would surely follow after the "
            "first one, is used here to make sure the callback returning false actually interrupts the "
            "pull loop before the remaining audio chunks are ever produced, rather than merely finishing "
            "a synthesis run that was always going to be a single chunk anyway.",
            language="en", on_chunk=stop_after_one)
    assert len(seen) == 1
    samples2, _ = t.synth("Still alive.", language="en")
    assert len(samples2) > 0
    t.unload()


@needs_tts_moss
def test_tts_moss_offline_and_clone():
    sokuji_native.init()
    # NULL device = engine auto (slice-3 ruling), which would pick Metal on
    # mac lanes; R19 keeps every TTS family cpu-only in production until
    # validated per family per lane, so this binding test pins cpu explicitly
    # too, like the CTest (native/tests/test_tts.cpp) does.
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    t = sokuji_native.tts_load(TTS_MOSS_DIR, "moss_tts_nano", cpu)
    assert not t.capabilities.streaming and t.capabilities.clones
    assert t.presets() == []
    samples, rate = t.synth("Hello from MOSS.")
    assert rate == 48000 and len(samples) > 0
    # moss_tts_nano's audio tokenizer output is stereo (confirmed against the official
    # audiocpp_cli's own --metrics output, native/tests/parity/): synth() must hand back a
    # numpy-natural 2-D (frames, channels) array, not a flat buffer mislabeled as mono.
    assert samples.ndim == 2 and samples.shape[1] == 2
    # Ruling R23 (.superpowers/moss-eoc-verdict.md): moss_tts_nano samples its stop decision
    # instead of arg-maxing it, so a short utterance reaches real end-of-content well under
    # audio.cpp's 300-frame/24.000s max_new_frames cap (measured there: 2.6-3.7s). This
    # duration<10s check replaces what a greedy build would otherwise show as a cap-shaped
    # ~24.0s expectation, every time.
    assert samples.shape[0] / rate < 10.0
    ref = np.sin(np.linspace(0, 2 * np.pi * 440, 24000)).astype(np.float32)
    t.set_voice(ref, 24000, ref_text="test")
    samples2, rate2 = t.synth("Hello again.")
    assert len(samples2) > 0
    assert samples2.ndim == 2 and samples2.shape[1] == 2
    assert samples2.shape[0] / rate2 < 10.0
    t.unload()
    t.unload()


# --------------------------------------------------------------------------------------
# TTS on a real GPU device.
#
# Every TTS test above pins the CPU device on purpose (R19). This one is the opposite gate,
# and it exists because a green suite is not evidence a GPU lane works: the slice-4
# mac-arm64/metal lane shipped a wheel while three of the five families aborted the process
# on Metal, precisely because nothing here ever placed a TTS session on a Metal device
# (.superpowers/metal-tts-validation.md §1, .superpowers/metal-fix-experiments.md §1).
#
# Gating, three independent conditions so the test disappears where it cannot mean anything:
#   - SK_TEST_TTS_GPU=1 (opt-in: this loads models onto a GPU, which a plain dev run
#     of the binding tests should not do behind the developer's back);
#   - the family's own SK_TEST_TTS_<FAMILY>_DIR, same pattern as the CPU tests above —
#     CI caches only supertonic and moss, so the other three simply skip there;
#   - devices() reporting a non-CPU device at all. The Linux/Windows CI runners are
#     headless with no Vulkan device, so they skip; the mac-arm64 runner always has Metal.
#
# One subprocess per family. A backend that lacks a kernel does not raise: ggml logs
# "unsupported op '<OP>'" and calls GGML_ABORT, i.e. SIGABRT of the whole process, so an
# in-process failure would take the pytest session with it and report nothing. The child
# registers NO log sink, exactly like the rest of this file — the abort line reaching its
# stderr is sk_common.cpp's warn/error fallback doing its job, and that fallback is the only
# reason the assertion below can name the missing op instead of an anonymous exit −6.
#
# The bar is deliberately model-free: non-empty audio of a sane duration. Intelligibility is
# the TTS->ASR loopback's job (sidecar/tests/test_tts_engine.py); pulling whisper in here
# would make a TTS backend gate depend on an ASR model being present too.

TTS_GPU = os.environ.get("SK_TEST_TTS_GPU") == "1"
GPU_TTS_TEXT = "The quick brown fox jumps over the lazy dog."
GPU_TTS_MIN_SECONDS = 0.5
GPU_TTS_MIN_PEAK = 0.01          # an all-zeros buffer of the right length must not pass

# family -> (env var name, model dir, preset or None, clones?, max seconds). supertonic and
# pocket_tts select a named preset; moss_tts_nano has a usable built-in voice; qwen3_tts
# (base checkpoint) and omnivoice are clone-only and additionally require the reference's
# transcript, so the child synthesizes its own reference clip with supertonic on the CPU
# device first and clones it with that clip's exact text.
#
# The max-duration bar is 30s (a generous "did not run away" bound) except for
# moss_tts_nano, where 10s is a real signal: ruling R23 switched that family to sampled
# decode precisely because greedy argmax never reaches its end-of-content token and runs to
# audio.cpp's 300-frame / 24.000s max_new_frames cap. A ~24s clip for this one sentence is
# that cap's signature, so the tighter bound catches a backend on which the stop decision
# stops working — same threshold the CPU test above uses.
GPU_TTS_FAMILIES = {
    "supertonic": ("SK_TEST_TTS_SUPERTONIC_DIR", TTS_SUPERTONIC_DIR, "M1", False, 30.0),
    "pocket_tts": ("SK_TEST_TTS_POCKET_DIR", TTS_POCKET_DIR, "alba", False, 30.0),
    "moss_tts_nano": ("SK_TEST_TTS_MOSS_DIR", TTS_MOSS_DIR, None, False, 10.0),
    "qwen3_tts": ("SK_TEST_TTS_QWEN3_DIR", TTS_QWEN3_DIR, None, True, 30.0),
    "omnivoice": ("SK_TEST_TTS_OMNIVOICE_DIR", TTS_OMNIVOICE_DIR, None, True, 30.0),
}

_GPU_TTS_RUNNER = r'''
import json, os, sys, time

cfg = json.loads(os.environ["SK_GPU_TTS_CONFIG"])
sys.path.insert(0, cfg["native_python_dir"])
import numpy as np
import sokuji_native as s

s.init()
device = next(d for d in s.devices() if d.index == cfg["device_index"])

voice = None
if cfg["clones"]:
    # A clone reference has to be real speech (a sine wave is not one), so supertonic
    # makes one on the CPU device in this same process; its text is the ref_text, which
    # both clone-only families require.
    cpu = next(d for d in s.devices() if d.kind == "cpu")
    ref = s.tts_load(cfg["supertonic_dir"], "supertonic", cpu)
    try:
        ref.set_preset("M1")
        pcm, rate = ref.synth(cfg["text"], language="en")
        if pcm.ndim > 1:
            pcm = pcm.mean(axis=1)
        voice = (np.ascontiguousarray(pcm, dtype=np.float32), int(rate))
    finally:
        ref.unload()

t0 = time.perf_counter()
model = s.tts_load(cfg["model_dir"], cfg["family"], device)
load_s = time.perf_counter() - t0
try:
    if cfg["preset"]:
        model.set_preset(cfg["preset"])
    if voice is not None:
        model.set_voice(voice[0], voice[1], ref_text=cfg["text"])
    t0 = time.perf_counter()
    samples, rate = model.synth(cfg["text"], language="en")
    synth_s = time.perf_counter() - t0
finally:
    model.unload()

frames = int(samples.shape[0])
print("SK_GPU_TTS_RESULT " + json.dumps({
    "device": f"{device.kind}/{device.name}",
    "frames": frames,
    "channels": int(samples.shape[1]) if samples.ndim > 1 else 1,
    "rate": int(rate),
    "seconds": round(frames / rate, 3) if rate else 0.0,
    "peak": float(np.max(np.abs(samples))) if frames else 0.0,
    "load_s": round(load_s, 3),
    "synth_s": round(synth_s, 3),
}))
'''


def _gpu_device():
    """The first non-CPU device, or None. `devices()` alone never touches a backend graph,
    so this is safe to call in the pytest process itself."""
    sokuji_native.init()
    return next((d for d in sokuji_native.devices() if d.kind != "cpu"), None)


@pytest.mark.parametrize("family", sorted(GPU_TTS_FAMILIES))
def test_tts_synthesises_on_a_gpu_device(family):
    env_name, model_dir, preset, clones, max_seconds = GPU_TTS_FAMILIES[family]
    if not (HAVE_TREE and TTS_GPU):
        pytest.skip("needs a built tree and SK_TEST_TTS_GPU=1")
    if not model_dir:
        pytest.skip(f"needs {env_name}")
    if clones and not TTS_SUPERTONIC_DIR:
        pytest.skip(f"{family} is clone-only and needs SK_TEST_TTS_SUPERTONIC_DIR for a reference clip")
    device = _gpu_device()
    if device is None:
        pytest.skip(f"no non-CPU device on this box: {sokuji_native.devices()}")

    cfg = {
        "native_python_dir": str(pathlib.Path(sokuji_native.__file__).resolve().parents[1]),
        "device_index": device.index,
        "family": family,
        "model_dir": model_dir,
        "preset": preset,
        "clones": clones,
        "supertonic_dir": TTS_SUPERTONIC_DIR,
        "text": GPU_TTS_TEXT,
    }
    env = dict(os.environ, SK_GPU_TTS_CONFIG=json.dumps(cfg))
    proc = subprocess.run([sys.executable, "-c", _GPU_TTS_RUNNER],
                          capture_output=True, text=True, timeout=1800, env=env)
    # A missing backend kernel aborts the child (SIGABRT); ggml prints the actual reason —
    # "unsupported op 'X'" or a GGML_ASSERT — to stderr well before the backtrace that
    # follows it, so a fixed-size tail alone can crop the one line that says what broke.
    # Surface that line up front, and widen the tail so the backtrace itself still fits.
    stderr_lines = (proc.stderr or "").strip().splitlines()
    abort_line = next(
        (l for l in stderr_lines if re.search(r"unsupported op|GGML_ASSERT|ggml_abort|error:", l)),
        None,
    )
    head = "\n".join(stderr_lines[:15])
    tail = "\n".join(stderr_lines[-80:])
    assert proc.returncode == 0, (
        f"{'abort: ' + abort_line + chr(10) if abort_line else ''}"
        f"{family} on {device.kind} device {device.index} ({device.name}) failed: exit {proc.returncode}"
        f"{' (SIGABRT — a missing backend kernel aborts the process)' if proc.returncode in (-6, 134) else ''}\n"
        f"--- stderr head (first 15) ---\n{head}\n"
        f"--- stderr tail (last 80) ---\n{tail}\n--- stdout ---\n{proc.stdout}")

    line = next((l for l in proc.stdout.splitlines() if l.startswith("SK_GPU_TTS_RESULT ")), None)
    assert line, f"{family}: runner produced no result line\n--- stdout ---\n{proc.stdout}\n--- stderr tail ---\n{tail}"
    got = json.loads(line[len("SK_GPU_TTS_RESULT "):])
    print(f"  gpu-tts {family:14s} {got['device']:16s} {got['seconds']:6.2f}s audio  "
          f"{got['load_s']:7.2f}s load  {got['synth_s']:7.2f}s synth  peak={got['peak']:.3f}")
    # The child resolves the device by index; make it prove it did not silently land on the
    # CPU one, or a "GPU" pass would mean nothing.
    assert not got["device"].startswith("cpu/"), got
    assert got["frames"] > 0 and got["rate"] > 0, got
    assert GPU_TTS_MIN_SECONDS <= got["seconds"] <= max_seconds, got
    # Silence of the right length is the failure mode a duration check cannot see: a backend
    # that runs every kernel and writes zeros passes everything above.
    assert got["peak"] > GPU_TTS_MIN_PEAK, got
