import asyncio, json, sys
from .server import serve


async def _run():
    from .pocket_engine import PocketEngine, register as register_pocket
    from .translate_engine import TranslateEngine, register as register_translate
    state = {"engine": PocketEngine(), "translate_engine": TranslateEngine()}
    register_pocket(state)
    register_translate(state)
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
