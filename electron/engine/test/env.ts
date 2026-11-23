/**
 * Imported first by every engine test: the strict wire contract for the whole engine suite (sidecar/tests/conftest.py).
 * Every message a test pushes through Conn.send is checked, and a violation throws instead of being sent.
 */
process.env.SOKUJI_WIRE_STRICT = '1';
