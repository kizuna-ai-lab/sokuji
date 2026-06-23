# Native Python Sidecar — Phase 2b (ASR backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native **streaming ASR** stage to the Python sidecar — VAD-segmented offline recognition (sherpa-onnx) driven by continuous binary audio frames over the existing WebSocket, pushing `speech_start`/`result` back asynchronously — proving the sidecar handles a streaming (not request/response) stage.

**Architecture:** Extends Phase 1/2a. The WS server gains a small per-connection context so standalone binary audio frames route to an ASR engine (instead of the set_voice "buffer-then-control" path), and the engine pushes recognition results back as they complete. A new `AsrEngine` (lazy-loads `sherpa-onnx`) does VAD → downsample → offline recognize. The renderer gets a push-model `NativeAsrClient` mirroring the `AsrEngine` callback surface, and the dev proto gains a mic-driven ASR panel.

**Tech Stack:** Python 3.11 (3.10 dev-OK) + `sherpa-onnx` + `numpy` + `huggingface_hub` (sidecar); TypeScript + native `WebSocket` + `getUserMedia`/AudioWorklet (renderer); pytest / vitest.

## Global Constraints

- **Electron-only**; reuse Phase 1's gating, `NativeHostManager`, IPC, preload whitelist unchanged.
- **ASR contract** matches `AsrEngine` (`src/lib/local-inference/engine/AsrEngine.ts`): `feedAudio(samples: Int16Array, sampleRate)`, `flush()`, callbacks `onResult(AsrResult)`, `onSpeechStart()`, `onStatus`, `onError`. `AsrResult = { text, startSample?, durationMs, recognitionTimeMs }`.
- **Audio**: client feeds **Int16 PCM @ 24000 Hz** (binary frames); the sidecar downsamples to Float32 @ 16000 Hz for VAD + recognition (same as the WASM worker).
- **Streaming model**: audio frames are **standalone binary frames processed on arrival**; results are **pushed** (not request-correlated). `speech_start` on VAD onset, `result` per completed speech segment.
- **First backend: sherpa-onnx offline + VAD** (sense-voice class) — covers the most-used non-Whisper ASR. `sherpa_onnx` imported **lazily inside `AsrEngine.init()`** so the module + fake-engine unit tests run without it. **faster-whisper** (whisper-\*) and **transformers** (voxtral/cohere/granite) are deferred follow-ups.
- **Server refactor must keep all Phase 1 + 2a tests green** — existing handlers gain a `conn=None` 4th param and ignore it.
- **Model hosting**: `huggingface_hub` native cache; `HF_HOME` set by `NativeHostManager`.
- **Blocking note**: VAD+decode are synchronous CPU calls run inside the async connection loop (acceptable for the single-connection PoC; matches Phase 1's Pocket generate). True off-thread execution is a later optimization.
- **tsc not clean repo-wide** — gate on vitest/pytest.

---

## File Structure

- Modify: `sidecar/sokuji_sidecar/server.py` — per-connection `Conn` (ctx + send), binary routing, `conn` passed to handlers.
- Modify: `sidecar/sokuji_sidecar/pocket_engine.py`, `translate_engine.py` — handlers accept `conn=None`.
- Create: `sidecar/sokuji_sidecar/asr_engine.py` — sherpa-onnx VAD+offline ASR + handlers.
- Modify: `sidecar/sokuji_sidecar/__main__.py` — register the ASR engine.
- Create/Modify tests: `sidecar/tests/test_server_conn.py`, `sidecar/tests/test_asr_engine.py`.
- Create: `src/lib/local-inference/native/NativeAsrClient.ts` + `.test.ts`; modify `nativeProtocol.ts`.
- Modify: `src/components/dev/NativeTtsProto.tsx` — ASR panel (mic → feed → transcripts).

---

## Task 1: Server refactor — per-connection context + binary routing

**Files:**
- Modify: `sidecar/sokuji_sidecar/server.py`
- Modify: `sidecar/sokuji_sidecar/pocket_engine.py`, `sidecar/sokuji_sidecar/translate_engine.py`
- Test: `sidecar/tests/test_server_conn.py` (plus all existing tests must stay green)

**Interfaces:**
- Produces: `class Conn` with `.ctx: dict` and `async send(obj=None, binary=None)`. `handle_message(state, raw, binary_in=None, conn=None)`. Handlers are now called as `handler(state, msg, binary_in, conn)`. When `conn.ctx["on_binary"]` is set (a `bytes -> list[dict]` callable), standalone binary frames are routed to it and each returned dict is sent; otherwise binary frames buffer as `pending_binary` (Phase 1 set_voice behavior).

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_server_conn.py`:

```python
import asyncio, json
from sokuji_sidecar.server import handle_message, Conn


class FakeWS:
    def __init__(self): self.sent = []
    async def send(self, d): self.sent.append(d)


def test_conn_send_json_and_binary():
    ws = FakeWS()
    conn = Conn(ws)
    asyncio.run(conn.send({"a": 1}))
    asyncio.run(conn.send(binary=b"\x00\x01"))
    assert ws.sent == [json.dumps({"a": 1}), b"\x00\x01"]


def test_handle_message_passes_conn_to_handler():
    seen = {}
    async def h(state, msg, binary_in, conn):
        seen["conn"] = conn
        return {"type": "okk", "id": msg["id"]}, None
    state = {"handlers": {"probe": h}}
    conn = Conn(FakeWS())
    reply, _ = asyncio.run(handle_message(state, json.dumps({"type": "probe", "id": 5}), None, conn))
    assert reply == {"type": "okk", "id": 5} and seen["conn"] is conn
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && .venv/bin/python -m pytest tests/test_server_conn.py -q`. Expected: FAIL (`Conn` missing / `handle_message` arity).

- [ ] **Step 3: Rewrite `server.py`:**

```python
import json
import websockets


class Conn:
    def __init__(self, ws):
        self._ws = ws
        self.ctx = {}

    async def send(self, obj=None, binary=None):
        if binary is not None:
            await self._ws.send(binary)
        if obj is not None:
            await self._ws.send(json.dumps(obj))


async def handle_message(state, raw, binary_in=None, conn=None):
    """Pure dispatch. Returns (json_reply_dict_or_None, binary_reply_bytes_or_None)."""
    msg = json.loads(raw)
    mtype = msg.get("type")
    mid = msg.get("id")
    if mtype == "ping":
        return {"type": "pong", "id": mid}, None
    handler = (state.get("handlers") or {}).get(mtype)
    if handler is None:
        return {"type": "error", "id": mid, "message": f"unknown message type: {mtype}"}, None
    return await handler(state, msg, binary_in, conn)


async def _conn(state, ws):
    conn = Conn(ws)
    pending_binary = None
    async for raw in ws:
        if isinstance(raw, (bytes, bytearray)):
            data = bytes(raw)
            feeder = conn.ctx.get("on_binary")   # ASR streaming: process immediately
            if feeder is not None:
                for out in feeder(data):
                    await conn.send(out)
            else:
                pending_binary = data            # set_voice: buffer for next control msg
            continue
        try:
            reply, binary = await handle_message(state, raw, pending_binary, conn)
        except Exception as e:
            reply, binary = {"type": "error", "message": str(e)}, None
        pending_binary = None
        if binary is not None:
            await ws.send(binary)
        if reply is not None:
            await ws.send(json.dumps(reply))


async def serve(state=None, host="127.0.0.1", port=0):
    state = state if state is not None else {}
    server = await websockets.serve(lambda ws: _conn(state, ws), host, port)
    bound_port = server.sockets[0].getsockname()[1]
    state["_server"] = server
    return bound_port, server
```

- [ ] **Step 4: Add `conn=None` to existing handlers.** In `pocket_engine.py` change the three handler signatures to `async def _h_init(state, msg, _b, conn=None):`, `_h_set_voice(state, msg, binary_in, conn=None):`, `_h_generate(state, msg, _b, conn=None):`. In `translate_engine.py` change `_h_translate_init(state, msg, _b, conn=None):` and `_h_translate(state, msg, _b, conn=None):`. Bodies unchanged.

- [ ] **Step 5: Run the full suite, expect all green.** Run: `cd sidecar && .venv/bin/python -m pytest tests/ -q`. Expected: previous 12 passed + 2 new = **14 passed, 2 skipped** (existing tests unaffected because `handle_message` defaults `conn=None`).

- [ ] **Step 6: Commit.**

```bash
git add sidecar/sokuji_sidecar/server.py sidecar/sokuji_sidecar/pocket_engine.py sidecar/sokuji_sidecar/translate_engine.py sidecar/tests/test_server_conn.py
git commit -m "refactor(sidecar): per-connection Conn + binary routing for streaming stages"
```

---

## Task 2: Sidecar ASR engine + streaming handlers

**Files:**
- Create: `sidecar/sokuji_sidecar/asr_engine.py`
- Modify: `sidecar/sokuji_sidecar/__main__.py`
- Test: `sidecar/tests/test_asr_engine.py`

**Interfaces:**
- Consumes: `Conn.ctx`, `pocket_inference.resample_to_24k` is NOT reused (ASR needs 24k→16k); a local `_downsample_int16_to_f32_16k` is provided.
- Produces: WS — `{"type":"asr_init","id","model"?,"language"?}` → `{"type":"ready","id","loadTimeMs"}` and sets `conn.ctx["on_binary"]`; standalone binary Int16@24k frames → pushed `{"type":"speech_start"}` / `{"type":"result","text","startSample","durationMs","recognitionTimeMs"}`; `{"type":"asr_flush","id"}` → drains, then `{"type":"ok","id"}`. Python: `class AsrEngine` with `init(model_id, language) -> int`, `feed(int16_bytes) -> list[dict]`, `flush() -> list[dict]`.

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_asr_engine.py` (fake engine — no sherpa needed; covers handler + binary routing):

```python
import asyncio, json
import numpy as np
from sokuji_sidecar import server, asr_engine


class FakeAsr:
    def init(self, model_id=None, language=""):
        return 33

    def feed(self, int16_bytes):
        # emit one result whenever >= 24000 samples (1s) are fed in a single chunk
        n = len(np.frombuffer(int16_bytes, dtype=np.int16))
        if n >= 24000:
            return [{"type": "speech_start"},
                    {"type": "result", "text": "hello", "startSample": 0,
                     "durationMs": 1000, "recognitionTimeMs": 5}]
        return []

    def flush(self):
        return [{"type": "result", "text": "tail", "startSample": 0,
                 "durationMs": 100, "recognitionTimeMs": 1}]


def make():
    st = {"asr_engine": FakeAsr(), "handlers": {}}
    asr_engine.register(st)
    conn = server.Conn(_FakeWS())
    return st, conn


class _FakeWS:
    def __init__(self): self.sent = []
    async def send(self, d): self.sent.append(d)


def test_asr_init_sets_binary_router_and_replies_ready():
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1, "language": "en"}), None, conn))
    assert reply == {"type": "ready", "id": 1, "loadTimeMs": 33}
    assert callable(conn.ctx.get("on_binary"))


def test_binary_router_emits_results():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    audio = np.zeros(24000, np.int16).tobytes()
    out = conn.ctx["on_binary"](audio)
    types = [m["type"] for m in out]
    assert types == ["speech_start", "result"] and out[1]["text"] == "hello"


def test_asr_flush_drains():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_flush", "id": 2}), None, conn))
    # flush pushes results via conn.send, then acks
    assert reply == {"type": "ok", "id": 2}
    assert any('"tail"' in s for s in conn._ws.sent)
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -q`. Expected: FAIL (`asr_engine` missing).

- [ ] **Step 3: Implement `asr_engine.py`** (sherpa-onnx lazy; VAD→downsample→offline recognize):

```python
import os, time
import numpy as np

TARGET_RATE = 16000
SRC_RATE = 24000


def _downsample_int16_to_f32_16k(int16_bytes, src_rate=SRC_RATE):
    x = np.frombuffer(int16_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    if src_rate == TARGET_RATE:
        return x
    ratio = TARGET_RATE / src_rate
    n = round(len(x) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.floor(pos).astype(np.int64)
    frac = (pos - i0).astype(np.float32)
    a = x[np.clip(i0, 0, len(x) - 1)]
    b = x[np.clip(i0 + 1, 0, len(x) - 1)]
    return (a + (b - a) * frac).astype(np.float32)


class AsrEngine:
    """sherpa-onnx VAD + offline recognition. Feed Int16@24k bytes, get text per VAD segment."""

    def __init__(self):
        self._vad = None
        self._rec = None
        self._sample_cursor = 0

    def init(self, model_id=None, language=""):
        import sherpa_onnx  # lazy: native lib pulled here
        from huggingface_hub import snapshot_download
        t0 = time.time()
        repo = model_id or os.environ.get(
            "SOKUJI_ASR_REPO", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        d = snapshot_download(repo_id=repo)
        vad_cfg = sherpa_onnx.VadModelConfig()
        vad_cfg.silero_vad.model = f"{d}/silero_vad.onnx" if os.path.exists(f"{d}/silero_vad.onnx") \
            else snapshot_download("csukuangfj/sherpa-onnx-vad") + "/silero_vad.onnx"
        vad_cfg.sample_rate = TARGET_RATE
        self._vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=30)
        self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt", use_itn=True)
        return int((time.time() - t0) * 1000)

    def _drain(self):
        out = []
        while not self._vad.empty():
            seg = self._vad.front
            stream = self._rec.create_stream()
            stream.accept_waveform(TARGET_RATE, seg.samples)
            t0 = time.time()
            self._rec.decode_stream(stream)
            text = stream.result.text.strip()
            self._vad.pop()
            if text:
                out.append({"type": "result", "text": text,
                            "startSample": int(seg.start),
                            "durationMs": int(len(seg.samples) / TARGET_RATE * 1000),
                            "recognitionTimeMs": int((time.time() - t0) * 1000)})
        return out

    def feed(self, int16_bytes):
        samples = _downsample_int16_to_f32_16k(int16_bytes)
        out = []
        was_detected = self._vad.is_speech_detected()
        self._vad.accept_waveform(samples)
        if not was_detected and self._vad.is_speech_detected():
            out.append({"type": "speech_start"})
        out.extend(self._drain())
        return out

    def flush(self):
        self._vad.flush()
        return self._drain()


async def _h_asr_init(state, msg, _b, conn=None):
    eng = state["asr_engine"]
    ms = eng.init(msg.get("model"), msg.get("language", ""))
    if conn is not None:
        conn.ctx["on_binary"] = eng.feed   # route subsequent binary frames to the recognizer
    return {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}, None


async def _h_asr_flush(state, msg, _b, conn=None):
    for out in state["asr_engine"].flush():
        if conn is not None:
            await conn.send(out)
    return {"type": "ok", "id": msg.get("id")}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"asr_init": _h_asr_init, "asr_flush": _h_asr_flush})
```

- [ ] **Step 4: Register the ASR engine in `__main__.py`** — extend `_run` state + registration:

```python
async def _run():
    from .pocket_engine import PocketEngine, register as register_pocket
    from .translate_engine import TranslateEngine, register as register_translate
    from .asr_engine import AsrEngine, register as register_asr
    state = {"engine": PocketEngine(), "translate_engine": TranslateEngine(), "asr_engine": AsrEngine()}
    register_pocket(state)
    register_translate(state)
    register_asr(state)
    port, server = await serve(state)
    print(json.dumps({"port": port}), flush=True)
    await server.wait_closed()
```

- [ ] **Step 5: Run tests, expect pass.** Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -q`. Expected: 3 passed. Then full suite: `.venv/bin/python -m pytest tests/ -q` → **17 passed, 2 skipped**.

- [ ] **Step 6: (env-permitting) real-model smoke** — optional, behind a model-gated manual run:

```bash
cd sidecar && .venv/bin/pip install sherpa-onnx
.venv/bin/python -c "
import numpy as np
from sokuji_sidecar.asr_engine import AsrEngine
e = AsrEngine(); print('loadMs', e.init())
# feed 2s of a real wav (16-bit @24k) here; verify a result dict comes back
"
```
Skip if the env can't fetch sherpa-onnx / models.

- [ ] **Step 7: Commit.**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/sokuji_sidecar/__main__.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): sherpa-onnx VAD+offline ASR engine + streaming handlers"
```

---

## Task 3: Renderer NativeAsrClient (push model)

**Files:**
- Create: `src/lib/local-inference/native/NativeAsrClient.ts`
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`
- Test: `src/lib/local-inference/native/NativeAsrClient.test.ts`

**Interfaces:**
- Consumes: `native-host:start`; the `asr_init`/binary/`asr_flush` contract; pushed `speech_start`/`result`.
- Produces: `class NativeAsrClient` with `onResult: ((r:{text:string;startSample?:number;durationMs:number;recognitionTimeMs:number})=>void)|null`, `onSpeechStart`, `onStatus`, `onError`; `async init(language?, modelId?): Promise<{loadTimeMs}>`; `feedAudio(samples: Int16Array, sampleRate: number): void`; `async flush(): Promise<void>`; `dispose()`.

- [ ] **Step 1: Write the failing test** `src/lib/local-inference/native/NativeAsrClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    if (typeof d === 'string') {
      const msg = JSON.parse(d);
      if (msg.type === 'asr_init') queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, loadTimeMs: 2 }) }));
      if (msg.type === 'asr_flush') queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: 'ok', id: msg.id }) }));
    } else {
      // binary audio frame → push speech_start + result
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'speech_start' }) }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
        { type: 'result', text: 'hi', startSample: 0, durationMs: 10, recognitionTimeMs: 1 }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeAsrClient', () => {
  it('inits then pushes speech_start + result on fed audio', async () => {
    const c = new NativeAsrClient();
    const results: string[] = [];
    let starts = 0;
    c.onResult = (r) => results.push(r.text);
    c.onSpeechStart = () => { starts++; };
    const r = await c.init('en');
    expect(r).toEqual({ loadTimeMs: 2 });
    c.feedAudio(new Int16Array(24000), 24000);
    await new Promise((res) => setTimeout(res, 5));
    expect(starts).toBe(1);
    expect(results).toEqual(['hi']);
  });
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Extend `nativeProtocol.ts`** — append:

