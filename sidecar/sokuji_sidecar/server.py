import json
import websockets


class Conn:
    def __init__(self, ws):
        self._ws = ws
        self.ctx = {}

    async def send(self, obj=None, binary=None):
        if binary is not None:
            await self._ws.send(binary)
        if obj is not None:
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
            if binary is not None:
                await ws.send(binary)
            if reply is not None:
                await ws.send(json.dumps(reply))
    finally:
        # A session connection closing is "stop": free the ASR model from VRAM. Only a
        # connection that started ASR streaming (on_binary set) owns the engine; the
        # model-management connection has no on_binary, so it leaves the model alone.
        if conn.ctx.get("on_binary") is not None:
            task = conn.ctx.get("stream_task")
            if task is not None:
                task.cancel()
            eng = state.get("asr_engine")
            if eng is not None:
                try:
                    eng.close()
                except Exception:
                    pass


async def serve(state=None, host="127.0.0.1", port=0):
    state = state if state is not None else {}
    server = await websockets.serve(lambda ws: _conn(state, ws), host, port)
    bound_port = server.sockets[0].getsockname()[1]
    state["_server"] = server
    return bound_port, server
