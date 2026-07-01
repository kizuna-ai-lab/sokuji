import os
# Reduce CUDA allocator fragmentation when loading large quantized models (e.g. FP8).
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import sys
# Pin one consistent cuDNN (torch's bundled copy) for the whole process BEFORE any
# onnxruntime/torch CUDA provider loads, so onnxruntime-gpu doesn't mix it with a
# different system cuDNN and silently fall back to CPU. See _cudnn_preload.
from ._cudnn_preload import preload_torch_cudnn
print(preload_torch_cudnn(), file=sys.stderr, flush=True)

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


def main():
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
