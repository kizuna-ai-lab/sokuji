"""native.py: the one module that touches sokuji_native. The wheel is faked at the module
level (sys.modules), exactly the way the accel tests fake it."""
import sys
import types

import pytest

from sokuji_sidecar import native
from sokuji_sidecar.backends import BackendLoadError


class _Dev:
    def __init__(self, index, kind, description, total=0, free=0):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = description, total, free


def fake_native(monkeypatch, devs, calls=None):
    mod = types.ModuleType("sokuji_native")
    calls = calls if calls is not None else []
    mod.init = lambda n_threads=0, log=None: calls.append(("init", n_threads, log is not None))
    mod.devices = lambda: list(devs)
    mod.device_free_mem = lambda i: next(d.mem_free for d in devs if d.index == i)
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return calls


def test_module_inits_once_with_thread_policy(monkeypatch):
    monkeypatch.setenv("SOKUJI_NATIVE_THREADS", "6")
    calls = fake_native(monkeypatch, [_Dev(0, "cpu", "CPU")])
    assert native.module() is native.module()
    assert calls == [("init", 6, True)]            # once, with the env thread count and a log sink


def test_device_for_picks_first_of_kind(monkeypatch):
    fake_native(monkeypatch, [_Dev(0, "vulkan", "NVIDIA GB10", 1 << 30, 1 << 29), _Dev(1, "cpu", "CPU")])
    assert native.device_for("vulkan").description == "NVIDIA GB10"
    assert native.device_for("cpu").index == 1
    with pytest.raises(BackendLoadError):
        native.device_for("metal")


def test_missing_wheel_is_import_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "sokuji_native", None)
    native.reset_for_tests()
    with pytest.raises(ImportError):
        native.module()
