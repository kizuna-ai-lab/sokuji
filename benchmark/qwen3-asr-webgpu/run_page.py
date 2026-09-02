"""Drive headless Chrome at the spike page over CDP (for boxes without node).

usage: python run_page.py <chrome-binary> <url> [timeoutSec] [extra chrome flags...]
needs: pip install websocket-client
"""
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket  # websocket-client

chrome, url = sys.argv[1], sys.argv[2]
timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 900
extra = sys.argv[4:]
port = 9222 + random.randint(0, 500)
profile = os.path.join(tempfile.gettempdir(), f"spike-chrome-profile-{port}")
flags = [chrome, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
         "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--window-size=800,600", *extra, "about:blank"]
proc = subprocess.Popen(flags, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

ws_url = None
for _ in range(150):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as r:
            for t in json.load(r):
                if t.get("type") == "page":
                    ws_url = t["webSocketDebuggerUrl"]
                    break
    except Exception:
        pass
    if ws_url:
        break
    time.sleep(0.2)
if not ws_url:
    print("no CDP target", proc.stderr.read()[-800:].decode(errors="replace"))
    proc.kill()
    sys.exit(3)

ws = websocket.create_connection(ws_url, suppress_origin=True)
ws.settimeout(5)
mid = 0


def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        handle_event(msg)
        if msg.get("id") == mid:
            return msg


def handle_event(msg):
    if msg.get("method") == "Runtime.consoleAPICalled":
        text = " ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"]["args"])
        if text.startswith(("RESULT ", "STATUS ")):
            print(text, flush=True)
        elif msg["params"]["type"] in ("error", "warning"):
            print("[console." + msg["params"]["type"] + "] " + text[:500], flush=True)
    elif msg.get("method") == "Runtime.exceptionThrown":
        print("[exception] " + json.dumps(msg["params"]["exceptionDetails"])[:800], flush=True)


send("Runtime.enable")
send("Page.enable")
send("Page.navigate", {"url": url})
start = time.time()
done = False
while time.time() - start < timeout:
    # drain events for ~1s
    t_end = time.time() + 1.0
    while time.time() < t_end:
        try:
            ws.settimeout(max(0.05, t_end - time.time()))
            handle_event(json.loads(ws.recv()))
        except websocket.WebSocketTimeoutException:
            break
    ws.settimeout(5)
    r = send("Runtime.evaluate", {"expression": "JSON.stringify({done: window.__result?.done})", "returnByValue": True})
    v = r.get("result", {}).get("result", {}).get("value")
    if v and json.loads(v).get("done"):
        done = True
        break
if not done:
    print(f"TIMEOUT after {timeout}s")
fin = send("Runtime.evaluate", {"expression": "JSON.stringify(window.__result)", "returnByValue": True})
print("FINAL " + str(fin.get("result", {}).get("result", {}).get("value"))[:20000])
ws.close()
proc.terminate()
sys.exit(0 if done else 2)
