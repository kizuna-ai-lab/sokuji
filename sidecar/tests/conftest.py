import os

# Strict wire contract for the whole suite: any outbound message flowing
# through server.Conn.send with a type/field the schema doesn't declare raises
# instead of being quietly sent — every conn-path test doubles as a contract
# checkpoint. Production (no env var) fails open: stderr warning, message sent.
# Unconditional (not setdefault): an ambient SOKUJI_WIRE_STRICT=0 in the shell
# must not silently defeat suite-wide strictness — that would be a false green.
# The one test that legitimately needs non-strict opts out via monkeypatch.delenv.
os.environ["SOKUJI_WIRE_STRICT"] = "1"
