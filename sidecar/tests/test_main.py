import pytest

from sokuji_sidecar import __main__ as sidecar_main


def test_install_exit_handlers_replaces_default_handlers(monkeypatch):
    """When SIGTERM/SIGINT are at their default (SIG_DFL) — the normal state
    for SIGTERM in a freshly started process — _install_exit_handlers must
    replace both with a handler that calls sys.exit(0), so atexit cleanups
    (LlamaServerProc.stop killing the llama-server child) run on a plain
    process kill instead of being skipped."""
    monkeypatch.setattr(sidecar_main.signal, "getsignal", lambda sig: sidecar_main.signal.SIG_DFL)
    installed = {}
    monkeypatch.setattr(sidecar_main.signal, "signal",
                        lambda sig, handler: installed.__setitem__(sig, handler))

    sidecar_main._install_exit_handlers()

    assert sidecar_main.signal.SIGTERM in installed
    assert sidecar_main.signal.SIGINT in installed
    with pytest.raises(SystemExit) as exc:
        installed[sidecar_main.signal.SIGTERM](sidecar_main.signal.SIGTERM, None)
    assert exc.value.code == 0


def test_install_exit_handlers_does_not_clobber_existing_handler(monkeypatch):
    """A signal that already has a non-default handler installed (e.g.
    Python's own SIGINT -> KeyboardInterrupt handler) must be left alone."""
    custom_handler = lambda signum, frame: None
    monkeypatch.setattr(sidecar_main.signal, "getsignal", lambda sig: custom_handler)
    calls = []
    monkeypatch.setattr(sidecar_main.signal, "signal",
                        lambda sig, handler: calls.append((sig, handler)))

    sidecar_main._install_exit_handlers()

    assert calls == []


import sys as _sys
import types as _types


def test_preload_cuda_dlls_calls_preload_when_cuda_present(monkeypatch):
    calls = []
    fake = _types.SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"],
        preload_dlls=lambda *a, **k: calls.append(True))
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake)
    status = sidecar_main._preload_cuda_dlls()
    assert calls == [True]
    assert status == "cuda-dll-preload: onnxruntime.preload_dlls() done"


def test_preload_cuda_dlls_skips_without_cuda(monkeypatch):
    fake = _types.SimpleNamespace(
        get_available_providers=lambda: ["DmlExecutionProvider", "CPUExecutionProvider"],
        preload_dlls=lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not be called")))
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake)
    status = sidecar_main._preload_cuda_dlls()
    assert "no CUDA execution provider" in status


def test_preload_cuda_dlls_skips_when_helper_absent(monkeypatch):
    fake = _types.SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setitem(_sys.modules, "onnxruntime", fake)
    status = sidecar_main._preload_cuda_dlls()
    assert "preload_dlls unavailable" in status


def test_cudnn_preload_shim_is_gone():
    import importlib.util
    assert importlib.util.find_spec("sokuji_sidecar._cudnn_preload") is None
