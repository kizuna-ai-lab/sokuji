import json
import sys
import websockets

from . import wire


class Conn:
    def __init__(self, ws):
        self._ws = ws
        self.ctx = {}
        self._on_close = []

    def on_close(self, cb):
        """Register a zero-arg cleanup to run when this connection closes.

        Each stage registers its own teardown at init, so the server never has to know
        which ctx keys a stage owns. A cleanup must read conn.ctx/state when it RUNS,
        not when it registers: a stage may create the handle it cancels after init (the
        TTS stream task is created by tts_generate, not tts_init).
        """
        self._on_close.append(cb)

    async def send(self, obj=None, binary=None):
        """The ONE outbound funnel: every JSON message this process sends —
        handler replies and engine pushes alike — leaves through here, so the
        wire contract is enforced in exactly one place (strict in tests,
        fail-open in production; see wire.py)."""
        if binary is not None:
            await self._ws.send(binary)
        if obj is not None:
            wire.validate_outbound(obj)
            await self._ws.send(json.dumps(obj))


async def handle_message(state, raw, binary_in=None, conn=None):
    """Pure dispatch. Returns (json_reply_dict_or_None, binary_reply_bytes_or_None)."""
    msg = json.loads(raw)
    mtype = msg.get("type")
    mid = msg.get("id")
    if mtype == "ping":
        return {"type": "pong", "id": mid}, None
    handler = (state.get("handlers") or {}).get(mtype)
    if handler is None:
        return {"type": "error", "id": mid, "message": f"unknown message type: {mtype}"}, None
    return await handler(state, msg, binary_in, conn)


async def _conn(state, ws):
    conn = Conn(ws)
    pending_binary = None
    try:
        async for raw in ws:
            if isinstance(raw, (bytes, bytearray)):
                data = bytes(raw)
                feeder = conn.ctx.get("on_binary")   # ASR streaming: process immediately
                if feeder is not None:
                    try:
                        for out in feeder(data):
                            await conn.send(out)
                    except Exception as e:  # feeder error must not kill the connection
                        await conn.send({"type": "error", "message": str(e)})
                else:
                    pending_binary = data            # set_voice: buffer for next control msg
                continue
            try:
                reply, binary = await handle_message(state, raw, pending_binary, conn)
            except Exception as e:  # never drop the connection on a single bad request
                try:
                    _mid = json.loads(raw).get("id")
                except Exception:
                    _mid = None
                reply, binary = {"type": "error", "id": _mid, "message": str(e)}, None
            pending_binary = None
            await conn.send(reply, binary)   # same binary-before-json order
    finally:
        # A session connection closing is "stop": free that connection's model from VRAM.
        # Each stage registers its own cleanup at init (conn.on_close), so the server
        # never needs to know which ctx keys a stage owns; the model-management
        # connection registers none and leaves models alone. The engines are process
        # singletons reused on the next init. Cleanups are independent — one raising
        # must not skip the rest.
        for cb in conn._on_close:
            try:
                cb()
            except Exception as e:
                # A broken cleanup must not skip the other stages' cleanups — but it
                # must not vanish either: its stage's model would silently never leave
                # VRAM. stderr is piped to the Electron log by NativeHostManager;
                # stdout is the port-handshake channel and must stay structured.
                print(f"[teardown] on_close cleanup failed: {e!r}",
                      file=sys.stderr, flush=True)


# A voice-clone reference clip (set_voice) is sent as ONE binary frame of raw
# Float32 PCM — up to ~20s, which at 48kHz is ~3.8 MB, far over the websockets
# 1 MiB default max_size. Raise the per-message limit so reference clips aren't
# rejected with 1009 (message too big). The sidecar is localhost-only, so a
# generous bound is safe; ASR still streams in small chunks well under this.
MAX_WS_MESSAGE_BYTES = 64 * 1024 * 1024  # 64 MiB


async def serve(state=None, host="127.0.0.1", port=0):
    state = state if state is not None else {}
    server = await websockets.serve(
        lambda ws: _conn(state, ws), host, port, max_size=MAX_WS_MESSAGE_BYTES)
    bound_port = server.sockets[0].getsockname()[1]
    state["_server"] = server
    return bound_port, server
