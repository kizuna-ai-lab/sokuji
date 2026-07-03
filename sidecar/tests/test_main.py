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
