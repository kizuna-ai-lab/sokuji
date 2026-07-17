import os

# Strict wire contract for the whole suite: any outbound message flowing
# through server.Conn.send with a type/field the schema doesn't declare raises
# instead of being quietly sent — every conn-path test doubles as a contract
# checkpoint. Production (no env var) fails open: stderr warning, message sent.
os.environ.setdefault("SOKUJI_WIRE_STRICT", "1")