```typescript
export interface SpeechStartMsg { type: 'speech_start'; }
export interface AsrResultMsg { type: 'result'; text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }
```

and add `| SpeechStartMsg | AsrResultMsg` to the `ServerMsg` union. (Note: `ResultMsg` from Phase 1 has an `id`; the ASR `result` is pushed without an id — discriminated by absence of `id`/presence of `text`.)

- [ ] **Step 4: Implement `NativeAsrClient.ts`:**

```typescript
import type { ServerMsg } from './nativeProtocol';

export interface NativeAsrResult { text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeAsrClient {
  onResult: ((r: NativeAsrResult) => void) | null = null;
  onSpeechStart: (() => void) | null = null;
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (m: ServerMsg) => void>();

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  private onMessage(data: any) {
    const msg = JSON.parse(data) as any;
    if (msg.type === 'speech_start') { this.onSpeechStart?.(); return; }
    if (msg.type === 'result' && msg.id === undefined) {
      this.onResult?.({ text: msg.text, startSample: msg.startSample, durationMs: msg.durationMs, recognitionTimeMs: msg.recognitionTimeMs });
      return;
    }
    if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.pending.delete(msg.id); return; }
    if (typeof msg.id === 'number') { this.pending.get(msg.id)?.(msg); this.pending.delete(msg.id); }
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async init(language = '', modelId?: string): Promise<{ loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-asr] init…');
    const msg = await this.send({ type: 'asr_init', language, model: modelId });
    return { loadTimeMs: (msg as Extract<ServerMsg, { type: 'ready' }>).loadTimeMs };
  }

  feedAudio(samples: Int16Array, _sampleRate: number): void {
    this.ws?.send(samples.buffer);   // server is in asr binary mode after init
  }

  async flush(): Promise<void> { await this.send({ type: 'asr_flush' }); }

  dispose(): void { try { this.ws?.close(); } catch (_) {} this.ws = null; this.pending.clear(); }
}
```

