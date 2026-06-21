import asyncio, json, sys
from .server import serve


async def _run():
    from .pocket_engine import PocketEngine, register
    state = {"engine": PocketEngine()}
    register(state)
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
