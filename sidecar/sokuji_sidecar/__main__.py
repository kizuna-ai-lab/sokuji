import asyncio, json, sys
from .server import serve


async def _run():
    from .pocket_engine import PocketEngine, register as register_pocket
    from .translate_engine import TranslateEngine, register as register_translate
    from .asr_engine import AsrEngine, register as register_asr
    state = {
        "engine": PocketEngine(),
        "translate_engine": TranslateEngine(),
        "asr_engine": AsrEngine(),
    }
    register_pocket(state)
    register_translate(state)
    register_asr(state)
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