- [ ] **Step 5: Run tests, expect pass.** Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`. Expected: 1 passed. Then `npx vitest run src/lib/local-inference/native/` → all native tests pass.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/local-inference/native/NativeAsrClient.ts src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeAsrClient.test.ts
git commit -m "feat(renderer): NativeAsrClient streaming WS client + ASR protocol"
```

---

## Task 4: Dev proto — ASR panel (mic → transcripts)

**Files:**
- Modify: `src/components/dev/NativeTtsProto.tsx`
- Test: manual (dev).

**Interfaces:**
- Consumes: `NativeAsrClient`, `getUserMedia` + an `AudioContext`/`ScriptProcessor` to produce Int16@24k frames.

- [ ] **Step 1: Add an ASR panel** to `NativeTtsProto.tsx`:

```tsx
// add import:
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';

// inside the component:
  const aclient = useRef<NativeAsrClient | null>(null);
  const micStop = useRef<(() => void) | null>(null);

  const startAsr = async () => {
    if (micStop.current) { micStop.current(); micStop.current = null; push('asr stopped'); return; }
    aclient.current = new NativeAsrClient();
    aclient.current.onStatus = push;
    aclient.current.onError = (e) => push('ERROR: ' + e);
    aclient.current.onSpeechStart = () => push('· speech_start');
    aclient.current.onResult = (r) => push(`asr: "${r.text}" (${r.recognitionTimeMs}ms)`);
    const r = await aclient.current.init('en');
    push(`asr ready loadMs=${r.loadTimeMs}`);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000 } });
    const ac = new AudioContext({ sampleRate: 24000 });
    const src = ac.createMediaStreamSource(stream);
    const node = ac.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
      aclient.current?.feedAudio(i16, 24000);
    };
    src.connect(node); node.connect(ac.destination);
    micStop.current = () => { node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ac.close(); aclient.current?.flush(); };
    push('asr listening… (click again to stop)');
  };
```

