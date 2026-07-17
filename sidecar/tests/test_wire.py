"""The outbound wire contract: schema shape + validate_outbound behavior.

Strictness contract: SOKUJI_WIRE_STRICT=1 (set for the whole suite in conftest)
makes a violation raise, so every message that flows through Conn.send in any
test is checked for free. Without the flag (production) a violation is printed
to stderr and the message is still sent — a contract bug must never take down
a live session (same fail-open stance as _conn's never-drop-the-connection).
"""
import json
import os

import pytest

from sokuji_sidecar import wire


def test_schema_covers_every_type_and_shapes_are_sane():
    # 18 ServerMsg members + pong. The renderer-side field test pins the schema
    # against nativeProtocol.ts; this end just guards the file's basic shape.
    assert len(wire.SCHEMA) == 19
    assert "pong" in wire.SCHEMA
    for mtype, spec in wire.SCHEMA.items():
        assert set(spec) == {"required", "optional"}, mtype
        assert "type" not in spec["required"] and "type" not in spec["optional"], mtype
        assert not (set(spec["required"]) & set(spec["optional"])), mtype


def test_valid_messages_pass_in_strict_mode(monkeypatch):
    monkeypatch.setenv("SOKUJI_WIRE_STRICT", "1")
    wire.validate_outbound({"type": "ok", "id": 3})
    wire.validate_outbound({"type": "ready", "id": 1, "loadTimeMs": 5,
                            "backend": "moss_onnx", "rtf": 0.2})
    wire.validate_outbound({"type": "error", "message": "boom"})          # id optional
    wire.validate_outbound({"type": "speech_start"})                       # no fields
    wire.validate_outbound({"type": "result", "text": "hi",
                            "durationMs": 10, "recognitionTimeMs": 2})


@pytest.mark.parametrize("bad, match", [
    ({"type": "no_such_message", "id": 1}, "unknown outbound type"),
    ({"type": "ok"}, "missing required"),                                  # no id
    ({"type": "ok", "id": 1, "extra": True}, "unexpected field"),
    ({"id": 1}, "has no 'type'"),
])
def test_violations_raise_in_strict_mode(monkeypatch, bad, match):
    monkeypatch.setenv("SOKUJI_WIRE_STRICT", "1")
    with pytest.raises(wire.WireContractError, match=match):
        wire.validate_outbound(bad)


def test_violations_fail_open_outside_strict_mode(monkeypatch, capsys):
    monkeypatch.delenv("SOKUJI_WIRE_STRICT", raising=False)
    wire.validate_outbound({"type": "ok"})            # would raise in strict
    err = capsys.readouterr().err
    assert "[wire]" in err and "missing required" in err


def test_conftest_turns_strict_on_for_the_suite():
    # The whole point: every Conn.send in every other test is a checkpoint.
    assert os.environ.get("SOKUJI_WIRE_STRICT") == "1"


def test_schema_json_is_the_loaded_source():
    p = os.path.join(os.path.dirname(wire.__file__), "wire_schema.json")
    with open(p, encoding="utf-8") as f:
        raw = json.load(f)
    raw.pop("_comment", None)
    assert set(raw) == set(wire.SCHEMA)
