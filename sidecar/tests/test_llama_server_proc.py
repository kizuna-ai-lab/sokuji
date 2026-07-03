import json
import os
import sys
import time
import urllib.request

import pytest

from sokuji_sidecar import llama_runtime as rt
from sokuji_sidecar.backends import BackendLoadError

FAKE = r'''
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

args = sys.argv[1:]
port = int(args[args.index("--port") + 1])
mode = "@MODE@"
if mode == "crash":
    sys.stderr.write("boom: failed to load model\n")
    sys.exit(1)
loading_until = time.time() + 0.3

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/health":
            if time.time() < loading_until:
                self.send_response(503); self.end_headers()
            else:
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n))
        if mode == "die-on-post":
            import os; os._exit(1)
        out = {"choices": [{"message": {"content": "TRANSLATED:" + body["messages"][-1]["content"]}}],
               "usage": {"completion_tokens": 7},
               "echo": body}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

HTTPServer(("127.0.0.1", port), H).serve_forever()
'''


def make_fake(tmp_path, mode="ok"):
    exe = tmp_path / "fake_llama.py"
    exe.write_text(FAKE.replace("@MODE@", mode))
    return [sys.executable, str(exe)]


@pytest.fixture
def gguf(tmp_path):
    p = tmp_path / "model.gguf"
    p.write_bytes(b"GGUF")
    return str(p)


def test_start_waits_for_health(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path), gguf)
    proc.start(timeout=15)
    try:
        assert proc.alive()
        with urllib.request.urlopen(f"http://127.0.0.1:{proc.port}/health") as r:
            assert r.status == 200
    finally:
        proc.stop()
    assert not proc.alive()


def test_start_crash_surfaces_stderr(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path, mode="crash"), gguf)
    with pytest.raises(BackendLoadError) as ei:
        proc.start(timeout=15)
    assert "boom" in str(ei.value)


def test_start_builds_expected_args(tmp_path, gguf):
    proc = rt.LlamaServerProc(make_fake(tmp_path), gguf, ctx=4096, fit_target_mib=1536)
    args = proc._build_args()
    assert "-m" in args and gguf in args
    assert "--no-webui" in args and "-c" in args and "4096" in args
    assert "--fit-target" in args and "1536" in args
    assert "-ngl" not in args
