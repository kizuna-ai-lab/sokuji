import asyncio, json
import websockets


async def handle_message(state, raw, binary_in=None):
    """Pure dispatch. Returns (json_reply_dict_or_None, binary_reply_bytes_or_None)."""
    msg = json.loads(raw)
    mtype = msg.get("type")
    mid = msg.get("id")
    if mtype == "ping":
        return {"type": "pong", "id": mid}, None
    # init / set_voice / generate are registered by later tasks via state["handlers"].
    handler = (state.get("handlers") or {}).get(mtype)
    if handler is None:
        return {"type": "error", "id": mid, "message": f"unknown message type: {mtype}"}, None
    return await handler(state, msg, binary_in)


async def _conn(state, ws):
    pending_binary = None
    async for raw in ws:
        if isinstance(raw, (bytes, bytearray)):
            pending_binary = bytes(raw)   # binary frame precedes its control message
            continue
        try:
            reply, binary = await handle_message(state, raw, pending_binary)
        except Exception as e:  # never drop the connection on a single bad request
            reply, binary = {"type": "error", "message": str(e)}, None
        pending_binary = None
        if binary is not None:
            await ws.send(binary)
        if reply is not None:
            await ws.send(json.dumps(reply))


async def serve(state=None, host="127.0.0.1", port=0):
    state = state if state is not None else {}
    server = await websockets.serve(lambda ws: _conn(state, ws), host, port)
    bound_port = server.sockets[0].getsockname()[1]
    state["_server"] = server
    return bound_port, server
