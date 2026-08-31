import signal
import sys

import asyncio, json
from .server import serve


async def _run():
    from . import tts_engine
    from .translate_engine import TranslateEngine, register as register_translate
    from .asr_engine import AsrEngine, register as register_asr
    from .native_models import register as register_models
    from .accel import register as register_accel
    state = {
        "tts_engine": tts_engine.TtsEngine(),
        "translate_engine": TranslateEngine(),
        "asr_engine": AsrEngine(),
    }
    tts_engine.register(state)
    register_translate(state)
    register_asr(state)
    register_models(state)
    register_accel(state)
    port, server = await serve(state)
    print(json.dumps({"port": port}), flush=True)   # handshake line read by NativeHostManager
    await server.wait_closed()


def _install_exit_handlers():
    """Make SIGTERM/SIGINT run atexit cleanups.

    Historically this existed for LlamaServerProc.stop (killing the
    llama-server child process on shutdown); slice 3 moved translation
    in-process through sokuji_native, so there is no separate child process
    to clean up here anymore. Kept as defensive infrastructure: Python's
    default handling of a raw signal kill (as opposed to a normal
    sys.exit()/return-from-main exit) skips atexit entirely, and Electron's
    native-host-manager stops this sidecar with SIGTERM (POSIX) /
    TerminateProcess (Windows) at ordinary app shutdown — not
    KeyboardInterrupt — so any future atexit-registered cleanup (in-process
    model unload, temp files, etc.) still needs this translation into a clean
    sys.exit(0) to actually run.

    Guarded to only replace the default handler (SIG_DFL): this must not
    clobber a handler something else in the process already installed."""
    def _handler(signum, frame):
        sys.exit(0)
    for sig in (signal.SIGTERM, signal.SIGINT):
        if signal.getsignal(sig) is signal.SIG_DFL:
            signal.signal(sig, _handler)


def main():
    _install_exit_handlers()
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
