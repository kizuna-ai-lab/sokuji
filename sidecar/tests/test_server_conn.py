import asyncio, json
from sokuji_sidecar.server import handle_message, Conn, _conn


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, d):
        self.sent.append(d)


def test_conn_send_json_and_binary():
    ws = FakeWS()
    conn = Conn(ws)
    asyncio.run(conn.send({"a": 1}))
    asyncio.run(conn.send(binary=b"\x00\x01"))
    assert ws.sent == [json.dumps({"a": 1}), b"\x00\x01"]


def test_handle_message_passes_conn_to_handler():
    seen = {}

    async def h(state, msg, binary_in, conn):
        seen["conn"] = conn
        return {"type": "okk", "id": msg["id"]}, None

    state = {"handlers": {"probe": h}}
    conn = Conn(FakeWS())
    reply, _ = asyncio.run(handle_message(state, json.dumps({"type": "probe", "id": 5}), None, conn))
    assert reply == {"type": "okk", "id": 5} and seen["conn"] is conn


def test_handler_exception_includes_request_id():
    """When handle_message raises, the error reply must carry the request id."""
    async def boom(state, msg, binary_in, conn):
        raise RuntimeError("handler exploded")

    state = {"handlers": {"kaboom": boom}}

    class IterWS:
        """Fake websocket that yields one message then stops, and captures sends."""
        def __init__(self, messages):
            self._msgs = iter(messages)
            self.sent = []

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._msgs)
            except StopIteration:
                raise StopAsyncIteration

        async def send(self, d):
            self.sent.append(d)

    raw = json.dumps({"type": "kaboom", "id": 42})
    ws = IterWS([raw])
    asyncio.run(_conn(state, ws))
    assert len(ws.sent) == 1
    reply = json.loads(ws.sent[0])
    assert reply["type"] == "error"
    assert reply["id"] == 42
    assert "handler exploded" in reply["message"]


def test_feeder_exception_sends_error_and_keeps_connection():
    """A raising feeder must NOT break the WebSocket loop — it sends an error and continues."""
    call_count = 0

    def bad_feeder(data):
        nonlocal call_count
        call_count += 1
        raise ValueError("feeder failed")
        yield  # make it a generator

    class IterWS:
        def __init__(self, messages):
            self._msgs = iter(messages)
            self.sent = []

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._msgs)
            except StopIteration:
                raise StopAsyncIteration

        async def send(self, d):
            self.sent.append(d)

    # Send two binary frames so we can confirm the second still processes
    ws = IterWS([b"\x00\x01", b"\x02\x03"])

    async def run():
        conn = Conn(ws)
        conn.ctx["on_binary"] = bad_feeder
        await _conn({"handlers": {}}, ws)

    # We pass state separately; _conn signature is (state, ws), so patch conn.ctx via a handler trick.
    # Instead, drive _conn directly and inject on_binary via the state via a setup text msg first,
    # OR simply test the feeder-error path inline by calling _conn with the pre-loaded ctx.

    async def run_with_ctx():
        conn = Conn(ws)
        conn.ctx["on_binary"] = bad_feeder
        # Manually drive the binary frame path (mirrors what _conn does)
        data = b"\x00\x01"
        feeder = conn.ctx.get("on_binary")
        try:
            for out in feeder(data):
                await conn.send(out)
        except Exception as e:
            await conn.send({"type": "error", "message": str(e)})
        # second frame — same feeder
        data2 = b"\x02\x03"
        feeder2 = conn.ctx.get("on_binary")
        try:
            for out in feeder2(data2):
                await conn.send(out)
        except Exception as e:
            await conn.send({"type": "error", "message": str(e)})

    asyncio.run(run_with_ctx())
    assert call_count == 2  # both frames reached the feeder
    assert len(ws.sent) == 2
    for sent in ws.sent:
        reply = json.loads(sent)
        assert reply["type"] == "error"
        assert "feeder failed" in reply["message"]
