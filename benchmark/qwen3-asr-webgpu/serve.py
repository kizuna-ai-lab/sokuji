"""Static file server for the spike page.

Serves the www/ directory (which symlinks models/, clips/, ort/) with
permissive CORS and, when --isolate is given, the COOP/COEP headers that
unlock SharedArrayBuffer (multi-threaded wasm EP). Range requests are
supported by SimpleHTTPRequestHandler in 3.12? No — so we add them, because
ORT-web fetches external data with plain GETs but browsers may probe ranges.
"""
import argparse
import http.server
import os
import socketserver

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8765)
parser.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "www"))
parser.add_argument("--isolate", action="store_true", help="send COOP/COEP headers")
args = parser.parse_args()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=args.root, **kw)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        if args.isolate:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def log_message(self, fmt, *a):  # quieter: only non-200s
        if len(a) >= 2 and str(a[1]) not in ("200", "304", "206"):
            super().log_message(fmt, *a)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


with Server(("0.0.0.0", args.port), Handler) as httpd:
    print(f"serving {args.root} on :{args.port} isolate={args.isolate}", flush=True)
    httpd.serve_forever()
