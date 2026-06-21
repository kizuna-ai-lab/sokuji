import asyncio, json
from sokuji_sidecar.server import handle_message, Conn


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