and in the JSX before the log `<pre>`:

```tsx
      <hr style={{ margin: '16px 0', borderColor: '#444' }} />
      <h4>ASR (mic)</h4>
      <button onClick={startAsr}>start / stop mic ASR</button>
```

- [ ] **Step 2: Sanity-check native vitest still green.** Run: `npx vitest run src/lib/local-inference/native/`. Expected: all native tests pass.

- [ ] **Step 3: Manual e2e (env-permitting).** `npm run electron:dev` → `Ctrl+Shift+N` → "start mic ASR" → speak → transcripts log. Requires sherpa-onnx + models + a mic; skip if headless.

- [ ] **Step 4: Commit.**

```bash
git add src/components/dev/NativeTtsProto.tsx
git commit -m "feat(dev): add mic ASR panel to native sidecar proto"
```

---

## Self-Review

**Spec coverage (Phase 2, ASR half):** native ASR backend (sherpa-onnx VAD+offline, Task 2) with the **streaming protocol** the spec called out as ASR-specific (binary frames + pushed partial/final), enabled by the server refactor (Task 1); renderer push-model client (Task 3); proof of life with mic (Task 4). **faster-whisper** and **transformers (voxtral/cohere/granite)** backends, plus true **partial** results from streaming models, are deferred follow-ups.

