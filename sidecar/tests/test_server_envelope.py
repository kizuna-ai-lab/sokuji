import asyncio, json
from sokuji_sidecar.server import handle_message


def test_ping_returns_pong():
    state = {}
    reply, binary = asyncio.run(handle_message(state, json.dumps({"type": "ping", "id": 7})))
    assert reply == {"type": "pong", "id": 7}
    assert binary is None


def test_unknown_type_returns_error():
    state = {}
    reply, _ = asyncio.run(handle_message(state, json.dumps({"type": "nope", "id": 1})))
    assert reply["type"] == "error" and reply["id"] == 1
