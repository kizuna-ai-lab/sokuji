/**
 * Imported first by every engine test: the strict wire contract for the whole engine suite (sidecar/tests/conftest.py).
 * Every message a test pushes through Conn.send is checked, and a violation throws instead of being sent.
 *
 * The model cache is a fresh empty directory, never the machine's own ~/.cache/huggingface, and the hub endpoint is a
 * closed local port, so no test reads a real download or reaches the network by accident. A test that wants a hub
 * starts test/fakeHub.ts and passes its URL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SOKUJI_WIRE_STRICT = '1';
const hfHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-engine-hf-'));
process.env.HF_HOME = hfHome;
process.on('exit', () => fs.rmSync(hfHome, { recursive: true, force: true }));
delete process.env.HF_HUB_CACHE;
delete process.env.HF_HUB_OFFLINE;
process.env.HF_ENDPOINT = 'http://127.0.0.1:9';