**Placeholder scan:** every step carries complete code; env-gated real-model runs (Task 2 Step 6, Task 4 Step 3) are explicitly optional, with fake-engine/fake-WS unit tests as the always-on gate. The sherpa-onnx model file names (`model.int8.onnx`/`tokens.txt`/`silero_vad.onnx`) and the `from_sense_voice` API are the model/library-specific points to verify against the actual `sherpa-onnx` release (Task 2 Step 6 catches mismatches) — the same class of flagged uncertainty as Pocket's ONNX feed names.

**Type consistency:** `AsrResult { text, startSample?, durationMs, recognitionTimeMs }` flows identically through the pushed `result` message, `NativeAsrClient.onResult`, and the proto. `asr_init`/`asr_flush`/`ready`/`ok`/`speech_start`/`result` names match between `asr_engine.py`, `nativeProtocol.ts`, and the client. The server refactor's `handle_message(state, raw, binary_in, conn)` and the `conn=None` handler signatures are consistent across `server.py`, `pocket_engine.py`, `translate_engine.py`, and `asr_engine.py`. ASR `result` (no `id`) is disambiguated from Phase 1's TTS `result` (`id`-bearing) by id-presence in `NativeAsrClient.onMessage`.

## Execution Handoff

Execute task-by-task (subagent-driven or inline), committing each in the worktree.
