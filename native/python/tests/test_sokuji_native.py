"""Runs against a built tree: set SOKUJI_NATIVE_DIR to the install/stage dir from Task 6
(or install the wheel). Without either, the load tests skip and only the pure-Python
contract logic is exercised."""
import json
import os
import pathlib

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
    # Controller Ruling 15: sk_init only stores the callback pointer on its first
    # successful call, so a later init(log=...) must not drop the only Python reference
    # to the trampoline native code still holds.
    first_lines = []
    second_lines = []
    sokuji_native.init(log=lambda level, msg: first_lines.append((level, msg)))
    first_trampoline = sokuji_native._log_refs[0]

    sokuji_native.init(log=lambda level, msg: second_lines.append((level, msg)))

    sokuji_native.init()  # a third call must not crash despite the dangling-pointer risk

    assert len(sokuji_native._log_refs) >= 2
    assert sokuji_native._log_refs[0] is first_trampoline
