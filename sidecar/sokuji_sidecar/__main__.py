import os
# Reduce CUDA allocator fragmentation when loading large quantized models (e.g. FP8).
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import signal
import sys


def _preload_cuda_dlls() -> str:
    """Officialized cuDNN/CUDA handling (spec D8): when the CUDA EP is present,
    ORT's own preload_dlls() pins the wheel-shipped cuDNN/cuBLAS/MSVC runtime
    BEFORE any session is created — replacing the hand-rolled _cudnn_preload
    ctypes loader and the Electron LD_LIBRARY_PATH injection. No-op on the
    DirectML / CPU / macOS SKUs (no CUDA EP) and on ORT builds without the
    helper. Best-effort: never raises. Returns a short status string."""
    try:
        import onnxruntime as ort
    except Exception as e:  # onnxruntime is a base dep, but stay defensive
        return f"cuda-dll-preload: skipped (onnxruntime import failed: {e})"
    if "CUDAExecutionProvider" not in ort.get_available_providers():
        return "cuda-dll-preload: skipped (no CUDA execution provider)"
    preload = getattr(ort, "preload_dlls", None)
    if not callable(preload):
        return "cuda-dll-preload: skipped (preload_dlls unavailable)"
    try:
        preload()
        return "cuda-dll-preload: onnxruntime.preload_dlls() done"
    except Exception as e:
        return f"cuda-dll-preload: failed ({e})"


# Pin one consistent CUDA/cuDNN set for the whole process BEFORE any engine
# imports onnxruntime, so onnxruntime-gpu never mixes the wheel's cuDNN with a
# different system copy and silently drops the CUDA EP to CPU.
print(_preload_cuda_dlls(), file=sys.stderr, flush=True)

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
    """Make SIGTERM/SIGINT run atexit cleanups (notably LlamaServerProc.stop,
    which kills the llama-server child).

    Python's default handling of a raw signal kill (as opposed to a normal
    sys.exit()/return-from-main exit) skips atexit entirely. Electron's
    native-host-manager stops this sidecar with SIGTERM (POSIX) /
    TerminateProcess (Windows) at ordinary app shutdown — not KeyboardInterrupt.
    On Linux, LlamaServerProc.start()'s PDEATHSIG saves us regardless (the
    child dies with its parent); macOS has no such mechanism, so translate
    SIGTERM/SIGINT into a clean sys.exit(0) here so atexit runs there too.
    SIGTERM is mostly theoretical on Windows (TerminateProcess bypasses
    signal handling outright) — that platform instead relies on the Job
    Object installed in LlamaServerProc.start().

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
