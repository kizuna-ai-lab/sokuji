"""Outbound wire contract.

The renderer's ServerMsg union (nativeProtocol.ts) is a hand-written model of
what this process sends; nothing mechanically connected the two until C4a
pinned the TYPE NAMES. This module extends that to top-level FIELD names:
wire_schema.json is the single source of truth, validated here at the one
outbound funnel (server.Conn.send) and pinned against the TS interfaces by
nativeProtocol.consistency.test.ts on the renderer side.

Failure stance: strict (raise) when SOKUJI_WIRE_STRICT=1 — the test suite sets
this, so every message a test pushes through Conn.send is checked for free.
Otherwise fail-open: print the violation to stderr (NativeHostManager pipes it
into the Electron log) and let the message through — a contract bug must never
take down a live session.

Scope: top-level field names + presence only. Values and nested payload shapes
(NativeModelInfo etc.) are deliberately out of scope — the renderer consumes
those defensively, and the fatal drift class (type/field renames) lives at the
top level.
"""
import json
import os
import sys

with open(os.path.join(os.path.dirname(__file__), "wire_schema.json"),
          encoding="utf-8") as _f:
    _raw = json.load(_f)
_raw.pop("_comment", None)
SCHEMA: dict[str, dict[str, frozenset]] = {
    mtype: {"required": frozenset(spec["required"]),
            "optional": frozenset(spec["optional"])}
    for mtype, spec in _raw.items()
}


class WireContractError(Exception):
    pass


def validate_outbound(obj: dict) -> None:
    """Check one outbound JSON message against the schema. Raises
    WireContractError in strict mode; otherwise reports to stderr and returns
    (the caller sends the message regardless — fail-open).

    Fail-open covers the validator ITSELF too: in production a crash inside
    _problem (a handler returning a non-dict, say) is reported and the message
    passes — the guard must never be more dangerous than what it guards. In
    strict mode the same crash surfaces raw, pointing at the real bug."""
    if os.environ.get("SOKUJI_WIRE_STRICT") == "1":
        problem = _problem(obj)
        if problem is not None:
            raise WireContractError(problem)
        return
    try:
        problem = _problem(obj)
    except Exception as e:
        problem = f"validator crashed: {e!r}"
    if problem is not None:
        print(f"[wire] contract violation: {problem}", file=sys.stderr, flush=True)


def _problem(obj: dict) -> str | None:
    mtype = obj.get("type")
    if mtype is None:
        return f"outbound message has no 'type': {sorted(obj)}"
    spec = SCHEMA.get(mtype)
    if spec is None:
        return f"unknown outbound type: {mtype!r}"
    keys = set(obj) - {"type"}
    missing = spec["required"] - keys
    if missing:
        return f"{mtype}: missing required field(s) {sorted(missing)}"
    extra = keys - spec["required"] - spec["optional"]
    if extra:
        return f"{mtype}: unexpected field(s) {sorted(extra)}"
    return None
